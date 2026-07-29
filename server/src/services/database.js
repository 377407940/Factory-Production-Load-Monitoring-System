/**
 * SQLite 持久化层
 *
 * 存储经金蝶 API 拉取并处理后的 SFC_OperationReport 记录。
 * 支持全量替换 / 增量合并 / 元数据管理。
 *
 * 降级策略：初始化失败时抛出异常，调用方回退金蝶直连。
 */
const path = require('path');
const config = require('../config');

// SQLite 库：优先 better-sqlite3，失败则尝试 sql.js，都失败则抛出
let DatabaseImpl;
try {
  DatabaseImpl = require('better-sqlite3');
} catch (e1) {
  try {
    DatabaseImpl = require('sql.js');
    // sql.js 需要包装成 Database 兼容接口（暂不支持）
    console.warn('[db] sql.js 可用但未实现适配，请安装 better-sqlite3');
  } catch (e2) {
    // 都不可用，由调用方处理
  }
}

const SCHEMA_VERSION = 1;

const CREATE_SQL = `
CREATE TABLE IF NOT EXISTS records (
  content_hash TEXT PRIMARY KEY,
  fdate TEXT NOT NULL,
  shift TEXT DEFAULT '',
  workshop TEXT DEFAULT '',
  machine TEXT DEFAULT '',
  fields_json TEXT NOT NULL,
  fmodify_date TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_records_fdate ON records(fdate);
CREATE INDEX IF NOT EXISTS idx_records_workshop ON records(workshop);
CREATE INDEX IF NOT EXISTS idx_records_machine ON records(machine);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

class Database {
  /**
   * @param {string} [dbPath] - SQLite 文件路径，默认 server/data/sfc_records.db
   */
  constructor(dbPath) {
    if (!DatabaseImpl) {
      throw new Error('better-sqlite3 或 sql.js 均不可用');
    }

    this.dbPath = dbPath || path.resolve(__dirname, '../../data/sfc_records.db');
    /** @type {Database|null} */
    this.db = null;
  }

  /** 打开连接并初始化 schema */
  initialize() {
    const fs = require('fs');
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseImpl(this.dbPath);

    // WAL 模式提升并发读性能
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');

    this._ensureSchema();
    console.log(`[db] SQLite 已初始化 path=${this.dbPath}`);
  }

  /** 检查并创建/迁移 schema */
  _ensureSchema() {
    // 检查 meta 表是否存在（即是否为全新库）
    const tableExists = this.db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='meta'`
    ).get();

    if (!tableExists) {
      // 全新库：创建表
      this.db.exec(CREATE_SQL);
      this.setMeta('schemaVersion', String(SCHEMA_VERSION));
      return;
    }

    // 检查版本
    const ver = this.getMeta('schemaVersion');
    if (!ver || parseInt(ver, 10) < SCHEMA_VERSION) {
      // 版本不匹配：重建（数据兼容性无法保证）
      console.warn(`[db] schema 版本不匹配 (${ver || 0} → ${SCHEMA_VERSION})，重建数据库`);
      this.db.exec(`DROP TABLE IF EXISTS records`);
      this.db.exec(`DROP TABLE IF EXISTS meta`);
      this.db.exec(CREATE_SQL);
      this.setMeta('schemaVersion', String(SCHEMA_VERSION));
    }
  }

  // ==================== 记录操作 ====================

  /**
   * 读取所有记录，返回处理好的记录数组（格式同 _aggregate 的输入）
   * @returns {Array<{ date: string, shift: string, workshop: string, machine: string, fields: object }>}
   */
  getAllRecords() {
    if (!this.db) return [];

    try {
      const rows = this.db.prepare('SELECT * FROM records').all();
      return rows.map((r) => {
        const fields = JSON.parse(r.fields_json);
        return {
          date: r.fdate,
          shift: r.shift,
          workshop: r.workshop,
          machine: r.machine,
          fields,
          content_hash: r.content_hash,
        };
      });
    } catch (err) {
      console.error(`[db] 读取记录失败: ${err.message}`);
      return [];
    }
  }

  /**
   * 读取指定日期范围内的记录
   * @param {string} startDate - 'YYYY-MM-DD'
   * @param {string} endDate - 'YYYY-MM-DD'
   * @returns {Array<{ date: string, shift: string, workshop: string, machine: string, fields: object }>}
   */
  getRecordsInRange(startDate, endDate) {
    if (!this.db) return [];

    try {
      const rows = this.db.prepare(
        'SELECT * FROM records WHERE fdate >= ? AND fdate <= ? ORDER BY fdate ASC'
      ).all(startDate, endDate);
      return rows.map((r) => {
        const fields = JSON.parse(r.fields_json);
        return {
          date: r.fdate,
          shift: r.shift,
          workshop: r.workshop,
          machine: r.machine,
          fields,
          content_hash: r.content_hash,
        };
      });
    } catch (err) {
      console.error(`[db] 读取记录失败: ${err.message}`);
      return [];
    }
  }

  /**
   * 全量替换所有记录（用于首次同步或全量覆盖）
   * @param {Array} records - 处理后的记录数组
   */
  replaceAllRecords(records) {
    if (!this.db || records.length === 0) return;

    const insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO records (content_hash, fdate, shift, workshop, machine, fields_json, fmodify_date)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction((rows) => {
      this.db.exec('DELETE FROM records');
      for (const r of rows) {
        insertStmt.run(
          r.content_hash,
          r.date,
          r.shift,
          r.workshop,
          r.machine,
          JSON.stringify(r.fields),
          r.fmodify_date || null,
        );
      }
    });

    try {
      transaction(records);
      console.log(`[db] 全量替换完成: ${records.length} 条`);
    } catch (err) {
      console.error(`[db] 全量替换失败: ${err.message}`);
    }
  }

  /**
   * 增量合并记录（INSERT OR REPLACE）
   * @param {Array} records
   */
  upsertRecords(records) {
    if (!this.db || records.length === 0) return;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO records (content_hash, fdate, shift, workshop, machine, fields_json, fmodify_date)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction((rows) => {
      for (const r of rows) {
        stmt.run(
          r.content_hash,
          r.date,
          r.shift,
          r.workshop,
          r.machine,
          JSON.stringify(r.fields),
          r.fmodify_date || null,
        );
      }
    });

    try {
      transaction(records);
      console.log(`[db] 增量合并完成: ${records.length} 条`);
    } catch (err) {
      console.error(`[db] 增量合并失败: ${err.message}`);
    }
  }

  /** 获取记录总数 */
  getRecordCount() {
    if (!this.db) return 0;
    try {
      const row = this.db.prepare('SELECT COUNT(*) AS cnt FROM records').get();
      return row ? row.cnt : 0;
    } catch {
      return 0;
    }
  }

  // ==================== 元数据 ====================

  getMeta(key) {
    if (!this.db) return null;
    try {
      const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
      return row ? row.value : null;
    } catch {
      return null;
    }
  }

  setMeta(key, value) {
    if (!this.db) return;
    try {
      this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
    } catch (err) {
      console.error(`[db] meta 写入失败 key=${key}: ${err.message}`);
    }
  }

  // ==================== 生命周期 ====================

  /** 关闭数据库连接 */
  close() {
    if (this.db) {
      try {
        this.db.close();
        console.log('[db] 数据库连接已关闭');
      } catch (err) {
        console.warn(`[db] 关闭异常: ${err.message}`);
      }
      this.db = null;
    }
  }
}

module.exports = Database;
