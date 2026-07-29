/**
 * FEntity 不触发规则的关键：
 * 1. F_FD_OperDescp 放在表头（不在 FEntity 内）
 * 2. FEntity 填上必填字段
 *
 * 从 View API 看 OptRptEntry 有什么字段，映射到 FEntity
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

  // 先看 YJYGXHB26060848 的 OptRptEntry 完整数据
  console.log('=== OptRptEntry 完整数据 (灌装) ===');
  const r1 = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
      { FormId: 'SFC_OperationReport', data: JSON.stringify({ Number: 'YJYGXHB26060848' }) },
    ),
  );
  const entry1 = r1.data?.Result?.Result?.OptRptEntry?.[0];
  if (entry1) {
    // 打印关键字段
    const keyFields = ['Id','Seq','MoNumber','MoRowNumber','OperNumber','PrdType',
      'MaterialId','UnitID','WorkCenterId','ProcessId',
      'QuaQty','FinishQty','TotalQuaQty',
      'F_FD_OperDescp','F_FD_AimProducts','F_FD_AimTimes',
      'F_YJY_loadTimes','F_YJY_NewRealShop',
      'F_FD_Machine','F_FD_Operator',
      'FD_Operator','F_YJY_OEE','F_YJY_equipSpeed',
      'F_UNW_WorkType','ShiftGroupId',
      'Activity1Qty','Activity1Id',
      'BaseUnitID','PrdUnitID',
    ];
    for (const k of keyFields) {
      if (entry1[k] !== undefined) console.log(`  ${k}:`, JSON.stringify(entry1[k]).slice(0, 100));
    }
  }

  // 看包装的
  console.log('\n=== OptRptEntry 完整数据 (包装) ===');
  const r2 = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
      { FormId: 'SFC_OperationReport', data: JSON.stringify({ Number: 'YJYGXHB26060859' }) },
    ),
  );
  const entry2 = r2.data?.Result?.Result?.OptRptEntry?.[0];
  if (entry2) {
    const keyFields = ['Id','Seq','MoNumber','MoRowNumber','OperNumber','PrdType',
      'MaterialId','UnitID','WorkCenterId','ProcessId',
      'QuaQty','FinishQty','TotalQuaQty',
      'F_FD_OperDescp','F_FD_AimProducts','F_FD_AimTimes',
      'F_YJY_loadTimes','F_YJY_NewRealShop',
      'F_FD_Machine','F_FD_Operator',
      'FD_Operator','F_YJY_OEE','F_YJY_equipSpeed',
      'F_UNW_WorkType','ShiftGroupId',
      'Activity1Qty','Activity1Id',
    ];
    for (const k of keyFields) {
      if (entry2[k] !== undefined) console.log(`  ${k}:`, JSON.stringify(entry2[k]).slice(0, 100));
    }
  }

  // 现在尝试创建 FEntity 带数据！
  const base = {
    FDate: today, F_UNW_Date2: today,
    FBillTypeID: { FNumber: 'GXHB01_SYS' },
    F_UNW_MONum: 'YJYMO2605108',
    PrdOrgId: { FNumber: 'YJY' },
    FWorkShopId: { FNumber: 'BM000034' },
    F_FD_OperDescp: '装盒&装箱',  // 表头！关键！
    OptRptEntry: [{
      FMaterialId: { FNumber: 'FP010587' },
      FQuaQty: 10,
    }],
  };

  // 1. FEntity 带最基础的字段
  // 从 View API 来看，OptRptEntry 有 WorkCenterId_Id, ProcessId_Id 等
  // WorkCenterId = ? 查一下
  console.log('\n=== 查 WorkCenter ===');
  const r3 = await client.callWithAuth(() =>
    client.executeBillQuery('BD_WORKCENTERCUSTOM', {  // 或者用 BD_WORKCENTER
      fieldKeys: ['FWorkCenterId', 'FNumber', 'FName'],
      skipDateFilter: true, limit: 5,
    }),
  );
  console.log('  WorkCenter:', JSON.stringify(r3.data).slice(0, 300));

  // 2. 试创建 FEntity 带合理数据
  await trySave('FEntity basic fields', {
    ...base,
    FEntity: [{
      FMaterialId: { FNumber: 'FP010587' },
      FQuaQty: 10,
      // 工作中心
      WorkCenterId: { FNumber: 'BM000034' },
      // 工序号
      FOperNumber: 10,
      // 单位
      FUnitID: { FNumber: 'Pcs' },
      // 计数方式
      // 当班实际车间
      F_YJY_NewRealShop: { FNumber: 'BM000034' },
      // 操作人员
      F_FD_Operator: '测试',
      // 工时
      F_FD_WorkTimes: 1,
      F_FD_AssistTimes: 0,
      // Activity 数量
      Activity1Qty: 10,
    }],
  });

  // 3. 简化版本：只试最关键字段
  await trySave('FEntity minimal+', {
    ...base,
    FEntity: [{
      FMaterialId: { FNumber: 'FP010587' },
      FQuaQty: 10,
    }],
  });
}

main().catch(e => console.error('FATAL', e));
