import { Hono } from 'hono';

import { createErrorHandler, createNotFoundHandler } from './http/errorHandler';
import type { AppEnv } from './http/appError';
import { createRequestContext } from './http/requestContext';
import { createConsoleLogger, type Logger } from './infra/logging/logger';
import { createCsrfGuard } from './middleware/csrf';
import { createOriginGuard } from './middleware/origin';
import { createSessionLoader } from './middleware/session';
import { createAuthRoutes } from './modules/auth/routes';
import { createGameRoutes } from './modules/game/routes';
import { createSystemRoutes } from './modules/system/routes';

/**
 * Worker 的 Hono 应用。
 *
 * 装配顺序（P0-03 建立契约与错误处理，P0-04 加入鉴权链路）：
 *   1. 禁止公共缓存的响应头（放在 next 之前，错误响应也会带上）；
 *   2. 请求上下文：生成 requestId、计时、注入 logger；
 *   3. 会话加载：读 Cookie → 查库 → 写入 auth/currentUser（未登录为 null）；
 *   4. Origin 校验：所有写请求必须同源（或命中开发白名单）；
 *   5. CSRF 校验：默认保护所有非安全方法，仅放行登录/注册这类账号动作；
 *   6. /api/v1 路由：系统模块（health/config）+ 账号模块（auth）；
 *   7. 统一 JSON 404 与错误处理（04 第 1、2 节的响应包与错误码）。
 *
 * 契约、错误码、响应包来自 @xiuxian/contracts；配置在模块初始化时校验（见 config/loadGameConfig.ts）。
 * 幂等命令、批次断言与可注入时钟由 P0-05 接入。
 */
export interface AppOptions {
  /** 测试可注入内存 logger；默认输出结构化 JSON 到 console。 */
  logger?: Logger;
}

export function createApp(options: AppOptions = {}): Hono<AppEnv> {
  const logger = options.logger ?? createConsoleLogger();
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    // API 响应禁止公共缓存（见 02 第 5 节）；先设置，保证错误响应同样带该头
    c.header('Cache-Control', 'no-store');
    await next();
  });

  app.use('*', createRequestContext(logger));
  app.use('*', createSessionLoader());
  app.use('*', createOriginGuard());
  app.use('*', createCsrfGuard());

  app.route('/api/v1', createSystemRoutes());
  app.route('/api/v1', createAuthRoutes());
  app.route('/api/v1', createGameRoutes());

  app.notFound(createNotFoundHandler());
  app.onError(createErrorHandler(logger));

  return app;
}
