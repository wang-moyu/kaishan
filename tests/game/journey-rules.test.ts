import { GAME_CONFIG_CONTENT } from '@xiuxian/game-config';
import { describe, expect, it } from 'vitest';

import {
  JOURNEY_DIRECTIONS,
  JOURNEY_DURATIONS_SECONDS,
  JOURNEY_EXTRA_HARVEST_BP,
  JOURNEY_HISTORY_LIMIT,
  JOURNEY_INJURY_DURATION_MS,
  JOURNEY_MAX_CONCURRENT,
  JOURNEY_MIN_DISCIPLES_AT_HOME,
  JOURNEY_MIN_REALM_ID,
  JOURNEY_PLANS,
  asJourneyDirection,
  cultivateJourneyReturn,
  findJourneyDirection,
  findJourneyPlan,
  isJourneyDirection,
  isJourneyDuration,
  journeyAwayIds,
  journeyBaseInjuryChanceBp,
  journeyBaseReward,
  journeyDirectionBlockedReason,
  journeyEligibilityBlock,
  journeyEligibilityBlockedReason,
  journeyEndsAt,
  journeyExtraHarvestChanceBp,
  journeyExtraHarvestReward,
  journeyFinalReward,
  journeyInjuryChanceBp,
  journeyInjuryUntil,
  journeyPhysiqueModifiedInjuryChanceBp,
  journeyStatusOf,
  parseJourneyRewardResources,
  previewJourneyCultivation,
  rollJourneyOutcome,
} from '../../apps/server/src/modules/game/journey';
import { absenceDurations, settleEconomy } from '../../apps/server/src/modules/game/settle';

/**
 * 弟子历练纯规则（apps/server/src/modules/game/journey.ts + settle.ts 的在外屏蔽）：
 * 筑基门槛、方向/时长白名单、奖励与天赋取整、概率上下限、额外收获与受伤独立、修为封顶、
 * 以及「整次离线结算只有一个 12 小时窗口与一批随机事件」。
 *
 * 这些测试不依赖 workerd / D1，跑在根级 node 测试里（vitest.config.ts）；
 * HTTP + D1 的行为在 apps/server/test/journey.test.ts 里覆盖。
 */

/** 按顺序返回给定值的随机源（用于钉死抽取结果）。 */
function sequence(values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index % values.length]!;
    index += 1;
    return value;
  };
}

/**
 * 只给「保底」的那点输入，方便逐条断言取整。
 * luck / physique 默认 50（0016 的机制中性点）：旧的概率基线断言因此继续成立，
 * 要验证幸运 / 体魄的作用时显式传入。
 */
function reward(
  direction: 'daoSeeking' | 'gathering',
  durationSeconds: number,
  aptitude: number,
  talent: string,
  combatPower: number,
  luck = 50,
  physique = 50,
) {
  return journeyBaseReward({
    direction,
    durationSeconds,
    aptitude,
    talent,
    combatPower,
    luck,
    physique,
  });
}

describe('历练方向、时长与数值基线', () => {
  it('固定两个方向、两档时长', () => {
    expect(JOURNEY_DIRECTIONS.map((direction) => direction.id)).toEqual([
      'daoSeeking',
      'gathering',
    ]);
    expect(JOURNEY_DURATIONS_SECONDS).toEqual([7_200, 21_600]);
    expect(JOURNEY_PLANS).toHaveLength(4);
  });

  it('数值表与计划 2.2 的测试基线一致（最小单位）', () => {
    expect(findJourneyPlan('daoSeeking', 7_200)).toMatchObject({
      cultivation: 180,
      resources: { spiritStone: 15_000 },
      injuryChanceBp: 500,
    });
    expect(findJourneyPlan('daoSeeking', 21_600)).toMatchObject({
      cultivation: 540,
      resources: { spiritStone: 45_000 },
      injuryChanceBp: 800,
    });
    expect(findJourneyPlan('gathering', 7_200)).toMatchObject({
      cultivation: 40,
      resources: { herb: 25_000, ore: 20_000 },
      injuryChanceBp: 1_200,
    });
    expect(findJourneyPlan('gathering', 21_600)).toMatchObject({
      cultivation: 120,
      resources: { herb: 75_000, ore: 60_000 },
      injuryChanceBp: 1_500,
    });
  });

  it('方向 / 时长白名单拒绝表外的组合', () => {
    expect(isJourneyDirection('daoSeeking')).toBe(true);
    expect(isJourneyDirection('gathering')).toBe(true);
    expect(isJourneyDirection('teamRaid')).toBe(false);
    expect(isJourneyDuration(7_200)).toBe(true);
    expect(isJourneyDuration(21_600)).toBe(true);
    expect(isJourneyDuration(3_600)).toBe(false);
    expect(findJourneyPlan('daoSeeking', 3_600)).toBeUndefined();
  });

  it('受伤概率下限：访道 2%、采集 5%；规则常量与计划一致', () => {
    expect(findJourneyDirection('daoSeeking').injuryFloorBp).toBe(200);
    expect(findJourneyDirection('gathering').injuryFloorBp).toBe(500);
    expect(JOURNEY_MAX_CONCURRENT).toBe(2);
    expect(JOURNEY_MIN_DISCIPLES_AT_HOME).toBe(3);
    expect(JOURNEY_EXTRA_HARVEST_BP).toBe(1_500);
    expect(JOURNEY_HISTORY_LIMIT).toBe(10);
    expect(JOURNEY_INJURY_DURATION_MS).toBe(30 * 60 * 1_000);
    expect(JOURNEY_MIN_REALM_ID).toBe('foundationEstablishment');
  });

  it('边界收窄：脏方向字符串退化为访道，不会产生非法值', () => {
    expect(asJourneyDirection('gathering')).toBe('gathering');
    expect(asJourneyDirection('nope')).toBe('daoSeeking');
    expect(asJourneyDirection('')).toBe('daoSeeking');
  });
});

