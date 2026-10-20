/**
 * 灌装 vs 外包成品入库 对比服务
 *
 * 目标表：每个 MP 条袋产品 × 生产日期 → { 灌装数量, 成品数量(折算条), 差异 }
 *
 * 数据来源：
 *  1. PRD_INSTOCK（生产入库单，金蝶）— MP 条袋灌装 + FP 盒装/外包成品的入库
 *      字段：FMaterialId.FNumber(物料编码) FMaterialId.FName(名称) FPRODUCEDATE(生产日期) FMUSTQTY(数量)
 *  2. box_ratio（盒条比）— 复用损耗库 mo_loss.data_json 里的 productData：
 *      键 = 成品订单 + FP成品编码 + MP条袋编码 → 比例（一个成品含多少条袋）
 *      必须带「成品订单」维度：同一个成品订单下，一个成品可能对应【多个条袋】，
 *      例：pp桶装50条（原味黑咖+黑巧风味）= 25条黑巧 MP020568 + 25条原味 MP020569。
 *      只按 fp_code 存会互相覆盖，导致其中一个条袋永远折算不到（2026-09-29 修）。
 *
 * 计算口径（已与业务确认）：
 *  行以 MP 条袋产品的 FPRODUCEDATE 为键；盒装成品的 FPRODUCEDATE 与条袋一致（即使包装跨天）
 *  灌装数量 = MP 当日 FMUSTQTY 合计
 *  成品数量 = 该 MP 对应的成品 FP 当日入库 FMUSTQTY × 盒条比 → 折算条数合计
 *  差异 = 灌装数量 − 成品数量
 */
const path = require('path');
const Database = require('better-sqlite3');

const PRD_FIELD_KEYS = [
  'FBillNo',
  'FMoBillNo',
  'FMaterialId.FNumber',
  'FMaterialId.FName',
  'FPRODUCEDATE',
  'FMUSTQTY',
];

const DEFAULT_DB_PATH = path.resolve(__dirname, '../../data/fillbox.db');

/** 数据源切换日：该日及之后灌装数量取 MES（成品折算逻辑不变） */
const MES_START_DATE = '2026-09-15';

class FillBoxService {
  /**
   * @param {object} opts
   * @param {object} opts.client - 金蝶客户端（KingdeeClient）
   * @param {string} [opts.dbPath]
   * @param {string} [opts.lossDbPath] - 损耗库路径（读取盒条比）
   */
  constructor({ client, dbPath, lossDbPath, mesFill } = {}) {
    this.client = client || null;
    // 灌装数量来源（MES_START_DATE 起）：(from, to) => Map<'产品名|日期', 数量>
    this.mesFill = typeof mesFill === 'function' ? mesFill : null;
    this.dbPath = dbPath || DEFAULT_DB_PATH;
    this.lossDbPath = lossDbPath || path.resolve(__dirname, '../../data/loss_data.db');
    this.db = null;
  }

