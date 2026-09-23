import {
  CHALLENGE_DAILY_LIMIT,
  REWARD_TIERS,
  asDefenseMode,
  asRewardTier,
  challengeDayStateOf,
  challengeUsedFromRow,
  planDefenseLineup,
  rewardForOutcome,
  rewardTierForLevelDifference,
  shufflePick,
} from '../../apps/server/src/modules/game/challenge';
import { describe, expect, it } from 'vitest';

/**
 * 挑战纯逻辑（apps/server/src/modules/game/challenge.ts）：
 * 奖励档位表（计划 3.2）、每日计数口径（4.2）、守擂阵容解析与自动选人（3.3）。
 * 不依赖 workerd/D1，跑在根级 node 测试里；随机源全部注入，不写概率性断言。
 */
describe('挑战奖励档位（计划 3.2 唯一事实来源）', () => {
  it('档位表数值与文档一致', () => {
    expect(REWARD_TIERS.map((tier) => [tier.tier, tier.reputation, tier.spiritStone])).toEqual([
      ['lower_3_plus_no_reward', 0, 0],
      ['lower_2', 5, 50_000],
      ['lower_1', 8, 75_000],
      ['equal', 10, 100_000],
      ['higher_1', 13, 125_000],
      ['higher_2', 15, 150_000],
      ['higher_3_plus', 20, 200_000],
    ]);
  });

  it('等级差 -10 / -3 / -2 / -1 / 0 / +1 / +2 / +3 / +10 全部落到正确档位', () => {
    expect(rewardTierForLevelDifference(-10).tier).toBe('lower_3_plus_no_reward');
    expect(rewardTierForLevelDifference(-3).tier).toBe('lower_3_plus_no_reward');
    expect(rewardTierForLevelDifference(-2).tier).toBe('lower_2');
    expect(rewardTierForLevelDifference(-1).tier).toBe('lower_1');
    expect(rewardTierForLevelDifference(0).tier).toBe('equal');
    expect(rewardTierForLevelDifference(1).tier).toBe('higher_1');
    expect(rewardTierForLevelDifference(2).tier).toBe('higher_2');
    expect(rewardTierForLevelDifference(3).tier).toBe('higher_3_plus');
    expect(rewardTierForLevelDifference(10).tier).toBe('higher_3_plus');
  });

  it('各档位胜利奖励：声望/灵石与表格一致，>=+3 封顶、<=-3 为 0', () => {
    expect(rewardForOutcome('win', -10)).toEqual({
      tier: 'lower_3_plus_no_reward',
      reputation: 0,
      spiritStone: 0,
    });
    expect(rewardForOutcome('win', -3).spiritStone).toBe(0);
    expect(rewardForOutcome('win', -2)).toEqual({
      tier: 'lower_2',
      reputation: 5,
      spiritStone: 50_000,
    });
    expect(rewardForOutcome('win', 0)).toEqual({
      tier: 'equal',
      reputation: 10,
      spiritStone: 100_000,
    });
    expect(rewardForOutcome('win', 3)).toEqual({
      tier: 'higher_3_plus',
      reputation: 20,
      spiritStone: 200_000,
    });
    expect(rewardForOutcome('win', 10)).toEqual({
      tier: 'higher_3_plus',
      reputation: 20,
      spiritStone: 200_000,
    });
  });

  it('任意档位失败的声望/灵石都是 0（档位仍记录）', () => {
    for (const diff of [-10, -3, -2, -1, 0, 1, 2, 3, 10]) {
      const reward = rewardForOutcome('lose', diff);
      expect(reward.reputation).toBe(0);
      expect(reward.spiritStone).toBe(0);
      expect(reward.tier).toBe(rewardTierForLevelDifference(diff).tier);
    }
  });

  it('每日上限常量 = 3', () => {
    expect(CHALLENGE_DAILY_LIMIT).toBe(3);
  });
});

