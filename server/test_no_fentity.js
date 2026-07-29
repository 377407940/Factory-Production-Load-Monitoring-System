/**
 * 彻底绕过 FEntity — 用其他参数
 * 或者查 MO 是否有工序计划
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
  };

  // 1. 直接调 Save 不加 FEntity，用底层 API
  console.log('=== 不带 FEntity 直接 Save ===');
  const r1 = await client.save('SFC_OperationReport', model);
  console.log('  Errors:', JSON.stringify(r1.data?.Result?.ResponseStatus?.Errors || []).slice(0, 300));

  // 2. 用 OperationResult 参数试试
  console.log('\n=== Save with OperationResult_Success ===');
  try {
    const r = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Save.common.kdsvc',
        {
          FormId: 'SFC_OperationReport',
          data: JSON.stringify({
            Model: model,
            OperationResult: 0,  // 0=Success, 1=Fail
          }),
        },
      ),
    );
    const errs = r.data?.Result?.ResponseStatus?.Errors || [];
    errs.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 200)}`));
    if (errs.length === 0) console.log('  ✅', JSON.stringify(r.data?.Result?.Number));
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 3. 查 PRD_MO 的工序计划 - 查子表
  console.log('\n=== 查 PRD_MO 子表 OPRouting ===');
  try {
    const r = await client.callWithAuth(() =>
      client.executeBillQuery('PRD_MO', {
        fieldKeys: ['FBillNo', 'FOperNumber', 'FOperName'],
        filter: "FBillNo='YJYMO2603133'",
        skipDateFilter: true, limit: 10,
      }),
    );
    console.log('  PRD_MO fields:', JSON.stringify(r.data).slice(0, 400));
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 4. 查 MO 的 TreeEntity（生产树）
  console.log('\n=== MO TreeEntity 完整查询 ===');
  try {
    const r = await client.callWithAuth(() =>
      client.executeBillQuery('PRD_MO', {
        fieldKeys: ['FBillNo', 'FTreeEntity_FOperNumber', 'FTreeEntity_FOperName'],
        filter: "FBillNo='YJYMO2603133'",
        skipDateFilter: true, limit: 10,
      }),
    );
    console.log('  TreeEntity:', JSON.stringify(r.data).slice(0, 400));
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 5. 查 PRD_MO 的 MOEntry 工序号
  console.log('\n=== MOEntry 工序号 ===');
  try {
    const r = await client.callWithAuth(() =>
      client.executeBillQuery('PRD_MO', {
        fieldKeys: ['FBillNo', 'FMoEntry_FOperNumber', 'FMoEntry_FOperName', 'FMoEntry_FSeq'],
        filter: "FBillNo='YJYMO2603133'",
        skipDateFilter: true, limit: 10,
      }),
    );
    console.log('  MOEntry:', JSON.stringify(r.data).slice(0, 400));
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 6. 查 PPBOM / 工艺路线
  console.log('\n=== 查 BD_ROUTE ===');
  try {
    const r = await client.callWithAuth(() =>
      client.executeBillQuery('BD_ROUTE', {
        fieldKeys: ['FBillNo', 'FRouteListing_FOperNumber', 'FRouteListing_FOperName'],
        filter: "FBillNo='RT000003'",
        skipDateFilter: true, limit: 10,
      }),
    );
    console.log('  RouteListing:', JSON.stringify(r.data).slice(0, 400));
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 7. 试一个完全不同的方法：在 FEntity 放 MoId 和 MoEntryId 来链接
  console.log('\n=== FEntity with MoId/MoEntryId ===');
  const r7 = await client.save('SFC_OperationReport', {
    ...model,
    FEntity: [{
      FSeqNumber: "0",
      FQuaQty: 10,
      FMaterialId: { FNumber: 'FP010580' },
      FWorkCenterId: { FNumber: 'WC000003' },
      FUnitID: { FNumber: 'Pcs' },
      MoRowNumber: 1,
      MoNumber: 'YJYMO2603133',
    }],
  });
  const errs7 = r7.data?.Result?.ResponseStatus?.Errors || [];
  errs7.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 300)}`));
}

main().catch(e => console.error('FATAL', e));
