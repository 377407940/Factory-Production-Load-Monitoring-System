/**
 * 呆滞成品服务
 *
 * 数据来源：金蝶 **即时库存** STK_Inventory（当前快照，没有历史）。
 *   filter: FStockName = '成品仓' AND FBASEQTY > 0
 *   ⚠️ 必须带 FBASEQTY > 0：成品仓共 1.6 万行，其中 1.59 万行是已出完的历史批号（库存量 0），
 *      不加这个过滤看板会被空批号淹没、且呆滞判定全部误命中。
 *
 * 呆滞定义：批次的 **生产日期** 距参考日 > 阈值天数（默认 30）。按批号判定，不是按物料 ——
 *   一个成品可能既有新批号也有老批号，只把老批号的量算作呆滞。
 *
 * 落库：每天一条快照（inv_snapshot，同一日期重复拉取直接覆盖）。
 *   存的是**原始批号**而不是算好的汇总 —— 这样 30/60/90 三个阈值、以及以后改口径，
 *   都能从同一份历史重算，不用重存。
 *
 * 注意：即时库存没有历史接口，趋势只能从现在开始逐日积累，补不了过去。
 */
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

/**
 * 查询字段顺序必须与金蝶返回列一一对应。
 * 注意两个坑：
 *  - `FLOT` 返回的是批号的**内部 ID**（如 983022），可读批号要取 `FLot.FNumber`（如 20250604G）
 *  - 同一个批号可能因为**辅助属性**不同被拆成多行（生产日期/保质期一致），需要按批号合并数量
 */
const FIELD_KEYS = [
  'FMaterialId.FNumber',   // 0  物料编码
  'FMaterialName',         // 1  物料名称
  'FBASEQTY',              // 2  库存量(基本单位)
  'FLOT',                  // 3  批号内部ID（合并用）
  'FLot.FNumber',          // 4  可读批号（展示用）
  'FPRODUCEDATE',          // 5  生产日期
  'FEXPIRYDATE',           // 6  保质期至
  'FBASEUNITID.FName',     // 7  基本单位
  'FStockStatusId.FName',  // 8  库存状态（可用/冻结…）
  'FStockUnitId.FName',    // 9  库存单位（箱/盒…，仅供参考；数量口径是基本单位）
  'FStockName',            // 10 仓库
];

const PAGE_SIZE = 200;
const MAX_PAGES = 120; // 200×120 = 24000 行上限，实测成品仓有库存的约 150 行
const LOT_BATCH = 15;  // 客户链路：每次 IN 多少个批号
const BILL_BATCH = 30; // 客户链路：每次 IN 多少张单据

/** 按 n 个一组切分（客户链路批量查询用） */
function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** 拼 SQL IN 列表（单引号转义，防止批号里的特殊字符破坏语句） */
function sqlIn(arr) {
  return arr.map((v) => `'${String(v).replace(/'/g, "''")}'`).join(',');
}

/** 解析金蝶日期（可能是 '2026-10-09T00:00:00' 或 ISO） */
function fmtDate(v) {
  const s = String(v || '');
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}

/** 本地日期 YYYY-MM-DD（北京时间） */
function localDate(d = new Date()) {
  const t = new Date(d.getTime() + 8 * 3600 * 1000);
  return t.toISOString().slice(0, 10);
}

/** 两个 YYYY-MM-DD 之间的天数差（a - b） */
function dayDiff(a, b) {
  if (!a || !b) return null;
  const ms = new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.round(ms / 86400000);
}

class StagnantService {
  /**
   * @param {object} opts
   * @param {object} opts.client - 金蝶客户端（KingdeeClient）
   * @param {string} [opts.dbPath]
   */
  constructor({ client, dbPath } = {}) {
    this.client = client || null;
    this.dbPath = dbPath || config.stagnant.dbPath;
    this.db = null;
  }

