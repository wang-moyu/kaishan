import { applyD1Migrations, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { SessionRepository, UserRepository } from '../src/modules/auth/repository';

import { dataOf, envWith, errorOf, TestClient } from './support/authClient';
import { createCapturingLogger } from './support/memoryLogger';

/**
 * 鉴权安全（P0-04）：A01 未登录私有接口、A02 跨源/CSRF、A05 限频与日志无密码。
 *
 * 限频按「来源 IP + 账号」双维度计数：这里给每个用例指定独立的 cf-connecting-ip，
 * 避免同一个文件的用例互相把对方的计数打满（pool-workers 没有逐用例回滚）。
 */

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

const quietLogger = { info: () => {}, warn: () => {}, error: () => {} };
const app = createApp({ logger: quietLogger });

const REGISTRATION_OPEN = { REGISTRATION_ENABLED: 'true', INVITE_CODES: 'invite-alpha' };
const PASSWORD = 'password-123456';

function clientWithIp(ip: string, overrides: Record<string, string> = REGISTRATION_OPEN): TestClient {
  return new TestClient(app, envWith(env, overrides), { 'cf-connecting-ip': ip });
}

async function registerVia(api: TestClient, account: string): Promise<void> {
  const result = await api.post('/api/v1/auth/register', {
    account,
    password: PASSWORD,
    inviteCode: 'invite-alpha',
  });
  expect(result.status).toBe(200);
}

describe('A01 未登录访问私有接口', () => {
  it('/api/v1/auth/me 返回 401，且不产生任何写入', async () => {
    const sessionsBefore = await new SessionRepository(env.DB).countAll();
    const usersBefore = await new UserRepository(env.DB).countAll();

    const api = new TestClient(app, envWith(env, REGISTRATION_OPEN));
    const result = await api.get('/api/v1/auth/me');

    expect(result.status).toBe(401);
    expect(errorOf(result).code).toBe('UNAUTHENTICATED');
    expect(await new SessionRepository(env.DB).countAll()).toBe(sessionsBefore);
    expect(await new UserRepository(env.DB).countAll()).toBe(usersBefore);
  });

  it('伪造的 session Cookie 不会通过（401）', async () => {
    const api = new TestClient(app, envWith(env, REGISTRATION_OPEN));
    const result = await api.get('/api/v1/auth/me', {
      headers: { cookie: 'session=forged-token-value' },
    });

    expect(result.status).toBe(401);
  });
});

describe('A02 跨源与 CSRF', () => {
  it('写请求缺少 Origin 直接被拒（403 CSRF_INVALID）', async () => {
    const api = clientWithIp('203.0.113.20');
    await registerVia(api, 'origin-missing');

    const result = await api.post('/api/v1/auth/logout', {}, { origin: null });
    expect(result.status).toBe(403);
    expect(errorOf(result).code).toBe('CSRF_INVALID');
  });

  it('跨源写请求被拒（即使带着正确的 CSRF 令牌）', async () => {
    const api = clientWithIp('203.0.113.21');
    await registerVia(api, 'cross-origin');

    const result = await api.post('/api/v1/auth/logout', {}, { origin: 'https://evil.example' });
    expect(result.status).toBe(403);
    expect(errorOf(result).code).toBe('CSRF_INVALID');
  });

  it('已登录但缺 CSRF 头不能写（403），退出未发生', async () => {
    const api = clientWithIp('203.0.113.22');
    await registerVia(api, 'csrf-missing');
    const user = await new UserRepository(env.DB).findByAccount('csrf-missing');

    const result = await api.post('/api/v1/auth/logout', {}, { csrfToken: null });

    expect(result.status).toBe(403);
    expect(errorOf(result).code).toBe('CSRF_INVALID');
    // 会话仍然有效
    expect(await new SessionRepository(env.DB).countActiveForUser(user?.id ?? '', Date.now())).toBe(1);
  });

  it('CSRF 头与 Cookie 不一致、或值被篡改都返回 403', async () => {
    const api = clientWithIp('203.0.113.23');
    await registerVia(api, 'csrf-mismatch');

    const mismatch = await api.post('/api/v1/auth/logout', {}, { csrfToken: 'not-the-cookie-value' });
    expect(mismatch.status).toBe(403);

    const tampered = await api.post('/api/v1/auth/logout', {}, {
      csrfToken: `${api.cookie('csrf') ?? ''}x`,
      headers: { cookie: `csrf=${api.cookie('csrf') ?? ''}x` },
    });
    expect(tampered.status).toBe(403);
    expect(errorOf(tampered).code).toBe('CSRF_INVALID');
  });

  it('同源 + 正确 CSRF 才能执行写操作（退出成功）', async () => {
    const api = clientWithIp('203.0.113.24');
    await registerVia(api, 'csrf-ok');

    const result = await api.post('/api/v1/auth/logout', {});
    expect(result.status).toBe(200);
    expect(dataOf(result).loggedOut).toBe(true);
    expect((await api.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('未登录的写请求返回 401（而不是 403），且不写入', async () => {
    const sessionsBefore = await new SessionRepository(env.DB).countAll();
    const api = new TestClient(app, envWith(env, REGISTRATION_OPEN));

    const result = await api.post('/api/v1/auth/logout', {});
    expect(result.status).toBe(401);
    expect(await new SessionRepository(env.DB).countAll()).toBe(sessionsBefore);
  });
});

describe('A05 限频与日志', () => {
  it('同一账号连续失败达到上限后返回 429（跨实例一致的 D1 计数）', async () => {
    const ip = '203.0.113.30';
    const api = clientWithIp(ip);
    await registerVia(api, 'locked-account');

    const attacker = clientWithIp(ip, { REGISTRATION_ENABLED: 'false', INVITE_CODES: '' });
    const attempts: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      const result = await attacker.post('/api/v1/auth/login', {
        account: 'locked-account',
        password: 'wrong-password-1',
      });
      attempts.push(result.status);
    }

    // 前 5 次是「密码错误」，第 6 次被限频挡住
    expect(attempts.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(attempts[5]).toBe(429);

    const blocked = await attacker.post('/api/v1/auth/login', {
      account: 'locked-account',
      password: PASSWORD,
    });
    expect(blocked.status).toBe(429);
    expect(errorOf(blocked).details?.retryAfterSeconds).toBeTypeOf('number');
  });

  it('任一账号的失败会累积到来源 IP 维度（换账号也挡）', async () => {
    const ip = '203.0.113.31';
    const attacker = clientWithIp(ip, { REGISTRATION_ENABLED: 'false', INVITE_CODES: '' });

    for (let index = 0; index < 5; index += 1) {
      const result = await attacker.post('/api/v1/auth/login', {
        account: `nonexistent-${index}`,
        password: 'wrong-password-1',
      });
      expect(result.status).toBe(401);
    }

    const blocked = await attacker.post('/api/v1/auth/login', {
      account: 'another-nonexistent',
      password: 'wrong-password-1',
    });
    expect(blocked.status).toBe(429);
  });

  it('成功登录会清零失败计数（正常用户不会被自己的失败卡住）', async () => {
    const ip = '203.0.113.32';
    const api = clientWithIp(ip);
    await registerVia(api, 'reset-counter');

    const user = clientWithIp(ip, { REGISTRATION_ENABLED: 'false', INVITE_CODES: '' });
    for (let index = 0; index < 4; index += 1) {
      expect(
        (await user.post('/api/v1/auth/login', { account: 'reset-counter', password: 'wrong-password-1' })).status,
      ).toBe(401);
    }

    const success = await user.post('/api/v1/auth/login', { account: 'reset-counter', password: PASSWORD });
    expect(success.status).toBe(200);

    // 清零后可以继续失败而不立刻被挡住
    const afterReset = await user.post('/api/v1/auth/login', {
      account: 'reset-counter',
      password: 'wrong-password-1',
    });
    expect(afterReset.status).toBe(401);
  });

  it('注册接口按来源 IP 限频', async () => {
    const ip = '203.0.113.33';
    const api = clientWithIp(ip);

    const statuses: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      const result = await api.post('/api/v1/auth/register', {
        account: `flood-${index}`,
        password: PASSWORD,
        inviteCode: 'invite-alpha',
      });
      statuses.push(result.status);
    }

    expect(statuses.slice(0, 5).every((status) => status === 200)).toBe(true);
    expect(statuses[5]).toBe(429);
  });

  it('日志里没有密码、会话令牌或 CSRF 值', async () => {
    const capturing = createCapturingLogger();
    const loggingApp = createApp({ logger: capturing.logger });
    const api = new TestClient(loggingApp, envWith(env, REGISTRATION_OPEN), {
      'cf-connecting-ip': '203.0.113.34',
    });

    await registerVia(api, 'log-case');
    const sessionToken = api.cookie('session') ?? '';
    const csrfToken = api.cookie('csrf') ?? '';
    await api.post('/api/v1/auth/login', { account: 'log-case', password: PASSWORD });
    await api.post('/api/v1/auth/logout', {});

    const logText = capturing.lines.join('\n');
    expect(logText.length).toBeGreaterThan(0);
    expect(logText).not.toContain(PASSWORD);
    expect(logText).not.toContain(sessionToken);
    expect(logText).not.toContain(csrfToken);
    expect(logText).not.toContain('invite-alpha');

    // 事件名与 requestId 保留，便于排查
    const events = capturing.parsed().map((line) => line.event);
    expect(events).toContain('auth_registered');
    expect(events).toContain('auth_login_succeeded');
    expect(events).toContain('auth_logout');
    for (const line of capturing.parsed()) {
      expect(typeof line.requestId).toBe('string');
    }
  });
});
