/**
 * 工厂负载监控 API 路由
 *
 * 提供 5 个监控端点：
 *   1. GET /api/monitor/overview         - 工厂总览
 *   2. GET /api/monitor/workshops         - 所有车间
 *   3. GET /api/monitor/workshop/:id      - 指定车间详情
 *   4. GET /api/monitor/equipment/:name   - 指定设备详情
 *   5. GET /api/monitor/equipment-types   - 设备类型列表
 */
const express = require('express');
const AggregationEngine = require('../services/aggregationEngine');
const KingdeeClient = require('../services/kingdeeService');
const ProductionBoardService = require('../services/productionBoardService');
const DailyReport = require('../services/dailyProductionReport');
const LossService = require('../services/lossService');
const FillBoxService = require('../services/fillBoxService');
const StagnantService = require('../services/stagnantService');
const { pushStagnantReport } = require('../services/stagnantReport');
const { sendMarkdown } = require('../services/dingTalkRobot');
const MesRecordMapper = require('../services/mesRecordMapper');
const config = require('../config');
const { WORKSHOPS } = require('../config/workshopMasterData');

const router = express.Router();

// 数据起始年份（与金蝶同步起点一致）；不设结束年，跨年后无需再改代码
const FIRST_DATA_YEAR = parseInt(String(config.kingdee.dataStartDate || '2025-01-01').slice(0, 4), 10) || 2025;

/** @type {AggregationEngine} */
let engine = null;

/** @type {import('../services/powerSyncService')} */
let powerService = null;

/** @type {ProductionBoardService} */
let boardService = null;

/** @type {LossService} */
let lossService = null;

/** @type {FillBoxService} */
let fillBoxService = null;

/** @type {StagnantService} */
let stagnantService = null;

/** 呆滞成品服务（懒初始化，复用引擎的金蝶客户端） */
function getStagnantService() {
  if (!stagnantService) {
    stagnantService = new StagnantService({ client: getEngine().client });
    stagnantService.initialize();
  }
  return stagnantService;
}

/** 灌装/成品对比服务（懒初始化，复用引擎金蝶客户端 + 损耗库路径） */
function getFillBoxService() {
  if (!fillBoxService) {
    const eng = getEngine();
    fillBoxService = new FillBoxService({
      client: eng.client,
      lossDbPath: config.loss.dbPath,
      // 2026-09-14 起灌装数量取 MES（成品折算仍走 PRD_INSTOCK × 盒条比）
      mesFill: (from, to) => eng.getMesFillSummary(from, to),
    });
    fillBoxService.initialize();
  }
  return fillBoxService;
}

/** 获取生产执行看板服务（懒初始化，复用引擎的 SQLite 与金蝶客户端；注入电表服务供日维度用电量分摊） */
function getBoardService() {
  if (!boardService) {
    const eng = getEngine();
    // 记录来源用引擎的合并结果（金蝶 < 2026-09-14 + MES >= 2026-09-14）
    boardService = new ProductionBoardService({
      db: eng.db,
      client: eng.client,
      powerService,
      getAllRecords: () => eng.getAllRecordsMerged(),
    });
  }
  return boardService;
}

/** 获取损耗数据服务（懒初始化） */
function getLossService() {
  if (!lossService) {
    lossService = new LossService();
    lossService.initialize();
  }
  return lossService;
}

/**
 * 损耗接口以「材料编码 MP 开头」为判定标准（不只看产品名是否叫"条袋"）。
 * 记录里没有 MP 编码字段，只能按产品名放宽匹配：凡产品名含「袋」（条袋/软袋/散袋/三边封袋装/PE袋装等袋装系列）
 * 都可能是 MP 订单走 stick-data，由损耗接口裁决是否真有数据（非 MP 返回错误即跳过）。
 */
function isLossPouchProduct(name) {
  return name.includes('袋')
}

/**
 * 从看板生产记录里收集可能可查损耗的袋装订单号
 * @param {string} fromDate - YYYY-MM-DD
 * @param {string} toDate   - YYYY-MM-DD
 * @returns {string[]} 去重后的订单号
 */
function listStickMoNumbers(fromDate, toDate) {
  const eng = getEngine();
  if (!eng || !eng.db) return [];
  const all = eng.db.getAllRecords();
  const mos = new Set();
  for (const r of all) {
    const f = r.fields || {};
    const prodDate = (f.F_UNW_Date2 || '').trim().slice(0, 10) || r.date;
    if (!prodDate || prodDate < fromDate || prodDate > toDate) continue;
    const mo = (f.FMoNumber || '').trim();
    const name = (f.FMaterialName || '').trim();
    if (mo && isLossPouchProduct(name)) mos.add(mo);
  }
  return [...mos];
}

