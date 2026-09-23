import { findStage, realmIndex } from './constants';
import { ATTRIBUTE_MAX, ATTRIBUTE_MIN, ATTRIBUTE_NEUTRAL } from './names';
import { discipleCombatPower } from './realms';

/**
 * 弟子单人历练（0014 迁移）——不访问数据库的纯定义与纯计算。
 *
 * 与 alchemy.ts / challenge.ts 同一做法：方向、时长白名单、奖励表、概率公式、时间边界
 * 都在这里集中定义，是 service / view / 预览 / 文案共用的**单一事实来源**；
 * 前端不复制任何一条公式（预览数值由服务端算好下发）。
 *
 * 本文件不调用 Date.now()、不读库；需要「现在」的调用方传入 now。
 *
 * 规则出处：docs/弟子历练开发计划.md 第 2 节（第一版产品规则）。
 * 金额一律是**最小单位**（03 第 1 节：1 展示单位 = 1000 最小单位）的整数。
 *
 * 取整口径（计划 2.2「每步向下取整」）：资质系数、天赋加成、额外收获加成各自 floor 一次，
 * 绝不先合并再取整；测试里逐条钉死，避免以后调参时悄悄改变结果。
 */

/** 历练方向：固定两种。 */
export type JourneyDirection = 'daoSeeking' | 'gathering';

/** 单条历练记录对「弟子当前能不能行动」的归约状态（none = 没有未领取记录）。 */
export type JourneyStatus = 'none' | 'active' | 'ready';

export interface JourneyDirectionDef {
  id: JourneyDirection;
  name: string;
  description: string;
  /** 受伤概率下限（基点）：访道 2%，采集 5%（计划 2.2）。 */
  injuryFloorBp: number;
}

/** 方向定义（顺序即前端展示顺序）。 */
export const JOURNEY_DIRECTIONS: readonly JourneyDirectionDef[] = [
  {
    id: 'daoSeeking',
    name: '访道',
    description: '寻访同道、参悟道统，带回修为与灵石；当前阶段需仍有修为门槛。',
    injuryFloorBp: 200,
  },
  {
    id: 'gathering',
    name: '采集',
    description: '远赴灵山采集药材与矿石；最高阶段也可出行，但不再有修为收益。',
    injuryFloorBp: 500,
  },
];

export interface JourneyPlanDef {
  direction: JourneyDirection;
  durationSeconds: number;
  /** 保底修为（未计资质/天赋加成）。 */
  cultivation: number;
  /** 保底资源（最小单位，未计天赋加成）。 */
  resources: Record<string, number>;
  /** 基础受伤概率（基点，未按战力下调）。 */
  injuryChanceBp: number;
}

/**
 * 方向 × 时长数值表（计划 2.2 的测试基线，唯一事实来源）。
 */
export const JOURNEY_PLANS: readonly JourneyPlanDef[] = [
  {
    direction: 'daoSeeking',
    durationSeconds: 7_200,
    cultivation: 180,
    resources: { spiritStone: 15_000 },
    injuryChanceBp: 500,
  },
  {
    direction: 'daoSeeking',
    durationSeconds: 21_600,
    cultivation: 540,
    resources: { spiritStone: 45_000 },
    injuryChanceBp: 800,
  },
  {
    direction: 'gathering',
    durationSeconds: 7_200,
    cultivation: 40,
    resources: { herb: 25_000, ore: 20_000 },
    injuryChanceBp: 1_200,
  },
  {
    direction: 'gathering',
    durationSeconds: 21_600,
    cultivation: 120,
    resources: { herb: 75_000, ore: 60_000 },
    injuryChanceBp: 1_500,
  },
];

/** 合法时长白名单（秒）：只有 2 小时与 6 小时两档。 */
export const JOURNEY_DURATIONS_SECONDS: readonly number[] = [7_200, 21_600];

