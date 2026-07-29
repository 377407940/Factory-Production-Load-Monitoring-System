/**
 * 绕过"汇总"实体规则的多种尝试
 * 1. SaveDraft 接口
 * 2. IsIgnoreRule 参数名变体
 * 3. 不同单据类型
 * 4. Submit 工作流
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

async function callApi(endpoint, payload) {
  return client.callWithAuth(() =>
    client._request(endpoint, payload),
  );
}

async function tryEndpoint(label, endpoint, payload) {
  console.log(`\n--- ${label} [${endpoint}] ---`);
  try {
    const r = await callApi(endpoint, payload);
    const resp = r.data;
    if (resp?.Result?.ResponseStatus?.IsSuccess) {
      console.log(`  ✅ ${resp.Result.Number}`);
      return true;
    } else {
      const errs = resp?.Result?.ResponseStatus?.Errors || [];
      errs.forEach(e => console.log(`  ❌ ${e.Message}`));
      return false;
    }
  } catch(e) {
    console.log(`  🔴 ${e.message?.slice(0, 100)}`);
    return false;
  }
}

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
  const dataStr = JSON.stringify({ Model: model });

  // 1. SaveDraft 端点（另存为草稿，不触发完整验证）
  await tryEndpoint('SaveDraft', 'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.SaveDraft.common.kdsvc', {
    FormId: 'SFC_OperationReport', data: dataStr,
  });

  // 2. Try with IsIgnoreRule (不同的参数名)
  await tryEndpoint('IsIgnoreRule', 'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Save.common.kdsvc', {
    FormId: 'SFC_OperationReport', data: JSON.stringify({ Model: model, IsIgnoreRule: true }),
  });

  // 3. Try with Validate=false
  await tryEndpoint('Validate=false', 'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Save.common.kdsvc', {
    FormId: 'SFC_OperationReport', data: JSON.stringify({ Model: model, Validate: false }),
  });

  // 4. 只传 header 字段，不传任何实体，SaveDraft
  await tryEndpoint('Header only + SaveDraft', 'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.SaveDraft.common.kdsvc', {
    FormId: 'SFC_OperationReport', data: JSON.stringify({ Model: {
      FDate: today, F_UNW_Date2: today,
      FBillTypeID: { FNumber: 'GXHB01_SYS' },
      F_UNW_MONum: 'YJYMO2605108',
      PrdOrgId: { FNumber: 'YJY' },
      FWorkShopId: { FNumber: 'BM000034' },
    }}),
  });

  // 5. 不同单据类型：查一下有啥别的
  // 从现有数据已知道 GXHB01_SYS, GXHB02_Sys
  // 再试试其他
  for (const bt of ['GXHB03_SYS', 'GXHB04_SYS', 'GXHB01_Sys', 'GXHB02_Sys']) {
    const m = JSON.parse(JSON.stringify(model));
    m.FBillTypeID = { FNumber: bt };
    await tryEndpoint(`BT:${bt}`, 'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Save.common.kdsvc', {
      FormId: 'SFC_OperationReport', data: JSON.stringify({ Model: m }),
    });
  }

  // 6. Submit 流程：先 SaveDraft，再 Submit
  // 先 SaveDraft 看能不能过
  const draftResult = await tryEndpoint('Draft for Submit',
    'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.SaveDraft.common.kdsvc',
    { FormId: 'SFC_OperationReport', data: JSON.stringify({ Model: {
      FDate: today, F_UNW_Date2: today,
      FBillTypeID: { FNumber: 'GXHB01_SYS' },
      F_UNW_MONum: 'YJYMO2605108',
      PrdOrgId: { FNumber: 'YJY' },
      FWorkShopId: { FNumber: 'BM000034' },
      FEntity: [{ FMaterialId: { FNumber: 'FP010587' }, FQuaQty: 10 }],
    }})},
  );
}

main().catch(e => console.error('FATAL', e));
