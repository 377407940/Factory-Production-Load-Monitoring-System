/**
 * 通过 Id 提交/审核草稿
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

async function main() {
  const draftId = 207104;  // 从刚才的 draft 得到

  // 1. 提交（Submit）通过 Id
  console.log('=== Submit by Id ===');
  const rSub = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Submit.common.kdsvc',
      {
        FormId: 'SFC_OperationReport',
        data: JSON.stringify({ CreateOnly: true, Model: { Id: draftId } }),
      },
    ),
  );
  console.log('  Submit:', JSON.stringify(rSub.data?.Result).slice(0, 800));

  // 如果提交成功，再看审核
  if (rSub.data?.Result?.ResponseStatus?.IsSuccess) {
    // 提交后查记录，看 BillNo
    console.log('\n=== 提交后查记录 ===');
    const rView = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
        { FormId: 'SFC_OperationReport', data: JSON.stringify({ Id: draftId }) },
      ),
    );
    const record = rView.data?.Result?.Result;
    if (record) {
      console.log(`  BillNo: ${record.BillNo}, Status: ${record.DocumentStatus}`);

      // 审核
      if (record.BillNo) {
        console.log(`\n=== Audit ${record.BillNo} ===`);
        const rAud = await client.callWithAuth(() =>
          client._request(
            'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Audit.common.kdsvc',
            {
              FormId: 'SFC_OperationReport',
              data: JSON.stringify({ CreateOnly: true, Model: { FBillNo: record.BillNo } }),
            },
          ),
        );
        console.log('  Audit:', JSON.stringify(rAud.data?.Result).slice(0, 500));
        if (rAud.data?.Result?.ResponseStatus?.IsSuccess) {
          console.log(`  ✅ 审核完成! ${record.BillNo}`);
        }
      }
    }
  } else {
    const errs = rSub.data?.Result?.ResponseStatus?.Errors || [];
    errs.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 300)}`));
  }

  // 2. 完整流程：Draft → Submit → Audit
  console.log('\n\n=== 完整流程测试 ===');
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
      FWorkCenterId: { FNumber: 'WC000003' },
      FUnitID: { FNumber: 'Pcs' },
      MoRowNumber: 1,
      MoNumber: 'YJYMO2603133',
    }],
  };

  // 2a. Draft
  console.log('--- Step 1: Draft ---');
  const r1 = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Draft.common.kdsvc',
      { FormId: 'SFC_OperationReport', data: JSON.stringify({ Model: model }) },
    ),
  );
  const newId = r1.data?.Result?.Id;
  console.log(`  Draft Id: ${newId}`);
  if (!newId) { console.log('  ❌ Draft failed'); return; }

  // 2b. Submit by Id
  console.log('--- Step 2: Submit ---');
  const r2 = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Submit.common.kdsvc',
      {
        FormId: 'SFC_OperationReport',
        data: JSON.stringify({ CreateOnly: true, Model: { Id: newId } }),
      },
    ),
  );
  console.log('  Submit success:', r2.data?.Result?.ResponseStatus?.IsSuccess);
  if (!r2.data?.Result?.ResponseStatus?.IsSuccess) {
    const errs = r2.data?.Result?.ResponseStatus?.Errors || [];
    errs.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 300)}`));
    return;
  }

  // 2c. View to get BillNo
  console.log('--- Step 2.5: View ---');
  const rView2 = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
      { FormId: 'SFC_OperationReport', data: JSON.stringify({ Id: newId }) },
    ),
  );
  const billNo = rView2.data?.Result?.Result?.BillNo;
  console.log(`  BillNo: ${billNo}`);

  // 2d. Audit
  if (billNo) {
    console.log('--- Step 3: Audit ---');
    const r3 = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Audit.common.kdsvc',
        {
          FormId: 'SFC_OperationReport',
          data: JSON.stringify({ CreateOnly: true, Model: { FBillNo: billNo } }),
        },
      ),
    );
    console.log('  Audit success:', r3.data?.Result?.ResponseStatus?.IsSuccess);
    if (r3.data?.Result?.ResponseStatus?.IsSuccess) {
      console.log(`  ✅ 完整流程成功! ${billNo}`);
    } else {
      const errs = r3.data?.Result?.ResponseStatus?.Errors || [];
      errs.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 300)}`));
    }
  }
}

main().catch(e => console.error('FATAL', e));
