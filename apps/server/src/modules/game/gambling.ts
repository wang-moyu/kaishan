/**
 * 赌坊系统（论道赌局，第一版）——纯定义与纯计算。
 *
 * 与 alchemy.ts / challenge.ts 同一模式：规则是少量玩法常量，放在游戏模块代码里，
 * 不进 GameConfigContent，也不改公共配置哈希；赌坊面板通过登录后的 /game/sync 返回。
 *
 * 本文件只放纯定义和纯计算：不读数据库、不取时间（不调用 Date.now()）；随机只出现在两处 ——
 * 论道对手属性（Math.random，只影响本轮对手）与天机轮格局（seed 驱动的线性同余，必须可复现）。
 * 解锁判断、赌注/奖励换算、每日次数归一、幸运侦查文案都集中在这里，
 * 复用于 sync 视图、daoDebate 写路径与 allocateDaoInsight 写路径。
 *
 * 金额一律是**最小单位整数**（1 展示单位 = 1000 最小单位，前端 formatAmount 会除）；
 * 倍率只能是 1 / 2 / 3 三档（计划 3）。论道的胜负**不在这里**判定（由 service 的 jev
 * 集成 + 降级胜率决定），本文件只提供降级胜率常量。
 */

import { PILL_IDS, type PillId } from './alchemy';
import { dateKeyUtc8 } from './constants';

/** 赌坊解锁：宗门等级下限（不依赖建筑）。 */
export const GAMBLING_UNLOCK_SECT_LEVEL = 2;

/** 每日次数上限（UTC+8 自然日重置，全宗门共享计数）：论道赌局与天机轮**共享**这 20 次。 */
export const DEBATE_DAILY_LIMIT = 50;

/** 每个弟子悟道值的累计分配上限。 */
export const DAO_INSIGHT_CAP = 50;

/**
 * 属性上限：悟道值加点后任何属性都不得超过它（= 100）。
 * 直接复用仓库已有的 names.ts 常量（与 0016 迁移的 CHECK、历练的属性夹取同一口径），
 * 不在这里另造一份 100。
 */
export { ATTRIBUTE_MAX } from './names';

/** 赌注模式。 */
export type BetMode = 'preset_spirit_stone' | 'free_resource' | 'attribute';

/** 倍率（三档）。 */
export type Multiplier = 1 | 2 | 3;

/** 可赌资源白名单。 */
export const BETTABLE_RESOURCES = ['spiritStone', 'herb', 'ore'] as const;
export type BettableResource = (typeof BETTABLE_RESOURCES)[number];

/** 可赌属性白名单（同时也是悟道值可加点属性）。 */
export const BETTABLE_ATTRIBUTES = [
  'attack',
  'defense',
  'speed',
  'aptitude',
  'luck',
  'physique',
] as const;
export type BettableAttribute = (typeof BETTABLE_ATTRIBUTES)[number];

/** 属性展示名（侦查文案与结果文案共用，不在各处复制中文）。 */
export const ATTRIBUTE_LABELS: Record<BettableAttribute, string> = {
  attack: '攻击',
  defense: '防御',
  speed: '身法',
  aptitude: '资质',
  luck: '幸运',
  physique: '体魄',
};

/** 系统预设灵石赌注额（最小单位）。 */
export const PRESET_STAKES: Record<Multiplier, number> = { 1: 100000, 2: 200000, 3: 300000 };

/** 系统预设：赢的灵石奖励（最小单位）。 */
export const PRESET_RESOURCE_REWARDS: Record<Multiplier, number> = {
  1: 180000,
  2: 360000,
  3: 540000,
};

/** 系统预设：赢的悟道值奖励。 */
export const PRESET_INSIGHT_REWARDS: Record<Multiplier, number> = { 1: 1, 2: 2, 3: 3 };

/** 自由输入模式的最小赌注（最小单位 = 展示 10）。 */
export const FREE_BET_MIN = 10000;

/** 自由输入模式的赢倍率（赢得的资源 = 实际赌注 × 1.8，向下取整）。 */
export const FREE_BET_WIN_MULTIPLIER = 1.8;

/** 属性赌注：押上的属性点。 */
export const ATTRIBUTE_STAKES: Record<Multiplier, number> = { 1: 1, 2: 2, 3: 3 };

/** 属性赌注：赢的悟道值。 */
export const ATTRIBUTE_INSIGHT_REWARDS: Record<Multiplier, number> = { 1: 2, 2: 4, 3: 6 };

