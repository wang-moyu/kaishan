import {
  ALCHEMY_UNLOCK_BUILDING_ID,
  ALCHEMY_UNLOCK_SECT_LEVEL,
  BODY_TEMPERING_MAX_USES,
  CULTIVATION_PILL_GAIN,
  PILL_IDS,
  PILL_RECIPES,
  alchemyUnlockBlockedReason,
  bodyTemperingGain,
  bodyTemperingTarget,
  findPillRecipe,
  firstInsufficientResource,
  isAlchemyUnlocked,
} from '../../apps/server/src/modules/game/alchemy';
import { describe, expect, it } from 'vitest';

/**
 * 丹药系统纯函数（apps/server/src/modules/game/alchemy.ts）：
 * 配方表、解锁判断、淬体丹短板公式（02 文档第 3~4 节的基线）。
 * 不依赖 workerd/D1，跑在根级 node 测试里（vitest.config.ts）。
 */
describe('丹药配方定义', () => {
  it('第一版只有三种丹药，id 与文档一致', () => {
    expect(PILL_IDS).toEqual(['healingPill', 'cultivationPill', 'bodyTemperingPill']);
    expect(PILL_RECIPES).toHaveLength(3);
  });

  it('配方成本与文档基线一致（最小单位字符串）', () => {
    expect(findPillRecipe('healingPill')?.cost).toEqual({ herb: '10000', spiritStone: '15000' });
    expect(findPillRecipe('cultivationPill')?.cost).toEqual({
      herb: '25000',
      spiritualEnergy: '15000',
      spiritStone: '10000',
    });
    expect(findPillRecipe('bodyTemperingPill')?.cost).toEqual({
      herb: '40000',
      ore: '20000',
      spiritStone: '30000',
    });
  });

  it('未知 pill id 查不到配方', () => {
    expect(findPillRecipe('nope')).toBeUndefined();
  });

  it('规则常量与文档一致', () => {
    expect(ALCHEMY_UNLOCK_SECT_LEVEL).toBe(2);
    expect(ALCHEMY_UNLOCK_BUILDING_ID).toBe('herbGarden');
    expect(BODY_TEMPERING_MAX_USES).toBe(10);
    expect(CULTIVATION_PILL_GAIN).toBe(120);
  });
});

describe('炼丹解锁判断', () => {
  it('宗门与灵药园都达标才解锁', () => {
    expect(isAlchemyUnlocked(2, { herbGarden: 2 })).toBe(true);
    expect(isAlchemyUnlocked(3, { herbGarden: 5 })).toBe(true);
    expect(isAlchemyUnlocked(1, { herbGarden: 5 })).toBe(false);
    expect(isAlchemyUnlocked(2, { herbGarden: 1 })).toBe(false);
    expect(isAlchemyUnlocked(2, {})).toBe(false); // 没有灵药园行视为 0 级
  });

  it('未解锁 reason 非空，解锁返回 null（craft/use 与 sync 共用同一判定）', () => {
    expect(alchemyUnlockBlockedReason(2, { herbGarden: 2 })).toBeNull();
    expect(alchemyUnlockBlockedReason(1, { herbGarden: 2 })).toContain('宗门 2 级');
    expect(alchemyUnlockBlockedReason(2, { herbGarden: 1 })).toContain('灵药园 2 级');
  });
});

describe('淬体丹短板公式', () => {
  it('文档示例：攻 32 / 防 76 / 速 70 → 补攻 5（gap 41）', () => {
    expect(bodyTemperingTarget(32, 76, 70)).toEqual({ attribute: 'attack', gain: 5, gap: 41 });
  });

  it('提升量 = min(5, max(1, 1 + floor(gap/10)), 100 - 当前值)', () => {
    expect(bodyTemperingGain(41, 32)).toBe(5); // 1 + 4 = 5
    expect(bodyTemperingGain(9, 50)).toBe(1); // 1 + 0 = 1
    expect(bodyTemperingGain(10, 50)).toBe(2); // 1 + 1 = 2
    expect(bodyTemperingGain(60, 98)).toBe(2); // 100 - 98 = 2 封顶
    expect(bodyTemperingGain(5, 99)).toBe(1);
  });

  it('并列时按 attack -> defense -> speed 固定顺序', () => {
    // 攻防同为短板且 gap 相等：选 attack。
    expect(bodyTemperingTarget(10, 50, 50)).toEqual({ attribute: 'attack', gain: 5, gap: 40 });
    // 攻不是短板、防速并列（gap 同为 30 → gain 4）：选 defense。
    expect(bodyTemperingTarget(80, 20, 20)).toEqual({ attribute: 'defense', gain: 4, gap: 30 });
  });

  it('三项均衡（gap 全 <= 0）返回 null', () => {
    expect(bodyTemperingTarget(50, 50, 50)).toBeNull();
    // 最高属性继续堆高被禁止：攻最高时攻的 gap 一定 <= 0。
    expect(bodyTemperingTarget(100, 100, 100)).toBeNull();
  });

  it('中等差距：每次 +1 的递减路径', () => {
    // 98/76/70：防 gap = 8 → 1 + floor(8/10) = 1；速 gap = 11 → 2，选速？(98+76)/2=87-70=17？
    // 精确计算：攻 98 不可补；防 gap = (98+70)/2 - 76 = 8；速 gap = (98+76)/2 - 70 = 17 → 选速。
    expect(bodyTemperingTarget(98, 76, 70)).toEqual({ attribute: 'speed', gain: 2, gap: 17 });
  });

  it('gap > 0 蕴含当前值 < 100，提升量至少为 1', () => {
    for (let attack = 1; attack <= 100; attack += 7) {
      for (let defense = 1; defense <= 100; defense += 7) {
        for (let speed = 1; speed <= 100; speed += 7) {
          const target = bodyTemperingTarget(attack, defense, speed);
          if (target === null) continue;
          const current =
            target.attribute === 'attack' ? attack : target.attribute === 'defense' ? defense : speed;
          expect(target.gain).toBeGreaterThanOrEqual(1);
          expect(target.gain).toBeLessThanOrEqual(5);
          expect(current + target.gain).toBeLessThanOrEqual(100);
        }
      }
    }
  });
});

describe('成本预检', () => {
  it('firstInsufficientResource 返回第一个不足的资源；足够时返回 null', () => {
    const balances: Record<string, number> = { herb: 10_000, spiritStone: 5_000 };
    const balanceOf = (id: string) => balances[id] ?? 0;
    expect(firstInsufficientResource({ herb: '10000', spiritStone: '15000' }, balanceOf)).toBe(
      'spiritStone',
    );
    balances.spiritStone = 15_000;
    expect(firstInsufficientResource({ herb: '10000', spiritStone: '15000' }, balanceOf)).toBeNull();
  });
});
