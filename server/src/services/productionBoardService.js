/**
 * 生产执行看板服务
 *
 * 数据源：
 *   1. 本地 SQLite records 表（每小时金蝶 SFC_OperationReport 同步），
 *      fields_json 已含全部字段（车间/设备/机手已解析为名称、班次已映射、数值已 parseFloat）
 *   2. 额外金蝶查询（按需 + 内存缓存，行量小）：
 *      - PRD_MO        → 订单计划量 FQty（项目完成率分母）
 *      - SAL_SaleOrder → 销售订单编号 → 客户名称（FCUSTID.FName 点符号内联）
 *   3. 本地 production_notes 表（未达产原因 / 后续补产方案，看板内手工录入）
 *
 * 指标定义：
 *   达产率     = 本班实际 ÷ 本班目标
 *   累计产量   = 该生产订单自开工累计实际产量（跨天累加，截至本行日期）
 *   即时达产率 = 累计实际 ÷ 累计目标
 *   项目完成率 = 累计产量 ÷ PRD_MO.FQty 订单计划量
 *
 * 行唯一 key：fdate|moNumber|shift|machine|operator（与 production_notes 表一致）
 */
const PLAN_CACHE_TTL_MS = 10 * 60 * 1000;
const CUSTOMER_CACHE_TTL_MS = 30 * 60 * 1000;
const IN_BATCH = 200;

function num(v) {
  return typeof v === 'number' ? v : parseFloat(v) || 0;
}

