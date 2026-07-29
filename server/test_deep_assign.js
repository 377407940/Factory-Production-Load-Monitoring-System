/**
 * 深层赋值：试各种字段名格式，让 FEntity 上的规则字段不为 null
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

function testModel(label, extraFields) {
  return new Promise(async (resolve) => {
    const today = new Date().toISOString().slice(0, 10);
    const model = {
      FDate: today, F_UNW_Date2: today,
      FBillTypeID: { FNumber: 'GXHB01_SYS' },
      F_UNW_MONum: 'YJYMO2605108',
      PrdOrgId: { FNumber: 'YJY' },
      FWorkShopId: { FNumber: 'BM000034' },
      OptRptEntry: [{
        FMaterialId: { FNumber: 'FP010587' },
        FQuaQty: 10,
        F_FD_OperDescp: 'test',  // OptRptEntry 有这个字段
        F_FD_AimProducts: 10,
        F_FD_AimTimes: 1,
      }],
      FEntity: [{
        FMaterialId: { FNumber: 'FP010587' },
        FQuaQty: 10,
        ...extraFields,
      }],
    };
    try {
      const r = await client.save('SFC_OperationReport', model);
      const resp = r.data;
      if (resp?.Result?.ResponseStatus?.IsSuccess) {
        console.log(`  ✅ ${label}: ${resp.Result.Number}`);
        resolve(true);
      } else {
        const errs = resp?.Result?.ResponseStatus?.Errors || [];
        const msg = (errs[0]?.Message || '').slice(0, 200);
        // 看有没有变化
        const noFind = msg.includes("NoneType") || msg.includes("find('灌装')");
        if (!noFind) {
          console.log(`  🔶 ${label}: ${msg}`);
        }
        resolve(false);
      }
    } catch(e) {
      resolve(false);
    }
  });
}

async function main() {
  console.log('=== 各种字段名格式 ===');

  const tests = [
    // 字段名变体
    ['F_FD_OperDescp: "test"', { F_FD_OperDescp: 'test' }],
    ['F_FD_OperDescp empty', { F_FD_OperDescp: '' }],
    ['F_FD_OperDescp number', { F_FD_OperDescp: 123 }],

    // 带实体前缀
    ['OptRptEntry.F_FD_OperDescp', { 'OptRptEntry.F_FD_OperDescp': 'test' }],
    ['#F_FD_OperDescp#', { '#F_FD_OperDescp#': 'test' }],

    // 不同大小写
    ['f_fd_operdescp', { f_fd_operdescp: 'test' }],
    ['F_fd_OperDescp', { F_fd_OperDescp: 'test' }],

    // 不同前缀
    ['FF_FD_OperDescp', { FF_FD_OperDescp: 'test' }],
    ['_F_FD_OperDescp', { _F_FD_OperDescp: 'test' }],
    ['Entity_F_FD_OperDescp', { Entity_F_FD_OperDescp: 'test' }],
    ['FEntity_F_FD_OperDescp', { FEntity_F_FD_OperDescp: 'test' }],

    // Id/Name 变体
    ['F_FD_OperDescp_Id', { F_FD_OperDescp_Id: 'test' }],
    ['F_FD_OperDescp_Text', { F_FD_OperDescp_Text: 'test' }],
    ['F_FD_OperDescp_Value', { F_FD_OperDescp_Value: 'test' }],

    // 对象格式
    ['F_FD_OperDescp {Value}', { F_FD_OperDescp: { Value: 'test' } }],
    ['F_FD_OperDescp {Label}', { F_FD_OperDescp: { Label: 'test' } }],

    // 所有三个字段一起
    ['all three fields', {
      F_FD_OperDescp: '液体灌装',
      F_FD_AimProducts: 22176,
      F_FD_AimTimes: 3.08,
      FDocumentStatus: 'C',
    }],
  ];

  // 并行测试太慢，逐个跑
  for (const [label, fields] of tests) {
    await testModel(label, fields);
  }

  // 额外：试试不传 FEntity 但用其他方式
  console.log('\n=== 特殊尝试 ===');

  // 尝试：FEntity 用其他 key 传值
  const today = new Date().toISOString().slice(0, 10);
  const base = {
    FDate: today, F_UNW_Date2: today,
    FBillTypeID: { FNumber: 'GXHB01_SYS' },
    F_UNW_MONum: 'YJYMO2605108',
    PrdOrgId: { FNumber: 'YJY' },
    FWorkShopId: { FNumber: 'BM000034' },
    OptRptEntry: [{
      FMaterialId: { FNumber: 'FP010587' },
      FQuaQty: 10,
      F_FD_OperDescp: 'test',
    }],
  };

  // 把 FEntity 作为子实体塞 OptRptEntry 第一行
  console.log('--- FEntity as child of OptRptEntry[0] ---');
  try {
    const m = JSON.parse(JSON.stringify(base));
    m.OptRptEntry[0].FEntity = [{ FQuaQty: 10, F_FD_OperDescp: 'test' }];
    const r = await client.save('SFC_OperationReport', m);
    const resp = r.data;
    if (resp?.Result?.ResponseStatus?.IsSuccess) {
      console.log(`  ✅ ${resp.Result.Number}`);
    } else {
      const errs = resp?.Result?.ResponseStatus?.Errors || [];
      errs.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 150)}`));
    }
  } catch(e) {}

  // 把规则需要的字段写在表头
  console.log('--- header level fields ---');
  try {
    const m = {
      ...base,
      F_FD_OperDescp: 'test',
      F_FD_AimProducts: 10,
      F_FD_AimTimes: 1,
      FDocumentStatus: 'C',
    };
    const r = await client.save('SFC_OperationReport', m);
    const resp = r.data;
    if (resp?.Result?.ResponseStatus?.IsSuccess) {
      console.log(`  ✅ ${resp.Result.Number}`);
    } else {
      const errs = resp?.Result?.ResponseStatus?.Errors || [];
      errs.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 150)}`));
    }
  } catch(e) {}

  // 试 FEntity 带 FID 引用已有记录
  console.log('--- FEntity with FID reference ---');
  try {
    const m = {
      ...base,
      FEntity: [{
        Id: 206839,  // 已有记录的 FID
        FMaterialId: { FNumber: 'FP010587' },
        FQuaQty: 10,
      }],
    };
    const r = await client.save('SFC_OperationReport', m);
    const resp = r.data;
    if (resp?.Result?.ResponseStatus?.IsSuccess) {
      console.log(`  ✅ ${resp.Result.Number}`);
    } else {
      const errs = resp?.Result?.ResponseStatus?.Errors || [];
      errs.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 150)}`));
    }
  } catch(e) {}
}

main().catch(e => console.error('FATAL', e));