/**
 * 降级胜率（基点）：没有 OPENROUTER_API_KEY 或 Decisions 调用失败时使用。
 * 倍率越高押得越凶、对手越强，所以胜率越低（计划 4.4）。
 * 与 DEBATE_TIER_PROBABILITIES 的中间档对齐：50/42/34。
 */
export const DEGRADED_WIN_RATES: Record<Multiplier, number> = { 1: 5000, 2: 4200, 3: 3400 };

/**
 * 倍率对应的对手强度描述（同时进 jev 状态文本与结果文案）。
 * 计划 4.1 的 multiplierHint 原文。
 */
export const MULTIPLIER_HINTS: Record<Multiplier, string> = {
  1: '势均力敌的对手',
  2: '略强于己的对手',
  3: '远超己身的对手',
};

/** 幸运侦查阈值：>= 70 给 1 条侦查提示。 */
export const LUCK_REVEAL_THRESHOLD_1 = 70;
/** 幸运侦查阈值：>= 85 给 2 条侦查提示。 */
export const LUCK_REVEAL_THRESHOLD_2 = 85;

/** 悟道值可分配到的属性白名单（与赌注属性相同，六项）。 */
export const INSIGHT_ALLOCATABLE_ATTRIBUTES = BETTABLE_ATTRIBUTES;

/** 未解锁时的统一文案（sync 视图与 daoDebate 报错共用同一句）。 */
export const GAMBLING_LOCKED_REASON = `赌坊尚未开启，需要宗门 ${GAMBLING_UNLOCK_SECT_LEVEL} 级`;

/** 解锁判断（只在服务端实现）：宗门等级达标即解锁，不依赖任何建筑。 */
export function isGamblingUnlocked(sectLevel: number): boolean {
  return sectLevel >= GAMBLING_UNLOCK_SECT_LEVEL;
}

/** 同一判断的文案版：解锁返回 null，否则返回 GAMBLING_LOCKED_REASON。 */
export function gamblingUnlockBlockedReason(sectLevel: number): string | null {
  return isGamblingUnlocked(sectLevel) ? null : GAMBLING_LOCKED_REASON;
}

/** 可赌资源白名单收窄（请求里的 resourceId 是自由字符串，必须过这一关）。 */
export function isBettableResource(value: string): value is BettableResource {
  return (BETTABLE_RESOURCES as readonly string[]).includes(value);
}

/** 自由输入模式的实际赌注 = 输入数量 × 倍率（整数，无小数）。 */
export function freeBetStake(amount: number, multiplier: Multiplier): number {
  return amount * multiplier;
}

/**
 * 自由输入模式的赢奖励 = floor(实际赌注 × 1.8)。
 * 用 Math.floor 截断到整数最小单位（计划 14.1：资源操作一律整数）。
 */
export function freeBetReward(amount: number, multiplier: Multiplier): number {
  return Math.floor(freeBetStake(amount, multiplier) * FREE_BET_WIN_MULTIPLIER);
}

/** 侦查数量：0 / 1 / 2（纯函数，只看幸运）。 */
export function revealCount(luck: number): number {
  if (luck >= LUCK_REVEAL_THRESHOLD_2) {
    return 2;
  }
  return luck >= LUCK_REVEAL_THRESHOLD_1 ? 1 : 0;
}

/**
 * 倍率决定对手总体强度（对手六项属性之和 ≈ 弟子六项之和 × 该系数）。
 * 1x 势均力敌，2x 略强，3x 明显强但不至于碾压。
 */
export const REVEAL_OPPONENT_FACTOR: Record<Multiplier, number> = { 1: 1.00, 2: 1.12, 3: 1.25 };

/**
 * 每项属性的独立权重幅度：权重在 [1-spread, 1+spread] 间均匀随机，
 * 再归一化让六项之和精确等于目标总值。这样对手有长短板而不是均匀拉高。
 */
export const OPPONENT_WEIGHT_SPREAD = 0.40;

/**
 * 生成对手六项属性（纯展示 + 送入 jev）。
 *
 * 1. 先给每项一个 [1-spread, 1+spread] 的随机权重；
 * 2. 算目标总值 = 弟子六项之和 × 倍率系数；
 * 3. 把权重归一化使 Σ(弟子[i] × w[i]) = 目标总值；
 * 4. 对手[i] = round(弟子[i] × w[i])，保底 1，不封顶（弟子封 100 但对手不必）。
 */
