<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import logoUrl from './assets/一家园logo.png'
import { logout } from './api/auth'
import { clearUser, useAuth } from './composables/useAuth'

const route = useRoute()
const router = useRouter()
const auth = useAuth()

// 登录页不套看板外壳（它自己就是整屏的）
const isPublicPage = computed(() => !!(route.meta && route.meta.public))

const loggingOut = ref(false)
async function handleLogout() {
  if (loggingOut.value) return
  loggingOut.value = true
  try {
    await logout()
  } catch (e) {
    console.warn('[app] 退出登录请求失败，仍按已退出处理:', e && e.message)
  }
  clearUser()
  loggingOut.value = false
  router.replace({ name: 'Login' })
}

// 顶栏导航激活态：总览（含车间/设备下钻页） / 生产执行看板
const isOverviewActive = computed(() =>
  ['FactoryOverview', 'WorkshopDetail', 'EquipmentDetail'].includes(route.name) || route.path.startsWith('/overview'),
)
const isProductionActive = computed(() =>
  route.name === 'ProductionBoard' || route.path.startsWith('/production'),
)
const isOutsourceActive = computed(() =>
  route.name === 'OutsourceBoard' || route.path.startsWith('/outsource'),
)
const isFillBoxActive = computed(() =>
  route.name === 'FillBox' || route.path.startsWith('/fillbox'),
)
const isStagnantActive = computed(() =>
  route.name === 'Stagnant' || route.path.startsWith('/stagnant'),
)
const isStaffActive = computed(() =>
  ['Staff', 'StaffDetail'].includes(route.name) || route.path.startsWith('/staff'),
)

const breadcrumbItems = computed(() => {
  // 生产执行看板 / 灌装成品对比 / 呆滞成品 / 人员：仅显示当前页名（人员明细多一级）
  if (route.name === 'ProductionBoard') {
    return [{ label: '生产执行看板', path: null }]
  }
  if (route.name === 'FillBox') {
    return [{ label: '灌装成品对比', path: null }]
  }
  if (route.name === 'OutsourceBoard') {
    return [{ label: '外包数据看板', path: null }]
  }
  if (route.name === 'Stagnant') {
    return [{ label: '呆滞成品', path: null }]
  }
  if (route.name === 'Staff') {
    return [{ label: '人员', path: null }]
  }
  if (route.name === 'StaffRoster') {
    return [
      { label: '人员', path: '/staff' },
      { label: '人员名单', path: null },
    ]
  }
  if (route.name === 'StaffDetail') {
    return [
      { label: '人员', path: '/staff' },
      { label: String(route.params.name || ''), path: null },
    ]
  }
  const items = [{ label: '总览', path: '/overview' }]
  const params = route.params
  const query = route.query

  if (params.name) {
    if (route.name === 'WorkshopDetail') {
      items.push({ label: params.name, path: null })
    } else if (route.name === 'EquipmentDetail') {
      const workshopName = query.workshop || params.workshop || '车间'
      items.push({ label: workshopName, path: `/workshop/${encodeURIComponent(workshopName)}` })
      items.push({ label: params.name, path: null })
    }
  }

  return items
})
</script>

<template>
  <div class="app-container">
    <header v-if="!isPublicPage" class="app-header">
      <div class="header-brand">
        <svg class="header-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
          <line x1="8" y1="21" x2="16" y2="21"/>
          <line x1="12" y1="17" x2="12" y2="21"/>
        </svg>
        <h1 class="app-title">一家园工厂生产数据系统</h1>
      </div>
      <nav class="header-nav">
        <router-link to="/overview" class="nav-link" :class="{ active: isOverviewActive }">工厂总览</router-link>
        <router-link to="/production" class="nav-link" :class="{ active: isProductionActive }">生产执行看板</router-link>
        <router-link to="/outsource" class="nav-link" :class="{ active: isOutsourceActive }">外包数据看板</router-link>
        <router-link to="/fillbox" class="nav-link" :class="{ active: isFillBoxActive }">灌装成品对比</router-link>
        <router-link to="/stagnant" class="nav-link" :class="{ active: isStagnantActive }">呆滞成品</router-link>
        <router-link to="/staff" class="nav-link" :class="{ active: isStaffActive }">人员</router-link>
      </nav>
      <nav class="breadcrumb">
        <template v-for="(item, index) in breadcrumbItems" :key="index">
          <router-link v-if="item.path" :to="item.path" class="breadcrumb-link">{{ item.label }}</router-link>
          <span v-else class="breadcrumb-current">{{ item.label }}</span>
          <svg v-if="index < breadcrumbItems.length - 1" class="breadcrumb-sep" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </template>
      </nav>
      <img class="header-logo" :src="logoUrl" alt="一家园" />
      <div v-if="auth.user && !auth.user.internal" class="header-user">
        <span class="header-user-name" :title="auth.user.nick">{{ auth.user.nick }}</span>
        <button class="header-logout" :disabled="loggingOut" @click="handleLogout">退出</button>
      </div>
    </header>
    <main class="app-main">
      <router-view v-slot="{ Component }">
        <transition name="page-fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>
  </div>