/**
 * 初始化聚合引擎（在服务启动时调用）
 */
function initEngine() {
  const client = KingdeeClient.fromEnv();
  engine = new AggregationEngine(client);
  return engine;
}

/**
 * 获取引擎实例
 */
function getEngine() {
  if (!engine) {
    initEngine();
  }
  return engine;
}

/**
 * 设置电表数据服务（可选，不设置则降级）
 */
function setPowerService(ps) {
  powerService = ps;
}

// 内联缓存：key = `${dimension}_${endpoint}_{params}`
const responseCache = new Map();
const CACHE_TTL_MS = (config.cache.ttl || 3600) * 1000;

function getCached(key) {
  const entry = responseCache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
    return entry.data;
  }
  return null;
}

function setCache(key, data) {
  responseCache.set(key, { data, timestamp: Date.now() });
}

// ====== 请求处理中间件 ======

/**
 * 校验 dimension 参数并解析 year 和可选的 startDate/endDate
 */
function parseParams(req) {
  const dim = (req.query.dimension || 'day').toLowerCase();
  if (!['day', 'week', 'month', 'year'].includes(dim)) {
    return { valid: false, error: 'dimension 必须是 day、week、month 或 year' };
  }
  const yearStr = req.query.year;
  let year;
  if (yearStr) {
    year = parseInt(yearStr, 10);
    if (isNaN(year) || year < FIRST_DATA_YEAR) {
      return { valid: false, error: `year 必须是不早于 ${FIRST_DATA_YEAR} 的年份` };
    }
  }
  // 可选的日期范围参数
  const startDate = req.query.startDate || undefined;
  const endDate = req.query.endDate || undefined;
  if (startDate && endDate) {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return { valid: false, error: 'startDate 和 endDate 格式必须为 YYYY-MM-DD' };
    }
    if (startDate > endDate) {
      return { valid: false, error: 'startDate 不能晚于 endDate' };
    }
  }
  return { valid: true, dimension: dim, year, startDate, endDate };
}

/**
 * 封装成功响应
 */
function success(res, data) {
  return res.json({ code: 0, msg: 'success', data });
}

/**
 * 封装错误响应
 */
function fail(res, status, msg) {
  return res.status(status).json({ code: status, msg });
}

/**
 * 将电表数据合并到车间详情响应
 */
function mergePowerToWorkshopDetail(data, workshopName, dimension, year, startDate, endDate) {
  if (!powerService || !powerService.isAvailable()) return;

  try {
    // 有日期范围时使用日粒度展示趋势
    const trendDim = (startDate && endDate) ? 'day' : dimension;
    const powerTrend = powerService.getWorkshopPowerTrend(workshopName, trendDim, year, startDate, endDate);
    data.powerTrend = powerTrend;

    data.powerCostTrend = powerService.getWorkshopPowerCostTrend(workshopName, trendDim, year, startDate, endDate);

    const latestKwh = powerService.getLatestWorkshopPower(workshopName, trendDim, year, startDate, endDate);
    data.totalPower = latestKwh;
    data.totalPowerCost = +(latestKwh * powerService.pricePerKwh).toFixed(2);
  } catch (err) {
    console.warn('[monitor] 车间电表数据合并失败:', err.message);
  }
}

// ====== 1. 工厂总览 ======

/**
 * 将电表数据合并到总览响应（如果 powerService 可用）
 */
function mergePowerToOverview(data, dimension, year, startDate, endDate) {
  if (!powerService || !powerService.isAvailable()) return;

  try {
    // 有日期范围时使用日粒度展示趋势
    const trendDim = (startDate && endDate) ? 'day' : dimension;

    // 全厂用电量趋势（kWh）
    const powerTrend = powerService.getPowerTrend(trendDim, year, startDate, endDate);
    data.powerTrend = powerTrend;

    // 全厂电费趋势（元）
    data.powerCostTrend = powerService.getPowerCostTrend(trendDim, year, startDate, endDate);

    // 当前最新时段用电量
    const latestKwh = powerService.getLatestPower(trendDim, year, startDate, endDate);
    data.totalPower = latestKwh;
    data.totalPowerCost = +(latestKwh * powerService.pricePerKwh).toFixed(2);

    // 各车间用电量
    const wsPowerMap = powerService.getWorkshopPowerMap(trendDim, year, startDate, endDate);
    for (const ws of data.workshops) {
      const wsKwh = wsPowerMap.get(ws.name) || 0;
      ws.power = wsKwh;
      ws.powerCost = +(wsKwh * powerService.pricePerKwh).toFixed(2);
    }
  } catch (err) {
    console.warn('[monitor] 电表数据合并失败:', err.message);
  }
}

