/**
 * infra 层的 D1 错误分类与安全映射。
 *
 * 目标：
 * 1. 捕获异常后能区分「约束不满足 / 结构未就绪 / 连接不可用 / 未知故障」，
 *    以便调用方决定回滚、重试或直接失败（见 02 第 3 节）。
 * 2. 对外响应与日志里绝不带上 SQL、表名、绑定名或 database_id（见 02 第 5 节、04 第 2 节）。
 *
 * 注意：这里的 code 是**数据库层内部码**，不是对外 API 错误码；对外错误码集中在
 * contracts 中定义（P0-03），本阶段路由只把 kind 映射成 04 第 2 节里已有的
 * TEMPORARILY_UNAVAILABLE。日志脱敏与统一错误中间件同样由 P0-03 负责。
 */

/** D1 binding 缺失：配置问题，不是数据问题。 */
export class DbBindingMissingError extends Error {
  constructor() {
    super('D1 binding 未配置');
    this.name = 'DbBindingMissingError';
  }
}

/** 迁移未应用（必需表缺失）：就绪检查用，避免把「表不存在」当成普通查询错误。 */
export class MissingSchemaError extends Error {
  constructor(
    readonly expectedTables: number,
    readonly foundTables: number,
  ) {
    super('数据库结构未就绪');
    this.name = 'MissingSchemaError';
  }
}

export type DbErrorKind = 'unique' | 'constraint' | 'schema' | 'unavailable' | 'unknown';

export type DbErrorCode =
  | 'DB_UNIQUE_VIOLATION'
  | 'DB_CONSTRAINT_VIOLATION'
  | 'DB_SCHEMA_NOT_READY'
  | 'DB_UNAVAILABLE'
  | 'DB_ERROR';

export interface SafeDbError {
  kind: DbErrorKind;
  code: DbErrorCode;
  /** 可安全返回给客户端的中文说明：不含 SQL、表名、绑定名或连接信息。 */
  message: string;
}

const SAFE_ERRORS: Record<DbErrorKind, SafeDbError> = {
  unique: { kind: 'unique', code: 'DB_UNIQUE_VIOLATION', message: '数据唯一约束冲突' },
  constraint: { kind: 'constraint', code: 'DB_CONSTRAINT_VIOLATION', message: '数据约束校验失败' },
  schema: { kind: 'schema', code: 'DB_SCHEMA_NOT_READY', message: '数据库结构未就绪（迁移未应用）' },
  unavailable: { kind: 'unavailable', code: 'DB_UNAVAILABLE', message: '数据库不可用' },
  unknown: { kind: 'unknown', code: 'DB_ERROR', message: '数据库操作失败' },
};

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' ? error : '';
}

/** 只按错误类型与消息特征分类，不解析错误对象上的数据库内部字段。 */
export function classifyDbError(error: unknown): DbErrorKind {
  if (error instanceof MissingSchemaError) {
    return 'schema';
  }
  if (error instanceof DbBindingMissingError) {
    return 'unavailable';
  }

  const message = messageOf(error).toLowerCase();
  if (message.includes('unique constraint failed')) {
    return 'unique';
  }
  if (message.includes('constraint failed')) {
    // CHECK / NOT NULL / FOREIGN KEY 约束失败
    return 'constraint';
  }
  if (
    message.includes('d1_error') ||
    message.includes('no such table') ||
    message.includes('storage') ||
    message.includes('network') ||
    message.includes('connection')
  ) {
    return 'unavailable';
  }
  return 'unknown';
}

export function toSafeDbError(error: unknown): SafeDbError {
  return SAFE_ERRORS[classifyDbError(error)];
}

/**
 * D1 查询失败：对外只暴露安全信息，原始错误留在 cause 里供日志层使用。
 * 由 infra/db 的仓储抛出，由 http 层统一映射成响应包。
 */
export class DbQueryError extends Error {
  readonly kind: DbErrorKind;
  readonly safe: SafeDbError;

  constructor(safe: SafeDbError, cause: unknown) {
    super(safe.message, { cause });
    this.name = 'DbQueryError';
    this.kind = safe.kind;
    this.safe = safe;
  }
}
