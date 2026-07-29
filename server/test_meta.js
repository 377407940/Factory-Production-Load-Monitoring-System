/**
 * 查 SFC_OperationReport 的元数据
 * 了解 FEntity 各字段名 + 格式
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

async function main() {
  // 1. 用 DynamicFormService 查元数据
  console.log('=== 查元数据 ===');
  try {
    const r = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Load.common.kdsvc',
        { FormId: 'SFC_OperationReport' },
      ),
    );
    // 可能太大，先看结构
    const data = r.data;
    console.log('  Top keys:', Object.keys(data).join(', '));
    if (data.Result?.Result) {
      console.log('  Result keys:', Object.keys(data.Result.Result).slice(0, 20).join(', '));
      // 找实体字段
      const pkgs = data.Result.Result.Packages;
      if (pkgs) {
        for (let i = 0; i < Math.min(pkgs.length, 3); i++) {
          const pkg = pkgs[i];
          console.log(`  Package[${i}] keys:`, Object.keys(pkg).join(', '));
          // 看实体的字段
          if (pkg.EntityType?.Properties) {
            for (const prop of pkg.EntityType.Properties.slice(0, 30)) {
              console.log(`    Property: ${prop.Name} (${prop.DataType})`);
            }
          }
        }
      }
    }
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 2. 用另一个 API 查字段
  console.log('\n=== 查字段元数据 ===');
  try {
    const r = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Validate.common.kdsvc',
        { FormId: 'SFC_OperationReport', Data: JSON.stringify({}) },
      ),
    );
    console.log('  Validate:', JSON.stringify(r.data).slice(0, 500));
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 3. 用 FieldList API
  console.log('\n=== FieldList API ===');
  try {
    const r = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.FieldList.common.kdsvc',
        { FormId: 'SFC_OperationReport' },
      ),
    );
    const data = r.data;
    console.log('  Result:', JSON.stringify(data).slice(0, 1000));
  } catch(e) {
    console.log('  Error:', e.message);
  }
}

main().catch(e => console.error('FATAL', e));
