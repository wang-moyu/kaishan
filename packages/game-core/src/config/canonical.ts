/**
 * 规范化 JSON 序列化：用于配置内容哈希。
 *
 * 规则（确定性，与键顺序无关）：
 * - 对象键按字典序升序输出；
 * - 数组保持原顺序（顺序在配置里有语义，例如 resources 的展示顺序）；
 * - 字符串用 JSON 转义；null 保留；布尔与有限数字按 JSON 输出；
 * - undefined、NaN、Infinity、函数、Symbol、BigInt 一律拒绝（配置里不该出现）。
 *
 * 不做这些规范化，同一份语义相同但书写顺序不同的配置会算出不同哈希，
 * 让「同版本内容未被改写」的校验失去意义（见 03 第 12 节）。
 */
export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalJsonError';
  }
}

export function canonicalizeJson(value: unknown): string {
  return write(value, []);
}

function write(value: unknown, path: readonly string[]): string {
  if (value === null) {
    return 'null';
  }

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number': {
      if (!Number.isFinite(value)) {
        throw new CanonicalJsonError(`${describe(path)}：不允许非有限数字`);
      }
      return JSON.stringify(value);
    }
    case 'object': {
      if (Array.isArray(value)) {
        const items = value.map((item, index) => write(item, [...path, String(index)]));
        return `[${items.join(',')}]`;
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      const entries = keys.map((key) => {
        const child = record[key];
        if (child === undefined) {
          throw new CanonicalJsonError(`${describe([...path, key])}：不允许 undefined`);
        }
        return `${JSON.stringify(key)}:${write(child, [...path, key])}`;
      });
      return `{${entries.join(',')}}`;
    }
    default:
      throw new CanonicalJsonError(
        `${describe(path)}：不支持的类型 ${typeof value}（不允许 undefined/BigInt/函数）`,
      );
  }
}

function describe(path: readonly string[]): string {
  return path.length === 0 ? '配置根' : `配置字段 ${path.join('.')}`;
}
