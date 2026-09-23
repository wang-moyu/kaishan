import type { MiddlewareHandler } from 'hono';

import { AppError, authOf, type AppEnv } from '../http/appError';
import { CSRF_HEADER, readCsrfCookie } from '../modules/auth/cookie';
import { constantTimeEqual, hashToken } from '../modules/auth/tokens';

/**
 * CSRF 校验（02 第 5 节：已登录写请求含退出再验 CSRF）。
 *
 * 采用「双提交 + 服务端摘要」：
 *   1. 头 X-CSRF-Token 必须存在，且与 csrf Cookie 完全一致（双提交）；
 *   2. sha256(头里的值) 必须等于会话行里存的摘要（防止 Cookie 被植入）。
 *
 * 默认保护所有非安全方法，只放行明确列出的「账号动作」（登录/注册）——
 * 它们还没有会话，靠注册开关、邀请码、Origin 校验与限频防护。
 * 新增写接口默认受保护，忘记加保护会失败而不是静默放行。
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const CSRF_EXEMPT_PATHS = new Set(['/api/v1/auth/login', '/api/v1/auth/register']);

export function createCsrfGuard(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method.toUpperCase()) || CSRF_EXEMPT_PATHS.has(c.req.path)) {
      return next();
    }

    const auth = authOf(c);
    if (auth === null) {
      // 未登录的写请求：401（且不产生任何写入）
      throw new AppError('UNAUTHENTICATED');
    }

    const headerToken = c.req.header(CSRF_HEADER);
    const cookieToken = readCsrfCookie(c);
    if (headerToken === undefined || cookieToken === null || !constantTimeEqual(headerToken, cookieToken)) {
      throw new AppError('CSRF_INVALID');
    }

    const headerHash = await hashToken(headerToken);
    if (!constantTimeEqual(headerHash, auth.csrfTokenHash)) {
      throw new AppError('CSRF_INVALID');
    }

    return next();
  };
}
