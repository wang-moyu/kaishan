/**
 * 鉴权模块的共享类型（不依赖任何其它模块，避免循环 import）：
 * - AuthState：请求上下文里的登录态（middleware/session.ts 写入）；
 * - UserSummary：可对外返回的账号摘要（绝不包含 password_hash）。
 */
export interface AuthState {
  sessionId: string;
  userId: string;
  /** 会话级 CSRF 令牌的 sha256 摘要（不存原文，见 cookie.ts）。 */
  csrfTokenHash: string;
  expiresAt: number;
}

export interface UserSummary {
  id: string;
  account: string;
  status: string;
  createdAt: string;
}
