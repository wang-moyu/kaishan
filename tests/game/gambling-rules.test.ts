import {
  ATTRIBUTE_INSIGHT_REWARDS,
  ATTRIBUTE_LABELS,
  ATTRIBUTE_MAX,
  ATTRIBUTE_STAKES,
  BETTABLE_ATTRIBUTES,
  BETTABLE_RESOURCES,
  DAO_INSIGHT_CAP,
  DEBATE_DAILY_LIMIT,
  DEBATE_TIER_ANCHOR,
  DEBATE_TIER_ANCHOR_RANGE,
  DEBATE_TIER_KEYS,
  DEBATE_TIER_PROBABILITIES,
  DEGRADED_WIN_RATES,
  FREE_BET_MIN,
  FREE_BET_WIN_MULTIPLIER,
  GAMBLING_LOCKED_REASON,
  GAMBLING_UNLOCK_SECT_LEVEL,
  LUCK_REVEAL_THRESHOLD_1,
  LUCK_REVEAL_THRESHOLD_2,
  OPPONENT_WEIGHT_SPREAD,
  PRESET_INSIGHT_REWARDS,
  PRESET_RESOURCE_REWARDS,
  PRESET_STAKES,
  REVEAL_OPPONENT_FACTOR,
  WHEEL_BIG_MULTIPLIER,
  WHEEL_BIG_SLOTS,
  WHEEL_MULTIPLIER_MAX,
  WHEEL_MULTIPLIER_MIN,
  WHEEL_NOTHING_SLOTS,
  WHEEL_RESET_COST,
  WHEEL_SLOT_COUNT,
  WHEEL_SMALL_SLOTS_MAX,
  WHEEL_SMALL_SLOTS_MIN,
  WHEEL_SPIN_COST,
  WHEEL_TIERS,
  debateDayStateOf,
  debateTierProbability,
  freeBetReward,
  freeBetStake,
  gamblingUnlockBlockedReason,
  generateOpponentAttrs,
  generateRevealHints,
  isBettableResource,
  isGamblingUnlocked,
  revealCount,
  generateWheelSlots,
  wheelLayoutSeed,
  wheelReward,
  wheelSlotLabel,
  wheelSpinCost,
  type WheelSlot,
} from '../../apps/server/src/modules/game/gambling';

import { PILL_IDS } from '../../apps/server/src/modules/game/alchemy';
import { describe, expect, it } from 'vitest';

/**
 * 赌坊纯函数（apps/server/src/modules/game/gambling.ts）：
 * 解锁门槛、赌注/奖励表、每日次数归一、幸运侦查文案（docs/赌坊开发计划.md 第 3、4、6 节）。
 * 不依赖 workerd/D1，跑在根级 node 测试里（vitest.config.ts）。
 */

const ATTRIBUTE_SAMPLE: Record<(typeof BETTABLE_ATTRIBUTES)[number], number> = {
  attack: 60,
  defense: 50,
  speed: 40,
  aptitude: 70,
  luck: 90,
  physique: 30,
};

describe('赌坊解锁与常量', () => {
  it('解锁只看宗门 2 级，不依赖建筑（计划 2.1）', () => {
    expect(GAMBLING_UNLOCK_SECT_LEVEL).toBe(2);
    expect(isGamblingUnlocked(1)).toBe(false);
    expect(isGamblingUnlocked(2)).toBe(true);
    expect(isGamblingUnlocked(9)).toBe(true);
    expect(gamblingUnlockBlockedReason(1)).toBe(GAMBLING_LOCKED_REASON);
    expect(gamblingUnlockBlockedReason(2)).toBeNull();
  });

  it('每日 50 次（DEBATE_DAILY_LIMIT）、悟道值累计上限 50、属性上限 100（计划 2.2 / 2.3）', () => {
    expect(DEBATE_DAILY_LIMIT).toBe(50);
    expect(DAO_INSIGHT_CAP).toBe(50);
    expect(ATTRIBUTE_MAX).toBe(100);
  });

  it('白名单：三种可赌资源 + 六项可赌属性', () => {
    expect([...BETTABLE_RESOURCES]).toEqual(['spiritStone', 'herb', 'ore']);
    expect([...BETTABLE_ATTRIBUTES]).toEqual([
      'attack',
      'defense',
      'speed',
      'aptitude',
      'luck',
      'physique',
    ]);
    expect(isBettableResource('spiritStone')).toBe(true);
    expect(isBettableResource('spiritualEnergy')).toBe(false);
    expect(isBettableResource('')).toBe(false);
    // 侦查文案要用到的展示名必须六项齐全。
    for (const attribute of BETTABLE_ATTRIBUTES) {
      expect(ATTRIBUTE_LABELS[attribute]).toBeTruthy();
    }
  });
});

