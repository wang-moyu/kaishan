import { createJsonLogger, type Logger } from '../../src/infra/logging/logger';

/** 捕获真实 JSON 日志行，测试里再解析断言（复用生产 logger 实现，避免两套格式）。 */
export interface CapturedLog {
  level: string;
  event: string;
  time: string;
  [key: string]: unknown;
}

export interface CapturingLogger {
  logger: Logger;
  lines: string[];
  parsed(): CapturedLog[];
}

export function createCapturingLogger(): CapturingLogger {
  const lines: string[] = [];
  const logger = createJsonLogger((line) => lines.push(line));

  return {
    logger,
    lines,
    parsed: () => lines.map((line) => JSON.parse(line) as CapturedLog),
  };
}
