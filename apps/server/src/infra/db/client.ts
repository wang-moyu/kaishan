import { DbBindingMissingError } from './errors';

/**
 * 取 D1 绑定。
 * 绑定缺失是配置错误：直接抛错，不能让调用方拿到 undefined 后漏判，
 * 也不能回退到内存或本地 sqlite 文件（见 06 禁止行为：不得用普通 SQLite 驱动或 mock 冒充 D1）。
 */
export function getDb(env: Env): D1Database {
  const db = env.DB;
  if (!db) {
    throw new DbBindingMissingError();
  }
  return db;
}
