/**
 * Draft/草稿 成功！
 * 现在：
 * 1. 看 Draft 返回的 BillNo
 * 2. 提交草稿 (Audit/Approve)
 * 3. 用完整字段测试最终保存
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

  // 1. Draft API 看返回
  console.log('=== Draft API 完整返回 ===');
  const rDraft = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Draft.common.kdsvc',
      { FormId: 'SFC_OperationReport', data: JSON.stringify({ Model: model }) },
    ),
  );
  console.log('  Draft response:', JSON.stringify(rDraft.data?.Result).slice(0, 500));

  const id = rDraft.data?.Result?.Id;
  const number = rDraft.data?.Result?.Number;
  console.log(`  Id: ${id}, Number: ${number}`);

  if (number) {
    // 2. 提交/审核
    console.log(`\n=== Submit ${number} ===`);
    const rSub = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Submit.common.kdsvc',
        {
          FormId: 'SFC_OperationReport',
          data: JSON.stringify({
            CreateOnly: true,
            Model: { FBillNo: number },
          }),
        },
      ),
    );
    console.log('  Submit:', JSON.stringify(rSub.data?.Result).slice(0, 500));

    // 3. 审核
    console.log(`\n=== Audit ${number} ===`);
    const rAud = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Audit.common.kdsvc',
        {
          FormId: 'SFC_OperationReport',
          data: JSON.stringify({
            CreateOnly: true,
            Model: { FBillNo: number },
          }),
        },
      ),
    );
    console.log('  Audit:', JSON.stringify(rAud.data?.Result).slice(0, 500));
  } else {
    console.log('\n=== 没有 Number，试直接用 View 查最新记录 ===');
    // 查刚才创建的草稿
    const rView = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
        { FormId: 'SFC_OperationReport', data: JSON.stringify({ Id: id }) },
      ),
    );
    console.log('  View:', JSON.stringify(rView.data?.Result?.Result?.BillNo).slice(0, 200));
  }

  // 4. SaveDraft 的返回
  console.log('\n=== SaveDraft 完整返回 ===');
  const rSaveDraft = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.SaveDraft.common.kdsvc',
      { FormId: 'SFC_OperationReport', data: JSON.stringify({ Model: model }) },
    ),
  );
  console.log('  SaveDraft:', JSON.stringify(rSaveDraft.data?.Result).slice(0, 500));
}

main().catch(e => console.error('FATAL', e));
