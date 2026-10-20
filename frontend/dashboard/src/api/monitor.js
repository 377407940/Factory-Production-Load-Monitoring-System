// 共用实例（含 401 → 跳登录页的拦截器），见 api/http.js
import { http as api } from './http'

export async function fetchOverview(dimension = 'day', year, startDate, endDate) {
  const params = { dimension }
  if (year) params.year = year
  if (startDate) params.startDate = startDate
  if (endDate) params.endDate = endDate
  const { data: resp } = await api.get('/api/monitor/overview', { params })
  return resp.data || resp
}

export async function fetchWorkshops(dimension = 'day', year, startDate, endDate) {
  const params = { dimension }
  if (year) params.year = year
  if (startDate) params.startDate = startDate
  if (endDate) params.endDate = endDate
  const { data: resp } = await api.get('/api/monitor/workshops', { params })
  return resp.data || resp
}

export async function fetchWorkshopDetail(name, dimension = 'day', year, startDate, endDate) {
  const params = { dimension }
  if (year) params.year = year
  if (startDate) params.startDate = startDate
  if (endDate) params.endDate = endDate
  const { data: resp } = await api.get(`/api/monitor/workshop/${encodeURIComponent(name)}`, { params })
  return resp.data || resp
}

export async function fetchEquipmentDetail(name, dimension = 'day', year, startDate, endDate) {
  const params = { dimension }
  if (year) params.year = year
  if (startDate) params.startDate = startDate
  if (endDate) params.endDate = endDate
  const { data: resp } = await api.get(`/api/monitor/equipment/${encodeURIComponent(name)}`, { params })
  return resp.data || resp
}

export async function fetchEquipmentTypes() {
  const { data: resp } = await api.get('/api/monitor/equipment-types')
  return resp.data || resp
}

export async function triggerSync() {
  const { data: resp } = await api.post('/api/monitor/sync')
  return resp.data || resp
}

/** 各数据源状态（含 MES 上次推送时间，用于提示 MES 是内网推送、手动同步不更新它） */
export async function fetchHealth() {
  const { data: resp } = await api.get('/api/monitor/health')
  return resp.data || resp
}

/** 呆滞成品：金蝶即时库存（成品仓），days = 30 | 60 | 90 */
export async function fetchStagnant(days = 30) {
  const { data: resp } = await api.get('/api/monitor/stagnant', { params: { days } })
  return resp.data || resp
}

export async function triggerStagnantSync() {
  const { data: resp } = await api.post('/api/monitor/stagnant/sync')
  return resp.data || resp
}

/** 呆滞成品：把当前视图（阈值 + 客户筛选）截整页图推到钉钉群。截图慢，超时放宽到 2 分钟 */
export async function pushStagnantToDingTalk(days = 30, customers = []) {
  const params = { days }
  if (customers.length) params.cust = customers.join(',')
  const { data: resp } = await api.post('/api/monitor/stagnant/push', null, { params, timeout: 120000 })
  return resp.data || resp
}

export async function fetchProductionBoard(dimension = 'day', year, startDate, endDate, view) {
  const params = { dimension }
  if (year) params.year = year
  if (startDate) params.startDate = startDate
  if (endDate) params.endDate = endDate
  if (view) params.view = view
  const { data: resp } = await api.get('/api/monitor/production-board', { params })
  return resp.data || resp
}

// ====== 人员模块 ======

/** 人员列表（含汇总）。不传 startDate/endDate 时由服务端按 dimension+year 推区间 */
export async function fetchStaff(dimension = 'month', year, startDate, endDate) {
  const params = { dimension }
  if (year) params.year = year
  if (startDate && endDate) { params.startDate = startDate; params.endDate = endDate }
  const { data: resp } = await api.get('/api/monitor/staff', { params })
  return resp.data || resp
}

/** 某人明细：总额 + 客户 / 设备 / 剂型 三个维度 */
export async function fetchStaffDetail(name, dimension = 'month', year, startDate, endDate) {
  const params = { dimension }
  if (year) params.year = year
  if (startDate && endDate) { params.startDate = startDate; params.endDate = endDate }
  const { data: resp } = await api.get(`/api/monitor/staff/${encodeURIComponent(name)}`, { params })
  return resp.data || resp
}

/** 岗位 / 技能等级的可选项 */
export async function fetchStaffOptions() {
  const { data: resp } = await api.get('/api/monitor/staff/options')
  return resp.data || resp
}

/** 保存某人的岗位 / 技能等级（空字符串 = 清空该项） */
export async function saveStaffMeta(name, { position, skillLevel }) {
  const { data: resp } = await api.put(`/api/monitor/staff/${encodeURIComponent(name)}/meta`, {
    position: position || '',
    skillLevel: skillLevel || '',
  })
  return resp.data || resp
}

/** 人员名单（钉钉通讯录：内包 / 外包两个子树） */
export async function fetchStaffRoster() {
  const { data: resp } = await api.get('/api/monitor/staff/roster')
  return resp.data || resp
}

/** 名单页只改技能等级（不会动岗位） */
export async function saveStaffSkillLevel(name, skillLevel) {
  const { data: resp } = await api.put(`/api/monitor/staff/${encodeURIComponent(name)}/skill-level`, {
    skillLevel: skillLevel || '',
  })
  return resp.data || resp
}

/** 手动同步钉钉通讯录 */
export async function syncStaffDirectory() {
  const { data: resp } = await api.post('/api/monitor/staff/directory/sync')
  return resp.data || resp
}

export async function saveProductionNote(note) {
  const { data: resp } = await api.put('/api/monitor/production-note', note)
  return resp.data || resp
}

export async function deleteProductionNote(note) {
  const { data: resp } = await api.delete('/api/monitor/production-note', { data: note })
  return resp.data || resp
}

export async function fetchMoLoss(moNumber) {
  const { data: resp } = await api.get('/api/monitor/mo-loss', { params: { moNumber } })
  return resp.data || resp
}

export async function fetchFillBox(startDate, endDate, dimension = 'day') {
  const params = { startDate, endDate, dimension }
  const { data: resp } = await api.get('/api/monitor/fill-box', { params })
  return resp.data || resp
}

export async function triggerFillBoxSync() {
  const { data: resp } = await api.post('/api/monitor/fill-box/sync')
  return resp.data || resp
}
