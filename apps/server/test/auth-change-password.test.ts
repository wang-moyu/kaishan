import { applyD1Migrations, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app';

import { dataOf, envWith, errorOf, TestClient } from './support/authClient';

/**
 * 修改密码（POST /auth/change-password）：旧密码校验、新旧相同、限频、其他会话失效、当前会话保留。
 *
 * 存储提醒：pool-workers 无逐用例回滚，每个用例使用独立账号与独立来源 IP。
 */

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

const quietLogger = { info: () => {}, warn: () => {}, error: () => {} };
const app = createApp({ logger: quietLogger });

const PASSWORD = 'password-123456';
const NEW_PASSWORD = 'new-password-654321';
const OVERRIDES = {
  ENVIRONMENT: 'local',
  REGISTRATION_ENABLED: 'true',
  INVITE_CODES: 'invite-alpha',
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS: '3',
};

let ipSequence = 0;

function client(): TestClient {
  ipSequence += 1;
  return new TestClient(app, envWith(env, OVERRIDES), {
    'cf-connecting-ip': `203.0.113.${ipSequence}`,
  });
}

async function register(account: string): Promise<TestClient> {
  const api = client();
  const result = await api.post('/api/v1/auth/register', {
    account,
    password: PASSWORD,
    inviteCode: 'invite-alpha',
  });
  expect(result.status).toBe(200);
  return api;
}

async function login(account: string, password: string): Promise<{ api: TestClient; status: number }> {
  const api = client();
  const result = await api.post('/api/v1/auth/login', { account, password });
  return { api, status: result.status };
}

describe('修改密码', () => {
  it('成功：新密码可登录、旧密码失效；其他设备下线，当前设备保持登录', async () => {
    const current = await register('pw-ok');
    const other = await login('pw-ok', PASSWORD);
    expect(other.status).toBe(200);

    const result = await current.post('/api/v1/auth/change-password', {
      oldPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(result.status).toBe(200);
    expect(dataOf(result)).toMatchObject({ changed: true, revokedSessions: 1 });

    expect((await current.get('/api/v1/auth/me')).status).toBe(200);
    expect((await other.api.get('/api/v1/auth/me')).status).toBe(401);
    expect((await login('pw-ok', PASSWORD)).status).toBe(401);
    expect((await login('pw-ok', NEW_PASSWORD)).status).toBe(200);
  });

  it('旧密码错误：400 VALIDATION_ERROR（不是 401，不会把当前会话踢下线），密码不变', async () => {
    const api = await register('pw-wrong');
    const result = await api.post('/api/v1/auth/change-password', {
      oldPassword: 'not-my-password',
      newPassword: NEW_PASSWORD,
    });
    expect(result.status).toBe(400);
    expect(errorOf(result)).toMatchObject({ code: 'VALIDATION_ERROR', message: '当前密码不正确' });
    expect((await api.get('/api/v1/auth/me')).status).toBe(200);
    expect((await login('pw-wrong', PASSWORD)).status).toBe(200);
  });

  it('新旧密码相同：400，不写库', async () => {
    const api = await register('pw-same');
    const result = await api.post('/api/v1/auth/change-password', {
      oldPassword: PASSWORD,
      newPassword: PASSWORD,
    });
    expect(result.status).toBe(400);
    expect(errorOf(result).message).toBe('新密码不能与当前密码相同');
  });

  it('新密码不合规（过短）与未声明字段：400', async () => {
    const api = await register('pw-short');
    expect(
      (await api.post('/api/v1/auth/change-password', { oldPassword: PASSWORD, newPassword: '123' })).status,
    ).toBe(400);
    expect(
      (
        await api.post('/api/v1/auth/change-password', {
          oldPassword: PASSWORD,
          newPassword: NEW_PASSWORD,
          userId: 'someone-else',
        })
      ).status,
    ).toBe(400);
  });

  it('旧密码连续输错达到上限后 429，即使随后给出正确旧密码也被挡住', async () => {
    const api = await register('pw-limit');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const wrong = await api.post('/api/v1/auth/change-password', {
        oldPassword: `wrong-password-${attempt}`,
        newPassword: NEW_PASSWORD,
      });
      expect(wrong.status).toBe(400);
    }
    const blocked = await api.post('/api/v1/auth/change-password', {
      oldPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(blocked.status).toBe(429);
    // 与登录共用账号计数：换一台设备登录也被挡住
    expect((await login('pw-limit', PASSWORD)).status).toBe(429);
  });

  it('未登录：401；缺 CSRF：403', async () => {
    const anonymous = client();
    const unauth = await anonymous.post('/api/v1/auth/change-password', {
      oldPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(unauth.status).toBe(401);

    const api = await register('pw-csrf');
    const noCsrf = await api.post(
      '/api/v1/auth/change-password',
      { oldPassword: PASSWORD, newPassword: NEW_PASSWORD },
      { csrfToken: null },
    );
    expect(noCsrf.status).toBe(403);
  });
});
