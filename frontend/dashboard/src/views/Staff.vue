<script setup>
/**
 * 人员看板
 *
 * 数据全部来自生产看板的班次行（按人重新聚合），口径与看板一致：
 *   产量/不合格品数 = 求和；合格率/OEE = 按产量加权平均；达产率 = Σ产量÷Σ目标
 *
 * ⚠️ 两个必须让人看见的口径（页面上有说明）：
 *  1. 一行报工有多个操作工时，**每个人都算全额** → 全员产量之和 > 实际总产量
 *  2. 没填操作工的报工（`——`）归不到任何人 → 实际总产量里有一部分「未归属」
 */
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { fetchStaff, fetchStaffOptions, saveStaffMeta } from '../api/monitor.js'
import MetricCard from '../components/widgets/MetricCard.vue'
import PeriodSelector from '../components/widgets/PeriodSelector.vue'
import StaffTabs from '../components/widgets/StaffTabs.vue'
import { getAvailableYears } from '../utils/years'

const router = useRouter()
const route = useRoute()

const dimensions = [
  { label: '日', value: 'day' },
  { label: '周', value: 'week' },
  { label: '月', value: 'month' },
  { label: '年', value: 'year' },
]
const currentDimension = ref(route.query.dimension || 'month')
const currentYear = ref(parseInt(route.query.year) || new Date().getFullYear())
const availableYears = getAvailableYears()
const currentPeriod = ref(
  route.query.startDate && route.query.endDate
    ? { startDate: route.query.startDate, endDate: route.query.endDate }
    : null,
)

const loading = ref(true)
const data = ref(null)
const rows = computed(() => (data.value && data.value.rows) || [])
const summary = computed(() => (data.value && data.value.summary) || {})
const periodSelectorRef = ref(null)

// 岗位 / 技能等级的可选项
const options = ref({ positions: [], skillLevels: [] })

function fmtN(v, digits) {
  if (v == null || v === '') return '—'
  const n = Number(v)
  return digits ? n.toFixed(digits) : n.toLocaleString()
}
function rateClass(v) {
  if (v == null) return ''
  return v >= 95 ? 'sf-good' : v >= 85 ? 'sf-mid' : 'sf-bad'
}

// ====== 岗位 / 技能等级：点一下变下拉，改完即存（乐观更新，失败回滚）======
const editing = ref(null) // { operator, field }
const saving = ref(false)
const savedKey = ref('')
let flashTimer = null

function startEdit(r, field) {
  if (saving.value) return
  editing.value = { operator: r.operator, field }
}
function cancelEdit() {
  editing.value = null
}
async function commitEdit(r, field, value) {
  if (!editing.value) return
  const prev = r[field]
  editing.value = null
  if (value === prev) return
  r[field] = value // 乐观更新
  saving.value = true
  try {
    await saveStaffMeta(r.operator, { position: r.position, skillLevel: r.skillLevel })
    savedKey.value = `${r.operator}|${field}`
    clearTimeout(flashTimer)
    flashTimer = setTimeout(() => { savedKey.value = '' }, 2000)
  } catch (e) {
    console.error('[staff] 保存失败:', e)
    r[field] = prev // 回滚
  }
  saving.value = false
}

