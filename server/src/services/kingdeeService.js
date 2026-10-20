/**
 * 金蝶云星空 Web API 调用封装
 *
 * 鉴权流程：
 * 1. 用 LoginByAppSecret（appKey + appSecret）登录获取 session cookie
 * 2. 每次请求携带 cookie + appKey 签名（query 参数）
 *
 * API 路径前缀统一使用 ServicesStub（实测兼容）
 */
const http = require('node:http');
const crypto = require('node:crypto');
const config = require('../config');

class KingdeeClient {
  /**
   * @param {string} [serverUrl] - 覆盖 config 中的服务器地址
   * @param {string} [dbId] - 覆盖 config 中的账套 ID
   * @param {string} [appKey] - 覆盖 config 中的 AppKey
   * @param {string} [appSecret] - 覆盖 config 中的 AppSecret
   */
  constructor(serverUrl, dbId, appKey, appSecret) {
    this.serverUrl = serverUrl || config.kingdee.serverUrl;
    this.dbId = dbId || config.kingdee.dbId;
    this.appKey = appKey || config.kingdee.appKey;
    this.appSecret = appSecret || config.kingdee.appSecret;
    this._sessionCookie = null;
  }
  /** 带重试包装的构造函数（使用环境变量配置） */
  static fromEnv() {
    return new KingdeeClient();
  }

  /** 检查配置是否完整 */
  isConfigured() {
    return !!(this.serverUrl && this.dbId && this.appKey && this.appSecret);
  }

  /** 生成 appKey 请求签名 */
  _buildSignature(timestamp) {
    const signStr = this.appKey + timestamp;
    return crypto
      .createHmac('sha256', this.appSecret)
      .update(signStr, 'utf8')
      .digest('base64');
  }

  /**
   * 登录金蝶云星空（获取 session）
   * 使用 LoginByAppSecret + 集成用户名，兼容当前金蝶云版本
   */
  async loginByAppSecret() {
    const { username, password } = config.kingdee;
    const result = await this._request(
      'Kingdee.BOS.WebApi.ServicesStub.AuthService.LoginByAppSecret.common.kdsvc',
      {
        acctID: this.dbId,
        appId: this.appKey,
        appSecret: this.appSecret,
        username: username || '',
        password: password || '',
        lcid: 2052,
      },
    );

    if (result.cookies && result.cookies.length > 0) {
      this._sessionCookie = result.cookies.join('; ');
    }

    return result.data;
  }

