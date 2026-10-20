/**
 * 钉钉身份登录路由
 *
 * 挂在 `/api/monitor/auth/*` —— 刻意放在 `/api/monitor` 前缀下，
 * 这样复用已有的 Nginx 反代 location，**一行 Nginx 都不用改**。
 * （实测不能挂 `/api/auth/`：活动配置里有 `location /api/ { proxy_pass 127.0.0.1:5000 }` 兜底，
 *   `/api/auth/*` 会被静默转给审计系统。）
 *
 * 与同机 /problem/ 那个实现的差别：本系统**没有本地账号表**。
 * 用户确认「本企业成员都可以」，所以省掉 matchUser/bindIdentity/用户管理那一整套 ——
 * 钉钉确认过身份就发会话，只把 unionId/姓名记下来用于展示和审计。
 */
const crypto = require('crypto');
const express = require('express');
const config = require('../config');
const sessionStore = require('../services/sessionStore');
const dingtalkAuth = require('../services/dingtalkAuth');
const {
  setSessionCookie, clearSessionCookie, clientIp, effectiveMode, readCookie, bearerToken,
} = require('../middleware/auth');

const router = express.Router();

/** state → { redirect, exp }。单进程 PM2 fork（instances:1）下用内存 Map 是安全的。 */
const oauthStates = new Map();
const STATE_TTL_MS = 10 * 60 * 1000;

/** 回跳地址白名单：只允许站内路径，防开放重定向 */
function safeRedirect(p) {
  const s = String(p || '');
  if (!s.startsWith('/') || s.startsWith('//')) return '';
  if (s.startsWith('/login') || s.startsWith('/monitor/login')) return '';
  return s.slice(0, 300);
}

function createState(redirect) {
  const now = Date.now();
  for (const [k, v] of oauthStates) if (v.exp < now) oauthStates.delete(k);
  const state = crypto.randomBytes(8).toString('hex');
  oauthStates.set(state, { redirect: safeRedirect(redirect), exp: now + STATE_TTL_MS });
  return state;
}
function takeState(state) {
  const k = String(state || '');
  const v = oauthStates.get(k);
  oauthStates.delete(k); // 一次性：无论成功失败都不再复用
  if (!v || v.exp < Date.now()) return null;
  return v;
}

/** 登录失败一律 302 回登录页并带上原因（不能给用户看裸 500/JSON，那一步他只能干瞪眼） */
function backToLogin(res, params) {
  const base = String(config.auth.publicBaseUrl || '').replace(/\/+$/, '');
  res.redirect(302, `${base}/monitor/login?${new URLSearchParams(params).toString()}`);
}

/** 当前登录人（**绝不回 token**） */
function publicUser(a) {
  if (!a) return null;
  return {
    nick: a.nick || '',
    mobile: a.mobile || '',
    unionId: a.unionId || '',
    internal: !!a.internal,
    loginAt: a.loginAt || '',
  };
}

/**
 * GET /api/monitor/auth/status — 公开
 * 前端启动和登录页靠它决定：走钉钉登录页、还是显示"请在钉钉中打开"的老文案。
 */
router.get('/status', (req, res) => {
  res.json({
    code: 0,
    data: {
      mode: effectiveMode(),
      dingtalk: dingtalkAuth.isConfigured(),
      loggedIn: !!req.auth,
      user: publicUser(req.auth),
      sessionDays: config.auth.sessionDays,
    },
  });
});

/** GET /api/monitor/auth/dingtalk-url?redirect=/stagnant — 拿授权地址 */
router.get('/dingtalk-url', (req, res) => {
  if (!dingtalkAuth.isConfigured()) {
    return res.status(503).json({ code: 503, msg: '钉钉免登未配置（服务器 .env 缺 DINGTALK_APP_KEY / DINGTALK_APP_SECRET）' });
  }
  const state = createState(req.query.redirect);
  res.json({ code: 0, data: { url: dingtalkAuth.buildOAuth2Url(dingtalkAuth.authCallbackUrl(), state) } });
});

