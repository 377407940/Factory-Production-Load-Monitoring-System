<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { fetchStagnant, triggerStagnantSync, pushStagnantToDingTalk } from '../api/monitor.js'
import MetricCard from '../components/widgets/MetricCard.vue'
import TrendLine from '../components/charts/TrendLine.vue'

const router = useRouter()
const route = useRoute()

const THRESHOLDS = [30, 60, 90]
const days = ref(THRESHOLDS.includes(Number(route.query.days)) ? Number(route.query.days) : 30)
/** URL 上的客户筛选（逗号分隔）——服务端截图推送时按这个还原因果筛选态 */
const custFromQuery = () => (route.query.cust ? String(route.query.cust).split(',').map((s) => s.trim()).filter(Boolean) : [])

const loading = ref(true)
const error = ref('')
const data = ref(null)
const expanded = ref(new Set()) // 已展开的物料编码

const summary = computed(() => (data.value && data.value.summary) || {})
const rows = computed(() => (data.value && data.value.rows) || [])
const trend = computed(() => (data.value && data.value.trend) || [])

const asOf = computed(() => (data.value && data.value.asOf) || '')
const stockName = computed(() => (data.value && data.value.stockName) || '成品仓')
const orgNumber = computed(() => (data.value && data.value.orgNumber) || 'YJY')

// 汇总卡
const cards = computed(() => {
  const s = summary.value
  return [
    { title: `呆滞成品（>${days.value}天）`, value: fmtN(s.stagnantItems), unit: '个', color: '#DC2626', subLabel: '占在库成品', subText: s.stockItems ? `${s.stagnantItems}/${s.stockItems} 个` : '—' },
    { title: '呆滞库存量', value: fmtN(s.stagnantQty), unit: '', color: '#EA580C', subLabel: '呆滞批次数', subText: `${fmtN(s.stagnantLots)} 批` },
    { title: '呆滞占在库比', value: s.stagnantRatio == null ? '—' : String(s.stagnantRatio), unit: '%', color: '#D97706', subLabel: '在库总量', subText: fmtN(s.stockQty) },
    { title: '最老账龄', value: fmtN(s.oldestAgeDays), unit: '天', color: '#7C3AED', subLabel: '即最早那批', subText: '生产日期距今' },
    { title: '已过保质期', value: fmtN(s.expiredLots), unit: '批', color: '#0EA5E9', subLabel: '呆滞批次中', subText: s.expiredLots ? '需优先处理' : '暂无' },
  ]
})

const trendItems = computed(() => trend.value.map((t) => ({ label: t.label, value: t.items })))
const trendQty = computed(() => trend.value.map((t) => ({ label: t.label, value: Math.round(t.qty) })))

