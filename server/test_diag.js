/**
 * 诊断：到底是"工序计划不存在"还是"FOperNumber 格式错误"？
 * 试 FOperNumber=1/2/5/10/20 看哪个通过
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const base = {
    FDate: today, F_UNW_Date2: today,
    FBillTypeID: { FNumber: 'GXHB01_SYS' },
    F_UNW_MONum: 'YJYMO2603133',
    PrdOrgId: { FNumber: 'YJY' },
    FWorkShopId: { FNumber: 'BM000034' },
    F_FD_OperDescp: '装盒&装箱',
    OptRptEntry: [{ FMaterialId: { FNumber: 'FP010580' }, FQuaQty: 10 }],
  };

  // 试不同 FOperNumber 值
  for (const val of [1, 2, 5, 10, 20, 30, 9999]) {
    const r = await client.save('SFC_OperationReport', {
      ...base,
      FEntity: [{
        FSeqNumber: "0",
        FOperNumber: val,
        FQuaQty: 10,
        FMaterialId: { FNumber: 'FP010580' },
        FWorkCenterId: { FNumber: 'WC000004' },
        FUnitID: { FNumber: 'Pcs' },
        MoRowNumber: 1,
        MoNumber: 'YJYMO2603133',
      }],
    });
    const errs = r.data?.Result?.ResponseStatus?.Errors || [];
    const first = errs[0]?.Message?.slice(0, 120) || '✅ 成功';
    console.log(`  FOperNumber=${val}: ${first}`);
    if (errs.length === 0) {
      console.log(`    ✅ ${r.data?.Result?.Number}`);
    }
  }

  // 也查 MO 的 TreeEntity 具体信息（不用 EntityKey）
  console.log('\n=== MO TreeEntity 全部数据 ===');
  try {
    const r = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
        { FormId: 'PRD_MO', data: JSON.stringify({ Number: 'YJYMO2603133' }) },
      ),
    );
    const record = r.data?.Result?.Result;
    if (record) {
      const tree = record.TreeEntity;
      if (Array.isArray(tree)) {
        for (let i = 0; i < tree.length; i++) {
          // 找嵌入的工序行
          const item = tree[i];
          for (const k of Object.keys(item)) {
            const v = item[k];
            if (typeof v === 'number' && v > 0) {
              // print number fields
            }
            if (Array.isArray(v) && v.length > 0) {
              // has sub-entities
              console.log(`  Tree[${i}].${k}: Array[${v.length}]`);
              const sub = v[0];
              if (typeof sub === 'object') {
                const subKeys = Object.keys(sub);
                console.log(`    keys[0..10]: ${subKeys.slice(0, 10).join(', ')}`);
              }
            }
          }
          // just print OperNumber if exists
          if (item.OperNumber !== undefined) {
            console.log(`  Tree[${i}].OperNumber: ${item.OperNumber}, OperName: ${item.OperName}`);
          }
          if (item.FOperNumber !== undefined) {
            console.log(`  Tree[${i}].FOperNumber: ${item.FOperNumber}`);
          }
        }
      }
    }
  } catch(e) {
    console.log('  Error:', e.message);
  }
}

main().catch(e => console.error('FATAL', e));
