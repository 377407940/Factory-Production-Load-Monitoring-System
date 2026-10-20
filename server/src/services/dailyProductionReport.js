/**
 * 生产执行日报：取指定日期的「日维度」看板数据 → 生成钉钉 markdown 日报 → 发送
 *
 * 复用 ProductionBoardService.getBoard({ view:'day', dimension:'day' }) 的数据口径，
 * 与看板「生产执行记录（日维度）」完全一致（白班+晚班按产品×日期合并）。
 * 日报内容：汇总 + 按产品明细（优先用表格图片，渲染失败回退 markdown 表格）+ 异常提醒。
 * 表格图片：SVG 排版（列宽固定、产品名完整换行、达产率<100 红字）→ sharp 转 PNG →
 * 存到 reports 目录（Nginx 单独服务 /monitor/reports/，绕过钉钉 UA 保护）→ markdown 插图。
 */
const fs = require('fs');
const path = require('path');
const { sendMarkdown } = require('./dingTalkRobot');
const { renderReportImage } = require('./reportImage');
const config = require('../config');

/** 数量单位换算：看板底层是「条」（排产单万条×10000），展示用「万条」 */
function wan(v) {
  return (v || 0) / 10000;
}

/** 数字格式化：空/NaN → '—'，否则保留 digits 位小数 */
function fmtNum(v, digits = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return Number(v).toFixed(digits);
}

/** 昨天日期 YYYY-MM-DD */
function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * 单元格转义：把表格单元格里的半角竖线换成全角（避免破坏 markdown 表格结构）
 */
function cell(v) {
  return String(v).replace(/\|/g, '｜');
}

/**
 * 产品名截断：超过 MAX_NAME_LEN 个字符时截断加省略号
 * （仅图片渲染失败、回退 markdown 表格时使用；图片里产品名完整显示）
 */
const MAX_NAME_LEN = 12;
function shortName(v) {
  const s = String(v);
  return s.length > MAX_NAME_LEN ? s.slice(0, MAX_NAME_LEN) + '…' : s;
}

/**
 * 生成 markdown 文本表格（图片渲染失败时的回退方案）
 * 钉钉 markdown 兼容性：表头/分隔行/数据行之间用单个 \n 连续，表格两侧留空行
 */
function buildTableMarkdown(rows) {
  const head = `| ${cell('产品')} | ${cell('目标(万条)')} | ${cell('实际(万条)')} | ${cell('达产率')} | ${cell('OES')} | ${cell('合格率')} |`;
  const sep = '| --- | --- | --- | --- | --- | --- |';
  const body = rows
    .map((r) => {
      const oesFlag = r.oes !== null && r.oes > 100 ? ' ⚠️' : '';
      const cells = [
        cell(shortName(r.product || '未知产品')),
        cell(fmtNum(wan(r.targetQty))),
        cell(fmtNum(wan(r.actualQty))),
        cell(`${fmtNum(r.rate)}%`),
        cell(`${fmtNum(r.oes)}%${oesFlag}`),
        cell(`${fmtNum(r.qualifyRate)}%`),
      ];
      return `| ${cells.join(' | ')} |`;
    })
    .join('\n');
  return [head, sep, body].join('\n');
}

/**
 * 生成日报 markdown 文本
 *
 * @param {{ rows: Array }} boardData - getBoard({view:'day',dimension:'day'}) 返回
 * @param {string} date - YYYY-MM-DD
 * @param {string} [imageUrl] - 表格图片公网地址；传入则明细用图片，否则用 markdown 表格回退
 * @returns {{ title: string, markdown: string, summary: object, hasImage: boolean }}
 */
