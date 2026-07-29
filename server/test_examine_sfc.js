/**
 * 查看 YJYGXHB26060859 (装盒&装箱报工单) 的结构
 * 探查：操作描述、车间、物料、数量、关联MO、自定义字段
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

async function qr(fieldKeys, filter = '', limit = 5) {
  const r = await client.callWithAuth(() =>
    client.executeBillQuery('SFC_OperationReport', { fieldKeys, filter, skipDateFilter: true, limit }),
  );
  let rows = r.data;
  if (rows && typeof rows === 'object' && !Array.isArray(rows) && Array.isArray(rows.Result)) rows = rows.Result;
  return rows;
}

async function main() {
  // 1. YJYGXHB26060859 的完整信息
  console.log('=== YJYGXHB26060859 完整字段 ===');
  const fields = [
    'FBillNo', 'FDate', 'FMoNumber', 'FBillTypeID.FNumber', 'FDOCUMENTSTATUS',
    'FMaterialId.FNumber', 'FMaterialName', 'FSpecification',
    'FQuaQty', 'FReworkQty', 'FWastageQty',
    'F_YJY_NewRealShop', 'FWorkShopId',
    'F_FD_OperDescp', 'F_FD_AimProducts', 'F_FD_AimTimes',
    'F_FD_Machine.FName', 'F_UNW_WorkType2',
    'F_YJY_loadTimes', 'F_FD_OperDescp',
  ];
  const r1 = await qr(fields, "FBillNo='YJYGXHB26060859'", 1);
  if (r1 && r1[0]) console.log('  ', JSON.stringify(r1[0]));

  // 2. 再看同MO的其他报工
  const moNo = r1?.[0]?.[2]; // FMoNumber 在 index 2
  if (moNo) {
    console.log(`\n=== 同一MO ${moNo} 的其他报工 ===`);
    const r2 = await qr(
      ['FBillNo', 'FDate', 'FQuaQty', 'F_FD_OperDescp', 'FWorkShopId', 'F_YJY_NewRealShop'],
      `FMoNumber='${moNo}' AND FDOCUMENTSTATUS='C'`, 5);
    if (r2) for (let i = 0; i < r2.length; i++) console.log(`  [${i}]:`, JSON.stringify(r2[i]));
  }

  // 3. 查装盒&装箱的 F_FD_OperDescp 都有什么值
  console.log('\n=== "装盒" 相关报工 ===');
  const r3 = await qr(
    ['FBillNo', 'FMoNumber', 'FQuaQty', 'F_FD_OperDescp', 'FWorkShopId', 'F_YJY_NewRealShop'],
    "F_FD_OperDescp LIKE '%装%' AND FDOCUMENTSTATUS='C'", 5);
  if (r3) for (let i = 0; i < r3.length; i++) console.log(`  [${i}]:`, JSON.stringify(r3[i]));

  // 4. 查这个记录对应的 MO 信息
  if (moNo) {
    console.log(`\n=== MO ${moNo} 详情 ===`);
    const r4 = await client.callWithAuth(() =>
      client.executeBillQuery('PRD_MO', {
        fieldKeys: ['FBillNo', 'FDate', 'FMaterialId.FNumber', 'FMaterialName', 'FQty', 'FMoEntryId'],
        filter: `FBillNo='${moNo}'`, skipDateFilter: true, limit: 1,
      }),
    );
    console.log('  MO data:', JSON.stringify(r4.data).slice(0, 300));
  }

  // 5. 尝试用这个 MO 和物料直接创建 SFC
  console.log('\n=== 尝试用装盒物料创建 SFC(不带FEntity) ===');
  // 先获取 MO 的物料
  if (r1 && r1[0]) {
    const matNo = r1[0][3]; // FMaterialId.FNumber
    console.log(`  Material: ${matNo}, MO: ${moNo}, Qty: ${r1[0][5]}`);

    // 用这个物料+MO 试试不带 FEntity
    const today = new Date().toISOString().slice(0, 10);
    const testModel = {
      FDate: today, F_UNW_Date2: today,
      FBillTypeID: { FNumber: 'GXHB01_SYS' },
      F_UNW_MONum: moNo,
      PrdOrgId: { FNumber: 'YJY' },
      FWorkShopId: { FNumber: 'BM000034' },
    };

    // 先试 OptRptEntry only
    console.log('\n--- OptRptEntry only (no FEntity) ---');
    const t1 = await client.save('SFC_OperationReport', {
      ...testModel,
      OptRptEntry: [{
        FMaterialId: { FNumber: matNo },
        FQuaQty: 10,
      }],
    });
    const t1e = t1.data?.Result?.ResponseStatus?.Errors || [];
    t1e.forEach(e => console.log(`  ❌ ${e.Message}`));

    // 再试 FEntity + OptRptEntry
    console.log('\n--- FEntity + OptRptEntry ---');
    const t2 = await client.save('SFC_OperationReport', {
      ...testModel,
      FEntity: [{
        FMaterialId: { FNumber: matNo },
        FQuaQty: 10,
      }],
      OptRptEntry: [{
        FMaterialId: { FNumber: matNo },
        FQuaQty: 10,
      }],
    });
    const t2e = t2.data?.Result?.ResponseStatus?.Errors || [];
    t2e.forEach(e => console.log(`  ❌ ${e.Message}`));
  }
}

main().catch(e => console.error('FATAL', e));
