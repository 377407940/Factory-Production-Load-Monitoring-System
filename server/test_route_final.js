/**
 * 查工艺路线 RT000003 的 View，看工序步骤
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

async function main() {
  // 查工艺路线 - 不同FormID
  for (const formId of ['ENG_Route', 'BD_Route', 'ENG_ROUTE', 'PP_Route', 'BD_ROUTE']) {
    console.log(`=== ${formId} ===`);
    try {
      const r = await client.callWithAuth(() =>
        client._request(
          'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
          { FormId: formId, data: JSON.stringify({ Number: 'RT000003' }) },
        ),
      );
      const record = r.data?.Result?.Result;
      if (record) {
        console.log(`  Found! BillNo: ${record.BillNo}, keys: ${Object.keys(record).slice(0, 15).join(', ')}`);
        // 找工序子表
        for (const k of Object.keys(record)) {
          if (Array.isArray(record[k]) && record[k].length > 0) {
            const arr = record[k];
            console.log(`  Entity '${k}': ${arr.length} rows`);
            for (let i = 0; i < Math.min(arr.length, 10); i++) {
              const row = arr[i];
              console.log(`    [${i}]`, JSON.stringify({
                OperNumber: row.OperNumber,
                OperName: row.OperName,
                WorkCenter: row.WorkCenterId?.Number,
              }).slice(0, 200));
            }
          }
        }
        break;
      }
    } catch(e) {
      // skip
    }
  }

  // 最终替代方案：查 SFC_OperationReport 的 BOS 元数据中的 FOperNumber 校验规则
  console.log('\n=== 查已保存记录的 FOperNumber 实际值 ===');
  try {
    const r = await client.callWithAuth(() =>
      client.executeBillQuery('SFC_OperationReport', {
        fieldKeys: ['FBillNo', 'FOperNumber', 'FWorkShopId.FNumber'],
        filter: "FBillNo='YJYGXHB26060859'",
        skipDateFilter: true, limit: 1,
      }),
    );
    console.log('  Result:', JSON.stringify(r.data).slice(0, 300));
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 最后试：在 FEntity 中用 FWorkShopId 代替 FWorkCenterId
  console.log('\n=== FWorkShopId in FEntity (可能和FWorkCenterId不同) ===');
  const today = new Date().toISOString().slice(0, 10);
  const r2 = await client.save('SFC_OperationReport', {
    FDate: today, F_UNW_Date2: today,
    FBillTypeID: { FNumber: 'GXHB01_SYS' },
    F_UNW_MONum: 'YJYMO2603133',
    PrdOrgId: { FNumber: 'YJY' },
    FWorkShopId: { FNumber: 'BM000034' },
    F_FD_OperDescp: '装盒&装箱',
    OptRptEntry: [{ FMaterialId: { FNumber: 'FP010580' }, FQuaQty: 10 }],
    FEntity: [{
      FSeqNumber: "0",
      FOperNumber: 10,
      FQuaQty: 10,
      FMaterialId: { FNumber: 'FP010580' },
      FWorkShopId: { FNumber: 'BM000034' },  // 不是 FWorkCenterId！
      FUnitID: { FNumber: 'Pcs' },
      MoRowNumber: 1,
      MoNumber: 'YJYMO2603133',
    }],
  });
  const errs = r2.data?.Result?.ResponseStatus?.Errors || [];
  errs.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 300)}`));
  if (r2.data?.Result?.ResponseStatus?.IsSuccess) console.log(`  ✅ ${r2.data?.Result?.Number}`);
}

main().catch(e => console.error('FATAL', e));
