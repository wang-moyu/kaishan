-- Migration number: 0006 	 Name: v2_2_explorations
--
-- 秘境探索：
--   explorations <- 探索记录（成功/失败与本次实际发放的奖励，供每日限次统计）
--
-- 说明：
--   - 秘境定义（难度/消耗/奖励/人数/每日限次）硬编码在代码里（modules/game/realms.ts），
--     表里只存 realm_id，不建外键（定义是代码数据，不是表数据）。
--   - party 存 JSON 数组（["discipleId1", ...]）。
--   - success：0=失败，1=成功。
--   - rewards 存 JSON（resourceId -> 最小单位数量字符串），失败时为空对象。
--   - 时间统一为 UTC 整数毫秒（见 03 第 1 节）；每日限次按 UTC+8 自然日窗口统计
--     （created_at >= 当天 00:00 的毫秒时间戳）。

CREATE TABLE explorations (
  id TEXT PRIMARY KEY,
  sect_id TEXT NOT NULL REFERENCES sects (id),
  realm_id TEXT NOT NULL,
  party TEXT NOT NULL DEFAULT '[]',
  success INTEGER NOT NULL DEFAULT 0,
  rewards TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX explorations_sect_idx ON explorations (sect_id, created_at DESC);
