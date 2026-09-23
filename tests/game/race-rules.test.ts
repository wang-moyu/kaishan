import { describe, expect, it } from 'vitest';

import {
  BEAST_NAMES,
  RACE_BEAST_COUNT,
  RACE_RANK_GAP,
  RACE_STEP_COUNT,
  RACE_WEIGHT_MAX,
  RACE_WEIGHT_MIN,
  beastWeightsFromRoundKey,
  generateRaceSteps,
  parimutuelOdds,
  raceFixedOdds,
  raceRankRandomOf,
  raceRanksOf,
  raceWeightedPick,
} from '../../apps/server/src/modules/game/gambling';

function sequence(values: number[], fallback = 0.5): () => number {
  const queue = [...values];
  return () => (queue.length > 0 ? (queue.shift() as number) : fallback);
}

describe('灵兽竞逐：互赌倍率', () => {
  it('净池 / 灵兽池 = (总池 × 0.9) / 灵兽池，四舍五入一位小数', () => {
    expect(parimutuelOdds(100000, 50000)).toBe(1.8);
    expect(parimutuelOdds(100000, 20000)).toBe(4.5);
    expect(parimutuelOdds(100000, 100000)).toBe(0.9);
  });

  it('无人投注返回 0', () => {
    expect(parimutuelOdds(100000, 0)).toBe(0);
    expect(parimutuelOdds(0, 0)).toBe(0);
  });
});

describe('灵兽竞逐：固定赔率', () => {
  it('赔率 = 总权重 × 0.9 / 灵兽权重', () => {
    expect(raceFixedOdds(3, 15)).toBe(4.5);
    expect(raceFixedOdds(1, 15)).toBe(13.5);
    expect(raceFixedOdds(5, 15)).toBe(2.7);
    expect(raceFixedOdds(2, 15)).toBe(6.8);
    expect(raceFixedOdds(4, 15)).toBe(3.4);
  });

  it('权重或总权重为 0 时返回 0', () => {
    expect(raceFixedOdds(0, 15)).toBe(0);
    expect(raceFixedOdds(3, 0)).toBe(0);
  });
});

describe('灵兽竞逐：名次', () => {
  it('冠军固定第 1，其余按权重加权随机（roll 恒为 0 时依次取剩余第一个）', () => {
    expect(raceRanksOf([1, 5, 5, 5, 5], 0, () => 0)).toEqual([1, 2, 3, 4, 5]);
    expect(raceRanksOf([3, 3, 3, 3, 3], 2, () => 0)).toEqual([2, 3, 1, 4, 5]);
    expect(raceRanksOf([5, 4, 3, 2, 1], 0, () => 0.999)).toEqual([1, 5, 4, 3, 2]);
  });

  it('同一 round_key 的名次随机源可复现', () => {
    const a = raceRanksOf([2, 5, 1, 4, 3], 3, raceRankRandomOf('2026-09-23T02:02'));
    const b = raceRanksOf([2, 5, 1, 4, 3], 3, raceRankRandomOf('2026-09-23T02:02'));
    expect(a).toEqual(b);
  });

  it('名次刚好是 1~5 的一个排列', () => {
    const ranks = raceRanksOf([2, 5, 1, 4, 3], 3);
    expect([...ranks].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(ranks[3]).toBe(1);
  });
});

describe('灵兽竞逐：动画序列', () => {
  it('每只灵兽 8 步、值域 0~1，最后一步严格等于名次对应的目标进度', () => {
    const steps = generateRaceSteps([1, 2, 3, 4, 5], sequence([0.1, 0.9, 0.3]));

    expect(steps).toHaveLength(RACE_BEAST_COUNT);
    for (const series of steps) {
      expect(series).toHaveLength(RACE_STEP_COUNT);
      for (const value of series) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
    expect(steps[0]?.[RACE_STEP_COUNT - 1]).toBe(1);
    expect(steps[1]?.[RACE_STEP_COUNT - 1]).toBeCloseTo(1 - RACE_RANK_GAP, 10);
    expect(steps[4]?.[RACE_STEP_COUNT - 1]).toBeCloseTo(1 - 4 * RACE_RANK_GAP, 10);
  });
});

describe('灵兽竞逐：加权随机与权重生成', () => {
  it('加权随机：roll = 0 落在第一只、接近 1 落在最后一只', () => {
    expect(raceWeightedPick([1, 1, 1, 1, 1], 0)).toBe(0);
    expect(raceWeightedPick([1, 1, 1, 1, 1], 0.999)).toBe(4);
    expect(raceWeightedPick([5, 1, 1, 1, 1], 0.5)).toBe(0);
    expect(raceWeightedPick([1, 1, 1, 1, 5], 0.5)).toBe(4);
  });

  it('beastWeightsFromRoundKey 生成 5 个 1~5 的整数权重', () => {
    const weights = beastWeightsFromRoundKey('2026-09-23T08:00');
    expect(weights).toHaveLength(RACE_BEAST_COUNT);
    for (const w of weights) {
      expect(w).toBeGreaterThanOrEqual(RACE_WEIGHT_MIN);
      expect(w).toBeLessThanOrEqual(RACE_WEIGHT_MAX);
    }
  });

  it('同一 roundKey 生成相同权重（确定性）', () => {
    const a = beastWeightsFromRoundKey('2026-09-23T08:00');
    const b = beastWeightsFromRoundKey('2026-09-23T08:00');
    expect(a).toEqual(b);
  });

  it('不同 roundKey 生成不同权重', () => {
    const a = beastWeightsFromRoundKey('2026-09-23T08:00');
    const b = beastWeightsFromRoundKey('2026-09-23T08:10');
    expect(a).not.toEqual(b);
  });

  it('灵兽名有 5 个', () => {
    expect(BEAST_NAMES).toHaveLength(RACE_BEAST_COUNT);
  });
});
