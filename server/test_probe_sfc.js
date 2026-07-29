/**
 * 探查 SFC_OperationReport 的完整结构：字段、实体
 *
 * 目标：
 * 1. 查一条完整 SFC 记录所有字段值（看 WorkShopID 实际填什么）
 * 2. 尝试用 F_YJY_NewRealShop 代替 WorkShopID 作为 Save 字段名
 * 3. 试探 "汇总" 实体到底是什么
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

async function qr(formId, fieldKeys, filter = '', limit = 5, orderString = '') {
  const r = await client.callWithAuth(() =>
    client.executeBillQuery(formId, { fieldKeys, filter, skipDateFilter: true, limit, orderString }),
  );
  let rows = r.data;
  if (rows && typeof rows === 'object' && !Array.isArray(rows) && Array.isArray(rows.Result)) rows = rows.Result;
  return Array.isArray(rows) ? rows : null;
}

async function trySave(label, model) {
  console.log(`\n--- ${label} ---`);
  console.log('  model:', JSON.stringify(model).slice(0, 400));
  const r = await client.save('SFC_OperationReport', model);
  const resp = r.data;
  if (resp?.Result?.ResponseStatus?.IsSuccess) {
    console.log(`  ✅ ${resp.Result.Number}`);
    return true;
  } else {
    const errs = resp?.Result?.ResponseStatus?.Errors || [];
    errs.forEach(e => console.log(`  ❌ ${e.Message}`));
    return false;
  }
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  // 1. 查一条完整 SFC 记录，看看 WorkShopID/FWorkShopID/F_YJY_NewRealShop 的值
  console.log('=== 完整 SFC 字段探查 ===');
  const rows = await qr('SFC_OperationReport', [
    'FBillNo', 'FDate', 'FMoNumber', 'FMaterialId.FNumber', 'FQuaQty',
    'F_YJY_NewRealShop', 'FWorkShopId',
    'FBillTypeID.FNumber', 'FDOCUMENTSTATUS',
  ], "FDOCUMENTSTATUS='C'", 3, 'FDate DESC');
  if (rows) for (let i = 0; i < rows.length; i++) console.log(`  [${i}]:`, JSON.stringify(rows[i]));

  // 2. 尝试 F_YJY_NewRealShop 作为 Save 字段
  await trySave('F_YJY_NewRealShop with FNumber', {
    FDate: today, F_UNW_Date2: today,
    F_UNW_MONum: 'YJYMO2605108',
    PrdOrgId: { FNumber: 'YJY' },
    FBillTypeID: { FNumber: 'GXHB01_SYS' },
    F_YJY_NewRealShop: { FNumber: 'BM000046' },  // 用 department number
    OptRptEntry: [{ FMaterialId: { FNumber: 'FP010587' }, FQuaQty: 10 }],
  });

  await trySave('F_YJY_NewRealShop with Id', {
    FDate: today, F_UNW_Date2: today,
    F_UNW_MONum: 'YJYMO2605108',
    PrdOrgId: { FNumber: 'YJY' },
    FBillTypeID: { FNumber: 'GXHB01_SYS' },
    F_YJY_NewRealShop: { Id: 214148 },
    OptRptEntry: [{ FMaterialId: { FNumber: 'FP010587' }, FQuaQty: 10 }],
  });

  // 3. 查 BD_DEPARTMENT 看看 BM 编号
  console.log('\n=== BD_DEPARTMENT 示例 ===');
  const depts = await qr('BD_DEPARTMENT', [
    'FDeptId', 'FNumber', 'FName', 'F_POKA_ShopID', 'F_POKA_IsShop',
  ], '', 10, '');
  if (depts) for (let i = 0; i < depts.length; i++) console.log(`  [${i}]:`, JSON.stringify(depts[i]));

  // 4. 试探 "汇总" 实体——尝试不同实体名
  console.log('\n=== 试探汇总实体 ===');

  // 添加空汇总
  await trySave('with empty Huizong', {
    FDate: today, F_UNW_Date2: today,
    FBillTypeID: { FNumber: 'GXHB01_SYS' },
    F_UNW_MONum: 'YJYMO2605108',
    PrdOrgId: { FNumber: 'YJY' },
    OptRptEntry: [{ FMaterialId: { FNumber: 'FP010587' }, FQuaQty: 10 }],
    Huizong: [],
  });

  // 尝试 SubHeadEntity
  await trySave('with SubHeadEntity', {
    FDate: today, F_UNW_Date2: today,
    FBillTypeID: { FNumber: 'GXHB01_SYS' },
    F_UNW_MONum: 'YJYMO2605108',
    PrdOrgId: { FNumber: 'YJY' },
    OptRptEntry: [{ FMaterialId: { FNumber: 'FP010587' }, FQuaQty: 10 }],
    SubHeadEntity: {},
  });

  // 试试把 FBillTypeID 加到之前的 base 看是否影响
  await trySave('with FBillTypeID only', {
    FDate: today, F_UNW_Date2: today,
    FBillTypeID: { FNumber: 'GXHB01_SYS' },
    F_UNW_MONum: 'YJYMO2605108',
    PrdOrgId: { FNumber: 'YJY' },
    OptRptEntry: [{ FMaterialId: { FNumber: 'FP010587' }, FQuaQty: 10 }],
  });
}

main().catch(e => console.error('FATAL', e));
