/**
 * 继续探查 SFC Save：WorkShopId 字段名 + "汇总" 实体
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
    errs.forEach(e => console.log(`  ❌ ${e.Message}`));
    return false;
  }
}

async function trySaveModel(label, model) {
  // 直接按金蝶 raw 格式：{ Model: ... }
  console.log(`\n--- ${label} ---`);
  const r = await client._request(
    'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Save.common.kdsvc',
    { FormId: 'SFC_OperationReport', data: JSON.stringify({ Model: model }) },
  );
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
  const base = {
    FDate: today, F_UNW_Date2: today,
    F_UNW_MONum: 'YJYMO2605108',
    PrdOrgId: { FNumber: 'YJY' },
    FBillTypeID: { FNumber: 'GXHB01_SYS' },
    OptRptEntry: [{ FMaterialId: { FNumber: 'FP010587' }, FQuaQty: 10 }],
  };

  // 1. 试试 WorkShopId（小写d）
  await trySave('WorkShopId with FNumber', { ...base, WorkShopId: { FNumber: 'BM000046' } });
  await trySave('WorkShopId with Id', { ...base, WorkShopId: { Id: 187423 } });

  // 2. 试试 FWorkShopId（带F前缀）
  await trySave('FWorkShopId with Id', { ...base, FWorkShopId: { Id: 187423 } });
  await trySave('FWorkShopId raw int', { ...base, FWorkShopId: 187423 });

  // 3. 分行测试：先只解决字段，把 WorkShopId 放一边
  // 看看能不能用其他方式跳过加工车间
  await trySave('FWorkShopId + raw number, skip entity test', {
    FDate: today, F_UNW_Date2: today,
    FBillTypeID: { FNumber: 'GXHB01_SYS' },
    PrdOrgId: { FNumber: 'YJY' },
    OptRptEntry: [{ FMaterialId: { FNumber: 'FP010587' }, FQuaQty: 10 }],
    FWorkShopId: 187423,
    OptRptSummary: [{ FQuaQty: 10 }],  // 猜汇总实体
  });

  // 4. 猜各种可能的汇总实体名
  const entityGuesses = [
    'Summary', 'FSummary', 'SummaryEntity', 'TotalEntity',
    'OptRptSummary', 'RptSummary', 'FHuizong', 'ReportSummary',
    'OptRptTotal', 'FEntity_Summary', 'FEntity_HZ',
    'FHuizongEntry', 'HuiZong', 'FHzEntry',
  ];
  for (const ent of entityGuesses) {
    const m = JSON.parse(JSON.stringify(base));
    m[ent] = [{ FQuaQty: 10 }];
    // 直接发，看错误变化
    try {
      const r = await client.save('SFC_OperationReport', m);
      const resp = r.data;
      const errs = resp?.Result?.ResponseStatus?.Errors || [];
      const msg = errs.map(e => e.Message).join('; ').slice(0, 120);
      if (msg.includes('汇总')) {
        // still the same error
      } else if (msg.includes('成功') || resp?.Result?.ResponseStatus?.IsSuccess) {
        console.log(`\n--- ${ent} --- ✅ SUCCESS!`);
      } else {
        console.log(`\n--- ${ent} --- changed: ${msg}`);
      }
    } catch(e) {
      // network error, skip
    }
  }

  // 5. 查一下 SFC_OperationReport 的子表有哪些
  console.log('\n=== SFC 全部字段探测（查一条全部字段） ===');
  // 不限制字段，看金蝶返回什么
  const r2 = await client.callWithAuth(() =>
    client.executeBillQuery('SFC_OperationReport', {
      fieldKeys: ['FBillNo', 'FDate', 'FMoNumber', 'FID', 'FEntryId', 'FEntity_FEntryId'],
      filter: "FBillNo='YJYGXHB26060848'", skipDateFilter: true, limit: 1,
    }),
  );
  console.log('  headers:', JSON.stringify(r2.data?.Result || r2.data));
}

main().catch(e => console.error('FATAL', e));
