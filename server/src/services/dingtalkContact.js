/**
 * 钉钉通讯录同步（人员名单用）
 *
 * 只同步「生产部（内包）」「生产部（外包）」两个子树，不拉财务/质量/营销等部门，
 * 也不存手机号 —— 名单页只要 名字 / 岗位 / 入职时间 三项来自钉钉。
 *
 * ⚠️ 这里用的是**企业 access_token**（appKey + appSecret），
 *    和登录用的**用户 access_token**（authCode 换的）不是同一种凭证。
 * ⚠️ topapi 失败时也可能返回 HTTP 200，必须显式判 `errcode`。
 * ⚠️ user/list 只返回**当前部门**成员，不含子部门 —— 所以要先把子树遍历出来。
 */
const axios = require('axios');
const config = require('../config');

const DEFAULT_API_BASE = 'https://api.dingtalk.com';
const DEFAULT_OAPI_BASE = 'https://oapi.dingtalk.com';
const TIMEOUT = 20000;
/** 提前 5 分钟刷新，避免卡在过期边界上 */
const TOKEN_REFRESH_AHEAD_MS = 5 * 60 * 1000;

let cachedToken = { value: '', expiresAt: 0 };

function apiBase() {
  return String(process.env.DINGTALK_API_V1_BASE || config.dingtalk.apiBaseV1 || DEFAULT_API_BASE).replace(/\/+$/, '');
}
function oapiBase() {
  return String(process.env.DINGTALK_OAPI_BASE || DEFAULT_OAPI_BASE).replace(/\/+$/, '');
}

function isConfigured() {
  return !!(config.dingtalk.appKey && config.dingtalk.appSecret);
}

/** 企业 access_token（缓存 2 小时；失效时 callOapi 会清缓存重试一次） */
async function getAppAccessToken({ force = false } = {}) {
  if (!isConfigured()) throw new Error('尚未配置钉钉 AppKey / AppSecret');
  if (!force && cachedToken.value && Date.now() < cachedToken.expiresAt - TOKEN_REFRESH_AHEAD_MS) {
    return cachedToken.value;
  }

  let res;
  try {
    res = await axios({
      url: `${apiBase()}/v1.0/oauth2/accessToken`,
      method: 'POST',
      data: { appKey: config.dingtalk.appKey, appSecret: config.dingtalk.appSecret },
      headers: { 'Content-Type': 'application/json' },
      timeout: TIMEOUT,
      validateStatus: null,
    });
  } catch (e) {
    throw new Error(`连不上钉钉 accessToken 接口（${apiBase()}）：${e.message}`);
  }

  if (res.status < 200 || res.status >= 300 || !res.data || !res.data.accessToken) {
    const msg = [res.data && res.data.code, res.data && res.data.message].filter(Boolean).join(' | ') || `HTTP ${res.status}`;
    throw new Error(`获取钉钉企业 accessToken 失败：${msg}`);
  }

  const expireIn = Number(res.data.expireIn) > 0 ? Number(res.data.expireIn) : 7200;
  cachedToken = { value: res.data.accessToken, expiresAt: Date.now() + expireIn * 1000 };
  return cachedToken.value;
}

/**
 * 调 oapi.dingtalk.com 的 topapi 接口。
 * 注意：HTTP 200 也可能是业务错误，必须看 errcode。
 */
async function callOapi(path, body, { retryToken = true } = {}) {
  const token = await getAppAccessToken();
  let res;
  try {
    res = await axios({
      url: `${oapiBase()}${path}?access_token=${encodeURIComponent(token)}`,
      method: 'POST',
      data: body,
      headers: { 'Content-Type': 'application/json' },
      timeout: TIMEOUT,
      validateStatus: null,
    });
  } catch (e) {
    throw new Error(`连不上钉钉通讯录接口（${path}）：${e.message}`);
  }

  const json = res.data;
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`钉钉通讯录接口 HTTP ${res.status}（${path}）`);
  }
  if (!json || typeof json !== 'object') {
    throw new Error(`钉钉通讯录接口返回的不是 JSON（${path}）`);
  }
  if (json.errcode && json.errcode !== 0) {
    // 40014 / 42001 / 88：token 无效或过期 —— 清缓存重试一次
    if (retryToken && [40014, 42001, 88].includes(Number(json.errcode))) {
      cachedToken = { value: '', expiresAt: 0 };
      return callOapi(path, body, { retryToken: false });
    }
    throw new Error(`钉钉通讯录接口报错（${path}）：${json.errcode} ${json.errmsg || ''}`);
  }
  return json;
}

/** 部门详情（拿根部门名称；失败时用配置里的兜底名） */
async function getDepartment(deptId) {
  try {
    const json = await callOapi('/topapi/v2/department/get', { dept_id: Number(deptId) });
    return json.result || null;
  } catch (e) {
    console.warn(`[dingtalk] 获取部门 ${deptId} 详情失败，使用兜底名称: ${e.message}`);
    return null;
  }
}

/** 直接子部门 */
async function listSubDepartments(deptId) {
  const json = await callOapi('/topapi/v2/department/listsub', { dept_id: Number(deptId) });
  return Array.isArray(json.result) ? json.result : [];
}