</template>

<style>
.app-container {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.app-header {
  background: linear-gradient(135deg, #0F1B3D, #1E40AF);
  padding: 14px 28px;
  display: flex;
  align-items: center;
  gap: 28px;
  position: sticky;
  top: 0;
  z-index: 100;
  box-shadow: 0 2px 12px rgba(15, 27, 61, 0.3);
}

.header-brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.header-icon {
  width: 22px;
  height: 22px;
  color: rgba(255,255,255,0.85);
  flex-shrink: 0;
}

.app-title {
  font-size: 18px;
  font-weight: 600;
  color: #fff;
  white-space: nowrap;
  letter-spacing: 0.5px;
}

.header-nav {
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 3px;
}

.nav-link {
  padding: 5px 14px;
  border-radius: 6px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.75);
  text-decoration: none;
  transition: all 0.2s;
  white-space: nowrap;
}

.nav-link:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
}

.nav-link.active {
  background: #fff;
  color: var(--primary, #1E40AF);
  font-weight: 600;
}

.breadcrumb {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.breadcrumb-link {
  color: rgba(255,255,255,0.7);
  text-decoration: none;
  transition: color 0.2s;
  padding: 2px 4px;
  border-radius: 4px;
}

.breadcrumb-link:hover {
  color: #fff;
  background: rgba(255,255,255,0.1);
}

.breadcrumb-current {
  color: rgba(255,255,255,0.95);
  font-weight: 500;
}

.breadcrumb-sep {
  color: rgba(255,255,255,0.35);
  flex-shrink: 0;
}

.header-logo {
  margin-left: auto;
  height: 36px;
  width: auto;
  object-fit: contain;
  opacity: 0.9;
  transition: opacity 0.2s;
}

.header-logo:hover {
  opacity: 1;
}

/* 当前登录人 + 退出（仅钉钉登录的人显示；内部/截图会话不显示） */
.header-user {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
}
.header-user-name {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.9);
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.header-logout {
  min-height: 30px;
  padding: 4px 12px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.9);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}
.header-logout:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.15);
  border-color: rgba(255, 255, 255, 0.6);
}
.header-logout:disabled { opacity: 0.6; cursor: not-allowed; }

.app-main {
  flex: 1;
  padding: 20px 28px;
  max-width: 1440px;
  width: 100%;
  margin: 0 auto;
}

/* 页面过渡动画 */
.page-fade-enter-active,
.page-fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.page-fade-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.page-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (max-width: 768px) {
  .app-header {
    padding: 10px 16px;
    gap: 10px;
    flex-wrap: wrap;
  }
  .app-main {
    padding: 16px;
  }
  .app-title {
    font-size: 15px;
  }
  /* 第一行：品牌 + logo + 当前用户；第二行：导航（可换行，不再横向溢出）；第三行：面包屑 */
  .header-brand { order: 1; }
  .header-nav {
    order: 4;
    flex: 1 1 100%;
    width: 100%;
    box-sizing: border-box;
    flex-wrap: wrap;
    gap: 2px;
    padding: 2px;
  }
  .nav-link {
    flex: 0 0 auto;
    padding: 4px 10px;
    font-size: 12px;
  }
  .breadcrumb {
    font-size: 12px;
    order: 10;
    width: 100%;
  }
  .header-logo {
    order: 2;
    height: 28px;
  }
  .header-user { order: 3; }
  .header-user-name { max-width: 84px; }
}

@media (max-width: 480px) {
  /* 窄屏只留「退出」按钮，姓名藏起来腾地方 */
  .header-user-name { display: none; }
  .header-logout { min-height: 32px; }
}

@media (max-width: 480px) {
  .app-header {
    padding: 8px 12px;
    gap: 6px;
  }
  .app-main {
    padding: 12px;
  }
  .app-title {
    font-size: 14px;
  }
  .header-logo {
    height: 24px;
  }
  .nav-link {
    padding: 4px 8px;
    font-size: 11px;
  }
}
</style>
