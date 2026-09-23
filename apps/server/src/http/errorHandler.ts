import type { ErrorHandler, NotFoundHandler } from 'hono';

import { DbQueryError } from '../infra/db/errors';
import { describeError, type Logger } from '../infra/logging/logger';
import type { AppEnv } from './appError';
import { AppError } from './appError';
import { respondError } from './envelope';

/**
 * 统一错误处理（04 第 2 节、02 第 3 节）。
 *
 * 分类：
 *   - AppError：业务/契约错误，按错误码返回固定状态与文案；
 *   - DbQueryError：数据库错误，按 infra 层分类返回安全文案（不含 SQL、表名、连接信息）；
 *   - 其他：500 INTERNAL_ERROR，对外只给固定文案 + requestId，绝不返回堆栈。
 *
 * 日志与响应分离：日志里可以带 error.name/message 便于排查，响应里只有安全信息。
 */
export function createErrorHandler(logger: Logger): ErrorHandler<AppEnv> {
  return (error, c) => {
    const requestId = c.get('requestId');
    const durationMs = Date.now() - c.get('startedAt');
    const base = {
      requestId,
      method: c.req.method,
      path: c.req.path,
      durationMs,
    };

    if (error instanceof AppError) {
      logger.warn('http_error', { ...base, status: error.status, code: error.code });
      return respondError(c, error);
    }

    if (error instanceof DbQueryError) {
      logger.error('db_error', { ...base, kind: error.kind, code: error.safe.code, ...describeError(error.cause) });
      return respondError(c, new AppError('TEMPORARILY_UNAVAILABLE', error.safe.message, { reason: error.safe.code }));
    }

    logger.error('unhandled_error', { ...base, ...describeError(error) });
    return respondError(c, new AppError('INTERNAL_ERROR'));
  };
}

export function createNotFoundHandler(): NotFoundHandler<AppEnv> {
  return (c) => {
    c.get('logger').warn('http_not_found', {
      requestId: c.get('requestId'),
      method: c.req.method,
      path: c.req.path,
    });
    return respondError(c, new AppError('NOT_FOUND'));
  };
}
