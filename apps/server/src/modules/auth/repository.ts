import { ParamRepository } from '../../infra/db/repository';

/**
 * 账号/会话/限频的 D1 仓储（P0-04）。
 *
 * 只做「表 → 行 → 参数化语句」映射；密码校验、限频判定、会话生命周期在 service.ts。
 * 写入是单条 execute：账号类写入不需要 P0-05 的资产批次断言（那条规则针对资产命令）。
 */

export interface UserRow {
  id: string;
  normalized_account: string;
  password_hash: string;
  status: string;
  created_at: number;
  updated_at: number;
}

export interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  csrf_token_hash: string;
  expires_at: number;
  created_at: number;
  revoked_at: number | null;
}

export class UserRepository extends ParamRepository {
  async findById(userId: string): Promise<UserRow | null> {
    return this.one<UserRow>({
      sql: 'SELECT id, normalized_account, password_hash, status, created_at, updated_at FROM users WHERE id = ?',
      params: [userId],
    });
  }

  async findByAccount(normalizedAccount: string): Promise<UserRow | null> {
    return this.one<UserRow>({
      sql: 'SELECT id, normalized_account, password_hash, status, created_at, updated_at FROM users WHERE normalized_account = ?',
      params: [normalizedAccount],
    });
  }

  async insert(row: {
    id: string;
    normalizedAccount: string;
    passwordHash: string;
    status: string;
    now: number;
  }): Promise<void> {
    await this.execute({
      sql: `INSERT INTO users (id, normalized_account, password_hash, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      params: [row.id, row.normalizedAccount, row.passwordHash, row.status, row.now, row.now],
    });
  }

  async updatePasswordHash(userId: string, passwordHash: string, now: number): Promise<void> {
    await this.execute({
      sql: 'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
      params: [passwordHash, now, userId],
    });
  }

  async countAll(): Promise<number> {
    const row = await this.one<{ total: number }>({ sql: 'SELECT COUNT(*) AS total FROM users' });
    return Number(row?.total ?? 0);
  }
}

export class SessionRepository extends ParamRepository {
  async insert(row: {
    id: string;
    userId: string;
    tokenHash: string;
    csrfTokenHash: string;
    expiresAt: number;
    now: number;
  }): Promise<void> {
    await this.execute({
      sql: `INSERT INTO sessions (id, user_id, token_hash, csrf_token_hash, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      params: [row.id, row.userId, row.tokenHash, row.csrfTokenHash, row.expiresAt, row.now],
    });
  }

  /** 只返回未撤销且未过期的会话。 */
  async findActiveByTokenHash(tokenHash: string, now: number): Promise<SessionRow | null> {
    return this.one<SessionRow>({
      sql: `SELECT id, user_id, token_hash, csrf_token_hash, expires_at, created_at, revoked_at
            FROM sessions
            WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?`,
      params: [tokenHash, now],
    });
  }

  async findAnyByTokenHash(tokenHash: string): Promise<SessionRow | null> {
    return this.one<SessionRow>({
      sql: `SELECT id, user_id, token_hash, csrf_token_hash, expires_at, created_at, revoked_at
            FROM sessions WHERE token_hash = ?`,
      params: [tokenHash],
    });
  }

  async revokeById(sessionId: string, revokedAt: number): Promise<number> {
    const result = await this.execute({
      sql: 'UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
      params: [revokedAt, sessionId],
    });
    return result.meta.changes ?? 0;
  }

  /** 轮换会话的 CSRF 令牌摘要（/auth/me 会按需轮换，见 routes.ts）。 */
  async updateCsrfTokenHash(sessionId: string, csrfTokenHash: string): Promise<void> {
    await this.execute({
      sql: 'UPDATE sessions SET csrf_token_hash = ? WHERE id = ?',
      params: [csrfTokenHash, sessionId],
    });
  }

  /** 受控撤销：某个账号的所有活跃会话（管理脚本与管理接口都走这里）。 */
  async revokeAllForUser(userId: string, revokedAt: number): Promise<number> {
    const result = await this.execute({
      sql: 'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
      params: [revokedAt, userId],
    });
    return result.meta.changes ?? 0;
  }

  async countActiveForUser(userId: string, now: number): Promise<number> {
    const row = await this.one<{ total: number }>({
      sql: 'SELECT COUNT(*) AS total FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?',
      params: [userId, now],
    });
    return Number(row?.total ?? 0);
  }

  async countAll(): Promise<number> {
    const row = await this.one<{ total: number }>({ sql: 'SELECT COUNT(*) AS total FROM sessions' });
    return Number(row?.total ?? 0);
  }
}

export interface RateLimitState {
  count: number;
  windowStart: number;
  expiresAt: number;
}

export class RateLimitRepository extends ParamRepository {
  /**
   * 固定窗口计数：单条 upsert 语句原子完成「进入窗口/累加」，并 RETURNING 当前计数。
   * 使用 D1 而不是 Worker 内存，保证跨实例限频（见 02 第 5 节）。
   */
  async consume(bucket: string, now: number, windowMs: number): Promise<number> {
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const expiresAt = windowStart + windowMs;
    const row = await this.one<{ count: number }>({
      sql: `INSERT INTO auth_rate_limits (bucket, window_start, count, expires_at)
            VALUES (?1, ?2, 1, ?3)
            ON CONFLICT (bucket) DO UPDATE SET
              count = CASE WHEN auth_rate_limits.window_start = ?2 THEN auth_rate_limits.count + 1 ELSE 1 END,
              window_start = ?2,
              expires_at = ?3
            RETURNING count`,
      params: [bucket, windowStart, expiresAt],
    });
    return Number(row?.count ?? 1);
  }

  async read(bucket: string): Promise<RateLimitState | null> {
    return this.one<RateLimitState>({
      sql: 'SELECT count, window_start AS windowStart, expires_at AS expiresAt FROM auth_rate_limits WHERE bucket = ?',
      params: [bucket],
    });
  }

  async clear(bucket: string): Promise<void> {
    await this.execute({ sql: 'DELETE FROM auth_rate_limits WHERE bucket = ?', params: [bucket] });
  }
}
