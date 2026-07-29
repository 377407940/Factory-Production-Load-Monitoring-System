/**
 * FSeqNumber 就是"工序序列"！
 * 现在试 FSeqNumber + FOperNumber 组合
 * 以及其他必填
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

async function trySave(label, model) {
  console.log(`\n--- ${label} ---`);
  console.log(`  FEntity keys: ${Object.keys(model.FEntity?.[0] || {}).join(', ')}`);
  const r = await client.save('SFC_OperationReport', model);
  const resp = r.data;
  if (resp?.Result?.ResponseStatus?.IsSuccess) {
    console.log(`  ✅ ${resp.Result.Number}`);
    return true;
  } else {
    const errs = resp?.Result?.ResponseStatus?.Errors || [];
    errs.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 300)}`));
    return false;
  }
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const base = {
    FDate: today, F_UNW_Date2: today,
    FBillTypeID: { FNumber: 'GXHB01_SYS' },
    F_UNW_MONum: 'YJYMO2603133',
    PrdOrgId: { FNumber: 'YJY' },
    FWorkShopId: { FNumber: 'BM000034' },
    F_FD_OperDescp: '装盒&装箱',
    OptRptEntry: [{ FMaterialId: { FNumber: 'FP010580' }, FQuaQty: 10 }],
  };

  // 1. FSeqNumber + FOperNumber + 所有已知字段
  // 注意：FSeqNumber 必须是字符串 "0"（从 OptRptEntry 的 SeqNumber 得到）
  await trySave('FSeqNumber="0" + FOperNumber=10 + all', {
    ...base,
    FEntity: [{
      FSeqNumber: "0",
      FOperNumber: 10,
      FQuaQty: 10,
      FMaterialId: { FNumber: 'FP010580' },
      FWorkCenterId: { FNumber: 'WC000003' },
      FUnitID: { FNumber: 'Pcs' },
      Seq: 1,
      MoNumber: 'YJYMO2603133',
      MoRowNumber: 1,
    }],
  });

  // 2. FSeqNumber + FOperNumber + MoRowNumber (最小组合)
  await trySave('FSeqNumber FOperNumber minimal', {
    ...base,
    FEntity: [{
      FSeqNumber: "0",
      FOperNumber: 10,
      FQuaQty: 10,
      FMaterialId: { FNumber: 'FP010580' },
      FWorkCenterId: { FNumber: 'WC000003' },
      FUnitID: { FNumber: 'Pcs' },
      MoRowNumber: 1,
    }],
  });

  // 3. FSeqNumber only (no FOperNumber)
  await trySave('FSeqNumber only (no FOperNumber)', {
    ...base,
    FEntity: [{
      FSeqNumber: "0",
      FQuaQty: 10,
      FMaterialId: { FNumber: 'FP010580' },
      FWorkCenterId: { FNumber: 'WC000003' },
      FUnitID: { FNumber: 'Pcs' },
      MoRowNumber: 1,
    }],
  });

  // 4. 完整版！所有字段
  await trySave('FULL with FSeqNumber + FOperNumber', {
    ...base,
    FEntity: [{
      FSeqNumber: "0",
      FOperNumber: 10,
      FQuaQty: 10,
      FMaterialId: { FNumber: 'FP010580' },
      FWorkCenterId: { FNumber: 'WC000003' },
      FUnitID: { FNumber: 'Pcs' },
      Seq: 1,
      MoNumber: 'YJYMO2603133',
      MoRowNumber: 1,
      F_YJY_NewRealShop: { FNumber: 'BM000034' },
      F_FD_Operator: { Id: 1076533 },
      FD_Operator: { Id: 1076533 },
      F_FD_WorkTimes: 1,
      F_FD_AssistTimes: 0,
      Activity1Id: { Id: 40381 },
      Activity1Qty: 10,
    }],
  });
}

main().catch(e => console.error('FATAL', e));
