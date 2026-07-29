/**
 * 电表数据同步与聚合服务
 *
 * 职责：
 *   1. 每天 8:00 从第三方电表 API 拉取全车间用电量数据
 *   2. 持久化到 SQLite
 *   3. 按日/周/月/年维度聚合，提供车间级和全厂级用电量
 *   4. 计算电费（单价 × 用电量）
 *
 * 容错：
 *   - 电表 API 不可用或未配置时静默降级（返回零值）
 *   - 所有初始化失败不阻止服务器启动
 */
const path = require('path');
const cron = require('node-cron');
const SmartMeterClient = require('./smartMeterClient');
const PowerDataStore = require('./powerDataStore');
const { WORKSHOP_METER_MAP, FACTORY_TO_METER } = require('../config/workshopMeterMap');
const config = require('../config');

/**
 * ISO 周数计算
 */
function getISOWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

/**
 * 获取时段标识
 */
function getPeriodKey(dateStr, dimension) {
  const d = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
  switch (dimension) {
    case 'day': return dateStr;
    case 'week': {
      const w = getISOWeekNumber(d);
      return `${d.getFullYear()}-W${String(w).padStart(2, '0')}`;
    }
    case 'month': return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    case 'year': return `${d.getFullYear()}`;
    default: return dateStr;
  }
}

/**
 * 生成从年初到当前的所有 period key
 */
function generatePeriodKeys(dimension, year, endDateStr) {
  const now = endDateStr ? new Date(endDateStr) : new Date();
  const targetYear = year || now.getFullYear();
  const isCurrentYear = targetYear === now.getFullYear();
  const keys = [];
  const fmt = (dt) => {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  if (dimension === 'month') {
    const maxMonth = isCurrentYear ? now.getMonth() + 1 : 12;
    for (let m = 1; m <= maxMonth; m++) {
      keys.push(`${targetYear}-${String(m).padStart(2, '0')}`);
    }
  } else if (dimension === 'week') {
    const endDate = isCurrentYear ? now : new Date(targetYear, 11, 31);
    const maxWeek = getISOWeekNumber(endDate);
    for (let w = 1; w <= maxWeek; w++) {
      keys.push(`${targetYear}-W${String(w).padStart(2, '0')}`);
    }
  } else if (dimension === 'year') {
    keys.push(`${targetYear}`);
  } else {
    const start = new Date(targetYear, 0, 1);
    const end = isCurrentYear ? now : new Date(targetYear, 11, 31);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      keys.push(fmt(d));
    }
  }
  return keys;
}

class PowerSyncService {
  constructor() {
    this.meterConfig = config.meter;
    this.pricePerKwh = this.meterConfig.pricePerKwh || 0.8;

    /** @type {PowerDataStore|null} */
    this.store = null;

    /** @type {SmartMeterClient|null} */
    this.meterClient = null;

    /** @type {Map<string, { data: object, timestamp: number }>} */
    this._cache = new Map();
    this.CACHE_TTL_MS = 300 * 1000; // 5 分钟

    /** @type {Function|null} */
    this._onSync = null;

    this._initialized = false;
  }

  /** 初始化（不会因失败而抛异常） */
  initialize() {
    try {
      // 1. 初始化 PowerDataStore
      const dbPath = this.meterConfig.dbPath || path.resolve(__dirname, '../../data/power_data.db');
      this.store = new PowerDataStore(dbPath);
      this.store.initialize();

      // 2. 初始化 SmartMeterClient
      if (this.meterConfig.enabled && this.meterConfig.baseUrl) {
        this.meterClient = new SmartMeterClient({
          baseUrl: this.meterConfig.baseUrl,
          account: this.meterConfig.account,
          password: this.meterConfig.password,
        });
      } else {
        console.log('[power] 电表 API 未配置，跳过');
      }

      this._initialized = true;
      console.log('[power] 服务初始化完成');
      return true;
    } catch (err) {
      console.warn(`[power] 初始化失败: ${err.message}`);
      return false;
    }
  }

