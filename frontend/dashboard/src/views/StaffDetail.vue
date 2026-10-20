<script setup>
/**
 * 人员明细：某个人在所选区间内，按 客户 / 设备 / 剂型 三个维度拆开的产量表现
 *
 * 三个维度里每一行都是「该维度下这一组」的聚合，口径与列表页、生产看板完全一致
 * （产量/不合格品数求和；合格率、OEE 按产量加权平均；达产率 = Σ产量÷Σ目标）。
 * 所以每个维度的产量加总都等于顶上那张卡的个人总额。
 */
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { fetchStaffDetail } from '../api/monitor.js'
import MetricCard from '../components/widgets/MetricCard.vue'
import PeriodSelector from '../components/widgets/PeriodSelector.vue'
import { getAvailableYears } from '../utils/years'

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
const detail = ref(null)
const periodSelectorRef = ref(null)

const operatorName = computed(() => String(route.params.name || ''))
const total = computed(() => (detail.value && detail.value.total) || {})
const byCustomer = computed(() => (detail.value && detail.value.byCustomer) || [])
const byMachine = computed(() => (detail.value && detail.value.byMachine) || [])
const byDosage = computed(() => (detail.value && detail.value.byDosage) || [])

function fmtN(v, digits) {
  if (v == null || v === '') return '—'
  const n = Number(v)
  return digits ? n.toFixed(digits) : n.toLocaleString()
}
function rateClass(v) {
  if (v == null) return ''
  return v >= 95 ? 'sd-good' : v >= 85 ? 'sd-mid' : 'sd-bad'
}

const cards = computed(() => {
  const t = total.value
  return [
    { title: '产量', value: fmtN(t.actualQty), unit: '条', color: '#1E40AF', subLabel: '报工', subText: `${fmtN(t.rowCount)} 条 / ${fmtN(t.dayCount)} 天` },
    { title: '不合格品数', value: fmtN(t.defectQty), unit: '条', color: '#DC2626', subLabel: '涉及设备', subText: `${fmtN(t.machineCount)} 台` },
    { title: '合格率', value: fmtN(t.qualifyRate, 1), unit: '%', color: '#16A34A', subLabel: '按产量加权', subText: `产品 ${fmtN(t.productCount)} 种` },
    { title: 'OEE', value: fmtN(t.oee, 1), unit: '%', color: '#7C3AED', subLabel: '按产量加权', subText: `订单 ${fmtN(t.moCount)} 个` },
    { title: '达产率', value: fmtN(t.rate, 1), unit: '%', color: '#EA580C', subLabel: 'Σ产量÷Σ目标', subText: `目标 ${fmtN(t.targetQty)}` },
  ]
})

async function loadData() {
  loading.value = true
  try {
    const { startDate, endDate } = currentPeriod.value || {}
    detail.value = await fetchStaffDetail(operatorName.value, currentDimension.value, currentYear.value, startDate, endDate)
  } catch (e) {
    console.error('[staff] 明细加载失败:', e)
    detail.value = null
  }
  loading.value = false
}

function onDimensionChange(dim) {
  currentDimension.value = dim
  currentPeriod.value = null
  loadData()
}
function onYearChange(y) {
  currentYear.value = y
  currentPeriod.value = null
  loadData()
}
function onPeriodChange(period) {
  currentPeriod.value = period
  loadData()
}

onMounted(() => {
  loadData()
  if (currentPeriod.value && periodSelectorRef.value) {
    periodSelectorRef.value.setFromUrl(currentPeriod.value.startDate, currentPeriod.value.endDate)
  }
})
watch(() => route.params.name, loadData)
</script>

