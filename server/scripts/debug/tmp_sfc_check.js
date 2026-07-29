var Database = require('better-sqlite3');
var db = new Database('data/sfc_records.db');

var cnt = db.prepare("SELECT COUNT(*) as c FROM records").get();
console.log("Total records:", cnt.c);

var june2 = db.prepare("SELECT COUNT(*) as c FROM records WHERE fdate = '2026-06-02'").get();
console.log("June 2 records:", june2.c);

var june2ws = db.prepare("SELECT workshop, COUNT(*) as cnt FROM records WHERE fdate = '2026-06-02' GROUP BY workshop").all();
console.log("June 2 by workshop:");
june2ws.forEach(function(r) { console.log("  " + r.workshop + " cnt=" + r.cnt); });

var liq = db.prepare("SELECT fdate, COUNT(*) as cnt FROM records WHERE workshop = 'Y液体二车间' AND fdate >= '2026-05-25' GROUP BY fdate ORDER BY fdate").all();
console.log("\nY液体二车间 recent dates:");
liq.forEach(function(r) { console.log("  " + r.fdate + " cnt=" + r.cnt); });

// Check total production for 液体二车间 by date
console.log("\nY液体二车间 production totals:");
var liqYield = db.prepare("SELECT fdate, SUM(json_extract(fields_json, '$.FQuaQty')) as total FROM records WHERE workshop = 'Y液体二车间' AND fdate >= '2026-05-25' GROUP BY fdate ORDER BY fdate").all();
liqYield.forEach(function(r) { console.log("  " + r.fdate + " total=" + (r.total||0)); });

db.close();
