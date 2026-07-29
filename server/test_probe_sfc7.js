/**
 * 汇总实体 = FEntity！服务规则需要 F_FD_OperDescp/F_FD_AimProducts/F_FD_AimTimes
 * 测试同时传 OptRptEntry + FEntity
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
    errs.forEach(e => console.log(`  ❌ ${e.Message}`));
    return false;
  }
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const base = {
    FDate: today, F_UNW_Date2: today,
    FBillTypeID: { FNumber: 'GXHB01_SYS' },
    F_UNW_MONum: 'YJYMO2605108',
    PrdOrgId: { FNumber: 'YJY' },
    FWorkShopId: { FNumber: 'BM000034' },
  };

  // 1. FEntity 作为独立实体（含服务规则需要的字段）
  // 推测：FEntity 是汇总实体，需要合计数量和异常字段
  await trySave('FEntity + OptRptEntry', {
    ...base,
    FEntity: [{
      // FEntity 字段：根据服务规则需要的
      F_FD_OperDescp: 'test',
      F_FD_AimProducts: 10,
      F_FD_AimTimes: 1,
      FQuaQty: 10,
    }],
    OptRptEntry: [{
      FMaterialId: { FNumber: 'FP010587' },
      FQuaQty: 10,
    }],
  });

  // 2. 只用 FEntity，不用 OptRptEntry（FEntity 可能代替了明细）
  await trySave('FEntity only (no OptRptEntry)', {
    ...base,
    FEntity: [{
      FMaterialId: { FNumber: 'FP010587' },
      FQuaQty: 10,
      F_FD_OperDescp: 'test',
      F_FD_AimProducts: 10,
      F_FD_AimTimes: 1,
    }],
  });

  // 3. FEntity 带全部已知字段
  await trySave('FEntity full fields', {
    ...base,
    FEntity: [{
      FMaterialId: { FNumber: 'FP010587' },
      FQuaQty: 10,
      FReworkQty: 0,
      FWastageQty: 0,
      F_FD_OperDescp: 'test report',
      F_FD_AimProducts: 10,
      F_FD_AimTimes: 1,
      F_YJY_loadTimes: 1,
    }],
  });

  // 4. 用 FDocumentStatus or FDocumentStatus
  await trySave('FEntity with FDocumentStatus', {
    ...base,
    FEntity: [{
      FMaterialId: { FNumber: 'FP010587' },
      FQuaQty: 10,
      F_FD_OperDescp: 'test灌装test',  // 包含"灌装"触发的规则
      F_FD_AimProducts: 10,
      F_FD_AimTimes: 1,
      FDocumentStatus: 'Z',  // 草稿状态
    }],
  });
}

main().catch(e => console.error('FATAL', e));
