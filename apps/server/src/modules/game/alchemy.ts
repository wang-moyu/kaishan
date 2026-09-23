/**
 * 丹药系统（v1 可玩闭环）——纯定义与纯计算。
 *
 * 与 events.ts / realms.ts 的特定玩法定义同理：配方是少量功能规则，放在游戏模块代码里，
 * 不进 GameConfigContent，也不改公共配置哈希。丹药视图通过登录后的 /game/sync 返回。
 *
 * 本文件只放纯定义和纯计算：不读数据库、不取时间（不调用 Date.now()）、不用随机数。
 * 解锁判断、短板选择等服务端规则都集中在这里，复用于 sync 视图与 craft/use 写路径。
 */

/** 炼丹解锁：宗门等级下限。 */
export const ALCHEMY_UNLOCK_SECT_LEVEL = 2;
/** 炼丹解锁：附属建筑（灵药园）id；第一版不新增独立炼丹房。 */
export const ALCHEMY_UNLOCK_BUILDING_ID = 'herbGarden';
/** 炼丹解锁：灵药园等级下限。 */
export const ALCHEMY_UNLOCK_BUILDING_LEVEL = 2;
/** 每名弟子最多服用淬体丹次数。 */
export const BODY_TEMPERING_MAX_USES = 10;
/** 聚气丹每颗增加的当前阶段修为。 */
export const CULTIVATION_PILL_GAIN = 120;

export type PillId = 'healingPill' | 'cultivationPill' | 'bodyTemperingPill';

export type PillAttribute = 'attack' | 'defense' | 'speed';

export interface PillRecipe {
  id: PillId;
  name: string;
  description: string;
  /** 单颗炼制成本：resourceId -> 最小单位十进制字符串（与配置资源同口径）。 */
  cost: Record<string, string>;
}

/**
 * 第一版丹方基线（03 文档第 3 节）：
 * - 回春丹：清除一名弟子的当前疗伤状态；
 * - 聚气丹：增加 120 点当前阶段修为（不越过突破门槛）；
 * - 淬体丹：自动补最明显的战斗属性短板（每名弟子最多 10 次）。
 */
export const PILL_RECIPES: readonly PillRecipe[] = [
  {
    id: 'healingPill',
    name: '回春丹',
    description: '清除一名弟子的疗伤状态，立刻可以再度出战或突破。',
    cost: { herb: '10000', spiritStone: '15000' },
  },
  {
    id: 'cultivationPill',
    name: '聚气丹',
    description: '为一名弟子增加 120 点当前阶段修为，不越过突破门槛。',
    cost: { herb: '25000', spiritualEnergy: '15000', spiritStone: '10000' },
  },
  {
    id: 'bodyTemperingPill',
    name: '淬体丹',
    description: '自动补齐一名弟子最明显的战斗属性短板，每名弟子最多服用 10 次。',
    cost: { herb: '40000', ore: '20000', spiritStone: '30000' },
  },
];

export const PILL_IDS: readonly PillId[] = PILL_RECIPES.map((recipe) => recipe.id);

/** 按 id 查配方；未知 id（客户端乱传）返回 undefined，由调用方抛 NOT_FOUND。 */
export function findPillRecipe(pillId: string): PillRecipe | undefined {
  return PILL_RECIPES.find((recipe) => recipe.id === pillId);
}

/** 未解锁时的统一文案（sync 视图与 craft/use 报错共用同一句）。 */
export const ALCHEMY_LOCKED_REASON = `炼丹尚未开启，需要宗门 ${ALCHEMY_UNLOCK_SECT_LEVEL} 级、灵药园 ${ALCHEMY_UNLOCK_BUILDING_LEVEL} 级`;

/**
 * 解锁判断（只在服务端实现）：宗门等级达标 且 附属建筑（灵药园）等级达标。
 * buildingLevels 是 defId -> level 表；没有灵药园行视为 0 级。
 */
export function isAlchemyUnlocked(sectLevel: number, buildingLevels: Record<string, number>): boolean {
  return (
    sectLevel >= ALCHEMY_UNLOCK_SECT_LEVEL &&
    (buildingLevels[ALCHEMY_UNLOCK_BUILDING_ID] ?? 0) >= ALCHEMY_UNLOCK_BUILDING_LEVEL
  );
}

/** 同一判断的文案版：解锁返回 null，未解锁返回 ALCHEMY_LOCKED_REASON。 */
export function alchemyUnlockBlockedReason(
  sectLevel: number,
  buildingLevels: Record<string, number>,
): string | null {
  return isAlchemyUnlocked(sectLevel, buildingLevels) ? null : ALCHEMY_LOCKED_REASON;
}

/**
 * 成本里第一个余额不足的资源（炼制 canCraft 判断用）。
 * 返回 resourceId；全部足够返回 null。数量 × quantity 的精确检查仍由 craft 服务执行。
 */
export function firstInsufficientResource(
  cost: Record<string, string>,
  balanceOf: (resourceId: string) => number,
): string | null {
  for (const [resourceId, amount] of Object.entries(cost)) {
    if (balanceOf(resourceId) < Number(amount)) {
      return resourceId;
    }
  }
  return null;
}

/** 淬体丹短板判定的固定属性顺序（gap 并列时先到先得）。 */
const PILL_ATTRIBUTE_ORDER: readonly PillAttribute[] = ['attack', 'defense', 'speed'];

/**
 * 单项短板的提升量：`min(5, max(1, 1 + floor(gap / 10)), 100 - 当前属性)`。
 * gap > 0 时结果至少为 1（gap > 0 蕴含当前属性 < 100，所以 100 - attr >= 1）。
 */
export function bodyTemperingGain(gap: number, currentValue: number): number {
  return Math.min(5, Math.max(1, 1 + Math.floor(gap / 10)), 100 - currentValue);
}

export interface BodyTemperingTarget {
  attribute: PillAttribute;
  gain: number;
  /** 与另两项均值（向下取整）的差距；恒 > 0。 */
  gap: number;
}

/**
 * 淬体丹补短板（服务端自动选择，客户端不能指定属性）：
 * 对每个候选属性算 otherAverage = floor(另两项之和 / 2)、gap = otherAverage - 当前属性，
 * 只有 gap > 0 的属性可补；选 gap 最大者，并列按 attack -> defense -> speed。
 * 没有可补属性（三项均衡）返回 null。
 */
export function bodyTemperingTarget(
  attack: number,
  defense: number,
  speed: number,
): BodyTemperingTarget | null {
  const values: Record<PillAttribute, number> = { attack, defense, speed };
  let best: BodyTemperingTarget | null = null;
  for (const attribute of PILL_ATTRIBUTE_ORDER) {
    const otherSum = PILL_ATTRIBUTE_ORDER.filter((item) => item !== attribute).reduce(
      (sum, item) => sum + values[item],
      0,
    );
    const gap = Math.floor(otherSum / 2) - values[attribute];
    if (gap <= 0) {
      continue;
    }
    // 严格大于：并列时保留先出现的属性（固定顺序 attack -> defense -> speed）。
    if (best === null || gap > best.gap) {
      best = { attribute, gain: bodyTemperingGain(gap, values[attribute]), gap };
    }
  }
  return best;
}
