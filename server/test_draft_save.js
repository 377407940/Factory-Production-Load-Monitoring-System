/**
 * Draft 后 Save（完整数据）
 * 看是否走"更新"路径绕过 FOperNumber 验证
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
      FOperNumber: 10,
      FQuaQty: 10,
      FMaterialId: { FNumber: 'FP010580' },
      FWorkCenterId: { Id: 188050 },
      FUnitID: { FNumber: 'Pcs' },
      MoRowNumber: 1,
      MoNumber: 'YJYMO2603133',
    }],
  };

  // Step 1: Draft
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

  // Step 2: Save complete model with Id (update)
  console.log('\n=== Step 2: Save (update) ===');
  const inner = {
    Model: {
      Id: id,
      ...model,
    },
  };
  const r2 = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Save.common.kdsvc',
      {
        FormId: 'SFC_OperationReport',
        data: JSON.stringify(inner),
      },
    ),
  );
  const r2s = r2.data?.Result?.ResponseStatus;
  if (r2s?.IsSuccess) {
    console.log(`  ✅ ${r2.data?.Result?.Number}`);
    const billNo = r2.data?.Result?.Number;
    // Submit + Audit
    if (billNo) {
      console.log(`\n=== Step 3: Submit ${billNo} ===`);
      const r3 = await client.callWithAuth(() =>
        client._request(
          'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Submit.common.kdsvc',
          {
            FormId: 'SFC_OperationReport',
            data: JSON.stringify({ CreateOnly: true, Model: { FBillNo: billNo } }),
          },
        ),
      );
      console.log('  Submit:', r3.data?.Result?.ResponseStatus?.IsSuccess ? '✅' : '❌');
      if (r3.data?.Result?.ResponseStatus?.IsSuccess) {
        console.log(`\n=== Step 4: Audit ${billNo} ===`);
        const r4 = await client.callWithAuth(() =>
          client._request(
            'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Audit.common.kdsvc',
            {
              FormId: 'SFC_OperationReport',
              data: JSON.stringify({ CreateOnly: true, Model: { FBillNo: billNo } }),
            },
          ),
        );
        console.log('  Audit:', r4.data?.Result?.ResponseStatus?.IsSuccess ? '✅' : '❌');
        if (r4.data?.Result?.ResponseStatus?.IsSuccess) console.log(`  🎉 ${billNo} 完成!`);
      }
    }
  } else {
    const errs = r2s?.Errors || [];
    errs.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 300)}`));
  }

  // Step 5: Alternative - try SaveDraft (which worked) and see if we can somehow get BillNo
  console.log('\n\n=== Alternate: SaveDraft + ??? ===');
  const r5 = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.SaveDraft.common.kdsvc',
      { FormId: 'SFC_OperationReport', data: JSON.stringify({ Model: model }) },
    ),
  );
  const r5r = r5.data?.Result;
  console.log('  SaveDraft result:', JSON.stringify(r5r).slice(0, 400));
  if (r5r?.Id) {
    console.log(`  SaveDraft Id: ${r5r.Id}`);
    // Check View
    const rView = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
        { FormId: 'SFC_OperationReport', data: JSON.stringify({ Id: r5r.Id }) },
      ),
    );
    console.log(`  BillNo: "${rView.data?.Result?.Result?.BillNo}", Status: "${rView.data?.Result?.Result?.DocumentStatus}"`);
  }
}

main().catch(e => console.error('FATAL', e));
