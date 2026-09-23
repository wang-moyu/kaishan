import { readFileSync } from 'node:fs';

import {
  GAME_CONFIG_CONTENT,
  GAME_CONFIG_PAYLOAD_HASH,
  GAME_CONFIG_VERSION,
  gameConfigSource,
} from '@xiuxian/game-config';
import { computeConfigHash, validateGameConfig } from '@xiuxian/game-core';
import { describe, expect, it } from 'vitest';

// 摘要实现与 Worker 共用同一份（见 apps/server/src/infra/crypto/sha256.ts）
import { sha256Digest } from '../../apps/server/src/infra/crypto/sha256';

/**
 * 配置完整性（P0-03 验收：「无效配置启动失败」与「configVersion 加哈希校验」）。
 *
 * 这里的断言就是发布门禁：改动 game-config 内容却没更新 payloadHash、
 * 或没同步 seed 里的 config_versions 行，都会在这里失败。
 */

const SEED_PATH = 'scripts/seed/seed.sql';

describe('game-config 完整性', () => {
  it('基线配置通过 schema + 语义 + 哈希三道校验', async () => {
    const validated = await validateGameConfig(gameConfigSource, { digest: sha256Digest });

    expect(validated.version).toBe(GAME_CONFIG_VERSION);
    expect(validated.payloadHash).toBe(GAME_CONFIG_PAYLOAD_HASH);
  });

  it('声明的 payloadHash 与内容一致（内容改写必须改哈希与版本）', async () => {
    const computed = await computeConfigHash(GAME_CONFIG_CONTENT, sha256Digest);

    expect(computed).toBe(GAME_CONFIG_PAYLOAD_HASH);
  });

  it('内容被改写但版本/哈希没更新时校验失败', async () => {
    const tampered = {
      ...gameConfigSource,
      content: {
        ...GAME_CONFIG_CONTENT,
        offlineCapSeconds: (GAME_CONFIG_CONTENT.offlineCapSeconds as number) + 1,
      },
    };

    await expect(validateGameConfig(tampered, { digest: sha256Digest })).rejects.toThrow(
      /payloadHash/u,
    );
  });

  it('seed 中的 config_versions 行与配置版本/哈希一致', () => {
    const seed = readFileSync(SEED_PATH, 'utf8');
    const row = extractConfigVersionRow(seed);

    expect(row.version).toBe(GAME_CONFIG_VERSION);
    expect(row.payloadHash).toBe(GAME_CONFIG_PAYLOAD_HASH);
  });
});

function extractConfigVersionRow(sql: string): { id: string; version: string; payloadHash: string } {
  const insertIndex = sql.indexOf('INSERT INTO config_versions');
  if (insertIndex < 0) {
    throw new Error(`${SEED_PATH} 缺少 config_versions 种子行`);
  }
  const valuesIndex = sql.indexOf('VALUES', insertIndex);
  const openIndex = sql.indexOf('(', valuesIndex);
  const closeIndex = sql.indexOf(')', openIndex);
  if (valuesIndex < 0 || openIndex < 0 || closeIndex < 0) {
    throw new Error(`${SEED_PATH} 的 config_versions 行格式无法解析`);
  }

  const fields = sql
    .slice(openIndex + 1, closeIndex)
    .split(',')
    .map((field) => field.trim().replace(/^'(.*)'$/su, '$1'));

  const [id, version, payloadHash] = fields;
  if (id === undefined || version === undefined || payloadHash === undefined) {
    throw new Error(`${SEED_PATH} 的 config_versions 行字段不足`);
  }
  return { id, version, payloadHash };
}
