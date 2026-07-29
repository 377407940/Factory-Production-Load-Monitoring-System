/**
 * Probe: Verify equipment year vs month dimension fix
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

  const yearDetail = engine._extractEquipmentDetail(aggYear, '粉体B机台');
  const monthDetail = engine._extractEquipmentDetail(aggMonth, '粉体B机台');

  console.log('=== 粉体B机台 年维度 ===');
  console.log('actualOutput:', yearDetail.actualOutput);
  console.log('loadRate:', yearDetail.loadRate);
  console.log('outputRate:', yearDetail.outputRate);
  console.log('oee:', yearDetail.oee);

  console.log('\n=== 粉体B机台 月维度(最新月) ===');
  console.log('actualOutput:', monthDetail.actualOutput);
  console.log('loadRate:', monthDetail.loadRate);
  console.log('outputRate:', monthDetail.outputRate);
  console.log('oee:', monthDetail.oee);

  const ratio = monthDetail.actualOutput > 0 ? (yearDetail.actualOutput / monthDetail.actualOutput).toFixed(2) : 'N/A';
  console.log('\n年/月倍数:', ratio);
  console.log('年 > 月 ?', yearDetail.actualOutput > monthDetail.actualOutput ? 'YES - FIX WORKS' : 'NO - STILL BROKEN');

  // Also workshop breakdown
  if (yearDetail.workshopBreakdown && yearDetail.workshopBreakdown.length > 0) {
    console.log('\n=== 年维度 车间分布 ===');
    yearDetail.workshopBreakdown.forEach(w => {
      console.log(' ', w.workshop, '| totalOutput:', w.totalOutput, '| loadRate:', w.loadRate, '| outputRate:', w.outputRate);
    });
  }

  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
