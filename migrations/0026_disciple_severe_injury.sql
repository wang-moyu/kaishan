-- Migration number: 0026 	Name: disciple_severe_injury
--
-- 世界 Boss 二期 · 阶段一：新弟子状态「重伤」（docs/世界Boss二期开发计划.md 1.2）。
--   disciples.severe_injured_until <- 新列：重伤到期时间（UTC 毫秒）；NULL = 未重伤。
--   重伤持续 3 天（constants.ts 的 SEVERE_INJURY_MS），期间不产出、不修炼，
--   且不能转岗 / 突破 / 服丹 / 历练 / 秘境 / 挑战 / 论道 / 讨伐；守擂自动按空位处理。

ALTER TABLE disciples ADD COLUMN severe_injured_until INTEGER;