describe('赌注与奖励表（计划第 3 节）', () => {
  it('模式 A：预设灵石赌注 / 灵石奖励 / 悟道值奖励', () => {
    expect(PRESET_STAKES).toEqual({ 1: 100000, 2: 200000, 3: 300000 });
    expect(PRESET_RESOURCE_REWARDS).toEqual({ 1: 180000, 2: 360000, 3: 540000 });
    expect(PRESET_INSIGHT_REWARDS).toEqual({ 1: 1, 2: 2, 3: 3 });
  });

  it('模式 B：最小赌注 10000、赢 1.8 倍（整数截断）', () => {
    expect(FREE_BET_MIN).toBe(10000);
    expect(FREE_BET_WIN_MULTIPLIER).toBe(1.8);
    expect(freeBetStake(10000, 1)).toBe(10000);
    expect(freeBetStake(10000, 3)).toBe(30000);
    expect(freeBetReward(10000, 1)).toBe(18000);
    expect(freeBetReward(10000, 3)).toBe(54000);
    // 1.8 倍会产生小数，一律 floor 到整数最小单位（计划 14.1）。
    expect(freeBetReward(10001, 1)).toBe(18001); // 18001.8 -> 18001
    expect(Number.isInteger(freeBetReward(12345, 2))).toBe(true);
  });

  it('模式 C：属性赌注点数与悟道值奖励', () => {
    expect(ATTRIBUTE_STAKES).toEqual({ 1: 1, 2: 2, 3: 3 });
    expect(ATTRIBUTE_INSIGHT_REWARDS).toEqual({ 1: 2, 2: 4, 3: 6 });
  });

  it('降级胜率：1x/2x/3x = 50% / 42% / 34%（基点，与档位表对齐）', () => {
    expect(DEGRADED_WIN_RATES).toEqual({ 1: 5000, 2: 4200, 3: 3400 });
    expect(DEGRADED_WIN_RATES[1] / 10_000).toBeCloseTo(0.5);
    expect(DEGRADED_WIN_RATES[2] / 10_000).toBeCloseTo(0.42);
    expect(DEGRADED_WIN_RATES[3] / 10_000).toBeCloseTo(0.34);
  });
});

describe('幸运侦查（计划 4.5）', () => {
  it('阈值 70 / 85 决定提示数量', () => {
    expect(LUCK_REVEAL_THRESHOLD_1).toBe(70);
    expect(LUCK_REVEAL_THRESHOLD_2).toBe(85);
    expect(revealCount(0)).toBe(0);
    expect(revealCount(69)).toBe(0);
    expect(revealCount(70)).toBe(1);
    expect(revealCount(84)).toBe(1);
    expect(revealCount(85)).toBe(2);
    expect(revealCount(100)).toBe(2);
  });

  it('幸运不足时没有提示；够时条数与幸运一致，且都是对手属性文案', () => {
    expect(generateRevealHints(ATTRIBUTE_SAMPLE, 1, 60)).toEqual([]);
    const one = generateRevealHints(ATTRIBUTE_SAMPLE, 1, 70);
    expect(one).toHaveLength(1);
    expect(one[0]).toMatch(/^对手(攻击|防御|身法|资质|幸运|体魄)/);
    expect(generateRevealHints(ATTRIBUTE_SAMPLE, 1, 90)).toHaveLength(2);
  });

  it('是确定性纯函数：同输入同输出（不调用 jev、不用随机数）', () => {
    const first = generateRevealHints(ATTRIBUTE_SAMPLE, 2, 90);
    const second = generateRevealHints(ATTRIBUTE_SAMPLE, 2, 90);
    expect(first).toEqual(second);
    // 倍率改变对手基准与取样偏移，所以文案会变（但仍是确定性结果）。
    expect(generateRevealHints(ATTRIBUTE_SAMPLE, 3, 90)).not.toEqual(
      generateRevealHints(ATTRIBUTE_SAMPLE, 1, 90),
    );
  });
});

