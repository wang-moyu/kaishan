import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app';

import { createCapturingLogger } from './support/memoryLogger';

/**
 * 统一响应包与基础路由（P0-03）。
 * 本文件不需要迁移：只覆盖不依赖业务表的路由与错误路径。
 */
describe('统一响应包（P0-03）', () => {
  it('live 返回标准成功包：ok/data/requestId/serverTime', async () => {
    const response = await SELF.fetch('https://example.com/api/v1/health/live');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');

    const body = (await response.json()) as {
      ok: boolean;
      data: { status: string; configVersion: string };
      requestId: string;
      serverTime: string;
    };

    expect(body.ok).toBe(true);
    expect(body.data.status).toBe('live');
    expect(body.data.configVersion).toBe('v5.1.0');
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(new Date(body.serverTime).toISOString()).toBe(body.serverTime);
  });

  it('未知路由返回 JSON 404 错误包，且带 requestId', async () => {
    const response = await SELF.fetch('https://example.com/api/v1/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');

    const text = await response.text();
    const body = JSON.parse(text) as {
      ok: boolean;
      error: { code: string; message: string };
      requestId: string;
    };

    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(text).not.toContain('<html');
  });

  it('已退役的 /api/health 不再存在', async () => {
    const response = await SELF.fetch('https://example.com/api/health');

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('公开配置只返回白名单 section，未声明的查询参数返回 400', async () => {
    const ok = await SELF.fetch('https://example.com/api/v1/config/public');
    expect(ok.status).toBe(200);
    const okBody = (await ok.json()) as {
      data: { version: string; config: Record<string, unknown> };
    };
    expect(okBody.data.version).toBe('v5.1.0');
    expect(Object.keys(okBody.data.config).sort()).toEqual([
      'breakthrough',
      'buildings',
      'cultivation',
      'offlineCapSeconds',
      'positions',
      'recruitment',
      'resources',
      'sect',
      'server',
    ]);

    const bad = await SELF.fetch('https://example.com/api/v1/config/public?unexpected=1');
    expect(bad.status).toBe(400);
    const badBody = (await bad.json()) as {
      ok: boolean;
      error: { code: string; details?: { fields?: { path: string }[] } };
    };
    expect(badBody.ok).toBe(false);
    expect(badBody.error.code).toBe('VALIDATION_ERROR');
    expect(badBody.error.details?.fields?.map((field) => field.path)).toContain('unexpected');

    const unknownVersion = await SELF.fetch('https://example.com/api/v1/config/public?version=p9');
    expect(unknownVersion.status).toBe(404);
  });

  it('每个请求的日志 requestId 与响应包一致', async () => {
    const capturing = createCapturingLogger();
    const app = createApp({ logger: capturing.logger });

    const response = await app.request('https://example.com/api/v1/health/live', undefined, env);
    const body = (await response.json()) as { requestId: string };

    const requestLogs = capturing.parsed().filter((line) => line.event === 'http_request');
    expect(requestLogs).toHaveLength(1);
    expect(requestLogs[0]?.requestId).toBe(body.requestId);
    expect(requestLogs[0]?.status).toBe(200);
    expect(typeof requestLogs[0]?.durationMs).toBe('number');
  });
});
