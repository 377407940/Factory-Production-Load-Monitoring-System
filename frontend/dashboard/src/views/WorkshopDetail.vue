<script setup>
import { ref, onMounted, watch, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { fetchWorkshopDetail } from '../api/monitor.js'
import MetricCard from '../components/widgets/MetricCard.vue'
import EquipmentTable from '../components/widgets/EquipmentTable.vue'
import TrendLine from '../components/charts/TrendLine.vue'
import BarChart from '../components/charts/BarChart.vue'
import PeriodSelector from '../components/widgets/PeriodSelector.vue'
import ProductTable from '../components/widgets/ProductTable.vue'
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
const loading = ref(true)
const detailData = ref(null)
const periodSelectorRef = ref(null)

const currentPeriod = ref(
  (route.query.startDate && route.query.endDate)
    ? { startDate: route.query.startDate, endDate: route.query.endDate }
    : null
)

const powerTrend = computed(() => {
  return detailData.value?.powerTrend || []
})

const workshopName = computed(() => route.params.name)

// 合并设备列表中的产品信息（按产品名称去重，跨设备合并产量和机手）
function mergeProducts(equipmentList) {
  const seen = new Map()
  for (const eq of equipmentList) {
    const prods = eq.currentProducts || []
    for (const p of prods) {
      const key = `${p.productName}|${p.moNumber}`
      if (seen.has(key)) {
        const existing = seen.get(key)
        existing.targetQty += p.targetQty
        existing.actualQty += p.actualQty
        if (p.dailyRate > existing.dailyRate) existing.dailyRate = p.dailyRate
        if (p.orderRate > existing.orderRate) existing.orderRate = p.orderRate
        existing.machines = [...new Set([...existing.machines, ...p.machines])]
        // 合并机手数组
        if (p.operators) {
          for (const op of p.operators) {
            const existingOp = existing.operators.find(eo => eo.operatorName === op.operatorName)
            if (existingOp) {
              existingOp.targetQty += op.targetQty
              existingOp.actualQty += op.actualQty
              existingOp.machines = [...new Set([...existingOp.machines, ...(op.machines || [])])]
              if (op.dailyRate > existingOp.dailyRate) existingOp.dailyRate = op.dailyRate
            } else {
              existing.operators.push({ ...op, machines: [...(op.machines || [])] })
            }
          }
        }
      } else {
        seen.set(key, {
          ...p,
          machines: [...p.machines],
          operators: p.operators ? p.operators.map(op => ({ ...op, machines: [...(op.machines || [])] })) : [],
        })
      }
    }
  }
  return Array.from(seen.values()).sort((a, b) => b.actualQty - a.actualQty)
}

async function loadData() {
  loading.value = true
  try {
    const { startDate, endDate } = currentPeriod.value || {}
    detailData.value = await fetchWorkshopDetail(workshopName.value, currentDimension.value, currentYear.value, startDate, endDate)
  } catch (e) {
    console.error('[workshop] 加载失败:', e)
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

function onEquipmentSelect(equipment) {
  const query = { dimension: currentDimension.value, year: currentYear.value }
  if (currentPeriod.value) {
    query.startDate = currentPeriod.value.startDate
    query.endDate = currentPeriod.value.endDate
  }
  router.push({
    name: 'EquipmentDetail',
    params: { name: equipment.name },
    query: { ...query, workshop: workshopName.value },
  })
}

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
  <div class="workshop-detail-page">
    <!-- 顶部标题和维度切换 -->
    <div class="detail-header">
      <h2 class="page-title">{{ workshopName }}</h2>
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
        title="总产出"
        :value="detailData?.totalOutput?.toLocaleString() || '--'"
        unit="条"
        color="#1890ff"
      />
      <MetricCard
        title="理论产出"
        :value="detailData?.theoreticalOutput?.toLocaleString() || '--'"
        unit="条"
        color="#722ed1"
      />
      <MetricCard
        title="产出率"
        :value="detailData?.outputRate ?? '--'"
        unit="%"
        :color="(detailData?.outputRate ?? 0) >= 85 ? '#52c41a' : (detailData?.outputRate ?? 0) >= 70 ? '#faad14' : '#ff4d4f'"
      />
      <MetricCard
        title="车间负载率"
        :value="detailData?.loadRate ?? '--'"
        unit="%"
        color="#faad14"
        sub-label="工作日"
        :sub-text="detailData?.workingDays ? detailData.workingDays + ' 天' : ''"
      />
    </div>

    <!-- 趋势图表（两列） -->
    <div class="chart-row">
      <div class="chart-col">
        <BarChart
          :data="detailData?.outputTrend || []"
          title="产量趋势"
          :height="300"
          bar-color="#1890ff"
        />
      </div>
      <div class="chart-col">
        <TrendLine
          :data="detailData?.loadRateTrend || []"
          title="车间负载率趋势"
          :height="300"
          line-color="#faad14"
        />
      </div>
    </div>

    <!-- 用电量趋势图 -->
    <div v-if="powerTrend.length > 0" class="chart-row">
      <div class="chart-col chart-full">
        <TrendLine
          :data="powerTrend"
          title="用电量趋势"
          :height="300"
          line-color="#1890ff"
        />
      </div>
    </div>

    <!-- 产品信息卡片（表格） -->
    <ProductTable
      :products="mergeProducts(detailData?.equipmentList || [])"
      title="当前生产产品"
    />

    <!-- 设备列表 -->
    <section class="equipment-section">
      <h3 class="section-title">设备列表</h3>
      <EquipmentTable
        :equipment-list="detailData?.equipmentList || []"
        :loading="loading"
        @select="onEquipmentSelect"
      />
    </section>
  </div>
</template>

<style scoped>
.workshop-detail-page {
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

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.equipment-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
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
}
</style>
