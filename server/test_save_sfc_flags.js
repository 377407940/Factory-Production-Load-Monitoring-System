/**
 * 试 IgnoreInterationFlag + ValidateFlag + IsVerifyBaseDataField
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
    F_UNW_MONum: 'YJYMO2605108',
    PrdOrgId: { FNumber: 'YJY' },
    FWorkShopId: { FNumber: 'BM000034' },
    FEntity: [{ FMaterialId: { FNumber: 'FP010587' }, FQuaQty: 10 }],
    OptRptEntry: [{ FMaterialId: { FNumber: 'FP010587' }, FQuaQty: 10 }],
  };

  // 各种参数组合
  const configs = [
    { IgnoreInterationFlag: true },
    { IgnoreInterationFlag: true, InterationFlags: '' },
    { ValidateFlag: false },
    { IsVerifyBaseDataField: false },
    { IsAutoAdjustField: false },
    { IgnoreInterationFlag: true, ValidateFlag: false, IsAutoAdjustField: false, IsVerifyBaseDataField: false },
  ];

  for (const cfg of configs) {
    const label = Object.keys(cfg).join(',');
    console.log(`\n--- ${label} ---`);
    const r = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Save.common.kdsvc',
        {
          FormId: 'SFC_OperationReport',
          data: JSON.stringify({ Model: model, ...cfg }),
        },
      ),
    );
    const resp = r.data;
    if (resp?.Result?.ResponseStatus?.IsSuccess) {
      console.log(`  ✅ ${resp.Result.Number}`);
    } else {
      const errs = resp?.Result?.ResponseStatus?.Errors || [];
      if (errs.length > 0) {
        // 去重显示
        const msgs = [...new Set(errs.map(e => e.Message))];
        msgs.forEach(m => console.log(`  ❌ ${m.slice(0, 200)}`));
      } else {
        console.log(`  Response:`, JSON.stringify(resp).slice(0, 200));
      }
    }
  }

  // 额外：试试用 FEntity_Link 代替 FEntity
  console.log('\n--- FEntity_Link instead of FEntity ---');
  const r2 = await client.save('SFC_OperationReport', {
    FDate: today, F_UNW_Date2: today,
    FBillTypeID: { FNumber: 'GXHB01_SYS' },
    F_UNW_MONum: 'YJYMO2605108',
    PrdOrgId: { FNumber: 'YJY' },
    FWorkShopId: { FNumber: 'BM000034' },
    FEntity_Link: [{ FMaterialId: { FNumber: 'FP010587' }, FQuaQty: 10 }],
    OptRptEntry: [{ FMaterialId: { FNumber: 'FP010587' }, FQuaQty: 10 }],
  });
  const r2e = r2.data?.Result?.ResponseStatus?.Errors || [];
  r2e.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 150)}`));
  if (!r2e.length) console.log('  Response:', JSON.stringify(r2.data).slice(0, 200));
}

main().catch(e => console.error('FATAL', e));
