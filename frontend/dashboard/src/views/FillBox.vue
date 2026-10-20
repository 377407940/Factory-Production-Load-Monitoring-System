<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { fetchFillBox, triggerFillBoxSync } from '../api/monitor.js'

const router = useRouter()
const route = useRoute()

// 日期区间（用户自选 开始/结束日期）
function todayStr() {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${dd}`
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${dd}`
}
const startDate = ref(route.query.startDate || addDays(todayStr(), -6))
const endDate = ref(route.query.endDate || todayStr())

const loading = ref(true)
const rows = ref([])

// ====== 产品筛选：可搜索的多选 ======
// 输入关键字 → 只列匹配的产品；可逐个勾，也可「全选匹配项」（= 你输入"迈胜"后一键把全部迈胜产品显示出来）
const productKeyword = ref('')
const selectedProducts = ref([]) // 空数组 = 不筛，显示全部产品
const productPanelOpen = ref(false)

const productOptions = computed(() => {
  const set = new Set()
  for (const r of rows.value) {
    if (r.product) set.add(r.product)
  }
  return [...set].sort()
})
/** 当前关键字匹配到的产品（关键字为空 = 全部） */
const matchedProducts = computed(() => {
  const kw = productKeyword.value.trim().toLowerCase()
  if (!kw) return productOptions.value
  return productOptions.value.filter((p) => p.toLowerCase().includes(kw))
})
const allMatchedSelected = computed(
  () => matchedProducts.value.length > 0 && matchedProducts.value.every((p) => selectedProducts.value.includes(p)),
)
function toggleProduct(p) {
  const i = selectedProducts.value.indexOf(p)
  if (i >= 0) selectedProducts.value.splice(i, 1)
  else selectedProducts.value.push(p)
}
/** 全选 / 取消全选「当前关键字匹配到的」产品 */
function toggleAllMatched() {
  if (allMatchedSelected.value) {
    const drop = new Set(matchedProducts.value)
    selectedProducts.value = selectedProducts.value.filter((p) => !drop.has(p))
  } else {
    selectedProducts.value = [...new Set([...selectedProducts.value, ...matchedProducts.value])]
  }
}
function clearProducts() {
  selectedProducts.value = []
  productKeyword.value = ''
}
// 换日期范围后，已选产品可能不在新数据里了 → 自动剔除
watch(productOptions, (opts) => {
  selectedProducts.value = selectedProducts.value.filter((p) => opts.includes(p))
})

// ====== 差异比例区间筛选（%，两端都可留空）======
const ratioMin = ref('')
const ratioMax = ref('')
/** 空串或非法输入 → null（该端不限） */
function parseBound(v) {
  const s = String(v == null ? '' : v).trim()
  if (s === '') return null
  const n = Number(s)
  return Number.isNaN(n) ? null : n
}
const ratioActive = computed(() => parseBound(ratioMin.value) != null || parseBound(ratioMax.value) != null)
function clearRatio() {
  ratioMin.value = ''
  ratioMax.value = ''
}

/** 每行带上算好的差异比例，筛选和展示共用（模板里就不用重复算） */
const rowsWithRate = computed(() => rows.value.map((r) => ({ ...r, rate: diffRate(r.fillQty, r.diff) })))

const filteredRows = computed(() => {
  const min = parseBound(ratioMin.value)
  const max = parseBound(ratioMax.value)
  const byProduct = selectedProducts.value.length > 0
  return rowsWithRate.value.filter((r) => {
    if (byProduct && !selectedProducts.value.includes(r.product)) return false
    if (min != null || max != null) {
      // 灌装为 0 的行没有比例（rate=null），一旦设了区间就排除
      if (r.rate == null) return false
      if (min != null && r.rate < min) return false
      if (max != null && r.rate > max) return false
    }
    return true
  })
})

function fmtN(v) {
  return v == null ? '—' : Number(v).toLocaleString()
}
function diffSign(v) {
  if (v == null) return '—'
  return v > 0 ? '+' : v < 0 ? '-' : ''
}
function diffClass(v) {
  if (v == null) return ''
  return v > 0 ? 'diff-pos' : v < 0 ? 'diff-neg' : ''
}
/** 差异比例 = 差异 ÷ 灌装。灌装为 0 时没有意义（分母为 0），返回 null 显示「—」 */
function diffRate(fill, diff) {
  if (!fill) return null
  return (diff / fill) * 100
}
/** 比例带正负号，和「差异数量」列的符号风格保持一致 */
function fmtPct(v) {
  if (v == null) return '—'
  return `${diffSign(v)}${Math.abs(v).toFixed(1)}%`
}

