/**
 * FEntity 字段格式修正
 * F_FD_Operator 需要对象格式
 * 计数方式可能是标头字段 FPrdType
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
    errs.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 200)}`));
    return false;
  }
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  const base = {
    FDate: today, F_UNW_Date2: today,
    FBillTypeID: { FNumber: 'GXHB01_SYS' },
    F_UNW_MONum: 'YJYMO2605108',
    PrdOrgId: { FNumber: 'YJY' },
    FWorkShopId: { FNumber: 'BM000034' },
    F_FD_OperDescp: '装盒&装箱',  // 表头，不含"灌装"→ 规则不触发
    OptRptEntry: [{
      FMaterialId: { FNumber: 'FP010587' },
      FQuaQty: 10,
    }],
  };

  // 1. F_FD_Operator 用对象格式，加其他必填
  await trySave('FEntity with object operator', {
    ...base,
    FPrdType: '1',  // 计数方式（猜的）
    FEntity: [{
      FMaterialId: { FNumber: 'FP010587' },
      FQuaQty: 10,
      FOperNumber: 10,
      // 操作人员用对象
      F_FD_Operator: { Id: 1076533 },
      FD_Operator: { Id: 1076533 },
      // 当班实际车间
      F_YJY_NewRealShop: { FNumber: 'BM000034' },
      // 工作中心
      WorkCenterId: { Id: 188049 },
      // 单位
      FUnitID: { FNumber: 'Pcs' },
      // 工时
      F_FD_WorkTimes: 1,
      F_FD_AssistTimes: 0,
      // 活动
      Activity1Id: { Id: 40381 },
      Activity1Qty: 10,
    }],
  });

  // 2. 试试 PrdType 表头
  await trySave('With PrdType header', {
    ...base,
    PrdType: '1',
    FEntity: [{
      FMaterialId: { FNumber: 'FP010587' },
      FQuaQty: 10,
    }],
  });

  // 3. 查计数方式字段名 - 试几个常见名
  for (const field of ['FCountMethod', 'FCounter', 'FPrdType', 'FCountType', 'FCalcMethod']) {
    try {
      const r = await client.callWithAuth(() =>
        client.executeBillQuery('SFC_OperationReport', {
          fieldKeys: ['FBillNo', field],
          filter: "FBillNo='YJYGXHB26060848'", skipDateFilter: true, limit: 1,
        }),
      );
      console.log(`\n  ${field}:`, JSON.stringify(r.data).slice(0, 100));
    } catch(e) {
      // skip
    }
  }

  // 4. 对比两地 records 的 differnece
  console.log('\n=== 表头字段差异 ===');
  // 从已有记录看 FPrdType 是否存在
  const r = await client.callWithAuth(() =>
    client.executeBillQuery('SFC_OperationReport', {
      fieldKeys: ['FBillNo', 'FPrdType'],
      filter: "FBillNo='YJYGXHB26060848'", skipDateFilter: true, limit: 1,
    }),
  );
  console.log('  FPrdType:', JSON.stringify(r.data).slice(0, 100));
}

main().catch(e => console.error('FATAL', e));
