/**
 * 逐个字段试，看哪个导致 FEntity 被整个拒绝
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

async function testFEntity(label, extraFields) {
  const today = new Date().toISOString().slice(0, 10);
  const model = {
    FDate: today, F_UNW_Date2: today,
    FBillTypeID: { FNumber: 'GXHB01_SYS' },
    F_UNW_MONum: 'YJYMO2605108',
    PrdOrgId: { FNumber: 'YJY' },
    FWorkShopId: { FNumber: 'BM000034' },
    F_FD_OperDescp: '装盒&装箱',
    OptRptEntry: [{ FMaterialId: { FNumber: 'FP010587' }, FQuaQty: 10 }],
    FEntity: [{ ...extraFields }],
  };
  const r = await client.save('SFC_OperationReport', model);
  const resp = r.data;
  if (resp?.Result?.ResponseStatus?.IsSuccess) {
    console.log(`  ✅ ${label}: ${resp.Result.Number}`);
    return 'success';
  }
  const errs = resp?.Result?.ResponseStatus?.Errors || [];
  const msgs = errs.map(e => e.Message);
  const firstError = msgs[0]?.slice(0, 120) || '';
  return firstError;
}

async function main() {
  console.log('=== 单个字段测试 ===');

  // 1. 基础：只有 FQuaQty
  let r = await testFEntity('only FQuaQty', { FQuaQty: 10 });
  console.log(`  only FQuaQty: ${r.slice(0, 80)}`);

  // 2. 加 FMaterialId (FNumber)
  r = await testFEntity('+FMaterialId FNumber', { FQuaQty: 10, FMaterialId: { FNumber: 'FP010587' } });
  console.log(`  +FMaterialId(FN): ${r.slice(0, 80)}`);

  // 3. FMaterialId (Id)
  r = await testFEntity('+FMaterialId Id', { FQuaQty: 10, FMaterialId: { Id: 1064252 } });
  console.log(`  +FMaterialId(Id): ${r.slice(0, 80)}`);

  // 4. 用 MaterialId (无F前缀)
  r = await testFEntity('+MaterialId Id', { FQuaQty: 10, MaterialId: { Id: 1064252 } });
  console.log(`  +MaterialId(Id): ${r.slice(0, 80)}`);

  // 5. +WorkCenterId
  r = await testFEntity('+WorkCenterId', { FQuaQty: 10, FMaterialId: { FNumber: 'FP010587' }, WorkCenterId: { Id: 188050 } });
  console.log(`  +WorkCenterId: ${r.slice(0, 80)}`);

  // 6. +OperNumber
  r = await testFEntity('+OperNumber', { FQuaQty: 10, FMaterialId: { FNumber: 'FP010587' }, WorkCenterId: { Id: 188050 }, OperNumber: 10 });
  console.log(`  +OperNumber: ${r.slice(0, 80)}`);

  // 7. +FUnitID
  r = await testFEntity('+FUnitID', { FQuaQty: 10, FMaterialId: { FNumber: 'FP010587' }, WorkCenterId: { Id: 188050 }, OperNumber: 10, FUnitID: { FNumber: 'Pcs' } });
  console.log(`  +FUnitID: ${r.slice(0, 80)}`);

  // 8. 完整组合
  r = await testFEntity('ALL', {
    FQuaQty: 10,
    FMaterialId: { FNumber: 'FP010587' },
    WorkCenterId: { Id: 188050 },
    OperNumber: 10,
    FUnitID: { FNumber: 'Pcs' },
    F_YJY_NewRealShop: { FNumber: 'BM000034' },
    F_FD_Operator: { Id: 1076533 },
    FD_Operator: { Id: 1076533 },
    F_FD_WorkTimes: 1,
    F_FD_AssistTimes: 0,
    Activity1Id: { Id: 40381 },
    Activity1Qty: 10,
    Seq: 1,
    MoNumber: 'YJYMO2605108',
    MoRowNumber: 1,
  });
  console.log(`  ALL: ${r.slice(0, 80)}`);
}

main().catch(e => console.error('FATAL', e));
