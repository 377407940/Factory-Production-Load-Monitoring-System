/**
 * 人员看板：把生产看板的班次行按「人」重新聚合，并给出三维度下钻
 *
 * **不重新取数** —— 直接消费 `ProductionBoardService.getBoard({view:'shift'})` 的行，
 * 那里已经把 customer / machine / product / operator 都挂好了（客户那条链路要调金蝶，别重复解析）。
 *
 * ⚠️ 聚合口径必须和看板逐行一致（`productionBoardService.js:456-466` + `:499-501`），
 *    否则同一个人在不同页面上数字对不上：
 *      产量 / 不合格品数 / 目标 = 直接求和
 *      合格率 / OEE            = **按产量加权平均**（不是简单平均）
 *      达产率                  = Σ产量 ÷ Σ目标（不是各行比例的平均）
 *
 * ⚠️ 多人同行（如「叶炎飞、马令」）：**每个人都拿这一行的全额**（用户确认的口径）。
 *    好处是个人数字和他自己在生产看板看到的行对得上；
 *    代价是**全员产量之和 > 实际总产量**，所以这里同时算出两个数供页面对照。
 */
const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;

const UNKNOWN_CUSTOMER = '未匹配';
const UNKNOWN_MACHINE = '未知设备';
const UNKNOWN_DOSAGE = '未知';
const NONE_OPERATOR = '——';

/** 「叶炎飞、马令」→ ['叶炎飞','马令']。分隔符由 mesRecordMapper 的 names() 保证是顿号 */
function splitOps(text) {
  return String(text || '')
    .split(/[、\n]+/)
    .map((s) => s.trim())
    .filter((s) => s && s !== NONE_OPERATOR);
}

class StaffBoardService {
  /**
   * @param {object} deps
   * @param {import('./productionBoardService')} deps.boardService
   * @param {import('./staffService')} deps.staffService
   */
  constructor({ boardService, staffService }) {
    this.board = boardService;
    this.staff = staffService;
  }

  /**
   * 取该区间的班次行（已挂客户）
   */
  async _shiftRows({ startDate, endDate, dimension }) {
    const data = await this.board.getBoard({ startDate, endDate, view: 'shift', dimension });
    return data.rows || [];
  }

  /**
   * 一组行 → 指标。列表页和三个明细维度**共用这一个函数**（口径只有一处，不会漂移）。
   */
  aggregateGroup(rows) {
    let targetQty = 0;
    let actualQty = 0;
    let defectQty = 0;
    let hours = 0;
    let oesW = 0;
    let oeeW = 0;
    let qualW = 0;
    let wD = 0;
    const dates = new Set();
    const machines = new Set();
    const products = new Set();
    const mos = new Set();
    for (const r of rows) {
      targetQty += r.targetQty || 0;
      actualQty += r.actualQty || 0;
      defectQty += r.defectQty || 0;
      // 工时取**正式工工时**（`F_FD_IMPORTTIMES`）。
      // 派遣工工时（`F_YJY_PQWORKERTIME`）不计入 —— 报工里的「操作人员」是正式工，
      // 派遣工是另一拨人、不在这张表的姓名维度里。
      hours += r.regularHours || 0;
      if (r.fdate) dates.add(r.fdate);
      if (r.machine) machines.add(r.machine);
      if (r.product) products.add(r.product);
      if (r.moNumber) mos.add(r.moNumber);
      const aq = r.actualQty || 0;
      if (aq > 0) {
        oesW += (r.oes || 0) * aq;
        oeeW += (r.oee || 0) * aq;
        qualW += (r.qualifyRate || 0) * aq;
        wD += aq;
      }
    }
    return {
      targetQty: round2(targetQty),
      actualQty: round2(actualQty),
      defectQty: round2(defectQty),
      hours: round1(hours), // 工时（正式工 + 派遣工）
      oes: wD > 0 && oesW > 0 ? round1(oesW / wD) : null,
      oee: wD > 0 && oeeW > 0 ? round1(oeeW / wD) : null,
      qualifyRate: wD > 0 && qualW > 0 ? round1(qualW / wD) : null,
      // 达产率 = Σ实际 ÷ Σ目标 —— 不是各行比例的平均
      rate: targetQty > 0 ? round1((actualQty / targetQty) * 100) : null,
      rowCount: rows.length,
      dayCount: dates.size,
      machineCount: machines.size,
      productCount: products.size,
      moCount: mos.size,
    };
  }

