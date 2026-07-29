/**
 * 查 MO (生产订单) 的工艺路线/工序计划
 * 确定有效工序号
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

async function main() {
  // 1. 查 MO 的完整 View
  console.log('=== MO = YJYMO2603133 View ===');
  try {
    const r = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
        { FormId: 'PRD_MO', data: JSON.stringify({ Number: 'YJYMO2603133' }) },
      ),
    );
    const record = r.data?.Result?.Result;
    if (record) {
      // 看MO分录
      const moEntry = record.MOEntry?.[0];
      if (moEntry) {
        console.log('  MOEntry keys:', Object.keys(moEntry).join(', '));
        // 物料
        console.log('  MaterialId:', JSON.stringify(moEntry.MaterialId?.Number));
        // 工艺路线
        console.log('  RouteId:', JSON.stringify(moEntry.RouteId));
        console.log('  RouteId_Id:', moEntry.RouteId_Id);
      }
      // 工艺路线组件
      const comps = record.MOComponent;
      if (comps) console.log('  MOComponent count:', comps.length);
      // 工艺路线明细
      const routing = record.OPRouting;
      if (routing) {
        console.log('  OPRouting count:', routing.length);
        for (let i = 0; i < routing.length; i++) {
          const r2 = routing[i];
          console.log(`  OPRouting[${i}]: OperNumber=${r2.OperNumber}, OperName=${r2.OperName}, WorkCenterId_Id=${r2.WorkCenterId_Id}, WorkCenterId=${JSON.stringify(r2.WorkCenterId?.Number)}`);
        }
      } else {
        console.log('  No OPRouting found');
        // 可能叫别的名
        const allKeys = Object.keys(record);
        console.log('  All entity keys:', allKeys.filter(k => !['ResponseStatus','Result'].includes(k)).join(', '));
      }
    }
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 2. 直接查 MO 的工序计划 (PRD_MO) 通过 ExecuteBillQuery
  console.log('\n=== 查 MO 工序 ===');
  try {
    const r = await client.callWithAuth(() =>
      client.executeBillQuery('PRD_MO', {
        fieldKeys: ['FBillNo', 'FMaterialId.FNumber'],
        filter: "FBillNo='YJYMO2603133'",
        skipDateFilter: true, limit: 1,
      }),
    );
    console.log('  MO material:', JSON.stringify(r.data).slice(0, 200));
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 3. 查工序计划 (PRD_ProcessPlan)
  console.log('\n=== 查工序计划 ===');
  try {
    const r = await client.callWithAuth(() =>
      client.executeBillQuery('PRD_ProcessPlan', {
        fieldKeys: ['FBillNo', 'FMaterialId.FNumber'],
        filter: "FBillNo='YJYMO2603133' OR FBillNo LIKE '%YJYMO2603133%'",
        skipDateFilter: true, limit: 3,
      }),
    );
    console.log('  ProcessPlan:', JSON.stringify(r.data).slice(0, 300));
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 4. 查子单据体 - 工序计划明细
  // 试试 OPRouting 的 BillQuery
  console.log('\n=== 查 PRD_MO 的 routing ===');
  try {
    const r = await client.callWithAuth(() =>
      client.executeBillQuery('PRD_MO', {
        fieldKeys: ['FBillNo', 'FPOOrderEntry_FSeq', 'FPOOrderEntry_FOperNumber', 'FPOOrderEntry_FOperName'],
        filter: "FBillNo='YJYMO2603133'",
        skipDateFilter: true, limit: 5,
      }),
    );
    console.log('  MO routing query:', JSON.stringify(r.data).slice(0, 500));
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 5. 试另一个单据体名 OPRouting 的查询
  console.log('\n=== 查 PRD_MO.OPRouting ===');
  try {
    const r = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
        { FormId: 'PRD_MO', data: JSON.stringify({ Number: 'YJYMO2603133', EntityKey: 'OPRouting' }) },
      ),
    );
    const routing = r.data?.Result?.Result;
    if (Array.isArray(routing)) {
      for (let i = 0; i < routing.length; i++) {
        console.log(`  [${i}]:`, JSON.stringify({
          OperNumber: routing[i].OperNumber,
          OperName: routing[i].OperName,
          WorkCenterId: routing[i].WorkCenterId?.Number || routing[i].WorkCenterId_Id,
        }).slice(0, 200));
      }
    } else {
      console.log('  Result:', JSON.stringify(routing).slice(0, 300));
    }
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 6. 查包装记录的 OptRptDetail
  console.log('\n=== 查 SFC 的 OptRptDetail ===');
  try {
    const r = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
        { FormId: 'SFC_OperationReport', data: JSON.stringify({ Number: 'YJYGXHB26060859', EntityKey: 'OptRptDetail' }) },
      ),
    );
    const detail = r.data?.Result?.Result;
    if (Array.isArray(detail)) {
      for (let i = 0; i < detail.length; i++) {
        console.log(`  [${i}]: OperNumber=${detail[i].OperNumber}, WorkCenterId=${detail[i].WorkCenterId?.Number || detail[i].WorkCenterId_Id}, MaterialId=${detail[i].MaterialId?.Number || detail[i].MaterialId_Id}`);
      }
    } else {
      console.log('  Result:', JSON.stringify(detail).slice(0, 300));
    }
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 7. 找 SFC_OperationReport 的 FEntity 在 View 中到底在哪
  console.log('\n=== 查 SFC View 所有实体 ===');
  try {
    const r = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
        { FormId: 'SFC_OperationReport', data: JSON.stringify({ Number: 'YJYGXHB26060859' }) },
      ),
    );
    const record = r.data?.Result?.Result;
    if (record) {
      const entityKeys = Object.keys(record).filter(k =>
        k !== 'ResponseStatus' && k !== 'Result' &&
        Array.isArray(record[k])
      );
      console.log('  Entity arrays in record:', entityKeys.join(', '));
      for (const k of entityKeys) {
        console.log(`  ${k}: ${record[k]?.length || 0} rows`);
      }
    }
  } catch(e) {
    console.log('  Error:', e.message);
  }
}

main().catch(e => console.error('FATAL', e));
