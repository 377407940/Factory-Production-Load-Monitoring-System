<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { fetchProductionBoard, fetchMoLoss, triggerSync, fetchHealth } from '../api/monitor.js'
import PeriodSelector from '../components/widgets/PeriodSelector.vue'
import ProductionBoardTable from '../components/widgets/ProductionBoardTable.vue'
import TrendLine from '../components/charts/TrendLine.vue'
import { getAvailableYears } from '../utils/years'

const router = useRouter()
const route = useRoute()

const dimensions = [
  { label: '日', value: 'day' },
  { label: '周', value: 'week' },
  { label: '月', value: 'month' },
  { label: '年', value: 'year' },
]

const currentDimension = ref(route.query.dimension || 'day')
const currentYear = ref(parseInt(route.query.year) || new Date().getFullYear())
const availableYears = getAvailableYears()
const currentPeriod = ref(
  (route.query.startDate && route.query.endDate)
    ? { startDate: route.query.startDate, endDate: route.query.endDate }
    : null,
)
// 视图：班次维度 | 日维度（URL ?view= 持久化）
const currentView = ref(route.query.view === 'day' ? 'day' : 'shift')
const periodSelectorRef = ref(null)

const loading = ref(true)
const boardData = ref(null)

// 客户端即时筛选：下拉为级联（车间/设备/人员/客户/产品互相收窄），生产订单编号为输入框模糊匹配
const filterWorkshop = ref('')
const filterMachine = ref('')
const filterOperator = ref('')
const filterCustomer = ref('')
const filterProduct = ref('')
const filterMo = ref('')

// 自动刷新间隔（1 小时，与总览一致）
const AUTO_REFRESH_MS = 60 * 60 * 1000
let refreshTimer = null

// ====== 级联筛选：下拉选项 = 满足其余 4 个下拉已选值的行中实际存在的不重复值 ======
// 车间/设备/人员/客户/产品互相收窄；生产订单编号为输入框模糊匹配，不参与下拉收窄
// 日维度下 设备/人员/车间/订单号 等多值列是 \n 拼接 → 用「包含」匹配，选项按行拆分取值
function containsValue(v, kw) {
  if (!kw) return true
  return (v || '').includes(kw)
}
function scopedRows(excludeField) {
  const rows = boardData.value?.rows || []
  return rows.filter((r) => {
    if (excludeField !== 'workshop' && !containsValue(r.workshop, filterWorkshop.value)) return false
    if (excludeField !== 'machine' && !containsValue(r.machine, filterMachine.value)) return false
    if (excludeField !== 'operator' && !containsValue(r.operator, filterOperator.value)) return false
    if (excludeField !== 'customer' && !containsValue(r.customer, filterCustomer.value)) return false
    if (excludeField !== 'product' && !containsValue(r.product, filterProduct.value)) return false
    return true
  })
}
function distinctValues(field, rows) {
  const set = new Set()
  for (const r of rows) {
    const v = r[field]
    if (v == null) continue
    for (const p of String(v).split('\n')) {
      const t = p.trim()
      if (t && t !== '——') set.add(t)
    }
  }
  return [...set].sort()
}
const workshopOptions = computed(() => distinctValues('workshop', scopedRows('workshop')))
const machineOptions = computed(() => distinctValues('machine', scopedRows('machine')))
const operatorOptions = computed(() => distinctValues('operator', scopedRows('operator')))
const customerOptions = computed(() => distinctValues('customer', scopedRows('customer')))
const productOptions = computed(() => distinctValues('product', scopedRows('product')))

// 联动清理：某下拉已选值不在新收窄选项内 → 自动清空（刚改动的下拉除外，避免误清）
function getFilter(f) {
  if (f === 'workshop') return filterWorkshop.value
  if (f === 'machine') return filterMachine.value
  if (f === 'operator') return filterOperator.value
  if (f === 'customer') return filterCustomer.value
  return filterProduct.value
}
function getOptions(f) {
  if (f === 'workshop') return workshopOptions.value
  if (f === 'machine') return machineOptions.value
  if (f === 'operator') return operatorOptions.value
  if (f === 'customer') return customerOptions.value
  return productOptions.value
}
function setFilter(f, v) {
  if (f === 'workshop') filterWorkshop.value = v
  else if (f === 'machine') filterMachine.value = v
  else if (f === 'operator') filterOperator.value = v
  else if (f === 'customer') filterCustomer.value = v
  else filterProduct.value = v
}
function clearInvalid(fields) {
  for (const f of fields) {
    const v = getFilter(f)
    if (v && !getOptions(f).includes(v)) setFilter(f, '')
  }
}
watch(filterWorkshop, () => clearInvalid(['machine', 'operator', 'customer', 'product']))
watch(filterMachine, () => clearInvalid(['workshop', 'operator', 'customer', 'product']))
watch(filterOperator, () => clearInvalid(['workshop', 'machine', 'customer', 'product']))
watch(filterCustomer, () => clearInvalid(['workshop', 'machine', 'operator', 'product']))
watch(filterProduct, () => clearInvalid(['workshop', 'machine', 'operator', 'customer']))