/** 某部门的全部成员（分页） */
async function listDepartmentUsers(deptId) {
  const all = [];
  let cursor = 0;
  for (let page = 0; page < 50; page++) {
    const json = await callOapi('/topapi/v2/user/list', {
      dept_id: Number(deptId),
      cursor,
      size: 100,
    });
    const result = json.result || {};
    const list = Array.isArray(result.list) ? result.list : [];
    all.push(...list);
    const next = Number(result.next_cursor);
    if (!result.has_more || !Number.isFinite(next) || next === cursor) break;
    cursor = next;
  }
  return all;
}

/** 从根部门递归出整棵子树（含根） */
async function collectSubtree(rootId, rootFallbackName) {
  const rootDetail = await getDepartment(rootId);
  const rootName = (rootDetail && rootDetail.name) || rootFallbackName || '';
  const result = [{ id: String(rootId), name: rootName, depth: 0, parentId: '' }];
  const seen = new Set([String(rootId)]);
  const queue = [{ id: String(rootId), depth: 0 }];

  while (queue.length) {
    const cur = queue.shift();
    const children = await listSubDepartments(cur.id);
    for (const child of children) {
      if (!child || child.dept_id == null) continue;
      const id = String(child.dept_id);
      if (seen.has(id)) continue;
      seen.add(id);
      result.push({ id, name: child.name || '', depth: cur.depth + 1, parentId: cur.id });
      queue.push({ id, depth: cur.depth + 1 });
    }
  }
  return result;
}

/**
 * 拉取人员名单。
 * @returns {Promise<{rows: Array, departmentCount: number}>}
 *   rows: [{ userid, name, title, deptNames, scope, hiredDate(ms|null) }]
 */
async function fetchRoster({ innerDeptId, outerDeptId } = {}) {
  const innerRoot = String(innerDeptId || config.staff.directory.innerDeptId);
  const outerRoot = String(outerDeptId || config.staff.directory.outerDeptId);

  const innerDepts = await collectSubtree(innerRoot, '生产部（内包）');
  const outerDepts = await collectSubtree(outerRoot, '生产部（外包）');

  const innerIds = new Set(innerDepts.map((d) => d.id));
  const outerIds = new Set(outerDepts.map((d) => d.id));
  const deptById = new Map([...innerDepts, ...outerDepts].map((d) => [d.id, d]));

  /** userid -> { raw, deptIds:Set } */
  const users = new Map();

  async function pull(depts) {
    for (const d of depts) {
      const list = await listDepartmentUsers(d.id);
      for (const u of list) {
        if (!u || u.userid == null || !String(u.name || '').trim()) continue;
        const id = String(u.userid);
        if (!users.has(id)) users.set(id, { ...u, _deptIds: new Set() });
        const rec = users.get(id);
        rec._deptIds.add(d.id);
        // dept_id_list 里可能还有子树外的部门，这里一并记下，后面按子树过滤
        for (const did of u.dept_id_list || []) rec._deptIds.add(String(did));
      }
    }
  }

  await pull(innerDepts);
  await pull(outerDepts);

  const rows = [];
  for (const u of users.values()) {
    const inInner = [...u._deptIds].some((id) => innerIds.has(id));
    const inOuter = [...u._deptIds].some((id) => outerIds.has(id));
    if (!inInner && !inOuter) continue;

    const scope = inInner && inOuter ? 'both' : inInner ? 'inner' : 'outer';
    const relevantDepts = [...u._deptIds]
      .filter((id) => (inInner && innerIds.has(id)) || (inOuter && outerIds.has(id)))
      .map((id) => deptById.get(id))
      .filter(Boolean)
      .sort((a, b) => b.depth - a.depth); // 最具体的部门优先
    const deptNames = [...new Set(relevantDepts.map((d) => d.name).filter(Boolean))];

    const hired = Number(u.hired_date);
    rows.push({
      userid: String(u.userid),
      name: String(u.name || '').trim(),
      title: String(u.title || '').trim(),
      deptNames,
      scope,
      hiredDate: Number.isFinite(hired) && hired > 0 ? hired : null,
    });
  }

  // 0 人通常意味着权限被收回或部门配错 —— 必须报错，让调用方保留上一次名单
  if (rows.length === 0) {
    throw new Error('钉钉返回 0 人，已保留上次名单（请检查通讯录权限和部门 ID）');
  }

  const scopeOrder = { inner: 0, outer: 1, both: 2 };
  const titleKey = (t) => String(t || '￿'); // 岗位为空的排最后
  rows.sort((a, b) =>
    (scopeOrder[a.scope] ?? 9) - (scopeOrder[b.scope] ?? 9) ||
    titleKey(a.title).localeCompare(titleKey(b.title), 'zh') ||
    String(a.name || '').localeCompare(String(b.name || ''), 'zh'));

  return { rows, departmentCount: innerDepts.length + outerDepts.length };
}

module.exports = {
  isConfigured,
  getAppAccessToken,
  fetchRoster,
};