export function generateOpponentAttrs(
  discipleAttrs: Record<BettableAttribute, number>,
  multiplier: Multiplier,
): Record<BettableAttribute, number> {
  const factor = REVEAL_OPPONENT_FACTOR[multiplier];
  const spread = OPPONENT_WEIGHT_SPREAD;

  const rawWeights: number[] = [];
  for (let i = 0; i < BETTABLE_ATTRIBUTES.length; i++) {
    rawWeights.push(1 - spread + Math.random() * 2 * spread);
  }

  let discipleTotal = 0;
  let weightedTotal = 0;
  for (let i = 0; i < BETTABLE_ATTRIBUTES.length; i++) {
    const v = Number(discipleAttrs[BETTABLE_ATTRIBUTES[i]!]) || 0;
    discipleTotal += v;
    weightedTotal += v * rawWeights[i]!;
  }

  const targetTotal = discipleTotal * factor;
  const scale = weightedTotal > 0 ? targetTotal / weightedTotal : 1;

  const result = {} as Record<BettableAttribute, number>;
  for (let i = 0; i < BETTABLE_ATTRIBUTES.length; i++) {
    const attr = BETTABLE_ATTRIBUTES[i]!;
    const v = Number(discipleAttrs[attr]) || 0;
    result[attr] = Math.max(1, Math.round(v * rawWeights[i]! * scale));
  }
  return result;
}

/** 侦查结论阈值（弟子值 / 对手基准值）；从高到低判定。 */
const REVEAL_VERDICTS: readonly { min: number; text: string }[] = [
  { min: 1.2, text: '远不如你' },
  { min: 1.02, text: '略逊于你' },
  { min: 0.98, text: '与你相当' },
  { min: 0.8, text: '略强于你' },
  { min: 0, text: '远超你' },
];

/**
 * 生成侦查文案（纯函数，计划 4.5）。
 *
 * - 数量由幸运决定（revealCount）；幸运不足时不返回任何提示；
 * - **不调用 jev、不影响胜负**：文案只按「弟子属性 + 倍率」确定性生成，
 *   本轮看哪几项由 `倍率 + luck / 20` 的偏移决定（同一弟子同一倍率结果稳定，
 *   不同弟子/不同倍率看到的项不同），对手基准 = 弟子该项属性 × 倍率系数。
 */
export function generateRevealHints(
  discipleAttrs: Record<BettableAttribute, number>,
  multiplier: Multiplier,
  luck: number,
): string[] {
  const count = revealCount(luck);
  if (count === 0) {
    return [];
  }
  const offset = (multiplier - 1 + Math.floor(luck / 20)) % BETTABLE_ATTRIBUTES.length;
  const hints: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const attribute =
      BETTABLE_ATTRIBUTES[(offset + index) % BETTABLE_ATTRIBUTES.length] ?? 'attack';
    const mine = Number(discipleAttrs[attribute]) || 0;
    const opponent = mine * REVEAL_OPPONENT_FACTOR[multiplier];
    const ratio = opponent > 0 ? mine / opponent : 1;
    const verdict =
      REVEAL_VERDICTS.find((item) => ratio >= item.min)?.text ?? '远超你';
    hints.push(`对手${ATTRIBUTE_LABELS[attribute]}${verdict}`);
  }
  return hints;
}

/** 论道计数的最小行形状（sects 行的 debate_* 两列）。 */
export interface DebateDayCountRow {
  debate_date_key: string;
  debate_count: number;
}

/** 论道当日次数状态（与 challenge.ts 的 ChallengeDayState 同一模式）。 */
export interface DebateDayState {
  /** 本次请求的 UTC+8 日期键。 */
  dateKey: string;
  /** 归一化后的当日已受理次数（0..DEBATE_DAILY_LIMIT）。 */
  usedToday: number;
  /** 当日剩余次数 = max(0, 上限 - usedToday)。 */
  remaining: number;
  /** 宗门行的日期键是否就是今天；false 时 usedToday 视为 0（跨天重置）。 */
  keyMatches: boolean;
}

/**
 * 宗门行口径的当日已用次数：日期键与今天一致取 debate_count，否则视为 0（跨天重置）。
 * 与挑战不同，赌坊是 0019 新表新列，不存在需要按日志窗口兼容核对的旧记录。
 */
export function debateDayStateOf(sect: DebateDayCountRow, now: number): DebateDayState {
  const dateKey = dateKeyUtc8(now);
  const keyMatches = sect.debate_date_key === dateKey;
  const raw = keyMatches ? Number(sect.debate_count) : 0;
  const usedToday = Math.min(DEBATE_DAILY_LIMIT, Math.max(0, raw));
  return {
    dateKey,
    usedToday,
    remaining: Math.max(0, DEBATE_DAILY_LIMIT - usedToday),
    keyMatches,
  };
}

