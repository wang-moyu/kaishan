import { describe, expect, it } from 'vitest';

import { createJsonLogger, describeError } from '../src/infra/logging/logger';
import { redact } from '../src/infra/logging/redact';

/** 日志脱敏（P0-03 测试项：敏感字段脱敏）。 */
describe('日志脱敏与结构化日志', () => {
  it('按键名打码：password/token/cookie/authorization/csrf/hash/secret', () => {
    const redacted = redact({
      account: 'alice',
      password: 'plain-text',
      passwordHash: 'abc',
      tokenHash: 'def',
      cookie: 'session=1',
      authorization: 'Bearer x',
      csrfToken: 'csrf-value',
      apiKey: 'k',
      nested: { secretValue: 's', keep: 1 },
      list: [{ accessToken: 't' }],
    }) as Record<string, unknown>;

    expect(redacted.account).toBe('alice');
    expect(redacted.password).toBe('[REDACTED]');
    expect(redacted.passwordHash).toBe('[REDACTED]');
    expect(redacted.tokenHash).toBe('[REDACTED]');
    expect(redacted.cookie).toBe('[REDACTED]');
    expect(redacted.authorization).toBe('[REDACTED]');
    expect(redacted.csrfToken).toBe('[REDACTED]');
    expect(redacted.apiKey).toBe('[REDACTED]');
    expect(redacted.nested).toEqual({ secretValue: '[REDACTED]', keep: 1 });
    expect(redacted.list).toEqual([{ accessToken: '[REDACTED]' }]);
  });

  it('日志行是单行 JSON，且已脱敏', () => {
    const lines: string[] = [];
    const logger = createJsonLogger((line) => lines.push(line));

    logger.info('login_attempt', { account: 'alice', password: 'plain-text', token: 't' });

    expect(lines).toHaveLength(1);
    const line = lines[0] ?? '';
    expect(line.includes('\n')).toBe(false);

    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.level).toBe('info');
    expect(parsed.event).toBe('login_attempt');
    expect(parsed.account).toBe('alice');
    expect(parsed.password).toBe('[REDACTED]');
    expect(parsed.token).toBe('[REDACTED]');
    expect(line).not.toContain('plain-text');
    expect(new Date(String(parsed.time)).toISOString()).toBe(parsed.time);
  });

  it('异常被压成 name/message，不带上自定义字段', () => {
    expect(describeError(new TypeError('bad input'))).toEqual({
      name: 'TypeError',
      message: 'bad input',
    });
    expect(describeError('plain failure')).toEqual({
      name: 'UnknownError',
      message: 'plain failure',
    });
  });
});
