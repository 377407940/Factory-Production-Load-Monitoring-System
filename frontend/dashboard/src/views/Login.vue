<script setup>
/**
 * 登录页
 *
 * 刻意**不做自动跳转**：用户点「钉钉登录」才走授权。
 * 这样普通浏览器打开时不会被一把弹到钉钉登录页（用户明确要求的体验）。
 */
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import logoUrl from '../assets/一家园logo.png'
import { fetchDingtalkUrl } from '../api/auth'
import { ensureUser, useAuth } from '../composables/useAuth'

const route = useRoute()
const router = useRouter()
const auth = useAuth()

const busy = ref(false)
const localErr = ref('')

// 回调失败时后端会带 dd_err 跳回来（授权码过期、缺权限、state 失效…）
const errorMsg = computed(() => localErr.value || String(route.query.dd_err || ''))

onMounted(async () => {
  await ensureUser(true)
  // 已登录的人不该停在登录页；服务端没开钉钉登录（legacy/off）时这里也不该是终点
  if (auth.user || auth.mode !== 'dingtalk') go()
})

function go() {
  const to = String(route.query.redirect || '')
  router.replace(to.startsWith('/') && !to.startsWith('//') ? to : '/overview')
}

async function login() {
  if (busy.value) return
  busy.value = true
  localErr.value = ''
  try {
    const d = await fetchDingtalkUrl(String(route.query.redirect || ''))
    // ⚠️ 必须整页跳转（window.location），不能用 window.open：
    // 弹窗会丢掉钉钉内置浏览器的登录态，授权页认不出人。
    window.location.href = d.url
  } catch (e) {
    console.error('[login] 获取钉钉授权地址失败:', e)
    const s = e && e.response && e.response.status
    localErr.value = s === 503
      ? '服务器还没配置钉钉登录（缺 AppKey/AppSecret），请联系管理员'
      : '无法连接服务器，请检查网络后重试'
    busy.value = false
  }
}
</script>

<template>
  <div class="lg-page">
    <div class="lg-card">
      <div class="lg-brand">
        <img class="lg-logo" :src="logoUrl" alt="一家园" />
        <h1 class="lg-title">一家园工厂生产数据系统</h1>
      </div>

      <div v-if="errorMsg" class="lg-error">{{ errorMsg }}</div>

      <template v-if="auth.dingtalk">
        <p class="lg-desc">请使用钉钉账号登录后查看看板数据</p>
        <button class="lg-btn" :disabled="busy" @click="login">
          <svg v-if="!busy" class="lg-btn-icon" viewBox="0 0 1024 1024" width="20" height="20" aria-hidden="true">
            <path fill="currentColor" d="M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448 448-200.6 448-448S759.4 64 512 64zm0 820c-205.4 0-372-166.6-372-372s166.6-372 372-372 372 166.6 372 372-166.6 372-372 372zm98.6-472.2l-79.6 213.4-73.4-168.2-79 168.2-73.4-213.4c-6-17.4-24.8-26.6-42.2-20.6-17.4 6-26.6 24.8-20.6 42.2l100.4 292c5.8 16.8 23.4 25.6 40.6 20.4 8.4-2.6 15.2-8.4 18.8-16.2l55.6-119 55.6 119c4.4 9.4 13.8 15.4 24 15.4 2.6 0 5.2-.4 7.8-1.2 12.8-4.2 20.6-16.6 19-29.8l-11-97.4h76.2c18.4 0 33.4-15 33.4-33.4 0-18.4-15-33.4-33.4-33.4h-88.6l37.4-100.2h51.2c18.4 0 33.4-15 33.4-33.4 0-18.4-15-33.4-33.4-33.4h-9.4l10.2-27.4c6.2-16.6-2.2-35.2-18.8-41.4-16.6-6.2-35.2 2.2-41.4 18.8z"/>
          </svg>
          <span v-if="busy" class="lg-spin" aria-hidden="true"></span>
          <span>{{ busy ? '正在跳转…' : '钉钉登录' }}</span>
        </button>
        <p class="lg-hint">在钉钉客户端内打开时会自动识别身份，无需扫码</p>
      </template>

      <!-- 没配钉钉凭据时退回旧文案，保持与改造前一致 -->
      <template v-else>
        <div class="lg-legacy">
          <div class="lg-legacy-icon">📱</div>
          <div class="lg-legacy-title">请在钉钉中打开</div>
          <div class="lg-legacy-desc">此页面仅在钉钉应用内允许访问，请使用钉钉扫描二维码或通过钉钉工作台打开。</div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.lg-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  background: linear-gradient(160deg, #EEF2FF 0%, #F8FAFC 55%, #F1F5F9 100%);
}
.lg-card {
  width: 100%;
  max-width: 400px;
  background: #fff;
  border: 1px solid #E5E7EB;
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(15, 27, 61, .1);
  padding: 36px 28px 32px;
  text-align: center;
}
.lg-brand { margin-bottom: 22px; }
.lg-logo { height: 44px; object-fit: contain; }
.lg-title {
  font-size: 17px;
  font-weight: 700;
  color: #0F1B3D;
  margin: 14px 0 0;
  line-height: 1.5;
}
.lg-desc { font-size: 13px; color: #6B7280; margin: 0 0 20px; }
.lg-btn {
  width: 100%;
  min-height: 48px;            /* 触控目标 ≥44px */
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: none;
  border-radius: 10px;
  background: #1E40AF;
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: background .2s;
}
.lg-btn:hover:not(:disabled) { background: #1D4ED8; }
.lg-btn:disabled { opacity: .7; cursor: not-allowed; }
.lg-btn-icon { flex: none; }
.lg-spin {
  width: 16px; height: 16px; flex: none;
  border: 2px solid rgba(255,255,255,.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: lg-spin .8s linear infinite;
}
@keyframes lg-spin { to { transform: rotate(360deg); } }
.lg-hint { font-size: 12px; color: #94A3B8; margin: 16px 0 0; line-height: 1.7; }
.lg-error {
  background: #FEF2F2;
  border: 1px solid #FECACA;
  color: #B91C1C;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.6;
  margin-bottom: 18px;
  text-align: left;
  word-break: break-all;
}
.lg-legacy { padding: 6px 0 2px; }
.lg-legacy-icon {
  width: 64px; height: 64px; margin: 0 auto 18px;
  background: #EFF6FF; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; font-size: 30px;
}
.lg-legacy-title { font-size: 18px; font-weight: 700; color: #111827; margin-bottom: 8px; }
.lg-legacy-desc { font-size: 14px; color: #6B7280; line-height: 1.6; }

@media (max-width: 480px) {
  .lg-card { padding: 28px 20px 26px; border-radius: 14px; }
  .lg-title { font-size: 16px; }
}
</style>
