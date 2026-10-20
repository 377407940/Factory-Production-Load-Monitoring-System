/**
 * 生产日报表格图片生成
 *
 * 用 SVG 精确排版表格（列宽固定、产品名自动换行、达产率<100 红字、OES>100 红标）
 * → sharp 转 PNG。解决钉钉 markdown 表格受消息框宽度限制、列宽无法自适应的痛点。
 *
 * 图片按手机宽度设计：720px 宽，钉钉消息里等比缩放到 ~350px，
 * 字体 21-22px 缩放后约 10-11px，仍可读。列宽固定为数字，产品列最宽。
 */
const sharp = require('sharp');

// ==== 布局常量 ====
const W = 720; // 总宽
const M = 16; // 左右边距
const HEADER_H = 48; // 表头高
const FONT = 21; // 数据字体
const LINE_H = 30; // 产品名行高
const CELL_PAD = 12; // 单元格左右内边距
const ROW_PAD = 10; // 行上下内边距
const FOOTER_H = 42; // 底部说明高

// 列定义（宽合计 688 = 720 - 2×16）
const COLS = [
  { key: 'product', label: '产品', width: 252 },
  { key: 'target', label: '目标(万条)', width: 88 },
  { key: 'actual', label: '实际(万条)', width: 88 },
  { key: 'rate', label: '达产率', width: 96 },
  { key: 'oes', label: 'OES', width: 84 },
  { key: 'qualify', label: '合格率', width: 80 },
];

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 数字转万条（底层是条，÷10000），保留 1 位小数 */
function wan(v) {
  return (v || 0) / 10000;
}

function fmt1(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return Number(v).toFixed(1);
}

/**
 * 按显示宽度估算换行：CJK 全宽 ≈ fontSize，ASCII ≈ 0.6×fontSize
 * @returns {string[]}
 */
function wrapByWidth(text, maxPx, fontSize) {
  const lines = [];
  let cur = '';
  let curW = 0;
  for (const ch of String(text)) {
    const w = ch.charCodeAt(0) > 0x2e80 ? fontSize : fontSize * 0.6;
    if (curW + w > maxPx && cur) {
      lines.push(cur);
      cur = ch;
      curW = w;
    } else {
      cur += ch;
      curW += w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

/**
 * 生成表格 SVG 字符串
 * @param {Array} rows - 日维度聚合行（含 product/targetQty/actualQty/rate/oes/qualifyRate）
 * @param {string} date - YYYY-MM-DD（显示在底部）
 * @returns {string} SVG
 */
function buildTableSvg(rows, date) {
  const list = rows.length ? rows : [];

  // 先算每行高度（产品列换行行数决定）
  const rowHeights = list.map((r) => {
    const lines = wrapByWidth(r.product || '未知产品', COLS[0].width - CELL_PAD * 2, FONT);
    return Math.max(lines.length, 1) * LINE_H + ROW_PAD * 2;
  });
  const totalH = HEADER_H + rowHeights.reduce((s, h) => s + h, 0) + FOOTER_H;

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${totalH}">`);
  parts.push(`<rect width="${W}" height="${totalH}" fill="#FFFFFF"/>`);

  // 表头
  let x = M;
  for (const c of COLS) {
    parts.push(`<rect x="${x}" y="0" width="${c.width}" height="${HEADER_H}" fill="#1F2D3D"/>`);
    parts.push(
      `<text x="${x + c.width / 2}" y="${HEADER_H / 2 + 8}" font-size="22" font-weight="700" ` +
        `fill="#FFFFFF" text-anchor="middle" font-family="Noto Sans CJK SC, Microsoft YaHei, sans-serif">${esc(c.label)}</text>`
    );
    x += c.width;
  }

  // 数据行
  let y = HEADER_H;
  list.forEach((r, i) => {
    const rowH = rowHeights[i];
    const bg = i % 2 === 0 ? '#FFFFFF' : '#F7F9FB';
    parts.push(`<rect x="${M}" y="${y}" width="${W - M * 2}" height="${rowH}" fill="${bg}"/>`);
    parts.push(`<line x1="${M}" y1="${y + rowH}" x2="${W - M}" y2="${y + rowH}" stroke="#E2E8F0" stroke-width="1"/>`);

    const rate = r.rate;
    const oes = r.oes;
    const rateRed = rate !== null && rate !== undefined && rate < 100;
    const oesRed = oes !== null && oes !== undefined && oes > 100;
    const values = {
      target: fmt1(wan(r.targetQty)),
      actual: fmt1(wan(r.actualQty)),
      rate: rate === null || rate === undefined || Number.isNaN(rate) ? '—' : `${fmt1(rate)}%`,
      oes: oes === null || oes === undefined || Number.isNaN(oes) ? '—' : `${fmt1(oes)}%`,
      qualify: r.qualifyRate === null || r.qualifyRate === undefined || Number.isNaN(r.qualifyRate) ? '—' : `${fmt1(r.qualifyRate)}%`,
    };

    // 产品列：换行文本
    const productLines = wrapByWidth(r.product || '未知产品', COLS[0].width - CELL_PAD * 2, FONT);
    let ty = y + ROW_PAD + FONT;
    productLines.forEach((ln) => {
      parts.push(
        `<text x="${M + CELL_PAD}" y="${ty}" font-size="${FONT}" fill="#1E293B" ` +
          `font-family="Noto Sans CJK SC, Microsoft YaHei, sans-serif">${esc(ln)}</text>`
      );
      ty += LINE_H;
    });

    // 数值列
    x = M + COLS[0].width;
    for (let ci = 1; ci < COLS.length; ci++) {
      const c = COLS[ci];
      let fill = '#334155';
      let weight = '400';
      if (c.key === 'rate' && rateRed) { fill = '#E53935'; weight = '700'; }
      if (c.key === 'oes' && oesRed) { fill = '#E53935'; weight = '700'; }
      // OES>100 时左侧画红色小三角标（不依赖 emoji 字体）
      if (c.key === 'oes' && oesRed) {
        const tx = x + c.width / 2 - 30;
        const cy = y + rowH / 2;
        parts.push(`<polygon points="${tx},${cy - 5} ${tx + 10},${cy - 5} ${tx + 5},${cy + 6}" fill="#E53935"/>`);
      }
      parts.push(
        `<text x="${x + c.width / 2}" y="${y + rowH / 2 + 8}" font-size="${FONT}" font-weight="${weight}" ` +
          `fill="${fill}" text-anchor="middle" font-family="Noto Sans CJK SC, Microsoft YaHei, sans-serif">${esc(values[c.key])}</text>`
      );
      x += c.width;
    }

    y += rowH;
  });

  // 底部说明
  parts.push(
    `<text x="${M}" y="${y + FOOTER_H / 2 + 7}" font-size="18" fill="#94A3B8" ` +
      `font-family="Noto Sans CJK SC, Microsoft YaHei, sans-serif">单位：万条 ｜ 达产率/OES/合格率为 % ｜ ${esc(date)}</text>`
  );

  parts.push('</svg>');
  return parts.join('');
}

/**
 * 渲染表格图片到 PNG 文件
 * @param {Array} rows - 日维度聚合行
 * @param {string} date - YYYY-MM-DD
 * @param {string} outPath - 输出 PNG 路径
 * @returns {Promise<string>} outPath
 */
async function renderReportImage(rows, date, outPath) {
  const svg = buildTableSvg(rows, date);
  await sharp(Buffer.from(svg)).png().toFile(outPath);
  return outPath;
}

module.exports = { buildTableSvg, renderReportImage };
