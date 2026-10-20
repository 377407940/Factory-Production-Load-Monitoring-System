/**
 * MES(192.168.1.14) → 看板记录 映射器
 *
 * 2026-09-14 起金蝶工序汇报停用，看板改从工厂 MES 取数。
 * 本模块把 1.14 推送过来的 MES 灌装设备级数据，转成与金蝶 SFC 记录
 * 完全同构的记录（{date, shift, workshop, machine, fields, content_hash}），
 * 这样聚合层无需区分数据来源。
 *
 * 字段口径来源：MES 前端 equipdata/detail 页（OES/OEE 公式即取自该处）
 *   OES(%) = good_qty / (speed × column_num × 60 × 班次时长) × 100
 *   OEE(%) = good_qty / (speed × column_num × 60 × (班次时长 − 计划停机)) × 100
 */

const crypto = require('crypto');
const { EQUIPMENT_LIST, normalizeWorkshopName } = require('../config/workshopMasterData');

/**
 * MES 设备名 → 看板主数据标准设备名
 * （比对时忽略空格；未命中的设备原样保留，聚合时按"未知设备"处理）
 */
const EQUIPMENT_NAME_MAP = {
  '粉体24.3十列灌装机FJ': '粉体24.3十列机',
  '粉体S100十二列机FK': 'S100（24.3十二列机）',
  '45.1双计量粉体八列机FU': '粉体45.1八列机',
  '49.8液体四列机': '液体49.8可变袋宽四列机',
  '45.1液体高速六列机YE': '液体六列机YE-6列',
  '液体六列充填包装机YD': '液体六列机',
  '双胞胎双列机YG': '液体双胞胎双列机G',
  '双胞胎双列机YH': '液体双胞胎双列H',
  '液体双列充填包装机YB': '液体双列机B',
  '粉体单列机（螺杆）FB': '粉体B机台',
  '粉体单列机（螺杆）FE': '粉体E机台',
  '粉体单列机（螺杆）FF': '粉体F机台',
  '粉体单列机（螺杆）FG': '粉体G机台',
  '粉体单列机（液改粉）FM': '粉体M机台',
};

/** 去掉所有空白字符，便于设备名模糊匹配 */
const strip = (s) => String(s || '').replace(/\s+/g, '');

const EQUIP_MAP_STRIPPED = new Map(
  Object.entries(EQUIPMENT_NAME_MAP).map(([k, v]) => [strip(k), v]),
);

const EQUIP_TYPE = new Map(EQUIPMENT_LIST.map((e) => [e.name, e.type]));

/** MES 设备名 → 标准设备名 */
function normalizeEquipmentName(name) {
  const key = strip(name);
  return EQUIP_MAP_STRIPPED.get(key) || String(name || '').trim();
}

/** 由设备名推断灌装工序类型（看板只保留 固体灌装/液体灌装） */
function processOfEquipment(stdName) {
  const type = EQUIP_TYPE.get(stdName);
  if (type === '粉体') return '固体灌装';
  if (type === '液体') return '液体灌装';
  return /粉体|固体/.test(stdName) ? '固体灌装' : '液体灌装';
}

/** hh:mm 起止 → 班次时长(小时)，跨天按 +24h */
function shiftHours(startTime, endTime) {
  if (!startTime || !endTime) return null;
  const [a, b] = String(startTime).split(':').map(Number);
  const [c, d] = String(endTime).split(':').map(Number);
  if ([a, b, c, d].some((v) => Number.isNaN(v))) return null;
  let mins = c * 60 + d - (a * 60 + b);
  if (mins <= 0) mins += 24 * 60;
  return Math.round((mins / 60) * 100) / 100;
}

const round2 = (v) => Math.round(v * 100) / 100;

/** 推送脚本用 ASCII 逗号分隔人名，展示时统一成顿号（与看板其它多值列一致） */
const names = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean).join('、');

