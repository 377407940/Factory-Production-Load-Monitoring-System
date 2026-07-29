/**
 * 最后一批尝试
 * 1. IgnoreRule 放在外层(data外)
 * 2. 用 UnAudit 直接反审核一条已有单据
 * 3. 尝试用不同的实体字段名映射
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
    FEntity: [{ FMaterialId: { FNumber: 'FP010587' }, FQuaQty: 10 }],
  };

  // 1. IgnoreRule 放外层 (与 FormId 同级)
  console.log('=== IgnoreRule top-level ===');
  const r1 = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Save.common.kdsvc',
      {
        FormId: 'SFC_OperationReport',
        IgnoreRule: true,
        data: JSON.stringify({ Model: model }),
      },
    ),
  );
  console.log('  Result:', JSON.stringify(r1.data?.Result?.ResponseStatus).slice(0, 300));

  // 2. 用 Number 更新已有单据
  console.log('\n=== Update existing with IgnoreRule ===');
  const r2 = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Save.common.kdsvc',
      {
        FormId: 'SFC_OperationReport',
        data: JSON.stringify({
          Model: {
            FBillTypeID: { FNumber: 'GXHB01_SYS' },
            F_UNW_MONum: 'YJYMO2605108',
            Number: 'YJYGXHB26060848',  // 更新已有单据
            FEntity: [{ FMaterialId: { FNumber: 'FP010587' }, FQuaQty: 10 }],
          },
          IgnoreRule: true,
        }),
      },
    ),
  );
  console.log('  Update:', JSON.stringify(r2.data?.Result?.ResponseStatus).slice(0, 300));

  // 3. 用 Operation=SaveDraft 参数
  // 有些金蝶版本用 Operation 参数指定 draft
  console.log('\n=== Save with Operation=SaveDraft ===');
  const r3 = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Save.common.kdsvc',
      {
        FormId: 'SFC_OperationReport',
        data: JSON.stringify({ Model: model, Operation: 'SaveDraft' }),
      },
    ),
  );
  console.log('  Result:', JSON.stringify(r3.data?.Result?.ResponseStatus).slice(0, 300));

  // 4. 使用 NeedReturnFields 包含 IgnoreRule
  console.log('\n=== With all known options ===');
  const r4 = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Save.common.kdsvc',
      {
        FormId: 'SFC_OperationReport',
        data: JSON.stringify({
          Model: model,
          IgnoreRule: true,
          IgnoreInteraction: true,
          IsIgnoreRule: true,
          NeedReturnFields: ['FBillNo', 'FID'],
        }),
      },
    ),
  );
  console.log('  Result:', JSON.stringify(r4.data?.Result?.ResponseStatus).slice(0, 300));

  // 5. 用 FC 风格参数名
  console.log('\n=== FC style params ===');
  const r5 = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Save.common.kdsvc',
      {
        FormId: 'SFC_OperationReport',
        data: JSON.stringify({
          Model: model,
          IsIgnoreRule: 'true',
          IgnoreInteraction: 'true',
        }),
      },
    ),
  );
  console.log('  Result:', JSON.stringify(r5.data?.Result?.ResponseStatus).slice(0, 300));
}

main().catch(e => console.error('FATAL', e));
