-- Migration number: 0027 	Name: world_boss_v2
--
-- 世界 Boss 二期（docs/世界Boss二期开发计划.md 2.10）：连战 + 随机词缀 + 疲劳/受伤/重伤。
--   world_bosses        <- 重建：去掉「阶」等级，改为 stage（第几关）+ affix（词缀）+ round_damage
--                          UNIQUE (day_key, stage)：一天可以有多个关卡
--   world_boss_hits      <- 重建：去掉 attempt_no / 唯一约束（二期不限出手次数），
--                          新增 disciple_ids / injured_names / severe_names（JSON）
--   disciple_boss_battles <- 新表：每名出战弟子每次写一行，用来算「最近 60 分钟疲劳次数」
--
-- 为什么重建表：SQLite 不能删除已有的 UNIQUE 约束，只能建同构新表 + 搬运数据
-- （参考 0018_disciple_avatar_frame_extend.sql 的写法与语句顺序：先改名备份、最后才删）。
--
-- 语句顺序是刻意排的（先改名备份，最后才删），任何一步失败原始数据都还在：
--     1. 两张旧表整体改名成 *_0027_old（正式表名空出来）
--     2. 建新结构（占用正式表名）
--     3. INSERT ... SELECT 搬数据
--     4. 到这里才 DROP 旧表
--     5. 最后才重建索引：旧索引跟着改名的表一起占用着旧名字，
--        提前建会撞「index world_boss_hits_boss_idx already exists」。
--
-- 旧数据的处理（一期已上线，线上会有历史行）：
--   - world_bosses：旧行一律 stage = 1、affix = 'none'（无词缀）、round_damage = 0；
--     **仍是 active 的旧 Boss 直接改成 fled，并把 rewarded_at 设为当前时间** ——
--     即新版上线时结束旧 Boss、且不发奖（避免用新规则补发一期的一局）。
--   - world_boss_hits：逐行原样搬运（只少了 attempt_no），新增的三列给 '[]'。

ALTER TABLE world_boss_hits RENAME TO world_boss_hits_0027_old;
ALTER TABLE world_bosses RENAME TO world_bosses_0027_old;

CREATE TABLE world_bosses (
  id TEXT PRIMARY KEY,
  -- UTC+8 日期 'YYYY-MM-DD'
  day_key TEXT NOT NULL,
  -- 第几关（每天从 1 开始，连战递增）
  stage INTEGER NOT NULL,
  -- 五只轮换 Boss 的下标（0~4）
  boss_index INTEGER NOT NULL,
  -- 随机词缀 id（见 worldBoss.ts 的 WORLD_BOSS_AFFIXES；旧数据为 'none'）
  affix TEXT NOT NULL,
  -- 生成第 1 关时算好的「一轮伤害」，后续关卡复用它算血量
  round_damage INTEGER NOT NULL,
  max_hp INTEGER NOT NULL,
  hp INTEGER NOT NULL,
  -- 'active' | 'killed' | 'fled'
  status TEXT NOT NULL DEFAULT 'active',
  killer_sect_id TEXT,
  half_announced INTEGER NOT NULL DEFAULT 0,
  -- 奖励发放完成时间；NULL = 未发
  rewarded_at INTEGER,
  created_at INTEGER NOT NULL,
  ended_at INTEGER,
  -- 一天可以有多个关卡（连战）
  UNIQUE (day_key, stage)
);

CREATE TABLE world_boss_hits (
  id TEXT PRIMARY KEY,
  boss_id TEXT NOT NULL REFERENCES world_bosses (id),
  sect_id TEXT NOT NULL,
  -- 冗余存宗门名，榜单与出手记录不用再 JOIN
  sect_name TEXT NOT NULL,
  -- 出战弟子名（JSON 数组）
  disciple_names TEXT NOT NULL,
  -- 出战弟子 id（JSON 数组）
  disciple_ids TEXT NOT NULL DEFAULT '[]',
  -- 本次受伤的弟子名（JSON 数组）
  injured_names TEXT NOT NULL DEFAULT '[]',
  -- 本次被打成重伤的弟子名（JSON 数组）
  severe_names TEXT NOT NULL DEFAULT '[]',
  -- 实际扣血
  damage INTEGER NOT NULL,
  is_crit INTEGER NOT NULL DEFAULT 0,
  is_last_hit INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE disciple_boss_battles (
  id TEXT PRIMARY KEY,
  disciple_id TEXT NOT NULL,
  sect_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

INSERT INTO world_bosses (
  id, day_key, stage, boss_index, affix, round_damage, max_hp, hp, status,
  killer_sect_id, half_announced, rewarded_at, created_at, ended_at
)
SELECT
  id, day_key, 1, boss_index, 'none', 0, max_hp, hp,
  CASE WHEN status = 'active' THEN 'fled' ELSE status END,
  killer_sect_id, half_announced,
  CASE
    WHEN status = 'active' THEN CAST(strftime('%s', 'now') AS INTEGER) * 1000
    ELSE rewarded_at
  END,
  created_at,
  CASE
    WHEN status = 'active' THEN CAST(strftime('%s', 'now') AS INTEGER) * 1000
    ELSE ended_at
  END
FROM world_bosses_0027_old;

INSERT INTO world_boss_hits (
  id, boss_id, sect_id, sect_name, disciple_names, disciple_ids,
  injured_names, severe_names, damage, is_crit, is_last_hit, created_at
)
SELECT
  id, boss_id, sect_id, sect_name, disciple_names, '[]',
  '[]', '[]', damage, is_crit, is_last_hit, created_at
FROM world_boss_hits_0027_old;

DROP TABLE world_boss_hits_0027_old;
DROP TABLE world_bosses_0027_old;

CREATE INDEX world_boss_hits_boss_idx ON world_boss_hits (boss_id, created_at DESC);
CREATE INDEX world_boss_hits_damage_idx ON world_boss_hits (damage DESC);
-- 二期：冷却判断（取该宗门最近一条出手记录）与疲劳统计都按宗门查。
CREATE INDEX world_boss_hits_sect_idx ON world_boss_hits (sect_id, created_at DESC);
CREATE INDEX disciple_boss_battles_disciple_idx ON disciple_boss_battles (disciple_id, created_at);
CREATE INDEX disciple_boss_battles_sect_idx ON disciple_boss_battles (sect_id, created_at);