  /** 服务是否可用 */
  isAvailable() {
    return this._initialized && this.store !== null;
  }

  /** 电表 API 是否已配置 */
  isMeterConfigured() {
    return this.meterClient !== null && this.meterClient.isConfigured();
  }

  /**
   * 注册同步完成回调（用于清除外部缓存等）
   */
  onSync(cb) {
    this._onSync = cb;
  }

  // ===================== 数据同步 =====================

  /**
   * 从电表 API 全量拉取并存储
   * 查询范围：2024-09-01 ~ 当天（API 最早数据始于 2024-09-01）
   */
  async sync() {
    if (!this.isMeterConfigured()) {
      console.warn('[power] 电表 API 未配置，无法同步');
      return false;
    }

    try {
      const today = new Date();
      const endStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

      console.log(`[power] 开始同步电表数据 (2024-09-01 ~ ${endStr})`);

      // 调用 API 获取原始数据
      const rawData = await this.meterClient.queryData({
        workshop: [],
        time: ['2024-09-01', endStr],
      });

      if (!Array.isArray(rawData) || rawData.length === 0) {
        console.warn('[power] API 返回空数据');
        return false;
      }

      // 转换为存储格式，同时映射车间名称
      const rows = rawData.map(r => ({
        meter_name: r.name,
        date: r.date,
        value: parseFloat(r.value) || 0,
        workshop: WORKSHOP_METER_MAP[r.name] || null,
      }));

      // 批量写入 SQLite
      this.store.upsertBatch(rows);
      this.store.setMeta('lastSyncTime', new Date().toISOString());
      this.store.setMeta('lastSyncStatus', 'success');

      // 清除聚合缓存
      this._cache.clear();

      console.log(`[power] 同步完成: ${rows.length} 行, ${this.store.getCount()} 总记录`);

      // 通知外部同步完成（清除响应缓存等）
      if (this._onSync) this._onSync();

      return true;
    } catch (err) {
      console.error(`[power] 同步失败: ${err.message}`);
      this.store.setMeta('lastSyncStatus', `error: ${err.message}`);
      return false;
    }
  }

  /**
   * 注册每小时定时同步
   */
  scheduleDaily() {
    if (!this._initialized) return;

    cron.schedule('0 * * * *', () => {
      console.log('[power] 定时同步触发');
      this.sync();
    });
    console.log('[power] 已注册定时同步：每小时整点');
  }

  // ===================== 元数据访问 =====================

  getLastSyncTime() {
    return this.store ? this.store.getMeta('lastSyncTime') : null;
  }

  getRecordCount() {
    return this.store ? this.store.getCount() : 0;
  }

  getSyncStatus() {
    return this.store ? this.store.getMeta('lastSyncStatus') : 'not_initialized';
  }

  getDateRange() {
    if (!this.store) return { start: null, end: null };
    return { start: this.store.getMinDate(), end: this.store.getMaxDate() };
  }

  // ===================== 聚合查询 =====================

  /**
   * 获取全厂用电量趋势（按指定维度聚合）
   * @param {string} dimension - 'day' | 'week' | 'month' | 'year'
   * @param {number} year
   * @param {string} [startDate] - 可选日期范围起始
   * @param {string} [endDate] - 可选日期范围结束
   * @returns {Array<{label: string, value: number}>} — value 单位为 kWh
   */
  getPowerTrend(dimension, year, startDate, endDate) {
    return this._getTrend('total', dimension, year, startDate, endDate);
  }

  /**
   * 获取全厂电费趋势（用电量 × 单价）
   * @param {string} dimension
   * @param {number} year
   * @param {string} [startDate] - 可选日期范围起始
   * @param {string} [endDate] - 可选日期范围结束
   * @returns {Array<{label: string, value: number}>} — value 单位为 元
   */
  getPowerCostTrend(dimension, year, startDate, endDate) {
    const trend = this._getTrend('total', dimension, year, startDate, endDate);
    return trend.map(t => ({ label: t.label, value: +(t.value * this.pricePerKwh).toFixed(2) }));
  }

