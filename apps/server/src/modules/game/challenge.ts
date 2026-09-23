import { DEFENSE_LINEUP_SIZE, dateKeyUtc8 } from './constants';

/**
 * 宗门挑战优化（0012 迁移）——不访问数据库的纯定义与纯计算。
 *
 * 与 alchemy.ts 同理：奖励档位、每日限次常量、守擂阵容解析都在这里集中定义，
 * 是 service / view / 文案共用的**单一事实来源**；改奖励只改这一张表。
 * 本文件不调用 Date.now()、不读库；需要「今天」的调用方传入 now 或 dateKeyUtc8 结果。
 */

/** 每个 UTC+8 自然日可主动挑战次数（只要真正受理一场战斗就消耗，失败/零奖励也消耗）。 */
export const CHALLENGE_DAILY_LIMIT = 3;

/** 守擂方式：有效手动阵容 / 临时自动守擂。 */
export type DefenseMode = 'configured' | 'automatic';

/**
 * 奖励档位稳定标识（写入 challenge_log.reward_tier 后不改名）。
 * 中文标签只用于展示，可单独调整。
 */
export type RewardTier =
  | 'lower_3_plus_no_reward'
  | 'lower_2'
  | 'lower_1'
  | 'equal'
  | 'higher_1'
  | 'higher_2'
  | 'higher_3_plus';

export interface RewardTierDef {
  tier: RewardTier;
  /** 展示用中文标签。 */
  label: string;
  /** 胜利时获得的声望。 */
  reputation: number;
  /** 胜利时获得的灵石（最小单位存储值）。 */
  spiritStone: number;
}

/**
 * 胜利奖励档位表（计划 3.2 的唯一事实来源；`levelDifference = 守方等级 - 攻方等级`）：
 *
 * | 等级差    | 声望 | 灵石（最小单位） |
 * | <= -3    |   0  |      0          |
 * | -2       |   5  |  50000          |
 * | -1       |   8  |  75000          |
 * | 0        |  10  | 100000          |
 * | +1       |  13  | 125000          |
 * | +2       |  15  | 150000          |
 * | >= +3    |  20  | 200000          |
 *
 * 失败始终 0/0；`>= +3` 封顶；`<= -3` 可挑战但胜利无奖励。
 */
export const REWARD_TIERS: readonly RewardTierDef[] = [
  { tier: 'lower_3_plus_no_reward', label: '跨级挑战（无奖励）', reputation: 0, spiritStone: 0 },
  { tier: 'lower_2', label: '跨级挑战', reputation: 5, spiritStone: 50_000 },
  { tier: 'lower_1', label: '越级挑战', reputation: 8, spiritStone: 75_000 },
  { tier: 'equal', label: '同级切磋', reputation: 10, spiritStone: 100_000 },
  { tier: 'higher_1', label: '以下克上', reputation: 13, spiritStone: 125_000 },
  { tier: 'higher_2', label: '以下克上', reputation: 15, spiritStone: 150_000 },
  { tier: 'higher_3_plus', label: '以下克上', reputation: 20, spiritStone: 200_000 },
];

/** 按等级差取奖励档位；超出表范围的低/高都收敛到两个端点档位。 */
export function rewardTierForLevelDifference(levelDifference: number): RewardTierDef {
  if (levelDifference <= -3) {
    return REWARD_TIERS[0]!;
  }
  if (levelDifference >= 3) {
    return REWARD_TIERS[6]!;
  }
  // -2..2 与表下标 1..5 一一对应（lower_2 / lower_1 / equal / higher_1 / higher_2）。
  return REWARD_TIERS[levelDifference + 3]!;
}

/** 胜利时的实际奖励；失败的声望/灵石始终为 0（见计划 3.2 补充规则）。 */
export function rewardForOutcome(
  outcome: 'win' | 'lose',
  levelDifference: number,
): { tier: RewardTier; reputation: number; spiritStone: number } {
  if (outcome !== 'win') {
    return { tier: rewardTierForLevelDifference(levelDifference).tier, reputation: 0, spiritStone: 0 };
  }
  const def = rewardTierForLevelDifference(levelDifference);
  return { tier: def.tier, reputation: def.reputation, spiritStone: def.spiritStone };
}

/* ---------- 每日计数口径（计划 4.2） ---------- */

/** 宗门行里与每日计数相关的字段（只取需要的部分，便于纯函数测试）。 */
export interface ChallengeDayCountRow {
  challenge_date_key: string;
  challenge_count: number;
}

export interface ChallengeDayState {
  /** 本次请求的 UTC+8 日期键。 */
  dateKey: string;
  /** 归一化后的当日已受理场次（0..3，数据异常不产生负数/超限展示）。 */
  usedToday: number;
  /** 当日剩余场次 = max(0, 3 - usedToday)。 */
  remaining: number;
  /** 宗门行的日期键是否就是今天；false 时 usedToday 来自日志兼容核对（见 service）。 */
  keyMatches: boolean;
}

/**
 * 宗门行口径的当日已用次数：日期键与今天一致取 challenge_count，不一致视为 0。
 * （发布当天的兼容核对在 service 层叠加 challenge_log 的 created_at 日窗口查询。）
 */
export function challengeUsedFromRow(sect: ChallengeDayCountRow, now: number): number {
  if (sect.challenge_date_key !== dateKeyUtc8(now)) {
    return 0;
  }
  return Math.min(CHALLENGE_DAILY_LIMIT, Math.max(0, Number(sect.challenge_count)));
}

