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
const config = require('../config');
const { WORKSHOPS } = require('../config/workshopMasterData');

const router = express.Router();

/** @type {AggregationEngine} */
let engine = null;

/** @type {import('../services/powerSyncService')} */
let powerService = null;

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
    if (isNaN(year) || year < 2025 || year > 2026) {
      return { valid: false, error: 'year 必须是 2025 或 2026' };
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

  // 额外确保响应缓存已清除
  clearCache();

  return success(res, { sync: results });
});

// ====== 健康检查 ======

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
