/**
 * 探索工序汇报单 SFC_OperationReport 的字段和数据
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

async function qrRaw(formId, fieldKeys, filter = '', limit = 5, orderString = '') {
  const r = await client.callWithAuth(() =>
    client.executeBillQuery(formId, { fieldKeys, filter, skipDateFilter: true, limit, orderString }),
  );
  let rows = r.data;
  if (rows && typeof rows === 'object' && !Array.isArray(rows) && Array.isArray(rows.Result)) rows = rows.Result;
  return Array.isArray(rows) ? rows : null;
}

async function main() {
  // 查最近几条工序汇报单（含关联MO、物料、数量、车间、设备）
  console.log('=== SFC_OperationReport 最近5条 ===');
  const rows = await qrRaw('SFC_OperationReport', [
    'FBillNo', 'FDate', 'FMoNumber', 'FMaterialId.FNumber', 'FMaterialName',
    'FQuaQty', 'FReworkQty', 'FWastageQty',
    'F_YJY_NewRealShop', 'F_FD_Machine.FName',
  ], "FDOCUMENTSTATUS='C'", 5, 'FDate DESC');

  if (rows) {
    console.log(`  共 ${rows.length} 行`);
    for (let i = 0; i < rows.length; i++) console.log(`  [${i}]:`, JSON.stringify(rows[i]));
  }

  // 查一下 FP010587 的工序汇报
  console.log('\n=== SFC (FP010587) ===');
  const rows2 = await qrRaw('SFC_OperationReport', [
    'FBillNo', 'FDate', 'FMoNumber', 'FQuaQty',
  ], "FMaterialId.FNumber='FP010587' AND FDOCUMENTSTATUS='C'", 3, 'FDate DESC');
  if (rows2) for (let i = 0; i < rows2.length; i++) console.log(`  [${i}]:`, JSON.stringify(rows2[i]));
  else console.log('  无记录');

  // 查 FP010587 的工序汇报（不限状态，看有没有草稿）
  console.log('\n=== SFC (FP010587, 不限状态) ===');
  const rows3 = await qrRaw('SFC_OperationReport', [
    'FBillNo', 'FDate', 'FMoNumber', 'FQuaQty', 'FDOCUMENTSTATUS',
  ], "FMaterialId.FNumber='FP010587'", 3, 'FDate DESC');
  if (rows3) for (let i = 0; i < rows3.length; i++) console.log(`  [${i}]:`, JSON.stringify(rows3[i]));
  else console.log('  无记录');
}
main();