/* ---------- 五档胜率（choice 题型 → 概率映射） ---------- */

/** jev choice 题的五个档位 key（从弟子优势到对手优势）。 */
export const DEBATE_TIER_KEYS = [
  'disciple_clear',
  'disciple_slight',
  'even',
  'opponent_slight',
  'opponent_clear',
] as const;
export type DebateTier = (typeof DEBATE_TIER_KEYS)[number];

/** 每个档位对应的固定胜率。 */
export const DEBATE_TIER_PROBABILITIES: Record<DebateTier, number> = {
  disciple_clear: 0.65,
  disciple_slight: 0.55,
  even: 0.50,
  opponent_slight: 0.42,
  opponent_clear: 0.34,
};

/** 倍率锚：防止模型把不同倍率都判成同一档导致梯度丢失。 */
export const DEBATE_TIER_ANCHOR: Record<Multiplier, number> = { 1: 0.50, 2: 0.42, 3: 0.34 };
export const DEBATE_TIER_ANCHOR_RANGE = 0.06;

/**
 * 根据 jev 返回的 choice probabilities 加权计算胜率，再用倍率锚 clamp。
 *
 * p = Σ(档位概率 × 模型给的档位权重)，归一化后 clamp 到 [anchor - range, anchor + range]。
 * 返回 null 表示输入无效（触发降级）。
 */
export function debateTierProbability(
  probabilities: Record<string, number> | undefined,
  multiplier: Multiplier,
): number | null {
  if (probabilities === undefined) return null;

  let weightedSum = 0;
  let totalWeight = 0;
  for (const tier of DEBATE_TIER_KEYS) {
    const w = Number(probabilities[tier]);
    if (!Number.isFinite(w) || w < 0) continue;
    weightedSum += DEBATE_TIER_PROBABILITIES[tier] * w;
    totalWeight += w;
  }
  if (totalWeight <= 0) return null;

  const raw = weightedSum / totalWeight;
  const anchor = DEBATE_TIER_ANCHOR[multiplier];
  const lo = anchor - DEBATE_TIER_ANCHOR_RANGE;
  const hi = anchor + DEBATE_TIER_ANCHOR_RANGE;
  return Math.min(hi, Math.max(lo, raw));
}

/* ---------- 天机轮（0020 迁移 + 计划 2）：8 格转盘 ---------- */

/** 转盘格数（8 等分，每格 45°）。 */
export const WHEEL_SLOT_COUNT = 8;

/** 投入档位（1x~5x）；费用 = WHEEL_SPIN_COST × 档位。 */
export const WHEEL_TIERS = [1, 2, 3, 4, 5] as const;
export type WheelTier = (typeof WHEEL_TIERS)[number];

/** 1x 档费用（最小单位 = 展示 50）。 */
export const WHEEL_SPIN_COST = 50_000;

/** 重置费用（最小单位 = 展示 100）；重置不消耗每日次数，也不限次数。 */
export const WHEEL_RESET_COST = 100_000;

/** 格子倍率范围（含两端，一位小数）。 */
export const WHEEL_MULTIPLIER_MIN = 0.8;
export const WHEEL_MULTIPLIER_MAX = 1.5;

/** 大额灵石格的额外倍率：奖励 = 投入 × 格子倍率 × 3。 */
export const WHEEL_BIG_MULTIPLIER = 3;

/** 草药/矿石格的换算系数：1 灵石 = 2 草药/矿石（游戏经济锚定）。 */
export const WHEEL_MATERIAL_RATIO = 2;

/** 各格子类型的落格权重：大奖概率低、谢谢惠顾概率偏高、普通格居中。 */
export const WHEEL_SLOT_WEIGHTS: Record<WheelSlotType, number> = {
  big_spirit_stone: 1,
  spirit_stone: 2,
  herb: 2,
  ore: 2,
  pill: 2,
  nothing: 3,
};

/** 根据格子列表的类型权重做加权随机选格，返回命中的下标。 */
export function wheelWeightedPick(slots: readonly WheelSlot[], roll: number): number {
  let total = 0;
  for (const slot of slots) total += WHEEL_SLOT_WEIGHTS[slot.type];
  const target = roll * total;
  let acc = 0;
  for (let i = 0; i < slots.length; i++) {
    acc += WHEEL_SLOT_WEIGHTS[slots[i]!.type];
    if (target < acc) return i;
  }
  return slots.length - 1;
}

