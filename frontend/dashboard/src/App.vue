<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import logoUrl from './assets/一家园logo.png'

const route = useRoute()

const breadcrumbItems = computed(() => {
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
    <header class="app-header">
      <div class="header-brand">
        <svg class="header-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
          <line x1="8" y1="21" x2="16" y2="21"/>
          <line x1="12" y1="17" x2="12" y2="21"/>
        </svg>
        <h1 class="app-title">一家园工厂生产负载系统</h1>
      </div>
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
  .breadcrumb {
    font-size: 12px;
    order: 10;
    width: 100%;
  }
  .header-logo {
    height: 28px;
  }
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
}
</style>
