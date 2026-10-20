/**
 * 登录会话存储（钉钉身份登录用）
 *
 * ⚠️ **必须落库，不能用内存 Map**：`deploy.sh` 每次部署都会 `pm2 restart`，
 * 内存会话会让所有人每次部署后被踢下线。30 天的会话存进 SQLite 才能扛住重启。
 * （OAuth2 的 state 用内存 Map 是可以的，那是秒级生命周期的东西，见 routes/auth.js。）
 *
 * 库文件在 `server/data/sessions.db` —— `deploy.sh` 只上传 `server/src`，
 * 不碰 `server/data/`，所以会话能跨部署存活。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const config = require('../config');

/** 多久才刷一次 last_seen_at（每次请求都写库没必要，这是同步 IO） */
const TOUCH_INTERVAL_MS = 3600 * 1000;

class SessionStore {
  constructor({ dbPath } = {}) {
    this.dbPath = dbPath || config.auth.dbPath;
    this.db = null;
  }

  initialize() {
    if (this.db) return this;
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        token        TEXT PRIMARY KEY,
        kind         TEXT NOT NULL DEFAULT 'dingtalk',  -- dingtalk | internal
        union_id     TEXT DEFAULT '',
        nick         TEXT DEFAULT '',
        mobile       TEXT DEFAULT '',
        ip           TEXT DEFAULT '',
        user_agent   TEXT DEFAULT '',
        created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        last_seen_at TEXT,
        expires_at   TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

      CREATE TABLE IF NOT EXISTS login_events (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        at         TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        event      TEXT NOT NULL,                       -- login | logout | expired_state | denied
        kind       TEXT DEFAULT '',
        union_id   TEXT DEFAULT '',
        nick       TEXT DEFAULT '',
        ip         TEXT DEFAULT '',
        user_agent TEXT DEFAULT '',
        detail     TEXT DEFAULT ''
      );
    `);
    return this;
  }

  /**
   * 建会话，返回 token（32 字节随机 hex —— 不引 JWT，不透明串更简单）
   * @param {{kind?: string, unionId?: string, nick?: string, mobile?: string,
   *          ip?: string, ua?: string, days?: number}} opts
   */
  createSession({ kind = 'dingtalk', unionId = '', nick = '', mobile = '', ip = '', ua = '', days } = {}) {
    this.initialize();
    const token = crypto.randomBytes(32).toString('hex');
    const n = Number(days) > 0 ? Number(days) : config.auth.sessionDays;
    this.db.prepare(
      `INSERT INTO sessions (token, kind, union_id, nick, mobile, ip, user_agent, last_seen_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), datetime('now','localtime', ?))`,
    ).run(token, kind, unionId, nick, mobile, ip, String(ua).slice(0, 300), `+${n} days`);
    return token;
  }

  /** 取会话；过期或不存在返回 null。顺手按小时粒度刷 last_seen_at。 */
  getSession(token) {
    if (!token) return null;
    this.initialize();
    const row = this.db.prepare(
      `SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now','localtime')`,
    ).get(token);
    if (!row) return null;
    const last = row.last_seen_at ? new Date(`${row.last_seen_at.replace(' ', 'T')}+08:00`).getTime() : 0;
    if (!last || Date.now() - last > TOUCH_INTERVAL_MS) {
      this.db.prepare("UPDATE sessions SET last_seen_at = datetime('now','localtime') WHERE token = ?").run(token);
    }
    return {
      token: row.token,
      kind: row.kind,
      unionId: row.union_id || '',
      nick: row.nick || '',
      mobile: row.mobile || '',
      loginAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  deleteSession(token) {
    if (!token) return 0;
    this.initialize();
    return this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token).changes;
  }

  /** 清理过期会话（定时任务调用） */
  purgeExpired() {
    this.initialize();
    const n = this.db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now','localtime')").run().changes;
    if (n) console.log(`[auth] 清理过期会话 ${n} 条`);
    return n;
  }

  logEvent({ event, kind = '', unionId = '', nick = '', ip = '', ua = '', detail = '' }) {
    this.initialize();
    try {
      this.db.prepare(
        `INSERT INTO login_events (event, kind, union_id, nick, ip, user_agent, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(event, kind, unionId, nick, ip, String(ua).slice(0, 300), String(detail).slice(0, 500));
    } catch (e) {
      console.warn('[auth] 写登录日志失败:', e.message);
    }
  }

  close() {
    if (this.db) { this.db.close(); this.db = null; }
  }
}

module.exports = new SessionStore();
