-- Migration number: 0010 	 Name: recruit_refresh
--
-- 招贤台刷新（每提升一个宗门境界可刷新 3 次候选人；升级即重置，未用次数不累积）：
--   sects <- 新增 recruit_refresh_level 列（上次授予刷新额度的宗门等级）
--            recruit_refresh_used  列（该等级已用的刷新次数）
--
-- 说明：
--   - 额度常量 RECRUIT_REFRESH_PER_LEVEL 定义在
--     apps/server/src/modules/game/constants.ts，不进配置表。
--   - 归一化在读取与写入时共用一套：`Number(sect.level) !== Number(sect.recruit_refresh_level)`
--     即视为「已用 0 次」，当前等级就是新的授予等级（升级重置、不累积）。
--   - 刷新免费：不消耗资源，也不消耗每日招募次数（recruit_count 与刷新计数相互独立）。
--   - 两列都是整数、非空，DEFAULT 让已有宗门行自动获得初始额度（1 级授予 3 次、已用 0 次）。

-- 上次授予刷新额度的宗门等级（与 sects.level 不一致时按「已用 0 次」归一化）
ALTER TABLE sects ADD COLUMN recruit_refresh_level INTEGER NOT NULL DEFAULT 1;

-- 该（授予）等级已用的刷新次数
ALTER TABLE sects ADD COLUMN recruit_refresh_used INTEGER NOT NULL DEFAULT 0;
