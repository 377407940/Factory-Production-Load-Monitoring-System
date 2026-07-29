/**
 * 换个思路：子实体方式 + 更多实体名 + 含数据 + 不同单据类型
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

async function qr(formId, fieldKeys, filter = '', limit = 5, orderString = '') {
  const r = await client.callWithAuth(() =>
    client.executeBillQuery(formId, { fieldKeys, filter, skipDateFilter: true, limit, orderString }),
  );
  let rows = r.data;
  if (rows && typeof rows === 'object' && !Array.isArray(rows) && Array.isArray(rows.Result)) rows = rows.Result;
  return Array.isArray(rows) ? rows : null;
}

async function trySave(label, model) {
  console.log(`\n--- ${label} ---`);
  console.log(`  model keys: ${Object.keys(model).join(', ')}`);
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

  // 1. 尝试把 "汇总" 作为 OptRptEntry 的子实体
  // 金蝶子实体命名惯例：子实体在父分录每行内
  const childNames = [
    'FEntity_Sub', 'FSubEntity', 'FEntity_Child', 'FChildEntity',
    'FEntrySub', 'FDetailEntity', 'FEntity_Detail', 'FDetail',
    'F_HZ', 'FHz', 'FHuiZong', 'FHuizong', 'Summary',
    'FSummary', 'FEntity_Summary', 'FEntity_HZ', 'FSum',
    'FEntity_Sum', 'FChild', 'FSubEntry', 'FEntry_Sub',
    'FEntitySub', 'FDetailSub', 'FSub'
  ];

  console.log('=== 子实体测试 (在 OptRptEntry 内) ===');
  for (const child of childNames) {
    const model = JSON.parse(JSON.stringify(base));
    model.OptRptEntry = [{
      FMaterialId: { FNumber: 'FP010587' },
      FQuaQty: 10,
    }];
    // 子实体在每行内
    model.OptRptEntry[0][child] = [{}];
    try {
      const r = await client.save('SFC_OperationReport', model);
      const resp = r.data;
      if (resp?.Result?.ResponseStatus?.IsSuccess) {
        console.log(`  child:${child} ✅ SUCCESS ${resp.Result.Number}`);
      } else {
        const errs = resp?.Result?.ResponseStatus?.Errors || [];
        const msg = errs.map(e => e.Message).join('; ').slice(0, 150);
        if (!msg.includes('汇总')) {
          console.log(`  child:${child} CHANGED -> ${msg}`);
        }
      }
    } catch(e) {}
  }

  // 2. 把所有存货名单放一起再试一次，但这次加一个非空汇总实体
  // 猜测汇总实体只要有数据就行
  const topNames = [
    'FEntity_HZ', 'FHuizong', 'FHzEntry', 'FHz', 'FHZ',
    'FHuiZongEntry', 'HuiZongEntry', 'FEntity_Sum', 'FSumEntity',
    'SummaryEntity', 'FSummaryEntity', 'OptRptSummary',
    'FEntity_Summary', 'OptRptTotal', 'TotalEntity',
    'OptRptSum', 'OptRpt_Summary',
    // 试试金蝶常见汇总
    'FEntity_Z', 'FEntity_H', 'Summary', 'FSummary',
    'FTotalQtyEntity', 'FTotal', 'FTotalEntry',
    // 试试中文直接
    'huizong', 'HuiZong', 'huizon',
    // 试试其他常见形式
    'EntrySummary', 'FEntrySummary', 'FDetailSummary',
    'FTotalSummary', 'FSumSummary',
    // 新猜测
    'FEntity_Total', 'F_Entity_Total',
    'OptRpt_Sum', 'OptRpt_HZ', 'OptRpt_HuiZong',
  ];

  console.log('\n=== 顶层实体+数据测试 ===');
  for (const ent of topNames) {
    const model = JSON.parse(JSON.stringify(base));
    model.OptRptEntry = [{ FMaterialId: { FNumber: 'FP010587' }, FQuaQty: 10 }];
    // 加实体含数据
    model[ent] = [{ FQuaQty: 10 }];
    try {
      const r = await client.save('SFC_OperationReport', model);
      const resp = r.data;
      if (resp?.Result?.ResponseStatus?.IsSuccess) {
        console.log(`  ${ent} ✅ SUCCESS ${resp.Result.Number}`);
      } else {
        const errs = resp?.Result?.ResponseStatus?.Errors || [];
        const msg = errs.map(e => e.Message).join('; ').slice(0, 150);
        if (!msg.includes('汇总')) {
          console.log(`  ${ent} CHANGED -> ${msg}`);
        }
      }
    } catch(e) {}
  }

  // 3. 试不同的单据类型
  console.log('\n=== 不同单据类型测试 ===');
  const billTypes = ['GXHB01_SYS', 'GXHB02_Sys', 'SCRK01_Sys'];
  for (const bt of billTypes) {
    const model = JSON.parse(JSON.stringify(base));
    model.FBillTypeID = { FNumber: bt };
    model.OptRptEntry = [{ FMaterialId: { FNumber: 'FP010587' }, FQuaQty: 10 }];
    try {
      const r = await client.save('SFC_OperationReport', model);
      const resp = r.data;
      const errs = resp?.Result?.ResponseStatus?.Errors || [];
      const msg = errs.map(e => e.Message).join('; ').slice(0, 150);
      console.log(`  ${bt}: ${resp?.Result?.ResponseStatus?.IsSuccess ? '✅' : '❌'} ${msg.slice(0, 100)}`);
    } catch(e) {
      console.log(`  ${bt}: error ${e.message?.slice(0,50)}`);
    }
  }

  // 4. 查其他字段看看能否找到实体线索
  console.log('\n=== 查一条完整 SFC 记录除标准字段外还有啥 ===');
  // 尝试已知的聚合引擎字段 + 一些可能的实体字段
  const extraFields = [
    'FBillNo', 'FMoNumber', 'FQuaQty', 'FReworkQty', 'FWastageQty',
    'FEntryId', 'FEntity_FEntryId', 'FIndex', 'FSeq',
    'FDetailEntity_FEntryId', 'FSubEntity_FEntryId',
    'FHaveSubEntry', 'FIsSumEntry',
    'FEntity_Sum_FEntryId', 'FSum_FEntryId',
    'FHz_FEntryId', 'FHZ_FEntryId',
    'FMoEntryId', 'FMoEntrySeq',
  ];
  for (const batch of [extraFields.slice(0,7), extraFields.slice(7)]) {
    try {
      const r = await qr('SFC_OperationReport', batch,
        "FBillNo='YJYGXHB26060848'", 1);
      if (r) for (let i = 0; i < r.length; i++) console.log(`  batch:`, JSON.stringify(r[i]).slice(0, 200));
    } catch(e) {}
  }
}

main().catch(e => console.error('FATAL', e));