// 行筛选：车间/设备/人员/客户/产品 用「包含」匹配（日维度多值列 \n 拼接；单值列效果等同精确匹配），订单号模糊匹配
function rowMatchesFilters(r) {
  const moKw = filterMo.value.trim().toLowerCase()
  if (!containsValue(r.workshop, filterWorkshop.value)) return false
  if (!containsValue(r.machine, filterMachine.value)) return false
  if (!containsValue(r.operator, filterOperator.value)) return false
  if (!containsValue(r.customer, filterCustomer.value)) return false
  if (!containsValue(r.product, filterProduct.value)) return false
  if (moKw && !(r.moNumber || '').toLowerCase().includes(moKw)) return false
  return true
}

const filteredRows = computed(() => {
  const rows = boardData.value?.rows || []
  return rows.filter(rowMatchesFilters)
})

// ====== 合并：同产品+同日期+同班次，且 同机台+同操作人员，才合并为一行 ======
// 不同机台/不同操作人员的行保持分开（只合并真正的重复报工）
// 产量/工时求和；订单号/设备/人员不同用 、连接；累计取组内最大（同 MO 同日期的运行累计）；达产率重算
function joinUnique(a, b) {
  if (!b) return a || ''
  if (!a) return b
  return [...new Set([a, b])].sort().join('、')
}
// 原因/方案：保留原顺序去重连接
function joinText(a, b) {
  if (!b) return a || ''
  if (!a) return b
  return [...new Set([a, b])].join('、')
}
const mergedRows = computed(() => {
  // 日维度：后端已按（产品×时段）聚合白班+晚班（多值\n拼接、达产率/累计/OEE加权），直接透传
  if (currentView.value === 'day') return filteredRows.value
  const rows = filteredRows.value
  const keyFields = ['fdate', 'shift', 'product', 'machine', 'operator']
  const byKey = new Map()
  for (const r of rows) {
    const key = keyFields.map((f) => r[f] || '').join('|')
    const g = byKey.get(key)
    if (!g) {
      byKey.set(key, {
        ...r,
        _keys: [[r.fdate, r.moNumber, r.shift || '', r.machine || '', r.operator || '']],
        _moSet: new Set([r.moNumber]),
        _cumMax: r.cumQty || 0,
        _cumTMax: r.cumTarget || 0,
        _projMax: r.projectRate != null ? r.projectRate : null,
        _oeeW: (r.oee || 0) * (r.actualQty || 0),
        _oeeD: r.actualQty || 0,
        _oesW: (r.oes || 0) * (r.actualQty || 0),
        _qualW: (r.qualifyRate || 0) * (r.actualQty || 0),
      })
    } else {
      g.targetQty += r.targetQty || 0
      g.actualQty += r.actualQty || 0
      g.defectQty += r.defectQty || 0
      g.regularHours += r.regularHours || 0
      g.tempHours += r.tempHours || 0
      g._keys.push([r.fdate, r.moNumber, r.shift || '', r.machine || '', r.operator || ''])
      g._moSet.add(r.moNumber)
      g._cumMax = Math.max(g._cumMax, r.cumQty || 0)
      g._cumTMax = Math.max(g._cumTMax, r.cumTarget || 0)
      if (r.projectRate != null) g._projMax = g._projMax == null ? r.projectRate : Math.max(g._projMax, r.projectRate)
      g.machine = joinUnique(g.machine, r.machine)
      g.operator = joinUnique(g.operator, r.operator)
      g.moNumber = joinUnique(g.moNumber, r.moNumber)
      g.salesOrderNo = joinUnique(g.salesOrderNo, r.salesOrderNo)
      g.reason = joinText(g.reason, r.reason || '')
      g.recoveryPlan = joinText(g.recoveryPlan, r.recoveryPlan || '')
      g._oeeW += (r.oee || 0) * (r.actualQty || 0)
      g._oeeD += r.actualQty || 0
      g._oesW += (r.oes || 0) * (r.actualQty || 0)
      g._qualW += (r.qualifyRate || 0) * (r.actualQty || 0)
    }
  }
  const merged = [...byKey.values()]
  // 班次达产率：同 (生产订单,日期,班次) 的多台设备，Σ实际 ÷ 班次目标（目标只算一次，不叠加）
  const shiftRate = new Map() // key: mo|fdate|shift -> { actual, targets }
  for (const r of merged) {
    const sk = `${r.moNumber}|${r.fdate}|${r.shift || ''}`
    const sg = shiftRate.get(sk) || { actual: 0, targets: new Set() }
    sg.actual += r.actualQty || 0
    if (r.targetQty > 0) sg.targets.add(r.targetQty)
    shiftRate.set(sk, sg)
  }
  return merged.map((g) => {
    const sg = shiftRate.get(`${g.moNumber}|${g.fdate}|${g.shift || ''}`)
    const tList = sg ? [...sg.targets] : []
    const denom = tList.length === 1 ? tList[0] : tList.reduce((s, t) => s + t, 0)
    g.rate = sg && denom > 0 ? Math.round((sg.actual / denom) * 1000) / 10 : null
    g.cumQty = g._cumMax
    g.cumTarget = g._cumTMax
    g.instantRate = g.cumTarget > 0 ? Math.round((g.cumQty / g.cumTarget) * 1000) / 10 : null
    g.projectRate = g._moSet.size === 1 ? g._projMax : null // 多订单号不显示项目完成率
    // OEE：按实际产量加权平均；无数据(0)显示 —
    g.oee = g._oeeD > 0 && g._oeeW > 0 ? Math.round((g._oeeW / g._oeeD) * 10) / 10 : null
    g.oes = g._oeeD > 0 && g._oesW > 0 ? Math.round((g._oesW / g._oeeD) * 10) / 10 : null
    g.qualifyRate = g._oeeD > 0 && g._qualW > 0 ? Math.round((g._qualW / g._oeeD) * 10) / 10 : null
    g.reason = g.reason || ''
    g.recoveryPlan = g.recoveryPlan || ''
    delete g._moSet; delete g._cumMax; delete g._cumTMax; delete g._projMax
    delete g._oeeW; delete g._oeeD; delete g._oesW; delete g._qualW
    return g
  })
})

