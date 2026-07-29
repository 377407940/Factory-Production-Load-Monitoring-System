/**
 * 在 OptRptEntry 里传 MoNumber + MoRowNumber
 * 让系统能找到工序计划
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  // 传 MoNumber/MoRowNumber 在 OptRptEntry 里
  console.log('=== OptRptEntry with MoNumber + MoRowNumber ===');
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
      MoNumber: 'YJYMO2603133',      // 关键：OptRptEntry 里传 MO 号
      MoRowNumber: 1,                 // 关键：MO 分录行号
      OperNumber: 10,                 // 工序号
    }],
    FEntity: [{
      FSeqNumber: "0",
      FOperNumber: 10,
      FQuaQty: 10,
      FMaterialId: { FNumber: 'FP010580' },
      FWorkCenterId: { FNumber: 'WC000004' },
      FUnitID: { FNumber: 'Pcs' },
      MoNumber: 'YJYMO2603133',
      MoRowNumber: 1,
    }],
  });
  const errs = r.data?.Result?.ResponseStatus?.Errors || [];
  errs.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 300)}`));
  if (r.data?.Result?.ResponseStatus?.IsSuccess) console.log(`  ✅ ${r.data?.Result?.Number}`);

  // 也许 OptRptEntry 就够了，不加 FEntity？
  console.log('\n=== No FEntity, OptRptEntry full ===');
  const r2 = await client.save('SFC_OperationReport', {
    FDate: today, F_UNW_Date2: today,
    FBillTypeID: { FNumber: 'GXHB01_SYS' },
    F_UNW_MONum: 'YJYMO2603133',
    PrdOrgId: { FNumber: 'YJY' },
    FWorkShopId: { FNumber: 'BM000034' },
    F_FD_OperDescp: '装盒&装箱',
    OptRptEntry: [{
      FMaterialId: { FNumber: 'FP010580' },
      FQuaQty: 10,
      MoNumber: 'YJYMO2603133',
      MoRowNumber: 1,
      OperNumber: 10,
      WorkCenterId: { Id: 188050 },
      FUnitID: { FNumber: 'Pcs' },
    }],
    // 不加 FEntity
  });
  const errs2 = r2.data?.Result?.ResponseStatus?.Errors || [];
  errs2.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 300)}`));
  if (r2.data?.Result?.ResponseStatus?.IsSuccess) console.log(`  ✅ ${r2.data?.Result?.Number}`);

  // 试试在 OptRptEntry 加 MoId + MoEntryId
  console.log('\n=== OptRptEntry with MoId/MoEntryId ===');
  const r3 = await client.save('SFC_OperationReport', {
    FDate: today, F_UNW_Date2: today,
    FBillTypeID: { FNumber: 'GXHB01_SYS' },
    F_UNW_MONum: 'YJYMO2603133',
    PrdOrgId: { FNumber: 'YJY' },
    FWorkShopId: { FNumber: 'BM000034' },
    F_FD_OperDescp: '装盒&装箱',
    OptRptEntry: [{
      FMaterialId: { FNumber: 'FP010580' },
      FQuaQty: 10,
      MoNumber: 'YJYMO2603133',
      MoRowNumber: 1,
      OperNumber: 10,
      MoId: 117479,
      MoEntryId: 117523,
    }],
    FEntity: [{
      FSeqNumber: "0",
      FOperNumber: 10,
      FQuaQty: 10,
      FMaterialId: { FNumber: 'FP010580' },
      FWorkCenterId: { FNumber: 'WC000004' },
      FUnitID: { FNumber: 'Pcs' },
      MoNumber: 'YJYMO2603133',
      MoRowNumber: 1,
    }],
  });
  const errs3 = r3.data?.Result?.ResponseStatus?.Errors || [];
  errs3.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 300)}`));
  if (r3.data?.Result?.ResponseStatus?.IsSuccess) console.log(`  ✅ ${r3.data?.Result?.Number}`);
}

main().catch(e => console.error('FATAL', e));
