/**
 * 核心聚合引擎
 *
 * 从金蝶 SFC_OperationReport 拉取数据，按维度（日/周/月）聚合计算：
 *   - 车间负载率（日/周/月）
 *   - 设备负载率（日/周/月）
 *   - 车间产出率
 *   - 设备产出率
 *
 * 缓存策略：5 分钟内存缓存，key = dimension
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const config = require('../config');
const { isWorkingDay, countWorkingDays, countWorkingDaysInMonth } = require('../config/holiday');
const { WORKSHOPS, WORKSHOP_AREAS, EQUIPMENT_TYPES, EQUIPMENT_LIST, WORKSHOP_LOAD_RATE_THRESHOLDS, getEquipmentByName } = require('../config/workshopMasterData');

/** 文件缓存目录（相对项目根目录） */
const CACHE_DIR = path.resolve(__dirname, '../../data/cache');

/** 已知车间名称集合（快速过滤用） */
const WORKSHOP_SET = new Set(WORKSHOPS);
/** 已知设备名称集合（快速过滤用） */
const EQUIPMENT_NAMES = new Set(EQUIPMENT_LIST.map(e => e.name));

// ====== 常量 ======

/** 每日额定负荷工时（两班制合计） */
const DAILY_MAX_HOURS = 22.5;

/** SFC_OperationReport 查询字段列表（顺序必须与 API 返回列一一对应） */
const FIELD_KEYS = [
  'FDate',               // 0
  'F_YJY_NewRealShop',   // 1
  'F_FD_Machine',        // 2
  'FQuaQty',             // 3
  'FReworkQty',          // 4
  'FWastageQty',         // 5
  'F_YJY_loadTimes',     // 6
  'F_FD_EXCEPTTimes',    // 7
  'F_FD_IMPORTTIMES',    // 8
  'F_UNW_WorkType2',     // 9
  'F_FD_Speeds',         // 10
  'F_YJY_equipSpeed',    // 11
  'F_FD_OEE',            // 12
  'F_YJY_OEE',           // 13
  'F_FD_AimPerProduct',  // 14
  'F_FD_RealPerProduct', // 15
  'FMaterialId',         // 16
  'FMaterialName',       // 17
  'FSpecification',      // 18
  'FMoNumber',           // 19
  'F_FD_OkRates',        // 20
  'F_FD_OperDescp',      // 21
];

/** 内联解析的点符号字段（在 FIELD_KEYS 之后追加） */
const DOT_FIELD = 'F_FD_Machine.FName';

/** 需要 parseFloat 的数值字段 */
const NUMERIC_FIELDS = new Set([
  'FQuaQty', 'FReworkQty', 'FWastageQty',
  'F_YJY_loadTimes', 'F_FD_EXCEPTTimes', 'F_FD_IMPORTTIMES',
  'F_FD_Speeds', 'F_YJY_equipSpeed', 'F_FD_OEE', 'F_YJY_OEE',
  'F_FD_AimPerProduct', 'F_FD_RealPerProduct', 'F_FD_OkRates',
]);

/** 班次映射 */
const SHIFT_MAP = {
  '10': '白班',
  '20': '晚班',
};

// ====== PRD_MO（生产订单）常量 ======

/** PRD_MO 查询字段 */
const PRD_MO_FIELD_KEYS = ['FBillNo', 'FDate', 'FQty'];
/** PRD_MO 内联解析字段（物料编码） */
const PRD_MO_DOT_FIELD = 'FMaterialId.FNumber';

// ====== 工具函数 ======

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
 * @param {string|Date} dateStr - 'YYYY-MM-DD' 或 Date
 * @param {string} dimension - 'day' | 'week' | 'month' | 'year'
 * @returns {string} 时段 key
 */
function getPeriodKey(dateStr, dimension) {
  const d = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
  switch (dimension) {
    case 'day':
      return dateStr;
    case 'week': {
      const w = getISOWeekNumber(d);
      return `${d.getFullYear()}-W${String(w).padStart(2, '0')}`;
    }
    case 'month':
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    case 'year':
      return `${d.getFullYear()}`;
    default:
      return dateStr;
  }
}

/**
 * 获取 ISO 周的所有日期
 */
function getWeekDates(year, week) {
  // 1月4日永远在第1周
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = jan4.getDay() || 7; // 1=Mon, 7=Sun
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - dayOfWeek + 1);

  const monday = new Date(week1Monday);
  monday.setDate(week1Monday.getDate() + (week - 1) * 7);

  const dates = [];
  const fmtLocal = (dt) => {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    dates.push(fmtLocal(d));
  }
  return dates;
}

/**
 * 获取某月的所有日期
 */
function getMonthDates(year, month) {
  const lastDay = new Date(year, month, 0).getDate();
  const dates = [];
  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    dates.push(dateStr);
  }
  return dates;
}

/**
 * 计算某周的工作日天数
 */
function countWorkingDaysInWeek(year, week) {
  const dates = getWeekDates(year, week);
  return dates.filter((d) => isWorkingDay(d)).length;
}

/**
 * 解析 periodKey，提取 year 和 week/month
 * periodKey 格式: '2026-W03', '2026-01'
 */
function parsePeriodKey(periodKey) {
  if (periodKey.includes('-W')) {
    const [yearStr, weekStr] = periodKey.split('-W');
    return { year: parseInt(yearStr, 10), week: parseInt(weekStr, 10) };
  }
  const [yearStr, monthStr] = periodKey.split('-');
  return { year: parseInt(yearStr, 10), month: parseInt(monthStr, 10) };
}

// ====== 聚合引擎类 ======

class AggregationEngine {
  constructor(client) {
    this.client = client;
    /** @type {Map<string, { data: object, timestamp: number }>} */
    this._cache = new Map();
    this.CACHE_TTL_MS = (config.cache.ttl || 300) * 1000;

    // SQLite 持久化（失败时静默降级）
    this.db = null;
    if (config.sqlite.enabled) {
      try {
        const Database = require('./database');
        const dbPath = config.sqlite.path || path.resolve(__dirname, '../../data/sfc_records.db');
        this.db = new Database(dbPath);
        this.db.initialize();
      } catch (err) {
        console.warn(`[agg] SQLite 初始化失败，回退金蝶直连: ${err.message}`);
      }
    }
    this.SYNC_INTERVAL_MS = (config.sync.interval || 300) * 1000;
    this._syncTimer = null;

    /** @type {Function|null} */
    this._onSync = null;

    /** @type {import('./powerSyncService')|null} */
    this.powerService = null;

    // 启动时从文件缓存加载到内存
    this._loadAllFileCaches();
  }

  // ===================== 公共 API =====================

  /**
   * 主入口：获取原始记录并聚合（带缓存）
   * - 有 SQLite：从本地读取，需要同步时后台触发
   * - 无 SQLite：回退金蝶直连
   * @param {string} dimension - 'day' | 'week' | 'month' | 'year'
   * @param {number} [year]
   * @param {string} [startDate] - 可选，日期范围起始 'YYYY-MM-DD'
   * @param {string} [endDate] - 可选，日期范围结束 'YYYY-MM-DD'
   * @returns {Promise<object>}
   */
  async fetchAndAggregate(dimension = 'day', year, startDate, endDate) {
    const cacheKey = `${dimension}_${year || ''}_${startDate || ''}_${endDate || ''}`;
    const cached = this._cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      console.log(`[agg] 缓存命中 key=${cacheKey}`);
      return cached.data;
    }

    console.log(`[agg] 开始获取数据 dimension=${dimension} year=${year} startDate=${startDate || '-'} endDate=${endDate || '-'}`);

    let records;

    if (this.db) {
      // 有 SQLite：从本地读取
      if (startDate && endDate) {
        // 指定日期范围：按范围查询
        records = this.db.getRecordsInRange(startDate, endDate);
        console.log(`[agg] 按日期范围查询: ${startDate} ~ ${endDate}, ${records.length} 条`);
      } else {
        records = this._readFromStorage();
        if (records.length === 0) {
          // SQLite 为空，执行一次全量同步
          records = await this._syncFromKingdee();
        } else {
          // 检查是否需要后台同步（不阻塞本次请求）
          this._checkSyncDue();
        }
      }
    } else {
      // 无 SQLite：金蝶直连（旧流程）
      records = await this._fetchRecords();
      await this._resolveWorkshopNames(records);
    }

    // 合并 Y固体一2号车间 → Y固体一1号车间（在聚合前重映射）
    this._remapWorkshopNames(records);

    // 获取电表数据用于车间负载率计算
    let powerDataMap = null;
    if (this.powerService && this.powerService.isAvailable()) {
      try {
        const psYear = year || new Date().getFullYear();
        const today = new Date().toISOString().slice(0, 10);
        const psEnd = endDate || (psYear < new Date().getFullYear() ? `${psYear}-12-31` : today);
        const psStart = startDate || `${psYear}-01-01`;
        powerDataMap = this.powerService.getDailyWorkshopPowerMap(psStart, psEnd);
        console.log(`[agg] 获取电表数据: ${powerDataMap.size} 个车间`);
      } catch (err) {
        console.warn(`[agg] 获取电表数据失败: ${err.message}`);
      }
    }

    // 聚合计算
    const aggregated = this._aggregate(records, dimension, year, startDate, endDate, powerDataMap);

    // 缓存
    this._cache.set(cacheKey, { data: aggregated, timestamp: Date.now() });
    // 只有全量数据才写入文件缓存
    if (!startDate && !endDate) {
      this._saveToFileCache(dimension, year, aggregated);
    }
    console.log(`[agg] 聚合完成 dimension=${dimension} year=${year} records=${records.length}`);

