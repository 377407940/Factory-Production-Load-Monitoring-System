/**
 * 电表车间名称 ↔ 工厂车间名称映射
 *
 * 第三方电表系统中使用的车间名称与工厂监控系统不一致，需要映射。
 */
const WORKSHOP_METER_MAP = {
  '固体一1车间': 'Y固体一1号车间',
  '固体一3车间': 'Y固体一3号车间',
  '固体一5车间': 'Y固体一5号车间',
  '固体一6车间': 'Y固体一6号车间',
  '固体一8车间': 'Y固体一8号车间',
  '分包间': 'Y固体一分包间',
  '固体二号车间': 'Y固体二车间',
  '液体二号车间': 'Y液体二车间',
};

const FACTORY_TO_METER = {};
for (const [meter, factory] of Object.entries(WORKSHOP_METER_MAP)) {
  FACTORY_TO_METER[factory] = meter;
}

/** 电表数据中不在车间映射表中的名称（非车间区域，不计入车间能耗） */
const NON_WORKSHOP_NAMES = [
  '一家园所有区域',
  '公共区域（餐厅、照明、办公区等）',
  '公用工程设备（固体一空压机、纯水、污水站）',
  '原料仓库',
  '固体1、固体二车间新风预处理冷却机组',
  '外包车间',
  '成品仓库',
  '检验室',
  '灭菌车间',
];

module.exports = { WORKSHOP_METER_MAP, FACTORY_TO_METER, NON_WORKSHOP_NAMES };