/** 大额灵石固定 1 格。 */
export const WHEEL_BIG_SLOTS = 1;
/** 谢谢惠顾固定 2 格。 */
export const WHEEL_NOTHING_SLOTS = 2;
/** 小额灵石的随机格数；剩下的 1~3 格给草药/矿石/丹药。 */
export const WHEEL_SMALL_SLOTS_MIN = 2;
export const WHEEL_SMALL_SLOTS_MAX = 4;

/** 特殊格（草药 / 矿石 / 丹药）的候选类型：每种最多出现 1 格。 */
const WHEEL_SPECIAL_TYPES = ['herb', 'ore', 'pill'] as const;

/** 格子类型（与计划 4.1 的 view 口径一致）。 */
export type WheelSlotType =
  | 'spirit_stone'
  | 'big_spirit_stone'
  | 'herb'
  | 'ore'
  | 'pill'
  | 'nothing';

/** 一个转盘格：类型 + 倍率 + 丹药（格局由 seed 确定性生成）。 */
export interface WheelSlot {
  type: WheelSlotType;
  /**
   * 格子倍率（0.8~1.5，一位小数）；谢谢惠顾为 0。
   * 丹药格也带倍率（格局只由 seed 决定，同一 seed 每次一样），但**不参与奖励计算**：
   * 丹药数量只跟投入档位走（计划 2.6）。
   */
  multiplier: number;
  /** 丹药格命中的丹药 id（同样由 seed 决定，所以格面文案稳定）；非丹药格为 null。 */
  pillId: PillId | null;
}

/** 转盘奖励（写入 dao_debate_log.reward_detail，口径见计划 3.2）。 */
export type WheelRewardDetail =
  | { type: 'resource'; resourceId: string; amount: string }
  | { type: 'pill'; pillId: string; quantity: number }
  | { type: 'none' };

/** 某一档的转动费用（最小单位）= 1x 费用 × 档位。 */
export function wheelSpinCost(tier: WheelTier): number {
  return WHEEL_SPIN_COST * tier;
}

/**
 * 32 位无符号线性同余伪随机（Numerical Recipes 系数）。
 * 全程整数运算（Math.imul）→ 跨平台一致，同一个 seed 永远给出同一串数。
 * 这里刻意**不用** Math.random：格局必须可复现（计划 6.1）。
 */
function wheelRandomOf(seed: number): () => number {
  let state = Math.floor(seed) >>> 0;
  if (state === 0) {
    // seed 0（新宗门）也必须有一个有效状态，否则整串随机数恒为 0。
    state = 0x9e3779b9;
  }
  const nextState = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
  // 暖机两次再开始取值：LCG 的头两个输出与 seed 的高位强相关（小 seed 时连乘都没进位，
  // 第一个取值会稳定落在同一个区间）。生产路径的 seed 是 wheelLayoutSeed 的大整数混合结果，
  // 本来就不会踩到这一点；暖机是为了让 generateWheelSlots 对任意 seed（含单测里 0~N 的小整数）
  // 都给出打散的格局。
  nextState();
  nextState();
  return () => nextState() / 4_294_967_296;
}

/** 闭区间 [min, max] 的确定性整数（random() 恒 < 1，所以不会溢出上界）。 */
function wheelInt(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

/** 确定性 Fisher–Yates 洗牌（用自己那串随机数，不动全局 Math.random）。 */
function wheelShuffle<T>(random: () => number, items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = wheelInt(random, 0, i);
    const swap = result[i]!;
    result[i] = result[j]!;
    result[j] = swap;
  }
  return result;
}

/**
 * 转盘格局种子 = 宗门 id × wheel_seed × 日期键 的混合（纯函数）。
 *
 * 每天日期键变化 → 格局自动刷新；同一天内手动重置（wheel_seed +1）也会刷新。
 * 同一 (sect_id, wheel_seed, dateKey) 永远一致。
 */
export function wheelLayoutSeed(sectId: string, wheelSeed: number, dateKey: string): number {
  let hash = 2166136261;
  for (let i = 0; i < sectId.length; i += 1) {
    hash = Math.imul(hash ^ sectId.charCodeAt(i), 16777619);
  }
  for (let i = 0; i < dateKey.length; i += 1) {
    hash = Math.imul(hash ^ dateKey.charCodeAt(i), 16777619);
  }
  const seed = (Number.isFinite(wheelSeed) ? Math.floor(wheelSeed) : 0) >>> 0;
  return (hash ^ Math.imul(seed + 1, 2654435761)) >>> 0;
}

