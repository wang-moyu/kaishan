import { describe, expect, it } from 'vitest';

import {
  BOSS_MERIT_RESOURCE_ID,
  WORLD_BOSS_AFFIXES,
  WORLD_BOSS_COOLDOWN_MS,
  WORLD_BOSS_KILL_POOL_RATE_FACTOR,
  WORLD_BOSS_DAILY_ATTACK_LIMIT_DEFAULT,
  WORLD_BOSS_FATIGUE_WINDOW_MS,
  WORLD_BOSS_MERIT_SHOP,
  WORLD_BOSS_MERIT_XUANTIE_MAX,
  WORLD_BOSS_MIN_HP,
  WORLD_BOSS_POOL_RESOURCES,
  WORLD_BOSS_ROUNDS_PER_STAGE,
  WORLD_BOSSES,
  affixAttributeMultiplier,
  affixNameOf,
  arenaCombatMultiplier,
  bossDefAt,
  bossDisplayName,
  bossIndexFor,
  dayIndexUtc8,
  discipleContribution,
  expectedPartyDamage,
  findAffix,
  findMeritShopItem,
  isFledByDamage,
  isWorldBossAttackable,
  lastHitReward,
  normalInjuryChance,
  rankRewardMultiplier,
  rewardFloor,
  rollAffix,
  rollDamage,
  parseDailyAttackLimit,
  rollOutcome,
  severeInjuryChance,
  stageMaxHp,
  stageName,
  stageResourceRewards,
  stageRewardMultiplier,
  meritStageMultiplier,
  worldBossPhaseOf,
  worldBossMeritFor,
} from '../../apps/server/src/modules/game/worldBoss';

function sequence(values: number[], fallback = 0.5): () => number {
  const queue = [...values];
  return () => (queue.length > 0 ? (queue.shift() as number) : fallback);
}

/** UTC+8 的某个时刻 → UTC 毫秒（业务日按 UTC+8，与 constants.ts 同一基准）。 */
function utc8(y: number, month: number, day: number, hour: number, minute = 0): number {
  return Date.UTC(y, month - 1, day, hour - 8, minute);
}

describe('世界 Boss 二期：阶段判定（UTC+8）', () => {
  it('07:59 before、08:00 open、22:00 frenzy、23:00 closed', () => {
    expect(worldBossPhaseOf(utc8(2026, 9, 23, 7, 59))).toBe('before');
    expect(worldBossPhaseOf(utc8(2026, 9, 23, 8, 0))).toBe('open');
    expect(worldBossPhaseOf(utc8(2026, 9, 23, 21, 59))).toBe('open');
    expect(worldBossPhaseOf(utc8(2026, 9, 23, 22, 0))).toBe('frenzy');
    expect(worldBossPhaseOf(utc8(2026, 9, 23, 23, 0))).toBe('closed');
    expect(worldBossPhaseOf(utc8(2026, 9, 24, 0, 30))).toBe('before');
  });

  it('只有 open / frenzy 可以出手', () => {
    expect(isWorldBossAttackable('open')).toBe(true);
    expect(isWorldBossAttackable('frenzy')).toBe(true);
    expect(isWorldBossAttackable('before')).toBe(false);
    expect(isWorldBossAttackable('closed')).toBe(false);
  });
});

describe('世界 Boss 二期：连战与关卡', () => {
  it('第 n 关用第 (dayIndex + n − 1) % 5 只 Boss', () => {
    expect(WORLD_BOSSES).toHaveLength(5);
    const dayIndex = 12;
    for (let stage = 1; stage <= 10; stage += 1) {
      expect(bossIndexFor(dayIndex, stage)).toBe((dayIndex + stage - 1) % 5);
    }
    // 同一天内每往下一关就换一只（第 6 关回到第 1 关那只）。
    expect(bossIndexFor(dayIndex, 6)).toBe(bossIndexFor(dayIndex, 1));
    expect(bossDefAt(0).name).toBe('黑风妖王');
    expect(bossDefAt(5).index).toBe(0);
    expect(dayIndexUtc8(utc8(2026, 9, 23, 12))).toBe(dayIndexUtc8(utc8(2026, 9, 23, 20)));
  });

  it('关卡名与显示名', () => {
    expect(stageName(2)).toBe('第 2 关');
    expect(bossDisplayName(1, 2)).toBe('第 2 关 · 赤炎火蛟');
    expect(bossDisplayName(0, 1)).toBe('第 1 关 · 黑风妖王');
  });

  it('血量 = max(10000, 一轮伤害 × 2 × 1.6^(n−1))', () => {
    expect(WORLD_BOSS_ROUNDS_PER_STAGE).toBe(2);
    expect(stageMaxHp(10_000, 1)).toBe(20_000);
    expect(stageMaxHp(10_000, 2)).toBe(32_000);
    expect(stageMaxHp(10_000, 3)).toBe(51_200);
    expect(stageMaxHp(10_000, 4)).toBe(81_920);
    // 一轮伤害太小时取下限
    expect(stageMaxHp(0, 1)).toBe(WORLD_BOSS_MIN_HP);
    expect(stageMaxHp(1000, 1)).toBe(WORLD_BOSS_MIN_HP);
  });
});

