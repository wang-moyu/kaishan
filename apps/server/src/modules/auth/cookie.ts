import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

import type { AppContext } from '../../http/appError';

/**
 * Cookie 约定（02 第 5 节）：
 * - `session`：会话令牌，HttpOnly + SameSite=Lax + Path=/ + Secure（production 才带）；
 * - `csrf`：CSRF 令牌，需要被前端 JS 读取后放进 X-CSRF-Token 头，因此**不是** HttpOnly。
 *
 * CSRF 采用「双提交 + 服务端摘要校验」：
 *   1. 头里的值与 Cookie 里的值必须一致（双提交）；
 *   2. sha256(头里的值) 必须等于会话行里存的 csrf_token_hash（防 Cookie 被植入）。
 */
export const SESSION_COOKIE = 'session';
export const CSRF_COOKIE = 'csrf';
export const CSRF_HEADER = 'x-csrf-token';

export function setSessionCookie(
  c: AppContext,
  token: string,
  ttlSeconds: number,
  secure: boolean,
): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure,
    maxAge: ttlSeconds,
  });
}

export function clearSessionCookie(c: AppContext, secure: boolean): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure, sameSite: 'Lax' });
}

export function readSessionToken(c: AppContext): string | null {
  const token = getCookie(c, SESSION_COOKIE);
  return token === undefined || token.length === 0 ? null : token;
}

export function setCsrfCookie(c: AppContext, token: string, ttlSeconds: number, secure: boolean): void {
  // 故意不加 HttpOnly：前端需要读出来放进请求头（见上）
  setCookie(c, CSRF_COOKIE, token, {
    httpOnly: false,
    sameSite: 'Lax',
    path: '/',
    secure,
    maxAge: ttlSeconds,
  });
}

export function clearCsrfCookie(c: AppContext, secure: boolean): void {
  deleteCookie(c, CSRF_COOKIE, { path: '/', secure, sameSite: 'Lax' });
}

export function readCsrfCookie(c: AppContext): string | null {
  const token = getCookie(c, CSRF_COOKIE);
  return token === undefined || token.length === 0 ? null : token;
}
