/**
 * Probe v3: Verify fuzzy matching for garbled machine names
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const KC = require('./services/kingdeeService');
const AggEngine = require('./services/aggregationEngine');

const client = KC.fromEnv();

(async () => {
  await client.loginByAppSecret();
  const engine = new AggEngine(client);

  // 1. Check raw records
  const records = await engine._fetchRecords();

  const hRecords = records.filter(r => r.machine && r.machine.includes('双胞胎双列H'));
  console.log('匹配到', hRecords.length, '条记录 (双胞胎双列H)');

  let totalQty = 0;
  hRecords.forEach(r => {
    const qty = r.fields['FQuaQty'] || 0;
    totalQty += qty;
    console.log('  date=' + r.date + ' shift=' + r.shift + ' machine=' + r.machine + ' quaQty=' + qty + ' loadTimes=' + r.fields['F_YJY_loadTimes'] + ' workshop=' + r.workshop);
  });
  console.log('  FQuaQty合计(所有天):', totalQty);

  // 2. Check aggregated result
  const agg = await engine.fetchAndAggregate('day');
  const equipDetail = engine._extractEquipmentDetail(agg, '液体双胞胎双列H');
  if (equipDetail && equipDetail.periods) {
    console.log('\n聚合结果(液体双胞胎双列H):');
    equipDetail.periods.forEach(p => {
      console.log('  ' + p.periodKey + ': output=' + p.quaQty + ' rate=' + (p.outputRate * 100).toFixed(1) + '% loadRate=' + (p.loadRate * 100).toFixed(1) + '%');
    });
  }

  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