describe('世界 Boss 二期：随机词缀', () => {
  it('五个词缀，id / 文案 / 推荐属性与计划表一致', () => {
    expect(WORLD_BOSS_AFFIXES.map((affix) => affix.id)).toEqual([
      'ironclad',
      'swift',
      'brute',
      'eerie',
      'berserk',
    ]);
    expect(findAffix('ironclad')?.effect).toBe('防御越高，伤害越高');
    expect(findAffix('ironclad')?.tip).toBe('派防御高的弟子');
    expect(findAffix('swift')?.sortAttribute).toBe('speed');
    expect(findAffix('brute')?.sortAttribute).toBe('attack');
    expect(findAffix('eerie')?.sortAttribute).toBe('luck');
    expect(findAffix('berserk')?.sortAttribute).toBe('physique');
    expect(findAffix('none')).toBeUndefined();
    expect(affixNameOf('berserk')).toBe('狂暴');
    expect(affixNameOf('none')).toBe('无');
  });

  it('属性加成 = 1 + 属性/10 × 0.05（只有前三种词缀有这个加成）', () => {
    const attrs = { attack: 100, defense: 100, speed: 100 };
    expect(affixAttributeMultiplier(findAffix('ironclad'), attrs)).toBeCloseTo(1.5, 10);
    expect(affixAttributeMultiplier(findAffix('swift'), attrs)).toBeCloseTo(1.5, 10);
    expect(affixAttributeMultiplier(findAffix('brute'), attrs)).toBeCloseTo(1.5, 10);
    expect(affixAttributeMultiplier(findAffix('eerie'), attrs)).toBe(1);
    expect(affixAttributeMultiplier(findAffix('berserk'), attrs)).toBe(1);
    expect(affixAttributeMultiplier(undefined, attrs)).toBe(1);
    // 属性 50 的那一项只加成 1.25，且只作用于自己那一项
    expect(
      affixAttributeMultiplier(findAffix('ironclad'), { attack: 100, defense: 50, speed: 100 }),
    ).toBeCloseTo(1.25, 10);
    expect(discipleContribution(200, findAffix('brute'), { attack: 100, defense: 0, speed: 0 })).toBe(
      300,
    );
  });

  it('抽词缀按注入的随机源取（0 → 第一个，接近 1 → 最后一个）', () => {
    expect(rollAffix(() => 0)).toBe('ironclad');
    expect(rollAffix(() => 0.21)).toBe('swift');
    expect(rollAffix(() => 0.99)).toBe('berserk');
  });
});

