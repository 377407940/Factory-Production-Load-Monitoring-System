/**
 * 正确调用 Submit/Audit API
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
      FWorkCenterId: { FNumber: 'WC000003' },
      FUnitID: { FNumber: 'Pcs' },
      MoRowNumber: 1,
      MoNumber: 'YJYMO2603133',
    }],
  };

  // 1. Draft
  console.log('=== Draft ===');
  const r1 = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Draft.common.kdsvc',
      { FormId: 'SFC_OperationReport', data: JSON.stringify({ Model: model }) },
    ),
  );
  const id = r1.data?.Result?.Id;
  console.log(`  Id: ${id}`);

  if (!id) { console.log('  ❌ No Id'); return; }

  // 查草稿看 BillNo 和状态
  const rView = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
      { FormId: 'SFC_OperationReport', data: JSON.stringify({ Id: id }) },
    ),
  );
  const record = rView.data?.Result?.Result;
  console.log(`  BillNo: "${record?.BillNo}", Status: "${record?.DocumentStatus}"`);

  // 2. Submit - 试不同格式
  // 格式1: Ids array
  console.log('\n=== Submit (Ids format) ===');
  const r2 = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Submit.common.kdsvc',
      {
        FormId: 'SFC_OperationReport',
        data: JSON.stringify({
          CreateOnly: true,
          Ids: [id],     // array format
          Numbers: [],
        }),
      },
    ),
  );
  console.log('  Submit:', JSON.stringify(r2.data?.Result?.ResponseStatus).slice(0, 500));
  if (r2.data?.Result?.ResponseStatus?.IsSuccess) {
    console.log('  ✅ Submit success');
  } else {
    const errs = r2.data?.Result?.ResponseStatus?.Errors || [];
    errs.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 300)}`));
  }

  // 再查记录
  const rView2 = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
      { FormId: 'SFC_OperationReport', data: JSON.stringify({ Id: id }) },
    ),
  );
  const record2 = rView2.data?.Result?.Result;
  console.log(`  After submit - BillNo: "${record2?.BillNo}", Status: "${record2?.DocumentStatus}"`);

  // 3. 如果需要，审核
  if (record2?.BillNo && record2?.DocumentStatus === 'A') {
    console.log('\n=== Audit ===');
    const r3 = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Audit.common.kdsvc',
        {
          FormId: 'SFC_OperationReport',
          data: JSON.stringify({
            CreateOnly: true,
            Numbers: [record2.BillNo],
          }),
        },
      ),
    );
    console.log('  Audit:', JSON.stringify(r3.data?.Result?.ResponseStatus).slice(0, 500));
    if (r3.data?.Result?.ResponseStatus?.IsSuccess) {
      console.log(`  ✅ ${record2.BillNo}`);
    }
  }

  // 4. 试 Submit 用 Numbers 格式
  if (!r2.data?.Result?.ResponseStatus?.IsSuccess && record?.BillNo) {
    console.log('\n=== Submit (Numbers format) ===');
    const r2b = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Submit.common.kdsvc',
        {
          FormId: 'SFC_OperationReport',
          data: JSON.stringify({
            CreateOnly: true,
            Ids: [],
            Numbers: [record.BillNo],
          }),
        },
      ),
    );
    console.log('  Submit:', JSON.stringify(r2b.data?.Result?.ResponseStatus).slice(0, 500));
  }

  // 5. 查看是否有 SFC_OperationReport 的已提交记录方法
  // 也许我们需要用 UnAuditAndSubmit
  console.log('\n=== 查单据编码规则（草稿不编码）===');
  console.log('  Draft returns empty BillNo - 草稿模式下不生成单据编号');
  console.log('  需要在 Submit 后才生成编号');
}

main().catch(e => console.error('FATAL', e));
