/**
 * 查元数据 - 解析返回数组
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

async function main() {
  console.log('=== 查元数据(Load API) ===');
  try {
    const r = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Load.common.kdsvc',
        { FormId: 'SFC_OperationReport' },
      ),
    );
    const data = r.data;
    console.log('Type:', typeof data, Array.isArray(data) ? `Array[${data.length}]` : 'obj');

    // 如果是数组，把每个元素的结构打出来
    if (Array.isArray(data)) {
      for (let i = 0; i < Math.min(data.length, 5); i++) {
        const item = data[i];
        if (typeof item === 'object' && item !== null) {
          console.log(`[${i}]:`, Object.keys(item).slice(0, 15).join(', '));
          // 找 Properties
          if (item.Properties) {
            for (const p of item.Properties.slice(0, 20)) {
              console.log(`  Prop: ${p.Name} (${p.DataType})`);
            }
          }
          if (item.Fields) {
            for (const f of item.Fields.slice(0, 20)) {
              console.log(`  Field: ${f.Name || f.FieldName} type=${f.Type || f.DataType}`);
            }
          }
        } else {
          console.log(`[${i}]:`, String(item).slice(0, 100));
        }
      }
    } else if (typeof data === 'object') {
      // 试试看里面有没有 Packages
      if (data.Packages) {
        console.log('Has Packages:', data.Packages.length);
        for (let i = 0; i < Math.min(data.Packages.length, 3); i++) {
          const pkg = data.Packages[i];
          console.log(`Package[${i}] keys:`, Object.keys(pkg).join(', '));
          if (pkg.EntityType?.Properties) {
            for (const prop of pkg.EntityType.Properties.slice(0, 30)) {
              console.log(`  Prop: ${prop.Name} (${prop.DataType})`);
            }
          }
        }
      }
    }

    // 打印部分内容
    const txt = JSON.stringify(data).slice(0, 3000);
    console.log('\nRaw (first 3k):', txt);
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 2. 用一个更轻量的方式找字段名
  // 试着在 FEntity 里放 FOperNumber 并设为 0，看看是否报相同错误
  console.log('\n=== FOperNumber=0 ===');
  const client2 = KingdeeClient.fromEnv();
  try {
    const today = new Date().toISOString().slice(0, 10);
    const r = await client2.save('SFC_OperationReport', {
      FDate: today, F_UNW_Date2: today,
      FBillTypeID: { FNumber: 'GXHB01_SYS' },
      F_UNW_MONum: 'YJYMO2603133',
      PrdOrgId: { FNumber: 'YJY' },
      FWorkShopId: { FNumber: 'BM000034' },
      F_FD_OperDescp: '装盒&装箱',
      OptRptEntry: [{ FMaterialId: { FNumber: 'FP010580' }, FQuaQty: 10 }],
      FEntity: [{
        FSeqNumber: "0",
        FOperNumber: 0,
        FQuaQty: 10,
        FMaterialId: { FNumber: 'FP010580' },
        FWorkCenterId: { FNumber: 'WC000003' },
        FUnitID: { FNumber: 'Pcs' },
        MoRowNumber: 1,
      }],
    });
    const errs = r.data?.Result?.ResponseStatus?.Errors || [];
    errs.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 300)}`));
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 3. 试一个完全不同 MO - 之前成功的那个
  console.log('\n=== 用旧 MO YJYMO2605108 (灌装) ===');
  try {
    const today = new Date().toISOString().slice(0, 10);
    const r = await client2.save('SFC_OperationReport', {
      FDate: today, F_UNW_Date2: today,
      FBillTypeID: { FNumber: 'GXHB01_SYS' },
      F_UNW_MONum: 'YJYMO2605108',
      PrdOrgId: { FNumber: 'YJY' },
      FWorkShopId: { FNumber: 'BM000034' },
      F_FD_OperDescp: '装盒&装箱',  // 不触发灌装规则
      OptRptEntry: [{ FMaterialId: { FNumber: 'FP010587' }, FQuaQty: 10 }],
      FEntity: [{
        FSeqNumber: "0",
        FOperNumber: 10,
        FQuaQty: 10,
        FMaterialId: { FNumber: 'FP010587' },
        FWorkCenterId: { FNumber: 'WC000003' },
        FUnitID: { FNumber: 'Pcs' },
        MoRowNumber: 1,
      }],
    });
    const errs = r.data?.Result?.ResponseStatus?.Errors || [];
    errs.forEach(e => console.log(`  ❌ ${e.Message.slice(0, 300)}`));
    if (errs.length === 0) console.log(`  ✅ ${r.data?.Result?.Number}`);
  } catch(e) {
    console.log('  Error:', e.message);
  }
}

main().catch(e => console.error('FATAL', e));