/** 同一宗门最多同时在外（尚未到期）的人数；已到期待领取不占名额。 */
export const JOURNEY_MAX_CONCURRENT = 2;

/** 出发后至少要留在宗门内（不在外）的弟子数：防「全员出门」免战。 */
export const JOURNEY_MIN_DISCIPLES_AT_HOME = 3;

/** 「额外收获」在幸运 50（机制中性点）时的独立判定概率（基点，15%）。 */
export const JOURNEY_EXTRA_HARVEST_BP = 1_500;

/** 幸运每偏离中性点 1 点，额外收获概率增减 10 基点（0.1%）：1/50/100 → 10.1% / 15% / 20%。 */
export const JOURNEY_LUCK_EXTRA_STEP_BP = 10;

/** 体魄每偏离中性点 1 点，受伤概率系数增减 60 基点（0.6%）：1 最多 +29.4%，100 最多 −30%。 */
export const JOURNEY_PHYSIQUE_INJURY_STEP_BP = 60;

/** 额外收获在保底值之上再加的比例（50%，逐项向下取整）。 */
export const JOURNEY_EXTRA_HARVEST_RATIO_BP = 5_000;
/** sync 返回的最近历练摘要条数（新的在前）。 */
export const JOURNEY_HISTORY_LIMIT = 10;

/** 受伤持续时间：从**到期时间**起算 30 分钟（计划 2.2）。 */
export const JOURNEY_INJURY_DURATION_MS = 30 * 60 * 1000;

/** 历练门槛：筑基初期起（按弟子本人的境界判定，与宗门等级无关）。 */
export const JOURNEY_MIN_REALM_ID = 'foundationEstablishment';

/** 修炼天赋对历练修为的加成（基点，+20%）。 */
export const JOURNEY_CULTIVATION_TALENT_BP = 2_000;

/** 采集天赋对采集资源的加成（基点，+20%）：采药 → 药材，炼矿 → 矿石。 */
export const JOURNEY_GATHERING_TALENT_BP = 2_000;

/** 采集方向下，天赋 → 受加成资源 id 的对应表。 */
export const JOURNEY_GATHERING_TALENT_RESOURCE: Record<string, string> = {
  herbGathering: 'herb',
  mining: 'ore',
};

const BP = 10_000;

/** 按方向 + 时长查数值表；只要表里没有这一对就是非法组合（返回 undefined）。 */
export function findJourneyPlan(
  direction: JourneyDirection,
  durationSeconds: number,
): JourneyPlanDef | undefined {
  return JOURNEY_PLANS.find(
    (plan) => plan.direction === direction && plan.durationSeconds === durationSeconds,
  );
}

/** 方向 id 是否合法（schema 之外的第二道白名单）。 */
export function isJourneyDirection(value: string): value is JourneyDirection {
  return JOURNEY_DIRECTIONS.some((direction) => direction.id === value);
}

export function findJourneyDirection(direction: JourneyDirection): JourneyDirectionDef {
  return JOURNEY_DIRECTIONS.find((item) => item.id === direction) ?? JOURNEY_DIRECTIONS[0]!;
}

/** 时长白名单校验（批量参数一律用它，不在各处散写 === 7200 || === 21600）。 */
export function isJourneyDuration(durationSeconds: number): boolean {
  return JOURNEY_DURATIONS_SECONDS.includes(durationSeconds);
}

export function journeyDurationLabel(durationSeconds: number): string {
  return `${String(durationSeconds / 3_600)} 小时`;
}

/* ---------- 纯时间规则（返程 / 伤势 / 在外判定都以服务器时间为准） ---------- */

/** 逻辑返程时间 = 出发时刻 + 时长；与玩家何时上线无关。 */
export function journeyEndsAt(startedAt: number, durationSeconds: number): number {
  return startedAt + durationSeconds * 1_000;
}

