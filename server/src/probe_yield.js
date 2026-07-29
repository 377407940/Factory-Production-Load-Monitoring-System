/**
 * Probe: Check Kingdee raw data vs aggregated data for 液体双胞胎双列H on May 27
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const KC = require('./services/kingdeeService');
const client = KC.fromEnv();

(async () => {
  await client.loginByAppSecret();

  // 1. Raw Kingdee data for 液体双胞胎双列H on May 27
  console.log('=== 液体双胞胎双列H 5-27 原始金蝶数据 ===');
  const r = await client.executeBillQuery('SFC_OperationReport', {
    fieldKeys: ['FDate', 'F_UNW_Date2', 'F_YJY_NewRealShop', 'F_FD_Machine', 'FQuaQty', 'F_YJY_loadTimes', 'F_FD_AimPerProduct', 'F_UNW_WorkType2', 'F_FD_OperDescp'],
    filter: "F_FD_Machine.FName = '液体双胞胎双列H' AND FDate >= '2026-05-27' AND FDate < '2026-05-28'",
    limit: 200,
    skipDateFilter: true,
  });

  console.log('行数:', r.data?.length || 0);
  let totalQty = 0;
  if (r.data?.length > 0) {
    for (let i = 0; i < r.data.length; i++) {
      const row = r.data[i];
      const qty = parseFloat(row[4]) || 0;
      totalQty += qty;
      console.log(i + ': FDate=' + row[0] + ' | F_UNW_Date2=' + (row[1] || '(空)') + ' | 车间=' + (row[2] || '') + ' | 设备=' + (row[3] || '') + ' | FQuaQty=' + qty + ' | 工时=' + (row[5] || '') + ' | 目标=' + (row[6] || '') + ' | 班次=' + (row[7] || '') + ' | 工序=' + (row[8] || ''));
    }
  }
  console.log('FQuaQty 合计(原始):', totalQty);

  // 2. Also query without FDate filter to catch late-shift records from May 26
  console.log('\n=== 液体双胞胎双列H 使用 F_UNW_Date2 查5-27（可能包含晚班跨日） ===');
  const r2 = await client.executeBillQuery('SFC_OperationReport', {
    fieldKeys: ['FDate', 'F_UNW_Date2', 'F_YJY_NewRealShop', 'F_FD_Machine', 'FQuaQty', 'F_YJY_loadTimes', 'F_FD_AimPerProduct', 'F_UNW_WorkType2', 'F_FD_OperDescp'],
    filter: "F_FD_Machine.FName = '液体双胞胎双列H' AND F_UNW_Date2 >= '2026-05-27' AND F_UNW_Date2 < '2026-05-28'",
    limit: 200,
    skipDateFilter: true,
  });

  console.log('行数:', r2.data?.length || 0);
  let totalQty2 = 0;
  if (r2.data?.length > 0) {
    for (let i = 0; i < r2.data.length; i++) {
      const row = r2.data[i];
      const qty = parseFloat(row[4]) || 0;
      totalQty2 += qty;
      console.log(i + ': FDate=' + row[0] + ' | F_UNW_Date2=' + (row[1] || '(空)') + ' | 车间=' + (row[2] || '') + ' | 设备=' + (row[3] || '') + ' | FQuaQty=' + qty + ' | 工时=' + (row[5] || '') + ' | 工序=' + (row[8] || ''));
    }
  }
  console.log('FQuaQty 合计(按实际班次日期):', totalQty2);

  process.exit(0);
})().catch(err => {
  console.error('失败:', err.message);
  process.exit(1);
});
