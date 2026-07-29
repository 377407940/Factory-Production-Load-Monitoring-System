/**
 * 查 MO 的 TreeEntity，获取工序计划的详细 ID
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

async function main() {
  // 查 MO YJYMO2603133 的 TreeEntity
  console.log('=== MO YJYMO2603133 TreeEntity ===');
  try {
    const r = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
        {
          FormId: 'PRD_MO',
          data: JSON.stringify({ Number: 'YJYMO2603133', EntityKey: 'TreeEntity' }),
        },
      ),
    );
    const tree = r.data?.Result?.Result;
    console.log('  Type:', typeof tree, Array.isArray(tree) ? `Array[${tree.length}]` : 'obj');
    if (Array.isArray(tree)) {
      for (let i = 0; i < tree.length; i++) {
        const item = tree[i];
        // 打印关键字段
        const info = {
          Id: item.Id,
          Seq: item.Seq,
          OperNumber: item.OperNumber,
          OperName: item.OperName,
          WorkCenterId: item.WorkCenterId?.Number,
          WorkCenterId_Id: item.WorkCenterId_Id,
          MaterialId: item.MaterialId?.Number,
        };
        console.log(`  [${i}]:`, JSON.stringify(info));
        // 打印所有 key
        if (i === 0) console.log(`  All keys (${Object.keys(item).length}):`, Object.keys(item).join(', '));
      }
    } else if (tree) {
      console.log('  Object keys:', Object.keys(tree).slice(0, 20).join(', '));
      console.log('  TreeEntity:', JSON.stringify(tree.TreeEntity).slice(0, 500));
    }
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 也看 TreeEntity 的子工序（如果有）
  console.log('\n=== MO View 全部子实体 ===');
  try {
    const r = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
        { FormId: 'PRD_MO', data: JSON.stringify({ Number: 'YJYMO2603133' }) },
      ),
    );
    const record = r.data?.Result?.Result;
    if (record) {
      const entityKeys = Object.keys(record).filter(k => Array.isArray(record[k]));
      console.log('  Entity arrays:', entityKeys.join(', '));
      for (const ek of entityKeys) {
        const arr = record[ek];
        if (arr.length > 0 && typeof arr[0] === 'object') {
          console.log(`  ${ek}[0] keys (${Object.keys(arr[0]).length}): ${Object.keys(arr[0]).slice(0, 15).join(', ')}`);
        }
      }
    }
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 用获取到的 TreeEntity Id 试 Save
  // 先看 TreeEntity 第一行有没有 OperNumber=10
  // 然后用不同的方法设置 FEntity
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

  // 用 FOperNumber 配合 FOptPlanId
  console.log('\n=== Save with FOperNumber=10 + TreeEntity refs ===');
  const r2 = await client.save('SFC_OperationReport', {
    ...base,
    FEntity: [{
      FSeqNumber: "0",
      FOperNumber: 10,
      FQuaQty: 10,
      FMaterialId: { FNumber: 'FP010580' },
      FWorkCenterId: { FNumber: 'WC000004' },
      FUnitID: { FNumber: 'Pcs' },
      MoRowNumber: 1,
      MoNumber: 'YJYMO2603133',
      // 关键：加 MoId 和 MoEntryId
      MoId: 117479,
      MoEntryId: 117523,
    }],
  });
  const errs2 = r2.data?.Result?.ResponseStatus?.Errors || [];
  errs2.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 300)}`));
  if (r2.data?.Result?.ResponseStatus?.IsSuccess) console.log(`  ✅ ${r2.data?.Result?.Number}`);

  // 也试 OptPlanId/OptPlanSeqId/OptPlanOptId
  console.log('\n=== Save with process plan refs ===');
  const r3 = await client.save('SFC_OperationReport', {
    ...base,
    FEntity: [{
      FSeqNumber: "0",
      FOperNumber: 10,
      FQuaQty: 10,
      FMaterialId: { FNumber: 'FP010580' },
      FWorkCenterId: { FNumber: 'WC000004' },
      FUnitID: { FNumber: 'Pcs' },
      MoRowNumber: 1,
      MoNumber: 'YJYMO2603133',
      MoId: 117479,
      MoEntryId: 117523,
      // 用 OptPlanOptId 来指示具体工序
      FProcessId: { Id: 120719 },  // 工序（Activity1）
    }],
  });
  const errs3 = r3.data?.Result?.ResponseStatus?.Errors || [];
  errs3.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 300)}`));
  if (r3.data?.Result?.ResponseStatus?.IsSuccess) console.log(`  ✅ ${r3.data?.Result?.Number}`);
}

main().catch(e => console.error('FATAL', e));