describe('论道每日次数归一（计划 2.2：UTC+8 自然日重置）', () => {
  /** 2026-01-05 09:00 UTC+8（= 01:00 UTC）。 */
  const NOON_UTC8 = Date.UTC(2026, 0, 5, 1, 0, 0);

  it('日期键是今天 → 用 debate_count，剩余 = DEBATE_DAILY_LIMIT - 已用', () => {
    const state = debateDayStateOf(
      { debate_date_key: '2026-01-05', debate_count: 3 },
      NOON_UTC8,
    );
    expect(state.dateKey).toBe('2026-01-05');
    expect(state.keyMatches).toBe(true);
    expect(state.usedToday).toBe(3);
    expect(state.remaining).toBe(DEBATE_DAILY_LIMIT - 3);
  });

  it('日期键不是今天 → 视为 0（跨天重置）', () => {
    const state = debateDayStateOf(
      { debate_date_key: '2026-01-04', debate_count: DEBATE_DAILY_LIMIT },
      NOON_UTC8,
    );
    expect(state.keyMatches).toBe(false);
    expect(state.usedToday).toBe(0);
    expect(state.remaining).toBe(DEBATE_DAILY_LIMIT);
  });

  it('debate_count = DEBATE_DAILY_LIMIT（50）视为用尽', () => {
    const full = debateDayStateOf(
      { debate_date_key: '2026-01-05', debate_count: DEBATE_DAILY_LIMIT },
      NOON_UTC8,
    );
    expect(full.keyMatches).toBe(true);
    expect(full.usedToday).toBe(DEBATE_DAILY_LIMIT);
    expect(full.remaining).toBe(0);
  });

  it('空日期键（迁移前的宗门）与异常计数都被 clamp 到合法区间', () => {
    const legacy = debateDayStateOf({ debate_date_key: '', debate_count: 0 }, NOON_UTC8);
    expect(legacy.usedToday).toBe(0);
    expect(legacy.remaining).toBe(DEBATE_DAILY_LIMIT);

    const over = debateDayStateOf(
      { debate_date_key: '2026-01-05', debate_count: 99 },
      NOON_UTC8,
    );
    expect(over.usedToday).toBe(DEBATE_DAILY_LIMIT);
    expect(over.remaining).toBe(0);

    const negative = debateDayStateOf(
      { debate_date_key: '2026-01-05', debate_count: -5 },
      NOON_UTC8,
    );
    expect(negative.usedToday).toBe(0);
    expect(negative.remaining).toBe(DEBATE_DAILY_LIMIT);
  });
});

describe('对手属性生成（归一化权重）', () => {
  it('对手六项之和 ≈ 弟子六项之和 × 倍率系数', () => {
    const discipleTotal = Object.values(ATTRIBUTE_SAMPLE).reduce((a, b) => a + b, 0);
    for (const mult of [1, 2, 3] as const) {
      const opponent = generateOpponentAttrs(ATTRIBUTE_SAMPLE, mult);
      const opponentTotal = Object.values(opponent).reduce((a, b) => a + b, 0);
      const expected = discipleTotal * REVEAL_OPPONENT_FACTOR[mult];
      expect(opponentTotal).toBeGreaterThan(expected * 0.9);
      expect(opponentTotal).toBeLessThan(expected * 1.1);
    }
  });

  it('各项有长短板（不全等于均匀缩放）', () => {
    const opponent = generateOpponentAttrs(ATTRIBUTE_SAMPLE, 2);
    const ratios = BETTABLE_ATTRIBUTES.map(
      (attr) => opponent[attr] / (ATTRIBUTE_SAMPLE[attr] || 1),
    );
    const allSame = ratios.every((r) => Math.abs(r - ratios[0]!) < 0.01);
    expect(allSame).toBe(false);
  });

  it('每项保底 1，不封顶', () => {
    const lowAttrs = { attack: 0, defense: 0, speed: 1, aptitude: 0, luck: 0, physique: 0 } as Record<
      (typeof BETTABLE_ATTRIBUTES)[number],
      number
    >;
    const opponent = generateOpponentAttrs(lowAttrs, 1);
    for (const attr of BETTABLE_ATTRIBUTES) {
      expect(opponent[attr]).toBeGreaterThanOrEqual(1);
    }
  });

  it('spread 常量 = 0.40', () => {
    expect(OPPONENT_WEIGHT_SPREAD).toBe(0.40);
  });
});

