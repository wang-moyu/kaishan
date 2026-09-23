import type { ApiErrorCode } from '@xiuxian/contracts';
import { defaultMessageOf, httpStatusOf } from '@xiuxian/contracts';
import type { Context } from 'hono';

import type { Logger } from '../infra/logging/logger';
import type { AuthState, UserSummary } from '../modules/auth/state';

/**
 * 服务端应用上下文：注入绑定、requestId、起始时间、logger 与登录态。
 * requestId 一律由服务端生成（不接受客户端指定），确保日志与响应包可对应。
 * 登录态由 middleware/session.ts 写入（未登录为 null，而不是 undefined）。
 */
export interface AppEnv {
  Bindings: Env;
  Variables: {
    requestId: string;
    startedAt: number;
    logger: Logger;
    auth: AuthState | null;
    currentUser: UserSummary | null;
  };
}

export type AppContext = Context<AppEnv>;

export function requestIdOf(c: AppContext): string {
  return c.get('requestId');
}

export function startedAtOf(c: AppContext): number {
  return c.get('startedAt');
}

export function authOf(c: AppContext): AuthState | null {
  return c.get('auth');
}

/**
 * 业务错误：携带 04 第 2 节定义的错误码，HTTP 状态由错误码决定，不允许随手指定。
 * details 只放结构化说明（字段名、缺少数量、剩余时间等），不放原始输入值/SQL/堆栈。
 */
export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ApiErrorCode, message?: string, details?: Record<string, unknown>) {
    super(message ?? defaultMessageOf(code));
    this.name = 'AppError';
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }

  get status(): number {
    return httpStatusOf(this.code);
  }
}
