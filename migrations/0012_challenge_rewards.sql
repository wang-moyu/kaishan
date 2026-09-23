-- Migration number: 0012 	 Name: challenge_rewards
--
-- 宗门挑战优化（每日 3 次 + 等级差奖励 + 自动守擂）：
--   sects         <- challenge_date_key（UTC+8 日期键）+ challenge_count（当日已受理场次）
--   challenge_log <- 5 个可空快照列（双方等级 / 奖励档位 / 守擂方式 / 日期键）+ 唯一部分索引
--
-- 说明：
--   - 不回改 0009；旧 challenge_log 行的新快照列为 NULL，仍可读取（演武录兼容展示）。
--   - 每日限次的并发保护：batch 首条 mutation_guards 快照语句校验攻方 sects 行
--     （等级/声望/结算时间/挑战日期键/计数）与资源余额仍与读取快照一致（见 repository.ts），
--     唯一部分索引从数据库层保证同一攻方同一天不能重复挑战同一目标。
--   - challenge_date_key DEFAULT ''：迁移前的旧宗门视为「尚无当日计数」，配合
--     challenge_log.created_at 的日窗口查询做发布当天兼容核对（见计划 4.2）。
--   - challenge_date_key 的唯一索引是部分索引（仅约束新记录），旧记录（NULL）不参与唯一性。

-- UTC+8 日期键（'YYYY-MM-DD'）；'' = 尚未以新口径计数（迁移前宗门）
ALTER TABLE sects ADD COLUMN challenge_date_key TEXT NOT NULL DEFAULT '';

-- 对应日期键内已受理的挑战场次（受理 = 整个 batch 成功）；CHECK 防负数
ALTER TABLE sects ADD COLUMN challenge_count INTEGER NOT NULL DEFAULT 0
  CHECK (challenge_count >= 0);

-- 开战时攻方宗门等级（奖励以开战快照为准，不从之后状态反推）
ALTER TABLE challenge_log ADD COLUMN attacker_level INTEGER;

-- 开战时守方宗门等级
ALTER TABLE challenge_log ADD COLUMN defender_level INTEGER;

-- 开战时匹配到的奖励档位（challenge.ts 的 RewardTier 稳定标识，写入后不改名）
ALTER TABLE challenge_log ADD COLUMN reward_tier TEXT;

-- 守擂方式：'configured'（有效手动阵容）或 'automatic'（临时自动守擂）
ALTER TABLE challenge_log ADD COLUMN defense_mode TEXT;

-- 本场对应的 UTC+8 日期键；NULL = 0012 迁移前的旧记录
ALTER TABLE challenge_log ADD COLUMN challenge_date_key TEXT;

-- 同一攻方同一天最多挑战同一目标 1 次（仅约束新记录；旧记录 NULL 不参与唯一性）
CREATE UNIQUE INDEX challenge_log_unique_day_target_idx
  ON challenge_log (attacker_sect_id, defender_sect_id, challenge_date_key)
  WHERE challenge_date_key IS NOT NULL;

-- 当日限次/兼容核对的窗口查询走这条索引（attacker + 日期键）
CREATE INDEX challenge_log_attacker_day_idx
  ON challenge_log (attacker_sect_id, challenge_date_key);