/** OES/OEE：合格产量 ÷ 理论产能 */
function computeOesOee({ goodQty, speed, columnNum, hours, planStopTime }) {
  const qty = Number(goodQty);
  const sp = Number(speed);
  const col = Number(columnNum);
  if (!qty || !sp || !col || !hours) return { oes: null, oee: null };
  const oes = round2((qty / (sp * col * 60 * hours)) * 100);
  const effHours = hours - (Number(planStopTime) || 0);
  const oee = effHours > 0 ? round2((qty / (sp * col * 60 * effHours)) * 100) : null;
  return { oes, oee };
}

/**
 * 单条 MES 原始行 → 看板记录
 * @param {object} r - 1.14 推送的原始行
 * @returns {object|null}
 */
function mapOne(r) {
  if (!r || !r.produceDate) return null;
  const date = String(r.produceDate).slice(0, 10);
  const stdEquip = normalizeEquipmentName(r.equipName);
  if (!stdEquip) return null;

  const workshop = normalizeWorkshopName(r.workshopName || r.workshop || '');
  const shift = r.shiftName || ''; // 白班 / 晚班
  const goodQty = Number(r.goodQty) || 0;
  const hours = shiftHours(r.startTime, r.endTime);
  const { oes, oee } = computeOesOee({
    goodQty,
    speed: r.speed,
    columnNum: r.columnNum,
    hours,
    planStopTime: r.planStopTime,
  });

  // 目标：MES 存的是「万条」，×10000 换成条
  const targetQty = r.targetQty == null ? null : Number(r.targetQty) * 10000;
  // 理论小时产能（条/h）：与金蝶 F_FD_AimPerProduct 同义，配合 loadTimes 得理论产量
  const aimPerHour = (Number(r.speed) || 0) * (Number(r.columnNum) || 0) * 60;

  const fields = {
    FDate: date,
    F_YJY_NewRealShop: workshop,
    F_FD_Machine: stdEquip,
    FQuaQty: goodQty,
    FReworkQty: 0,
    FWastageQty: 0,
    F_YJY_loadTimes: hours || 0,
    F_FD_EXCEPTTimes: Number(r.accidentStopTime) || 0,
    F_FD_IMPORTTIMES: Number(r.workTime) || 0,
    F_UNW_WorkType2: shift === '晚班' ? '20' : '10',
    F_FD_Speeds: Number(r.speed) || 0,
    F_YJY_equipSpeed: Number(r.speed) || 0,
    F_FD_OEE: oee == null ? 0 : oee,
    F_YJY_OEE: oee == null ? 0 : oee,
    F_FD_OkRates: Number(r.yieldRate) || 0,
    F_FD_AimPerProduct: aimPerHour,
    F_FD_RealPerProduct: hours > 0 ? round2(goodQty / hours) : 0,
    FSpecification: r.materialSpe || '',
    FMaterialName: r.materialName || '',
    FMoNumber: r.moNumber || '',
    F_FD_OperDescp: processOfEquipment(stdEquip),
    F_FD_AimProducts: targetQty == null ? 0 : targetQty,
    // 操作人员：优先本台设备的操作工，设备未关联人员时退回该报工全部人员
    F_FD_Operator: names(r.operatorName) || names(r.reportWorkers),
    F_FD_SALEORDERNUMBER: '',
    F_UNW_REASON: r.unreachReason || '',
    F_UNW_SOLUTION: r.makeupPlan || '',
    F_UNW_Date2: date,
    F_FD_WorkTimes: 0,
    F_YJY_PQWORKERTIME: 0,
    F_FD_TXTWORKERS: '',
    // 产出明细的生产日期拆分（晚班跨天：一个班次可能落在两个生产日期上）
    // 格式 '2026-09-17:125845;2026-09-18:274155'
    // 记录本身不按它拆分（看板/总览一律按班次日期），仅供「灌装成品对比」页按生产日期取数
    F_YJY_DAYSPLIT: String(r.daySplit || ''),
    _mes: {
      oes,
      oee,
      defectQty: Number(r.defectQty) || 0,
      columnNum: Number(r.columnNum) || 0,
      speed: Number(r.speed) || 0,
      planStopTime: Number(r.planStopTime) || 0,
      workTime: Number(r.workTime) || 0,
      equipDataId: r.equipDataId || null,
    },
  };

  // 业务主键：MES 设备运行记录 ID（mes_equip_data.id，一行业务上唯一）。
  // 不能用「日期+班次+订单+设备」——同一台设备一个班次可能有多条运行记录，会撞键互相覆盖。
  const bizKey = r.equipDataId
    ? `mes|${r.equipDataId}`
    : `mes|${date}|${shift}|${r.moNumber || ''}|${stdEquip}`;

  return {
    date,
    shift,
    workshop,
    machine: stdEquip,
    fields,
    content_hash: crypto.createHash('sha1').update(bizKey).digest('hex'),
  };
}

