import type { AuthConfig } from '../../config/authConfig';
import type { DbQueryError } from '../../infra/db/errors';
import { AppError } from '../../http/appError';
import {
  LOGIN_ACCOUNT_BUCKET,
  LOGIN_IP_BUCKET,
  REGISTER_IP_BUCKET,
} from '../../middleware/rateLimit';
import { dummyVerify, hashPassword, needsRehash, verifyPassword } from './password';
import {
  RateLimitRepository,
  SessionRepository,
  UserRepository,
  type UserRow,
} from './repository';
import { normalizeAccount, type LoginRequest, type RegisterRequest } from './schema';
import type { AuthState, UserSummary } from './state';
import { constantTimeEqual, hashToken, randomToken } from './tokens';

/**
 * 账号与会话的服务层（P0-04）。
 *
 * 安全约定：
 * - 登录失败一律返回同一个错误码与文案（不区分「账号不存在」与「密码错误」），
 *   账号不存在时也执行一次等价开销的 Argon2id 校验，避免用响应时间枚举账号；
 * - 限频只统计**失败**次数：成功登录会清零，正常用户不会被自己的登录卡住；
 * - 限频桶名只放 sha256 摘要（账号与来源 IP 都不以明文落库）。
 */
/**
 * 对外返回的账号摘要（不含 password_hash 等内部字段）。
 * 类型定义在 state.ts，避免 http 层与 service 相互 import。
 */
export type { UserSummary };

export interface SessionTokens {
  token: string;
  csrfToken: string;
}

export function toUserSummary(user: UserRow): UserSummary {
  return {
    id: user.id,
    // 返回规范化后的账号（小写），不返回 password_hash 等内部字段
    account: user.normalized_account,
    status: user.status,
    createdAt: new Date(user.created_at).toISOString(),
  };
}

export async function createSession(
  db: D1Database,
  config: AuthConfig,
  now: number,
  userId: string,
): Promise<SessionTokens> {
  const token = randomToken();
  const csrfToken = randomToken();
  const [tokenHash, csrfTokenHash] = await Promise.all([hashToken(token), hashToken(csrfToken)]);

  const sessions = new SessionRepository(db);
  await sessions.insert({
    id: crypto.randomUUID(),
    userId,
    tokenHash,
    csrfTokenHash,
    expiresAt: now + config.sessionTtlSeconds * 1000,
    now,
  });

  return { token, csrfToken };
}

export interface LoadedSession {
  auth: AuthState;
  user: UserRow;
}

/** 校验会话令牌：只查未撤销且未过期的行；令牌本身不落库，只比对摘要。 */
export async function loadSession(
  db: D1Database,
  now: number,
  token: string,
): Promise<LoadedSession | null> {
  const tokenHash = await hashToken(token);
  const sessions = new SessionRepository(db);
  const session = await sessions.findActiveByTokenHash(tokenHash, now);
  if (session === null) {
    return null;
  }

  const users = new UserRepository(db);
  const user = await users.findById(session.user_id);
  if (user === null || user.status !== 'active') {
    return null;
  }

  return {
    auth: {
      sessionId: session.id,
      userId: session.user_id,
      csrfTokenHash: session.csrf_token_hash,
      expiresAt: session.expires_at,
    },
    user,
  };
}

export async function rotateCsrfToken(
  db: D1Database,
  sessionId: string,
): Promise<string> {
  const csrfToken = randomToken();
  const csrfTokenHash = await hashToken(csrfToken);
  await new SessionRepository(db).updateCsrfTokenHash(sessionId, csrfTokenHash);
  return csrfToken;
}

export async function revokeSessionById(db: D1Database, now: number, sessionId: string): Promise<boolean> {
  const changes = await new SessionRepository(db).revokeById(sessionId, now);
  return changes > 0;
}

export async function revokeAllSessionsForUser(db: D1Database, now: number, userId: string): Promise<number> {
  return new SessionRepository(db).revokeAllForUser(userId, now);
}

/** 注册（注册开关与邀请码都由服务端裁决，客户端无法绕过）。 */
export async function registerAccount(
  db: D1Database,
  config: AuthConfig,
  now: number,
  input: RegisterRequest,
): Promise<{ user: UserSummary; tokens: SessionTokens }> {
  const users = new UserRepository(db);
  const account = normalizeAccount(input.account);

  if (!config.registrationEnabled) {
    throw new AppError('FORBIDDEN', '当前未开放注册');
  }
  if (config.inviteCodes.length > 0) {
    const provided = input.inviteCode;
    const matched =
      provided !== undefined && config.inviteCodes.some((code) => constantTimeEqual(code, provided));
    if (!matched) {
      throw new AppError('FORBIDDEN', '邀请码无效');
    }
  }

  if ((await users.findByAccount(account)) !== null) {
    // 说明：注册接口无法完全不泄露「账号是否存在」，此处的取舍记录在验证记录里；
    // 本期是邀请内测，注册入口本身受开关与邀请码限制。
    throw new AppError('STATE_CONFLICT', '账号不可用（可能已被占用）');
  }

  const user: UserRow = {
    id: crypto.randomUUID(),
    normalized_account: account,
    password_hash: hashPassword(input.password),
    status: 'active',
    created_at: now,
    updated_at: now,
  };

  try {
    await users.insert({
      id: user.id,
      normalizedAccount: user.normalized_account,
      passwordHash: user.password_hash,
      status: user.status,
      now,
    });
  } catch (error) {
    // 并发注册撞唯一约束：映射成 409，而不是把数据库错误暴露成 503
    if (isUniqueViolation(error)) {
      throw new AppError('STATE_CONFLICT', '账号不可用（可能已被占用）');
    }
    throw error;
  }

  const tokens = await createSession(db, config, now, user.id);
  return { user: toUserSummary(user), tokens };
}

