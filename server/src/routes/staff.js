/**
 * 人员模块路由 —— 挂在 `/api/monitor/staff`
 *
 * 挂载点在 index.js 里排在 `app.use('/api/monitor', …, monitorRouter)` **之前**，
 * 并且同样经过 attachSession + requireAuthApi，所以**自动继承钉钉登录保护**，不用另配。
 *
 * 时间维度/区间参数复用 monitor.js 的 parseParams + resolveBoardRange（口径和看板完全一致）。
 */
const express = require('express');
const config = require('../config');
const monitorRouter = require('./monitor');
const StaffService = require('../services/staffService');
const StaffBoardService = require('../services/staffBoardService');
const dingtalkContact = require('../services/dingtalkContact');

const router = express.Router();

function ok(res, data) { res.json({ code: 0, msg: 'success', data }); }
function fail(res, code, msg) { res.status(code).json({ code, msg }); }

/** @type {StaffService} */
let staffService = null;
/** @type {StaffBoardService} */
let staffBoardService = null;

function getStaffService() {
  if (!staffService) {
    // 复用引擎的金蝶客户端（拉剂型字典用）
    staffService = new StaffService({ client: monitorRouter.getEngine().client });
    staffService.initialize();
  }
  return staffService;
}
function getStaffBoardService() {
  if (!staffBoardService) {
    staffBoardService = new StaffBoardService({
      boardService: monitorRouter.getBoardService(),
      staffService: getStaffService(),
    });
  }
  return staffBoardService;
}

/** 解析时间参数（与生产看板同一套） */
function resolveRange(req) {
  const p = monitorRouter.parseParams(req);
  if (!p.valid) return { error: p.error };
  const range = monitorRouter.resolveBoardRange(p.dimension, p.year, p.startDate, p.endDate);
  return { dimension: p.dimension, year: p.year, ...range };
}

// ====== 钉钉人员名单同步 ======

/** 正在进行的同步（防并发：页面首次加载和手动同步可能同时触发） */
let directorySyncing = null;
let lastManualSyncAt = 0;
const MANUAL_SYNC_COOLDOWN_MS = 60 * 1000;

/**
 * 拉钉钉通讯录（内包 / 外包两个子树）→ 全量替换 staff_directory。
 * 失败时不写库，保留上一次名单。
 */
function syncDirectory() {
  if (directorySyncing) return directorySyncing;
  if (!config.staff.directory.enabled) {
    return Promise.reject(new Error('钉钉名单同步已关闭（DINGTALK_STAFF_SYNC_ENABLED=false）'));
  }
  directorySyncing = dingtalkContact.fetchRoster({
    innerDeptId: config.staff.directory.innerDeptId,
    outerDeptId: config.staff.directory.outerDeptId,
  }).then(({ rows, departmentCount }) => {
    getStaffService().replaceDirectory(rows);
    monitorRouter.clearCache();
    const lastSyncAt = getStaffService().getDirectoryLastSyncAt();
    console.log(`[staff] 钉钉名单同步完成：${departmentCount} 个部门 / ${rows.length} 人`);
    return { count: rows.length, departmentCount, lastSyncAt };
  }).finally(() => {
    directorySyncing = null;
  });
  return directorySyncing;
}

/** 名单为空时先同步一次（首次部署 / 新库） */
async function ensureDirectory() {
  if (getStaffService().countDirectory() > 0) return;
  await syncDirectory();
}

/**
 * GET /api/monitor/staff/options —— 岗位 / 技能等级的可选项
 * ⚠️ 必须排在 `/:name` 之前，否则会被当成一个人名
 */
router.get('/options', (req, res) => {
  ok(res, { positions: config.staff.positions, skillLevels: config.staff.skillLevels });
});

/**
 * GET /api/monitor/staff/roster —— 钉钉人员名单
 *
 * 数据来自 staff_directory（内包 / 外包两个子树），技能等级复用 staff.skill_level。
 * ⚠️ 必须排在 `/:name` 之前，否则会被当成一个人名。
 */
router.get('/roster', async (req, res) => {
  try {
    await ensureDirectory();
    return ok(res, getStaffService().getRoster());
  } catch (err) {
    console.error('[staff] /roster 失败:', err.message);
    return fail(res, 502, `人员名单获取失败: ${err.message}`);
  }
});

/**
 * POST /api/monitor/staff/directory/sync —— 手动同步钉钉名单
 * 60 秒冷却，防止连点把钉钉接口打爆。
 */