// ====== 客户筛选（多选；选项取自当前数据的客户）======
const filterCustomers = ref(custFromQuery())
const customerPanelOpen = ref(false)
// 同步进 URL：手动推送时服务端要按 query 还原筛选态，顺便让链接可分享
watch(filterCustomers, (v) => {
  const q = { ...route.query }
  if (v.length) q.cust = v.join(',')
  else delete q.cust
  router.replace({ query: q })
})
const customerOptions = computed(() =>
  [...new Set(rows.value.map((r) => r.customer).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh')),
)
// 解析不到客户的批次（老批号可能没有入库单）；有才给「（未匹配）」这个选项
const hasUnmatched = computed(() => rows.value.some((r) => !r.customer))
const filteredRows = computed(() => {
  if (filterCustomers.value.length === 0) return rows.value
  return rows.value.filter((r) => filterCustomers.value.includes(r.customer || ''))
})
const filteredQty = computed(() => filteredRows.value.reduce((s, r) => s + (Number(r.qty) || 0), 0))

// ====== 表头排序（点击列头切换升/降序；默认按呆滞库存量降序，和后端返回顺序一致）======
const TEXT_KEYS = new Set(['materialCode', 'product', 'customer', 'oldestProduceDate', 'earliestExpiry', 'stockUnit'])
const sortKey = ref('qty')
const sortDir = ref('desc')
const sortedRows = computed(() => {
  const dir = sortDir.value === 'asc' ? 1 : -1
  const k = sortKey.value
  return [...filteredRows.value].sort((a, b) => {
    const va = a[k]
    const vb = b[k]
    if (TEXT_KEYS.has(k)) {
      // 文本列的空值（如未匹配到客户）同样恒排最后
      const sa = String(va || '')
      const sb = String(vb || '')
      if (!sa && !sb) return 0
      if (!sa) return 1
      if (!sb) return -1
      return sa.localeCompare(sb, 'zh') * dir
    }
    const na = va == null || va === '' ? null : Number(va)
    const nb = vb == null || vb === '' ? null : Number(vb)
    if (na == null && nb == null) return 0
    if (na == null) return 1 // 空值恒排最后，不随升降序翻转
    if (nb == null) return -1
    return (na - nb) * dir
  })
})
function toggleSort(k) {
  if (sortKey.value === k) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
    return
  }
  sortKey.value = k
  sortDir.value = TEXT_KEYS.has(k) ? 'asc' : 'desc'
}
function sortClass(k) {
  if (sortKey.value !== k) return ''
  return sortDir.value === 'asc' ? 'st-sorted st-asc' : 'st-sorted st-desc'
}

function fmtN(v) {
  return v == null || v === '' ? '—' : Number(v).toLocaleString()
}
/** 账龄分档配色：31-60 黄 / 61-90 橙 / >90 红 */
function ageClass(age) {
  if (age == null) return ''
  if (age > 90) return 'age-red'
  if (age > 60) return 'age-orange'
  if (age > 30) return 'age-amber'
  return ''
}
function expiryClass(d) {
  if (d == null) return ''
  if (d < 0) return 'age-red'
  if (d <= 30) return 'age-orange'
  if (d <= 90) return 'age-amber'
  return ''
}
function toggleExpand(code) {
  const s = new Set(expanded.value)
  if (s.has(code)) s.delete(code)
  else s.add(code)
  expanded.value = s
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    data.value = await fetchStagnant(days.value)
  } catch (e) {
    console.error('[stagnant] 加载失败:', e)
    error.value = '数据获取失败，请稍后重试'
    data.value = null
  }
  loading.value = false
}

function setDays(d) {
  if (days.value === d) return
  days.value = d
  router.replace({ query: { ...route.query, days: d } })
  load()
}

// 手动同步（重新拉金蝶即时库存）
const syncing = ref(false)
const syncMsg = ref('')
let syncTimer = null
async function handleSync() {
  if (syncing.value) return
  syncing.value = true
  syncMsg.value = ''
  try {
    const r = await triggerStagnantSync()
    syncMsg.value = `已刷新 (${r?.count ?? 0} 个批次)`
    await load()
  } catch (e) {
    console.error('[stagnant] 同步失败:', e)
    syncMsg.value = '刷新失败'
  }
  syncing.value = false
  clearTimeout(syncTimer)
  syncTimer = setTimeout(() => { syncMsg.value = '' }, 4000)
}

// 手动推送到钉钉群（截当前视图的整页图；服务端跑无头 Chrome，约 10 秒）
const pushing = ref(false)
const pushMsg = ref('')
let pushTimer = null
async function handlePush() {
  if (pushing.value) return
  pushing.value = true
  pushMsg.value = ''
  try {
    const r = await pushStagnantToDingTalk(days.value, filterCustomers.value)
    pushMsg.value = `已推送 (${r?.items ?? 0} 个成品)`
  } catch (e) {
    console.error('[stagnant] 推送失败:', e)
    pushMsg.value = '推送失败'
  }
  pushing.value = false
  clearTimeout(pushTimer)
  pushTimer = setTimeout(() => { pushMsg.value = '' }, 5000)
}

onMounted(load)
</script>