/** 受伤截止时间固定从**到期时间**起算（不是领取时间），晚登录可能已经痊愈。 */
export function journeyInjuryUntil(endsAt: number): number {
  return endsAt + JOURNEY_INJURY_DURATION_MS;
}

/**
 * 是否仍在在外（未到期）：`now < endsAt`。
 * 到期即视为已归队 —— 玩家是否领取不影响能否工作（但未领取前不能再出发 / 被驱逐）。
 */
export function isJourneyAway(endsAt: number, now: number): boolean {
  return now < endsAt;
}

/**
 * 单条未领取记录的归约状态：'active'（尚未到期）/ 'ready'（已到期待领取）。
 * 不接收已领取记录 —— 已领取的历史不该再产生任何状态。
 */
export function journeyStatusOf(
  row: { ends_at: number; completed_at: number | null; claimed_at: number | null },
  now: number,
): JourneyStatus {
  if (row.claimed_at !== null) {
    return 'none';
  }
  return isJourneyAway(Number(row.ends_at), now) ? 'active' : 'ready';
}

/** 某宗未领取记录里仍在外的弟子 id 集合（结算屏蔽与状态派生的唯一入口）。 */
export function journeyAwayIds(
  rows: readonly { disciple_id: string; ends_at: number; claimed_at: number | null }[],
  now: number,
): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.claimed_at === null && isJourneyAway(Number(row.ends_at), now)) {
      ids.add(row.disciple_id);
    }
  }
  return ids;
}

/* ---------- 奖励与概率（出发时快照，到期前不公开） ---------- */

export interface JourneyRewardInput {
  direction: JourneyDirection;
  durationSeconds: number;
  /** 弟子资质（出发时快照）。 */
  aptitude: number;
  /** 弟子天赋 id（出发时快照）。 */
  talent: string;
  /** 出发时战力（discipleCombatPower），只用于下调受伤概率。 */
  combatPower: number;
  /** 弟子幸运（出发时快照，1..100）：只决定额外收获概率。 */
  luck: number;
  /** 弟子体魄（出发时快照，1..100）：只决定受伤概率系数。 */
  physique: number;
}

/** 保底奖励（含资质/天赋加成）+ 两项实际概率；随机结果不在这里。 */
export interface JourneyBaseReward {
  /** 保底修为（资质系数 + 修炼天赋后）。 */
  cultivation: number;
  /** 保底资源（最小单位，采集天赋后）。 */
  resources: Record<string, number>;
  /** 额外收获概率（基点，由幸运决定；预览与出发共用同一个值）。 */
  extraChanceBp: number;
  /** 实际受伤概率（基点，已按战力与体魄调整并 clamp 到该方向下限）。 */
  injuryChanceBp: number;
}

/**
 * 修炼系数（基点）= min(8000 + 40 × 资质, 20000)，即计划 2.2 给出的公式。
 * 注意：资质为 1~100 时它与 settle.ts 的「基础 8000 + 资质加成（封顶 20000）」完全等价
 * （40 × 100 = 4000 < 20000），这里按文档字面实现。
 */
export function journeyAptitudeCoefficientBp(aptitude: number): number {
  return Math.min(8_000 + 40 * Math.max(0, Math.floor(aptitude)), 20_000);
}

/**
 * 「基础受伤概率」（基点）= 表格值 − floor(战力 / 50) × 100，再 clamp 到该方向的下限。
 * 只减不增：战力再低也不会比表格值更危险。体魄的修正见 journeyInjuryChanceBp。
 */
export function journeyBaseInjuryChanceBp(plan: JourneyPlanDef, combatPower: number): number {
  const direction = findJourneyDirection(plan.direction);
  const reduction = Math.floor(Math.max(0, combatPower) / 50) * 100;
  return Math.max(direction.injuryFloorBp, plan.injuryChanceBp - reduction);
}