/**
 * 单条 MES 配料&混料报工 → 看板记录
 *
 * 只提供「配料人员」与配料工时（看板 attachMixTimes 按 日期|班次|产品 挂到灌装行上），
 * 产量恒为 0，工序为「配料&混料」，因此不会进入产量统计与看板行。
 */
function mapMixOne(r) {
  if (!r || !r.produceDate) return null;
  const date = String(r.produceDate).slice(0, 10);
  const workshop = normalizeWorkshopName(r.workshopName || r.workshop || '');
  const shift = r.shiftName || '';

  const fields = {
    FDate: date,
    F_YJY_NewRealShop: workshop,
    F_FD_Machine: '',
    FQuaQty: 0,
    FReworkQty: 0,
    FWastageQty: 0,
    F_YJY_loadTimes: 0,
    F_FD_EXCEPTTimes: 0,
    F_FD_IMPORTTIMES: 0,
    F_UNW_WorkType2: shift === '晚班' ? '20' : '10',
    F_FD_Speeds: 0,
    F_YJY_equipSpeed: 0,
    F_FD_OEE: 0,
    F_YJY_OEE: 0,
    F_FD_OkRates: 0,
    F_FD_AimPerProduct: 0,
    F_FD_RealPerProduct: 0,
    FSpecification: '',
    FMaterialName: r.materialName || '',
    FMoNumber: r.moNumber || '',
    F_FD_OperDescp: '配料&混料',
    F_FD_AimProducts: 0,
    F_FD_Operator: '',
    F_FD_SALEORDERNUMBER: '',
    F_UNW_REASON: '',
    F_UNW_SOLUTION: '',
    F_UNW_Date2: date,
    // 正式工工时（扣除派遣岗位）/ 派遣工工时（岗位=派遣）
    F_FD_WorkTimes: Number(r.formalHours) || 0,
    F_YJY_PQWORKERTIME: Number(r.dispatchHours) || 0,
    // 配料&混料操作人员（看板解析时支持多种分隔符）
    F_FD_TXTWORKERS: names(r.operators),
    _mes: { kind: 'mix' },
  };

  const bizKey = `mesmix|${date}|${shift}|${r.moNumber || ''}|${r.materialName || ''}`;
  return {
    date,
    shift,
    workshop,
    machine: '',
    fields,
    content_hash: crypto.createHash('sha1').update(bizKey).digest('hex'),
  };
}

/** 批量映射（按 kind 分流：fill=灌装设备行，mix=配料报工） */
function mapRows(rows) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const rec = r && r.kind === 'mix' ? mapMixOne(r) : mapOne(r);
    if (rec) out.push(rec);
  }
  return out;
}

module.exports = {
  EQUIPMENT_NAME_MAP,
  normalizeEquipmentName,
  processOfEquipment,
  shiftHours,
  computeOesOee,
  mapOne,
  mapMixOne,
  mapRows,
};
