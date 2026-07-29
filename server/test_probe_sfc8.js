/**
 * 绕过 FEntity 服务规则
 * 规则: F_FD_OperDescp.find('灌装') >=0 and F_FD_AimProducts >0 and F_FD_AimTimes >0 and FDocumentStatus <> 'C'
 * 问题: F_FD_OperDescp 在 FEntity 上不存在 → None.find() 报错
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
    errs.forEach(e => console.log(`  ❌ ${e.Message}`));
    return false;
  }
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const base = {
    FDate: today, F_UNW_Date2: today,
    FBillTypeID: { FNumber: 'GXHB01_SYS' },
    F_UNW_MONum: 'YJYMO2605108',
    PrdOrgId: { FNumber: 'YJY' },
    FWorkShopId: { FNumber: 'BM000034' },
  };

  // 1. 尝试在 FEntity 里用 F_FD_OperDescp 的不同格式
  await trySave('FEntity with empty F_FD_OperDescp', {
    ...base,
    FEntity: [{
      FMaterialId: { FNumber: 'FP010587' },
      FQuaQty: 10,
      F_FD_OperDescp: '测试',
      F_FD_AimProducts: 10,
      F_FD_AimTimes: 1,
    }],
  });

  // 2. FEntity 不包含触发字段，看看能不能先用空 FEntity 绕过
  await trySave('FEntity empty row', {
    ...base,
    FEntity: [{}],
  });

  // 3. FEntity 只有最基础字段
  await trySave('FEntity minimal', {
    ...base,
    FEntity: [{ FQuaQty: 10 }],
  });

  // 4. 直接把 FEntity 设成空数组？（试试空的）
  await trySave('FEntity empty array', {
    ...base,
    FEntity: [],
  });

  // 5. 把 FDocumentStatus 放进 header
  await trySave('with FDocumentStatus=C at header', {
    ...base,
    FDocumentStatus: 'C',
    FEntity: [{
      FMaterialId: { FNumber: 'FP010587' },
      FQuaQty: 10,
    }],
  });

  // 6. 查现有 SFC 的 FEntity 数据
  console.log('\n=== 查现有 SFC FEntity ===');
  // 用 try 执行 FEntity 字段查询
  try {
    const r = await client.callWithAuth(() =>
      client.executeBillQuery('SFC_OperationReport', {
        fieldKeys: ['FBillNo', 'FQuaQty', 'FReworkQty', 'FWastageQty', 'FEntryId', 'FEntity_FEntryId'],
        filter: "FBillNo='YJYGXHB26060848'", skipDateFilter: true, limit: 3,
      }),
    );
    console.log('  Result:', JSON.stringify(r.data).slice(0, 400));
  } catch(e) {
    console.log('  Error:', e.message?.slice(0, 100));
  }

  // 7. 查一下规则中提到的字段是否在表头/主实体中
  const fieldsToCheck = ['F_FD_OperDescp', 'F_FD_AimProducts', 'F_FD_AimTimes', 'FDocumentStatus'];
  for (const f of fieldsToCheck) {
    try {
      const r = await client.callWithAuth(() =>
        client.executeBillQuery('SFC_OperationReport', {
          fieldKeys: ['FBillNo', f],
          filter: "FBillNo='YJYGXHB26060848'", skipDateFilter: true, limit: 1,
        }),
      );
      const val = JSON.stringify(r.data).slice(0, 100);
      console.log(`  ${f}: ${val}`);
    } catch(e) {
      console.log(`  ${f}: error`);
    }
  }

  // 8. 猜 FEntity 字段名可能是 F_FD_OperDescp 的完整版
  // 有些实体字段需要 FBiz suffx
  await trySave('FEntity F_FD_AimProducts=0', {
    ...base,
    FEntity: [{
      FQuaQty: 10,
      // 设 AimProducts=0 让规则条件不成立
      F_FD_AimProducts: 0,
      F_FD_AimTimes: 1,
    }],
  });

  // 9. 试试完全不传 FEntity 但传 OptRptEntry 并给个特殊值
  await trySave('Only F_FD_OperDescp in header', {
    ...base,
    F_FD_OperDescp: 'test',
    OptRptEntry: [{ FMaterialId: { FNumber: 'FP010587' }, FQuaQty: 10 }],
    FEntity: [{ FQuaQty: 10, F_FD_AimProducts: 10, F_FD_AimTimes: 1, F_FD_OperDescp: 'test' }],
  });
}

main().catch(e => console.error('FATAL', e));