/** 1..100 夹取（脏行也不会把概率带出 2.2 给出的区间；非数字退化为中性点）。 */
function clampAttribute(value: number): number {
  if (!Number.isFinite(value)) return ATTRIBUTE_NEUTRAL;
  return Math.min(ATTRIBUTE_MAX, Math.max(ATTRIBUTE_MIN, Math.floor(value)));
}

/**
 * 幸运 → 额外收获概率（基点）= 1500 + (幸运 − 50) × 10（计划 2.2）。
 * 幸运 1/50/100 分别对应 1010 / 1500 / 2000 基点（10.1% / 15% / 20%）；
 * 历练保底奖励与「触发后额外 +50%」的数量口径都不受影响。
 */
export function journeyExtraHarvestChanceBp(luck: number): number {
  return (
    JOURNEY_EXTRA_HARVEST_BP +
    (clampAttribute(luck) - ATTRIBUTE_NEUTRAL) * JOURNEY_LUCK_EXTRA_STEP_BP
  );
}

/**
 * 体魄对受伤概率的修正（基点，向下取整一次）：
 *   floor(基础概率 × (10000 − (体魄 − 50) × 60) / 10000)
 * 体魄 50 逐位保持旧概率；1 最多约 +29.4%，100 最多约 −30%。
 */
export function journeyPhysiqueModifiedInjuryChanceBp(
  baseInjuryChanceBp: number,
  physique: number,
): number {
  const factorBp =
    BP - (clampAttribute(physique) - ATTRIBUTE_NEUTRAL) * JOURNEY_PHYSIQUE_INJURY_STEP_BP;
  return Math.floor((Math.max(0, baseInjuryChanceBp) * factorBp) / BP);
}

/**
 * 最终受伤概率（基点）：先按战力与方向表算出基础概率（含旧的方向下限），
 * 再按体魄调整，最后再与方向下限取大。
 *
 * 原方向下限仍然有效，所以高体魄在已经触底时可能无法继续降低概率。
 * physique 默认 50：迁移后的旧弟子（50/50）得到的概率与加体魄之前完全一致。
 */
export function journeyInjuryChanceBp(
  plan: JourneyPlanDef,
  combatPower: number,
  physique: number = ATTRIBUTE_NEUTRAL,
): number {
  const direction = findJourneyDirection(plan.direction);
  const modified = journeyPhysiqueModifiedInjuryChanceBp(
    journeyBaseInjuryChanceBp(plan, combatPower),
    physique,
  );
  return Math.max(direction.injuryFloorBp, modified);
}

/**
 * 出发时把资质/天赋加成算成保底奖励（每步向下取整），并给出两项**实际概率**：
 *   1. 修为 = floor(表值 × 修炼系数 / 10000)，再按修炼天赋 floor(× 1.2)；
 *   2. 采集方向下对应天赋再 floor(资源 × 1.2)；
 *   3. extraChanceBp = 1500 + (幸运 − 50) × 10（幸运决定）；
 *   4. injuryChanceBp = clamp(体魄修正(基础受伤概率), 方向下限)（体魄决定）。
 * 不叠加藏经阁的静修加成（那是原岗位产出，出发期间本来就不计）。
 */
export function journeyBaseReward(input: JourneyRewardInput): JourneyBaseReward | null {
  const plan = findJourneyPlan(input.direction, input.durationSeconds);
  if (plan === undefined) {
    return null;
  }

  const coefficientBp = journeyAptitudeCoefficientBp(input.aptitude);
  let cultivation = Math.floor((plan.cultivation * coefficientBp) / BP);
  if (input.talent === 'cultivation') {
    cultivation = Math.floor((cultivation * (BP + JOURNEY_CULTIVATION_TALENT_BP)) / BP);
  }

  const talentResource =
    input.direction === 'gathering'
      ? JOURNEY_GATHERING_TALENT_RESOURCE[input.talent]
      : undefined;
  const resources: Record<string, number> = {};
  for (const [resourceId, amount] of Object.entries(plan.resources)) {
    resources[resourceId] =
      resourceId === talentResource
        ? Math.floor((amount * (BP + JOURNEY_GATHERING_TALENT_BP)) / BP)
        : amount;
  }

  return {
    cultivation,
    resources,
    extraChanceBp: journeyExtraHarvestChanceBp(input.luck),
    injuryChanceBp: journeyInjuryChanceBp(plan, input.combatPower, input.physique),
  };
}

