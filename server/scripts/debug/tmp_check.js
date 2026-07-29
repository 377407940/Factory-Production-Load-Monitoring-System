const path = require('path');
const Database = require('better-sqlite3');
const db = new Database(path.resolve(__dirname, 'data/production.db'));

console.log('=== 6月2日产量数据 ===');
const rows = db.prepare("SELECT * FROM aggregated_records WHERE date = '2026-06-02' LIMIT 50").all();
console.log('记录数:', rows.length);
rows.forEach(r => console.log(JSON.stringify(r)));

console.log('');
console.log('=== 所有不同workshop ===');
const wss = db.prepare("SELECT DISTINCT workshop FROM aggregated_records").all();
console.log(wss.map(w => w.workshop).join(', '));

console.log('');
console.log('=== 6月2日按车间汇总 ===');
const grp = db.prepare("SELECT workshop, SUM(f_yield) as total_yield, SUM(power_consumption) as total_power FROM aggregated_records WHERE date = '2026-06-02' GROUP BY workshop").all();
grp.forEach(function(r) {
  console.log(r.workshop + '  yield=' + (r.total_yield||0).toFixed(1) + '  power=' + (r.total_power||0).toFixed(1));
});

db.close();
