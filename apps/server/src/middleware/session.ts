import type { MiddlewareHandler } from 'hono';

import type { AppEnv } from '../http/appError';
import { getDb } from '../infra/db/client';
import { readSessionToken } from '../modules/auth/cookie';
import { loadSession, toUserSummary } from '../modules/auth/service';

/**
 * 会话加载（02 第 2 节的 session 插件）。
 *
 * - Cookie 里没有令牌就不查库；
 * - 只接受未撤销、未过期且账号仍为 active 的会话；
 * - 未登录时把 auth / currentUser 显式设成 null，避免下游拿到 undefined。
 *
 * 时间来源：本阶段用服务端当前时间；P0-05 引入可注入 Clock 后改为从上下文取。
 */
export function createSessionLoader(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set('auth', null);
    c.set('currentUser', null);

    const token = readSessionToken(c);
    if (token !== null) {
      const loaded = await loadSession(getDb(c.env), Date.now(), token);
      if (loaded !== null) {
        c.set('auth', loaded.auth);
        c.set('currentUser', toUserSummary(loaded.user));
      }
    }

    await next();
  };
}
