/**
 * Probe v2: Debug machine name resolution for 液体双胞胎双列H on May 27
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const KC = require('./services/kingdeeService');
const client = KC.fromEnv();

const FIELD_KEYS = [
  'FDate',               // 0
  'F_YJY_NewRealShop',   // 1
  'F_FD_Machine',        // 2
  'FQuaQty',             // 3
  'FReworkQty',          // 4
  'FWastageQty',         // 5
  'F_YJY_loadTimes',     // 6
  'F_FD_EXCEPTTimes',    // 7
  'F_FD_IMPORTTIMES',    // 8
  'F_UNW_WorkType2',     // 9
  'F_FD_Speeds',         // 10
  'F_YJY_equipSpeed',    // 11
  'F_FD_OEE',            // 12
  'F_YJY_OEE',           // 13
  'F_FD_AimPerProduct',  // 14
  'F_FD_RealPerProduct', // 15
  'FMaterialId',         // 16
  'FMaterialName',       // 17
  'FSpecification',      // 18
  'FMoNumber',           // 19
  'F_FD_OkRates',        // 20
  'F_FD_OperDescp',      // 21
];
const DOT_FIELD = 'F_FD_Machine.FName';

(async () => {
  await client.loginByAppSecret();

  const extendedKeys = [...FIELD_KEYS, DOT_FIELD];

  const result = await client.executeBillQuery('SFC_OperationReport', {
    fieldKeys: extendedKeys,
    filter: "FDOCUMENTSTATUS = 'C' AND FDate >= '2026-05-27' AND FDate < '2026-05-28' AND F_FD_OperDescp IN ('固体灌装','液体灌装')",
    limit: 300,
    orderString: 'FDate ASC',
    skipDateFilter: true,
  });

  console.log('总行数:', result.data?.length || 0);

  const dotColIndex = FIELD_KEYS.length; // 22

  let dataStart = 0;
  if (result.data?.length > 0 && Array.isArray(result.data[0])) {
    const hasHeader = result.data[0].some(h => typeof h === 'string' && /^F[A-Z]/.test(h));
    if (hasHeader) dataStart = 1;
  }

  const rows = result.data?.slice(dataStart) || [];

  // Print ALL rows first
  console.log('\n全部8行数据:');
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rawMachine = row[2];
    const inlineMachine = row[dotColIndex];
    const quaQty = parseFloat(row[3]) || 0;
    const fDate = row[0] || '';
    const shift = row[9] || '';
    const workshop = row[1] || '';
    const operDescp = row[21] || '';
    const loadTimes = row[6] || '';

    console.log(`行${i}: FDate=${fDate} | 班次=${shift} | 工时=${loadTimes} | 设备(raw)=${rawMachine} | 设备(inline)=${inlineMachine || '(空)'} | 产量=${quaQty} | 工序=${operDescp} | 车间=${workshop}`);
  }

  // Filter for 液体双胞胎双列H
  let foundCount = 0;
  let totalQtyByDate = {};

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rawMachine = row[2]; // F_FD_Machine
    const inlineMachine = row[dotColIndex]; // F_FD_Machine.FName
    const quaQty = parseFloat(row[3]) || 0;
    const fDate = row[0] || '';
    const shift = row[9] || '';

    if (inlineMachine === '液体双胞胎双列H' || (inlineMachine && inlineMachine.includes('双胞胎双列H'))) {
      foundCount++;
      const dateKey = fDate.slice(0, 10);
      if (!totalQtyByDate[dateKey]) totalQtyByDate[dateKey] = 0;
      totalQtyByDate[dateKey] += quaQty;
    }
  }

  console.log('\n匹配到', foundCount, '条 inline 名称为 液体双胞胎双列H');
  console.log('按日期汇总:');
  for (const [d, q] of Object.entries(totalQtyByDate)) {
    console.log('  ' + d + ': ' + q);
  }

  process.exit(0);
})().catch(err => {
  console.error('失败:', err.message);
  process.exit(1);
});