/** 工时噪声过滤：≤0.1 视为 0（金蝶对无工时的班次会落 0.01/0.1 占位值） */
function cleanHours(v) {
  return v == null ? 0 : (v <= 0.1 ? 0 : v);
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

function uniq(arr) {
  return [...new Set(arr)];
}

/**
 * 解析配料&混料人员文本（F_FD_TXTWORKERS）：
 * 常见分隔符 中文逗号/空格/英文点/中文点/顿号 等；少数无分隔符拼接的中文名按 3 字优先切分
 */
function splitWorkers(text) {
  if (!text) return [];
  const out = [];
  const parts = String(text).split(/[，,、/;；\s.．。]+/).map((s) => s.trim()).filter(Boolean);
  for (const p of parts) {
    if (p.length >= 5) {
      // 拼接的中文名（如 束叶军茅嘉文 → 束叶军 / 茅嘉文）
      let rest = p;
      while (rest.length >= 5) {
        out.push(rest.slice(0, 3));
        rest = rest.slice(3);
      }
      if (rest.length >= 2) out.push(rest);
      else if (rest.length === 1 && out.length) out[out.length - 1] += rest;
    } else {
      out.push(p);
    }
  }
  return out;
}

/** 时段键：day→YYYY-MM-DD；week→ISO 周键 YYYY-Www；month→YYYY-MM */
function periodKeyOf(date, aggLevel) {
  if (aggLevel === 'day') return date;
  const dt = new Date(date);
  if (aggLevel === 'month') return date.slice(0, 7);
  if (aggLevel === 'week') {
    const d = new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }
  return date;
}

/** 时段起点日期（日维度的"生产日期"列展示/排序）：day→当日；week→周一；month→当月1号 */
function periodStartDate(date, aggLevel) {
  if (aggLevel === 'day') return date;
  const dt = new Date(date);
  if (aggLevel === 'month') return date.slice(0, 7) + '-01';
  if (aggLevel === 'week') {
    const d = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    const dayNum = d.getDay() || 7; // 周日=7
    d.setDate(d.getDate() - dayNum + 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }
  return date;
}

/** 时段结束日期（配合 periodStartDate 展示 起~止）：week→周日；month→当月最后一天 */
function periodEndDate(date, aggLevel) {
  if (aggLevel === 'day') return date;
  const dt = new Date(date);
  if (aggLevel === 'month') {
    const lastDay = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
    return date.slice(0, 7) + '-' + String(lastDay).padStart(2, '0');
  }
  if (aggLevel === 'week') {
    const d = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    d.setDate(d.getDate() + 6); // 周一 + 6 = 周日
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }
  return date;
}

function noteKey(r) {
  return [r.fdate, r.moNumber, r.shift || '', r.machine || '', r.operator || ''].join('|');
}

/** 解析 executeBillQueryAll 的 2D 数组 → 对象数组（自动跳过表头行） */
function parse2d(rawResult, cols) {
  const out = [];
  if (!Array.isArray(rawResult)) return out;
  let dataStart = 0;
  if (rawResult[0] && Array.isArray(rawResult[0])) {
    const hasHeader = rawResult[0].some((h) => typeof h === 'string' && /^F[A-Z]/.test(h));
    if (hasHeader) dataStart = 1;
  }
  for (let i = dataStart; i < rawResult.length; i++) {
    const row = rawResult[i];
    if (!Array.isArray(row)) continue;
    const obj = {};
    for (let c = 0; c < cols.length; c++) obj[cols[c]] = row[c];
    out.push(obj);
  }
  return out;
}

/** 单条 SFC 记录 → 看板行（18 列的前 12 列 + 空的计算/录入位） */
function buildRows(records, planMap = new Map()) {
  const rows = [];
  const planAssigned = new Set(); // mo|date|shift|machine|operator：已分配排产单目标（避免重复报工合并时双倍）
  for (const r of records) {
    const f = r.fields || {};
    const process = (f.F_FD_OperDescp || '').trim();
    // 看板只展示 固体灌装/液体灌装（配料&混料等其余工序仅入库，用于匹配工时）
    if (process !== '固体灌装' && process !== '液体灌装') continue;
    const actualQty = num(f.FQuaQty);
    // 不合格条袋数量：MES 段把不良数放在 _mes.defectQty（它自己的 FReworkQty 恒为 0）；
    // 金蝶段没有 _mes，不良数存在 FReworkQty 里 —— 实测与 F_FD_OkRates 自洽：
    // 合格率 = FQuaQty ÷ (FQuaQty + 不合格)，如 224600/(224600+2250)=99.01% ↔ OkRates 99.01。
    const defectQty = f._mes ? (Number(f._mes.defectQty) || 0) : num(f.FReworkQty);
    const moNumber = (f.FMoNumber || '').trim();
    const operator = (f.F_FD_Operator && f.F_FD_Operator !== '0' && f.F_FD_Operator !== '')
      ? String(f.F_FD_Operator) : '——';

    // 生产日期取 F_UNW_Date2（实际生产日期，晚班跨天时与报工日期 FDate 不同）；空则回退 FDate
    const prodDate = (f.F_UNW_Date2 || '').trim().slice(0, 10) || r.date
    // 本班目标产量：优先取排产单 UNW_yjyProductPlanBill.FAIMQTY×10000（万条→条）
    // 匹配键 = (mo, F_UNW_Date2, F_UNW_WorkType2) ↔ (FMOBILL, FDATE, FCLASS)；未命中保持 F_FD_AimProducts
    const wt = (f.F_UNW_WorkType2 || '').trim();
    const planKey = wt ? `${moNumber}|${prodDate}|${wt}` : '';
    const planQty = planKey ? (planMap.get(planKey) || 0) : 0;
    const groupKey = `${planKey}|${r.machine || ''}|${operator}`;
    let targetQty = num(f.F_FD_AimProducts);
    if (planQty > 0 && !planAssigned.has(groupKey)) {
      targetQty = planQty * 10000;
      planAssigned.add(groupKey);
    } else if (planQty > 0) {
      targetQty = 0; // 同组重复报工：目标已计一次
    }
    // 只保留有生产订单、且本班有目标或产量的记录（0 产出的未达产班次也要保留）
    if (!moNumber || (targetQty <= 0 && actualQty <= 0)) continue;

    rows.push({
      fdate: prodDate,
      product: (f.FMaterialName || '').trim(),
      moNumber,
      salesOrderNo: (f.F_FD_SALEORDERNUMBER || '').trim(),
      workshop: r.workshop || '',
      machine: r.machine || '',
      shift: r.shift || '',
      process,
      targetQty,
      actualQty,
      defectQty,
      // 工时：正式工 = 灌装 F_FD_IMPORTTIMES + 配料&混料 F_FD_WorkTimes；派遣工 = F_YJY_PQWORKERTIME（配料&混料部分由 attachMixTimes 追加）
      regularHours: cleanHours(num(f.F_FD_IMPORTTIMES)),
      tempHours: cleanHours(num(f.F_YJY_PQWORKERTIME)),
      oee: num(f.F_YJY_OEE),
      oes: num(f.F_FD_OEE),
      qualifyRate: num(f.F_FD_OkRates),
      operator,
      // 计算列（后续填充）
      rate: null,
      cumQty: 0,
      cumTarget: 0,
      instantRate: null,
      projectRate: null,
      // 客户/未达产原因/补产方案：来自 ERP（SFC_OperationReport），手工笔记（production_notes）可覆盖
      customer: '',
      reason: (f.F_UNW_REASON || '').trim(),
      recoveryPlan: (f.F_UNW_SOLUTION || '').trim(),
    });
  }
  return rows;
}

/**
 * 匹配配料&混料：按 (生产日期, 班次, 产品名称) 将配料&混料的工时加到对应灌装行
 * 正式工 += 配料&混料 F_FD_WorkTimes；派遣工 += 配料&混料 F_YJY_PQWORKERTIME
 * 同时把该组的配料&混料操作人员挂到灌装行（日维度「配料人员」列用）
 */
function attachMixTimes(rows, records) {
  const groups = new Map(); // key: fdate|shift|product → { regular, temp, operators }
  for (const r of records) {
    const f = r.fields || {};
    if ((f.F_FD_OperDescp || '').trim() !== '配料&混料') continue;
    // 与灌装行一致：按 F_UNW_Date2（实际生产日期）匹配
    const mixDate = (f.F_UNW_Date2 || '').trim().slice(0, 10) || r.date
    const key = [mixDate, r.shift || '', (f.FMaterialName || '').trim()].join('|');
    const g = groups.get(key) || { regular: 0, temp: 0, operators: new Set() };
    g.regular += cleanHours(num(f.F_FD_WorkTimes));
    g.temp += cleanHours(num(f.F_YJY_PQWORKERTIME));
    // 配料&混料操作人员：F_FD_TXTWORKERS（文本，可多人，分隔符/拼接不一）
    for (const w of splitWorkers(f.F_FD_TXTWORKERS)) g.operators.add(w);
    groups.set(key, g);
  }
  // 按 设备数量 平均分配：同一 (日期,班次,产品) 有 N 台设备，每台分 1/N（单台独占）；多报工行均分该台份额
  const rowGroups = new Map(); // key: fdate|shift|product → 灌装行
  for (const row of rows) {
    const key = [row.fdate, row.shift || '', row.product].join('|');
    if (!rowGroups.has(key)) rowGroups.set(key, []);
    rowGroups.get(key).push(row);
  }
  for (const [key, list] of rowGroups) {
    const g = groups.get(key);
    if (!g) continue;
    // 配料&混料操作人员：同 (日期,班次,产品) 的灌装行挂同一组
    if (g.operators.size > 0) {
      const ops = [...g.operators];
      for (const row of list) row.mixingOperators = ops;
    }
    const byMachine = new Map();
    for (const row of list) {
      const m = row.machine || '';
      if (!byMachine.has(m)) byMachine.set(m, []);
      byMachine.get(m).push(row);
    }
    const machineCount = byMachine.size;
    if (machineCount === 0) continue;
    for (const [, mrows] of byMachine) {
      const share = mrows.length > 0 ? 1 / machineCount / mrows.length : 0; // 每台 1/N，再均分给该台各报工行
      for (const row of mrows) {
        row.regularHours += g.regular * share;
        row.tempHours += g.temp * share;
      }
    }
  }
}

/**
 * 按 FMoNumber 分组、按日期升序累加：达产率 / 累计产量 / 即时达产率
 * 班次口径：同 (日期,班次) 的多台设备，累计实际 = Σ设备实际；累计目标 = 班次目标只计一次；
 * 该班次所有行共用同一累计值 → 即时达产率/项目完成率一致
 */
function attachCumulative(rows) {
  const byMo = new Map();
  for (const row of rows) {
    if (!byMo.has(row.moNumber)) byMo.set(row.moNumber, []);
    byMo.get(row.moNumber).push(row);
  }
  for (const list of byMo.values()) {
    // 按日期升序，同日期内 白班 → 晚班（时间先后）
    const shiftOrder = (s) => (s === '白班' ? 0 : s === '晚班' ? 1 : 2)
    list.sort((a, b) => {
      if (a.fdate !== b.fdate) return a.fdate < b.fdate ? -1 : 1
      return shiftOrder(a.shift || '') - shiftOrder(b.shift || '')
    });
    let cumQty = 0;
    let cumTarget = 0;
    let i = 0;
    while (i < list.length) {
      const date = list[i].fdate;
      let j = i;
      while (j < list.length && list[j].fdate === date) j++;
      // 同日期内按班次分组
      const dayRows = list.slice(i, j);
      const shiftMap = new Map();
      for (const row of dayRows) {
        const s = row.shift || '';
        if (!shiftMap.has(s)) shiftMap.set(s, []);
        shiftMap.get(s).push(row);
      }
      for (const [, srows] of shiftMap) {
        const shiftActual = srows.reduce((s, r) => s + (r.actualQty || 0), 0);
        const targetSet = new Set(srows.map((r) => r.targetQty).filter((t) => t > 0));
        const tList = [...targetSet];
        const shiftTarget = tList.length === 1 ? tList[0] : tList.reduce((s, t) => s + t, 0);
        cumQty += shiftActual;
        cumTarget += shiftTarget;
        for (const row of srows) {
          row.cumQty = cumQty;
          row.cumTarget = cumTarget;
          row.rate = row.targetQty > 0 ? round1((row.actualQty / row.targetQty) * 100) : null;
          row.instantRate = cumTarget > 0 ? round1((cumQty / cumTarget) * 100) : null;
        }
      }
      i = j;
    }
  }
}

class ProductionBoardService {
  /**
   * @param {object} deps
   * @param {import('./database')} deps.db
   * @param {import('./kingdeeService')} [deps.client]
   * @param {import('./powerSyncService')} [deps.powerService] 电表服务（日维度用电量分摊用）
   */
  constructor({ db, client, powerService, getAllRecords }) {
    this.db = db;
    this.client = client || null;
    this.powerService = powerService || null;
    // 记录来源：默认只读本库；注入后可用「金蝶 + MES」合并的完整记录集
    this._getAllRecords = typeof getAllRecords === 'function' ? getAllRecords : null;
    this._planCache = new Map();       // moNumber -> FQty
    this._planCacheTime = 0;
    this._customerCache = new Map();   // salesOrderNo -> customerName
    this._customerCacheTime = 0;
    this._moSoCache = new Map();       // moNumber -> salesOrderNo（MES 记录没有销售订单号，需回查金蝶 PRD_MO）
    this._moSoCacheTime = 0;
    this._planBillCache = new Map();   // key: mo|date|shift -> FAIMQTY（万条），来自 UNW_yjyProductPlanBill
    this._planBillMos = new Set();     // 已缓存的排产单 MO
    this._planBillCacheTime = 0;
  }

  /**
   * 生产执行看板主入口
   * @param {{ startDate?: string, endDate?: string, view?: 'shift'|'day', dimension?: string }} opts
   *   view=shift 返回班次维度行（白/晚班各一行）；view=day 返回日维度聚合行（白晚班按产品×时段合并）
   */
  async getBoard({ startDate, endDate, view = 'shift', dimension = 'day' } = {}) {
    const all = this._getAllRecords ? this._getAllRecords() : this.db.getAllRecords();
    // 排产单目标计划缓存（UNW_yjyProductPlanBill）
    const moNumbers = uniq(all.map((r) => ((r.fields || {}).FMoNumber || '').trim()).filter(Boolean));
    await this._ensurePlanBillCache(moNumbers);
    let rows = buildRows(all, this._planBillCache);

    attachMixTimes(rows, all);
    attachCumulative(rows);
    await this._attachProjectRate(rows);
    await this._attachCustomer(rows);
    this._attachNotes(rows);

    if (startDate && endDate) {
      rows = rows.filter((r) => r.fdate >= startDate && r.fdate <= endDate);
    }

    // 筛选下拉选项始终用班次行计算（日维度聚合行是多值 \n 拼接，不适合直接取值）
    const filterOptions = {
      workshops: uniq(rows.map((r) => r.workshop).filter(Boolean)).sort(),
      machines: uniq(rows.map((r) => r.machine).filter(Boolean)).sort(),
      operators: uniq(rows.map((r) => r.operator).filter((o) => o && o !== '——')).sort(),
    };

    // 日维度：按（产品 × 时段）聚合白班+晚班；aggLevel 由 dimension 决定（year 按 month）
    // dayRows = 日粒度明细（趋势图每日 X 轴用）；rows = 按时段聚合后的表行
    if (view === 'day') {
      const shiftRows = rows;
      const dayRows = this._aggregateDayRows(shiftRows, 'day');
      const level = dimension === 'year' ? 'month' : dimension;
      rows = level === 'day' ? dayRows : this._aggregateDayRows(shiftRows, level);
      // 电表用电量：车间电量按该车间各产品实际产量占比分摊，跨车间求和
      // 表行按时段（day/week/month）；dayRows 按日粒度（趋势图电量图用），周/月时需单独挂日级电量
      const powerShare = this._computePowerShareByProduct(shiftRows, level, startDate, endDate);
      const powerShareDay = level !== 'day'
        ? this._computePowerShareByProduct(shiftRows, 'day', startDate, endDate)
        : powerShare;
      for (const r of rows) {
        const pk = periodKeyOf(r.fdate, level);
        r.powerKwh = powerShare.get(`${r.product || ''}|${pk}`) || 0;
      }
      if (level !== 'day') {
        for (const r of dayRows) {
          const pk = periodKeyOf(r.fdate, 'day');
          r.powerKwh = powerShareDay.get(`${r.product || ''}|${pk}`) || 0;
        }
      }
      return { rows, dayRows, filterOptions };
    }

    // 班次维度排序：日期升序 → 同日期按产品分组 → 同产品按班次（白班在晚班前）
    const shiftOrder = (s) => (s === '白班' ? 0 : s === '晚班' ? 1 : 2)
    rows.sort((a, b) => {
      if (a.fdate !== b.fdate) return a.fdate < b.fdate ? -1 : 1
      if (a.product !== b.product) return (a.product || '') < (b.product || '') ? -1 : 1
      return shiftOrder(a.shift || '') - shiftOrder(b.shift || '')
    });

    return { rows, filterOptions };
  }

  /**
   * 日维度聚合：把白班+晚班（及周/月的多天）按「产品 × 时段」合并为一行
   * 多值字段（设备/人员/车间/订单号/销售单/客户）换行拼接；产量/工时求和；
   * 达产率=Σ实际/Σ目标；累计产量=本时段实际合计；OES/OEE/合格率按实际产量加权平均；
   * 未达产原因/补产方案去重后换行合并；projectRate = 本时段实际/最新日期对应订单的计划量
   * @param {Array} rows - 已 attach（含 customer/reason）的班次行
   * @param {string} aggLevel - 'day' | 'week' | 'month' | 'year'（year 按 month）
   * @returns {Array} 日维度合并行
   */
  _aggregateDayRows(rows, aggLevel = 'day') {
    const level = aggLevel === 'year' ? 'month' : aggLevel;
    // 各订单号最新生产日期（多订单号时按"最新日期对应的订单"算项目完成率：
    // 之前的订单完成后才进入下一个，最新日期/单号的订单是当前在生产的）
    const moLastDate = new Map();
    for (const r of rows) {
      if (!r.moNumber || !r.fdate) continue;
      const prev = moLastDate.get(r.moNumber) || '';
      if (r.fdate > prev) moLastDate.set(r.moNumber, r.fdate);
    }
    const groups = new Map(); // key: product|periodKey -> { list, periodStart }
    const order = [];
    for (const r of rows) {
      const pk = periodKeyOf(r.fdate, level);
      const key = `${r.product || ''}|${pk}`;
      if (!groups.has(key)) {
        groups.set(key, { list: [], periodStart: periodStartDate(r.fdate, level) });
        order.push(key);
      }
      groups.get(key).list.push(r);
    }
    const out = [];
    for (const key of order) {
      const g = groups.get(key);
      const machines = new Set(), operators = new Set(), mixOps = new Set(), workshops = new Set(), mos = new Set(), sos = new Set(), customers = new Set();
      const reasons = new Set(), plans = new Set();
      let targetQty = 0, actualQty = 0, defectQty = 0, regularHours = 0, tempHours = 0;
      let oesW = 0, oeeW = 0, qualW = 0, wD = 0;
      const keys = []; // 组成班次行的 note key（fdate|mo|shift|machine|operator）
      for (const r of g.list) {
        if (r.machine) machines.add(r.machine);
        if (r.operator && r.operator !== '——') operators.add(r.operator);
        if (r.mixingOperators) for (const op of r.mixingOperators) mixOps.add(op);
        if (r.workshop) workshops.add(r.workshop);
        if (r.moNumber) mos.add(r.moNumber);
        if (r.salesOrderNo) sos.add(r.salesOrderNo);
        if (r.customer) customers.add(r.customer);
        if (r.reason) reasons.add(r.reason);
        if (r.recoveryPlan) plans.add(r.recoveryPlan);
        targetQty += r.targetQty || 0;
        actualQty += r.actualQty || 0;
        defectQty += r.defectQty || 0;
        regularHours += r.regularHours || 0;
        tempHours += r.tempHours || 0;
        keys.push([r.fdate, r.moNumber, r.shift || '', r.machine || '', r.operator || '']);
        const aq = r.actualQty || 0;
        if (aq > 0) {
          oesW += (r.oes || 0) * aq;
          oeeW += (r.oee || 0) * aq;
          qualW += (r.qualifyRate || 0) * aq;
          wD += aq;
        }
      }
      const hours = regularHours + tempHours;
      // 项目完成率：取"最新日期对应的订单号"（生产日期最新；同日期取单号最大），用其计划量
      let latestMo = '';
      for (const mo of mos) {
        if (!latestMo) { latestMo = mo; continue; }
        const d1 = moLastDate.get(mo) || '';
        const d2 = moLastDate.get(latestMo) || '';
        if (d1 > d2 || (d1 === d2 && mo > latestMo)) latestMo = mo;
      }
      const moPlan = latestMo ? (this._planCache.get(latestMo) || 0) : 0;
      const rateVal = targetQty > 0 ? round1((actualQty / targetQty) * 100) : null;
      // 生产日期展示：day=当日；week/month=起~止（MM-DD ~ MM-DD）
      const dateRange = level === 'day'
        ? g.periodStart
        : `${g.periodStart.slice(5)} ~ ${periodEndDate(g.periodStart, level).slice(5)}`;
      out.push({
        fdate: g.periodStart,
        dateRange,
        product: (g.list[0] && g.list[0].product) || '',
        moNumber: [...mos].join('\n'),
        salesOrderNo: [...sos].join('\n'),
        workshop: [...workshops].join('\n'),
        machine: [...machines].join('\n'),
        shift: '',
        process: '',
        targetQty,
        actualQty,
        defectQty,
        regularHours,
        tempHours,
        hourlyRate: hours > 0 ? round1(actualQty / hours) : null,
        oes: wD > 0 && oesW > 0 ? round1(oesW / wD) : null,
        oee: wD > 0 && oeeW > 0 ? round1(oeeW / wD) : null,
        qualifyRate: wD > 0 && qualW > 0 ? round1(qualW / wD) : null,
        operator: [...operators].join('\n'),
        mixingOperators: [...mixOps].join('\n'),
        rate: rateVal,
        cumQty: actualQty,
        cumTarget: targetQty,
        instantRate: rateVal,
        projectRate: moPlan > 0 ? round1((actualQty / moPlan) * 100) : null,
        customer: [...customers].join('\n'),
        reason: [...reasons].join('\n'),
        recoveryPlan: [...plans].join('\n'),
        _keys: keys,
      });
    }
    // 排序：时段升序 → 同时段按产品
    out.sort((a, b) => {
      if (a.fdate !== b.fdate) return a.fdate < b.fdate ? -1 : 1;
      const ap = a.product || '', bp = b.product || '';
      return ap < bp ? -1 : ap > bp ? 1 : 0;
    });
    return out;
  }

  /**
   * 电表用电量按产量占比分摊到产品：
   *   某产品(时段)电量 = Σ各涉及车间[ 该车间时段电量 × 该产品在该车间产量 ÷ 该车间时段总产量 ]
   * 周/月：电量和产量都先按时段汇总再分摊；无电表车间电量记 0。
   * @param {Array} shiftRows - 已 attach 的班次行（含 workshop/actualQty/product/fdate）
   * @param {string} level - 'day' | 'week' | 'month'
   * @param {string} [startDate] - 日期范围起始 YYYY-MM-DD
   * @param {string} [endDate] - 日期范围结束 YYYY-MM-DD
   * @returns {Map<string, number>} key: `product|periodKey` → kWh
   */
  _computePowerShareByProduct(shiftRows, level, startDate, endDate) {
    const result = new Map();
    if (!this.powerService || !this.powerService.isAvailable()) return result;

    // 1) 车间×时段 总产量（所有产品灌装实际产量）
    const wsTotal = new Map(); // workshop|periodKey -> output
    // 2) 产品×车间×时段 产量
    const prodData = new Map(); // product|periodKey -> { periodKey, workshops: Map<ws, output> }
    for (const r of shiftRows) {
      if (!r.workshop || !r.fdate) continue;
      const pk = periodKeyOf(r.fdate, level);
      const wsKey = `${r.workshop}|${pk}`;
      wsTotal.set(wsKey, (wsTotal.get(wsKey) || 0) + (r.actualQty || 0));
      const ppk = `${r.product || ''}|${pk}`;
      let pd = prodData.get(ppk);
      if (!pd) { pd = { periodKey: pk, workshops: new Map() }; prodData.set(ppk, pd); }
      pd.workshops.set(r.workshop, (pd.workshops.get(r.workshop) || 0) + (r.actualQty || 0));
    }

    // 3) 车间×时段 电量（每日电量按时段求和）
    const wsPower = new Map(); // workshop|periodKey -> kWh
    const dailyPower = this.powerService.getDailyWorkshopPowerMap(startDate, endDate);
    for (const [ws, dateMap] of dailyPower) {
      for (const [date, kwh] of dateMap) {
        const pk = periodKeyOf(date, level);
        const key = `${ws}|${pk}`;
        wsPower.set(key, (wsPower.get(key) || 0) + kwh);
      }
    }

    // 4) 分摊求和：车间电量 × 该产品该车间产量 / 车间总产量
    for (const [ppk, pd] of prodData) {
      let total = 0;
      for (const [ws, out] of pd.workshops) {
        const wsKey = `${ws}|${pd.periodKey}`;
        const wsTotalOut = wsTotal.get(wsKey) || 0;
        const power = wsPower.get(wsKey) || 0;
        if (wsTotalOut > 0 && power > 0 && out > 0) {
          total += power * (out / wsTotalOut);
        }
      }
      result.set(ppk, +total.toFixed(1));
    }
    return result;
  }

  /** 保存一条手工录入笔记（upsert，按行唯一 key） */
  saveNote(note) {
    this.db.upsertProductionNote(note);
  }

  /** 删除一条手工录入笔记（未达产原因/补产方案均清空时调用） */
  deleteNote(note) {
    this.db.deleteProductionNote(note);
  }

  /** 排产单目标计划缓存：UNW_yjyProductPlanBill → (FMOBILL, FDATE, FCLASS) → FAIMQTY(万条) */
  async _ensurePlanBillCache(moNumbers) {
    if (!this.client || !this.client.isConfigured() || moNumbers.length === 0) return;
    const now = Date.now();
    if (this._planBillCacheTime > 0 && now - this._planBillCacheTime > PLAN_CACHE_TTL_MS) {
      this._planBillCache.clear();
      this._planBillMos.clear();
      this._planBillCacheTime = 0;
    }
    const missing = moNumbers.filter((n) => !this._planBillMos.has(n));
    if (missing.length === 0) return;
    for (let i = 0; i < missing.length; i += IN_BATCH) {
      const batch = missing.slice(i, i + IN_BATCH);
      try {
        const inClause = batch.map((n) => `'${String(n).replace(/'/g, "''")}'`).join(',');
        const raw = await this.client.executeBillQueryAll('UNW_yjyProductPlanBill', {
          fieldKeys: ['FMOBILL', 'FDATE', 'FCLASS', 'FAIMQTY'],
          filter: `FMOBILL IN (${inClause})`,
        });
        for (const row of parse2d(raw, ['FMoBill', 'FDate', 'FClass', 'FAIMQTY'])) {
          const mo = String(row.FMoBill || '').trim();
          const date = String(row.FDate || '').slice(0, 10);
          const cls = String(row.FClass || '').trim();
          const qty = num(row.FAIMQTY);
          if (mo && date && cls && qty > 0) {
            const key = `${mo}|${date}|${cls}`;
            if (!this._planBillCache.has(key)) this._planBillCache.set(key, qty);
          }
        }
        for (const n of batch) this._planBillMos.add(n);
      } catch (err) {
        console.warn(`[board] 排产单查询失败: ${err.message}`);
      }
    }
    this._planBillCacheTime = now;
  }

  // ==================== 内部 ====================

  /** 合并 production_notes 到行（未达产原因 / 补产方案） */
  _attachNotes(rows) {
    const notes = this.db.getProductionNotes();
    const noteMap = new Map(notes.map((n) => [noteKey(n), n]));
    for (const row of rows) {
      const n = noteMap.get(noteKey(row));
      if (n) {
        row.reason = n.reason || '';
        row.recoveryPlan = n.recoveryPlan || '';
      }
    }
  }

  /** 项目完成率 = 累计产量 ÷ PRD_MO 计划量 */
  async _attachProjectRate(rows) {
    if (!this.client || !this.client.isConfigured()) return;
    const moNumbers = uniq(rows.map((r) => r.moNumber).filter(Boolean));
    if (moNumbers.length === 0) return;
    await this._ensurePlanCache(moNumbers);
    for (const row of rows) {
      const planQty = this._planCache.get(row.moNumber) || 0;
      row.projectRate = planQty > 0 ? round1((row.cumQty / planQty) * 100) : null;
    }
  }

  async _ensurePlanCache(moNumbers) {
    const now = Date.now();
    if (this._planCacheTime > 0 && now - this._planCacheTime > PLAN_CACHE_TTL_MS) {
      this._planCache.clear();
      this._planCacheTime = 0;
    }
    const missing = moNumbers.filter((n) => !this._planCache.has(n));
    if (missing.length === 0) return;
    for (let i = 0; i < missing.length; i += IN_BATCH) {
      const batch = missing.slice(i, i + IN_BATCH);
      const map = await this._queryPlanBatch(batch);
      for (const [k, v] of map) this._planCache.set(k, v);
    }
    this._planCacheTime = now;
  }

  async _queryPlanBatch(billNos) {
    const map = new Map();
    try {
      const inClause = billNos.map((n) => `'${String(n).replace(/'/g, "''")}'`).join(',');
      const raw = await this.client.executeBillQueryAll('PRD_MO', {
        fieldKeys: ['FBillNo', 'FQty'],
        filter: `FBillNo IN (${inClause})`,
      });
      for (const row of parse2d(raw, ['FBillNo', 'FQty'])) {
        const billNo = String(row.FBillNo || '').trim();
        const qty = num(row.FQty);
        if (billNo && qty > 0) map.set(billNo, (map.get(billNo) || 0) + qty);
      }
    } catch (err) {
      console.warn(`[board] PRD_MO 计划量查询失败: ${err.message}`);
    }
    return map;
  }

  /** 客户/销售订单：SFC.F_FD_SALEORDERNUMBER == SAL_SaleOrder.FBILLNO → FCUSTID → 客户名 */
  async _attachCustomer(rows) {
    if (!this.client || !this.client.isConfigured()) return;

    // MES 来源的记录没有销售订单号（F_FD_SALEORDERNUMBER 为空），
    // 用生产订单号回查金蝶 PRD_MO.FSaleOrderNo 补齐，再走原有的 销售订单 → 客户 链路
    const moNumbers = uniq(rows.filter((r) => !r.salesOrderNo && r.moNumber).map((r) => r.moNumber));
    if (moNumbers.length > 0) {
      await this._ensureMoSaleOrderCache(moNumbers);
      for (const row of rows) {
        if (!row.salesOrderNo) row.salesOrderNo = this._moSoCache.get(row.moNumber) || '';
      }
    }

    const salesOrderNos = uniq(rows.map((r) => r.salesOrderNo).filter(Boolean));
    if (salesOrderNos.length === 0) return;
    await this._ensureCustomerCache(salesOrderNos);
    for (const row of rows) {
      const name = this._customerCache.get(row.salesOrderNo);
      // 查不到时保留原值（MES 记录可能已自带客户），不清空
      if (name) row.customer = name;
    }
  }

  /** 生产订单号 → 销售订单号（金蝶 PRD_MO.FSaleOrderNo） */
  async _ensureMoSaleOrderCache(moNumbers) {
    const now = Date.now();
    if (this._moSoCacheTime > 0 && now - this._moSoCacheTime > CUSTOMER_CACHE_TTL_MS) {
      this._moSoCache.clear();
      this._moSoCacheTime = 0;
    }
    const missing = moNumbers.filter((n) => !this._moSoCache.has(n));
    if (missing.length === 0) return;
    for (let i = 0; i < missing.length; i += IN_BATCH) {
      const batch = missing.slice(i, i + IN_BATCH);
      try {
        const inClause = batch.map((n) => `'${String(n).replace(/'/g, "''")}'`).join(',');
        const raw = await this.client.executeBillQueryAll('PRD_MO', {
          fieldKeys: ['FBillNo', 'FSaleOrderNo'],
          filter: `FBillNo IN (${inClause})`,
        });
        for (const r of parse2d(raw, ['FBillNo', 'FSaleOrderNo'])) {
          const mo = String(r.FBillNo || '').trim();
          const so = String(r.FSaleOrderNo || '').trim();
          if (mo && so) this._moSoCache.set(mo, so);
        }
      } catch (err) {
        console.warn(`[board] 生产订单→销售订单 查询失败 batch=${i}: ${err.message}`);
      }
    }
    this._moSoCacheTime = now;
  }

  async _ensureCustomerCache(salesOrderNos) {
    const now = Date.now();
    if (this._customerCacheTime > 0 && now - this._customerCacheTime > CUSTOMER_CACHE_TTL_MS) {
      this._customerCache.clear();
      this._customerCacheTime = 0;
    }
    const missing = salesOrderNos.filter((n) => !this._customerCache.has(n));
    if (missing.length === 0) return;
    for (let i = 0; i < missing.length; i += IN_BATCH) {
      const batch = missing.slice(i, i + IN_BATCH);
      const map = await this._queryCustomerBatch(batch);
      for (const [k, v] of map) this._customerCache.set(k, v);
    }
    this._customerCacheTime = now;
  }

  async _queryCustomerBatch(salesOrderNos) {
    const map = new Map();
    try {
      const inClause = salesOrderNos.map((n) => `'${String(n).replace(/'/g, "''")}'`).join(',');
      // 主路径：点符号 FCUSTID.FName 内联取客户中文名（零额外请求）
      const raw = await this.client.executeBillQueryAll('SAL_SaleOrder', {
        fieldKeys: ['FBILLNO', 'FCUSTID', 'FCUSTID.FName'],
        filter: `FBILLNO IN (${inClause})`,
      });
      const resolved = parse2d(raw, ['FBillNo', 'FCustId', 'FCustName']);
      const hit = resolved.filter((r) => r.FBillNo && r.FCustName);
      if (hit.length > 0) {
        for (const r of hit) map.set(String(r.FBillNo).trim(), String(r.FCustName).trim());
        return map;
      }

      // 退路：点符号不可用 → 分表查 BD_Customer（基础资料无 FDate，须用 executeBillQuery + skipDateFilter）
      const raw2 = await this.client.executeBillQueryAll('SAL_SaleOrder', {
        fieldKeys: ['FBILLNO', 'FCUSTID'],
        filter: `FBILLNO IN (${inClause})`,
      });
      const so2cust = new Map();
      const custIds = new Set();
      for (const r of parse2d(raw2, ['FBillNo', 'FCustId'])) {
        const so = String(r.FBillNo || '').trim();
        const cid = String(r.FCustId || '').trim();
        if (so && cid) { so2cust.set(so, cid); custIds.add(cid); }
      }
      if (custIds.size > 0) {
        const custNameMap = await this._queryCustomerNames([...custIds]);
        for (const [so, cid] of so2cust) {
          const name = custNameMap.get(cid);
          if (name) map.set(so, name);
        }
      }
    } catch (err) {
      console.warn(`[board] 客户查询失败: ${err.message}`);
    }
    return map;
  }

  /** 批量查 BD_Customer：FCUSTID → FName */
  async _queryCustomerNames(custIds) {
    const map = new Map();
    try {
      const inClause = custIds.map((n) => `'${String(n).replace(/'/g, "''")}'`).join(',');
      // executeBillQuery 本身不带自动登录，套 callWithAuth 兜底会话过期
      const raw = await this.client.callWithAuth(() => this.client.executeBillQuery('BD_Customer', {
        limit: 2000,
        fieldKeys: ['FCUSTID', 'FName'],
        filter: `FCUSTID IN (${inClause})`,
        skipDateFilter: true,
      }));
      const result = raw.data || raw;
      let rowsData = result;
      if (rowsData && typeof rowsData === 'object' && !Array.isArray(rowsData) && Array.isArray(rowsData.Result)) {
        rowsData = rowsData.Result;
      }
      const rows = Array.isArray(rowsData) ? parse2d(rowsData, ['FCustId', 'FName']) : [];
      for (const r of rows) {
        const cid = String(r.FCustId || '').trim();
        const name = String(r.FName || '').trim();
        if (cid && name) map.set(cid, name);
      }
    } catch (err) {
      console.warn(`[board] BD_Customer 查询失败: ${err.message}`);
    }
    return map;
  }
}

module.exports = ProductionBoardService;
