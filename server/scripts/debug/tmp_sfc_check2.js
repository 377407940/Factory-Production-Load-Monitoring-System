var Database = require('better-sqlite3');
var db = new Database('data/sfc_records.db');

// June 2 full detail
console.log("=== June 2 ALL records ===");
var june2 = db.prepare("SELECT * FROM records WHERE fdate = '2026-06-02'").all();
june2.forEach(function(r) {
  console.log("  workshop=" + r.workshop + " machine=" + r.machine);
  console.log("  fields_json:", r.fields_json);
  console.log("");
});

// Check all workshop totals for June 2
console.log("=== June 2 workshop FQuaQty totals ===");
var totals = db.prepare(
  "SELECT workshop, SUM(CAST(json_extract(fields_json, '$.FQuaQty') AS REAL)) as total_yield " +
  "FROM records WHERE fdate = '2026-06-02' GROUP BY workshop"
).all();
totals.forEach(function(r) { console.log("  " + r.workshop + ": " + (r.total_yield||0)); });

// Total for June 2
var sum = db.prepare("SELECT SUM(CAST(json_extract(fields_json, '$.FQuaQty') AS REAL)) as t FROM records WHERE fdate = '2026-06-02'").get();
console.log("\nTotal June 2 FQuaQty:", sum.t);

// Check: does the field name match? Try FQuaQty vs numeric field parsing
console.log("\n=== Checking numeric parse for FQuaQty ===");
var raw = db.prepare("SELECT fdate, workshop, json_extract(fields_json, '$.FQuaQty') as raw_qua, CAST(json_extract(fields_json, '$.FQuaQty') AS REAL) as real_qua FROM records WHERE fdate = '2026-06-02'").all();
raw.forEach(function(r) { console.log("  " + r.workshop + " raw=" + r.raw_qua + " parsed=" + r.real_qua); });

// Check lastSyncTime
console.log("\n=== Sync info ===");
var first = db.prepare("SELECT MIN(fdate) as first FROM records").get();
var last = db.prepare("SELECT MAX(fdate) as last FROM records").get();
console.log("Date range:", first.first, "~", last.last);

var meta = db.prepare("SELECT * FROM meta").all();
console.log("Meta:");
meta.forEach(function(r) { console.log("  " + r.key + " = " + r.value); });

db.close();
