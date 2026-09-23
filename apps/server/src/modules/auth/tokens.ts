import { sha256Hex } from '../../infra/crypto/sha256';

/**
 * 随机不透明令牌（session token / CSRF token）。
 *
 * - 用 Web Crypto 的随机源生成 32 字节，再编码为 base64url（无填充，适合放 Cookie/头）；
 * - 数据库只存 sha256 摘要（见 02 第 5 节：D1 仅存摘要与期限）；
 * - 比较用自己实现的定长比较：workerd 没有 crypto.timingSafeEqual，
 *   这里只是常量时间比较，不是「手写密码哈希」（哈希用 Argon2id，见 password.ts）。
 */

const TOKEN_BYTES = 32;

export function randomToken(bytes: number = TOKEN_BYTES): string {
  const buffer = crypto.getRandomValues(new Uint8Array(bytes));
  return base64UrlFromBytes(buffer);
}

export function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function hashToken(token: string): Promise<string> {
  return sha256Hex(token);
}

/** 常量时间字符串比较（长度不同直接返回 false；逐字节异或累加）。 */
export function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return diff === 0;
}

export function constantTimeEqualBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return diff === 0;
}