describe('奖励计算与取整口径', () => {
  it('修为 = floor(表值 × 修炼系数)，资质 50 时系数 10000（与静修同一套系数）', () => {
    expect(reward('daoSeeking', 7_200, 50, 'combat', 0)?.cultivation).toBe(180);
    expect(reward('daoSeeking', 21_600, 50, 'combat', 0)?.cultivation).toBe(540);
  });

  it('资质 100 → 系数 12000，逐项向下取整', () => {
    // floor(540 × 12000 / 10000) = floor(648) = 648
    expect(reward('daoSeeking', 21_600, 100, 'combat', 0)?.cultivation).toBe(648);
    // floor(40 × 12000 / 10000) = 48
    expect(reward('gathering', 7_200, 100, 'combat', 0)?.cultivation).toBe(48);
  });

  it('修炼天赋在系数之后再 +20%（分步取整）', () => {
    // floor(648 × 1.2) = floor(777.6) = 777
    expect(reward('daoSeeking', 21_600, 100, 'cultivation', 0)?.cultivation).toBe(777);
    // floor(48 × 1.2) = floor(57.6) = 57
    expect(reward('gathering', 7_200, 100, 'cultivation', 0)?.cultivation).toBe(57);
  });

  it('采药 / 炼矿天赋只加成对应的采集资源，访道不受影响', () => {
    expect(reward('gathering', 21_600, 50, 'herbGathering', 0)?.resources).toEqual({
      herb: 90_000,
      ore: 60_000,
    });
    expect(reward('gathering', 21_600, 50, 'mining', 0)?.resources).toEqual({
      herb: 75_000,
      ore: 72_000,
    });
    expect(reward('daoSeeking', 21_600, 50, 'herbGathering', 0)?.resources).toEqual({
      spiritStone: 45_000,
    });
  });

  it('不叠加藏经阁的静修加成（奖励只由表值 + 资质 + 天赋决定）', () => {
    const base = reward('daoSeeking', 7_200, 50, 'combat', 0);
    expect(base?.cultivation).toBe(180);
    expect(base?.resources).toEqual({ spiritStone: 15_000 });
  });

  it('未知方向 / 时长的组合返回 null（调用方必须按 VALIDATION_ERROR 处理）', () => {
    expect(
      journeyBaseReward({
        direction: 'daoSeeking',
        durationSeconds: 3_600,
        aptitude: 50,
        talent: 'combat',
        combatPower: 0,
        luck: 50,
        physique: 50,
      }),
    ).toBeNull();
  });
});

describe('受伤概率', () => {
  it('每满 50 点战力减 1 个百分点', () => {
    const plan = findJourneyPlan('daoSeeking', 7_200)!;
    expect(journeyInjuryChanceBp(plan, 0)).toBe(500);
    expect(journeyInjuryChanceBp(plan, 49)).toBe(500);
    expect(journeyInjuryChanceBp(plan, 50)).toBe(400);
    expect(journeyInjuryChanceBp(plan, 100)).toBe(300);
    // 战力足够高时触到访道下限 2%（500 − 400 = 100 → clamp 到 200）。
    expect(journeyInjuryChanceBp(plan, 200)).toBe(200);
    // 战力足够高时会触到访道下限 2%：只减不增，不会比表格值更危险。
    const gather6h = findJourneyPlan('gathering', 21_600)!;
    expect(journeyInjuryChanceBp(gather6h, 350)).toBe(800);
    expect(journeyInjuryChanceBp(gather6h, 10_000)).toBe(500);
  });

  it('访道下限 2%、采集下限 5%（只减不增）', () => {
    const dao = findJourneyPlan('daoSeeking', 7_200)!;
    const gather = findJourneyPlan('gathering', 7_200)!;
    expect(journeyInjuryChanceBp(dao, 10_000)).toBe(200);
    expect(JOURNEY_MIN_DISCIPLES_AT_HOME).toBe(3);
    expect(JOURNEY_MAX_CONCURRENT).toBe(2);
    expect(journeyInjuryChanceBp(gather, 100)).toBe(1_000);
  });
});

