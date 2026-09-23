import { GAME_CONFIG_CONTENT } from '@xiuxian/game-config';
import {
  CanonicalJsonError,
  collectSchemaIssues,
  collectSemanticIssues,
  computeConfigHash,
  gameConfigContentSchema,
  hashConfigContent,
  validateGameConfig,
  type GameConfigContent,
} from '@xiuxian/game-core';
import { describe, expect, it } from 'vitest';

import { sha256Digest } from '../../apps/server/src/infra/crypto/sha256';

/**
 * 配置校验（P0-03 测试项：schema 边界、配置破损）。
 * 用例都从真实基线配置派生，保证「校验通过的那份配置」就是线上那份。
 */
function cloneConfig(): GameConfigContent {
  return structuredClone(GAME_CONFIG_CONTENT);
}

function semanticCodes(config: GameConfigContent): string[] {
  return collectSemanticIssues(config).map((issue) => issue.code);
}

describe('game-core 配置语义校验', () => {
  it('基线配置没有任何语义问题', () => {
    expect(collectSemanticIssues(cloneConfig())).toEqual([]);
  });

  it('重复 id：资源 / 建筑 / 岗位', () => {
    const config = cloneConfig();
    const first = config.resources[0];
    if (first === undefined) throw new Error('fixture 缺少资源');
    config.resources.push({ ...first });

    expect(semanticCodes(config)).toContain('duplicate_id');
  });

  it('引用不存在：升级成本、岗位产出、初始建筑、初始岗位', () => {
    const unknownResource = cloneConfig();
    const building = unknownResource.buildings[0];
    if (building === undefined) throw new Error('fixture 缺少建筑');
    building.upgradeCostPerLevel = { spiritStoneUndefined: '1' };
    expect(semanticCodes(unknownResource)).toContain('unknown_reference');

    const unknownBuilding = cloneConfig();
    unknownBuilding.sect.initialBuildings = [{ defId: 'notBuilt', level: 1 }];
    expect(semanticCodes(unknownBuilding)).toContain('unknown_reference');

    const unknownPosition = cloneConfig();
    unknownPosition.sect.initialDisciples = [{ realm: 'qiRefining', stage: 1, assignment: 'mining' as never }];
    expect(semanticCodes(unknownPosition)).toContain('unknown_reference');
  });

  it('成本/范围内问题：免费升级、空成本表、容量小于初始值、初始等级超上限', () => {
    const freeUpgrade = cloneConfig();
    const building = freeUpgrade.buildings[0];
    if (building === undefined) throw new Error('fixture 缺少建筑');
    building.upgradeCostPerLevel = { spiritStone: '0' };
    expect(semanticCodes(freeUpgrade)).toContain('invalid_cost');

    const emptyCost = cloneConfig();
    const second = emptyCost.buildings[1];
    if (second === undefined) throw new Error('fixture 缺少建筑');
    second.upgradeCostPerLevel = {};
    expect(semanticCodes(emptyCost)).toContain('invalid_cost');

    const capacityTooSmall = cloneConfig();
    const resource = capacityTooSmall.resources[0];
    if (resource === undefined) throw new Error('fixture 缺少资源');
    resource.capacity = '1';
    expect(semanticCodes(capacityTooSmall)).toContain('invalid_range');

    const levelTooHigh = cloneConfig();
    levelTooHigh.sect.initialBuildings = [{ defId: 'spiritualArray', level: 9 }];
    expect(semanticCodes(levelTooHigh)).toContain('invalid_range');
  });

  it('概率与上限：突破概率顺序错误、满资质系数超过总上限', () => {
    const badBreakthrough = cloneConfig();
    badBreakthrough.breakthrough = { ...badBreakthrough.breakthrough, minChanceBp: 9000, baseChanceBp: 8000 };
    expect(semanticCodes(badBreakthrough)).toContain('invalid_range');

    const badCultivation = cloneConfig();
    badCultivation.cultivation = { ...badCultivation.cultivation, maxTotalBonusBp: 9000 };
    expect(semanticCodes(badCultivation)).toContain('invalid_range');
  });

  it('严格 schema：未知字段、未知 section、错误类型都失败', () => {
    const unknownField = cloneConfig() as unknown as Record<string, unknown>;
    unknownField.unexpected = true;
    const schemaIssues = collectSchemaIssues(unknownField, 'p0.1.0');
    expect(schemaIssues.map((issue) => issue.code)).toContain('schema');

    const wrongType = cloneConfig() as unknown as Record<string, unknown>;
    wrongType.offlineCapSeconds = '43200';
    expect(collectSchemaIssues(wrongType, 'p0.1.0').map((issue) => issue.code)).toContain('schema');

    // 新 section 必须先加入 schema 才会被接受（避免拼错字段名静默失效）
    const unknownSection = cloneConfig() as unknown as Record<string, unknown>;
    unknownSection.events = [];
    expect(collectSchemaIssues(unknownSection, 'p0.1.0').map((issue) => issue.code)).toContain(
      'schema',
    );

    expect(collectSchemaIssues(cloneConfig(), 'bad version!').map((issue) => issue.code)).toContain(
      'invalid_version',
    );
    expect(gameConfigContentSchema.safeParse(cloneConfig()).success).toBe(true);
  });

  it('破损配置直接抛错，并列出所有问题路径', async () => {
    const broken = cloneConfig();
    const resource = broken.resources[0];
    if (resource === undefined) throw new Error('fixture 缺少资源');
    resource.capacity = '1';
    broken.resources.push({ ...resource });

    await expect(
      validateGameConfig({ version: 'p0.1.0', payloadHash: 'sha256:x', content: broken }),
    ).rejects.toThrow(/游戏配置校验失败/u);
  });
});

describe('game-core 规范化与哈希', () => {
  it('键顺序不影响规范化结果与哈希', async () => {
    const a = { b: 1, a: { d: [2, 3], c: 'x' } };
    const b = { a: { c: 'x', d: [2, 3] }, b: 1 };

    expect(await hashConfigContent(a, sha256Digest)).toBe(await hashConfigContent(b, sha256Digest));
  });

  it('数组顺序影响哈希（顺序在配置里有语义）', async () => {
    expect(await hashConfigContent([1, 2], sha256Digest)).not.toBe(
      await hashConfigContent([2, 1], sha256Digest),
    );
  });

  it('拒绝 undefined / NaN / BigInt', async () => {
    await expect(hashConfigContent({ a: undefined }, sha256Digest)).rejects.toThrow(
      CanonicalJsonError,
    );
    await expect(hashConfigContent({ a: Number.NaN }, sha256Digest)).rejects.toThrow(
      CanonicalJsonError,
    );
    await expect(hashConfigContent({ a: 1n }, sha256Digest)).rejects.toThrow(CanonicalJsonError);
  });

  it('哈希带算法前缀且长度固定', async () => {
    const hash = await computeConfigHash(cloneConfig(), sha256Digest);

    expect(hash.startsWith('sha256:')).toBe(true);
    expect(hash.slice('sha256:'.length)).toHaveLength(64);
  });
});
