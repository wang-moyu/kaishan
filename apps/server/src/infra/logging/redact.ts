/**
 * 日志脱敏（02 第 5 节：日志不得输出 secret/token/密码）。
 *
 * 只按**键名**判断，不改动值本身：密钥类字段整体替换为 [REDACTED]，
 * 避免把 token/密码写进 Workers 日志与第三方日志平台。
 */
const SENSITIVE_KEY_PATTERN = /(pass(word)?|secret|token|cookie|authorization|csrf|hash|apikey|api_key)/iu;

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) {
    return '[TRUNCATED]';
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      result[key] = isSensitiveKey(key) ? REDACTED : redact(child, depth + 1);
    }
    return result;
  }

  return value;
}
