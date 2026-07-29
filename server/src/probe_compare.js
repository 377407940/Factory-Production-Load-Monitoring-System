/**
 * Probe: Compare year vs month totals
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const KC = require('./services/kingdeeService');
const AggEngine = require('./services/aggregationEngine');

const client = KC.fromEnv();

(async () => {
  await client.loginByAppSecret();
  const engine = new AggEngine(client);

  const aggYear = await engine.fetchAndAggregate('year');
  const aggMonth = await engine.fetchAndAggregate('month');

  console.log('=== 年维度 ===');
  console.log('总产量:', Math.round(aggYear.summary.totalOutput));
  console.log('车间时段数:', aggYear.workshopPeriods.size);

  console.log('\n=== 月维度 ===');
  const periods = [...aggMonth.workshopPeriods.values()];
  const latestKey = periods.reduce((a, b) => a.periodKey > b.periodKey ? a : b).periodKey;
  let monthTotal = 0;
  for (const p of periods) {
    if (p.periodKey === latestKey) {
      monthTotal += (p.totalQuaQty || p.quaQty || 0);
    }
  }
  console.log('最新月(' + latestKey + ')总产量:', Math.round(monthTotal));
  console.log('\n年/月倍数:', (aggYear.summary.totalOutput / monthTotal).toFixed(2));

  const ovY = engine._extractOverview(aggYear);
  const ovM = engine._extractOverview(aggMonth);
  console.log('\nOverview年totalOutput:', ovY.totalOutput);
  console.log('Overview月totalOutput:', ovM.totalOutput);

  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
