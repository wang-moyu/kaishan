-- Migration number: 0020 	 Name: wheel_seed
--
-- 天机轮（docs/天机轮开发计划.md）：赌坊的第二个玩法 —— 花灵石转一次，落到哪格得什么奖。
--   sects          <- wheel_seed（转盘格局种子；每次重置 +1）
--   dao_debate_log <- 重建：multiplier 的 CHECK 从 1~3 放宽到 1~5（投入档位 1x~5x）
--
-- sects 为什么只加列：
--   - 转盘格局**不落库**：格局完全由 sect_id + wheel_seed 确定性生成
--     （见 gambling.ts 的 wheelLayoutSeed / generateWheelSlots），所以库里只需要一个「重置计数器」。
--     sync 不会让格局变化，只有重置（wheel_seed + 1）才变，与计划 3.1 一致。
--   - NOT NULL DEFAULT 0：旧宗门自动获得 seed 0（第一版格局），不需要回填 UPDATE。
--   - CHECK (wheel_seed >= 0)：重置只做 +1，负值一定是代码 bug，让它在写库时就失败。
--
-- dao_debate_log 为什么必须重建：
--   - 计划 3.2 复用这张表存天机轮记录（bet_mode = 'wheel'），但计划 2.3 的投入档位是 1~5，
--     而 0019 建表时 multiplier 带 CHECK (multiplier >= 1 AND multiplier <= 3)（那是论道的三档倍率）。
--     4x / 5x 的转动会被 CHECK 直接打回（表现为 500），所以上限必须放宽到 5。
--   - SQLite 不能就地改 CHECK，只能建同构新表 + 搬数 —— 与 0018 重建 disciples 同一套路。
--   - 语句顺序刻意排成「先改名成备份 → 建新表 → 搬数 → 最后 DROP」：
--     任何一步失败，原始数据都还在（在 dao_debate_log 或 dao_debate_log_0020_old 里），
--     最坏情况是多留一张要人工改名的备份表，而不是数据丢失。
--     反过来（先建新表、DROP 旧表、再 RENAME）会在 DROP 与 RENAME 之间失败时留下
--     「dao_debate_log 不存在、数据在临时表里」的坏状态，所以不采用。
--   - 索引 dao_debate_log_sect_idx 跟着旧表一起被改名占用，所以必须在 DROP 之后重建，
--     否则会撞「index dao_debate_log_sect_idx already exists」。
--   - 结构与数据等价性：列名、列顺序、类型、NOT NULL、外键、索引列与排序全部原样保留，
--     唯一的差别是 multiplier 的 CHECK 上限 3 → 5。INSERT ... SELECT 逐列搬运，
--     不做任何 UPDATE、不重算历史记录（旧记录都是 1~3，天然满足新 CHECK）。
--   - 没有其它表用 FOREIGN KEY 指向 dao_debate_log，改名前后的 DROP 不会级联删行；
--     dao_debate_log.sect_id REFERENCES sects (id) 这条出向外键照旧保留。
--   - 重跑注意：本文件必须整份成功。若上一次执行失败并留下了 dao_debate_log_0020_old，
--     说明失败点在重命名之后，而 wheel_seed 那一列（本文件第 1 条语句）也已经加过了 ——
--     直接重跑会先报「duplicate column name: wheel_seed」，而不是备份表冲突。
--     恢复步骤（人工）：① 确认 dao_debate_log 或备份表里的数据完整；
--     ② 手工删掉 dao_debate_log_0020_old；③ 回到本文件第 2 条语句起手工执行
--     （CREATE TABLE + INSERT ... SELECT + DROP + CREATE INDEX）。
--     注意不能靠 ALTER TABLE sects DROP COLUMN wheel_seed 回退：该列带 CHECK (wheel_seed >= 0)，
--     SQLite 不允许删掉被 CHECK 引用的列，要回退只能重建 sects —— 代价远大于手工跑完剩下三步。
--   - 远程 D1 没有自动备份（CI 是无值守 apply），正式执行前建议先 `wrangler d1 export`。
--
-- 天机轮记录的列口径（不改结构，用约定表达；计划 3.2）：
--   bet_mode       = 'wheel'
--   multiplier     = 投入档位 1~5
--   disciple_id    = ''       （转盘没有出战弟子；两列仍是 0019 的 NOT NULL）
--   disciple_name  = '天机轮' （赌坊记录列表直接渲染这一列，不必为转盘单开分支）
--   stake_detail   = { "amount": "<最小单位投入>" }
--   result         = 'win' | 'lose'（谢谢惠顾 = lose）
--   reward_detail  = { type:'resource', resourceId, amount }
--                  | { type:'pill', pillId, quantity }
--                  | { type:'none' }
--   win_probability= NULL（转盘不用 jev，无胜率概念）

-- 转盘格局种子：sync 用它生成格局，重置时 +1（格局随 seed 变化）
ALTER TABLE sects ADD COLUMN wheel_seed INTEGER NOT NULL DEFAULT 0
  CHECK (wheel_seed >= 0);

ALTER TABLE dao_debate_log RENAME TO dao_debate_log_0020_old;

CREATE TABLE dao_debate_log (
  id TEXT PRIMARY KEY,
  sect_id TEXT NOT NULL REFERENCES sects (id),
  disciple_id TEXT NOT NULL,
  disciple_name TEXT NOT NULL,
  -- 'preset_spirit_stone' | 'free_resource' | 'attribute' | 'wheel'
  bet_mode TEXT NOT NULL,
  -- 论道是赌注倍率 1~3；天机轮是投入档位 1~5
  multiplier INTEGER NOT NULL CHECK (multiplier >= 1 AND multiplier <= 5),
  -- 赌注详情 JSON：{ resourceId, amount } 或 { attribute, points } 或天机轮的 { amount }
  stake_detail TEXT NOT NULL,
  -- 'win' | 'lose'
  result TEXT NOT NULL,
  -- 奖励详情 JSON：{ type: 'resource'|'insight'|'pill'|'none', ... }
  reward_detail TEXT NOT NULL,
  -- jev 返回的原始胜率（0~1 小数）；降级与天机轮为 NULL
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
FROM dao_debate_log_0020_old;

DROP TABLE dao_debate_log_0020_old;

CREATE INDEX dao_debate_log_sect_idx ON dao_debate_log (sect_id, created_at DESC);
