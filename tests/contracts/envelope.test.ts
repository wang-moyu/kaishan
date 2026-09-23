import {
  ERROR_CODES,
  ERROR_HTTP_STATUS,
  DEFAULT_ERROR_MESSAGES,
  apiErrorCodeSchema,
  apiFailureSchema,
  apiResponseSchema,
  apiSuccessSchema,
  defaultMessageOf,
  httpStatusOf,
} from '@xiuxian/contracts';
import { describe, expect, it } from 'vitest';

const REQUEST_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const SERVER_TIME = '2026-09-17T07:00:00.000Z';

/** 响应包与错误契约（04 第 1、2 节）。 */
describe('contracts 响应包', () => {
  it('成功包：ok/data/requestId/serverTime，且拒绝未声明字段', () => {
    const schema = apiSuccessSchema(apiErrorCodeSchema);

    const parsed = schema.safeParse({
      ok: true,
      data: 'NOT_FOUND',
      requestId: REQUEST_ID,
      serverTime: SERVER_TIME,
    });
    expect(parsed.success).toBe(true);

    expect(
      schema.safeParse({
        ok: true,
        data: 'NOT_FOUND',
        requestId: REQUEST_ID,
        serverTime: SERVER_TIME,
        extra: 1,
      }).success,
    ).toBe(false);

    expect(schema.safeParse({ ok: true, data: 'NOT_FOUND', serverTime: SERVER_TIME }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({
        ok: true,
        data: 'NOT_FOUND',
        requestId: 'not-a-uuid',
        serverTime: SERVER_TIME,
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ok: true,
        data: 'NOT_FOUND',
        requestId: REQUEST_ID,
        serverTime: '2026-09-17T07:00:00Z',
      }).success,
    ).toBe(false);
  });

  it('失败包：错误码必须在表内，details 可选且为对象', () => {
    expect(
      apiFailureSchema.safeParse({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: '请求参数不合法' },
        requestId: REQUEST_ID,
        serverTime: SERVER_TIME,
      }).success,
    ).toBe(true);

    expect(
      apiFailureSchema.safeParse({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'x', details: { fields: [] } },
        requestId: REQUEST_ID,
        serverTime: SERVER_TIME,
      }).success,
    ).toBe(true);

    expect(
      apiFailureSchema.safeParse({
        ok: false,
        error: { code: 'NOT_A_CODE', message: 'x' },
        requestId: REQUEST_ID,
        serverTime: SERVER_TIME,
      }).success,
    ).toBe(false);

    expect(
      apiFailureSchema.safeParse({
        ok: false,
        error: { code: 'VALIDATION_ERROR' },
        requestId: REQUEST_ID,
        serverTime: SERVER_TIME,
      }).success,
    ).toBe(false);
  });

  it('联合 schema 同时接受成功与失败包', () => {
    const schema = apiResponseSchema(apiErrorCodeSchema);

    expect(
      schema.safeParse({
        ok: true,
        data: 'INTERNAL_ERROR',
        requestId: REQUEST_ID,
        serverTime: SERVER_TIME,
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' },
        requestId: REQUEST_ID,
        serverTime: SERVER_TIME,
      }).success,
    ).toBe(true);
  });
});

describe('contracts 错误码表', () => {
  it('每个错误码都有状态与默认文案，没有多余键', () => {
    for (const code of ERROR_CODES) {
      expect(typeof httpStatusOf(code)).toBe('number');
      expect(defaultMessageOf(code).length).toBeGreaterThan(0);
    }
    expect(Object.keys(ERROR_HTTP_STATUS).sort()).toEqual([...ERROR_CODES].sort());
    expect(Object.keys(DEFAULT_ERROR_MESSAGES).sort()).toEqual([...ERROR_CODES].sort());
  });

  it('错误码到状态的映射与 04 第 2 节一致', () => {
    expect(ERROR_HTTP_STATUS).toEqual({
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
    });
  });
});
