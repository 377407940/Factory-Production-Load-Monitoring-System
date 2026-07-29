/**
 * 工厂负载监控系统 - 服务入口
 *
 * 启动 Express 服务，挂载监控 API 路由。
 */
// 必须在所有 require 之前加载 .env，确保 config 模块能读到环境变量
try {
  require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
} catch {
  // dotenv 非必需，无 .env 文件时使用环境变量
}

const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const monitorRouter = require('./routes/monitor');
const PowerSyncService = require('./services/powerSyncService');
const cron = require('node-cron');

const app = express();
const PORT = config.server.port;

// ==== 中间件 ====
app.use(cors());
app.use(express.json());

// 请求日志
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ==== 钉钉 UA / 文档内嵌 检查中间件 ====
function dingtalkOnly(req, res, next) {
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  const referer = (req.headers['referer'] || '').toLowerCase();

  // 钉钉客户端内置浏览器 → 放行
  if (ua.includes('dingtalk') || ua.includes('dingding')) return next();
  // 钉钉文档内嵌浏览器（通过 Referer 判断）→ 放行
  if (referer.includes('alidocs.dingtalk.com') || referer.includes('dingtalk.com/docs')) return next();
  // SPA 自身发出的 API 请求（同源）→ 放行（确保钉钉文档内嵌时 API 正常工作）
  if (referer.includes(req.hostname)) return next();

  // 非钉钉请求：返回阻止页面
  res.status(403).send(`<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>访问受限</title><style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,sans-serif;text-align:center;padding:20px}.box{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:48px 32px;max-width:360px;box-shadow:0 4px 20px rgba(0,0,0,.06)}.icon{width:64px;height:64px;margin:0 auto 20px;background:#eff6ff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:32px}.title{font-size:18px;font-weight:700;color:#111827;margin-bottom:8px}.desc{font-size:14px;color:#6b7280;line-height:1.6}</style></head>
<body><div class="box"><div class="icon">📱</div><div class="title">请在钉钉中打开</div><div class="desc">此页面仅在钉钉应用内允许访问，请使用钉钉扫描二维码或通过钉钉工作台打开。</div></div></body></html>`);
}

// ==== 路由 ====
// 监控路由（钉钉 UA 保护）
app.use('/api/monitor', dingtalkOnly, monitorRouter);

// 初始化聚合引擎并预热缓存
const engine = monitorRouter.initEngine();

// 初始化电表数据同步服务
const powerService = new PowerSyncService();
const powerInitialized = powerService.initialize();
if (powerInitialized) {
  // 注册到 monitor router
  monitorRouter.setPowerService(powerService);
  // 注入聚合引擎（用于车间负载率基于电量的计算）
  engine.setPowerService(powerService);

  // 电表同步完成后清除响应缓存
  powerService.onSync(() => monitorRouter.clearCache());

  // 金蝶同步完成后同样清除响应缓存
  engine.onSync(() => monitorRouter.clearCache());

  // 如果电表 API 已配置且有数据需要同步
  if (powerService.isMeterConfigured()) {
    // 启动时尝试同步（不阻塞）
    if (!powerService.store.hasData()) {
      powerService.sync().then(() => {
        console.log('[server] 电表数据首次同步完成');
      }).catch(err => {
        console.warn(`[server] 电表数据首次同步失败: ${err.message}`);
      });
    } else {
      console.log('[server] 电表数据已存在，跳过首次同步');
    }
    // 注册每日 8:00 定时同步
    powerService.scheduleDaily();
  } else {
    console.log('[server] 电表 API 未配置，跳过同步');
  }
} else {
  console.log('[server] 电表服务未初始化（降级运行）');
}

// 金蝶生产数据定时同步（每半小时触发，避免与电表整点同步冲突）
if (engine.db) {
  cron.schedule('30 * * * *', () => {
    console.log('[server] 金蝶生产数据定时同步触发');
    engine.scheduleSync();
  });
  console.log('[server] 已注册金蝶定时同步：每小时 30 分');
}

