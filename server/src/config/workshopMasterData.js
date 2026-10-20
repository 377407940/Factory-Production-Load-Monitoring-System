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

/**
 * 金蝶部门现名 → 主数据标准名（别名归一化）
 *
 * 金蝶 BD_DEPARTMENT 里的车间名会被业务改动（2026-09 去掉/加了"号"字，
 * 如 Y固体一1号车间 → Y固体一1车间、Y固体二车间 → Y固体二号车间）。
 * 同步解析出的车间名必须先归一化成这里的标准名，否则按名字匹配会全部失配（产量归零）。
 * 金蝶以后再改名，在此追加一行即可。
 */
const WORKSHOP_NAME_ALIASES = {
  // 金蝶 BD_DEPARTMENT 部门名（改动后）
  'Y固体一1车间': 'Y固体一1号车间',
  'Y固体一2车间': 'Y固体一2号车间',
  'Y固体一3车间': 'Y固体一3号车间',
  'Y固体一5车间': 'Y固体一5号车间',
  'Y固体一6车间': 'Y固体一6号车间',
  'Y固体一8车间': 'Y固体一8号车间',
  'Y分包间': 'Y固体一分包间',
  'Y固体二号车间': 'Y固体二车间',
  'Y液体二号车间': 'Y液体二车间',
  // MES dev_dict 的车间标签（无 Y 前缀）
  '固体一1车间': 'Y固体一1号车间',
  '固体一2车间': 'Y固体一2号车间',
  '固体一3车间': 'Y固体一3号车间',
  '固体一5车间': 'Y固体一5号车间',
  '固体一6车间': 'Y固体一6号车间',
  '固体一8车间': 'Y固体一8号车间',
  '分包间': 'Y固体一分包间',
  '固体二号车间': 'Y固体二车间',
  '液体二号车间': 'Y液体二车间',
};

/** 把金蝶解析出的车间名归一化成主数据标准名（无别名时原样返回） */
function normalizeWorkshopName(name) {
  if (!name) return name;
  return WORKSHOP_NAME_ALIASES[String(name).trim()] || name;
}

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
  { name: 'S100（24.3十二列机）', type: '粉体', defaultWorkshop: 'Y固体二车间',   lanes: 12, designSpeed: 40 },
  { name: '45.1可变袋宽六列机', type: '粉体', defaultWorkshop: '',                lanes: 6,  designSpeed: 40 },
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
  WORKSHOP_NAME_ALIASES,
  normalizeWorkshopName,
  WORKSHOP_AREAS,
  EQUIPMENT_TYPES,
  EQUIPMENT_LIST,
  WORKSHOP_LOAD_RATE_THRESHOLDS,
  getEquipmentByName,
  getEquipmentNamesByType,
  getDefaultEquipmentByWorkshop,
};
