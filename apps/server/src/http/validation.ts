import type { z } from 'zod';

import type { AppContext } from './appError';
import { AppError } from './appError';

/**
 * 严格输入校验（04 第 1、3 节：所有 body/query 采用严格 schema，不接受未声明字段）。
 *
 * 校验失败一律映射为 400 VALIDATION_ERROR，details 只带字段路径与原因，
 * **不回显原始值**，避免把用户输入（可能是密码）写进响应或日志。
 */

export function parseStrictQuery<S extends z.ZodType>(schema: S, c: AppContext): z.infer<S> {
  const raw = c.req.query();
  return parseOrThrow(schema, raw);
}

export async function parseStrictJson<S extends z.ZodType>(schema: S, c: AppContext): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new AppError('VALIDATION_ERROR', undefined, { reason: 'BODY_NOT_JSON' });
  }
  return parseOrThrow(schema, raw);
}

function parseOrThrow<S extends z.ZodType>(schema: S, raw: unknown): z.infer<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', undefined, {
      fields: parsed.error.issues.map((issue) => ({
        // 未声明字段的 issue 没有 path，但会带上具体键名，这里把它作为路径回给客户端
        path: issuePath(issue),
        message: issue.message,
      })),
    });
  }
  return parsed.data as z.infer<S>;
}

function issuePath(issue: z.core.$ZodIssue): string {
  if (issue.path.length > 0) {
    return issue.path.join('.');
  }
  const keys = (issue as { keys?: string[] }).keys;
  return keys !== undefined && keys.length > 0 ? keys.join(',') : '(root)';
}
