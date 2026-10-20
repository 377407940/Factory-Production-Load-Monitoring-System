/**
 * 生产损耗数据服务
 *
 * 数据来源：yjytask.joyea.cn:3000 的 /biz/loss/stick-data 损耗计算接口（按生产订单号，条袋 MP 产品）
 * 思路：像电表数据一样，把损耗数据拉取后落本地 SQLite（loss_data.db），看板读库秒回，避免每次实时调外部接口。
 *
 * 数据口径：
 *  - lossRate 是实时计算值，会随订单进度变化；生产中途（开工/下达）领料远超当前产出 → 损耗率虚高无意义
 *  - 订单到 完工/结案/结算 后损耗率才稳定有意义 → 只有这些状态的订单才向前端展示
 *  - 非最终状态订单：当天内缓存，跨天重取更新（随订单完工自动更新出损耗率）
 *
 * 表结构：
 *   mo_loss        每生产订单一行：汇总损耗 + 订单状态
 *   mo_loss_entry  每子件一行：理论/实际用量、损耗率（点开明细用）
 */
const path = require('path');
const axios = require('axios');
const Database = require('better-sqlite3');
const SmartMeterClient = require('./smartMeterClient');
const config = require('../config');

/** 损耗率有意义的最终状态（>= 完工） */
const FINAL_STATUSES = ['完工', '结案', '结算'];

/** 默认数据库路径：server/data/loss_data.db */
const DEFAULT_DB_PATH = path.resolve(__dirname, '../../data/loss_data.db');

class LossService {
  /**
   * @param {{ dbPath?: string }} [opts]
   */
  constructor({ dbPath } = {}) {
    this.dbPath = dbPath || config.loss.dbPath || DEFAULT_DB_PATH;
    /** @type {Database.Database|null} */
    this.db = null;
    this._token = null;
  }