/**
 * GET /api/monitor/overview
 * 返回工厂总览：9个车间的负载率、产出率、总产量，以及全厂汇总指标。
 *
 * Query params:
 *   dimension - day (默认) | week | month | year
 *   startDate - 可选，日期范围起始 YYYY-MM-DD
 *   endDate - 可选，日期范围结束 YYYY-MM-DD
 */
router.get('/overview', async (req, res) => {
  const dimResult = parseParams(req);
  if (!dimResult.valid) return fail(res, 400, dimResult.error);
  const { dimension, year, startDate, endDate } = dimResult;

  const cacheKey = `overview_${dimension}_${year || ''}_${startDate || ''}_${endDate || ''}`;
  const cached = getCached(cacheKey);
  if (cached) return success(res, cached);

  try {
    const eng = getEngine();
    const data = await eng.getOverview(dimension, year, startDate, endDate);
    mergePowerToOverview(data, dimension, year, startDate, endDate);
    // 年维度附加计划订单数据
    if (dimension === 'year' && year) {
      await eng.mergePlannedOrderInfo(data, year);
    }
    setCache(cacheKey, data);
    return success(res, data);
  } catch (err) {
    console.error('[monitor] /overview 失败:', err.message);
    return fail(res, 502, `数据获取失败: ${err.message}`);
  }
});

// ====== 2. 所有车间 ======

/**
 * GET /api/monitor/workshops
 * 返回所有车间列表及各自聚合数据。
 *
 * Query params:
 *   dimension - day (默认) | week | month | year
 *   startDate - 可选，日期范围起始 YYYY-MM-DD
 *   endDate - 可选，日期范围结束 YYYY-MM-DD
 */
router.get('/workshops', async (req, res) => {
  const dimResult = parseParams(req);
  if (!dimResult.valid) return fail(res, 400, dimResult.error);
  const { dimension, year, startDate, endDate } = dimResult;

  const cacheKey = `workshops_${dimension}_${year || ''}_${startDate || ''}_${endDate || ''}`;
  const cached = getCached(cacheKey);
  if (cached) return success(res, cached);

  try {
    const eng = getEngine();
    const workshops = await eng.getWorkshops(dimension, year, startDate, endDate);
    setCache(cacheKey, workshops);
    return success(res, {
      dimension,
      year,
      total: workshops.length,
      workshops,
    });
  } catch (err) {
    console.error('[monitor] /workshops 失败:', err.message);
    return fail(res, 502, `数据获取失败: ${err.message}`);
  }
});

// ====== 3. 指定车间详情 ======

/**
 * GET /api/monitor/workshop/:id
 * 返回指定车间详情：设备列表、产量趋势、负载趋势。
 *
 * URL params:
 *   id - 车间名称（URL 编码）
 * Query params:
 *   dimension - day (默认) | week | month | year
 *   startDate - 可选，日期范围起始 YYYY-MM-DD
 *   endDate - 可选，日期范围结束 YYYY-MM-DD
 */
router.get('/workshop/:id', async (req, res) => {
  const dimResult = parseParams(req);
  if (!dimResult.valid) return fail(res, 400, dimResult.error);
  const { dimension, year, startDate, endDate } = dimResult;

  const workshopName = decodeURIComponent(req.params.id);
  if (!workshopName) return fail(res, 400, '缺少车间名称');

  const cacheKey = `workshop_${workshopName}_${dimension}_${year || ''}_${startDate || ''}_${endDate || ''}`;
  const cached = getCached(cacheKey);
  if (cached) return success(res, cached);

  try {
    const eng = getEngine();
    const data = await eng.getWorkshopDetail(workshopName, dimension, year, startDate, endDate);
    mergePowerToWorkshopDetail(data, workshopName, dimension, year, startDate, endDate);
    setCache(cacheKey, data);
    return success(res, data);
  } catch (err) {
    console.error('[monitor] /workshop/:id 失败:', err.message);
    return fail(res, 502, `数据获取失败: ${err.message}`);
  }
});

// ====== 4. 指定设备详情 ======

/**
 * GET /api/monitor/equipment/:name
 * 返回指定设备详情：负载率趋势、产出率趋势、OEE 趋势。
 *
 * URL params:
 *   name - 设备名称（URL 编码）
 * Query params:
 *   dimension - day (默认) | week | month | year
 *   startDate - 可选，日期范围起始 YYYY-MM-DD
 *   endDate - 可选，日期范围结束 YYYY-MM-DD
 */