describe('额外收获与受伤：独立判定', () => {
  it('额外收获 = 保底值 + floor(保底值 × 50%)，逐项取整', () => {
    const base = reward('gathering', 21_600, 50, 'herbGathering', 0)!;
    const extra = journeyExtraHarvestReward(base);
    expect(extra.cultivation).toBe(Math.floor(120 * 0.5));
    expect(extra.resources).toEqual({ herb: 45_000, ore: 30_000 });
  });

  it('额外未触发时就是保底值本身', () => {
    const base = reward('daoSeeking', 7_200, 50, 'combat', 0)!;
    expect(journeyFinalReward(base, false)).toEqual({
      cultivation: 180,
      resources: { spiritStone: 15_000 },
    });
  });

  it('额外触发时保底与额外相加（修为与各项资源都加）', () => {
    const base = reward('daoSeeking', 7_200, 50, 'combat', 0)!;
    expect(journeyFinalReward(base, true)).toEqual({
      cultivation: 270,
      resources: { spiritStone: 22_500 },
    });
  });

  it('两次掷点决定两个结果：可以同时发生，也各自可以单独发生', () => {
    // random() 依次消费两个值：第一个是额外收获，第二个是受伤。
    const chances = { extraChanceBp: 5_000, injuryChanceBp: 5_000 };
    expect(rollJourneyOutcome(chances, sequence([0.05, 0.9]))).toEqual({
      extraHarvest: true,
      injured: false,
    });
    expect(rollJourneyOutcome(chances, sequence([0.9, 0.1]))).toEqual({
      extraHarvest: false,
      injured: true,
    });
    expect(rollJourneyOutcome(chances, sequence([0.1, 0.1]))).toEqual({
      extraHarvest: true,
      injured: true,
    });
    expect(rollJourneyOutcome(chances, sequence([0.9, 0.9]))).toEqual({
      extraHarvest: false,
      injured: false,
    });
  });

  it('两个概率各自独立生效：一个拉满也不会影响另一个', () => {
    expect(
      rollJourneyOutcome({ extraChanceBp: 10_000, injuryChanceBp: 0 }, sequence([0.999, 0])),
    ).toEqual({ extraHarvest: true, injured: false });
    expect(
      rollJourneyOutcome({ extraChanceBp: 0, injuryChanceBp: 10_000 }, sequence([0, 0.999])),
    ).toEqual({ extraHarvest: false, injured: true });
  });

  it('掷点严格小于概率才命中（边界值不命中）', () => {
    // 受伤概率 1500（15%）：roll 1499 命中，roll 1500 不命中。
    const injury = { extraChanceBp: 0, injuryChanceBp: 1_500 };
    expect(rollJourneyOutcome(injury, sequence([0.9, 0.1499])).injured).toBe(true);
    expect(rollJourneyOutcome(injury, sequence([0.9, 0.15])).injured).toBe(false);
    // 额外收获概率 1010（幸运 1 → 10.1%）：边界同样按严格小于。
    const extra = { extraChanceBp: 1_010, injuryChanceBp: 0 };
    expect(rollJourneyOutcome(extra, sequence([0.1009, 0.9])).extraHarvest).toBe(true);
    expect(rollJourneyOutcome(extra, sequence([0.101, 0.9])).extraHarvest).toBe(false);
  });

  it('没有「失败后奖励归零」的分支：概率为 0 也照样拿满保底', () => {
    const base = reward('daoSeeking', 7_200, 50, 'combat', 10_000)!;
    const outcome = rollJourneyOutcome(
      { extraChanceBp: base.extraChanceBp, injuryChanceBp: base.injuryChanceBp },
      sequence([0.9, 0.5]),
    );
    const final = journeyFinalReward(base, outcome.extraHarvest);
    expect(final.cultivation).toBeGreaterThan(0);
    expect(final.resources).toEqual({ spiritStone: 15_000 });
  });
});

