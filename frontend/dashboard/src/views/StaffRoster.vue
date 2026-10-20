<script setup>
/**
 * 人员名单（钉钉通讯录）
 *
 * 数据范围固定：生产部（内包）+ 生产部（外包）两个子树，共 55 人。
 * 名字 / 岗位 / 入职时间来自钉钉，每天 7:30 同步；
 * 技能等级是本系统人工维护的，和「人员数据」页共用 staff.skill_level。
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import {
  fetchStaffRoster,
  fetchStaffOptions,
  saveStaffSkillLevel,
  syncStaffDirectory,
} from '../api/monitor.js'
import MetricCard from '../components/widgets/MetricCard.vue'
import StaffTabs from '../components/widgets/StaffTabs.vue'

const loading = ref(true)
const syncing = ref(false)
const loadError = ref('')
const syncError = ref('')
const data = ref(null)
const options = ref({ positions: [], skillLevels: [] })

const scope = ref('all')
const q = ref('')
// 清单上方的三个筛选
const positionFilter = ref('')   // 岗位（钉钉 title）
const hireStart = ref('')        // 入职时间起
const hireEnd = ref('')          // 入职时间止
const skillFilter = ref('')      // 技能等级
const EMPTY = '__empty__'        // 「未填」的筛选值

const rows = computed(() => (data.value && data.value.rows) || [])
const summary = computed(() => (data.value && data.value.summary) || {})

const scopeTabs = computed(() => [
  { key: 'all', label: '全部', count: summary.value.total || 0 },
  { key: 'inner', label: '内包', count: summary.value.inner || 0 },
  { key: 'outer', label: '外包', count: summary.value.outer || 0 },
])

/** 岗位下拉：从名单里动态取；有岗位为空的就追加「未填」 */
const positionOptions = computed(() => {
  const set = new Set()
  let hasEmpty = false
  for (const r of rows.value) {
    const t = String(r.title || '').trim()
    if (t) set.add(t)
    else hasEmpty = true
  }
  const list = [...set].sort((a, b) => a.localeCompare(b, 'zh'))
  if (hasEmpty) list.push(EMPTY)
  return list
})

const filteredRows = computed(() => {
  const s = scope.value
  const kw = q.value.trim()
  return rows.value.filter((r) => {
    if (s !== 'all' && r.scope !== s && r.scope !== 'both') return false
    if (kw && !String(r.name || '').includes(kw)) return false

    const title = String(r.title || '').trim()
    if (positionFilter.value === EMPTY) {
      if (title) return false
    } else if (positionFilter.value && title !== positionFilter.value) {
      return false
    }

    if (skillFilter.value === EMPTY) {
      if (r.skillLevel) return false
    } else if (skillFilter.value && r.skillLevel !== skillFilter.value) {
      return false
    }

    if (hireStart.value || hireEnd.value) {
      if (!r.hiredDate) return false
      if (hireStart.value && r.hiredDate < hireStart.value) return false
      if (hireEnd.value && r.hiredDate > hireEnd.value) return false
    }
    return true
  })
})

const hasActiveFilter = computed(() =>
  scope.value !== 'all' || !!q.value.trim() || !!positionFilter.value ||
  !!hireStart.value || !!hireEnd.value || !!skillFilter.value,
)

function resetFilters() {
  scope.value = 'all'
  q.value = ''
  positionFilter.value = ''
  hireStart.value = ''
  hireEnd.value = ''
  skillFilter.value = ''
}

const cards = computed(() => {
  const s = summary.value
  return [
    { title: '在册总人数', value: fmtN(s.total), unit: '人', color: '#1E40AF', subLabel: '钉钉通讯录', subText: '内包 + 外包' },
    { title: '内包', value: fmtN(s.inner), unit: '人', color: '#0891B2', subLabel: '生产部（内包）', subText: '含灌装 / 配料 / 车间管理' },
    { title: '外包', value: fmtN(s.outer), unit: '人', color: '#7C3AED', subLabel: '生产部（外包）', subText: '含灭菌' },
    { title: '已填技能等级', value: fmtN(s.withSkillLevel), unit: '人', color: '#16A34A', subLabel: '人工维护', subText: `共 ${fmtN(s.total)} 人` },
  ]
})