router.get('/equipment/:name', async (req, res) => {
  const dimResult = parseParams(req);
  if (!dimResult.valid) return fail(res, 400, dimResult.error);
  const { dimension, year, startDate, endDate } = dimResult;

  const equipmentName = decodeURIComponent(req.params.name);
  if (!equipmentName) return fail(res, 400, '缺少设备名称');

  const cacheKey = `equipment_${equipmentName}_${dimension}_${year || ''}_${startDate || ''}_${endDate || ''}`;
  const cached = getCached(cacheKey);
  if (cached) return success(res, cached);

  try {
    const eng = getEngine();
    const data = await eng.getEquipmentDetail(equipmentName, dimension, year, startDate, endDate);
    setCache(cacheKey, data);
    return success(res, data);
  } catch (err) {
    console.error('[monitor] /equipment/:name 失败:', err.message);
    return fail(res, 502, `数据获取失败: ${err.message}`);
  }
});

// ====== 5. 设备类型列表 ======

/**
 * GET /api/monitor/equipment-types
 * 返回设备类型列表（粉体/液体），用于筛选。
 */
router.get('/equipment-types', (req, res) => {
  const eng = getEngine();
  const types = eng.getEquipmentTypes();
  return success(res, { types });
});

// ====== 6. 手动同步 ======

/**
 * POST /api/monitor/sync
 * 手动触发全量同步：先同步金蝶生产数据，再同步电表数据，最后清除缓存。
 * 返回同步结果给前端显示。
 */
router.post('/sync', async (req, res) => {
  const eng = getEngine();
  const results = { production: null, power: null };

  // 同步金蝶生产数据
  try {
    const { count } = await eng.syncNow();
    results.production = { status: 'ok', count };
  } catch (err) {
    console.error('[monitor] 手动同步生产数据失败:', err.message);
    results.production = { status: 'error', message: err.message };
  }

  // 同步电表数据
  if (powerService) {
    try {
      await powerService.sync();
      // powerService.sync() 内部已清除缓存并触发 _onSync → clearCache
      results.power = { status: 'ok' };
    } catch (err) {
      console.error('[monitor] 手动同步电表数据失败:', err.message);
      results.power = { status: 'error', message: err.message };
    }
  }

  // 同步生产入库(灌装/成品对比数据源)
  try {
    const fb = getFillBoxService();
    const r = await fb.syncPrdInstock();
    fb.rebuildRatio();
    results.fillbox = { status: 'ok', count: r.count };
  } catch (err) {
    console.error('[monitor] 手动同步生产入库失败:', err.message);
    results.fillbox = { status: 'error', message: err.message };
  }

  // 额外确保响应缓存已清除
  clearCache();

  // MES 段不在本次同步范围内（它是 1.14 推送进来的，本服务拉不到），
  // 但仍回报其状态，让前端能提示「MES 数据由内网推送、最近 X 分钟前」。
  results.mes = mesStatus(eng);

  return success(res, { sync: results });
});

/**
 * POST /api/monitor/mes-push
 * 接收工厂内网 192.168.1.14 推送的 MES 灌装数据（2026-09-14 起金蝶工序汇报停用后的数据源）。
 *
 * 鉴权：Header X-Mes-Token 必须等于 config.mesPush.token
 * 请求体：{ from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', rows: [...] }
 * 语义：按 [from, to] 窗口整体替换（幂等；MES 报工可改可删）
 */
router.post('/mes-push', (req, res) => {
  const token = String((req.headers && req.headers['x-mes-token']) || '');
  const expected = config.mesPush && config.mesPush.token;
  if (!expected) return fail(res, 500, '服务端未配置 MES 推送 token');
  if (token !== expected) return fail(res, 401, 'token 无效');

  const body = req.body || {};
  const from = String(body.from || '').slice(0, 10);
  const to = String(body.to || '').slice(0, 10);
  const rows = Array.isArray(body.rows) ? body.rows : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return fail(res, 400, 'from/to 必须是 YYYY-MM-DD');
  }
  if (from > to) return fail(res, 400, 'from 不能晚于 to');
  if (!rows) return fail(res, 400, 'rows 必须是数组');

  try {
    const records = MesRecordMapper.mapRows(rows);
    const eng = getEngine();
    eng.replaceMesRecords(records, from, to);
    clearCache();
    console.log(`[monitor] MES 推送入库: ${from} ~ ${to}, 原始 ${rows.length} 行 → 有效 ${records.length} 条`);
    return success(res, { from, to, received: rows.length, stored: records.length, total: eng.getMesRecordCount() });
  } catch (err) {
    console.error('[monitor] MES 推送失败:', err.message);
    return fail(res, 500, `MES 推送失败: ${err.message}`);
  }
});

