-- Migration number: 0031 	 Name: world_boss_v3
--
-- 世界 Boss 三期：
--   1. 新资源「功勋」（game-config v7.0.0）：所有已有宗门补一行余额（0）；新宗门建宗时按配置自动带上。
--   （config_versions 的 v7.0.0 行由 scripts/seed/seed.sql 负责，运行时不读这张表。）
--   本期不需要其它表结构改动：掉落与功勋都只写现有的 resource_balances / equipment / event_logs。

INSERT INTO resource_balances (id, sect_id, resource_id, balance, remainder, updated_at)
SELECT lower(hex(randomblob(16))), id, 'bossMerit', 0, 0, CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM sects
WHERE NOT EXISTS (
  SELECT 1 FROM resource_balances rb WHERE rb.sect_id = sects.id AND rb.resource_id = 'bossMerit'
);