describe('修为封顶与返程入账', () => {
  it('预览按当前剩余门槛截断，并标注「最多」', () => {
    expect(previewJourneyCultivation(180, 300, 0)).toEqual({ cultivation: 180, capped: false });
    expect(previewJourneyCultivation(180, 300, 200)).toEqual({ cultivation: 100, capped: true });
    expect(previewJourneyCultivation(180, 300, 300)).toEqual({ cultivation: 0, capped: true });
  });

  it('最高阶段（门槛为 null）修为收益为 0，但采集方向仍可用', () => {
    expect(previewJourneyCultivation(120, null, 0)).toEqual({ cultivation: 0, capped: true });
    expect(journeyDirectionBlockedReason('gathering', null, 0)).toBeNull();
    expect(journeyDirectionBlockedReason('daoSeeking', null, 0)).toContain('最高阶段');
  });

  it('访道要求当前阶段仍有门槛且未满', () => {
    expect(journeyDirectionBlockedReason('daoSeeking', 300, 0)).toBeNull();
    expect(journeyDirectionBlockedReason('daoSeeking', 300, 299)).toBeNull();
    expect(journeyDirectionBlockedReason('daoSeeking', 300, 300)).toContain('先破境');
  });

  it('返程入账：awarded = min(计划修为, 门槛 − 返程时修为)', () => {
    // 返程时 100 → 可入账 max(0, 300-100) = 200，计划 180 全给。
    expect(
      cultivateJourneyReturn({
        beforeReturn: 100,
        settledCultivation: 100,
        settledRemainder: 1_234,
        requiredCultivation: 300,
        plannedCultivation: 180,
      }),
    ).toEqual({ cultivation: 280, remainder: 1_234, awarded: 180 });
  });

  it('晚登录时静修已填满门槛：历练仍按返程时门槛入账，静修那部分被截断（总收益不越门槛）', () => {
    // 规则要求历练修为「先于返程后的静修结算」：按返程时门槛算，这次实拿 180；
    // 静修在时间上发生在返程之后，所以被截断的是静修那部分（总收益仍止于门槛 300）。
    expect(
      cultivateJourneyReturn({
        beforeReturn: 100,
        settledCultivation: 300,
        settledRemainder: 0,
        requiredCultivation: 300,
        plannedCultivation: 180,
      }),
    ).toEqual({ cultivation: 300, remainder: 0, awarded: 180 });
  });

  it('入账后越过门槛时封顶到门槛并清空余量', () => {
    expect(
      cultivateJourneyReturn({
        beforeReturn: 100,
        settledCultivation: 200,
        settledRemainder: 999,
        requiredCultivation: 300,
        plannedCultivation: 180,
      }),
    ).toEqual({ cultivation: 300, remainder: 0, awarded: 180 });
  });

  it('最高阶段：修为保持原值、awarded 为 0', () => {
    expect(
      cultivateJourneyReturn({
        beforeReturn: 5_000,
        settledCultivation: 5_500,
        settledRemainder: 42,
        requiredCultivation: null,
        plannedCultivation: 120,
      }),
    ).toEqual({ cultivation: 5_500, remainder: 42, awarded: 0 });
  });

  it('等价性：先入账历练再结算静修 == 一次结算 + 一次入账（都在门槛处截断）', () => {
    const threshold = 300;
    for (const before of [0, 100, 250, 299]) {
      for (const journeyGain of [40, 180, 540]) {
        for (const restGain of [0, 30, 200, 1_000]) {
          // 分两步：先入账历练，再叠加静修，最后在门槛截断。
          const twoStep = Math.min(threshold, Math.min(threshold, before + journeyGain) + restGain);
          // 一次结算（静修先算，含在 settledCultivation 里）+ 一次入账。
          const settled = Math.min(threshold, before + restGain);
          const oneShot = cultivateJourneyReturn({
            beforeReturn: before,
            settledCultivation: settled,
            settledRemainder: 0,
            requiredCultivation: threshold,
            plannedCultivation: journeyGain,
          }).cultivation;
          expect(oneShot).toBe(twoStep);
        }
      }
    }
  });
});

describe('时间规则与在外判定', () => {
  it('返程时间 = 出发 + 时长；伤势从返程起算 30 分钟', () => {
    expect(journeyEndsAt(1_000_000, 7_200)).toBe(1_000_000 + 7_200_000);
    expect(journeyInjuryUntil(1_000_000)).toBe(1_000_000 + JOURNEY_INJURY_DURATION_MS);
  });

  it('未到期 = 在外；到期即视为归队（不依赖领取）', () => {
    const endsAt = 5_000;
    expect(journeyStatusOf({ ends_at: endsAt, completed_at: null, claimed_at: null }, 4_999)).toBe(
      'active',
    );
    expect(journeyStatusOf({ ends_at: endsAt, completed_at: null, claimed_at: null }, 5_000)).toBe(
      'ready',
    );
    expect(
      journeyStatusOf({ ends_at: endsAt, completed_at: 6_000, claimed_at: null }, 6_000),
    ).toBe('ready');
    expect(journeyStatusOf({ ends_at: endsAt, completed_at: 6_000, claimed_at: 6_000 }, 6_000)).toBe(
      'none',
    );
  });

  it('在外集合只包含未领取且未到期的记录', () => {
    const rows = [
      { disciple_id: 'a', ends_at: 1_000, claimed_at: null },
      { disciple_id: 'b', ends_at: 1_000, claimed_at: 100 },
      { disciple_id: 'c', ends_at: 3_000, claimed_at: null },
    ];
    expect([...journeyAwayIds(rows, 2_000)].sort()).toEqual(['c']);
    expect([...journeyAwayIds(rows, 4_000)].sort()).toEqual([]);
  });
});

