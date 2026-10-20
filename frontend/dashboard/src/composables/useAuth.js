/**
 * 当前登录人（模块级单例）。
 * 项目里没上 Pinia，一个 reactive 对象就够了。
 */
import { reactive } from 'vue'
import { fetchAuthStatus } from '../api/auth'

const state = reactive({
  user: null,
  ready: false,      // 是否已问过服务器
  mode: '',          // dingtalk | legacy | off
  dingtalk: false,   // 钉钉凭据是否已配置
})

let inflight = null

/** 确保问过一次；force=true 时重新问 */
export function ensureUser(force = false) {
  if (state.ready && !force) return Promise.resolve(state.user)
  if (inflight) return inflight
  inflight = fetchAuthStatus()
    .then((d) => {
      state.mode = d.mode || ''
      state.dingtalk = !!d.dingtalk
      state.user = d.loggedIn ? d.user : null
      state.ready = true
      return state.user
    })
    .finally(() => { inflight = null })
  return inflight
}

export function clearUser() {
  state.user = null
  state.ready = true
}

export function useAuth() {
  return state
}
