import { z } from 'zod';

/**
 * 错误码与 HTTP 状态映射（04 第 2 节）。
 * 一处定义，服务端与前端共用；不允许各页面各写一套中文字符串。
 */

export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'CSRF_INVALID',
  'NOT_FOUND',
  'IDEMPOTENCY_CONFLICT',
  'STATE_CONFLICT',
  'INSUFFICIENT_RESOURCE',
  'CAPACITY_FULL',
  'INVALID_STATUS',
  'COOLDOWN_ACTIVE',
  'DAILY_LIMIT',
  'EXPIRED',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'TEMPORARILY_UNAVAILABLE',
] as const;

export type ApiErrorCode = (typeof ERROR_CODES)[number];

export const apiErrorCodeSchema = z.enum(ERROR_CODES);

/** 每个错误码固定一个 HTTP 状态；表外的组合不允许出现。 */
export const ERROR_HTTP_STATUS: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  CSRF_INVALID: 403,
  NOT_FOUND: 404,
  IDEMPOTENCY_CONFLICT: 409,
  STATE_CONFLICT: 409,
  INSUFFICIENT_RESOURCE: 409,
  CAPACITY_FULL: 409,
  INVALID_STATUS: 409,
  COOLDOWN_ACTIVE: 409,
  DAILY_LIMIT: 409,
  EXPIRED: 410,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  TEMPORARILY_UNAVAILABLE: 503,
};

/** 默认中文文案：可被具体场景覆盖，但不能泄露堆栈、SQL 或内部标识。 */
export const DEFAULT_ERROR_MESSAGES: Record<ApiErrorCode, string> = {
  VALIDATION_ERROR: '请求参数不合法',
  UNAUTHENTICATED: '请先登录',
  FORBIDDEN: '没有权限执行该操作',
  CSRF_INVALID: '请求校验失败，请刷新后重试',
  NOT_FOUND: '对象不存在',
  IDEMPOTENCY_CONFLICT: '同一幂等键的请求内容不一致',
  STATE_CONFLICT: '状态已变化，请同步后重试',
  INSUFFICIENT_RESOURCE: '资源不足',
  CAPACITY_FULL: '容量不足',
  INVALID_STATUS: '当前状态不允许该操作',
  COOLDOWN_ACTIVE: '操作冷却中',
  DAILY_LIMIT: '今日次数已用完',
  EXPIRED: '操作已过期',
  RATE_LIMITED: '请求过于频繁，请稍后再试',
  INTERNAL_ERROR: '服务器内部错误',
  TEMPORARILY_UNAVAILABLE: '服务暂时不可用，请稍后再试',
};

/**
 * 错误对象 schema。details 只放结构化说明（字段名、缺少数量、剩余时间等），
 * 不放原始输入值、SQL、堆栈或内部 id。
 */
export const apiErrorSchema = z.strictObject({
  code: apiErrorCodeSchema,
  message: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

export function httpStatusOf(code: ApiErrorCode): number {
  return ERROR_HTTP_STATUS[code];
}

export function defaultMessageOf(code: ApiErrorCode): string {
  return DEFAULT_ERROR_MESSAGES[code];
}
