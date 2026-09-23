import { canonicalizeJson } from './canonical';

/**
 * 配置内容哈希（03 第 12 节：配置按内容哈希/版本发布）。
 *
 * 设计取舍：
 * - game-core 不直接调用平台 API，也不依赖真实时钟；摘要函数由调用方注入
 *   （Worker/Node 传 Web Crypto 的 SHA-256，测试传同一个实现或桩）。
 * - 哈希覆盖「规范化后的内容」，不含版本号与哈希本身，避免自引用。
 * - 采用 sha256 前缀，便于将来更换算法时区分。
 */

export const CONFIG_HASH_ALGORITHM = 'sha256';
export const CONFIG_HASH_PREFIX = `${CONFIG_HASH_ALGORITHM}:`;

/**
 * 摘要函数：给定**字符串**返回摘要字节。
 * 接收字符串而不是字节，是为了让 game-core 不依赖 TextEncoder 等平台全局：
 * UTF-8 编码留在平台适配层（见 apps/server/src/infra/crypto/sha256.ts）。
 */
export type DigestFn = (text: string) => Promise<ArrayBuffer>;

export async function hashConfigContent(content: unknown, digest: DigestFn): Promise<string> {
  const canonical = canonicalizeJson(content);
  const hash = await digest(canonical);
  return `${CONFIG_HASH_PREFIX}${toHex(new Uint8Array(hash))}`;
}

export async function verifyConfigHash(
  content: unknown,
  expectedHash: string,
  digest: DigestFn,
): Promise<boolean> {
  const actual = await hashConfigContent(content, digest);
  return actual === expectedHash;
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}
