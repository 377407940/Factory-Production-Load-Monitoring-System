/**
 * 查工序计划是否存在 + 试不同方法
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

async function call(action, payload) {
  const r = await client.callWithAuth(() =>
    client._request(action, payload),
  );
  return r.data;
}

async function main() {
  // 1. 查 MO 的 TreeEntity 完整工序
  console.log('=== MO TreeEntity 完整 ===');
  const r1 = await call(
    'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
    { FormId: 'PRD_MO', data: JSON.stringify({ Number: 'YJYMO2603133', EntityKey: 'TreeEntity' }) },
  );
  const tree = r1?.Result?.Result;
  if (Array.isArray(tree)) {
    for (let i = 0; i < tree.length; i++) {
      // 找工序相关字段
      const item = tree[i];
      const operRelated = {};
      for (const k of Object.keys(item)) {
        if (k.toLowerCase().includes('oper') || k.toLowerCase().includes('process') || k.toLowerCase().includes('route') || k.toLowerCase().includes('seq')) {
          operRelated[k] = typeof item[k] === 'object' ? JSON.stringify(item[k]).slice(0, 80) : item[k];
        }
      }
      console.log(`  [${i}] OperRelated:`, JSON.stringify(operRelated).slice(0, 400));
    }
  }

  // 2. 查 ProcessId / RouteListing 子实体
  // TreeEntity 可能还挂有子工序表
  if (Array.isArray(tree) && tree.length > 0) {
    const first = tree[0];
    const subEntities = Object.keys(first).filter(k => Array.isArray(first[k]));
    if (subEntities.length > 0) {
      console.log('\n=== TreeEntity 子实体 ===');
      for (const se of subEntities) {
        console.log(`  ${se}: ${first[se].length} rows`);
        if (first[se][0]) {
          console.log(`    keys: ${Object.keys(first[se][0]).slice(0, 10).join(', ')}`);
        }
      }
    }
  }

  // 3. 查打包记录的 OptRptDetail - 看完整
  console.log('\n=== 查 OptRptDetail (完整) ===');
  try {
    const r3 = await call(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
      { FormId: 'SFC_OperationReport', data: JSON.stringify({ Number: 'YJYGXHB26060859', EntityKey: 'OptRptDetail' }) },
    );
    const details = r3?.Result?.Result;
    console.log('  Type:', typeof details, Array.isArray(details) ? `Array[${details.length}]` : '');
    if (Array.isArray(details)) {
      for (let i = 0; i < details.length; i++) {
        console.log(`  [${i}]:`, JSON.stringify(details[i]).slice(0, 300));
      }
    } else {
      console.log('  Result:', JSON.stringify(details).slice(0, 300));
    }
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 4. 用 OperNumber 对象数组格式
  console.log('\n=== Save with FOperNumber as complex obj ===');
  const today = new Date().toISOString().slice(0, 10);
  const base = {
    FDate: today, F_UNW_Date2: today,
    FBillTypeID: { FNumber: 'GXHB01_SYS' },
    F_UNW_MONum: 'YJYMO2603133',
    PrdOrgId: { FNumber: 'YJY' },
    FWorkShopId: { FNumber: 'BM000034' },
    F_FD_OperDescp: '装盒&装箱',
    OptRptEntry: [{ FMaterialId: { FNumber: 'FP010580' }, FQuaQty: 10 }],
    FEntity: [{
      FSeqNumber: "0",
      // 尝试用 OptPlanSeqId 做 FOperNumber
      FOperNumber: 10,
      FQuaQty: 10,
      FMaterialId: { FNumber: 'FP010580' },
      FWorkCenterId: { FNumber: 'WC000004' },
      FUnitID: { FNumber: 'Pcs' },
      MoRowNumber: 1,
      MoNumber: 'YJYMO2603133',
    }],
  };

  const r4 = await call(
    'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Save.common.kdsvc',
    { FormId: 'SFC_OperationReport', data: JSON.stringify({ Model: base }) },
  );
  const r4s = r4?.Result?.ResponseStatus;
  if (r4s?.IsSuccess) {
    console.log(`  ✅ ${r4?.Result?.Number}`);
  } else {
    const errs = r4s?.Errors || [];
    errs.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 300)}`));
  }

  // 5. 关键测试：走 Draft→Save(不带 FOperNumber)→Submit
  // 但这次 Draft 用最好的数据
  console.log('\n=== Draft → Submit 简化版 ===');
  const rD = await call(
    'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Draft.common.kdsvc',
    {
      FormId: 'SFC_OperationReport',
      data: JSON.stringify({
        Model: {
          ...base,
          FEntity: [{
            FSeqNumber: "0",
            FOperNumber: { Id: 120719 },  // 已知可用的工序ID
            FQuaQty: 10,
            FMaterialId: { FNumber: 'FP010580' },
            FWorkCenterId: { FNumber: 'WC000004' },
            FUnitID: { FNumber: 'Pcs' },
            MoRowNumber: 1,
            MoNumber: 'YJYMO2603133',
          }],
          // 加表头其他必填
          FPrdType: '1',  // 计数方式试试
        },
      }),
    },
  );
  const draftId = rD?.Result?.Id;
  console.log(`  Draft Id: ${draftId}`);

  if (draftId) {
    // 查 Draft 完整数据
    const rV = await call(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
      { FormId: 'SFC_OperationReport', data: JSON.stringify({ Id: draftId }) },
    );
    const draftRecord = rV?.Result?.Result;
    if (draftRecord) {
      console.log(`  BillNo: "${draftRecord.BillNo}", Status: "${draftRecord.DocumentStatus}"`);
      if (draftRecord.FEntity) {
        console.log(`  FEntity:`, JSON.stringify(draftRecord.FEntity).slice(0, 500));
      }
    }

    // 试试 Submit 不传 CreateOnly
    console.log(`  Submit without CreateOnly...`);
    const rSub = await call(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Submit.common.kdsvc',
      {
        FormId: 'SFC_OperationReport',
        data: JSON.stringify({ Ids: String(draftId) }),
      },
    );
    console.log(`  Submit:`, JSON.stringify(rSub?.Result?.ResponseStatus).slice(0, 400));

    // Submit 用另一个格式
    const rSub2 = await call(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Submit.common.kdsvc',
      {
        FormId: 'SFC_OperationReport',
        Data: JSON.stringify({ Ids: String(draftId) }),
      },
    );
    console.log(`  Submit(Data):`, JSON.stringify(rSub2?.Result?.ResponseStatus).slice(0, 400));
  }
}

main().catch(e => console.error('FATAL', e));
