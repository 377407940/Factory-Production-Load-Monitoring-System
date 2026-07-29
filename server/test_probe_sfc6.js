/**
 * 汇总实体终极探查：中文名 + 不同API端点 + 查系统表
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
    errs.forEach(e => `  ❌ ${e.Message}`.slice(0, 200));
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
    OptRptEntry: [{ FMaterialId: { FNumber: 'FP010587' }, FQuaQty: 10 }],
  };

  // 1. 试试直接拿中文 "汇总" 当 entity 名
  console.log('=== 中文实体名 ===');
  const r1 = await client.save('SFC_OperationReport', {
    ...base,
    "汇总": [{ FQuaQty: 10 }],
  });
  const r1e = r1.data?.Result?.ResponseStatus?.Errors || [];
  console.log(`  中文"汇总": ${r1e.map(e=>e.Message).join('; ').slice(0,200)}`);

  // 2. 试试直接改 request 格式——用 FContent 或直接 raw
  console.log('\n=== Raw approach ===');
  // 有些金蝶要求实体放在 FEntity 数组而不是具名
  const r2 = await client.save('SFC_OperationReport', {
    ...base,
    FEntity: base.OptRptEntry,
  });
  delete r2.data?.OptRptEntry;
  const r2e = r2.data?.Result?.ResponseStatus?.Errors || [];
  console.log(`  FEntity: ${r2e.map(e=>e.Message).join('; ').slice(0,200)}`);

  // 3. 直接不传 OptRptEntry，只传 FEntity
  const { OptRptEntry, ...baseNoEntry } = base;
  const r3 = await client.save('SFC_OperationReport', {
    ...baseNoEntry,
    FEntity: [{ FMaterialId: { FNumber: 'FP010587' }, FQuaQty: 10 }],
  });
  const r3e = r3.data?.Result?.ResponseStatus?.Errors || [];
  console.log(`  FEntity only: ${r3e.map(e=>e.Message).join('; ').slice(0,200)}`);

  // 4. 试 Kingdee 的 ViewModel 格式
  // 有些金蝶版本接受 { FormId, Model: { ... } } 的扁平格式
  console.log('\n=== ViewModel 格式 ===');
  try {
    const r4 = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Save.common.kdsvc',
        {
          FormId: 'SFC_OperationReport',
          data: JSON.stringify({
            Model: {
              FDate: today, F_UNW_Date2: today,
              FBillTypeID: { FNumber: 'GXHB01_SYS' },
              F_UNW_MONum: 'YJYMO2605108',
              PrdOrgId: { FNumber: 'YJY' },
              FWorkShopId: { FNumber: 'BM000034' },
            },
          }),
        },
      ),
    );
    const r4e = r4.data?.Result?.ResponseStatus?.Errors || [];
    console.log(`  header only: ${r4e.map(e=>e.Message).join('; ').slice(0,200)}`);
  } catch(e) {
    console.log(`  error: ${e.message}`);
  }

  // 5. 查金蝶系统表看看 SFC_OperationReport 的实体信息
  console.log('\n=== 查系统表 ===');
  // 试试 T_META_FORMTABLE
  for (const sql of [
    "SELECT FID, FNAME_L2 FROM T_META_FORMTABLE WHERE FFORMID='SFC_OperationReport'",
    "SELECT FID, FNAME_L2 FROM T_META_FIELD WHERE FFORMID='SFC_OperationReport' AND FFIELDTYPE='Entity'",
  ]) {
    try {
      // 可能金蝶不支持直接 SQL
      const r = await client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.ExecuteBillQuery.common.kdsvc',
        { data: JSON.stringify({ FormId: 'T_META_FORMTABLE', FieldKeys: 'FID,FNAME_L2', FilterString: "FFORMID='SFC_OperationReport'", Limit: 10 }) },
      );
      console.log(`  SQL attempt:`, JSON.stringify(r.data).slice(0, 300));
    } catch(e) {
      console.log(`  SQL error: ${e.message?.slice(0,80)}`);
    }
  }

  // 6. 换个端点：GetEntity
  console.log('\n=== GetEntity ===');
  try {
    const r = await client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.GetEntity.common.kdsvc',
      { data: JSON.stringify({ FormId: 'SFC_OperationReport', EntityKey: '' }) },
    );
    console.log('  Result:', JSON.stringify(r.data).slice(0, 500));
  } catch(e) {
    console.log(`  Error: ${e.message?.slice(0,80)}`);
  }

  // 7. 看能不能直接把一条已有 SFC 反审核再保存来获取参考
  console.log('\n=== 已有 SFC 记录审计 ===');
  const r7 = await client.callWithAuth(() =>
    client.executeBillQuery('SFC_OperationReport', {
      fieldKeys: ['FBillNo', 'FMoNumber', 'FQuaQty', 'FReworkQty', 'FWastageQty', 'FID'],
      filter: "FBillNo='YJYGXHB26060848'", skipDateFilter: true, limit: 1,
    }),
  );
  console.log('  Existing record:', JSON.stringify(r7.data).slice(0, 300));
}

main().catch(e => console.error('FATAL', e));
