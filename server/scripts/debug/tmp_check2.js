const db = require('better-sqlite3')('data/production.db');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables:', tables.map(function(t){return t.name}).join(', '));
if (tables.length > 0) {
  console.log('=== 表结构 ===');
  tables.forEach(function(t) {
    const cols = db.prepare("PRAGMA table_info('" + t.name + "')").all();
    console.log(t.name + ':');
    cols.forEach(function(c){console.log('  ' + c.name + ' ' + c.type)});
  });

  console.log('');
  console.log('=== 各表最新记录数 ===');
  tables.forEach(function(t) {
    const cnt = db.prepare("SELECT COUNT(*) as c FROM " + t.name).get();
    console.log(t.name + ': ' + cnt.c + ' rows');
    if (cnt.c > 0) {
      const sample = db.prepare("SELECT * FROM " + t.name + " LIMIT 2").all();
      console.log('  sample:', JSON.stringify(sample[0]));
      const recent = db.prepare("SELECT * FROM " + t.name + " ORDER BY rowid DESC LIMIT 3").all();
      console.log('  recent:', recent.map(function(r){return JSON.stringify(r)}).join(' | '));
    }
  });
}
db.close();