  /**
   * 获取业务对象元数据（表结构）
   * @param {string} formId - 业务对象 FormId，如 BD_MATERIAL
   */
  async getFormMeta(formId) {
    const innerParams = {
      FormId: formId,
      SubSystemId: '',
      IsDeleteManagement: false,
    };
    return this._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.GetFormDesignInfo.common.kdsvc',
      { data: JSON.stringify(innerParams) },
    );
  }

  /**
   * 执行单据查询（表记录）
   * 该版本金蝶 API 要求参数包裹在 data 字段中（JSON 字符串），FieldKeys 需为逗号分隔字符串
   * @param {string} formId - 业务对象 FormId
   * @param {object} query - 查询参数
   */
  async executeBillQuery(formId, query = {}) {
    const { limit = 300, offset = 0, fieldKeys = [], filter = '', orderString = '', skipDateFilter = false } = query;

    // 拼接日期过滤条件（基础资料表无 FDate 字段，需跳过）
    let filterString = filter || '';
    if (!skipDateFilter) {
      const startDate = config.kingdee.dataStartDate;
      if (startDate) {
        const dateCondition = `FDate >= '${startDate}'`;
        filterString = filterString
          ? `(${filterString}) AND ${dateCondition}`
          : dateCondition;
      }
    }

    const innerParams = {
      FormId: formId,
      FieldKeys: Array.isArray(fieldKeys) ? fieldKeys.join(',') : fieldKeys,
      FilterString: filterString,
      Limit: limit,
      StartRow: offset,
      TopRowCount: 20000,
      OrderString: orderString,
      SubSystemId: '',
    };

    return this._request(
      'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.ExecuteBillQuery.common.kdsvc',
      { data: JSON.stringify(innerParams) },
    );
  }

  /**
   * 自动循环分页获取全部数据（首次请求一次性返回）
   * 每次请求 200 条，最多循环 50 次（共 10,000 条）
   */
  async executeBillQueryAll(formId, query = {}) {
    const { fieldKeys = [], filter = '', orderString = '' } = query;
    const pageSize = 200;
    const maxPages = 100;
    const allRows = [];

    for (let page = 0; page < maxPages; page++) {
      const offset = page * pageSize;

      const result = await this.callWithAuth(() =>
        this.executeBillQuery(formId, {
          limit: pageSize,
          offset,
          fieldKeys,
          filter,
          orderString,
        }),
      );

      // 提取实际数据行：金蝶可能返回 2D 数组、对象数组、或 Result 包裹格式
      let rows = result.data;

      // 情况1: { Result: [...] } 包裹格式
      if (rows && typeof rows === 'object' && !Array.isArray(rows) && Array.isArray(rows.Result)) {
        rows = rows.Result;
      }

      // 情况2a: 非数组 → 是异常响应（金蝶报错时会把错误当字符串/对象返回），必须抛错而不是当成"没数据"
      // 以前这里静默 break 当成空结果，调用方（如 PRD_INSTOCK 同步）会误以为"金蝶确实没数据"，
      // 而它又是先删后拉 → 31 天数据被清空。2026-10-10 实际发生过。
      if (!Array.isArray(rows)) {
        const preview = typeof result.data === 'string'
          ? result.data.slice(0, 300)
          : JSON.stringify(result.data || null).slice(0, 300);
        throw new Error(`金蝶返回格式异常 formId=${formId} dataType=${typeof result.data}：${preview}`);
      }

      // 情况2b: 空数组 → 真的没有数据
      if (rows.length === 0) {
        if (page === 0) {
          console.warn(`[kingdee] executeBillQueryAll 首页无数据 formId=${formId}`);
        }
        break;
      }

      if (page === 0) {
        console.log(`[kingdee] === 第1页诊断 formId=${formId} ===`);
        console.log(`[kingdee] fieldKeys=[${fieldKeys.join(',')}]`);
        const is2D = Array.isArray(rows[0]);
        console.log(`[kingdee] 格式=${is2D ? '2D数组' : typeof rows[0] === 'object' ? '对象数组' : 'other'} 行数=${rows.length}`);

        if (is2D && rows.length > 0) {
          console.log(`[kingdee] 表头(第0行):`, JSON.stringify(rows[0]));
          const dataStart = rows[0].some((h) => typeof h === 'string' && /^F[A-Z]/.test(h)) ? 1 : 0;
          const dataRows = rows.slice(dataStart);
          const sampleCount = Math.min(3, dataRows.length);
          console.log(`[kingdee] hasHeader=${dataStart > 0} 数据行数=${dataRows.length}`);
          for (let s = 0; s < sampleCount; s++) {
            console.log(`[kingdee] 数据行[${s}]:`, JSON.stringify(dataRows[s]));
          }
        } else if (rows.length > 0) {
          console.log(`[kingdee] 首行示例:`, JSON.stringify(rows[0]).slice(0, 500));
        }
        console.log(`[kingdee] === 第1页诊断结束 ===`);
      } else {
        console.log(`[kingdee] 第${page + 1}页 rows=${rows.length}`);
      }

      allRows.push(...rows);

      if (rows.length < pageSize) break;
    }

    console.log(`[kingdee] executeBillQueryAll 完成 formId=${formId} total=${allRows.length}`);
    return allRows;
  }

  /**
   * 保存/创建业务对象（单据）
   * 调用 DynamicFormService.Save，用于新建或修改金蝶单据
   * @param {string} formId - 业务对象 FormId，如 PRD_INSTOCK
   * @param {object} model - 单据数据模型
   * @param {object} [options] - 额外选项
   * @param {boolean} [options.createOnly=false] - true=只允许新建(不覆盖已有)
   * @returns {Promise<{data, cookies}>}
   */
  async save(formId, model, options = {}) {
    // Kingdee Save API:
    //   外层: { FormId, data: JSON.stringify({ Model, ... }) }
    //   FormId 在外层，JSON 字符串内放 Model
    const inner = { Model: model };
    if (options.createOnly) inner.CreateOnly = true;
    if (options.ignoreRule) inner.IgnoreRule = true;
    if (options.ignoreInteraction) inner.IgnoreInteraction = true;
    const payload = {
      FormId: formId,
      data: JSON.stringify(inner),
    };
    return this.callWithAuth(() =>
      this._request(
        'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Save.common.kdsvc',
        payload,
      ),
    );
  }

  /**
   * 通用 HTTP 请求
   */
  _request(path, data) {
    if (!this.isConfigured()) {
      return Promise.reject(
        new Error('金蝶云星空 API 未配置，请设置 KD_SERVER_URL、KD_DBID、KD_APP_KEY、KD_APP_SECRET'),
      );
    }

    return new Promise((resolve, reject) => {
      const timestamp = Date.now().toString();
      const signature = this._buildSignature(timestamp);

      const urlPath = `/${path}?dbid=${encodeURIComponent(this.dbId)}&timestamp=${timestamp}&signature=${encodeURIComponent(signature)}&appkey=${encodeURIComponent(this.appKey)}`;

      const postBody = JSON.stringify(data);
      const url = new URL(urlPath.slice(1), this.serverUrl);

      const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(postBody),
      };
      if (this._sessionCookie) {
        headers.Cookie = this._sessionCookie;
      }

      const options = {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname + url.search,
        method: 'POST',
        headers,
        timeout: 20000,
      };

      const req = http.request(options, (res) => {
        // 用 Buffer.concat 而非 data += chunk：
        // 字符串拼接会在 chunk 边界切断多字节 UTF-8 字符，产生 U+FFFD 乱码
        const chunks = [];
        const cookies = res.headers['set-cookie'];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const data = Buffer.concat(chunks).toString('utf8');
          try {
            resolve({ data: JSON.parse(data), cookies });
          } catch {
            resolve({ data, cookies, status: res.statusCode });
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('请求超时'));
      });

      req.write(postBody);
      req.end();
    });
  }

  /** 当前是否已登录 */
  isLoggedIn() {
    return !!this._sessionCookie;
  }

  /** 清除 session（重新登录） */
  logout() {
    this._sessionCookie = null;
  }

  /**
   * 带自动登录的重试包装
   * 调用 apiFn，如果返回会话丢失错误则自动重新登录后重试一次
   */
  async callWithAuth(apiFn) {
    if (!this.isLoggedIn()) {
      await this._ensureLogin();
    }

    const { data, cookies } = await apiFn();

    // 检查是否会话过期
    if (this._isSessionExpired(data)) {
      this.logout();
      await this._ensureLogin();
      return apiFn();
    }

    return { data, cookies };
  }

  _isSessionExpired(responseData) {
    // 金蝶可能返回不同格式的会话过期错误：
    //   { Result: { ResponseStatus: { Errors: [...] } } }
    //   [[{ Result: { ResponseStatus: { Errors: [...] } } }]]  ← 2D 数组包裹
    //   [{ Result: { ResponseStatus: { Errors: [...] } } }]    ← 1D 数组包裹
    let target = responseData;
    if (Array.isArray(target) && target.length > 0) {
      const first = target[0];
      if (Array.isArray(first) && first.length > 0 && first[0] && first[0].Result) {
        target = first[0]; // [[{Result:...}]] → {Result:...}
      } else if (first && first.Result) {
        target = first;     // [{Result:...}] → {Result:...}
      }
    }
    const msg =
      target?.Result?.ResponseStatus?.Errors?.[0]?.Message || '';
    return msg.includes('会话信息已丢失');
  }

  async _ensureLogin() {
    if (!this.isConfigured()) {
      throw new Error(
        '金蝶应用未配置。请设置 KD_SERVER_URL、KD_DBID、KD_APP_KEY、KD_APP_SECRET',
      );
    }
    await this.loginByAppSecret();
  }
}

module.exports = KingdeeClient;
