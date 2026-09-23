import type { GameConfigContent } from '@xiuxian/game-core';

import {
  MISSION_HALL_BUILDING_ID,
  MISSION_HALL_SPIRIT_STONE_BONUS_BP_PER_LEVEL,
  SCRIPTURE_LIBRARY_BUILDING_ID,
  SCRIPTURE_LIBRARY_CULTIVATION_BONUS_BP_PER_LEVEL,
  SPIRITUAL_ARRAY_BUILDING_ID,
  SPIRITUAL_ARRAY_ENERGY_BONUS_BP_PER_LEVEL,
  TALENT_CULTIVATION_BONUS_BP,
  TALENT_POSITION_BONUS_BP,
  effectiveCapacity,
  findStage,
} from './constants';
import { triggerEvents, type TriggeredEvent } from './events';

/**
 * 离线结算（纯计算；规则来自 03 第 3、4 节 + P3 随机事件 + 0014 弟子历练）。
 *
 * 关键点：
 * - 只累计 [lastSettledAt, lastSettledAt + min(elapsed, 12h)]，超过上限的时段永久丢弃；
 * - 产量的整数算法改成「分子累加」：每种资源的分子 = 基础产量 × 窗口毫秒 + Σ 弟子岗位产出 × 该弟子
 *   在岗毫秒。没有在外记录时与旧的「速率 × 窗口毫秒」逐位等价（见 settleEconomy 注释）；
 * - 在外（历练）期间**不计**岗位产出与静修：把该弟子这段区间的毫秒从分子的第二项里扣掉，
 *   但基础产量与 12 小时上限不受影响 —— 因此整次离线结算仍然只有一个窗口、一批随机事件；
 * - 资源触顶时丢弃溢出与小数余量；修为到突破门槛时停止积累并清理余量；
 * - 资源/修为结算完成后追加一次事件判定（P3 第 3 节）：这是本函数**唯一**的随机来源，
 *   通过可选参数 `random`（默认 Math.random）注入，便于测试；
 * - 所有数值来自配置，函数本身不读数据库、不取时间。
 */
export interface ResourceState {
  resourceId: string;
  balance: number;
  remainder: number;
}

export interface DiscipleState {
  id: string;
  aptitude: number;
  realmId: string;
  stage: number;
  cultivation: number;
  cultivationRemainder: number;
  assignment: string;
  /** V4 天赋 id（见 constants.ts 的 TALENTS）；缺省由调用方保证。 */
  talent: string;
}

/**
 * 一名弟子在外的区间（0014 弟子历练）：`[startMs, endMs)` 之内不计岗位产出与静修。
 * 与结算窗口取交集，因此「已归队」的历史区间天然不产生影响。
 */
export interface AbsenceWindow {
  discipleId: string;
  /** 区间起点（含），UTC 毫秒。 */
  startMs: number;
  /** 区间终点（不含），UTC 毫秒。 */
  endMs: number;
}

export interface SettleInput {
  config: GameConfigContent;
  lastSettledAt: number;
  now: number;
  resources: readonly ResourceState[];
  disciples: readonly DiscipleState[];
  /** 宗门等级的资源容量倍率（默认 1；不传时与旧行为完全一致）。 */
  capacityMultiplier?: number;
  /** 建筑等级表（defId -> level），用于计算藏经阁的修炼加速。 */
  buildingLevels?: Record<string, number>;
  /**
   * 在外区间（历练）：只屏蔽弟子贡献，不改变结算窗口与事件判定。
   * 不传 / 传空数组时与旧行为逐位一致。
   */
  absences?: readonly AbsenceWindow[];
}

export interface SettledResource extends ResourceState {
  /** 本段结算使用的产量（最小单位/小时，含岗位弟子贡献）。 */
  ratePerHour: number;
  /** 因容量不足丢弃的量（最小单位）。 */
  discarded: number;
  /** 本段结束时是否已满仓（满仓会丢弃小数余量）。 */
  capped: boolean;
}

export interface SettledDisciple {
  id: string;
  cultivation: number;
  cultivationRemainder: number;
  /** 本段结算使用的修炼速度（修为/小时）。 */
  ratePerHour: number;
}

