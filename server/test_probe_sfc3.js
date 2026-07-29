/**
 * 继续：FWorkShopId 值格式测试 + BD_DEPARTMENT 查询 + 汇总实体
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

  // 1. 查 BD_DEPARTMENT 正常字段
  console.log('=== BD_DEPARTMENT ===');
  const depts = await qr('BD_DEPARTMENT', [
    'FDeptId', 'FNumber', 'FName', 'FParentId', 'FDeptId_FNumber',
  ], '', 10);
  if (depts) for (let i = 0; i < depts.length; i++) console.log(`  [${i}]:`, JSON.stringify(depts[i]));

  // 查 department 187423
  console.log('\n=== BD_DEPARTMENT FDeptId=187423 ===');
  const dept2 = await qr('BD_DEPARTMENT', [
    'FDeptId', 'FNumber', 'FName',
  ], "FDeptId=187423", 3);
  if (dept2) for (let i = 0; i < dept2.length; i++) console.log(`  [${i}]:`, JSON.stringify(dept2[i]));

  // 查 department 214148
  console.log('\n=== BD_DEPARTMENT FDeptId=214148 ===');
  const dept3 = await qr('BD_DEPARTMENT', [
    'FDeptId', 'FNumber', 'FName',
  ], "FDeptId=214148", 3);
  if (dept3) for (let i = 0; i < dept3.length; i++) console.log(`  [${i}]:`, JSON.stringify(dept3[i]));

  const base = {
    FDate: today, F_UNW_Date2: today,
    F_UNW_MONum: 'YJYMO2605108',
    PrdOrgId: { FNumber: 'YJY' },
    FBillTypeID: { FNumber: 'GXHB01_SYS' },
    OptRptEntry: [{ FMaterialId: { FNumber: 'FP010587' }, FQuaQty: 10 }],
  };

  // 2. FWorkShopId 各种格式（现在字段名已正确）
  await trySave('FWorkShopId {FNumber:BM...}', { ...base, FWorkShopId: { FNumber: 'BM000046' } });
  await trySave('FWorkShopId {FDeptId:187423}', { ...base, FWorkShopId: { FDeptId: 187423 } });
  await trySave('FWorkShopId {FDeptId_FNumber:xxx}', { ...base, FWorkShopId: { FDeptId_FNumber: 'BM000046' } });

  // 3. Entity 的试探：看看 SFC 有哪些实体
  console.log('\n=== SFC 单据类型枚举 ===');
  // 已有单据类型
  const bt = await qr('SFC_OperationReport', [
    'FBillNo', 'FBillTypeID.FNumber',
  ], '', 5, 'FDate DESC');
  if (bt) for (let i = 0; i < bt.length; i++) console.log(`  [${i}]:`, JSON.stringify(bt[i]));
}

main().catch(e => console.error('FATAL', e));
