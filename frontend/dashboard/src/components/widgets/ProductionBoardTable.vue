<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { saveProductionNote, deleteProductionNote } from '../../api/monitor.js'

const props = defineProps({
  rows: { type: Array, default: () => [] },
  view: { type: String, default: 'shift' }, // 'shift' 班次维度 | 'day' 日维度
  // 损耗数据：moNumber -> { billNo, fstatus, lossRate, entries[], ... }（来自 /mo-loss）
  lossMap: { type: Object, default: () => ({}) },
})

const emit = defineEmits(['open-loss'])

// 损耗率有意义的订单状态（>=完工）；生产中途损耗率虚高不展示
const FINAL_LOSS_STATUSES = ['完工', '结案', '结算']

/** 某行包含的订单号列表：日维度 \n 多值；班次维度单值（罕见 '、' 多订单合并不关联损耗） */
function rowMoList(row) {
  const raw = String(row.moNumber || '').trim()
  if (!raw) return []
  if (props.view === 'day') return raw.split('\n').map((s) => s.trim()).filter(Boolean)
  return raw.includes('、') ? [] : [raw]
}

/** 损耗率是否超出正常范围（>10% 或 <-10%，数据异常需提醒） */
function lossIsAbnormal(rateStr) {
  if (rateStr == null) return false
  const n = parseFloat(String(rateStr).replace('%', ''))
  return !Number.isNaN(n) && (n > 10 || n < -10)
}

/**
 * 某行损耗展示行：条袋产品行 → 每个订单号一行 { mo, rate, hasRec, abnormal }
 * rate 仅订单完工+且有值；中途/无数据/'-'(实际用量0) → null（单元格显示 —）
 * 与「生产订单编号」列的多值行一一对齐
 */
function lossLines(row) {
  if (!String(row.product || '').includes('袋')) return [] // 仅含"袋"的袋装系列可能查损耗
  return rowMoList(row).map((mo) => {
    const rec = props.lossMap[mo]
    const hasRec = !!(rec && rec.billNo)
    let rate = null
    if (hasRec && FINAL_LOSS_STATUSES.includes(rec.fstatus)) {
      const r = rec.lossRate
      if (r != null && r !== '' && r !== '-') rate = r
    }
    return { mo, rate, hasRec, abnormal: rate ? lossIsAbnormal(rate) : false }
  })
}

/** 班次维度列定义（editable 的两列在看板内手工录入，存 production_notes 表；bold 关键列；wan 累计产量转万袋） */
const shiftColumns = [
  { key: 'customer', label: '客户名称', bold: true, frozen: true },
  { key: 'product', label: '产品名称', bold: true, wrapText: true, minW: 150, frozen: true },
  { key: 'salesOrderNo', label: '销售订单编号' },
  { key: 'moNumber', label: '生产订单编号' },
  { key: 'workshop', label: '车间名称' },
  { key: 'machine', label: '设备' },
  { key: 'fdate', label: '生产日期' },
  { key: 'shift', label: '班次' },
  { key: 'process', label: '工序说明' },
  { key: 'targetQty', label: '本班目标产量', num: true },
  { key: 'actualQty', label: '本班实际产量', num: true },
  { key: 'defectQty', label: '不合格条袋数量', num: true },
  { key: 'regularHours', label: '正式工工时', num: true },
  { key: 'tempHours', label: '派遣工工时', num: true },
  { key: 'hourlyRate', label: '单位小时产量', num: true },
  { key: 'oes', label: 'OES(考核指标)', rate: true, warnOver100: true },
  { key: 'oee', label: 'OEE', rate: true },
  { key: 'qualifyRate', label: '合格率', rate: true },
  { key: 'operator', label: '操作人员' },
  { key: 'rate', label: '班次达产率', rate: true },
  { key: 'cumQty', label: '累计产量(万袋)', num: true, wan: true },
  { key: 'instantRate', label: '即时达产率', rate: true },
  { key: 'projectRate', label: '项目完成率', rate: true },
  { key: 'lossRate', label: '损耗率', loss: true, minW: 90, title: '订单完工后显示损耗率，点击看用料明细' },
  { key: 'reason', label: '未达产原因', editable: true, wrap: true },
  { key: 'recoveryPlan', label: '后续补产方案', editable: true, wrap: true },
]

