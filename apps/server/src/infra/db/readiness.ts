import { MissingSchemaError } from './errors';

/**
 * 必需表白名单（代码内，不来自请求参数）。
 * P0 迁移 0001~0003 建账号/会话/命令/配置表，0004 建游戏表（一次性可玩版本），
 * 0005 建事件日志表（P3 随机事件），0006 建探索记录表（V2-2 秘境探索），
 * 0007 建切磋记录表（V3 多人互动），0008 加弟子战斗属性（V4），
 * 0009 加守擂阵容列与挑战记录表（V5 挑战系统），0010 加招贤刷新列（V5.2 招贤台刷新），
 * 0011 加弟子淬体次数列与丹药库存表（丹药系统），0015 建交互式秘境探索进行中状态表
 * （V6 秘境探索重构：realm_explorations），0019 建论道赌局记录表（赌坊：dao_debate_log）。
 */
export const REQUIRED_TABLES = [
  'users',
  'sessions',
  'command_receipts',
  'mutation_guards',
  'game_servers',
  'config_versions',
  'auth_rate_limits',
  'sects',
  'disciples',
  'buildings',
  'resource_balances',
  'event_log',
  'explorations',
  'sparring_log',
  'challenge_log',
  'pill_inventories',
  'realm_explorations',
  'dao_debate_log',
] as const;

export interface DbReadiness {
  appliedMigrations: number;
}

/**
 * 就绪检查：D1 连接可用，且 P0 迁移已应用。
 *
 * - 只查 sqlite_master 与 d1_migrations，不读业务数据，不返回连接信息（见 04 第 3 节 /health/ready）。
 * - 表缺失时抛 MissingSchemaError，让路由区分「未迁移」和「数据库挂了」。
 * - 刻意不检查 seed：引用数据缺失不应让服务整体不可用。
 */
export async function checkDbReadiness(db: D1Database): Promise<DbReadiness> {
  const placeholders = REQUIRED_TABLES.map(() => '?').join(', ');
  const tableRow = await db
    .prepare(
      `SELECT COUNT(*) AS found FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`,
    )
    .bind(...REQUIRED_TABLES)
    .first<{ found: number }>();

  const found = Number(tableRow?.found ?? 0);
  if (found !== REQUIRED_TABLES.length) {
    throw new MissingSchemaError(REQUIRED_TABLES.length, found);
  }

  const migrationRow = await db
    .prepare('SELECT COUNT(*) AS applied FROM d1_migrations')
    .first<{ applied: number }>();

  return { appliedMigrations: Number(migrationRow?.applied ?? 0) };
}
