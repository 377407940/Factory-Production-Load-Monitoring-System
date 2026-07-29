<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import * as echarts from 'echarts'

const props = defineProps({
  data: { type: Array, default: () => [] },
  title: { type: String, default: '' },
  height: { type: Number, default: 300 },
  barColor: { type: String, default: '#3B82F6' },
  colors: { type: Array, default: null },
})

const chartRef = ref(null)
let chartInstance = null

function initChart() {
  if (!chartRef.value) return
  if (chartInstance) chartInstance.dispose()
  chartInstance = echarts.init(chartRef.value, null, { renderer: 'canvas' })
  renderChart()
}

function renderChart() {
  if (!chartInstance) return

  chartInstance.setOption({
    title: props.title
      ? { text: props.title, textStyle: { fontSize: 14, fontWeight: 600, color: '#1E293B' }, left: 'center', top: 8 }
      : undefined,
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255,255,255,0.95)',
      borderColor: '#E2E8F0',
      borderWidth: 1,
      textStyle: { fontSize: 12, color: '#1E293B' },
      formatter: (params) => {
        const p = params[0]
        const val = p.value !== undefined ? p.value.toLocaleString() : p.value
        return `${p.name}<br/>${p.marker} ${val}`
      },
    },
    grid: { left: 56, right: 16, top: props.title ? 44 : 20, bottom: 28 },
    xAxis: {
      type: 'category',
      data: props.data.map((d) => d.label),
      axisLine: { lineStyle: { color: '#E2E8F0' } },
      axisLabel: { color: '#94A3B8', fontSize: 11, rotate: props.data.length > 8 ? 30 : 0 },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: '#F1F5F9', type: 'dashed' } },
      axisLabel: {
        color: '#94A3B8',
        fontSize: 11,
        formatter: (val) => {
          if (val >= 10000) return (val / 10000).toFixed(1) + '万'
          if (val >= 1000) return (val / 1000).toFixed(1) + 'k'
          return val.toLocaleString()
        },
      },
    },
    series: [
      {
        type: 'bar',
        data: props.data.map((d, i) => {
          if (props.colors && props.colors[i]) {
            return {
              value: d.value,
              itemStyle: { color: props.colors[i], borderRadius: [4, 4, 0, 0] },
            };
          }
          return d.value;
        }),
        barWidth: '50%',
        label: {
          show: props.data.length <= 15,
          position: 'top',
          color: '#475569',
          fontSize: 11,
          fontWeight: 600,
          formatter: (params) => {
            const v = params.value
            const num = typeof v === 'object' ? v.value : v
            if (num >= 10000) return (num / 10000).toFixed(1) + '万'
            return num.toLocaleString()
          },
        },
        itemStyle: props.colors ? undefined : {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: props.barColor },
            { offset: 1, color: props.barColor + '44' },
          ]),
          borderRadius: [4, 4, 0, 0],
        },
        animationDuration: 500,
        animationEasing: 'cubicOut',
      },
    ],
  })
}

function handleResize() {
  chartInstance?.resize()
}

onMounted(() => {
  nextTick(initChart)
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  chartInstance?.dispose()
  chartInstance = null
})

watch(
  () => [props.data, props.title],
  () => {
    nextTick(renderChart)
  },
  { deep: true }
)
</script>

<template>
  <div class="bar-chart-wrapper">
    <div ref="chartRef" class="bar-chart-echart" :style="{ height: height + 'px' }"></div>
  </div>
</template>

<style scoped>
.bar-chart-wrapper {
  background: var(--bg-card);
  border-radius: var(--radius-md);
  padding: 8px 8px 4px;
  box-shadow: var(--shadow-sm);
}

.bar-chart-echart {
  width: 100%;
}
</style>