/** 日维度列定义（白班+晚班合并；无班次/工序列；设备/人员/车间/订单号等多值列换行展示） */
const dayColumns = [
  { key: 'customer', label: '客户名称', bold: true, multi: true, minW: 200, frozen: true },
  { key: 'product', label: '产品名称', bold: true, wrapText: true, minW: 150, frozen: true },
  { key: 'salesOrderNo', label: '销售订单编号', multi: true, minW: 120 },
  { key: 'moNumber', label: '生产订单编号', multi: true, minW: 120 },
  { key: 'workshop', label: '车间名称', multi: true, minW: 120 },
  { key: 'machine', label: '设备', multi: true, minW: 120 },
  { key: 'fdate', label: '生产日期', dateRange: true },
  { key: 'targetQty', label: '目标产量', num: true },
  { key: 'actualQty', label: '实际产量', num: true },
  { key: 'defectQty', label: '不合格条袋数量', num: true },
  { key: 'powerKwh', label: '用电量(kWh)', num: true },
  { key: 'regularHours', label: '正式工工时', num: true },
  { key: 'tempHours', label: '派遣工工时', num: true },
  { key: 'hourlyRate', label: '单位小时产量', num: true },
  { key: 'oes', label: 'OES(考核指标)', rate: true, warnOver100: true },
  { key: 'oee', label: 'OEE', rate: true },
  { key: 'qualifyRate', label: '合格率', rate: true },
  { key: 'mixingOperators', label: '配料人员', multi: true },
  { key: 'operator', label: '灌装人员', multi: true },
  { key: 'rate', label: '达产率', rate: true },
  { key: 'cumQty', label: '累计产量(万袋)', num: true, wan: true },
  { key: 'instantRate', label: '即时达产率', rate: true },
  { key: 'projectRate', label: '项目完成率', rate: true },
  { key: 'lossRate', label: '损耗率', loss: true, minW: 90, title: '多订单行与订单编号对齐显示各单损耗率，点击看用料明细' },
  { key: 'reason', label: '未达产原因', editable: true, wrap: true },
  { key: 'recoveryPlan', label: '后续补产方案', editable: true, wrap: true },
]

const isDay = computed(() => props.view === 'day')
const columns = computed(() => (isDay.value ? dayColumns : shiftColumns))
const tableTitle = computed(() => (isDay.value ? '生产执行记录（日维度）' : '生产执行记录（班次维度）'))

// ====== 列隐藏（localStorage 持久化，按视图区分 key） ======

const LS_KEY = computed(() => `productionBoard.hiddenColumns.${props.view}`)
const hiddenColumns = ref([])
const panelOpen = ref(false)
const panelRef = ref(null)

const hiddenSet = computed(() => new Set(hiddenColumns.value))
const visibleColumns = computed(() => columns.value.filter((c) => !hiddenSet.value.has(c.key)))
// 隐藏列后按可见列数收窄最小宽度，避免空转横向滚动（下限 600px）
const tableMinWidth = computed(() => `${Math.max(visibleColumns.value.length * 88, 600)}px`)

// ====== 冻结列（客户名称 + 产品名称）：第二个冻结列需偏移到前一个冻结列宽度之后 ======
const tableRef = ref(null)
const frozenSet = computed(() => new Set(visibleColumns.value.filter((c) => c.frozen).map((c) => c.key)))
const frozenLefts = ref({}) // key -> left px（由实际渲染宽度测量）

