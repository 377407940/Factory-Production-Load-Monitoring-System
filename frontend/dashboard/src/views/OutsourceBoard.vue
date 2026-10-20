<script setup>
/**
 * 外包数据看板
 *
 * 这块看板是**另一个独立应用**（`yijiayuan-prod`，PM2 / 端口 3000 / Node 22，
 * 走 `/prod/` 反代），不搬代码，直接 iframe 嵌进来 —— 它自己更新我们自动跟着变。
 *
 * 登录态天然是通的：iframe 与主站同源，会话 Cookie 自动带上；
 * 而且 `/monitor/outsource` 本身是受保护路由，未登录时**路由守卫先跳登录页**，
 * 这个 iframe 根本不会被渲染出来。
 *
 * 它自己顶部的工具栏（维度切换 / 日期 / 同步按钮）**故意保留** ——
 * 没有那些控件，嵌进来就只能看默认维度。
 */
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'

const wrap = ref(null)
const height = ref(600)

/**
 * 高度用量的，不写死 calc(100vh - Npx)：
 * 顶栏在手机上会换行变高，写死的话要么露白要么溢出。
 */
function fit() {
  if (!wrap.value) return
  const top = wrap.value.getBoundingClientRect().top
  height.value = Math.max(360, window.innerHeight - top - 20)
}

onMounted(() => {
  nextTick(fit)
  window.addEventListener('resize', fit)
})
onBeforeUnmount(() => window.removeEventListener('resize', fit))
</script>

<template>
  <div ref="wrap" class="ob-wrap">
    <iframe
      class="ob-frame"
      :style="{ height: height + 'px' }"
      src="/prod/"
      title="外包数据看板"
    ></iframe>
  </div>
</template>

<style scoped>
.ob-wrap { display: flex; flex-direction: column; }
.ob-frame {
  width: 100%;
  border: 0;
  border-radius: 10px;
  background: #fff;
  box-shadow: var(--shadow-sm);
  display: block;
}

@media (max-width: 640px) {
  .ob-frame { border-radius: 8px; }
}
</style>
