var Database = require('better-sqlite3');
var db = new Database('data/sfc_records.db');

// Read all records (same as aggregation engine)
var rows = db.prepare('SELECT * FROM records').all();
console.log('Total records from SQLite:', rows.length);

// Simulate what the aggregation engine does
var records = rows.map(function(r) {
  var fields = JSON.parse(r.fields_json);
  return {
    date: r.fdate,
    shift: r.shift,
    workshop: r.workshop,
    machine: r.machine,
    fields: fields,
    content_hash: r.content_hash,
  };
});

// Check workshops defined
var WORKSHOPS = [
  'Y固体一1号车间', 'Y固体一2号车间', 'Y固体一3号车间',
  'Y固体一5号车间', 'Y固体一6号车间', 'Y固体一8号车间',
  'Y固体一分包间', 'Y固体二车间', 'Y液体二车间'
];
var WS_SET = new Set(WORKSHOPS);

// Simulate daily workshop metrics
var june2_records = records.filter(function(r) { return r.date === '2026-06-02'; });
console.log('\nJune 2 records before processing: ' + june2_records.length);
june2_records.forEach(function(r) {
  console.log('  workshop=' + r.workshop + ' machine=' + r.machine);
  console.log('    FQuaQty=' + r.fields.FQuaQty + ' (type=' + typeof r.fields.FQuaQty + ')');
  console.log('    in WORKSHOPS? ' + WS_SET.has(r.workshop));
});

// Now simulate the aggregation: the engine loads ALL records then filters
var filtered_records = records.filter(function(r) {
  return r.workshop && r.date && WS_SET.has(r.workshop);
});
console.log('\nAfter WORKSHOP filter: ' + filtered_records.length + ' / ' + records.length);

var june2_filtered = filtered_records.filter(function(r) { return r.date === '2026-06-02'; });
console.log('June 2 after filter: ' + june2_filtered.length);
june2_filtered.forEach(function(r) {
  console.log('  ' + r.workshop + ' FQuaQty=' + r.fields.FQuaQty + ' loadTimes=' + r.fields.F_YJY_loadTimes);
});

// Check for non-workshop records on June 2
var june2_no_workshop = june2_records.filter(function(r) { return !r.workshop || !WS_SET.has(r.workshop); });
console.log('\nJune 2 records without valid workshop: ' + june2_no_workshop.length);
june2_no_workshop.forEach(function(r) {
  console.log('  workshop="' + r.workshop + '" machine=' + r.machine);
});

// Check all records to see workshop name variations
console.log('\n=== Unique workshop values in DB ===');
var wsValues = {};
records.forEach(function(r) {
  if (r.workshop) {
    wsValues[r.workshop] = (wsValues[r.workshop] || 0) + 1;
  }
});
Object.keys(wsValues).sort().forEach(function(k) {
  console.log('  "' + k + '" -> ' + wsValues[k] + ' records');
});

db.close();
