/**
 * P0-03 起健康检查走统一契约：/api/v1/health/live（原 /api/health 已退役）。
 * 完整请求封装（错误码、CSRF、幂等 key、401 跳转）由 P0-06 实现。
 */
export interface LiveResponse {
  ok: true;
  data: { status: string; configVersion: string };
  requestId: string;
  serverTime: string;
}

export async function fetchHealth(signal?: AbortSignal): Promise<LiveResponse> {
  const response = await fetch('/api/v1/health/live', {
    headers: { accept: 'application/json' },
    signal,
  });

  const body = (await response.json()) as { ok: boolean; error?: { message?: string } };
  if (!response.ok || body.ok !== true) {
    throw new Error(body.error?.message ?? `健康检查失败（HTTP ${response.status}）`);
  }

  return body as LiveResponse;
}