const rangeLabel = computed(() => {
  const d = boardData.value
  if (!d) return ''
  return `${d.startDate || '—'} ~ ${d.endDate || '—'}`
})

// 单位小时产量曲线：筛选到具体设备/产品/车间时显示；
// 按 (设备,产品) 分组，每条曲线 = 一台设备（区分产品）的单位小时产量；X = 日期+班次
const showHourlyChart = computed(() => filterMachine.value !== '' || filterProduct.value !== '' || filterWorkshop.value !== '' || filterCustomer.value !== '')
// ====== 趋势图共用数据：group → Map<periodKey, {actual, hours, oesW, oesD}> ======
// 班次维度按设备拆线（periodKey = date|shift）；日维度按产品拆线（periodKey = date）
function buildTrendSeriesMap() {
  const d = boardData.value
  const isDay = currentView.value === 'day'
  // 日维度用 dayRows（日粒度明细，筛选后）；班次维度用 mergedRows（已筛选+合并）
  const source = isDay
    ? ((d && d.dayRows && d.dayRows.length) ? d.dayRows : (d && d.rows) || []).filter(rowMatchesFilters)
    : mergedRows.value
  const seriesMap = new Map()
  for (const r of source) {
    const group = isDay ? (r.product || '未知产品') : (r.machine || '未知设备')
    if (!seriesMap.has(group)) seriesMap.set(group, new Map())
    const m = seriesMap.get(group)
    const key = isDay ? r.fdate : `${r.fdate}|${r.shift || '无班次'}`
    const g = m.get(key) || { actual: 0, hours: 0, oesW: 0, oesD: 0, power: 0, reason: '' }
    g.actual += r.actualQty || 0
    g.hours += (r.regularHours || 0) + (r.tempHours || 0)
    const aq = r.actualQty || 0
    if (aq > 0 && (r.oes || 0) > 0) { g.oesW += (r.oes || 0) * aq; g.oesD += aq }
    g.power += r.powerKwh || 0
    if (r.reason && !g.reason) g.reason = r.reason // 未达产原因（tooltip 展示）
    m.set(key, g)
  }
  return { seriesMap, isDay }
}

// 生成趋势曲线：valueOf(g) 决定 Y 值（单位小时产量 / 实际产量 / OES 加权 / 用电量）
// withReason=true 时数据点携带未达产原因（tooltip 展示，日维度单位小时产量图用）
function buildTrendSeries(valueOf, withReason = false) {
  const { seriesMap, isDay } = buildTrendSeriesMap()
  const d = boardData.value
  const start = d && d.startDate, end = d && d.endDate
  const dayCount = start && end ? Math.round((new Date(end) - new Date(start)) / 86400000) + 1 : 0
  const useFullAxis = start && end && dayCount > 0 && dayCount <= 45
  const orderShift = (s) => (s === '白班' ? 0 : s === '晚班' ? 1 : 2)
  const axis = []
  if (useFullAxis) {
    const s = new Date(start), e = new Date(end)
    for (let dt = new Date(s); dt <= e; dt.setDate(dt.getDate() + 1)) {
      const ds = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
      if (isDay) {
        axis.push({ label: ds.slice(5), key: ds })
      } else {
        axis.push({ label: `${ds.slice(5)} 白班`, key: `${ds}|白班` })
        axis.push({ label: `${ds.slice(5)} 晚班`, key: `${ds}|晚班` })
      }
    }
  }
  const mkPoint = (g, label) => {
    const point = { label, value: valueOf(g) }
    if (withReason && g && g.reason) point.reason = g.reason
    return point
  }
  const COLORS = ['#1890ff', '#52c41a', '#faad14', '#f5222d', '#722ed1', '#13c2c2', '#eb2f96', '#a0d911', '#2f54eb', '#fa8c16']
  return [...seriesMap.entries()].map(([name, m], i) => {
    let data
    if (useFullAxis) {
      data = axis.map((a) => mkPoint(m.get(a.key), a.label))
    } else {
      data = [...m.entries()]
        .sort((a, b) => {
          if (isDay) return a[0] < b[0] ? -1 : 1
          const [ad, as] = a[0].split('|'), [bd, bs] = b[0].split('|')
          if (ad !== bd) return ad < bd ? -1 : 1
          return orderShift(as) - orderShift(bs)
        })
        .map(([key, g]) => mkPoint(g, isDay ? key.slice(5) : (() => { const [date, shift] = key.split('|'); return `${date.slice(5)} ${shift}` })()))
    }
    return { name, color: COLORS[i % COLORS.length], data }
  })
}

