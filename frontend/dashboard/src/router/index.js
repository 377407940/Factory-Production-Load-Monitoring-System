import { createRouter, createWebHistory } from 'vue-router'
import { ensureUser, clearUser, useAuth } from '../composables/useAuth'
import { setUnauthorizedHandler } from '../api/http'

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/Login.vue'),
    meta: { public: true },
  },
  {
    path: '/',
    redirect: '/overview',
  },
  {
    path: '/overview',
    name: 'FactoryOverview',
    component: () => import('../views/FactoryOverview.vue'),
  },
  {
    path: '/production',
    name: 'ProductionBoard',
    component: () => import('../views/ProductionBoard.vue'),
  },
  {
    path: '/outsource',
    name: 'OutsourceBoard',
    component: () => import('../views/OutsourceBoard.vue'),
  },
  {
    path: '/fillbox',
    name: 'FillBox',
    component: () => import('../views/FillBox.vue'),
  },
  {
    path: '/stagnant',
    name: 'Stagnant',
    component: () => import('../views/Stagnant.vue'),
  },
  {
    path: '/staff',
    name: 'Staff',
    component: () => import('../views/Staff.vue'),
  },
  {
    // ⚠️ 必须排在 /staff/:name 之前
    path: '/staff/roster',
    name: 'StaffRoster',
    component: () => import('../views/StaffRoster.vue'),
  },
  {
    path: '/staff/:name',
    name: 'StaffDetail',
    component: () => import('../views/StaffDetail.vue'),
  },
  {
    path: '/workshop/:name',
    name: 'WorkshopDetail',
    component: () => import('../views/WorkshopDetail.vue'),
  },
  {
    path: '/equipment/:name',
    name: 'EquipmentDetail',
    component: () => import('../views/EquipmentDetail.vue'),
    props: true,
  },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

// 未登录 → 去登录页（带回来地址）。登录页自己不拦，否则会死循环。
router.beforeEach(async (to) => {
  if (to.meta && to.meta.public) {
    // 已登录的人访问登录页 → 直接放行进看板
    const u = await ensureUser().catch(() => null)
    if (u) {
      const to2 = String(to.query.redirect || '')
      return to2.startsWith('/') && !to2.startsWith('//') ? to2 : '/overview'
    }
    return true
  }
  try {
    await ensureUser()
    const st = useAuth()
    if (st.user) return true
    // ⚠️ 只有服务端真的在「钉钉登录」模式下才由前端拦。
    // legacy（未配凭据，走旧的 UA 网关）和 off 模式下，访问控制归服务端管，
    // 前端再拦一道会把现在能看到看板的人踢到登录页去 —— 那是回归，不是功能。
    if (st.mode !== 'dingtalk') return true
  } catch (e) {
    // 网络异常时不要把人挡在门外，交给页面自己去报错
    console.warn('[router] 获取登录状态失败:', e && e.message)
    return true
  }
  return { name: 'Login', query: { redirect: to.fullPath } }
})

// 任何请求拿到 401（会话过期 / 被踢）→ 清状态并回登录页
setUnauthorizedHandler(() => {
  clearUser()
  const cur = router.currentRoute.value
  if (cur.name !== 'Login') {
    router.replace({ name: 'Login', query: { redirect: cur.fullPath } })
  }
})

export default router