function fmtN(v) {
  if (v == null || v === '') return '0'
  return Number(v).toLocaleString()
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    data.value = await fetchStaffRoster()
  } catch (e) {
    console.error('[staff-roster] 加载失败:', e)
    loadError.value = (e && e.message) || '加载失败'
    data.value = null
  }
  loading.value = false
}

async function handleSync() {
  if (syncing.value) return
  syncing.value = true
  syncError.value = ''
  try {
    await syncStaffDirectory()
    await load()
  } catch (e) {
    console.error('[staff-roster] 同步失败:', e)
    syncError.value = (e && e.message) || '同步失败'
  }
  syncing.value = false
}

// ====== 技能等级：点击变下拉，改完即存（乐观更新，失败回滚）======
const editing = ref(null) // 姓名
const saving = ref(false)
const savedKey = ref('')
let flashTimer = null

function startEdit(r) {
  if (!saving.value) editing.value = r.name
}
function cancelEdit() {
  editing.value = null
}
async function commitEdit(r, value) {
  if (editing.value !== r.name) return
  const prev = r.skillLevel
  editing.value = null
  if (value === prev) return
  r.skillLevel = value // 乐观更新
  saving.value = true
  try {
    await saveStaffSkillLevel(r.name, value)
    savedKey.value = r.name
    clearTimeout(flashTimer)
    flashTimer = setTimeout(() => { savedKey.value = '' }, 2000)
    // 汇总卡里的「已填技能等级」跟着变
    if (data.value && data.value.summary) {
      data.value.summary.withSkillLevel = rows.value.filter((x) => x.skillLevel).length
    }
  } catch (e) {
    console.error('[staff-roster] 保存技能等级失败:', e)
    r.skillLevel = prev // 回滚
  }
  saving.value = false
}

onMounted(async () => {
  try {
    options.value = await fetchStaffOptions()
  } catch (e) {
    console.error('[staff-roster] 选项加载失败:', e)
  }
  load()
})

onBeforeUnmount(() => clearTimeout(flashTimer))
</script>