// ====== 7. 生产执行看板 ======

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 看板日期范围推断：优先用请求参数，否则按维度/年份取默认区间。
 * 前端通常已通过 PeriodSelector 传具体区间，这里是直连 API 时的兜底。
 */
function resolveBoardRange(dimension, year, startDate, endDate) {
  if (startDate && endDate) return { startDate, endDate };
  const now = new Date();
  const currentYear = now.getFullYear();
  const y = year || currentYear;
  const today = fmtDate(now);
  const yStart = `${y}-01-01`;
  const yEnd = `${y}-12-31`;
  const isCur = y === currentYear;

  switch (dimension) {
    case 'month': {
      const m = isCur ? now.getMonth() + 1 : 12;
      const lastDay = new Date(y, m, 0).getDate();
      const ms = String(m).padStart(2, '0');
      const md = String(lastDay).padStart(2, '0');
      return { startDate: `${y}-${ms}-01`, endDate: `${y}-${ms}-${md}` };
    }
    case 'week':
      // 过去年份不做周推断，回退整年
      if (!isCur) return { startDate: yStart, endDate: yEnd };
      {
        const day = now.getDay() || 7; // 周日 = 7
        const monday = new Date(now);
        monday.setDate(now.getDate() - day + 1);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        return { startDate: fmtDate(monday), endDate: fmtDate(sunday) };
      }
    case 'year':
      return { startDate: yStart, endDate: yEnd };
    default: // day
      return { startDate: isCur ? today : yEnd, endDate: isCur ? today : yEnd };
  }
}

/**
 * GET /api/monitor/production-board
 * 生产执行看板：逐班展示 SFC 报工记录（18 列），时间维度复用 日/周/月/年 + 区间。
 *
 * Query params:
 *   dimension - day (默认) | week | month | year
 *   year - 年份（2025/2026）
 *   startDate / endDate - 可选，日期范围 YYYY-MM-DD
 */
router.get('/production-board', async (req, res) => {
  const dimResult = parseParams(req);
  if (!dimResult.valid) return fail(res, 400, dimResult.error);
  const { dimension, year, startDate, endDate } = dimResult;
  const view = req.query.view === 'day' ? 'day' : 'shift';

  const range = resolveBoardRange(dimension, year, startDate, endDate);
  const cacheKey = `production_board_${view}_${dimension}_${year || ''}_${range.startDate}_${range.endDate}`;
  const cached = getCached(cacheKey);
  if (cached) return success(res, cached);

  try {
    const svc = getBoardService();
    const data = await svc.getBoard({ startDate: range.startDate, endDate: range.endDate, view, dimension });
    const payload = {
      dimension,
      year,
      view,
      startDate: range.startDate,
      endDate: range.endDate,
      total: data.rows.length,
      rows: data.rows,
      // 日维度附加日粒度明细（趋势图每日 X 轴用）；班次维度无此字段
      dayRows: data.dayRows || undefined,
      filterOptions: data.filterOptions,
    };
    setCache(cacheKey, payload);
    return success(res, payload);
  } catch (err) {
    console.error('[monitor] /production-board 失败:', err.message);
    return fail(res, 502, `数据获取失败: ${err.message}`);
  }
});

/**
 * PUT /api/monitor/production-note
 * 保存/更新手工录入笔记（未达产原因 / 后续补产方案），按行唯一 key 定位。
 *
 * Body: { fdate, moNumber, shift?, machine?, operator?, workshop?, reason?, recoveryPlan? }
 */
router.put('/production-note', (req, res) => {
  const { fdate, moNumber, shift, machine, operator, workshop, reason, recoveryPlan } = req.body || {};
  if (!fdate || !moNumber) {
    return fail(res, 400, '缺少必填字段 fdate / moNumber');
  }
  try {
    const svc = getBoardService();
    svc.saveNote({ fdate, moNumber, shift, machine, operator, workshop, reason, recoveryPlan });
    clearCache();
    return success(res, { ok: true });
  } catch (err) {
    console.error('[monitor] /production-note 失败:', err.message);
    return fail(res, 500, `保存失败: ${err.message}`);
  }
});

/**
 * DELETE /api/monitor/production-note
 * 删除一条手工录入笔记（未达产原因/后续补产方案均清空时调用）。
 *
 * Body: { fdate, moNumber, shift?, machine?, operator? }
 */
router.delete('/production-note', (req, res) => {
  const { fdate, moNumber, shift, machine, operator } = req.body || {};
  if (!fdate || !moNumber) {
    return fail(res, 400, '缺少必填字段 fdate / moNumber');
  }
  try {
    const svc = getBoardService();
    svc.deleteNote({ fdate, moNumber, shift, machine, operator });
    clearCache();
    return success(res, { ok: true });
  } catch (err) {
    console.error('[monitor] DELETE /production-note 失败:', err.message);
    return fail(res, 500, `删除失败: ${err.message}`);
  }
});

