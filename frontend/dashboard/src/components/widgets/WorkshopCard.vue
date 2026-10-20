<script setup>
import { computed } from 'vue'

const props = defineProps({
  name: { type: String, default: '' },
  area: { type: Number, default: null },
  outputRate: { type: Number, default: 0 },
  totalOutput: { type: Number, default: 0 },
  outputUnit: { type: String, default: '条' },
  loadRate: { type: Number, default: 0 },
  loadRateDays: { type: Number, default: null },
  status: { type: String, default: 'health' },
  power: { type: Number, default: null },
  powerCost: { type: Number, default: null },
})

const emit = defineEmits(['click'])

const statusConfig = computed(() => {
  const map = {
    health: { label: '健康', color: '#22C55E', bg: '#F0FDF4' },
    warning: { label: '注意', color: '#F59E0B', bg: '#FFFBEB' },
    danger: { label: '预警', color: '#EF4444', bg: '#FEF2F2' },
  }
  return map[props.status] || map.health
})

const borderColor = computed(() => statusConfig.value.color)

const outputRateBarWidth = computed(() => Math.min(Math.max(props.outputRate, 0), 100))
const loadRateBarWidth = computed(() => Math.min(Math.max(props.loadRate, 0), 100))

const outputRateColor = computed(() => {
  if (props.outputRate >= 85) return '#22C55E'
  if (props.outputRate >= 70) return '#F59E0B'
  return '#EF4444'
})

</script>

<template>
  <div class="workshop-card" @click="emit('click')">
    <div class="workshop-border" :style="{ background: borderColor }"></div>
    <div class="workshop-body">
      <div class="workshop-header">
        <div class="workshop-title-group">
          <span class="workshop-name">{{ name }}</span>
          <span v-if="area" class="workshop-area">{{ area }}㎡</span>
        </div>
        <span class="workshop-badge" :style="{ color: statusConfig.color, background: statusConfig.bg }">
          <svg width="6" height="6" viewBox="0 0 6 6" fill="currentColor">
            <circle cx="3" cy="3" r="3"/>
          </svg>
          {{ statusConfig.label }}
        </span>
      </div>

      <div class="workshop-metrics">
        <div class="metric-item">
          <span class="metric-label">产出率</span>
          <span class="metric-value" :style="{ color: outputRateColor }">{{ outputRate }}%</span>
          <div class="progress-track">
            <div class="progress-fill" :style="{ width: outputRateBarWidth + '%', background: outputRateColor }"></div>
          </div>
        </div>
        <div class="metric-item">
          <span class="metric-label">产出量</span>
          <span class="metric-value metric-qty">{{ totalOutput.toLocaleString() }}</span>
          <span class="metric-unit">{{ outputUnit }}</span>
        </div>
        <div class="metric-item">
          <span class="metric-label">车间负载率</span>
          <span class="metric-value">{{ loadRate }}%</span>
          <div class="progress-track">
            <div class="progress-fill" :style="{ width: loadRateBarWidth + '%', background: '#3B82F6' }"></div>
          </div>
          <span v-if="loadRateDays != null" class="metric-load-days">工作日 {{ loadRateDays }} 天</span>
        </div>
        <div v-if="power !== null" class="metric-item">
          <span class="metric-label">用电量</span>
          <span class="metric-value metric-power">{{ power >= 10000 ? (power / 10000).toFixed(1) + '万' : power.toFixed(1) }}</span>
          <span class="metric-unit">kWh</span>
          <span v-if="powerCost !== null" class="metric-cost">{{ powerCost.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }} 元</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.workshop-card {
  background: var(--bg-card);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  transition: box-shadow 0.25s, transform 0.25s;
  display: flex;
  overflow: hidden;
  position: relative;
}

.workshop-card:hover {
  box-shadow: var(--shadow-md);
  transform: translateY(-3px);
}

.workshop-border {
  width: 4px;
  flex-shrink: 0;
}

.workshop-body {
  flex: 1;
  min-width: 0;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.workshop-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.workshop-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.workshop-title-group {
  display: flex;
  align-items: center;
}

.workshop-area {
  font-size: 13px;
  font-weight: 600;
  color: #f97316;
  margin-left: 8px;
}

.workshop-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 500;
  padding: 3px 10px;
  border-radius: 12px;
  white-space: nowrap;
}

.workshop-metrics {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-shrink: 0;
}

.metric-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  flex: 1;
  min-width: 0;
}

.metric-label {
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 500;
}

.metric-value {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.metric-qty {
  font-size: 16px;
}

.metric-unit {
  font-size: 11px;
  color: var(--text-muted);
}

.progress-track {
  width: 80%;
  height: 4px;
  background: #F1F5F9;
  border-radius: 2px;
  overflow: hidden;
  margin-top: 2px;
}

.progress-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.metric-cost {
  font-size: 12px;
  font-weight: 600;
  color: #f97316;
  margin-top: 1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.metric-load-days {
  font-size: 11px;
  color: var(--text-muted, #94A3B8);
  font-weight: 500;
  white-space: nowrap;
}

@media (max-width: 768px) {
  .workshop-body {
    padding: 12px 14px;
    gap: 10px;
  }
  .workshop-name {
    font-size: 13px;
  }
  .workshop-metrics {
    flex-wrap: wrap;
    gap: 8px;
  }
  .metric-item {
    min-width: calc(50% - 4px);
  }
  .metric-value {
    font-size: 15px;
  }
  .progress-track {
    width: 90%;
  }
}
</style>
