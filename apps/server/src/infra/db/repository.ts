import { DbQueryError, toSafeDbError } from './errors';

/** D1 可绑定的标量类型。金额/资源用安全整数 number 或十进制字符串，不直接绑 BigInt（见 02 第 4 节）。 */
export type SqlValue = string | number | null;

/** 参数化查询：SQL 固定，值只经 bind 传入；禁止把用户输入或表名拼接进 SQL。 */
export interface ParameterizedQuery {
  sql: string;
  params?: readonly SqlValue[];
}


/**
 * 把参数化查询批量编译成 D1 预编译语句，供 `db.batch()` 使用。
 *
 * 位置：和 ParameterizedQuery 放在一起，保证「SQL 固定 + 值只经 bind」这条约定
 * 在 batch 场景下同样只有一份实现（游戏模块用它把「读到的状态写回去」合成一次 batch）。
 */
export function prepareStatements(
  db: D1Database,
  queries: readonly ParameterizedQuery[],
): D1PreparedStatement[] {
  return queries.map((query) => {
    const prepared = db.prepare(query.sql);
    const params = query.params ?? [];
    return params.length > 0 ? prepared.bind(...params) : prepared;
  });
}
/**
 * 参数化仓储基类：只提供读取查询与单条准备语句的封装。
 *
 * 本类**不**提供事务语义：读取一致快照、静默计算、单次 batch 断言版本与条件、写回执
 * 这套命令流程由 P0-05 的 infra/command-plan/batch 统一实现（见 02 第 3 节）。
 * 业务仓储只负责「表 -> 行 -> 参数化语句」的映射，不在这里拼业务条件。
 */
export class ParamRepository {
  constructor(protected readonly db: D1Database) {}

  /** 查询多行。 */
  protected async all<T>(query: ParameterizedQuery): Promise<T[]> {
    try {
      const result = await this.statement(query).all<T>();
      return result.results ?? [];
    } catch (error) {
      throw new DbQueryError(toSafeDbError(error), error);
    }
  }

  /** 查询单行；无结果返回 null（D1 的 first() 语义）。 */
  protected async one<T>(query: ParameterizedQuery): Promise<T | null> {
    try {
      return await this.statement(query).first<T>();
    } catch (error) {
      throw new DbQueryError(toSafeDbError(error), error);
    }
  }

  /**
   * 单条写入（INSERT/UPDATE/DELETE）。
   * 仍然**不**提供事务语义：一次资产命令的「读取快照 → 计算 → 单批断言 → 写入 + 回执」
   * 由 P0-05 的 infra/command-plan/batch 负责；这里只给账号/会话这类单条写入使用。
   */
  protected async execute(query: ParameterizedQuery): Promise<D1Result> {
    try {
      return await this.statement(query).run();
    } catch (error) {
      throw new DbQueryError(toSafeDbError(error), error);
    }
  }


  private statement(query: ParameterizedQuery): D1PreparedStatement {
    const prepared = this.db.prepare(query.sql);
    const params = query.params ?? [];
    return params.length > 0 ? prepared.bind(...params) : prepared;
  }
}
