/**
 * SFC：试 Id 格式 + 查现有单据类型
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

async function trySave(label, model) {
  console.log(`  ${label}:`, JSON.stringify(model).slice(0, 300));
  const r = await client.save('SFC_OperationReport', model);
  const resp = r.data;
  if (resp?.Result?.ResponseStatus?.IsSuccess) {
    console.log(`    ✅ 成功！${resp.Result.Number}`);
    return true;
  } else {
    const errs = resp?.Result?.ResponseStatus?.Errors || [];
    console.log(`    ❌ ${errs.map(e => e.Message).join('; ').slice(0, 150)}`);
    return false;
  }
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const base = {
    FDate: today, F_UNW_Date2: today,
    F_UNW_MONum: 'YJYMO2605108',
    PrdOrgId: { FNumber: 'YJY' },
    OptRptEntry: [{ FMaterialId: { FNumber: 'FP010587' }, FQuaQty: 10 }],
  };

  // 各种 WorkShopID 格式
  console.log('=== WorkShopID 格式测试 ===');
  await trySave('Id:214148', { ...base, WorkShopID: { Id: 214148 } });
  await trySave('FId:214148', { ...base, WorkShopID: { FId: 214148 } });
  // 用 PrdOrgId 格式
  await trySave('FNumber:Y固体二车间', { ...base, WorkShopID: { FNumber: 'Y固体一2号车间' } });

  // 直接看查一下已有 SFC 的单据类型
  console.log('\n=== 查 SFC 单据类型 ===');
  const r = await client.callWithAuth(() =>
    client.executeBillQuery('SFC_OperationReport', {
      fieldKeys: ['FBillNo', 'FBillTypeID.FNumber'],
      filter: "FDOCUMENTSTATUS='C'", skipDateFilter: true, limit: 3,
      orderString: 'FDate DESC',
    }),
  );
  let rows = r.data;
  if (Array.isArray(rows)) for (let i = 0; i < rows.length; i++) console.log(`  [${i}]:`, JSON.stringify(rows[i]));
}
main();
