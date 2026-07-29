/**
 * 发现：已有记录无 FEntity，F_FD_OperDescp 在表头
 * 试完整字段 + 表头 F_FD_OperDescp
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

async function trySave(label, model) {
  console.log(`\n--- ${label} ---`);
  console.log(`  Model keys: ${Object.keys(model).join(', ')}`);
  const r = await client.save('SFC_OperationReport', model);
  const resp = r.data;
  if (resp?.Result?.ResponseStatus?.IsSuccess) {
    console.log(`  ✅ ${resp.Result.Number}`);
    return true;
  } else {
    const errs = resp?.Result?.ResponseStatus?.Errors || [];
    errs.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 200)}`));
    return false;
  }
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  // 1. 看已有记录 OptRptEntry 的完整字段
  console.log('=== 已有记录 OptRptEntry 完整字段 ===');
  const r = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
      {
        FormId: 'SFC_OperationReport',
        data: JSON.stringify({ Number: 'YJYGXHB26060859' }),
      },
    ),
  );
  const entry = r.data?.Result?.Result?.OptRptEntry?.[0];
  if (entry) {
    const entryKeys = Object.keys(entry);
    console.log(`  OptRptEntry keys (${entryKeys.length}):`, entryKeys.join(', '));
  }
  // 看表头有什么字段
  const record = r.data?.Result?.Result;
  const headerKeys = Object.keys(record).filter(k => !['ResponseStatus', 'Result', 'OptRptEntry', 'BOS_ConvertTakeDataInfo'].includes(k) && !k.startsWith('ora_Cust_'));
  console.log(`  Header keys (${headerKeys.length}):`, headerKeys.join(', '));

  // 2. 保存：按 View API 看到的完整格式
  // 表头带 F_FD_OperDescp
  // 不加 FEntity，看系统能不能自动算
  await trySave('Full fields, no FEntity, header F_FD_OperDescp', {
    FDate: today,
    F_UNW_Date2: today,
    FBillTypeID: { FNumber: 'GXHB01_SYS' },
    F_UNW_MONum: 'YJYMO2605108',
    PrdOrgId: { FNumber: 'YJY' },
    FWorkShopId: { FNumber: 'BM000034' },
    F_FD_OperDescp: '装盒&装箱',  // 表头级别
    F_FD_AimProducts: 100,  // 试试表头
    F_FD_AimTimes: 1,      // 试试表头
    OptRptEntry: [{
      FMaterialId: { FNumber: 'FP010587' },
      FQuaQty: 10,
      F_FD_OperDescp: '装盒&装箱',  // 也在分录里
      F_FD_AimProducts: 100,
      F_FD_AimTimes: 1,
    }],
  });

  // 3. 不加 FEntity，OptRptEntry 带完整字段
  await trySave('Full OptRptEntry, no FEntity', {
    FDate: today,
    F_UNW_Date2: today,
    FBillTypeID: { FNumber: 'GXHB01_SYS' },
    F_UNW_MONum: 'YJYMO2605108',
    PrdOrgId: { FNumber: 'YJY' },
    FWorkShopId: { FNumber: 'BM000034' },
    F_FD_OperDescp: '装盒&装箱',
    OptRptEntry: [{
      FMaterialId: { FNumber: 'FP010587' },
      FQuaQty: 10,
      F_FD_OperDescp: '装盒&装箱',
      F_FD_AimProducts: 100,
      F_FD_AimTimes: 1,
      F_YJY_loadTimes: 10,
      F_UNW_WorkType2: '',
    }],
  });

  // 4. FEntity 加空行 + OptRptEntry 正常数据 + 表头 F_FD_OperDescp
  // 看规则会不会因为表头有值而不报错
  await trySave('FEntity [] + header F_FD_OperDescp', {
    FDate: today,
    F_UNW_Date2: today,
    FBillTypeID: { FNumber: 'GXHB01_SYS' },
    F_UNW_MONum: 'YJYMO2605108',
    PrdOrgId: { FNumber: 'YJY' },
    FWorkShopId: { FNumber: 'BM000034' },
    F_FD_OperDescp: '装盒&装箱',
    FEntity: [{}],
    OptRptEntry: [{
      FMaterialId: { FNumber: 'FP010587' },
      FQuaQty: 10,
      F_FD_OperDescp: '装盒&装箱',
    }],
  });

  // 5. 关键测试：看 F_FD_OperDescp 在表头能不能被 FEntity 规则读到
  // 用 FEntity: [{ F_FD_OperDescp: '' }] + 表头 F_FD_OperDescp
  await trySave('FEntity empty string OperDescp', {
    FDate: today,
    F_UNW_Date2: today,
    FBillTypeID: { FNumber: 'GXHB01_SYS' },
    F_UNW_MONum: 'YJYMO2605108',
    PrdOrgId: { FNumber: 'YJY' },
    FWorkShopId: { FNumber: 'BM000034' },
    F_FD_OperDescp: '包装测试',
    FEntity: [{ F_FD_OperDescp: '' }], // 空字符串而不是 None
    OptRptEntry: [{
      FMaterialId: { FNumber: 'FP010587' },
      FQuaQty: 10,
    }],
  });

  // 6. 完全复制已有记录 YJYGXHB26060859 的结构
  // 但改成新的 MO
  await trySave('Clone packaging style', {
    FDate: today,
    F_UNW_Date2: today,
    FBillTypeID: { FNumber: 'GXHB01_SYS' },
    F_UNW_MONum: 'YJYMO2605108',
    PrdOrgId: { FNumber: 'YJY' },
    FWorkShopId: { FNumber: 'BM000034' },
    F_FD_OperDescp: '装盒&装箱',
    // 不传 FEntity，也不传其他实体
    OptRptEntry: [{
      FMaterialId: { FNumber: 'FP010587' },
      FQuaQty: 10,
      F_FD_OperDescp: '装盒&装箱',
    }],
  });
}

main().catch(e => console.error('FATAL', e));