/**
 * 生成 8 格转盘格局（**确定性纯函数**：同一个 seed 永远同一布局，计划 2.1）。
 *
 * 固定：大额灵石 1 格 + 谢谢惠顾 2 格；随机：小额灵石 2~4 格，
 * 剩下的 1~3 格从草药 / 矿石 / 丹药里取（每种最多 1 格）。
 * 格子排布、每格倍率与丹药种类全部由 seed 决定，所以重启、换设备都不会让转盘变样。
 */
export function generateWheelSlots(seed: number): WheelSlot[] {
  const random = wheelRandomOf(seed);

  const smallCount = wheelInt(random, WHEEL_SMALL_SLOTS_MIN, WHEEL_SMALL_SLOTS_MAX);
  const specialCount = WHEEL_SLOT_COUNT - WHEEL_BIG_SLOTS - WHEEL_NOTHING_SLOTS - smallCount;
  const specials = wheelShuffle(random, WHEEL_SPECIAL_TYPES).slice(0, specialCount);

  // 固定格 + 随机格一共正好 8 格（2~4 格小额时剩余 1~3 格特殊格）。
  const types: WheelSlotType[] = [
    'big_spirit_stone',
    ...Array<WheelSlotType>(WHEEL_NOTHING_SLOTS).fill('nothing'),
    ...Array<WheelSlotType>(smallCount).fill('spirit_stone'),
    ...specials,
  ];

  return wheelShuffle(random, types).map((type) => {
    if (type === 'nothing') {
      return { type, multiplier: 0, pillId: null };
    }
    // 倍率只取一位小数：0.8 / 0.9 / … / 1.5（8 档均匀取）。
    const multiplier =
      (WHEEL_MULTIPLIER_MIN * 10 +
        wheelInt(random, 0, Math.round((WHEEL_MULTIPLIER_MAX - WHEEL_MULTIPLIER_MIN) * 10))) /
      10;
    if (type === 'pill') {
      return {
        type,
        multiplier,
        pillId: PILL_IDS[wheelInt(random, 0, PILL_IDS.length - 1)] ?? null,
      };
    }
    return { type, multiplier, pillId: null };
  });
}

/**
 * 格面文案（计划 4.1 的 label）：服务端拼好，前端只渲染。
 *
 * 资源名与丹药名由调用方传进来 —— 唯一一份中文名词表在配置与 alchemy.ts，
 * 这里不复制第二份。大额灵石显示的是**实际结算倍率**（格子倍率 × 3），
 * 玩家一眼就能看出这格更肥；丹药格显示数量随档位走（×1~5）。
 */
export function wheelSlotLabel(
  slot: WheelSlot,
  names: { resource: (resourceId: string) => string; pill: (pillId: string) => string },
): string {
  switch (slot.type) {
    case 'nothing':
      return '谢谢惠顾';
    case 'pill':
      return slot.pillId === null ? '丹药' : `${names.pill(slot.pillId)} ×1~${String(WHEEL_TIERS.length)}`;
    case 'big_spirit_stone':
      return `${names.resource('spiritStone')} ×${(slot.multiplier * WHEEL_BIG_MULTIPLIER).toFixed(1)}`;
    case 'herb':
    case 'ore':
      return `${names.resource(slot.type)} ×${slot.multiplier.toFixed(1)}`;
    default:
      return `${names.resource('spiritStone')} ×${slot.multiplier.toFixed(1)}`;
  }
}

/**
 * 结算一格奖励（纯函数，计划 2.6）。
 *
 * 金额一律是**最小单位整数**：资源类 = floor(投入 × 格子倍率)，大额灵石再 ×3，
 * 草药/矿石再 × WHEEL_MATERIAL_RATIO（1 灵石换 2 材料）；
 * 丹药 = 投入档位颗数（1x→1 颗 … 5x→5 颗），**不受格子倍率影响**；谢谢惠顾 = 无奖励。
 */
export function wheelReward(slot: WheelSlot, tier: WheelTier, cost: number): WheelRewardDetail {
  if (slot.type === 'nothing') {
    return { type: 'none' };
  }
  if (slot.type === 'pill') {
    return slot.pillId === null
      ? { type: 'none' }
      : { type: 'pill', pillId: slot.pillId, quantity: tier };
  }
  let multiplier = slot.multiplier;
  if (slot.type === 'big_spirit_stone') multiplier *= WHEEL_BIG_MULTIPLIER;
  if (slot.type === 'herb' || slot.type === 'ore') multiplier *= WHEEL_MATERIAL_RATIO;
  return {
    type: 'resource',
    resourceId: slot.type === 'herb' || slot.type === 'ore' ? slot.type : 'spiritStone',
    amount: String(Math.floor(cost * multiplier + 1e-6)),
  };
}

