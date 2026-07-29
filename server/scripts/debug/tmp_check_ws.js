var wmd = require('./src/config/workshopMasterData');
console.log('=== All WORKSHOPS ===');
wmd.WORKSHOPS.forEach(function(w) { console.log('  ' + w); });

console.log('\n=== EQUIPMENT_LIST keys ===');
Object.keys(wmd.EQUIPMENT_LIST).forEach(function(k) { console.log('  ' + k); });

console.log('\n=== 分包间 equipment ===');
var fenbaoRelated = Object.keys(wmd.EQUIPMENT_LIST).filter(function(k) { return k.includes('分包'); });
fenbaoRelated.forEach(function(k) {
  console.log('  ' + k + ':');
  wmd.EQUIPMENT_LIST[k].forEach(function(e) { console.log('    ' + JSON.stringify(e)); });
});

console.log('\n=== 固体一 (excl 8号) equipment ===');
var related = Object.keys(wmd.EQUIPMENT_LIST).filter(function(k) { return k.includes('固体一') && !k.includes('8号'); });
related.forEach(function(k) {
  console.log('  ' + k + ':');
  wmd.EQUIPMENT_LIST[k].forEach(function(e) { console.log('    ' + JSON.stringify(e)); });
});
