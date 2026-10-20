/**
 * 访问网关：钉钉身份登录 + 若干必须豁免的通路
 *
 * 取代原来的 `dingtalkOnly`（只看 User-Agent / Referer）。旧做法等于没有防护：
 * 实测 `curl -H 'Referer: https://k3-aitable.xyz/x' https://k3-aitable.xyz/api/monitor/overview`
 * 直接返回 200 —— 两个头都是客户端随便填的。
 *
 * ⚠️⚠️ 最关键的一点，改代码前务必看懂：
 *   Nginx 对 /monitor/ 和 /api/monitor/ 都是 `proxy_pass http://localhost:4000`，
 *   所以【**所有来自公网的请求，进到 Express 时源地址都是 127.0.0.1**】。
 *   只按 `req.socket.remoteAddress` 判回环 = 对全网上开天窗。
 *
 *   正确判据是三者同时成立（见 isDirectLocal）：
 *     源地址是回环 AND 没有 X-Forwarded-For AND 没有 X-Real-IP
 *   —— nginx 这两个头都会设；截图用的无头 Chrome 直连 127.0.0.1:4000，两个头都没有。
 *
 *   这条还依赖「4000 端口不能被公网直连」（index.js 里 listen 收了回环）；
 *   否则外部直连 4000 时故意不带这两个头，就能伪造"内部直连"。
 */
const crypto = require('crypto');
const config = require('../config');
const sessionStore = require('../services/sessionStore');
const dingtalkAuth = require('../services/dingtalkAuth');

/** 源地址是不是回环（含 IPv6 与 IPv4-mapped 形式） */
function isLoopback(addr) {
  const a = String(addr || '');
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1' || a.startsWith('127.');
}

/**
 * 是不是「本机内部直连」—— 截图管线靠这条活着。
 * 三者必须同时成立，理由见文件头。
 */
function isDirectLocal(req) {
  if (!isLoopback(req.socket && req.socket.remoteAddress)) return false;
  if (req.headers['x-forwarded-for']) return false;
  if (req.headers['x-real-ip']) return false;
  return true;
}

/** 本次请求对外是不是 HTTPS（req.protocol 恒为 http，因为没设 trust proxy） */
function isHttpsRequest(req) {
  if (req.secure) return true;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return proto === 'https';
}

/** 从 Cookie 头里取一个值（不想为一个纯 hex 值引入 cookie-parser，那还会连带要求重新装依赖） */
function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  if (!raw) return '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

/** 取 Bearer token（作为 Cookie 之外的备用通道，见 attachSession） */
function bearerToken(req) {
  const h = String(req.headers.authorization || '');
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

function setSessionCookie(req, res, token, days) {
  res.cookie(config.auth.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttpsRequest(req),
    maxAge: (Number(days) > 0 ? Number(days) : config.auth.sessionDays) * 86400000,
    path: '/',
  });
}

function clearSessionCookie(req, res) {
  res.clearCookie(config.auth.cookieName, { path: '/' });
}

/** 请求方 IP：nginx 在后面，真实来源看 X-Real-IP */
function clientIp(req) {
  return String(req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || '');
}

/**
 * 挂会话，**从不拒绝请求**。只负责把 req.auth 填好，拦截交给 requireAuthApi。
 * 会话来源优先级：Cookie → Authorization: Bearer → 内部直连（临时身份，不写库）
 */
function attachSession(req, res, next) {
  const token = readCookie(req, config.auth.cookieName) || bearerToken(req);
  if (token) {
    const s = sessionStore.getSession(token);
    if (s) {
      req.auth = { ...s, internal: s.kind === 'internal', transient: false };
      req.authToken = token;
      return next();
    }
  }
  if (isDirectLocal(req)) {
    // 截图用的无头浏览器就走这条。**不要**为它写库（每次请求一条太浪费）
    req.auth = { kind: 'internal', nick: '内部调用', internal: true, transient: true };
  }
  return next();
}

/** 网关生效模式。用函数而不是常量，这样 pm2 restart --update-env 就是完整的回滚手段。 */
function gateMode() {
  const m = String(process.env.AUTH_GATE_MODE || config.auth.gateMode || 'auto').trim();
  if (m === 'off' || m === 'legacy') return m;
  return 'auto';
}

/** auto 模式下的实际走向：配了钉钉凭据才是 dingtalk，否则退回旧网关 */
function effectiveMode() {
  const m = gateMode();
  if (m !== 'auto') return m;
  return dingtalkAuth.isConfigured() ? 'dingtalk' : 'legacy';
}

