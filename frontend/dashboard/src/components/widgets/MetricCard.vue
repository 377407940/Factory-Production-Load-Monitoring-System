<script setup>
import { ref, onMounted, watch } from 'vue'

const props = defineProps({
  title: { type: String, default: '' },
  value: { type: [String, Number], default: '' },
  unit: { type: String, default: '' },
  color: { type: String, default: '#1890ff' },
  subText: { type: String, default: '' },
  subLabel: { type: String, default: '' },
})

const displayValue = ref('')
const targetNum = ref(0)
const isNumber = ref(false)

function animateValue() {
  const val = props.value
  if (val === '--' || val === '' || val === null || val === undefined) {
    displayValue.value = '--'
    isNumber.value = false
    return
  }
  const num = typeof val === 'string' ? parseFloat(val.replace(/,/g, '')) : val
  if (isNaN(num)) {
    displayValue.value = String(val)
    isNumber.value = false
    return
  }
  isNumber.value = true
  targetNum.value = num
  const duration = 400
  const start = performance.now()
  const startVal = 0

  function tick(now) {
    const elapsed = now - start
    const progress = Math.min(elapsed / duration, 1)
    const eased = 1 - Math.pow(1 - progress, 3)
    const current = startVal + (targetNum.value - startVal) * eased
    if (Number.isInteger(targetNum.value)) {
      displayValue.value = Math.round(current).toLocaleString()
    } else {
      displayValue.value = current.toFixed(1)
    }
    if (progress < 1) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

onMounted(animateValue)
watch(() => props.value, animateValue)
</script>

<template>
  <div class="metric-card">
    <div class="metric-accent" :style="{ background: color }"></div>
    <div class="metric-title">{{ title }}</div>
    <div class="metric-value" :style="{ color }">
      {{ displayValue }}
      <span v-if="unit && displayValue !== '--'" class="metric-unit">{{ unit }}</span>
    </div>
    <div v-if="subText" class="metric-sub">
      <div class="sub-divider"></div>
      <div class="sub-row">
        <span v-if="subLabel" class="sub-label">{{ subLabel }}</span>
        <span class="sub-value">{{ subText }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.metric-card {
  background: var(--bg-card);
  border-radius: var(--radius-md);
  padding: 18px 20px;
  box-shadow: var(--shadow-sm);
  text-align: center;
  transition: box-shadow 0.25s, transform 0.25s;
  position: relative;
  overflow: hidden;
}

.metric-card:hover {
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}

.metric-accent {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 3px;
  opacity: 0.8;
}

.metric-title {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 6px;
  font-weight: 500;
}

.metric-value {
  font-size: 28px;
  font-weight: 700;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}

.metric-unit {
  font-size: 13px;
  font-weight: 400;
  margin-left: 3px;
  opacity: 0.75;
}

.metric-sub {
  margin-top: 10px;
}

.sub-divider {
  height: 1px;
  background: var(--border-color, #E2E8F0);
  margin-bottom: 8px;
  opacity: 0.5;
}

.sub-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.sub-label {
  font-size: 12px;
  color: var(--text-muted, #94A3B8);
  font-weight: 500;
  white-space: nowrap;
}

.sub-value {
  font-size: 15px;
  color: var(--text-secondary, #475569);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 768px) {
  .metric-card {
    padding: 14px 16px;
  }
  .metric-value {
    font-size: 22px;
  }
  .sub-value {
    font-size: 13px;
  }
}
</style>
