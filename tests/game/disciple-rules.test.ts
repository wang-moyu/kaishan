import { describe, expect, it } from 'vitest';

import { findTalent } from '../../apps/server/src/modules/game/constants';
import {
  ATTRIBUTE_MAX,
  ATTRIBUTE_MIN,
  ATTRIBUTE_NEUTRAL,
  DISCIPLE_RULE_VERSION,
  attributeScore,
  generateAttributes,
  generateCandidates,
  recruitBatchId,
  recruitBatchStatus,
  seededRandom,
  type DiscipleAttributes,
} from '../../apps/server/src/modules/game/names';

/**
 * 0016 弟子属性与综合评分的**纯规则**（apps/server/src/modules/game/names.ts）：
 * 属性生成分布与边界、攻/防/身法的「共用基础值」约束、六项等权评分与取整、
 * 以及招贤批次标识的判定。
 *
 * 这些测试不需要 workerd / D1，跑在根级 node 测试里（vitest.config.ts）；
 * HTTP + D1 的行为（迁移、预览=招募、过期批次拒绝、历练概率落库）在
 * apps/server/test/disciple-rating.test.ts 里覆盖。
 */

/** 按顺序返回给定值的随机源（用于钉死生成结果）。 */
function sequence(values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index % values.length]!;
    index += 1;
    return value;
  };
}

/** 用固定种子生成 n 组完整属性（确定性，不依赖真实随机）。 */
function sweep(n: number, seed = 'disciple-rules'): DiscipleAttributes[] {
  const random = seededRandom(seed);
  const list: DiscipleAttributes[] = [];
  for (let i = 0; i < n; i++) {
    list.push(generateAttributes(random));
  }
  return list;
}

function combatSpread(attributes: DiscipleAttributes): number {
  const values = [attributes.attack, attributes.defense, attributes.speed];
  return Math.max(...values) - Math.min(...values);
}

