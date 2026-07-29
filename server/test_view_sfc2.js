/**
 * View API - 专注看实体数据
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

async function main() {
  // 用包装记录 - 可能更短
  for (const billNo of ['YJYGXHB26060848', 'YJYGXHB26060859']) {
    console.log(`\n=== View ${billNo} ===`);
    try {
      const r = await client.callWithAuth(() =>
        client._request(
          'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
          {
            FormId: 'SFC_OperationReport',
            data: JSON.stringify({ Number: billNo }),
          },
        ),
      );
      const data = r.data;
      if (data?.Result?.ResponseStatus?.IsSuccess) {
        const record = data.Result.Result; // actual record data (nested under Result.Result)
        // 看有哪些 key
        const allKeys = Object.keys(record);
        console.log('  Record keys:', allKeys.join(', '));

        // 看实体相关 key
        const entityKeys = allKeys.filter(k =>
          k.includes('Entry') || k.includes('Entity') || k.includes('OptRpt') ||
          k === 'FEntity' || k === 'FEntity_Link'
        );
        console.log('  Entity keys:', entityKeys.join(', '));

        // 如果有 FEntity，看它
        if (record.FEntity) {
          console.log('  FEntity:', JSON.stringify(record.FEntity).slice(0, 1000));
        }
        // 如果有 OptRptEntry
        if (record.OptRptEntry) {
          const e = record.OptRptEntry;
          console.log(`  OptRptEntry (${Array.isArray(e) ? e.length : '?'}):`);
          if (Array.isArray(e) && e.length > 0) {
            console.log('    [0]:', JSON.stringify(e[0]).slice(0, 600));
          }
        }
        // 如果有 OptRpt
        if (record.OptRpt) {
          console.log('  OptRpt:', JSON.stringify(record.OptRpt).slice(0, 500));
        }
        // 打印所有 entity 类型字段
        for (const k of entityKeys) {
          if (!['FEntity', 'OptRptEntry', 'OptRpt'].includes(k)) {
            console.log(`  ${k}:`, JSON.stringify(record[k]).slice(0, 500));
          }
        }
      } else {
        const errs = data?.Result?.ResponseStatus?.Errors || [];
        errs.forEach(e => console.log('  ❌', e.Message));
        console.log('  Raw:', JSON.stringify(data).slice(0, 300));
      }
    } catch(e) {
      console.log('  Error:', e.message);
    }
  }
}

main().catch(e => console.error('FATAL', e));