// ====== 排序（复用呆滞成品的做法：文本列升序优先，数值列降序优先，空值恒排最后）======
const TEXT_KEYS = new Set(['operator', 'position', 'skillLevel'])
const sortKey = ref('actualQty')
const sortDir = ref('desc')
const sortedRows = computed(() => {
  const dir = sortDir.value === 'asc' ? 1 : -1
  const k = sortKey.value
  return [...rows.value].sort((a, b) => {
    const va = a[k]
    const vb = b[k]
    if (TEXT_KEYS.has(k)) {
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
    if (na == null) return 1
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
  return sortDir.value === 'asc' ? 'sf-sorted sf-asc' : 'sf-sorted sf-desc'
}

// ====== 汇总卡 ======
const cards = computed(() => {
  const s = summary.value
  return [
    { title: '在岗人员', value: fmtN(s.staffCount), unit: '人', color: '#1E40AF', subLabel: '参与报工的', subText: `${fmtN(s.rowCount)} 条报工` },
    { title: '实际总产量', value: fmtN(s.totalActualQty), unit: '条', color: '#0891B2', subLabel: '未归属', subText: `${fmtN(s.unattributedRows)} 条报工没填操作工` },
    { title: '平均合格率', value: fmtN(s.avgQualifyRate, 1), unit: '%', color: '#16A34A', subLabel: '按产量加权', subText: `不合格 ${fmtN(s.totalDefectQty)} 条` },
    { title: '平均 OEE', value: fmtN(s.avgOee, 1), unit: '%', color: '#7C3AED', subLabel: '按产量加权', subText: '与生产看板同口径' },
    { title: '平均达产率', value: fmtN(s.avgRate, 1), unit: '%', color: '#EA580C', subLabel: '整体', subText: `目标 ${fmtN(s.totalTargetQty)}` },
  ]
})

async function loadData() {
  loading.value = true
  try {
    const { startDate, endDate } = currentPeriod.value || {}
    data.value = await fetchStaff(currentDimension.value, currentYear.value, startDate, endDate)
  } catch (e) {
    console.error('[staff] 加载失败:', e)
    data.value = null
  }
  loading.value = false
}

function onDimensionChange(dim) {
  currentDimension.value = dim
  currentPeriod.value = null
  router.replace({ query: { dimension: dim, year: currentYear.value } })
  loadData()
}
function onYearChange(y) {
  currentYear.value = y
  currentPeriod.value = null
  router.replace({ query: { dimension: currentDimension.value, year: y } })
  loadData()
}
function onPeriodChange(period) {
  currentPeriod.value = period
  const query = { dimension: currentDimension.value, year: currentYear.value }
  if (period) {
    query.startDate = period.startDate
    query.endDate = period.endDate
  }
  router.replace({ query })
  loadData()
}
function openDetail(r) {
  router.push({
    name: 'StaffDetail',
    params: { name: r.operator },
    query: { dimension: currentDimension.value, year: currentYear.value, ...(currentPeriod.value || {}) },
  })
}

onMounted(async () => {
  try { options.value = await fetchStaffOptions() } catch (e) { console.error('[staff] 选项加载失败:', e) }
  loadData()
  if (currentPeriod.value && periodSelectorRef.value) {
    periodSelectorRef.value.setFromUrl(currentPeriod.value.startDate, currentPeriod.value.endDate)
  }
})
</script>

<template>
  <div class="sf-page">
    <StaffTabs />

    <!-- 标题 + 维度切换 -->
    <div class="sf-header">
      <h2 class="sf-title">人员</h2>
      <div class="sf-controls">
        <select class="sf-year" :value="currentYear" @change="onYearChange(Number($event.target.value))">
          <option v-for="y in availableYears" :key="y" :value="y">{{ y }} 年</option>
        </select>
        <PeriodSelector
          ref="periodSelectorRef"
          :dimension="currentDimension"
          :year="currentYear"
          @update:period="onPeriodChange"
        />
        <div class="sf-switcher">
          <button
            v-for="d in dimensions"
            :key="d.value"
            :class="['sf-dim-btn', { active: currentDimension === d.value }]"
            @click="onDimensionChange(d.value)"
          >{{ d.label }}</button>
        </div>
      </div>
    </div>

    <!-- 口径说明 -->
    <div class="sf-note">
      人员来自生产看板的报工记录（金蝶 + MES）｜ 产量/不合格品数/工时按人求和（<b>工时 = 正式工工时</b>），合格率与 OEE 按产量加权平均，达产率 = Σ产量 ÷ Σ目标 ｜
      <b>一行报工有多个操作工时，每个人都算全额</b>，所以「人员产量之和」会大于「实际总产量」（本期重复计
      <b>{{ fmtN(summary.doubleCountedQty) }}</b> 条）；
      另有 <b>{{ fmtN(summary.unattributedRows) }}</b> 条报工没填操作工、<b>{{ fmtN(summary.unattributedQty) }}</b> 条产量未归属到人 ｜
      岗位与技能等级可点击单元格直接修改
    </div>

    <div v-if="loading" class="sf-skeleton">
      <div class="sf-sk-bar"></div><div class="sf-sk-bar"></div><div class="sf-sk-bar"></div>
    </div>

    <template v-else-if="rows.length">
      <!-- 汇总卡 -->
      <div class="sf-cards">
        <MetricCard
          v-for="c in cards"
          :key="c.title"
          :title="c.title" :value="c.value" :unit="c.unit" :color="c.color"
          :sub-label="c.subLabel" :sub-text="c.subText"
        />
      </div>

      <!-- 明细表 -->
      <div class="sf-table-wrap">
        <table class="sf-table">
          <thead>
            <tr>
              <th class="sf-idx">序号</th>
              <th class="sf-sortable" :class="sortClass('operator')" @click="toggleSort('operator')">人员<i class="sf-arrow"></i></th>
              <th class="sf-sortable" :class="sortClass('position')" @click="toggleSort('position')">岗位<i class="sf-arrow"></i></th>
              <th class="sf-sortable" :class="sortClass('skillLevel')" @click="toggleSort('skillLevel')">技能等级<i class="sf-arrow"></i></th>
              <th class="num sf-sortable" :class="sortClass('actualQty')" @click="toggleSort('actualQty')">产量<i class="sf-arrow"></i></th>
              <th class="num sf-sortable" :class="sortClass('defectQty')" @click="toggleSort('defectQty')">不合格品数<i class="sf-arrow"></i></th>
              <th class="num sf-sortable" :class="sortClass('qualifyRate')" @click="toggleSort('qualifyRate')">合格率<i class="sf-arrow"></i></th>
              <th class="num sf-sortable" :class="sortClass('oee')" @click="toggleSort('oee')">OEE<i class="sf-arrow"></i></th>
              <th class="num sf-sortable" :class="sortClass('rate')" @click="toggleSort('rate')">达产率<i class="sf-arrow"></i></th>
              <th class="num sf-sortable" :class="sortClass('hours')" @click="toggleSort('hours')">工时<i class="sf-arrow"></i></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in sortedRows" :key="r.operator" class="sf-row">
              <td class="sf-idx">{{ i + 1 }}</td>
              <td class="sf-name">
                <a class="sf-link" @click="openDetail(r)">{{ r.operator }}</a>
              </td>

              <!-- 岗位：点击变下拉 -->
              <td class="sf-edit-cell">
                <select
                  v-if="editing && editing.operator === r.operator && editing.field === 'position'"
                  class="sf-select"
                  :value="r.position"
                  @change="commitEdit(r, 'position', $event.target.value)"
                  @blur="cancelEdit"
                  @click.stop
                >
                  <option value="">（未填）</option>
                  <option v-for="p in options.positions" :key="p" :value="p">{{ p }}</option>
                </select>
                <span
                  v-else
                  class="sf-edit-text"
                  :class="{ 'sf-saved': savedKey === r.operator + '|position' }"
                  @click.stop="startEdit(r, 'position')"
                >{{ r.position || '—' }}</span>
              </td>

              <!-- 技能等级 -->
              <td class="sf-edit-cell">
                <select
                  v-if="editing && editing.operator === r.operator && editing.field === 'skillLevel'"
                  class="sf-select"
                  :value="r.skillLevel"
                  @change="commitEdit(r, 'skillLevel', $event.target.value)"
                  @blur="cancelEdit"
                  @click.stop
                >
                  <option value="">（未填）</option>
                  <option v-for="s in options.skillLevels" :key="s" :value="s">{{ s }}</option>
                </select>
                <span
                  v-else
                  class="sf-edit-text"
                  :class="{ 'sf-saved': savedKey === r.operator + '|skillLevel' }"
                  @click.stop="startEdit(r, 'skillLevel')"
                >{{ r.skillLevel || '—' }}</span>
              </td>

              <td class="num sf-strong">{{ fmtN(r.actualQty) }}</td>
              <td class="num">{{ fmtN(r.defectQty) }}</td>
              <td class="num" :class="rateClass(r.qualifyRate)">{{ fmtN(r.qualifyRate, 1) }}<span v-if="r.qualifyRate != null" class="sf-unit">%</span></td>
              <td class="num" :class="rateClass(r.oee)">{{ fmtN(r.oee, 1) }}<span v-if="r.oee != null" class="sf-unit">%</span></td>
              <td class="num" :class="rateClass(r.rate)">{{ fmtN(r.rate, 1) }}<span v-if="r.rate != null" class="sf-unit">%</span></td>
              <td class="num">{{ fmtN(r.hours, 1) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <div v-else-if="!loading" class="sf-empty">所选范围内没有报工记录</div>
  </div>
</template>

<style scoped>
.sf-page { display: flex; flex-direction: column; gap: 14px; }
.sf-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
.sf-title { font-size: 18px; font-weight: 600; color: var(--text-primary); margin: 0; }
.sf-controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.sf-year {
  padding: 4px 10px; border: 1px solid var(--border-color, #E2E8F0); border-radius: 6px;
  font-size: 13px; color: var(--text-primary); background: var(--bg-card); cursor: pointer; outline: none;
}
.sf-switcher { display: inline-flex; border: 1px solid var(--border-color, #E2E8F0); border-radius: 6px; overflow: hidden; background: var(--bg-card); }
.sf-dim-btn {
  padding: 5px 12px; border: none; background: transparent; cursor: pointer;
  font-size: 13px; color: var(--text-secondary, #64748B); border-right: 1px solid var(--border-color, #E2E8F0);
}
.sf-dim-btn:last-child { border-right: none; }
.sf-dim-btn.active { background: var(--primary, #3B82F6); color: #fff; font-weight: 600; }
.sf-note { font-size: 12px; color: var(--text-muted, #94A3B8); line-height: 1.8; }
.sf-cards { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }
.sf-skeleton { display: flex; flex-direction: column; gap: 8px; background: var(--bg-card); border-radius: 10px; padding: 16px; }
.sf-sk-bar { height: 18px; border-radius: 4px; background: linear-gradient(90deg, #F1F5F9 25%, #E2E8F0 37%, #F1F5F9 63%); background-size: 400% 100%; animation: sf-shimmer 1.4s ease infinite; }
@keyframes sf-shimmer { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }
.sf-empty { background: var(--bg-card); border-radius: 10px; padding: 30px; text-align: center; color: var(--text-muted, #94A3B8); }
.sf-table-wrap { background: var(--bg-card); border-radius: 10px; box-shadow: var(--shadow-sm); overflow-x: auto; }
.sf-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 1020px; }
.sf-table th { text-align: left; padding: 9px 12px; background: #F8FAFC; color: #475569; font-weight: 600; white-space: nowrap; border-bottom: 1px solid #E2E8F0; }
.sf-table td { padding: 8px 12px; border-bottom: 1px solid #F1F5F9; color: #1E293B; }
.sf-table .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.sf-idx { width: 52px; color: #94A3B8; }
.sf-row:hover { background: #F8FAFC; }
.sf-name { font-weight: 600; white-space: nowrap; }
.sf-link { color: var(--primary, #3B82F6); cursor: pointer; text-decoration: none; }
.sf-link:hover { text-decoration: underline; }
.sf-strong { font-weight: 700; }
.sf-unit { font-size: 11px; color: #94A3B8; margin-left: 1px; }
.sf-good { color: #16A34A; font-weight: 600; }
.sf-mid { color: #D97706; font-weight: 600; }
.sf-bad { color: #DC2626; font-weight: 700; }
/* 可排序表头 */
.sf-sortable { cursor: pointer; user-select: none; }
.sf-sortable:hover { color: var(--primary, #3B82F6); }
.sf-arrow {
  display: inline-block; margin-left: 4px; vertical-align: middle;
  width: 0; height: 0; opacity: .18;
  border-left: 3.5px solid transparent; border-right: 3.5px solid transparent;
  border-bottom: 4.5px solid currentColor;
}
.sf-sorted .sf-arrow { opacity: 1; }
.sf-asc .sf-arrow { border-bottom: 4.5px solid currentColor; border-top: none; }
.sf-desc .sf-arrow { border-bottom: none; border-top: 4.5px solid currentColor; }
/* 岗位/技能等级行内编辑 */
.sf-edit-cell { white-space: nowrap; }
.sf-edit-text {
  display: inline-block; min-width: 44px; padding: 3px 6px; border-radius: 5px;
  cursor: pointer; border: 1px dashed transparent; min-height: 22px;
}
.sf-edit-text:hover { border-color: var(--border-color, #E2E8F0); background: #F8FAFC; }
.sf-edit-text.sf-saved { background: #DCFCE7; border-color: #86EFAC; }
.sf-select {
  min-height: 30px; padding: 3px 6px; border: 1px solid var(--primary, #3B82F6); border-radius: 5px;
  font-size: 13px; color: var(--text-primary); background: var(--bg-card); outline: none;
}

@media (max-width: 1024px) {
  .sf-cards { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 640px) {
  .sf-controls { width: 100%; }
  .sf-cards { grid-template-columns: 1fr 1fr; gap: 8px; }
  .sf-note { line-height: 1.9; }
  .sf-select { min-height: 40px; }
  .sf-edit-text { min-height: 32px; line-height: 24px; }
}
</style>