/* ---------- 灵兽竞逐（0024 迁移 + docs/灵兽竞逐开发计划.md） ---------- */

/** 每轮固定 5 只灵兽。 */
export const RACE_BEAST_COUNT = 5;

/** 灵兽名（修仙风格）。 */
export const BEAST_NAMES = ['麒麟', '玄龟', '朱雀', '白虎', '青龙'] as const;

/** 庄家抽水率（互赌/parimutuel：净池 = 总池 × (1 − HOUSE_EDGE)）。 */
export const RACE_HOUSE_EDGE = 0.1;


/** 实力权重范围（整数，含端点）；权重之和决定胜率。 */
export const RACE_WEIGHT_MIN = 1;
export const RACE_WEIGHT_MAX = 10;

/** 赌注范围（灵石最小单位；1 展示单位 = 1000 最小单位）：即展示 10 ~ 500。 */
export const RACE_BET_MIN = 10_000;
export const RACE_BET_MAX = 500_000;

/** 大奖广播阈值：实际倍率 ≥ 此值且中奖 → 全服聊天广播。 */
export const RACE_BROADCAST_PAYOUT_THRESHOLD = 5.0;

/** 跑马动画步数：前端 8 步 × ~440ms ≈ 3.5 秒。 */
export const RACE_STEP_COUNT = 8;

/** 名次每落后一名，终点进度少 0.06：冠军 1.00、末位 0.76。 */
export const RACE_RANK_GAP = 0.06;

/** 中间步的最大抖动幅度（随进度收窄，最后一步恒为 0）。 */
const RACE_STEP_JITTER = 0.12;

/** 灵兽竞逐记录里的 disciple_name（与天机轮写 '天机轮' 同一模式）。 */
export const RACE_LOG_NAME = '灵兽竞逐';

/** 轮次时长（毫秒）：10 分钟。 */
export const RACE_ROUND_MS = 10 * 60 * 1000;

/** 投注阶段时长（毫秒）：前 8 分钟。 */
export const RACE_BETTING_MS = 8 * 60 * 1000;

/** 轮次相对整 10 分钟的偏移：x2 开始投注、x0 整点封盘开跑（Cron 同时结算），结算后留 2 分钟看动画与结果。 */
export const RACE_ROUND_OFFSET_MS = 2 * 60 * 1000;

/** 当前轮次的开始时间戳（UTC+8 按 10 分钟对齐后再后移 2 分钟）。 */
export function raceRoundStartOf(now: number): number {
  const shifted = now + 8 * 3_600_000 - RACE_ROUND_OFFSET_MS;
  return Math.floor(shifted / RACE_ROUND_MS) * RACE_ROUND_MS + RACE_ROUND_OFFSET_MS - 8 * 3_600_000;
}

/** 运营时段（UTC+8 小时）。 */
export const RACE_OPERATE_START_HOUR = 8;
export const RACE_OPERATE_END_HOUR = 23;

/** 竞逐阶段。 */
export type RacePhase = 'betting' | 'sealed' | 'closed';

export interface RacePhaseInfo {
  phase: RacePhase;
  roundKey: string;
  /** 距下一阶段切换的剩余毫秒。 */
  remainingMs: number;
}

