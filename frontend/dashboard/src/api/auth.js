import { http } from './http'

/** 网关模式 / 是否已登录（公开接口，登录页和路由守卫都用它） */
export async function fetchAuthStatus() {
  const { data: resp } = await http.get('/api/monitor/auth/status', { timeout: 8000 })
  return resp.data || resp
}

/** 拿钉钉授权地址；未配置时后端回 503 */
export async function fetchDingtalkUrl(redirect) {
  const { data: resp } = await http.get('/api/monitor/auth/dingtalk-url', {
    params: redirect ? { redirect } : {},
    timeout: 8000,
  })
  return resp.data || resp
}

export async function logout() {
  const { data: resp } = await http.post('/api/monitor/auth/logout', null, { timeout: 8000 })
  return resp.data || resp
}
