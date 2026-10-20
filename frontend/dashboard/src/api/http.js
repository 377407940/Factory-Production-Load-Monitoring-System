import axios from 'axios'

/** 全站共用的 axios 实例（同源，Cookie 会自动带上，不用 withCredentials） */
export const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || '',
  timeout: 60000,
})

// 401 的处理在 router 里（因为要跳转），这里只负责通知 —— 用回调注册而不是直接 import router，
// 免得 router → views → api → router 绕成循环依赖。
let onUnauthorized = null
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn
}

http.interceptors.response.use(
  (r) => r,
  (err) => {
    const url = String((err.config && err.config.url) || '')
    // 登录接口自己的 401 不在这里处理，否则会和登录页的提示打架
    if (err.response && err.response.status === 401 && !url.includes('/auth/')) {
      if (onUnauthorized) onUnauthorized()
    }
    return Promise.reject(err)
  },
)