<template>
  <div class="sr-page">
    <StaffTabs />

    <div class="sr-header">
      <div class="sr-title-wrap">
        <h2 class="sr-title">人员名单</h2>
        <span class="sr-sub">
          钉钉通讯录 · 内包 / 外包
          <template v-if="summary.lastSyncAt"> · 上次同步 {{ summary.lastSyncAt }}</template>
        </span>
      </div>
      <div class="sr-actions">
        <input v-model="q" class="sr-search" type="search" placeholder="搜索姓名" />
        <button class="sr-sync" :disabled="syncing" @click="handleSync">
          {{ syncing ? '同步中…' : '同步钉钉' }}
        </button>
      </div>
    </div>

    <div class="sr-note">
      名字 / 岗位 / 入职时间来自钉钉通讯录，每天 7:30 自动同步；技能等级由本系统人工维护，与「人员数据」页共用。
    </div>

    <div v-if="syncError" class="sr-alert">{{ syncError }}</div>

    <div class="sr-scope-tabs">
      <button
        v-for="t in scopeTabs"
        :key="t.key"
        class="sr-scope-btn"
        :class="{ active: scope === t.key }"
        @click="scope = t.key"
      >
        {{ t.label }}<span class="sr-scope-count">{{ t.count }}</span>
      </button>
    </div>

    <!-- 清单上方的筛选：岗位 / 入职时间 / 技能等级 -->
    <div class="sr-filter-bar">
      <label class="sr-filter">
        <span>岗位</span>
        <select v-model="positionFilter" class="sr-filter-select">
          <option value="">全部</option>
          <option v-for="t in positionOptions" :key="t" :value="t">
            {{ t === EMPTY ? '（未填）' : t }}
          </option>
        </select>
      </label>

      <label class="sr-filter">
        <span>入职时间</span>
        <input v-model="hireStart" type="date" class="sr-date" />
        <span class="sr-tilde">至</span>
        <input v-model="hireEnd" type="date" class="sr-date" />
      </label>

      <label class="sr-filter">
        <span>技能等级</span>
        <select v-model="skillFilter" class="sr-filter-select">
          <option value="">全部</option>
          <option v-for="s in options.skillLevels" :key="s" :value="s">{{ s }}</option>
          <option :value="EMPTY">（未填）</option>
        </select>
      </label>

      <button v-if="hasActiveFilter" class="sr-reset" @click="resetFilters">重置</button>
      <span class="sr-result-count">筛选结果 {{ filteredRows.length }} 人</span>
    </div>

    <div v-if="loading" class="sr-skeleton">
      <div class="sr-sk-bar"></div>
      <div class="sr-sk-bar"></div>
      <div class="sr-sk-bar"></div>
    </div>

    <template v-else-if="data">
      <div class="sr-cards">
        <MetricCard
          v-for="c in cards"
          :key="c.title"
          :title="c.title" :value="c.value" :unit="c.unit" :color="c.color"
          :sub-label="c.subLabel" :sub-text="c.subText"
        />
      </div>

      <div v-if="filteredRows.length" class="sr-table-wrap">
        <table class="sr-table">
          <thead>
            <tr>
              <th class="sr-idx">序号</th>
              <th>姓名</th>
              <th>岗位</th>
              <th>入职时间</th>
              <th>技能等级</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in filteredRows" :key="r.userid" class="sr-row">
              <td class="sr-idx">{{ i + 1 }}</td>
              <td class="sr-name">
                {{ r.name }}
                <template v-if="scope === 'all'">
                  <span v-if="r.scope === 'inner'" class="sr-tag sr-tag-inner">内包</span>
                  <span v-else-if="r.scope === 'outer'" class="sr-tag sr-tag-outer">外包</span>
                  <span v-else class="sr-tag sr-tag-both">内包+外包</span>
                </template>
              </td>
              <td>{{ r.title || '—' }}</td>
              <td>{{ r.hiredDate || '—' }}</td>
              <td class="sr-edit-cell">
                <select
                  v-if="editing === r.name"
                  class="sr-select"
                  :value="r.skillLevel"
                  @change="commitEdit(r, $event.target.value)"
                  @blur="cancelEdit"
                  @click.stop
                >
                  <option value="">（未填）</option>
                  <option v-for="s in options.skillLevels" :key="s" :value="s">{{ s }}</option>
                </select>
                <span
                  v-else
                  class="sr-edit-text"
                  :class="{ 'sr-saved': savedKey === r.name }"
                  @click.stop="startEdit(r)"
                >{{ r.skillLevel || '—' }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="sr-empty">没有匹配的人员</div>
    </template>

    <div v-else class="sr-empty">
      <p>{{ loadError || '尚未同步钉钉通讯录' }}</p>
      <button class="sr-sync" :disabled="syncing" @click="handleSync">
        {{ syncing ? '同步中…' : '立即同步' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.sr-page { display: flex; flex-direction: column; gap: 14px; }
.sr-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
.sr-title-wrap { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.sr-title { font-size: 18px; font-weight: 600; color: var(--text-primary); margin: 0; }
.sr-sub { font-size: 12px; color: var(--text-muted, #94A3B8); }
.sr-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sr-search {
  width: 180px; min-height: 32px; padding: 4px 10px;
  border: 1px solid var(--border-color, #E2E8F0); border-radius: 6px;
  font-size: 13px; color: var(--text-primary); background: var(--bg-card); outline: none;
}
.sr-search:focus { border-color: var(--primary, #1E40AF); }
.sr-sync {
  min-height: 32px; padding: 4px 14px; border: 1px solid var(--primary, #1E40AF);
  border-radius: 6px; background: var(--primary, #1E40AF); color: #fff;
  font-size: 13px; cursor: pointer; white-space: nowrap;
}
.sr-sync:hover:not(:disabled) { opacity: 0.9; }
.sr-sync:disabled { opacity: 0.6; cursor: not-allowed; }
.sr-note { font-size: 12px; color: var(--text-muted, #94A3B8); line-height: 1.8; }
.sr-alert {
  font-size: 13px; color: #B91C1C; background: #FEF2F2;
  border: 1px solid #FECACA; border-radius: 8px; padding: 8px 12px;
}
.sr-scope-tabs { display: inline-flex; align-self: flex-start; gap: 4px; padding: 3px; background: var(--bg-card); border: 1px solid var(--border-color, #E2E8F0); border-radius: 8px; }
.sr-scope-btn {
  min-height: 30px; padding: 4px 14px; border: none; border-radius: 6px;
  background: transparent; color: var(--text-secondary, #64748B); font-size: 13px; cursor: pointer;
}
.sr-scope-btn.active { background: var(--primary, #1E40AF); color: #fff; font-weight: 600; }
.sr-scope-count { margin-left: 6px; font-size: 12px; opacity: 0.75; }
.sr-filter-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; }
.sr-filter { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-secondary, #64748B); }
.sr-filter-select, .sr-date {
  min-height: 32px; padding: 4px 8px;
  border: 1px solid var(--border-color, #E2E8F0); border-radius: 6px;
  font-size: 13px; color: var(--text-primary); background: var(--bg-card); outline: none;
}
.sr-filter-select:focus, .sr-date:focus { border-color: var(--primary, #1E40AF); }
.sr-tilde { color: var(--text-muted, #94A3B8); }
.sr-reset {
  min-height: 32px; padding: 4px 12px;
  border: 1px solid var(--border-color, #E2E8F0); border-radius: 6px;
  background: var(--bg-card); color: var(--text-secondary, #64748B);
  font-size: 13px; cursor: pointer;
}
.sr-reset:hover { color: var(--primary, #1E40AF); border-color: var(--primary, #1E40AF); }
.sr-result-count { font-size: 12px; color: var(--text-muted, #94A3B8); margin-left: auto; }
.sr-cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.sr-skeleton { display: flex; flex-direction: column; gap: 8px; background: var(--bg-card); border-radius: 10px; padding: 16px; }
.sr-sk-bar { height: 18px; border-radius: 4px; background: linear-gradient(90deg, #F1F5F9 25%, #E2E8F0 37%, #F1F5F9 63%); background-size: 400% 100%; animation: sr-shimmer 1.4s ease infinite; }
@keyframes sr-shimmer { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }
.sr-table-wrap { background: var(--bg-card); border-radius: 10px; box-shadow: var(--shadow-sm); overflow-x: auto; }
.sr-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 560px; }
.sr-table th { text-align: left; padding: 9px 12px; background: #F8FAFC; color: #475569; font-weight: 600; white-space: nowrap; border-bottom: 1px solid #E2E8F0; }
.sr-table td { padding: 8px 12px; border-bottom: 1px solid #F1F5F9; color: #1E293B; }
.sr-idx { width: 52px; color: #94A3B8; }
.sr-row:hover { background: #F8FAFC; }
.sr-name { font-weight: 600; white-space: nowrap; }
.sr-tag { display: inline-block; margin-left: 6px; padding: 1px 6px; border-radius: 9px; font-size: 11px; font-weight: 400; vertical-align: 1px; }
.sr-tag-inner { background: #EFF6FF; color: #1E40AF; }
.sr-tag-outer { background: #F5F3FF; color: #7C3AED; }
.sr-tag-both { background: #ECFDF5; color: #047857; }
.sr-edit-cell { white-space: nowrap; }
.sr-edit-text {
  display: inline-block; min-width: 44px; padding: 3px 6px; border-radius: 5px;
  cursor: pointer; border: 1px dashed transparent; min-height: 22px;
}
.sr-edit-text:hover { border-color: var(--border-color, #E2E8F0); background: #F8FAFC; }
.sr-edit-text.sr-saved { background: #DCFCE7; border-color: #86EFAC; }
.sr-select {
  min-height: 30px; padding: 3px 6px; border: 1px solid var(--primary, #1E40AF); border-radius: 5px;
  font-size: 13px; color: var(--text-primary); background: var(--bg-card); outline: none;
}
.sr-empty { background: var(--bg-card); border-radius: 10px; padding: 30px; text-align: center; color: var(--text-muted, #94A3B8); display: flex; flex-direction: column; align-items: center; gap: 12px; }
.sr-empty p { margin: 0; }

@media (max-width: 1024px) {
  .sr-cards { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 640px) {
  .sr-actions { width: 100%; }
  .sr-search { flex: 1; min-width: 0; min-height: 40px; }
  .sr-sync { min-height: 40px; }
  .sr-scope-btn { min-height: 38px; }
  .sr-filter { width: 100%; }
  .sr-filter-select, .sr-date { flex: 1; min-width: 0; min-height: 40px; }
  .sr-reset { min-height: 40px; }
  .sr-result-count { width: 100%; margin-left: 0; }
  .sr-cards { gap: 8px; }
  .sr-select { min-height: 40px; }
  .sr-edit-text { min-height: 32px; line-height: 24px; }
}
</style>