  /** 行 → 分组键 → 行数组。`keyOf` 返回空字符串时归到 `fallback` */
  _bucketBy(rows, keyOf, fallback) {
    const m = new Map();
    for (const r of rows) {
      const k = keyOf(r) || fallback;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return m;
  }

  /**
   * 人员列表
   * @returns {Promise<{rows: Array, summary: object, startDate: string, endDate: string}>}
   */
  async getStaffBoard({ startDate, endDate, dimension = 'day' } = {}) {
    const rows = await this._shiftRows({ startDate, endDate, dimension });
    const meta = this.staff.listStaff();

    // 人 → 该人的行（多人行会同时进多个人的桶里）
    const byPerson = new Map();
    let rowsWithoutOperator = 0;
    for (const r of rows) {
      const ops = splitOps(r.operator);
      if (ops.length === 0) { rowsWithoutOperator++; continue; }
      for (const op of ops) {
        if (!byPerson.has(op)) byPerson.set(op, []);
        byPerson.get(op).push(r);
      }
    }

    const list = [];
    for (const [operator, rs] of byPerson) {
      const agg = this.aggregateGroup(rs);
      const m = meta.get(operator) || {};
      list.push({ operator, position: m.position || '', skillLevel: m.skillLevel || '', ...agg });
    }
    list.sort((a, b) => b.actualQty - a.actualQty);

    // 三笔账要分清，否则「人员之和 vs 总产量」对不上时没法判断是 bug 还是口径：
    //   总产量 = 有操作工的行 + 没填操作工的行
    //   人员之和 = 有操作工的行 + 多人同行被重复计的部分
    const overall = this.aggregateGroup(rows);
    const attributed = rows.filter((r) => splitOps(r.operator).length > 0);
    const attrAgg = this.aggregateGroup(attributed);
    const personalQty = round2(list.reduce((s, r) => s + r.actualQty, 0));
    const summary = {
      staffCount: list.length,
      rowCount: rows.length,
      // 没填操作工的报工 —— 进不了任何人名下，是上游数据质量问题，页面要提示
      unattributedRows: rowsWithoutOperator,
      attributedRows: attributed.length,
      // 产量三本账
      totalActualQty: overall.actualQty, // 全部报工（每行一次）
      attributedQty: attrAgg.actualQty, // 有操作工的行（每行一次）
      unattributedQty: round2(overall.actualQty - attrAgg.actualQty),
      personalQtySum: personalQty, // 人员之和（多人行重复计）
      doubleCountedQty: round2(personalQty - attrAgg.actualQty), // 多人同行重复计的部分
      // 整体指标（按全部报工算，和看板一致）
      totalDefectQty: overall.defectQty,
      totalTargetQty: overall.targetQty,
      avgRate: overall.rate,
      avgOee: overall.oee,
      avgQualifyRate: overall.qualifyRate,
    };
    return { rows: list, summary, startDate, endDate, dimension };
  }

  /**
   * 某人明细：总额 + 客户 / 设备 / 剂型 三个维度
   */
  async getStaffDetail(operator, { startDate, endDate, dimension = 'day' } = {}) {
    const name = String(operator || '').trim();
    const all = await this._shiftRows({ startDate, endDate, dimension });
    const mine = all.filter((r) => splitOps(r.operator).includes(name));

    const meta = this.staff.listStaff().get(name) || {};
    const dict = this.staff.materialGroups();

    const dosageOf = (product) => {
      const hit = dict.get(product);
      if (!hit) return UNKNOWN_DOSAGE;
      if (hit.ambiguous) return `${hit.groupName || UNKNOWN_DOSAGE}（歧义）`;
      return hit.groupName || UNKNOWN_DOSAGE;
    };

    const toList = (map) =>
      [...map.entries()]
        .map(([key, rs]) => ({ key, ...this.aggregateGroup(rs) }))
        .sort((a, b) => b.actualQty - a.actualQty);

    return {
      operator: name,
      position: meta.position || '',
      skillLevel: meta.skillLevel || '',
      startDate,
      endDate,
      dimension,
      total: this.aggregateGroup(mine),
      byCustomer: toList(this._bucketBy(mine, (r) => r.customer, UNKNOWN_CUSTOMER)),
      byMachine: toList(this._bucketBy(mine, (r) => r.machine, UNKNOWN_MACHINE)),
      byDosage: toList(this._bucketBy(mine, (r) => dosageOf(r.product), UNKNOWN_DOSAGE)),
    };
  }
}

module.exports = StaffBoardService;
