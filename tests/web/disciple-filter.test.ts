import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DISCIPLE_FILTER,
  DISCIPLE_SORT_OPTIONS,
  breakthroughEligible,
  cultivationProgress,
  cultivationRatio,
  cultivationTier,
  discipleStatus,
  filterDisciples,
  isFilterActive,
  isInjured,
  matchesProgressFilter,
  realmOptions,
  stageOptions,
  journeyBadge,
  type CultivationProgressTier,
  sortDisciples,
  type DiscipleFilter,
  type FilterableDisciple,
} from '../../apps/web/src/utils/discipleFilter';

/**
 * 弟子名册的筛选 / 排序 / 状态派生（apps/web/src/utils/discipleFilter.ts）。
 *
 * 全部用构造的纯数据，不连后端：这些规则必须是纯函数，才能被根级 node 测试直接跑。
 * 疗伤判定统一用固定的 serverNow，不依赖本机时钟，也不写时间敏感断言。
 */
const SERVER_NOW = Date.parse('2026-01-01T12:00:00.000Z');
const IN_ONE_HOUR = '2026-01-01T13:00:00.000Z';
const ONE_HOUR_AGO = '2026-01-01T11:00:00.000Z';

function makeDisciple(overrides: Partial<FilterableDisciple> & { id: string }): FilterableDisciple {
  return {
    name: '无名氏',
    realmId: 'qiRefining',
    realmName: '炼气',
    realmOrder: 0,
    stage: 1,
    stageName: '炼气一层',
    assignment: 'idle',
    assignmentName: '闲置',
    cultivation: 0,
    requiredCultivation: 100,
    cultivationRatePerHour: 12,
    combatPower: 10,
    // 0016 综合评分：服务端现算的六项等权平均（一位小数）；这里只锁排序行为，不重算公式。
    attributeScore: 50,
    injuredUntil: null,
    canBreakthrough: false,
    ...overrides,
  };
}

function withFilter(overrides: Partial<DiscipleFilter>): DiscipleFilter {
  return { ...DEFAULT_DISCIPLE_FILTER, ...overrides };
}

function ids(disciples: readonly FilterableDisciple[]): string[] {
  return disciples.map((disciple) => disciple.id);
}

describe('状态派生优先级', () => {
  it('疗伤中优先于可破境', () => {
    const injured = makeDisciple({
      id: 'a',
      injuredUntil: IN_ONE_HOUR,
      canBreakthrough: true,
      cultivation: 100,
      assignmentName: '采药',
    });
    expect(discipleStatus(injured, SERVER_NOW)).toEqual({ key: 'injured', label: '疗伤中' });
  });

  it('疗伤结束（injuredUntil <= serverNow）不再算疗伤', () => {
    const healed = makeDisciple({ id: 'a', injuredUntil: ONE_HOUR_AGO });
    expect(isInjured(healed, SERVER_NOW)).toBe(false);
    expect(discipleStatus(healed, SERVER_NOW).key).toBe('assignment');
  });

  it('可破境只看 canBreakthrough，优先于版本上限与岗位', () => {
    const ready = makeDisciple({
      id: 'a',
      canBreakthrough: true,
      requiredCultivation: null,
      assignmentName: '采灵',
    });
    expect(discipleStatus(ready, SERVER_NOW)).toEqual({ key: 'canBreakthrough', label: '可破境' });
  });

  it('修为满但 requiredCultivation === null 时是「已达当前版本上限」，不是可破境', () => {
    const capped = makeDisciple({ id: 'a', requiredCultivation: null, cultivation: 9999 });
    expect(discipleStatus(capped, SERVER_NOW)).toEqual({
      key: 'capped',
      label: '已达当前版本上限',
    });
    const progress = cultivationProgress(capped.cultivation, capped.requiredCultivation);
    expect(progress).toEqual({
      percent: 100,
      text: '已达当前版本上限',
      capped: true,
      full: false,
    });
  });

  it('修为到门槛但服务端没给 canBreakthrough 时是「修为已满」', () => {
    const full = makeDisciple({ id: 'a', cultivation: 100, requiredCultivation: 100 });
    expect(discipleStatus(full, SERVER_NOW)).toEqual({ key: 'cultivationFull', label: '修为已满' });
  });

  it('都没有时回落到当前岗位名（含闲置）', () => {
    const idle = makeDisciple({ id: 'a' });
    expect(discipleStatus(idle, SERVER_NOW)).toEqual({ key: 'assignment', label: '闲置' });
    const working = makeDisciple({ id: 'b', assignment: 'herbGathering', assignmentName: '采药' });
    expect(discipleStatus(working, SERVER_NOW)).toEqual({ key: 'assignment', label: '采药' });
  });

  it('进度百分比 clamp 到 0~100，数字保持可读', () => {
    expect(cultivationProgress(90, 180)).toEqual({
      percent: 50,
      text: '90/180',
      capped: false,
      full: false,
    });
    expect(cultivationProgress(999, 100).percent).toBe(100);
    expect(cultivationProgress(-5, 100).percent).toBe(0);
  });
});

