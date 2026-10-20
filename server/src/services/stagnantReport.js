/**
 * 呆滞成品看板 → 钉钉群推送
 *
 * 推的是**整个界面的截图**（汇总卡 + 趋势图 + 明细表），不是 markdown 表格 ——
 * 看板里有 echarts 折线图，只有真实浏览器渲染才还原得了，见 screenshotService.js。
 *
 * 图片必须走 Nginx 的 /monitor/reports/ alias：DingTalk 服务器去拉图时不会带钉钉 UA，
 * 走 Express 的 /monitor/ 会撞上 UA 网关（实测拿到的是「请在钉钉中打开」的拦截页）。
 *
 * 图片 URL 带 ?t=<文件 mtime>：钉钉 PC 端会按 URL 缓存加载过的图，
 * URL 不变就永远显示旧图（手机端没这个问题）。
 */
const path = require('path');
const fs = require('fs');
const config = require('../config');
const { sendMarkdown } = require('./dingTalkRobot');
const { capturePage, isAvailable } = require('./screenshotService');

/** 本地日期 YYYY-MM-DD（北京时间） */
function localDate(d = new Date()) {
  const t = new Date(d.getTime() + 8 * 3600 * 1000);
  return t.toISOString().slice(0, 10);
}

function fmtN(v) {
  if (v == null || v === '') return '—';
  return Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

/**
 * 汇总口径。筛了客户就只算这些客户的行 —— 保证文字和图上看到的一致。
 */
function summarize(data, customers) {
  if (!customers.length) {
    const s = data.summary;
    return {
      items: s.stagnantItems, lots: s.stagnantLots, qty: s.stagnantQty,
      stockQty: s.stockQty, ratio: s.stagnantRatio,
      oldest: s.oldestAgeDays, expired: s.expiredLots, filtered: false,
    };
  }
  const rows = data.rows.filter((r) => customers.includes(r.customer || ''));
  return {
    items: rows.length,
    lots: rows.reduce((a, r) => a + (Number(r.lots) || 0), 0),
    qty: rows.reduce((a, r) => a + (Number(r.qty) || 0), 0),
    stockQty: null,
    ratio: null,
    oldest: rows.reduce((a, r) => Math.max(a, r.oldestAgeDays || 0), 0),
    expired: rows.reduce((a, r) => a + (r.daysToExpiry != null && r.daysToExpiry < 0 ? 1 : 0), 0),
    filtered: true,
  };
}

/**
 * 组装钉钉 markdown。
 * 兼容性（踩过的坑）：段落之间必须留空行，单个 \n 会被折叠成空格。
 */
function buildMessage({ s, days, customers, imgUrl, date, pageUrl }) {
  const lines = [];
  lines.push(`### 呆滞成品看板（账龄 > ${days} 天）`);
  lines.push('');
  lines.push(`**${date}** ｜ 组织 ${config.stagnant.orgNumber} · 仓库「${config.stagnant.stockName}」`);
  lines.push('');
  lines.push(`- 呆滞成品：**${fmtN(s.items)}** 个，呆滞批号 **${fmtN(s.lots)}** 批`);
  lines.push(`- 呆滞库存量：**${fmtN(s.qty)}**`);
  if (s.filtered) {
    lines.push(`- 范围：**${customers.join('、')}**`);
  } else {
    lines.push(`- 占在库成品：**${s.ratio}%**（在库 ${fmtN(s.stockQty)}）`);
  }
  lines.push(`- 最老账龄：**${fmtN(s.oldest)}** 天${s.expired ? `，已过保质期 **${s.expired}** 批` : ''}`);
  lines.push('');
  lines.push(`![呆滞成品看板](${imgUrl})`);
  lines.push('');
  lines.push(`[在钉钉中打开看板](${pageUrl})`);
  return lines.join('\n');
}

/**
 * 截呆滞看板整页图 + 推送到钉钉群
 * @param {object} opts
 * @param {import('./stagnantService')} opts.svc - 呆滞服务（懒初始化单例）
 * @param {number} [opts.days] - 阈值口径，默认取配置
 * @param {string[]} [opts.customers] - 客户筛选（与页面 URL 上的 cust 一致），空则不筛
 * @returns {Promise<object>} { ok, items, qty, imageUrl, pageUrl, shot }
 */
async function pushStagnantReport({ svc, days, customers = [] } = {}) {
  const thr = config.stagnant.allowedDays.includes(Number(days)) ? Number(days) : config.stagnant.thresholdDays;

  if (!config.robot.webhook) throw new Error('未配置 ROBOT_WEBHOOK，无法推送');
  const avail = isAvailable();
  if (!avail.ok) throw new Error(avail.reason);

  // 先把快照拉新 —— 截图读到的那份数据，和这里算的文字摘要必须是同一次拉取
  await svc.ensureFresh();
  const data = svc.query({ days: thr });

  const q = new URLSearchParams({ days: String(thr) });
  if (customers.length) q.set('cust', customers.join(','));

  const port = process.env.PORT || 4000;
  // ⚠️ 加了钉钉登录之后，截图必须能穿过访问网关，否则截到的是登录页、推送看起来成功但内容全错。
  // 两道保险，互为备份：
  //   ① 无头 Chrome 直连 127.0.0.1:4000，命中「内部直连」判据（见 middleware/auth.js）
  //   ② 显式带上 __auth 令牌，换成内部会话 Cookie（AUTH_BYPASS_TOKEN 未配置时自动省略）
  const authQ = config.auth.bypassToken ? `&__auth=${encodeURIComponent(config.auth.bypassToken)}` : '';
  const shotUrl = `http://127.0.0.1:${port}/monitor/stagnant?${q.toString()}${authQ}`;
  const pageUrl = `${config.report.baseUrl}/stagnant?${q.toString()}`;

  const date = localDate();
  const fileName = `stagnant-${thr}d-${date}.png`;
  const outPath = path.join(config.report.reportsDir, fileName);
  await fs.promises.mkdir(config.report.reportsDir, { recursive: true });
  const shot = await capturePage(shotUrl, outPath);

  // ?t= 用文件 mtime，保证每次推送 URL 都变（否则钉钉 PC 端一直显示旧图）
  const imageUrl = `${config.report.baseUrl}/reports/${fileName}?t=${Math.round(shot.mtimeMs)}`;

  const s = summarize(data, customers);
  const markdown = buildMessage({ s, days: thr, customers, imgUrl: imageUrl, date, pageUrl });
  const sent = await sendMarkdown(config.robot.webhook, config.robot.secret, {
    title: `呆滞成品看板（>${thr}天）`,
    markdown,
  });
  if (!sent.ok) throw new Error(`钉钉推送失败 errcode=${sent.code} ${sent.errmsg}`);

  console.log(`[stagnantReport] 已推送: ${thr}天 呆滞${s.items}个/${fmtN(s.qty)} 图片${(shot.bytes / 1024).toFixed(0)}KB ${imageUrl}`);
  return { ok: true, days: thr, items: s.items, qty: s.qty, imageUrl, pageUrl, shot };
}

module.exports = { pushStagnantReport, summarize, buildMessage, localDate };
