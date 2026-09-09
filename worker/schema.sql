-- 健康日志 · D1 表结构
-- 应用：wrangler d1 execute health-log --file=worker/schema.sql --remote

-- 主数据：整份 JSON 存在一行里（和本地版 health.json 结构完全一致）
CREATE TABLE IF NOT EXISTS docs (
  id         TEXT    PRIMARY KEY,
  rev        INTEGER NOT NULL DEFAULT 0,   -- 乐观锁版本号，每次写入 +1
  data       TEXT    NOT NULL,             -- 整份 JSON
  updated_at INTEGER NOT NULL              -- 毫秒时间戳
);

-- 快照：每次写入留一份，保留最近 30 份（替代本地版的 data/backups/）
CREATE TABLE IF NOT EXISTS snapshots (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  rev        INTEGER NOT NULL,
  data       TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);

-- 服务端配置（目前只存 DeepSeek API Key；也可用 DEEPSEEK_API_KEY secret）
CREATE TABLE IF NOT EXISTS config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 登录失败记录（按 IP 限流，防暴力破解）
CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT    NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_ts ON login_attempts (ip, ts);