function measureFrozen() {
  nextTick(() => {
    const el = tableRef.value
    if (!el) return
    const ths = el.querySelectorAll('thead th')
    const map = {}
    let acc = 0
    for (const th of ths) {
      const key = th.getAttribute('data-col')
      if (key && frozenSet.value.has(key)) {
        map[key] = acc
        acc += th.offsetWidth
      }
    }
    frozenLefts.value = map
  })
}

function cellStyle(col) {
  const s = {}
  if (col.minW) s.minWidth = col.minW + 'px'
  if (col.frozen) s.left = (frozenLefts.value[col.key] ?? 0) + 'px'
  return Object.keys(s).length ? s : null
}

function loadHidden() {
  try {
    const raw = localStorage.getItem(LS_KEY.value)
    if (raw) hiddenColumns.value = JSON.parse(raw)
  } catch (e) {
    hiddenColumns.value = []
  }
}
function saveHidden() {
  try {
    localStorage.setItem(LS_KEY.value, JSON.stringify(hiddenColumns.value))
  } catch (e) {}
}
function toggleColumn(key) {
  const isHidden = hiddenColumns.value.includes(key)
  if (!isHidden && visibleColumns.value.length <= 1) return // 至少保留一列
  hiddenColumns.value = isHidden
    ? hiddenColumns.value.filter((k) => k !== key)
    : [...hiddenColumns.value, key]
  saveHidden()
}
function showAll() {
  hiddenColumns.value = []
  saveHidden()
}
function onDocClick(e) {
  if (panelOpen.value && panelRef.value && !panelRef.value.contains(e.target)) {
    panelOpen.value = false
  }
}
function onKeydown(e) {
  if (e.key === 'Escape') panelOpen.value = false
}

// 行唯一 key：fdate|moNumber|shift|machine|operator（与后端 production_notes 一致）
function rowKey(row) {
  return [row.fdate, row.moNumber, row.shift || '', row.machine || '', row.operator || ''].join('|')
}

function fmtNum(v) {
  return v == null || v === '' ? '—' : Number(v).toLocaleString()
}
function fmtWan(v) {
  return v == null || v === '' ? '—' : (v / 10000).toFixed(2)
}
function fmtRate(v) {
  return v == null ? '—' : `${v}%`
}
function rateClass(v) {
  if (v == null) return ''
  return v >= 85 ? 't-rate-good' : v >= 70 ? 't-rate-mid' : 't-rate-low'
}

function round1(v) {
  return Math.round(v * 10) / 10
}