describe('五档胜率（choice → 概率映射）', () => {
  it('档位表五个 key 与概率值', () => {
    expect(DEBATE_TIER_KEYS).toHaveLength(5);
    expect(DEBATE_TIER_PROBABILITIES).toEqual({
      disciple_clear: 0.65,
      disciple_slight: 0.55,
      even: 0.50,
      opponent_slight: 0.42,
      opponent_clear: 0.34,
    });
  });

  it('倍率锚与 ±0.06 范围', () => {
    expect(DEBATE_TIER_ANCHOR).toEqual({ 1: 0.50, 2: 0.42, 3: 0.34 });
    expect(DEBATE_TIER_ANCHOR_RANGE).toBe(0.06);
  });

  it('纯弟子优势 → 加权概率接近 0.65，但被锚 clamp', () => {
    const probs = { disciple_clear: 1, disciple_slight: 0, even: 0, opponent_slight: 0, opponent_clear: 0 };
    expect(debateTierProbability(probs, 1)).toBeCloseTo(0.56);
    expect(debateTierProbability(probs, 2)).toBeCloseTo(0.48);
    expect(debateTierProbability(probs, 3)).toBeCloseTo(0.40);
  });

  it('纯对手优势 → 加权概率接近 0.34，被锚 clamp', () => {
    const probs = { disciple_clear: 0, disciple_slight: 0, even: 0, opponent_slight: 0, opponent_clear: 1 };
    expect(debateTierProbability(probs, 1)).toBeCloseTo(0.44);
    expect(debateTierProbability(probs, 2)).toBeCloseTo(0.36);
    expect(debateTierProbability(probs, 3)).toBeCloseTo(0.34);
  });

  it('even 独占 → 加权概率 = 0.50，锚 clamp 后按倍率分化', () => {
    const probs = { disciple_clear: 0, disciple_slight: 0, even: 1, opponent_slight: 0, opponent_clear: 0 };
    expect(debateTierProbability(probs, 1)).toBeCloseTo(0.50);
    expect(debateTierProbability(probs, 2)).toBeCloseTo(0.48);
    expect(debateTierProbability(probs, 3)).toBeCloseTo(0.40);
  });

  it('undefined / 空对象 / 全零 → null（触发降级）', () => {
    expect(debateTierProbability(undefined, 1)).toBeNull();
    expect(debateTierProbability({}, 1)).toBeNull();
    expect(debateTierProbability({ disciple_clear: 0, even: 0 }, 1)).toBeNull();
  });

  it('降级胜率与锚表对齐', () => {
    for (const mult of [1, 2, 3] as const) {
      expect(DEGRADED_WIN_RATES[mult] / 10_000).toBeCloseTo(DEBATE_TIER_ANCHOR[mult]);
    }
  });
});

/* ---------- 天机轮（0020 迁移 + 计划第 2 节） ---------- */

/** 固定构造的格子：奖励公式用固定 slot 断言，不靠随机 seed 去碰大额 / 丹药格。 */
function wheelSlot(overrides: Partial<WheelSlot> & { type: WheelSlot['type'] }): WheelSlot {
  const base: WheelSlot = { type: overrides.type, multiplier: 1, pillId: null };
  return { ...base, ...overrides };
}

const WHEEL_RESOURCE_NAMES: Record<string, string> = {
  spiritStone: '灵石',
  herb: '药材',
  ore: '矿石',
};

const WHEEL_NAMES = {
  resource: (resourceId: string): string => WHEEL_RESOURCE_NAMES[resourceId] ?? resourceId,
  pill: (pillId: string): string => (pillId === 'healingPill' ? '回春丹' : pillId),
};

