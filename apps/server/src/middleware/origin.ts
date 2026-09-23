import type { MiddlewareHandler } from 'hono';

import { readAuthConfig } from '../config/authConfig';
import { AppError, type AppEnv } from '../http/appError';

/**
 * Origin 校验（02 第 5 节：所有写请求验 Origin）。
 *
 * - GET/HEAD/OPTIONS 不校验（无副作用）；
 * - 写请求必须带 Origin，且等于请求自身的源（host 相同即可，http / https 都接受，
 *   以兼容 frp / ngrok 这类 TLS 终止型隧道）；
 * - 本地开发若前端直连 Worker（不经 Vite 代理），可用 ALLOWED_ORIGINS 显式放行；
 *   该白名单只用于开发便利，生产应保持为空。
 *
 * 说明：这是 CSRF 的第一道防线；已登录写请求还会再验 CSRF 令牌（见 csrf.ts）。
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function createOriginGuard(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method.toUpperCase())) {
      return next();
    }

    const origin = c.req.header('origin');
    if (origin === undefined || origin.length === 0) {
      throw new AppError('CSRF_INVALID', '写请求必须带 Origin 头');
    }
    if (!isAllowedOrigin(c, origin)) {
      throw new AppError('CSRF_INVALID', '跨源写请求被拒绝');
    }

    return next();
  };
}

function isAllowedOrigin(c: Parameters<MiddlewareHandler<AppEnv>>[0], origin: string): boolean {
  const url = new URL(c.req.url);
  // 同源判定：host 必须一致。http / https 两种写法都接受——经 TLS 终止型隧道
  // （frp / ngrok / Cloudflare Tunnel 等）访问时，浏览器给的 Origin 是 https，
  // 而请求到达 Worker 时已经是 http，两者 host 仍然相同，属于同一个源。
  if (origin === `http://${url.host}` || origin === `https://${url.host}`) {
    return true;
  }
  return readAuthConfig(c.env).allowedOrigins.includes(origin);
}
