/**
 * 鉴权相关的运行时配置（来自 wrangler.jsonc 的 vars / .dev.vars / secrets）。
 *
 * 取值原则（fail-closed）：
 * - 注册开关只在显式等于 "true" 时打开，其它值（拼写错误、空值、被删）一律视为关闭；
 * - 数值型配置（会话时长、限频）非法时回退到安全默认值；
 * - Cookie 的 Secure 只在 ENVIRONMENT=production 时打开（本地 http 开发必须关掉，否则浏览器不保存）。
 */
export interface AuthConfig {
  registrationEnabled: boolean;
  inviteCodes: readonly string[];
  sessionTtlSeconds: number;
  /** Cookie 是否带 Secure：production 必须为 true（见 02 第 5 节）。 */
  cookieSecure: boolean;
  /** 允许的跨源白名单（仅用于本地开发时前端直连 Worker），空表示只允许同源。 */
  allowedOrigins: readonly string[];
  loginRateLimit: {
    maxAttempts: number;
    windowSeconds: number;
  };
}

export const AUTH_CONFIG_DEFAULTS = {
  sessionTtlSeconds: 604_800,
  loginMaxAttempts: 5,
  loginWindowSeconds: 60,
} as const;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseList(value: string | undefined): string[] {
  if (value === undefined) {
    return [];
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * 读取一个字符串型配置。
 *
 * 注意：`wrangler types` 会把 wrangler.jsonc 里的 vars 生成为**字面量类型**（如 "local"），
 * 但运行时这些值可能被 .dev.vars / secrets 覆盖成别的字符串。这里统一放宽为 string，
 * 避免类型上「不可能相等」的假象。
 */
function readVar(env: Env, key: keyof Env): string | undefined {
  const value: unknown = env[key];
  return typeof value === 'string' ? value : undefined;
}

export function readAuthConfig(env: Env): AuthConfig {
  return {
    registrationEnabled: readVar(env, 'REGISTRATION_ENABLED') === 'true',
    inviteCodes: parseList(readVar(env, 'INVITE_CODES')),
    sessionTtlSeconds: parsePositiveInt(
      readVar(env, 'SESSION_TTL_SECONDS'),
      AUTH_CONFIG_DEFAULTS.sessionTtlSeconds,
    ),
    cookieSecure: readVar(env, 'ENVIRONMENT') === 'production',
    allowedOrigins: parseList(readVar(env, 'ALLOWED_ORIGINS')),
    loginRateLimit: {
      maxAttempts: parsePositiveInt(
        readVar(env, 'LOGIN_RATE_LIMIT_MAX_ATTEMPTS'),
        AUTH_CONFIG_DEFAULTS.loginMaxAttempts,
      ),
      windowSeconds: parsePositiveInt(
        readVar(env, 'LOGIN_RATE_LIMIT_WINDOW_SECONDS'),
        AUTH_CONFIG_DEFAULTS.loginWindowSeconds,
      ),
    },
  };
}