  /** 初始化数据库表结构 */
  initialize() {
    if (this.db) return this;
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mo_loss (
        bill_no TEXT PRIMARY KEY,
        type TEXT,
        sale_order TEXT,
        fqty REAL,
        material_no TEXT,
        material_name TEXT,
        material_spe TEXT,
        unit TEXT,
        stock_qty REAL,
        box_stock REAL,
        total_theory REAL,
        total_real REAL,
        loss_rate TEXT,
        fstatus TEXT,
        updated_at TEXT,
        data_json TEXT
      );
      CREATE TABLE IF NOT EXISTS mo_loss_entry (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bill_no TEXT NOT NULL,
        seq INTEGER,
        child_no TEXT,
        material_name TEXT,
        material_spe TEXT,
        unit TEXT,
        numerator REAL,
        denominator REAL,
        translate_qty REAL,
        picked_qty REAL,
        good_return REAL,
        bad_return REAL,
        qty REAL,
        theory_qty REAL,
        real_qty REAL,
        loss_rate TEXT,
        fstatus TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_entry_bill ON mo_loss_entry(bill_no);
    `);
    return this;
  }

  // ===================== 登录 =====================

  async _ensureToken() {
    if (this._token) return;
    if (!config.meter.baseUrl) throw new Error('未配置电表 API（METER_BASE_URL），无法调用损耗接口');
    const client = new SmartMeterClient({
      baseUrl: config.meter.baseUrl,
      account: config.meter.account,
      password: config.meter.password,
    });
    await client.authenticate();
    this._token = client._token;
  }

  // ===================== 拉取外部接口 =====================

  /** 调一次 stick-data（用当前缓存的 token）；token 类错误在 err.isTokenError 上标记 */
  async _stickLossOnce(moNumber) {
    const res = await axios.get(`${config.meter.baseUrl}/biz/loss/stick-data`, {
      params: { fnumber: moNumber },
      headers: { token: this._token },
      timeout: 30000,
    });
    const body = res.data || {};
    if (body.code !== 200) {
      const err = new Error(body.msg || `code=${body.code}`);
      err.isTokenError = /token/i.test(String(body.msg || ''));
      throw err;
    }
    return body.data || null;
  }

  /**
   * 调 stick-data 拉某生产订单损耗
   * @param {string} moNumber
   * @returns {Promise<object|null>} 原始响应 data；code 非 200 / 非条袋订单抛错由调用方处理
   */
  async fetchStickLoss(moNumber) {
    await this._ensureToken();
    try {
      return await this._stickLossOnce(moNumber);
    } catch (err) {
      if (!err.isTokenError) throw err;
      // token 过期：清掉缓存、重新登录后重试一次。
      // SmartMeterClient 对电表请求有同样的重试，所以电表侧一直正常；
      // 损耗侧以前漏了这段 —— _token 只取不换，token 一过期就连续几天静默失败
      // （2026-10-04~06 实际发生：每天 7:20 的损耗预热 0/13 全部失败）。2026-10-06 修。
      console.warn('[loss] token 已过期，重新登录后重试...');
      this._token = null;
      await this._ensureToken();
      return await this._stickLossOnce(moNumber);
    }
  }

  // ===================== 落库 =====================

  /** 把 stick-data 原始响应写入 mo_loss + mo_loss_entry（先删旧 entry 再插新） */
  upsertLoss(raw) {
    if (!raw || !raw.billNo) return;
    const today = new Date().toISOString().slice(0, 10);
    const entries = Array.isArray(raw.entries) ? raw.entries : [];
    // 订单状态：主表无 fstatus，取 entry 行首条状态（整单一致）
    const fstatus = (entries[0] && entries[0].fstatus) || null;

    const upsertMain = this.db.prepare(`
      INSERT OR REPLACE INTO mo_loss
        (bill_no, type, sale_order, fqty, material_no, material_name, material_spe, unit,
         stock_qty, box_stock, total_theory, total_real, loss_rate, fstatus, updated_at, data_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    this.db.transaction(() => {
      upsertMain.run(
        raw.billNo, raw.type || '条袋', raw.saleOrder || null, raw.fqty ?? null,
        raw.materialNo || null, raw.materialName || null, raw.materialSpe || null, raw.unit || null,
        raw.stockQty ?? null, raw.boxStock ?? null, raw.totalTheory ?? null, raw.totalReal ?? null,
        raw.lossRate ?? null, fstatus, today, JSON.stringify(raw)
      );
      this.db.prepare('DELETE FROM mo_loss_entry WHERE bill_no = ?').run(raw.billNo);
      const insEntry = this.db.prepare(`
        INSERT INTO mo_loss_entry
          (bill_no, seq, child_no, material_name, material_spe, unit, numerator, denominator,
           translate_qty, picked_qty, good_return, bad_return, qty, theory_qty, real_qty, loss_rate, fstatus)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `);
      for (const e of entries) {
        insEntry.run(
          raw.billNo, e.seq ?? null, e.childNo || null, e.materialName || null, e.materialSpe || null,
          e.unit || null, e.numerator ?? null, e.denominator ?? null, e.translateQty ?? null,
          e.pickedQty ?? null, e.goodReturn ?? null, e.badReturn ?? null, e.qty ?? null,
          e.theoryQty ?? null, e.realQty ?? null, e.lossRate ?? null, e.fstatus || null
        );
      }
    })();
  }

  // ===================== 读取 =====================

  /** 从库读某订单（含明细）；不存在返回 null。字段统一转 camelCase（与前端/外部接口一致） */
  getStoredLoss(moNumber) {
    const m = this.db.prepare('SELECT * FROM mo_loss WHERE bill_no = ?').get(moNumber);
    if (!m) return null;
    const rows = this.db.prepare(
      'SELECT * FROM mo_loss_entry WHERE bill_no = ? ORDER BY seq ASC, id ASC'
    ).all(moNumber);
    return {
      billNo: m.bill_no, type: m.type, saleOrder: m.sale_order, fqty: m.fqty,
      materialNo: m.material_no, materialName: m.material_name, materialSpe: m.material_spe, unit: m.unit,
      stockQty: m.stock_qty, boxStock: m.box_stock, totalTheory: m.total_theory, totalReal: m.total_real,
      lossRate: m.loss_rate, fstatus: m.fstatus, updatedAt: m.updated_at,
      entries: rows.map((e) => ({
        childNo: e.child_no, materialName: e.material_name, materialSpe: e.material_spe, unit: e.unit,
        seq: e.seq, numerator: e.numerator, denominator: e.denominator, translateQty: e.translate_qty,
        pickedQty: e.picked_qty, goodReturn: e.good_return, badReturn: e.bad_return, qty: e.qty,
        theoryQty: e.theory_qty, realQty: e.real_qty, lossRate: e.loss_rate, fstatus: e.fstatus,
      })),
    };
  }

  /** 读穿缓存：有则读库（最终状态长期缓存；非最终当天缓存），无或过期则拉外部接口落库 */
  async getOrFetchLoss(moNumber) {
    this.initialize();
    const today = new Date().toISOString().slice(0, 10);
    const row = this.getStoredLoss(moNumber);
    if (row) {
      const isFinal = FINAL_STATUSES.includes(row.fstatus);
      // getStoredLoss 返回 camelCase：updatedAt
      const freshToday = (row.updatedAt || '').slice(0, 10) === today;
      if (isFinal || freshToday) {
        return { ...row, source: 'db' };
      }
      // 非最终且非今天 → 拉取更新
    }
    try {
      const raw = await this.fetchStickLoss(moNumber);
      if (!raw || !raw.billNo) return { moNumber, found: false };
      this.upsertLoss(raw);
      const stored = this.getStoredLoss(moNumber);
      return { ...stored, source: 'api' };
    } catch (err) {
      console.warn(`[loss] ${moNumber} 拉取失败: ${err.message}`);
      return { moNumber, found: false, error: err.message };
    }
  }

  /** 某订单是否处于最终状态（完工+） */
  static isFinalStatus(status) {
    return FINAL_STATUSES.includes(status);
  }

  // ===================== 预热 =====================

  /**
   * 批量拉取并落库一批订单（预热任务用）
   * @param {string[]} moNumbers
   * @returns {Promise<{ok: number, fail: number, failList: string[]}>}
   */
  async prewarmMoList(moNumbers, { concurrency = 4 } = {}) {
    this.initialize();
    let ok = 0;
    let fail = 0;
    const failList = [];
    const queue = [...moNumbers];
    const worker = async () => {
      while (queue.length) {
        const mo = queue.shift();
        try {
          const res = await this.getOrFetchLoss(mo);
          if (res.found === false) { fail++; failList.push(mo); }
          else ok++;
        } catch (e) {
          fail++; failList.push(mo);
        }
      }
    };
    const workers = Array.from({ length: Math.min(concurrency, moNumbers.length || 1) }, () => worker());
    await Promise.all(workers);
    return { ok, fail, failList };
  }

  /** 关闭数据库 */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

module.exports = LossService;