/** 把 usedToday 装配成完整日状态（clamp 到 0..3，remaining 不为负）。 */
export function challengeDayStateOf(
  sect: ChallengeDayCountRow,
  now: number,
  /** 日期键不一致时由调用方传入日志兼容核对结果（默认 0）。 */
  legacyUsedToday = 0,
): ChallengeDayState {
  const dateKey = dateKeyUtc8(now);
  const keyMatches = sect.challenge_date_key === dateKey;
  const raw = keyMatches ? Number(sect.challenge_count) : legacyUsedToday;
  const usedToday = Math.min(CHALLENGE_DAILY_LIMIT, Math.max(0, raw));
  return { dateKey, usedToday, remaining: Math.max(0, CHALLENGE_DAILY_LIMIT - usedToday), keyMatches };
}

/* ---------- 守擂阵容（计划 3.3） ---------- */

/**
 * 守方阵容方案（按 mode 可辨识，便于调用方收窄）：
 * - `configured`：恰好 3 个不重复且仍属于守方的弟子 id，保留玩家设置的顺序；
 * - `automatic`：没有有效手动阵容，但当前弟子 >= 3，可以临时随机守擂；
 * - 弟子不足 3 名时不能被挑战（调用方拒绝且不消耗攻方次数）。
 */
export type DefenseLineupPlan =
  | { canDefend: true; mode: 'configured'; manualIds: string[] }
  | { canDefend: true; mode: 'automatic'; manualIds: null }
  | { canDefend: false };

/**
 * 解析守方阵容 JSON 与当前弟子的关系：
 * 手动阵容里出现重复、失效或非本宗弟子时整体视为无效，弟子足够则回退自动守擂，
 * 不再用「已离宗 / 0 战力」占位（计划 3.3 第 6 条）。
 */
export function planDefenseLineup(
  lineupJson: string | null,
  disciples: readonly { id: string }[],
): DefenseLineupPlan {
  const manualIds = parseManualLineupIds(lineupJson);
  if (manualIds !== null) {
    const ownIds = new Set(disciples.map((disciple) => disciple.id));
    const allPresent = manualIds.every((id) => ownIds.has(id));
    if (allPresent) {
      return { canDefend: true, mode: 'configured', manualIds };
    }
  }
  if (disciples.length >= DEFENSE_LINEUP_SIZE) {
    return { canDefend: true, mode: 'automatic', manualIds: null };
  }
  return { canDefend: false };
}

/** 阵容 JSON → 恰好 3 个不重复弟子 id；null / 非法 JSON / 长度或重复问题都返回 null。 */
function parseManualLineupIds(lineupJson: string | null): string[] | null {
  if (lineupJson === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(lineupJson);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) {
    return null;
  }
  if (parsed.length !== DEFENSE_LINEUP_SIZE) {
    return null;
  }
  const ids: string[] = [];
  for (const item of parsed) {
    if (typeof item !== 'string') {
      return null;
    }
    ids.push(item);
  }
  if (new Set(ids).size !== ids.length) {
    return null;
  }
  return ids;
}

/**
 * 手动守擂阵容 JSON 里是否包含某名弟子（驱逐时的「是否需要清空阵容」判断）。
 *
 * JSON 非法 / 不是数组时视为不包含：这种阵容本来就会被 planDefenseLineup 判为无效并回退
 * 自动守擂，不构成有效配置，驱逐时无需改写它。
 */
export function lineupContainsDisciple(lineupJson: string | null, discipleId: string): boolean {
  if (lineupJson === null) {
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(lineupJson);
  } catch {
    return false;
  }
  if (!Array.isArray(parsed)) {
    return false;
  }
  return (parsed as unknown[]).some((item) => item === discipleId);
}

/**
 * 不改写原数组的 Fisher-Yates 洗牌 + 取前 count 个：
 * 自动守擂「等概率、不重复抽 3 名并随机排序」用同一个函数完成；
 * `random` 可注入以便测试（生产用默认 Math.random）。
 */
export function shufflePick<T>(
  items: readonly T[],
  count: number,
  random: () => number = Math.random,
): T[] {
  const pool = [...items];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const temp = pool[index]!;
    pool[index] = pool[swapIndex]!;
    pool[swapIndex] = temp;
  }
  return pool.slice(0, Math.max(0, count));
}

/* ---------- 日志快照的安全读取（历史/脏数据兼容） ---------- */

const REWARD_TIER_IDS: readonly string[] = REWARD_TIERS.map((tier) => tier.tier);

/** 挑战日志里的档位标识 → RewardTier；旧记录（null）与脏数据返回 null，不伪造档位。 */
export function asRewardTier(value: string | null): RewardTier | null {
  return value !== null && (REWARD_TIER_IDS as readonly string[]).includes(value)
    ? (value as RewardTier)
    : null;
}

/** 挑战日志里的守擂方式 → DefenseMode；旧记录（null）与脏数据返回 null。 */
export function asDefenseMode(value: string | null): DefenseMode | null {
  return value === 'configured' || value === 'automatic' ? value : null;
}

/**
 * 0014 弟子历练：自动守擂的候选池 = 当前**不在外**的弟子。
 *
 * 手动阵容成员不可能在外（出发前就要求不在阵容里），所以把过滤后的列表交给
 * planDefenseLineup 就够：一旦真有人在外，手动阵容会被判为无效并回退自动守擂，
 * 自动守擂也不会抽到在外弟子。名单无人过滤时返回原列表，行为与 0014 之前一致。
 */
export function availableDefenders<T extends { id: string }>(
  disciples: readonly T[],
  awayIds: ReadonlySet<string>,
): T[] {
  return awayIds.size === 0
    ? [...disciples]
    : disciples.filter((disciple) => !awayIds.has(disciple.id));
}
