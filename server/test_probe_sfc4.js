/**
 * 只剩 "汇总" 实体一个障碍。系统化试探所有实体名。
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

async function testEntity(entityName, entityValue) {
  const model = {
    FDate: new Date().toISOString().slice(0, 10),
    F_UNW_Date2: new Date().toISOString().slice(0, 10),
    FBillTypeID: { FNumber: 'GXHB01_SYS' },
    F_UNW_MONum: 'YJYMO2605108',
    PrdOrgId: { FNumber: 'YJY' },
    FWorkShopId: { FNumber: 'BM000034' },
    OptRptEntry: [{ FMaterialId: { FNumber: 'FP010587' }, FQuaQty: 10 }],
  };
  model[entityName] = entityValue;

  try {
    const r = await client.save('SFC_OperationReport', model);
    const resp = r.data;
    if (resp?.Result?.ResponseStatus?.IsSuccess) {
      return { status: 'SUCCESS', number: resp.Result.Number };
    }
    const errs = resp?.Result?.ResponseStatus?.Errors || [];
    const msg = errs.map(e => e.Message).join('; ').slice(0, 150);
    if (msg.includes('汇总')) return { status: 'same' };
    return { status: 'changed', msg };
  } catch (e) {
    return { status: 'error', msg: e.message?.slice(0, 100) };
  }
}

async function main() {
  // 1. 各种可能的汇总实体名（带空数组）
  const topLevelGuesses = [
    'FEntity_HZ', 'FHzEntry', 'FHuizong', 'SummaryEntity', 'FSumEntity',
    'FSummary', 'OptRptSummary', 'FHuizongEntry', 'HuiZongEntry',
    'FHuizon', 'FHuizongEntity', 'FEntity_Summary',
    'FEntity_Sum', 'FTotalEntity', 'F_Entity_HZ',
    'ora_Cust_Entry100002', 'ora_Cust_Entry100003',
    'ora_Cust_Entry100007', 'ora_Cust_Entry100009',
    'FSubEntity', 'FChildEntity', 'FEntityChild', 'FEntrySub',
    'OptRptChild', 'FDetailEntity', 'FDetail', 'FEntity_Detail',
    // 试试 pinyin combinations
    'HZEntry', 'Huizon', 'HuiZong', 'FHz', 'FHuiz',
    // 常见金蝶汇总实体
    'FEntity_SumUp', 'FSummaryEntity', 'SumEntity',
    'FTotal', 'FSum', 'F_Sum', 'F_Summary',
    // 试试为空对象 {}
    'SubHeadEntity1', 'SubEntry',
  ];

  console.log('=== 顶层实体试探 ===');
  // 用空数组 []
  for (const ent of topLevelGuesses) {
    const r = await testEntity(ent, []);
    if (r.status === 'same') continue;
    console.log(`  ${ent}: ${r.status} ${r.msg || r.number || ''}`);
  }

  // 2. 试试汇总作为 OptRptEntry 的子实体
  console.log('\n=== 子实体试探 (在 OptRptEntry 内部) ===');
  const childGuesses = [
    'Summary', 'FSummary', 'FEntity_HZ', 'FHzEntry', 'FHuizong',
    'HuiZong', 'FHz', 'FChildEntity', 'SubEntry',
    'FEntity_Summary', 'SumEntity', 'FTotal',
  ];
  for (const child of childGuesses) {
    const model = {
      FDate: new Date().toISOString().slice(0, 10),
      F_UNW_Date2: new Date().toISOString().slice(0, 10),
      FBillTypeID: { FNumber: 'GXHB01_SYS' },
      F_UNW_MONum: 'YJYMO2605108',
      PrdOrgId: { FNumber: 'YJY' },
      FWorkShopId: { FNumber: 'BM000034' },
      OptRptEntry: [{
        FMaterialId: { FNumber: 'FP010587' },
        FQuaQty: 10,
      }],
    };
    model.OptRptEntry[0][child] = [{}];
    const r = await testEntity(child + ' (child)', model.OptRptEntry);
    // We need a different approach for child entities - save the full model
    try {
      const r2 = await client.save('SFC_OperationReport', model);
      const resp = r2.data;
      if (resp?.Result?.ResponseStatus?.IsSuccess) {
        console.log(`  child:${child} ✅ SUCCESS ${resp.Result.Number}`);
      } else {
        const errs = resp?.Result?.ResponseStatus?.Errors || [];
        const msg = errs.map(e => e.Message).join('; ').slice(0, 150);
        if (!msg.includes('汇总')) console.log(`  child:${child} -> ${msg}`);
      }
    } catch(e) {
      // skip
    }
  }

  // 3. 查一下 SFC_OperationReport 全部系统字段看看哪些实体存在
  console.log('\n=== 查 SFC 已有记录的分录信息 ===');
  const rows = await qr('SFC_OperationReport', [
    'FBillNo', 'FDate', 'FMoNumber', 'FQuaQty', 'FEntryId',
    'FEntity_FEntryId', 'FIndex', 'FSeq',
  ], "FDOCUMENTSTATUS='C'", 3, 'FDate DESC');
  if (rows) for (let i = 0; i < rows.length; i++) console.log(`  [${i}]:`, JSON.stringify(rows[i]));

  // 4. 尝试获取 BOS 元数据
  console.log('\n=== GetFormDesignInfo ===');
  try {
    const meta = await client.getFormMeta('SFC_OperationReport');
    console.log('  Result:', JSON.stringify(meta.data).slice(0, 500));
  } catch(e) {
    console.log('  Error:', e.message?.slice(0, 100));
  }

  // 5. 看看有没有 FMoEntryId 相关的字段
  console.log('\n=== SFC MoEntry 字段 ===');
  const mo = await qr('SFC_OperationReport', [
    'FBillNo', 'FMoEntryId', 'FMoEntry_FEntryId',
  ], "FBillNo='YJYGXHB26060848'", 1);
  if (mo) for (let i = 0; i < mo.length; i++) console.log(`  [${i}]:`, JSON.stringify(mo[i]));

  // 6. 最关键：查 OptRptEntry 的子实体
  console.log('\n=== OptRptEntry 子实体 ===');
  const detail = await qr('SFC_OperationReport', [
    'FBillNo', 'FDetailEntity_FEntryId', 'FDetailId', 'FEntity_Detail',
  ], "FBillNo='YJYGXHB26060848'", 3);
  if (detail) for (let i = 0; i < detail.length; i++) console.log(`  [${i}]:`, JSON.stringify(detail[i]));

  // 7. 直接尝试不带 OptRptEntry 的模型
  console.log('\n=== 无分录测试 ===');
  const r3 = await testEntity('skip', []);
  if (r3.status === 'changed') console.log(`  skip entity: ${r3.msg}`);
}

main().catch(e => console.error('FATAL', e));