/**
 * GET /api/monitor/auth/dingtalk-callback?authCode=..&state=..
 * ⚠️ 不能挂鉴权中间件 —— 人还没登录。
 */
router.get('/dingtalk-callback', async (req, res) => {
  const st = takeState(req.query.state);
  if (!st) {
    sessionStore.logEvent({ event: 'expired_state', ip: clientIp(req), ua: req.headers['user-agent'] });
    return backToLogin(res, { dd_err: '登录状态已过期，请重新点击登录' });
  }
  const code = String(req.query.authCode || req.query.code || '');
  if (!code) return backToLogin(res, { dd_err: '钉钉没有返回授权码，请重试' });

  try {
    const info = await dingtalkAuth.exchangeCode(code);
    const token = sessionStore.createSession({
      kind: 'dingtalk',
      unionId: info.unionId,
      nick: info.nick,
      mobile: info.mobile,
      ip: clientIp(req),
      ua: req.headers['user-agent'],
    });
    sessionStore.logEvent({
      event: 'login', kind: 'dingtalk', unionId: info.unionId, nick: info.nick,
      ip: clientIp(req), ua: req.headers['user-agent'],
    });
    setSessionCookie(req, res, token);
    const base = String(config.auth.publicBaseUrl || '').replace(/\/+$/, '');
    const to = st.redirect && st.redirect.startsWith('/monitor')
      ? `${base}${st.redirect}`
      : `${base}/monitor${st.redirect || '/overview'}`;
    console.log(`[auth] 登录成功: ${info.nick} (${info.unionId})`);
    return res.redirect(302, to);
  } catch (e) {
    // 日志留全量（含钉钉原文，排错就靠它）；给用户的那句截断即可
    console.error('[auth] 钉钉免登回调失败:', e.message);
    return backToLogin(res, { dd_err: String(e.message).slice(0, 140) });
  }
});

/**
 * GET /api/monitor/auth/check —— 给 Nginx 的 `auth_request` 用的纯鉴权探针。
 *
 * ⚠️⚠️ **绝对不要改成去看 `req.auth`**。
 * 本路由挂在 `/api/monitor/auth` 上，只经过 `attachSession`。而 `attachSession` 有一条
 * 「内部直连豁免」：源地址回环 + 无 X-Forwarded-For + 无 X-Real-IP → 直接给一个内部身份。
 * **Nginx 的 auth_request 子请求恰好完全满足这三条**（从本机发起、我们故意不给它加那两个头），
 * 所以只要这里读 `req.auth`，`/prod/` 就会对全网开放。
 *
 * 结论：这里**只认显式的会话凭据**（Cookie 或 Bearer），别的什么都不看。
 * 对应地，`/etc/nginx/.../packing-optimizer` 里那个 `location = /prod-auth-check`
 * 也刻意不设 X-Real-IP / X-Forwarded-For。
 *
 * 返回：200 = 放行；401 = 让 nginx 走 error_page 跳登录页。不带 body。
 */
router.get('/check', (req, res) => {
  const token = readCookie(req, config.auth.cookieName) || bearerToken(req);
  const sess = token ? sessionStore.getSession(token) : null;
  return sess ? res.status(200).end() : res.status(401).end();
});

/** GET /api/monitor/auth/me */
router.get('/me', (req, res) => {
  if (!req.auth) return res.status(401).json({ code: 401, msg: '未登录或登录已过期' });
  res.json({ code: 0, data: { user: publicUser(req.auth) } });
});

/** POST /api/monitor/auth/logout */
router.post('/logout', (req, res) => {
  if (req.authToken) sessionStore.deleteSession(req.authToken);
  if (req.auth && !req.auth.transient) {
    sessionStore.logEvent({
      event: 'logout', kind: req.auth.kind, unionId: req.auth.unionId, nick: req.auth.nick,
      ip: clientIp(req), ua: req.headers['user-agent'],
    });
  }
  clearSessionCookie(req, res);
  res.json({ code: 0, data: { ok: true } });
});

module.exports = router;
