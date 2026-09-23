import { Hono } from 'hono';

import { readAuthConfig } from '../../config/authConfig';
import { getDb } from '../../infra/db/client';
import { AppError, authOf, type AppEnv } from '../../http/appError';
import { respondOk } from '../../http/envelope';
import { parseStrictJson } from '../../http/validation';
import { clientIpOf } from '../../middleware/rateLimit';
import {
  clearCsrfCookie,
  clearSessionCookie,
  readCsrfCookie,
  setCsrfCookie,
  setSessionCookie,
} from './cookie';
import { loginRequestSchema, registerRequestSchema } from './schema';
import {
  assertRegisterAllowed,
  loginWithPassword,
  registerAccount,
  revokeSessionById,
  rotateCsrfToken,
} from './service';
import { constantTimeEqual, hashToken } from './tokens';

/**
 * 账号接口（04 第 3 节：注册/登录/me/退出）。
 *
 * - 注册：受 REGISTRATION_ENABLED 与邀请码控制，客户端无法绕过；
 * - 登录：不要求预先持有 session token；失败与限频见 service.ts；
 * - me：需要有效会话；按需轮换 CSRF 令牌（Cookie 缺失或与服务端摘要不符时）；
 * - 退出：需要会话 + CSRF + 同源 Origin（CSRF 由 middleware/csrf.ts 统一校验）。
 *
 * 日志只写 userId 与事件名，绝不写密码、令牌或 CSRF 值。
 */
export function createAuthRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.post('/auth/register', async (c) => {
    const config = readAuthConfig(c.env);
    const now = Date.now();
    const db = getDb(c.env);
    const body = await parseStrictJson(registerRequestSchema, c);

    await assertRegisterAllowed(db, config, now, clientIpOf(c));
    const { user, tokens } = await registerAccount(db, config, now, body);

    setSessionCookie(c, tokens.token, config.sessionTtlSeconds, config.cookieSecure);
    setCsrfCookie(c, tokens.csrfToken, config.sessionTtlSeconds, config.cookieSecure);
    c.get('logger').info('auth_registered', { requestId: c.get('requestId'), userId: user.id });

    return respondOk(c, { user, csrfToken: tokens.csrfToken });
  });

  routes.post('/auth/login', async (c) => {
    const config = readAuthConfig(c.env);
    const now = Date.now();
    const db = getDb(c.env);
    const body = await parseStrictJson(loginRequestSchema, c);

    const result = await loginWithPassword(db, config, now, body, { ip: clientIpOf(c) });

    setSessionCookie(c, result.tokens.token, config.sessionTtlSeconds, config.cookieSecure);
    setCsrfCookie(c, result.tokens.csrfToken, config.sessionTtlSeconds, config.cookieSecure);
    c.get('logger').info('auth_login_succeeded', {
      requestId: c.get('requestId'),
      userId: result.user.id,
      passwordUpgraded: result.passwordUpgraded,
    });

    return respondOk(c, { user: result.user, csrfToken: result.tokens.csrfToken });
  });

  routes.get('/auth/me', async (c) => {
    const auth = authOf(c);
    const user = c.get('currentUser');
    if (auth === null || user === null) {
      throw new AppError('UNAUTHENTICATED');
    }

    const config = readAuthConfig(c.env);
    const db = getDb(c.env);

    // Cookie 缺失或与服务端摘要不符时轮换（自愈），否则直接回显 Cookie 里的值
    let csrfToken = readCsrfCookie(c);
    const matches =
      csrfToken !== null && constantTimeEqual(await hashToken(csrfToken), auth.csrfTokenHash);
    if (csrfToken === null || !matches) {
      csrfToken = await rotateCsrfToken(db, auth.sessionId);
      setCsrfCookie(c, csrfToken, config.sessionTtlSeconds, config.cookieSecure);
      c.get('logger').warn('auth_csrf_rotated', {
        requestId: c.get('requestId'),
        userId: user.id,
      });
    }

    // sect 摘要属于 P1（宗门创建）之前为 null，这里保持字段存在，避免前端分支猜测
    return respondOk(c, { user, sect: null, csrfToken });
  });

  routes.post('/auth/logout', async (c) => {
    const auth = authOf(c);
    if (auth === null) {
      throw new AppError('UNAUTHENTICATED');
    }

    const config = readAuthConfig(c.env);
    await revokeSessionById(getDb(c.env), Date.now(), auth.sessionId);

    clearSessionCookie(c, config.cookieSecure);
    clearCsrfCookie(c, config.cookieSecure);
    c.get('logger').info('auth_logout', { requestId: c.get('requestId'), userId: auth.userId });

    return respondOk(c, { loggedOut: true });
  });

  return routes;
}
