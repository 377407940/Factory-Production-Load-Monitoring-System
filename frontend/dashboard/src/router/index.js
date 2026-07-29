import { createRouter, createWebHistory } from 'vue-router'

const routes = [
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

export default router
