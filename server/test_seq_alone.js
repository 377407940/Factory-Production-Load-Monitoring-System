/**
 * 单独测 Seq 字段，看它是不是"工序序列"
 * 之前 Seq 总是和 FOperNumber 一起测试，FOperNumber 先失败
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

async function trySave(label, model) {
  console.log(`\n--- ${label} ---`);
  const r = await client.save('SFC_OperationReport', model);
  const resp = r.data;
  if (resp?.Result?.ResponseStatus?.IsSuccess) {
    console.log(`  ✅ ${resp.Result.Number}`);
    return true;
  } else {
    const errs = resp?.Result?.ResponseStatus?.Errors || [];
    errs.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 300)}`));
    return false;
  }
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

  // 只加 Seq，不加 FOperNumber
  await trySave('Seq=1 only (no OperNumber)', {
    ...base,
    FEntity: [{
      FQuaQty: 10,
      FMaterialId: { FNumber: 'FP010580' },
      FWorkCenterId: { FNumber: 'WC000003' },
      FUnitID: { FNumber: 'Pcs' },
      Seq: 1,
    }],
  });

  // 只加 FSeq (大写)
  await trySave('FSeq=1 only', {
    ...base,
    FEntity: [{
      FQuaQty: 10,
      FMaterialId: { FNumber: 'FP010580' },
      FWorkCenterId: { FNumber: 'WC000003' },
      FUnitID: { FNumber: 'Pcs' },
      FSeq: 1,
    }],
  });

  // 不传任何序列字段
  await trySave('NO seq fields at all', {
    ...base,
    FEntity: [{
      FQuaQty: 10,
      FMaterialId: { FNumber: 'FP010580' },
      FWorkCenterId: { FNumber: 'WC000003' },
      FUnitID: { FNumber: 'Pcs' },
    }],
  });

  // 试 SeqNumber
  await trySave('SeqNumber="0"', {
    ...base,
    FEntity: [{
      FQuaQty: 10,
      FMaterialId: { FNumber: 'FP010580' },
      FWorkCenterId: { FNumber: 'WC000003' },
      FUnitID: { FNumber: 'Pcs' },
      SeqNumber: "0",
    }],
  });

  // 试 FSeqNumber
  await trySave('FSeqNumber="0"', {
    ...base,
    FEntity: [{
      FQuaQty: 10,
      FMaterialId: { FNumber: 'FP010580' },
      FWorkCenterId: { FNumber: 'WC000003' },
      FUnitID: { FNumber: 'Pcs' },
      FSeqNumber: "0",
    }],
  });

  // 试 FOperNumber(跳过验证)看看是否 Seq 字段名被误解
  // 不传 FOperNumber，只传 Seq，看看是否改变
  // 也试 empty FEntity
  await trySave('FEntity: [{}]', {
    ...base,
    FEntity: [{}],
  });
}

main().catch(e => console.error('FATAL', e));
