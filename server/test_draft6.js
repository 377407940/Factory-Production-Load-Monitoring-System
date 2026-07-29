/**
 * Draft 带 FOperNumber 会怎样？
 * 对比：有 FOperNumber vs 无 FOperNumber
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
  };

  // Test 1: Draft WITHOUT FOperNumber (this worked before)
  console.log('=== Draft without FOperNumber ===');
  const r1 = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Draft.common.kdsvc',
      {
        FormId: 'SFC_OperationReport',
        data: JSON.stringify({
          Model: {
            ...base,
            FEntity: [{
              FSeqNumber: "0",
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
  console.log('  Result:', JSON.stringify(r1.data?.Result?.ResponseStatus).slice(0, 400));
  console.log('  Id:', r1.data?.Result?.Id);

  // Test 2: Draft WITH FOperNumber
  console.log('\n=== Draft with FOperNumber=10 ===');
  const r2 = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Draft.common.kdsvc',
      {
        FormId: 'SFC_OperationReport',
        data: JSON.stringify({
          Model: {
            ...base,
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
          },
        }),
      },
    ),
  );
  console.log('  Result:', JSON.stringify(r2.data?.Result?.ResponseStatus).slice(0, 400));
  console.log('  Id:', r2.data?.Result?.Id);

  // 看 Draft 返回的 NeedReturnData
  console.log('\n  NeedReturnData:', JSON.stringify(r1.data?.Result?.NeedReturnData).slice(0, 200));

  // Test 3: 用 SaveDraft API 试
  console.log('\n=== SaveDraft ===');
  const r3 = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.SaveDraft.common.kdsvc',
      {
        FormId: 'SFC_OperationReport',
        data: JSON.stringify({
          Model: {
            ...base,
            FEntity: [{
              FSeqNumber: "0",
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
  console.log('  SaveDraft result:', JSON.stringify(r3.data?.Result).slice(0, 400));
}

main().catch(e => console.error('FATAL', e));
