/**
 * Probe: Check year-dimension data in aggregation
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const KC = require('./services/kingdeeService');
const AggEngine = require('./services/aggregationEngine');

const client = KC.fromEnv();

(async () => {
  await client.loginByAppSecret();
  const engine = new AggEngine(client);

  // 1. Check raw record count
  const records = await engine._fetchRecords();

  // Need to resolve workshop names and normalize like fetchAndAggregate does
  await engine._resolveWorkshopNames(records);
  engine._normalizeRecords(records);

  console.log('总记录数:', records.length);

  // Check date range
  const dates = [...new Set(records.map(r => r.date))].sort();
  console.log('日期范围:', dates[0], '~', dates[dates.length - 1]);
  console.log('总天数:', dates.length);

  // Count by year
  const yearCounts = {};
  for (const r of records) {
    const y = r.date.slice(0, 4);
    yearCounts[y] = (yearCounts[y] || 0) + 1;
  }
  console.log('按年分布:', JSON.stringify(yearCounts));

  // 2. Check daily metrics first
  const dailyWsMap = engine._computeDailyWorkshopMetrics(records);
  console.log('\n每日车间指标数量:', dailyWsMap.size);
  // Show a few samples
  let count = 0;
  for (const [key, val] of dailyWsMap) {
    if (count < 5) console.log(`  ${key}: quaQty=${val.quaQty} aimProd=${val.aimProd} dailyActualHours=${val.dailyActualHours} workshop=${val.workshop} date=${val.date}`);
    count++;
  }

  const dailyEqMap = engine._computeDailyEquipmentMetrics(records);
  console.log('\n每日设备指标数量:', dailyEqMap.size);
  count = 0;
  for (const [key, val] of dailyEqMap) {
    if (count < 5) console.log(`  ${key}: quaQty=${val.quaQty} machine=${val.machine} workshop=${val.workshop} date=${val.date}`);
    count++;
  }

  // 3. Aggregate by year
  const aggregated = engine._aggregate(records, 'year');
  console.log('\n年维度聚合:');
  console.log('  workshopPeriods 数量:', aggregated.workshopPeriods.size);
  console.log('  equipmentPeriods 数量:', aggregated.equipmentPeriods.size);

  // Print workshop periods
  let totalYearOutput = 0;
  for (const [key, period] of aggregated.workshopPeriods) {
    const output = period.totalQuaQty || period.quaQty || 0;
    totalYearOutput += output;
    console.log(`  车间[${period.workshop}] periodKey=${period.periodKey} 产量=${output} 负荷率=${(period.loadRate || 0) * 100}% 产出率=${(period.outputRate || 0) * 100}% 工作天数=${period.workingDays}`);
  }
  console.log('  年总产量(所有车间):', totalYearOutput);

  // 3. Test extractWorkshopDetail for one workshop
  const detail = engine._extractWorkshopDetail(aggregated, 'Y固体一1号车间');
  console.log('\n_extractWorkshopDetail (Y固体一1号车间):');
  console.log('  totalOutput:', detail.totalOutput);
  console.log('  theoreticalOutput:', detail.theoreticalOutput);
  console.log('  outputRate:', detail.outputRate);
  console.log('  loadRate:', detail.loadRate);
  console.log('  设备列表:', detail.equipmentList.length, '台');
  for (const eq of detail.equipmentList) {
    console.log('    ', eq.name, 'output:', eq.output, 'outputRate:', eq.outputRate);
  }

  // 4. Test extractOverview
  const overview = engine._extractOverview(aggregated);
  console.log('\n_extractOverview:');
  console.log('  totalOutput:', overview.totalOutput);
  console.log('  avgLoadRate:', overview.avgLoadRate);
  console.log('  avgOutputRate:', overview.avgOutputRate);
  console.log('  车间数:', overview.workshops.length);
  for (const ws of overview.workshops) {
    console.log('    ', ws.name, 'totalOutput:', ws.totalOutput, 'outputRate:', ws.outputRate, 'loadRate:', ws.loadRate);
  }

  process.exit(0);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