describe('天机轮常量与费用（计划 2.3 / 2.4）', () => {
  it('8 格转盘、5 个投入档位，费用 = 50000 × 档位', () => {
    expect(WHEEL_SLOT_COUNT).toBe(8);
    expect([...WHEEL_TIERS]).toEqual([1, 2, 3, 4, 5]);
    expect(WHEEL_SPIN_COST).toBe(50_000);
    expect(WHEEL_RESET_COST).toBe(100_000);
    expect(WHEEL_TIERS.map((tier) => wheelSpinCost(tier))).toEqual([
      50_000, 100_000, 150_000, 200_000, 250_000,
    ]);
  });

  it('格局配额与倍率区间常量', () => {
    expect(WHEEL_BIG_SLOTS).toBe(1);
    expect(WHEEL_NOTHING_SLOTS).toBe(2);
    expect(WHEEL_SMALL_SLOTS_MIN).toBe(2);
    expect(WHEEL_SMALL_SLOTS_MAX).toBe(4);
    expect(WHEEL_BIG_MULTIPLIER).toBe(3);
    expect(WHEEL_MULTIPLIER_MIN).toBe(0.8);
    expect(WHEEL_MULTIPLIER_MAX).toBe(1.5);
  });
});

describe('wheelLayoutSeed：宗门 id × wheel_seed × 日期键的混合', () => {
  const DAY = '2026-09-22';

  it('确定性：同一 (sect_id, wheel_seed, dateKey) 永远同种子', () => {
    expect(wheelLayoutSeed('sect-a', 0, DAY)).toBe(wheelLayoutSeed('sect-a', 0, DAY));
    expect(wheelLayoutSeed('sect-a', 7, DAY)).toBe(wheelLayoutSeed('sect-a', 7, DAY));
  });

  it('不同 sect_id / 不同 wheel_seed / 不同日期 得到不同种子', () => {
    expect(wheelLayoutSeed('sect-a', 0, DAY)).not.toBe(wheelLayoutSeed('sect-b', 0, DAY));
    expect(wheelLayoutSeed('sect-a', 0, DAY)).not.toBe(wheelLayoutSeed('sect-a', 1, DAY));
    expect(wheelLayoutSeed('sect-a', 0, DAY)).not.toBe(wheelLayoutSeed('sect-a', 0, '2026-09-23'));
    expect(wheelLayoutSeed('', 0, DAY)).not.toBe(wheelLayoutSeed('sect-a', 0, DAY));
  });

  it('种子是 32 位无符号整数', () => {
    for (const sectId of ['sect-a', 'sect-b', '']) {
      for (const seed of [0, 1, 2, 99]) {
        const layoutSeed = wheelLayoutSeed(sectId, seed, DAY);
        expect(Number.isInteger(layoutSeed)).toBe(true);
        expect(layoutSeed).toBeGreaterThanOrEqual(0);
        expect(layoutSeed).toBeLessThanOrEqual(0xff_ff_ff_ff);
      }
    }
  });
});

