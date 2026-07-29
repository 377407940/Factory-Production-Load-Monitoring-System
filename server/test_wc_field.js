/**
 * 试 FEntity 工作中心的各种字段名 + 查 FNumber
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

async function test(label, extraFEntity) {
  const today = new Date().toISOString().slice(0, 10);
  const model = {
    FDate: today, F_UNW_Date2: today,
    FBillTypeID: { FNumber: 'GXHB01_SYS' },
    F_UNW_MONum: 'YJYMO2605108',
    PrdOrgId: { FNumber: 'YJY' },
    FWorkShopId: { FNumber: 'BM000034' },
    F_FD_OperDescp: '装盒&装箱',
    OptRptEntry: [{ FMaterialId: { FNumber: 'FP010587' }, FQuaQty: 10 }],
    FEntity: [{ ...extraFEntity }],
  };
  const r = await client.save('SFC_OperationReport', model);
  const resp = r.data;
  if (resp?.Result?.ResponseStatus?.IsSuccess) {
    console.log(`  ✅ ${label}: ${resp.Result.Number}`);
    return true;
  }
  const errs = resp?.Result?.ResponseStatus?.Errors || [];
  const msgs = errs.map(e => e.Message).join('; ').slice(0, 150);
  // 看错误是否变了
  if (msgs.includes('工作中心')) {
    // still the same
    return false;
  }
  console.log(`  🔶 ${label}: ${msgs}`);
  return false;
}

async function main() {
  // 查 EN_WorkCenter 获取工作中心 FNumber
  console.log('=== 工作中心查询 ===');
  try {
    const r = await client.callWithAuth(() =>
      client.executeBillQuery('ENG_WorkCenter', {
        fieldKeys: ['FWorkCenterId', 'FNumber', 'FName'],
        skipDateFilter: true, limit: 10,
      }),
    );
    let rows = r.data;
    if (Array.isArray(rows)) {
      for (let i = 0; i < rows.length; i++) {
        if (Array.isArray(rows[i])) {
          // 2D array
          console.log(`  [${i}]:`, JSON.stringify(rows[i]));
        } else if (rows[i].FWorkCenterId) {
          console.log(`  [${i}]:`, JSON.stringify(rows[i]));
        }
      }
      // 也可能是对象数组
      if (typeof rows[0] === 'object' && !Array.isArray(rows[0])) {
        for (let i = 0; i < Math.min(5, rows.length); i++) {
          console.log(`  [${i}]:`, JSON.stringify(rows[i]).slice(0, 200));
        }
      }
    } else {
      console.log('  Result:', JSON.stringify(r.data).slice(0, 300));
    }
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 试试 BD_WORKCENTER (另一种表名)
  console.log('\n=== BD_WORKCENTER ===');
  try {
    const r = await client.callWithAuth(() =>
      client.executeBillQuery('ENG_WorkCenter', {
        fieldKeys: ['FWorkCenterId', 'FNumber', 'FName', 'FUseOrgId'],
        skipDateFilter: true, limit: 10,
      }),
    );
    console.log('  Result:', JSON.stringify(r.data).slice(0, 400));
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 查 SFC 已有记录的工作中心
  console.log('\n=== SFC 工作中心查询 ===');
  try {
    const r = await client.callWithAuth(() =>
      client.executeBillQuery('SFC_OperationReport', {
        fieldKeys: ['FBillNo', 'FWorkCenterId', 'FWorkCenterId.FNumber'],
        filter: "FBillNo='YJYGXHB26060848'", skipDateFilter: true, limit: 1,
      }),
    );
    console.log('  Result:', JSON.stringify(r.data).slice(0, 300));
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 试各种 WorkCenter 字段名
  console.log('\n=== 字段名测试 ===');
  const base = { FQuaQty: 10, FMaterialId: { FNumber: 'FP010587' } };

  // 直接在 FEntity 试不同名称
  const fieldNames = [
    'FWorkCenterId', 'FWorkCenterID', 'WorkCenterID',
    'FWorkCenter', 'WorkCenter', 'FWCId',
    'FCenterId', 'FCenterID',
  ];

  for (const name of fieldNames) {
    const m = { ...base };
    m[name] = { Id: 188050 };
    await test(`${name}(Id)`, m);
  }

  // 用 FNumber 格式
  const m = { ...base, WorkCenterId: { FNumber: '' } };  // empty first
  // Wait, I don't know the FNumber. Let me try common ones
  for (const num of ['WC001', 'BM000034', 'BM000047']) {
    const m2 = { ...base, WorkCenterId: { FNumber: num } };
    await test(`WorkCenterId(FN:${num})`, m2);
  }
}

main().catch(e => console.error('FATAL', e));