  initialize() {
    if (this.db) return this;
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS prd_instock (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bill_no TEXT,
        mo_bill_no TEXT,
        material_code TEXT,
        material_name TEXT,
        producedate TEXT,
        qty REAL
      );
      CREATE INDEX IF NOT EXISTS idx_pi_code_date ON prd_instock(material_code, producedate);
      CREATE INDEX IF NOT EXISTS idx_pi_date ON prd_instock(producedate);

      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
    // box_ratio 结构在 2026-09-29 变过：加入「成品订单」维度（旧表以 fp_code 为主键，
    // 同一个成品订单下多条袋的成品会互相覆盖）。它是纯派生表，旧结构直接重建即可。
    const boxCols = this.db.prepare('PRAGMA table_info(box_ratio)').all().map((c) => c.name);
    if (boxCols.length > 0 && !boxCols.includes('mo_bill_no')) {
      console.log('[fillbox] box_ratio 结构升级：加 mo_bill_no 主键维度，重建表');
      this.db.exec('DROP TABLE box_ratio');
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS box_ratio (
        mo_bill_no TEXT,
        fp_code TEXT,
        mp_code TEXT,
        num REAL,
        den REAL,
        ratio REAL,
        PRIMARY KEY (mo_bill_no, fp_code, mp_code)
      );
    `);
    return this;
  }

  getMeta(key) {
    const r = this.db.prepare('SELECT value FROM meta WHERE key=?').get(key);
    return r ? r.value : null;
  }
  setMeta(key, value) {
    this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?,?)').run(key, value);
  }

  fmtDate(s) {
    return String(s || '').slice(0, 10);
  }

  /** 本地日期 YYYY-MM-DD */
  todayStr() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${dd}`;
  }

  addDays(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${dd}`;
  }

  // ===================== PRD_INSTOCK 同步 =====================

  /**
   * 从金蝶拉 PRD_INSTOCK 入库（按 FPRODUCEDATE 窗口，delete+insert 幂等）
   * 每次重拉 [cursor-2天, 今天]，首次拉全量(2024-01-01起)；避免重复/漏晚补单
   * @returns {Promise<{count: number, from: string, to: string}>}
   */
  async syncPrdInstock() {
    this.initialize();
    if (!this.client || !this.client.isConfigured()) {
      throw new Error('金蝶客户端未配置，无法同步 PRD_INSTOCK');
    }
    const to = this.todayStr();
    const cursor = this.getMeta('cursor') || null; // 上次同步到的日期
    // 回看 30 天：盒装成品(外包)入库单滞后条袋灌装 1~3 天才补录进金蝶，
    // 窗口太窄会把"生产日期早、当天才补录"的单子永久漏掉（游标只前进不回退）
    const from = cursor ? this.addDays(cursor, -30) : '2024-01-01';
    if (from > to) return { count: 0, from, to };

    // ⚠️ 顺序很重要：**先把数据拉到手里，确认没问题了再删旧数据**。
    // 以前是「先 DELETE 窗口、再拉取」，一旦金蝶返回异常（实测 2026-10-10 07:20
    // 返回了非数组、被当成"无数据"），31 天窗口就被清空且插不回来，
    // 灌装对比页的「成品折算」全变成 0。
    const filter = `FPRODUCEDATE >= '${from}' AND FPRODUCEDATE <= '${to}'`;
    // executeBillQueryAll 内部已处理登录并返回 2D 数组（不要再包 callWithAuth）
    const rawResult = await this.client.executeBillQueryAll('PRD_INSTOCK', {
      fieldKeys: PRD_FIELD_KEYS,
      filter,
      orderString: 'FPRODUCEDATE ASC',
    });

    const rows = [];
    for (const r of Array.isArray(rawResult) ? rawResult : []) {
      if (!Array.isArray(r) || r.length < PRD_FIELD_KEYS.length) continue;
      const qty = parseFloat(r[5]) || 0;
      if (qty <= 0) continue;
      rows.push(r);
    }

    // 安全阀：窗口里原本有数据、这次却一行都没拉到 → 判定上游异常，保留旧数据不覆盖
    const before = this.db
      .prepare('SELECT COUNT(*) c FROM prd_instock WHERE producedate BETWEEN ? AND ?')
      .get(from, to).c;
    if (rows.length === 0 && before > 0) {
      throw new Error(`金蝶返回 0 行，但窗口内原有 ${before} 行 → 判定为异常响应，已保留旧数据`);
    }

    // 拉取成功 → 删 + 插放在同一事务里，中途出错也不会留下半个窗口
    const tx = this.db.transaction((list) => {
      this.db.prepare('DELETE FROM prd_instock WHERE producedate BETWEEN ? AND ?').run(from, to);
      const ins = this.db.prepare(
        'INSERT INTO prd_instock (bill_no, mo_bill_no, material_code, material_name, producedate, qty) VALUES (?,?,?,?,?,?)',
      );
      for (const r of list) ins.run(r[0], r[1], r[2], r[3], this.fmtDate(r[4]), parseFloat(r[5]) || 0);
    });
    tx(rows);

    this.setMeta('cursor', to);
    console.log(`[fillbox] PRD_INSTOCK 同步完成: ${rows.length} 行 (${from} ~ ${to})`);
    return { count: rows.length, from, to };
  }

  // ===================== 盒条比（复用损耗 productData） =====================

  /** 从损耗库 mo_loss.data_json 重建 box_ratio（FP盒装 → MP条袋 + 比例） */
  rebuildRatio() {
    this.initialize();
    const lossDb = new Database(this.lossDbPath, { readonly: true });
    const rows = lossDb.prepare("SELECT data_json FROM mo_loss WHERE data_json IS NOT NULL AND data_json != ''").all();
    lossDb.close();
    // 键 = 成品订单 + 成品编码 + 条袋编码。
    // 不能只用 fp_code：同一个成品订单下，一个成品可能由多个条袋组成
    // （例：pp桶装50条 = 25条黑巧 MP020568 + 25条原味 MP020569），单键会互相覆盖、漏算一半。
    const map = new Map();
    for (const { data_json } of rows) {
      let raw;
      try { raw = JSON.parse(data_json); } catch { continue; }
      const list = Array.isArray(raw.productData) ? raw.productData : [];
      for (const p of list) {
        if (!p.productNo || !p.fnumber || !p.childNo) continue;
        const num = parseFloat(p.numerator);
        const den = parseFloat(p.denominator);
        if (!(num > 0) || !(den > 0)) continue;
        map.set(`${p.productNo}|${p.fnumber}|${p.childNo}`, {
          mo_bill_no: String(p.productNo), fp_code: p.fnumber, mp_code: p.childNo, num, den, ratio: num / den,
        });
      }
    }
    const items = [...map.values()];
    const tx = this.db.transaction((list) => {
      this.db.prepare('DELETE FROM box_ratio').run();
      const ins = this.db.prepare(
        'INSERT OR REPLACE INTO box_ratio (mo_bill_no, fp_code, mp_code, num, den, ratio) VALUES (?,?,?,?,?,?)',
      );
      for (const it of list) ins.run(it.mo_bill_no, it.fp_code, it.mp_code, it.num, it.den, it.ratio);
    });
    tx(items);
    const fpCount = new Set(items.map((i) => i.fp_code)).size;
    console.log(`[fillbox] 盒条比重建: ${items.length} 条（成品订单×成品×条袋），覆盖 ${fpCount} 个成品`);
    return items.length;
  }

  // ===================== 计算 =====================

  /**
   * 计算 灌装 vs 成品 对比行
   * @param {object} opts
   * @param {string} opts.startDate - YYYY-MM-DD
   * @param {string} opts.endDate
   * @param {string} [opts.dimension] - day(默认) | week | month | year
   * @returns {Array} [{ product, materialCode, periodKey, label, fillQty, boxQty, diff }]
   */
  getFillBox({ startDate, endDate, dimension = 'day' } = {}) {
    this.initialize();
    const e = endDate || this.todayStr();
    const s = startDate || this.addDays(e, -29); // 默认近 30 天，避免无日期时拉全史
    const rows = this.db.prepare(
      'SELECT mo_bill_no, material_code, material_name, producedate, qty FROM prd_instock WHERE producedate BETWEEN ? AND ?',
    ).all(s, e);

    // 盒条比读入内存：
    //   ratioByOrder：`成品订单|成品编码` → Map(条袋编码 → 比例)   ← 首选，精确到订单
    //   ratioByFp   ：成品编码 → Set(该成品在各订单里出现过的口径种类)，用于判断能否兜底
    //   ratioByFpOne：成品编码 → 唯一口径（仅当该成品口径唯一时才有意义）
    const ratioByOrder = new Map();
    const ratioByFp = new Map();
    const ratioByFpOne = new Map();
    for (const r of this.db.prepare('SELECT mo_bill_no, fp_code, mp_code, ratio FROM box_ratio').all()) {
      const k = `${r.mo_bill_no}|${r.fp_code}`;
      if (!ratioByOrder.has(k)) ratioByOrder.set(k, new Map());
      ratioByOrder.get(k).set(r.mp_code, r.ratio);
    }
    for (const [k, m] of ratioByOrder) {
      const fp = k.slice(k.indexOf('|') + 1);
      const sig = [...m.entries()].map(([mp, ratio]) => `${mp}=${ratio}`).sort().join(',');
      if (!ratioByFp.has(fp)) ratioByFp.set(fp, new Set());
      ratioByFp.get(fp).add(sig);
      if (!ratioByFpOne.has(fp)) ratioByFpOne.set(fp, m);
    }

    // MP 物料编码 → 产品名 / 产品名 → 物料编码（MES 只提供产品名，需归集到同一个 MP 键上）
    const nameToCode = new Map();
    const mpNames = new Map();
    for (const r of this.db.prepare(
      "SELECT DISTINCT material_code, material_name FROM prd_instock WHERE material_code LIKE 'MP%'",
    ).all()) {
      const n = String(r.material_name || '').trim();
      if (n && !nameToCode.has(n)) nameToCode.set(n, r.material_code);
      if (!mpNames.has(r.material_code)) mpNames.set(r.material_code, n);
    }

    // 2026-09-14 起：灌装数量改由 MES 提供（成品仍走原 PRD_INSTOCK × 盒条比）
    const mesFill = this.mesFill ? this.mesFill(s, e) : null;

    // 按 (code, date) 汇总
    const names = new Map(); // code -> 物料名
    const fillByDay = new Map(); // `${code}|${date}` -> qty
    const boxByDay = new Map(); // `${mp}|${date}` -> 折算 qty
    const bomSkipped = new Map(); // 无法判定条袋用量的成品编码 -> 行数
    for (const r of rows) {
      const code = r.material_code || '';
      const date = this.fmtDate(r.producedate);
      if (!code || !date) continue;
      if (!names.has(code)) names.set(code, r.material_name || '');
      if (code.startsWith('MP')) {
        if (date >= MES_START_DATE) continue; // 切换日起灌装不再取入库数据
        const key = `${code}|${date}`;
        fillByDay.set(key, (fillByDay.get(key) || 0) + (r.qty || 0));
      } else {
        // 成品 → 条袋：优先按「成品订单 + 成品编码」精确查；
        // 该订单不在损耗库时，若此成品在其它订单里口径唯一（都是同一组 条袋×比例）则兜底；
        // 否则无从判定 → 跳过并记账（宁缺勿错，别套一个别的订单的比例）
        let list = ratioByOrder.get(`${r.mo_bill_no}|${code}`);
        if (!list) {
          const sigs = ratioByFp.get(code);
          if (sigs && sigs.size === 1) list = ratioByFpOne.get(code);
        }
        if (!list) {
          bomSkipped.set(code, (bomSkipped.get(code) || 0) + 1);
          continue;
        }
        for (const [mp, ratio] of list) {
          if (!names.has(mp)) names.set(mp, mpNames.get(mp) || '');
          const key = `${mp}|${date}`;
          boxByDay.set(key, (boxByDay.get(key) || 0) + (r.qty || 0) * ratio);
        }
      }
    }
    if (bomSkipped.size > 0) {
      const n = [...bomSkipped.values()].reduce((a, b) => a + b, 0);
      console.warn(
        `[fillbox] ${n} 行成品入库查不到条袋用量（订单不在损耗库、且该成品口径不唯一），已跳过：${[...bomSkipped.keys()].slice(0, 6).join(', ')}`,
      );
    }

    // 灌装（MES）：按产品名映射回 MP 编码后累计
    if (mesFill && mesFill.size > 0) {
      let unmapped = 0;
      for (const [key, qty] of mesFill) {
        const idx = key.lastIndexOf('|');
        const name = key.slice(0, idx);
        const date = key.slice(idx + 1);
        if (!date || date < MES_START_DATE) continue;
        const code = nameToCode.get(name);
        if (!code) {
          unmapped++;
          continue;
        }
        if (!names.has(code)) names.set(code, name);
        const k = `${code}|${date}`;
        fillByDay.set(k, (fillByDay.get(k) || 0) + (qty || 0));
      }
      if (unmapped > 0) console.warn(`[fillbox] ${unmapped} 条 MES 灌装找不到对应 MP 物料编码，已跳过`);
    }

    // 时段键
    const periodOf = (date) => {
      if (dimension === 'month') return { key: date.slice(0, 7), label: date.slice(0, 7) };
      if (dimension === 'year') return { key: date.slice(0, 4), label: date.slice(0, 4) };
      if (dimension === 'week') {
        const dt = new Date(date + 'T00:00:00');
        const dow = dt.getUTCDay() || 7;
        const thu = new Date(dt);
        thu.setUTCDate(dt.getUTCDate() + 4 - dow);
        const y = thu.getUTCFullYear();
        const first = new Date(Date.UTC(y, 0, 1));
        const w = Math.ceil((((thu - first) / 86400000) + 1) / 7);
        return { key: `${y}-W${String(w).padStart(2, '0')}`, label: `${y}-W${String(w).padStart(2, '0')}` };
      }
      return { key: date, label: date };
    };

    // 组装：行 = (条袋 × 时段)，灌装与成品折算都按这个键归并。
    // 若某时段只有成品入库、没有灌装记录，也要落成一行（灌装 0 / 折算有值）——
    // 否则这笔折算会被静默丢掉，日维度的合计就与月/周维度对不上。
    // 实测：MP020569 2026-09 月维度 369,645、日维度只剩 310,970，差的正是 9/8 那笔 58,675
    // （9/8 有成品入库、当天没有该条袋的灌装记录）。2026-09-29 修。
    const agg = new Map(); // `${code}|${periodKey}` -> row
    const ensureRow = (code, p) => {
      const agKey = `${code}|${p.key}`;
      let r0 = agg.get(agKey);
      if (!r0) {
        r0 = {
          product: names.get(code) || mpNames.get(code) || '',
          materialCode: code,
          label: p.label,
          fillQty: 0,
          boxQty: 0,
        };
        agg.set(agKey, r0);
      }
      return r0;
    };
    for (const [key, qty] of fillByDay) {
      const [code, date] = key.split('|');
      ensureRow(code, periodOf(date)).fillQty += qty;
    }
    for (const [key, qty] of boxByDay) {
      const [code, date] = key.split('|');
      ensureRow(code, periodOf(date)).boxQty += qty;
    }

    const out = [...agg.values()].map((r) => {
      const fillQty = Math.round(r.fillQty * 100) / 100;
      const boxQty = Math.round(r.boxQty * 100) / 100;
      return {
        product: r.product,
        materialCode: r.materialCode,
        label: r.label,
        fillQty,
        boxQty,
        diff: Math.round((fillQty - boxQty) * 100) / 100,
      };
    });
    out.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : (a.product || '').localeCompare(b.product || '')));
    return out;
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

module.exports = FillBoxService;