// 异步预热（不阻塞 listen）
(async () => {
  if (engine.db) {
    // 有 SQLite：本地毫秒级预热 + 后台同步
    const count = engine.db.getRecordCount();
    console.log(`[server] SQLite 已就绪, ${count} 条记录`);

    if (count > 0) {
      // 后台触发同步（不 await，不阻塞预热）
      engine.scheduleSync();

      // 本地并行预热（毫秒级）
      const years = [2025, 2026];
      const dims = ['day', 'week', 'month', 'year'];
      let done = 0;
      const total = years.length * dims.length;
      const tasks = years.flatMap(y => dims.map(d =>
        engine.fetchAndAggregate(d, y).then(r => {
          done++;
          console.log(`[server] 缓存预热 ${done}/${total} dimension=${d} year=${y}`);
        }).catch(err => {
          done++;
          console.warn(`[server] 缓存预热失败 ${done}/${total} dimension=${d} year=${y}: ${err.message}`);
        })
      ));
      await Promise.all(tasks);
      console.log('[server] 全量缓存预热完成 (SQLite)');
    } else {
      // SQLite 为空，首次全量同步
      console.log('[server] SQLite 为空，开始首次同步...');
      try {
        await engine._syncFromKingdee();
      } catch (err) {
        console.warn(`[server] 首次同步失败: ${err.message}`);
      }
      // 预热
      for (const year of [2025, 2026]) {
        for (const dim of ['day', 'week', 'month', 'year']) {
          try {
            await engine.fetchAndAggregate(dim, year);
          } catch (err) {
            console.warn(`[server] 缓存预热失败 dimension=${dim} year=${year}: ${err.message}`);
          }
        }
      }
      console.log('[server] 首次同步 + 预热完成');
    }
  } else {
    // 无 SQLite：串行金蝶预热（原流程）
    console.log('[server] 聚合引擎已初始化，正在预热缓存...');
    const years = [2025, 2026];
    const total = years.length * 4;
    let done = 0;
    for (const year of years) {
      for (const dim of ['day', 'week', 'month', 'year']) {
        done++;
        try {
          await engine.fetchAndAggregate(dim, year);
          console.log(`[server] 缓存预热 ${done}/${total} dimension=${dim} year=${year}`);
        } catch (err) {
          console.warn(`[server] 缓存预热失败 ${done}/${total} dimension=${dim} year=${year}: ${err.message}`);
        }
      }
    }
    console.log('[server] 全量缓存预热完成');
  }
})();

// ==== 根路由 ====
app.get('/', (req, res) => {
  res.json({
    service: '工厂负载监控系统 API',
    version: '1.0.0',
    endpoints: [
      'GET /api/monitor/overview         - 工厂总览',
      'GET /api/monitor/workshops         - 所有车间',
      'GET /api/monitor/workshop/:id      - 指定车间详情',
      'GET /api/monitor/equipment/:name   - 指定设备详情',
      'GET /api/monitor/equipment-types   - 设备类型列表',
      'GET /api/monitor/health            - 健康检查',
    ],
  });
});

// ==== 前端静态文件（钉钉 UA 保护） ====
const frontendDist = path.resolve(__dirname, '../../frontend/dashboard/dist');
// index.html 不缓存（确保部署后浏览器获取最新版本），带 hash 的静态资源长期缓存
app.use('/monitor', dingtalkOnly, express.static(frontendDist, {
  maxAge: '1y',
  setHeaders(res, filePath) {
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));
// SPA 回退：/monitor/* 不匹配文件时返回 index.html
app.get('/monitor/*', dingtalkOnly, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(frontendDist, 'index.html'));
});

// ==== 404 ====
app.use((req, res) => {
  res.status(404).json({ code: 404, msg: 'Not Found' });
});

// ==== 错误处理 ====
app.use((err, req, res, _next) => {
  console.error('[server] 未捕获错误:', err);
  res.status(500).json({ code: 500, msg: '服务器内部错误' });
});

// ==== 启动 ====
app.listen(PORT, () => {
  console.log(`[server] 工厂负载监控系统已启动，端口: ${PORT}`);
  console.log(`[server] 健康检查: http://localhost:${PORT}/api/monitor/health`);
  console.log(`[server] API 文档: http://localhost:${PORT}/`);
});

// 优雅退出
process.on('SIGINT', () => {
  console.log('[server] 收到 SIGINT，正在关闭...');
  if (engine && engine.db) {
    engine.db.close();
  }
  if (powerService && powerService.store) {
    powerService.store.close();
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[server] 收到 SIGTERM，正在关闭...');
  if (engine && engine.db) {
    engine.db.close();
  }
  if (powerService && powerService.store) {
    powerService.store.close();
  }
  process.exit(0);
});
