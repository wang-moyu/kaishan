import { Hono } from 'hono';
import { z } from 'zod';

import { gameConfigVersion, publicGameConfig } from '../../config/loadGameConfig';
import { getDb } from '../../infra/db/client';
import { toSafeDbError } from '../../infra/db/errors';
import { checkDbReadiness } from '../../infra/db/readiness';
import { AppError, type AppEnv } from '../../http/appError';
import { respondOk } from '../../http/envelope';
import { parseStrictQuery } from '../../http/validation';

/**
 * 系统模块（04 第 3 节的 health 与 config 接口）。
 *
 * 路径前缀 /api/v1 在 app.ts 里挂载；本文件只关心自己的路由与输入校验。
 * 所有响应都经 respondOk/AppError，统一由错误处理中间件补 requestId 与 serverTime。
 */

/** GET /config/public 的严格查询 schema：只接受 version，多余参数直接 400。 */
const publicConfigQuerySchema = z.strictObject({
  version: z.string().min(1).max(64).optional(),
});

export function createSystemRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  // 存活：不访问数据库，只证明 Worker 能响应
  routes.get('/health/live', (c) => respondOk(c, { status: 'live', configVersion: gameConfigVersion }));

  // 就绪：数据库连接可用且迁移已应用；失败抛 TEMPORARILY_UNAVAILABLE（503）
  routes.get('/health/ready', async (c) => {
    try {
      const readiness = await checkDbReadiness(getDb(c.env));
      return respondOk(c, {
        status: 'ready',
        appliedMigrations: readiness.appliedMigrations,
        configVersion: gameConfigVersion,
      });
    } catch (error) {
      const safe = toSafeDbError(error);
      throw new AppError('TEMPORARILY_UNAVAILABLE', safe.message, { reason: safe.code });
    }
  });

  // 公开配置：只返回白名单投影（见 game-core/config/publicView.ts）
  routes.get('/config/public', (c) => {
    const { version } = parseStrictQuery(publicConfigQuerySchema, c);
    if (version !== undefined && version !== gameConfigVersion) {
      throw new AppError('NOT_FOUND', '该配置版本不存在');
    }
    return respondOk(c, { version: gameConfigVersion, config: publicGameConfig });
  });

  return routes;
}
