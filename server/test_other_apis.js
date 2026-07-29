/**
 * 查金蝶其他可用 API + 查 MO 关联的工艺路线
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

async function main() {
  // 1. 查 MO 的工艺路线关联
  console.log('=== MO YJYMO2603133 的 RouteId ===');
  try {
    const r = await client.callWithAuth(() =>
      client.executeBillQuery('PRD_MO', {
        fieldKeys: ['FBillNo', 'FRouteId', 'FRouteId.FNumber'],
        filter: "FBillNo='YJYMO2603133'",
        skipDateFilter: true, limit: 1,
      }),
    );
    console.log('  Result:', JSON.stringify(r.data).slice(0, 400));
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 2. 用 View API 看 MOEntry
  console.log('\n=== MO View ===');
  try {
    const r = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
        { FormId: 'PRD_MO', data: JSON.stringify({ Number: 'YJYMO2603133' }) },
      ),
    );
    const record = r.data?.Result?.Result;
    if (record) {
      console.log('  MOEntry:', record.MOEntry ? `${record.MOEntry.length} rows` : 'none');
      if (record.MOEntry?.[0]) {
        console.log('  RouteId:', record.MOEntry[0].RouteId?.Number);
        console.log('  RouteId_Id:', record.MOEntry[0].RouteId_Id);
      }
      if (record.TreeEntity) console.log('  TreeEntity:', record.TreeEntity.length, 'rows');
      if (record.ScheduledEntity) console.log('  ScheduledEntity:', record.ScheduledEntity.length, 'rows');
    }
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 3. 试试用 routeId 查 Route 的工序
  // RouteId RT000003 → 查 Route 的 View
  console.log('\n=== 查 Route RT000003 ===');
  try {
    const r = await client.callWithAuth(() =>
      client.executeBillQuery('ENG_Route', {
        fieldKeys: ['FBillNo', 'FNumber', 'FRouteListing_FOperNumber', 'FRouteListing_FOperName'],
        filter: "FNumber='RT000003'",
        skipDateFilter: true, limit: 5,
      }),
    );
    console.log('  Route:', JSON.stringify(r.data).slice(0, 400));
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 4. 找有工序计划的 MO
  console.log('\n=== 查有完整工序的 SFC 记录 ===');
  try {
    const r = await client.callWithAuth(() =>
      client.executeBillQuery('SFC_OperationReport', {
        fieldKeys: ['FBillNo', 'FMoNumber', 'FMaterialId.FNumber', 'FWorkCenterId.FNumber'],
        filter: "FDocumentStatus='C'",
        skipDateFilter: true, limit: 10,
      }),
    );
    console.log('  Recent completed SFC:', JSON.stringify(r.data).slice(0, 600));
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 5. 直接看 FOperNumber 的完整错误信息
  // 查 MO + 工艺路线是否有定义的工序号
  console.log('\n=== 看 YJYGXHB26060859 的 OptPlan ===');
  try {
    const r = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
        { FormId: 'SFC_OperationReport', data: JSON.stringify({ Number: 'YJYGXHB26060859' }) },
      ),
    );
    const entry = r.data?.Result?.Result?.OptRptEntry?.[0];
    if (entry) {
      console.log('  OptPlanId:', entry.OptPlanId);
      console.log('  OptPlanSeqId:', entry.OptPlanSeqId);
      console.log('  OptPlanOptId:', entry.OptPlanOptId);
      console.log('  MoId:', entry.MoId);
      console.log('  MoEntryId:', entry.MoEntryId);
      // 检查 FEntity
      console.log('  FEntity:', JSON.stringify(r.data?.Result?.Result?.FEntity).slice(0, 200));
    }
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 6. 最终方案：试试能不能直接查 PRD_OptPlan 的其他名字
  console.log('\n=== 查 PRD_MO 的所有子实体 ===');
  try {
    const r = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
        { FormId: 'PRD_MO', data: JSON.stringify({ Number: 'YJYMO2603133' }) },
      ),
    );
    const record = r.data?.Result?.Result;
    if (record) {
      const entities = Object.keys(record).filter(k => Array.isArray(record[k]));
      console.log('  Sub-entities:', entities.slice(0, 20).join(', '));
    } else {
      console.log('  View failed:', JSON.stringify(r.data).slice(0, 200));
    }
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 7. 用 F_YJY_loadTimes 字段测试 FEntity 是否有这个字段
  console.log('\n=== 用 F_YJY_loadTimes 测试 FEntity 字段 ===');
  const today = new Date().toISOString().slice(0, 10);
  try {
    const r = await client.save('SFC_OperationReport', {
      FDate: today, F_UNW_Date2: today,
      FBillTypeID: { FNumber: 'GXHB01_SYS' },
      F_UNW_MONum: 'YJYMO2603133',
      PrdOrgId: { FNumber: 'YJY' },
      FWorkShopId: { FNumber: 'BM000034' },
      F_FD_OperDescp: '装盒&装箱',
      OptRptEntry: [{ FMaterialId: { FNumber: 'FP010580' }, FQuaQty: 10 }],
      FEntity: [{
        FSeqNumber: "0",
        FQuaQty: 10,
        FMaterialId: { FNumber: 'FP010580' },
        FWorkCenterId: { FNumber: 'WC000004' },
        FUnitID: { FNumber: 'Pcs' },
        MoRowNumber: 1,
        MoNumber: 'YJYMO2603133',
        F_YJY_loadTimes: 10,  // 额外字段
      }],
    });
    const errs = r.data?.Result?.ResponseStatus?.Errors || [];
    errs.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 300)}`));
    if (r.data?.Result?.ResponseStatus?.IsSuccess) console.log(`  ✅ ${r.data?.Result?.Number}`);
  } catch(e) {
    console.log('  Error:', e.message);
  }
}

main().catch(e => console.error('FATAL', e));
