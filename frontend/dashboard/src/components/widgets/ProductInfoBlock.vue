<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  products: { type: Array, default: () => [] },
  title: { type: String, default: '当前产品' },
  showHeader: { type: Boolean, default: true },
})

// 展开/折叠状态
const expanded = ref(false)
const expandedProducts = ref({}) // { [productName|moNumber]: true/false }

const displayList = computed(() => {
  if (expanded.value) return props.products
  return props.products.slice(0, 5)
})
const moreCount = computed(() => Math.max(0, props.products.length - 5))

const hasOperators = computed(() => {
  return props.products.some(p => p.operators && p.operators.length > 0)
})

function rateClass(val) {
  if (val >= 85) return 'p-rate-good'
  if (val >= 70) return 'p-rate-mid'
  return 'p-rate-low'
}

function toggleProduct(p) {
  const key = `${p.productName}|${p.moNumber}`
  expandedProducts.value[key] = !expandedProducts.value[key]
}

function isProductExpanded(p) {
  const key = `${p.productName}|${p.moNumber}`
  return !!expandedProducts.value[key]
}

function opRateClass(val) {
  if (val >= 85) return 'op-rate-good'
  if (val >= 70) return 'op-rate-mid'
  return 'op-rate-low'
}
</script>

<template>
  <div v-if="products.length > 0" class="product-block">
    <div v-if="showHeader" class="product-block-header">
      <span class="product-block-title">{{ title }}</span>
      <span class="product-block-count">{{ products.length }} 个</span>
    </div>
    <div class="product-block-list">
      <div v-for="(p, i) in displayList" :key="i" class="product-block-item">
        <!-- 主行：产品名称 + 汇总数据 -->
        <div class="p-main-row" @click="toggleProduct(p)">
          <div class="p-name-line">
            <span class="p-expand-icon">{{ isProductExpanded(p) ? '▼' : '▸' }}</span>
            <span class="p-name" :title="p.productName">{{ p.productName }}</span>
          </div>
          <div class="p-meta-line">
            <span v-if="p.machines.length" class="p-machines" :title="p.machines.join('、')">{{ p.machines.join('、') }}</span>
            <span v-if="p.machines.length" class="p-sep">·</span>
            <span class="p-qty">目标 {{ p.targetQty.toLocaleString() }} / 实际 {{ p.actualQty.toLocaleString() }}</span>
            <span class="p-sep">·</span>
            <span class="p-rate" :class="rateClass(p.dailyRate)">{{ p.dailyRate }}%</span>
            <span class="p-sep">·</span>
            <span class="p-order">订单 {{ p.orderRate }}%</span>
          </div>
        </div>

        <!-- 展开的机手明细 -->
        <div v-if="isProductExpanded(p) && p.operators && p.operators.length" class="p-operator-detail">
          <div v-for="(op, oi) in p.operators" :key="oi" class="op-row">
            <span class="op-name">{{ op.operatorName || '——' }}</span>
            <span class="op-machines" :title="(op.machines || []).join('、')">{{ (op.machines || []).join('、') }}</span>
            <span class="op-qty">目标 {{ (op.targetQty || 0).toLocaleString() }}</span>
            <span class="p-sep">/</span>
            <span class="op-qty">实际 {{ (op.actualQty || 0).toLocaleString() }}</span>
            <span class="p-sep">·</span>
            <span class="op-rate" :class="opRateClass(op.dailyRate || 0)">{{ op.dailyRate || 0 }}%</span>
          </div>
        </div>
        <div v-else-if="isProductExpanded(p) && (!p.operators || !p.operators.length)" class="p-operator-detail">
          <div class="op-row op-row-empty">无机手数据</div>
        </div>
      </div>
    </div>

    <!-- 展开/折叠全部 -->
    <div v-if="moreCount > 0 && !expanded" class="p-more" @click="expanded = true">
      还有 {{ moreCount }} 个产品 →
    </div>
    <div v-if="expanded && moreCount > 0" class="p-more" @click="expanded = false">
      收起 ↑
    </div>
  </div>
</template>

<style scoped>
.product-block {
  background: var(--bg-card);
  border-radius: var(--radius-md);
  padding: 12px 16px;
  box-shadow: var(--shadow-sm);
}

.product-block-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.product-block-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.product-block-count {
  font-size: 11px;
  color: var(--text-muted);
  background: #F1F5F9;
  padding: 2px 8px;
  border-radius: 8px;
}

.product-block-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.product-block-item {
  border-bottom: 1px dashed #F1F5F9;
}
.product-block-item:last-child {
  border-bottom: none;
}

/* ===== 产品主行 ===== */
.p-main-row {
  padding: 6px 0 6px 0;
  cursor: pointer;
  user-select: none;
}

.p-name-line {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 2px;
}

.p-expand-icon {
  font-size: 9px;
  color: #94A3B8;
  flex-shrink: 0;
  width: 12px;
  text-align: center;
}

.p-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.p-meta-line {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--text-secondary, #64748B);
  padding-left: 16px;
}

.p-machines {
  color: var(--text-muted, #94A3B8);
  max-width: 140px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.p-sep {
  color: #CBD5E1;
}

.p-qty {
  font-variant-numeric: tabular-nums;
}

.p-rate {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.p-rate-good { color: #22C55E; }
.p-rate-mid { color: #F59E0B; }
.p-rate-low { color: #EF4444; }

.p-order {
  color: #8B5CF6;
  font-weight: 500;
}

/* ===== 机手明细行 ===== */
.p-operator-detail {
  padding: 2px 0 6px 16px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.op-row {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-secondary, #64748B);
  padding: 2px 8px;
  background: #F8FAFC;
  border-radius: 4px;
}

.op-row-empty {
  color: #94A3B8;
  font-style: italic;
  background: transparent;
  padding: 2px 8px;
}

.op-name {
  font-weight: 600;
  color: #6366F1;
  white-space: nowrap;
  flex-shrink: 0;
}

.op-machines {
  color: var(--text-muted, #94A3B8);
  max-width: 120px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.op-qty {
  font-variant-numeric: tabular-nums;
}

.op-rate {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.op-rate-good { color: #22C55E; }
.op-rate-mid { color: #F59E0B; }
.op-rate-low { color: #EF4444; }

/* ===== 展开/折叠全部 ===== */
.p-more {
  font-size: 12px;
  color: #3B82F6;
  cursor: pointer;
  text-align: center;
  padding: 6px 0 2px;
  user-select: none;
}
.p-more:hover {
  color: #2563EB;
  text-decoration: underline;
}

@media (max-width: 768px) {
  .product-block {
    padding: 10px 12px;
  }
  .product-block-title {
    font-size: 13px;
  }
  .p-name {
    font-size: 12px;
  }
  .p-meta-line {
    font-size: 11px;
  }
  .op-row {
    font-size: 10px;
    flex-wrap: wrap;
  }
}
</style>
