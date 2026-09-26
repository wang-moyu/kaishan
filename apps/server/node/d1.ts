import { DatabaseSync, type StatementSync } from 'node:sqlite';

/**
 * 用 Node 内置的 node:sqlite 实现业务代码用到的那部分 D1 接口：
 * prepare / bind / first / all / run / raw / batch / exec。
 *
 * 与 D1 对齐的几个要点：
 * - 整数必须按 INTEGER 绑定：node:sqlite 把 JS number 一律按 REAL 绑定，
 *   写进 TEXT 列会变成 '5.0'，所以安全整数先转 BigInt 再绑；
 * - batch 是一个事务：任何一条失败整批回滚（mutation_guards 的 CHECK 守卫靠它）；
 * - 外键默认开启（D1 的默认行为）；
 * - 读出的行转成普通对象（node:sqlite 给的是 null-prototype 对象）。
 */

type Bindable = string | number | bigint | null | Uint8Array;

function toBindable(value: unknown, index: number): Bindable {
  if (value === null) return null;
  if (typeof value === 'number') return Number.isSafeInteger(value) ? BigInt(value) : value;
  if (typeof value === 'boolean') return value ? 1n : 0n;
  if (typeof value === 'string' || typeof value === 'bigint') return value;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError(`D1_TYPE_ERROR: Type '${typeof value}' not supported for value at index ${String(index + 1)}`);
}

/** 带编号的参数（?1 ?2）：node:sqlite 不接受按位置传，要换成 { 1: …, 2: … }。 */
const NUMBERED_PARAMS = /\?\d/;

type Args = [Record<string, Bindable>] | Bindable[];

function argsFor(sql: string, params: readonly Bindable[]): Args {
  if (!NUMBERED_PARAMS.test(sql)) return [...params];
  return [Object.fromEntries(params.map((value, index) => [String(index + 1), value]))];
}

/** 按 argsFor 的两种形态调用 get / all / run（node:sqlite 的重载要求具名参数放第一个）。 */
function invoke<R>(
  args: Args,
  positional: (...values: Bindable[]) => R,
  named: (values: Record<string, Bindable>) => R,
): R {
  const [first] = args;
  const isNamed = args.length === 1 && first !== null && typeof first === 'object' && !(first instanceof Uint8Array);
  return isNamed ? named(first as Record<string, Bindable>) : positional(...(args as Bindable[]));
}

/** 会返回行的语句：SELECT / WITH / PRAGMA / VALUES，或带 RETURNING 的写入。 */
const RETURNS_ROWS = /^(?:SELECT|WITH|PRAGMA|VALUES|EXPLAIN)\b|\bRETURNING\b/i;

function stripLeadingComments(sql: string): string {
  return sql.replace(/^(?:\s+|--[^\n]*\n?|\/\*[\s\S]*?\*\/)*/, '');
}

interface Meta {
  duration: number;
  changes: number;
  last_row_id: number;
  changed_db: boolean;
  size_after: number;
  rows_read: number;
  rows_written: number;
}

interface Result<T> {
  success: true;
  results: T[];
  meta: Meta;
}

export class SqlitePreparedStatement {
  constructor(
    private readonly owner: SqliteD1Database,
    readonly sql: string,
    readonly params: readonly Bindable[] = [],
  ) {}

  bind(...values: unknown[]): SqlitePreparedStatement {
    return new SqlitePreparedStatement(this.owner, this.sql, values.map(toBindable));
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const prepared = this.owner.statement(this.sql);
    const row = invoke(argsFor(this.sql, this.params), (...v) => prepared.get(...v), (v) => prepared.get(v));
    if (row === undefined) return null;
    const plain = { ...row } as Record<string, unknown>;
    if (column === undefined) return plain as T;
    if (!(column in plain)) throw new Error(`D1_COLUMN_NOTFOUND: Column not found (${column})`);
    return plain[column] as T;
  }

  async all<T = Record<string, unknown>>(): Promise<Result<T>> {
    return this.owner.executeSync<T>(this);
  }

  async run<T = Record<string, unknown>>(): Promise<Result<T>> {
    return this.owner.executeSync<T>(this);
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    const { results } = this.owner.executeSync<Record<string, unknown>>(this);
    return results.map((row) => Object.values(row) as T);
  }
}

export class SqliteD1Database {
  private readonly cache = new Map<string, StatementSync>();

  constructor(readonly db: DatabaseSync) {}

  prepare(sql: string): SqlitePreparedStatement {
    return new SqlitePreparedStatement(this, sql);
  }

  async batch<T = Record<string, unknown>>(statements: readonly SqlitePreparedStatement[]): Promise<Result<T>[]> {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map((statement) => this.executeSync<T>(statement));
      this.db.exec('COMMIT');
      return results;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  async exec(sql: string): Promise<{ count: number; duration: number }> {
    const started = performance.now();
    this.db.exec(sql);
    return { count: 1, duration: performance.now() - started };
  }

  /** 预编译语句缓存（SQL 都是固定模板，参数只经 bind 传入）。 */
  statement(sql: string): StatementSync {
    let prepared = this.cache.get(sql);
    if (prepared === undefined) {
      if (this.cache.size >= 1000) this.cache.clear();
      prepared = this.db.prepare(sql);
      this.cache.set(sql, prepared);
    }
    return prepared;
  }

  executeSync<T>(statement: SqlitePreparedStatement): Result<T> {
    const started = performance.now();
    const prepared = this.statement(statement.sql);
    const args = argsFor(statement.sql, statement.params);
    let results: T[] = [];
    let changes = 0;
    let lastRowId = 0;
    if (RETURNS_ROWS.test(stripLeadingComments(statement.sql))) {
      results = invoke(args, (...v) => prepared.all(...v), (v) => prepared.all(v)).map((row) => ({ ...row }) as T);
      changes = /^(?:SELECT|WITH|PRAGMA|VALUES|EXPLAIN)\b/i.test(stripLeadingComments(statement.sql))
        ? 0
        : results.length;
    } else {
      const info = invoke(args, (...v) => prepared.run(...v), (v) => prepared.run(v));
      changes = Number(info.changes);
      lastRowId = Number(info.lastInsertRowid);
    }
    return {
      success: true,
      results,
      meta: {
        duration: performance.now() - started,
        changes,
        last_row_id: lastRowId,
        changed_db: changes > 0,
        size_after: 0,
        rows_read: 0,
        rows_written: changes,
      },
    };
  }
}

/** 打开数据库文件：WAL（读写不互相阻塞）+ 外键 + 忙等待。 */
export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

/** 业务代码按 D1Database 使用；运行时就是上面的实现。 */
export function asD1(db: DatabaseSync): D1Database {
  return new SqliteD1Database(db) as unknown as D1Database;
}
