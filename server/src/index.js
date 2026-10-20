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
const authRouter = require('./routes/auth');
const staffRouter = require('./routes/staff');
const openRouter = require('./routes/open');
const sessionStore = require('./services/sessionStore');
const { attachSession, requireAuthApi, internalTokenExchange, effectiveMode } = require('./middleware/auth');
const PowerSyncService = require('./services/powerSyncService');
const cron = require('node-cron');

// 数据起始年份与预热年份：随当前年份自动扩展，跨年后无需再改代码
const FIRST_DATA_YEAR = parseInt(String(config.kingdee.dataStartDate || '2025-01-01').slice(0, 4), 10) || 2025;
function getDataYears() {
  const current = new Date().getFullYear();
  const years = [];
  for (let y = FIRST_DATA_YEAR; y <= current; y++) years.push(y);
  return years;
}

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

// ==== 访问网关（钉钉身份登录；旧的 UA/Referer 判断退居为降级路径）====
// 见 middleware/auth.js 里的详细注释 —— 尤其是 isDirectLocal 为什么不能只看源地址。

// Nginx 在本机反代，信任回环上的代理，这样 X-Forwarded-* 才会被采纳
app.set('trust proxy', 'loopback');

// ==== 路由 ====
// 认证路由必须挂在网关**之前**（回调时人还没登录，不能被他自己的网关拦住）
app.use('/api/monitor/auth', attachSession, authRouter);
// 人员模块：独立 router，排在 /api/monitor 之前，同样过网关（自动继承钉钉登录保护）
app.use('/api/monitor/staff', attachSession, requireAuthApi, staffRouter);
// 监控路由（钉钉登录保护）
app.use('/api/monitor', attachSession, requireAuthApi, monitorRouter);

// 对外只读接口（供同机其它自研应用调用）：不挂钉钉 UA 校验，改用 X-Api-Key 鉴权
app.use('/api/open', openRouter);

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

// MES 推送看门狗：2026-09-14 起产量依赖工厂内网(192.168.1.14)推送，断流需及时告警
if (engine.mesDb && config.robot.webhook) {
  const robot = require('./services/dingTalkRobot');
  let lastAlertAt = 0;
  cron.schedule('15,45 * * * *', () => {
    const last = engine.getMesLastPushAt();
    if (!last) return; // 从未推送过（尚未上线）不告警
    const ageMin = Math.round((Date.now() - new Date(last).getTime()) / 60000);
    const hour = new Date().getHours();
    if (ageMin <= 90) return; // 正常
    if (hour < 6 || hour >= 22) return; // 非生产时段不告警
    if (Date.now() - lastAlertAt < 2 * 3600 * 1000) return; // 最多 2 小时告警一次
    lastAlertAt = Date.now();
    const text = `### ⚠️ 工厂看板数据源告警\n\n` +
      `**MES 数据已 ${ageMin} 分钟未推送**\n\n` +
      `- 最后推送：${new Date(last).toLocaleString('zh-CN')}\n` +
      `- 影响：9/14 起的车间产量、OEE 将不再更新\n` +
      `- 排查：192.168.1.14 的 \`C:\\mes-push\\logs\` 日志、计划任务 \`MES-Push-To-Monitor\``;
    console.warn(`[server] MES 推送看门狗告警: 已 ${ageMin} 分钟未推送`);
    robot.sendMarkdown(config.robot.webhook, config.robot.secret, { title: '工厂看板数据源告警', markdown: text })
      .catch((err) => console.error(`[server] 看门狗告警发送失败: ${err.message}`));
  });
  console.log('[server] 已注册 MES 推送看门狗：每小时 15/45 分检查');
}

// 钉钉生产执行日报推送（每天 8:00 推前一天；未配置 webhook 则跳过）
if (config.robot.webhook) {
  cron.schedule(config.report.pushCron, () => {
    console.log('[server] 钉钉生产日报推送触发');
    monitorRouter.sendDailyReport().catch((err) => {
      console.error(`[server] 钉钉生产日报推送失败: ${err.message}`);
    });
  });
  console.log(`[server] 已注册钉钉日报推送：${config.report.pushCron}`);
} else {
  console.log('[server] 未配置 ROBOT_WEBHOOK，跳过钉钉日报定时推送');
}