describe('世界 Boss 二期：伤害', () => {
  it('期望伤害 = 队伍战力 × 演武场加成 × DAMAGE_SCALE（无浮动/暴击/词缀/力竭）', () => {
    expect(arenaCombatMultiplier(0)).toBe(1);
    expect(arenaCombatMultiplier(2)).toBeCloseTo(1.2, 10);
    expect(expectedPartyDamage({ topPartyPower: 100, arenaLevel: 0 })).toBe(10_000);
    expect(expectedPartyDamage({ topPartyPower: 100, arenaLevel: 2 })).toBe(12_000);
  });

  it('浮动下界 0.8、上界 1.2', () => {
    const base = { partyBase: 100, arenaLevel: 0, avgLuck: 0, frenzy: false };
    expect(rollDamage({ ...base, random: sequence([0, 1]) })).toEqual({ damage: 8_000, crit: false });
    expect(rollDamage({ ...base, random: sequence([1, 1]) })).toEqual({ damage: 12_000, crit: false });
  });

  it('暴击率 = 出战弟子 luck 平均值 / 100 × 20%，暴击倍率 1.5', () => {
    const base = { partyBase: 100, arenaLevel: 0, frenzy: false };
    expect(rollDamage({ ...base, avgLuck: 100, random: sequence([0.5, 0.1]) })).toEqual({
      damage: 15_000,
      crit: true,
    });
    expect(rollDamage({ ...base, avgLuck: 100, random: sequence([0.5, 0.5]) })).toEqual({
      damage: 10_000,
      crit: false,
    });
    // luck 平均 0 → 暴击率 0
    expect(rollDamage({ ...base, avgLuck: 0, random: sequence([0.5, 0]) }).crit).toBe(false);
  });

  it('「邪祟」让暴击率翻倍', () => {
    const base = { partyBase: 100, arenaLevel: 0, frenzy: false, avgLuck: 50 };
    // 50/100 × 20% = 10%；roll 0.15 不暴击
    expect(rollDamage({ ...base, random: sequence([0.5, 0.15]) }).crit).toBe(false);
    // 翻倍后 20%：同样 roll 0.15 暴击
    expect(
      rollDamage({ ...base, critRateMultiplier: 2, random: sequence([0.5, 0.15]) }).crit,
    ).toBe(true);
  });

  it('力竭倍率 1.5', () => {
    expect(
      rollDamage({
        partyBase: 100,
        arenaLevel: 0,
        avgLuck: 0,
        frenzy: true,
        random: sequence([0.5, 0.5]),
      }),
    ).toEqual({ damage: 15_000, crit: false });
  });
});

describe('世界 Boss 二期：疲劳 · 受伤 · 重伤', () => {
  it('重伤概率表：0/1/2 次 0%，第 4 次 30%，第 5 次 70%，第 6 次起 100%', () => {
    expect(severeInjuryChance(0, 50, false)).toBe(0);
    expect(severeInjuryChance(2, 50, false)).toBe(0);
    expect(severeInjuryChance(3, 50, false)).toBe(0.3);
    expect(severeInjuryChance(4, 50, false)).toBe(0.7);
    expect(severeInjuryChance(5, 50, false)).toBe(1);
    expect(severeInjuryChance(9, 50, false)).toBe(1);
  });

  it('体魄修正只作用在 30% / 70% 两档：每高 10 点下调 3 个百分点，最低 0', () => {
    expect(severeInjuryChance(3, 60, false)).toBeCloseTo(0.27, 10);
    expect(severeInjuryChance(3, 100, false)).toBeCloseTo(0.15, 10);
    expect(severeInjuryChance(4, 100, false)).toBeCloseTo(0.55, 10);
    // 体魄再高也不会低于 0
    expect(severeInjuryChance(3, 500, false)).toBe(0);
    // 100% 那一档不修正
    expect(severeInjuryChance(5, 500, false)).toBe(1);
  });

  it('「狂暴」让两个概率翻倍（封顶 100%）', () => {
    expect(severeInjuryChance(3, 50, true)).toBeCloseTo(0.6, 10);
    expect(severeInjuryChance(4, 50, true)).toBeCloseTo(1, 10);
    expect(severeInjuryChance(4, 100, true)).toBeCloseTo(1, 10);
    expect(severeInjuryChance(0, 50, true)).toBe(0);
    expect(normalInjuryChance(50, true)).toBeCloseTo(0.06, 10);
  });

  it('普通受伤概率 = 3% − (体魄 − 50)/10 × 1%，夹在 1%~8%', () => {
    expect(normalInjuryChance(50, false)).toBeCloseTo(0.03, 10);
    expect(normalInjuryChance(100, false)).toBeCloseTo(0.01, 10);
    expect(normalInjuryChance(0, false)).toBeCloseTo(0.08, 10);
    expect(normalInjuryChance(200, false)).toBeCloseTo(0.01, 10);
  });

  it('判定顺序：先重伤；重伤就不再取受伤那个随机数', () => {
    // 疲劳 3 次（30%）+ roll 0.1 → 重伤；第二个随机数不会被取用（fallback 0 也不会变成受伤）
    expect(rollOutcome({ fatigueCount: 3, physique: 50, berserk: false, random: sequence([0.1]) })).toEqual(
      { severe: true, injured: false },
    );
    // 未重伤（roll 0.9 > 0.3）→ 再判受伤：roll 0.02 < 0.03 → 受伤
    expect(
      rollOutcome({ fatigueCount: 3, physique: 50, berserk: false, random: sequence([0.9, 0.02]) }),
    ).toEqual({ severe: false, injured: true });
    // 都不触发（roll 0.9 与 0.9）
    expect(
      rollOutcome({ fatigueCount: 0, physique: 50, berserk: false, random: sequence([0.9, 0.9]) }),
    ).toEqual({ severe: false, injured: false });
  });
});

