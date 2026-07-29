/**
 * 绕过服务规则 - 用 IgnoreRule 选项跳过 FEntity 上的问题规则
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const model = {
    FDate: today, F_UNW_Date2: today,
    FBillTypeID: { FNumber: 'GXHB01_SYS' },
    F_UNW_MONum: 'YJYMO2605108',
    PrdOrgId: { FNumber: 'YJY' },
    FWorkShopId: { FNumber: 'BM000034' },
    // FEntity = "汇总" 实体，必须传
    FEntity: [{
      FMaterialId: { FNumber: 'FP010587' },
      FQuaQty: 10,
    }],
    // 或者 OptRptEntry 是明细分录
    OptRptEntry: [{
      FMaterialId: { FNumber: 'FP010587' },
      FQuaQty: 10,
    }],
  };

  // 1. 标准 Save 带 IgnoreRule
  console.log('=== IgnoreRule=true ===');
  const r1 = await client._request(
    'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Save.common.kdsvc',
    {
      FormId: 'SFC_OperationReport',
      data: JSON.stringify({
        Model: model,
        IgnoreRule: true,
      }),
    },
  );
  const resp1 = r1.data;
  if (resp1?.Result?.ResponseStatus?.IsSuccess) {
    console.log(`  ✅ ${resp1.Result.Number}`);
  } else {
    const errs = resp1?.Result?.ResponseStatus?.Errors || [];
    errs.forEach(e => console.log(`  ❌ ${e.Message}`));
  }

  // 2. 试试另一种方法: 用 save 方法传 options
  console.log('\n=== save with { ignoreRule: true } ===');
  const r2 = await client.save('SFC_OperationReport', model, { ignoreRule: true });
  const resp2 = r2.data;
  if (resp2?.Result?.ResponseStatus?.IsSuccess) {
    console.log(`  ✅ ${resp2.Result.Number}`);
  } else {
    const errs = resp2?.Result?.ResponseStatus?.Errors || [];
    errs.forEach(e => console.log(`  ❌ ${e.Message}`));
  }

  // 3. 尝试另一种绕过：不传 FEntity，但也用 IgnoreRule
  console.log('\n=== 无 FEntity + IgnoreRule ===');
  const { FEntity, ...modelNoFE } = model;
  const r3 = await client._request(
    'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Save.common.kdsvc',
    {
      FormId: 'SFC_OperationReport',
      data: JSON.stringify({
        Model: modelNoFE,
        IgnoreRule: true,
      }),
    },
  );
  const resp3 = r3.data;
  if (resp3?.Result?.ResponseStatus?.IsSuccess) {
    console.log(`  ✅ ${resp3.Result.Number}`);
  } else {
    const errs = resp3?.Result?.ResponseStatus?.Errors || [];
    errs.forEach(e => console.log(`  ❌ ${e.Message}`));
  }

  // 4. 试试 IgnoreInteraction = true
  console.log('\n=== IgnoreInteraction + IgnoreRule ===');
  const r4 = await client._request(
    'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Save.common.kdsvc',
    {
      FormId: 'SFC_OperationReport',
      data: JSON.stringify({
        Model: model,
        IgnoreRule: true,
        IgnoreInteraction: true,
      }),
    },
  );
  const resp4 = r4.data;
  if (resp4?.Result?.ResponseStatus?.IsSuccess) {
    console.log(`  ✅ ${resp4.Result.Number}`);
  } else {
    const errs = resp4?.Result?.ResponseStatus?.Errors || [];
    errs.forEach(e => console.log(`  ❌ ${e.Message}`));
  }
}

main().catch(e => console.error('FATAL', e));
