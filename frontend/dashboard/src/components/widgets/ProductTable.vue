<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  products: { type: Array, default: () => [] },
  title: { type: String, default: '当前生产产品' },
})

const expanded = ref(false)

const displayList = computed(() => {
  if (expanded.value) return props.products
  return props.products.slice(0, 5)
})
const moreCount = computed(() => Math.max(0, props.products.length - 5))

function rateClass(val) {
  if (val >= 85) return 't-rate-good'
  if (val >= 70) return 't-rate-mid'
  return 't-rate-low'
}
</script>

<template>
  <div v-if="products.length > 0" class="product-table-block">
    <div class="pt-header">
      <span class="pt-title">{{ title }}</span>
      <span class="pt-count">{{ products.length }} 个</span>
    </div>

    <div class="pt-scroll">
      <table class="pt-table">
        <thead>
          <tr>
            <th class="col-name">产品名称</th>
            <th class="col-machine">设备</th>
            <th class="col-num">产量目标</th>
            <th class="col-num">实际产量</th>
            <th class="col-rate">班次完成率</th>
            <th class="col-rate">订单完成率</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(p, i) in displayList" :key="i">
            <td class="col-name pt-name" :title="p.productName">{{ p.productName }}</td>
            <td class="col-machine pt-machines" :title="(p.machines || []).join('、')">{{ (p.machines || []).join('、') }}</td>
            <td class="col-num pt-qty">{{ (p.targetQty || 0).toLocaleString() }}</td>
            <td class="col-num pt-qty">{{ (p.actualQty || 0).toLocaleString() }}</td>
            <td class="col-rate pt-rate" :class="rateClass(p.dailyRate)">{{ p.dailyRate || 0 }}%</td>
            <td class="col-rate pt-order">{{ p.orderRate || 0 }}%</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="moreCount > 0 && !expanded" class="pt-more" @click="expanded = true">
      还有 {{ moreCount }} 个产品 →
    </div>
    <div v-if="expanded && moreCount > 0" class="pt-more" @click="expanded = false">
      收起 ↑
    </div>
  </div>
</template>

<style scoped>
.product-table-block {
  background: var(--bg-card);
  border-radius: var(--radius-md);
  padding: 12px 16px;
  box-shadow: var(--shadow-sm);
}

.pt-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.pt-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.pt-count {
  font-size: 11px;
  color: var(--text-muted);
  background: #F1F5F9;
  padding: 2px 8px;
  border-radius: 8px;
}

/* 横向滚动容器：移动端可左右滑动查看全部列 */
.pt-scroll {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.pt-table {
  width: 100%;
  min-width: 640px;
  border-collapse: collapse;
  font-size: 12px;
}

.pt-table th {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted, #94A3B8);
  background: #F8FAFC;
  padding: 7px 8px;
  text-align: left;
  white-space: nowrap;
  border-bottom: 1px solid var(--border-color, #E2E8F0);
}

.pt-table td {
  padding: 8px;
  border-bottom: 1px solid #F1F5F9;
  vertical-align: middle;
}

.pt-table tbody tr:last-child td {
  border-bottom: none;
}

.pt-table tbody tr:hover {
  background: #F8FAFC;
}

.col-name { width: 28%; }
.col-machine { width: 22%; }
/* 特异性需覆盖 .pt-table th 的 text-align: left，否则表头数字列左对齐、内容右对齐，错位 */
.pt-table .col-num { width: 13%; text-align: right; }
.pt-table .col-rate { width: 12%; text-align: right; }

.pt-name {
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 0;
}

.pt-machines {
  color: var(--text-secondary, #64748B);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 0;
}

.pt-qty {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.pt-rate {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.t-rate-good { color: #22C55E; }
.t-rate-mid { color: #F59E0B; }
.t-rate-low { color: #EF4444; }

.pt-order {
  color: #8B5CF6;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* 展开/折叠全部 */
.pt-more {
  font-size: 12px;
  color: #3B82F6;
  cursor: pointer;
  text-align: center;
  padding: 8px 0 2px;
  user-select: none;
}
.pt-more:hover {
  color: #2563EB;
  text-decoration: underline;
}

@media (max-width: 768px) {
  .product-table-block {
    padding: 10px 12px;
  }
  .pt-title {
    font-size: 13px;
  }
  .pt-table {
    font-size: 11px;
  }
  .pt-table th {
    font-size: 10px;
    padding: 6px;
  }
  .pt-table td {
    padding: 6px;
  }
}
</style>
