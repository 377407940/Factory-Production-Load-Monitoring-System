/**
 * 调试 SaveDraft 响应 + 其他绕过尝试
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
  };

  // 1. 看看 SaveDraft 到底返回什么
  console.log('=== SaveDraft raw response ===');
  const r1 = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.SaveDraft.common.kdsvc',
      { FormId: 'SFC_OperationReport', data: JSON.stringify({ Model: {
        ...model,
        FEntity: [{ FMaterialId: { FNumber: 'FP010587' }, FQuaQty: 10 }],
      }})},
    ),
  );
  console.log('  SaveDraft raw:', JSON.stringify(r1.data).slice(0, 500));

  // 2. 试试用 DragDrop 或另一个端点 Endpoint
  console.log('\n=== 直接调用 View 端点 ===');
  try {
    const r2 = await client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
      { data: JSON.stringify({ FormId: 'SFC_OperationReport', Number: 'YJYGXHB26060848' }) },
    );
    console.log('  View result:', JSON.stringify(r2.data).slice(0, 500));
  } catch(e) {
    console.log('  View error:', e.message?.slice(0, 100));
  }

  // 3. 试试单据类型参数的精确写法
  // 现有数据确认 FBillTypeID.FNumber = GXHB01_SYS
  // 文档：FBillTypeID 格式为 { FNumber: 'xxx' }

  // 4. 尝试不带 FEntity，看看 SaveDraft 是否跳过
  console.log('\n=== SaveDraft without FEntity ===');
  const r4 = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.SaveDraft.common.kdsvc',
      { FormId: 'SFC_OperationReport', data: JSON.stringify({ Model: {
        ...model,
        OptRptEntry: [{ FMaterialId: { FNumber: 'FP010587' }, FQuaQty: 10 }],
      }})},
    ),
  );
  console.log('  SaveDraft without FEntity:', JSON.stringify(r4.data).slice(0, 500));

  // 5. 尝试在"汇总"实体中用报表级字段名（金蝶某些版本支持报表字段前缀）
  // 规则在 FEntity 上找 F_FD_OperDescp, 但可能在 FEntity 中需要 F_FD_OperDescp 以不同格式
  console.log('\n=== FEntity with all known OptRptEntry fields ===');
  const r5 = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Save.common.kdsvc',
      { FormId: 'SFC_OperationReport', data: JSON.stringify({ Model: {
        ...model,
        FEntity: [{
          FMaterialId: { FNumber: 'FP010587' },
          FQuaQty: 10,
          // Even though FEntity doesn't have these fields, try setting them
          F_FD_OperDescp: '液体灌装',
          F_FD_AimProducts: 22176,
          F_FD_AimTimes: 3.08,
        }],
      }})},
    ),
  );
  console.log('  FEntity with fields:', JSON.stringify(r5.data?.Result?.ResponseStatus?.Errors || r5.data).slice(0, 500));
}

main().catch(e => console.error('FATAL', e));