// 四条趋势曲线：单位小时产量 / 实际产量 / OES（加权）/ 用电量（仅日维度）
// 日维度数据点携带未达产原因（hover 显示日期+原因）；班次维度不携带
const hourlySeries = computed(() => buildTrendSeries(
  (g) => (g && g.hours > 0 ? Math.round((g.actual / g.hours) * 10) / 10 : null),
  currentView.value === 'day'
))
const actualSeries = computed(() => buildTrendSeries((g) => (g ? Math.round(g.actual) : null), currentView.value === 'day'))
const oesSeries = computed(() => buildTrendSeries((g) => (g && g.oesD > 0 ? Math.round((g.oesW / g.oesD) * 10) / 10 : null), currentView.value === 'day'))
const powerSeries = computed(() => (currentView.value === 'day'
  ? buildTrendSeries((g) => (g && g.power ? Math.round(g.power) : null), true)
  : []))

async function loadData() {
  loading.value = true
  try {
    const { startDate, endDate } = currentPeriod.value || {}
    boardData.value = await fetchProductionBoard(currentDimension.value, currentYear.value, startDate, endDate, currentView.value)
  } catch (e) {
    console.error('[board] 加载失败:', e)
  }
  loading.value = false
  refreshMesStatus()
}

function onDimensionChange(dim) {
  currentDimension.value = dim
  currentPeriod.value = null
  router.replace({ query: { dimension: dim, year: currentYear.value, view: currentView.value } })
}

function onYearChange(year) {
  currentYear.value = year
  currentPeriod.value = null
  router.replace({ query: { dimension: currentDimension.value, year, view: currentView.value } })
}

function onPeriodChange(period) {
  currentPeriod.value = period
  const query = { dimension: currentDimension.value, year: currentYear.value, view: currentView.value }
  if (period) {
    query.startDate = period.startDate
    query.endDate = period.endDate
  }
  router.replace({ query })
}

function onViewChange(v) {
  currentView.value = v
  const query = { dimension: currentDimension.value, year: currentYear.value, view: v }
  if (currentPeriod.value) {
    query.startDate = currentPeriod.value.startDate
    query.endDate = currentPeriod.value.endDate
  }
  router.replace({ query })
  loadData()
}

onMounted(() => {
  loadData()
  refreshTimer = setInterval(loadData, AUTO_REFRESH_MS)
  // 从 URL 恢复期间选择
  if (currentPeriod.value && periodSelectorRef.value) {
    periodSelectorRef.value.setFromUrl(currentPeriod.value.startDate, currentPeriod.value.endDate)
  }
})

onBeforeUnmount(() => {
  clearInterval(refreshTimer)
})

watch(currentDimension, loadData)
watch(currentYear, loadData)
watch(currentPeriod, loadData)

// ====== 损耗率（班次+日维度、条袋订单；完工后才展示；数据存本地 loss_data.db，秒回） ======
const lossMap = ref({}) // moNumber -> 损耗记录 { billNo, fstatus, lossRate, entries[] }
const lossDialog = ref(null) // 当前查看的损耗明细
const FINAL_LOSS_STATUSES = ['完工', '结案', '结算']
// 自动拉取上限：2026 全年已预热本地 loss_data.db（读取本地秒回），上限放宽到覆盖整年；
// 仅冷数据(未预热范围/年份)会触外部损耗接口，仍有上限兜底
const AUTO_FETCH_MAX = 500
let lossTimer = null

// 损耗接口以材料编码 MP 为准（不只看产品名"条袋"）；凡含"袋"的袋装系列都可能查损耗，接口裁决是否真有数据
function isLossPouch(product) {
  return String(product || '').includes('袋')
}

/** 收集当前视图可见行里的 袋装(可能查损耗) 订单号（班次单值；日维度 moNumber 多值 \n 拼接） */
function visibleStickMos() {
  const mos = new Set()
  for (const r of mergedRows.value) {
    if (!isLossPouch(r.product)) continue
    const parts = String(r.moNumber || '').split(/\n|、/).map((s) => s.trim()).filter(Boolean)
    for (const mo of parts) mos.add(mo)
  }
  return [...mos]
}

