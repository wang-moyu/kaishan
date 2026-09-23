import type { MiddlewareHandler } from 'hono';

import type { Logger } from '../infra/logging/logger';
import type { AppEnv } from './appError';

/**
 * 请求上下文：生成 requestId、记录起始时间、把 logger 放进 context，
 * 并在成功路径写一行结构化访问日志。
 *
 * 失败路径不在这里写日志：异常会冒泡到 app.onError（见 errorHandler.ts），
 * 由那里按错误码记录一次，保证每个请求只有一行日志。
 */
export function createRequestContext(logger: Logger): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set('requestId', crypto.randomUUID());
    c.set('startedAt', Date.now());
    c.set('logger', logger);

    await next();

    // 只记成功请求：错误（4xx/5xx）由 errorHandler/notFound 各记一行，
    // 保证每个请求恰好一行日志，且状态码不会重复出现。
    if (c.res.status < 400) {
      logger.info('http_request', {
        requestId: c.get('requestId'),
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Date.now() - c.get('startedAt'),
      });
    }
  };
}
