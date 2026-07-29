/**
 * Probe v7: Check recent data with F_UNW_Date2
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const KC = require('./services/kingdeeService');
const client = KC.fromEnv();

(async () => {
  await client.loginByAppSecret();

  // Check dates: FDate + F_UNW_Date2 in recent records
  for (const label of ['2026年数据', '2025年数据']) {
    const year = label.startsWith('2026') ? '2026' : '2025';
    console.log(`\n=== ${label} ===`);
    const r = await client.executeBillQuery('SFC_OperationReport', {
      fieldKeys: ['FDate', 'F_UNW_Date2', 'F_YJY_NewRealShop', 'F_UNW_WorkType2', 'FQuaQty', 'F_YJY_loadTimes'],
      filter: `FDOCUMENTSTATUS = 'C' AND FDate >= '${year}-01-01' AND FDate < '${year}-06-01' AND F_FD_OperDescp IN ('固体灌装','液体灌装')`,
      limit: 5,
    });
    console.log('数据行:', r.data?.length || 0);
    if (r.data?.length > 0) {
      r.data.forEach((row, i) => {
        console.log(`  ${i}: FDate=${row[0]} | F_UNW_Date2=${row[1] || '(空)'} | 车间=${row[2] || ''} | 班次=${row[3] || ''} | 产量=${row[4] || ''} | 工时=${row[5] || ''}`);
      });
    }
  }

  // Check if the field exists by trying a field that definitely doesn't exist
  console.log('\n=== 对比: 查不存在的字段 ===');
  try {
    const rBad = await client.executeBillQuery('SFC_OperationReport', {
      fieldKeys: ['FDate', 'THIS_FIELD_DOES_NOT_EXIST_XYZ123'],
      filter: "FDOCUMENTSTATUS = 'C'",
      limit: 1,
      skipDateFilter: true,
    });
    console.log('不存在的字段查询: 行数', rBad.data?.length || 0);
    if (rBad.data?.length > 0) {
      console.log('  结果:', JSON.stringify(rBad.data[0]));
    } else {
      console.log('  空结果');
    }
  } catch (e) {
    console.log('不存在的字段查询: 报错:', e.message.slice(0, 200));
  }

  process.exit(0);
})().catch(err => {
  console.error('失败:', err.message);
  process.exit(1);
});
