-- Migration number: 0007 	 Name: v3_multiplayer
--
-- 多人互动：
--   sects        <- 新增 reputation 列（声望，排行榜排序与展示用；初始 0）
--   sparring_log <- 切磋记录（每日总限 5 次 + 同目标 1 次的窗口统计来源）
--
-- 说明：
--   - 声望只由切磋胜利 +10 写入（失败/平局不变），DEFAULT 0 让已有宗门自动获得该列。
--   - attacker_disciple_id / defender_disciple_id 不建外键：弟子可能后续被遣散（本版本暂不支持），
--     记录只做历史留痕，不依赖弟子行仍然存在。
--   - result：'win' | 'lose' | 'draw'（从攻方视角）。
--   - 时间统一为 UTC 整数毫秒（见 03 第 1 节）；每日限次按 UTC+8 自然日窗口统计
--     （created_at >= 当天 00:00 的毫秒时间戳）。

ALTER TABLE sects ADD COLUMN reputation INTEGER NOT NULL DEFAULT 0;

CREATE TABLE sparring_log (
  id TEXT PRIMARY KEY,
  attacker_sect_id TEXT NOT NULL REFERENCES sects (id),
  defender_sect_id TEXT NOT NULL REFERENCES sects (id),
  attacker_disciple_id TEXT NOT NULL,
  defender_disciple_id TEXT NOT NULL,
  attacker_power INTEGER NOT NULL,
  defender_power INTEGER NOT NULL,
  result TEXT NOT NULL,  -- 'win' | 'lose' | 'draw'
  reputation_gained INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX sparring_log_attacker_idx ON sparring_log (attacker_sect_id, created_at);
CREATE INDEX sparring_log_defender_idx ON sparring_log (defender_sect_id, created_at);