describe('世界 Boss 二期：奖励', () => {
  it('保底、关卡系数、排名倍数', () => {
    expect(rewardFloor(1)).toBe(10_000);
    expect(rewardFloor(3)).toBe(30_000);
    // 防通胀：每关 +0.3，第 5 关起封顶 ×2.2
    expect(stageRewardMultiplier(1)).toBe(1);
    expect(stageRewardMultiplier(2)).toBeCloseTo(1.3, 10);
    expect(stageRewardMultiplier(5)).toBeCloseTo(2.2, 10);
    expect(stageRewardMultiplier(6)).toBeCloseTo(2.2, 10);
    expect(stageRewardMultiplier(12)).toBeCloseTo(2.2, 10);
    expect(WORLD_BOSS_KILL_POOL_RATE_FACTOR).toBe(2.5);
    // 功勋保留三期口径（每关 +0.5、不封顶），兑换价按它定
    expect(meritStageMultiplier(2)).toBeCloseTo(1.5, 10);
    expect(meritStageMultiplier(6)).toBeCloseTo(3.5, 10);
    expect(rankRewardMultiplier(1)).toBe(1.5);
    expect(rankRewardMultiplier(2)).toBe(1.25);
    expect(rankRewardMultiplier(3)).toBe(1.1);
    expect(rankRewardMultiplier(4)).toBe(1);
    expect(rankRewardMultiplier(9)).toBe(1);
  });

  it('基础份 = max(产出 × 2.5, 保底) × 关卡系数 × 排名倍数（按资源分别算）', () => {
    const rewards = stageResourceRewards({
      rates: { spiritStone: 40_000, herb: 0, ore: 300_000 },
      sectLevel: 1,
      stage: 1,
      rank: 1,
    });
    expect(Object.keys(rewards).sort()).toEqual([...WORLD_BOSS_POOL_RESOURCES].sort());
    // 40000 × 2.5 × 1.5（第 1 名）
    expect(rewards.spiritStone).toBe(150_000);
    // 没有这项产出时只吃保底
    expect(rewards.herb).toBe(15_000);
    expect(rewards.ore).toBe(1_125_000);
  });

  it('关卡系数与排名倍数叠乘；击退时资源减半', () => {
    const base = { rates: { spiritStone: 100_000, herb: 100_000, ore: 100_000 }, sectLevel: 1 };
    // 第 3 关第 2 名：100000 × 2.5 × 1.6 × 1.25 = 500000
    expect(stageResourceRewards({ ...base, stage: 3, rank: 2 }).spiritStone).toBe(500_000);
    // 击退：再 ×0.5
    expect(stageResourceRewards({ ...base, stage: 3, rank: 2, repelled: true }).spiritStone).toBe(
      250_000,
    );
    // 第 5 关起封顶：第 9 关与第 5 关一样多
    expect(stageResourceRewards({ ...base, stage: 9, rank: 4 }).spiritStone).toBe(
      stageResourceRewards({ ...base, stage: 5, rank: 4 }).spiritStone,
    );
  });

  it('最后一击奖 = max(产出 × 1, 保底) × 关卡系数', () => {
    expect(lastHitReward(0, 1, 1)).toBe(10_000);
    expect(lastHitReward(400_000, 1, 1)).toBe(400_000);
    expect(lastHitReward(0, 1, 3)).toBe(16_000);
  });

  it('击退阈值 ≥70%', () => {
    expect(isFledByDamage(1_000, 300)).toBe(true);
    expect(isFledByDamage(1_000, 301)).toBe(false);
    expect(isFledByDamage(0, 0)).toBe(false);
  });

  it('冷却与疲劳窗口常量', () => {
    expect(WORLD_BOSS_COOLDOWN_MS).toBe(3_000);
    expect(WORLD_BOSS_FATIGUE_WINDOW_MS).toBe(60 * 60 * 1000);
  });
});

