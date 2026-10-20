/**
 * 网页整页截图（无头 Chrome）
 *
 * 用途：把监控页面的**完整界面**截成图片，供钉钉 markdown 插图。
 * 为什么不用 reportImage.js 那套手绘 SVG：呆滞看板里有 echarts 折线图，
 * SVG 复刻不了，只有真实浏览器渲染出来才是「所见即所得」。
 *
 * 关键点：
 *  - Chrome 二进制放在 /opt/chrome-for-testing（**不在部署目录里**，deploy.sh 不会碰它）
 *  - 页面走 http://127.0.0.1:PORT —— Express 的钉钉 UA 网关对 localhost/127.0.0.1 直接放行，
 *    同时再带一个钉钉 UA 兜底（换域名访问时也不会被拦）
 *  - 视口 1440px：页面 .app-main 的 max-width 就是 1440，正好铺满桌面布局
 *  - deviceScaleFactor=2：出 2 倍图，钉钉里放大看文字仍然清晰
 *  - 等 .st-cards 出现（数据回来后才渲染）再截，否则会拍到骨架屏
 */
const fs = require('fs');
const config = require('../config');

/** 服务器上的 Chrome 可执行文件 */
const CHROME_PATH = process.env.CHROME_PATH || '/opt/chrome-for-testing/chrome-linux64/chrome';

/** 兜底用的钉钉 UA（网关认 ua 里含 dingtalk / dingding） */
const DINGTALK_UA =
  'Mozilla/5.0 (Linux; Android 13; SM-G9910) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/131.0.0.0 Mobile Safari/537.36 DingTalk/7.0.0';

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage', // 服务器容器 /dev/shm 很小，不加会崩
  '--disable-gpu',
  '--hide-scrollbars',
  '--force-color-profile=srgb',
  '--font-render-hinting=none',
  '--lang=zh-CN',
];

/** 服务器上是否具备截图条件 */
function isAvailable() {
  try {
    require.resolve('puppeteer-core');
  } catch {
    return { ok: false, reason: '未安装 puppeteer-core（服务器上执行 npm i puppeteer-core）' };
  }
  if (!fs.existsSync(CHROME_PATH)) {
    return { ok: false, reason: `Chrome 不存在：${CHROME_PATH}` };
  }
  return { ok: true, reason: '' };
}

/**
 * 截取网页整页
 * @param {string} url - 要截的页面地址
 * @param {string} outPath - 输出 PNG 路径
 * @param {{width?: number, dpr?: number, waitSelector?: string, settleMs?: number, timeoutMs?: number}} [opts]
 * @returns {Promise<{path: string, width: number, height: number, bytes: number}>}
 */
async function capturePage(url, outPath, opts = {}) {
  const { width = 1440, dpr = 2, waitSelector = '.st-cards', settleMs = 1500, timeoutMs = 60000 } = opts;

  const avail = isAvailable();
  if (!avail.ok) throw new Error(avail.reason);

  // 延迟 require：没装 puppeteer-core 时不影响服务启动
  const puppeteer = require('puppeteer-core');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: LAUNCH_ARGS,
    protocolTimeout: timeoutMs,
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(DINGTALK_UA);
    await page.setViewport({ width, height: 1000, deviceScaleFactor: dpr });
    // echarts 会播入场动画，等它画完；页面本身的 CSS 过渡也一并关掉，避免截到中间态
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);

    await page.goto(url, { waitUntil: 'networkidle0', timeout: timeoutMs });
    if (waitSelector) await page.waitForSelector(waitSelector, { timeout: timeoutMs });
    await page.addStyleTag({ content: '*{transition:none !important;animation:none !important}' });
    await new Promise((r) => setTimeout(r, settleMs));

    await fs.promises.mkdir(require('path').dirname(outPath), { recursive: true });
    await page.screenshot({ path: outPath, fullPage: true, type: 'png' });

    const stat = await fs.promises.stat(outPath);
    const dims = await page.evaluate(() => ({
      w: document.documentElement.scrollWidth,
      h: document.documentElement.scrollHeight,
    }));
    return {
      path: outPath,
      width: dims.w * dpr,
      height: dims.h * dpr,
      bytes: stat.size,
      mtimeMs: stat.mtimeMs,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { capturePage, isAvailable, CHROME_PATH, DINGTALK_UA };
