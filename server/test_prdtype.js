/**
 * 测试：通过 PrdType 解锁 FOperNumber
 * 服务规则: "产品类型=主产品,锁定工序序列和工序号,反之解锁"
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

  // 试不同的 PrdType 值
  // 1 = 主产品, 2 = 联产品, 3 = 副产品
  for (const pt of [1, 2, 3, '1', '2', '3']) {
    const r = await client.save('SFC_OperationReport', {
      ...base,
      FEntity: [{
        FSeqNumber: "0",
        FOperNumber: 10,
        FQuaQty: 10,
        FMaterialId: { FNumber: 'FP010580' },
        FWorkCenterId: { FNumber: 'WC000004' },
        FUnitID: { FNumber: 'Pcs' },
        MoNumber: 'YJYMO2603133',
        MoRowNumber: 1,
        // 产品类型
        PrdType: pt,
      }],
    });
    const errs = r.data?.Result?.ResponseStatus?.Errors || [];
    const firstMsg = errs[0]?.Message?.slice(0, 120) || '✅ 成功';
    console.log(`  PrdType=${pt}: ${firstMsg}`);
    if (errs.length === 0) console.log(`    ✅ ${r.data?.Result?.Number}`);
  }
}

main().catch(e => console.error('FATAL', e));
