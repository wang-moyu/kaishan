import { describe, expect, it } from 'vitest';

import {
  assertLocalD1Binding,
  LOCAL_DATABASE_ID,
  loadWranglerConfig,
  parseJsonc,
  stripJsonComments,
} from '../../scripts/db/check-local-binding.mjs';

/**
 * 本地 D1 绑定守卫的回归测试（P0-02 验收点：生产/未知远程绑定执行测试立即失败）。
 * 守卫本身在 apps/server 的 test:unit 里作为前置步骤执行，这里覆盖它的判定逻辑。
 */

const VALID_CONFIG = `
{
  // 行注释应被忽略
  "name": "test-server",
  /* 块注释也应被忽略 */
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "test-db",
      "database_id": "${LOCAL_DATABASE_ID}",
      "migrations_dir": "../../migrations"
    }
  ]
}
`;

const CONFIG_PATH = 'virtual/wrangler.jsonc';

describe('本地 D1 绑定守卫', () => {
  it('剥离行注释与块注释，且不动字符串里的 //', () => {
    expect(stripJsonComments('{"a":"http://x//y",/*c*/"b":1//t\n}')).toBe(
      '{"a":"http://x//y","b":1\n}',
    );
    expect(parseJsonc('{"a":"b" // 注释\n}')).toEqual({ a: 'b' });
  });

  it('容忍 UTF-8 BOM（Windows 工具常写入）', () => {
    expect(parseJsonc('\uFEFF{"a":"b"}')).toEqual({ a: 'b' });
  });

  it('哨兵 database_id 的配置通过检查', () => {
    const binding = assertLocalD1Binding(parseJsonc(VALID_CONFIG), CONFIG_PATH);

    expect(binding.binding).toBe('DB');
    expect(binding.database_id).toBe(LOCAL_DATABASE_ID);
  });

  it('换成真实/未知 database_id 立即失败', () => {
    const broken = parseJsonc(
      VALID_CONFIG.replace(LOCAL_DATABASE_ID, '11111111-1111-1111-1111-111111111111'),
    );

    expect(() => assertLocalD1Binding(broken, CONFIG_PATH)).toThrow(/database_id/u);
  });

  it('标记 remote 的绑定立即失败', () => {
    const broken = parseJsonc(
      VALID_CONFIG.replace('"migrations_dir"', '"remote": true, "migrations_dir"'),
    );

    expect(() => assertLocalD1Binding(broken, CONFIG_PATH)).toThrow(/remote/u);
  });

  it('缺少 DB 绑定或 migrations_dir 立即失败', () => {
    expect(() => assertLocalD1Binding(parseJsonc('{"name":"x"}'), CONFIG_PATH)).toThrow(
      /d1_databases/u,
    );

    const noMigrationsDir = parseJsonc(
      VALID_CONFIG.replace(',\n      "migrations_dir": "../../migrations"', ''),
    );
    expect(() => assertLocalD1Binding(noMigrationsDir, CONFIG_PATH)).toThrow(/migrations_dir/u);
  });

  it('仓库中的真实配置本身通过守卫', () => {
    const configPath = 'apps/server/wrangler.jsonc';
    const binding = assertLocalD1Binding(loadWranglerConfig(configPath), configPath);

    expect(binding.binding).toBe('DB');
    expect(binding.migrations_dir).toBe('../../migrations');
  });
});
