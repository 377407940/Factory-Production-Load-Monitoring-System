/**
 * 钉钉自定义机器人消息发送
 *
 * 加签模式安全校验：
 *   timestamp = 当前毫秒时间戳
 *   stringToSign = `${timestamp}\n${secret}`
 *   sign = URLEncode( Base64( HMAC-SHA256(secret, stringToSign) ) )
 *   请求 URL 追加 `&timestamp=..&sign=..`
 * 参考：https://open.dingtalk.com/document/robots/custom-robot-access
 *
 * 用 Node 内置 https 模块发送（不依赖 fetch，兼容各 Node 版本），失败可重试。
 */
const crypto = require('crypto');
const https = require('https');

/**
 * 生成加签后的请求 URL（无 secret 时原样返回 webhook）
 * @param {string} webhook
 * @param {string} [secret]
 * @returns {string}
 */
function buildSignedUrl(webhook, secret) {
  if (!secret) return webhook;
  const timestamp = Date.now();
  const stringToSign = `${timestamp}\n${secret}`;
  const sign = encodeURIComponent(
    crypto.createHmac('sha256', secret).update(stringToSign, 'utf8').digest('base64')
  );
  const sep = webhook.includes('?') ? '&' : '?';
  return `${webhook}${sep}timestamp=${timestamp}&sign=${sign}`;
}

/** POST JSON 到指定 URL（https），返回解析后的响应体 */
function postJson(url, body, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch (err) {
      return reject(new Error(`webhook 地址非法: ${err.message}`));
    }
    const payload = JSON.stringify(body);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: timeoutMs,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`非 JSON 响应: ${String(data).slice(0, 200)}`));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * 发送 markdown 消息（网络异常/钉钉限流时重试 retries 次，间隔递增）
 * @param {string} webhook
 * @param {string} [secret]
 * @param {{ title: string, markdown: string }} msg
 * @param {number} [retries=1]
 * @returns {Promise<{ok: boolean, code: number, errmsg: string}>}
 */
async function sendMarkdown(webhook, secret, msg, retries = 1) {
  if (!webhook) {
    return { ok: false, code: -1, errmsg: 'webhook 为空，未配置 ROBOT_WEBHOOK' };
  }
  const url = buildSignedUrl(webhook, secret);
  const body = {
    msgtype: 'markdown',
    markdown: { title: msg.title, text: msg.markdown },
  };
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const data = await postJson(url, body);
      if (data.errcode === 0) return { ok: true, code: 0, errmsg: '' };
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      console.error(`[dingTalkRobot] 钉钉发送失败 errcode=${data.errcode} errmsg=${data.errmsg}`);
      return { ok: false, code: data.errcode, errmsg: data.errmsg };
    } catch (err) {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      console.error(`[dingTalkRobot] 钉钉发送异常: ${err.message}`);
      return { ok: false, code: -1, errmsg: err.message };
    }
  }
  return { ok: false, code: -1, errmsg: '发送失败' };
}

module.exports = { buildSignedUrl, sendMarkdown };
