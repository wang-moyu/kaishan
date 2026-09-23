-- Migration number: 0019 	 Name: gambling_house
--
-- 赌坊系统（论道赌局，docs/赌坊开发计划.md 第 5 节）：
--   sects     <- debate_date_key（UTC+8 日期键）+ debate_count（当日已论道次数）
--   disciples <- dao_insight（可用悟道值）+ dao_insight_used（累计已分配悟道值）
--   dao_debate_log <- 每次论道的记录（赌注模式 / 倍率 / 赌注明细 / 结果 / 奖励 / 胜率）
--
-- 说明：
--   - 不回改既有表结构与数据：两个 ALTER 只加列（NOT NULL + DEFAULT），旧宗门自动获得
--     空日期键与 0 计数，视为「今日尚未论道」；悟道值一律从 0 开始（旧弟子不补发）。
--   - 每日限次（10 次）的并发保护与挑战系统同一模式：batch 首条 mutation_guards 快照
--     语句校验 sects 行的 debate_date_key / debate_count 仍与读取快照一致（见 repository.ts）。
--   - dao_insight / dao_insight_used 的 CHECK 与 gambling.ts 的 DAO_INSIGHT_CAP 同口径；
--     dao_insight 非负，dao_insight_used 累计不超过 50（每个弟子的悟道值分配上限）。
--   - 属性赌注输了会把属性扣到 0（允许）：本迁移不为属性列加新 CHECK（也不动既有 CHECK）。
--     注意 luck / physique 在 0016（0018 重建时原样保留）就带 CHECK (1..100)，这两项
--     由服务端保留最低 1 点（service.ts 的 attributeFloorOf），不会被扣到 0。
--   - bet_mode / result 只做内容约定，不加 CHECK：游标格式变化不值得让整批写入失败。
--   - win_probability 存 jev 返回的原始胜率（0~1 小数）；降级判定时为 NULL。

-- UTC+8 日期键（'YYYY-MM-DD'）；'' = 尚未以本口径计数（迁移前宗门）
ALTER TABLE sects ADD COLUMN debate_date_key TEXT NOT NULL DEFAULT '';

-- 对应日期键内已受理的论道次数（受理 = 整个 batch 成功）；CHECK 防负数
ALTER TABLE sects ADD COLUMN debate_count INTEGER NOT NULL DEFAULT 0
  CHECK (debate_count >= 0);

-- 弟子当前可用悟道值余额（只能通过赌坊获得；加点到属性时扣除）
ALTER TABLE disciples ADD COLUMN dao_insight INTEGER NOT NULL DEFAULT 0
  CHECK (dao_insight >= 0);

-- 该弟子累计已分配的悟道值（上限 DAO_INSIGHT_CAP = 50）
ALTER TABLE disciples ADD COLUMN dao_insight_used INTEGER NOT NULL DEFAULT 0
  CHECK (dao_insight_used >= 0 AND dao_insight_used <= 50);

CREATE TABLE dao_debate_log (
  id TEXT PRIMARY KEY,
  sect_id TEXT NOT NULL REFERENCES sects (id),
  disciple_id TEXT NOT NULL,
  disciple_name TEXT NOT NULL,
  -- 'preset_spirit_stone' | 'free_resource' | 'attribute'
  bet_mode TEXT NOT NULL,
  multiplier INTEGER NOT NULL CHECK (multiplier >= 1 AND multiplier <= 3),
  -- 赌注详情 JSON：{ resourceId, amount } 或 { attribute, points }
  stake_detail TEXT NOT NULL,
  -- 'win' | 'lose'
  result TEXT NOT NULL,
  -- 奖励详情 JSON：{ type: 'resource'|'insight', resourceId?, amount?, insight? }
  reward_detail TEXT NOT NULL,
  -- jev 返回的原始胜率（0~1 小数）；降级时为 NULL
  win_probability REAL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (sect_id) REFERENCES sects (id)
);

CREATE INDEX dao_debate_log_sect_idx ON dao_debate_log (sect_id, created_at DESC);
