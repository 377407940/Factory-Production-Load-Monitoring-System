/**
 * 查已有 SFC 记录，看"汇总"实体到底有没有数据
 * 尝试用深度查询看能不能拿到 FEntity 的数据
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

async function qr(fieldKeys, filter = '', limit = 3) {
  const r = await client.callWithAuth(() =>
    client.executeBillQuery('SFC_OperationReport', { fieldKeys, filter, skipDateFilter: true, limit }),
  );
  let rows = r.data;
  if (rows && typeof rows === 'object' && !Array.isArray(rows) && Array.isArray(rows.Result)) rows = rows.Result;
  return rows;
}

async function main() {
  // 1. 查一条已有的灌装和一条包装记录，对比所有字段
  console.log('=== 灌装 完整记录 ===');
  const r1 = await qr([
    'FBillNo', 'FMoNumber', 'FMaterialId.FNumber', 'FQuaQty',
    'F_FD_OperDescp', 'FWorkShopId', 'F_YJY_NewRealShop',
    'F_UNW_WorkType2', 'F_YJY_loadTimes', 'F_FD_Machine',
    'F_FD_AimProducts', 'F_FD_AimTimes',
  ], "FBillNo='YJYGXHB26060848'", 1);
  if (r1) console.log('  灌装:', JSON.stringify(r1[0]));

  console.log('\n=== 包装 完整记录 ===');
  const r2 = await qr([
    'FBillNo', 'FMoNumber', 'FMaterialId.FNumber', 'FQuaQty',
    'F_FD_OperDescp', 'FWorkShopId', 'F_YJY_NewRealShop',
    'F_UNW_WorkType2', 'F_YJY_loadTimes', 'F_FD_Machine',
    'F_FD_AimProducts', 'F_FD_AimTimes',
  ], "FBillNo='YJYGXHB26060859'", 1);
  if (r2) console.log('  包装:', JSON.stringify(r2[0]));

  // 2. 看看能不能通过 FID 查
  console.log('\n=== 查 FID ===');
  const r3 = await qr(['FBillNo', 'FID'], "FBillNo='YJYGXHB26060848'", 1);
  if (r3) console.log('  FID:', JSON.stringify(r3[0]));

  // 3. 尝试不用 Save API，用更底层的方式创建
  // 查一下 F_UNW_MONum 字段是不是必须传
  console.log('\n=== 验证已有数据 ===');
  const r4 = await qr([
    'FBillNo', 'F_UNW_MONum',
  ], "FBillNo='YJYGXHB26060848'", 1);
  if (r4) console.log('  MONum:', JSON.stringify(r4[0]));

  // 4. 看看这个"汇总"的实体在已有记录里的数据
  // 尝试用汇总实体的字段来查
  console.log('\n=== 尝试查 "汇总" 相关字段 ===');
  const summaryFields = [
    'FBillNo',
    // 一些可能属于汇总实体的字段
    'FTotalQty', 'FTotalFailQty', 'FQuaQty', 'FReworkQty',
    // 试试用 FEntity_ 前缀
    'FEntity_Link.FEntryId',
  ];
  for (const f of summaryFields) {
    try {
      const r = await qr([f], "FBillNo='YJYGXHB26060848'", 1);
      if (r && r[0]) console.log(`  ${f}: ${JSON.stringify(r[0])}`);
    } catch(e) {}
  }
}

main().catch(e => console.error('FATAL', e));
