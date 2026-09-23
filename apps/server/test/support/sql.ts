/**
 * 测试侧 SQL 执行辅助。
 *
 * 生产路径由 wrangler 负责拆分语句（d1 execute --file、readD1Migrations 用到的 splitSqlQuery）；
 * 在 workerd 里没有这些工具，所以对受控的 seed 文件做同样的简单拆分：
 * 去掉 `--` 行注释，按分号切分，逐条执行。
 *
 * 限制：不支持字符串字面量内出现分号。scripts/seed/seed.sql 必须保持该约束。
 */
export function splitSqlStatements(sql: string): string[] {
  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

export async function runSql(db: D1Database, sql: string): Promise<void> {
  for (const statement of splitSqlStatements(sql)) {
    await db.prepare(statement).run();
  }
}
