-- Migration number: 0009 	 Name: v5_challenge_system
--
-- 挑战系统：
--   sects         <- 新增 defense_lineup 列（守擂阵容：3 名弟子 id 的 JSON 数组，null = 未设置）
--   challenge_log <- 挑战记录（3v3 逐对决斗；每日 1 次限次的窗口统计来源 + 演武录展示）
--
-- 说明：
--   - 旧 sparring_log 表不删、不改，新功能不再读写它（旧切磋历史不出现在新演武录中）。
--   - attacker_lineup / defender_lineup / rounds 存 JSON 快照：弟子可能后续变化或被遣散，
--     记录要能独立展示。
--   - 时间统一为 UTC 整数毫秒（见 03 第 1 节）；每日限次按 UTC+8 自然日窗口统计
--     （created_at >= 当天 00:00 的毫秒时间戳）。

-- 宗门守擂阵容：3 名弟子 id 的 JSON 数组，null 表示未设置（不可被挑战）
ALTER TABLE sects ADD COLUMN defense_lineup TEXT DEFAULT NULL;

-- 挑战记录表（替代旧 sparring_log 的展示用途，旧表保留不删）
CREATE TABLE challenge_log (
  id TEXT PRIMARY KEY,
  attacker_sect_id TEXT NOT NULL REFERENCES sects (id),
  defender_sect_id TEXT NOT NULL REFERENCES sects (id),
  -- 攻方阵容：JSON 数组 [{discipleId, name, power}]
  attacker_lineup TEXT NOT NULL,
  -- 守方阵容：JSON 数组 [{discipleId, name, power}]
  defender_lineup TEXT NOT NULL,
  -- 每轮结果：JSON 数组 [{round, attackerPower, defenderPower, winner: "attacker"|"defender"|"draw"}]
  rounds TEXT NOT NULL,
  -- 最终结果（从攻方视角）：'win' | 'lose'（3v3 不会整体平局；单轮平局算攻方负该轮）
  result TEXT NOT NULL,
  reputation_gained INTEGER NOT NULL DEFAULT 0,
  spirit_stone_gained INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX challenge_log_attacker_idx ON challenge_log (attacker_sect_id, created_at);
CREATE INDEX challenge_log_defender_idx ON challenge_log (defender_sect_id, created_at);