describe('generateWheelSlots：确定性 8 格格局（计划 2.1）', () => {
  it('同 seed 深比较完全相同（重启 / 换设备格局不变）', () => {
    for (const seed of [0, 1, 12_345, 0xff_ff_ff_ff]) {
      expect(generateWheelSlots(seed)).toEqual(generateWheelSlots(seed));
    }
  });

  it('不同 seed 得到不同格局', () => {
    const layouts = new Set(
      Array.from({ length: 50 }, (_, seed) => JSON.stringify(generateWheelSlots(seed))),
    );
    expect(layouts.size).toBe(50);
    expect(generateWheelSlots(1)).not.toEqual(generateWheelSlots(2));
  });

  it('配额：8 格 = 大额灵石 1 + 谢谢惠顾 2 + 小额灵石 2~4 + 草药/矿石/丹药 1~3', () => {
    const smallCounts = new Set<number>();
    for (let seed = 0; seed < 2_000; seed += 1) {
      const slots = generateWheelSlots(seed);
      expect(slots).toHaveLength(WHEEL_SLOT_COUNT);
      const countOf = (type: WheelSlot['type']): number =>
        slots.filter((slot) => slot.type === type).length;

      expect(countOf('big_spirit_stone')).toBe(WHEEL_BIG_SLOTS);
      expect(countOf('nothing')).toBe(WHEEL_NOTHING_SLOTS);

      const small = countOf('spirit_stone');
      expect(small).toBeGreaterThanOrEqual(WHEEL_SMALL_SLOTS_MIN);
      expect(small).toBeLessThanOrEqual(WHEEL_SMALL_SLOTS_MAX);

      for (const special of ['herb', 'ore', 'pill'] as const) {
        expect(countOf(special)).toBeLessThanOrEqual(1);
      }
      const specials = countOf('herb') + countOf('ore') + countOf('pill');
      expect(specials).toBe(WHEEL_SLOT_COUNT - WHEEL_BIG_SLOTS - WHEEL_NOTHING_SLOTS - small);
      expect(specials).toBeGreaterThanOrEqual(1);
      expect(specials).toBeLessThanOrEqual(3);

      smallCounts.add(small);
    }
    // seed 从前到后是线性同余的一整串，取 2000 个才覆盖到小额 2 / 3 / 4 三档，
    // 否则上面的区间断言可能没被真正走到。
    expect([...smallCounts].sort((a, b) => a - b)).toEqual([2, 3, 4]);
  });

  it('倍率：资源 / 丹药格都在 0.8~1.5 且一位小数，nothing 为 0；丹药 id 来自 alchemy', () => {
    const multipliers = new Set<number>();
    const pillIds = new Set<string>();
    for (let seed = 0; seed < 2_000; seed += 1) {
      for (const slot of generateWheelSlots(seed)) {
        if (slot.type === 'nothing') {
          expect(slot.multiplier).toBe(0);
          expect(slot.pillId).toBeNull();
          continue;
        }
        multipliers.add(slot.multiplier);
        expect(slot.multiplier).toBeGreaterThanOrEqual(WHEEL_MULTIPLIER_MIN);
        expect(slot.multiplier).toBeLessThanOrEqual(WHEEL_MULTIPLIER_MAX);
        // 一位小数：×10 后是整数（round 消掉二进制噪声再比回原值）。
        expect(Math.round(slot.multiplier * 10) / 10).toBeCloseTo(slot.multiplier, 10);
        if (slot.type === 'pill') {
          expect(slot.pillId).not.toBeNull();
          expect(PILL_IDS).toContain(slot.pillId);
          pillIds.add(slot.pillId as string);
        } else {
          expect(slot.pillId).toBeNull();
        }
      }
    }
    expect([...multipliers].sort((a, b) => a - b)).toEqual([
      0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5,
    ]);
    // 样本里真的出现过丹药格（且三种丹药都出现过），上面的白名单断言才不是空转。
    expect([...pillIds].sort()).toEqual([...PILL_IDS].sort());
  });
});

describe('wheelSlotLabel：格面文案（计划 4.1）', () => {
  it('六种类型的文案都由服务端拼好', () => {
    expect(wheelSlotLabel(wheelSlot({ type: 'nothing', multiplier: 0 }), WHEEL_NAMES)).toBe(
      '谢谢惠顾',
    );
    expect(wheelSlotLabel(wheelSlot({ type: 'spirit_stone', multiplier: 1.3 }), WHEEL_NAMES)).toBe(
      '灵石 ×1.3',
    );
    expect(wheelSlotLabel(wheelSlot({ type: 'herb', multiplier: 0.9 }), WHEEL_NAMES)).toBe(
      '药材 ×0.9',
    );
    expect(wheelSlotLabel(wheelSlot({ type: 'ore', multiplier: 1.5 }), WHEEL_NAMES)).toBe(
      '矿石 ×1.5',
    );
    // 大额格显示的是实际结算倍率（格子倍率 × 3）。
    expect(
      wheelSlotLabel(wheelSlot({ type: 'big_spirit_stone', multiplier: 1.1 }), WHEEL_NAMES),
    ).toBe('灵石 ×3.3');
    // 丹药格显示数量随档位走（×1~5），与格子倍率无关。
    expect(
      wheelSlotLabel(wheelSlot({ type: 'pill', multiplier: 1.4, pillId: 'healingPill' }), WHEEL_NAMES),
    ).toBe('回春丹 ×1~5');
    // 理论上不会出现的空 pillId 也要有兜底文案。
    expect(
      wheelSlotLabel(wheelSlot({ type: 'pill', multiplier: 1.4, pillId: null }), WHEEL_NAMES),
    ).toBe('丹药');
  });
});

