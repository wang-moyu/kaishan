-- Migration number: 0023 	Name: horse_race
--
-- 赛马（docs/赛马开发计划.md）：赌坊的第三个玩法 —— 5 匹马、赔率浮动、只赌冠军。
--   dao_debate_log <- 重建：multiplier 的 CHECK 从 1~5 放宽到 1~999
--
-- 为什么不加新表：
--   - 赛马记录复用 dao_debate_log（与天机轮同一模式）：bet_mode = 'horse_race'、
--     disciple_id = ''、disciple_name = '赛马'，赌坊记录列表直接渲染，不必为新玩法开一张表；
--   - 赛马把「选中马的赔率 × 10」存进 multiplier（该列是 INTEGER，赔率是一位小数）：
--     热门 1.2x → 12、冷门 13.5x → 135，而 0020 的 CHECK 上限是 5，所以必须放宽。
--     上限取 999：权重 1~5、5 匹马时最低胜率 = 1/21 ≈ 0.048，赔率 ≈ 18.9 → ×10 = 189，999 有充足余量。
--
-- 为什么重建：SQLite 不能就地改 CHECK，只能建同构新表 + 搬数 —— 与 0018 重建 disciples、
--   0020 重建本表同一套路，语句顺序同样是「先改名成备份 → 建新表 → 搬数 → 最后 DROP → 重建索引」：
--   - 任何一步失败，原始数据都还在（在 dao_debate_log 或 dao_debate_log_0023_old 里），
--     最坏情况是多留一张需要人工改名的备份表，而不是数据丢失；
--   - 反向顺序（先建新表、DROP 旧表、再 RENAME）会在 DROP 与 RENAME 之间失败时留下
--     「dao_debate_log 不存在、数据在临时表里」的坏状态，所以不采用；
--   - 索引 dao_debate_log_sect_idx 跟着旧表一起被改名占用，必须在 DROP 之后重建，
--     否则会撞「index dao_debate_log_sect_idx already exists」；
--   - 结构与数据等价性：列名、列顺序、类型、NOT NULL、外键、索引列与排序全部原样保留，
--     唯一的差别是 multiplier 的 CHECK 上限 5 → 999。INSERT ... SELECT 逐列搬运，
--     不做任何 UPDATE、不重算历史记录（旧记录都是 1~5，天然满足新 CHECK）；
--   - 没有其它表用 FOREIGN KEY 指向 dao_debate_log，改名与 DROP 不会级联删行。
--
-- 重跑注意：本文件必须整份成功。若上一次失败并留下了 dao_debate_log_0023_old，
--   说明失败点在重命名之后，恢复步骤（人工）：① 确认 dao_debate_log 或备份表里的数据完整；
--   ② 手工删掉 dao_debate_log_0023_old；③ 从本文件第 2 条语句起手工执行
--   （CREATE TABLE + INSERT ... SELECT + DROP + CREATE INDEX）。
--   远程 D1 没有自动备份（CI 是无值守 apply），正式执行前建议先 `wrangler d1 export`。
--
-- 赛马记录的列口径（不改结构，用约定表达；计划第 3 节）：
--   bet_mode       = 'horse_race'
--   multiplier     = 选中马的赔率 × 10 取整（3.2x → 32）
--   disciple_id    = ''      （赛马没有出战弟子，两列仍是 0019 的 NOT NULL）
--   disciple_name  = '赛马'  （与天机轮写 '天机轮' 同一模式）
--   stake_detail   = { "amount": "<最小单位赌注>", "horseIndex": 0~4, "horseName": "赤兔", "odds": 3.2 }
--   result         = 'win' | 'lose'
--   reward_detail  = { "type": "resource", "resourceId": "spiritStone", "amount": "<最小单位>" }
--                  | { "type": "none" }
--   win_probability= 选中马的胜率（0~1 小数；赛马不用 jev，但胜率是本地权重算出来的）

ALTER TABLE dao_debate_log RENAME TO dao_debate_log_0023_old;

CREATE TABLE dao_debate_log (
  id TEXT PRIMARY KEY,
  sect_id TEXT NOT NULL REFERENCES sects (id),
  disciple_id TEXT NOT NULL,
  disciple_name TEXT NOT NULL,
  -- 'preset_spirit_stone' | 'free_resource' | 'attribute' | 'wheel' | 'horse_race'
  bet_mode TEXT NOT NULL,
  -- 论道是赌注倍率 1~3；天机轮是投入档位 1~5；赛马是选中马的赔率 × 10（最高约 189）
  multiplier INTEGER NOT NULL CHECK (multiplier >= 1 AND multiplier <= 999),
  -- 赌注详情 JSON：{ resourceId, amount } / { attribute, points } / 天机轮 { amount } / 赛马 { amount, horseIndex, horseName, odds }
  stake_detail TEXT NOT NULL,
  -- 'win' | 'lose'
  result TEXT NOT NULL,
  -- 奖励详情 JSON：{ type: 'resource'|'insight'|'pill'|'none', ... }
  reward_detail TEXT NOT NULL,
  -- jev 返回的原始胜率（0~1 小数）；降级、天机轮为 NULL，赛马写选中马的本地胜率
  win_probability REAL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (sect_id) REFERENCES sects (id)
);

INSERT INTO dao_debate_log (
  id, sect_id, disciple_id, disciple_name, bet_mode, multiplier,
  stake_detail, result, reward_detail, win_probability, created_at
)
SELECT
  id, sect_id, disciple_id, disciple_name, bet_mode, multiplier,
  stake_detail, result, reward_detail, win_probability, created_at
FROM dao_debate_log_0023_old;

DROP TABLE dao_debate_log_0023_old;

CREATE INDEX dao_debate_log_sect_idx ON dao_debate_log (sect_id, created_at DESC);
