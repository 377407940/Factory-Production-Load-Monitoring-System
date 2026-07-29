/**
 * 试各种保存策略绕过 FOperNumber 验证
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const model = {
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
      FWorkCenterId: { FNumber: 'WC000003' },
      FUnitID: { FNumber: 'Pcs' },
      MoRowNumber: 1,
      MoNumber: 'YJYMO2603133',
    }],
  };

  // 1. Draft API
  console.log('=== Draft API ===');
  try {
    const r = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Draft.common.kdsvc',
        {
          FormId: 'SFC_OperationReport',
          data: JSON.stringify({ Model: model, CreateOnly: true }),
        },
      ),
    );
    const errs = r.data?.Result?.ResponseStatus?.Errors || [];
    errs.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 300)}`));
    if (errs.length === 0) console.log(`  ✅ ${r.data?.Result?.Number}`);
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 2. SaveDraft
  console.log('\n=== SaveDraft ===');
  try {
    const r = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.SaveDraft.common.kdsvc',
        {
          FormId: 'SFC_OperationReport',
          data: JSON.stringify({ Model: model }),
        },
      ),
    );
    const errs = r.data?.Result?.ResponseStatus?.Errors || [];
    errs.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 300)}`));
    if (errs.length === 0) console.log(`  ✅ ${r.data?.Result?.Number}`);
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 3. 不传 FOperNumber，但传 FOperNumber_Link 或其他变体
  console.log('\n=== FOperId 作为数字 ===');
  try {
    const r = await client.save('SFC_OperationReport', {
      ...model,
      FEntity: [{
        ...model.FEntity[0],
        FProcessId: 40381,  // 数字
      }],
    });
    const errs = r.data?.Result?.ResponseStatus?.Errors || [];
    errs.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 300)}`));
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 4. 传 ProcessId 对象
  console.log('\n=== FProcessId 对象 ===');
  try {
    const r = await client.save('SFC_OperationReport', {
      ...model,
      FEntity: [{
        ...model.FEntity[0],
        FProcessId: { Id: 120719 },  // OptPlanOptId from packaging record
      }],
    });
    const errs = r.data?.Result?.ResponseStatus?.Errors || [];
    errs.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 300)}`));
    if (errs.length === 0) console.log(`  ✅ ${r.data?.Result?.Number}`);
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 5. 试试 FOperNumber 作为字符串
  console.log('\n=== FOperNumber 字符串 "10" ===');
  try {
    const r = await client.save('SFC_OperationReport', {
      ...model,
      FEntity: [{
        ...model.FEntity[0],
        FOperNumber: "10",
      }],
    });
    const errs = r.data?.Result?.ResponseStatus?.Errors || [];
    errs.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 300)}`));
    if (errs.length === 0) console.log(`  ✅ ${r.data?.Result?.Number}`);
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 6. 关键测试：从包装记录查看是否有 OptRptDetail
  // 也许 FEntity 不是"汇总"而是其他名字
  console.log('\n=== 查所有实体名 ===');
  try {
    const r = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
        { FormId: 'SFC_OperationReport', data: JSON.stringify({ Number: 'YJYGXHB26060859' }) },
      ),
    );
    const record = r.data?.Result?.Result;
    if (record) {
      for (const k of Object.keys(record)) {
        if (Array.isArray(record[k]) && !['MultiLanguageText', 'Description'].includes(k)) {
          const row0 = record[k][0];
          if (row0 && typeof row0 === 'object') {
            console.log(`  ${k}: ${record[k].length} rows, contains OperNumber? ${'OperNumber' in row0}, contains FOperNumber? ${'FOperNumber' in row0}`);
            // 打印前3个key
            console.log(`    first keys: ${Object.keys(row0).slice(0, 5).join(', ')}`);
          }
        }
      }
    }
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 7. 查 OptRptDetail
  console.log('\n=== 查 OptRptDetail 可查询性 ===');
  try {
    const r = await client.callWithAuth(() =>
      client.executeBillQuery('SFC_OperationReport', {
        fieldKeys: ['FBillNo', 'FOperNumber', 'FSeq'],
        filter: "FBillNo='YJYGXHB26060859'",
        skipDateFilter: true, limit: 1,
      }),
    );
    console.log('  FBillNo:', JSON.stringify(r.data).slice(0, 300));
  } catch(e) {
    console.log('  Error:', e.message);
  }
}

main().catch(e => console.error('FATAL', e));
