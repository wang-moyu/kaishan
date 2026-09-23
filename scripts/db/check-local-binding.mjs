#!/usr/bin/env node
/**
 * 本地 D1 绑定守卫。
 *
 * 作用：在跑测试/接管本地 D1 之前，断言 wrangler 配置里的 DB 绑定仍然指向**本地哨兵库**，
 * 从而做到「生产/未知远程绑定执行测试立即失败」（P0-02 验收项，见 05 第 1 节、06 第 6 节）。
 *
 * 判定规则（任一不满足即退出码 1 并打印原因）：
 *   1. 必须存在 d1_databases，且恰好有一个 binding = DB；
 *   2. 不能带 remote / experimental_remote = true；
 *   3. database_id 必须等于本文件里的本地哨兵 UUID（接远程库必须先取得授权并同步改这个守卫）；
 *   4. 必须声明 migrations_dir。
 *
 * 用法：
 *   node scripts/db/check-local-binding.mjs --config apps/server/wrangler.jsonc
 * 被 apps/server 的 test:unit 脚本调用，也可单独在 CI 中执行。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const D1_BINDING_NAME = 'DB';
/** 全零 UUID：明确表示“不是真实库”，任何真实 database_id 都会让检查失败。 */
export const LOCAL_DATABASE_ID = '00000000-0000-0000-0000-000000000000';

const DEFAULT_CONFIG = 'apps/server/wrangler.jsonc';

/**
 * 去掉 JSONC 的行注释与块注释。自己实现是为了不引入额外依赖，
 * 且只用于读取本项目自己的 wrangler 配置（不做通用 JSONC 解析器承诺）。
 */
export function stripJsonComments(text) {
  let out = '';
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
        out += char;
      }
      continue;
    }
    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      out += char;
      if (char === '\\') {
        out += next ?? '';
        i += 1;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }
    out += char;
  }

  // 去注释后可能留下尾随逗号
  return out.replace(/,(\s*[}\]])/g, '$1');
}

export function parseJsonc(text) {
  // 容忍 Windows 工具写入的 UTF-8 BOM，避免把 BOM 当成 JSON 语法错误
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return JSON.parse(stripJsonComments(body));
}

export function loadWranglerConfig(configPath) {
  return parseJsonc(readFileSync(configPath, 'utf8'));
}

/** 校验配置并返回 DB 绑定；不满足则抛错（错误信息可直接给人看）。 */
export function assertLocalD1Binding(config, configPath) {
  const declared = config?.d1_databases;
  if (!Array.isArray(declared) || declared.length === 0) {
    throw new Error(`${configPath}：缺少 d1_databases 绑定，本地/测试无法访问 D1`);
  }

  const matches = declared.filter((entry) => entry?.binding === D1_BINDING_NAME);
  if (matches.length !== 1) {
    throw new Error(
      `${configPath}：必须恰好有一个 binding 为 "${D1_BINDING_NAME}" 的 D1 绑定（当前 ${matches.length} 个）`,
    );
  }

  const binding = matches[0];
  if (binding.remote === true || binding.experimental_remote === true) {
    throw new Error(
      `${configPath}：D1 绑定 "${D1_BINDING_NAME}" 被标记为 remote，测试不允许连接远程库`,
    );
  }
  if (binding.database_id !== LOCAL_DATABASE_ID) {
    throw new Error(
      `${configPath}：D1 database_id 不是本地哨兵值（期望 ${LOCAL_DATABASE_ID}，实际 ${String(
        binding.database_id,
      )}）。测试只允许本地 D1；接远程库必须先取得授权，并同步更新本守卫与 05/07 记录。`,
    );
  }
  if (typeof binding.migrations_dir !== 'string' || binding.migrations_dir.length === 0) {
    throw new Error(`${configPath}：D1 绑定 "${D1_BINDING_NAME}" 必须声明 migrations_dir`);
  }

  return binding;
}

export function run(argv) {
  const configFlagIndex = argv.indexOf('--config');
  const configPath = resolve(configFlagIndex >= 0 ? argv[configFlagIndex + 1] : DEFAULT_CONFIG);
  try {
    const binding = assertLocalD1Binding(loadWranglerConfig(configPath), configPath);
    console.log(
      `✅ 本地 D1 绑定检查通过：binding=${binding.binding} database_id=${binding.database_id} migrations_dir=${binding.migrations_dir}`,
    );
    return 0;
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  process.exit(run(process.argv.slice(2)));
}
