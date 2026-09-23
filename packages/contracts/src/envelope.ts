import { z } from 'zod';

import { apiErrorSchema } from './errors';
import { utcIsoTimeSchema, uuidSchema } from './primitives';

/**
 * 统一响应包（04 第 1 节）：
 *
 * type ApiResponse<T> =
 *   | { ok: true;  data: T; requestId: string; serverTime: string }
 *   | { ok: false; error: { code; message; details? }; requestId: string; serverTime: string }
 *
 * requestId 由服务端生成（不接受客户端指定），用于日志与问题排查；
 * serverTime 是本次请求的服务端 UTC 时间，客户端时间不参与裁决。
 */

export const requestIdSchema = uuidSchema;

export const apiSuccessSchema = <T extends z.ZodType>(data: T) =>
  z.strictObject({
    ok: z.literal(true),
    data,
    requestId: requestIdSchema,
    serverTime: utcIsoTimeSchema,
  });

export const apiFailureSchema = z.strictObject({
  ok: z.literal(false),
  error: apiErrorSchema,
  requestId: requestIdSchema,
  serverTime: utcIsoTimeSchema,
});

export const apiResponseSchema = <T extends z.ZodType>(data: T) =>
  z.union([apiSuccessSchema(data), apiFailureSchema]);

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  requestId: string;
  serverTime: string;
}

export interface ApiFailure {
  ok: false;
  error: {
    code: z.infer<typeof apiErrorSchema>['code'];
    message: string;
    details?: Record<string, unknown>;
  };
  requestId: string;
  serverTime: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;