// 呆滞成品看板 → 钉钉群（整页截图；每天 8:00，快照 6:50 已就绪）
if (config.robot.webhook) {
  cron.schedule(config.stagnant.pushCron, () => {
    console.log('[server] 呆滞成品看板推送触发');
    monitorRouter.pushStagnantReport().catch((err) => {
      console.error(`[server] 呆滞成品看板推送失败: ${err.message}`);
    });
  });
  console.log(`[server] 已注册呆滞成品看板推送：${config.stagnant.pushCron}`);
} else {
  console.log('[server] 未配置 ROBOT_WEBHOOK，跳过呆滞成品看板推送');
}

// 生产损耗数据预热（每天定时拉近 N 天条袋订单损耗入库；走外部损耗接口，不依赖本机 webhook）
if (config.meter.baseUrl) {
  cron.schedule(config.loss.prewarmCron, () => {
    console.log(`[server] 损耗数据预热触发（近 ${config.loss.prewarmDays} 天）`);
    monitorRouter.prewarmLoss()
      .then((r) => {
        console.log(`[server] 损耗预热完成: 成功 ${r.ok} / 失败 ${r.fail} / 共 ${r.total}`);
        // 预热产生新损耗记录 → 顺带同步生产入库 + 重建盒条比（灌装/成品对比依赖）
        return monitorRouter.syncFillBox().then((fb) => {
          console.log(`[server] 灌装入库同步完成: ${fb.count} 行, 盒条比 ${fb.ratio} 个`);
          return monitorRouter.notifySyncResult('成品入库同步', true);
        }).catch((err) => {
          console.error(`[server] 灌装入库同步失败: ${err.message}`);
          return monitorRouter.notifySyncResult('成品入库同步', false, err.message);
        });
      })
      .catch((err) => {
        console.error(`[server] 损耗预热失败: ${err.message}`);
      });
  });
  console.log(`[server] 已注册损耗预热：${config.loss.prewarmCron}（近 ${config.loss.prewarmDays} 天）`);
} else {
  console.log('[server] 未配置电表 API，跳过损耗预热');
}

// 灌装/成品入库(PRD_INSTOCK)每日同步（每天 6:40，独立于损耗预热）
if (engine && engine.client && engine.client.isConfigured()) {
  cron.schedule(config.fillBox.syncCron, () => {
    monitorRouter.syncFillBox().then((r) => {
      console.log(`[server] 生产入库同步完成: ${r.count} 行, 盒条比 ${r.ratio} 个`);
      // 失败过就报一次「已恢复」，没失败过则什么都不发
      return monitorRouter.notifySyncResult('成品入库同步', true);
    }).catch((err) => {
      console.error(`[server] 生产入库同步失败: ${err.message}`);
      // 只在「由好变坏」时推一次，不会每 30 分钟刷屏
      monitorRouter.notifySyncResult('成品入库同步', false, err.message);
    });
  });
  console.log(`[server] 已注册生产入库同步：${config.fillBox.syncCron}（成品入库）`);
}

