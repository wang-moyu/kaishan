/**
 * SHA-256 摘要（Web Crypto 适配层）。
 *
 * 位置说明：这是**平台能力适配**，不是领域逻辑，所以放在 apps/server 的 infra 下；
 * game-core 只接受注入的 DigestFn（见 packages/game-core/src/config/hash.ts）。
 * UTF-8 编码在这里完成，game-core 不需要 TextEncoder/crypto 等平台全局。
 * 测试与 Worker 共用这一份实现，避免两处算出不同哈希。
 */
export async function sha256Digest(text: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await sha256Digest(text);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