export interface LoginContext {
  ip: string;
}

/** 登录（requirement：登录不需要预先持有 session token）。 */
export async function loginWithPassword(
  db: D1Database,
  config: AuthConfig,
  now: number,
  input: LoginRequest,
  context: LoginContext,
): Promise<{ user: UserSummary; tokens: SessionTokens; passwordUpgraded: boolean }> {
  const account = normalizeAccount(input.account);
  const rateLimits = new RateLimitRepository(db);
  const accountBucket = LOGIN_ACCOUNT_BUCKET + (await hashToken(account));
  const ipBucket = LOGIN_IP_BUCKET + (await hashToken(context.ip));

  await assertLoginAllowed(rateLimits, config, now, accountBucket, ipBucket);

  const users = new UserRepository(db);
  const user = await users.findByAccount(account);

  if (user === null) {
    // 等价开销：不存在的账号也跑一次 Argon2id，避免用时间区分账号是否存在
    dummyVerify(input.password);
    await registerLoginFailure(rateLimits, config, now, accountBucket, ipBucket);
    throw invalidCredentials();
  }

  if (user.status !== 'active' || !verifyPassword(input.password, user.password_hash)) {
    await registerLoginFailure(rateLimits, config, now, accountBucket, ipBucket);
    throw invalidCredentials();
  }

  // 成功登录：清零失败计数，避免正常用户被历史失败次数卡住
  await Promise.all([rateLimits.clear(accountBucket), rateLimits.clear(ipBucket)]);

  let passwordUpgraded = false;
  if (needsRehash(user.password_hash)) {
    await users.updatePasswordHash(user.id, hashPassword(input.password), now);
    passwordUpgraded = true;
  }

  const tokens = await createSession(db, config, now, user.id);
  return { user: toUserSummary(user), tokens, passwordUpgraded };
}

/** 注册限频：按来源 IP 计数（注册入口默认关闭，这里防的是开放期的批量注册）。 */
export async function assertRegisterAllowed(
  db: D1Database,
  config: AuthConfig,
  now: number,
  ip: string,
): Promise<void> {
  const rateLimits = new RateLimitRepository(db);
  const bucket = REGISTER_IP_BUCKET + (await hashToken(ip));
  const count = await rateLimits.consume(bucket, now, config.loginRateLimit.windowSeconds * 1000);
  if (count > config.loginRateLimit.maxAttempts) {
    throw new AppError('RATE_LIMITED', undefined, {
      retryAfterSeconds: config.loginRateLimit.windowSeconds,
    });
  }
}

async function assertLoginAllowed(
  rateLimits: RateLimitRepository,
  config: AuthConfig,
  now: number,
  accountBucket: string,
  ipBucket: string,
): Promise<void> {
  const windowMs = config.loginRateLimit.windowSeconds * 1000;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const counters = await Promise.all([rateLimits.read(accountBucket), rateLimits.read(ipBucket)]);

  const blocked = counters.some(
    (counter) => counter !== null && counter.windowStart === windowStart && counter.count >= config.loginRateLimit.maxAttempts,
  );
  if (blocked) {
    throw new AppError('RATE_LIMITED', undefined, { retryAfterSeconds: config.loginRateLimit.windowSeconds });
  }
}

async function registerLoginFailure(
  rateLimits: RateLimitRepository,
  config: AuthConfig,
  now: number,
  accountBucket: string,
  ipBucket: string,
): Promise<void> {
  const windowMs = config.loginRateLimit.windowSeconds * 1000;
  await Promise.all([rateLimits.consume(accountBucket, now, windowMs), rateLimits.consume(ipBucket, now, windowMs)]);
}

function invalidCredentials(): AppError {
  // 固定文案：不区分账号不存在 / 密码错误 / 账号被禁用
  return new AppError('UNAUTHENTICATED', '账号或密码不正确');
}

function isUniqueViolation(error: unknown): boolean {
  return (error as DbQueryError | undefined)?.kind === 'unique';
}