async function loadData() {
  loading.value = true
  try {
    const data = await fetchFillBox(startDate.value, endDate.value, 'day')
    rows.value = data.rows || []
  } catch (e) {
    console.error('[fillbox] 加载失败:', e)
    rows.value = []
  }
  loading.value = false
}

const totals = computed(() => {
  let fill = 0
  let box = 0
  for (const r of filteredRows.value) {
    fill += r.fillQty || 0
    box += r.boxQty || 0
  }
  const diff = fill - box
  return { fill, box, diff, diffRate: diffRate(fill, diff) }
})

const rangeLabel = computed(() => `${startDate.value} ~ ${endDate.value}`)

// 日期改动 → 重新查询（自动修正起止）
function onDateInput() {
  if (startDate.value && endDate.value && startDate.value > endDate.value) {
    ;[startDate.value, endDate.value] = [endDate.value, startDate.value]
  }
  router.replace({ query: { startDate: startDate.value, endDate: endDate.value } })
  loadData()
}

// 手动同步（金蝶生产入库 PRD_INSTOCK）
const syncing = ref(false)
const syncMsg = ref('')
let syncTimer = null
async function handleSync() {
  if (syncing.value) return
  syncing.value = true
  syncMsg.value = ''
  try {
    const result = await triggerFillBoxSync()
    syncMsg.value = `同步成功 (${result?.count ?? 0} 行入库)`
    await loadData()
  } catch (e) {
    console.error('[fillbox] 同步失败:', e)
    syncMsg.value = '同步失败'
  }
  syncing.value = false
  clearTimeout(syncTimer)
  syncTimer = setTimeout(() => { syncMsg.value = '' }, 4000)
}

onMounted(() => {
  loadData()
})
</script>

<template>
  <div class="fb-page">
    <!-- 顶部标题 + 日期区间 -->
    <div class="fb-header">
      <h2 class="fb-title">灌装与成品入库对比</h2>
      <div class="fb-controls">
        <label class="fb-date">
          <span class="fb-date-label">开始日期</span>
          <input v-model="startDate" type="date" class="fb-date-input" @change="onDateInput" />
        </label>
        <label class="fb-date">
          <span class="fb-date-label">结束日期</span>
          <input v-model="endDate" type="date" class="fb-date-input" @change="onDateInput" />
        </label>
        <button class="fb-sync-btn" :class="{ syncing }" :disabled="syncing" @click="handleSync" title="手动同步生产入库数据">
          <svg v-if="syncing" class="fb-sync-icon spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
            <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
            <line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
            <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
          </svg>
          <svg v-else class="fb-sync-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
          <span v-if="syncMsg" class="fb-sync-msg" :class="{ error: syncMsg === '同步失败' }">{{ syncMsg }}</span>
          <span v-else class="fb-sync-label">{{ syncing ? '同步中' : '同步' }}</span>
        </button>
      </div>
    </div>

    <!-- 筛选 + 说明 + 范围 -->
    <div class="fb-bar">
      <div class="fb-filters">
        <!-- 产品：可搜索的多选 -->
        <div class="fb-combo">
          <span class="fb-filter-label">产品</span>
          <button
            class="fb-combo-btn"
            :class="{ active: selectedProducts.length > 0 }"
            @click="productPanelOpen = !productPanelOpen"
          >
            <span class="fb-combo-text">
              {{ selectedProducts.length === 0 ? '全部产品' : `已选 ${selectedProducts.length} 个产品` }}
            </span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>
          </button>
          <div v-if="productPanelOpen" class="fb-combo-backdrop" @click="productPanelOpen = false"></div>
          <div v-if="productPanelOpen" class="fb-combo-panel">
            <input
              v-model="productKeyword"
              class="fb-combo-search"
              type="text"
              placeholder="输入关键字筛选，如：迈胜"
            />
            <div class="fb-combo-actions">
              <a @click="clearProducts">清空已选</a>
            </div>
            <label v-if="matchedProducts.length" class="fb-combo-opt fb-combo-all">
              <input type="checkbox" :checked="allMatchedSelected" @change="toggleAllMatched" />
              <span>全选匹配项（{{ matchedProducts.length }} 个）</span>
            </label>
            <div class="fb-combo-list">
              <label v-for="p in matchedProducts" :key="p" class="fb-combo-opt">
                <input type="checkbox" :checked="selectedProducts.includes(p)" @change="toggleProduct(p)" />
                <span :title="p">{{ p }}</span>
              </label>
              <div v-if="matchedProducts.length === 0" class="fb-combo-none">没有匹配的产品</div>
            </div>
          </div>
        </div>

        <!-- 差异比例区间（%） -->
        <div class="fb-ratio">
          <span class="fb-filter-label">差异比例</span>
          <input v-model="ratioMin" type="number" step="0.1" class="fb-ratio-input" placeholder="最小" />
          <span class="fb-ratio-sep">~</span>
          <input v-model="ratioMax" type="number" step="0.1" class="fb-ratio-input" placeholder="最大" />
          <span class="fb-ratio-unit">%</span>
          <a v-if="ratioActive" class="fb-ratio-clear" @click="clearRatio">清除</a>
        </div>
      </div>
      <div class="fb-bar-right">
        <span class="fb-note">灌装=条袋生产入库 ｜ 成品=盒装入库按盒条比折算 ｜ 差异=灌装−成品 ｜ 差异比例=差异÷灌装</span>
        <span class="fb-count">{{ filteredRows.length }} 条 · {{ rangeLabel }}</span>
      </div>
    </div>

    <!-- 主表：每天一行 -->
    <div v-if="loading" class="fb-skeleton">
      <div class="fb-sk-bar"></div>
      <div class="fb-sk-bar"></div>
      <div class="fb-sk-bar"></div>
    </div>
    <div v-else-if="filteredRows.length === 0" class="fb-empty">所选日期范围内暂无灌装入库数据</div>
    <div v-else class="fb-table-wrap">
      <table class="fb-table">
        <thead>
          <tr>
            <th>产品名称</th>
            <th>生产日期</th>
            <th class="num">灌装数量</th>
            <th class="num">成品数量(折算)</th>
            <th class="num">差异数量</th>
            <th class="num">差异比例</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in filteredRows" :key="i">
            <td class="name" :title="r.product">{{ r.product }}</td>
            <td class="date">{{ r.label }}</td>
            <td class="num">{{ fmtN(r.fillQty) }}</td>
            <td class="num">{{ fmtN(r.boxQty) }}</td>
            <td class="num" :class="diffClass(r.diff)">{{ diffSign(r.diff) }}{{ Math.abs(r.diff).toLocaleString() }}</td>
            <td class="num" :class="diffClass(r.diff)">{{ fmtPct(r.rate) }}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr class="fb-total">
            <td colspan="2">合计</td>
            <td class="num">{{ fmtN(totals.fill) }}</td>
            <td class="num">{{ fmtN(totals.box) }}</td>
            <td class="num" :class="diffClass(totals.diff)">{{ diffSign(totals.diff) }}{{ Math.abs(totals.diff).toLocaleString() }}</td>
            <td class="num" :class="diffClass(totals.diff)">{{ fmtPct(totals.diffRate) }}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
