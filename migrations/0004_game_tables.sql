-- Migration number: 0004 	 Name: p0_game_tables
--
-- 当前可玩版本的核心游戏表：
--   sects             <- 宗门（每个用户一个）
--   disciples         <- 弟子（境界/阶段/修为/岗位）
--   buildings         <- 宗门建筑（每类型一座，等级升级）
--   resource_balances <- 资源余额（最小单位整数 + 小时余数）
--
-- 说明（与任务卡的唯一偏差，已在验证记录里说明）：
--   招募的「每日次数」需要落库，但任务卡的表结构里没有计数器表。
--   这里直接在 sects 上加 recruit_date_key / recruit_count 两列（按 UTC+8 自然日重置），
--   避免新增一张只为计数的表。
--
-- 本版本不做幂等键、版本号、事务守卫：写操作就是「读状态 → 算结果 → 写回去」。
-- 时间统一为 UTC 整数毫秒（见 03 第 1 节）。

CREATE TABLE sects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users (id),
  name TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  vein_level INTEGER NOT NULL DEFAULT 1,
  last_settled_at INTEGER NOT NULL,
  -- 招募每日次数（UTC+8 自然日）
  recruit_date_key TEXT NOT NULL DEFAULT '',
  recruit_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE disciples (
  id TEXT PRIMARY KEY,
  sect_id TEXT NOT NULL REFERENCES sects (id),
  name TEXT NOT NULL,
  gender TEXT NOT NULL DEFAULT 'male',
  aptitude INTEGER NOT NULL,
  realm_id TEXT NOT NULL DEFAULT 'qiRefining',
  stage INTEGER NOT NULL DEFAULT 1,
  cultivation INTEGER NOT NULL DEFAULT 0,
  cultivation_remainder INTEGER NOT NULL DEFAULT 0,
  assignment TEXT NOT NULL DEFAULT 'idle',
  injured_until INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX disciples_sect_id_idx ON disciples (sect_id);

CREATE TABLE buildings (
  id TEXT PRIMARY KEY,
  sect_id TEXT NOT NULL REFERENCES sects (id),
  def_id TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  UNIQUE (sect_id, def_id)
);

CREATE TABLE resource_balances (
  id TEXT PRIMARY KEY,
  sect_id TEXT NOT NULL REFERENCES sects (id),
  resource_id TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0,
  remainder INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  UNIQUE (sect_id, resource_id)
);
