/**
 * 钉钉 OAuth2 网页授权（拿到"你是谁"）
 *
 * 流程（三步，官方文档的授权码模式）：
 *   ① 浏览器跳 https://login.dingtalk.com/oauth2/auth?...
 *   ② 钉钉带 authCode 回跳我们的回调
 *   ③ 用 authCode 换 userAccessToken → 再用它调 /contact/users/me 拿身份
 *
 * 这里只负责"跟钉钉说话"，不管 HTTP 请求状态（state 在 routes/auth.js 里）。
 * 出站用 axios（已是依赖），比 dingTalkRobot.js 那套 https.request 好写超时和 JSON。
 */
const axios = require('axios');
const config = require('../config');

const LOGIN_URL = 'https://login.dingtalk.com/oauth2/auth';
const DEFAULT_API_V1 = 'https://api.dingtalk.com';
const TIMEOUT = 15000;

/** 凭据是否齐全（复用 /problem/ 那个企业内部应用的 AppKey/AppSecret） */
function isConfigured() {
  return !!(config.dingtalk.appKey && config.dingtalk.appSecret);
}

/** api.dingtalk.com 基址（自测时可以指向桩服务） */
const apiV1Base = () =>
  String(process.env.DINGTALK_API_V1_BASE || config.dingtalk.apiBaseV1 || DEFAULT_API_V1).replace(/\/+$/, '');

/**
 * 登录回调地址。
 * ⚠️ 必须与钉钉控制台「重定向 URL」**字面量完全一致**（协议/域名/路径大小写敏感）。
 * 挂在 /api/monitor/auth 下是为了复用已有的 Nginx `/api/monitor/` 反代，不用改 Nginx。
 */
function authCallbackUrl() {
  return `${String(config.auth.publicBaseUrl || '').replace(/\/+$/, '')}/api/monitor/auth/dingtalk-callback`;
}

/** 生成授权地址（纯函数、不联网） */
function buildOAuth2Url(redirectUri, state) {
  const params = new URLSearchParams({
    redirect_uri: redirectUri,
    response_type: 'code',
    client_id: config.dingtalk.appKey,
    scope: 'openid',       // 只要身份，不要 corpid
    state,                 // 防 CSRF + 携带登录后的落地页
    prompt: 'consent',
  });
  return `${LOGIN_URL}?${params.toString()}`;
}

/**
 * 调 api.dingtalk.com/v1.0（新版接口报错形态与 oapi 不同：非 2xx 时是 {code, message}，没有 errcode）
 */
async function callV1(path, { method = 'GET', headers = {}, body } = {}) {
  let res;
  try {
    res = await axios({
      url: `${apiV1Base()}${path}`,
      method,
      headers: body ? { 'Content-Type': 'application/json', ...headers } : headers,
      data: body,
      timeout: TIMEOUT,
      validateStatus: null, // 自己判状态码，好把钉钉原文带出来
    });
  } catch (e) {
    throw new Error(`连不上钉钉免登接口（${apiV1Base()}）：${e.message}`);
  }
  const json = res.data;
  if (res.status < 200 || res.status >= 300) {
    const msg = [json && json.code, json && json.message].filter(Boolean).join(' | ') || `HTTP ${res.status}`;
    // 最典型：invalid_grant = 授权码过期或已被用过；AccessTokenPermissionDenied = 权限改了没发布版本
    throw new Error(`钉钉免登接口报错：${msg}`);
  }
  if (!json || typeof json !== 'object') {
    throw new Error(`钉钉免登接口返回的不是 JSON：${String(res.data).slice(0, 120)}`);
  }
  return json;
}

/**
 * 授权码 → 用户身份。只取数，不落库不建会话。
 * @returns {Promise<{unionId: string, nick: string, mobile: string}>}
 */
async function exchangeCode(code) {
  if (!isConfigured()) throw new Error('尚未配置钉钉 AppKey / AppSecret');
  const { appKey, appSecret } = config.dingtalk;

  const d1 = await callV1('/v1.0/oauth2/userAccessToken', {
    method: 'POST',
    body: { clientId: appKey, clientSecret: appSecret, code, grantType: 'authorization_code' },
  });
  if (!d1.accessToken) throw new Error('钉钉没有返回 accessToken（授权码可能已过期或已被使用，请重试）');

  // ⚠️ 授权码一次性、5 分钟有效：换完立刻用，别拿去再调别的接口
  const d2 = await callV1('/v1.0/contact/users/me', {
    headers: { 'x-acs-dingtalk-access-token': d1.accessToken },
  });
  const unionId = String(d2.unionId || '');
  if (!unionId) {
    // 少了它就认不出人，必须报错而不是放行
    throw new Error('钉钉没有返回 unionId（应用的「通讯录个人信息读权限」没开，或改了权限没发布版本？）');
  }
  return { unionId, nick: String(d2.nick || ''), mobile: String(d2.mobile || '') };
}

module.exports = { isConfigured, authCallbackUrl, buildOAuth2Url, exchangeCode, apiV1Base };
