/**
 * 确认工作中心 FNumber ↔ Id 映射
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

async function main() {
  // 查包装记录的工作中心
  console.log('=== 查包装记录的工作中心 ===');
  const r = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
      { FormId: 'SFC_OperationReport', data: JSON.stringify({ Number: 'YJYGXHB26060859' }) },
    ),
  );
  const entry = r.data?.Result?.Result?.OptRptEntry?.[0];
  if (entry) {
    console.log('  WorkCenterId:', JSON.stringify(entry.WorkCenterId).slice(0, 200));
    console.log('  WorkCenterId_Id:', entry.WorkCenterId_Id);
    if (entry.WorkCenterId) {
      console.log('  WorkCenterId.Number:', entry.WorkCenterId.Number);
      console.log('  WorkCenterId.Id:', entry.WorkCenterId.Id);
    }
  }

  // 查所有工作中心
  console.log('\n=== 查所有工作中心 ===');
  const r2 = await client.callWithAuth(() =>
    client.executeBillQuery('ENG_WorkCenter', {
      fieldKeys: ['FWorkCenterId', 'FNumber', 'FName'],
      skipDateFilter: true, limit: 20,
    }),
  );
  const rows = r2.data;
  if (Array.isArray(rows)) {
    console.log('  Row count:', rows.length);
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const row = rows[i];
      if (Array.isArray(row)) {
        console.log(`  [${i}]: Id=${row[0]}, FNumber=${row[1]}, FName=${row[2] || ''}`);
      } else if (typeof row === 'object') {
        console.log(`  [${i}]:`, JSON.stringify(row).slice(0, 150));
      }
    }
  }

  // 从包装记录的 OptRptEntry 找到 OptPlan 的具体值
  // 用 WorkCenterId=188050 和 OperNumber=10
  console.log('\n=== 用正确工作中心测试 Save ===');
  const today = new Date().toISOString().slice(0, 10);
  const r3 = await client.save('SFC_OperationReport', {
    FDate: today, F_UNW_Date2: today,
    FBillTypeID: { FNumber: 'GXHB01_SYS' },
    F_UNW_MONum: 'YJYMO2603133',
    PrdOrgId: { FNumber: 'YJY' },
    FWorkShopId: { FNumber: 'BM000034' },
    F_FD_OperDescp: '装盒&装箱',
    OptRptEntry: [{ FMaterialId: { FNumber: 'FP010580' }, FQuaQty: 10 }],
    FEntity: [{
      FSeqNumber: "0",
      FOperNumber: 10,
      FQuaQty: 10,
      FMaterialId: { FNumber: 'FP010580' },
      FWorkCenterId: { Id: 188050 },  // 用包装记录的正确 Id
      FUnitID: { FNumber: 'Pcs' },
      MoRowNumber: 1,
      MoNumber: 'YJYMO2603133',
    }],
  });
  const errs = r3.data?.Result?.ResponseStatus?.Errors || [];
  errs.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 300)}`));
  if (r3.data?.Result?.ResponseStatus?.IsSuccess) console.log(`  ✅ ${r3.data?.Result?.Number}`);
}

main().catch(e => console.error('FATAL', e));
