/**
 * Draft + FOperNumber: { Id } 成功！
 * 现在走完整流程：Draft → Submit → Audit
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
      FOperNumber: { Id: 120719 },  // 关键的 OptPlanOptId！
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
  console.log('  FOperNumber format:', JSON.stringify(model.FEntity[0].FOperNumber));
  const r1 = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Draft.common.kdsvc',
      { FormId: 'SFC_OperationReport', data: JSON.stringify({ Model: model }) },
    ),
  );
  const resp1 = r1.data?.Result;
  console.log('  Full response:', JSON.stringify(resp1).slice(0, 500));
  const id = resp1?.Id;
  console.log(`  Id: ${id}`);
  if (!id) return;

  // Step 2: View draft
  const rView = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
      { FormId: 'SFC_OperationReport', data: JSON.stringify({ Id: id }) },
    ),
  );
  const draft = rView.data?.Result?.Result;
  console.log(`  Draft BillNo: "${draft?.BillNo}", Status: "${draft?.DocumentStatus}"`);

  // Step 3: Try Submit with different formats
  // Format A: Submit with Numbers in Data (Kingdee standard)
  console.log('\n=== Step 3A: Submit (Data format, empty Numbers) ===');
  const r3a = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Submit.common.kdsvc',
      {
        FormId: 'SFC_OperationReport',
        Data: JSON.stringify({ Ids: String(id), Numbers: '' }),
      },
    ),
  );
  console.log('  Submit:', JSON.stringify(r3a.data?.Result?.ResponseStatus).slice(0, 400));

  // Format B: Submit with data (lowercase) format
  if (!r3a.data?.Result?.ResponseStatus?.IsSuccess) {
    console.log('\n=== Step 3B: Submit (data format, Ids as string) ===');
    const r3b = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Submit.common.kdsvc',
        {
          FormId: 'SFC_OperationReport',
          data: JSON.stringify({ Ids: String(id), Numbers: '' }),
        },
      ),
    );
    console.log('  Submit:', JSON.stringify(r3b.data?.Result?.ResponseStatus).slice(0, 400));
  }

  // Step 4: Try Save (not Draft) with FOperNumber: { Id }
  console.log('\n=== Step 4: Save with FOperNumber: { Id } ===');
  const r4 = await client.save('SFC_OperationReport', model);
  const r4s = r4.data?.Result?.ResponseStatus;
  if (r4s?.IsSuccess) {
    const billNo = r4.data?.Result?.Number;
    console.log(`  ✅ ${billNo}`);
    if (billNo) {
      console.log(`\n=== Step 5: Submit ${billNo} ===`);
      const r5 = await client.callWithAuth(() =>
        client._request(
          'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Submit.common.kdsvc',
          { FormId: 'SFC_OperationReport', Data: JSON.stringify({ Numbers: billNo }) },
        ),
      );
      console.log('  Submit:', r5.data?.Result?.ResponseStatus?.IsSuccess ? '✅' : '❌');
      if (r5.data?.Result?.ResponseStatus?.IsSuccess) {
        console.log(`\n=== Step 6: Audit ${billNo} ===`);
        const r6 = await client.callWithAuth(() =>
          client._request(
            'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Audit.common.kdsvc',
            { FormId: 'SFC_OperationReport', Data: JSON.stringify({ Numbers: billNo }) },
          ),
        );
        console.log('  Audit:', r6.data?.Result?.ResponseStatus?.IsSuccess ? '✅ 🎉' : '❌');
        if (r6.data?.Result?.ResponseStatus?.IsSuccess) console.log(`  🎉🎉🎉 ${billNo} 完成!`);
      }
    }
  } else {
    const errs = r4s?.Errors || [];
    errs.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 300)}`));
  }
}

main().catch(e => console.error('FATAL', e));
