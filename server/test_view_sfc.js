/**
 * 用 View API 查看已有 SFC 的完整结构
 * 看 FEntity（汇总）里到底有什么字段和数据
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const KingdeeClient = require('./src/services/kingdeeService');
const client = KingdeeClient.fromEnv();

async function main() {
  // 1. View API - 看完整记录结构
  console.log('=== View YJYGXHB26060848 ===');
  try {
    const r = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
        {
          FormId: 'SFC_OperationReport',
          data: JSON.stringify({ Number: 'YJYGXHB26060848' }),
        },
      ),
    );
    const data = r.data;
    if (data?.Result?.ResponseStatus?.IsSuccess) {
      // 打印 Result 的所有一级 key
      const result = data.Result;
      const keys = Object.keys(result).filter(k => k !== 'ResponseStatus');
      console.log('  Result keys:', keys.join(', '));
      // 打印 Model
      if (result.Model) {
        const modelKeys = Object.keys(result.Model);
        console.log('  Model keys:', modelKeys.join(', '));
        // 看 FEntity
        if (result.Model.FEntity) {
          console.log('  FEntity:', JSON.stringify(result.Model.FEntity).slice(0, 500));
        }
        // 看 OptRptEntry
        if (result.Model.OptRptEntry) {
          console.log('  OptRptEntry:', JSON.stringify(result.Model.OptRptEntry).slice(0, 500));
        }
      }
      // 打印整个 result(精简)
      console.log('  Full result:', JSON.stringify(result, (k, v) => {
        if (k === 'ResponseStatus') return undefined;
        if (Array.isArray(v) && v.length > 3) return `[array(${v.length})]`;
        return v;
      }, 2).slice(0, 2000));
    } else {
      const errs = data?.Result?.ResponseStatus?.Errors || [];
      errs.forEach(e => console.log('  ❌', e.Message));
      console.log('  Raw:', JSON.stringify(data).slice(0, 500));
    }
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 2. View 包装记录
  console.log('\n=== View YJYGXHB26060859 (包装) ===');
  try {
    const r = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc',
        {
          FormId: 'SFC_OperationReport',
          data: JSON.stringify({ Number: 'YJYGXHB26060859' }),
        },
      ),
    );
    const data = r.data;
    if (data?.Result?.ResponseStatus?.IsSuccess) {
      if (data.Result.Model) {
        const modelKeys = Object.keys(data.Result.Model);
        console.log('  Model keys:', modelKeys.join(', '));
        if (data.Result.Model.FEntity) {
          console.log('  FEntity:', JSON.stringify(data.Result.Model.FEntity).slice(0, 500));
        }
        if (data.Result.Model.OptRptEntry) {
          const entries = data.Result.Model.OptRptEntry;
          console.log(`  OptRptEntry (${entries.length} rows):`, JSON.stringify(entries[0]).slice(0, 500));
        }
      }
    } else {
      const errs = data?.Result?.ResponseStatus?.Errors || [];
      errs.forEach(e => console.log('  ❌', e.Message));
    }
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // 3. 用 Load 接口 (另一种查看方式)
  console.log('\n=== Load 接口 ===');
  try {
    const r = await client.callWithAuth(() =>
      client._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Load.common.kdsvc',
        {
          FormId: 'SFC_OperationReport',
          data: JSON.stringify({
            Number: 'YJYGXHB26060848',
            NeedReturnFields: ['*'],  // 所有字段
          }),
        },
      ),
    );
    const data = r.data;
    if (data?.Result?.ResponseStatus?.IsSuccess) {
      console.log('  Model keys:', Object.keys(data.Result.Model || {}).join(', '));
    } else {
      const errs = data?.Result?.ResponseStatus?.Errors || [];
      errs.forEach(e => console.log('  ❌', e.Message));
    }
  } catch(e) {
    console.log('  Error:', e.message);
  }
}

main().catch(e => console.error('FATAL', e));
