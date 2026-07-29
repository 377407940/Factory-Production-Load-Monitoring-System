<script setup>
import { ref, onMounted, watch, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { fetchEquipmentDetail } from '../api/monitor.js'
import MetricCard from '../components/widgets/MetricCard.vue'
import TrendLine from '../components/charts/TrendLine.vue'
import BarChart from '../components/charts/BarChart.vue'
import PeriodSelector from '../components/widgets/PeriodSelector.vue'

const chartColors = ['#1890ff', '#52c41a', '#faad14', '#ff4d4f', '#722ed1', '#13c2c2', '#eb2f96', '#fa8c16']

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
const detailData = ref(null)
const periodSelectorRef = ref(null)

const currentPeriod = ref(
  (route.query.startDate && route.query.endDate)
    ? { startDate: route.query.startDate, endDate: route.query.endDate }
    : null
)

const equipmentName = computed(() => route.params.name)

async function loadData() {
  loading.value = true
  try {
    const { startDate, endDate } = currentPeriod.value || {}
    detailData.value = await fetchEquipmentDetail(equipmentName.value, currentDimension.value, currentYear.value, startDate, endDate)
  } catch (e) {
    console.error('[equipment] 加载失败:', e)
  }
  loading.value = false
}

function onDimensionChange(dim) {
  currentDimension.value = dim
  currentPeriod.value = null
  router.replace({ query: { ...route.query, dimension: dim } })
}

function onYearChange(year) {
  currentYear.value = year
  currentPeriod.value = null
  router.replace({ query: { ...route.query, year } })
}

function onPeriodChange(period) {
  currentPeriod.value = period
  const query = { ...route.query }
  if (period) {
    query.startDate = period.startDate
    query.endDate = period.endDate
  } else {
    delete query.startDate
    delete query.endDate
  }
  router.replace({ query })
}

// 产量为0的车间不展示
const visibleWorkshopBreakdown = computed(() => {
  return (detailData.value?.workshopBreakdown || []).filter(ws => ws.totalOutput > 0)
})

// 分车间多系列趋势（仅在有多个车间时启用）
const wsOutputTrendSeries = computed(() => {
  const bd = visibleWorkshopBreakdown.value
  if (!bd || bd.length < 2) return null
  return bd.map((ws, i) => ({
    name: ws.workshop,
    data: ws.outputTrend || [],
    color: chartColors[i % chartColors.length],
  }))
})
const wsLoadRateTrendSeries = computed(() => {
  const bd = visibleWorkshopBreakdown.value
  if (!bd || bd.length < 2) return null
  return bd.map((ws, i) => ({
    name: ws.workshop,
    data: ws.loadRateTrend || [],
    color: chartColors[i % chartColors.length],
  }))
})

onMounted(() => {
  loadData()
  if (currentPeriod.value && periodSelectorRef.value) {
    periodSelectorRef.value.setFromUrl(currentPeriod.value.startDate, currentPeriod.value.endDate)
  }
})

watch(currentDimension, loadData)
watch(currentYear, loadData)
watch(currentPeriod, loadData)
watch(
  () => route.params.name,
  () => {
    loadData()
  }
)
</script>

<template>
  <div class="equipment-detail-page">
    <!-- 顶部标题和维度切换 -->
    <div class="detail-header">
      <h2 class="page-title">{{ equipmentName }}</h2>
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
      </div>
    </div>

    <!-- 指标卡片 -->
    <div class="metric-grid">
      <MetricCard
        title="实际产量"
        :value="detailData?.actualOutput?.toLocaleString() || '--'"
        unit="条"
        color="#1890ff"
      />
      <MetricCard
        title="设备负荷率"
        :value="detailData?.loadRate ?? '--'"
        unit="%"
        :color="(detailData?.loadRate ?? 0) >= 85 ? '#52c41a' : (detailData?.loadRate ?? 0) >= 70 ? '#faad14' : '#ff4d4f'"
      />
      <MetricCard
        title="产出率"
        :value="detailData?.outputRate ?? '--'"
        unit="%"
        :color="(detailData?.outputRate ?? 0) >= 85 ? '#52c41a' : (detailData?.outputRate ?? 0) >= 70 ? '#faad14' : '#ff4d4f'"
      />
      <MetricCard
        title="OEE"
        :value="detailData?.oee ?? '--'"
        unit="%"
        color="#722ed1"
      />
    </div>

    <!-- 图表区域 -->

    <!-- 分车间明细（仅在有多个车间记录时展示） -->
    <div v-if="visibleWorkshopBreakdown.length > 1" class="workshop-section">
      <h3 class="section-title">车间分布</h3>
      <div class="ws-summary-grid">
        <div v-for="ws in visibleWorkshopBreakdown" :key="ws.workshop" class="ws-card">
          <div class="ws-card-name">{{ ws.workshop }}</div>
          <div class="ws-card-metrics">
            <div class="ws-metric">
              <span class="ws-metric-label">产量</span>
              <span class="ws-metric-value">{{ ws.totalOutput?.toLocaleString() }} 条</span>
            </div>
            <div class="ws-metric">
              <span class="ws-metric-label">产出率</span>
              <span class="ws-metric-value">{{ ws.outputRate }}%</span>
            </div>
            <div class="ws-metric">
              <span class="ws-metric-label">负荷率</span>
              <span class="ws-metric-value">{{ ws.loadRate }}%</span>
            </div>
          </div>
        </div>
      </div>
      <div class="chart-row">
        <div class="chart-col">
          <TrendLine
            :multi-series="wsOutputTrendSeries"
            title="各车间产量趋势"
            :height="280"
          />
        </div>
        <div class="chart-col">
          <TrendLine
            :multi-series="wsLoadRateTrendSeries"
            title="各车间负荷率趋势"
            :height="280"
          />
        </div>
      </div>
    </div>

    <div class="chart-row">
      <div class="chart-col">
        <TrendLine
          :data="detailData?.loadRateTrend || []"
          title="设备负荷率趋势"
          :height="300"
          line-color="#faad14"
        />
      </div>
      <div class="chart-col">
        <TrendLine
          :data="detailData?.outputRateTrend || []"
          title="设备产出率趋势"
          :height="300"
          line-color="#52c41a"
        />
      </div>
    </div>

    <div class="full-chart">
      <BarChart
        :data="detailData?.outputTrend || []"
        title="产量趋势"
        :height="250"
        bar-color="#1890ff"
      />
    </div>

    <div class="full-chart">
      <TrendLine
        :data="detailData?.oeeTrend || []"
        title="OEE趋势"
        :height="300"
        line-color="#722ed1"
        :target-line="85"
      />
    </div>
  </div>
</template>

<style scoped>
.equipment-detail-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.detail-header {
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
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.chart-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.chart-col {
  min-width: 0;
}

.full-chart {
  width: 100%;
}

.workshop-section {
  background: var(--bg-card);
  border-radius: var(--radius-md);
  padding: 16px 20px;
  box-shadow: var(--shadow-sm);
}

.section-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 12px;
}

.ws-summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.ws-card {
  border: 1px solid var(--border-color, #E2E8F0);
  border-radius: var(--radius-sm);
  padding: 12px 16px;
  background: var(--bg-body, #F8FAFC);
}

.ws-card-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.ws-card-metrics {
  display: flex;
  gap: 16px;
}

.ws-metric {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ws-metric-label {
  font-size: 11px;
  color: var(--text-secondary);
}

.ws-metric-value {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

@media (max-width: 1024px) {
  .metric-grid { grid-template-columns: repeat(2, 1fr); }
  .chart-row { grid-template-columns: 1fr; }
}

@media (max-width: 768px) {
  .detail-header {
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
  .metric-grid { grid-template-columns: 1fr; }
  .ws-card-metrics {
    flex-wrap: wrap;
    gap: 10px;
  }
}
</style>
