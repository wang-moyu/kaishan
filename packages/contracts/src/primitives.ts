import { z } from 'zod';

/**
 * 公共标量 schema（见 03 第 1 节、04 第 1 节）。
 *
 * 约定：
 * - 资源/金额：API 传「最小单位」的十进制整数字符串（1 展示单位 = 1000 最小单位），
 *   落库前用 toSafeAmountNumber 转成安全整数，绝不直接绑定 BigInt。
 * - 计数、基点：JSON number；基点范围 0～10000。
 * - 时间：UTC ISO 8601 字符串（毫秒 + Z），服务端时间才有裁决权。
 * - 所有对象 schema 一律严格：未声明字段直接拒绝。
 */

/** 1 展示单位 = 1000 最小单位。 */
export const MIN_UNITS_PER_DISPLAY_UNIT = 1000;

/**
 * 单值绝对上限（03 第 1 节）：1e15，且小于 Number.MAX_SAFE_INTEGER（9007199254740991）。
 */
export const MAX_AMOUNT_MIN_UNITS = 1_000_000_000_000_000n;

/** 安全整数上限（02 第 4 节）：转 number 前必须校验。 */
export const MAX_SAFE_AMOUNT = Number(MAX_AMOUNT_MIN_UNITS);

/** 超出安全范围（转换前拦截，不依赖 SQLite 溢出后的静默转换）。 */
export class AmountOutOfRangeError extends Error {
  constructor(readonly value: string) {
    super('金额超出安全范围');
    this.name = 'AmountOutOfRangeError';
  }
}

const decimalPattern = /^(0|[1-9]\d*)$/u;

/** 十进制整数字符串：无正负号、无小数点、无前导零。 */
export const decimalAmountSchema = z
  .string()
  .regex(decimalPattern, '必须是十进制整数字符串（最小单位）')
  .refine(
    // Zod 4 会继续执行后续 refine：这里先确认格式合法再转 BigInt，
    // 否则 '1.5' 这类输入会让 BigInt 抛异常（把 400 变成 500）。
    (value) => !decimalPattern.test(value) || BigInt(value) <= MAX_AMOUNT_MIN_UNITS,
    '金额超出允许上限',
  );

/** 十进制字符串 → 安全整数 number；越界抛 AmountOutOfRangeError。 */
export function toSafeAmountNumber(value: string): number {
  if (!decimalPattern.test(value)) {
    throw new AmountOutOfRangeError(value);
  }
  const parsed = BigInt(value);
  if (parsed > MAX_AMOUNT_MIN_UNITS) {
    throw new AmountOutOfRangeError(value);
  }
  return Number(parsed);
}

/** 安全整数 number → 十进制字符串（写响应与写库前的统一出口）。 */
export function toAmountString(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AmountOutOfRangeError(String(value));
  }
  return String(value);
}

/** 概率/系数基点：0～10000。 */
export const basisPointsSchema = z.int().min(0).max(10_000);

/** 非负计数。 */
export const countSchema = z.int().min(0);

/** 正计数（如等级、容量）。 */
export const positiveIntSchema = z.int().min(1);

/** UUID 字符串（03 第 1 节：ID 使用 UUID 字符串）。 */
export const uuidSchema = z.uuid();

/** 资源/实体稳定 id：小驼峰，字母开头。 */
export const stableIdSchema = z.string().regex(/^[a-z][A-Za-z0-9]*$/u, 'id 必须是小驼峰稳定标识');

/**
 * UTC ISO 8601：必须带毫秒与 Z 后缀（与 toISOString() 一致）。
 * 不接受本地时间、不带时区的时间或带偏移的时间。
 */
export const utcIsoTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u, '必须是 UTC ISO 8601（毫秒 + Z）');

/**
 * 幂等键（04 第 1 节 Idempotency-Key）。
 * 04 未规定长度与字符集，这里定为 8～128 个可打印无空白字符，客户端生成且重试沿用。
 */
export const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[\x21-\x7e]+$/u, '幂等键只能包含可打印非空白字符');

/** 分页默认与上限（04 第 1 节）。 */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** 不透明游标：只由服务端生成与解释。 */
export const cursorSchema = z.string().min(1).max(512);

/** 列表查询：严格对象，未声明参数直接拒绝。 */
export const paginationQuerySchema = z.strictObject({
  cursor: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