describe('出发资格判定', () => {
  const base = {
    realmId: 'foundationEstablishment',
    injuredUntil: null,
    pending: null,
    activeCount: 0,
    discipleCount: 6,
    othersAwayCount: 0,
    inDefenseLineup: false,
    now: 1_000_000,
  } as const;

  it('炼气弟子不能出发，筑基与更高境界可以', () => {
    expect(journeyEligibilityBlock({ ...base, realmId: 'qiRefining' })?.message).toContain(
      '筑基',
    );
    expect(journeyEligibilityBlock({ ...base, realmId: 'foundationEstablishment' })).toBeNull();
    expect(journeyEligibilityBlock({ ...base, realmId: 'goldenCore' })).toBeNull();
    expect(journeyEligibilityBlock({ ...base, realmId: 'spiritTransformation' })).toBeNull();
  });

  it('受伤未愈不能出发，伤好之后可以', () => {
    expect(
      journeyEligibilityBlock({ ...base, injuredUntil: base.now + 60_000 })?.message,
    ).toContain('疗伤中');
    expect(journeyEligibilityBlock({ ...base, injuredUntil: base.now })).toBeNull();
  });

  it('已有未领取记录时：在外是「尚未归队」，待领取是「先领取」', () => {
    const active = journeyEligibilityBlock({
      ...base,
      pending: { status: 'active', direction: 'daoSeeking' },
    });
    const ready = journeyEligibilityBlock({
      ...base,
      pending: { status: 'ready', direction: 'gathering' },
    });
    expect(active?.code).toBe('INVALID_STATUS');
    expect(active?.message).toContain('尚未归队');
    expect(ready?.code).toBe('INVALID_STATUS');
    expect(ready?.message).toContain('先领取');
  });

  it('两人名额上限是 CAPACITY_FULL；出发后至少要留 3 人', () => {
    const full = journeyEligibilityBlock({ ...base, activeCount: JOURNEY_MAX_CONCURRENT });
    expect(full?.code).toBe('CAPACITY_FULL');
    expect(journeyEligibilityBlock({ ...base, activeCount: 1 })).toBeNull();

    const tooFew = journeyEligibilityBlock({
      ...base,
      discipleCount: 4,
      othersAwayCount: 1,
    });
    expect(tooFew?.code).toBe('INVALID_STATUS');
    expect(tooFew?.message).toContain('守宗');
    // 4 人门内 0 人在外：出发 1 人后还剩 3 人，刚好合规。
    expect(journeyEligibilityBlock({ ...base, discipleCount: 4, othersAwayCount: 0 })).toBeNull();
  });

  it('守擂阵容里的弟子不能出发', () => {
    const blocked = journeyEligibilityBlock({ ...base, inDefenseLineup: true });
    expect(blocked?.message).toContain('守擂阵容');
  });

  it('视图用的 blockedReason 就是同一个判定（只取文案）', () => {
    expect(journeyEligibilityBlockedReason({ ...base, realmId: 'qiRefining' })).toBe(
      journeyEligibilityBlock({ ...base, realmId: 'qiRefining' })?.message,
    );
    expect(journeyEligibilityBlockedReason(base)).toBeNull();
  });
});

describe('奖励快照 JSON 的读取', () => {
  it('合法 JSON 读出字符串表；非法输入退化为空表', () => {
    expect(parseJourneyRewardResources('{"spiritStone":22500}')).toEqual({
      spiritStone: '22500',
    });
    expect(parseJourneyRewardResources('not json')).toEqual({});
    expect(parseJourneyRewardResources('[]')).toEqual({});
    expect(parseJourneyRewardResources('null')).toEqual({});
  });
});


/* ---------- 结算里的「在外」屏蔽（settle.ts） ---------- */

