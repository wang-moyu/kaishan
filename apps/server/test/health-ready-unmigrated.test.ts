import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * 本文件刻意**不**应用迁移：用真实的空本地 D1 验证
 * 「数据库不可用时 ready 失败、live 仍能响应」（P0-02 验收，P0-03 保持）。
 * 不是 mock D1：这里就是 workerd 里的真实 D1 绑定，只是没有建表。
 */
describe('健康检查：未迁移的本地 D1', () => {
  it('live 不依赖 D1，仍然返回 200', async () => {
    const response = await SELF.fetch('https://example.com/api/v1/health/live');

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');

    const body = (await response.json()) as { ok: boolean; serverTime: string };
    expect(body.ok).toBe(true);
    expect(new Date(body.serverTime).toISOString()).toBe(body.serverTime);
  });

  it('ready 在缺表时返回 503，且响应不泄露 SQL、表名或连接信息', async () => {
    const response = await SELF.fetch('https://example.com/api/v1/health/ready');

    expect(response.status).toBe(503);

    const text = await response.text();
    const body = JSON.parse(text) as {
      ok: boolean;
      error: { code: string; message: string; details?: { reason: string } };
      requestId: string;
    };

    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('TEMPORARILY_UNAVAILABLE');
    expect(body.error.details?.reason).toBe('DB_SCHEMA_NOT_READY');
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/u);

    expect(text).not.toMatch(/sqlite_master|SELECT |CREATE TABLE|d1_databases|00000000-0000/u);
    expect(text).not.toContain('users');
  });
});
