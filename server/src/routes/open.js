/**
 * 对外只读接口（/api/open/*）
 *
 * 供**同机其它自研应用**调用，与钉钉页面用的 /api/monitor/* 复用同一套聚合服务。
 *
 * 设计要点：
 *  - 鉴权：请求头 X-Api-Key（值取自 .env 的 OPEN_API_KEY），timing-safe 比较
 *  - 只读：本路由只注册 GET，无任何写接口
 *  - 与钉钉 UA 拦截解耦：/api/open 在 index.js 里豁免钉钉校验，改用 Key 鉴权
 *  - 不设日期范围上限（调用方为同机应用，按需查全量）；结果走引擎/响应缓存
 *
 * 端点：
 *   GET /api/open/health      服务与数据源状态（免 Key，便于探活）
 *   GET /api/open/production  产品产量明细
 *   GET /api/open/equipment   设备数据（不传 name → 全部设备汇总；传 name → 单台明细）
 *   GET /api/open/workshops   车间数据（各车间分时段）
 */
const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const monitor = require('./monitor');
const { EQUIPMENT_LIST } = require('../config/workshopMasterData');

const router = express.Router();

const ok = (res, data) => res.json({ code: 0, msg: 'success', data });
const bad = (res, status, msg) => res.status(status).json({ code: status, msg });

/** 校验 X-Api-Key；返回 null=未配置、true/false=校验结果 */
function checkKey(req) {
  const expected = String((config.openApi && config.openApi.key) || '');
  if (!expected) return null;
  const got = String(req.headers['x-api-key'] || '');
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** 统一的查询参数解析（dimension / year / startDate / endDate） */
function parseQuery(req, res) {
  const r = monitor.parseParams(req);
  if (!r.valid) {
    bad(res, 400, r.error);
    return null;
  }
  return r;
}

// ====== 探活（免 Key，供调用方做可用性检查）======

router.get('/health', async (req, res) => {
  try {
    const eng = monitor.getEngine();
    const count = eng.db ? eng.db.getRecordCount() : 0;
    return ok(res, {
      service: 'factory-monitor',
      status: 'ok',
      serverTime: new Date().toISOString(),
      sfcRecordCount: count,
      mesRecordCount: eng.getMesRecordCount(),
      mesLastPushAt: eng.getMesLastPushAt(),
    });
  } catch (err) {
    return bad(res, 500, `健康检查失败: ${err.message}`);
  }
});

// ====== 以下全部需要 X-Api-Key ======

router.use((req, res, next) => {
  const v = checkKey(req);
  if (v === null) return bad(res, 500, '服务端未配置 OPEN_API_KEY');
  if (!v) return bad(res, 401, 'X-Api-Key 无效');
  next();
});

/**
 * GET /api/open/production
 * 产品产量明细（一行 = 某产品某生产日期，可能含多个订单/设备/人员）
 *
 * Query:
 *   startDate / endDate  YYYY-MM-DD（不传则该维度全量）
 *   view                 shift(默认，白/晚班各一行) | day(白晚班按产品×日期合并)
 *   dimension            day(默认) | week | month | year
 *   product              可选，产品名包含此字串才返回
 *   workshop             可选，车间名包含此字串才返回
 */
router.get('/production', async (req, res) => {
  const p = parseQuery(req, res);
  if (!p) return;
  const view = ['shift', 'day'].includes(String(req.query.view)) ? String(req.query.view) : 'shift';
  const productFilter = String(req.query.product || '').trim();
  const workshopFilter = String(req.query.workshop || '').trim();

  try {
    const range = monitor.resolveBoardRange(p.dimension, p.year, p.startDate, p.endDate);
    const data = await monitor.getBoardService().getBoard({
      startDate: range.startDate,
      endDate: range.endDate,
      view,
      dimension: p.dimension,
    });
    let rows = Array.isArray(data.rows) ? data.rows : [];
    if (productFilter) rows = rows.filter((r) => String(r.product || '').includes(productFilter));
    if (workshopFilter) rows = rows.filter((r) => String(r.workshop || '').includes(workshopFilter));

    return ok(res, {
      startDate: range.startDate,
      endDate: range.endDate,
      view,
      dimension: p.dimension,
      total: rows.length,
      rows,
      filterOptions: data.filterOptions || null,
    });
  } catch (err) {
    console.error('[open] /production 失败:', err.message);
    return bad(res, 502, `数据获取失败: ${err.message}`);
  }
});

/**
 * GET /api/open/equipment
 * 设备数据
 *   不传 name → 返回全部设备汇总（一行一台：产量/负载率/产出率/OEE）
 *   传 name   → 返回该设备明细（含各趋势与当前生产的产品）
 *
 * Query:
 *   name                 可选，设备名（须与 /equipment-list 返回的 name 一致）
 *   type                 可选，汇总时按类型过滤：粉体 | 液体
 *   startDate / endDate / dimension 同 /production
 */
router.get('/equipment', async (req, res) => {
  const p = parseQuery(req, res);
  if (!p) return;
  const name = String(req.query.name || '').trim();
  const type = String(req.query.type || '').trim();

  try {
    const eng = monitor.getEngine();

    // 单台明细：与页面 /equipment/:name 完全一致
    if (name) {
      const data = await eng.getEquipmentDetail(name, p.dimension, p.year, p.startDate, p.endDate);
      return ok(res, data);
    }

    // 全部设备汇总：逐台取汇总标量（聚合结果走引擎缓存，不会重复计算）
    const list = type ? EQUIPMENT_LIST.filter((e) => e.type === type) : EQUIPMENT_LIST;
    const items = [];
    for (const e of list) {
      try {
        const d = await eng.getEquipmentDetail(e.name, p.dimension, p.year, p.startDate, p.endDate);
        items.push({
          name: d.name || e.name,
          type: d.type || e.type || '',
          workshop: d.defaultWorkshop || e.defaultWorkshop || '',
          actualOutput: d.actualOutput || 0,
          loadRate: d.loadRate || 0,
          outputRate: d.outputRate || 0,
          oee: d.oee || 0,
          currentProducts: d.currentProducts || [],
        });
      } catch (err) {
        console.warn(`[open] 设备 ${e.name} 汇总失败: ${err.message}`);
      }
    }
    return ok(res, {
      dimension: p.dimension,
      startDate: p.startDate || null,
      endDate: p.endDate || null,
      total: items.length,
      equipment: items,
    });
  } catch (err) {
    console.error('[open] /equipment 失败:', err.message);
    return bad(res, 502, `数据获取失败: ${err.message}`);
  }
});

/**
 * GET /api/open/workshops
 * 车间数据：各车间的分时段产量 / 负载率 / 产出率 / 实际工时
 *
 * Query: startDate / endDate / dimension 同上
 */
router.get('/workshops', async (req, res) => {
  const p = parseQuery(req, res);
  if (!p) return;
  try {
    const data = await monitor.getEngine().getWorkshops(p.dimension, p.year, p.startDate, p.endDate);
    return ok(res, data);
  } catch (err) {
    console.error('[open] /workshops 失败:', err.message);
    return bad(res, 502, `数据获取失败: ${err.message}`);
  }
});

module.exports = router;
