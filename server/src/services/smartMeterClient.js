/**
 * 智能电表数据客户端
 *
 * 对接接口：http://yjytask.joyea.cn:3000/api
 *
 * 流程：
 *   1. POST /auth/b/doLogin → 获取 JWT token（密码需 SM2 加密）
 *   2. POST /biz/power/workshop → 查询车间能耗（返回透视表格式）
 *   3. unpivot → 将动态日期列反透视成标准化行
 *
 * 低耦合设计：所有配置通过构造函数注入，
 * 后期可直接迁移到工厂负载监控系统使用。
 */
const axios = require('axios');
const sm2 = require('sm-crypto').sm2;

// 前端硬编码的 SM2 公钥（从登录页 JS 中提取）
const SM2_PUBLIC_KEY = '04298364ec840088475eae92a591e01284d1abefcda348b47eb324bb521bb03b0b2a5bc393f6b71dabb8f15c99a0050818b56b23f31743b93df9cf8948f15ddb54';

// 日期列名的正则匹配（如 "2026-05-01"）
const DATE_COLUMN_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

class SmartMeterClient {
  /**
   * @param {object} config
   * @param {string} config.baseUrl  - API 基础地址（如 http://yjytask.joyea.cn:3000/api）
   * @param {string} config.account  - B 端登录账号
   * @param {string} config.password - B 端登录密码
   */
  constructor(config) {
    this.baseUrl = config.baseUrl;
    this.account = config.account;
    this.password = config.password;

    this._token = null;

    this._http = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /** 检查配置是否完整 */
  isConfigured() {
    return !!(this.baseUrl && this.account && this.password);
  }

  /**
   * 第一步：登录获取 token
   *
   * 密码使用 SM2 加密（与前端行为一致）
   * POST /auth/b/doLogin
   * Body: { account, password: sm2.doEncrypt(password), validCode: "", validCodeReqNo: "" }
   * 响应：{ code: 200, msg: "操作成功", data: "jwt_token_string" }
   */
  async authenticate() {
    if (!this.isConfigured()) {
      throw new Error('智能电表 API 未配置，请设置环境变量 METER_BASE_URL、METER_ACCOUNT、METER_PASSWORD');
    }

    const encryptedPwd = sm2.doEncrypt(this.password, SM2_PUBLIC_KEY, 1);

    const res = await this._http.post('/auth/b/doLogin', {
      account: this.account,
      password: encryptedPwd,
      validCode: '',
      validCodeReqNo: '',
    });

    const body = res.data;
    if (body.code !== 200) {
      throw new Error(`登录失败: ${body.msg || `code=${body.code}`}`);
    }

    this._token = body.data;
    this._setAuthHeader();
    console.log('[meter] 登录成功');
  }

  /**
   * 第二步：查询车间能耗
   *
   * POST /biz/power/workshop
   * Body: { workshop: [...], time: ["start", "end"], base?: "month" }
   * 响应：{ code: 200, msg: "操作成功", data: [...] }
   *
   * 注意：workshop 传空数组 [] 返回全部车间
   *
   * @param {object} params
   * @param {string[]} [params.workshop] - 车间名称列表，空数组=全部
   * @param {string[]} params.time       - 时间范围，如 ["2025-01-01", "2025-01-31"]
   * @param {string}   [params.base]     - 基准类型，如 "month"
   * @returns {object[]} 原始车间能耗数据列表
   */
  async fetchRawData(params = {}) {
    await this._ensureAuth();

    try {
      const res = await this._http.post('/biz/power/workshop', {
        workshop: params.workshop || [],
        time: params.time,
        base: params.base,
      });

      const body = res.data;
      if (body.code !== 200 && body.msg && body.msg.includes('token')) {
        // token 过期：清空并重登录重试一次
        console.warn('[meter] token 已过期，重新登录...');
        this.logout();
        await this._ensureAuth();
        const retryRes = await this._http.post('/biz/power/workshop', {
          workshop: params.workshop || [],
          time: params.time,
          base: params.base,
        });
        const retryBody = retryRes.data;
        if (retryBody.code !== 200) {
          throw new Error(`查询失败: ${retryBody.msg || `code=${retryBody.code}`}`);
        }
        return retryBody.data || [];
      }
      if (body.code !== 200) {
        throw new Error(`查询失败: ${body.msg || `code=${body.code}`}`);
      }

      return body.data || [];
    } catch (err) {
      throw err;
    }
  }

  /**
   * 第三步：反透视 — 将动态日期列转为固定格式行
   *
   * 输入（透视表）：
   *   [{ name: "固体一1车间", "2026-05-01": "12.0", "2026-05-02": "11.5", total: "240.5", chart: {...}, xaxis: [...] }]
   *
   * 输出（标准化）：
   *   [{ name: "固体一1车间", date: "2026-05-01", value: "12.0" },
   *    { name: "固体一1车间", date: "2026-05-02", value: "11.5" }]
   *
   * @param {object[]} rows         - 原始数据行
   * @param {string[]} [dateColumns] - 可选的日期列名列表，不传则自动按正则识别
   * @returns {object[]} 标准化行记录
   */
  unpivot(rows, dateColumns) {
    if (!Array.isArray(rows) || rows.length === 0) return [];

    // 自动识别日期列
    const dateCols = dateColumns || Object.keys(rows[0]).filter((key) => DATE_COLUMN_PATTERN.test(key));

    const result = [];

    for (const row of rows) {
      // 固定字段 = 所有字段中去掉日期列和 chart/xaxis（避免重复数据膨胀）
      const fixedFields = {};
      for (const [key, val] of Object.entries(row)) {
        if (!dateCols.includes(key) && key !== 'chart' && key !== 'xaxis' && key !== 'columns') {
          fixedFields[key] = val;
        }
      }

      // 每个日期列生成一行
      for (const dateCol of dateCols) {
        if (row[dateCol] !== undefined && row[dateCol] !== null) {
          result.push({ ...fixedFields, date: dateCol, value: row[dateCol] });
        }
      }
    }

    return result;
  }

  /**
   * 对外统一入口：查询并返回标准化数据
   *
   * @param {object}  params       - 查询参数 { workshop, time, base }
   * @param {string[]} [dateColumns] - 可选，指定日期列名
   * @returns {object[]} 标准化行记录
   */
  async queryData(params, dateColumns) {
    const rawData = await this.fetchRawData(params);
    return this.unpivot(rawData, dateColumns);
  }

  // ======== 内部方法 ========

  _ensureAuth() {
    if (!this._token) {
      return this.authenticate();
    }
  }

  /** 设置请求头 Token（自定义 Header，不是 Authorization Bearer） */
  _setAuthHeader() {
    this._http.defaults.headers.common.Token = this._token;
  }

  logout() {
    this._token = null;
    delete this._http.defaults.headers.common.Token;
  }
}

module.exports = SmartMeterClient;
