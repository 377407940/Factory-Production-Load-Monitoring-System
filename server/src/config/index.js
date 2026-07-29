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
};