export interface SettleResult {
  /** 新的最后结算时间（max(lastSettledAt, now)）；时钟回拨时不回拨。 */
  lastSettledAt: number;
  /** 本段实际计收益的毫秒数（已按 12 小时上限截断）。 */
  durationMs: number;
  cappedByOfflineLimit: boolean;
  clockWentBackwards: boolean;
  resources: SettledResource[];
  disciples: SettledDisciple[];
  totalDiscarded: number;
  /** 本段结算触发的事件（P3 第 3 节）；效果已直接作用到 resources 余额上。 */
  events: TriggeredEvent[];
}

const MS_PER_HOUR = 3_600_000;
const BP = 10_000;

export function settleEconomy(input: SettleInput, random: () => number = Math.random): SettleResult {
  const { config, lastSettledAt, now, resources, disciples } = input;
  const capacityMultiplier = input.capacityMultiplier ?? 1;
  const scriptureLibraryLevel = input.buildingLevels?.[SCRIPTURE_LIBRARY_BUILDING_ID] ?? 0;
  const elapsed = Math.max(0, now - lastSettledAt);
  const durationMs = Math.min(elapsed, config.offlineCapSeconds * 1000);

  // 在外毫秒只在这个窗口内计算：窗口外的时段（已归队）自动恢复岗位收益。
  const absentMsByDisciple = absenceDurations(input.absences ?? [], lastSettledAt, durationMs);
  // 弟子岗位产出只算一次：每种资源的分子复用它，保证与 resourceRates（视图速率）同源。
  const outputs = disciples.map((disciple) => ({
    id: disciple.id,
    activeMs: Math.max(0, durationMs - (absentMsByDisciple.get(disciple.id) ?? 0)),
    output: positionOutputPerHour(config, disciple),
  }));
  const baseRates = resourceBaseRates(config, input.buildingLevels);
  const rateByResource = resourceRates(config, disciples, input.buildingLevels);

  const settledResources = resources.map((resource) => {
    const ratePerHour = rateByResource.get(resource.resourceId) ?? 0;
    const numerator = resourceNumerator(
      baseRates.get(resource.resourceId) ?? 0,
      outputs,
      resource.resourceId,
      durationMs,
    );
    return settleResource(resource, config, numerator, ratePerHour, capacityMultiplier);
  });

  const settledDisciples = disciples.map((disciple) =>
    settleDisciple(
      disciple,
      config,
      durationMs,
      scriptureLibraryLevel,
      absentMsByDisciple.get(disciple.id) ?? 0,
    ),
  );

  // P3 第 3 节：资源/修为结算完成后再判定事件，效果直接叠加到结算结果余额上。
  // 只调用一次 triggerEvents：分段（历练起止）不会带来多批随机事件。
  const events = triggerEvents(durationMs, random);
  applyEventEffects(settledResources, config, events, capacityMultiplier);

  return {
    lastSettledAt: Math.max(lastSettledAt, now),
    durationMs,
    cappedByOfflineLimit: elapsed > durationMs,
    clockWentBackwards: now < lastSettledAt,
    resources: settledResources,
    disciples: settledDisciples,
    totalDiscarded: settledResources.reduce((sum, item) => sum + item.discarded, 0),
    events,
  };
}

/**
 * 本次结算窗口 `[windowStart, windowStart + durationMs)` 内每名弟子在外的毫秒数。
 * 与窗口取交集（窗口外为 0），并对同一弟子的多段区间求和后按窗口长度封顶。
 */
export function absenceDurations(
  absences: readonly AbsenceWindow[],
  windowStart: number,
  durationMs: number,
): Map<string, number> {
  const byDisciple = new Map<string, number>();
  if (durationMs <= 0) {
    return byDisciple;
  }
  const windowEnd = windowStart + durationMs;
  for (const absence of absences) {
    const overlap = Math.max(
      0,
      Math.min(windowEnd, absence.endMs) - Math.max(windowStart, absence.startMs),
    );
    if (overlap <= 0) {
      continue;
    }
    const current = byDisciple.get(absence.discipleId) ?? 0;
    byDisciple.set(absence.discipleId, Math.min(durationMs, current + overlap));
  }
  return byDisciple;
}

/**
 * 把事件效果叠加到结算结果余额上：资源不低于 0、不超过该资源容量（P3 第 3 节）。
 * 只改 balance（整数最小单位），不动产量/余数/丢弃量这类产量结算字段。
 */
