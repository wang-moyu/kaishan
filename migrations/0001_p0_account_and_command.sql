-- Migration number: 0001 	 Name: p0_account_and_command
--
-- P0 账号与命令幂等基座（对应 03 第 11 节 P0 实体）：
--   users            <- User(normalizedAccount unique, passwordHash, status)
--   sessions         <- Session(tokenHash unique, expiresAt)
--   command_receipts <- CommandReceipt(userId, scope, key unique, requestHash, response, expiresAt)
--   mutation_guards  <- MutationGuard(commandId primary key, valid not null check(valid=1))
-- 命名约定：实体名单数大写（如 CommandReceipt），表名用复数 snake_case；列名用 snake_case。
-- 时间统一为 UTC 整数毫秒（见 02 第 4 节、03 第 1 节）；不使用本地时区或浮点时间。
-- 本文件只建表与约束，不写入任何数据；种子数据见 scripts/seed/seed.sql。

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  normalized_account TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  -- P0-04 负责注册/登录语义；此处只允许明确的账号状态
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'pending')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  -- 仅存摘要与期限，不存明文 token（见 02 第 5 节）
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE command_receipts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  scope TEXT NOT NULL,
  -- 对应 04 的 Idempotency-Key；列名避开 SQL 关键字 key
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  -- 已提交命令的响应体，校验过的 JSON TEXT（见 02 第 4 节）
  response TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  UNIQUE (user_id, scope, idempotency_key)
);

CREATE INDEX command_receipts_expires_at_idx ON command_receipts (expires_at);

CREATE TABLE mutation_guards (
  command_id TEXT PRIMARY KEY,
  -- 批次首条插入 1 或 0；插 0 触发约束错误使整批回滚（见 02 第 3 节）
  valid INTEGER NOT NULL CHECK (valid = 1)
);