router.post('/directory/sync', async (req, res) => {
  const now = Date.now();
  if (now - lastManualSyncAt < MANUAL_SYNC_COOLDOWN_MS) {
    return fail(res, 429, '同步太频繁，请 1 分钟后再试');
  }
  lastManualSyncAt = now;
  try {
    const r = await syncDirectory();
    const who = (req.auth && req.auth.nick) || '未知';
    console.log(`[staff] 手动同步钉钉名单：${who}（${r.count} 人）`);
    return ok(res, r);
  } catch (err) {
    console.error('[staff] 手动同步钉钉名单失败:', err.message);
    return fail(res, 502, `同步失败: ${err.message}`);
  }
});

/**
 * GET /api/monitor/staff?dimension=&year=&startDate=&endDate=
 * 人员列表 + 汇总。summary 里同时给了 totalActualQty（实际总产量）
 * 和 personalQtySum（人员产量之和）—— 后者会更大，差值是「多人同行被重复计」的部分。
 */
router.get('/', async (req, res) => {
  const r = resolveRange(req);
  if (r.error) return fail(res, 400, r.error);
  const cacheKey = `staff_board_${r.dimension}_${r.year || ''}_${r.startDate}_${r.endDate}`;
  const cached = monitorRouter.getCached(cacheKey);
  if (cached) return ok(res, cached);
  try {
    // 首次部署时字典是空的 —— 同步拉一次，否则剂型维度全是「未知」
    await getStaffService().ensureMaterialGroups();
    const data = await getStaffBoardService().getStaffBoard({ startDate: r.startDate, endDate: r.endDate, dimension: r.dimension });
    const payload = { ...data, year: r.year };
    monitorRouter.setCache(cacheKey, payload);
    return ok(res, payload);
  } catch (err) {
    console.error('[staff] /staff 失败:', err.message);
    return fail(res, 502, `人员数据获取失败: ${err.message}`);
  }
});

/**
 * GET /api/monitor/staff/:name?dimension=&...
 * 某人明细：总额 + 客户 / 设备 / 剂型 三个维度
 */
router.get('/:name', async (req, res) => {
  const r = resolveRange(req);
  if (r.error) return fail(res, 400, r.error);
  try {
    await getStaffService().ensureMaterialGroups();
    const data = await getStaffBoardService().getStaffDetail(req.params.name, {
      startDate: r.startDate, endDate: r.endDate, dimension: r.dimension,
    });
    return ok(res, { ...data, year: r.year });
  } catch (err) {
    console.error('[staff] /staff/:name 失败:', err.message);
    return fail(res, 502, `人员明细获取失败: ${err.message}`);
  }
});

/**
 * PUT /api/monitor/staff/:name/meta —— 保存岗位 / 技能等级
 * body: { position?, skillLevel? }  空字符串表示清空该项
 * 只接受配置里的固定选项（或空），避免前端传进来乱七八糟的值。
 */
router.put('/:name/meta', (req, res) => {
  try {
    const body = req.body || {};
    const position = String(body.position == null ? '' : body.position).trim();
    const skillLevel = String(body.skillLevel == null ? '' : body.skillLevel).trim();
    if (position && !config.staff.positions.includes(position)) {
      return fail(res, 400, `岗位必须是：${config.staff.positions.join(' / ')}（或留空）`);
    }
    if (skillLevel && !config.staff.skillLevels.includes(skillLevel)) {
      return fail(res, 400, `技能等级必须是：${config.staff.skillLevels.join(' / ')}（或留空）`);
    }
    const saved = getStaffService().upsertStaff(req.params.name, { position, skillLevel });
    monitorRouter.clearCache(); // 列表里有岗位列，改完让缓存失效
    return ok(res, saved);
  } catch (err) {
    console.error('[staff] 保存档案失败:', err.message);
    return fail(res, 400, `保存失败: ${err.message}`);
  }
});

/**
 * PUT /api/monitor/staff/:name/skill-level —— 名单页只改技能等级
 *
 * 与 /:name/meta 的区别：**绝不碰 position**。
 * 名单页改技能等级时如果复用 meta，会把产量页手工维护的岗位清空。
 */
router.put('/:name/skill-level', (req, res) => {
  try {
    const body = req.body || {};
    const skillLevel = String(body.skillLevel == null ? '' : body.skillLevel).trim();
    if (skillLevel && !config.staff.skillLevels.includes(skillLevel)) {
      return fail(res, 400, `技能等级必须是：${config.staff.skillLevels.join(' / ')}（或留空）`);
    }
    const saved = getStaffService().upsertSkillLevel(req.params.name, skillLevel);
    monitorRouter.clearCache();
    return ok(res, saved);
  } catch (err) {
    console.error('[staff] 保存技能等级失败:', err.message);
    return fail(res, 400, `保存失败: ${err.message}`);
  }
});

module.exports = router;
/** 供 index.js 的定时任务刷新剂型字典 */
module.exports.refreshMaterialGroups = () => getStaffService().refreshMaterialGroups();
/** 供 index.js 的定时任务同步钉钉人员名单 */
module.exports.syncDirectory = syncDirectory;