/** 从时间戳计算当前轮次的 round_key（UTC+8 对齐到 10 分钟）。 */
export function raceRoundKeyOf(now: number): string {
  const d = new Date(raceRoundStartOf(now));
  const yyyy = String(d.getUTCFullYear());
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

/** 判断给定时间戳所在轮次是否在运营时段内（按轮次开始时间算：首轮 08:02 开始，末轮 22:52 开始、23:00 开跑）。 */
export function isRaceOperatingHour(now: number): boolean {
  const utc8Hour = new Date(raceRoundStartOf(now) + 8 * 3_600_000).getUTCHours();
  return utc8Hour >= RACE_OPERATE_START_HOUR && utc8Hour < RACE_OPERATE_END_HOUR;
}

/** 计算当前阶段与倒计时。 */
export function racePhaseOf(now: number): RacePhaseInfo {
  const roundKey = raceRoundKeyOf(now);
  if (!isRaceOperatingHour(now)) {
    const utc8 = now + 8 * 3_600_000;
    const todayStart = new Date(utc8);
    todayStart.setUTCHours(RACE_OPERATE_START_HOUR, 0, 0, 0);
    let nextOpen = todayStart.getTime() - 8 * 3_600_000 + RACE_ROUND_OFFSET_MS;
    if (nextOpen <= now) nextOpen += 24 * 3_600_000;
    return { phase: 'closed', roundKey, remainingMs: nextOpen - now };
  }

  const roundStart = raceRoundStartOf(now);
  const elapsed = now - roundStart;
  if (elapsed < RACE_BETTING_MS) {
    return { phase: 'betting', roundKey, remainingMs: RACE_BETTING_MS - elapsed };
  }
  return { phase: 'sealed', roundKey, remainingMs: RACE_ROUND_MS - elapsed };
}

/** 从 round_key 确定性生成 5 只灵兽的权重（简单字符哈希 → 伪随机）。 */
export function beastWeightsFromRoundKey(roundKey: string): number[] {
  let hash = 0;
  for (let i = 0; i < roundKey.length; i += 1) {
    hash = ((hash << 5) - hash + roundKey.charCodeAt(i)) | 0;
  }
  const weights: number[] = [];
  for (let i = 0; i < RACE_BEAST_COUNT; i += 1) {
    hash = ((hash * 1103515245 + 12345) & 0x7fffffff) | 0;
    weights.push(RACE_WEIGHT_MIN + ((hash >>> 16) % (RACE_WEIGHT_MAX - RACE_WEIGHT_MIN + 1)));
  }
  return weights;
}

/** 灵兽名（index 必在 0~4）。 */
export function beastNameAt(index: number): string {
  return BEAST_NAMES[index] ?? `第${String(index + 1)}号灵兽`;
}

/** 纯互赌倍率（保留用于旧赛马记录展示）。 */
export function parimutuelOdds(totalPool: number, beastPool: number): number {
  if (beastPool <= 0 || totalPool <= 0) return 0;
  const netPool = totalPool * (1 - RACE_HOUSE_EDGE);
  return Math.round((netPool / beastPool) * 10) / 10;
}

/** 固定赔率：根据权重一次算定，整轮不变。 */
export function raceFixedOdds(weight: number, totalWeight: number): number {
  if (weight <= 0 || totalWeight <= 0) return 0;
  return Math.round((totalWeight * (1 - RACE_HOUSE_EDGE)) / weight * 10) / 10;
}

/** 按权重加权随机选一个下标（roll ∈ [0, 1)）。 */
export function raceWeightedPick(weights: readonly number[], roll: number): number {
  let total = 0;
  for (const weight of weights) total += weight;
  const target = roll * total;
  let acc = 0;
  for (let index = 0; index < weights.length; index += 1) {
    acc += weights[index]!;
    if (target < acc) return index;
  }
  return weights.length - 1;
}

/** 名次（纯函数）：冠军固定第 1，其余按权重降序。 */
export function raceRanksOf(
  weights: readonly number[],
  winnerIndex: number,
  random: () => number = Math.random,
): number[] {
  const ranks = new Array<number>(weights.length).fill(weights.length);
  ranks[winnerIndex] = 1;
  // 冠军之外的名次同样按权重不放回抽取：热门更可能靠前，但不固定第二。
  const rest = weights
    .map((weight, index) => ({ weight, index }))
    .filter((item) => item.index !== winnerIndex);
  for (let place = 2; rest.length > 0; place += 1) {
    const picked = raceWeightedPick(rest.map((item) => item.weight), random());
    ranks[rest[picked]!.index] = place;
    rest.splice(picked, 1);
  }
  return ranks;
}

/** 名次随机源：由 round_key 确定性生成，所有人、每次请求看到的名次都一致（名次不落库）。 */
export function raceRankRandomOf(roundKey: string): () => number {
  const key = `${roundKey}:ranks`;
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  return wheelRandomOf(hash);
}

/** 跑马动画序列（纯函数）。 */
export function generateRaceSteps(
  ranks: readonly number[],
  random: () => number = Math.random,
): number[][] {
  return ranks.map((rank) => {
    const target = Math.max(0, 1 - (rank - 1) * RACE_RANK_GAP);
    const series: number[] = [];
    for (let step = 1; step <= RACE_STEP_COUNT; step += 1) {
      if (step === RACE_STEP_COUNT) {
        series.push(target);
        continue;
      }
      const progress = step / RACE_STEP_COUNT;
      const noise = (random() - 0.5) * RACE_STEP_JITTER * (1 - progress);
      series.push(Math.min(1, Math.max(0, progress * target + noise)));
    }
    return series;
  });
}