describe('组合筛选（境界 / 岗位 / 状态）', () => {
  const roster = [
    makeDisciple({
      id: 'a',
      name: '赵一',
      realmId: 'qiRefining',
      realmName: '炼气',
      realmOrder: 0,
      stage: 2,
      assignment: 'idle',
      assignmentName: '闲置',
    }),
    makeDisciple({
      id: 'b',
      name: '钱二',
      realmId: 'qiRefining',
      realmName: '炼气',
      realmOrder: 0,
      stage: 1,
      assignment: 'herbGathering',
      assignmentName: '采药',
      cultivation: 100,
      requiredCultivation: 100,
      combatPower: 30,
    }),
    makeDisciple({
      id: 'c',
      name: '孙三',
      realmId: 'foundationEstablishment',
      realmName: '筑基',
      realmOrder: 1,
      stage: 1,
      assignment: 'herbGathering',
      assignmentName: '采药',
      injuredUntil: IN_ONE_HOUR,
      canBreakthrough: true,
      // 真实服务端里 canBreakthrough 必然代表修为已到门槛 → 这里刻意给满修为，
      // 用来锁死「修为已满」筛选必须排除可破境者（否则筛选结果与行内标签互相矛盾）。
      cultivation: 300,
      requiredCultivation: 300,
      combatPower: 90,
    }),
    makeDisciple({
      id: 'd',
      name: '李四',
      realmId: 'goldenCore',
      realmName: '金丹',
      realmOrder: 2,
      stage: 1,
      assignment: 'idle',
      assignmentName: '闲置',
      requiredCultivation: null,
      cultivation: 5000,
      combatPower: 50,
    }),
  ];

  it('境界 + 岗位 + 状态可以同时生效', () => {
    const result = filterDisciples(
      roster,
      withFilter({
        realmId: 'qiRefining',
        assignment: 'herbGathering',
        status: 'cultivationFull',
      }),
      SERVER_NOW,
    );
    expect(ids(result)).toEqual(['b']);

    // 换成疗伤状态就没有结果了（组合条件不是「或」）。
    const injuredOnly = filterDisciples(
      roster,
      withFilter({ realmId: 'qiRefining', assignment: 'herbGathering', status: 'injured' }),
      SERVER_NOW,
    );
    expect(injuredOnly).toEqual([]);
  });

  it('状态筛选各自的口径：可破境 / 疗伤 / 修为已满（含版本上限、排除可破境）/ 闲置', () => {
    expect(ids(filterDisciples(roster, withFilter({ status: 'canBreakthrough' }), SERVER_NOW))).toEqual(
      ['c'],
    );
    expect(ids(filterDisciples(roster, withFilter({ status: 'injured' }), SERVER_NOW))).toEqual(['c']);
    expect(ids(filterDisciples(roster, withFilter({ status: 'cultivationFull' }), SERVER_NOW))).toEqual([
      'b',
      'd',
    ]);
    expect(ids(filterDisciples(roster, withFilter({ status: 'idle' }), SERVER_NOW))).toEqual(['a', 'd']);
  });

  it('岗位筛选按岗位 id，境界筛选按境界 id', () => {
    expect(ids(filterDisciples(roster, withFilter({ assignment: 'herbGathering' }), SERVER_NOW))).toEqual(
      ['b', 'c'],
    );
    expect(ids(filterDisciples(roster, withFilter({ realmId: 'goldenCore' }), SERVER_NOW))).toEqual(['d']);
  });

  it('筛选条件互斥时返回空数组（无结果态）', () => {
    const empty = filterDisciples(
      roster,
      withFilter({ realmId: 'qiRefining', assignment: 'notExist' }),
      SERVER_NOW,
    );
    expect(empty).toEqual([]);
    expect(empty.length).toBe(0);
  });

  it('不修改入参，返回新数组', () => {
    const before = ids(roster);
    const result = filterDisciples(roster, withFilter({ sort: 'combatPower' }), SERVER_NOW);
    expect(ids(roster)).toEqual(before);
    expect(result).not.toBe(roster);
  });
});

