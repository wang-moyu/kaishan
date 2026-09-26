import { z } from 'zod';

import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './password';

/**
 * 账号接口的严格输入 schema（04 第 3 节；未声明字段一律拒绝）。
 * 服务端还会做 normalize（账号小写、去首尾空白），客户端不能替代这些校验。
 */
export const accountSchema = z
  .string()
  .min(2, '账号至少 2 个字符')
  .max(32, '账号最多 32 个字符')
  .regex(/^[\w一-鿿.-]+$/u, '账号只能包含中文、字母、数字、下划线、点和连字符');

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `密码至少 ${MIN_PASSWORD_LENGTH} 个字符`)
  .max(MAX_PASSWORD_LENGTH, `密码最多 ${MAX_PASSWORD_LENGTH} 个字符`);

export const inviteCodeSchema = z.string().min(1).max(64);

export const registerRequestSchema = z.strictObject({
  account: accountSchema,
  password: passwordSchema,
  inviteCode: inviteCodeSchema.optional(),
});

export const loginRequestSchema = z.strictObject({
  account: accountSchema,
  password: passwordSchema,
});

/**
 * 修改密码：旧密码只校验长度上限（旧账号的密码可能是早期规则下设的，不能因新规则而无法验证），
 * 新密码走与注册相同的规则；新旧相同由 service 拒绝。
 */
export const changePasswordRequestSchema = z.strictObject({
  oldPassword: z.string().min(1, '请输入当前密码').max(MAX_PASSWORD_LENGTH),
  newPassword: passwordSchema,
});

/** 空 body：不接受任何字段，避免客户端塞入 userId 之类的越权参数。 */
export const emptyRequestSchema = z.strictObject({});

export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export function normalizeAccount(account: string): string {
  return account.trim().toLowerCase();
}