  initialize() {
    if (this.db) return this;
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS inv_snapshot (
        snap_date     TEXT NOT NULL,
        material_code TEXT NOT NULL DEFAULT '',
        material_name TEXT NOT NULL DEFAULT '',
        lot           TEXT NOT NULL DEFAULT '',
        produce_date  TEXT,
        expiry_date   TEXT,
        qty           REAL NOT NULL DEFAULT 0,
        unit          TEXT DEFAULT '',
        status        TEXT DEFAULT '',
        stock_unit    TEXT DEFAULT '',
        customer      TEXT DEFAULT '',
        PRIMARY KEY (snap_date, material_code, lot)
      );
      CREATE INDEX IF NOT EXISTS idx_inv_date ON inv_snapshot(snap_date);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    `);
    // 老库补列（加库存状态/库存单位；批号已按 FLot.FNumber 存，历史快照保持可读）
    const cols = this.db.prepare('PRAGMA table_info(inv_snapshot)').all().map((c) => c.name);
    if (cols.length && !cols.includes('status')) {
      this.db.exec("ALTER TABLE inv_snapshot ADD COLUMN status TEXT DEFAULT ''");
      this.db.exec("ALTER TABLE inv_snapshot ADD COLUMN stock_unit TEXT DEFAULT ''");
    }
    if (cols.length && !cols.includes('customer')) {
      this.db.exec("ALTER TABLE inv_snapshot ADD COLUMN customer TEXT DEFAULT ''");
    }
    return this;
  }

  getMeta(key) {
    const r = this.db.prepare('SELECT value FROM meta WHERE key=?').get(key);
    return r ? r.value : null;
  }
  setMeta(key, value) {
    this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?,?)').run(key, String(value));
  }

  // ===================== 拉金蝶 =====================

  /**
   * 拉即时库存（成品仓、库存量>0）。
   * 不能复用 executeBillQueryAll：它不透传 skipDateFilter，会自动加 `FDate >= ...`，
   * 而 STK_Inventory 没有 FDate 字段，查询会直接报错。所以这里自己分页。
   */
  async fetchInventory() {
    if (!this.client || !this.client.isConfigured()) throw new Error('金蝶客户端未配置');
    const { stockName, orgNumber } = config.stagnant;
    // 组织过滤不能少：成品仓里除了 YJY，还混着 YY 组织的库存
    const filter = `FStockOrgId.FNumber = '${orgNumber}' AND FStockName = '${stockName}' AND FBASEQTY > 0`;
    const out = new Map(); // key = 物料编码|批号ID
    let rawCount = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await this.client.callWithAuth(() => this.client.executeBillQuery('STK_Inventory', {
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        fieldKeys: FIELD_KEYS,
        filter,
        orderString: 'FPRODUCEDATE ASC',
        skipDateFilter: true,
      }));
      const rows = Array.isArray(res && res.data) ? res.data : [];
      // 金蝶把错误当成一行数据返回，必须显式识别
      if (rows.length && rows[0] && rows[0].Result) {
        const msg = (rows[0].Result.ResponseStatus && rows[0].Result.ResponseStatus.Errors
          && rows[0].Result.ResponseStatus.Errors[0] && rows[0].Result.ResponseStatus.Errors[0].Message)
          || JSON.stringify(rows[0]).slice(0, 200);
        throw new Error(`金蝶返回错误：${msg}`);
      }
      for (const r of rows) {
        if (!Array.isArray(r)) continue;
        const qty = Number(r[2]) || 0;
        if (qty <= 0) continue;
        rawCount++;
        const materialCode = String(r[0] || '').trim();
        const lotId = String(r[3] || '').trim();
        const lot = String(r[4] || '').trim() || lotId;
        const produceDate = fmtDate(r[5]);
        const expiryDate = fmtDate(r[6]);
        // 同一批号因「辅助属性」不同会拆成多行 → 按批号合并数量
        const key = `${materialCode}|${lotId || lot}`;
        const hit = out.get(key);
        if (hit) {
          hit.qty += qty;
          if (hit.produce_date !== produceDate) {
            console.warn(`[stagnant] 批号 ${lot} 出现多个生产日期（${hit.produce_date} / ${produceDate}），按较早的算`);
            if (produceDate && (!hit.produce_date || produceDate < hit.produce_date)) hit.produce_date = produceDate;
          }
          continue;
        }
        out.set(key, {
          material_code: materialCode,
          material_name: String(r[1] || '').trim(),
          qty,
          lot,
          produce_date: produceDate,
          expiry_date: expiryDate,
          unit: String(r[7] || '').trim(),
          status: String(r[8] || '').trim(),
          stock_unit: String(r[9] || '').trim(),
        });
      }
      if (rows.length < PAGE_SIZE) break;
      if (page === MAX_PAGES - 1) {
        console.warn(`[stagnant] 分页达到上限 ${MAX_PAGES} 页，可能有数据被截断`);
      }
    }
    const list = [...out.values()];
    if (rawCount !== list.length) {
      console.log(`[stagnant] 金蝶 ${rawCount} 行 → 按批号合并为 ${list.length} 个批次（同批号多辅助属性）`);
    }
    return list;
  }

  // ===================== 客户解析 =====================

  /**
   * 自建分页查询（和 fetchInventory 同样的理由：executeBillQueryAll 不透传 skipDateFilter）。
   * @returns {Promise<Array<Array>>} 2D 数组行
   */
  async _queryPaged(formId, fieldKeys, filter) {
    const out = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await this.client.callWithAuth(() => this.client.executeBillQuery(formId, {
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        fieldKeys,
        filter,
        orderString: '',
        skipDateFilter: true,
      }));
      const rows = Array.isArray(res && res.data) ? res.data : [];
      // 金蝶把错误当成一行数据返回，必须显式识别
      if (rows.length && rows[0] && rows[0].Result) {
        const msg = (rows[0].Result.ResponseStatus && rows[0].Result.ResponseStatus.Errors
          && rows[0].Result.ResponseStatus.Errors[0] && rows[0].Result.ResponseStatus.Errors[0].Message)
          || JSON.stringify(rows[0]).slice(0, 200);
        throw new Error(`金蝶返回错误：${msg}`);
      }
      for (const r of rows) if (Array.isArray(r)) out.push(r);
      if (rows.length < PAGE_SIZE) break;
    }
    return out;
  }

  /**
   * 解析「物料编码 + 批号 → 客户」。
   *
   * 即时库存表本身没有客户字段（实测 FCustId 全为空，FOwnerId 只是本公司），
   * 只能顺着单据链反查：
   *   批号 → PRD_INSTOCK 生产入库单 FMoBillNo
   *        → PRD_MO     生产订单   FSaleOrderNo
   *        → SAL_SaleOrder 销售订单 FCUSTID.FName
   *
   * ⚠️ 三段都用自建分页 + skipDateFilter：executeBillQueryAll 不透传 skipDateFilter，
   *    会被强制加上 `FDate >= 数据起始日`，2026-01-01 之前入库的老批号就查不到了
   *    （实测 6 个 2025 年的批号就是这么漏掉的，改用 skipDateFilter 后 149/149 全中）。
   *
   * @param {Array<{material_code:string, lot:string}>} pairs
   * @returns {Promise<Map<string,string>>} '物料编码|批号' → 客户名（解析不到的没有键）
   */
  async resolveCustomers(pairs) {
    const out = new Map();
    if (!this.client || !this.client.isConfigured() || !pairs.length) return out;

    // 1) 批号 → 生产订单。按批号批量查；一个批号下混着 MP/FP 多个物料，所以按「物料+批号」收窄
    const lots = [...new Set(pairs.map((p) => p.lot).filter(Boolean))];
    const pairMos = new Map(); // 'mat|lot' → Set(生产订单号)
    for (const batch of chunk(lots, LOT_BATCH)) {
      try {
        const rows = await this._queryPaged('PRD_INSTOCK',
          ['FMoBillNo', 'FMaterialId.FNumber', 'FLot.FNumber'],
          `FLot.FNumber IN (${sqlIn(batch)})`);
        for (const r of rows) {
          const mo = String(r[0] || '').trim();
          const mat = String(r[1] || '').trim();
          const lot = String(r[2] || '').trim();
          if (!mo || !mat || !lot) continue;
          const k = `${mat}|${lot}`;
          if (!pairMos.has(k)) pairMos.set(k, new Set());
          pairMos.get(k).add(mo);
        }
      } catch (e) {
        console.warn(`[stagnant] 批号→生产订单 查询失败: ${e.message}`);
      }
    }

    // 2) 生产订单 → 销售订单
    const allMos = [...new Set([...pairMos.values()].flatMap((s) => [...s]))];
    const moSo = new Map();
    for (const batch of chunk(allMos, BILL_BATCH)) {
      try {
        const rows = await this._queryPaged('PRD_MO', ['FBillNo', 'FSaleOrderNo'], `FBillNo IN (${sqlIn(batch)})`);
        for (const r of rows) {
          const mo = String(r[0] || '').trim();
          const so = String(r[1] || '').trim();
          if (mo && so) moSo.set(mo, so);
        }
      } catch (e) {
        console.warn(`[stagnant] 生产订单→销售订单 查询失败: ${e.message}`);
      }
    }

    // 3) 销售订单 → 客户
    const allSos = [...new Set([...moSo.values()])];
    const soCust = new Map();
    for (const batch of chunk(allSos, BILL_BATCH)) {
      try {
        const rows = await this._queryPaged('SAL_SaleOrder', ['FBILLNO', 'FCUSTID.FName'], `FBILLNO IN (${sqlIn(batch)})`);
        for (const r of rows) {
          const so = String(r[0] || '').trim();
          const c = String(r[1] || '').trim();
          if (so && c) soCust.set(so, c);
        }
      } catch (e) {
        console.warn(`[stagnant] 销售订单→客户 查询失败: ${e.message}`);
      }
    }

    for (const [k, mos] of pairMos) {
      for (const mo of mos) {
        const so = moSo.get(mo);
        const c = so && soCust.get(so);
        if (c) { out.set(k, c); break; }
      }
    }
    return out;
  }

  /** 历史快照里已经解析过的 物料+批号 → 客户（当缓存用，省掉重复回查金蝶） */
  _knownCustomers() {
    const rows = this.db
      .prepare("SELECT material_code, lot, MAX(customer) AS c FROM inv_snapshot WHERE customer <> '' GROUP BY material_code, lot")
      .all();
    return new Map(rows.map((r) => [`${r.material_code}|${r.lot}`, r.c]));
  }

  /**
   * 给批次行补 customer 字段。已经解析过的直接从历史快照取，只对新增的批号回查金蝶 ——
   * ensureFresh 是「超过 30 分钟就在打开页面时重拉」，不缓存的话每次开页面都要多等 1~2 分钟。
   * 批号对应的生产订单/客户是固定事实，缓存不会过期。
   * @returns {Promise<number>} 本次新解析出的批号数
   */
  async _attachCustomers(rows) {
    const known = this._knownCustomers();
    const missing = [];
    for (const r of rows) {
      const hit = known.get(`${r.material_code}|${r.lot}`);
      if (hit) r.customer = hit;
      else missing.push(r);
    }
    let fresh = 0;
    if (missing.length) {
      const m = await this.resolveCustomers(missing);
      for (const r of missing) {
        const c = m.get(`${r.material_code}|${r.lot}`) || '';
        r.customer = c;
        if (c) fresh++;
      }
    }
    return fresh;
  }

  /** 写入某天的快照（整体替换该天） */
  saveSnapshot(date, rows) {
    this.initialize();
    const tx = this.db.transaction((list) => {
      this.db.prepare('DELETE FROM inv_snapshot WHERE snap_date = ?').run(date);
      const ins = this.db.prepare(
        `INSERT OR REPLACE INTO inv_snapshot
           (snap_date, material_code, material_name, lot, produce_date, expiry_date, qty, unit, status, stock_unit, customer)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      );
      for (const r of list) {
        ins.run(date, r.material_code, r.material_name, r.lot, r.produce_date || null, r.expiry_date || null,
          r.qty, r.unit || '', r.status || '', r.stock_unit || '', r.customer || '');
      }
    });
    tx(rows);
    this.setMeta('lastPullAt', new Date().toISOString());
    return rows.length;
  }

  /**
   * 保证快照足够新：距上次拉取超过 maxAgeMinutes 就重新拉（同一日期直接覆盖）。
   * @param {{force?: boolean, maxAgeMinutes?: number}} opts
   */
  async ensureFresh({ force = false, maxAgeMinutes = 30 } = {}) {
    this.initialize();
    const last = this.getMeta('lastPullAt');
    if (!force && last) {
      const ageMin = (Date.now() - new Date(last).getTime()) / 60000;
      if (ageMin >= 0 && ageMin < maxAgeMinutes) {
        const today = localDate();
        const n = this.db.prepare('SELECT COUNT(*) c FROM inv_snapshot WHERE snap_date = ?').get(today).c;
        if (n > 0) return { pulled: false, count: n, lastPullAt: last, ageMinutes: Math.round(ageMin) };
      }
    }
    const rows = await this.fetchInventory();
    const fresh = await this._attachCustomers(rows);
    const count = this.saveSnapshot(localDate(), rows);
    console.log(`[stagnant] 即时库存同步完成: ${count} 个批次（组织 ${config.stagnant.orgNumber} · ${config.stagnant.stockName} · 库存量>0），新解析客户 ${fresh} 个`);
    return { pulled: true, count, customersResolved: fresh, lastPullAt: new Date().toISOString(), ageMinutes: 0 };
  }

  /** 清理过期快照 */
  prune() {
    this.initialize();
    const cutoff = localDate(new Date(Date.now() - config.stagnant.keepDays * 86400000));
    const info = this.db.prepare('DELETE FROM inv_snapshot WHERE snap_date < ?').run(cutoff);
    if (info.changes) console.log(`[stagnant] 清理 ${cutoff} 之前的快照: ${info.changes} 行`);
    return info.changes;
  }

  // ===================== 计算 =====================

  /**
   * 按阈值口径分组：以某天快照 + 参考日，把批号分成呆滞/正常，并按物料汇总
   * @param {Array} rows - 某天快照行
   * @param {string} refDate - 参考日（算账龄的基准）
   * @param {number} days - 阈值
   */
  static aggregate(rows, refDate, days) {
    const byMat = new Map();
    let stockQty = 0;
    let stagnantQty = 0;
    let stagnantLots = 0;
    let expiredLots = 0;
    let noProduceDate = 0;
    let oldestAgeDays = null;

    for (const r of rows) {
      const qty = Number(r.qty) || 0;
      stockQty += qty;
      const age = dayDiff(refDate, r.produce_date);
      if (age == null) noProduceDate++;
      const stale = age != null && age > days;
      const key = r.material_code || r.material_name;
      const m = byMat.get(key) || {
        materialCode: r.material_code, product: r.material_name,
        // unit=基本单位（该 ERP 里全是 "Pcs"，没参考价值）；stockUnit=库存单位（箱/盒），
        // 与产品名「箱装/盒装」一致，所以前端展示用 stockUnit
        unit: r.unit || '', stockUnit: r.stock_unit || '',
        qty: 0, qtyAll: 0, lots: 0, lotsAll: 0, lotsList: [],
        oldestProduceDate: '', oldestAgeDays: null, earliestExpiry: '', daysToExpiry: null,
        _customers: new Set(),
      };
      if (!m.stockUnit && r.stock_unit) m.stockUnit = r.stock_unit;
      // 客户挂在「物料+批号」上（批号 → 生产订单 → 销售订单 → 客户）。
      // 实测同一成品只对一个客户，但这里仍按集合收，跨客户时全部列出而不是丢掉
      if (r.customer) m._customers.add(r.customer);
      m.qtyAll += qty;
      m.lotsAll += 1;
      if (stale) {
        m.qty += qty;
        m.lots += 1;
        stagnantQty += qty;
        stagnantLots += 1;
        if (m.oldestAgeDays == null || age > m.oldestAgeDays) {
          m.oldestAgeDays = age;
          m.oldestProduceDate = r.produce_date;
        }
        if (r.expiry_date && (!m.earliestExpiry || r.expiry_date < m.earliestExpiry)) {
          m.earliestExpiry = r.expiry_date;
        }
        const dte = dayDiff(r.expiry_date, refDate);
        if (dte != null) {
          if (m.daysToExpiry == null || dte < m.daysToExpiry) m.daysToExpiry = dte;
          if (dte < 0) expiredLots++;
        }
        m.lotsList.push({
          lot: r.lot, qty, produceDate: r.produce_date, ageDays: age,
          expiryDate: r.expiry_date, daysToExpiry: dte,
        });
        if (oldestAgeDays == null || age > oldestAgeDays) oldestAgeDays = age;
      }
      byMat.set(key, m);
    }

    const list = [...byMat.values()].filter((m) => m.lots > 0);
    for (const m of list) {
      m.lotsList.sort((a, b) => b.ageDays - a.ageDays);
      m.staleRatio = m.qtyAll > 0 ? Math.round((m.qty / m.qtyAll) * 1000) / 10 : 0;
      m.customer = [...m._customers].sort().join(' / ');
      delete m._customers;
    }
    list.sort((a, b) => b.qty - a.qty);

    return {
      rows: list,
      summary: {
        stagnantItems: list.length,
        stagnantQty: Math.round(stagnantQty * 100) / 100,
        stagnantLots,
        stockItems: byMat.size,
        stockQty: Math.round(stockQty * 100) / 100,
        stagnantRatio: stockQty > 0 ? Math.round((stagnantQty / stockQty) * 1000) / 10 : 0,
        oldestAgeDays,
        expiredLots,
        noProduceDate,
      },
    };
  }

  /**
   * 出看板数据
   * @param {{days?: number, trendDays?: number}} opts
   */
  query({ days = config.stagnant.thresholdDays, trendDays = 30 } = {}) {
    this.initialize();
    const today = localDate();
    const rows = this.db.prepare('SELECT * FROM inv_snapshot WHERE snap_date = ?').all(today);

    const { rows: detail, summary } = StagnantService.aggregate(rows, today, days);

    // 趋势：每个历史快照按「各自日期」为基准、同一阈值重算
    const snapDates = this.db
      .prepare('SELECT DISTINCT snap_date FROM inv_snapshot ORDER BY snap_date DESC LIMIT ?')
      .all(trendDays)
      .map((r) => r.snap_date)
      .reverse();
    const trend = [];
    for (const d of snapDates) {
      const dayRows = this.db.prepare('SELECT * FROM inv_snapshot WHERE snap_date = ?').all(d);
      const agg = StagnantService.aggregate(dayRows, d, days);
      trend.push({
        date: d,
        label: d.slice(5),
        items: agg.summary.stagnantItems,
        qty: agg.summary.stagnantQty,
      });
    }

    return {
      asOf: today,
      thresholdDays: days,
      orgNumber: config.stagnant.orgNumber,
      stockName: config.stagnant.stockName,
      summary,
      rows: detail,
      trend,
      trendPoints: trend.length,
    };
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

module.exports = StagnantService;
