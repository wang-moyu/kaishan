import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { GameServerRepository } from '../src/infra/db/repositories';
import { respondOk } from '../src/http/envelope';

import { createCapturingLogger } from './support/memoryLogger';

/**
 * 错误映射与不泄露（P0-03 验收：内部异常不泄露堆栈/SQL）。
 *
 * 说明：这里用 createApp() + 测试专用探针路由，探针只存在于测试内，
 * 不会进入生产 Worker（生产入口是 src/index.ts）。
 */
describe('错误映射与响应安全（P0-03）', () => {
  it('未预期异常返回 500 INTERNAL_ERROR，响应不含堆栈或 SQL', async () => {
    const capturing = createCapturingLogger();
    const app = createApp({ logger: capturing.logger });

    app.get('/api/v1/__probe/boom', () => {
      throw new Error('boom: SELECT * FROM users WHERE password_hash = ?');
    });

    const response = await app.request('https://example.com/api/v1/__probe/boom', undefined, env);
    const text = await response.text();
    const body = JSON.parse(text) as {
      ok: boolean;
      error: { code: string; message: string; details?: unknown };
      requestId: string;
    };

    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('服务器内部错误');
    expect(body.error.details).toBeUndefined();

    // 响应里没有 SQL、没有堆栈、没有原始错误文本
    expect(text).not.toContain('SELECT');
    expect(text).not.toContain('password_hash');
    expect(text).not.toContain('boom');
    expect(text).not.toContain('at ');

    // 排查信息只在日志里（带同一个 requestId）
    const errorLogs = capturing.parsed().filter((line) => line.event === 'unhandled_error');
    expect(errorLogs).toHaveLength(1);
    expect(errorLogs[0]?.requestId).toBe(body.requestId);
    expect(String(errorLogs[0]?.message)).toContain('boom');
  });

  it('数据库错误返回 503，且不泄露表名与 SQL', async () => {
    const capturing = createCapturingLogger();
    const app = createApp({ logger: capturing.logger });

    // 本文件不应用迁移：查询真实存在的 game_servers 表会因缺表失败
    app.get('/api/v1/__probe/db', async (c) => {
      const repository = new GameServerRepository(c.env.DB);
      return respondOk(c, { servers: await repository.countAll() });
    });

    const response = await app.request('https://example.com/api/v1/__probe/db', undefined, env);
    const text = await response.text();
    const body = JSON.parse(text) as {
      ok: boolean;
      error: { code: string; message: string; details?: { reason?: string } };
    };

    expect(response.status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('TEMPORARILY_UNAVAILABLE');
    expect(body.error.details?.reason).toBe('DB_UNAVAILABLE');
    expect(text).not.toContain('game_servers');
    expect(text).not.toContain('SELECT');
    expect(text).not.toContain('no such table');

    const dbLogs = capturing.parsed().filter((line) => line.event === 'db_error');
    expect(dbLogs).toHaveLength(1);
    expect(dbLogs[0]?.kind).toBe('unavailable');
  });

  it('业务错误按错误码返回固定状态，且不重复记日志', async () => {
    const capturing = createCapturingLogger();
    const app = createApp({ logger: capturing.logger });

    const response = await app.request(
      'https://example.com/api/v1/config/public?version=p9',
      undefined,
      env,
    );
    expect(response.status).toBe(404);

    const events = capturing.parsed().map((line) => line.event);
    expect(events).toEqual(['http_error']);

    // 只有错误日志，没有成功访问日志（每个请求一行）
    const liveResponse = await app.request(
      'https://example.com/api/v1/health/live',
      undefined,
      env,
    );
    expect(liveResponse.status).toBe(200);
    expect(capturing.parsed().filter((line) => line.event === 'http_request')).toHaveLength(1);
  });
});
