<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { fetchOverview } from '../api/monitor.js'
import { triggerSync } from '../api/monitor.js'
import MetricCard from '../components/widgets/MetricCard.vue'
import WorkshopCard from '../components/widgets/WorkshopCard.vue'
import EquipmentCard from '../components/widgets/EquipmentCard.vue'
import BarChart from '../components/charts/BarChart.vue'
import TrendLine from '../components/charts/TrendLine.vue'
import PeriodSelector from '../components/widgets/PeriodSelector.vue'

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
const availableYears = [2025, 2026]
const loading = ref(true)
const overviewData = ref(null)
const periodSelectorRef = ref(null)

// 手动同步状态
const syncing = ref(false)
const syncMsg = ref('')     // 反馈文本：'' | '同步成功' | '同步失败'
let syncTimer = null

// 自动刷新间隔（1 小时）
const AUTO_REFRESH_MS = 60 * 60 * 1000
let refreshTimer = null

// 期间选择状态：{ startDate, endDate } | null
const currentPeriod = ref(
  (route.query.startDate && route.query.endDate)
    ? { startDate: route.query.startDate, endDate: route.query.endDate }
    : null
)

const totalPower = computed(() => {
  return overviewData.value?.totalPower ?? null
})

const totalPowerCost = computed(() => {
  return overviewData.value?.totalPowerCost ?? null
})

