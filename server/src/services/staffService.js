/**
 * 人员模块：员工档案（岗位 / 技能等级）+ 剂型字典
 *
 * 两件事放一个库里（`data/staff.db`），因为都只服务人员模块：
 *
 *  1. `staff` —— 岗位/技能等级是**人工维护**的，源数据里没有。主键就是**姓名**：
 *     金蝶/MES 只给姓名，没有工号（`F_FD_Operator` 是文本字段）。
 *     ⚠️ 因此同名同姓的两个人会合并成一行，这是已知限制，页面上有提示。
 *
 *  2. `material_group` —— 剂型（固体/液体）。
 *     看板行里**没有物料编码**（金蝶只有内部 ID，MES 连 ID 都没有），只能拿**产品名**去反查
 *     BD_MATERIAL 的物料分组。实测看板出现过的 386 个产品名全部命中，只有 1 个重名。
 *
 *     ⚠️ 和批号（FLOT）同样的坑：裸字段 `FMATERIALGROUP` 返回的是**内部 ID**（100686/…），
 *        必须用点符号 `FMaterialGroup.FNumber` / `.FName` 才是可读的 `MP01/固体`。
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

const PAGE_SIZE = 200;
const MAX_PAGES = 60; // 1480 个 MP 物料 ≈ 8 页，留足余量

/** 钉钉入职时间是毫秒时间戳，按北京时间格式化成 YYYY-MM-DD */
function formatDate(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '';
  const d = new Date(n + 8 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

class StaffService {
  /**
   * @param {object} opts
   * @param {object} [opts.client] - 金蝶客户端（拉剂型字典用）
   * @param {string} [opts.dbPath]
   */
  constructor({ client, dbPath } = {}) {
    this.client = client || null;
    this.dbPath = dbPath || config.staff.dbPath;
    this.db = null;
  }

  initialize() {
    if (this.db) return this;
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS staff (
        operator    TEXT PRIMARY KEY,
        position    TEXT DEFAULT '',
        skill_level TEXT DEFAULT '',
        updated_at  TEXT
      );
      CREATE TABLE IF NOT EXISTS material_group (
        material_name TEXT PRIMARY KEY,
        material_code TEXT,
        group_code    TEXT,
        group_name    TEXT,
        ambiguous     INTEGER NOT NULL DEFAULT 0,
        updated_at    TEXT
      );
      -- 钉钉通讯录名单（只存名单页要用的字段，不存手机号）
      CREATE TABLE IF NOT EXISTS staff_directory (
        userid      TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        title       TEXT DEFAULT '',
        dept_names  TEXT DEFAULT '[]',
        scope       TEXT DEFAULT '',
        hired_date  INTEGER,
        synced_at   TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_staff_directory_name ON staff_directory(name);
    `);
    return this;
  }

  // ===================== 员工档案 =====================

  /** 全部档案，返回 Map<'姓名', {position, skillLevel}> */
  listStaff() {
    this.initialize();
    const m = new Map();
    for (const r of this.db.prepare('SELECT operator, position, skill_level FROM staff').all()) {
      m.set(r.operator, { position: r.position || '', skillLevel: r.skill_level || '' });
    }
    return m;
  }

  /**
   * 保存某人的岗位/技能等级。空字符串表示「清空该项」。
   * 用了 `production_notes` 那套 upsert（database.js:307-324）。
   */
  upsertStaff(operator, { position, skillLevel } = {}) {
    this.initialize();
    const name = String(operator || '').trim();
    if (!name) throw new Error('人员姓名不能为空');
    this.db.prepare(
      `INSERT INTO staff (operator, position, skill_level, updated_at)
       VALUES (?, ?, ?, datetime('now','localtime'))
       ON CONFLICT(operator) DO UPDATE SET
         position    = excluded.position,
         skill_level = excluded.skill_level,
         updated_at  = datetime('now','localtime')`,
    ).run(name, String(position || ''), String(skillLevel || ''));
    return { operator: name, position: String(position || ''), skillLevel: String(skillLevel || '') };
  }

  // ===================== 人员名单（钉钉通讯录） =====================

  countDirectory() {
    this.initialize();
    return this.db.prepare('SELECT COUNT(*) c FROM staff_directory').get().c;
  }

  /**
   * 全量替换名单。rows 为空时拒绝覆盖（防止权限异常把名单清空）。
   * 事务内先删后插，失败自动回滚，保留上一次数据。
   */
  replaceDirectory(rows) {
    this.initialize();
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('名单为空，拒绝覆盖');
    const tx = this.db.transaction((list) => {
      this.db.prepare('DELETE FROM staff_directory').run();
      const ins = this.db.prepare(
        `INSERT OR REPLACE INTO staff_directory
           (userid, name, title, dept_names, scope, hired_date, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))`,
      );
      for (const r of list) {
        ins.run(
          String(r.userid),
          String(r.name || ''),
          String(r.title || ''),
          JSON.stringify(Array.isArray(r.deptNames) ? r.deptNames : []),
          String(r.scope || ''),
          r.hiredDate == null ? null : Number(r.hiredDate),
        );
      }
    });
    tx(rows);
    return rows.length;
  }

  getDirectoryLastSyncAt() {
    this.initialize();
    const row = this.db.prepare('SELECT MAX(synced_at) at FROM staff_directory').get();
    return (row && row.at) || '';
  }

  /**
   * 名单 + 汇总。
   * 技能等级复用 staff.skill_level（按姓名关联），与「人员数据」页共用。
   */
  getRoster() {
    this.initialize();
    const meta = this.listStaff();
    const rows = this.db.prepare('SELECT * FROM staff_directory').all().map((r) => {
      let deptNames = [];
      try { deptNames = JSON.parse(r.dept_names || '[]'); } catch { deptNames = []; }
      const m = meta.get(r.name) || {};
      return {
        userid: r.userid,
        name: r.name,
        title: r.title || '',
        deptNames,
        scope: r.scope || '',
        hiredDate: formatDate(r.hired_date),
        skillLevel: m.skillLevel || '',
      };
    });

    const scopeOrder = { inner: 0, outer: 1, both: 2 };
    const titleKey = (t) => String(t || '￿'); // 岗位为空的排最后
    rows.sort((a, b) =>
      (scopeOrder[a.scope] ?? 9) - (scopeOrder[b.scope] ?? 9) ||
      titleKey(a.title).localeCompare(titleKey(b.title), 'zh') ||
      String(a.name || '').localeCompare(String(b.name || ''), 'zh'));

    const summary = {
      total: rows.length,
      inner: rows.filter((r) => r.scope === 'inner' || r.scope === 'both').length,
      outer: rows.filter((r) => r.scope === 'outer' || r.scope === 'both').length,
      both: rows.filter((r) => r.scope === 'both').length,
      withSkillLevel: rows.filter((r) => r.skillLevel).length,
      lastSyncAt: this.getDirectoryLastSyncAt(),
    };
    return { rows, summary };
  }

  /**
   * 只更新技能等级，**不碰岗位**。
   * 现有 upsertStaff 会同时写 position/skill_level，名单页只改技能等级时不能复用它。
   */
  upsertSkillLevel(operator, skillLevel) {
    this.initialize();
    const name = String(operator || '').trim();
    if (!name) throw new Error('人员姓名不能为空');
    this.db.prepare(
      `INSERT INTO staff (operator, position, skill_level, updated_at)
       VALUES (?, '', ?, datetime('now','localtime'))
       ON CONFLICT(operator) DO UPDATE SET
         skill_level = excluded.skill_level,
         updated_at  = excluded.updated_at`,
    ).run(name, String(skillLevel || ''));
    return { operator: name, skillLevel: String(skillLevel || '') };
  }

  // ===================== 剂型字典 =====================

  /** 产品名 → { groupCode, groupName, ambiguous } 的字典 */
  materialGroups() {
    this.initialize();
    const m = new Map();
    for (const r of this.db.prepare('SELECT material_name, group_code, group_name, ambiguous FROM material_group').all()) {
      m.set(r.material_name, {
        groupCode: r.group_code || '',
        groupName: r.group_name || '',
        ambiguous: !!r.ambiguous,
      });
    }
    return m;
  }

  countMaterialGroups() {
    this.initialize();
    return this.db.prepare('SELECT COUNT(*) c FROM material_group').get().c;
  }

  /**
   * 从金蝶 BD_MATERIAL 拉全部 MP* 物料的物料分组，重建字典。
   * 基础资料没有 FDate，必须自建分页 + skipDateFilter（executeBillQueryAll 会强制加日期条件）。
   * @returns {Promise<{count:number, ambiguous:number}>}
   */
  async refreshMaterialGroups() {
    if (!this.client || !this.client.isConfigured()) throw new Error('金蝶客户端未配置，无法刷新剂型字典');
    this.initialize();

    // 同名多物料时：分组一致就取那个分组；不一致标歧义（页面显示「歧义」而不是猜一个）
    const byName = new Map(); // name -> { code, groupCode, groupName, ambiguous }
    let raw = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await this.client.callWithAuth(() => this.client.executeBillQuery('BD_MATERIAL', {
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        fieldKeys: ['FNumber', 'FName', 'FMaterialGroup.FNumber', 'FMaterialGroup.FName'],
        filter: "FNumber LIKE 'MP%'",
        orderString: 'FNumber ASC',
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
        const code = String(r[0] || '').trim();
        const name = String(r[1] || '').trim();
        if (!code || !name) continue;
        raw++;
        const groupCode = String(r[2] || '').trim();
        const groupName = String(r[3] || '').trim();
        const hit = byName.get(name);
        if (!hit) {
          byName.set(name, { code, groupCode, groupName, ambiguous: false });
        } else if (hit.groupName !== groupName) {
          hit.ambiguous = true; // 同名但分组不一致 → 存疑，别猜
        }
      }
      if (rows.length < PAGE_SIZE) break;
      if (page === MAX_PAGES - 1) console.warn(`[staff] 剂型字典分页达到上限 ${MAX_PAGES} 页，可能被截断`);
    }

    const list = [...byName.entries()];
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM material_group').run();
      const ins = this.db.prepare(
        `INSERT OR REPLACE INTO material_group
           (material_name, material_code, group_code, group_name, ambiguous, updated_at)
         VALUES (?,?,?,?,?, datetime('now','localtime'))`,
      );
      for (const [name, v] of list) ins.run(name, v.code, v.groupCode, v.groupName, v.ambiguous ? 1 : 0);
    });
    tx();

    const ambiguous = list.filter(([, v]) => v.ambiguous).length;
    console.log(`[staff] 剂型字典刷新完成：金蝶 ${raw} 行 → ${list.length} 个产品名（歧义 ${ambiguous} 个）`);
    return { count: list.length, ambiguous };
  }

  /**
   * 保证字典可用：表为空时同步拉一次（首次部署用），否则不动。
   * 日常靠 index.js 的 cron 刷新。
   */
  async ensureMaterialGroups() {
    if (this.countMaterialGroups() > 0) return { skipped: true, count: this.countMaterialGroups() };
    const r = await this.refreshMaterialGroups();
    return { skipped: false, ...r };
  }

  close() {
    if (this.db) { this.db.close(); this.db = null; }
  }
}

module.exports = StaffService;
