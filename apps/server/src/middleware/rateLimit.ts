import type { AppContext } from '../http/appError';

/**
 * 限频插件（02 第 5 节：安全限频不能依赖全局内存 Map）。
 *
 * 分工：
 * - 本文件负责「桶命名 + 来源标识提取」这类请求级输入；
 * - 计数本身由 D1 原子 upsert 完成（modules/auth/repository.ts 的 RateLimitRepository），
 *   因此跨 Worker 实例一致；
 * - 登录/注册的判定策略在 modules/auth/service.ts。
 *
 * 隐私：桶名里只放 sha256 摘要，账号与 IP 都不以明文落库。
 */

export const LOGIN_ACCOUNT_BUCKET = 'login:account:';
export const LOGIN_IP_BUCKET = 'login:ip:';
export const REGISTER_IP_BUCKET = 'register:ip:';

/**
 * 取客户端来源标识：优先 Cloudflare 注入的 CF-Connecting-IP，
 * 其次 X-Forwarded-For 的第一段；都没有时退回固定串（本地直连/测试）。
 * 该值只用于限频，不做鉴权判断。
 */
export function clientIpOf(c: AppContext): string {
  const connectingIp = c.req.header('cf-connecting-ip');
  if (connectingIp !== undefined && connectingIp.trim().length > 0) {
    return connectingIp.trim();
  }
  const forwardedFor = c.req.header('x-forwarded-for');
  if (forwardedFor !== undefined) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first !== undefined && first.length > 0) {
      return first;
    }
  }
  return 'unknown';
}
