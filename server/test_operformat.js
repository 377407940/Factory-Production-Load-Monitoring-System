/**
 * FOperNumber 验证不通过的根因测试
 * 可能是：字段格式需要对象引用，或需要特定的值
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

  // 1. FOperNumber as object with FNumber
  await trySave('FOperNumber={FNumber:"10"}', {
    ...base,
    FEntity: [{
      FSeqNumber: "0",
      FOperNumber: { FNumber: "10" },
      FQuaQty: 10,
      FMaterialId: { FNumber: 'FP010580' },
      FWorkCenterId: { FNumber: 'WC000003' },
      FUnitID: { FNumber: 'Pcs' },
      MoRowNumber: 1,
    }],
  });

  // 2. Just skip FOperNumber entirely, see if FSeqNumber + MoRowNumber + FWorkCenterId
  // can let the system auto-calculate
  await trySave('No FOperNumber with FSeqNumber', {
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

  // 3. Try only the fields that exist on OptRptEntry and DON'T have FEntity at all
  // but use a different approach: set FEntity as empty array
  await trySave('FEntity=[] empty array', {
    ...base,
    FEntity: [],
  });

  // 4. Try FEntity as null
  await trySave('FEntity=null', {
    ...base,
    FEntity: null,
  });

  // 5. FOperNumber with a much higher number
  await trySave('FOperNumber=1000', {
    ...base,
    FEntity: [{
      FSeqNumber: "0",
      FOperNumber: 1000,
      FQuaQty: 10,
      FMaterialId: { FNumber: 'FP010580' },
      FWorkCenterId: { FNumber: 'WC000003' },
      FUnitID: { FNumber: 'Pcs' },
      MoRowNumber: 1,
    }],
  });

  // 6. Critical: what if FOperNumber needs to be sent as part of
  // a sub-object? Like FOperNumber_Number or similar.
  // Let me try with the exact format from the other packaging record

  // First, let's query the existing record's FEntity_Link for reference
  console.log('\n=== 查 FEntity_Link 所有字段 ===');
  try {
    const r = await client.callWithAuth(() =>
      client.executeBillQuery('SFC_OperationReport', {
        fieldKeys: ['FBillNo', 'FSeq', 'FSeqNumber', 'FMoRowNumber', 'FOperNumber', 'FMoNumber'],
        filter: "FBillNo='YJYGXHB26060859'",
        skipDateFilter: true, limit: 1,
      }),
    );
    console.log('  Result:', JSON.stringify(r.data).slice(0, 300));
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 7. Try F_YJY_OperNumber or other variants
  await trySave('FOperStepNumber=10', {
    ...base,
    FEntity: [{
      FSeqNumber: "0",
      FOperStepNumber: 10,
      FQuaQty: 10,
      FMaterialId: { FNumber: 'FP010580' },
      FWorkCenterId: { FNumber: 'WC000003' },
      FUnitID: { FNumber: 'Pcs' },
      MoRowNumber: 1,
    }],
  });

  // 8. What if OperNumber (without F) IS "工序序列"?
  // We assumed FSeqNumber = 工序序列 based on "工序序列是必填项" disappearing,
  // but maybe the real field is something else
  // Let me try with higher resolution on what changed
  // The errors WITHOUT any seq field:
  //   工序序列是必填项
  //   工作中心是必填项
  //   产品编码是必填项
  // The errors WITH FSeqNumber="0" ONLY:
  //   工作中心是必填项 (we didn't include it)
  //   NO 工序序列
  //   NO 产品编码
  // So FSeqNumber="0" somehow satisfied both 工序序列 AND 产品编码

  // BUT: when we include ALL fields (with FSeqNumber="0") we STILL get
  // "工序号超出范围" because FOperNumber is 0 (default)

  // What if FSeqNumber actually auto-loads the process data from MO,
  // and FOperNumber is then supposed to be auto-filled?
  // But since we're providing it, it conflicts?

  await trySave('FSeqNumber="0" + no FOperNumber + all fields', {
    ...base,
    FEntity: [{
      FSeqNumber: "0",
      FQuaQty: 10,
      FMaterialId: { FNumber: 'FP010580' },
      FWorkCenterId: { FNumber: 'WC000003' },
      FUnitID: { FNumber: 'Pcs' },
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
