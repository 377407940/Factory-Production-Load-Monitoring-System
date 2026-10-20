/**
 * 工厂负载监控系统 - 配置
 */
const path = require('path');

module.exports = {
  // 金蝶云星空 API 配置（通过环境变量注入）
  kingdee: {
    serverUrl: process.env.KD_SERVER_URL || '',
    dbId: process.env.KD_DBID || '',
    appKey: process.env.KD_APP_KEY || '',
    appSecret: process.env.KD_APP_SECRET || '',
    // LoginByAppSecret 集成用户名
    username: process.env.KD_USERNAME || '',
    // 集成账号密码（LoginByAppSecret 方式通常留空）
    password: process.env.KD_PASSWORD || '',
    // 数据起始日期，仅同步此日期之后的单据
    dataStartDate: process.env.DATA_START_DATE || '2025-01-01',
  },

  // 服务配置
  server: {
    port: parseInt(process.env.PORT || '4000', 10),
  },

  // 缓存配置（秒）
  cache: {
    ttl: parseInt(process.env.CACHE_TTL || '300', 10), // 默认 5 分钟
  },

  // SQLite 持久化配置
  sqlite: {
    enabled: process.env.SQLITE_ENABLED !== 'false', // 默认开启
    path: process.env.SQLITE_PATH || '',
    mesPath: process.env.MES_SQLITE_PATH || '', // MES 库（留空则用默认 data/mes_records.db）
  },

  // MES 推送（192.168.1.14 → 本服务；2026-09-14 起金蝶工序汇报停用后的数据源）
  mesPush: {
    token: process.env.MES_PUSH_TOKEN || '', // 必须配置，否则 /mes-push 直接报错
  },

  // 对外只读接口（供同机其它自研应用调用，见 routes/open.js）
  openApi: {
    key: process.env.OPEN_API_KEY || '', // 必须配置，否则 /api/open/* 一律报错
  },

  // 钉钉身份登录（OAuth2 网页授权；复用同机 /problem/ 那个企业内部应用）
  dingtalk: {
    appKey: process.env.DINGTALK_APP_KEY || '',
    appSecret: process.env.DINGTALK_APP_SECRET || '',
    // 仅本地自测用：把 api.dingtalk.com 指向桩服务，不用真凭据也能跑通流程
    apiBaseV1: process.env.DINGTALK_API_V1_BASE || '',
  },

  // 灌装成品对比：生产入库(PRD_INSTOCK)同步
  fillBox: {
    // 每 30 分钟一次。**故意避开整点和半点** —— 那些点被别的任务占了：
    //   :00 电表同步、:15/:45 MES 看门狗、:30 金蝶 SFC 全量同步（要跑 27~35 秒）
    syncCron: process.env.FILLBOX_SYNC_CRON || '10,40 * * * *',
  },

  // 人员模块（员工档案：岗位/技能等级手工维护；剂型字典由 BD_MATERIAL 的物料分组生成）
  staff: {
    dbPath: process.env.STAFF_DB_PATH || path.resolve(__dirname, '../../data/staff.db'),
    // 剂型字典每天刷一次（BD_MATERIAL 变动极少）；避开 6:40 / 6:50 / 7:20 那批任务
    refreshCron: process.env.STAFF_REFRESH_CRON || '10 7 * * *',
    // 岗位 / 技能等级的固定选项。要改直接改这两个环境变量，不用动代码。
    positions: (process.env.STAFF_POSITIONS || '配料,灌装,灭菌,外包').split(','),
    skillLevels: (process.env.STAFF_SKILL_LEVELS || '1级,2级,3级,4级,5级,6级').split(','),
    // 人员名单：钉钉通讯录同步。只同步这两个部门及其子部门，不存手机号。
    directory: {
      enabled: process.env.DINGTALK_STAFF_SYNC_ENABLED !== 'false',
      innerDeptId: process.env.DINGTALK_STAFF_INNER_DEPT || '663751617', // 生产部（内包）
      outerDeptId: process.env.DINGTALK_STAFF_OUTER_DEPT || '665374465', // 生产部（外包）
      syncCron: process.env.DINGTALK_STAFF_SYNC_CRON || '30 7 * * *',
    },
  },

  // 访问网关 / 会话
  auth: {
    // auto   = 配了钉钉凭据就走钉钉登录，没配就退回旧的 UA 网关（默认，安全上线用）
    // legacy = 强制走旧的 UA/Referer 判断（行为与本改造之前完全一致）
    // off    = 完全不拦（应急逃生口，启动会大声告警）
    gateMode: process.env.AUTH_GATE_MODE || 'auto',
    // 裸域名，**不带 /monitor** —— 回调挂在 /api/monitor/auth 下
    publicBaseUrl: process.env.PUBLIC_BASE_URL || 'https://k3-aitable.xyz',
    sessionDays: parseInt(process.env.AUTH_SESSION_DAYS || '30', 10),
    dbPath: process.env.AUTH_DB_PATH || path.resolve(__dirname, '../../data/sessions.db'),
    cookieName: 'fm_session',
    // 截图管线的兜底通路（见 middleware/auth.js 的 internalTokenExchange）。
    // 留空则关闭该通路，只靠「内部直连」判据。
    bypassToken: process.env.AUTH_BYPASS_TOKEN || '',
  },

  // 同步配置（秒）
  sync: {
    interval: parseInt(process.env.SYNC_INTERVAL || '3600', 10), // 增量同步间隔，默认 1 小时
    fullResyncHours: parseInt(process.env.FULL_RESYNC_HOURS || '168', 10), // 全量覆盖周期，默认 7 天
  },

  // 智能电表配置
  meter: {
    enabled: process.env.METER_ENABLED !== 'false',
    baseUrl: process.env.METER_BASE_URL || '',
    account: process.env.METER_ACCOUNT || '',
    password: process.env.METER_PASSWORD || '',
    dbPath: process.env.METER_DB_PATH || path.resolve(__dirname, '../../data/power_data.db'),
    pricePerKwh: parseFloat(process.env.METER_PRICE_PER_KWH || '0.92'),
  },

  // 钉钉自定义机器人（群机器人 webhook + 加签密钥）
  robot: {
    webhook: process.env.ROBOT_WEBHOOK || '',
    secret: process.env.ROBOT_SECRET || '',
  },

  // 生产执行日报推送（cron 表达式，默认每天 8:00 推前一天）
  report: {
    pushCron: process.env.REPORT_PUSH_CRON || '0 8 * * *',
    // 表格图片公网基础地址（钉钉 markdown 插图用；Nginx 单独服务 /monitor/reports/ 绕过钉钉UA保护）
    baseUrl: process.env.REPORT_BASE_URL || 'https://k3-aitable.xyz/monitor',
    // 表格图片落盘目录（Nginx alias 指向同一目录）
    reportsDir: process.env.REPORT_IMAGES_DIR || path.resolve(__dirname, '../../../reports'),
  },

  // 生产损耗数据（stick-data 损耗接口 → 本地 loss_data.db）
  loss: {
    dbPath: process.env.LOSS_DB_PATH || path.resolve(__dirname, '../../data/loss_data.db'),
    // 每日预热任务：拉近 N 天看板出现过的条袋订单损耗
    prewarmDays: parseInt(process.env.LOSS_PREWARM_DAYS || '10', 10),
    prewarmCron: process.env.LOSS_PREWARM_CRON || '20 7 * * *',
  },

  // 呆滞成品（金蝶即时库存 STK_Inventory → 本地每日快照 → 账龄超阈值即呆滞）
  stagnant: {
    orgNumber: process.env.STAGNANT_ORG || 'YJY', // 只统计该库存组织（FStockOrgId.FNumber）
    stockName: process.env.STAGNANT_STOCK_NAME || '成品仓', // 只统计该仓库
    thresholdDays: parseInt(process.env.STAGNANT_DAYS || '30', 10), // 账龄 > 该天数即呆滞
    allowedDays: [30, 60, 90], // 页面可切换的阈值白名单
    keepDays: parseInt(process.env.STAGNANT_KEEP_DAYS || '400', 10), // 快照保留天数
    // 每日落快照（供趋势）—— 避开 6:40 生产入库、7:20 损耗预热
    cron: process.env.STAGNANT_CRON || '50 6 * * *',
    dbPath: process.env.STAGNANT_DB_PATH || path.resolve(__dirname, '../../data/inventory.db'),
    // 每日把看板整页截图推到钉钉群（与生产日报同点；快照 6:50 已就绪）
    pushCron: process.env.STAGNANT_PUSH_CRON || '0 8 * * *',
  },
};