function buildDailyReport(boardData, date, imageUrl) {
  const rows = boardData.rows || [];
  const title = `生产执行日报 ${date}`;
  if (!rows.length) {
    return {
      title,
      markdown: `### 📊 ${title}\n\n**昨日无生产记录**`,
      summary: { count: 0 },
      hasImage: false,
    };
  }

  // ==== 汇总 ====
  let targetQty = 0;
  let actualQty = 0;
  let powerKwh = 0;
  for (const r of rows) {
    targetQty += r.targetQty || 0;
    actualQty += r.actualQty || 0;
    powerKwh += r.powerKwh || 0;
  }
  const overallRate = targetQty > 0 ? (actualQty / targetQty) * 100 : null;

  const parts = [];
  parts.push(`### 📊 ${title}`);
  parts.push(
    `**汇总**：目标 ${fmtNum(wan(targetQty))} 万条 ｜ 实际 ${fmtNum(wan(actualQty))} 万条 ｜ ` +
      `达产率 ${fmtNum(overallRate)}% ｜ 用电 ${Math.round(powerKwh)} kWh`
  );

  // ==== 按产品明细：优先图片，回退 markdown 表格 ====
  parts.push('**按产品明细**');
  if (imageUrl) {
    parts.push(`![生产明细](${imageUrl})`);
  } else {
    parts.push(buildTableMarkdown(rows));
  }

  // ==== 异常提醒（达产率<100 或 OES>100；原因内联行尾，各条之间用空行分隔） ====
  const issues = [];
  for (const r of rows) {
    const product = r.product || '未知产品';
    const flags = [];
    if (r.rate !== null && r.rate < 100) flags.push(`达产率 ${fmtNum(r.rate)}%（未达产）`);
    if (r.oes !== null && r.oes > 100) flags.push(`OES ${fmtNum(r.oes)}%（>100% 数据异常）`);
    if (!flags.length) continue;
    const reason = String(r.reason || '').trim().split('\n').filter(Boolean).slice(0, 3).join('；');
    issues.push(`🔴 ${product} ${flags.join('，')}${reason ? ` → ${reason}` : ''}`);
  }
  if (issues.length) {
    parts.push('**⚠️ 异常提醒**');
    parts.push(...issues);
  }

  return {
    title,
    markdown: parts.join('\n\n'),
    summary: { count: rows.length, targetQty, actualQty, powerKwh, rate: overallRate },
    hasImage: !!imageUrl,
  };
}

/**
 * 生成并推送某日期日报
 * 流程：取日维度数据 → 生成表格图片存 reports 目录 → 组装 markdown（含图片）→ 发送
 * 图片生成失败时回退 markdown 文本表格（不影响推送）。
 *
 * @param {object} boardService - ProductionBoardService 实例
 * @param {{ date?: string }} [opts] - date: YYYY-MM-DD，缺省为昨天
 * @returns {Promise<{ok: boolean, date: string, title: string, hasImage: boolean, send: object}>}
 */
async function sendDailyReport(boardService, { date } = {}) {
  const targetDate = date || yesterday();
  if (!config.robot.webhook) {
    const err = new Error('未配置 ROBOT_WEBHOOK，无法推送钉钉日报');
    console.error(`[dailyReport] ${err.message}`);
    throw err;
  }
  const data = await boardService.getBoard({
    startDate: targetDate,
    endDate: targetDate,
    view: 'day',
    dimension: 'day',
  });

  // 生成表格图片 → 返回公网 URL（失败回退文本表格，不阻断推送）
  let imageUrl = '';
  try {
    const dir = config.report.reportsDir;
    fs.mkdirSync(dir, { recursive: true });
    const outPath = path.join(dir, `${targetDate}.png`);
    await renderReportImage(data.rows, targetDate, outPath);
    // URL 带 mtime 版本参数：图片重生成时 URL 变化，强制钉钉客户端重新拉取
    // （修复 PC 端缓存旧失败/旧图导致不刷新的问题）
    const ver = Math.round(fs.statSync(outPath).mtimeMs || 0);
    imageUrl = `${config.report.baseUrl}/reports/${targetDate}.png?t=${ver}`;
  } catch (err) {
    console.warn(`[dailyReport] 表格图片生成失败，回退 markdown 表格: ${err.message}`);
  }

  const report = buildDailyReport(data, targetDate, imageUrl || undefined);
  const send = await sendMarkdown(config.robot.webhook, config.robot.secret, {
    title: report.title,
    markdown: report.markdown,
  });
  console.log(
    `[dailyReport] ${targetDate} 推送${send.ok ? '成功' : '失败'} ` +
      `产品数=${report.summary.count} 达产率=${fmtNum(report.summary.rate)}% ` +
      `${imageUrl ? '图=' + imageUrl : '回退文本表格'} ${send.errmsg ? 'errmsg=' + send.errmsg : ''}`
  );
  return { ok: send.ok, date: targetDate, title: report.title, hasImage: !!imageUrl, send };
}

module.exports = { buildDailyReport, sendDailyReport, yesterday, fmtNum };