/** 旧的判断逻辑，原样保留（含"钉钉文档内嵌"和同源 Referer 两条），仅回环那条换成真实源地址 */
function legacyAllowed(req) {
  const ua = String(req.headers['user-agent'] || '').toLowerCase();
  const referer = String(req.headers['referer'] || '').toLowerCase();
  if (isDirectLocal(req)) return true;
  if (ua.includes('dingtalk') || ua.includes('dingding')) return true;
  if (referer.includes('alidocs.dingtalk.com') || referer.includes('dingtalk.com/docs')) return true;
  if (referer.includes(String(req.hostname || '').toLowerCase())) return true;
  return false;
}

const DENY_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>访问受限</title><style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,sans-serif;text-align:center;padding:20px}.box{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:48px 32px;max-width:360px;box-shadow:0 4px 20px rgba(0,0,0,.06)}.icon{width:64px;height:64px;margin:0 auto 20px;background:#eff6ff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:32px}.title{font-size:18px;font-weight:700;color:#111827;margin-bottom:8px}.desc{font-size:14px;color:#6b7280;line-height:1.6}</style></head>
<body><div class="box"><div class="icon">📱</div><div class="title">请在钉钉中打开</div><div class="desc">此页面仅在钉钉应用内允许访问，请使用钉钉扫描二维码或通过钉钉工作台打开。</div></div></body></html>`;

function denyLegacy(req, res) {
  res.status(403).send(DENY_HTML);
}

/**
 * API 网关。挂在 /api/monitor 上（auth 子路由挂之前，见 index.js）。
 * 未登录一律回 401 **JSON**，不做 302 —— 302 在 XHR 上会被静默吞掉，前端无法处理。
 */
function requireAuthApi(req, res, next) {
  // 1. 已挂上会话（Cookie / Bearer / 内部直连）
  if (req.auth) return next();

  // 2. MES 推送：工厂内网计划任务，没有钉钉身份，靠 X-Mes-Token 鉴权（在路由里查）
  //    用原始 URL 而不是挂载相对的 req.path，免得以后挂载点变了这里静默失效
  const rawPath = String(req.originalUrl || '').split('?')[0];
  if (rawPath.startsWith('/api/monitor/mes-push')) return next();

  const mode = effectiveMode();

  // 3. 应急逃生口
  if (mode === 'off') return next();

  // 4. 旧网关（未配置钉钉凭据时的降级路径，行为与本改造之前一致）
  if (mode === 'legacy') return legacyAllowed(req) ? next() : denyLegacy(req, res);

  // 5. 钉钉模式：未登录
  return res.status(401).json({ code: 401, msg: '未登录或登录已过期', login: `${config.auth.publicBaseUrl}/monitor/login` });
}

/** 定时比较，避免时序侧信道 */
function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

/**
 * 截图管线的兜底通路：`/monitor/xxx?__auth=<AUTH_BYPASS_TOKEN>`
 * → 建一个内部会话、种 Cookie、302 到去掉 __auth 的同一个 URL。
 *
 * 为什么不只靠 isDirectLocal：截图是每天 8:00 自动跑的自动化，
 * 值得再挂一条显式通路，两条互为备份。
 */
function internalTokenExchange(req, res, next) {
  const token = req.query && req.query.__auth;
  if (!token) return next();

  const expected = config.auth.bypassToken;
  if (!expected || !safeEqual(token, expected)) {
    // 静默放行会让截图截到登录页、推送看起来"成功"但内容是错的 —— 必须留下痕迹
    console.warn('[auth] __auth 校验失败（token 为空或不匹配），已忽略该参数');
    sessionStore.logEvent({ event: 'denied', kind: 'internal', ip: clientIp(req), ua: req.headers['user-agent'], detail: '__auth 校验失败' });
    return next();
  }

  const sess = sessionStore.createSession({ kind: 'internal', nick: '内部调用', ip: clientIp(req), ua: req.headers['user-agent'] });
  setSessionCookie(req, res, sess, 1); // 内部会话短命即可

  // ⚠️ 必须用 req.originalUrl（含挂载前缀），不能用 req.path：
  // 这个中间件挂在 app.use('/monitor', ...) 上，req.path 里 '/monitor' 已被 Express 剥掉，
  // 用它拼出来的是 /stagnant 而不是 /monitor/stagnant → 302 到一个不存在的地址 → 页面 404。
  // （2026-10-10 就这么坑过一次：钉钉推送一直报 "Waiting for selector .st-cards failed"。）
  const u = new URL(req.originalUrl || '/', 'http://placeholder');
  u.searchParams.delete('__auth');
  return res.redirect(302, `${u.pathname}${u.search}`);
}

module.exports = {
  isLoopback,
  isDirectLocal,
  isHttpsRequest,
  readCookie,
  bearerToken,
  setSessionCookie,
  clearSessionCookie,
  clientIp,
  attachSession,
  requireAuthApi,
  internalTokenExchange,
  gateMode,
  effectiveMode,
  legacyAllowed,
};
