/**
 * 查工艺路线 RT000003 的工序
 * 以及找 FEntity "工序序列" 的正确字段名
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

async function main() {
  // 1. 查工艺路线 RT000003
  console.log('=== 查工艺路线 RT000003 ===');
  try {
    const r = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
        { FormId: 'BD_ROUTE', data: JSON.stringify({ Number: 'RT000003' }) },
      ),
    );
    const record = r.data?.Result?.Result;
    if (record) {
      const entityKeys = Object.keys(record).filter(k => Array.isArray(record[k]));
      console.log('  Entity keys:', entityKeys.join(', '));
      // 找工艺路线上的工序
      for (const ek of entityKeys) {
        const arr = record[ek];
        if (arr.length > 0) {
          console.log(`  ${ek}[0] keys:`, Object.keys(arr[0]).join(', '));
          for (let i = 0; i < Math.min(arr.length, 20); i++) {
            const op = arr[i];
            console.log(`  [${i}] OperNumber=${op.OperNumber} OperName=${op.OperName} WorkCenter=${op.WorkCenterId?.Number || ''}`);
          }
        }
      }
    }
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 2. 查 BD_ROUTE 的 RouteListing 或 RouteStep
  console.log('\n=== 查 BD_ROUTE 的 RouteListing ===');
  try {
    const r = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
        { FormId: 'BD_ROUTE', data: JSON.stringify({ Number: 'RT000003', EntityKey: 'RouteListing' }) },
      ),
    );
    const listing = r.data?.Result?.Result;
    if (Array.isArray(listing)) {
      for (let i = 0; i < Math.min(listing.length, 20); i++) {
        console.log(`  [${i}]`, JSON.stringify({
          OperNumber: listing[i].OperNumber,
          OperName: listing[i].OperName,
        }).slice(0, 200));
      }
    } else {
      console.log('  Result:', JSON.stringify(listing).slice(0, 300));
    }
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 3. 直接查 BD_ROUTE 所有子实体
  console.log('\n=== BD_ROUTE View 找工序 ===');
  try {
    const r = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
        { FormId: 'BD_ROUTE', data: JSON.stringify({ Number: 'RT000003' }) },
      ),
    );
    const record = r.data?.Result?.Result;
    if (record) {
      for (const k of Object.keys(record)) {
        if (Array.isArray(record[k]) && record[k].length > 0) {
          const first = record[k][0];
          if (first.OperNumber !== undefined || first.FOperNumber !== undefined) {
            console.log(`  Entity ${k}:`);
            for (let i = 0; i < Math.min(record[k].length, 20); i++) {
              const op = record[k][i];
              console.log(`    [${i}] OperNumber=${op.OperNumber} OperName=${op.OperName} WorkCenterId=${JSON.stringify(op.WorkCenterId)}`);
            }
          }
        }
      }
    }
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 4. 查 MO 的工艺路线（看看MO上的工序号）
  console.log('\n=== 查 MO 上工艺路线 ===');
  try {
    const r = await client.callWithAuth(() =>
      client.executeBillQuery('PRD_MO', {
        fieldKeys: ['FBillNo', 'FRouteId.FNumber'],
        filter: "FBillNo='YJYMO2603133'",
        skipDateFilter: true, limit: 1,
      }),
    );
    console.log('  MO RouteId:', JSON.stringify(r.data).slice(0, 200));
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 5. 查 MO 的下游工序计划
  console.log('\n=== 查 MO 的 OptPlan ===');
  try {
    const r = await client.callWithAuth(() =>
      client.executeBillQuery('PRD_OptPlan', {
        fieldKeys: ['FBillNo', 'FMoBillNo', 'FOperNumber', 'FOperName'],
        filter: "FMoBillNo='YJYMO2603133'",
        skipDateFilter: true, limit: 10,
      }),
    );
    console.log('  OptPlan:', JSON.stringify(r.data).slice(0, 500));
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 6. 另一种思路：直接看 FEntity 汇总表字段
  // FOperNumber 验证不通过，说明需要工序计划存在
  // 但 FProcessId 可以填，它是引用字段
  console.log('\n=== 试 FProcessId + FOperNumber ===');
  const today = new Date().toISOString().slice(0, 10);
  const base = {
    FDate: today, F_UNW_Date2: today,
    FBillTypeID: { FNumber: 'GXHB01_SYS' },
    F_UNW_MONum: 'YJYMO2603133',
    PrdOrgId: { FNumber: 'YJY' },
    FWorkShopId: { FNumber: 'BM000034' },
    F_FD_OperDescp: '装盒&装箱',
    OptRptEntry: [{ FMaterialId: { FNumber: 'FP010580' }, FQuaQty: 10 }],
  };

  // 试试 FProcessId 当对象 + FOperNumber
  const r = await client.save('SFC_OperationReport', {
    ...base,
    FEntity: [{
      FQuaQty: 10,
      FMaterialId: { FNumber: 'FP010580' },
      FWorkCenterId: { FNumber: 'WC000003' },
      FProcessId: { Id: 40381 },  // Activity1Id value
      FOperNumber: 10,
      Seq: 1,
      MoNumber: 'YJYMO2603133',
      MoRowNumber: 1,
      FUnitID: { FNumber: 'Pcs' },
    }],
  });
  const resp = r.data;
  if (resp?.Result?.ResponseStatus?.IsSuccess) {
    console.log(`  ✅ ${resp.Result.Number}`);
  } else {
    const errs = resp?.Result?.ResponseStatus?.Errors || [];
    errs.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 250)}`));
  }
}

main().catch(e => console.error('FATAL', e));
