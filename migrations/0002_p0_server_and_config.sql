-- Migration number: 0002 	 Name: p0_server_and_config
--
-- P0 服务器与配置版本（对应 03 第 11 节 P0 实体）：
--   game_servers    <- GameServer(code unique, timeZone)
--   config_versions <- ConfigVersion(version unique, payloadHash)
-- 本阶段只建表；实际配置内容与哈希校验由 P0-03（packages/game-config）负责写入。
-- 单服：V1 只有一个 game_servers 行（code = 's1'，UTC+8），种子见 scripts/seed/seed.sql。

CREATE TABLE game_servers (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  -- IANA 时区名或固定偏移；V1 使用 UTC+8 划分自然日/周（见 03 第 1 节）
  time_zone TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE config_versions (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL UNIQUE,
  -- 配置内容哈希，用于校验同版本内容未被改写（见 03 第 12 节）
  payload_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
