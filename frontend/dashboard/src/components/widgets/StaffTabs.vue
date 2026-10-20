<script setup>
/**
 * 人员模块内的两个页签：人员数据 / 人员名单
 * 放在两个页面顶部，切换时不改变主导航高亮（都由 /staff 前缀命中）。
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const onAnalysis = computed(() => ['Staff', 'StaffDetail'].includes(route.name))
const onRoster = computed(() => route.name === 'StaffRoster')
</script>

<template>
  <nav class="staff-tabs">
    <router-link to="/staff" class="staff-tab" :class="{ active: onAnalysis }">人员数据</router-link>
    <router-link to="/staff/roster" class="staff-tab" :class="{ active: onRoster }">人员名单</router-link>
  </nav>
</template>

<style scoped>
.staff-tabs {
  display: inline-flex;
  align-self: flex-start;
  gap: 4px;
  padding: 3px;
  background: var(--bg-card);
  border: 1px solid var(--border-color, #E2E8F0);
  border-radius: 8px;
}
.staff-tab {
  padding: 6px 16px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-secondary, #64748B);
  text-decoration: none;
  white-space: nowrap;
  transition: all 0.2s;
}
.staff-tab:hover {
  background: #F8FAFC;
  color: var(--text-primary);
}
.staff-tab.active {
  background: var(--primary, #1E40AF);
  color: #fff;
  font-weight: 600;
}

@media (max-width: 640px) {
  .staff-tabs { width: 100%; }
  .staff-tab {
    flex: 1;
    min-height: 40px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 14px;
  }
}
</style>