// ====== 底部合计行：按当前筛选后的行汇总 ======
// 班次维度：达产率/即时达产率按「总量相除」聚合（目标去重，多设备班次目标只算一次）；
// 日维度：行已聚合，直接 Σ实际 ÷ Σ目标。
// 累计产量合计 = 筛选期内实际产量之和；OES/OEE/合格率按实际产量加权；项目完成率合计取消
const totals = computed(() => {
  const t = { targetQty: 0, actualQty: 0, defectQty: 0, powerKwh: 0, cumQty: 0, cumTarget: 0, regularHours: 0, tempHours: 0 }
  let oesW = 0, oeeW = 0, qualW = 0, wD = 0
  for (const r of props.rows) {
    t.targetQty += r.targetQty || 0
    t.actualQty += r.actualQty || 0
    t.defectQty += r.defectQty || 0
    t.powerKwh += r.powerKwh || 0
    t.regularHours += r.regularHours || 0
    t.tempHours += r.tempHours || 0
    const aq = r.actualQty || 0
    if (aq > 0) {
      oesW += (r.oes || 0) * aq
      oeeW += (r.oee || 0) * aq
      qualW += (r.qualifyRate || 0) * aq
      wD += aq
    }
  }
  // 累计产量合计 = 筛选期内实际产量之和（不按各订单历史累计求和）
  t.cumQty = t.actualQty
  t.oes = wD > 0 && oesW > 0 ? round1(oesW / wD) : null
  t.oee = wD > 0 && oeeW > 0 ? round1(oeeW / wD) : null
  t.qualifyRate = wD > 0 && qualW > 0 ? round1(qualW / wD) : null
  // 单位小时产量合计 = Σ实际产量 ÷ Σ(正式工+派遣工工时)
  t.hourlyRate = (t.regularHours + t.tempHours) > 0 ? round1(t.actualQty / (t.regularHours + t.tempHours)) : null

  if (isDay.value) {
    // 日维度：行已按产品×时段聚合 → 达产率/即时达产率 = Σ实际 ÷ Σ目标
    t.rate = t.targetQty > 0 ? round1((t.actualQty / t.targetQty) * 100) : null
    t.instantRate = t.rate
  } else {
    // 班次维度：目标去重（多设备班次目标不重复计）；即时达产率按班次累计只取一次
    const shiftTargets = new Map() // key: mo|fdate|shift -> Set<target>
    const shiftCum = new Map() // key: mo|fdate|shift -> { qty, target }
    for (const r of props.rows) {
      const sk = `${r.moNumber}|${r.fdate}|${r.shift || ''}`
      if (!shiftTargets.has(sk)) shiftTargets.set(sk, new Set())
      if (r.targetQty > 0) shiftTargets.get(sk).add(r.targetQty)
      if (!shiftCum.has(sk)) shiftCum.set(sk, { qty: r.cumQty || 0, target: r.cumTarget || 0 })
    }
    let totalTarget = 0
    for (const ts of shiftTargets.values()) {
      const tList = [...ts]
      totalTarget += tList.length === 1 ? tList[0] : tList.reduce((s, x) => s + x, 0)
    }
    t.rate = totalTarget > 0 ? round1((t.actualQty / totalTarget) * 100) : null
    let totQ = 0, totT = 0
    for (const v of shiftCum.values()) { totQ += v.qty; totT += v.target }
    t.instantRate = totT > 0 ? round1((totQ / totT) * 100) : null
  }
  return t
})

// 单位小时产量 = 本班实际产量 ÷ (正式工工时 + 派遣工工时)；工时合计为 0 → null（显示 —）
const displayRows = computed(() => props.rows.map((r) => {
  const hours = (r.regularHours || 0) + (r.tempHours || 0)
  return { ...r, hourlyRate: hours > 0 ? round1((r.actualQty || 0) / hours) : null }
}))

// ====== 可编辑单元格（未达产原因 / 补产方案） ======

const editing = ref(null) // { key, field, value } | null
const saving = ref(false)
const savedKey = ref('') // 最近保存成功的行 key，用于短暂提示
const savedIsDelete = ref(false) // 最近一次是删除（提示"已删除"）

let flashTimer = null

function startEdit(row, field) {
  editing.value = { key: rowKey(row), field, value: row[field] || '' }
  nextTick(() => {
    const el = document.querySelector('.pb-edit-input')
    if (el) {
      el.focus()
      autoResize(el)
    }
  })
}

// 编辑框随内容自动增高
function autoResize(el) {
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
}

async function commitEdit(row) {
  if (!editing.value) return
  const { key, field, value } = editing.value
  const newVal = (value || '').trim()
  const prevVal = row[field] // 编辑前的值
  editing.value = null
  if (row[field] === newVal) return // 无变化

  row[field] = newVal
  saving.value = true
  try {
    const reason = (row.reason || '').trim()
    const recoveryPlan = (row.recoveryPlan || '').trim()
    // 合并行含多个组成 key（_keys），逐行保存/删除笔记；未合并行仅 1 个 key
    const keys = (row._keys && row._keys.length) ? row._keys : [[row.fdate, row.moNumber, row.shift || '', row.machine || '', row.operator || '']]
    if (!reason && !recoveryPlan) {
      // 未达产原因/补产方案均清空 → 删除该行（及各组成行）笔记
      for (const k of keys) {
        await deleteProductionNote({ fdate: k[0], moNumber: k[1], shift: k[2], machine: k[3], operator: k[4] })
      }
      savedIsDelete.value = true
    } else {
      // 至少一列有内容 → 保存（清空的列写空串，另一列保留）
      for (const k of keys) {
        await saveProductionNote({
          fdate: k[0], moNumber: k[1], shift: k[2], machine: k[3], operator: k[4],
          workshop: row.workshop,
          reason,
          recoveryPlan,
        })
      }
      savedIsDelete.value = false
    }
    savedKey.value = `${key}|${field}`
    clearTimeout(flashTimer)
    flashTimer = setTimeout(() => { savedKey.value = '' }, 2000)
  } catch (err) {
    console.error('[board] 笔记保存失败:', err)
    row[field] = prevVal || '' // 保存/删除失败还原为编辑前的值
  }
  saving.value = false
}