// 呆滞成品：每天落一份即时库存快照（供趋势；即时库存没有历史接口，只能逐日积累）
if (engine && engine.client && engine.client.isConfigured()) {
  cron.schedule(config.stagnant.cron, () => {
    console.log('[server] 呆滞成品快照触发');
    monitorRouter.ensureStagnantSnapshot()
      .then((r) => {
        console.log(`[server] 呆滞成品快照完成: ${r.count} 行`);
      })
      .catch((err) => {
        console.error(`[server] 呆滞成品快照失败: ${err.message}`);
      });
  });
  console.log(`[server] 已注册呆滞成品快照：${config.stagnant.cron}`);
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
      const years = getDataYears();
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
      for (const year of getDataYears()) {
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
    const years = getDataYears();
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

// ==== 前端静态文件 ====
// ⚠️ 静态文件**不挂**访问网关：登录页自己的 JS 就在这里面，拦了它连登录页都加载不出来。
// 数据只存在于 /api/monitor/* 后面，公开一堆静态 JS 不泄露任何东西。
const frontendDist = path.resolve(__dirname, '../../frontend/dashboard/dist');
// index.html 不缓存（确保部署后浏览器获取最新版本），带 hash 的静态资源长期缓存
app.use('/monitor', internalTokenExchange, express.static(frontendDist, {
  maxAge: '1y',
  setHeaders(res, filePath) {
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));
// SPA 回退：/monitor/* 不匹配文件时返回 index.html
app.get('/monitor/*', internalTokenExchange, (req, res) => {
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

// 会话清理（每天凌晨 4:30）
cron.schedule('30 4 * * *', () => {
  sessionStore.purgeExpired();
});

// 人员模块的剂型字典（BD_MATERIAL 物料分组 → 固体/液体），每天刷新一次
if (config.kingdee.appKey) {
  cron.schedule(config.staff.refreshCron, () => {
    console.log('[server] 剂型字典刷新触发');
    staffRouter.refreshMaterialGroups()
      .then((r) => console.log(`[server] 剂型字典刷新完成: ${r.count} 个产品名，歧义 ${r.ambiguous} 个`))
      .catch((err) => console.error(`[server] 剂型字典刷新失败: ${err.message}`));
  });
  console.log(`[server] 已注册剂型字典刷新：${config.staff.refreshCron}`);
}

// 人员名单：钉钉通讯录（内包 / 外包两个子树），每天 7:30 同步
if (config.staff.directory.enabled && config.dingtalk.appKey && config.dingtalk.appSecret) {
  cron.schedule(config.staff.directory.syncCron, () => {
    console.log('[server] 钉钉人员名单同步触发');
    staffRouter.syncDirectory()
      .then((r) => console.log(`[server] 钉钉人员名单同步完成: ${r.departmentCount} 个部门 / ${r.count} 人`))
      .catch((err) => console.error(`[server] 钉钉人员名单同步失败: ${err.message}`));
  });
  console.log(`[server] 已注册钉钉人员名单同步：${config.staff.directory.syncCron}`);
}

// ==== 启动 ====
// ⚠️ 绑回环，不给公网直连 4000 的机会。
// 这不是洁癖：「内部直连」判据（middleware/auth.js 的 isDirectLocal）建立在
// 「外部到不了 4000」之上 —— 否则外部可以直连并故意不带 X-Forwarded-For 来伪造它。
// Nginx 在本机、/api/open 的调用方也都在本机，绑回环不影响任何现有链路。
app.listen(PORT, '127.0.0.1', () => {
  const mode = effectiveMode();
  const mask = config.dingtalk.appKey ? `${config.dingtalk.appKey.slice(0, 8)}…` : '';
  console.log(`[server] 工厂负载监控系统已启动，端口: ${PORT}（仅监听回环 127.0.0.1）`);
  console.log(`[server] 访问网关模式: ${mode}` + (mode === 'dingtalk'
    ? `（钉钉登录，AppKey ${mask}，会话 ${config.auth.sessionDays} 天）`
    : mode === 'legacy'
      ? '（未配置钉钉凭据 → 降级为旧的 UA/Referer 判断）'
      : ''));
  console.log(`[server] 截图兜底通路 AUTH_BYPASS_TOKEN: ${config.auth.bypassToken ? '已配置' : '未配置（仅靠内部直连判据）'}`);
  console.log(`[server] 会话库: ${config.auth.dbPath}`);
  if (mode === 'off') {
    console.warn('[server] ⚠️⚠️ AUTH_GATE_MODE=off —— 访问网关已完全关闭，任何人都能读所有数据！仅用于应急。');
  }
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
  sessionStore.close();
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
  sessionStore.close();
  process.exit(0);
});
