import {
  AmountOutOfRangeError,
  MAX_AMOUNT_MIN_UNITS,
  MAX_SAFE_AMOUNT,
  basisPointsSchema,
  decimalAmountSchema,
  idempotencyKeySchema,
  paginationQuerySchema,
  stableIdSchema,
  toAmountString,
  toSafeAmountNumber,
  utcIsoTimeSchema,
} from '@xiuxian/contracts';
import { describe, expect, it } from 'vitest';

/** 公共标量 schema 的边界（P0-03 测试项：schema 边界）。 */
describe('contracts 标量边界', () => {
  it('十进制最小单位字符串：拒绝前导零、负数、小数、科学计数法', () => {
    for (const ok of ['0', '200000', '1000000000000000']) {
      expect(decimalAmountSchema.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of ['007', '-1', '1.5', '', '1e5', ' 200', '10000000000000000']) {
      expect(decimalAmountSchema.safeParse(bad).success, bad).toBe(false);
    }
    expect(decimalAmountSchema.safeParse(200).success).toBe(false);
  });

  it('安全整数转换：上限内可转，越界或非法抛错', () => {
    expect(toSafeAmountNumber('200000')).toBe(200_000);
    expect(toSafeAmountNumber(String(MAX_AMOUNT_MIN_UNITS))).toBe(MAX_SAFE_AMOUNT);
    expect(() => toSafeAmountNumber(String(MAX_AMOUNT_MIN_UNITS + 1n))).toThrow(
      AmountOutOfRangeError,
    );
    expect(() => toSafeAmountNumber('-1')).toThrow(AmountOutOfRangeError);
    expect(() => toSafeAmountNumber('abc')).toThrow(AmountOutOfRangeError);
  });

  it('反向格式化：安全整数转字符串，负数/小数抛错', () => {
    expect(toAmountString(0)).toBe('0');
    expect(toAmountString(200_000)).toBe('200000');
    expect(() => toAmountString(-1)).toThrow(AmountOutOfRangeError);
    expect(() => toAmountString(1.5)).toThrow(AmountOutOfRangeError);
  });

  it('基点只接受 0～10000 的整数', () => {
    expect(basisPointsSchema.safeParse(0).success).toBe(true);
    expect(basisPointsSchema.safeParse(10_000).success).toBe(true);
    for (const bad of [-1, 10_001, 1.5, '8000', null]) {
      expect(basisPointsSchema.safeParse(bad).success, String(bad)).toBe(false);
    }
  });

  it('稳定 id 必须小驼峰', () => {
    expect(stableIdSchema.safeParse('spiritStone').success).toBe(true);
    expect(stableIdSchema.safeParse('Spirit').success).toBe(false);
    expect(stableIdSchema.safeParse('1abc').success).toBe(false);
    expect(stableIdSchema.safeParse('spirit_stone').success).toBe(false);
  });

  it('UTC 时间必须带毫秒与 Z', () => {
    expect(utcIsoTimeSchema.safeParse(new Date().toISOString()).success).toBe(true);
    expect(utcIsoTimeSchema.safeParse('2026-09-17T07:00:00Z').success).toBe(false);
    expect(utcIsoTimeSchema.safeParse('2026-09-17T15:00:00.000+08:00').success).toBe(false);
    expect(utcIsoTimeSchema.safeParse('2026-09-17').success).toBe(false);
  });

  it('幂等键：8～128 个可打印非空白字符', () => {
    expect(idempotencyKeySchema.safeParse('abcdefgh').success).toBe(true);
    expect(idempotencyKeySchema.safeParse('a'.repeat(128)).success).toBe(true);
    expect(idempotencyKeySchema.safeParse('abcdefg').success).toBe(false);
    expect(idempotencyKeySchema.safeParse('a'.repeat(129)).success).toBe(false);
    expect(idempotencyKeySchema.safeParse('has space').success).toBe(false);
  });

  it('分页查询：默认 20、上限 100、拒绝未声明参数与非法游标', () => {
    expect(paginationQuerySchema.parse({}).limit).toBe(20);
    expect(paginationQuerySchema.parse({ limit: '25' }).limit).toBe(25);
    expect(paginationQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ cursor: 'abc', extra: 'x' }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ cursor: '' }).success).toBe(false);
  });
});