/**
 * POST /api/monitor/production-report/send
 * 手动触发钉钉生产执行日报推送（未配置 webhook 返回错误）。
 *
 * Query/Body: date - 可选，YYYY-MM-DD；缺省推送昨天
 */
router.post('/production-report/send', async (req, res) => {
  const date = String((req.query && req.query.date) || (req.body && req.body.date) || '').trim();
  try {
    const result = await DailyReport.sendDailyReport(getBoardService(), { date: date || undefined });
    return success(res, result);
  } catch (err) {
    console.error('[monitor] /production-report/send 失败:', err.message);
    return fail(res, 500, `推送失败: ${err.message}`);
  }
});

/**
 * GET /api/monitor/mo-loss?moNumber=xxx
 * 某生产订单的损耗数据（读穿缓存：本地 loss_data.db 命中秒回，未命中调外部损耗接口落库）。
 *
 * 返回 data 字段：billNo/type/fstatus/lossRate/totalTheory/totalReal/stockQty/boxStock 等 + entries[]
 * 说明：lossRate 只在 fstatus ∈ {完工,结案,结算} 时有意义；中途订单前端应显示 "—"
 */
router.get('/mo-loss', async (req, res) => {
  const moNumber = String((req.query && req.query.moNumber) || '').trim();
  if (!moNumber) return fail(res, 400, '缺少参数 moNumber');
  try {
    const result = await getLossService().getOrFetchLoss(moNumber);
    return success(res, result);
  } catch (err) {
    console.error(`[monitor] /mo-loss ${moNumber} 失败:`, err.message);
    return fail(res, 500, `损耗查询失败: ${err.message}`);
  }
});

/**
 * POST /api/monitor/loss/prewarm
 * 手动触发损耗预热：拉近 N 天看板出现过的条袋订单损耗入库。
 * Query: days(可选,默认 config.loss.prewarmDays=10)
 */
router.post('/loss/prewarm', async (req, res) => {
  try {
    const days = Math.max(1, parseInt((req.query && req.query.days) || config.loss.prewarmDays, 10) || 10);
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(toDate.getDate() - (days - 1));
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const moNumbers = listStickMoNumbers(fmt(fromDate), fmt(toDate));
    if (!moNumbers.length) return success(res, { ok: true, total: 0, msg: `近 ${days} 天无条袋订单` });
    const result = await getLossService().prewarmMoList(moNumbers);
    return success(res, { ok: true, total: moNumbers.length, days, ...result });
  } catch (err) {
    console.error('[monitor] /loss/prewarm 失败:', err.message);
    return fail(res, 500, `预热失败: ${err.message}`);
  }
});

/**
 * GET /api/monitor/fill-box?startDate=..&endDate=..&dimension=day|week|month|year
 * 灌装 vs 外包成品入库 对比（每个 MP 条袋产品 × 生产日期/时段）
 * data: [{ product, materialCode, label, fillQty(灌装), boxQty(成品折算), diff(差异) }]
 */
router.get('/fill-box', (req, res) => {
  try {
    const startDate = String((req.query && req.query.startDate) || '').trim();
    const endDate = String((req.query && req.query.endDate) || '').trim();
    const dimension = ['week', 'month', 'year'].includes(req.query && req.query.dimension)
      ? req.query.dimension
      : 'day';
    const rows = getFillBoxService().getFillBox({ startDate, endDate, dimension });
    return success(res, { dimension, startDate, endDate, total: rows.length, rows });
  } catch (err) {
    console.error('[monitor] /fill-box 失败:', err.message);
    return fail(res, 500, `查询失败: ${err.message}`);
  }
});

/**
 * POST /api/monitor/fill-box/sync
 * 手动同步生产入库 + 重建盒条比
 */
router.post('/fill-box/sync', async (req, res) => {
  try {
    const r = await getFillBoxService().syncPrdInstock();
    const ratio = getFillBoxService().rebuildRatio();
    return success(res, { ok: true, count: r.count, ratio });
  } catch (err) {
    console.error('[monitor] /fill-box/sync 失败:', err.message);
    return fail(res, 500, `同步失败: ${err.message}`);
  }
});

// ====== 呆滞成品 ======

/**
 * GET /api/monitor/stagnant?days=30
 * 呆滞成品：金蝶即时库存（成品仓、库存量>0），按「生产日期距今 > days 天」判定呆滞。
 * days 只接受白名单（30/60/90），其它值回退到配置默认值。
 * 返回：汇总卡 summary + 按成品汇总的明细 rows（含批号明细 lotsList）+ 趋势 trend
 */
