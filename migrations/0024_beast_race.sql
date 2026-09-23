-- Migration number: 0024 	Name: beast_race
--
-- 灵兽竞逐（docs/灵兽竞逐开发计划.md）：替换即时赛马，改为 10 分钟一轮的全服公共投注池。
--   race_rounds <- 新表：每轮竞逐的元信息（权重、状态、冠军、总池）
--   race_bets   <- 新表：每笔投注（sect_id + beast_index + amount）

CREATE TABLE race_rounds (
  id TEXT PRIMARY KEY,
  -- UTC+8 对齐的 10 分钟轮次标识，如 "2026-09-23T08:00"
  round_key TEXT NOT NULL UNIQUE,
  -- 5 只灵兽的权重 JSON，如 [3,2,5,1,4]
  beast_weights TEXT NOT NULL,
  -- 'betting' | 'settled'
  status TEXT NOT NULL DEFAULT 'betting',
  -- 冠军灵兽下标（0~4），结算后填入
  winner_index INTEGER,
  -- 所有投注的总和（最小单位）
  total_pool INTEGER NOT NULL DEFAULT 0,
  -- 结算时间戳
  settled_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE race_bets (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES race_rounds (id),
  sect_id TEXT NOT NULL REFERENCES sects (id),
  beast_index INTEGER NOT NULL CHECK (beast_index >= 0 AND beast_index <= 4),
  amount INTEGER NOT NULL CHECK (amount > 0),
  created_at INTEGER NOT NULL
);

CREATE INDEX race_bets_round_idx ON race_bets (round_id, beast_index);
CREATE INDEX race_bets_sect_idx ON race_bets (sect_id, created_at DESC);