const totalPowerCostFormatted = computed(() => {
  const cost = totalPowerCost.value
  if (cost === null || cost === undefined) return ''
  if (cost >= 10000) {
    return `¥ ${(cost / 10000).toLocaleString(undefined, { maximumFractionDigits: 2 })} 万元`
  }
  return `¥ ${cost.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
})

const remainingOrdersFormatted = computed(() => {
  const val = overviewData.value?.remainingOrders
  if (val === null || val === undefined) return ''
  return `${(val / 10000).toLocaleString(undefined, { maximumFractionDigits: 2 })} 万条`
})

const powerTrend = computed(() => {
  return overviewData.value?.powerTrend || []
})

const loadRateTrendData = computed(() => {
  return overviewData.value?.loadRateTrend || []
})

const sortedEquipmentList = computed(() => {
  const list = overviewData.value?.equipmentList || []
  return [...list].sort((a, b) => (b.output || 0) - (a.output || 0))
})

const workshopOutputData = computed(() => {
  if (!overviewData.value?.workshops) return []
  const labelMap = {
    'Y固体一1号车间': '1号',
    'Y固体一2号车间': '2号',
    'Y固体一3号车间': '3号',
    'Y固体一5号车间': '5号',
    'Y固体一6号车间': '6号',
    'Y固体一8号车间': '8号',
    'Y固体一分包间': '分包间',
    'Y固体二车间': '固体二',
    'Y液体二车间': '液体二',
  }
  return overviewData.value.workshops.map(w => ({
    label: labelMap[w.name] || w.name,
    value: w.totalOutput || 0,
  }))
})

async function loadData() {
  loading.value = true
  try {
    const { startDate, endDate } = currentPeriod.value || {}
    overviewData.value = await fetchOverview(currentDimension.value, currentYear.value, startDate, endDate)
  } catch (e) {
    console.error('[overview] 加载失败:', e)
  }
  loading.value = false
}

async function handleSync() {
  if (syncing.value) return
  syncing.value = true
  syncMsg.value = ''
  try {
    const result = await triggerSync()
    const prod = result?.sync?.production
    const pow = result?.sync?.power
    const parts = []
    if (prod?.status === 'ok') parts.push(`生产 ${prod.count} 条`)
    if (pow?.status === 'ok') parts.push('电表 OK')
    syncMsg.value = parts.length ? `同步成功 (${parts.join(', ')})` : '同步完成'
    // 成功后重新加载数据
    await loadData()
  } catch (e) {
    console.error('[overview] 同步失败:', e)
    syncMsg.value = '同步失败'
  }
  syncing.value = false
  // 3 秒后清除反馈文字
  clearTimeout(syncTimer)
  syncTimer = setTimeout(() => { syncMsg.value = '' }, 3000)
}

function onDimensionChange(dim) {
  currentDimension.value = dim
  currentPeriod.value = null
  router.replace({ query: { dimension: dim, year: currentYear.value } })
}

function onYearChange(year) {
  currentYear.value = year
  currentPeriod.value = null
  router.replace({ query: { dimension: currentDimension.value, year } })
}

function onPeriodChange(period) {
  currentPeriod.value = period
  const query = { dimension: currentDimension.value, year: currentYear.value }
  if (period) {
    query.startDate = period.startDate
    query.endDate = period.endDate
  }
  router.replace({ query })
}

function onWorkshopClick(name) {
  const query = { dimension: currentDimension.value, year: currentYear.value }
  if (currentPeriod.value) {
    query.startDate = currentPeriod.value.startDate
    query.endDate = currentPeriod.value.endDate
  }
  router.push({
    name: 'WorkshopDetail',
    params: { name },
    query,
  })
}

function onEquipmentClick(name) {
  const query = { dimension: currentDimension.value, year: currentYear.value }
  if (currentPeriod.value) {
    query.startDate = currentPeriod.value.startDate
    query.endDate = currentPeriod.value.endDate
  }
  router.push({
    name: 'EquipmentDetail',
    params: { name },
    query,
  })
}

onMounted(() => {
  loadData()
  // 启动自动刷新
  refreshTimer = setInterval(loadData, AUTO_REFRESH_MS)
  // Restore period selector from URL on mount
  if (currentPeriod.value && periodSelectorRef.value) {
    periodSelectorRef.value.setFromUrl(currentPeriod.value.startDate, currentPeriod.value.endDate)
  }
})

onBeforeUnmount(() => {
  clearTimeout(syncTimer)
  clearInterval(refreshTimer)
})

watch(currentDimension, loadData)
watch(currentYear, loadData)
watch(currentPeriod, loadData)
</script>

<template>
  <div class="overview-page">
    <!-- 顶部标题和维度切换 -->
    <div class="overview-header">
      <h2 class="page-title">工厂总览</h2>
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
        <button class="sync-btn" :class="{ syncing }" :disabled="syncing" @click="handleSync" title="手动同步">
          <svg v-if="syncing" class="sync-icon spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="2" x2="12" y2="6"/>
            <line x1="12" y1="18" x2="12" y2="22"/>
            <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/>
            <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
            <line x1="2" y1="12" x2="6" y2="12"/>
            <line x1="18" y1="12" x2="22" y2="12"/>
            <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/>
            <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
          </svg>
          <svg v-else class="sync-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"/>
            <polyline points="1 20 1 14 7 14"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
          <span class="sync-msg" v-if="syncMsg" :class="{ error: syncMsg === '同步失败' }">{{ syncMsg }}</span>
        </button>
      </div>
    </div>

    <!-- 指标卡片 -->
    <div class="metric-grid">
      <MetricCard
        title="总产量"
        :value="overviewData?.totalOutput != null ? (overviewData.totalOutput / 10000).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '--'"
        unit="万条"
        color="#1890ff"
        :subLabel="currentDimension === 'year' ? '未完成' : ''"
        :subText="currentDimension === 'year' ? remainingOrdersFormatted : ''"
      />
      <MetricCard
        title="总电量"
        :value="totalPower !== null ? totalPower.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '--'"
        unit="kWh"
        color="#f97316"
        subLabel="电费"
        :subText="totalPowerCostFormatted"
      />
      <MetricCard
        title="平均车间负载率"
        :value="overviewData?.avgLoadRate ?? '--'"
        unit="%"
        :color="(overviewData?.avgLoadRate ?? 0) >= 85 ? '#52c41a' : (overviewData?.avgLoadRate ?? 0) >= 70 ? '#faad14' : '#ff4d4f'"
      />
      <MetricCard
        title="平均产出率"
        :value="overviewData?.avgOutputRate ?? '--'"
        unit="%"
        :color="(overviewData?.avgOutputRate ?? 0) >= 85 ? '#52c41a' : (overviewData?.avgOutputRate ?? 0) >= 70 ? '#faad14' : '#ff4d4f'"
      />
      <MetricCard
        title="平均OEE"
        :value="overviewData?.avgOEE ?? '--'"
        unit="%"
        color="#722ed1"
      />
    </div>

    <!-- 车间卡片网格 -->
    <section class="section">
      <h3 class="section-title">车间概览</h3>
      <div v-if="loading" class="skeleton-section">
        <div class="skeleton-metric-grid">
          <div v-for="i in 4" :key="'m'+i" class="skeleton-card skeleton-metric"></div>
        </div>
        <div class="skeleton-workshop-grid">
          <div v-for="i in 9" :key="'w'+i" class="skeleton-card skeleton-workshop"></div>
        </div>
        <div class="skeleton-chart-row">
          <div class="skeleton-card skeleton-chart"></div>
          <div class="skeleton-card skeleton-chart"></div>
        </div>
        <div class="skeleton-chart-row">
          <div class="skeleton-card skeleton-chart"></div>
        </div>
      </div>
      <div v-else class="workshop-grid">
        <WorkshopCard
          v-for="ws in overviewData?.workshops || []"
          :key="ws.name"
          :name="ws.name"
          :area="ws.area"
          :output-rate="ws.outputRate"
          :total-output="ws.totalOutput"
          :load-rate="ws.loadRate"
          :status="ws.status"
          :power="ws.power"
          :power-cost="ws.powerCost"
          @click="onWorkshopClick(ws.name)"
        />
      </div>
    </section>

    <!-- 设备列表卡片 -->
    <section class="section equipment-section">
      <h3 class="section-title">设备列表</h3>
      <div v-if="loading" class="skeleton-equipment-grid">
        <div v-for="i in 8" :key="'eq'+i" class="skeleton-card skeleton-equipment"></div>
      </div>
      <div v-else class="equipment-grid">
        <EquipmentCard
          v-for="eq in sortedEquipmentList"
          :key="eq.name"
          :name="eq.name"
          :type="eq.type"
          :output="eq.output"
          :output-rate="eq.outputRate"
          :load-rate="eq.loadRate"
          :total-load-hours="eq.totalLoadHours"
          :oee="eq.oee"
          :status="eq.status"
          :lanes="eq.lanes"
          :design-speed="eq.designSpeed"
          @click="onEquipmentClick(eq.name)"
        />
      </div>
    </section>

    <!-- 底部图表 -->
    <div class="chart-row">
      <div class="chart-col">
        <BarChart
          :data="overviewData?.outputTrend || []"
          title="全厂产量趋势"
          :height="320"
          bar-color="#1890ff"
        />
      </div>
      <div class="chart-col">
        <BarChart
          :data="workshopOutputData"
          title="各车间产出数量"
          :height="320"
          :colors="['#5470c6','#91cc75','#fac858','#ee6666','#73c0de','#3ba272','#fc8452','#9a60b4','#ea7ccc']"
        />
      </div>
    </div>

    <div class="chart-row">
      <div class="chart-col chart-full">
        <TrendLine
          :data="loadRateTrendData"
          title="平均车间负载率趋势"
          :height="300"
          :target-line="85"
          line-color="#1890ff"
        />
      </div>
    </div>

    <!-- 用电量趋势图 -->
    <div v-if="powerTrend.length > 0" class="chart-row">
      <div class="chart-col chart-full">
        <TrendLine
          :data="powerTrend"
          title="全厂用电量趋势"
          :height="300"
          line-color="#1890ff"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.overview-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.overview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
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

.year-select:focus {
  border-color: var(--primary, #3B82F6);
}

.dimension-switcher {
  display: flex;
  gap: 4px;
  background: var(--bg-card);
  border-radius: var(--radius-sm);
  padding: 3px;
  box-shadow: var(--shadow-sm);
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

.dim-btn:hover {
  color: var(--primary-light);
}

.dim-btn.active {
  background: var(--primary);
  color: #fff;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 16px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 12px;
}

.workshop-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

/* 设备列表 */
.equipment-section {
  margin-top: 4px;
}

.equipment-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
}

.skeleton-equipment-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
}

.skeleton-equipment {
  height: 210px;
}

.chart-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.chart-col {
  min-width: 0;
}

.chart-col.chart-full {
  grid-column: 1 / -1;
}

/* ===== 骨架屏 ===== */

.skeleton-section {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.skeleton-metric-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 16px;
}

.skeleton-workshop-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.skeleton-chart-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.skeleton-card {
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 8px;
}

.skeleton-metric {
  height: 100px;
}

.skeleton-workshop {
  height: 130px;
}

.skeleton-chart {
  height: 340px;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

@media (max-width: 1200px) {
  .skeleton-metric-grid { grid-template-columns: repeat(3, 1fr); }
  .skeleton-workshop-grid { grid-template-columns: repeat(2, 1fr); }
  .skeleton-chart-row { grid-template-columns: 1fr; }
}

@media (max-width: 768px) {
  .overview-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }
  .header-controls {
    flex-wrap: wrap;
    gap: 6px;
    width: 100%;
  }
  .page-title {
    font-size: 16px;
  }
  .dim-btn {
    padding: 6px 10px;
    font-size: 12px;
  }
  .year-select {
    font-size: 12px;
    padding: 4px 6px;
  }
  .skeleton-metric-grid { grid-template-columns: 1fr; }
  .skeleton-workshop-grid { grid-template-columns: 1fr; }
}

@media (max-width: 768px) {
  .metric-grid { grid-template-columns: 1fr; }
  .workshop-grid { grid-template-columns: 1fr; }
}

@media (max-width: 768px) {
  .equipment-grid { grid-template-columns: 1fr; }
  .skeleton-equipment-grid { grid-template-columns: 1fr; }
}

/* 同步按钮 */
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
.sync-msg {
  font-size: 12px;
  color: #22C55E;
  font-weight: 500;
}
.sync-msg.error {
  color: #EF4444;
}
</style>
