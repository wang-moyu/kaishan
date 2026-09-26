import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

/**
 * 迁移：沿用 wrangler 的 d1_migrations 表结构（id / name / applied_at），
 * 从 D1 导出的数据导入后可以直接接着跑，不会重复执行已经在 D1 上跑过的迁移。
 * 每个迁移文件一个事务，失败整体回滚并中止。
 */
export function applyMigrations(db: DatabaseSync, dir: string): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS d1_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`);
  const applied = new Set(
    db.prepare('SELECT name FROM d1_migrations').all().map((row) => String(row.name)),
  );
  const pending = readdirSync(dir)
    .filter((file) => file.endsWith('.sql') && !applied.has(file))
    .sort();
  for (const file of pending) {
    const sql = readFileSync(join(dir, file), 'utf8');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(file);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`迁移 ${file} 执行失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return pending;
}

/** 种子数据（幂等：重复执行不新增、不修改已有行），每次启动都跑一遍。 */
export function applySeed(db: DatabaseSync, file: string): void {
  if (!existsSync(file)) return;
  db.exec(readFileSync(file, 'utf8'));
}

/** 业务表数量（导入前判断是不是空库）。 */
export function userTableCount(db: DatabaseSync): number {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'd1_migrations'",
    )
    .get();
  return Number(row?.n ?? 0);
}

/**
 * 导入 `wrangler d1 export` 导出的 SQL（结构 + 数据 + d1_migrations）。
 * 导出文件里表的先后顺序不保证满足外键，所以导入期间关外键，完成后再做一次外键检查。
 */
export function importDump(db: DatabaseSync, file: string): void {
  // 导出文件若自带事务语句就去掉（这里统一包一层事务）。
  const sql = readFileSync(file, 'utf8').replace(/^\s*(?:BEGIN TRANSACTION|BEGIN|COMMIT)\s*;\s*$/gim, '');
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(sql);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
  const violations = db.prepare('PRAGMA foreign_key_check').all();
  if (violations.length > 0) {
    console.warn(`导入完成，但有 ${String(violations.length)} 行外键不一致（D1 里本来就存在的孤儿行）`);
  }
}
