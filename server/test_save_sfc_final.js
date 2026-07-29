/**
 * 终极 SFC Save 测试：用 IgnoreRule 跳过问题规则
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

async function trySave(label, model, opts = {}) {
  console.log(`\n--- ${label} ---`);
  const r = await client.save('SFC_OperationReport', model, opts);
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

  // 模型1：FEntity 代替 OptRptEntry（FEntity = "汇总" 实体）
  const base = {
    FDate: today, F_UNW_Date2: today,
    FBillTypeID: { FNumber: 'GXHB01_SYS' },
    F_UNW_MONum: 'YJYMO2605108',
    PrdOrgId: { FNumber: 'YJY' },
    FWorkShopId: { FNumber: 'BM000034' },
  };

  // 测试1: 只有 FEntity + IgnoreRule
  await trySave('FEntity + IgnoreRule', {
    ...base,
    FEntity: [{
      FMaterialId: { FNumber: 'FP010587' },
      FQuaQty: 10,
    }],
  }, { ignoreRule: true });

  // 测试2: FEntity + OptRptEntry 同时传 + IgnoreRule
  await trySave('Both entities + IgnoreRule', {
    ...base,
    FEntity: [{
      FMaterialId: { FNumber: 'FP010587' },
      FQuaQty: 10,
    }],
    OptRptEntry: [{
      FMaterialId: { FNumber: 'FP010587' },
      FQuaQty: 10,
    }],
  }, { ignoreRule: true });

  // 测试3: 先不跳过规则，但提供 FEntity 和 F_FD_OperDescp
  // 看看能不能直接传这些字段
  await trySave('FEntity + fields', {
    ...base,
    FEntity: [{
      FMaterialId: { FNumber: 'FP010587' },
      FQuaQty: 10,
      // 规则需要的字段
      F_FD_OperDescp: '液体灌装',
      F_FD_AimProducts: 22176,
      F_FD_AimTimes: 3.08,
      FDocumentStatus: 'C',
    }],
    OptRptEntry: [{
      FMaterialId: { FNumber: 'FP010587' },
      FQuaQty: 10,
    }],
  });

  // 测试4: 如果 FEntity 不带规则字段但 IgnoreRule = true
  await trySave('FEntity only + IgnoreRule', {
    ...base,
    FEntity: [{
      FMaterialId: { FNumber: 'FP010587' },
      FQuaQty: 10,
    }],
  }, { ignoreRule: true });

  // 测试5: 试试空的 FEntity
  await trySave('FEntity empty + IgnoreRule', {
    ...base,
    FEntity: [],
  }, { ignoreRule: true });
}

main().catch(e => console.error('FATAL', e));