/**
 * 确定性：
 * - 窗口取 25 分钟、随机源固定返回 0.999 —— 25 分钟的期望事件数 0.833 < 1，
 *   小数部分判定不通过，所以**零随机事件**，余额断言可以精确到个位；
 * - 12 小时上限那一条只看 durationMs / cappedByOfflineLimit / 事件条数，不受事件内容影响。
 */
const WINDOW_MS = 25 * 60 * 1_000;
const noEventRandom = (): number => 0.999;

describe('离线结算的在外屏蔽', () => {
  const config = GAME_CONFIG_CONTENT;
  const lastSettledAt = 1_000_000_000;
  /** d1 采矿石（15000/时）、d2 静修（资质 50 → 60/时）。 */
  const disciples = [
    {
      id: 'd1',
      aptitude: 50,
      realmId: 'qiRefining',
      stage: 1,
      cultivation: 0,
      cultivationRemainder: 0,
      assignment: 'oreGathering',
      talent: 'combat',
    },
    {
      id: 'd2',
      aptitude: 50,
      realmId: 'qiRefining',
      stage: 1,
      cultivation: 0,
      cultivationRemainder: 0,
      assignment: 'cultivating',
      talent: 'combat',
    },
  ];
  const resources = [
    { resourceId: 'spiritStone', balance: 0, remainder: 0 },
    { resourceId: 'spiritualEnergy', balance: 0, remainder: 0 },
    { resourceId: 'herb', balance: 0, remainder: 0 },
    { resourceId: 'ore', balance: 0, remainder: 0 },
  ];

  function balanceOf(result: ReturnType<typeof settleEconomy>, resourceId: string): number {
    return result.resources.find((row) => row.resourceId === resourceId)?.balance ?? -1;
  }

  function cultivationOf(result: ReturnType<typeof settleEconomy>, discipleId: string): number {
    return result.disciples.find((row) => row.id === discipleId)?.cultivation ?? -1;
  }

  it('没有在外记录时与旧行为一致（速率 × 窗口毫秒）', () => {
    const result = settleEconomy(
      { config, lastSettledAt, now: lastSettledAt + WINDOW_MS, resources, disciples, absences: [] },
      noEventRandom,
    );
    // 矿石：基础 0 + 弟子 15000/时 × (25/60) 小时 = 6250
    expect(balanceOf(result, 'ore')).toBe(6_250);
    // 修为：60/时 × (25/60) 小时 = 25（未到炼气一层门槛 30）
    expect(cultivationOf(result, 'd2')).toBe(25);
    // 基础产量与弟子无关，照常入账：灵石 30000/时 → 12500
    expect(balanceOf(result, 'spiritStone')).toBe(12_500);
    expect(result.events).toHaveLength(0);
  });

  it('整天在外：岗位产出与静修均为 0，基础产量照常', () => {
    const result = settleEconomy(
      {
        config,
        lastSettledAt,
        now: lastSettledAt + WINDOW_MS,
        resources,
        disciples,
        absences: [
          { discipleId: 'd1', startMs: lastSettledAt, endMs: lastSettledAt + WINDOW_MS },
          { discipleId: 'd2', startMs: lastSettledAt, endMs: lastSettledAt + WINDOW_MS },
        ],
      },
      noEventRandom,
    );
    // 矿石没有基础产量：整段屏蔽后为 0。
    expect(balanceOf(result, 'ore')).toBe(0);
    expect(cultivationOf(result, 'd2')).toBe(0);
    // 灵石的基础产量照常（在外弟子本来就不产灵石）。
    expect(balanceOf(result, 'spiritStone')).toBe(12_500);
  });

  it('区间取交集：窗口外的时段（已归队）恢复岗位收益', () => {
    const result = settleEconomy(
      {
        config,
        lastSettledAt,
        now: lastSettledAt + WINDOW_MS,
        resources,
        disciples,
        // 只在外前一半时间。
        absences: [
          { discipleId: 'd1', startMs: lastSettledAt, endMs: lastSettledAt + WINDOW_MS / 2 },
          { discipleId: 'd2', startMs: lastSettledAt, endMs: lastSettledAt + WINDOW_MS / 2 },
        ],
      },
      noEventRandom,
    );
    // 15000 × (12.5/60) 小时 = 3125
    expect(balanceOf(result, 'ore')).toBe(3_125);
    // 60 × (12.5/60) = 12.5 → 12（余数保留到下次）
    expect(cultivationOf(result, 'd2')).toBe(12);
  });

  it('区间完全在窗口之前（已归队）时不产生任何屏蔽', () => {
    const result = settleEconomy(
      {
        config,
        lastSettledAt,
        now: lastSettledAt + WINDOW_MS,
        resources,
        disciples,
        absences: [
          { discipleId: 'd1', startMs: lastSettledAt - 10 * WINDOW_MS, endMs: lastSettledAt },
        ],
      },
      noEventRandom,
    );
    expect(balanceOf(result, 'ore')).toBe(6_250);
    expect(cultivationOf(result, 'd2')).toBe(25);
  });

  it('absenceDurations 与窗口取交集并按窗口长度封顶', () => {
    const durations = absenceDurations(
      [
        { discipleId: 'd1', startMs: 0, endMs: 1_000 },
        { discipleId: 'd1', startMs: 500, endMs: 5_000 },
      ],
      500,
      1_000,
    );
    // 两段都与 [500, 1500) 相交，求和后按窗口长度封顶为 1000。
    expect(durations.get('d1')).toBe(1_000);
    expect(absenceDurations([], 0, 1_000).size).toBe(0);
    expect(absenceDurations([{ discipleId: 'd1', startMs: 0, endMs: 1 }], 0, 0).size).toBe(0);
    // 区间与窗口不相交时不产生任何条目。
    expect(absenceDurations([{ discipleId: 'd1', startMs: 5_000, endMs: 9_000 }], 0, 1_000).size).toBe(
      0,
    );
  });

  it('整次离线结算仍然只有一个 12 小时窗口（不是每段各一份）', () => {
    // 离线 30 小时：有效时长必须是 12 小时，事件数与「12 小时一次判定」完全相同。
    const capped = settleEconomy({
      config,
      lastSettledAt,
      now: lastSettledAt + 30 * 3_600_000,
      resources,
      disciples,
      absences: [{ discipleId: 'd1', startMs: lastSettledAt, endMs: lastSettledAt + 2 * 3_600_000 }],
    });
    expect(capped.durationMs).toBe(12 * 3_600_000);
    expect(capped.cappedByOfflineLimit).toBe(true);

    const oneWindow = settleEconomy({
      config,
      lastSettledAt,
      now: lastSettledAt + 12 * 3_600_000,
      resources,
      disciples,
      absences: [{ discipleId: 'd1', startMs: lastSettledAt, endMs: lastSettledAt + 2 * 3_600_000 }],
    });
    // 事件条数由有效时长唯一决定：分段（历练起止）不会带来多批随机事件。
    expect(capped.events.length).toBe(oneWindow.events.length);
    expect(capped.events.length).toBe(5);
  });

  it('修为封顶：一次 12 小时结算不会越过突破门槛', () => {
    const result = settleEconomy(
      {
        config,
        lastSettledAt,
        now: lastSettledAt + 12 * 3_600_000,
        resources,
        disciples,
        absences: [],
      },
      noEventRandom,
    );
    // 炼气一层门槛 30：封顶到 30 并清空余量（不会自动突破）。
    expect(cultivationOf(result, 'd2')).toBe(30);
    expect(result.disciples.find((row) => row.id === 'd2')?.cultivationRemainder).toBe(0);
  });
});