</template>

<style scoped>
.fb-page { display: flex; flex-direction: column; gap: 14px; }
.fb-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
.fb-title { font-size: 18px; font-weight: 600; color: var(--text-primary); margin: 0; }
.fb-controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.fb-date { display: inline-flex; align-items: center; gap: 6px; }
.fb-date-label { font-size: 13px; color: var(--text-secondary, #64748B); white-space: nowrap; }
.fb-date-input {
  padding: 4px 8px; border: 1px solid var(--border-color, #E2E8F0); border-radius: 6px;
  font-size: 13px; color: var(--text-primary); background: var(--bg-card); cursor: pointer; outline: none;
}
.fb-sync-btn {
  display: inline-flex; align-items: center; gap: 5px; padding: 5px 12px;
  border: 1px solid var(--border-color, #E2E8F0); border-radius: 6px; background: var(--bg-card);
  color: var(--text-secondary, #64748B); font-size: 13px; cursor: pointer; transition: all .2s; white-space: nowrap;
}
.fb-sync-btn:hover:not(:disabled) { color: var(--primary, #3B82F6); border-color: var(--primary, #3B82F6); }
.fb-sync-btn:disabled { opacity: .6; cursor: not-allowed; }
.fb-sync-icon { flex-shrink: 0; }
.fb-sync-icon.spin { animation: fb-spin 1s linear infinite; }
@keyframes fb-spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
.fb-sync-msg { font-size: 12px; color: #22C55E; font-weight: 500; }
.fb-sync-msg.error { color: #EF4444; }
.fb-bar { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
.fb-filters { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.fb-filter-label { font-size: 12px; color: var(--text-primary, #1E293B); white-space: nowrap; }
/* 产品：可搜索的多选 */
.fb-combo { position: relative; display: inline-flex; align-items: center; gap: 6px; }
.fb-combo-btn {
  display: inline-flex; align-items: center; justify-content: space-between; gap: 8px;
  min-width: 190px; padding: 5px 10px; border: 1px solid var(--border-color, #E2E8F0); border-radius: 6px;
  background: var(--bg-card); color: var(--text-primary); font-size: 13px; cursor: pointer; transition: all .2s;
}
.fb-combo-btn:hover { border-color: var(--primary, #3B82F6); }
.fb-combo-btn.active { color: var(--primary, #3B82F6); border-color: var(--primary, #3B82F6); font-weight: 600; }
.fb-combo-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fb-combo-backdrop { position: fixed; inset: 0; z-index: 20; }
.fb-combo-panel {
  position: absolute; top: calc(100% + 4px); left: 0; z-index: 21;
  width: 380px; max-width: calc(100vw - 32px);
  background: var(--bg-card); border: 1px solid var(--border-color, #E2E8F0); border-radius: 8px;
  box-shadow: var(--shadow-md, 0 4px 16px rgba(0, 0, 0, .12));
  padding: 6px; display: flex; flex-direction: column; gap: 4px;
}
.fb-combo-search {
  width: 100%; box-sizing: border-box; padding: 7px 10px; margin-bottom: 2px;
  border: 1px solid var(--border-color, #E2E8F0); border-radius: 6px;
  font-size: 13px; color: var(--text-primary); outline: none;
}
.fb-combo-search:focus { border-color: var(--primary, #3B82F6); }
.fb-combo-actions { display: flex; justify-content: flex-end; padding: 0 6px 6px; border-bottom: 1px solid #F1F5F9; }
.fb-combo-actions a { font-size: 12px; color: var(--primary, #3B82F6); cursor: pointer; }
.fb-combo-list { max-height: 280px; overflow-y: auto; }
.fb-combo-opt {
  display: flex; align-items: center; gap: 8px; padding: 7px 8px; border-radius: 5px;
  font-size: 13px; color: #1E293B; cursor: pointer; min-height: 34px;
}
.fb-combo-opt:hover { background: #F8FAFC; }
.fb-combo-opt input { cursor: pointer; flex: none; }
.fb-combo-opt span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fb-combo-all { background: #F8FAFC; font-weight: 600; color: var(--primary, #3B82F6); }
.fb-combo-none { padding: 14px 8px; text-align: center; font-size: 12px; color: var(--text-muted, #94A3B8); }
/* 差异比例区间 */
.fb-ratio { display: inline-flex; align-items: center; gap: 6px; }
.fb-ratio-input {
  width: 78px; padding: 5px 8px; border: 1px solid var(--border-color, #E2E8F0); border-radius: 6px;
  font-size: 13px; color: var(--text-primary); background: var(--bg-card); outline: none;
}
.fb-ratio-input:focus { border-color: var(--primary, #3B82F6); }
.fb-ratio-sep, .fb-ratio-unit { font-size: 13px; color: var(--text-secondary, #64748B); }
.fb-ratio-clear { font-size: 12px; color: var(--primary, #3B82F6); cursor: pointer; }
.fb-bar-right { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; text-align: right; }
.fb-note { font-size: 12px; color: var(--text-muted, #94A3B8); }
.fb-count { font-size: 12px; color: var(--text-secondary); }
.fb-skeleton { display: flex; flex-direction: column; gap: 8px; background: var(--bg-card); border-radius: 10px; padding: 16px; }
.fb-sk-bar { height: 18px; border-radius: 4px; background: linear-gradient(90deg, #F1F5F9 25%, #E2E8F0 37%, #F1F5F9 63%); background-size: 400% 100%; animation: fb-shimmer 1.4s ease infinite; }
@keyframes fb-shimmer { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }
.fb-empty { background: var(--bg-card); border-radius: 10px; padding: 30px; text-align: center; color: var(--text-muted, #94A3B8); }
.fb-table-wrap { background: var(--bg-card); border-radius: 10px; box-shadow: var(--shadow-sm); overflow-x: auto; }
.fb-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 760px; }
.fb-table th { text-align: left; padding: 9px 12px; background: #F8FAFC; color: #475569; font-weight: 600; white-space: nowrap; border-bottom: 1px solid #E2E8F0; }
.fb-table td { padding: 8px 12px; border-bottom: 1px solid #F1F5F9; color: #1E293B; }
.fb-table .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.fb-table .name { max-width: 300px; }
.fb-total td { font-weight: 700; background: #F8FAFC; color: #1E293B; }
.diff-pos { color: #DC2626; font-weight: 600; }
.diff-neg { color: #16A34A; font-weight: 600; }

@media (max-width: 640px) {
  .fb-controls { width: 100%; gap: 8px; }
  .fb-date { flex: 1; }
  .fb-date-input { width: 100%; }
  .fb-bar-right { align-items: flex-start; text-align: left; }
  .fb-filters { width: 100%; gap: 10px; }
  .fb-combo { flex: 1 1 100%; }
  .fb-combo-btn { width: 100%; min-width: 0; }
  .fb-combo-panel { width: 100%; max-width: none; left: 0; }
  .fb-combo-list { max-height: 50vh; }
  .fb-ratio { width: 100%; }
  .fb-ratio-input { flex: 1; width: auto; }
  .fb-note { line-height: 1.5; }
}
</style>