router.get('/stagnant', async (req, res) => {
  try {
    const raw = parseInt(String((req.query && req.query.days) || ''), 10);
    const days = config.stagnant.allowedDays.includes(raw) ? raw : config.stagnant.thresholdDays;
    const svc = getStagnantService();
    const pull = await svc.ensureFresh();
    const data = svc.query({ days });
    return success(res, { ...data, pull });
  } catch (err) {
    console.error('[monitor] /stagnant 失败:', err.message);
    return fail(res, 502, `呆滞成品数据获取失败: ${err.message}`);
  }
});

/** POST /api/monitor/stagnant/sync — 强制重新拉取金蝶即时库存 */
router.post('/stagnant/sync', async (req, res) => {
  try {
    const svc = getStagnantService();
    const pull = await svc.ensureFresh({ force: true });
    return success(res, { ok: true, ...pull });
  } catch (err) {
    console.error('[monitor] /stagnant/sync 失败:', err.message);
    return fail(res, 502, `同步失败: ${err.message}`);
  }
});

/**
 * POST /api/monitor/stagnant/push?days=30&cust=客户A,客户B
 * 把呆滞看板整页截图推到钉钉群（手动触发；定时推送见 index.js 的 pushCron）。
 * days 走白名单；cust 是客户名数组（与页面筛选一致，用于截图时带上筛选态）。
 */
