-- Migration number: 0028 	Name: equipment
--
-- 装备系统 · 一期（docs/装备系统开发计划.md 第 2 节）。
--
--   equipment        <- 新表：宗门持有的装备。disciple_id IS NULL = 在背包里，
--                       否则 = 穿在该弟子身上（每名弟子每个部位最多一件，靠部分唯一索引兜底）。
--                       disciple_id 不加外键：驱逐弟子时先把装备放回背包，与历练记录同一做法。
--   disciples.gear_* <- 5 个冗余列：该弟子当前穿戴装备的加成之和。
--                       战斗计算只读这 5 列（不查装备表，D1 额度紧）；
--                       每次穿戴 / 卸下 / 驱逐都在同一个 batch 里按装备表重新求和写回。
--
-- 一期不做：强化/升级、更高品质的炼器、套装、耐久、交易、锁定、背包扩容（见计划第 6 节）。

CREATE TABLE equipment (
  id TEXT PRIMARY KEY,
  sect_id TEXT NOT NULL REFERENCES sects (id),
  -- NULL = 在背包里
  disciple_id TEXT,
  -- weapon | armor | artifact
  slot TEXT NOT NULL,
  -- common | spirit | treasure | immortal（见 equipment.ts 的 EQUIPMENT_QUALITIES）
  quality TEXT NOT NULL,
  -- {品质名}·{部位名}，例如「仙品·紫金葫芦」
  name TEXT NOT NULL,
  main_attr TEXT NOT NULL,
  main_value INTEGER NOT NULL,
  sub_attr TEXT NOT NULL,
  sub_value INTEGER NOT NULL,
  -- forge | boss（一期的两个来源）
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- 背包计数（sect_id + disciple_id IS NULL）与宗门内全部装备列表都走这条索引。
CREATE INDEX equipment_sect_idx ON equipment (sect_id, disciple_id);
-- 每名弟子每个部位最多一件（背包里的行 disciple_id 为 NULL，不参与唯一性）。
CREATE UNIQUE INDEX equipment_disciple_slot_uniq ON equipment (disciple_id, slot) WHERE disciple_id IS NOT NULL;

ALTER TABLE disciples ADD COLUMN gear_attack INTEGER NOT NULL DEFAULT 0;
ALTER TABLE disciples ADD COLUMN gear_defense INTEGER NOT NULL DEFAULT 0;
ALTER TABLE disciples ADD COLUMN gear_speed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE disciples ADD COLUMN gear_luck INTEGER NOT NULL DEFAULT 0;
ALTER TABLE disciples ADD COLUMN gear_physique INTEGER NOT NULL DEFAULT 0;
