-- Migration number: 0005 	 Name: p3_event_log
--
-- 随机事件系统：
--   event_log <- 已触发事件的日志（sync 的 recentEvents 与 GET /game/events 的数据源）
--
-- 说明：
--   - 事件定义（name/weight）硬编码在代码里（modules/game/events.ts），表里只存 event_id；
--     读库时 name 由事件定义按 event_id 查表得到，查不到时用 event_id 兜底。
--   - effects 存 JSON（resourceId -> 带符号的最小单位数量字符串）。
--   - 时间统一为 UTC 整数毫秒（见 03 第 1 节）。

CREATE TABLE event_log (
  id TEXT PRIMARY KEY,
  sect_id TEXT NOT NULL REFERENCES sects (id),
  event_id TEXT NOT NULL,
  description TEXT NOT NULL,
  effects TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX event_log_sect_idx ON event_log (sect_id, created_at DESC);