<template>
  <div class="sd-page">
    <!-- 标题 + 维度切换 -->
    <div class="sd-header">
      <div class="sd-title-wrap">
        <h2 class="sd-title">{{ operatorName }}</h2>
        <span v-if="detail && (detail.position || detail.skillLevel)" class="sd-badge">
          {{ detail.position || '岗位未填' }}
          <template v-if="detail.skillLevel"> · {{ detail.skillLevel }}</template>
        </span>
        <span v-else class="sd-badge sd-badge-muted">岗位 / 技能等级未填（回列表页点单元格可改）</span>
      </div>
      <div class="sd-controls">
        <select class="sd-year" :value="currentYear" @change="onYearChange(Number($event.target.value))">
          <option v-for="y in availableYears" :key="y" :value="y">{{ y }} 年</option>
        </select>
        <PeriodSelector
          ref="periodSelectorRef"
          :dimension="currentDimension"
          :year="currentYear"
          @update:period="onPeriodChange"
        />
        <div class="sd-switcher">
          <button
            v-for="d in dimensions"
            :key="d.value"
            :class="['sd-dim-btn', { active: currentDimension === d.value }]"
            @click="onDimensionChange(d.value)"
          >{{ d.label }}</button>
        </div>
      </div>
    </div>

    <div class="sd-note">
      口径与生产看板一致：产量/不合格品数/工时求和（工时 = 正式工工时），合格率与 OEE 按产量加权平均，达产率 = Σ产量 ÷ Σ目标 ｜
      每张表按产量从大到小排 ｜ 客户由订单号反查金蝶销售订单得到，剂型来自产品在 BD_MATERIAL 里的物料分组（固体/液体）
    </div>

    <div v-if="loading" class="sd-skeleton">
      <div class="sd-sk-bar"></div><div class="sd-sk-bar"></div><div class="sd-sk-bar"></div>
    </div>

    <template v-else-if="detail">
      <div class="sd-cards">
        <MetricCard
          v-for="c in cards"
          :key="c.title"
          :title="c.title" :value="c.value" :unit="c.unit" :color="c.color"
          :sub-label="c.subLabel" :sub-text="c.subText"
        />
      </div>

      <!-- 三个维度 -->
      <section v-for="dim in [
        { key: 'customer', title: '客户维度', rows: byCustomer, col: '客户' },
        { key: 'machine', title: '设备维度', rows: byMachine, col: '设备' },
        { key: 'dosage', title: '剂型维度', rows: byDosage, col: '剂型' },
      ]" :key="dim.key" class="sd-section">
        <h3 class="sd-section-title">
          {{ dim.title }}
          <span class="sd-section-sub">{{ dim.rows.length }} 项 · 产量 {{ fmtN(dim.rows.reduce((s, x) => s + (x.actualQty || 0), 0)) }}</span>
        </h3>
        <div class="sd-table-wrap">
          <table class="sd-table">
            <thead>
              <tr>
                <th>{{ dim.col }}</th>
                <th class="num">产量</th>
                <th class="num">不合格品数</th>
                <th class="num">合格率</th>
                <th class="num">OEE</th>
                <th class="num">达产率</th>
                <th class="num">工时</th>
                <th class="num">报工数</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="x in dim.rows" :key="x.key">
                <td class="sd-key" :title="x.key">{{ x.key }}</td>
                <td class="num sd-strong">{{ fmtN(x.actualQty) }}</td>
                <td class="num">{{ fmtN(x.defectQty) }}</td>
                <td class="num" :class="rateClass(x.qualifyRate)">{{ fmtN(x.qualifyRate, 1) }}<span v-if="x.qualifyRate != null" class="sd-unit">%</span></td>
                <td class="num" :class="rateClass(x.oee)">{{ fmtN(x.oee, 1) }}<span v-if="x.oee != null" class="sd-unit">%</span></td>
                <td class="num" :class="rateClass(x.rate)">{{ fmtN(x.rate, 1) }}<span v-if="x.rate != null" class="sd-unit">%</span></td>
                <td class="num">{{ fmtN(x.hours, 1) }}</td>
                <td class="num sd-muted">{{ x.rowCount }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr class="sd-total">
                <td>合计</td>
                <td class="num">{{ fmtN(total.actualQty) }}</td>
                <td class="num">{{ fmtN(total.defectQty) }}</td>
                <td class="num" :class="rateClass(total.qualifyRate)">{{ fmtN(total.qualifyRate, 1) }}<span v-if="total.qualifyRate != null" class="sd-unit">%</span></td>
                <td class="num" :class="rateClass(total.oee)">{{ fmtN(total.oee, 1) }}<span v-if="total.oee != null" class="sd-unit">%</span></td>
                <td class="num" :class="rateClass(total.rate)">{{ fmtN(total.rate, 1) }}<span v-if="total.rate != null" class="sd-unit">%</span></td>
                <td class="num">{{ fmtN(total.hours, 1) }}</td>
                <td class="num sd-muted">{{ total.rowCount }}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </template>

    <div v-else-if="!loading" class="sd-empty">该区间内没有这个人的报工记录</div>
  </div>
</template>

<style scoped>
.sd-page { display: flex; flex-direction: column; gap: 14px; }
.sd-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
.sd-title-wrap { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.sd-title { font-size: 18px; font-weight: 600; color: var(--text-primary); margin: 0; }
.sd-badge {
  font-size: 12px; padding: 2px 10px; border-radius: 10px;
  background: #EFF6FF; color: #1E40AF; white-space: nowrap;
}
.sd-badge-muted { background: #F1F5F9; color: #94A3B8; }
.sd-controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.sd-year {
  padding: 4px 10px; border: 1px solid var(--border-color, #E2E8F0); border-radius: 6px;
  font-size: 13px; color: var(--text-primary); background: var(--bg-card); cursor: pointer; outline: none;
}
.sd-switcher { display: inline-flex; border: 1px solid var(--border-color, #E2E8F0); border-radius: 6px; overflow: hidden; background: var(--bg-card); }
.sd-dim-btn {
  padding: 5px 12px; border: none; background: transparent; cursor: pointer;
  font-size: 13px; color: var(--text-secondary, #64748B); border-right: 1px solid var(--border-color, #E2E8F0);
}
.sd-dim-btn:last-child { border-right: none; }
.sd-dim-btn.active { background: var(--primary, #3B82F6); color: #fff; font-weight: 600; }
.sd-note { font-size: 12px; color: var(--text-muted, #94A3B8); line-height: 1.8; }
.sd-cards { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }
.sd-skeleton { display: flex; flex-direction: column; gap: 8px; background: var(--bg-card); border-radius: 10px; padding: 16px; }
.sd-sk-bar { height: 18px; border-radius: 4px; background: linear-gradient(90deg, #F1F5F9 25%, #E2E8F0 37%, #F1F5F9 63%); background-size: 400% 100%; animation: sd-shimmer 1.4s ease infinite; }
@keyframes sd-shimmer { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }
.sd-empty { background: var(--bg-card); border-radius: 10px; padding: 30px; text-align: center; color: var(--text-muted, #94A3B8); }
.sd-section { display: flex; flex-direction: column; gap: 8px; }
.sd-section-title { font-size: 14px; font-weight: 600; color: var(--text-primary); margin: 0; display: flex; align-items: baseline; gap: 10px; }
.sd-section-sub { font-size: 12px; font-weight: 400; color: var(--text-muted, #94A3B8); }
.sd-table-wrap { background: var(--bg-card); border-radius: 10px; box-shadow: var(--shadow-sm); overflow-x: auto; }
.sd-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 840px; }
.sd-table th { text-align: left; padding: 9px 12px; background: #F8FAFC; color: #475569; font-weight: 600; white-space: nowrap; border-bottom: 1px solid #E2E8F0; }
.sd-table td { padding: 8px 12px; border-bottom: 1px solid #F1F5F9; color: #1E293B; }
.sd-table .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.sd-key { max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sd-strong { font-weight: 700; }
.sd-muted { color: #94A3B8; }
.sd-unit { font-size: 11px; color: #94A3B8; margin-left: 1px; }
.sd-total td { font-weight: 700; background: #F8FAFC; color: #1E293B; }
.sd-good { color: #16A34A; font-weight: 600; }
.sd-mid { color: #D97706; font-weight: 600; }
.sd-bad { color: #DC2626; font-weight: 700; }

@media (max-width: 1024px) {
  .sd-cards { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 640px) {
  .sd-controls { width: 100%; }
  .sd-cards { grid-template-columns: 1fr 1fr; gap: 8px; }
  .sd-note { line-height: 1.9; }
}
</style>
