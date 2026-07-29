/**
 * Draft 后查完整数据
 * 看 FEntity 被系统自动填充成什么
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  // 先查之前 Draft 的记录
  const draftIds = [207113, 207114];
  for (const id of draftIds) {
    console.log(`=== Draft Id=${id} ===`);
    try {
      const r = await client.callWithAuth(() =>
        client._request(
          'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
          { FormId: 'SFC_OperationReport', data: JSON.stringify({ Id: id }) },
        ),
      );
      const record = r.data?.Result?.Result;
      if (record) {
        console.log(`  BillNo: "${record.BillNo}", Status: "${record.DocumentStatus}"`);
        console.log(`  FEntity:`, JSON.stringify(record.FEntity).slice(0, 500));
        console.log(`  OptRptEntry:`, JSON.stringify(record.OptRptEntry?.[0]).slice(0, 400));
        console.log(`  FWorkShopId:`, JSON.stringify(record.FWorkShopId?.Number));
        console.log(`  F_FD_OperDescp:`, record.F_FD_OperDescp);
      } else {
        console.log('  No record');
      }
    } catch(e) {
      console.log('  Error:', e.message);
    }
  }

  // 也看一个正式已提交的记录的 FEntity（如果有的话）
  console.log('\n=== 正式记录 YJYGXHB26060859 ===');
  try {
    const r = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
        { FormId: 'SFC_OperationReport', data: JSON.stringify({ Number: 'YJYGXHB26060859' }) },
      ),
    );
    const record = r.data?.Result?.Result;
    if (record) {
      console.log(`  FEntity:`, JSON.stringify(record.FEntity).slice(0, 500));
      console.log(`  FOperNumber in OptRptEntry:`, record.OptRptEntry?.[0]?.OperNumber);
    }
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 另类思路：尝试直接给 Draft 设置 FBillNo
  console.log('\n=== 尝试给 Draft 设置 FBillNo ===');
  try {
    // 直接从现有单据号查最新的编码模式
    const rSeq = await client.callWithAuth(() =>
      client.executeBillQuery('SFC_OperationReport', {
        fieldKeys: ['FBillNo'],
        skipDateFilter: true, limit: 1,
        orderBy: 'FBillNo desc',
      }),
    );
    console.log('  Latest BillNo:', JSON.stringify(rSeq.data).slice(0, 200));
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 尝试 Draft → Save with FBillNo (手动设置)
  const newToday = new Date().toISOString().slice(0, 10);
  const model = {
    FDate: newToday, F_UNW_Date2: newToday,
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

  console.log('\n=== Draft → Save with FBillNo ===');
  const rD = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Draft.common.kdsvc',
      { FormId: 'SFC_OperationReport', data: JSON.stringify({ Model: model }) },
    ),
  );
  const newId = rD.data?.Result?.Id;
  console.log(`  Draft Id: ${newId}`);
  if (newId) {
    // Save with FBillNo manually set - what if system accepts FBillNo in Save?
    // Format: YJYGXHB2606xxxx
    const testBillNo = 'YJYGXHB26060999'; // Might not exist
    const rS = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Save.common.kdsvc',
        {
          FormId: 'SFC_OperationReport',
          data: JSON.stringify({
            Model: {
              Id: newId,
              FBillNo: testBillNo,
              ...model,
            },
            NeedReturnData: ['FBillNo'],
          }),
        },
      ),
    );
    console.log('  Save:', JSON.stringify(rS.data?.Result?.ResponseStatus).slice(0, 500));
    if (rS.data?.Result?.ResponseStatus?.IsSuccess) {
      console.log(`  ✅ BillNo: ${rS.data?.Result?.Number}`);
    }
  }
}

main().catch(e => console.error('FATAL', e));
