/**
 * 用 MoId/MoEntryId 代替 MoNumber/MoRowNumber
 * FOperNumber 验证失败可能是因为 MO 关联不够
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

async function main() {
  // 1. 查 MO 的内部 Id
  console.log('=== 查 MO YJYMO2603133 的 Id ===');
  let moId = null;
  try {
    const r = await client.callWithAuth(() =>
      client.executeBillQuery('PRD_MO', {
        fieldKeys: ['FBillNo', 'FId'],
        filter: "FBillNo='YJYMO2603133'",
        skipDateFilter: true, limit: 1,
      }),
    );
    const rows = r.data;
    if (Array.isArray(rows) && rows.length > 0) {
      console.log('  MO query result:', JSON.stringify(rows).slice(0, 200));
      const row = rows[0];
      if (Array.isArray(row)) {
        moId = row[1]; // [BillNo, Id]
      }
    }
    console.log(`  MoId: ${moId}`);
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 2. 查 MO 的 MOEntry(MoEntryId)
  console.log('\n=== 查 MO 分录 Id ===');
  let moEntryId = null;
  try {
    const r = await client.callWithAuth(() =>
      client.executeBillQuery('PRD_MO', {
        fieldKeys: ['FBillNo', 'FMoEntry_FEntryId', 'FMoEntry_FMaterialId.FNumber'],
        filter: "FBillNo='YJYMO2603133'",
        skipDateFilter: true, limit: 5,
      }),
    );
    console.log('  MOEntry query:', JSON.stringify(r.data).slice(0, 400));
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 3. 查 MO 的复杂查询 - 查子实体
  console.log('\n=== 查 MO 分录视图 ===');
  try {
    const r = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
        { FormId: 'PRD_MO', data: JSON.stringify({ Number: 'YJYMO2603133' }) },
      ),
    );
    const record = r.data?.Result?.Result;
    if (record) {
      // 找 MOEntry
      const moEntry = record.MOEntry;
      if (Array.isArray(moEntry) && moEntry.length > 0) {
        console.log(`  MOEntry[0].Id: ${moEntry[0].Id}`);
        console.log(`  MOEntry[0].MaterialId:`, JSON.stringify(moEntry[0].MaterialId?.Number));
        moEntryId = moEntry[0].Id;
      }
    }
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 4. 用 MoId + MoEntryId 试 Save
  if (moId || moEntryId) {
    console.log('\n=== Save with MoId/MoEntryId ===');
    const today = new Date().toISOString().slice(0, 10);
    const fe = {
      FSeqNumber: "0",
      FQuaQty: 10,
      FMaterialId: { FNumber: 'FP010580' },
      FWorkCenterId: { FNumber: 'WC000003' },
      FUnitID: { FNumber: 'Pcs' },
      MoRowNumber: 1,
    };
    if (moId) fe.MoId = moId;
    if (moEntryId) fe.MoEntryId = moEntryId;

    const r = await client.save('SFC_OperationReport', {
      FDate: today, F_UNW_Date2: today,
      FBillTypeID: { FNumber: 'GXHB01_SYS' },
      F_UNW_MONum: 'YJYMO2603133',
      PrdOrgId: { FNumber: 'YJY' },
      FWorkShopId: { FNumber: 'BM000034' },
      F_FD_OperDescp: '装盒&装箱',
      OptRptEntry: [{ FMaterialId: { FNumber: 'FP010580' }, FQuaQty: 10 }],
      FEntity: [fe],
    });
    const resp = r.data;
    if (resp?.Result?.ResponseStatus?.IsSuccess) {
      console.log(`  ✅ ${resp.Result.Number}`);
    } else {
      const errs = resp?.Result?.ResponseStatus?.Errors || [];
      errs.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 300)}`));
    }
  }

  // 5. 也许根本问题：我们用的 MO YJYMO2603133 可能没有完整的工序计划
  // 需要找一个有完整工序计划的 MO 来测试
  console.log('\n=== 查有工序计划的 MO ===');
  try {
    const r = await client.callWithAuth(() =>
      client.executeBillQuery('SFC_OperationReport', {
        fieldKeys: ['FBillNo', 'FMoNumber'],
        filter: "FDocumentStatus='C'",
        skipDateFilter: true, limit: 5,
      }),
    );
    console.log('  Recent SFC records:', JSON.stringify(r.data).slice(0, 400));
  } catch(e) {
    console.log('  Error:', e.message);
  }
}

main().catch(e => console.error('FATAL', e));