  /**
   * 获取指定车间的用电量趋势
   * @param {string} workshop - 工厂车间名称（如 'Y固体一1号车间'）
   * @param {string} dimension
   * @param {number} year
   * @param {string} [startDate] - 可选日期范围起始
   * @param {string} [endDate] - 可选日期范围结束
   * @returns {Array<{label: string, value: number}>}
   */
  getWorkshopPowerTrend(workshop, dimension, year, startDate, endDate) {
    return this._getTrend(workshop, dimension, year, startDate, endDate);
  }

  /**
   * 获取指定车间的电费趋势
   */
  getWorkshopPowerCostTrend(workshop, dimension, year, startDate, endDate) {
    const trend = this._getTrend(workshop, dimension, year, startDate, endDate);
    return trend.map(t => ({ label: t.label, value: +(t.value * this.pricePerKwh).toFixed(2) }));
  }

  /**
   * 获取当前维度下最新时段的用电量（kWh）
   * 当传入 startDate/endDate 时，返回该范围内的总用电量（求和）
   */
  getLatestPower(dimension, year, startDate, endDate) {
    const trend = this.getPowerTrend(dimension, year, startDate, endDate);
    if (trend.length === 0) return 0;
    if (startDate && endDate) {
      // 日期范围：对该范围内所有时段求和
      return +trend.reduce((sum, t) => sum + t.value, 0).toFixed(1);
    }
    return trend[trend.length - 1].value;
  }

  /**
   * 获取指定车间在当前维度下最新时段的用电量
   * 当传入 startDate/endDate 时，返回该范围内的总用电量（求和）
   */
  getLatestWorkshopPower(workshop, dimension, year, startDate, endDate) {
    const trend = this.getWorkshopPowerTrend(workshop, dimension, year, startDate, endDate);
    if (trend.length === 0) return 0;
    if (startDate && endDate) {
      // 日期范围：对该范围内所有时段求和
      return +trend.reduce((sum, t) => sum + t.value, 0).toFixed(1);
    }
    return trend[trend.length - 1].value;
  }

  /**
   * 获取所有已映射车间在当前维度下的用电量（用于车间卡片）
   * @param {string} [startDate] - 可选日期范围起始
   * @param {string} [endDate] - 可选日期范围结束
   * @returns {Map<string, number>}  workshopName → kWh
   */
  getWorkshopPowerMap(dimension, year, startDate, endDate) {
    if (!this.store) return new Map();

    const cacheKey = `wsmap_${dimension}_${year || ''}_${startDate || ''}_${endDate || ''}`;
    const cached = this._cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.data;
    }

    const targetYear = String(year || new Date().getFullYear());
    const effectiveEndDate = endDate || this.store.getMaxDate() || (year ? `${year}-12-31` : new Date().toISOString().slice(0, 10));
    const effectiveStartDate = startDate || `${targetYear}-01-01`;

    const rows = this.store.getGroupedByWorkshop(effectiveStartDate, effectiveEndDate);

    // 按时段分组
    const periodBuckets = new Map(); // workshop → periodKey → sum(value)
    const wsLatestPeriod = new Map(); // workshop → latest periodKey

    for (const r of rows) {
      if (!r.workshop) continue;
      const pk = getPeriodKey(r.date, dimension);
      if (!periodBuckets.has(r.workshop)) {
        periodBuckets.set(r.workshop, new Map());
      }
      const wsBucket = periodBuckets.get(r.workshop);
      wsBucket.set(pk, (wsBucket.get(pk) || 0) + r.value);
      // 跟踪最新时段
      if (!wsLatestPeriod.has(r.workshop) || pk > wsLatestPeriod.get(r.workshop)) {
        wsLatestPeriod.set(r.workshop, pk);
      }
    }

