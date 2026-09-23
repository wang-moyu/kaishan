import { ParamRepository } from './repository';

/**
 * P0 表的最小读取仓储。它们只做「表 -> 行 -> 参数化语句」映射：
 * 业务规则（归属校验、结算、升级成本等）由后续任务的 service 负责，
 * 本阶段也不写任何业务写入方法（写入与批次断言归 P0-05）。
 */

export interface GameServerRow {
  id: string;
  code: string;
  time_zone: string;
  created_at: number;
}

/** game_servers（03 的 GameServer）：单服 code + 时区。 */
export class GameServerRepository extends ParamRepository {
  async findByCode(code: string): Promise<GameServerRow | null> {
    return this.one<GameServerRow>({
      sql: 'SELECT id, code, time_zone, created_at FROM game_servers WHERE code = ?',
      params: [code],
    });
  }

  async countAll(): Promise<number> {
    const row = await this.one<{ total: number }>({
      sql: 'SELECT COUNT(*) AS total FROM game_servers',
    });
    return Number(row?.total ?? 0);
  }
}

export interface ConfigVersionRow {
  id: string;
  version: string;
  payload_hash: string;
  created_at: number;
}

/** config_versions（03 的 ConfigVersion）：配置内容哈希的真实写入由 P0-03 负责。 */
export class ConfigVersionRepository extends ParamRepository {
  async findByVersion(version: string): Promise<ConfigVersionRow | null> {
    return this.one<ConfigVersionRow>({
      sql: 'SELECT id, version, payload_hash, created_at FROM config_versions WHERE version = ?',
      params: [version],
    });
  }

  async findLatest(): Promise<ConfigVersionRow | null> {
    return this.one<ConfigVersionRow>({
      sql: 'SELECT id, version, payload_hash, created_at FROM config_versions ORDER BY created_at DESC, id DESC LIMIT 1',
    });
  }
}
