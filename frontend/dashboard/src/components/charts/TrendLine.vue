<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import * as echarts from 'echarts'

const props = defineProps({
  data: { type: Array, default: () => [] },
  title: { type: String, default: '' },
  height: { type: Number, default: 300 },
  targetLine: { type: Number, default: null },
  lineColor: { type: String, default: '#1890ff' },
  multiSeries: { type: Array, default: null },
  // 简单 tooltip：只显示日期/标签 + 未达产原因，不显示各系列圆点/名称/数值
  simpleTooltip: { type: Boolean, default: false },
  // Y 轴最大值（如 OES 固定 100）
  yAxisMax: { type: Number, default: null },
})

const chartRef = ref(null)
let chartInstance = null

function initChart() {
  if (!chartRef.value) return
  if (chartInstance) chartInstance.dispose()
  chartInstance = echarts.init(chartRef.value)
  renderChart()
}

function renderChart() {
  if (!chartInstance) return

  const isMulti = props.multiSeries && props.multiSeries.length > 0

  const labels = isMulti
    ? (props.multiSeries[0].data || []).map((d) => d.label)
    : props.data.map((d) => d.label)

  const series = isMulti
    ? props.multiSeries.map((s) => ({
        type: 'line',
        name: s.name,
        data: (s.data || []).map((d) => d.value),
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { color: s.color, width: 2 },
        itemStyle: { color: s.color },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: s.color + '22' },
            { offset: 1, color: s.color + '05' },
          ]),
        },
      }))
    : [
        {
          type: 'line',
          data: props.data.map((d) => d.value),
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { color: props.lineColor, width: 2 },
          itemStyle: { color: props.lineColor },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: props.lineColor + '33' },
              { offset: 1, color: props.lineColor + '05' },
            ]),
          },
        },
      ]

  if (props.targetLine !== null) {
    series.push({
      type: 'line',
      data: labels.map(() => props.targetLine),
      lineStyle: { color: '#ff4d4f', width: 2, type: 'dashed' },
      symbol: 'none',
      name: '目标线',
    })
  }

  const option = {
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
        if (!params || params.length === 0) return ''
        const item = isMulti ? (props.multiSeries[0].data || [])[params[0].dataIndex] : props.data[params[0].dataIndex]
        // 简单模式：只显示日期 + 未达产原因（不显示各产品圆点/名称/数值）
        if (props.simpleTooltip) {
          let html = `${item ? item.label : ''}<br/>`
          const seen = new Set()
          if (isMulti) {
            for (const p of params) {
              const arr = props.multiSeries[p.seriesIndex] ? props.multiSeries[p.seriesIndex].data : null
              const dp = arr ? arr[p.dataIndex] : null
              if (dp && dp.reason && !seen.has(dp.reason)) {
                seen.add(dp.reason)
                html += `<span style="color:#EF4444;font-size:11px">未达产原因：${String(dp.reason).replace(/\n/g, '<br/>')}</span><br/>`
              }
            }
          }
          return html
        }
        let html = `${item ? item.label : ''}<br/>`
        params.forEach((p) => {
          html += `${p.marker} ${p.seriesName || ''} ${p.value}`
          // 数据点携带未达产原因时在 tooltip 中展示（直接读 props 数据：ECharts 会对带 label 字段的数据项规范化，p.data 可能丢失自定义字段）
          if (isMulti && p.seriesIndex != null) {
            const arr = props.multiSeries[p.seriesIndex] ? props.multiSeries[p.seriesIndex].data : null
            const dp = arr ? arr[p.dataIndex] : null
            if (dp && dp.reason) {
              html += `<br/><span style="color:#EF4444;font-size:11px">未达产原因：${String(dp.reason).replace(/\n/g, '<br/>')}</span>`
            }
          }
          html += `<br/>`
        })
        return html
      },
    },
    legend: isMulti ? { data: props.multiSeries.map((s) => s.name), top: 34, textStyle: { fontSize: 11, color: '#64748B' } } : undefined,
    grid: { left: 48, right: 16, top: props.title ? (isMulti ? 56 : 44) : 20, bottom: 28 },
    xAxis: {
      type: 'category',
      data: labels,
      axisLine: { lineStyle: { color: '#E2E8F0' } },
      axisLabel: { color: '#94A3B8', fontSize: 11 },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      max: props.yAxisMax !== null && props.yAxisMax !== undefined ? props.yAxisMax : undefined,
      splitLine: { lineStyle: { color: '#F1F5F9', type: 'dashed' } },
      axisLabel: { color: '#94A3B8', fontSize: 11 },
    },
    series,
  }

  // notMerge: 全量替换，避免筛选变化后旧序列残留
  chartInstance.setOption(option, { notMerge: true })
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
  () => [props.data, props.title, props.targetLine, props.multiSeries],
  () => {
    nextTick(renderChart)
  },
  { deep: true }
)
</script>

<template>
  <div class="trend-line-wrapper">
    <div ref="chartRef" class="trend-line-chart" :style="{ height: height + 'px' }"></div>
  </div>
</template>

<style scoped>
.trend-line-wrapper {
  background: #fff;
  border-radius: 8px;
  padding: 8px;
}

.trend-line-chart {
  width: 100%;
}
</style>