    // 返回结果：有日期范围时累加所有时段，否则仅返回最新时段
    const result = new Map();
    for (const ws of periodBuckets.keys()) {
      const wsBucket = periodBuckets.get(ws);
      if (startDate && endDate) {
        // 日期范围：累加所有时段
        let total = 0;
        for (const val of wsBucket.values()) {
          total += val;
        }
        result.set(ws, +total.toFixed(1));
      } else {
        // 仅返回最新时段
        const latestPk = wsLatestPeriod.get(ws);
        const val = wsBucket.get(latestPk) || 0;
        result.set(ws, +val.toFixed(1));
      }
    }

    this._cache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  }

  // ===================== 车间负载率（功率衍生） =====================

  /**
   * 获取各车间每日用电量（用于计算车间负载率）
   * @param {string} startDate - 'YYYY-MM-DD'
   * @param {string} endDate - 'YYYY-MM-DD'
   * @returns {Map<string, Map<string, number>>} Map<workshop, Map<date, kWh>>
   */
  getDailyWorkshopPowerMap(startDate, endDate) {
    if (!this.store) return new Map();
    const effectiveStart = startDate || this.store.getMinDate() || '2024-01-01';
    const effectiveEnd = endDate || this.store.getMaxDate() || new Date().toISOString().slice(0, 10);
    const rows = this.store.getGroupedByWorkshop(effectiveStart, effectiveEnd);
    const result = new Map();
    for (const r of rows) {
      if (!r.workshop) continue;
      if (!result.has(r.workshop)) result.set(r.workshop, new Map());
      const dateMap = result.get(r.workshop);
      dateMap.set(r.date, (dateMap.get(r.date) || 0) + r.value);
    }
    return result;
  }

  // ===================== 内部方法 =====================

  /**
   * 通用趋势查询
   * @param {string} scope - 'total' | workshopName
   * @param {string} [startDate] - 可选日期范围起始
   * @param {string} [endDate] - 可选日期范围结束
   */
  _getTrend(scope, dimension, year, startDate, endDate) {
    if (!this.store) return [];

    const cacheKey = `trend_${scope}_${dimension}_${year || ''}_${startDate || ''}_${endDate || ''}`;
    const cached = this._cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.data;
    }

    const targetYear = String(year || new Date().getFullYear());
    const effectiveEndDate = endDate || this.store.getMaxDate() || (year ? `${year}-12-31` : new Date().toISOString().slice(0, 10));
    const effectiveStartDate = startDate || `${targetYear}-01-01`;

    // 获取原始数据
    let rows;
    if (scope === 'total') {
      rows = this.store.getTotalByDate(effectiveStartDate, effectiveEndDate);
    } else {
      rows = this.store.getWorkshopData(scope, effectiveStartDate, effectiveEndDate);
    }

    // 按 period 聚合
    const periodMap = new Map();
    for (const r of rows) {
      const pk = getPeriodKey(r.date, dimension);
      periodMap.set(pk, (periodMap.get(pk) || 0) + r.value);
    }

    // 填充缺失时段
    let allPeriodKeys;
    if (startDate && endDate) {
      // 指定日期范围：生成该范围内的每日 keys
      const start = new Date(startDate);
      const end = new Date(endDate);
      allPeriodKeys = [];
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        allPeriodKeys.push(`${y}-${m}-${dd}`);
      }
    } else {
      allPeriodKeys = generatePeriodKeys(dimension, year, effectiveEndDate);
    }
    const result = allPeriodKeys.map(pk => {
      const rawVal = periodMap.get(pk) || 0;
      const label = dimension === 'year'
        ? `${parseInt(pk.slice(5, 7), 10)}月`
        : pk.length === 10 ? `${pk.slice(5, 7)}/${pk.slice(8, 10)}`
          : pk.includes('-W') ? pk.slice(2) : pk;
      return { label, value: +rawVal.toFixed(1) };
    });

    this._cache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  }
}

module.exports = PowerSyncService;