function cancelEdit() {
  editing.value = null
}

onMounted(() => {
  loadHidden()
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', measureFrozen)
  measureFrozen()
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', measureFrozen)
})

// 列可见性 / 数据变化 / 视图切换时重新测量冻结列偏移
watch(visibleColumns, () => measureFrozen())
watch(() => props.rows, () => measureFrozen(), { deep: true })
watch(() => props.view, () => measureFrozen())
</script>

<template>
  <div class="pb-block">
    <!-- 标题栏 + 计数 + 列设置 -->
    <div class="pb-header">
      <span class="pb-title">{{ tableTitle }}</span>
      <div class="pb-header-right">
        <span class="pb-count">{{ rows.length }} 条</span>
        <div class="pb-colset" ref="panelRef">
          <button
            class="pb-colset-btn"
            :class="{ open: panelOpen }"
            @click.stop="panelOpen = !panelOpen"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            列设置
          </button>
          <div v-if="panelOpen" class="pb-colset-panel">
            <div v-for="col in columns" :key="col.key" class="pb-colset-item">
              <label class="pb-colset-label">
                <input
                  type="checkbox"
                  :checked="!hiddenSet.has(col.key)"
                  :disabled="visibleColumns.length <= 1 && !hiddenSet.has(col.key)"
                  @change="toggleColumn(col.key)"
                />
                <span>{{ col.label }}</span>
              </label>
            </div>
            <div class="pb-colset-footer">
              <button class="pb-colset-reset" @click="showAll">全部显示</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="pb-scroll">
      <table ref="tableRef" class="pb-table" :style="{ minWidth: tableMinWidth }">
        <thead>
          <tr>
            <th
              v-for="(col, i) in visibleColumns"
              :key="col.key"
              :data-col="col.key"
              :style="cellStyle(col)"
              :class="[col.frozen ? 'col-frozen' : '', col.num ? 'col-num' : '', col.rate ? 'col-rate' : '']"
            >{{ col.label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="rows.length === 0">
            <td :colspan="visibleColumns.length" class="pb-empty">所选时间范围内暂无生产记录</td>
          </tr>
          <tr v-for="(row, idx) in displayRows" :key="rowKey(row) + idx">
            <td v-for="(col, i) in visibleColumns" :key="col.key" :style="cellStyle(col)" :class="[col.frozen ? 'col-frozen' : '', col.num ? 'col-num' : '', col.rate ? 'col-rate' : '', col.wrap ? 'col-wrap' : '']">
              <!-- 可编辑列 -->
              <template v-if="col.editable">
                <div
                  v-if="editing && editing.key === rowKey(row) && editing.field === col.key"
                  class="pb-edit-wrap"
                >
                  <textarea
                    v-model="editing.value"
                    class="pb-edit-input"
                    rows="1"
                    :placeholder="col.key === 'reason' ? '未达产原因' : '补产方案'"
                    @input="autoResize($event.target)"
                    @keydown.enter.exact.prevent="commitEdit(row)"
                    @keydown.esc.prevent="cancelEdit"
                    @blur="commitEdit(row)"
                  ></textarea>
                </div>
                <div v-else class="pb-edit-cell" @click="startEdit(row, col.key)">
                  <span :class="{ 'pb-saved': savedKey === rowKey(row) + '|' + col.key }">
                    {{ row[col.key] || '—' }}
                  </span>
                  <span v-if="savedKey === rowKey(row) + '|' + col.key" class="pb-saved-tag">{{ savedIsDelete ? '已删除' : '已保存' }}</span>
                </div>
              </template>
              <!-- 速率列（着色；超过100%的OES加红色感叹号提醒数据异常） -->
              <span v-else-if="col.rate" :class="rateClass(row[col.key])">
                {{ fmtRate(row[col.key]) }}
                <span v-if="col.warnOver100 && (row[col.key] || 0) > 100" class="pb-warn-100" title="数据异常：超过100%">!</span>
              </span>
              <!-- 数值列（万袋 / 常规） -->
              <span v-else-if="col.num" class="pb-num">{{ col.wan ? fmtWan(row[col.key]) : fmtNum(row[col.key]) }}</span>
              <!-- 损耗率列：条袋行按订单号逐行显示损耗率（仅完工+），点击对应订单看用料明细 -->
              <span v-else-if="col.loss" class="pb-text pb-loss-cell">
                <template v-if="lossLines(row).length">
                  <button
                    v-for="(li, liIdx) in lossLines(row)"
                    :key="liIdx"
                    class="pb-loss-link"
                    :class="{ 'pb-loss-warn': li.abnormal }"
                    :title="li.abnormal ? '损耗率 ' + li.rate + ' 超出正常范围(>10% 或 <-10%)' : '生产订单 ' + li.mo"
                    @click.stop="emit('open-loss', li.mo)"
                  >
                    <span class="pb-loss-val">{{ li.rate || '—' }}</span>
                    <span v-if="li.abnormal" class="pb-loss-warn-ic" title="损耗率异常">!</span>
                    <svg v-else-if="li.rate" class="pb-loss-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>
                  </button>
                </template>
                <span v-else>—</span>
              </span>
              <!-- 文本列（multi 多值列：\n 拼接 → 换行展示；wrapText 产品名称 → 换行完整显示不省略；dateRange 生产日期周/月 → 起~止） -->
              <span v-else class="pb-text" :class="{ 'pb-bold': col.bold, 'pb-multi': col.multi, 'pb-wrap-text': col.wrapText }" :title="row[col.key]">{{ (col.dateRange && row.dateRange) || row[col.key] || '—' }}</span>
            </td>
          </tr>
        </tbody>
        <!-- 底部合计行（仅数据列有值，首列显示「合计」标签） -->
        <tfoot v-if="rows.length > 0">
          <tr class="pb-total-row">
            <td v-for="(col, i) in visibleColumns" :key="col.key" :style="cellStyle(col)" :class="[col.frozen ? 'col-frozen' : '', col.num ? 'col-num' : '', col.rate ? 'col-rate' : '']">
              <span v-if="i === 0" class="pb-total-label">合计</span>
              <!-- 项目完成率合计取消，不计算不显示 -->
              <span v-else-if="col.rate && col.key !== 'projectRate'" :class="rateClass(totals[col.key])">
                {{ fmtRate(totals[col.key]) }}
                <span v-if="col.warnOver100 && (totals[col.key] || 0) > 100" class="pb-warn-100" title="数据异常：超过100%">!</span>
              </span>
              <span v-else-if="col.num" class="pb-num">{{ col.wan ? fmtWan(totals[col.key]) : fmtNum(totals[col.key]) }}</span>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
</template>

<style scoped>
.pb-block {
  background: var(--bg-card);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
}

/* 标题栏 */
.pb-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-color, #E2E8F0);
}

.pb-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.pb-header-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pb-count {
  font-size: 11px;
  color: var(--text-muted);
  background: #F1F5F9;
  padding: 2px 8px;
  border-radius: 8px;
}

/* 列设置按钮 + 下拉面板 */
.pb-colset {
  position: relative;
}

.pb-colset-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border: 1px solid var(--border-color, #E2E8F0);
  border-radius: 6px;
  background: var(--bg-card);
  color: var(--text-primary, #1E293B);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}
.pb-colset-btn:hover,
.pb-colset-btn.open {
  color: var(--primary, #3B82F6);
  border-color: var(--primary, #3B82F6);
}

.pb-colset-panel {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  width: 220px;
  max-height: 420px;
  overflow-y: auto;
  background: #fff;
  border: 1px solid var(--border-color, #E2E8F0);
  border-radius: 8px;
  box-shadow: var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.12));
  padding: 8px;
  z-index: 50;
}

.pb-colset-item {
  padding: 2px 4px;
}

.pb-colset-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-primary, #1E293B);
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 4px;
}
.pb-colset-label:hover {
  background: #F8FAFC;
}
.pb-colset-label input {
  accent-color: var(--primary, #1E40AF);
  cursor: pointer;
  flex-shrink: 0;
}
.pb-colset-label input:disabled {
  cursor: not-allowed;
}

.pb-colset-footer {
  border-top: 1px solid var(--border-color, #E2E8F0);
  margin-top: 6px;
  padding-top: 6px;
  text-align: center;
}
.pb-colset-reset {
  font-size: 12px;
  color: var(--primary, #3B82F6);
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 10px;
}
.pb-colset-reset:hover {
  text-decoration: underline;
}

/* 横向滚动容器 + 限高：数据多时内部纵向滚动，合计行/滚动条固定在卡片底部 */
.pb-scroll {
  overflow-x: auto;
  overflow-y: auto;
  max-height: 60vh;
  -webkit-overflow-scrolling: touch;
}

.pb-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12px;
}

.pb-table th {
  position: sticky;
  top: 0;
  z-index: 3;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted, #94A3B8);
  background: #F8FAFC;
  padding: 8px 10px;
  text-align: left;
  white-space: nowrap;
  border-bottom: 1px solid var(--border-color, #E2E8F0);
}

.pb-table td {
  padding: 8px 10px;
  border-bottom: 1px solid #F1F5F9;
  vertical-align: middle;
  white-space: nowrap;
}

.pb-table tbody tr:last-child td {
  border-bottom: none;
}

.pb-table tbody tr:hover {
  background: #F8FAFC;
}

/* 首列冻结（横向滚动时第一可见列保持可见） */
.col-frozen {
  position: sticky;
  left: 0;
  z-index: 2;
  background: #fff;
  box-shadow: 1px 0 0 #F1F5F9;
}
.pb-table th.col-frozen {
  z-index: 4;
  background: #F8FAFC;
}
.pb-table tbody tr:hover .col-frozen {
  background: #F8FAFC;
}

/* 底部合计行：sticky bottom 钉在滚动区底部，纵向滚动时始终可见 */
.pb-total-row td {
  position: sticky;
  bottom: 0;
  z-index: 5;
  font-weight: 600;
  color: var(--text-primary);
  background: #F8FAFC;
  border-top: 2px solid var(--border-color, #E2E8F0);
}
.pb-total-label {
  font-weight: 700;
  color: var(--text-primary, #1E293B);
}
.pb-total-row td.col-frozen {
  position: sticky;
  left: 0;
  bottom: 0;
  z-index: 6;
  background: #F8FAFC;
}

.col-num { text-align: right; }
.col-rate { text-align: right; }

/* 长文本列：自动换行（table-cell 不受 max-width 约束，
   列宽由内层固定宽度块 .pb-edit-cell 决定，文本换行、行高自适应） */
.col-wrap {
  white-space: normal;
  word-break: break-word;
}

.pb-text {
  color: var(--text-primary, #1E293B);
  display: inline-block;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: bottom;
}
.pb-bold {
  font-weight: 600;
}
/* 产品名称：换行完整显示（不省略号截断），限宽防撑爆列宽 */
.pb-wrap-text {
  white-space: normal;
  word-break: break-word;
  max-width: 220px;
  overflow: visible;
  text-overflow: clip;
  line-height: 1.4;
  vertical-align: bottom;
}
/* 多值列（日维度 设备/人员/车间/订单号 等 \n 拼接）：换行展示、限宽、行高自适应 */
.pb-multi {
  white-space: pre-wrap;
  word-break: break-word;
  max-width: 180px;
  line-height: 1.4;
  overflow: visible;
  text-overflow: clip;
}

.pb-num {
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.t-rate-good { color: #22C55E; font-weight: 600; font-variant-numeric: tabular-nums; }
.t-rate-mid { color: #F59E0B; font-weight: 600; font-variant-numeric: tabular-nums; }
.t-rate-low { color: #EF4444; font-weight: 600; font-variant-numeric: tabular-nums; }

/* OES 超过 100% 的红色感叹号（数据异常提醒） */
.pb-warn-100 {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  margin-left: 4px;
  border-radius: 50%;
  background: #EF4444;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  vertical-align: middle;
  cursor: help;
}

/* 可编辑单元格（未达产原因/补产方案）：固定宽度块 → 无论文本多长都强制换行，行高自适应 */
.pb-edit-cell {
  cursor: pointer;
  min-height: 20px;
  color: var(--text-primary, #1E293B);
  border-radius: 4px;
  padding: 1px 4px;
  margin: -1px -4px;
  width: 200px;
  box-sizing: border-box;
  white-space: normal;
  word-break: break-word;
  line-height: 1.5;
}
.pb-edit-cell:hover {
  background: #EFF6FF;
  color: var(--primary, #1E40AF);
}
.pb-saved {
  color: #22C55E;
}
.pb-saved-tag {
  margin-left: 4px;
  font-size: 10px;
  color: #22C55E;
  background: #ECFDF5;
  border-radius: 4px;
  padding: 1px 5px;
}
.pb-edit-wrap {
  display: inline-flex;
}
.pb-edit-input {
  width: 200px;
  max-width: 60vw;
  min-height: 24px;
  padding: 3px 8px;
  border: 1px solid var(--primary, #3B82F6);
  border-radius: 5px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-primary);
  outline: none;
  background: #fff;
  resize: none;
  overflow: hidden;
  vertical-align: top;
  font-family: inherit;
}

.pb-empty {
  text-align: center;
  color: var(--text-muted, #94A3B8);
  padding: 32px 0 !important;
  white-space: normal !important;
}

@media (max-width: 768px) {
  .pb-header {
    padding: 8px 12px;
  }
  .pb-scroll { max-height: 55vh; }
  .pb-table { font-size: 11px; }
  .pb-table th { font-size: 10px; padding: 6px 8px; }
  .pb-table td { padding: 6px 8px; }
  .pb-text { max-width: 120px; }
}

/* 损耗率列：多订单行(日维度) 每单损耗纵向排列，与订单编号列对齐 */
.pb-loss-cell { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
.pb-loss-link {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  border: none;
  border-radius: 4px;
  background: #EFF6FF;
  color: #1D4ED8;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
  white-space: nowrap;
}
.pb-loss-link:hover { background: #DBEAFE; }
.pb-loss-link:disabled { background: #F1F5F9; color: #94A3B8; cursor: default; }
.pb-loss-arrow { flex-shrink: 0; }
/* 损耗率超正常范围(>10% 或 <-10%)：红底警示 */
.pb-loss-link.pb-loss-warn { background: #FEE2E2; color: #B91C1C; }
.pb-loss-link.pb-loss-warn:hover { background: #FECACA; }
.pb-loss-warn-ic {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #B91C1C;
  color: #fff;
  font-size: 9px;
  font-weight: 800;
  line-height: 1;
  flex-shrink: 0;
}
</style>
