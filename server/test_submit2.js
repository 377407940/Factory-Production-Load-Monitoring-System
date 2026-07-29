/**
 * 试 Submit API 正确格式
 * 标准 Kingdee Submit 格式:
 * FormId: string
 * Data: string (JSON with Ids/Numbers)
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

async function main() {
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
      FQuaQty: 10,
      FMaterialId: { FNumber: 'FP010580' },
      FWorkCenterId: { Id: 188050 },
      FUnitID: { FNumber: 'Pcs' },
      MoRowNumber: 1,
      MoNumber: 'YJYMO2603133',
    }],
  };

  // Step 1: Draft
  console.log('=== Draft ===');
  const r1 = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Draft.common.kdsvc',
      { FormId: 'SFC_OperationReport', data: JSON.stringify({ Model: base }) },
    ),
  );
  const id = r1.data?.Result?.Id;
  console.log(`  Id: ${id}`);
  if (!id) return;

  // Step 2: Submit with Data string format
  // Kingdee standard: Data is the outer parameter name, not data
  console.log(`\n=== Submit Id=${id} (Data format) ===`);
  const r2 = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Submit.common.kdsvc',
      {
        FormId: 'SFC_OperationReport',
        Data: JSON.stringify({ Ids: String(id) }),
      },
    ),
  );
  console.log('  Submit:', JSON.stringify(r2.data?.Result?.ResponseStatus).slice(0, 500));

  // Check View after submit
  const rView = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
      { FormId: 'SFC_OperationReport', data: JSON.stringify({ Id: id }) },
    ),
  );
  const billNo = rView.data?.Result?.Result?.BillNo;
  const status = rView.data?.Result?.Result?.DocumentStatus;
  console.log(`  After submit - BillNo: "${billNo}", Status: "${status}"`);

  // Step 3: If submitted, Audit
  if (billNo && (status === 'A' || status === 'B')) {
    console.log(`\n=== Audit ${billNo} ===`);
    const r3 = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Audit.common.kdsvc',
        {
          FormId: 'SFC_OperationReport',
          Data: JSON.stringify({ Numbers: billNo }),
        },
      ),
    );
    console.log('  Audit:', JSON.stringify(r3.data?.Result?.ResponseStatus).slice(0, 500));
    if (r3.data?.Result?.ResponseStatus?.IsSuccess) {
      console.log(`  ✅ ${billNo} 完成!`);
    }
  }

  // Step 4: Try Audit even if Submit didn't work with a direct approach
  if (!billNo && status === 'Z') {
    // Try with Numbers in Data
    console.log(`\n=== Submit with Data.Numbers (empty string) ===`);
    const r4 = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Submit.common.kdsvc',
        {
          FormId: 'SFC_OperationReport',
          Data: JSON.stringify({ Ids: String(id), Numbers: '' }),
        },
      ),
    );
    console.log('  Submit:', JSON.stringify(r4.data?.Result?.ResponseStatus).slice(0, 500));
  }
}

main().catch(e => console.error('FATAL', e));
