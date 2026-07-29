<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  dimension: { type: String, required: true },
  year: { type: Number, required: true },
})

const emit = defineEmits(['update:period'])

const selectedPeriod = ref(null)

/** 月选项：1月 ~ 当前月（或12月） */
const monthOptions = computed(() => {
  const now = new Date()
  const maxMonth = (props.year === now.getFullYear()) ? now.getMonth() + 1 : 12
  const options = []
  for (let m = 1; m <= maxMonth; m++) {
    options.push({ value: m, label: `${m}月` })
  }
  return options
})

/** 周选项：W01 ~ 当前周 */
const weekOptions = computed(() => {
  const now = new Date()
  const endDate = (props.year === now.getFullYear()) ? now : new Date(props.year, 11, 31)
  const maxWeek = getISOWeekNumber(endDate)
  const options = []
  for (let w = 1; w <= maxWeek; w++) {
    options.push({ value: w, label: `W${String(w).padStart(2, '0')}` })
  }
  return options
})

function getISOWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
}

const dateRange = computed(() => {
  if (!selectedPeriod.value) return null

  if (props.dimension === 'day') {
    const d = selectedPeriod.value
    return { startDate: d, endDate: d }
  } else if (props.dimension === 'month') {
    const month = selectedPeriod.value
    const lastDay = new Date(props.year, month, 0).getDate()
    return {
      startDate: `${props.year}-${String(month).padStart(2, '0')}-01`,
      endDate: `${props.year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    }
  } else if (props.dimension === 'week') {
    const week = selectedPeriod.value
    const jan4 = new Date(props.year, 0, 4)
    const dayOfWeek = jan4.getDay() || 7
    const week1Monday = new Date(jan4)
    week1Monday.setDate(jan4.getDate() - dayOfWeek + 1)
    const monday = new Date(week1Monday)
    monday.setDate(week1Monday.getDate() + (week - 1) * 7)
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    const fmt = (dt) => {
      const y = dt.getFullYear()
      const m = String(dt.getMonth() + 1).padStart(2, '0')
      const d = String(dt.getDate()).padStart(2, '0')
      return `${y}-${m}-${d}`
    }
    return { startDate: fmt(monday), endDate: fmt(sunday) }
  }
  return null
})

// Emit computed dateRange on change
watch(dateRange, (range) => {
  emit('update:period', range)
})

// Reset selection when dimension changes
watch(() => props.dimension, () => {
  selectedPeriod.value = null
  emit('update:period', null)
})

// Initialize from URL params on mount
function setFromUrl(startDate, endDate) {
  if (startDate && endDate) {
    if (props.dimension === 'day') {
      selectedPeriod.value = startDate
    } else if (props.dimension === 'month') {
      // Extract month from startDate
      const m = parseInt(startDate.slice(5, 7), 10)
      selectedPeriod.value = m
    } else if (props.dimension === 'week') {
      // Calculate week number from startDate
      const d = new Date(startDate)
      selectedPeriod.value = getISOWeekNumber(d)
    }
  }
}

defineExpose({ setFromUrl })
</script>

<template>
  <div class="period-selector" v-if="dimension !== 'year'">
    <!-- 日：日期选择器 -->
    <input
      v-if="dimension === 'day'"
      type="date"
      class="period-input"
      :min="`${year}-01-01`"
      :max="`${year}-12-31`"
      v-model="selectedPeriod"
    />
    <!-- 周：下拉 -->
    <select
      v-else-if="dimension === 'week'"
      class="period-input"
      v-model.number="selectedPeriod"
    >
      <option :value="null" disabled>选择周</option>
      <option v-for="opt in weekOptions" :key="opt.value" :value="opt.value">
        {{ opt.label }}
      </option>
    </select>
    <!-- 月：下拉 -->
    <select
      v-else-if="dimension === 'month'"
      class="period-input"
      v-model.number="selectedPeriod"
    >
      <option :value="null" disabled>选择月</option>
      <option v-for="opt in monthOptions" :key="opt.value" :value="opt.value">
        {{ opt.label }}
      </option>
    </select>
  </div>
</template>

<style scoped>
.period-selector {
  display: inline-flex;
}
.period-input {
  padding: 4px 10px;
  border: 1px solid var(--border-color, #E2E8F0);
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-primary);
  background: var(--bg-card);
  cursor: pointer;
  outline: none;
}
.period-input:focus {
  border-color: var(--primary, #3B82F6);
}

@media (max-width: 768px) {
  .period-input {
    font-size: 12px;
    padding: 4px 6px;
    max-width: 130px;
  }
}
</style>