describe('每日计数口径（计划 4.2）', () => {
  // 2026-09-19 12:00 UTC = 2026-09-19 20:00 UTC+8
  const NOW = Date.UTC(2026, 8, 19, 12, 0, 0);

  it('日期键匹配时取 challenge_count（clamp 到 0..3）', () => {
    const today = dateKeyOf(NOW);
    expect(challengeUsedFromRow({ challenge_date_key: today, challenge_count: 2 }, NOW)).toBe(2);
    expect(challengeUsedFromRow({ challenge_date_key: today, challenge_count: 9 }, NOW)).toBe(3);
    expect(challengeUsedFromRow({ challenge_date_key: today, challenge_count: -1 }, NOW)).toBe(0);
  });

  it('日期键不匹配（跨日重置）视为 0', () => {
    expect(challengeUsedFromRow({ challenge_date_key: '', challenge_count: 3 }, NOW)).toBe(0);
    expect(challengeUsedFromRow({ challenge_date_key: '2000-01-01', challenge_count: 3 }, NOW)).toBe(0);
  });

  it('UTC+8 23:59:59 与次日 00:00:00 的日期键正确切换', () => {
    // 2026-09-19 15:59:59 UTC = 2026-09-19 23:59:59 UTC+8；一毫秒后跨到 09-20。
    const beforeMidnight = Date.UTC(2026, 8, 19, 15, 59, 59, 999);
    const afterMidnight = beforeMidnight + 1;
    expect(dateKeyOf(beforeMidnight)).toBe('2026-09-19');
    expect(dateKeyOf(afterMidnight)).toBe('2026-09-20');

    const row = { challenge_date_key: '2026-09-19', challenge_count: 3 };
    expect(challengeUsedFromRow(row, beforeMidnight)).toBe(3);
    expect(challengeUsedFromRow(row, afterMidnight)).toBe(0);
    expect(challengeDayStateOf(row, afterMidnight).remaining).toBe(3);
  });

  it('challengeDayStateOf：键匹配用计数；键不匹配用兼容核对值并 clamp', () => {
    const today = dateKeyOf(NOW);
    const state = challengeDayStateOf({ challenge_date_key: today, challenge_count: 2 }, NOW);
    expect(state).toEqual({ dateKey: today, usedToday: 2, remaining: 1, keyMatches: true });

    // 发布当天：宗门行还是 ''，但今天已有 1 场旧记录（兼容核对传入 1）
    const compat = challengeDayStateOf({ challenge_date_key: '', challenge_count: 0 }, NOW, 1);
    expect(compat.usedToday).toBe(1);
    expect(compat.remaining).toBe(2);
    expect(compat.keyMatches).toBe(false);

    // 兼容值异常时 clamp 到 3
    const over = challengeDayStateOf({ challenge_date_key: '', challenge_count: 0 }, NOW, 99);
    expect(over.usedToday).toBe(3);
    expect(over.remaining).toBe(0);
  });
});