describe('wheelReward：奖励结算（计划 2.6）', () => {
  it('资源类 = floor(投入 × 倍率)；大额灵石再 ×3；草药/矿石再 ×2', () => {
    expect(wheelReward(wheelSlot({ type: 'spirit_stone', multiplier: 1.3 }), 2, 100_000)).toEqual({
      type: 'resource',
      resourceId: 'spiritStone',
      amount: '130000',
    });
    // 草药：150000 × 0.9 × 2 = 270000
    expect(wheelReward(wheelSlot({ type: 'herb', multiplier: 0.9 }), 3, 150_000)).toEqual({
      type: 'resource',
      resourceId: 'herb',
      amount: '270000',
    });
    // 矿石：50000 × 1.5 × 2 = 150000
    expect(wheelReward(wheelSlot({ type: 'ore', multiplier: 1.5 }), 1, 50_000)).toEqual({
      type: 'resource',
      resourceId: 'ore',
      amount: '150000',
    });
    // 大额灵石格：金额 = floor(投入 × 格子倍率 × 3)，资源必须归到灵石 ——
    // 与格面文案（「灵石 ×3.3」）同一口径；若返回 'big_spirit_stone' 之类的 id，
    // 发奖就会在 resource_balances 里凭空插一条配置里不存在的资源。
    expect(wheelReward(wheelSlot({ type: 'big_spirit_stone', multiplier: 1.1 }), 2, 100_000)).toEqual({
      type: 'resource',
      resourceId: 'spiritStone',
      amount: '330000',
    });
    // 0.8 的二进制噪声会被 1e-6 消掉：floor(50000 × 0.8) 必须是 40000 而不是 39999。
    expect(wheelReward(wheelSlot({ type: 'spirit_stone', multiplier: 0.8 }), 1, 50_000)).toEqual({
      type: 'resource',
      resourceId: 'spiritStone',
      amount: '40000',
    });
  });

  it('丹药 = 投入档位颗数，不受格子倍率影响；谢谢惠顾 = 无奖励', () => {
    expect(
      wheelReward(wheelSlot({ type: 'pill', multiplier: 0.8, pillId: 'healingPill' }), 5, 250_000),
    ).toEqual({ type: 'pill', pillId: 'healingPill', quantity: 5 });
    expect(
      wheelReward(
        wheelSlot({ type: 'pill', multiplier: 1.5, pillId: 'cultivationPill' }),
        1,
        50_000,
      ),
    ).toEqual({ type: 'pill', pillId: 'cultivationPill', quantity: 1 });
    expect(wheelReward(wheelSlot({ type: 'nothing', multiplier: 0 }), 3, 150_000)).toEqual({
      type: 'none',
    });
    // 空 pillId 的兜底：不给奖励（宁可无奖也不写一条没有丹药的记录）。
    expect(
      wheelReward(wheelSlot({ type: 'pill', multiplier: 1.2, pillId: null }), 3, 150_000),
    ).toEqual({ type: 'none' });
  });

  it('按真实费用（wheelSpinCost）结算时金额是最小单位整数', () => {
    for (const tier of WHEEL_TIERS) {
      const cost = wheelSpinCost(tier);
      expect(wheelReward(wheelSlot({ type: 'spirit_stone', multiplier: 1.5 }), tier, cost)).toEqual({
        type: 'resource',
        resourceId: 'spiritStone',
        amount: String(cost * 1.5),
      });
      expect(
        wheelReward(wheelSlot({ type: 'pill', multiplier: 1.4, pillId: 'healingPill' }), tier, cost),
      ).toEqual({ type: 'pill', pillId: 'healingPill', quantity: tier });
    }
  });
});