function applyEventEffects(
  resources: SettledResource[],
  config: GameConfigContent,
  events: readonly TriggeredEvent[],
  capacityMultiplier: number,
): void {
  for (const event of events) {
    for (const [resourceId, amountText] of Object.entries(event.effects)) {
      const settled = resources.find((item) => item.resourceId === resourceId);
      if (settled === undefined) {
        continue;
      }
      const definition = config.resources.find((item) => item.id === resourceId);
      // 容量按宗门等级倍率放大后再夹取，否则升级后的加成就被基础容量截断了。
      const capacity =
        definition === undefined
          ? Number.MAX_SAFE_INTEGER
          : effectiveCapacity(definition.capacity, capacityMultiplier);
      settled.balance = Math.min(capacity, Math.max(0, settled.balance + Number(amountText)));
    }
  }
}

/** 每种资源的产量 = 基础产量 + 所有岗位弟子的产出（配置驱动，不硬编码）。 */
export function resourceRates(
  config: GameConfigContent,
  disciples: readonly DiscipleState[],
  buildingLevels?: Record<string, number>,
): Map<string, number> {
  const rates = resourceBaseRates(config, buildingLevels);
  for (const disciple of disciples) {
    for (const [resourceId, amount] of positionOutputPerHour(config, disciple)) {
      rates.set(resourceId, (rates.get(resourceId) ?? 0) + amount);
    }
  }
  return rates;
}

/**
 * 不含弟子的基础产量（最小单位/小时）：资源基础产出 + 灵矿对灵石的加成 + 聚灵阵对灵气的加成。
 * 这两项加成只抬高基础值，与弟子岗位产出是相加关系（V5.1）。
 */
export function resourceBaseRates(
  config: GameConfigContent,
  buildingLevels?: Record<string, number>,
): Map<string, number> {
  const rates = new Map<string, number>();
  for (const resource of config.resources) {
    rates.set(resource.id, Number(resource.baseRatePerHour));
  }

  const missionHallLevel = buildingLevels?.[MISSION_HALL_BUILDING_ID] ?? 0;
  if (missionHallLevel > 0) {
    const currentRate = rates.get('spiritStone') ?? 0;
    const bonusBp = missionHallLevel * MISSION_HALL_SPIRIT_STONE_BONUS_BP_PER_LEVEL;
    rates.set('spiritStone', Math.floor((currentRate * (10_000 + bonusBp)) / 10_000));
  }

  const spiritualArrayLevel = buildingLevels?.[SPIRITUAL_ARRAY_BUILDING_ID] ?? 0;
  if (spiritualArrayLevel > 0) {
    const currentRate = rates.get('spiritualEnergy') ?? 0;
    const bonusBp = spiritualArrayLevel * SPIRITUAL_ARRAY_ENERGY_BONUS_BP_PER_LEVEL;
    rates.set('spiritualEnergy', Math.floor((currentRate * (10_000 + bonusBp)) / 10_000));
  }

  return rates;
}

/**
 * 单名弟子在当前岗位上的产出（最小单位/小时）；岗位不在配置里（例如闲置）返回空表。
 * V4 4.2：天赋匹配当前岗位时该弟子的产出 ×1.2（基点 12000 vs 10000）。
 */
export function positionOutputPerHour(
  config: GameConfigContent,
  disciple: DiscipleState,
): Map<string, number> {
  const output = new Map<string, number>();
  const position = config.positions.find((item) => String(item.id) === disciple.assignment);
  if (position === undefined) {
    return output;
  }

  const talentMatch =
    (disciple.talent === 'herbGathering' && disciple.assignment === 'herbGathering') ||
    (disciple.talent === 'mining' && disciple.assignment === 'oreGathering');
  const bonusMultiplier = talentMatch ? BP + TALENT_POSITION_BONUS_BP : BP;

  for (const [resourceId, amountText] of Object.entries(position.outputPerHourPerDisciple)) {
    output.set(resourceId, Math.floor((Number(amountText) * bonusMultiplier) / BP));
  }
  return output;
}

/**
 * 单种资源的产量分子（最小单位·毫秒）：
 *   基础产量 × 窗口毫秒 + Σ_{弟子} 该弟子对这项资源的产出 × 该弟子在岗毫秒
 * 没有在外记录时每一项的 activeMs 都等于窗口毫秒，与旧的 `速率 × 窗口毫秒` 完全等价。
 */
