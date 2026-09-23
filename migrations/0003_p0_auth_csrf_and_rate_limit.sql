-- Migration number: 0003 	 Name: p0_auth_csrf_and_rate_limit
--
-- P0-04 鉴权基座：
--   1. sessions 增加 csrf_token_hash：会话级 CSRF token 只存摘要（双提交/自定义头校验，见 02 第 5 节）；
--   2. auth_rate_limits：跨 Worker 实例的限频计数（D1 原子 upsert，不用内存 Map）。
--
-- 说明：
-- - sessions.csrf_token_hash 用 DEFAULT '' 以便已有行也能迁移；空串永远不可能匹配真实 token，
--   相当于历史会话无法通过 CSRF 校验（安全侧默认拒绝）。
-- - 限频计数按固定窗口：bucket 形如 'login:account:<sha256>' / 'login:ip:<sha256>'，
--   expires_at 供后续清理任务使用（清理任务属 P0-05/P0-07，本迁移只建表与索引）。

ALTER TABLE sessions ADD COLUMN csrf_token_hash TEXT NOT NULL DEFAULT '';

CREATE INDEX sessions_user_id_revoked_idx ON sessions (user_id, revoked_at);

CREATE TABLE auth_rate_limits (
  bucket TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL CHECK (count >= 0),
  expires_at INTEGER NOT NULL
);

CREATE INDEX auth_rate_limits_expires_at_idx ON auth_rate_limits (expires_at);
