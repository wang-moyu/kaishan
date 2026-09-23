import { describe, expect, it } from 'vitest';

import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  PASSWORD_HASH_PARAMS,
  dummyVerify,
  encodePasswordHash,
  hashPassword,
  needsRehash,
  parsePasswordHash,
  verifyPassword,
} from '../src/modules/auth/password';

/**
 * 密码哈希（P0-04 测试项：workerd 兼容性与耗时验证）。
 *
 * 这里同时是「选型可行性验证」：参数取 OWASP 对 Argon2id 的最低建议，
 * 实测耗时记录在 password.ts 顶部注释里。
 */
describe('密码哈希（Argon2id，workerd）', () => {
  it('哈希可校验，且同一密码两次哈希不同（随机盐）', () => {
    const first = hashPassword('correct horse battery staple');
    const second = hashPassword('correct horse battery staple');

    expect(first).not.toBe(second);
    expect(verifyPassword('correct horse battery staple', first)).toBe(true);
    expect(verifyPassword('correct horse battery staple', second)).toBe(true);
  });

  it('错误密码、被篡改的哈希、格式非法的哈希都返回 false（不放行）', () => {
    const hash = hashPassword('correct horse battery staple');

    expect(verifyPassword('wrong password', hash)).toBe(false);
    expect(verifyPassword('', hash)).toBe(false);
    expect(verifyPassword('correct horse battery staple', hash.slice(0, -2) + 'aa')).toBe(false);
    expect(verifyPassword('correct horse battery staple', 'not-a-hash')).toBe(false);
    expect(verifyPassword('correct horse battery staple', '')).toBe(false);
    expect(verifyPassword('correct horse battery staple', '$argon2id$m=0,t=2,p=1,dk=32$AAAA$BBBB')).toBe(
      false,
    );
  });

  it('编码里带算法与参数，便于将来升参', () => {
    const hash = hashPassword('abcdefgh');
    expect(hash.startsWith('$argon2id$m=19456,t=2,p=1,dk=32$')).toBe(true);

    const parsed = parsePasswordHash(hash);
    expect(parsed?.params).toEqual(PASSWORD_HASH_PARAMS);
    expect(parsed?.salt.length).toBe(16);
    expect(parsed?.hash.length).toBe(32);
  });

  it('参数更强时需要重新哈希，参数相同则不需要', () => {
    const hash = hashPassword('abcdefgh');
    expect(needsRehash(hash)).toBe(false);
    expect(needsRehash(hash, { m: 65_536, t: 3, p: 1, dk: 32 })).toBe(true);
    expect(needsRehash('broken')).toBe(true);
  });

  it('等价开销的 dummy 校验不会抛错（用于账号不存在的分支）', () => {
    expect(() => dummyVerify('anything')).not.toThrow();
  });

  it('耗时在可接受范围（本机实测约 140 ms/次；这里只兜住数量级）', () => {
    const started = performance.now();
    const hash = hashPassword('performance-check-password');
    const hashMs = performance.now() - started;

    const verifyStarted = performance.now();
    expect(verifyPassword('performance-check-password', hash)).toBe(true);
    const verifyMs = performance.now() - verifyStarted;

    // 上限放到 3 秒：既验证「能在 workerd 里跑完」，又能在参数被误调成极端值时报警
    expect(hashMs).toBeLessThan(3000);
    expect(verifyMs).toBeLessThan(3000);
    // 下限：确认没有退化成接近无开销的假哈希
    expect(hashMs).toBeGreaterThan(1);
  });

  it('参数边界：密码长度限制在 schema 层，哈希本身接受任意字符串', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
    expect(MAX_PASSWORD_LENGTH).toBe(128);

    const long = 'a'.repeat(MAX_PASSWORD_LENGTH);
    const hash = hashPassword(long);
    expect(verifyPassword(long, hash)).toBe(true);
    expect(verifyPassword(long.slice(1), hash)).toBe(false);
  });

  it('encodePasswordHash 与 parsePasswordHash 互为逆运算', () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const digest = crypto.getRandomValues(new Uint8Array(32));
    const encoded = encodePasswordHash(PASSWORD_HASH_PARAMS, salt, digest);

    const parsed = parsePasswordHash(encoded);
    expect(parsed).not.toBeNull();
    expect(Array.from(parsed?.salt ?? [])).toEqual(Array.from(salt));
    expect(Array.from(parsed?.hash ?? [])).toEqual(Array.from(digest));
  });
});
