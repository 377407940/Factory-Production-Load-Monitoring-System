/**
 * 最终测试：MO 有工艺路线 RT000003，那为什么 FOperNumber=10 验证不通过？
 * 测试关键假设：系统在 Save 时可能查不到工序计划实例
 *
 * 思路：先 Draft（跳过 FOperNumber 验证）
 * 然后直接 Save（更新草稿），用 FOperNumber: { Id: 120719 } 来提供工序引用
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

async function call(servicePath, payload) {
  const r = await client.callWithAuth(() => client._request(servicePath, payload));
  return r.data;
}

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

  // 1. Draft without FOperNumber (should work)
  console.log('=== 1. Draft (no FOperNumber) ===');
  const rD = await call(
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
            FWorkCenterId: { FNumber: 'WC000004' },
            FUnitID: { FNumber: 'Pcs' },
            MoRowNumber: 1,
            MoNumber: 'YJYMO2603133',
          }],
        },
      }),
    },
  );
  const id = rD?.Result?.Id;
  console.log(`  Draft Id: ${id}`);
  if (!id) { console.log('  ❌ Draft failed:', JSON.stringify(rD?.Result?.ResponseStatus).slice(0, 200)); return; }

  // 2. Now try Save (update) with FOperNumber: { Id: 120719 }
  // This is the OptPlanOptId from existing SFC
  console.log('\n=== 2. Save (update) with FOperNumber Id ===');
  const rS = await call(
    'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Save.common.kdsvc',
    {
      FormId: 'SFC_OperationReport',
      data: JSON.stringify({
        Model: {
          Id: id,
          ...base,
          FEntity: [{
            FSeqNumber: "0",
            FOperNumber: { Id: 120719 },
            FQuaQty: 10,
            FMaterialId: { FNumber: 'FP010580' },
            FWorkCenterId: { FNumber: 'WC000004' },
            FUnitID: { FNumber: 'Pcs' },
            MoRowNumber: 1,
            MoNumber: 'YJYMO2603133',
          }],
        },
      }),
    },
  );
  const rs = rS?.Result?.ResponseStatus;
  if (rs?.IsSuccess) {
    const bn = rS?.Result?.Number;
    console.log(`  ✅ ${bn}`);

    // Submit
    console.log(`\n=== 3. Submit ${bn} ===`);
    const rSub = await call(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Submit.common.kdsvc',
      { FormId: 'SFC_OperationReport', Data: JSON.stringify({ Numbers: bn }) },
    );
    console.log('  Submit:', rSub?.Result?.ResponseStatus?.IsSuccess ? '✅' : '❌');

    if (rSub?.Result?.ResponseStatus?.IsSuccess) {
      console.log(`\n=== 4. Audit ${bn} ===`);
      const rAud = await call(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Audit.common.kdsvc',
        { FormId: 'SFC_OperationReport', Data: JSON.stringify({ Numbers: bn }) },
      );
      console.log('  Audit:', rAud?.Result?.ResponseStatus?.IsSuccess ? '✅🎉' : '❌');
    }
  } else {
    const errs = rs?.Errors || [];
    errs.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 300)}`));

    // 3. Alternative: Save with integer FOperNumber
    console.log('\n=== 3. Save (update) with FOperNumber=10 ===');
    const rS2 = await call(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Save.common.kdsvc',
      {
        FormId: 'SFC_OperationReport',
        data: JSON.stringify({
          Model: {
            Id: id,
            ...base,
            FEntity: [{
              FSeqNumber: "0",
              FOperNumber: 10,
              FQuaQty: 10,
              FMaterialId: { FNumber: 'FP010580' },
              FWorkCenterId: { FNumber: 'WC000004' },
              FUnitID: { FNumber: 'Pcs' },
              MoRowNumber: 1,
              MoNumber: 'YJYMO2603133',
            }],
          },
        }),
      },
    );
    const rs2 = rS2?.Result?.ResponseStatus;
    if (rs2?.IsSuccess) {
      console.log(`  ✅ ${rS2?.Result?.Number}`);
    } else {
      const errs2 = rs2?.Errors || [];
      errs2.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 300)}`));
    }
  }
}

main().catch(e => console.error('FATAL', e));