/** 拉取一批订单损耗（分批并发，结果进 lossMap；已有/已尝试过的不重拉） */
async function refreshLosses() {
  if (loading.value) return
  const mos = visibleStickMos()
  if (!mos.length || mos.length > AUTO_FETCH_MAX) return // 超上限不自动拉
  const toFetch = mos.filter((mo) => !(mo in lossMap.value))
  if (!toFetch.length) return
  const CHUNK = 6
  for (let i = 0; i < toFetch.length; i += CHUNK) {
    const batch = toFetch.slice(i, i + CHUNK)
    const results = await Promise.allSettled(batch.map((mo) => fetchMoLoss(mo)))
    const patch = {}
    results.forEach((res, idx) => {
      const mo = batch[idx]
      patch[mo] = res.status === 'fulfilled' ? res.value : { moNumber: mo, found: false }
    })
    lossMap.value = { ...lossMap.value, ...patch }
  }
}

// 数据/筛选变化后重新拉（带 300ms 防抖）
watch(
  () => mergedRows.value,
  () => {
    clearTimeout(lossTimer)
    lossTimer = setTimeout(refreshLosses, 300)
  },
)

// ====== 手动同步（金蝶生产 + 电表 + 生产入库）======
// 注意：MES 段（9/15 起）不在此按钮范围内——它由工厂内网 192.168.1.14 定时推送过来，
// 服务器在公网拉不到内网，所以只能等推送。下方明细行会显示 MES 上次推送距今多久。
const syncing = ref(false)
const syncMsg = ref('')
const syncDetail = ref('')
const mesAgeMinutes = ref(null) // MES 上次推送距今分钟数；null = 还没有推送记录
let lastSyncResult = null
let syncMsgTimer = null

function mesAgeText(min) {
  if (min == null) return '暂无推送记录'
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  return `${Math.floor(min / 60)} 小时 ${min % 60} 分钟前`
}

/** 组装数据源明细行：本次同步结果（若有）+ MES 推送新鲜度 */
function renderSyncDetail() {
  const parts = []
  const s = lastSyncResult
  if (s) {
    const push = (r, okText, failText) => {
      if (!r) return
      if (r.status === 'ok') parts.push(typeof okText === 'function' ? okText(r) : okText)
      else parts.push(failText)
    }
    push(s.production, (r) => `金蝶 ${r.count} 条`, '金蝶 失败')
    push(s.power, '电表 OK', '电表 失败')
    push(s.fillbox, (r) => `入库 ${r.count} 行`, '入库 失败')
  }
  const mesPart = `MES 由内网推送，${mesAgeText(mesAgeMinutes.value)}`
  syncDetail.value = parts.length ? `${parts.join(' · ')} ｜ ${mesPart}` : mesPart
}

/** 拉取各数据源状态（MES 新鲜度）——loadData 每次触发时顺带刷新 */
async function refreshMesStatus() {
  try {
    const h = await fetchHealth()
    mesAgeMinutes.value = h?.mes?.ageMinutes ?? null
  } catch (e) {
    mesAgeMinutes.value = null
  }
  renderSyncDetail()
}

async function handleSync() {
  if (syncing.value) return
  syncing.value = true
  syncMsg.value = ''
  try {
    const result = await triggerSync()
    lastSyncResult = result?.sync || null
    mesAgeMinutes.value = lastSyncResult?.mes?.ageMinutes ?? mesAgeMinutes.value
    syncMsg.value = '同步成功'
    renderSyncDetail()
    await loadData() // 同步完成后重新拉看板数据
  } catch (e) {
    console.error('[board] 同步失败:', e)
    syncMsg.value = '同步失败'
  }
  syncing.value = false
  clearTimeout(syncMsgTimer)
  syncMsgTimer = setTimeout(() => { syncMsg.value = '' }, 4000)
}

/** 点损耗率：打开明细弹窗（未拉过则即时拉取） */
async function openLoss(mo) {
  let rec = lossMap.value[mo]
  if (!rec) {
    try {
      rec = await fetchMoLoss(mo)
    } catch (e) {
      rec = { moNumber: mo, found: false }
    }
    lossMap.value = { ...lossMap.value, [mo]: rec }
  }
  lossDialog.value = rec
}
function closeLoss() {
  lossDialog.value = null
}

// 损耗明细行是否展示（订单完工+）
function lossDetailRows(rec) {
  if (!rec || !rec.billNo || !FINAL_LOSS_STATUSES.includes(rec.fstatus)) return []
  return rec.entries || []
}

function fmtLossNum(v) {
  if (v == null || v === '') return '—'
  const n = Number(v)
  return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(2)
}
// 损耗率着色：超出正常范围(>10% 或 <-10%)异常红标；正常范围内 >=5% 红 / >=3% 橙 / 其余绿(负数绿=比理论省料)
function lossRateClass(str) {
  if (str == null || str === '' || str === '-') return ''
  const n = parseFloat(String(str).replace('%', ''))
  if (Number.isNaN(n)) return ''
  if (n > 10 || n < -10) return 'loss-abnormal'
  if (n >= 5) return 'loss-bad'
  if (n >= 3) return 'loss-mid'
  return 'loss-good'
}
</script>