/** 额外收获：修为与各项资源各自再加保底值的 50%（逐项向下取整）。 */
export function journeyExtraHarvestReward(base: JourneyBaseReward): JourneyBaseReward {
  const resources: Record<string, number> = {};
  for (const [resourceId, amount] of Object.entries(base.resources)) {
    resources[resourceId] = Math.floor((amount * JOURNEY_EXTRA_HARVEST_RATIO_BP) / BP);
  }
  return {
    cultivation: Math.floor((base.cultivation * JOURNEY_EXTRA_HARVEST_RATIO_BP) / BP),
    resources,
    extraChanceBp: base.extraChanceBp,
    injuryChanceBp: base.injuryChanceBp,
  };
}

/** 把「保底 + 额外」合并成最终发放值（额外未触发时就是保底值本身）。 */
export function journeyFinalReward(
  base: JourneyBaseReward,
  extraHarvest: boolean,
): { cultivation: number; resources: Record<string, number> } {
  if (!extraHarvest) {
    return { cultivation: base.cultivation, resources: { ...base.resources } };
  }
  const extra = journeyExtraHarvestReward(base);
  const resources: Record<string, number> = {};
  for (const [resourceId, amount] of Object.entries(base.resources)) {
    resources[resourceId] = amount + (extra.resources[resourceId] ?? 0);
  }
  return { cultivation: base.cultivation + extra.cultivation, resources };
}

/**
 * 出发时一次性抽取：额外收获与受伤各掷一次、互相独立（计划 2.2）。
 *
 * 两个概率都由调用方传入（额外收获来自幸运、受伤来自战力 + 体魄），本函数不再自带
 * 任何固定概率；随机源可注入（默认 Math.random）。结果随记录落库，
 * 刷新 / 到期 / 重复领取都不会重抽。
 */
export function rollJourneyOutcome(
  chances: { extraChanceBp: number; injuryChanceBp: number },
  random: () => number = Math.random,
): { extraHarvest: boolean; injured: boolean } {
  const extraHarvest = Math.floor(random() * BP) < chances.extraChanceBp;
  const injured = Math.floor(random() * BP) < chances.injuryChanceBp;
  return { extraHarvest, injured };
}

/* ---------- 修为封顶与预览 ---------- */

/**
 * 预览用的修为收益：按当前剩余门槛截断（计划 2.2「预览的修为须按当前剩余突破门槛截断」）。
 * 实际入账以返程时的剩余门槛为准（见 cultivateJourneyReturn）。
 */
export function previewJourneyCultivation(
  planned: number,
  requiredCultivation: number | null,
  cultivation: number,
): { cultivation: number; capped: boolean } {
  if (requiredCultivation === null) {
    return { cultivation: 0, capped: true };
  }
  const room = Math.max(0, requiredCultivation - cultivation);
  return room >= planned
    ? { cultivation: planned, capped: false }
    : { cultivation: room, capped: true };
}

/**
 * 返程入账（纯函数）：把历练修为按**返程时的剩余突破门槛**叠加到结算后的修为上。
 *
 * - `settledCultivation` 是本次结算（含返程后正常静修）之后的修为，`beforeReturn` 是
 *   返程那一刻的修为（在外期间不积累，所以就是结算开始时的值）；
 * - `awarded = min(计划修为, 门槛 − 返程时修为)`，即「实际增加量」，最高阶段恒为 0；
 * - 叠加后仍以门槛封顶并清空小数余量 —— 与 settle.ts 的静修封顶保持同一口径。
 *
 * 数学上它等价于「先入账历练修为、再结算返程后的静修」：两者都只是在门槛处截断，
 * min(T, min(T, C + G) + R) === min(T, C + G + R)。这里用一次结算 + 一次入账表达，
 * 因此整次离线结算仍然只有一个 12 小时窗口、一批随机事件。
 */