describe('属性生成：范围与随机源边界', () => {
  it('区间端点是 1..100（1 + floor(100 × (r1 + r2) / 2)）', () => {
    expect(ATTRIBUTE_MIN).toBe(1);
    expect(ATTRIBUTE_MAX).toBe(100);
    expect(ATTRIBUTE_NEUTRAL).toBe(50);
  });

  it('随机源全返回 0：资质 / 幸运 / 体魄取最小 1，攻防身法夹取到 1（偏移可到 −15）', () => {
    const random = sequence([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(generateAttributes(random)).toEqual({
      aptitude: 1,
      luck: 1,
      physique: 1,
      attack: 1,
      defense: 1,
      speed: 1,
    });
  });

  it('随机源全接近 1：六项都取到 100（基础值 85 + 偏移 15）', () => {
    const random = sequence([0.999999, 0.999999, 0.999999, 0.999999, 0.999999, 0.999999, 0.999999, 0.999999, 0.999999, 0.999999]);
    expect(generateAttributes(random)).toEqual({
      aptitude: 100,
      luck: 100,
      physique: 100,
      attack: 100,
      defense: 100,
      speed: 100,
    });
  });

  it('资质 / 幸运 / 体魄三项各自独立消费两次随机数', () => {
    // 资质两次 0 → 1；幸运两次 0.999999 → 100；体魄两次 0.5 → 51。
    const random = sequence([0, 0, 0.999999, 0.999999, 0.5, 0.5, 0.3, 0.7, 0.7, 0.3]);
    const attributes = generateAttributes(random);
    expect(attributes.aptitude).toBe(1);
    expect(attributes.luck).toBe(100);
    expect(attributes.physique).toBe(51);
  });

  it('攻 / 防 / 身法共用同一个基础值：出生时三项最大差距不超过 30', () => {
    const list = sweep(3_000);
    for (const attributes of list) {
      expect(combatSpread(attributes)).toBeLessThanOrEqual(30);
    }
    // 不是退化：确实存在偏科（差距 > 10）的弟子。
    expect(list.some((attributes) => combatSpread(attributes) > 10)).toBe(true);
  });

  it('仍然允许偏科与少量接近 100 的战斗属性', () => {
    const list = sweep(3_000);
    expect(list.some((attributes) => Math.max(attributes.attack, attributes.defense, attributes.speed) >= 95)).toBe(
      true,
    );
  });

  it('六项都在 1..100 且都是整数', () => {
    for (const attributes of sweep(1_000)) {
      for (const value of Object.values(attributes)) {
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(ATTRIBUTE_MIN);
        expect(value).toBeLessThanOrEqual(ATTRIBUTE_MAX);
      }
    }
  });

  it('资质 / 幸运 / 体魄是「中间常见、极值罕见」，且不受战斗基础值约束', () => {
    const list = sweep(3_000);
    const centered = list.flatMap((attributes) => [
      attributes.aptitude,
      attributes.luck,
      attributes.physique,
    ]);
    const share = (predicate: (value: number) => boolean): number =>
      centered.filter(predicate).length / centered.length;
    // 两次均匀随机取平均 → 三角分布（密度在 0.5 处最大、两端线性趋零）：
    // 实测峰值带 [45,56] 约 22%、两端 [1,20] 与 [81,100] 各约 8%，这里给宽裕边界避免脆弱断言。
    const peak = share((value) => value >= 45 && value <= 56);
    const extremes = share((value) => value <= 20 || value >= 81);
    expect(peak).toBeGreaterThan(0.15);
    expect(extremes).toBeLessThan(0.25);
    // 结构性质：中间带比两端更常见（极值罕见）。
    expect(peak).toBeGreaterThan(extremes);
  });

  it('固定种子可复现：同一随机源序列必然得到同一组属性', () => {
    expect(sweep(5, 'fixed-seed')).toEqual(sweep(5, 'fixed-seed'));
    expect(sweep(5, 'seed-a')).not.toEqual(sweep(5, 'seed-b'));
  });
});

describe('综合评分：当前六项等权，一位小数', () => {
  it('六项全 1 → 1.0；六项全 100 → 100.0（公式端点的真实值）', () => {
    const min: DiscipleAttributes = {
      aptitude: 1,
      attack: 1,
      defense: 1,
      speed: 1,
      luck: 1,
      physique: 1,
    };
    const max: DiscipleAttributes = {
      aptitude: 100,
      attack: 100,
      defense: 100,
      speed: 100,
      luck: 100,
      physique: 100,
    };
    expect(attributeScore(min)).toBe(1);
    expect(attributeScore(max)).toBe(100);
  });

  it('按 round(total × 10 / 6) / 10 取整：总 300 → 50，总 301 → 50.2', () => {
    expect(
      attributeScore({ aptitude: 50, attack: 50, defense: 50, speed: 50, luck: 50, physique: 50 }),
    ).toBe(50);
    expect(
      attributeScore({ aptitude: 51, attack: 50, defense: 50, speed: 50, luck: 50, physique: 50 }),
    ).toBe(50.2);
    // floor 而不是 round 的反例：总 302 → 503.33 → 503 → 50.3（若是截断会得到 50.3 之外的错值）。
    expect(
      attributeScore({ aptitude: 52, attack: 50, defense: 50, speed: 50, luck: 50, physique: 50 }),
    ).toBe(50.3);
  });

  it('任意一项 +1，显示分至少 +0.1；六项全 +1 至少 +1.0', () => {
    const base: DiscipleAttributes = {
      aptitude: 30,
      attack: 41,
      defense: 55,
      speed: 62,
      luck: 17,
      physique: 88,
    };
    const keys = ['aptitude', 'attack', 'defense', 'speed', 'luck', 'physique'] as const;
    const before = attributeScore(base);
    for (const key of keys) {
      const after = attributeScore({ ...base, [key]: base[key] + 1 });
      expect(after - before).toBeGreaterThanOrEqual(0.1 - 1e-9);
    }
    const allUp = attributeScore({
      aptitude: base.aptitude + 1,
      attack: base.attack + 1,
      defense: base.defense + 1,
      speed: base.speed + 1,
      luck: base.luck + 1,
      physique: base.physique + 1,
    });
    expect(allUp - before).toBeGreaterThanOrEqual(1 - 1e-9);
  });

  it('只由六项属性决定：境界 / 修为 / 天赋 / 战力等额外字段不参与', () => {
    const attributes: DiscipleAttributes = {
      aptitude: 60,
      attack: 20,
      defense: 70,
      speed: 40,
      luck: 10,
      physique: 90,
    };
    const polluted = {
      ...attributes,
      realmId: 'spiritTransformation',
      stage: 9,
      cultivation: 999_999,
      talent: 'combat',
      combatPower: 12_345,
    } as DiscipleAttributes;
    expect(attributeScore(polluted)).toBe(attributeScore(attributes));
  });

  it('评分是六项等权平均，不因「偏科」被打折（与平均值的 1 位小数一致）', () => {
    const attributes: DiscipleAttributes = {
      aptitude: 100,
      attack: 1,
      defense: 100,
      speed: 1,
      luck: 100,
      physique: 1,
    };
    const total = 100 + 1 + 100 + 1 + 100 + 1;
    expect(attributeScore(attributes)).toBe(Math.round((total * 10) / 6) / 10);
  });
});

describe('招贤候选人：预览确定性与评分口径', () => {
  it('同一组 seed 参数生成同一批 3 人（反复预览一致）', () => {
    const first = generateCandidates('sect-1', '2026-01-01', 0, 0);
    const second = generateCandidates('sect-1', '2026-01-01', 0, 0);
    expect(first).toHaveLength(3);
    expect(first).toEqual(second);
  });

  it('宗门 / 日期键 / 已招募次数 / 刷新序号任一变化都会换一批', () => {
    const base = generateCandidates('sect-1', '2026-01-01', 0, 0);
    expect(generateCandidates('sect-2', '2026-01-01', 0, 0)).not.toEqual(base);
    expect(generateCandidates('sect-1', '2026-01-02', 0, 0)).not.toEqual(base);
    expect(generateCandidates('sect-1', '2026-01-01', 1, 0)).not.toEqual(base);
    expect(generateCandidates('sect-1', '2026-01-01', 0, 1)).not.toEqual(base);
  });

  it('候选人六项都在 1..100、攻防身法最大差距 ≤ 30、评分与六项一致', () => {
    for (const candidate of generateCandidates('sect-1', '2026-01-01', 0, 0)) {
      const attributes: DiscipleAttributes = {
        aptitude: candidate.aptitude,
        attack: candidate.attack,
        defense: candidate.defense,
        speed: candidate.speed,
        luck: candidate.luck,
        physique: candidate.physique,
      };
      for (const value of Object.values(attributes)) {
        expect(value).toBeGreaterThanOrEqual(ATTRIBUTE_MIN);
        expect(value).toBeLessThanOrEqual(ATTRIBUTE_MAX);
      }
      expect(combatSpread(attributes)).toBeLessThanOrEqual(30);
      expect(candidate.attributeScore).toBe(attributeScore(attributes));
    }
  });

  it('性别与姓名合法性、天赋展示名沿用既有规则（不因新属性而改变）', () => {
    for (const candidate of generateCandidates('sect-1', '2026-01-01', 0, 0)) {
      expect(['male', 'female']).toContain(candidate.gender);
      expect(candidate.name.length).toBeGreaterThanOrEqual(2);
      expect(['herbGathering', 'mining', 'cultivation', 'combat']).toContain(candidate.talent);
      expect(candidate.talentName).toBe(findTalent(candidate.talent)?.name ?? candidate.talent);
    }
  });
});

describe('招贤批次标识', () => {
  const expected = {
    sectId: 'sect-1',
    dateKey: '2026-01-01',
    recruitCount: 2,
    refreshSeq: 1,
  };

  it('包含生成规则版本、宗门 id、日期键、招募次数与刷新序号', () => {
    expect(DISCIPLE_RULE_VERSION).toBe(2);
    expect(recruitBatchId(expected)).toBe(
      `${DISCIPLE_RULE_VERSION}:sect-1:2026-01-01:2:1`,
    );
  });

  it('任一组成变化都会得到不同的批次标识（跨天 / 刷新 / 招募次数 / 版本 / 宗门）', () => {
    const base = recruitBatchId(expected);
    expect(recruitBatchId({ ...expected, dateKey: '2026-01-02' })).not.toBe(base);
    expect(recruitBatchId({ ...expected, refreshSeq: 2 })).not.toBe(base);
    expect(recruitBatchId({ ...expected, recruitCount: 3 })).not.toBe(base);
    expect(recruitBatchId({ ...expected, sectId: 'sect-2' })).not.toBe(base);
    // 批次里带版本号：规则版本一变，旧的批次就不再等于当前批次。
    expect(recruitBatchId(expected).startsWith(`${DISCIPLE_RULE_VERSION}:`)).toBe(true);
  });

  it('批次判定：一致 = current，不一致 = stale，缺省/空串 = missing（旧客户端）', () => {
    const batch = recruitBatchId(expected);
    expect(recruitBatchStatus(batch, expected)).toBe('current');
    expect(recruitBatchStatus(recruitBatchId({ ...expected, refreshSeq: 0 }), expected)).toBe(
      'stale',
    );
    expect(recruitBatchStatus(undefined, expected)).toBe('missing');
    expect(recruitBatchStatus('', expected)).toBe('missing');
    expect(recruitBatchStatus('1:sect-1:2026-01-01:2:1', expected)).toBe('stale');
  });
});
