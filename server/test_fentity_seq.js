/**
 * 找 FEntity 上"工序序列"的字段名
 * 思路：
 * 1. 试 Seq / FSeq 等
 * 2. 查已有记录的 FEntity（如果有的话）
 * 3. 用 ExecuteBillQuery 查 FEntity 字段
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
    errs.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 250)}`));
    return false;
  }
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  const base = {
    FDate: today,
    F_UNW_Date2: today,
    FBillTypeID: { FNumber: 'GXHB01_SYS' },
    F_UNW_MONum: 'YJYMO2603133',
    PrdOrgId: { FNumber: 'YJY' },
    FWorkShopId: { FNumber: 'BM000034' },
    F_FD_OperDescp: '装盒&装箱',
    OptRptEntry: [{
      FMaterialId: { FNumber: 'FP010580' },
      FQuaQty: 10,
    }],
  };

  const feBase = {
    FQuaQty: 10,
    FMaterialId: { FNumber: 'FP010580' },
    FWorkCenterId: { FNumber: 'WC000003' },
    FUnitID: { FNumber: 'Pcs' },
  };

  // 先确认：仅 FOperNumber 单独会怎样
  await trySave('FOperNumber=10 only', { ...base, FEntity: [{ ...feBase, FOperNumber: 10 }] });

  // 试 Seq 字段
  await trySave('FOperNumber=10 + Seq=1', { ...base, FEntity: [{ ...feBase, FOperNumber: 10, Seq: 1 }] });

  // 试 FSeq 字段
  await trySave('FOperNumber=10 + FSeq=1', { ...base, FEntity: [{ ...feBase, FOperNumber: 10, FSeq: 1 }] });

  // 试 FOperNumber 字符串
  await trySave('FOperNumber="10" string', { ...base, FEntity: [{ ...feBase, FOperNumber: '10' }] });

  // 试 OperNumber (non-F) with FWorkCenterId
  await trySave('OperNumber=10 (no F) with FWC', { ...base, FEntity: [{ ...feBase, OperNumber: 10 }] });

  // 试 FOperNumber=1 (不同的值)
  await trySave('FOperNumber=1', { ...base, FEntity: [{ ...feBase, FOperNumber: 1 }] });

  // 试 FOperNumber=20
  await trySave('FOperNumber=20', { ...base, FEntity: [{ ...feBase, FOperNumber: 20 }] });

  // 重点：MO 的工序号可能是 0030
  await trySave('FOperNumber=30', { ...base, FEntity: [{ ...feBase, FOperNumber: 30 }] });

  // 也可以试试用 FEntity_Link 表
  console.log('\n=== 查 SFC 已有记录的 FEntity_Link ===');
  try {
    const r = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
        { FormId: 'SFC_OperationReport', data: JSON.stringify({ Number: 'YJYGXHB26060859', EntityKey: 'FEntity_Link' }) },
      ),
    );
    const link = r.data?.Result?.Result;
    if (Array.isArray(link)) {
      for (let i = 0; i < link.length; i++) {
        console.log(`  [${i}]:`, JSON.stringify(Object.fromEntries(
          Object.entries(link[i]).filter(([k]) => ['Id','Seq','MoNumber','MoRowNumber','FOperNumber','FOperName'].includes(k))
        )).slice(0, 300));
      }
    } else {
      console.log('  Result type:', typeof link, JSON.stringify(link).slice(0, 200));
    }
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 查 MO 的 TreeEntity (可能有工序信息)
  console.log('\n=== MO TreeEntity ===');
  try {
    const r = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
        { FormId: 'PRD_MO', data: JSON.stringify({ Number: 'YJYMO2603133', EntityKey: 'TreeEntity' }) },
      ),
    );
    const tree = r.data?.Result?.Result;
    if (Array.isArray(tree)) {
      for (let i = 0; i < Math.min(tree.length, 10); i++) {
        console.log(`  [${i}]:`, JSON.stringify({
          OperNumber: tree[i].OperNumber,
          OperName: tree[i].OperName,
          WorkCenterId: tree[i].WorkCenterId?.Number || tree[i].WorkCenterId_Id,
        }).slice(0, 200));
      }
    } else {
      console.log('  Result:', JSON.stringify(tree).slice(0, 300));
    }
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 查 MO 的 ScheduledEntity
  console.log('\n=== MO ScheduledEntity ===');
  try {
    const r = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
        { FormId: 'PRD_MO', data: JSON.stringify({ Number: 'YJYMO2603133', EntityKey: 'ScheduledEntity' }) },
      ),
    );
    const sched = r.data?.Result?.Result;
    if (Array.isArray(sched)) {
      for (let i = 0; i < Math.min(sched.length, 10); i++) {
        console.log(`  [${i}]:`, JSON.stringify({
          OperNumber: sched[i].OperNumber,
          OperName: sched[i].OperName,
        }).slice(0, 200));
      }
    } else {
      console.log('  Result:', JSON.stringify(sched).slice(0, 300));
    }
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 查 MO 上的工艺路线 RouteId
  console.log('\n=== 查 Route(工艺路线)列表 ===');
  try {
    const r = await client.callWithAuth(() =>
      client.executeBillQuery('SFC_OperationReport', {
        fieldKeys: ['FBillNo', 'FRouteId', 'FRouteId.FNumber'],
        filter: "FBillNo='YJYGXHB26060859'",
        skipDateFilter: true, limit: 1,
      }),
    );
    console.log('  Route query:', JSON.stringify(r.data).slice(0, 300));
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 再试试字段名 FProcessId 或 FOperId
  await trySave('FOperId=10', { ...base, FEntity: [{ ...feBase, FOperId: 10 }] });
  await trySave('FProcessId=10', { ...base, FEntity: [{ ...feBase, FProcessId: 10 }] });
}

main().catch(e => console.error('FATAL', e));
