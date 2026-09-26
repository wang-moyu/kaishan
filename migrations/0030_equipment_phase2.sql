-- Migration number: 0030 	 Name: equipment_phase2
--
-- 装备二期：
--   1. 新资源「玄铁」（game-config v6.0.0）：所有已有宗门补一行余额（0）；新宗门建宗时按配置自动带上。
--   2. 新建筑「炼器坊」：宗门 2 级自动获得（constants.ts 的 unlockBuildings）；已达 2 级的宗门在这里补建 1 级。
--   （config_versions 的 v6.0.0 行由 scripts/seed/seed.sql 负责，运行时不读这张表。）

INSERT INTO resource_balances (id, sect_id, resource_id, balance, remainder, updated_at)
SELECT lower(hex(randomblob(16))), id, 'xuantie', 0, 0, CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM sects
WHERE NOT EXISTS (
  SELECT 1 FROM resource_balances rb WHERE rb.sect_id = sects.id AND rb.resource_id = 'xuantie'
);

INSERT INTO buildings (id, sect_id, def_id, level, created_at)
SELECT lower(hex(randomblob(16))), id, 'forgeWorkshop', 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM sects
WHERE level >= 2
  AND NOT EXISTS (SELECT 1 FROM buildings b WHERE b.sect_id = sects.id AND b.def_id = 'forgeWorkshop');
