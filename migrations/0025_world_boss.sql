-- Migration number: 0025 	Name: world_boss
--
-- 世界 Boss（讨伐）（docs/世界Boss开发计划.md）：全服合作打同一只 Boss，异步进行。
--   world_bosses     <- 新表：当天 Boss 的本体（等级、血量、状态、最后一击、发奖时间）
--   world_boss_hits  <- 新表：每宗每次出手的伤害记录（榜单与记录都用它，不 JOIN sects）

CREATE TABLE world_bosses (
  id TEXT PRIMARY KEY,
  -- UTC+8 日期 'YYYY-MM-DD'；一天一只，UNIQUE 兜住 Cron 并发的重复创建
  day_key TEXT NOT NULL UNIQUE,
  -- 五只轮换 Boss 的下标（0~4）
  boss_index INTEGER NOT NULL,
  -- 1~5，由前一天的战果升降
  level INTEGER NOT NULL,
  max_hp INTEGER NOT NULL,
  hp INTEGER NOT NULL,
  -- 'active' | 'killed' | 'fled'
  status TEXT NOT NULL DEFAULT 'active',
  -- 最后一击的宗门（击杀时填入）
  killer_sect_id TEXT,
  -- 是否已广播过「血量不足一半」（0/1）
  half_announced INTEGER NOT NULL DEFAULT 0,
  -- 奖励发放完成时间；NULL = 尚未发放
  rewarded_at INTEGER,
  created_at INTEGER NOT NULL,
  ended_at INTEGER
);

CREATE TABLE world_boss_hits (
  id TEXT PRIMARY KEY,
  boss_id TEXT NOT NULL REFERENCES world_bosses (id),
  sect_id TEXT NOT NULL,
  -- 冗余存宗门名，榜单与出手记录不用再 JOIN
  sect_name TEXT NOT NULL,
  -- 1~3，本宗门今天第几次出手
  attempt_no INTEGER NOT NULL,
  -- 出战弟子名（JSON 数组）
  disciple_names TEXT NOT NULL,
  -- 实际扣血
  damage INTEGER NOT NULL,
  is_crit INTEGER NOT NULL DEFAULT 0,
  is_last_hit INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  -- 同一宗门对同一只 Boss 的同一次出手只能有一行：并发重复提交由它兜住
  UNIQUE (boss_id, sect_id, attempt_no)
);

CREATE INDEX world_boss_hits_boss_idx ON world_boss_hits (boss_id, created_at DESC);
CREATE INDEX world_boss_hits_damage_idx ON world_boss_hits (damage DESC);
