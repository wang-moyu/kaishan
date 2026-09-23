import type { Hono } from 'hono';

import type { AppEnv } from '../../src/http/appError';

// pool-workers 0.22 起 cloudflare:test 不再导出 Env 类型，直接用 wrangler types
// 生成的全局 Env（等价于 Cloudflare.Env），避免两套绑定类型漂移。
type Env = Cloudflare.Env;

/**
 * 账号接口测试脚手架（P0-04）。
 *
 * - 每个用例可以传自己的环境变量覆盖（注册开关、邀请码、Cookie Secure 等）——
 *   这些值在运行时可能被 .dev.vars/secrets 覆盖，而 wrangler types 生成的是字面量类型，
 *   所以这里统一 cast 成 Env；
 * - 自带 Cookie jar：把响应的 Set-Cookie 收集起来，后续请求自动带上（模拟浏览器）；
 * - 默认带同源 Origin，写请求需要时显式覆盖。
 */
export interface RequestOptions {
  method?: string;
  body?: unknown;
  /** 覆盖 Origin；传 null 表示故意不带 Origin。 */
  origin?: string | null;
  /** 覆盖 X-CSRF-Token；默认用 Cookie 里的 csrf 值。 */
  csrfToken?: string | null;
  headers?: Record<string, string>;
  /** 是否自动带上 Cookie jar（默认 true）。 */
  withCookies?: boolean;
}

export interface ApiResult {
  status: number;
  body: Record<string, unknown>;
  /** 原始 Set-Cookie 值列表。 */
  setCookies: string[];
}

const BASE_URL = 'https://example.com';

export class TestClient {
  private readonly cookies = new Map<string, string>();

  constructor(
    private readonly app: Hono<AppEnv>,
    private readonly env: Env,
    /** 每个请求都会带上的头（例如给限频用例指定独立的 cf-connecting-ip）。 */
    private readonly defaultHeaders: Record<string, string> = {},
  ) {}

  get cookieHeader(): string {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  cookie(name: string): string | undefined {
    return this.cookies.get(name);
  }

  clearCookies(): void {
    this.cookies.clear();
  }

  async request(path: string, options: RequestOptions = {}): Promise<ApiResult> {
    const method = options.method ?? 'GET';
    const headers = new Headers({
      accept: 'application/json',
      ...this.defaultHeaders,
      ...options.headers,
    });

    const origin = options.origin === undefined ? BASE_URL : options.origin;
    if (origin !== null) {
      headers.set('origin', origin);
    }
    if (options.withCookies !== false && this.cookies.size > 0) {
      headers.set('cookie', this.cookieHeader);
    }
    if (options.body !== undefined) {
      headers.set('content-type', 'application/json');
    }

    const csrfToken =
      options.csrfToken === undefined ? this.cookies.get('csrf') : options.csrfToken;
    if (csrfToken !== null && csrfToken !== undefined) {
      headers.set('x-csrf-token', csrfToken);
    }

    const response = await this.app.request(
      `${BASE_URL}${path}`,
      {
        method,
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      },
      this.env,
    );

    const setCookies = readSetCookies(response);
    for (const raw of setCookies) {
      const [pair] = raw.split(';');
      const [name, value] = (pair ?? '').split('=');
      if (name === undefined || value === undefined) {
        continue;
      }
      if (value === '') {
        this.cookies.delete(name.trim());
      } else {
        this.cookies.set(name.trim(), value);
      }
    }

    const text = await response.text();
    const body = text.length === 0 ? {} : (JSON.parse(text) as Record<string, unknown>);
    return { status: response.status, body, setCookies };
  }

  get(path: string, options?: RequestOptions): Promise<ApiResult> {
    return this.request(path, { ...options, method: 'GET' });
  }

  post(path: string, body?: unknown, options?: RequestOptions): Promise<ApiResult> {
    return this.request(path, { ...options, method: 'POST', body });
  }
}

/** 覆盖环境变量（注册开关等）；因 vars 是字面量类型，这里必须 cast。 */
export function envWith(base: Env, overrides: Record<string, string>): Env {
  return { ...base, ...overrides } as unknown as Env;
}

export function readSetCookies(response: Response): string[] {
  const withGetter = response.headers as Headers & { getSetCookie?: () => string[] };
  const all = withGetter.getSetCookie?.();
  if (all !== undefined && all.length > 0) {
    return all;
  }
  const single = response.headers.get('set-cookie');
  return single === null ? [] : [single];
}

export function dataOf(result: ApiResult): Record<string, unknown> {
  if (result.body.ok !== true) {
    throw new Error(`期望成功响应，实际：${JSON.stringify(result.body)}`);
  }
  return result.body.data as Record<string, unknown>;
}

export function errorOf(result: ApiResult): {
  code: string;
  message: string;
  details?: Record<string, unknown>;
} {
  if (result.body.ok !== false) {
    throw new Error(`期望失败响应，实际：${JSON.stringify(result.body)}`);
  }
  return result.body.error as { code: string; message: string; details?: Record<string, unknown> };
}