export function cultivateJourneyReturn(input: {
  beforeReturn: number;
  settledCultivation: number;
  settledRemainder: number;
  requiredCultivation: number | null;
  plannedCultivation: number;
}): { cultivation: number; remainder: number; awarded: number } {
  const { beforeReturn, settledCultivation, settledRemainder, requiredCultivation } = input;
  if (requiredCultivation === null) {
    return { cultivation: settledCultivation, remainder: settledRemainder, awarded: 0 };
  }
  const room = Math.max(0, requiredCultivation - beforeReturn);
  const awarded = Math.max(0, Math.min(input.plannedCultivation, room));
  let cultivation = settledCultivation + awarded;
  let remainder = settledRemainder;
  if (cultivation >= requiredCultivation) {
    cultivation = requiredCultivation;
    remainder = 0;
  }
  return { cultivation, remainder, awarded };
}

/* ---------- 出发资格（纯判定：输入全部来自调用方读到的状态） ---------- */

export interface JourneyEligibilityInput {
  realmId: string;
  /** 伤势截止时间；null = 无恙。 */
  injuredUntil: number | null;
  /** 该弟子未领取的历练记录；没有则 null。 */
  pending: { status: Exclude<JourneyStatus, 'none'>; direction: JourneyDirection } | null;
  /** 本宗尚未到期（在外）的人数，含本人（本人一定是 none 才走到这里）。 */
  activeCount: number;
  /** 门下弟子总数。 */
  discipleCount: number;
  /** 除本人以外仍在外的弟子数。 */
  othersAwayCount: number;
  /** 本人是否在某宗手动守擂阵容里（阵容快照按 id 判定）。 */
  inDefenseLineup: boolean;
  now: number;
}

/** 出发被拒绝的原因码 + 文案（service 据此抛业务错误，view 只取文案）。 */
export type JourneyBlockCode = 'INVALID_STATUS' | 'CAPACITY_FULL';

export interface JourneyBlock {
  code: JourneyBlockCode;
  message: string;
}

/**
 * 与方向无关的不可出发原因；null = 可以出发（方向自身的限制见 journeyDirectionBlockedReason）。
 * 判定顺序即报错优先级：身份 → 未领取记录 → 伤势 → 名额 → 留守 → 阵容。
 *
 * 只有「同时在外的两人名额」映射为 CAPACITY_FULL（计划第 3 节要求的业务错误码），
 * 其余都是 INVALID_STATUS；view 层只取 message 展示。
 */
export function journeyEligibilityBlock(input: JourneyEligibilityInput): JourneyBlock | null {
  if (realmIndex(input.realmId) < realmIndex(JOURNEY_MIN_REALM_ID)) {
    return { code: 'INVALID_STATUS', message: '筑基后方可历练' };
  }
  if (input.pending !== null) {
    return {
      code: 'INVALID_STATUS',
      message:
        input.pending.status === 'active'
          ? '正在外历练，尚未归队'
          : '已有待领取的历练收获，先领取后才能再次出发',
    };
  }
  if (input.injuredUntil !== null && Number(input.injuredUntil) > input.now) {
    const remaining = Math.ceil((Number(input.injuredUntil) - input.now) / 1_000);
    return { code: 'INVALID_STATUS', message: `疗伤中（剩 ${String(remaining)} 秒），带伤不可出行` };
  }
  if (input.activeCount >= JOURNEY_MAX_CONCURRENT) {
    return {
      code: 'CAPACITY_FULL',
      message: `同时历练名额已满（最多 ${String(JOURNEY_MAX_CONCURRENT)} 人）`,
    };
  }
  // 出发后门内至少要留 JOURNEY_MIN_DISCIPLES_AT_HOME 名不在外的弟子（防「全员出门」免战）。
  const atHomeAfterDeparture = input.discipleCount - input.othersAwayCount - 1;
  if (atHomeAfterDeparture < JOURNEY_MIN_DISCIPLES_AT_HOME) {
    return {
      code: 'INVALID_STATUS',
      message: `需至少留 ${String(JOURNEY_MIN_DISCIPLES_AT_HOME)} 名弟子守宗（当前门下 ${String(
        input.discipleCount,
      )} 人，其中 ${String(input.othersAwayCount)} 人正在外）`,
    };
  }
  if (input.inDefenseLineup) {
    return { code: 'INVALID_STATUS', message: '在守擂阵容中，先调整阵容再出行' };
  }
  return null;
}

