/**
 * 电表数据持久化 — SQLite 存储
 *
 * 将电表原始数据（名称、日期、用电量）存储到 SQLite，
 * 并提供按车间/日期维度的聚合查询接口。
 *
 * 表结构：
 *   power_data(meter_name, date, value, workshop) — 细粒度日数据
 *   power_meta(key, value) — 同步元数据
 */
const path = require('path');
const Database = require('better-sqlite3');

const META_LAST_SYNC = 'lastSyncTime';
const META_SYNC_STATUS = 'lastSyncStatus';
const META_DATE_RANGE_START = 'dateRangeStart';
const META_DATE_RANGE_END = 'dateRangeEnd';

class PowerDataStore {
  /**
   * @param {string} dbPath - SQLite 文件路径
   */
  constructor(dbPath) {
    this.dbPath = dbPath;
    /** @type {Database.Database|null} */
    this.db = null;
  }

  /** 初始化数据库连接和表结构 */
  initialize() {
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS power_data (
        meter_name TEXT NOT NULL,
        date TEXT NOT NULL,
        value REAL NOT NULL DEFAULT 0,
        workshop TEXT,
        PRIMARY KEY (meter_name, date)
      );
      CREATE INDEX IF NOT EXISTS idx_pd_date ON power_data(date);
      CREATE INDEX IF NOT EXISTS idx_pd_workshop ON power_data(workshop);

      CREATE TABLE IF NOT EXISTS power_meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
    return this;
  }

  /** 检查是否有数据 */
  hasData() {
    if (!this.db) return false;
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM power_data').get();
    return row && row.cnt > 0;
  }

  /** 获取记录数 */
  getCount() {
    if (!this.db) return 0;
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM power_data').get();
    return row ? row.cnt : 0;
  }

  /**
   * 批量写入/替换电表数据
   * @param {Array<{meter_name: string, date: string, value: number, workshop: string|null}>} rows
   */
  upsertBatch(rows) {
    if (!this.db || rows.length === 0) return;

    const stmt = this.db.prepare(
      'INSERT OR REPLACE INTO power_data (meter_name, date, value, workshop) VALUES (?, ?, ?, ?)'
    );

    const tx = this.db.transaction((items) => {
      for (const r of items) {
        stmt.run(r.meter_name, r.date, r.value, r.workshop || null);
      }
    });

    tx(rows);
  }

  /**
   * 获取某个时间范围内所有车间（已映射）的日用电量
   * @param {string} startDate - 'YYYY-MM-DD'
   * @param {string} endDate   - 'YYYY-MM-DD'
   * @returns {Array<{meter_name: string, date: string, value: number, workshop: string|null}>}
   */
  getDataByDateRange(startDate, endDate) {
    if (!this.db) return [];
    return this.db.prepare(
      'SELECT * FROM power_data WHERE date >= ? AND date <= ? ORDER BY date ASC, meter_name ASC'
    ).all(startDate, endDate);
  }

  /**
   * 获取指定车间在某时间范围内的日用电量
   * @param {string} workshop - 工厂车间名称
   * @param {string} startDate
   * @param {string} endDate
   * @returns {Array<{date: string, value: number}>}
   */
  getWorkshopData(workshop, startDate, endDate) {
    if (!this.db) return [];
    return this.db.prepare(
      `SELECT date, SUM(value) as value FROM power_data
       WHERE workshop = ? AND date >= ? AND date <= ?
       GROUP BY date ORDER BY date ASC`
    ).all(workshop, startDate, endDate);
  }

  /**
   * 按车间分组获取某时间范围内每日总用电量
   * @returns {Array<{workshop: string, date: string, value: number}>}
   */
  getGroupedByWorkshop(startDate, endDate) {
    if (!this.db) return [];
    return this.db.prepare(
      `SELECT workshop, date, SUM(value) as value FROM power_data
       WHERE workshop IS NOT NULL AND date >= ? AND date <= ?
       GROUP BY workshop, date ORDER BY date ASC, workshop ASC`
    ).all(startDate, endDate);
  }

  /**
   * 获取所有车间在某时间范围内的总用电量（按日聚合）
   * @returns {Array<{date: string, value: number}>}
   */
  getTotalByDate(startDate, endDate) {
    if (!this.db) return [];
    return this.db.prepare(
      `SELECT date, SUM(value) as value FROM power_data
       WHERE date >= ? AND date <= ? AND meter_name != '一家园所有区域'
       GROUP BY date ORDER BY date ASC`
    ).all(startDate, endDate);
  }

  /**
   * 获取指定车间在所有日期中最早的用电量日期
   */
  getWorkshopDateRange(workshop) {
    if (!this.db) return null;
    const row = this.db.prepare(
      'SELECT MIN(date) as minDate, MAX(date) as maxDate FROM power_data WHERE workshop = ?'
    ).get(workshop);
    return row && row.minDate ? row : null;
  }

  /** 获取数据库中最早的日期 */
  getMinDate() {
    if (!this.db) return null;
    const row = this.db.prepare('SELECT MIN(date) as d FROM power_data').get();
    return row ? row.d : null;
  }

  /** 获取数据库中最近的日期 */
  getMaxDate() {
    if (!this.db) return null;
    const row = this.db.prepare('SELECT MAX(date) as d FROM power_data').get();
    return row ? row.d : null;
  }

  /** 获取已映射的车间列表（去重） */
  getDistinctWorkshops() {
    if (!this.db) return [];
    return this.db.prepare(
      'SELECT DISTINCT workshop FROM power_data WHERE workshop IS NOT NULL ORDER BY workshop'
    ).all().map(r => r.workshop);
  }

  // ===================== 元数据 =====================

  getMeta(key) {
    if (!this.db) return null;
    const row = this.db.prepare('SELECT value FROM power_meta WHERE key = ?').get(key);
    return row ? row.value : null;
  }

  setMeta(key, value) {
    if (!this.db) return;
    this.db.prepare(
      'INSERT OR REPLACE INTO power_meta (key, value) VALUES (?, ?)'
    ).run(key, value);
  }

  // ===================== 关闭 =====================

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

module.exports = PowerDataStore;
