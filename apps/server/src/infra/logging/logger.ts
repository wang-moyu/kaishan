import { redact } from './redact';

/**
 * Workers 结构化日志（02 第 1、5 节：结构化 console 日志 + requestId，禁止输出 secret）。
 *
 * - 每行一个 JSON 对象，便于 Workers Observability / 日志平台按 requestId 关联；
 * - 所有字段先过 redact()，密码/token/cookie/hash 类键名一律打码；
 * - logger 以接口形式注入 createApp()，测试可以传入内存实现断言写了什么。
 */

export interface LogFields {
  [key: string]: unknown;
}

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogLine extends LogFields {
  level: LogLevel;
  event: string;
  time: string;
}

export function createJsonLogger(sink: (line: string) => void): Logger {
  const write = (level: LogLevel, event: string, fields: LogFields = {}): void => {
    const line: LogLine = {
      level,
      event,
      time: new Date().toISOString(),
      ...(redact(fields) as LogFields),
    };
    sink(JSON.stringify(line));
  };

  return {
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
  };
}

export function createConsoleLogger(): Logger {
  return createJsonLogger((line) => {
    console.log(line);
  });
}

/** 把异常压成可安全写日志的形状（不含 SQL 参数与 secret）。 */
export function describeError(error: unknown): LogFields {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: 'UnknownError', message: typeof error === 'string' ? error : 'non-error thrown' };
}
