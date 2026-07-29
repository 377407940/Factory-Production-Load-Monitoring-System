/**
 * 先验证 Save API 是否工作（用一个简单单据）
 * 再尝试其他方案
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

async function trySave(label, formId, model) {
  console.log(`\n--- ${label} [${formId}] ---`);
  const result = await client.save(formId, model);
  const resp = result.data;
  if (resp?.Result?.ResponseStatus?.IsSuccess) {
    console.log(`✅ 成功！单号: ${resp.Result.Number}, 内码: ${resp.Result.Id}`);
    return true;
  } else {
    const errs = resp?.Result?.ResponseStatus?.Errors || [];
    errs.forEach(e => console.log(`  ${e.Message}`));
    return false;
  }
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  // 测试1: 用简单单据 - BD_MATERIAL 试试 Save
  // 先跳过，物料可能也要走复杂验证

  // 测试2: 直接查 MO 的 org
  console.log('=== PRD_MO YJYMO2603131 组织 ===');
  const r = await client.callWithAuth(() =>
    client.executeBillQuery('PRD_MO', {
      fieldKeys: ['FBillNo', 'FID', 'FMaterialId.FNumber', 'FQty', 'FMoEntryId'],
      filter: "FBillNo='YJYMO2603131'", skipDateFilter: true, limit: 3,
    }),
  );
  let rows = r.data;
  if (Array.isArray(rows)) {
    for (let i = 0; i < rows.length; i++) console.log(`  [${i}]:`, JSON.stringify(rows[i]));
  }

  // 测试3: 尝试用 SCRK02_Sys 等不同单据类型
  await trySave('测试 SCRK03_Sys', 'PRD_INSTOCK', {
    FBillTypeID: { FNumber: 'SCRK03_Sys' },
    FDate: today,
    FStockOrgId: { FNumber: 'YJY' },
    FPrdOrgId: { FNumber: 'YJY' },
    FOwnerId0: { FNumber: 'YJY' },
    FEntity: [{
      FMaterialId: { FNumber: 'MP010625' },
      FRealQty: 10,
      FUnitId: { FNumber: 'UOM001' },
      FBaseUnitId: { FNumber: 'UOM001' },
      FStockId: { FNumber: '002' },
      FStockStatusId: { FNumber: 'KCZT01_SYS' },
      FOwnerId: { FNumber: 'YJY' },
      FMoBillNo: 'YJYMO2603131',
      FMoEntryId: 117521,
      F_FD_TraceCode: `TEST-${Date.now()}`,
      F_yjy_newRealShop: { FNumber: 'BM000046' },
    }],
  });

  // 测试4: 用 SCRK02_Sys
  await trySave('测试 SCRK02_Sys', 'PRD_INSTOCK', {
    FBillTypeID: { FNumber: 'SCRK02_Sys' },
    FDate: today,
    FStockOrgId: { FNumber: 'YJY' },
    FPrdOrgId: { FNumber: 'YJY' },
    FOwnerId0: { FNumber: 'YJY' },
    FEntity: [{
      FMaterialId: { FNumber: 'MP010625' },
      FRealQty: 10,
      FUnitId: { FNumber: 'UOM001' },
      FBaseUnitId: { FNumber: 'UOM001' },
      FStockId: { FNumber: '002' },
      FStockStatusId: { FNumber: 'KCZT01_SYS' },
      FOwnerId: { FNumber: 'YJY' },
      FMoBillNo: 'YJYMO2603131',
      FMoEntryId: 117521,
      F_FD_TraceCode: `TEST-${Date.now()}`,
      F_yjy_newRealShop: { FNumber: 'BM000046' },
    }],
  });

  // 测试5: 用 SCRK01_Sys 但用 FMoBillNo=FNumber 对象(最后再试一次)
  // 查一下 YJY 组织的内码
  console.log('\n=== 查组织信息 ===');
  // 使用 BD_SUPPLIER 或简单表
  const r2 = await client.callWithAuth(() =>
    client.executeBillQuery('BD_STOCK', {
      fieldKeys: ['FStockId', 'FNumber', 'FName', 'FUseOrgId'],
      filter: "FNumber='CK025'", skipDateFilter: true, limit: 3,
    }),
  );
  let rows2 = r2.data;
  if (Array.isArray(rows2)) for (let i = 0; i < rows2.length; i++) console.log(`  [${i}]:`, JSON.stringify(rows2[i]));
}
main();
