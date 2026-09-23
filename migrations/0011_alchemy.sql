-- Migration number: 0011 	 Name: alchemy
--
-- 丹药系统（v1 可玩闭环）：
--   disciples <- 新增 body_tempering_count 列（每名弟子已服用淬体丹次数，上限 10）
--   新增 pill_inventories 表（宗门丹药库存，同一宗门同一 pill_id 只有一行）
--
-- 说明：
--   - 解锁条件（宗门 2 级 + 灵药园 2 级）、丹方配方与淬体上限都是代码常量，定义在
--     apps/server/src/modules/game/alchemy.ts，不进配置表，也不改公共配置哈希。
--   - pill_id 不建外键：配方定义属于代码常量，不是数据库实体。
--   - quantity 是非负整数（不用十进制字符串）；CHECK 保证不会出现负库存。
--   - body_tempering_count NOT NULL DEFAULT 0 让已有弟子行自动获得 0 次。
--   - 炼制/服用共用现有 SectDraft 的一次 D1 batch 写入，不新增独立写路径。

-- 每名弟子最多 10 次淬体丹服用次数。
ALTER TABLE disciples
  ADD COLUMN body_tempering_count INTEGER NOT NULL DEFAULT 0
  CHECK (body_tempering_count >= 0);

CREATE TABLE pill_inventories (
  id TEXT PRIMARY KEY,
  sect_id TEXT NOT NULL REFERENCES sects (id) ON DELETE CASCADE,
  pill_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at INTEGER NOT NULL,
  UNIQUE (sect_id, pill_id)
);

CREATE INDEX pill_inventories_sect_idx
  ON pill_inventories (sect_id);