/* ---------- 0016 幸运 / 体魄：只作用于单人定时历练 ---------- */

describe('幸运：额外收获概率', () => {
  it('1500 + (幸运 − 50) × 10 基点：1 / 50 / 100 → 1010 / 1500 / 2000', () => {
    expect(journeyExtraHarvestChanceBp(1)).toBe(1_010);
    expect(journeyExtraHarvestChanceBp(50)).toBe(1_500);
    expect(journeyExtraHarvestChanceBp(100)).toBe(2_000);
    expect(journeyExtraHarvestChanceBp(49)).toBe(1_490);
    expect(journeyExtraHarvestChanceBp(51)).toBe(1_510);
  });

  it('中性点就是旧的固定 15%（JOURNEY_EXTRA_HARVEST_BP）', () => {
    expect(JOURNEY_EXTRA_HARVEST_BP).toBe(1_500);
    expect(journeyExtraHarvestChanceBp(50)).toBe(JOURNEY_EXTRA_HARVEST_BP);
  });

  it('脏输入夹取到 1..100、非整数向下取整、非数字退化为中性点', () => {
    expect(journeyExtraHarvestChanceBp(0)).toBe(1_010);
    expect(journeyExtraHarvestChanceBp(101)).toBe(2_000);
    expect(journeyExtraHarvestChanceBp(50.7)).toBe(1_500);
    expect(journeyExtraHarvestChanceBp(Number.NaN)).toBe(1_500);
  });

  it('保底奖励与「额外 +50%」的数量口径不受幸运影响', () => {
    const unlucky = reward('daoSeeking', 7_200, 50, 'combat', 0, 1, 50)!;
    const lucky = reward('daoSeeking', 7_200, 50, 'combat', 0, 100, 50)!;
    expect(unlucky.cultivation).toBe(lucky.cultivation);
    expect(unlucky.resources).toEqual(lucky.resources);
    expect(journeyFinalReward(unlucky, true)).toEqual(journeyFinalReward(lucky, true));
    expect(unlucky.extraChanceBp).toBe(1_010);
    expect(lucky.extraChanceBp).toBe(2_000);
  });
});

