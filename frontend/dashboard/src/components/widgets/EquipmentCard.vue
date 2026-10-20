<script setup>
import { computed } from 'vue'

const props = defineProps({
  name: { type: String, required: true },
  type: { type: String, default: '未知' },
  output: { type: Number, default: 0 },
  outputRate: { type: Number, default: 0 },
  loadRate: { type: Number, default: 0 },
  totalLoadHours: { type: Number, default: 0 },
  oee: { type: Number, default: 0 },
  status: { type: String, default: 'health' },
  lanes: { type: Number, default: null },
  designSpeed: { type: Number, default: null },
})

const emit = defineEmits(['click'])

const typeColor = computed(() => {
  return props.type === '粉体' ? '#3B82F6' : '#8B5CF6'
})

const typeLabel = computed(() => {
  return props.type === '粉体' ? '粉体' : '液体'
})

const statusConfig = computed(() => {
  const map = {
    health: { label: '健康', color: '#22C55E', bg: '#F0FDF4' },
    warning: { label: '注意', color: '#F59E0B', bg: '#FFFBEB' },
    danger: { label: '预警', color: '#EF4444', bg: '#FEF2F2' },
  }
  return map[props.status] || map.health
})

const infoLine = computed(() => {
  const parts = [typeLabel.value]
  if (props.lanes) parts.push(`${props.lanes}列`)
  if (props.designSpeed) parts.push(`设计速度${props.designSpeed}切/分`)
  return parts.join(' · ')
})

// 环形进度
const RING_RADIUS = 30
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

const outputRateOffset = computed(() => {
  const rate = Math.min(Math.max(props.outputRate, 0), 100)
  return RING_CIRCUMFERENCE * (1 - rate / 100)
})

const loadRateOffset = computed(() => {
  const rate = Math.min(Math.max(props.loadRate, 0), 100)
  return RING_CIRCUMFERENCE * (1 - rate / 100)
})

const outputRateColor = computed(() => {
  if (props.outputRate >= 85) return '#22C55E'
  if (props.outputRate >= 70) return '#F59E0B'
  return '#EF4444'
})

const loadRateColor = computed(() => {
  if (props.loadRate >= 85) return '#22C55E'
  if (props.loadRate >= 70) return '#3B82F6'
  return '#6B7280'
})

</script>

<template>
  <div class="equipment-card" @click="emit('click')">
    <!-- 顶部类型色条 -->
    <div class="card-accent" :style="{ background: typeColor }"></div>

    <div class="card-body">
      <!-- 头部：名称 + 状态 -->
      <div class="card-header">
        <span class="eq-name" :title="name">{{ name }}</span>
        <span class="eq-status" :style="{ color: statusConfig.color, background: statusConfig.bg }">
          <svg width="6" height="6" viewBox="0 0 6 6" fill="currentColor">
            <circle cx="3" cy="3" r="3"/>
          </svg>
          {{ statusConfig.label }}
        </span>
      </div>

      <!-- 类型信息行 -->
      <div class="eq-info">{{ infoLine }}</div>

      <!-- 2×2 环形进度区 -->
      <div class="ring-grid">
        <!-- 产出率环形 -->
        <div class="ring-item">
          <div class="ring-wrapper">
            <svg viewBox="0 0 80 80" class="ring-svg">
              <circle cx="40" cy="40" :r="RING_RADIUS" fill="none" stroke="#E5E7EB" stroke-width="6"/>
              <circle cx="40" cy="40" :r="RING_RADIUS" fill="none"
                :stroke="outputRateColor" stroke-width="6"
                stroke-linecap="round"
                :stroke-dasharray="RING_CIRCUMFERENCE"
                :stroke-dashoffset="outputRateOffset"
                transform="rotate(-90 40 40)"
                class="ring-progress"
              />
            </svg>
            <div class="ring-center">
              <span class="ring-value" :style="{ color: outputRateColor }">{{ outputRate }}%</span>
              <span class="ring-label">产出率</span>
            </div>
          </div>
          <div class="ring-sub-value">{{ (output / 10000).toLocaleString(undefined, { maximumFractionDigits: 2 }) }}万条</div>
        </div>

        <!-- 负荷率环形 -->
        <div class="ring-item">
          <div class="ring-wrapper">
            <svg viewBox="0 0 80 80" class="ring-svg">
              <circle cx="40" cy="40" :r="RING_RADIUS" fill="none" stroke="#E5E7EB" stroke-width="6"/>
              <circle cx="40" cy="40" :r="RING_RADIUS" fill="none"
                :stroke="loadRateColor" stroke-width="6"
                stroke-linecap="round"
                :stroke-dasharray="RING_CIRCUMFERENCE"
                :stroke-dashoffset="loadRateOffset"
                transform="rotate(-90 40 40)"
                class="ring-progress"
              />
            </svg>
            <div class="ring-center">
              <span class="ring-value" :style="{ color: loadRateColor }">{{ loadRate }}%</span>
              <span class="ring-label">负荷率</span>
            </div>
          </div>
          <div class="ring-sub-value">{{ totalLoadHours.toFixed(1) }}h</div>
        </div>
      </div>

      <!-- 底部 OEE -->
      <div class="card-footer">
        <span class="footer-label">OEE</span>
        <span class="footer-value" :class="{ 'oee-good': oee >= 85, 'oee-mid': oee >= 70 && oee < 85, 'oee-low': oee > 0 && oee < 70 }">
          {{ oee > 0 ? oee.toFixed(1) + '%' : '--' }}
        </span>
      </div>

      <!-- 底部弹性空间：吸收多余空间，确保空白留在最底部 -->
      <div class="card-spacer"></div>
    </div>
  </div>
</template>

<style scoped>
.equipment-card {
  background: var(--bg-card);
  border-radius: 12px;
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  transition: box-shadow 0.25s, border-color 0.25s;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid transparent;
  position: relative;
}

.equipment-card:hover {
  box-shadow: var(--shadow-md);
  border-color: var(--primary-light, #93C5FD);
}

/* 顶部类型色条 */
.card-accent {
  height: 4px;
  flex-shrink: 0;
}

.card-body {
  padding: 14px 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
}

/* 头部 */
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.eq-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 75%;
}

.eq-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 10px;
  white-space: nowrap;
  flex-shrink: 0;
}

/* 类型信息 */
.eq-info {
  font-size: 12px;
  color: var(--text-muted, #94A3B8);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 环形进度网格 */
.ring-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 4px;
}

.ring-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.ring-wrapper {
  position: relative;
  width: 70px;
  height: 70px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ring-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.ring-progress {
  transition: stroke-dashoffset 0.8s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.ring-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1.1;
  z-index: 1;
}

.ring-value {
  font-size: 15px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.ring-label {
  font-size: 10px;
  color: var(--text-muted, #94A3B8);
  font-weight: 500;
}

.ring-sub-value {
  font-size: 11px;
  color: var(--text-secondary, #64748B);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

/* 底部 OEE */
.card-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--border-color, #E2E8F0);
}

.footer-label {
  font-size: 11px;
  color: var(--text-muted, #94A3B8);
  font-weight: 500;
}

.footer-value {
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary, #64748B);
}

.oee-good { color: #22C55E; }
.oee-mid { color: #F59E0B; }
.oee-low { color: #EF4444; }

/* ===== 底部弹性空间 ===== */
.card-spacer {
  flex: 1;
}
</style>
