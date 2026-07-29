/**
 * 完整工作流：Draft → Save(分配编码) → Submit → Audit
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

async function call(action, payload) {
  const r = await client.callWithAuth(() =>
    client._request(
      `Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.${action}.common.kdsvc`,
      payload,
    ),
  );
  return r.data;
}

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
      FWorkCenterId: { FNumber: 'WC000003' },
      FUnitID: { FNumber: 'Pcs' },
      MoRowNumber: 1,
      MoNumber: 'YJYMO2603133',
    }],
  };

  // Step 1: Draft
  console.log('=== Step 1: Draft ===');
  const r1 = await call('Draft', {
    FormId: 'SFC_OperationReport',
    data: JSON.stringify({ Model: model }),
  });
  const id = r1?.Result?.Id;
  console.log(`  Id: ${id}`);
  if (!id) { console.log('  ❌ No Id'); return; }

  // Step 2: View - check BillNo
  console.log(`\n=== Step 1.5: View ${id} ===`);
  const rView = await call('View', {
    FormId: 'SFC_OperationReport',
    data: JSON.stringify({ Id: id }),
  });
  const billNo = rView?.Result?.Result?.BillNo;
  console.log(`  BillNo: "${billNo}", Status: "${rView?.Result?.Result?.DocumentStatus}"`);

  // Step 3: Try Save on existing draft (to assign BillNo)
  console.log('\n=== Step 2: Save existing draft ===');
  const r2 = await call('Save', {
    FormId: 'SFC_OperationReport',
    data: JSON.stringify({
      Model: {
        Id: id,
        // Re-send minimal model to trigger BillNo assignment
        F_UNW_MONum: 'YJYMO2603133',
      },
      NeedReturnData: [/*'BillNo'*/],
    }),
  });
  const r2s = r2?.Result?.ResponseStatus;
  if (r2s?.IsSuccess) {
    console.log(`  ✅ Save success`);
    // Check if BillNo was assigned
    const rView2 = await call('View', {
      FormId: 'SFC_OperationReport',
      data: JSON.stringify({ Id: id }),
    });
    const billNo2 = rView2?.Result?.Result?.BillNo;
    console.log(`  BillNo: "${billNo2}", Status: "${rView2?.Result?.Result?.DocumentStatus}"`);
  } else {
    const errs = r2s?.Errors || [];
    errs.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 300)}`));
  }

  // Step 4: Try Submit with Draft=True flag
  console.log('\n=== Step 3: SubmitDraft ===');
  try {
    const r3 = await call('SubmitDraft', {
      FormId: 'SFC_OperationReport',
      data: JSON.stringify({
        CreateOnly: true,
        Model: { Id: id },
      }),
    });
    console.log('  SubmitDraft:', JSON.stringify(r3?.Result?.ResponseStatus).slice(0, 300));
    if (r3?.Result?.ResponseStatus?.IsSuccess) {
      console.log(`  ✅ SubmitDraft success`);
    }
  } catch(e) {
    console.log('  SubmitDraft error (might not exist):', e.message);
  }

  // Step 5: Try UnAuditSubmit
  console.log('\n=== Step 4: UnAuditSubmit ===');
  try {
    const r4 = await call('UnAuditSubmit', {
      FormId: 'SFC_OperationReport',
      data: JSON.stringify({
        CreateOnly: true,
        Model: { Id: id },
      }),
    });
    console.log('  UnAuditSubmit:', JSON.stringify(r4?.Result?.ResponseStatus).slice(0, 300));
  } catch(e) {
    console.log('  UnAuditSubmit error:', e.message);
  }

  // Step 6: Just try Submit with different params
  console.log('\n=== Step 5: Submit with Data.Ids as string ===');
  const r5 = await call('Submit', {
    FormId: 'SFC_OperationReport',
    data: JSON.stringify({
      CreateOnly: true,
      Ids: String(id),
      Numbers: '',
    }),
  });
  console.log('  Submit:', JSON.stringify(r5?.Result?.ResponseStatus).slice(0, 400));

  // Step 7: What if the BillNo format is known? Try to assign manually
  // Find the last bill number pattern
  console.log('\n=== Step 6: 查最近单据号 ===');
  try {
    const r6 = await client.callWithAuth(() =>
      client.executeBillQuery('SFC_OperationReport', {
        fieldKeys: ['FBillNo'],
        skipDateFilter: true, limit: 3,
        orderBy: 'FBillNo desc',
      }),
    );
    console.log('  Recent:', JSON.stringify(r6.data).slice(0, 200));
  } catch(e) {
    console.log('  Error:', e.message);
  }
}

main().catch(e => console.error('FATAL', e));
