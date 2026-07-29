/**
 * 试 Submit 的各种参数格式
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

async function submit(label, payload) {
  console.log(`\n--- ${label} ---`);
  try {
    const r = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Submit.common.kdsvc',
        payload,
      ),
    );
    const resp = r.data?.Result?.ResponseStatus;
    if (resp?.IsSuccess) {
      console.log('  ✅ Submit success');
      return true;
    } else {
      const errs = resp?.Errors || [];
      errs.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 300)}`));
      return false;
    }
  } catch(e) {
    console.log('  Error:', e.message);
    return false;
  }
}

async function main() {
  // 先创建一个新的草稿
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

  console.log('=== Draft ===');
  const rDraft = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Draft.common.kdsvc',
      { FormId: 'SFC_OperationReport', data: JSON.stringify({ Model: model }) },
    ),
  );
  const id = rDraft.data?.Result?.Id;
  console.log(`  Draft Id: ${id}`);

  if (!id) return;

  // 试各种 Submit 格式
  // 1. Data string with Ids as string
  await submit('Data.Ids string', {
    FormId: 'SFC_OperationReport',
    data: JSON.stringify({ Ids: String(id) }),
  });

  // 2. Data string with Numbers
  await submit('Data.Numbers array', {
    FormId: 'SFC_OperationReport',
    data: JSON.stringify({ Numbers: [] }),
  });

  // 3. Top-level Ids
  await submit('Top-level Ids string', {
    FormId: 'SFC_OperationReport',
    data: JSON.stringify({ Ids: String(id) }),
    Ids: String(id),
  });

  // 4. Model with Id
  await submit('Model.Id', {
    FormId: 'SFC_OperationReport',
    data: JSON.stringify({ Model: { Id: id } }),
  });

  // 5. Original format: Data as object, not string
  await submit('Data as object with Ids', {
    FormId: 'SFC_OperationReport',
    Data: { Ids: String(id) },
  });

  // 6. Try without CreateOnly
  await submit('No CreateOnly, Ids string in Data', {
    FormId: 'SFC_OperationReport',
    data: JSON.stringify({ Ids: String(id) }),
  });

  // 7. Data with both Ids string and Numbers array
  await submit('Ids string + Numbers[]', {
    FormId: 'SFC_OperationReport',
    data: JSON.stringify({ Ids: String(id), Numbers: [] }),
  });
}

main().catch(e => console.error('FATAL', e));
