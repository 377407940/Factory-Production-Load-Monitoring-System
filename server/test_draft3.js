/**
 * Draft 返回了 Id=207103，查这个草稿
 * 提单/审核流程
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

async function main() {
  // 1. 查 draft 记录
  console.log('=== 查 Id=207103 ===');
  try {
    const r = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
        { FormId: 'SFC_OperationReport', data: JSON.stringify({ Id: 207103 }) },
      ),
    );
    const record = r.data?.Result?.Result;
    if (record) {
      console.log('  BillNo:', record.BillNo);
      console.log('  DocumentStatus:', record.DocumentStatus);
      console.log('  FEntity:', JSON.stringify(record.FEntity).slice(0, 300));
      console.log('  OptRptEntry:', JSON.stringify(record.OptRptEntry?.[0]).slice(0, 300));
    } else {
      console.log('  No record found:', JSON.stringify(r.data).slice(0, 300));
    }
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 2. 重新 Draft 并记录返回完整
  console.log('\n=== 新 Draft + 完整日志 ===');
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

  const r2 = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Draft.common.kdsvc',
      { FormId: 'SFC_OperationReport', data: JSON.stringify({ Model: model }) },
    ),
  );
  console.log('  Full response:', JSON.stringify(r2.data, null, 2).slice(0, 1000));

  const id2 = r2.data?.Result?.Id;
  console.log(`  New Id: ${id2}`);

  if (id2) {
    // 马上查这个新草稿
    const r3 = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
        { FormId: 'SFC_OperationReport', data: JSON.stringify({ Id: id2 }) },
      ),
    );
    const record2 = r3.data?.Result?.Result;
    if (record2) {
      console.log(`  BillNo: ${record2.BillNo}, Status: ${record2.DocumentStatus}`);

      // 3. 尝试 Submit
      if (record2.BillNo) {
        console.log(`\n=== Submit ${record2.BillNo} ===`);
        const rSub = await client.callWithAuth(() =>
          client._request(
            'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Submit.common.kdsvc',
            {
              FormId: 'SFC_OperationReport',
              data: JSON.stringify({
                CreateOnly: true,
                Model: { FBillNo: record2.BillNo },
              }),
            },
          ),
        );
        console.log('  Submit:', JSON.stringify(rSub.data?.Result).slice(0, 500));

        // 4. Audit
        if (rSub.data?.Result?.ResponseStatus?.IsSuccess) {
          console.log(`\n=== Audit ${record2.BillNo} ===`);
          const rAud = await client.callWithAuth(() =>
            client._request(
              'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Audit.common.kdsvc',
              {
                FormId: 'SFC_OperationReport',
                data: JSON.stringify({
                  CreateOnly: true,
                  Model: { FBillNo: record2.BillNo },
                }),
              },
            ),
          );
          console.log('  Audit:', JSON.stringify(rAud.data?.Result).slice(0, 500));
        }
      }
    }
  }
}

main().catch(e => console.error('FATAL', e));