describe('体魄：受伤概率', () => {
  /** 访道 2 小时：表值 500，方向下限 200。 */
  const dao = findJourneyPlan('daoSeeking', 7_200)!;
  /** 采集 6 小时：表值 1500，方向下限 500。 */
  const gather = findJourneyPlan('gathering', 21_600)!;

  it('体魄 50 逐位保持旧概率（与 journeyBaseInjuryChanceBp 完全一致）', () => {
    for (const combatPower of [0, 49, 50, 100, 200, 10_000]) {
      expect(journeyInjuryChanceBp(dao, combatPower, 50)).toBe(
        journeyBaseInjuryChanceBp(dao, combatPower),
      );
      expect(journeyInjuryChanceBp(gather, combatPower, 50)).toBe(
        journeyBaseInjuryChanceBp(gather, combatPower),
      );
    }
  });

  it('体魄 1 最多约 +29.4%：floor(基础 × (10000 + 49 × 60) / 10000)', () => {
    // 基础 500（战力 0）→ floor(500 × 12940 / 10000) = floor(647) = 647
    expect(journeyPhysiqueModifiedInjuryChanceBp(500, 1)).toBe(647);
    expect(journeyInjuryChanceBp(dao, 0, 1)).toBe(647);
  });

  it('体魄 100 最多约 −30%：floor(基础 × 7000 / 10000)', () => {
    // 基础 1500（采集 6 小时、战力 0）→ floor(1500 × 0.7) = 1050
    expect(journeyPhysiqueModifiedInjuryChanceBp(1_500, 100)).toBe(1_050);
    expect(journeyInjuryChanceBp(gather, 0, 100)).toBe(1_050);
  });

  it('先算基础概率（含旧的方向下限）再按体魄修正：低体魄可以高于战力触到的下限', () => {
    // 战力 200 → 基础 = max(200, 500 − 400) = 200；体魄 1 → floor(200 × 1.294) = 258
    expect(journeyBaseInjuryChanceBp(dao, 200)).toBe(200);
    expect(journeyInjuryChanceBp(dao, 200, 1)).toBe(258);
  });

  it('方向下限仍然有效：已经触底时高体魄无法继续降低概率', () => {
    // 战力 10_000 → 基础触底 200；体魄 100 → floor(140) = 140 → 被下限 clamp 回 200。
    expect(journeyInjuryChanceBp(dao, 10_000, 100)).toBe(200);
    expect(journeyInjuryChanceBp(gather, 10_000, 100)).toBe(500);
  });

  it('脏输入夹取到 1..100、非整数向下取整、非数字退化为中性点', () => {
    expect(journeyInjuryChanceBp(dao, 0, 0)).toBe(journeyInjuryChanceBp(dao, 0, 1));
    expect(journeyInjuryChanceBp(dao, 0, 101)).toBe(journeyInjuryChanceBp(dao, 0, 100));
    expect(journeyInjuryChanceBp(dao, 0, 50.9)).toBe(journeyInjuryChanceBp(dao, 0, 50));
    expect(journeyInjuryChanceBp(dao, 0, Number.NaN)).toBe(journeyInjuryChanceBp(dao, 0, 50));
  });

  it('体魄只影响受伤概率，不改奖励', () => {
    const frail = reward('gathering', 21_600, 50, 'combat', 0, 50, 1)!;
    const tough = reward('gathering', 21_600, 50, 'combat', 0, 50, 100)!;
    expect(frail.cultivation).toBe(tough.cultivation);
    expect(frail.resources).toEqual(tough.resources);
    expect(frail.injuryChanceBp).toBeGreaterThan(tough.injuryChanceBp);
  });
});

describe('预览与出发共用同一个口径', () => {
  it('迁移后的旧弟子（50 / 50）拿到的预览概率就是原来的值', () => {
    const base = reward('daoSeeking', 21_600, 50, 'combat', 0, 50, 50)!;
    expect(base.extraChanceBp).toBe(1_500);
    expect(base.injuryChanceBp).toBe(findJourneyPlan('daoSeeking', 21_600)!.injuryChanceBp);
  });

  it('journeyExtraHarvestReward 原样保留两项概率，不重掷也不改口径', () => {
    const base = reward('gathering', 7_200, 50, 'combat', 100, 80, 20)!;
    const extra = journeyExtraHarvestReward(base);
    expect(extra.extraChanceBp).toBe(base.extraChanceBp);
    expect(extra.injuryChanceBp).toBe(base.injuryChanceBp);
  });
});
