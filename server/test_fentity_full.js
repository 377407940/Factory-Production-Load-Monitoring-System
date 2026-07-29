/**
 * 一次性提交 FEntity 全部可能字段
 * 用 View API 中的完整数据结构
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  // 从 View API 获取包装记录的完整数据
  console.log('=== 获取包装记录完整结构 ===');
  const r = await client.callWithAuth(() =>
    client._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
      { FormId: 'SFC_OperationReport', data: JSON.stringify({ Number: 'YJYGXHB26060859' }) },
    ),
  );
  const record = r.data?.Result?.Result;
  if (!record) { console.log('  ❌ View failed'); return; }

  const optEntry = record.OptRptEntry?.[0];
  if (!optEntry) { console.log('  ❌ No OptRptEntry'); return; }

  // 从 OptRptEntry 提取关键字段
  const extractField = (obj, field) => {
    const v = obj[field];
    if (v === null || v === undefined) return undefined;
    if (typeof v === 'object' && v.Id) return { Id: v.Id };
    if (typeof v === 'object' && v.Number) return { FNumber: v.Number };
    return v;
  };

  // 构建 FEntity 数据
  const fentityRow = {
    // 从 OptRptEntry 复制核心字段
    FMaterialId: extractField(optEntry, 'MaterialId'),  // { Id: 1064252 }
    FUnitID: extractField(optEntry, 'UnitID'),          // { Id: 10101 }
    FQuaQty: optEntry.QuaQty || 10,
    // 工作中心
    WorkCenterId: extractField(optEntry, 'WorkCenterId'), // { Id: 188050 }
    // 工序号
    OperNumber: optEntry.OperNumber || 10,
    // 操作人员
    F_FD_Operator: extractField(optEntry, 'FD_Operator'), // { Id: 1101146 }
    FD_Operator: extractField(optEntry, 'FD_Operator'),
    // 当班实际车间
    F_YJY_NewRealShop: extractField(optEntry, 'F_YJY_newRealShop'),
    // 工时
    F_FD_WorkTimes: 1,
    F_FD_AssistTimes: 0,
    // 活动
    Activity1Id: extractField(optEntry, 'Activity1Id'),
    Activity1Qty: optEntry.Activity1Qty || 1,
    // 其他
    Seq: 1,
    MoNumber: 'YJYMO2605108',
    MoRowNumber: 1,
    // 跟单工序相关
    F_YJY_loadTimes: 10,
  };

  // 清理 undefined
  Object.keys(fentityRow).forEach(k => {
    if (fentityRow[k] === undefined) delete fentityRow[k];
  });

  console.log('  FEntity row:', JSON.stringify(fentityRow, null, 2).slice(0, 1000));

  // 提交！
  console.log('\n=== 提交 FEntity 完整数据 ===');
  const saveR = await client.save('SFC_OperationReport', {
    FDate: today,
    F_UNW_Date2: today,
    FBillTypeID: { FNumber: 'GXHB01_SYS' },
    F_UNW_MONum: 'YJYMO2605108',
    PrdOrgId: { FNumber: 'YJY' },
    FWorkShopId: { FNumber: 'BM000034' },
    F_FD_OperDescp: '装盒&装箱',  // 表头! 不含"灌装"
    FEntity: [fentityRow],
    OptRptEntry: [{
      FMaterialId: { FNumber: 'FP010587' },
      FQuaQty: 10,
    }],
  });
  const resp = saveR.data;
  if (resp?.Result?.ResponseStatus?.IsSuccess) {
    console.log(`  ✅ ${resp.Result.Number}`);
  } else {
    const errs = resp?.Result?.ResponseStatus?.Errors || [];
    errs.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 200)}`));
  }
}

main().catch(e => console.error('FATAL', e));
