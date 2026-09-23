import type { ApiErrorCode, ApiSuccess } from '@xiuxian/contracts';
import { defaultMessageOf } from '@xiuxian/contracts';

import type { AppContext } from './appError';
import { AppError, requestIdOf } from './appError';

/**
 * 响应包构造（04 第 1 节）。
 *
 * 所有响应都必须带 requestId 与 serverTime；错误响应额外带稳定的错误码。
 * 时间来源：本阶段直接用服务端当前时间；P0-05 引入可注入 Clock 后改为从上下文取，
 * 届时本文件是唯一需要改动的地方（客户端时间永远不参与裁决）。
 */

function serverTime(): string {
  return new Date().toISOString();
}

export function respondOk<T>(c: AppContext, data: T): Response {
  const body: ApiSuccess<T> = {
    ok: true,
    data,
    requestId: requestIdOf(c),
    serverTime: serverTime(),
  };
  return c.json(body, 200);
}

export function respondError(c: AppContext, error: AppError): Response {
  return c.json(
    {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
      requestId: requestIdOf(c),
      serverTime: serverTime(),
    },
    error.status as 400,
  );
}

export function respondErrorCode(
  c: AppContext,
  code: ApiErrorCode,
  message?: string,
  details?: Record<string, unknown>,
): Response {
  return respondError(c, new AppError(code, message ?? defaultMessageOf(code), details));
}
