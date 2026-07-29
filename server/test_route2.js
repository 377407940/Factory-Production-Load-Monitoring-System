/**
 * 查工艺路线（用已有 SFC 记录的 Route）
 * 以及完全另类的方法
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

async function main() {
  // 1. 查 Route - 看看包装记录的工艺路线信息
  console.log('=== 查已有 SFC 包装记录 ===');
  try {
    const r = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
        { FormId: 'SFC_OperationReport', data: JSON.stringify({ Number: 'YJYGXHB26060859' }) },
      ),
    );
    const entry = r.data?.Result?.Result?.OptRptEntry?.[0];
    if (entry) {
      console.log('  RouteId:', entry.RouteId?.Number, 'Id:', entry.RouteId_Id);
      console.log('  MoId:', entry.MoId, 'MoEntryId:', entry.MoEntryId);
      console.log('  OptPlanId:', entry.OptPlanId, 'OptPlanSeqId:', entry.OptPlanSeqId, 'OptPlanOptId:', entry.OptPlanOptId);
      console.log('  WorkCenterId:', entry.WorkCenterId?.Number, 'Id:', entry.WorkCenterId_Id);
      console.log('  OperNumber:', entry.OperNumber);
    }
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 2. 查 MO 的工艺路线信息（可能在其他字段）
  console.log('\n=== 查 MO 的 RouteId（PRD_MO View）===');
  try {
    const r = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
        { FormId: 'PRD_MO', data: JSON.stringify({ Number: 'YJYMO2603133' }) },
      ),
    );
    const mo = r.data?.Result?.Result;
    if (mo) {
      if (mo.MOEntry?.[0]) {
        console.log('  RouteId:', mo.MOEntry[0].RouteId?.Number);
        console.log('  RouteId_Id:', mo.MOEntry[0].RouteId_Id);
      }
    }
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 3. 另类思路：试试 FOperNumber 用对象格式 { Id: OperPlanOptId }
  console.log('\n=== FOperNumber as object { Id } ===');
  const today = new Date().toISOString().slice(0, 10);
  try {
    const r = await client.save('SFC_OperationReport', {
      FDate: today, F_UNW_Date2: today,
      FBillTypeID: { FNumber: 'GXHB01_SYS' },
      F_UNW_MONum: 'YJYMO2603133',
      PrdOrgId: { FNumber: 'YJY' },
      FWorkShopId: { FNumber: 'BM000034' },
      F_FD_OperDescp: '装盒&装箱',
      OptRptEntry: [{ FMaterialId: { FNumber: 'FP010580' }, FQuaQty: 10 }],
      FEntity: [{
        FSeqNumber: "0",
        FOperNumber: { Id: 120719 },  // OptPlanOptId from packaging rec
        FQuaQty: 10,
        FMaterialId: { FNumber: 'FP010580' },
        FWorkCenterId: { FNumber: 'WC000003' },
        FUnitID: { FNumber: 'Pcs' },
        MoRowNumber: 1,
        MoNumber: 'YJYMO2603133',
      }],
    });
    const errs = r.data?.Result?.ResponseStatus?.Errors || [];
    errs.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 300)}`));
    if (r.data?.Result?.ResponseStatus?.IsSuccess) console.log(`  ✅ ${r.data?.Result?.Number}`);
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 4. 试在 OptRptEntry 带完整信息，FEntity 极度精简
  console.log('\n=== OptRptEntry 完整 + FEntity 只有 FSeqNumber ===');
  try {
    const r = await client.save('SFC_OperationReport', {
      FDate: today, F_UNW_Date2: today,
      FBillTypeID: { FNumber: 'GXHB01_SYS' },
      F_UNW_MONum: 'YJYMO2603133',
      PrdOrgId: { FNumber: 'YJY' },
      FWorkShopId: { FNumber: 'BM000034' },
      F_FD_OperDescp: '装盒&装箱',
      OptRptEntry: [{
        FMaterialId: { FNumber: 'FP010580' },
        FQuaQty: 10,
        // 加 OptRptEntry 的完整字段
        WorkCenterId: { Id: 188050 },
        OperNumber: 10,
        Seq: 1,
        MoNumber: 'YJYMO2603133',
        MoRowNumber: 1,
        FUnitID: { FNumber: 'Pcs' },
      }],
      FEntity: [{
        FSeqNumber: "0",
        FQuaQty: 10,
        FMaterialId: { FNumber: 'FP010580' },
        FWorkCenterId: { FNumber: 'WC000003' },
        FUnitID: { FNumber: 'Pcs' },
        MoRowNumber: 1,
        MoNumber: 'YJYMO2603133',
        // 不加 FOperNumber
      }],
    });
    const errs = r.data?.Result?.ResponseStatus?.Errors || [];
    errs.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 300)}`));
    if (r.data?.Result?.ResponseStatus?.IsSuccess) console.log(`  ✅ ${r.data?.Result?.Number}`);
  } catch(e) {
    console.log('  Error:', e.message);
  }
}

main().catch(e => console.error('FATAL', e));