describe('排序', () => {
  const roster = [
    makeDisciple({ id: 'a', realmOrder: 0, stage: 2, combatPower: 30 }),
    makeDisciple({ id: 'b', realmOrder: 1, stage: 3, combatPower: 30 }),
    makeDisciple({ id: 'c', realmOrder: 1, stage: 1, combatPower: 90 }),
    makeDisciple({ id: 'd', realmOrder: 2, stage: 1, combatPower: 10 }),
  ];

  it('默认（招募顺序）保持 state.disciples 的原顺序', () => {
    expect(ids(filterDisciples(roster, withFilter({}), SERVER_NOW))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('战力高低：从高到低，相同战力保持原顺序', () => {
    expect(ids(filterDisciples(roster, withFilter({ sort: 'combatPower' }), SERVER_NOW))).toEqual([
      'c',
      'a',
      'b',
      'd',
    ]);
  });

  it('境界高低：先比 realmOrder 再比 stage，都相同保持原顺序', () => {
    expect(ids(filterDisciples(roster, withFilter({ sort: 'realm' }), SERVER_NOW))).toEqual([
      'd',
      'b',
      'c',
      'a',
    ]);

    const sameRealm = [
      makeDisciple({ id: 'x', realmId: 'foundationEstablishment', realmOrder: 1, stage: 1 }),
      makeDisciple({ id: 'y', realmId: 'foundationEstablishment', realmOrder: 1, stage: 1 }),
    ];
    expect(ids(filterDisciples(sameRealm, withFilter({ sort: 'realm' }), SERVER_NOW))).toEqual([
      'x',
      'y',
    ]);
  });

  it('境界排序按 realmOrder，不按境界名字符串', () => {
    // 名字字符串排序会把「筑基」排在「炼气」前面，realmOrder 才是服务端顺序。
    const named = [
      makeDisciple({ id: 'qi', realmId: 'qiRefining', realmName: '炼气', realmOrder: 0, stage: 9 }),
      makeDisciple({ id: 'foundation', realmId: 'foundationEstablishment', realmName: '筑基', realmOrder: 1, stage: 1 }),
    ];
    expect(ids(filterDisciples(named, withFilter({ sort: 'realm' }), SERVER_NOW))).toEqual([
      'foundation',
      'qi',
    ]);
  });

  it('综合评分高低：从高到低，按一位小数比较', () => {
    const scored = [
      makeDisciple({ id: 'a', attributeScore: 62.3 }),
      makeDisciple({ id: 'b', attributeScore: 88.1 }),
      makeDisciple({ id: 'c', attributeScore: 12.0 }),
      // 只差 0.1：服务端下发的就是一位小数，这里按原值比较，不再二次取整。
      makeDisciple({ id: 'd', attributeScore: 88.2 }),
    ];
    expect(ids(filterDisciples(scored, withFilter({ sort: 'attributeScore' }), SERVER_NOW))).toEqual([
      'd',
      'b',
      'a',
      'c',
    ]);
    expect(ids(sortDisciples(scored, 'attributeScore'))).toEqual(['d', 'b', 'a', 'c']);
  });

  it('综合评分并列时保持招募顺序（稳定排序，不另拼次级键）', () => {
    const tied = [
      makeDisciple({ id: 'first', attributeScore: 66.6, combatPower: 10 }),
      makeDisciple({ id: 'second', attributeScore: 66.6, combatPower: 999 }),
      makeDisciple({ id: 'third', attributeScore: 66.6, combatPower: 1 }),
      makeDisciple({ id: 'fourth', attributeScore: 66.7, combatPower: 2 }),
    ];
    expect(ids(filterDisciples(tied, withFilter({ sort: 'attributeScore' }), SERVER_NOW))).toEqual([
      'fourth',
      'first',
      'second',
      'third',
    ]);
    // 换一个输入顺序：并列的三人保持「出现在入参里的先后」，也就是 state.disciples 的招募顺序。
    const shuffled = [tied[2], tied[0], tied[3], tied[1]];
    expect(ids(sortDisciples(shuffled, 'attributeScore'))).toEqual([
      'fourth',
      'third',
      'first',
      'second',
    ]);
  });

  it('排序项里同时有战力与综合评分：两者互不代用', () => {
    const mixed = [
      makeDisciple({ id: 'a', combatPower: 10, attributeScore: 90 }),
      makeDisciple({ id: 'b', combatPower: 90, attributeScore: 10 }),
    ];
    expect(ids(filterDisciples(mixed, withFilter({ sort: 'attributeScore' }), SERVER_NOW))).toEqual([
      'a',
      'b',
    ]);
    expect(ids(filterDisciples(mixed, withFilter({ sort: 'combatPower' }), SERVER_NOW))).toEqual([
      'b',
      'a',
    ]);
  });
});

describe('排序项列表', () => {
  it('包含「综合评分高低」，且默认（招募顺序）仍在第一位', () => {
    // 0016 的四项键与文案保持原样；本轮新增的排序项排在它们后面。
    expect(DISCIPLE_SORT_OPTIONS.map((option) => option.value).slice(0, 4)).toEqual([
      'recruitOrder',
      'combatPower',
      'attributeScore',
      'realm',
    ]);
    const score = DISCIPLE_SORT_OPTIONS.find((option) => option.value === 'attributeScore');
    expect(score?.label).toBe('综合评分高低');
    expect(DISCIPLE_SORT_OPTIONS[0]?.value).toBe('recruitOrder');
  });
});

describe('境界筛选项与重置态', () => {
  it('从当前弟子去重派生并按 realmOrder 升序', () => {
    const roster = [
      makeDisciple({ id: 'a', realmId: 'goldenCore', realmName: '金丹', realmOrder: 2 }),
      makeDisciple({ id: 'b', realmId: 'qiRefining', realmName: '炼气', realmOrder: 0 }),
      makeDisciple({ id: 'c', realmId: 'qiRefining', realmName: '炼气', realmOrder: 0 }),
    ];
    expect(realmOptions(roster)).toEqual([
      { realmId: 'qiRefining', realmName: '炼气', realmOrder: 0 },
      { realmId: 'goldenCore', realmName: '金丹', realmOrder: 2 },
    ]);
  });

  it('默认筛选不算「已筛选」，任一项改动都算', () => {
    expect(isFilterActive(DEFAULT_DISCIPLE_FILTER)).toBe(false);
    expect(isFilterActive(withFilter({ realmId: 'qiRefining' }))).toBe(true);
    expect(isFilterActive(withFilter({ assignment: 'idle' }))).toBe(true);
    expect(isFilterActive(withFilter({ status: 'injured' }))).toBe(true);
    expect(isFilterActive(withFilter({ sort: 'realm' }))).toBe(true);
    // 0016 新增排序键：必须被当成非默认态，否则「重置」按钮不会亮，无结果文案也会说错。
    expect(isFilterActive(withFilter({ sort: 'attributeScore' }))).toBe(true);
    expect(isFilterActive(withFilter({ sort: 'combatPower' }))).toBe(true);
    // 新键不影响默认态判定：默认仍是招募顺序。
    expect(isFilterActive({ ...DEFAULT_DISCIPLE_FILTER, sort: 'recruitOrder' })).toBe(false);
  });
});

describe('名册行上的历练标记（journeyBadge）', () => {
  it('none / 没有历练字段时不显示标记', () => {
    expect(journeyBadge({ status: 'none', directionName: null, endsAt: null }, SERVER_NOW)).toBeNull();
    expect(journeyBadge(undefined, SERVER_NOW)).toBeNull();
  });

  it('已归队待领取显示明确入口文案（与服务端 status 一致）', () => {
    expect(journeyBadge({ status: 'ready', directionName: '访道', endsAt: ONE_HOUR_AGO }, SERVER_NOW)).toBe(
      '已归队 · 待领取',
    );
  });

  it('在外且剩余 >= 1 小时时显示「约 N 小时后归队」（向上取整）', () => {
    expect(
      journeyBadge({ status: 'active', directionName: '访道', endsAt: '2026-01-01T15:00:00.000Z' }, SERVER_NOW),
    ).toBe('访道 · 约 3 小时后归队');
    // 2 小时零 1 毫秒也算 3 小时（向上取整），避免显示成不足的时间。
    expect(
      journeyBadge({ status: 'active', directionName: '采集', endsAt: '2026-01-01T14:00:00.001Z' }, SERVER_NOW),
    ).toBe('采集 · 约 3 小时后归队');
  });

  it('在外且剩余不足 1 小时时显示「约 N 分钟后归队」', () => {
    expect(
      journeyBadge({ status: 'active', directionName: '采集', endsAt: '2026-01-01T12:30:00.000Z' }, SERVER_NOW),
    ).toBe('采集 · 约 30 分钟后归队');
    // 已经到期但服务端还没同步（status 仍是 active）时也不显示 0 分钟，至少 1 分钟。
    expect(
      journeyBadge({ status: 'active', directionName: '采集', endsAt: ONE_HOUR_AGO }, SERVER_NOW),
    ).toBe('采集 · 约 1 分钟后归队');
  });

  it('endsAt 缺失或非法时只显示方向名（不猜剩余时间）', () => {
    expect(journeyBadge({ status: 'active', directionName: '访道', endsAt: null }, SERVER_NOW)).toBe('访道');
    expect(journeyBadge({ status: 'active', directionName: '访道', endsAt: '不是时间' }, SERVER_NOW)).toBe(
      '访道',
    );
    // 方向名也缺失时给出中性兜底，不用空串占位。
    expect(journeyBadge({ status: 'active', directionName: null, endsAt: null }, SERVER_NOW)).toBe('历练中');
  });
});

describe('修为进度分档（按服务端原始比例，不用取整百分比）', () => {
  it('四档按 [0,0.25) / [0.25,0.5) / [0.5,0.75) / [0.75,1) 划分', () => {
    const tierOf = (cultivation: number): CultivationProgressTier =>
      cultivationTier(makeDisciple({ id: 'a', cultivation, requiredCultivation: 1000 }));

    expect(tierOf(0)).toBe('lt25');
    expect(tierOf(249.9)).toBe('lt25');
    expect(tierOf(250)).toBe('gte25lt50');
    expect(tierOf(499.9)).toBe('gte25lt50');
    expect(tierOf(500)).toBe('gte50lt75');
    expect(tierOf(749.9)).toBe('gte50lt75');
    expect(tierOf(750)).toBe('gte75lt100');
    expect(tierOf(999.9)).toBe('gte75lt100');
  });

  it('99.6% 仍未满：显示用的整数百分比会四舍五入到 100%，但分档与破境资格都不能跟着算满', () => {
    const almost = makeDisciple({ id: 'a', cultivation: 996, requiredCultivation: 1000 });
    // 展示口径：percent 取整后确实是 100%，full 仍是 false。
    expect(cultivationProgress(996, 1000).percent).toBe(100);
    expect(cultivationProgress(996, 1000).full).toBe(false);
    // 判定口径：仍是「75–不足 100%」，且不能作为破境入口。
    expect(cultivationTier(almost)).toBe('gte75lt100');
    expect(breakthroughEligible(almost)).toBe(false);
    expect(cultivationRatio(almost)).toBeCloseTo(0.996, 5);
  });

  it('已满但不可破 / 可破境 / 版本上限三档互斥', () => {
    const fullBlocked = makeDisciple({ id: 'a', cultivation: 1000, requiredCultivation: 1000 });
    expect(cultivationTier(fullBlocked)).toBe('fullBlocked');
    expect(breakthroughEligible(fullBlocked)).toBe(true);

    const ready = makeDisciple({
      id: 'b',
      cultivation: 1000,
      requiredCultivation: 1000,
      canBreakthrough: true,
    });
    expect(cultivationTier(ready)).toBe('breakthrough');

    const capped = makeDisciple({ id: 'c', cultivation: 9999, requiredCultivation: null });
    expect(cultivationTier(capped)).toBe('capped');
    // 版本上限不显示破境入口：requiredCultivation === null 一律不算资格。
    expect(breakthroughEligible(capped)).toBe(false);
  });

  it('每名弟子只落进一个非 all 档（分档互斥，组合筛选不会自相矛盾）', () => {
    const roster = [
      makeDisciple({ id: 'lt25', cultivation: 10, requiredCultivation: 100 }),
      makeDisciple({ id: 'gte25lt50', cultivation: 30, requiredCultivation: 100 }),
      makeDisciple({ id: 'gte50lt75', cultivation: 60, requiredCultivation: 100 }),
      makeDisciple({ id: 'gte75lt100', cultivation: 90, requiredCultivation: 100 }),
      makeDisciple({ id: 'fullBlocked', cultivation: 100, requiredCultivation: 100 }),
      makeDisciple({
        id: 'breakthrough',
        cultivation: 100,
        requiredCultivation: 100,
        canBreakthrough: true,
      }),
      makeDisciple({ id: 'capped', cultivation: 500, requiredCultivation: null }),
    ];
    const tiers: CultivationProgressTier[] = [
      'lt25',
      'gte25lt50',
      'gte50lt75',
      'gte75lt100',
      'fullBlocked',
      'breakthrough',
      'capped',
    ];

    let hits = 0;
    for (const tier of tiers) {
      const matched = roster.filter((disciple) => matchesProgressFilter(disciple, tier));
      expect(matched.map((disciple) => disciple.id)).toEqual([tier]);
      hits += matched.length;
    }
    expect(hits).toBe(roster.length);
    // all 一律放行。
    expect(roster.filter((disciple) => matchesProgressFilter(disciple, 'all'))).toHaveLength(
      roster.length,
    );
  });

  it('进度分档与状态筛选可以叠加：口径不同的两项同时用不会互相顶掉', () => {
    const roster = [
      makeDisciple({ id: 'full-idle', cultivation: 100, requiredCultivation: 100 }),
      makeDisciple({
        id: 'ready-away',
        cultivation: 100,
        requiredCultivation: 100,
        canBreakthrough: true,
        assignment: 'herbGathering',
        assignmentName: '采药',
      }),
    ];
    expect(
      ids(
        filterDisciples(
          roster,
          withFilter({ status: 'cultivationFull', progress: 'fullBlocked' }),
          SERVER_NOW,
        ),
      ),
    ).toEqual(['full-idle']);
    // 状态「可破境」与进度「已满 · 可破境」命中同一条，但语义各自独立。
    expect(
      ids(filterDisciples(roster, withFilter({ status: 'canBreakthrough' }), SERVER_NOW)),
    ).toEqual(['ready-away']);
    expect(
      ids(filterDisciples(roster, withFilter({ progress: 'breakthrough' }), SERVER_NOW)),
    ).toEqual(['ready-away']);
  });

  it('门槛非法（0 或非有限数）时比例不产生 NaN，排序/筛选仍可稳定工作', () => {
    const zeroGate = makeDisciple({ id: 'a', cultivation: 0, requiredCultivation: 0 });
    expect(cultivationRatio(zeroGate)).toBe(0);
    expect(Number.isFinite(cultivationTier(zeroGate) === 'lt25' ? 1 : 0)).toBe(true);
    const badGate = makeDisciple({ id: 'b', cultivation: 5, requiredCultivation: Number.NaN });
    expect(Number.isFinite(cultivationRatio(badGate))).toBe(true);
    expect(breakthroughEligible(badGate)).toBe(false);
  });
});

describe('境界内阶段从属筛选', () => {
  const roster = [
    makeDisciple({
      id: 'a',
      realmId: 'qiRefining',
      realmName: '炼气',
      realmOrder: 0,
      stage: 3,
      stageName: '炼气三层',
    }),
    makeDisciple({
      id: 'b',
      realmId: 'qiRefining',
      realmName: '炼气',
      realmOrder: 0,
      stage: 1,
      stageName: '炼气一层',
    }),
    makeDisciple({
      id: 'c',
      realmId: 'qiRefining',
      realmName: '炼气',
      realmOrder: 0,
      stage: 1,
      stageName: '炼气一层',
    }),
    makeDisciple({
      id: 'd',
      realmId: 'foundationEstablishment',
      realmName: '筑基',
      realmOrder: 1,
      stage: 2,
      stageName: '筑基二层',
    }),
  ];

  it('选项从完整名单派生，按 stage 数值升序、同阶段去重、标签用 stageName', () => {
    expect(stageOptions(roster, 'qiRefining')).toEqual([
      { stage: 1, stageName: '炼气一层' },
      { stage: 3, stageName: '炼气三层' },
    ]);
    expect(stageOptions(roster, 'foundationEstablishment')).toEqual([
      { stage: 2, stageName: '筑基二层' },
    ]);
  });

  it('没选境界时没有阶段选项（从属筛选不可用）', () => {
    expect(stageOptions(roster, '')).toEqual([]);
  });

  it('阶段筛选按 stage 数值，不按阶段名字符串', () => {
    expect(
      ids(filterDisciples(roster, withFilter({ realmId: 'qiRefining', stage: 1 }), SERVER_NOW)),
    ).toEqual(['b', 'c']);
    expect(
      ids(filterDisciples(roster, withFilter({ realmId: 'qiRefining', stage: 3 }), SERVER_NOW)),
    ).toEqual(['a']);
  });

  it('没选境界时残留的 stage 不参与判定（不留隐藏条件）', () => {
    expect(ids(filterDisciples(roster, withFilter({ stage: 1 }), SERVER_NOW))).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('境界 + 阶段 + 岗位可以同时生效，互斥时返回空', () => {
    const assigned = [
      roster[0],
      { ...roster[1], assignment: 'herbGathering' },
      { ...roster[2], assignment: 'idle' },
    ];
    expect(
      ids(
        filterDisciples(
          assigned,
          withFilter({ realmId: 'qiRefining', stage: 1, assignment: 'herbGathering' }),
          SERVER_NOW,
        ),
      ),
    ).toEqual(['b']);
    expect(
      filterDisciples(
        assigned,
        withFilter({ realmId: 'foundationEstablishment', stage: 1 }),
        SERVER_NOW,
      ),
    ).toEqual([]);
  });
});

describe('排序（既有两项保留 + 新增高低向）', () => {
  it('境界低到高：先比 realmOrder 再比 stage，都相同保持原顺序', () => {
    const roster = [
      makeDisciple({ id: 'a', realmOrder: 0, stage: 2 }),
      makeDisciple({ id: 'b', realmOrder: 1, stage: 3 }),
      makeDisciple({ id: 'c', realmOrder: 1, stage: 1 }),
      makeDisciple({ id: 'd', realmOrder: 2, stage: 1 }),
    ];
    expect(
      ids(filterDisciples(roster, withFilter({ sort: 'realmAsc' }), SERVER_NOW)),
    ).toEqual(['a', 'c', 'b', 'd']);
  });

  it('战力低到高', () => {
    const roster = [
      makeDisciple({ id: 'a', combatPower: 30 }),
      makeDisciple({ id: 'b', combatPower: 30 }),
      makeDisciple({ id: 'c', combatPower: 90 }),
      makeDisciple({ id: 'd', combatPower: 10 }),
    ];
    expect(
      ids(filterDisciples(roster, withFilter({ sort: 'combatPowerAsc' }), SERVER_NOW)),
    ).toEqual(['d', 'a', 'b', 'c']);
  });

  it('修为进度跨境界按原始比例比较，版本上限视为 100%', () => {
    const roster = [
      makeDisciple({ id: 'zero', realmOrder: 0, cultivation: 0, requiredCultivation: 100 }),
      makeDisciple({ id: 'half', realmOrder: 0, cultivation: 50, requiredCultivation: 100 }),
      makeDisciple({ id: 'almost', realmOrder: 1, cultivation: 999, requiredCultivation: 1000 }),
      makeDisciple({ id: 'capped', realmOrder: 2, cultivation: 9, requiredCultivation: null }),
      makeDisciple({ id: 'fifth', realmOrder: 0, cultivation: 20, requiredCultivation: 100 }),
    ];
    expect(
      ids(filterDisciples(roster, withFilter({ sort: 'cultivationProgressDesc' }), SERVER_NOW)),
    ).toEqual(['capped', 'almost', 'half', 'fifth', 'zero']);
    expect(
      ids(filterDisciples(roster, withFilter({ sort: 'cultivationProgressAsc' }), SERVER_NOW)),
    ).toEqual(['zero', 'fifth', 'half', 'almost', 'capped']);
  });

  it('修为进度并列时保持招募顺序（稳定排序）', () => {
    const roster = [
      makeDisciple({ id: 'a', cultivation: 1, requiredCultivation: 4 }),
      makeDisciple({ id: 'b', cultivation: 1, requiredCultivation: 4 }),
      makeDisciple({ id: 'c', cultivation: 2, requiredCultivation: 4 }),
      makeDisciple({ id: 'd', cultivation: 1, requiredCultivation: 4 }),
    ];
    expect(
      ids(filterDisciples(roster, withFilter({ sort: 'cultivationProgressDesc' }), SERVER_NOW)),
    ).toEqual(['c', 'a', 'b', 'd']);
  });

  it('修炼速度高低：按服务端每小时产出', () => {
    const roster = [
      makeDisciple({ id: 'a', cultivationRatePerHour: 12 }),
      makeDisciple({ id: 'b', cultivationRatePerHour: 40 }),
      makeDisciple({ id: 'c', cultivationRatePerHour: 12 }),
      makeDisciple({ id: 'd', cultivationRatePerHour: 5 }),
    ];
    expect(
      ids(filterDisciples(roster, withFilter({ sort: 'cultivationRateDesc' }), SERVER_NOW)),
    ).toEqual(['b', 'a', 'c', 'd']);
    expect(
      ids(filterDisciples(roster, withFilter({ sort: 'cultivationRateAsc' }), SERVER_NOW)),
    ).toEqual(['d', 'a', 'c', 'b']);
  });

  it('排序不改动入参，且新增项不改变原有两项的语义', () => {
    const roster = [
      makeDisciple({ id: 'a', combatPower: 30, realmOrder: 0, stage: 2 }),
      makeDisciple({ id: 'b', combatPower: 10, realmOrder: 1, stage: 1 }),
    ];
    const before = ids(roster);
    expect(ids(filterDisciples(roster, withFilter({ sort: 'combatPower' }), SERVER_NOW))).toEqual([
      'a',
      'b',
    ]);
    expect(ids(filterDisciples(roster, withFilter({ sort: 'realm' }), SERVER_NOW))).toEqual([
      'b',
      'a',
    ]);
    expect(ids(roster)).toEqual(before);
  });
});

describe('阶段 / 进度筛选也纳入「已筛选」判定', () => {
  it('只改阶段或进度也算处于筛选状态，可用于重置按钮', () => {
    expect(isFilterActive(withFilter({}))).toBe(false);
    expect(isFilterActive(withFilter({ stage: 1 }))).toBe(true);
    expect(isFilterActive(withFilter({ progress: 'capped' }))).toBe(true);
  });
});
