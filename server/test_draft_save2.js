/**
 * Draft → Save (重试, 完整模型)
 * 思路：Draft 后，用 Save 做更新，看是否走不同逻辑
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
    F_UNW_MONum: 'YJYMO2603133',
    PrdOrgId: { FNumber: 'YJY' },
    FWorkShopId: { FNumber: 'BM000034' },
    F_FD_OperDescp: '装盒&装箱',
    OptRptEntry: [{ FMaterialId: { FNumber: 'FP010580' }, FQuaQty: 10 }],
    FEntity: [{
      FSeqNumber: "0",
      FQuaQty: 10,
      FMaterialId: { FNumber: 'FP010580' },
      FWorkCenterId: { Id: 188050 },
      FUnitID: { FNumber: 'Pcs' },
      MoRowNumber: 1,
      MoNumber: 'YJYMO2603133',
    }],
  };

  // Step 1: Draft（无 FOperNumber）
  console.log('=== Step 1: Draft ===');
  const r1 = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Draft.common.kdsvc',
      { FormId: 'SFC_OperationReport', data: JSON.stringify({ Model: model }) },
    ),
  );
  const id = r1.data?.Result?.Id;
  console.log(`  Id: ${id}`);
  if (!id) return;

  // Step 2: Save（完整模型 + Id）
  // Pass the exact same model but with Id
  console.log('\n=== Step 2: Save (update with full model) ===');
  const r2 = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Save.common.kdsvc',
      {
        FormId: 'SFC_OperationReport',
        data: JSON.stringify({
          Model: {
            Id: id,
            ...model,
          },
        }),
      },
    ),
  );
  const r2s = r2.data?.Result?.ResponseStatus;
  if (r2s?.IsSuccess) {
    const billNo = r2.data?.Result?.Number;
    console.log(`  ✅ BillNo: ${billNo}`);

    // Submit
    if (billNo) {
      console.log(`\n=== Step 3: Submit ${billNo} ===`);
      const r3 = await client.callWithAuth(() =>
        client._request(
          'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Submit.common.kdsvc',
          { FormId: 'SFC_OperationReport', Data: JSON.stringify({ Numbers: billNo }) },
        ),
      );
      console.log('  Submit:', r3.data?.Result?.ResponseStatus?.IsSuccess ? '✅' : '❌');

      if (r3.data?.Result?.ResponseStatus?.IsSuccess) {
        console.log(`\n=== Step 4: Audit ${billNo} ===`);
        const r4 = await client.callWithAuth(() =>
          client._request(
            'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Audit.common.kdsvc',
            { FormId: 'SFC_OperationReport', Data: JSON.stringify({ Numbers: billNo }) },
          ),
        );
        console.log('  Audit:', r4.data?.Result?.ResponseStatus?.IsSuccess ? '✅ 🎉' : '❌');
      }
    }
  } else {
    const errs = r2s?.Errors || [];
    errs.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 300)}`));
  }

  // Step 5: Try completely different approach
  // What if we set FOperNumber via NeedReturnData or post-save calc?
  console.log('\n\n=== Save with FOperNumber: { Id: 120719 } ===');
  const r5 = await client.callWithAuth(() =>
    client._request(
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
              FWorkCenterId: { Id: 188050 },
              FUnitID: { FNumber: 'Pcs' },
              MoRowNumber: 1,
              MoNumber: 'YJYMO2603133',
            }],
          },
        }),
      },
    ),
  );
  console.log('  Draft result:', JSON.stringify(r5.data?.Result?.ResponseStatus).slice(0, 300));

  // Step 6: What if FOperNumber needs to be on OptRptEntry, not FEntity?
  console.log('\n\n=== No FEntity, OptRptEntry with OperNumber ===');
  const r6 = await client.save('SFC_OperationReport', {
    FDate: today, F_UNW_Date2: today,
    FBillTypeID: { FNumber: 'GXHB01_SYS' },
    F_UNW_MONum: 'YJYMO2603133',
    PrdOrgId: { FNumber: 'YJY' },
    FWorkShopId: { FNumber: 'BM000034' },
    F_FD_OperDescp: '装盒&装箱',
    OptRptEntry: [{
      FMaterialId: { FNumber: 'FP010580' },
      FQuaQty: 10,
      OperNumber: 10,
      WorkCenterId: { Id: 188050 },
      FUnitID: { FNumber: 'Pcs' },
    }],
  }, { ignoreRule: true, ignoreInteraction: true });
  const r6e = r6.data?.Result?.ResponseStatus?.Errors || [];
  r6e.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 300)}`));
  if (r6.data?.Result?.ResponseStatus?.IsSuccess) console.log(`  ✅ ${r6.data?.Result?.Number}`);
}

main().catch(e => console.error('FATAL', e));
