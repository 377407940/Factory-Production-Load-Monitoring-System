/**
 * 验证：草稿模式下 FOperNumber 会不会自动计算？
 * 以及 Draft 后的 FEntity 数据
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
      FWorkCenterId: { FNumber: 'WC000004' },
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
      { FormId: 'SFC_OperationReport', data: JSON.stringify({ Model: model }) },
    ),
  );
  const id = r1.data?.Result?.Id;
  console.log(`  Draft Id: ${id}`);
  if (!id) { console.log('  ❌ Failed'); return; }

  // Step 2: View 草稿的数据，看 FOperNumber 是否自动计算了
  console.log('\n=== View Draft 完整数据 ===');
  const r2 = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
      { FormId: 'SFC_OperationReport', data: JSON.stringify({ Id: id }) },
    ),
  );
  const record = r2.data?.Result?.Result;
  if (record) {
    console.log(`  BillNo: "${record.BillNo}", Status: "${record.DocumentStatus}"`);
    console.log(`  F_FD_OperDescp: "${record.F_FD_OperDescp}"`);

    // 小心地打印 FEntity
    const fe = record.FEntity;
    if (fe) {
      console.log(`  FEntity type: ${typeof fe}, isArray: ${Array.isArray(fe)}`);
      if (Array.isArray(fe)) {
        for (let i = 0; i < fe.length; i++) {
          console.log(`  FEntity[${i}]:`);
          for (const key of Object.keys(fe[i])) {
            const val = typeof fe[i][key] === 'object'
              ? JSON.stringify(fe[i][key]).slice(0, 100)
              : fe[i][key];
            console.log(`    ${key}: ${val}`);
          }
        }
      } else if (typeof fe === 'object') {
        console.log(`  FEntity keys: ${Object.keys(fe).slice(0, 20).join(', ')}`);
      }
    } else {
      console.log('  FEntity: null/undefined');
    }

    // 也看 OptRptEntry
    const opt = record.OptRptEntry?.[0];
    if (opt) {
      console.log(`\n  OptRptEntry[0] key fields:`);
      for (const key of ['Id', 'Seq', 'OperNumber', 'MoNumber', 'MoRowNumber', 'WorkCenterId', 'MaterialId', 'FOperNumber']) {
        if (opt[key] !== undefined) {
          console.log(`    ${key}: ${JSON.stringify(opt[key]).slice(0, 80)}`);
        }
      }
    }
  }
}

main().catch(e => console.error('FATAL', e));
