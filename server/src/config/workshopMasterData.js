/**
 * 工厂车间/设备主数据
 *
 * 车间分配为初始默认值，实际会从金蝶数据动态派生。
 * 设备类型（机型）用于筛选和设备分类。
 */

/** 8 个车间（Y固体一2号车间已合并到1号车间） */
const WORKSHOPS = [
  'Y固体一1号车间',
  'Y固体一3号车间',
  'Y固体一5号车间',
  'Y固体一6号车间',
  'Y固体一8号车间',
  'Y固体一分包间',
  'Y固体二车间',
  'Y液体二车间',
];

/** 车间面积（㎡） */
const WORKSHOP_AREAS = {
  'Y固体一1号车间': 300, // 245（原1号）+ 55（原2号，已合并）
  'Y固体一3号车间': 110,
  'Y固体一5号车间': 186,
  'Y固体一6号车间': 154,
  'Y固体一8号车间': 352,
  'Y固体一分包间': 139,
  'Y固体二车间': 431,
  'Y液体二车间': 348,
};

/**
 * 设备类型枚举
 */
const EQUIPMENT_TYPES = ['粉体', '液体'];

/**
 * 设备主数据
 * 初始所属车间为默认值，实际从金蝶数据动态派生车间归属。
 * lanes: 设备列数, designSpeed: 设计速度（切/分钟）
 *
 * 设备名称源自金蝶 SFC_OperationReport 中 F_FD_Machine.FName 的实际值。
 */
const EQUIPMENT_LIST = [
  // === 粉体设备 ===
  { name: '粉体12列机P机台',   type: '粉体', defaultWorkshop: 'Y固体二车间',     lanes: 12, designSpeed: 60 },
  { name: '粉体24.3十列机',    type: '粉体', defaultWorkshop: 'Y固体二车间',     lanes: 10, designSpeed: 40 },
  { name: '粉体45.1八列机',    type: '粉体', defaultWorkshop: '',                lanes: 8,  designSpeed: 35 },
  { name: '粉体A机台',         type: '粉体', defaultWorkshop: 'Y固体一1号车间',  lanes: 1,  designSpeed: 40 },
  { name: '粉体B机台',         type: '粉体', defaultWorkshop: 'Y固体一1号车间',  lanes: 1,  designSpeed: 40 },
  { name: '粉体C机台',         type: '粉体', defaultWorkshop: 'Y固体一1号车间',  lanes: 1,  designSpeed: 40 },
  { name: '粉体D机台',         type: '粉体', defaultWorkshop: 'Y固体一1号车间',  lanes: 1,  designSpeed: 40 },
  { name: '粉体E机台',         type: '粉体', defaultWorkshop: 'Y固体一1号车间',  lanes: 1,  designSpeed: 40 },
  { name: '粉体F机台',         type: '粉体', defaultWorkshop: 'Y固体一分包间',   lanes: 1,  designSpeed: 40 },
  { name: '粉体G机台',         type: '粉体', defaultWorkshop: 'Y固体一分包间',   lanes: 1,  designSpeed: 40 },
  { name: '粉体M机台',         type: '粉体', defaultWorkshop: 'Y固体一1号车间',  lanes: 1,  designSpeed: 40 },
  { name: '30.6粉体十列机',    type: '粉体', defaultWorkshop: '',                lanes: 10, designSpeed: 40 },
  { name: '软袋包装机',        type: '粉体', defaultWorkshop: 'Y固体一8号车间',  lanes: 1,  designSpeed: 12 },

  // === 液体设备 ===
  { name: '液体49.8可变袋宽四列机', type: '液体', defaultWorkshop: 'Y固体一6号车间', lanes: 4, designSpeed: 40 },
  { name: '液体A机台',             type: '液体', defaultWorkshop: 'Y液体二车间',     lanes: 1, designSpeed: 35 },
  { name: '液体B机台',             type: '液体', defaultWorkshop: 'Y液体二车间',     lanes: 1, designSpeed: 35 },
  { name: '液体C机台',             type: '液体', defaultWorkshop: 'Y液体二车间',     lanes: 1, designSpeed: 35 },
  { name: '液体D机台',             type: '液体', defaultWorkshop: 'Y液体二车间',     lanes: 1, designSpeed: 35 },
  { name: '液体E机台',             type: '液体', defaultWorkshop: 'Y液体二车间',     lanes: 1, designSpeed: 35 },
  { name: '液体六列机',            type: '液体', defaultWorkshop: 'Y液体二车间',     lanes: 6, designSpeed: 25 },
  { name: '液体六列机YE-6列',      type: '液体', defaultWorkshop: 'Y固体一5号车间',  lanes: 6, designSpeed: 50 },
  { name: '液体双胞胎双列H',       type: '液体', defaultWorkshop: 'Y液体二车间',     lanes: 2, designSpeed: 45 },
  { name: '液体双胞胎双列机G',     type: '液体', defaultWorkshop: 'Y液体二车间',     lanes: 2, designSpeed: 45 },
  { name: '液体双列机',            type: '液体', defaultWorkshop: 'Y液体二车间',     lanes: 2, designSpeed: 35 },
  { name: '液体双列机A',           type: '液体', defaultWorkshop: 'Y固体一6号车间',  lanes: 2, designSpeed: 35 },
  { name: '液体双列机B',           type: '液体', defaultWorkshop: 'Y液体二车间',     lanes: 2, designSpeed: 35 },
  { name: '液体双列机C',           type: '液体', defaultWorkshop: 'Y固体一6号车间',  lanes: 2, designSpeed: 35 },
];

/** 通过名称查询设备 */
function getEquipmentByName(name) {
  return EQUIPMENT_LIST.find((e) => e.name === name) || null;
}

/** 通过设备类型筛选设备名列表 */
function getEquipmentNamesByType(type) {
  return EQUIPMENT_LIST
    .filter((e) => e.type === type)
    .map((e) => e.name);
}

/** 获取某车间默认设备列表 */
function getDefaultEquipmentByWorkshop(workshop) {
  return EQUIPMENT_LIST
    .filter((e) => e.defaultWorkshop === workshop)
    .map((e) => e.name);
}

/**
 * 车间负载率阈值配置（基于日用电量 kWh）
 *   < low  → 0%
 *   low ~ high → 50%
 *   > high → 100%
 */
const WORKSHOP_LOAD_RATE_THRESHOLDS = {
  'Y固体一1号车间': { low: 20, high: 400 },
  'Y固体一3号车间': { low: 20, high: 120 },
  'Y固体一5号车间': { low: 20, high: 400 },
  'Y固体一6号车间': { low: 20, high: 200 },
  'Y固体一8号车间': { low: 100, high: 900 },
  'Y固体一分包间':  { low: 100, high: 200 },
  'Y固体二车间':    { low: 100, high: 1000 },
  'Y液体二车间':    { low: 100, high: 500 },
};

module.exports = {
  WORKSHOPS,
  WORKSHOP_AREAS,
  EQUIPMENT_TYPES,
  EQUIPMENT_LIST,
  WORKSHOP_LOAD_RATE_THRESHOLDS,
  getEquipmentByName,
  getEquipmentNamesByType,
  getDefaultEquipmentByWorkshop,
};
