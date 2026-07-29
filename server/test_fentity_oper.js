/**
 * 解决"工序序列是必填项"：
 * 先查已有包装记录看 FEntity 字段名
 * 然后试 FOperNumber（带 F 前缀）
 * 使用包装的 MO（YJYMO2603133, FP010580）
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

async function trySave(label, model) {
  console.log(`\n--- ${label} ---`);
  const r = await client.save('SFC_OperationReport', model);
  const resp = r.data;
  if (resp?.Result?.ResponseStatus?.IsSuccess) {
    console.log(`  ✅ ${resp.Result.Number}`);
    return true;
  } else {
    const errs = resp?.Result?.ResponseStatus?.Errors || [];
    errs.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 250)}`));
    return false;
  }
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  // 1. 看包装记录 YJYGXHB26060859 的 View 完整数据，特别看 FEntity 和相关字段名
  console.log('=== 查看包装记录完整 View ===');
  const r = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
      { FormId: 'SFC_OperationReport', data: JSON.stringify({ Number: 'YJYGXHB26060859' }) },
    ),
  );
  const record = r.data?.Result?.Result;
  if (record) {
    // FEntity 在不在？
    console.log('  Has FEntity?', !!record.FEntity);
    if (record.FEntity) {
      console.log('  FEntity:', JSON.stringify(record.FEntity).slice(0, 500));
    }
    // 看 OptRptEntry 完整字段
    const entry = record.OptRptEntry?.[0];
    if (entry) {
      console.log('  OptRptEntry keys:', Object.keys(entry).join(', '));
      // 特别关注工序序列相关字段
      for (const k of Object.keys(entry)) {
        const kLower = k.toLowerCase();
        if (kLower.includes('oper') || kLower.includes('seq') || kLower.includes('工序') || kLower.includes('step') || kLower.includes('process')) {
          console.log(`  ${k}:`, JSON.stringify(entry[k]).slice(0, 100));
        }
      }
      // MoNumber
      console.log('  MoNumber:', entry.MoNumber);
      console.log('  MaterialId:', JSON.stringify(entry.MaterialId));
      // 打印所有数值字段
      for (const k of Object.keys(entry)) {
        const v = entry[k];
        if (typeof v === 'number' || typeof v === 'string' && !isNaN(Number(v))) {
          console.log(`  ${k} = ${v}`);
        }
      }
    }
  }

  // 2. 从 View 结果看到 OptRptEntry 的 OperNumber=10
  // 试 FOperNumber + FWorkCenterId
  const base = {
    FDate: today,
    F_UNW_Date2: today,
    FBillTypeID: { FNumber: 'GXHB01_SYS' },
    F_UNW_MONum: 'YJYMO2603133',    // 包装的 MO
    PrdOrgId: { FNumber: 'YJY' },
    FWorkShopId: { FNumber: 'BM000034' },
    F_FD_OperDescp: '装盒&装箱',      // 表头，不含"灌装"
    OptRptEntry: [{
      FMaterialId: { FNumber: 'FP010580' },  // 包装的物料
      FQuaQty: 10,
    }],
  };

  // 试各种"工序序列"字段名
  const operFieldTests = [
    { FOperNumber: 10 },
    { OperNumber: 10 },
    { FSequence: 10 },
    { Sequence: 10 },
    { FProcessStep: 10 },
    { FOperStep: 10 },
    { FOperSequence: 10 },
    { FOperSeq: 10 },
  ];

  for (const extra of operFieldTests) {
    const fieldName = Object.keys(extra)[0];
    await trySave(`${fieldName}=10`, {
      ...base,
      FEntity: [{
        FQuaQty: 10,
        FMaterialId: { FNumber: 'FP010580' },
        FWorkCenterId: { FNumber: 'WC000003' },
        FUnitID: { FNumber: 'Pcs' },
        ...extra,
      }],
    });
  }

  // 3. 如果上面都不行，试 Seq 和 OperNumber 组合
  await trySave('FOperNumber=10 Seq=1', {
    ...base,
    FEntity: [{
      FQuaQty: 10,
      FMaterialId: { FNumber: 'FP010580' },
      FWorkCenterId: { FNumber: 'WC000003' },
      FUnitID: { FNumber: 'Pcs' },
      FOperNumber: 10,
      Seq: 1,
    }],
  });

  // 4. 完整版
  await trySave('FULL with FOperNumber', {
    ...base,
    FEntity: [{
      FQuaQty: 10,
      FMaterialId: { FNumber: 'FP010580' },
      FWorkCenterId: { FNumber: 'WC000003' },
      FOperNumber: 10,
      Seq: 1,
      MoNumber: 'YJYMO2603133',
      MoRowNumber: 1,
      FUnitID: { FNumber: 'Pcs' },
      F_YJY_NewRealShop: { FNumber: 'BM000034' },
      F_FD_Operator: { Id: 1076533 },
      F_FD_WorkTimes: 1,
      F_FD_AssistTimes: 0,
      Activity1Id: { Id: 40381 },
      Activity1Qty: 10,
    }],
  });

  // 5. 如果包装的还不行，查 FBillNo=YJYGXHB26060848（灌装）的 OptRptEntry OperNumber 值
  console.log('\n=== 查 FBillNo=YJYGXHB26060859 的 OperNumber ===');
  const r2 = await client.callWithAuth(() =>
    client.executeBillQuery('SFC_OperationReport', {
      fieldKeys: ['FBillNo', 'FOperNumber', 'FSeq'],
      filter: "FBillNo='YJYGXHB26060859'",
      skipDateFilter: true, limit: 1,
    }),
  );
  console.log('  Query result:', JSON.stringify(r2.data).slice(0, 300));
}

main().catch(e => console.error('FATAL', e));