    return aggregated;
  }

  /**
   * 获取工厂总览
   */
  async getOverview(dimension = 'day', year, startDate, endDate) {
    return this._extractOverview(await this.fetchAndAggregate(dimension, year, startDate, endDate));
  }

  /**
   * 获取所有车间聚合数据
   */
  async getWorkshops(dimension = 'day', year, startDate, endDate) {
    return this._extractWorkshops(await this.fetchAndAggregate(dimension, year, startDate, endDate));
  }

  /**
   * 获取指定车间详情
   * @param {string} workshopName
   */
  async getWorkshopDetail(workshopName, dimension = 'day', year, startDate, endDate) {
    return this._extractWorkshopDetail(await this.fetchAndAggregate(dimension, year, startDate, endDate), workshopName);
  }

  /**
   * 获取指定设备详情
   * @param {string} equipmentName
   */
  async getEquipmentDetail(equipmentName, dimension = 'day', year, startDate, endDate) {
    return this._extractEquipmentDetail(await this.fetchAndAggregate(dimension, year, startDate, endDate), equipmentName);
  }

  /**
   * 获取设备类型列表
   */
  getEquipmentTypes() {
    return EQUIPMENT_TYPES.map((type) => ({
      type,
      equipment: EQUIPMENT_LIST.filter((e) => e.type === type).map((e) => e.name),
    }));
  }

  // ===================== PRD_MO 生产订单计划汇总 =====================

  /**
   * 将计划订单总量合并到总览数据中（仅年维度）
   * 从金蝶 PRD_MO 获取物料含 MP 的订单计划总数量，减去已产出量得到剩余未完成
   */
  async mergePlannedOrderInfo(data, year) {
    if (!year) return;
    try {
      const plannedTotal = await this._getPlannedOrderTotal(year);
      data.plannedOrderTotal = plannedTotal;
      data.remainingOrders = Math.max(0, plannedTotal - (data.totalOutput || 0));
      console.log(`[agg] 计划订单: year=${year} plannedTotal=${plannedTotal} totalOutput=${data.totalOutput || 0} remaining=${data.remainingOrders}`);
    } catch (err) {
      console.warn(`[agg] 获取计划订单数据失败: ${err.message}`);
    }
  }

  /**
   * 查询金蝶 PRD_MO，汇总 2026 年物料编码含 MP 的订单计划数量
   * 结果缓存到内存（和聚合缓存共用 TTL）
   */
  async _getPlannedOrderTotal(year) {
    const cacheKey = `plannedTotal_${year}`;
    const cached = this._cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.data;
    }

    console.log(`[agg] 查询 PRD_MO (year=${year})`);

    const extendedKeys = [...PRD_MO_FIELD_KEYS, PRD_MO_DOT_FIELD];
    const rawResult = await this.client.executeBillQueryAll('PRD_MO', {
      fieldKeys: extendedKeys,
      filter: `FDate >= '${year}-01-01' AND FDate <= '${year}-12-31' AND FPRDORGID.FNumber = 'YJY'`,
      orderString: 'FDate ASC',
    });

    if (!Array.isArray(rawResult) || rawResult.length === 0) {
      console.log(`[agg] PRD_MO 查询结果为空`);
      this._cache.set(cacheKey, { data: 0, timestamp: Date.now() });
      return 0;
    }

    // 解析 2D 数组：跳过可能的表头行
    let dataStart = 0;
    if (Array.isArray(rawResult[0])) {
      const hasHeader = rawResult[0].some(h => typeof h === 'string' && /^F[A-Z]/.test(h));
      if (hasHeader) dataStart = 1;
    }

    // 列索引：FBillNo=0, FDate=1, FQty=2, FMaterialId.FNumber=3
    const MATERIAL_COL = PRD_MO_FIELD_KEYS.length;
    let total = 0;

    for (let i = dataStart; i < rawResult.length; i++) {
      const row = rawResult[i];
      if (!row) continue;
      const materialCode = row[MATERIAL_COL];
      if (materialCode && String(materialCode).includes('MP')) {
        total += parseFloat(row[2]) || 0;
      }
    }

    console.log(`[agg] PRD_MO 汇总: MP 物料订单计划总量 = ${total}`);
    this._cache.set(cacheKey, { data: total, timestamp: Date.now() });
    return total;
  }

  // ===================== 数据获取与解析 =====================

  /**
   * 从金蝶拉取 SFC_OperationReport 全量数据并解析为内部格式
   */
  async _fetchRecords() {
    if (!this.client || !this.client.isConfigured()) {
      console.warn('[agg] 金蝶客户端未配置，返回空数据');
      return [];
    }

    const extendedKeys = [...FIELD_KEYS, DOT_FIELD];

    const rawResult = await this.client.executeBillQueryAll('SFC_OperationReport', {
      fieldKeys: extendedKeys,
      filter: "FDOCUMENTSTATUS = 'C'",
      orderString: 'FDate ASC',
    });

    if (!Array.isArray(rawResult) || rawResult.length === 0) {
      console.warn('[agg] 金蝶返回空数据');
      return [];
    }

    // 转换 2D 数组为记录数组
    let records = this._transformSfcRecords(rawResult, FIELD_KEYS);

    // 内联解析 F_FD_Machine（必须在 reverse 之前！）
    this._applyMachineInline(rawResult, records);

    // 班次映射与数值解析
    this._normalizeRecords(records);

    // 去重：基于全部字段指纹
    records = this._deduplicate(records);

    // 过滤工序说明
    records = this._filterByOperation(records);

    // 异常值过滤
    records = this._filterOutliers(records);

    console.log(`[agg] 有效记录数: ${records.length}`);
    return records;
  }

  /**
   * 基于 fields 指纹去重
   */
  _deduplicate(records) {
    const before = records.length;
    const seen = new Set();
    const result = records.filter(r => {
      const fingerprint = JSON.stringify(r.fields);
      if (seen.has(fingerprint)) return false;
      seen.add(fingerprint);
      return true;
    });
    if (before - result.length > 0) {
      console.log(`[agg] 去重: ${before} → ${result.length} (移除 ${before - result.length})`);
    }
    return result;
  }

  /**
   * 仅保留固体灌装和液体灌装的记录
   */
  _filterByOperation(records) {
    const before = records.length;
    const filtered = records.filter(r => {
      const operDescp = r.fields['F_FD_OperDescp'];
      return operDescp === '固体灌装' || operDescp === '液体灌装';
    });
    console.log(`[agg] 工序过滤: ${before} → ${filtered.length}`);
    return filtered;
  }

  /**
   * 移除 OEE > 1000% 的异常记录
   */
  _filterOutliers(records) {
    const before = records.length;
    const cleaned = records.filter(r => {
      const oee = r.fields['F_YJY_OEE'];
      return typeof oee !== 'number' || oee <= 1000;
    });
    if (before - cleaned.length > 0) {
      console.log(`[agg] 异常值过滤: ${before} → ${cleaned.length} (移除 ${before - cleaned.length})`);
    }
    return cleaned;
  }

  // ===================== SQLite 存储与同步 =====================

  /**
   * 从 SQLite 读取已处理的记录
   * @returns {Array}
   */
  _readFromStorage() {
    if (!this.db) return [];
    try {
      const records = this.db.getAllRecords();
      if (records.length > 0) {
        console.log(`[agg] 从 SQLite 读取: ${records.length} 条`);
      }
      return records;
    } catch (err) {
      console.warn(`[agg] SQLite 读取失败: ${err.message}`);
      return [];
    }
  }

  /**
   * 计算记录的内容哈希（用于去重标识）
   * @param {object} fields - 记录的 fields 对象
   * @returns {string} MD5 hex
   */
  _computeContentHash(fields) {
    const keys = Object.keys(fields).sort();
    const ordered = {};
    for (const k of keys) ordered[k] = fields[k];
    return crypto.createHash('md5').update(JSON.stringify(ordered)).digest('hex');
  }

  /**
   * 检查同步是否到期，触发后台同步
   */
  _checkSyncDue() {
    if (!this.db) return;
    const lastSync = this.db.getMeta('lastSyncTime');
    if (!lastSync) return;
    const elapsed = Date.now() - new Date(lastSync).getTime();
    if (elapsed >= this.SYNC_INTERVAL_MS) {
      console.log(`[agg] 同步到期 (距上次 ${Math.round(elapsed/1000)}s)，触发后台同步`);
      this.scheduleSync();
    }
  }

  /**
   * 后台调度一次同步（不 await，不阻塞）
   */
  scheduleSync() {
    if (!this.db) return;
    this._syncFromKingdee().then((records) => {
      if (records.length > 0) {
        console.log(`[agg] 后台同步完成: ${records.length} 条`);
        // 同步后清除内存缓存，下次请求会重新聚合
        this._cache.clear();
      }
      // 通知外部监听（清除响应缓存等）
      if (this._onSync) this._onSync();
    }).catch((err) => {
      console.warn(`[agg] 后台同步失败: ${err.message}`);
    });
  }

  /**
   * 从金蝶同步数据到 SQLite
   * 首次为全量，后续探测 FModifyDate 决定增量或全量
   */
  async _syncFromKingdee() {
    const lastSync = this.db ? this.db.getMeta('lastSyncTime') : null;

    if (lastSync && this.db.getMeta('fmodifyDateSupported') !== 'false') {
      // 尝试增量
      try {
        return await this._syncIncremental(lastSync);
      } catch (err) {
        console.warn(`[agg] 增量同步失败，回退全量: ${err.message}`);
      }
    }

    return await this._syncFull();
  }

  /**
   * 全量同步：从金蝶拉取所有记录，处理后写入 SQLite
   */
  async _syncFull() {
    console.log('[agg] 开始全量同步...');
    if (!this.client || !this.client.isConfigured()) {
      console.warn('[agg] 金蝶客户端未配置，返回空数据');
      return [];
    }

    // 探测 FModifyDate 是否可用
    const fmdSupported = await this._probeFModifyDate();
    if (this.db) {
      this.db.setMeta('fmodifyDateSupported', fmdSupported ? 'true' : 'false');
    }

    const extendedKeys = [...FIELD_KEYS, DOT_FIELD];
    if (fmdSupported) extendedKeys.push('FModifyDate');

    const rawResult = await this.client.executeBillQueryAll('SFC_OperationReport', {
      fieldKeys: extendedKeys,
      filter: "FDOCUMENTSTATUS = 'C'",
      orderString: 'FDate ASC',
    });

    if (!Array.isArray(rawResult) || rawResult.length === 0) {
      console.warn('[agg] 金蝶返回空数据');
      return [];
    }

    // 完整处理管道
    let records = this._transformSfcRecords(rawResult, FIELD_KEYS);
    this._applyMachineInline(rawResult, records);
    this._normalizeRecords(records);
    records = this._deduplicate(records);
    records = this._filterByOperation(records);
    records = this._filterOutliers(records);

    // 解析车间名称
    await this._resolveWorkshopNames(records);

    // 提取 FModifyDate
    if (fmdSupported) {
      this._extractModifyDates(rawResult, records);
    }

    // 计算内容哈希
    for (const r of records) {
      r.content_hash = this._computeContentHash(r.fields);
    }

    // 写入 SQLite
    if (this.db) {
      this.db.replaceAllRecords(records);
      this.db.setMeta('lastSyncTime', new Date().toISOString());
    }

    console.log(`[agg] 全量同步完成: ${records.length} 条`);
    return records;
  }

  /**
   * 增量同步：只拉取上次同步后修改的记录
   */
  async _syncIncremental(lastSync) {
    const from = lastSync || new Date(0).toISOString();
    console.log(`[agg] 开始增量同步 since=${from}`);

    const extendedKeys = [...FIELD_KEYS, DOT_FIELD, 'FModifyDate'];
    const filter = `FDOCUMENTSTATUS = 'C' AND FModifyDate >= '${from}'`;

    const rawResult = await this.client.executeBillQueryAll('SFC_OperationReport', {
      fieldKeys: extendedKeys,
      filter,
      orderString: 'FDate ASC',
    });

    if (!Array.isArray(rawResult) || rawResult.length === 0) {
      console.log('[agg] 增量同步无新数据');
      this.db.setMeta('lastSyncTime', new Date().toISOString());
      return [];
    }

    // 处理管道
    let records = this._transformSfcRecords(rawResult, FIELD_KEYS);
    this._applyMachineInline(rawResult, records);
    this._normalizeRecords(records);
    records = this._deduplicate(records);
    records = this._filterByOperation(records);
    records = this._filterOutliers(records);
    await this._resolveWorkshopNames(records);
    this._extractModifyDates(rawResult, records);

    for (const r of records) {
      r.content_hash = this._computeContentHash(r.fields);
    }

    // 合并到 SQLite
    if (this.db && records.length > 0) {
      this.db.upsertRecords(records);
      this.db.setMeta('lastSyncTime', new Date().toISOString());
    }

    console.log(`[agg] 增量同步完成: ${records.length} 条`);
    return records;
  }

  /**
   * 从 rawResult 中提取 FModifyDate 到 records
   */
  _extractModifyDates(rawResult, records) {
    let dataStart = 0;
    if (rawResult.length > 0 && Array.isArray(rawResult[0])) {
      const hasHeader = rawResult[0].some(h => typeof h === 'string' && /^F[A-Z]/.test(h));
      if (hasHeader) dataStart = 1;
    }
    // 索引：FIELD_KEYS.length (22) + DOT_FIELD (1) = 23
    const mdIndex = FIELD_KEYS.length + 1;
    for (let i = 0; i < records.length; i++) {
      const row = rawResult[i + dataStart];
      if (!row) continue;
      const val = row[mdIndex];
      records[i].fmodify_date = (val !== undefined && val !== null && val !== '')
        ? String(val).slice(0, 19) : null;
    }
  }

  /**
   * 探测 FModifyDate 字段在金蝶 API 中是否可用
   */
  async _probeFModifyDate() {
    try {
      const result = await this.client.executeBillQuery('SFC_OperationReport', {
        limit: 1,
        offset: 0,
        fieldKeys: ['FDate', 'FModifyDate'],
        filter: "FDOCUMENTSTATUS = 'C'",
        skipDateFilter: true,
      });

      let rows = result && result.data;
      if (rows && typeof rows === 'object' && !Array.isArray(rows) && Array.isArray(rows.Result)) {
        rows = rows.Result;
      }

      if (Array.isArray(rows) && rows.length > 1) {
        const dataStart = (Array.isArray(rows[0]) && rows[0].some(h => typeof h === 'string' && /^F[A-Z]/.test(h))) ? 1 : 0;
        const row = rows[dataStart];
        if (row && row[1] && String(row[1]).length > 0) {
          console.log(`[agg] FModifyDate 探测成功: ${row[1]}`);
          return true;
        }
      }
      console.warn('[agg] FModifyDate 探测失败：字段为空');
      return false;
    } catch (err) {
      console.warn(`[agg] FModifyDate 探测失败: ${err.message}`);
      return false;
    }
  }

  /**
   * 将金蝶 ExecuteBillQueryAll 返回的 2D 数组转为内部记录格式
   *
   * @param {Array[]} rawResult
   * @param {string[]} fieldKeys
   * @returns {Array<{ date: string, fields: object }>}
   */
  _transformSfcRecords(rawResult, fieldKeys) {
    if (rawResult.length === 0) return [];

    const firstRow = rawResult[0];
    let dataStart = 0;
    if (Array.isArray(firstRow)) {
      const hasHeader = firstRow.some((h) => typeof h === 'string' && /^F[A-Z]/.test(h));
      if (hasHeader) dataStart = 1;
    }

    return rawResult.slice(dataStart).map((row, i) => {
      const fields = {};
      fieldKeys.forEach((key, j) => {
        const value = row[j];
        if (value !== undefined && value !== null && value !== '') {
          fields[key] = String(value);
        }
      });
      return {
        date: fields['FDate'] || '',
        shift: '',
        workshop: fields['F_YJY_NewRealShop'] || '',
        machine: fields['F_FD_Machine'] || '',
        // 保留原始 fields 用于解析
        fields,
      };
    });
  }

  /**
   * 内联解析 F_FD_Machine（F_FD_Machine.FName）
   * 必须在 _transformSfcRecords 之后立即执行，且不得 reverse records
   */
  _applyMachineInline(rawResult, records) {
    if (rawResult.length === 0 || records.length === 0) return;

    let dataStart = 0;
    if (rawResult.length > 0 && Array.isArray(rawResult[0])) {
      const hasHeader = rawResult[0].some((h) => typeof h === 'string' && /^F[A-Z]/.test(h));
      if (hasHeader) dataStart = 1;
    }

    const dotColumnIndex = FIELD_KEYS.length; // 内联列在 extendedKeys 中的位置

    for (let i = 0; i < records.length; i++) {
      const row = rawResult[i + dataStart];
      if (!row) continue;
      const machineName = row[dotColumnIndex];
      if (machineName !== undefined && machineName !== null && machineName !== '' && machineName !== '0') {
        let name = String(machineName);
        // 模糊匹配：金蝶内联可能返回乱码多字节字符
        if (!EQUIPMENT_NAMES.has(name)) {
          const fuzzy = EQUIPMENT_LIST.find(e => name.includes(e.name) || e.name.includes(name));
          if (fuzzy) name = fuzzy.name;
        }
        records[i].machine = name;
        records[i].fields['F_FD_Machine'] = name;
      }
    }
  }

  /**
   * 解析 BD_DEPARTMENT 表，将 F_YJY_NewRealShop 内码替换为车间名称
   */
  async _resolveWorkshopNames(records) {
    if (records.length === 0) return;

    const ids = [...new Set(records.map((r) => r.fields['F_YJY_NewRealShop']).filter((v) => v && v !== '0'))];
    if (ids.length === 0) return;

    console.log(`[agg] 解析车间名称: unique=${ids.length}`);

    const nameMap = new Map();
    const BATCH = 200;

    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH);
      const filter = `FDeptId in (${batch.join(',')})`;

      try {
        const { data } = await this.client.callWithAuth(() =>
          this.client.executeBillQuery('BD_DEPARTMENT', {
            limit: batch.length,
            offset: 0,
            fieldKeys: ['FDeptId', 'FName'],
            filter,
            orderString: '',
            skipDateFilter: true,
          }),
        );

        let rows = data;
        if (rows && typeof rows === 'object' && !Array.isArray(rows) && Array.isArray(rows.Result)) {
          rows = rows.Result;
        }

        if (Array.isArray(rows)) {
          for (const row of rows) {
            if (Array.isArray(row) && row.length >= 2) {
              const id = String(row[0]);
              const name = String(row[1]);
              if (id && name && name !== 'undefined') {
                nameMap.set(id, name);
              }
            }
          }
        }
      } catch (e) {
        console.warn(`[agg] BD_DEPARTMENT 查询失败 batch=${i}: ${e.message}`);
      }
    }

    let replaced = 0;
    for (const r of records) {
      const id = r.fields['F_YJY_NewRealShop'];
      const name = nameMap.get(id);
      if (name) {
        r.workshop = name;
        r.fields['F_YJY_NewRealShop'] = name;
        replaced++;
      }
    }

    console.log(`[agg] 车间名称解析完成 resolved=${replaced}/${records.length}`);
  }

  /**
   * 重映射车间名称：将已合并的车间记录重命名为目标车间
   * 当前：Y固体一2号车间 → Y固体一1号车间
   * 必须在聚合之前、车间名称解析之后调用
   */
  _remapWorkshopNames(records) {
    const REMAP = {
      'Y固体一2号车间': 'Y固体一1号车间',
    };
    let count = 0;
    for (const r of records) {
      const newName = r.workshop && REMAP[r.workshop];
      if (newName) {
        r.workshop = newName;
        if (r.fields && r.fields['F_YJY_NewRealShop']) {
          r.fields['F_YJY_NewRealShop'] = newName;
        }
        count++;
      }
    }
    if (count > 0) {
      console.log(`[agg] 车间名称重映射: ${count} 条记录 (Y固体一2号车间 → Y固体一1号车间)`);
    }
  }

  /**
   * 标准化记录：班次映射、数值字段解析
   */
  _normalizeRecords(records) {
    for (const r of records) {
      // 日期标准化："2026-01-02T00:00:00" → "2026-01-02"
      if (r.date && r.date.length > 10) {
        r.date = r.date.slice(0, 10);
      }

      // 班次映射
      const rawShift = r.fields['F_UNW_WorkType2'];
      r.shift = SHIFT_MAP[rawShift] || '';

      // 数值字段 parseFloat
      for (const fieldName of NUMERIC_FIELDS) {
        const val = r.fields[fieldName];
        if (val !== undefined && val !== null && val !== '') {
          const num = parseFloat(val);
          r.fields[fieldName] = isNaN(num) ? 0 : num;
        } else {
          r.fields[fieldName] = 0;
        }
      }

      // 软袋包装机 F_FD_AimPerProduct 金蝶数据缺失（始终为0），
      // 固定为 720（设计速度 12切/分钟 × 60分钟/小时）
      if (r.machine === '软袋包装机' && r.fields['F_FD_AimPerProduct'] === 0) {
        r.fields['F_FD_AimPerProduct'] = 720;
      }
    }
  }

  // ===================== 核心聚合 =====================

  /**
   * 按维度聚合全部记录
   * @param {Array} records - 标准化后的记录
   * @param {string} dimension
   * @param {number} [year]
   * @param {string} [startDate] - 可选日期范围起始
   * @param {string} [endDate] - 可选日期范围结束
   * @returns {object} 聚合结果
   */
  _aggregate(records, dimension, year, startDate, endDate, powerDataMap) {
    if (records.length === 0) {
      return this._emptyResult(dimension, year, startDate, endDate);
    }

    // 按 (workshop, date) 分组计算每日车间级指标
    const dailyWorkshopMap = this._computeDailyWorkshopMetrics(records, powerDataMap);
    // 按 (machine, date) 分组计算每日设备级指标
    const dailyEquipmentMap = this._computeDailyEquipmentMetrics(records);

    // 按时段聚合
    const workshopPeriods = this._aggregateToPeriods(dailyWorkshopMap, dimension, 'workshop');
    const equipmentPeriods = this._aggregateToPeriods(dailyEquipmentMap, dimension, 'equipment');

    // 年维度下额外按月聚合，供趋势图展示月度数据
    let monthlyWorkshopData, monthlyEquipmentData;
    if (dimension === 'year') {
      monthlyWorkshopData = this._aggregateToPeriods(dailyWorkshopMap, 'month', 'workshop');
      monthlyEquipmentData = this._aggregateToPeriods(dailyEquipmentMap, 'month', 'equipment');
    }

    // 日期范围下保留日粒度数据供趋势图使用
    let dailyWorkshopTrend, dailyEquipmentTrend;
    if (startDate && endDate) {
      dailyWorkshopTrend = dailyWorkshopMap;
      dailyEquipmentTrend = dailyEquipmentMap;
    }

    // 汇总全厂
    // 提取API响应并转换比率值为百分比（0-1 → 0-100）
    const summary = this._computeSummary(workshopPeriods, equipmentPeriods, dimension);

    return {
      dimension,
      year,
      startDate,
      endDate,
      workshopPeriods,
      equipmentPeriods,
      monthlyWorkshopData,
      monthlyEquipmentData,
      dailyWorkshopTrend,
      dailyEquipmentTrend,
      summary,
    };
  }

  /**
   * 计算每日车间级指标
   *
   * 车间负载率(日) = (max_白班负荷工时 + max_晚班负荷工时) / 22.5
   * 产出率(日) = Σ FQuaQty / Σ (F_FD_AimPerProduct × F_YJY_loadTimes)
   *
   * @param {Array} records
   * @returns {Map<string, object>} key = `${workshop}|${date}`
   */
  _computeDailyWorkshopMetrics(records, powerDataMap) {
    // 收集车间每天的所有负荷工时（金蝶 F_UNW_WorkType2 班次字段大部分为空，
    // 无法依赖班次区分，改用 top-2 最大值之和估算双班负荷）
    const loadBuckets = new Map();   // key = `${ws}|${date}` => loadTimes array
    const outputBuckets = new Map(); // key = `${ws}|${date}` => { quaQty, aimProd }

    for (const r of records) {
      if (!r.workshop || !r.date || !WORKSHOP_SET.has(r.workshop)) continue;

      // 负荷率：收集所有非零负荷工时（不依赖班次字段）
      const loadVal = typeof r.fields['F_YJY_loadTimes'] === 'number' ? r.fields['F_YJY_loadTimes'] : 0;
      if (loadVal > 0) {
        const wsDateKey = `${r.workshop}|${r.date}`;
        if (!loadBuckets.has(wsDateKey)) loadBuckets.set(wsDateKey, []);
        loadBuckets.get(wsDateKey).push(loadVal);
      }

      // 实际产量：始终累加，不依赖目标产出
      const quaQty = typeof r.fields['FQuaQty'] === 'number' ? r.fields['FQuaQty'] : 0;
      const aim = typeof r.fields['F_FD_AimPerProduct'] === 'number' ? r.fields['F_FD_AimPerProduct'] : 0;
      const load = typeof r.fields['F_YJY_loadTimes'] === 'number' ? r.fields['F_YJY_loadTimes'] : 0;
      if (quaQty > 0) {
        const outKey = `${r.workshop}|${r.date}`;
        if (!outputBuckets.has(outKey)) outputBuckets.set(outKey, { quaQty: 0, aimProd: 0 });
        const ob = outputBuckets.get(outKey);
        ob.quaQty += quaQty;
        if (aim > 0 && load > 0) {
          ob.aimProd += aim * load;
        }
      }
    }

    // 汇总为每日车间指标
    const dailyMap = new Map();
    const allKeys = new Set();
    for (const key of loadBuckets.keys()) {
      allKeys.add(key);
    }
    for (const key of outputBuckets.keys()) {
      allKeys.add(key);
    }

    for (const key of allKeys) {
      const [workshop, date] = key.split('|');
      if (!workshop || !date) continue;

      const allLoads = loadBuckets.get(key) || [0];
      const sortedLoads = [...allLoads].sort((a, b) => b - a);
      const topTwo = sortedLoads.slice(0, 2);
      const dailyActualHours = Math.min(topTwo.reduce((s, v) => s + v, 0), DAILY_MAX_HOURS);
      const dailyLoadRate = Math.min(dailyActualHours / DAILY_MAX_HOURS, 1);

      const ob = outputBuckets.get(key) || { quaQty: 0, aimProd: 0 };
      const outputRate = ob.aimProd > 0 ? Math.min(ob.quaQty / ob.aimProd, 1) : 0;

      dailyMap.set(key, {
        workshop,
        date,
        dayShiftMaxLoad: sortedLoads[0] || 0,
        nightShiftMaxLoad: sortedLoads[1] || 0,
        dailyActualHours,
        dailyLoadRate,
        quaQty: ob.quaQty,
        aimProd: ob.aimProd,
        outputRate,
      });
    }

    // ===== 基于电表数据的车间负载率覆盖 =====
    if (powerDataMap && powerDataMap.size > 0) {
      const REMAP = { 'Y固体一2号车间': 'Y固体一1号车间' };

      // 1) 覆盖已有生产记录日的负载率
      // 注意：仅当电表数据确实包含该日期的记录时才覆盖，否则保留生产数据计算的负荷率
      for (const [, daily] of dailyMap) {
        const wsPowerMap = powerDataMap.get(daily.workshop);
        if (!wsPowerMap) continue;
        if (!wsPowerMap.has(daily.date)) continue; // 无该日电表数据时跳过覆盖
        const kwh = wsPowerMap.get(daily.date);
        const th = WORKSHOP_LOAD_RATE_THRESHOLDS[daily.workshop];
        if (!th) continue;
        const rate = kwh < th.low ? 0 : (kwh <= th.high ? 0.5 : 1.0);
        daily.dailyLoadRate = rate;
        daily.dailyActualHours = rate * DAILY_MAX_HOURS;
      }

      // 2) 补充有电表数据但无生产记录的日（仅负载率，产出率为 0）
      for (let [ws, dateMap] of powerDataMap) {
        ws = REMAP[ws] || ws;
        if (!WORKSHOP_SET.has(ws)) continue;
        const th = WORKSHOP_LOAD_RATE_THRESHOLDS[ws];
        if (!th) continue;
        for (const [date, kwh] of dateMap) {
          const key = `${ws}|${date}`;
          if (dailyMap.has(key)) continue;
          const rate = kwh < th.low ? 0 : (kwh <= th.high ? 0.5 : 1.0);
          dailyMap.set(key, {
            workshop: ws,
            date,
            dayShiftMaxLoad: 0,
            nightShiftMaxLoad: 0,
            dailyActualHours: rate * DAILY_MAX_HOURS,
            dailyLoadRate: rate,
            quaQty: 0,
            aimProd: 0,
            outputRate: 0,
          });
        }
      }
    }

    return dailyMap;
  }

  /**
   * 计算每日设备级指标
   *
   * 设备负载率(日) = (白班负荷工时 + 晚班负荷工时) / 22.5
   * 产出率(日) = Σ FQuaQty / Σ (F_FD_AimPerProduct × F_YJY_loadTimes)
   *
   * @param {Array} records
   * @returns {Map<string, object>} key = `${machine}|${date}`
   */
  _computeDailyEquipmentMetrics(records) {
    // 收集设备每天的所有负荷工时（与车间维度同理，不依赖班次字段）
    const loadBuckets = new Map();   // key = `${m}|${ws}|${date}` => loadTimes array
    const outputBuckets = new Map(); // key = `${m}|${ws}|${date}` => { quaQty, aimProd, workshop, ... }

    for (const r of records) {
      if (!r.machine || !r.date || !WORKSHOP_SET.has(r.workshop) || !EQUIPMENT_NAMES.has(r.machine)) continue;

      // 负荷率：收集所有非零负荷工时
      const loadVal = typeof r.fields['F_YJY_loadTimes'] === 'number' ? r.fields['F_YJY_loadTimes'] : 0;
      if (loadVal > 0) {
        const eqKey = `${r.machine}|${r.workshop}|${r.date}`;
        if (!loadBuckets.has(eqKey)) loadBuckets.set(eqKey, []);
        loadBuckets.get(eqKey).push(loadVal);
      }

      // 实际产量：始终累加，不依赖目标产出
      const quaQty = typeof r.fields['FQuaQty'] === 'number' ? r.fields['FQuaQty'] : 0;
      const aim = typeof r.fields['F_FD_AimPerProduct'] === 'number' ? r.fields['F_FD_AimPerProduct'] : 0;
      const load = typeof r.fields['F_YJY_loadTimes'] === 'number' ? r.fields['F_YJY_loadTimes'] : 0;
      const oee = typeof r.fields['F_YJY_OEE'] === 'number' ? r.fields['F_YJY_OEE'] : 0;
      if (quaQty > 0) {
        const outKey = `${r.machine}|${r.workshop}|${r.date}`;
        if (!outputBuckets.has(outKey)) outputBuckets.set(outKey, { quaQty: 0, aimProd: 0, workshop: r.workshop, oeeWeightedSum: 0, oeeWeightDenom: 0 });
        const ob = outputBuckets.get(outKey);
        ob.quaQty += quaQty;
        if (aim > 0 && load > 0) {
          ob.aimProd += aim * load;
        }
        if (oee > 0 && quaQty > 0) {
          ob.oeeWeightedSum += oee * quaQty;
          ob.oeeWeightDenom += quaQty;
        }
        if (r.workshop) ob.workshop = r.workshop;
      }
    }

    const dailyMap = new Map();
    const allKeys = new Set();
    for (const key of loadBuckets.keys()) {
      allKeys.add(key);
    }
    for (const key of outputBuckets.keys()) {
      allKeys.add(key);
    }

    for (const key of allKeys) {
      const parts = key.split('|');
      const machine = parts[0];
      const workshop = parts[1];
      const date = parts[2];
      if (!machine || !date) continue;

      const allLoads = loadBuckets.get(key) || [0];
      const sortedLoads = [...allLoads].sort((a, b) => b - a);
      const topTwo = sortedLoads.slice(0, 2);
      const dailyActualHours = Math.min(topTwo.reduce((s, v) => s + v, 0), DAILY_MAX_HOURS);
      const dailyLoadRate = Math.min(dailyActualHours / DAILY_MAX_HOURS, 1);

      const ob = outputBuckets.get(key) || { quaQty: 0, aimProd: 0, workshop: '' };
      const outputRate = ob.aimProd > 0 ? Math.min(ob.quaQty / ob.aimProd, 1) : 0;

      dailyMap.set(key, {
        machine,
        date,
        workshop: ob.workshop,
        dayShiftLoad: sortedLoads[0] || 0,
        nightShiftLoad: sortedLoads[1] || 0,
        dailyActualHours,
        dailyLoadRate,
        quaQty: ob.quaQty,
        aimProd: ob.aimProd,
        outputRate,
        oee: ob.oeeWeightDenom > 0 ? ob.oeeWeightedSum / ob.oeeWeightDenom : 0,
      });
    }

    return dailyMap;
  }

  /**
   * 将每日指标按时段（周/月）聚合
   *
   * 车间负载率(周/月) = Σ(每日实际工时) / (工作日天数 × 22.5h)
   * 分母剔除周日和节假日。
   *
   * @param {Map<string, object>} dailyMap
   * @param {string} dimension
   * @param {string} type - 'workshop' | 'equipment'
   * @returns {Map<string, object>} key = groupKey|periodKey
   */
  _aggregateToPeriods(dailyMap, dimension, type) {
    if (dimension === 'day') return dailyMap;

    // 按 (group, periodKey) 分组，group 是 workshop/machine 名称
    const periodBuckets = new Map();

    for (const daily of dailyMap.values()) {
      // 根据聚合类型选择分组键：设备聚合按设备名分组，车间聚合按车间名分组
      const groupKey = type === 'equipment' ? (daily.machine || daily.workshop) : (daily.workshop || daily.machine);
      if (!groupKey) continue;

      const periodKey = getPeriodKey(daily.date, dimension);
      // 设备聚合保留车间分列，车间聚合按车间合并
      const bucketKey = type === 'equipment'
        ? `${groupKey}|${daily.workshop || ''}|${periodKey}`
        : `${groupKey}|${periodKey}`;

      if (!periodBuckets.has(bucketKey)) {
        const base = {
          groupKey,
          periodKey,
          dailyHours: [],
          dailyLoadRates: [],
          totalQuaQty: 0,
          totalAimProd: 0,
          oeeWeightedSum: 0,
          oeeWeightDenom: 0,
          days: [],
        };
        // 添加标识字段：车间聚合存 workshop，设备聚合存 machine + workshop
        if (type === 'workshop') {
          base.workshop = groupKey;
        } else {
          base.machine = groupKey;
          base.workshop = daily.workshop || '';
        }
        periodBuckets.set(bucketKey, base);
      }

      const bucket = periodBuckets.get(bucketKey);
      bucket.dailyHours.push(daily.dailyActualHours);
      bucket.dailyLoadRates.push(daily.dailyLoadRate);
      bucket.totalQuaQty += daily.quaQty;
      bucket.totalAimProd += daily.aimProd;
      const dQuaQty = daily.quaQty || 0;
      if ((daily.oee || 0) > 0 && dQuaQty > 0) {
        bucket.oeeWeightedSum += (daily.oee || 0) * dQuaQty;
        bucket.oeeWeightDenom += dQuaQty;
      }
      // 设备维度：更新到最近日期的所属车间
      if (type === 'equipment' && daily.workshop) {
        bucket.workshop = daily.workshop;
      }
      bucket.days.push({
        date: daily.date,
        loadRate: daily.dailyLoadRate,
        quaQty: daily.quaQty,
      });
    }

    // 计算最终指标
    const resultMap = new Map();
    const _fmtLocal = (dt) => {
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const d = String(dt.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };
    const _todayStr = _fmtLocal(new Date());
    const _currentPeriodKey = dimension !== 'day' ? getPeriodKey(_todayStr, dimension) : '';
    for (const [bucketKey, bucket] of periodBuckets) {
      const { year, week, month } = parsePeriodKey(bucket.periodKey);
      let workingDays;
      if (dimension === 'week') {
        workingDays = countWorkingDaysInWeek(year, week);
      } else if (dimension === 'year') {
        const yearNum = parseInt(year, 10);
        const endDate = yearNum < new Date().getFullYear() ? `${year}-12-31` : _todayStr;
        workingDays = countWorkingDays(`${year}-01-01`, endDate);
      } else {
        workingDays = countWorkingDaysInMonth(year, month);
      }
      // 如果是当前月份/周/年，工作日天数封顶到今日（已过去的月份按全月）
      if (_currentPeriodKey && bucket.periodKey === _currentPeriodKey && dimension !== 'year') {
        const startDate = dimension === 'week' ? getWeekDates(year, week)[0] : `${bucket.periodKey}-01`;
        workingDays = countWorkingDays(startDate, _todayStr);
      }

      const sumDailyHours = bucket.dailyHours.reduce((a, b) => a + b, 0);
      let loadRate;
      if (type === 'workshop') {
        // 车间负载率 = 每日负载率（电表衍生）的平均值
        const dailyRates = bucket.dailyLoadRates || [];
        loadRate = dailyRates.length > 0
          ? Math.min(dailyRates.reduce((a, b) => a + b, 0) / dailyRates.length, 1)
          : 0;
      } else {
        // 设备负载率保持原公式：总工时 / (工作天数 × 22.5h)
        const denominator = workingDays * DAILY_MAX_HOURS;
        loadRate = denominator > 0 ? Math.min(sumDailyHours / denominator, 1) : 0;
      }
      const outputRate = bucket.totalAimProd > 0 ? Math.min(bucket.totalQuaQty / bucket.totalAimProd, 1) : 0;

      resultMap.set(bucketKey, {
        ...bucket,
        sumDailyHours,
        workingDays,
        loadRate,
        outputRate: outputRate,
        totalOutput: bucket.totalQuaQty,
        oee: bucket.oeeWeightDenom > 0 ? bucket.oeeWeightedSum / bucket.oeeWeightDenom : 0,
      });
    }

    return resultMap;
  }

  /**
   * 计算全厂汇总指标
   */
  _computeSummary(workshopPeriods, equipmentPeriods, dimension) {
    const allWorkshops = new Set();
    let totalOutput = 0;
    let totalLoadSum = 0;
    let totalLoadCount = 0;
    let totalLoadWeighted = 0; // 面积加权：Σ(loadRate × area)
    let totalArea = 0; // 面积加权：Σ(area)
    let totalOutputRateNumer = 0;
    let totalOutputRateDenom = 0;
    let oeeSum = 0;
    let oeeCount = 0;

    for (const period of workshopPeriods.values()) {
      if (period.workshop) {
        allWorkshops.add(period.workshop);
      }
      totalOutput += (period.totalQuaQty || period.quaQty || 0);
      const loadRate = period.loadRate !== undefined ? period.loadRate : (period.dailyLoadRate || 0);
      totalLoadSum += loadRate;
      totalLoadCount++;
      // 面积加权负荷率
      const area = WORKSHOP_AREAS[period.workshop] || 0;
      totalLoadWeighted += loadRate * area;
      totalArea += area;
      totalOutputRateNumer += (period.totalQuaQty || period.quaQty || 0);
      totalOutputRateDenom += (period.totalAimProd || period.aimProd || 0);
    }

    // OEE 从设备维度汇总
    for (const period of equipmentPeriods.values()) {
      const oeeVal = period.oee || 0;
      if (oeeVal > 0) {
        oeeSum += oeeVal;
        oeeCount++;
      }
    }

    return {
      totalOutput: Math.round(totalOutput),
      avgLoadRate: totalArea > 0 ? this._pct(totalLoadWeighted / totalArea) : 0,
      avgOutputRate: totalOutputRateDenom > 0
        ? this._pct(totalOutputRateNumer / totalOutputRateDenom)
        : 0,
      avgOEE: oeeCount > 0 ? +((oeeSum / oeeCount).toFixed(1)) : 0,
      workshopCount: allWorkshops.size,
    };
  }

  /**
   * 将比率值（0-1）转为百分比（0-100），保留1位小数
   */
  _pct(val) {
    return +(val * 100).toFixed(1);
  }

  /**
   * 生成从年初到当前时段的所有period key列表
   * 用于填充趋势图中缺失的时段（无数据的时段显示为0）
   * @param {string} dimension - 'day' | 'week' | 'month' | 'year'
   * @param {number} [year]
   * @param {string} [startDate] - 可选日期范围起始
   * @param {string} [endDate] - 可选日期范围结束
   */
  _generateAllPeriodKeys(dimension, year, startDate, endDate) {
    const now = new Date();
    const targetYear = year || now.getFullYear();
    const fmtLocal = (dt) => {
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const d = String(dt.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };

    // 指定日期范围：在该范围内生成 key
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const keys = [];
      if (dimension === 'day') {
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          keys.push(fmtLocal(d));
        }
      } else {
        // 非 day 维度但指定了日期范围（当前不会发生，extract 中会降级为 day）
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          keys.push(fmtLocal(d));
        }
      }
      return keys;
    }

    const isCurrentYear = targetYear === now.getFullYear();
    const keys = [];

    if (dimension === 'month') {
      const maxMonth = isCurrentYear ? now.getMonth() + 1 : 12;
      for (let m = 1; m <= maxMonth; m++) {
        keys.push(`${targetYear}-${String(m).padStart(2, '0')}`);
      }
    } else if (dimension === 'week') {
      const endDate2 = isCurrentYear ? now : new Date(targetYear, 11, 31);
      const maxWeek = getISOWeekNumber(endDate2);
      for (let w = 1; w <= maxWeek; w++) {
        keys.push(`${targetYear}-W${String(w).padStart(2, '0')}`);
      }
    } else if (dimension === 'year') {
      keys.push(`${targetYear}`);
    } else {
      // day: 当年从年初至年末/今天
      const start = new Date(targetYear, 0, 1);
      const end = isCurrentYear ? now : new Date(targetYear, 11, 31);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        keys.push(fmtLocal(d));
      }
    }
    return keys;
  }

  /**
   * 空结果
   */
  _emptyResult(dimension, year, startDate, endDate) {
    return {
      dimension,
      year,
      startDate,
      endDate,
      workshopPeriods: new Map(),
      equipmentPeriods: new Map(),
      summary: {
        totalOutput: 0,
        avgLoadRate: 0,
        avgOutputRate: 0,
        avgOEE: 0,
        workshopCount: 0,
      },
    };
  }

  // ===================== API 响应提取 =====================

  /**
   * 从聚合数据提取总览（前端展平格式）
   */
  _extractOverview(aggregated) {
    const { workshopPeriods, dimension, year } = aggregated;
    const targetYear = String(year || new Date().getFullYear());

    // 找出最新的时段（仅限目标年份）
    let latestKey = '';
    const periodDateMap = new Map(); // periodKey → 该时段所有车间数据
    for (const [, period] of workshopPeriods) {
      const pk = period.periodKey || period.date;
      if (!pk || !pk.startsWith(targetYear)) continue;
      const name = period.workshop;
      if (!name || !WORKSHOPS.includes(name)) continue;
      if (!periodDateMap.has(pk)) periodDateMap.set(pk, []);
      periodDateMap.get(pk).push(period);
      if (pk > latestKey) latestKey = pk;
    }

    // 车间卡片：所有9个车间始终显示（无数据则显示0）
    const workshops = [];
    const latestPeriods = periodDateMap.get(latestKey) || [];
    const latestWsMap = new Map();
    for (const period of latestPeriods) {
      const name = period.workshop;
      if (!latestWsMap.has(name)) {
        latestWsMap.set(name, { loadSum: 0, outSum: 0, count: 0, totalOut: 0 });
      }
      const ws = latestWsMap.get(name);
      const loadRate = period.loadRate !== undefined ? period.loadRate : (period.dailyLoadRate || 0);
      const outRate = period.outputRate !== undefined ? period.outputRate : 0;
      ws.loadSum += this._pct(loadRate);
      ws.outSum += this._pct(outRate);
      ws.count++;
      ws.totalOut += period.quaQty !== undefined ? period.quaQty : (period.totalQuaQty || 0);
    }
    for (const wsName of WORKSHOPS) {
      const ws = latestWsMap.get(wsName) || { loadSum: 0, outSum: 0, count: 0, totalOut: 0 };
      const avgOutRate = ws.count > 0 ? +(ws.outSum / ws.count).toFixed(1) : 0;
      workshops.push({
        name: wsName,
        area: WORKSHOP_AREAS[wsName] || null,
        outputRate: avgOutRate,
        loadRate: ws.count > 0 ? +(ws.loadSum / ws.count).toFixed(1) : 0,
        totalOutput: Math.round(ws.totalOut),
        status: avgOutRate >= 85 ? 'health' : avgOutRate >= 70 ? 'warning' : 'danger',
      });
    }
    workshops.sort((a, b) => a.name.localeCompare(b.name));

    // 产出趋势：从年初到当前所有时段，无数据的填0
    // 有日期范围时降级为日粒度展示期间内每日数据
    const hasDateRange = !!(aggregated.startDate && aggregated.endDate);
    const trendDim = hasDateRange ? 'day' : (dimension === 'year' ? 'month' : dimension);
    const trendWsData = hasDateRange ? (aggregated.dailyWorkshopTrend || workshopPeriods)
      : (dimension === 'year' ? aggregated.monthlyWorkshopData : workshopPeriods);
    const trendEqData = hasDateRange ? (aggregated.dailyEquipmentTrend || aggregated.equipmentPeriods)
      : (dimension === 'year' ? aggregated.monthlyEquipmentData : aggregated.equipmentPeriods);

    const outputByPeriod = new Map();
    for (const [, period] of trendWsData) {
      const dateKey = period.date || period.periodKey;
      if (!dateKey) continue;
      const name = period.workshop;
      if (!name || !WORKSHOPS.includes(name)) continue;
      const output = period.quaQty !== undefined ? period.quaQty : (period.totalQuaQty || 0);
      outputByPeriod.set(dateKey, (outputByPeriod.get(dateKey) || 0) + output);
    }
    const allPeriodKeys = this._generateAllPeriodKeys(trendDim, year, aggregated.startDate, aggregated.endDate);
    const outputTrend = allPeriodKeys.map(pk => {
      const label = dimension === 'year'
        ? `${parseInt(pk.slice(5, 7), 10)}月`
        : pk.length === 10 ? `${pk.slice(5, 7)}/${pk.slice(8, 10)}`
          : pk.includes('-W') ? pk.slice(2) : pk;
      return { label, value: Math.round(outputByPeriod.get(pk) || 0) };
    });

    // 平均负载率趋势：各时段所有设备的聚合平均负载率
    const loadRateByPeriod = new Map();
    for (const [, period] of trendEqData) {
      const pk = period.periodKey || period.date;
      if (!pk) continue;
      if (!loadRateByPeriod.has(pk)) {
        loadRateByPeriod.set(pk, { sumActualHours: 0, equipSet: new Set(), workingDays: 0 });
      }
      const bucket = loadRateByPeriod.get(pk);
      const actualHours = period.dailyActualHours !== undefined ? period.dailyActualHours : (period.sumDailyHours || 0);
      bucket.sumActualHours += actualHours;
      const eqName = period.machine || period.groupKey;
      if (eqName) bucket.equipSet.add(eqName);
      if (dimension === 'day') {
        bucket.workingDays = 1;
      } else if (period.workingDays) {
        bucket.workingDays = period.workingDays;
      }
    }

    const loadRateTrend = allPeriodKeys.map(pk => {
      const bucket = loadRateByPeriod.get(pk);
      let value = 0;
      if (bucket && bucket.equipSet.size > 0 && bucket.workingDays > 0) {
        value = +((bucket.sumActualHours / (bucket.equipSet.size * bucket.workingDays * DAILY_MAX_HOURS)) * 100).toFixed(1);
      }
      const label = dimension === 'year'
        ? `${parseInt(pk.slice(5, 7), 10)}月`
        : pk.length === 10 ? `${pk.slice(5, 7)}/${pk.slice(8, 10)}`
          : pk.includes('-W') ? pk.slice(2) : pk;
      return { label, value };
    });

    // 产出率对比
    const outputRateComparison = workshops.map((w) => ({
      label: w.name.replace('Y固体', '').replace('车间', ''),
      value: w.outputRate,
    }));

    // 汇总指标：从设备维度加权计算（仅最新时段）
    let latestTotalOutput = 0;
    for (const period of latestPeriods) {
      latestTotalOutput += (period.quaQty || period.totalQuaQty || 0);
    }

    // ====== 设备列表提取 ======
    const equipmentMap = new Map(); // name → { totalOutput, totalAimProd, loadRateSum, loadRateCount, oeeWS, oeeWD, totalLoadHours }
    for (const [, period] of aggregated.equipmentPeriods) {
      const pk = period.periodKey || period.date;
      if (pk !== latestKey) continue;
      const eqName = period.machine || period.groupKey;
      if (!eqName) continue;

      const quaQty = period.totalQuaQty !== undefined ? period.totalQuaQty : (period.quaQty || 0);
      const aimProd = period.totalAimProd !== undefined ? period.totalAimProd : (period.aimProd || 0);
      const loadRate = period.loadRate !== undefined ? period.loadRate : (period.dailyLoadRate || 0);
      const oeeVal = period.oee || 0;
      const loadHours = period.sumDailyHours !== undefined ? period.sumDailyHours : (period.dailyActualHours || 0);

      if (!equipmentMap.has(eqName)) {
        equipmentMap.set(eqName, { totalOutput: 0, totalAimProd: 0, loadRateSum: 0, loadRateCount: 0, oeeWS: 0, oeeWD: 0, totalLoadHours: 0 });
      }
      const eq = equipmentMap.get(eqName);
      eq.totalOutput += quaQty;
      eq.totalAimProd += aimProd;
      eq.loadRateSum += loadRate;
      eq.loadRateCount++;
      eq.totalLoadHours += loadHours;
      if (oeeVal > 0 && quaQty > 0) {
        eq.oeeWS += oeeVal * quaQty;
        eq.oeeWD += quaQty;
      }
    }

    const equipmentList = [];
    for (const [name, eq] of equipmentMap) {
      const eqInfo = getEquipmentByName(name);
      const outRate = eq.totalAimProd > 0 ? +((eq.totalOutput / eq.totalAimProd) * 100).toFixed(1) : 0;
      const avgLoadRate = eq.loadRateCount > 0 ? +((eq.loadRateSum / eq.loadRateCount) * 100).toFixed(1) : 0;
      const avgOee = eq.oeeWD > 0 ? +((eq.oeeWS / eq.oeeWD).toFixed(1)) : 0;
      equipmentList.push({
        name,
        output: Math.round(eq.totalOutput),
        outputRate: outRate,
        loadRate: avgLoadRate,
        totalLoadHours: +eq.totalLoadHours.toFixed(1),
        oee: avgOee,
        status: outRate >= 85 ? 'health' : outRate >= 70 ? 'warning' : 'danger',
        type: eqInfo ? eqInfo.type : '未知',
        lanes: eqInfo ? eqInfo.lanes : null,
        designSpeed: eqInfo ? eqInfo.designSpeed : null,
      });
    }
    // 按产出率降序排列，产出率为 0 的排末尾
    equipmentList.sort((a, b) => {
      if (a.outputRate === 0 && b.outputRate === 0) return a.name.localeCompare(b.name);
      if (a.outputRate === 0) return 1;
      if (b.outputRate === 0) return -1;
      return b.outputRate - a.outputRate;
    });

    // 从设备维度计算加权平均（跨车间合并同一设备）
    let overviewWorkingDays = 0;
    const latestEquipMap = new Map();
    for (const [, period] of aggregated.equipmentPeriods) {
      const pk = period.periodKey || period.date;
      if (pk !== latestKey) continue;
      const eqName = period.machine || period.groupKey;
      if (!eqName) continue;

      if (!latestEquipMap.has(eqName)) {
        latestEquipMap.set(eqName, { actualHours: 0, quaQty: 0, aimProd: 0, oeeWeightedSum: 0, oeeWeightDenom: 0 });
      }
      const eq = latestEquipMap.get(eqName);
      if (!overviewWorkingDays && period.workingDays) overviewWorkingDays = period.workingDays;

      const actualHours = period.dailyActualHours !== undefined ? period.dailyActualHours : (period.sumDailyHours || 0);
      const quaQty = period.quaQty !== undefined ? period.quaQty : (period.totalQuaQty || 0);
      const aimProd = period.aimProd !== undefined ? period.aimProd : (period.totalAimProd || 0);

      eq.actualHours += actualHours;
      eq.quaQty += quaQty;
      eq.aimProd += aimProd;

      const oeeVal = period.oee || 0;
      if (oeeVal > 0 && quaQty > 0) {
        eq.oeeWeightedSum += oeeVal * quaQty;
        eq.oeeWeightDenom += quaQty;
      }
    }

    let sumActualHours = 0;
    let sumQuaQty = 0;
    let sumAimProd = 0;
    let sumOeeWeighted = 0;
    let sumOeeWeight = 0;
    const equipCount = latestEquipMap.size;

    for (const eq of latestEquipMap.values()) {
      sumActualHours += eq.actualHours;
      sumQuaQty += eq.quaQty;
      sumAimProd += eq.aimProd;
      sumOeeWeighted += eq.oeeWeightedSum;
      sumOeeWeight += eq.oeeWeightDenom;
    }

    // 平均负荷率：按车间面积加权
    let totalLoadWeighted = 0;
    let totalArea = 0;
    for (const ws of workshops) {
      const area = ws.area || 0;
      totalLoadWeighted += ws.loadRate * area;
      totalArea += area;
    }
    const avgLoadRate = totalArea > 0 ? +(totalLoadWeighted / totalArea).toFixed(1) : 0;

    const avgOutputRate = sumAimProd > 0
      ? +((sumQuaQty / sumAimProd) * 100).toFixed(1)
      : 0;
    const avgOEE = sumOeeWeight > 0
      ? +((sumOeeWeighted / sumOeeWeight)).toFixed(1)
      : 0;

    return {
      dimension,
      totalOutput: Math.round(latestTotalOutput),
      avgLoadRate,
      avgOutputRate,
      avgOEE,
      workshops,
      equipmentList,
      outputTrend,
      loadRateTrend,
      outputRateComparison,
    };
  }

  /**
   * 提取所有车间列表及聚合数据
   */
  _extractWorkshops(aggregated) {
    return this._groupByWorkshop(aggregated);
  }

  /**
   * 按车间名分组（聚合所有时段）
   */
  _groupByWorkshop(aggregated) {
    const workshopMap = new Map();

    // 初始化为所有9个车间，确保无数据的车间也出现
    for (const wsName of WORKSHOPS) {
      workshopMap.set(wsName, {
        name: wsName,
        periods: [],
        totalOutput: 0,
        avgLoadRate: 0,
        avgOutputRate: 0,
      });
    }

    for (const [, period] of aggregated.workshopPeriods) {
      const wsName = period.workshop;
      if (!wsName || !WORKSHOPS.includes(wsName)) continue;

      if (!workshopMap.has(wsName)) {
        workshopMap.set(wsName, {
          name: wsName,
          periods: [],
          totalOutput: 0,
          avgLoadRate: 0,
          avgOutputRate: 0,
        });
      }

      const ws = workshopMap.get(wsName);
      ws.periods.push({
        periodKey: period.periodKey || period.date,
        loadRate: this._pct(period.loadRate !== undefined ? period.loadRate : (period.dailyLoadRate || 0)),
        outputRate: this._pct(period.outputRate !== undefined ? period.outputRate : 0),
        totalOutput: period.quaQty !== undefined ? Math.round(period.quaQty) : Math.round(period.totalQuaQty || 0),
        actualHours: period.dailyActualHours !== undefined ? +(period.dailyActualHours).toFixed(2) : +(period.sumDailyHours || 0).toFixed(2),
      });

      ws.totalOutput += (period.quaQty || period.totalQuaQty || 0);
    }

    // 计算均值
    for (const ws of workshopMap.values()) {
      if (ws.periods.length > 0) {
        ws.avgLoadRate = +(ws.periods.reduce((s, p) => s + p.loadRate, 0) / ws.periods.length).toFixed(1);
        ws.avgOutputRate = +(ws.periods.reduce((s, p) => s + p.outputRate, 0) / ws.periods.length).toFixed(1);
      }
      ws.totalOutput = Math.round(ws.totalOutput);
      // 按 periodKey 排序
      ws.periods.sort((a, b) => a.periodKey.localeCompare(b.periodKey));
    }

    // 按车间名排序
    return Array.from(workshopMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * 提取指定车间详情（前端展平格式）
   */
  _extractWorkshopDetail(aggregated, workshopName) {
    const { year } = aggregated;
    const targetYear = String(year || new Date().getFullYear());
    const wsPeriods = [];

    for (const [, period] of aggregated.workshopPeriods) {
      if (period.workshop !== workshopName) continue;
      const loadRate = this._pct(period.loadRate !== undefined ? period.loadRate : (period.dailyLoadRate || 0));
      const outRate = this._pct(period.outputRate !== undefined ? period.outputRate : 0);
      const output = period.quaQty !== undefined ? period.quaQty : (period.totalQuaQty || 0);
      const aimProd = period.aimProd !== undefined ? period.aimProd : (period.totalAimProd || 0);
      wsPeriods.push({
        periodKey: period.periodKey || period.date,
        loadRate,
        outputRate: outRate,
        totalOutput: Math.round(output),
        aimProd: Math.round(aimProd),
      });
    }
    wsPeriods.sort((a, b) => a.periodKey.localeCompare(b.periodKey));

    // 汇总指标：有日期范围时累加该范围内所有期间，否则取最新期间
    let totalOutput, theoreticalOutput, avgOutputRate, avgLoadRate;
    if (aggregated.startDate) {
      let sumOutput = 0, sumAimProd = 0, loadRateSum = 0, loadRateCount = 0;
      for (const [, period] of aggregated.workshopPeriods) {
        if (period.workshop !== workshopName) continue;
        sumOutput += period.quaQty !== undefined ? period.quaQty : (period.totalQuaQty || 0);
        sumAimProd += period.aimProd !== undefined ? period.aimProd : (period.totalAimProd || 0);
        const lr = period.loadRate !== undefined ? period.loadRate : (period.dailyLoadRate || 0);
        loadRateSum += lr;
        loadRateCount++;
      }
      totalOutput = Math.round(sumOutput);
      theoreticalOutput = Math.round(sumAimProd);
      avgOutputRate = sumAimProd > 0
        ? +((sumOutput / sumAimProd) * 100).toFixed(1)
        : 0;
      avgLoadRate = loadRateCount > 0
        ? +((loadRateSum / loadRateCount) * 100).toFixed(1)
        : 0;
    } else {
      // 填充缺失时段（无数据则显示0）
      const wsPeriodMap = new Map(wsPeriods.map(p => [p.periodKey, p]));
      const allPeriodKeys = this._generateAllPeriodKeys(aggregated.dimension, year);
      const filledPeriods = allPeriodKeys.map(pk => {
        const existing = wsPeriodMap.get(pk);
        return existing || {
          periodKey: pk,
          loadRate: 0,
          outputRate: 0,
          totalOutput: 0,
          aimProd: 0,
        };
      });

      // 取最新时段（包含无数据的时段，显示为 0）
      const latestPeriod = filledPeriods.length > 0 ? filledPeriods[filledPeriods.length - 1] : null;
      totalOutput = latestPeriod ? latestPeriod.totalOutput : 0;
      theoreticalOutput = latestPeriod ? latestPeriod.aimProd : 0;
      avgOutputRate = theoreticalOutput > 0
        ? +((totalOutput / theoreticalOutput) * 100).toFixed(1)
        : 0;
      avgLoadRate = latestPeriod ? latestPeriod.loadRate : 0;
    }

    // 从设备维度提取该车间最新时段设备列表（仅限目标年份）
    let equipLatestKey = '';
    for (const [, period] of aggregated.equipmentPeriods) {
      const pk = period.periodKey || period.date;
      if (!pk || !pk.startsWith(targetYear)) continue;
      if (pk > equipLatestKey) equipLatestKey = pk;
    }

    const eqMap = new Map();
    for (const [, period] of aggregated.equipmentPeriods) {
      const pk = period.periodKey || period.date;
      if (pk !== equipLatestKey) continue;
      const eqName = period.machine || period.groupKey;
      if (!eqName) continue;
      if (period.workshop !== workshopName) continue;

      const quaQty = period.quaQty !== undefined ? period.quaQty : (period.totalQuaQty || 0);
      const aimProd = period.aimProd !== undefined ? period.aimProd : (period.totalAimProd || 0);
      const loadRate = period.loadRate !== undefined ? period.loadRate : (period.dailyLoadRate || 0);

      if (!eqMap.has(eqName)) {
        eqMap.set(eqName, { totalOutput: 0, totalAimProd: 0, loadRateSum: 0, loadRateCount: 0 });
      }
      const eq = eqMap.get(eqName);
      eq.totalOutput += quaQty;
      eq.totalAimProd += aimProd;
      eq.loadRateSum += loadRate;
      eq.loadRateCount++;
    }

    const equipmentList = [];
    for (const [name, eq] of eqMap) {
      const eqInfo = getEquipmentByName(name);
      const outRate = eq.totalAimProd > 0
        ? +((eq.totalOutput / eq.totalAimProd) * 100).toFixed(1)
        : 0;
      equipmentList.push({
        name,
        output: Math.round(eq.totalOutput),
        outputRate: outRate,
        loadRate: +(eq.loadRateSum / eq.loadRateCount * 100).toFixed(1),
        type: eqInfo ? eqInfo.type : '未知',
        status: outRate >= 85 ? 'health' : outRate >= 70 ? 'warning' : 'danger',
      });
    }
    equipmentList.sort((a, b) => a.name.localeCompare(b.name));

    // 趋势数组（全量历史，缺失时段填0）
    const hasDateRange = !!(aggregated.startDate && aggregated.endDate);
    const trendDim = hasDateRange ? 'day' : (aggregated.dimension === 'year' ? 'month' : aggregated.dimension);
    const trendPeriodKeys = this._generateAllPeriodKeys(trendDim, year, aggregated.startDate, aggregated.endDate);
    const trendWsData = hasDateRange ? (aggregated.dailyWorkshopTrend || aggregated.workshopPeriods)
      : (aggregated.dimension === 'year' ? aggregated.monthlyWorkshopData : aggregated.workshopPeriods);

    const trendPeriodMap = new Map();
    for (const [, period] of trendWsData) {
      if (period.workshop !== workshopName) continue;
      const pk = period.periodKey || period.date;
      const output = period.quaQty !== undefined ? period.quaQty : (period.totalQuaQty || 0);
      const loadRate = this._pct(period.loadRate !== undefined ? period.loadRate : (period.dailyLoadRate || 0));
      trendPeriodMap.set(pk, { periodKey: pk, totalOutput: Math.round(output), loadRate });
    }
    const trendFilled = trendPeriodKeys.map(pk => {
      const existing = trendPeriodMap.get(pk);
      return existing || { periodKey: pk, totalOutput: 0, loadRate: 0 };
    });

    const trendLabel = (p) => {
      const pk = p.periodKey || '';
      if (aggregated.dimension === 'year') return `${parseInt(pk.slice(5, 7), 10)}月`;
      const d = pk.slice(0, 10);
      return d.length === 10 ? `${d.slice(5, 7)}/${d.slice(8, 10)}`
        : pk.includes('-W') ? pk.slice(2) : pk;
    };
    const outputTrend = trendFilled.map((p) => ({ label: trendLabel(p), value: p.totalOutput }));
    const loadRateTrend = trendFilled.map((p) => ({ label: trendLabel(p), value: p.loadRate }));

    return {
      name: workshopName,
      totalOutput: Math.round(totalOutput),
      theoreticalOutput: Math.round(theoreticalOutput),
      outputRate: avgOutputRate,
      loadRate: avgLoadRate,
      equipmentList,
      outputTrend,
      loadRateTrend,
    };
  }

  /**
   * 提取指定设备详情（前端展平格式）
   */
  _extractEquipmentDetail(aggregated, equipmentName) {
    const { year } = aggregated;
    const periods = [];

    for (const [, period] of aggregated.equipmentPeriods) {
      const eqName = period.machine || period.groupKey;
      if (eqName !== equipmentName) continue;
      const quaQty = period.quaQty !== undefined ? period.quaQty : (period.totalQuaQty || 0);
      const aimProd = period.aimProd !== undefined ? period.aimProd : (period.totalAimProd || 0);
      periods.push({
        periodKey: period.periodKey || period.date,
        workshop: period.workshop || '',
        loadRate: period.loadRate !== undefined ? period.loadRate : (period.dailyLoadRate || 0),
        outputRate: period.outputRate !== undefined ? period.outputRate : 0,
        quaQty,
        aimProd,
        oee: period.oee || 0,
      });
    }
    periods.sort((a, b) => a.periodKey.localeCompare(b.periodKey) || a.workshop.localeCompare(b.workshop));

    // === 按车间分组，用于分车间明细 ===
    const wsPeriodMap = new Map();
    for (const p of periods) {
      const ws = p.workshop || '未知';
      if (!wsPeriodMap.has(ws)) {
        wsPeriodMap.set(ws, { workshop: ws, totalOutput: 0, totalAimProd: 0, periodMap: new Map() });
      }
      const bd = wsPeriodMap.get(ws);
      bd.totalOutput += p.quaQty;
      bd.totalAimProd += p.aimProd;
      const pk = p.periodKey;
      if (!bd.periodMap.has(pk)) {
        bd.periodMap.set(pk, { totalOutput: 0, totalAimProd: 0, maxLoadRate: 0 });
      }
      const pp = bd.periodMap.get(pk);
      pp.totalOutput += p.quaQty;
      pp.totalAimProd += p.aimProd;
      pp.maxLoadRate = Math.max(pp.maxLoadRate, p.loadRate);
    }

    // 跨车间合并（同一设备可能在多个车间有记录）
    const mergedMap = new Map();
    for (const p of periods) {
      const key = p.periodKey;
      if (!mergedMap.has(key)) {
        mergedMap.set(key, {
          periodKey: key,
          totalOutput: 0,
          totalAimProd: 0,
          oeeWeightedSum: 0,
          oeeWeightDenom: 0,
          maxLoadRate: 0,
        });
      }
      const m = mergedMap.get(key);
      m.totalOutput += p.quaQty;
      m.totalAimProd += p.aimProd;
      m.maxLoadRate = Math.max(m.maxLoadRate, p.loadRate);
      if ((p.oee || 0) > 0 && (p.quaQty || 0) > 0) {
        m.oeeWeightedSum += p.oee * p.quaQty;
        m.oeeWeightDenom += p.quaQty;
      }
    }

    // 填充缺失时段
    const hasDateRange = !!(aggregated.startDate && aggregated.endDate);
    const trendDim = hasDateRange ? 'day' : (aggregated.dimension === 'year' ? 'month' : aggregated.dimension);
    const trendEqSrc = hasDateRange ? (aggregated.dailyEquipmentTrend || aggregated.equipmentPeriods)
      : (aggregated.dimension === 'year' ? aggregated.monthlyEquipmentData : aggregated.equipmentPeriods);

    // 从趋势数据源过滤本设备记录
    const trendPeriodsMap = new Map();
    for (const [, period] of trendEqSrc) {
      const eqName = period.machine || period.groupKey;
      if (eqName !== equipmentName) continue;
      const pk = period.periodKey || period.date;
      const quaQty = period.quaQty !== undefined ? period.quaQty : (period.totalQuaQty || 0);
      const aimProd = period.aimProd !== undefined ? period.aimProd : (period.totalAimProd || 0);
      if (!trendPeriodsMap.has(pk)) {
        trendPeriodsMap.set(pk, { periodKey: pk, totalOutput: 0, totalAimProd: 0, maxLoadRate: 0, oeeWeightedSum: 0, oeeWeightDenom: 0 });
      }
      const m = trendPeriodsMap.get(pk);
      m.totalOutput += quaQty;
      m.totalAimProd += aimProd;
      m.maxLoadRate = Math.max(m.maxLoadRate, period.loadRate !== undefined ? period.loadRate : (period.dailyLoadRate || 0));
      if ((period.oee || 0) > 0 && quaQty > 0) {
        m.oeeWeightedSum += period.oee * quaQty;
        m.oeeWeightDenom += quaQty;
      }
    }

    const trendPeriods = Array.from(trendPeriodsMap.values()).sort((a, b) => a.periodKey.localeCompare(b.periodKey));
    const trendList = trendPeriods.map((m) => ({
      periodKey: m.periodKey,
      loadRate: this._pct(m.maxLoadRate),
      outputRate: m.totalAimProd > 0 ? this._pct(m.totalOutput / m.totalAimProd) : 0,
      totalOutput: Math.round(m.totalOutput),
      oee: m.oeeWeightDenom > 0 ? +(m.oeeWeightedSum / m.oeeWeightDenom).toFixed(1) : 0,
    }));

    const trendMap = new Map(trendList.map(p => [p.periodKey, p]));
    const allPeriodKeys = this._generateAllPeriodKeys(trendDim, year, aggregated.startDate, aggregated.endDate);
    const filledTrends = allPeriodKeys.map(pk => {
      const existing = trendMap.get(pk);
      return existing || {
        periodKey: pk,
        loadRate: 0,
        outputRate: 0,
        totalOutput: 0,
        oee: 0,
      };
    });

    // 汇总指标：有日期范围时累加该范围内所有期间，否则按维度取最新
    let actualOutput, avgLoadRate, avgOutRate, avgOee;
    if (aggregated.startDate) {
      let sumOutput = 0, sumAimProd = 0;
      let sumOeeWeighted = 0, sumOeeWeight = 0;
      let maxLoadRate = 0;
      for (const period of mergedMap.values()) {
        sumOutput += period.totalOutput;
        sumAimProd += period.totalAimProd;
        if (period.maxLoadRate > maxLoadRate) maxLoadRate = period.maxLoadRate;
        sumOeeWeighted += period.oeeWeightedSum;
        sumOeeWeight += period.oeeWeightDenom;
      }
      actualOutput = Math.round(sumOutput);
      avgLoadRate = this._pct(maxLoadRate);
      avgOutRate = sumAimProd > 0 ? this._pct(sumOutput / sumAimProd) : 0;
      avgOee = sumOeeWeight > 0 ? +(sumOeeWeighted / sumOeeWeight).toFixed(1) : 0;
    } else if (aggregated.dimension === 'year') {
      const yearKey = String(year || new Date().getFullYear());
      const yearPeriod = mergedMap.get(yearKey);
      if (yearPeriod) {
        actualOutput = Math.round(yearPeriod.totalOutput);
        avgLoadRate = this._pct(yearPeriod.maxLoadRate);
        avgOutRate = yearPeriod.totalAimProd > 0 ? this._pct(yearPeriod.totalOutput / yearPeriod.totalAimProd) : 0;
        avgOee = yearPeriod.oeeWeightDenom > 0 ? +(yearPeriod.oeeWeightedSum / yearPeriod.oeeWeightDenom).toFixed(1) : 0;
      } else {
        actualOutput = 0;
        avgLoadRate = 0;
        avgOutRate = 0;
        avgOee = 0;
      }
    } else {
      const latest = filledTrends.length > 0 ? filledTrends[filledTrends.length - 1] : null;
      actualOutput = latest ? latest.totalOutput : 0;
      avgLoadRate = latest ? latest.loadRate : 0;
      avgOutRate = latest ? latest.outputRate : 0;
      avgOee = latest ? latest.oee : 0;
    }

    const equipmentInfo = getEquipmentByName(equipmentName);

    const trendLabel = (p) => {
      const pk = p.periodKey || '';
      if (aggregated.dimension === 'year') return `${parseInt(pk.slice(5, 7), 10)}月`;
      const d = pk.slice(0, 10);
      return d.length === 10 ? `${d.slice(5, 7)}/${d.slice(8, 10)}`
        : pk.includes('-W') ? pk.slice(2) : pk;
    };

    // 格式化为分车间明细（年维度取全年聚合，其他维度取最新时段）
    const latestPk = aggregated.dimension === 'year'
      ? String(year || new Date().getFullYear())
      : (allPeriodKeys.length > 0 ? allPeriodKeys[allPeriodKeys.length - 1] : '');
    const wsBreakdownArr = Array.from(wsPeriodMap.values()).map(bd => {
      // 年维度下用月度数据给趋势图，其他维度直接用时段数据
      let bdFilled;
      if (aggregated.dimension === 'year') {
        const wsMonthMap = new Map();
        for (const [, period] of aggregated.monthlyEquipmentData) {
          const eqName = period.machine || period.groupKey;
          if (eqName !== equipmentName || (period.workshop || '') !== bd.workshop) continue;
          const pk = period.periodKey || '';
          const quaQty = period.quaQty !== undefined ? period.quaQty : (period.totalQuaQty || 0);
          if (!wsMonthMap.has(pk)) wsMonthMap.set(pk, { totalOutput: 0, maxLoadRate: 0 });
          const pp = wsMonthMap.get(pk);
          pp.totalOutput += quaQty;
          pp.maxLoadRate = Math.max(pp.maxLoadRate, period.loadRate !== undefined ? period.loadRate : (period.dailyLoadRate || 0));
        }
        bdFilled = allPeriodKeys.map(pk => ({
          periodKey: pk,
          totalOutput: wsMonthMap.get(pk)?.totalOutput || 0,
          maxLoadRate: wsMonthMap.get(pk)?.maxLoadRate || 0,
        }));
      } else {
        bdFilled = allPeriodKeys.map(pk => {
          const pp = bd.periodMap.get(pk);
          return { periodKey: pk, totalOutput: pp?.totalOutput || 0, maxLoadRate: pp?.maxLoadRate || 0 };
        });
      }
      const latestPp = bd.periodMap.get(latestPk);
      return {
        workshop: bd.workshop,
        totalOutput: Math.round(latestPp?.totalOutput || 0),
        outputRate: latestPp?.totalAimProd > 0 ? this._pct(latestPp.totalOutput / latestPp.totalAimProd) : 0,
        loadRate: this._pct(latestPp?.maxLoadRate || 0),
        outputTrend: bdFilled.map(p => ({ label: trendLabel(p), value: Math.round(p.totalOutput) })),
        loadRateTrend: bdFilled.map(p => ({ label: trendLabel(p), value: this._pct(p.maxLoadRate) })),
      };
    });
    wsBreakdownArr.sort((a, b) => b.totalOutput - a.totalOutput);

    return {
      name: equipmentName,
      type: equipmentInfo ? equipmentInfo.type : '未知',
      defaultWorkshop: equipmentInfo ? equipmentInfo.defaultWorkshop : '',
      actualOutput,
      loadRate: avgLoadRate,
      outputRate: avgOutRate,
      oee: avgOee,
      loadRateTrend: filledTrends.map((p) => ({ label: trendLabel(p), value: p.loadRate })),
      outputRateTrend: filledTrends.map((p) => ({ label: trendLabel(p), value: p.outputRate })),
      outputTrend: filledTrends.map((p) => ({ label: trendLabel(p), value: p.totalOutput })),
      oeeTrend: filledTrends.map((p) => ({ label: trendLabel(p), value: p.oee })),
      workshopBreakdown: wsBreakdownArr,
    };
  }

  /**
   * 清除缓存（用于调试/手动刷新）
   */
  clearCache() {
    this._cache.clear();
    console.log('[agg] 缓存已清除');
  }

  /**
   * 手动触发一次同步并等待完成
   * 返回同步记录数，用于前端反馈
   */
  async syncNow() {
    if (!this.db) throw new Error('SQLite 未初始化');
    const records = await this._syncFromKingdee();
    this._cache.clear();
    if (this._onSync) this._onSync();
    return { count: records.length };
  }

  /**
   * 注册同步完成回调（用于清除外部缓存等）
   */
  onSync(cb) {
    this._onSync = cb;
  }

  /**
   * 注入电表数据服务（用于车间负载率基于电量的计算）
   * @param {import('./powerSyncService')} ps
   */
  setPowerService(ps) {
    this.powerService = ps;
    console.log('[agg] 电表数据服务已注入');
  }

  // ===================== 文件缓存持久化 =====================

  /**
   * 获取文件缓存路径
   */
  _getCacheFilePath(dimension, year) {
    return path.join(CACHE_DIR, `aggregated_${dimension}_${year || ''}.json`);
  }

  /**
   * 将聚合结果写入文件缓存（持久化，防止重启丢失）
   * 注意：需要将 Map 转为数组，因为 JSON.stringify 不能序列化 Map
   */
  _saveToFileCache(dimension, year, data) {
    try {
      if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
      }
      const fileData = {
        ...data,
        workshopPeriods: Array.from(data.workshopPeriods.entries()),
        equipmentPeriods: Array.from(data.equipmentPeriods.entries()),
        monthlyWorkshopData: data.monthlyWorkshopData
          ? Array.from(data.monthlyWorkshopData.entries())
          : undefined,
        monthlyEquipmentData: data.monthlyEquipmentData
          ? Array.from(data.monthlyEquipmentData.entries())
          : undefined,
      };
      const filePath = this._getCacheFilePath(dimension, year);
      fs.writeFileSync(filePath, JSON.stringify(fileData), 'utf-8');
    } catch (err) {
      console.warn(`[agg] 文件缓存写入失败 dimension=${dimension} year=${year}: ${err.message}`);
    }
  }

  /**
   * 启动时从文件缓存加载到内存
   * 注意：需要将数组转回 Map（JSON 不能直接序列化 Map）
   */
  _loadAllFileCaches() {
    try {
      if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        return;
      }

      const files = fs.readdirSync(CACHE_DIR);
      let loaded = 0;
      for (const file of files) {
        // 文件名格式: aggregated_{dimension}_{year}.json
        const match = file.match(/^aggregated_(.+?)\.json$/);
        if (!match) continue;

        const filePath = path.join(CACHE_DIR, file);
        try {
          const raw = fs.readFileSync(filePath, 'utf-8');
          const data = JSON.parse(raw);
          // 将数组恢复为 Map
          data.workshopPeriods = new Map(data.workshopPeriods || []);
          data.equipmentPeriods = new Map(data.equipmentPeriods || []);
          if (data.monthlyWorkshopData) data.monthlyWorkshopData = new Map(data.monthlyWorkshopData);
          if (data.monthlyEquipmentData) data.monthlyEquipmentData = new Map(data.monthlyEquipmentData);
          const cacheKey = match[1]; // 如 "day_2025"
          this._cache.set(cacheKey, { data, timestamp: Date.now() });
          loaded++;
        } catch (err) {
          console.warn(`[agg] 文件缓存加载失败 ${file}: ${err.message}`);
        }
      }
      if (loaded > 0) {
        console.log(`[agg] 文件缓存加载完成: ${loaded} 个`);
      }
    } catch (err) {
      console.warn(`[agg] 文件缓存目录读取失败: ${err.message}`);
    }
  }
}

module.exports = AggregationEngine;