/** 只要文案的调用方（视图层）。 */
export function journeyEligibilityBlockedReason(input: JourneyEligibilityInput): string | null {
  return journeyEligibilityBlock(input)?.message ?? null;
}

/**
 * 方向自身的限制：访道要求当前阶段仍有修为门槛且未满（否则没有修为可带回）；
 * 采集在最高阶段仍可用，只是修为收益为 0。
 */
export function journeyDirectionBlockedReason(
  direction: JourneyDirection,
  requiredCultivation: number | null,
  cultivation: number,
): string | null {
  if (direction !== 'daoSeeking') {
    return null;
  }
  if (requiredCultivation === null) {
    return '已达本版本最高阶段，无法访道（可改选采集）';
  }
  if (cultivation >= requiredCultivation) {
    return '修为已满突破门槛，请先破境再访道（或改选采集）';
  }
  return null;
}

/**
 * 便捷封装：弟子行 + 战力 → 保底奖励（调用方负责把 row 映射进来）。
 * luck / physique 必须是**出发时快照**，预览与出发要传同一份值。
 */
export function journeyBaseRewardForDisciple(
  disciple: {
    realmId: string;
    stage: number;
    aptitude: number;
    talent: string;
    attack: number;
    defense: number;
    speed: number;
    luck: number;
    physique: number;
  },
  direction: JourneyDirection,
  durationSeconds: number,
): JourneyBaseReward | null {
  return journeyBaseReward({
    direction,
    durationSeconds,
    aptitude: disciple.aptitude,
    talent: disciple.talent,
    combatPower: discipleCombatPower(
      disciple.realmId,
      disciple.stage,
      disciple.attack,
      disciple.defense,
      disciple.speed,
      disciple.talent,
    ),
    luck: disciple.luck,
    physique: disciple.physique,
  });
}

/** 弟子当前阶段的突破门槛（null = 最高阶段）；把 findStage 收在这里，少一处重复映射。 */
export function journeyThresholdOf(realmId: string, stage: number): number | null {
  return findStage(realmId, stage).requiredCultivation;
}

// ---------- 数据库 / 接口边界上的受控收窄 ----------

/** 数据库或请求里的方向字符串 → 受控联合类型（迁移的 CHECK 与 schema 已保证取值）。 */
export function asJourneyDirection(value: string): JourneyDirection {
  return isJourneyDirection(value) ? value : 'daoSeeking';
}

/**
 * 资源奖励 JSON（resourceId -> 最小单位整数）→ 字符串表；非法输入退化为空表。
 * 与 event_log.effects 的解析同一做法：脏数据不该让整个 state 读取失败。
 */
export function parseJourneyRewardResources(text: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object') {
      return {};
    }
    const resources: Record<string, string> = {};
    for (const [resourceId, amount] of Object.entries(parsed as Record<string, unknown>)) {
      resources[resourceId] = String(amount);
    }
    return resources;
  } catch {
    return {};
  }
}
