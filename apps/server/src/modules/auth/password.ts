import { argon2id } from '@noble/hashes/argon2.js';

import { constantTimeEqualBytes } from './tokens';

/**
 * 密码哈希（P0-04）。
 *
 * 选型依据（02 第 5 节要求：成熟、Workers 兼容、不用 Node 原生二进制、不手写哈希）：
 * - 实现：`@noble/hashes` 的 Argon2id（纯 TypeScript，不依赖 WASM 加载与原生绑定；
 *   Node 原生 `argon2`/`bcrypt` 因含原生二进制被明确排除）。
 * - 参数：m=19456 KiB、t=2、p=1、dkLen=32（OWASP 对 Argon2id 的最低建议）。
 * - 实测（workerd 1.20260815.1，本机）：单次约 140～156 ms；同机对比 PBKDF2-SHA256 600k 约 207 ms。
 *   Workers Free 套餐 CPU 上限 10 ms/请求，因此注册/登录功能需要 Workers Paid（详见 07 与验证记录）。
 * - 编码：`$argon2id$m=...,t=...,p=...,dk=...$<salt base64url>$<hash base64url>`，
 *   参数随哈希保存，将来提高参数时可在校验成功后重新计算（needsRehash）。
 */

export const PASSWORD_HASH_ID = 'argon2id';
export const PASSWORD_SALT_BYTES = 16;

export interface Argon2Params {
  /** 内存开销（KiB）。 */
  m: number;
  /** 迭代次数。 */
  t: number;
  /** 并行度。 */
  p: number;
  /** 输出长度（字节）。 */
  dk: number;
}

export const PASSWORD_HASH_PARAMS: Argon2Params = { m: 19_456, t: 2, p: 1, dk: 32 };

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

export function encodePasswordHash(params: Argon2Params, salt: Uint8Array, hash: Uint8Array): string {
  const paramText = `m=${params.m},t=${params.t},p=${params.p},dk=${params.dk}`;
  return `$${PASSWORD_HASH_ID}$${paramText}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

export interface ParsedPasswordHash {
  params: Argon2Params;
  salt: Uint8Array;
  hash: Uint8Array;
}

/** 解析存储格式；格式非法返回 null（调用方必须把 null 当作校验失败，而不是放行）。 */
export function parsePasswordHash(encoded: string): ParsedPasswordHash | null {
  const parts = encoded.split('$');
  // ['', 'argon2id', 'm=..,t=..,p=..,dk=..', salt, hash]
  if (parts.length !== 5 || parts[1] !== PASSWORD_HASH_ID) {
    return null;
  }
  const [, , paramText, saltText, hashText] = parts;
  if (paramText === undefined || saltText === undefined || hashText === undefined) {
    return null;
  }

  const params: Partial<Argon2Params> = {};
  for (const pair of paramText.split(',')) {
    const [key, rawValue] = pair.split('=');
    const value = Number.parseInt(rawValue ?? '', 10);
    if (!Number.isInteger(value) || value <= 0) {
      return null;
    }
    if (key === 'm' || key === 't' || key === 'p' || key === 'dk') {
      params[key] = value;
    }
  }
  if (params.m === undefined || params.t === undefined || params.p === undefined || params.dk === undefined) {
    return null;
  }

  const salt = fromBase64Url(saltText);
  const hash = fromBase64Url(hashText);
  if (salt === null || hash === null || salt.length === 0 || hash.length === 0) {
    return null;
  }

  return { params: { m: params.m, t: params.t, p: params.p, dk: params.dk }, salt, hash };
}

export function hashPassword(password: string, params: Argon2Params = PASSWORD_HASH_PARAMS): string {
  const salt = crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_BYTES));
  return encodePasswordHash(params, salt, derive(password, salt, params));
}

export function verifyPassword(password: string, encoded: string): boolean {
  const parsed = parsePasswordHash(encoded);
  if (parsed === null) {
    return false;
  }
  const candidate = derive(password, parsed.salt, parsed.params);
  return constantTimeEqualBytes(candidate, parsed.hash);
}

/** 参数已升级时需要重新哈希（登录成功后由调用方决定是否回写）。 */
export function needsRehash(encoded: string, params: Argon2Params = PASSWORD_HASH_PARAMS): boolean {
  const parsed = parsePasswordHash(encoded);
  if (parsed === null) {
    return true;
  }
  return (
    parsed.params.m < params.m ||
    parsed.params.t < params.t ||
    parsed.params.p < params.p ||
    parsed.params.dk < params.dk
  );
}

/**
 * 账号不存在时也执行一次等价开销的校验，避免用响应时间泄露账号是否存在。
 * 这里用固定盐与固定参数计算一次并丢弃结果。
 */
const DUMMY_SALT = new Uint8Array(PASSWORD_SALT_BYTES);

export function dummyVerify(password: string): void {
  derive(password, DUMMY_SALT, PASSWORD_HASH_PARAMS);
}

function derive(password: string, salt: Uint8Array, params: Argon2Params): Uint8Array {
  return argon2id(new TextEncoder().encode(password), salt, {
    m: params.m,
    t: params.t,
    p: params.p,
    dkLen: params.dk,
  });
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromBase64Url(text: string): Uint8Array | null {
  try {
    const padded = text.replaceAll('-', '+').replaceAll('_', '/');
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}