function resourceNumerator(
  baseRate: number,
  outputs: readonly { activeMs: number; output: Map<string, number> }[],
  resourceId: string,
  durationMs: number,
): number {
  let numerator = baseRate * durationMs;
  for (const entry of outputs) {
    const contribution = entry.output.get(resourceId);
    if (contribution === undefined) {
      continue;
    }
    numerator += contribution * entry.activeMs;
  }
  return numerator;
}

/** 单名修炼弟子的修为速度（修为/小时）：基础 × (资质系数 / 10000) × 藏经阁加成，加成按配置封顶。 */
export function cultivationRatePerHour(
  config: GameConfigContent,
  disciple: DiscipleState,
  scriptureLibraryLevel = 0,
): number {
  if (disciple.assignment !== 'cultivating') {
    return 0;
  }
  const rawBonusBp = disciple.aptitude * config.cultivation.aptitudeCoefficientPerPointBp;
  const bonusBp = Math.min(rawBonusBp, config.cultivation.maxTotalBonusBp);
  const coefficientBp = config.cultivation.aptitudeCoefficientBaseBp + bonusBp;
  const baseRate = Math.floor((config.cultivation.baseRatePerHour * coefficientBp) / 10_000);
  // 藏经阁加成：每级 +10%
  const libraryBonusBp = scriptureLibraryLevel * SCRIPTURE_LIBRARY_CULTIVATION_BONUS_BP_PER_LEVEL;
  const result = Math.floor((baseRate * (10_000 + libraryBonusBp)) / 10_000);
  // V4 4.3：修炼天赋在藏经阁加成之后再 ×1.2。
  if (disciple.talent === 'cultivation') {
    return Math.floor((result * (10_000 + TALENT_CULTIVATION_BONUS_BP)) / 10_000);
  }
  return result;
}

/**
 * 资源结算：分子 → 收益；容量不足时丢弃溢出，满仓时连小数余量一起丢弃。
 * `numerator` 为 0（本段没有任何产出）时保持余额与余数不变。
 */
function settleResource(
  resource: ResourceState,
  config: GameConfigContent,
  numerator: number,
  ratePerHour: number,
  capacityMultiplier: number,
): SettledResource {
  const definition = config.resources.find((item) => item.id === resource.resourceId);
  const capacity =
    definition === undefined
      ? Number.MAX_SAFE_INTEGER
      : effectiveCapacity(definition.capacity, capacityMultiplier);

  if (ratePerHour <= 0 || numerator <= 0) {
    return { ...resource, ratePerHour, discarded: 0, capped: resource.balance >= capacity };
  }

  const total = numerator + resource.remainder;
  const gain = Math.floor(total / MS_PER_HOUR);
  let remainder = total % MS_PER_HOUR;

  const room = Math.max(0, capacity - resource.balance);
  const accepted = Math.min(gain, room);
  const balance = resource.balance + accepted;
  const capped = balance >= capacity;
  if (capped) {
    // 满仓时丢弃小数余量，避免满仓暗存收益（03 第 3 节）
    remainder = 0;
  }

  return { resourceId: resource.resourceId, balance, remainder, ratePerHour, discarded: gain - accepted, capped };
}

/**
 * 弟子静修结算：只累计在岗毫秒（`durationMs - absenceMs`）。
 * 完全在外（或不在修炼岗位）时不产生收益，并**保留**原有小数余量。
 */
function settleDisciple(
  disciple: DiscipleState,
  config: GameConfigContent,
  durationMs: number,
  scriptureLibraryLevel: number,
  absenceMs: number,
): SettledDisciple {
  const ratePerHour = cultivationRatePerHour(config, disciple, scriptureLibraryLevel);
  const activeMs = Math.max(0, durationMs - absenceMs);
  if (ratePerHour <= 0 || activeMs <= 0) {
    return {
      id: disciple.id,
      cultivation: disciple.cultivation,
      cultivationRemainder: disciple.cultivationRemainder,
      ratePerHour,
    };
  }

  const numerator = ratePerHour * activeMs + disciple.cultivationRemainder;
  const gain = Math.floor(numerator / MS_PER_HOUR);
  let remainder = numerator % MS_PER_HOUR;

  const threshold = findStage(disciple.realmId, disciple.stage).requiredCultivation;
  let cultivation = disciple.cultivation + gain;
  if (threshold !== null && cultivation >= threshold) {
    // 到突破门槛就停止积累并清理余量（不会自动突破）
    cultivation = threshold;
    remainder = 0;
  }

  return { id: disciple.id, cultivation, cultivationRemainder: remainder, ratePerHour };
}