router.post('/stagnant/push', async (req, res) => {
  try {
    const raw = parseInt(String((req.query && req.query.days) || ''), 10);
    const days = config.stagnant.allowedDays.includes(raw) ? raw : config.stagnant.thresholdDays;
    const customers = String((req.query && req.query.cust) || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const r = await pushStagnantReport({ svc: getStagnantService(), days, customers });
    return success(res, r);
  } catch (err) {
    console.error('[monitor] /stagnant/push 失败:', err.message);
    return fail(res, 502, `推送到钉钉失败: ${err.message}`);
  }
});

// ====== 健康检查 ======

/**
 * MES 段状态（9/15 起的数据源）。
 * MES 数据由工厂内网 192.168.1.14 单向推送过来，本服务在公网、拉不到内网，
 * 所以这里只能报告「上次推送时间」，前端据此提示用户为何手动同步不会更新 MES。
 */
function mesStatus(eng) {
  const lastPushAt = eng.getMesLastPushAt();
  return {
    recordCount: eng.getMesRecordCount(),
    lastPushAt,
    ageMinutes: lastPushAt ? Math.round((Date.now() - new Date(lastPushAt).getTime()) / 60000) : null,
    source: 'push', // 由 1.14 定时推送，非本服务主动同步
  };
}

/**
 * GET /api/monitor/health
 * 检查金蝶连接状态
 */
router.get('/health', async (req, res) => {
  const eng = getEngine();
  const client = eng.client;
  const configured = client.isConfigured();
  const loggedIn = client.isLoggedIn();

  // SQLite 状态
  let sqliteStatus = 'not_configured';
  let recordCount = 0;
  let lastSyncTime = null;
  if (eng.db) {
    sqliteStatus = 'connected';
    recordCount = eng.db.getRecordCount();
    lastSyncTime = eng.db.getMeta('lastSyncTime');
  }

  // 电表服务状态
  let powerStatus = 'not_configured';
  let powerRecordCount = 0;
  let powerLastSync = null;
  if (powerService) {
    const avail = powerService.isAvailable();
    powerStatus = avail ? (powerService.isMeterConfigured() ? 'connected' : 'not_configured') : 'error';
    powerRecordCount = powerService.getRecordCount();
    powerLastSync = powerService.getLastSyncTime();
  }

  return success(res, {
    status: configured && loggedIn ? 'connected' : configured ? 'not_logged_in' : 'not_configured',
    configured,
    loggedIn,
    cacheTTL: `${CACHE_TTL_MS / 1000}s`,
    engineCacheSize: eng._cache ? eng._cache.size : 0,
    sqlite: sqliteStatus,
    recordCount,
    lastSyncTime,
    power: powerStatus,
    powerRecordCount,
    powerLastSync,
    mes: mesStatus(eng),
  });
});

/** 清除响应缓存（电表同步完成后调用） */
function clearCache() {
  responseCache.clear();
  console.log('[monitor] 响应缓存已清除');
}

module.exports = router;
module.exports.initEngine = initEngine;
module.exports.setPowerService = setPowerService;
module.exports.clearCache = clearCache;

// 供对外只读接口(routes/open.js)复用同一套服务实例与参数解析
module.exports.getEngine = getEngine;
module.exports.getBoardService = getBoardService;
module.exports.parseParams = parseParams;
module.exports.resolveBoardRange = resolveBoardRange;
module.exports.getCached = getCached;
module.exports.setCache = setCache;

// ====== 同步任务失败告警 ======

/** scope → 'ok' | 'fail'，只记状态 */
const syncAlertState = new Map();

/**
 * 同步任务结果 → 钉钉告警。**只在状态翻转时推**，这点很关键：
 * 同步改成 30 分钟一跑之后，如果每次失败都推，一天就是 48 条，群里会直接无视它。
 *   好 → 坏：推失败告警
 *   坏 → 好：推「已恢复」
 *   一直坏 / 一直好：只写日志，不打扰
 * @param {string} scope - 任务名，如「成品入库同步」
 * @param {boolean} ok
 * @param {string} [detail] - 失败原因
 */
module.exports.notifySyncResult = async (scope, ok, detail = '') => {
  const prev = syncAlertState.get(scope);
  if (ok) {
    syncAlertState.set(scope, 'ok');
    // 没坏过就不必庆祝；也避免启动时把第一次成功误报成「已恢复」
    if (prev !== 'fail') return;
  } else {
    if (prev === 'fail') return; // 一直坏着，别重复推
    syncAlertState.set(scope, 'fail');
  }
  if (!config.robot.webhook) {
    console.warn(`[alert] ${scope} ${ok ? '已恢复' : '失败'}，但未配置 ROBOT_WEBHOOK，只写日志`);
    return;
  }
  const at = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const title = ok ? `✅ ${scope} 已恢复` : `⚠️ ${scope} 失败`;
  const markdown = ok
    ? `### ✅ ${scope} 已恢复正常\n\n**${at}**`
    : `### ⚠️ ${scope} 失败\n\n**${at}**\n\n${String(detail).slice(0, 400)}\n\n> 同步是「**先拉取、校验通过再删旧数据**」，所以失败**不会清空**已有数据，只是这段时间的数据没更新。`;
  const r = await sendMarkdown(config.robot.webhook, config.robot.secret, { title, markdown });
  if (r.ok) console.log(`[alert] 已推送告警: ${title}`);
  else console.error(`[alert] 告警推送失败: ${r.errmsg}`);
};

/**
 * 生成并推送钉钉生产日报（供 index.js 定时任务调用）
 * @param {{ date?: string }} [opts] - date 缺省为昨天
 */
module.exports.sendDailyReport = (opts = {}) => DailyReport.sendDailyReport(getBoardService(), opts);

/**
 * 损耗预热任务（供 index.js 定时任务调用）：拉近 N 天看板出现过的袋装订单损耗入库
 * @param {number} [days]
 * @returns {Promise<{ok:number, fail:number, total:number}>}
 */
module.exports.prewarmLoss = async (days = config.loss.prewarmDays) => {
  const toDate = new Date();
  const fromDate = new Date();
  fromDate.setDate(toDate.getDate() - (days - 1));
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const moNumbers = listStickMoNumbers(fmt(fromDate), fmt(toDate));
  if (!moNumbers.length) return { ok: 0, fail: 0, total: 0 };
  const result = await getLossService().prewarmMoList(moNumbers);
  return { ...result, total: moNumbers.length };
};

/**
 * 灌装/成品入库同步任务（供 index.js 定时 + 损耗预热的扩展）：同步 PRD_INSTOCK + 重建盒条比
 * 损耗预热后调它可让盒条比覆盖最新订单。
 */
module.exports.syncFillBox = async () => {
  const fb = getFillBoxService();
  // 入库同步失败（金蝶返回异常）时，盒条比仍然重建 —— 它读的是 mo_loss，与入库无关；
  // 两者都失败才会让「成品折算」全 0。错误照常往上抛，路由/定时任务能看到。
  let syncErr = null;
  let r = null;
  try {
    r = await fb.syncPrdInstock();
  } catch (err) {
    syncErr = err;
  }
  const ratio = fb.rebuildRatio();
  if (syncErr) throw syncErr;
  return { ...r, ratio };
};

/**
 * 呆滞成品：落一份即时库存快照（供 index.js 每日 cron 调用），顺带清理过期快照。
 * 同一日期重复拉取会整体覆盖，所以多跑几次也只留当天最新的一份。
 */
module.exports.ensureStagnantSnapshot = async () => {
  const svc = getStagnantService();
  const r = await svc.ensureFresh({ force: true });
  svc.prune();
  return r;
};

/** 呆滞成品：推送看板整页截图到钉钉群（供 index.js 每日 cron 调用） */
module.exports.pushStagnantReport = () => pushStagnantReport({ svc: getStagnantService() });
