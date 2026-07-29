/**
 * 最后尝试：用 Data (大写D) 参数提交草稿
 * 以及试 UnAuditSubmit / 其他流程 API
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

/** 调用金蝶 API */
async function call(servicePath, payload) {
  try {
    const r = await client.callWithAuth(() =>
      client._request(servicePath, payload),
    );
    return r.data;
  } catch(e) {
    return { error: e.message };
  }
}

async function main() {
  // 先查之前 Draft 的 Id=207121 (FOperNumber Id 格式的草稿)
  const draftId = 207121;

  // 1. Submit 通过 Data (大写 D) 参数
  console.log('=== Submit via Data(D) ===');
  const r1 = await call(
    'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Submit.common.kdsvc',
    { FormId: 'SFC_OperationReport', Data: JSON.stringify({ Ids: String(draftId) }) },
  );
  const rs1 = r1?.Result?.ResponseStatus;
  if (rs1?.IsSuccess) {
    console.log('  ✅');
  } else {
    const errs = rs1?.Errors || [];
    errs.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 300)}`));
    if (errs.length === 0) console.log('  ❌', JSON.stringify(rs1).slice(0, 300));
  }

  // 2. 先查草稿的完整数据
  console.log('\n=== Draft View ===');
  const rView = await call(
    'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
    { FormId: 'SFC_OperationReport', data: JSON.stringify({ Id: draftId }) },
  );
  const record = rView?.Result?.Result;
  if (record) {
    console.log(`  BillNo: "${record.BillNo}", Status: "${record.DocumentStatus}"`);
    console.log(`  FEntity:`, JSON.stringify(record.FEntity).slice(0, 500));
    console.log(`  OptRptEntry[0]:`, JSON.stringify(record.OptRptEntry?.[0]).slice(0, 300));
  }

  // 3. 尝试直接 Save（用 FNumber 格式 + FOperNumber: 10）
  // 用全新数据，不经过 Draft
  console.log('\n=== Save new with FWorkCenterId: FNumber + FOperNumber: 10 ===');
  const today = new Date().toISOString().slice(0, 10);
  const model = {
    FDate: today, F_UNW_Date2: today,
    FBillTypeID: { FNumber: 'GXHB01_SYS' },
    F_UNW_MONum: 'YJYMO2603133',
    PrdOrgId: { FNumber: 'YJY' },
    FWorkShopId: { FNumber: 'BM000034' },
    F_FD_OperDescp: '装盒&装箱',
    OptRptEntry: [{ FMaterialId: { FNumber: 'FP010580' }, FQuaQty: 10 }],
    FEntity: [{
      FSeqNumber: "0",
      FOperNumber: 10,
      FQuaQty: 10,
      FMaterialId: { FNumber: 'FP010580' },
      FWorkCenterId: { FId: 188050 },
      FUnitID: { FNumber: 'Pcs' },
      MoRowNumber: 1,
      MoNumber: 'YJYMO2603133',
    }],
  };

  const rNew = await call(
    'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Save.common.kdsvc',
    { FormId: 'SFC_OperationReport', data: JSON.stringify({ Model: model }) },
  );
  const rsNew = rNew?.Result?.ResponseStatus;
  if (rsNew?.IsSuccess) {
    console.log(`  ✅ ${rNew?.Result?.Number}`);
  } else {
    const errs = rsNew?.Errors || [];
    errs.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 300)}`));
  }

  // 4. 用 FId 格式试 FOperNumber
  console.log('\n=== Save with FOperNumber: { FId: 120719 } ===');
  const r4 = await call(
    'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Save.common.kdsvc',
    {
      FormId: 'SFC_OperationReport',
      data: JSON.stringify({
        Model: {
          ...model,
          FEntity: [{
            ...model.FEntity[0],
            FOperNumber: { FId: 120719 },
          }],
        },
      }),
    },
  );
  const rs4 = r4?.Result?.ResponseStatus;
  if (rs4?.IsSuccess) {
    console.log(`  ✅ ${r4?.Result?.Number}`);
  } else {
    const errs = rs4?.Errors || [];
    errs.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 300)}`));
  }

  // 5. 看 Draft 是否有其他字段可以触发保存
  // 试 Draft 然后用 ForceSubmit
  console.log('\n=== Draft → ForceSubmit 获取 FBillNo ===');
  const rDraft = await call(
    'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Draft.common.kdsvc',
    {
      FormId: 'SFC_OperationReport',
      data: JSON.stringify({
        Model: {
          ...model,
          FEntity: [{
            FSeqNumber: "0",
            FOperNumber: { Id: 120719 },
            FQuaQty: 10,
            FMaterialId: { FNumber: 'FP010580' },
            FWorkCenterId: { FId: 188050 },
            FUnitID: { FNumber: 'Pcs' },
            MoRowNumber: 1,
            MoNumber: 'YJYMO2603133',
          }],
        },
      }),
    },
  );
  const newId = rDraft?.Result?.Id;
  console.log(`  Draft Id: ${newId || 'none'}`);
}

main().catch(e => console.error('FATAL', e));