<template>
  <div class="st-page">
    <!-- 标题 + 阈值切换 + 刷新 -->
    <div class="st-header">
      <h2 class="st-title">呆滞成品</h2>
      <div class="st-controls">
        <div class="st-switcher">
          <button
            v-for="d in THRESHOLDS"
            :key="d"
            :class="['st-dim-btn', { active: days === d }]"
            @click="setDays(d)"
          >{{ d }} 天</button>
        </div>
        <span v-if="asOf" class="st-asof">截至 {{ asOf }}</span>
        <button class="st-sync-btn" :class="{ syncing }" :disabled="syncing" @click="handleSync" title="重新拉取金蝶即时库存">
          <svg v-if="syncing" class="st-sync-icon spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
            <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
            <line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
            <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
          </svg>
          <svg v-else class="st-sync-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
          <span v-if="syncMsg" class="st-sync-msg" :class="{ error: syncMsg === '刷新失败' }">{{ syncMsg }}</span>
          <span v-else class="st-sync-label">{{ syncing ? '刷新中' : '刷新' }}</span>
        </button>
        <button class="st-sync-btn" :class="{ syncing: pushing }" :disabled="pushing" @click="handlePush" title="把当前视图截整页图推到钉钉群（约 10 秒）">
          <svg v-if="pushing" class="st-sync-icon spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
            <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
            <line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
            <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
          </svg>
          <svg v-else class="st-sync-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>
          </svg>
          <span v-if="pushMsg" class="st-sync-msg" :class="{ error: pushMsg === '推送失败' }">{{ pushMsg }}</span>
          <span v-else class="st-sync-label">{{ pushing ? '推送中' : '推送到钉钉' }}</span>
        </button>
      </div>
    </div>

    <!-- 口径说明 -->
    <div class="st-note">
      数据源：金蝶即时库存 · 组织 <b>{{ orgNumber }}</b> · 仓库「{{ stockName }}」· 仅库存量 &gt; 0 ｜
      呆滞口径：<b>批号的生产日期</b>距今超过 {{ days }} 天（<b>按批号判定</b>，不是按成品整体）｜
      数量按基本单位计（该 ERP 的基本单位统一名为 Pcs），<b>单位列取「库存单位」</b>（箱/盒），与实际包装一致 ｜
      <b>客户</b>由批号反查入库单 → 生产订单 → 销售订单得到（库存表本身没有客户字段）｜
      表头可点击排序，客户可按多选筛选
    </div>

    <div v-if="loading" class="st-skeleton">
      <div class="st-sk-bar"></div>
      <div class="st-sk-bar"></div>
      <div class="st-sk-bar"></div>
    </div>

    <template v-else-if="data">
      <!-- 汇总卡 -->
      <div class="st-cards">
        <MetricCard
          v-for="c in cards"
          :key="c.title"
          :title="c.title"
          :value="c.value"
          :unit="c.unit"
          :color="c.color"
          :sub-label="c.subLabel"
          :sub-text="c.subText"
        />
      </div>

      <!-- 趋势 -->
      <div class="st-trends">
        <div class="st-trend-box">
          <TrendLine :data="trendItems" title="呆滞品项数趋势" :height="200" line-color="#DC2626" />
        </div>
        <div class="st-trend-box">
          <TrendLine :data="trendQty" title="呆滞库存量趋势" :height="200" line-color="#EA580C" />
        </div>
      </div>
      <div v-if="data.trendPoints < 3" class="st-trend-hint">
        趋势从 2026-10-09 开始逐日积累（即时库存没有历史接口），当前 {{ data.trendPoints }} 个数据点，过几天才有形状。
      </div>

      <!-- 明细 -->
      <div v-if="rows.length === 0" class="st-empty">
        当前没有超过 {{ days }} 天的呆滞成品库存 👌
      </div>
      <template v-else>
      <div class="st-toolbar">
        <div class="st-cust-filter">
          <button
            class="st-cust-btn"
            :class="{ active: filterCustomers.length > 0 }"
            @click="customerPanelOpen = !customerPanelOpen"
          >
            客户<span v-if="filterCustomers.length" class="st-cust-count">{{ filterCustomers.length }}</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>
          </button>
          <div v-if="customerPanelOpen" class="st-cust-backdrop" @click="customerPanelOpen = false"></div>
          <div v-if="customerPanelOpen" class="st-cust-panel">
            <div class="st-cust-actions">
              <a @click="filterCustomers = [...customerOptions]">全选</a>
              <a @click="filterCustomers = []">清空</a>
            </div>
            <label v-for="c in customerOptions" :key="c" class="st-cust-opt">
              <input type="checkbox" :value="c" v-model="filterCustomers" />
              <span>{{ c }}</span>
            </label>
            <label v-if="hasUnmatched" class="st-cust-opt">
              <input type="checkbox" value="" v-model="filterCustomers" />
              <span class="st-muted">（未匹配）</span>
            </label>
          </div>
        </div>
        <span class="st-count">
          共 <b>{{ sortedRows.length }}</b> 个成品<template v-if="filterCustomers.length"> / {{ rows.length }}</template>
          · 呆滞量 <b>{{ fmtN(filteredQty) }}</b>
        </span>
      </div>
      <div class="st-table-wrap">
        <table class="st-table">
          <thead>
            <tr>
              <th class="st-expand-col"></th>
              <th class="st-sortable" :class="sortClass('materialCode')" @click="toggleSort('materialCode')">物料编码<i class="st-arrow"></i></th>
              <th class="st-name-col st-sortable" :class="sortClass('product')" @click="toggleSort('product')">成品名称<i class="st-arrow"></i></th>
              <th class="st-cust-col st-sortable" :class="sortClass('customer')" @click="toggleSort('customer')">客户<i class="st-arrow"></i></th>
              <th class="num st-sortable" :class="sortClass('qty')" @click="toggleSort('qty')">呆滞库存量<i class="st-arrow"></i></th>
              <th class="st-sortable" :class="sortClass('stockUnit')" @click="toggleSort('stockUnit')">单位<i class="st-arrow"></i></th>
              <th class="num st-sortable" :class="sortClass('qtyAll')" @click="toggleSort('qtyAll')">该成品在库<i class="st-arrow"></i></th>
              <th class="num st-sortable" :class="sortClass('lots')" @click="toggleSort('lots')">呆滞批号数<i class="st-arrow"></i></th>
              <th class="st-sortable" :class="sortClass('oldestProduceDate')" @click="toggleSort('oldestProduceDate')">最老生产日期<i class="st-arrow"></i></th>
              <th class="num st-sortable" :class="sortClass('oldestAgeDays')" @click="toggleSort('oldestAgeDays')">账龄(天)<i class="st-arrow"></i></th>
              <th class="st-sortable" :class="sortClass('earliestExpiry')" @click="toggleSort('earliestExpiry')">最早到期日<i class="st-arrow"></i></th>
              <th class="num st-sortable" :class="sortClass('daysToExpiry')" @click="toggleSort('daysToExpiry')">剩余保质期(天)<i class="st-arrow"></i></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="r in sortedRows" :key="r.materialCode">
              <tr class="st-row" :class="{ open: expanded.has(r.materialCode) }" @click="toggleExpand(r.materialCode)">
                <td class="st-expand-col">
                  <svg class="st-caret" :class="{ open: expanded.has(r.materialCode) }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>
                </td>
                <td class="st-code">{{ r.materialCode }}</td>
                <td class="st-name" :title="r.product">{{ r.product }}</td>
                <td class="st-cust" :title="r.customer">{{ r.customer || '—' }}</td>
                <td class="num st-strong">{{ fmtN(r.qty) }}</td>
                <td class="st-unit">{{ r.stockUnit || '—' }}</td>
                <td class="num st-muted">{{ fmtN(r.qtyAll) }}</td>
                <td class="num">{{ r.lots }}<span class="st-muted"> / {{ r.lotsAll }}</span></td>
                <td>{{ r.oldestProduceDate || '—' }}</td>
                <td class="num" :class="ageClass(r.oldestAgeDays)">{{ fmtN(r.oldestAgeDays) }}</td>
                <td>{{ r.earliestExpiry || '—' }}</td>
                <td class="num" :class="expiryClass(r.daysToExpiry)">{{ fmtN(r.daysToExpiry) }}</td>
              </tr>
              <tr v-if="expanded.has(r.materialCode)" class="st-lot-row">
                <td></td>
                <td colspan="11">
                  <table class="st-lot-table">
                    <thead>
                      <tr>
                        <th>批号</th>
                        <th>生产日期</th>
                        <th class="num">账龄(天)</th>
                        <th>保质期至</th>
                        <th class="num">剩余(天)</th>
                        <th class="num">数量</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="l in r.lotsList" :key="l.lot">
                        <td class="st-lot">{{ l.lot }}</td>
                        <td>{{ l.produceDate || '—' }}</td>
                        <td class="num" :class="ageClass(l.ageDays)">{{ fmtN(l.ageDays) }}</td>
                        <td>{{ l.expiryDate || '—' }}</td>
                        <td class="num" :class="expiryClass(l.daysToExpiry)">{{ fmtN(l.daysToExpiry) }}</td>
                        <td class="num st-strong">{{ fmtN(l.qty) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      </template>
    </template>

    <div v-else-if="error" class="st-empty st-error">{{ error }}</div>
  </div>
</template>

<style scoped>
.st-page { display: flex; flex-direction: column; gap: 14px; }
.st-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
.st-title { font-size: 18px; font-weight: 600; color: var(--text-primary); margin: 0; }
.st-controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.st-switcher { display: inline-flex; border: 1px solid var(--border-color, #E2E8F0); border-radius: 6px; overflow: hidden; background: var(--bg-card); }
.st-dim-btn {
  padding: 5px 12px; border: none; background: transparent; cursor: pointer;
  font-size: 13px; color: var(--text-secondary, #64748B); border-right: 1px solid var(--border-color, #E2E8F0);
}
.st-dim-btn:last-child { border-right: none; }
.st-dim-btn.active { background: var(--primary, #3B82F6); color: #fff; font-weight: 600; }
.st-asof { font-size: 12px; color: var(--text-muted, #94A3B8); }
.st-sync-btn {
  display: inline-flex; align-items: center; gap: 5px; padding: 5px 12px;
  border: 1px solid var(--border-color, #E2E8F0); border-radius: 6px; background: var(--bg-card);
  color: var(--text-secondary, #64748B); font-size: 13px; cursor: pointer; transition: all .2s; white-space: nowrap;
}
.st-sync-btn:hover:not(:disabled) { color: var(--primary, #3B82F6); border-color: var(--primary, #3B82F6); }
.st-sync-btn:disabled { opacity: .6; cursor: not-allowed; }
.st-sync-icon.spin { animation: st-spin 1s linear infinite; }
@keyframes st-spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
.st-sync-msg { font-size: 12px; color: #22C55E; font-weight: 500; }
.st-sync-msg.error { color: #EF4444; }
.st-note { font-size: 12px; color: var(--text-muted, #94A3B8); line-height: 1.7; }
.st-cards { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }
.st-trends { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.st-trend-box { background: var(--bg-card); border-radius: 10px; box-shadow: var(--shadow-sm); padding: 8px 10px; }
.st-trend-hint { font-size: 12px; color: var(--text-muted, #94A3B8); margin-top: -6px; }
.st-skeleton { display: flex; flex-direction: column; gap: 8px; background: var(--bg-card); border-radius: 10px; padding: 16px; }
.st-sk-bar { height: 18px; border-radius: 4px; background: linear-gradient(90deg, #F1F5F9 25%, #E2E8F0 37%, #F1F5F9 63%); background-size: 400% 100%; animation: st-shimmer 1.4s ease infinite; }
@keyframes st-shimmer { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }
.st-empty { background: var(--bg-card); border-radius: 10px; padding: 30px; text-align: center; color: var(--text-muted, #94A3B8); }
.st-error { color: #DC2626; }
/* 明细工具条：客户筛选 + 计数 */
.st-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.st-count { font-size: 12px; color: var(--text-muted, #94A3B8); }
.st-count b { color: var(--text-primary, #1E293B); font-variant-numeric: tabular-nums; }
.st-cust-filter { position: relative; }
.st-cust-btn {
  display: inline-flex; align-items: center; gap: 5px; padding: 5px 12px;
  border: 1px solid var(--border-color, #E2E8F0); border-radius: 6px; background: var(--bg-card);
  color: var(--text-secondary, #64748B); font-size: 13px; cursor: pointer;
}
.st-cust-btn:hover { color: var(--primary, #3B82F6); border-color: var(--primary, #3B82F6); }
.st-cust-btn.active { color: var(--primary, #3B82F6); border-color: var(--primary, #3B82F6); font-weight: 600; }
.st-cust-count {
  display: inline-flex; align-items: center; justify-content: center; min-width: 16px; height: 16px;
  padding: 0 4px; border-radius: 8px; background: var(--primary, #3B82F6); color: #fff; font-size: 11px;
}
/* 铺满全屏的透明遮罩，点任意处收起面板 */
.st-cust-backdrop { position: fixed; inset: 0; z-index: 20; }
.st-cust-panel {
  position: absolute; top: calc(100% + 4px); left: 0; z-index: 21;
  min-width: 260px; max-height: 320px; overflow-y: auto;
  background: var(--bg-card); border: 1px solid var(--border-color, #E2E8F0);
  border-radius: 8px; box-shadow: var(--shadow-md, 0 4px 16px rgba(0,0,0,.12)); padding: 6px;
}
.st-cust-actions { display: flex; gap: 12px; padding: 4px 8px 8px; border-bottom: 1px solid #F1F5F9; margin-bottom: 4px; }
.st-cust-actions a { font-size: 12px; color: var(--primary, #3B82F6); cursor: pointer; }
.st-cust-opt {
  display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 5px;
  font-size: 13px; color: #1E293B; cursor: pointer; min-height: 32px;
}
.st-cust-opt:hover { background: #F8FAFC; }
.st-cust-opt input { cursor: pointer; flex: none; }
.st-table-wrap { background: var(--bg-card); border-radius: 10px; box-shadow: var(--shadow-sm); overflow-x: auto; }
.st-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 1200px; }
.st-table th { text-align: left; padding: 9px 12px; background: #F8FAFC; color: #475569; font-weight: 600; white-space: nowrap; border-bottom: 1px solid #E2E8F0; }
.st-table td { padding: 8px 12px; border-bottom: 1px solid #F1F5F9; color: #1E293B; }
.st-table .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.st-expand-col { width: 28px; padding-left: 12px !important; }
.st-name-col { min-width: 260px; }
.st-row { cursor: pointer; }
.st-row:hover { background: #F8FAFC; }
.st-row.open { background: #F1F5F9; }
.st-caret { transition: transform .15s; color: #94A3B8; }
.st-caret.open { transform: rotate(90deg); }
.st-code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #475569; white-space: nowrap; }
.st-name { max-width: 340px; }
.st-cust-col { min-width: 170px; }
.st-cust { max-width: 220px; color: #475569; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.st-unit { white-space: nowrap; color: #475569; }
/* 可排序表头 */
.st-sortable { cursor: pointer; user-select: none; }
.st-sortable:hover { color: var(--primary, #3B82F6); }
.st-arrow {
  display: inline-block; margin-left: 4px; vertical-align: middle;
  width: 0; height: 0; opacity: .18;
  border-left: 3.5px solid transparent; border-right: 3.5px solid transparent;
  border-bottom: 4.5px solid currentColor;
}
.st-sorted .st-arrow { opacity: 1; }
.st-asc .st-arrow { border-bottom: 4.5px solid currentColor; border-top: none; }
.st-desc .st-arrow { border-bottom: none; border-top: 4.5px solid currentColor; }
.st-lot { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #475569; }
.st-strong { font-weight: 700; }
.st-muted { color: #94A3B8; font-weight: 400; }
.age-amber { color: #D97706; font-weight: 600; }
.age-orange { color: #EA580C; font-weight: 700; }
.age-red { color: #DC2626; font-weight: 700; }
.st-lot-row > td { background: #FBFDFF; padding: 0 12px 10px 12px; }
.st-lot-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.st-lot-table th { padding: 6px 10px; background: #F1F5F9; color: #64748B; font-weight: 600; border-bottom: 1px solid #E2E8F0; }
.st-lot-table td { padding: 5px 10px; border-bottom: 1px solid #F1F5F9; }
.st-lot-table .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }

@media (max-width: 1024px) {
  .st-cards { grid-template-columns: repeat(2, 1fr); }
  .st-trends { grid-template-columns: 1fr; }
}
@media (max-width: 640px) {
  .st-controls { width: 100%; }
  .st-cards { grid-template-columns: 1fr 1fr; gap: 8px; }
  .st-note { line-height: 1.8; }
  .st-cust-filter { flex: 1; }
  .st-cust-btn { width: 100%; justify-content: space-between; }
  .st-cust-panel { min-width: min(300px, calc(100vw - 40px)); max-height: 60vh; }
}
</style>
