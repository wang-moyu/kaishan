import { GAME_CONFIG_CONTENT } from '@xiuxian/game-config';
import { PUBLIC_CONFIG_SECTIONS, toPublicGameConfig, type GameConfigContent } from '@xiuxian/game-core';
import { describe, expect, it } from 'vitest';

/**
 * 公开配置投影（P0-03 验收：公开配置不暴露隐藏奖励）。
 *
 * 机制是白名单：未列出的 section 一律不公开，即使是将来新增的。
 * 这里用**测试夹具**模拟未来的「事件暗奖」section 与 internal 条目，
 * 不去发明生产配置内容。
 */
describe('公开配置投影', () => {
  it('只包含白名单 section，未知 section 一律剔除', () => {
    const configWithHiddenSection = {
      ...GAME_CONFIG_CONTENT,
      events: [
        {
          id: 'secretEvent',
          name: '暗奖事件',
          hiddenRewards: [{ itemDefId: 'legendaryPill', weight: 3 }],
          rngSeed: 'seed-1',
        },
      ],
    } as unknown as GameConfigContent;

    const publicConfig = toPublicGameConfig(configWithHiddenSection);
    const serialized = JSON.stringify(publicConfig);

    expect(Object.keys(publicConfig).sort()).toEqual([...PUBLIC_CONFIG_SECTIONS].sort());
    expect(serialized).not.toContain('events');
    expect(serialized).not.toContain('hiddenRewards');
    expect(serialized).not.toContain('weight');
    expect(serialized).not.toContain('rngSeed');
    expect(serialized).not.toContain('legendaryPill');
  });

  it('visibility = internal 的条目被剔除，public 条目保留', () => {
    const config = structuredClone(GAME_CONFIG_CONTENT);
    const firstResource = config.resources[0];
    if (firstResource === undefined) throw new Error('fixture 缺少资源');

    config.resources.push({
      ...firstResource,
      id: 'internalToken',
      name: '内部资源',
      visibility: 'internal',
    });

    const publicConfig = toPublicGameConfig(config);
    const ids = publicConfig.resources.map((resource) => resource.id);

    expect(ids).not.toContain('internalToken');
    expect(ids).toContain('spiritStone');
    expect(ids).toHaveLength(config.resources.length - 1);
    expect(JSON.stringify(publicConfig)).not.toContain('internalToken');
  });

  it('不修改原配置，且公开内容与源配置逐字段一致（除被剔除项）', () => {
    const config = structuredClone(GAME_CONFIG_CONTENT);
    const snapshot = JSON.stringify(config);

    const publicConfig = toPublicGameConfig(config);

    expect(JSON.stringify(config)).toBe(snapshot);
    expect(publicConfig.server).toEqual(config.server);
    expect(publicConfig.offlineCapSeconds).toBe(config.offlineCapSeconds);
    expect(publicConfig.buildings).toHaveLength(config.buildings.length);
    expect(publicConfig.recruitment).toEqual(config.recruitment);
    expect(publicConfig.breakthrough).toEqual(config.breakthrough);
  });

  it('公开投影里不出现任何 internal 字样', () => {
    const config = structuredClone(GAME_CONFIG_CONTENT);
    const firstBuilding = config.buildings[0];
    if (firstBuilding === undefined) throw new Error('fixture 缺少建筑');
    config.buildings[0] = { ...firstBuilding, visibility: 'internal' };

    const serialized = JSON.stringify(toPublicGameConfig(config));
    expect(serialized).not.toContain('internal');
    expect(serialized).not.toContain('内部');
  });
});
