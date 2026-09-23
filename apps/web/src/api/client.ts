/**
 * 前端请求封装（一次性可玩版本）。
 *
 * 只做三件事：
 * 1. 统一带上 `X-CSRF-Token`（登录/注册/me 返回的 csrfToken，存在内存里）；
 * 2. 按统一响应包解开 `{ ok, data }`，失败时抛出带错误码的 ApiError；
 * 3. 网络失败给出可读提示（后端 wrangler dev 没起时会出现）。
 */

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: string, message: string, status: number, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function currentCsrfToken(): string | null {
  return csrfToken;
}

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
}

export interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (method !== 'GET' && csrfToken !== null) {
    headers['X-CSRF-Token'] = csrfToken;
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  } catch {
    throw new ApiError('NETWORK_ERROR', '连接后端失败（确认 npm run dev 已启动）', 0);
  }

  const text = await response.text();
  let envelope: ApiEnvelope<T> | null = null;
  if (text.length > 0) {
    try {
      envelope = JSON.parse(text) as ApiEnvelope<T>;
    } catch {
      throw new ApiError('BAD_RESPONSE', `响应不是合法 JSON（HTTP ${response.status}）`, response.status);
    }
  }

  if (envelope === null || envelope.ok !== true || envelope.data === undefined) {
    let msg = envelope?.error?.message ?? `请求失败（HTTP ${response.status}）`;
    const fields = envelope?.error?.details?.fields as { path?: string; message?: string }[] | undefined;
    if (fields?.length) {
      msg = fields.map((f) => f.message ?? f.path).join('；');
    }
    throw new ApiError(
      envelope?.error?.code ?? 'UNKNOWN_ERROR',
      msg,
      response.status,
      envelope?.error?.details,
    );
  }

  return envelope.data;
}