<template>
  <div class="board-page">
    <!-- 顶部标题、时间维度选择 -->
    <div class="board-header">
      <h2 class="page-title">生产执行看板</h2>
      <div class="header-controls">
        <select class="year-select" :value="currentYear" @change="onYearChange(Number($event.target.value))">
          <option v-for="y in availableYears" :key="y" :value="y">{{ y }} 年</option>
        </select>
        <PeriodSelector
          ref="periodSelectorRef"
          :dimension="currentDimension"
          :year="currentYear"
          @update:period="onPeriodChange"
        />
        <div class="view-switcher">
          <button
            v-for="v in [{ label: '班次维度', value: 'shift' }, { label: '日维度', value: 'day' }]"
            :key="v.value"
            :class="['dim-btn', { active: currentView === v.value }]"
            @click="onViewChange(v.value)"
          >
            {{ v.label }}
          </button>
        </div>
        <div class="dimension-switcher">
          <button
            v-for="dim in dimensions"
            :key="dim.value"
            :class="['dim-btn', { active: currentDimension === dim.value }]"
            @click="onDimensionChange(dim.value)"
          >
            {{ dim.label }}
          </button>
        </div>
        <button class="sync-btn" :class="{ syncing }" :disabled="syncing" @click="handleSync" title="手动同步金蝶生产 / 电表 / 生产入库。MES 数据由工厂内网定时推送，不在此按钮范围内。">
          <svg v-if="syncing" class="sync-icon spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
            <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
            <line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
            <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
          </svg>
          <svg v-else class="sync-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
          <span v-if="syncMsg" class="sync-msg" :class="{ error: syncMsg === '同步失败' }">{{ syncMsg }}</span>
          <span v-else class="sync-label">{{ syncing ? '同步中' : '同步' }}</span>
        </button>
      </div>
    </div>

    <!-- 数据源状态：手动同步的明细 + MES 推送新鲜度（MES 走内网推送，上面那个按钮同步不到它） -->
    <div v-if="syncDetail" class="sync-detail">{{ syncDetail }}</div>

    <!-- 筛选栏：车间 / 设备 / 人员 -->
    <div class="filter-bar">
      <label class="filter-item">
        <span class="filter-label">车间</span>
        <select v-model="filterWorkshop" class="filter-select">
          <option value="">全部车间</option>
          <option v-for="w in workshopOptions" :key="w" :value="w">{{ w }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span class="filter-label">设备</span>
        <select v-model="filterMachine" class="filter-select">
          <option value="">全部设备</option>
          <option v-for="m in machineOptions" :key="m" :value="m">{{ m }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span class="filter-label">人员</span>
        <select v-model="filterOperator" class="filter-select">
          <option value="">全部人员</option>
          <option v-for="o in operatorOptions" :key="o" :value="o">{{ o }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span class="filter-label">客户</span>
        <select v-model="filterCustomer" class="filter-select">
          <option value="">全部客户</option>
          <option v-for="c in customerOptions" :key="c" :value="c">{{ c }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span class="filter-label">产品名称</span>
        <select v-model="filterProduct" class="filter-select">
          <option value="">全部产品</option>
          <option v-for="p in productOptions" :key="p" :value="p">{{ p }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span class="filter-label">生产订单编号</span>
        <input v-model="filterMo" type="text" class="filter-input" placeholder="输入订单号筛选" />
      </label>
      <span class="filter-count">共 {{ mergedRows.length }} 条 · {{ rangeLabel }}</span>
    </div>

    <!-- 主表 -->
    <div v-if="loading" class="board-skeleton">
      <div class="skeleton-bar"></div>
      <div class="skeleton-bar"></div>
      <div class="skeleton-bar"></div>
      <div class="skeleton-bar"></div>
      <div class="skeleton-bar"></div>
    </div>
    <ProductionBoardTable
      v-else
      :rows="mergedRows"
      :view="currentView"
      :loss-map="lossMap"
      @open-loss="openLoss"
    />

    <!-- 损耗明细弹窗 -->
    <div v-if="lossDialog" class="loss-overlay" @click.self="closeLoss">
      <div class="loss-modal">
        <div class="loss-modal-head">
          <div class="loss-modal-title">
            <span>损耗明细</span>
            <span class="loss-modal-mo">{{ lossDialog.billNo || lossDialog.moNumber }}</span>
          </div>
          <button class="loss-modal-close" @click="closeLoss">✕</button>
        </div>
        <template v-if="lossDialog.billNo">
          <div class="loss-modal-summary">
            <div class="loss-summary-product">{{ lossDialog.materialName || '—' }}</div>
            <div class="loss-summary-rate">
              损耗率
              <b :class="lossRateClass(lossDialog.lossRate)">{{ lossDialog.lossRate || '—' }}</b>
              <span class="loss-status-tag">订单状态：{{ lossDialog.fstatus }}</span>
            </div>
            <div class="loss-summary-meta">
              理论用量 {{ fmtLossNum(lossDialog.totalTheory) }} ｜ 实际用量 {{ fmtLossNum(lossDialog.totalReal) }}
              ｜ 入库 {{ fmtLossNum(lossDialog.stockQty) }} {{ lossDialog.unit || '' }}
            </div>
          </div>
          <div v-if="lossDetailRows(lossDialog).length" class="loss-table-wrap">
            <table class="loss-table">
              <thead>
                <tr><th>物料编码</th><th>子件物料</th><th>单位</th><th>理论用量</th><th>实际用量</th><th>损耗率</th></tr>
              </thead>
              <tbody>
                <tr v-for="(en, i) in lossDetailRows(lossDialog)" :key="i">
                  <td class="loss-td-code">{{ en.childNo || '—' }}</td>
                  <td class="loss-td-name" :title="en.materialName">{{ en.materialName }}</td>
                  <td>{{ en.unit || '—' }}</td>
                  <td class="loss-num">{{ fmtLossNum(en.theoryQty) }}</td>
                  <td class="loss-num">{{ fmtLossNum(en.realQty) }}</td>
                  <td :class="lossRateClass(en.lossRate)">{{ en.lossRate || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="loss-note">
            <template v-if="FINAL_LOSS_STATUSES.includes(lossDialog.fstatus)">该订单暂无用料明细</template>
            <template v-else>订单状态「{{ lossDialog.fstatus }}」，损耗率尚未稳定，完工后可见</template>
          </div>
        </template>
        <div v-else class="loss-note">未查询到该订单的损耗数据</div>
      </div>
    </div>

    <!-- 单位小时产量曲线：筛选到具体设备/产品/车间时显示；班次维度按设备拆线，日维度按产品拆线 -->
    <div v-if="!loading && showHourlyChart" class="hourly-chart-block">
      <TrendLine
        :multiSeries="hourlySeries"
        :title="currentView === 'day' ? '单位小时产量趋势（按产品）' : '单位小时产量趋势（按设备）'"
        :simple-tooltip="currentView === 'day'"
        :height="300"
      />
    </div>
    <!-- 实际产量趋势 + OES 趋势：与单位小时产量图同分组、同筛选时机 -->
    <div v-if="!loading && showHourlyChart" class="hourly-chart-block">
      <TrendLine
        :multiSeries="actualSeries"
        :title="currentView === 'day' ? '实际产量趋势（按产品）' : '实际产量趋势（按设备）'"
        :simple-tooltip="currentView === 'day'"
        :height="300"
      />
    </div>
    <div v-if="!loading && showHourlyChart" class="hourly-chart-block">
      <TrendLine
        :multiSeries="oesSeries"
        :title="currentView === 'day' ? 'OES趋势（按产品）' : 'OES趋势（按设备）'"
        :simple-tooltip="currentView === 'day'"
        :y-axis-max="100"
        :height="300"
      />
    </div>
    <!-- 电量趋势：电表为车间×每日粒度，仅日维度（按产品）显示 -->
    <div v-if="!loading && showHourlyChart && currentView === 'day'" class="hourly-chart-block">
      <TrendLine :multiSeries="powerSeries" title="电量趋势（按产品）" :simple-tooltip="true" :height="300" />
    </div>
  </div>
</template>

<style scoped>
.board-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.board-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
}

.page-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}

.header-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

/* 数据源状态行：小字、可换行、手机端也不挤 */
.sync-detail {
  margin-top: -6px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-tertiary, #94A3B8);
  word-break: break-word;
}

.year-select {
  padding: 4px 10px;
  border: 1px solid var(--border-color, #E2E8F0);
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-primary);
  background: var(--bg-card);
  cursor: pointer;
  outline: none;
}

.dimension-switcher {
  display: flex;
  gap: 4px;
  background: var(--bg-card);
  border-radius: var(--radius-sm);
  padding: 3px;
  box-shadow: var(--shadow-sm);
}

.view-switcher {
  display: flex;
  gap: 4px;
  background: var(--bg-card);
  border-radius: var(--radius-sm);
  padding: 3px;
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--primary-light, #93C5FD);
}
.view-switcher .dim-btn.active {
  background: var(--primary, #1E40AF);
  color: #fff;
}

.dim-btn {
  padding: 6px 16px;
  border: none;
  background: transparent;
  border-radius: 4px;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
}
.dim-btn:hover { color: var(--primary-light); }
.dim-btn.active { background: var(--primary); color: #fff; }

/* 筛选栏 */
.filter-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  background: var(--bg-card);
  border-radius: var(--radius-md);
  padding: 10px 14px;
  box-shadow: var(--shadow-sm);
}

.filter-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.filter-label {
  font-size: 12px;
  color: var(--text-primary, #1E293B);
  white-space: nowrap;
}

.filter-select {
  padding: 4px 8px;
  border: 1px solid var(--border-color, #E2E8F0);
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-primary);
  background: var(--bg-card);
  cursor: pointer;
  outline: none;
  max-width: 220px;
}
.filter-select:focus { border-color: var(--primary, #3B82F6); }

.filter-input {
  padding: 4px 8px;
  border: 1px solid var(--border-color, #E2E8F0);
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-primary);
  background: var(--bg-card);
  outline: none;
  width: 180px;
  max-width: 220px;
}
.filter-input:focus { border-color: var(--primary, #3B82F6); }
.filter-input::placeholder { color: var(--text-muted, #94A3B8); }

.filter-count {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-muted, #94A3B8);
}

/* 单位小时产量曲线 */
.hourly-chart-block {
  background: var(--bg-card);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  padding: 10px;
}

/* 骨架屏 */
.board-skeleton {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.skeleton-bar {
  height: 44px;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 8px;
}
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

@media (max-width: 768px) {
  .board-header { flex-direction: column; align-items: flex-start; }
  .header-controls { width: 100%; gap: 6px; }
  .page-title { font-size: 16px; }
  .dim-btn { padding: 6px 10px; font-size: 12px; }
  .year-select { font-size: 12px; padding: 4px 6px; }
  .filter-bar { gap: 8px; padding: 8px 10px; }
  .filter-item { flex: 1 1 100%; }
  .filter-select { width: 100%; max-width: none; }
  .filter-input { width: 100%; max-width: none; }
  .filter-count { margin-left: 0; }
}

/* ====== 损耗明细弹窗 ====== */
.loss-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}
.loss-modal {
  background: #fff;
  border-radius: 10px;
  width: min(560px, 100%);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);
  overflow: hidden;
}
.loss-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #E2E8F0;
  background: #F8FAFC;
}
.loss-modal-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 15px;
  font-weight: 600;
  color: #1E293B;
}
.loss-modal-mo { font-size: 12px; color: #64748B; font-weight: 500; }
.loss-modal-close {
  border: none;
  background: transparent;
  font-size: 15px;
  color: #94A3B8;
  cursor: pointer;
  padding: 2px 6px;
}
.loss-modal-close:hover { color: #1E293B; }
.loss-modal-summary {
  padding: 12px 16px;
  border-bottom: 1px solid #F1F5F9;
}
.loss-summary-product { font-size: 13px; color: #334155; margin-bottom: 6px; }
.loss-summary-rate { font-size: 18px; font-weight: 700; color: #1E293B; }
.loss-summary-rate .loss-status-tag {
  font-size: 11px;
  font-weight: 500;
  color: #64748B;
  margin-left: 8px;
  background: #F1F5F9;
  padding: 2px 6px;
  border-radius: 4px;
}
.loss-summary-meta { font-size: 12px; color: #94A3B8; margin-top: 6px; }
.loss-table-wrap { overflow: auto; padding: 0 16px 14px; }
.loss-table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
.loss-table th {
  text-align: left;
  color: #64748B;
  font-weight: 500;
  padding: 6px 8px;
  border-bottom: 1px solid #E2E8F0;
  white-space: nowrap;
}
.loss-table td { padding: 6px 8px; border-bottom: 1px solid #F1F5F9; color: #334155; }
.loss-td-code { white-space: nowrap; font-variant-numeric: tabular-nums; color: #475569; }
.loss-td-name { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.loss-num { text-align: right; font-variant-numeric: tabular-nums; }
.loss-note { padding: 20px 16px; color: #94A3B8; font-size: 13px; text-align: center; }
.loss-good { color: #16A34A; font-weight: 600; }
.loss-mid { color: #D97706; font-weight: 600; }
.loss-bad { color: #DC2626; font-weight: 700; }
/* 手动同步按钮 */
.sync-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--border-color, #E2E8F0);
  border-radius: 6px;
  background: var(--bg-card);
  color: var(--text-secondary, #64748B);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}
.sync-btn:hover:not(:disabled) {
  color: var(--primary, #3B82F6);
  border-color: var(--primary, #3B82F6);
}
.sync-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.sync-btn.syncing {
  color: var(--primary, #3B82F6);
  border-color: var(--primary, #3B82F6);
}
.sync-icon {
  flex-shrink: 0;
}
.sync-icon.spin {
  animation: sync-spin 1s linear infinite;
}
@keyframes sync-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.sync-label {
  font-size: 13px;
  color: inherit;
}
.sync-msg {
  font-size: 12px;
  color: #22C55E;
  font-weight: 500;
}
.sync-msg.error {
  color: #EF4444;
}
/* 损耗率超出正常范围(>10% 或 <-10%)：红底警示标签 */
.loss-abnormal {
  display: inline-block;
  color: #B91C1C;
  font-weight: 800;
  background: #FEE2E2;
  padding: 1px 7px;
  border-radius: 5px;
  box-shadow: inset 0 0 0 1px #FCA5A5;
}
</style>
