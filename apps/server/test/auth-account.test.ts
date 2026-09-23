import { applyD1Migrations, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { SessionRepository, UserRepository } from '../src/modules/auth/repository';
import { revokeAllSessionsForUser } from '../src/modules/auth/service';

import { dataOf, envWith, errorOf, TestClient } from './support/authClient';

/**
 * 账号与会话（P0-04）：注册开关/邀请码、重复账号、登录、Cookie 属性、me、退出、撤销与过期。
 *
 * 存储提醒：pool-workers 0.22 无逐用例回滚，同一文件内数据会累积，
 * 因此每个用例使用独立账号，涉及计数的断言写成相对值。
 */

// 应用 P0 迁移（0001~0003，含 sessions.csrf_token_hash 与 auth_rate_limits）
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

const quietLogger = { info: () => {}, warn: () => {}, error: () => {} };
const app = createApp({ logger: quietLogger });

const LOCAL_ENV = { ENVIRONMENT: 'local' } as const;
const REGISTRATION_OPEN = {
  ...LOCAL_ENV,
  REGISTRATION_ENABLED: 'true',
  INVITE_CODES: 'invite-alpha',
};
const REGISTRATION_CLOSED = {
  ...LOCAL_ENV,
  REGISTRATION_ENABLED: 'false',
  INVITE_CODES: '',
};

/**
 * 每个客户端分配独立的来源 IP：
 * 注册接口按来源 IP 限频（固定窗口，默认 5 次/60s），而 pool-workers 没有逐用例回滚，
 * 同文件内共用默认 IP 会让前面的注册用例把配额打满，后面的注册直接 429。
 * 想要验证限频行为请显式指定 IP（见 auth-security.test.ts）。
 */
let ipSequence = 0;

function client(overrides: Record<string, string> = REGISTRATION_CLOSED): TestClient {
  ipSequence += 1;
  return new TestClient(app, envWith(env, overrides), {
    'cf-connecting-ip': `198.51.100.${ipSequence}`,
  });
}

async function userCount(): Promise<number> {
  return new UserRepository(env.DB).countAll();
}

describe('注册', () => {
  it('注册关闭时不可绕过：即使带邀请码也返回 403，且不写入用户', async () => {
    const before = await userCount();
    const api = client(REGISTRATION_CLOSED);

    const result = await api.post('/api/v1/auth/register', {
      account: 'closed-case',
      password: 'password-123456',
      inviteCode: 'invite-alpha',
    });

    expect(result.status).toBe(403);
    expect(errorOf(result).code).toBe('FORBIDDEN');
    expect(await userCount()).toBe(before);
    expect(api.cookie('session')).toBeUndefined();
  });

  it('注册开启时邀请码错误返回 403，正确时建号建会话并下发 Cookie', async () => {
    const api = client(REGISTRATION_OPEN);

    const wrong = await api.post('/api/v1/auth/register', {
      account: 'invite-case',
      password: 'password-123456',
      inviteCode: 'not-the-code',
    });
    expect(wrong.status).toBe(403);

    const before = await userCount();
    const ok = await api.post('/api/v1/auth/register', {
      account: 'Invite-Case',
      password: 'password-123456',
      inviteCode: 'invite-alpha',
    });

    expect(ok.status).toBe(200);
    const data = dataOf(ok);
    expect((data.user as Record<string, unknown>).account).toBe('invite-case');
    expect(typeof data.csrfToken).toBe('string');
    expect(await userCount()).toBe(before + 1);

    // Cookie 属性：session 必须 HttpOnly + SameSite=Lax + Path=/；csrf 需要被 JS 读取
    const sessionCookie = ok.setCookies.find((raw) => raw.startsWith('session='));
    const csrfCookie = ok.setCookies.find((raw) => raw.startsWith('csrf='));
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('SameSite=Lax');
    expect(sessionCookie).toContain('Path=/');
    expect(sessionCookie).not.toContain('Secure');
    expect(csrfCookie).not.toContain('HttpOnly');
    expect(csrfCookie).toContain('SameSite=Lax');

    // 数据库只存摘要：token_hash / csrf_token_hash 都不等于 Cookie 里的原文
    const user = await new UserRepository(env.DB).findByAccount('invite-case');
    expect(user).not.toBeNull();
    expect(user?.password_hash.startsWith('$argon2id$')).toBe(true);
    expect(user?.password_hash).not.toContain('password-123456');

    const sessionToken = api.cookie('session');
    const csrfToken = api.cookie('csrf');
    const sessions = await env.DB.prepare('SELECT token_hash, csrf_token_hash FROM sessions WHERE user_id = ?')
      .bind(user?.id)
      .all<{ token_hash: string; csrf_token_hash: string }>();
    const stored = sessions.results?.[0];
    expect(stored?.token_hash).toBeDefined();
    expect(stored?.token_hash).not.toBe(sessionToken);
    expect(stored?.csrf_token_hash).not.toBe(csrfToken);
  });

  it('重复账号返回 409 且不会创建第二个用户', async () => {
    const api = client(REGISTRATION_OPEN);
    const payload = { account: 'duplicate-case', password: 'password-123456', inviteCode: 'invite-alpha' };

    expect((await api.post('/api/v1/auth/register', payload)).status).toBe(200);
    const after = await userCount();

    const again = await api.post('/api/v1/auth/register', payload);
    expect(again.status).toBe(409);
    expect(errorOf(again).code).toBe('STATE_CONFLICT');
    expect(await userCount()).toBe(after);
  });

  it('严格输入：短密码、非法账号、未声明字段都返回 400', async () => {
    const api = client(REGISTRATION_OPEN);

    expect(
      (await api.post('/api/v1/auth/register', { account: 'short-pwd', password: '123', inviteCode: 'invite-alpha' }))
        .status,
    ).toBe(400);
    expect(
      (await api.post('/api/v1/auth/register', { account: 'bad account', password: 'password-123456' })).status,
    ).toBe(400);
    expect(
      (
        await api.post('/api/v1/auth/register', {
          account: 'extra-field',
          password: 'password-123456',
          inviteCode: 'invite-alpha',
          isAdmin: true,
        })
      ).status,
    ).toBe(400);
  });
});

describe('登录与会话', () => {
  it('登录不需要预先持有 session token，成功后下发新会话', async () => {
    const registerApi = client(REGISTRATION_OPEN);
    await registerApi.post('/api/v1/auth/register', {
      account: 'login-case',
      password: 'password-123456',
      inviteCode: 'invite-alpha',
    });

    // 全新客户端：没有任何 Cookie
    const loginApi = client(REGISTRATION_CLOSED);
    expect(loginApi.cookie('session')).toBeUndefined();

    const result = await loginApi.post('/api/v1/auth/login', {
      account: 'login-case',
      password: 'password-123456',
    });

    expect(result.status).toBe(200);
    expect(dataOf(result).csrfToken).toBeTypeOf('string');
    expect(loginApi.cookie('session')).toBeDefined();

    const me = await loginApi.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    const meData = dataOf(me);
    expect((meData.user as Record<string, unknown>).account).toBe('login-case');
    expect(meData.sect).toBeNull();
  });

  it('错误密码与不存在的账号返回完全相同的错误（不泄露账号存在性）', async () => {
    const registerApi = client(REGISTRATION_OPEN);
    await registerApi.post('/api/v1/auth/register', {
      account: 'enum-case',
      password: 'password-123456',
      inviteCode: 'invite-alpha',
    });

    const wrongPassword = await client().post('/api/v1/auth/login', {
      account: 'enum-case',
      password: 'wrong-password-123',
    });
    const unknownAccount = await client().post('/api/v1/auth/login', {
      account: 'no-such-account',
      password: 'wrong-password-123',
    });

    expect(wrongPassword.status).toBe(401);
    expect(unknownAccount.status).toBe(401);
    expect(errorOf(wrongPassword)).toEqual(errorOf(unknownAccount));
    // 响应体形状一致（只允许 requestId 不同）
    expect(Object.keys(wrongPassword.body).sort()).toEqual(Object.keys(unknownAccount.body).sort());
  });

  it('退出后再访问 me 返回 401，且会话被标记撤销', async () => {
    const api = client(REGISTRATION_OPEN);
    await api.post('/api/v1/auth/register', {
      account: 'logout-case',
      password: 'password-123456',
      inviteCode: 'invite-alpha',
    });

    expect((await api.get('/api/v1/auth/me')).status).toBe(200);
    expect((await api.post('/api/v1/auth/logout', {})).status).toBe(200);
    expect((await api.get('/api/v1/auth/me')).status).toBe(401);

    const user = await new UserRepository(env.DB).findByAccount('logout-case');
    const active = await new SessionRepository(env.DB).countActiveForUser(
      user?.id ?? '',
      Date.now(),
    );
    expect(active).toBe(0);
  });

  it('受控撤销（管理脚本走的同一路径）会让所有会话立即失效', async () => {
    const api = client(REGISTRATION_OPEN);
    await api.post('/api/v1/auth/register', {
      account: 'revoke-case',
      password: 'password-123456',
      inviteCode: 'invite-alpha',
    });
    expect((await api.get('/api/v1/auth/me')).status).toBe(200);

    const user = await new UserRepository(env.DB).findByAccount('revoke-case');
    const revoked = await revokeAllSessionsForUser(env.DB, Date.now(), user?.id ?? '');

    expect(revoked).toBeGreaterThan(0);
    expect((await api.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('过期会话失效（即使 Cookie 与服务端摘要都正确）', async () => {
    const api = client(REGISTRATION_OPEN);
    await api.post('/api/v1/auth/register', {
      account: 'expire-case',
      password: 'password-123456',
      inviteCode: 'invite-alpha',
    });

    const user = await new UserRepository(env.DB).findByAccount('expire-case');
    await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE user_id = ?')
      .bind(Date.now() - 1000, user?.id)
      .run();

    const me = await api.get('/api/v1/auth/me');
    expect(me.status).toBe(401);
    expect(errorOf(me).code).toBe('UNAUTHENTICATED');
  });

  it('production 环境下的 Cookie 带 Secure', async () => {
    const api = client({ ...REGISTRATION_OPEN, ENVIRONMENT: 'production' });
    const result = await api.post('/api/v1/auth/register', {
      account: 'secure-case',
      password: 'password-123456',
      inviteCode: 'invite-alpha',
    });

    const sessionCookie = result.setCookies.find((raw) => raw.startsWith('session='));
    expect(sessionCookie).toContain('Secure');
    expect(sessionCookie).toContain('HttpOnly');
  });
});