describe('守擂阵容解析（计划 3.3）', () => {
  const disciples = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

  it('有效手动阵容：3 个不重复且都属于本宗 → configured 且保留顺序', () => {
    expect(planDefenseLineup(JSON.stringify(['c', 'a', 'b']), disciples)).toEqual({
      canDefend: true,
      mode: 'configured',
      manualIds: ['c', 'a', 'b'],
    });
  });

  it('未设置阵容但弟子 >= 3 → automatic', () => {
    expect(planDefenseLineup(null, disciples)).toEqual({
      canDefend: true,
      mode: 'automatic',
      manualIds: null,
    });
  });

  it('阵容重复 / 含非本宗弟子 / 失效 ID / 非法 JSON → 回退自动（弟子足够时）', () => {
    expect(planDefenseLineup(JSON.stringify(['a', 'a', 'b']), disciples)).toEqual({
      canDefend: true,
      mode: 'automatic',
      manualIds: null,
    });
    expect(planDefenseLineup(JSON.stringify(['a', 'b', 'ghost']), disciples)).toEqual({
      canDefend: true,
      mode: 'automatic',
      manualIds: null,
    });
    expect(planDefenseLineup('not-json', disciples)).toEqual({
      canDefend: true,
      mode: 'automatic',
      manualIds: null,
    });
    expect(planDefenseLineup(JSON.stringify(['a']), disciples)).toEqual({
      canDefend: true,
      mode: 'automatic',
      manualIds: null,
    });
    for (const invalid of [JSON.stringify(['a', 'b', 'c', null]), JSON.stringify(['a', null, 'b'])]) {
      expect(planDefenseLineup(invalid, disciples)).toEqual({
        canDefend: true,
        mode: 'automatic',
        manualIds: null,
      });
    }
    expect(planDefenseLineup(42 as unknown as string, disciples)).toEqual({
      canDefend: true,
      mode: 'automatic',
      manualIds: null,
    });
  });

  it('弟子 < 3 名时不可被挑战（无论是否设置阵容）', () => {
    const two = [{ id: 'a' }, { id: 'b' }];
    expect(planDefenseLineup(null, two)).toEqual({ canDefend: false });
    expect(planDefenseLineup(JSON.stringify(['a', 'b', 'c']), two)).toEqual({ canDefend: false });
    // 手动阵容里的 ID 已失效（比如引用了别宗弟子）且弟子不足 → 同样不可挑战
    expect(planDefenseLineup(JSON.stringify(['a', 'b', 'x']), [{ id: 'a' }])).toEqual({
      canDefend: false,
    });
  });
});

describe('自动守擂选人（shufflePick）', () => {
  it('不改写原数组', () => {
    const source = [1, 2, 3, 4, 5];
    const frozen = [...source];
    shufflePick(source, 3, () => 0);
    expect(source).toEqual(frozen);
  });

  it('确定性随机源决定抽取与顺序', () => {
    const source = ['a', 'b', 'c', 'd', 'e'];
    // random() 恒 0 → 每步与第 0 位交换，洗牌结果可复现（b,c,d,e,a → 取前 3）
    expect(shufflePick(source, 3, () => 0)).toEqual(['b', 'c', 'd']);
    // random() 恒 0.999… → 每步与自身交换，保持原序
    expect(shufflePick(source, 3, () => 0.999)).toEqual(['a', 'b', 'c']);
    // 同一随机源同一输入 → 同一输出（快照一致性）
    const first = shufflePick(source, 3, seededRandom([0.1, 0.7, 0.3, 0.9]));
    const second = shufflePick(source, 3, seededRandom([0.1, 0.7, 0.3, 0.9]));
    expect(first).toEqual(second);
  });

  it('恰好取出 count 个且不重复', () => {
    const picked = shufflePick(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 3, () => 0.42);
    expect(picked).toHaveLength(3);
    expect(new Set(picked).size).toBe(3);
    for (const item of picked) {
      expect(['a', 'b', 'c', 'd', 'e', 'f', 'g']).toContain(item);
    }
  });
});

describe('历史快照安全读取', () => {
  it('asRewardTier / asDefenseMode：合法值透传，null 与脏数据返回 null', () => {
    expect(asRewardTier('equal')).toBe('equal');
    expect(asRewardTier('higher_3_plus')).toBe('higher_3_plus');
    expect(asRewardTier(null)).toBeNull();
    expect(asRewardTier('made_up_tier')).toBeNull();
    expect(asDefenseMode('automatic')).toBe('automatic');
    expect(asDefenseMode('configured')).toBe('configured');
    expect(asDefenseMode(null)).toBeNull();
    expect(asDefenseMode('auto')).toBeNull();
  });
});

/** 与 constants.dateKeyUtc8 同口径（测试本地辅助，避免导出内部依赖）。 */
function dateKeyOf(timestamp: number): string {
  return new Date(timestamp + 8 * 3_600_000).toISOString().slice(0, 10);
}

/** 依次返回给定序列的确定性随机源（序列用尽后回 0）。 */
function seededRandom(values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index] ?? 0;
    index += 1;
    return value;
  };
}