describe('世界 Boss 三期：功勋与功勋兑换（计划 2.3、2.4）', () => {
  it('功勋 = max(2, round(10 × 关卡系数 × √占比))；击退减半（至少 1）', () => {
    // 计划 2.3 的参考值表逐条断言。
    expect(worldBossMeritFor({ stage: 1, damageShare: 1, repelled: false })).toBe(10);
    expect(worldBossMeritFor({ stage: 1, damageShare: 1, repelled: true })).toBe(5);
    expect(worldBossMeritFor({ stage: 1, damageShare: 0.25, repelled: false })).toBe(5);
    expect(worldBossMeritFor({ stage: 1, damageShare: 0.25, repelled: true })).toBe(2);
    expect(worldBossMeritFor({ stage: 1, damageShare: 0.01, repelled: false })).toBe(2);
    expect(worldBossMeritFor({ stage: 1, damageShare: 0.01, repelled: true })).toBe(1);
    expect(worldBossMeritFor({ stage: 2, damageShare: 1, repelled: false })).toBe(15);
    expect(worldBossMeritFor({ stage: 2, damageShare: 1, repelled: true })).toBe(7);
    expect(worldBossMeritFor({ stage: 3, damageShare: 0.25, repelled: false })).toBe(10);
    expect(worldBossMeritFor({ stage: 3, damageShare: 0.25, repelled: true })).toBe(5);
    expect(worldBossMeritFor({ stage: 5, damageShare: 0.55, repelled: false })).toBe(22);
    expect(worldBossMeritFor({ stage: 5, damageShare: 0.55, repelled: true })).toBe(11);
    // 没造成伤害就什么也没有（击杀与击退都一样）。
    expect(worldBossMeritFor({ stage: 2, damageShare: 0, repelled: false })).toBe(0);
    expect(worldBossMeritFor({ stage: 2, damageShare: 0, repelled: true })).toBe(0);
  });

  it('功勋兑换价目表：四项 4 / 25 / 70 / 200，玄铁单项上限 100', () => {
    expect(BOSS_MERIT_RESOURCE_ID).toBe('bossMerit');
    expect(WORLD_BOSS_MERIT_SHOP.map((item) => item.id)).toEqual([
      'xuantie',
      'spirit',
      'treasure',
      'immortal',
    ]);
    expect(WORLD_BOSS_MERIT_SHOP.map((item) => item.name)).toEqual([
      '玄铁',
      '灵品装备',
      '宝品装备',
      '仙品装备',
    ]);
    expect(WORLD_BOSS_MERIT_SHOP.map((item) => item.cost)).toEqual([4, 25, 70, 200]);
    expect(WORLD_BOSS_MERIT_SHOP.map((item) => item.quality)).toEqual([
      null,
      'spirit',
      'treasure',
      'immortal',
    ]);
    expect(WORLD_BOSS_MERIT_XUANTIE_MAX).toBe(100);
    expect(findMeritShopItem('xuantie')).toMatchObject({ name: '玄铁', cost: 4, quality: null });
    expect(findMeritShopItem('xxx')).toBeUndefined();
  });
});

describe('世界 Boss：每日出手上限', () => {
  it('默认 120；环境变量给非负整数就用它（0 = 不限），没配或写错回到默认', () => {
    expect(WORLD_BOSS_DAILY_ATTACK_LIMIT_DEFAULT).toBe(120);
    expect(parseDailyAttackLimit(undefined)).toBe(120);
    expect(parseDailyAttackLimit('')).toBe(120);
    expect(parseDailyAttackLimit(' 80 ')).toBe(80);
    expect(parseDailyAttackLimit('0')).toBe(0);
    expect(parseDailyAttackLimit('-1')).toBe(120);
    expect(parseDailyAttackLimit('1.5')).toBe(120);
    expect(parseDailyAttackLimit('abc')).toBe(120);
  });
});
