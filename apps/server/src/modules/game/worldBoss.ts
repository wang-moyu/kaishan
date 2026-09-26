import { bossDropDescription, type EquipmentQuality } from './equipment';
import { ARENA_COMBAT_BONUS_BP_PER_LEVEL } from './realms';

/**
 * 世界 Boss（讨伐）二期纯规则（docs/世界Boss二期开发计划.md 2.2~2.9）。
 *
 * 与一期同一做法：这里只有常量与纯函数 —— 不读库、不取时间、不调用 Math.random
 * （随机源通过参数注入），定义硬编码在代码里、不进 game-config。
 *
 * 二期的三处结构性变化：
 * - **连战**：一天从第 1 关开始，打死一关立刻出下一关；血量按关卡翻倍。
 * - **随机词缀**：每关生成时随机一个，整关不变，给弟子属性加成与额外风险。
 * - **不限出手次数**：靠「冷却 3 秒 + 弟子疲劳/受伤/重伤」自然约束。
 *   一期的「阶（level）」「每日 3 次」「参与奖」「打破奖池按伤害占比分」全部去掉。
 *
 * 三期的三处结构性变化（docs/世界Boss三期开发计划.md 2.1~2.4）：
 * - **掉落人人有份**：装备掉落改为每个参与宗门按 √伤害占比各自判定，不再只给伤害第一。
 * - **功勋**：每关按 √伤害占比发新资源「功勋」，可在讨伐面板兑换玄铁与装备。
 * - **玄铁门槛放宽**：伤害占比不足 15% 的宗门每关也能得 1 个玄铁。
 *
 * 金额一律是最小单位（1 展示单位 = 1000 最小单位）。
 */
export const WORLD_BOSS_MIN_PARTY = 1;
export const WORLD_BOSS_MAX_PARTY = 10;

/** 时间线（UTC+8 小时）：08:00 开放、22:00 力竭、23:00 逃走。 */
export const WORLD_BOSS_OPEN_HOUR = 8;
export const WORLD_BOSS_FRENZY_HOUR = 22;
export const WORLD_BOSS_CLOSE_HOUR = 23;

/** 力竭期伤害倍率（22:00~23:00）。 */
export const WORLD_BOSS_FRENZY_MULTIPLIER = 1.5;

/** 暴击倍率与暴击率上限（luck 1~100 → 最高 20%）。 */
export const WORLD_BOSS_CRIT_MULTIPLIER = 1.5;
export const WORLD_BOSS_CRIT_RATE_MAX = 0.2;

/** 伤害浮动区间（均匀随机）。 */
export const WORLD_BOSS_FLUCTUATION_MIN = 0.8;
export const WORLD_BOSS_FLUCTUATION_MAX = 1.2;

/** 只为数字好看：伤害与血量都按同一个比例放大。 */
export const WORLD_BOSS_DAMAGE_SCALE = 100;

/** 血量下限。 */
export const WORLD_BOSS_MIN_HP = 10_000;

/** 第 1 关的血量 = 一轮伤害 × 这个倍数；每往下一关再 ×1.6（2、3.2、5.1、8.2… 轮）。 */
export const WORLD_BOSS_ROUNDS_PER_STAGE = 2;
/** 每关血量相对上一关的倍数。 */
export const WORLD_BOSS_STAGE_HP_GROWTH = 1.6;

/** 打掉这个比例以上算「击退」（而不是单纯逃走）。 */
export const WORLD_BOSS_FLED_THRESHOLD = 0.7;
/** 击退时奖励 ×0.5。 */
export const WORLD_BOSS_FLED_POOL_FACTOR = 0.5;

/** 同一宗门的出手冷却（不限次数之后的唯一节奏约束）。 */
export const WORLD_BOSS_COOLDOWN_MS = 3_000;

/**
 * 每个宗门每天最多出手几次（防协议脚本全天刷）：默认 120，比最肝的真人玩家略多。
 * 线上由环境变量 WORLD_BOSS_DAILY_ATTACK_LIMIT 覆盖（改 .env 后重启即可，不用改代码）；
 * 0 = 不限次数。「一天」按 UTC+8 自然日算（讨伐只在 08:00–23:00 开放）。
 */
export const WORLD_BOSS_DAILY_ATTACK_LIMIT_DEFAULT = 120;

/** 解析每日出手上限：非负整数原样用（0 = 不限）；没配、写错时用默认值。 */
export function parseDailyAttackLimit(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return WORLD_BOSS_DAILY_ATTACK_LIMIT_DEFAULT;
  const value = Number(raw.trim());
  return Number.isInteger(value) && value >= 0 ? value : WORLD_BOSS_DAILY_ATTACK_LIMIT_DEFAULT;
}

/** 疲劳统计窗口：最近 60 分钟内已出战讨伐的次数。 */
export const WORLD_BOSS_FATIGUE_WINDOW_MS = 60 * 60 * 1000;

/** 普通受伤持续 30 分钟（沿用 disciples.injured_until）。 */
export const WORLD_BOSS_INJURY_DURATION_MS = 30 * 60 * 1000;

/** 普通受伤概率 = 3% − (体魄 − 50)/10 × 1%，夹在 1%~8%。 */
export const WORLD_BOSS_INJURY_BASE_RATE = 0.03;
export const WORLD_BOSS_INJURY_RATE_MIN = 0.01;
export const WORLD_BOSS_INJURY_RATE_MAX = 0.08;
export const WORLD_BOSS_INJURY_PHYSIQUE_STEP = 0.01;

/** 重伤概率表：本次是这一小时第 n+1 次出手。 */
export const WORLD_BOSS_SEVERE_RATE_AT_3 = 0.3;
export const WORLD_BOSS_SEVERE_RATE_AT_4 = 0.7;
/** 体魄每高 10 点，30% / 70% 两档下调 3 个百分点。 */
export const WORLD_BOSS_SEVERE_PHYSIQUE_STEP = 0.03;

/** 保底 = 10 × 宗门等级 × 1000（最小单位）。 */
export const WORLD_BOSS_REWARD_FLOOR_UNIT = 10 * 1000;
/** 奖励涉及的资源（按资源分别算）。 */
export const WORLD_BOSS_POOL_RESOURCES = ['spiritStone', 'herb', 'ore'] as const;
/** 基础份的产量系数（每关给几小时产出；防通胀由 3.5 下调）。 */
export const WORLD_BOSS_KILL_POOL_RATE_FACTOR = 2.5;
/** 最后一击奖的产量系数。 */
export const WORLD_BOSS_LAST_HIT_RATE_FACTOR = 1.0;
/**
 * 资源奖励的关卡系数：第 n 关 ×(1 + 0.3 × (min(n, 5) − 1))，第 5 关起不再递增（最高 ×2.2）。
 * 防通胀：原来每关 +0.5 且不封顶，关数一多资源奖励按平方增长。
 */
export const WORLD_BOSS_STAGE_REWARD_STEP = 0.3;
/** 资源奖励关卡系数封顶的关卡。 */
export const WORLD_BOSS_STAGE_REWARD_MAX_STAGE = 5;
/** 功勋的关卡系数每关递增量（与资源分开：功勋兑换价按它定，不随资源下调）。 */
export const WORLD_BOSS_MERIT_STAGE_STEP = 0.5;
/** 击杀时必发的丹药（每参与宗门）。 */
export const WORLD_BOSS_KILL_PILL_ID = 'cultivationPill';
/** 伤害第 1 名的额外丹药。 */
export const WORLD_BOSS_TOP_DAMAGE_PILL_ID = 'bodyTemperingPill';

/** 排名倍数：第 1/2/3 名，其余 ×1.0。 */
const RANK_MULTIPLIERS: readonly number[] = [1.5, 1.25, 1.1];

export interface WorldBossDef {
  index: number;
  name: string;
  /** 印章字（圆形印章中间的那个字）。 */
  sealCharacter: string;
  /** 主色（印章与血条的强调色）。 */
  color: string;
  description: string;
}

/** 五只轮换 Boss，按 (dayIndex + stage − 1) % 5 取用。 */
export const WORLD_BOSSES: readonly WorldBossDef[] = [
  {
    index: 0,
    name: '黑风妖王',
    sealCharacter: '风',
    color: '#7a8c6e',
    description: '盘踞黑风岭的老妖，一口妖风可卷走半座山门。',
  },
  {
    index: 1,
    name: '赤炎火蛟',
    sealCharacter: '蛟',
    color: '#e0654f',
    description: '生于地火熔窟，所过之处草木成灰。',
  },
  {
    index: 2,
    name: '九幽冥蛛',
    sealCharacter: '蛛',
    color: '#8a6bb8',
    description: '自九幽裂隙爬出，丝网能缚住元婴修士的神识。',
  },
  {
    index: 3,
    name: '玄冰狼王',
    sealCharacter: '狼',
    color: '#6fb6d9',
    description: '统领北境狼群，啸声所至万物结霜。',
  },
  {
    index: 4,
    name: '裂山石魔',
    sealCharacter: '魔',
    color: '#b08a5a',
    description: '上古山魂所化，一拳可崩裂峰峦。',
  },
];

/* ---------- 随机词缀（2.7） ---------- */

export interface WorldBossAffixDef {
  id: string;
  name: string;
  /** 界面文案（保持这么短，不要加长）。 */
  effect: string;
  /** 配队提示。 */
  tip: string;
  /** 前端「推荐排序属性」。 */
  sortAttribute: 'attack' | 'defense' | 'speed' | 'luck' | 'physique';
  /** 提供属性加成的弟子属性列；null = 不给加成（只改概率）。 */
  attribute: 'attack' | 'defense' | 'speed' | null;
}

/** 词缀 id 白名单（含「无词缀」，迁移过来的旧行是 'none'）。 */
export const WORLD_BOSS_AFFIX_NONE = 'none';

export const WORLD_BOSS_AFFIXES: readonly WorldBossAffixDef[] = [
  {
    id: 'ironclad',
    name: '铁甲',
    effect: '防御越高，伤害越高',
    tip: '派防御高的弟子',
    sortAttribute: 'defense',
    attribute: 'defense',
  },
  {
    id: 'swift',
    name: '迅捷',
    effect: '身法越高，伤害越高',
    tip: '派身法高的弟子',
    sortAttribute: 'speed',
    attribute: 'speed',
  },
  {
    id: 'brute',
    name: '蛮力',
    effect: '攻击越高，伤害越高',
    tip: '派攻击高的弟子',
    sortAttribute: 'attack',
    attribute: 'attack',
  },
  {
    id: 'eerie',
    name: '邪祟',
    effect: '暴击率翻倍',
    tip: '派幸运高的弟子',
    sortAttribute: 'luck',
    attribute: null,
  },
  {
    id: 'berserk',
    name: '狂暴',
    effect: '受伤、重伤概率翻倍',
    tip: '派体魄高的弟子，别贪刀',
    sortAttribute: 'physique',
    attribute: null,
  },
];

/** 找一个词缀定义；'none' / 脏 id 都返回 undefined（视作无词缀）。 */
export function findAffix(affixId: string): WorldBossAffixDef | undefined {
  return WORLD_BOSS_AFFIXES.find((affix) => affix.id === affixId);
}

/** 词缀显示名（'none' → 「无」）。 */
export function affixNameOf(affixId: string): string {
  return findAffix(affixId)?.name ?? '无';
}

/** 生成关卡时抽一个词缀（随机源注入）。 */
export function rollAffix(random: () => number): string {
  const index = Math.min(
    WORLD_BOSS_AFFIXES.length - 1,
    Math.max(0, Math.floor(random() * WORLD_BOSS_AFFIXES.length)),
  );
  return WORLD_BOSS_AFFIXES[index]!.id;
}

/** 词缀属性加成：1 + 属性 / 10 × 0.05（属性 100 → ×1.5）；无加成词缀返回 1。 */
export function affixAttributeMultiplier(
  affix: WorldBossAffixDef | undefined,
  attributes: { attack: number; defense: number; speed: number },
): number {
  if (affix === undefined || affix.attribute === null) return 1;
  return 1 + (attributes[affix.attribute] / 10) * 0.05;
}

/* ---------- 阶段与关卡（2.1、2.2） ---------- */

/** Boss 阶段：未出现 / 讨伐中 / 力竭中 / 已结束。 */
export type WorldBossPhase = 'before' | 'open' | 'frenzy' | 'closed';

/**
 * 阶段判定（UTC+8 小时整数）：
 * 08:00 前 before；08:00~22:00 open；22:00~23:00 frenzy；23:00 起 closed。
 */
export function worldBossPhaseOf(now: number): WorldBossPhase {
  const hour = new Date(now + 8 * 3_600_000).getUTCHours();
  if (hour < WORLD_BOSS_OPEN_HOUR) return 'before';
  if (hour >= WORLD_BOSS_CLOSE_HOUR) return 'closed';
  if (hour >= WORLD_BOSS_FRENZY_HOUR) return 'frenzy';
  return 'open';
}

/** 能不能出手（力竭期仍能出手，只是伤害更高）。 */
export function isWorldBossAttackable(phase: WorldBossPhase): boolean {
  return phase === 'open' || phase === 'frenzy';
}

/** 当天 UTC+8 日期距 1970-01-01 的天数（轮换下标用）。 */
export function dayIndexUtc8(now: number): number {
  return Math.floor((now + 8 * 3_600_000) / 86_400_000);
}

/** 第 stage 关用哪只 Boss：WORLD_BOSSES[(dayIndex + stage − 1) % 5]。 */
export function bossIndexFor(dayIndex: number, stage: number): number {
  const raw = (dayIndex + stage - 1) % WORLD_BOSSES.length;
  return raw < 0 ? raw + WORLD_BOSSES.length : raw;
}

export function bossDefAt(index: number): WorldBossDef {
  const normalized = ((index % WORLD_BOSSES.length) + WORLD_BOSSES.length) % WORLD_BOSSES.length;
  return WORLD_BOSSES[normalized]!;
}

/** 关卡名（第 3 关）。 */
export function stageName(stage: number): string {
  return `第 ${String(stage)} 关`;
}

/** 显示名：第 2 关 · 赤炎火蛟。 */
export function bossDisplayName(bossIndex: number, stage: number): string {
  return `${stageName(stage)} · ${bossDefAt(bossIndex).name}`;
}

/** 第 n 关最大血量 = max(10000, 一轮伤害 × 2 × 1.6^(n−1))。 */
export function stageMaxHp(roundDamage: number, stage: number): number {
  const rounds = WORLD_BOSS_ROUNDS_PER_STAGE * WORLD_BOSS_STAGE_HP_GROWTH ** Math.max(0, stage - 1);
  return Math.max(WORLD_BOSS_MIN_HP, Math.floor(Math.max(0, roundDamage) * rounds));
}

/* ---------- 伤害（2.5） ---------- */

/** 演武场加成 = 1 + 演武场等级 × 0.1（复用每级 1000 基点）。 */
export function arenaCombatMultiplier(arenaLevel: number): number {
  return 1 + (arenaLevel * ARENA_COMBAT_BONUS_BP_PER_LEVEL) / 10_000;
}

/**
 * 一名弟子的贡献 = 他的战力 × 词缀属性加成。
 * （战力本身由 realms.ts 的 discipleCombatPower 算好，这里只乘词缀。）
 */
export function discipleContribution(
  power: number,
  affix: WorldBossAffixDef | undefined,
  attributes: { attack: number; defense: number; speed: number },
): number {
  return power * affixAttributeMultiplier(affix, attributes);
}

/**
 * 「一轮伤害」里单个宗门的期望伤害：
 * 队伍战力 × 演武场加成 × DAMAGE_SCALE（无浮动、无暴击、无词缀、无力竭）。
 */
export function expectedPartyDamage(input: {
  topPartyPower: number;
  arenaLevel: number;
}): number {
  return Math.floor(
    Math.max(0, input.topPartyPower) * arenaCombatMultiplier(input.arenaLevel) * WORLD_BOSS_DAMAGE_SCALE,
  );
}

/**
 * 一次出手的伤害与是否暴击。
 *
 * 伤害 = floor(队伍基础 × 演武场加成 × 浮动 × 暴击倍率 × 力竭倍率 × DAMAGE_SCALE)
 * 暴击率 = 出战弟子 luck 平均值 / 100 × 20% ×（「邪祟」词缀时 ×2），最高 100%。
 *
 * 随机源按固定顺序取用：先浮动、后暴击判定（测试可据此注入固定序列）。
 */
export function rollDamage(input: {
  /** 未重伤成员的贡献之和（已含词缀属性加成）。 */
  partyBase: number;
  arenaLevel: number;
  /** 出战弟子（本次派出的全部成员）的 luck 平均值。 */
  avgLuck: number;
  /** 是否处于力竭期（22:00~23:00）。 */
  frenzy: boolean;
  /** 「邪祟」词缀时传 2（暴击率翻倍）。 */
  critRateMultiplier?: number;
  random: () => number;
}): { damage: number; crit: boolean } {
  const fluctuation =
    WORLD_BOSS_FLUCTUATION_MIN +
    input.random() * (WORLD_BOSS_FLUCTUATION_MAX - WORLD_BOSS_FLUCTUATION_MIN);
  const critRate = Math.min(
    1,
    (input.avgLuck / 100) * WORLD_BOSS_CRIT_RATE_MAX * (input.critRateMultiplier ?? 1),
  );
  const crit = input.random() < critRate;
  const damage = Math.floor(
    Math.max(0, input.partyBase) *
      arenaCombatMultiplier(input.arenaLevel) *
      fluctuation *
      (crit ? WORLD_BOSS_CRIT_MULTIPLIER : 1) *
      (input.frenzy ? WORLD_BOSS_FRENZY_MULTIPLIER : 1) *
      WORLD_BOSS_DAMAGE_SCALE,
  );
  return { damage, crit };
}

/* ---------- 疲劳 · 受伤 · 重伤（2.6） ---------- */

/**
 * 本次出手的重伤概率：按「这一小时第几次出手」取基础概率，
 * 30% / 70% 两档再按体魄下调，最后「狂暴」词缀 ×2（封顶 100%）。
 */
export function severeInjuryChance(
  fatigueCount: number,
  physique: number,
  berserk: boolean,
): number {
  if (fatigueCount <= 2) return 0;
  let rate: number;
  if (fatigueCount === 3) {
    rate = WORLD_BOSS_SEVERE_RATE_AT_3;
  } else if (fatigueCount === 4) {
    rate = WORLD_BOSS_SEVERE_RATE_AT_4;
  } else {
    rate = 1;
  }
  // 体魄修正只作用在 30% 与 70% 两档（100% 那档没有下调空间）。
  if (rate < 1) {
    rate = Math.max(0, rate - (Math.max(0, physique - 50) / 10) * WORLD_BOSS_SEVERE_PHYSIQUE_STEP);
  }
  return berserk ? Math.min(1, rate * 2) : rate;
}

/** 普通受伤概率：3% − (体魄 − 50)/10 × 1%，夹在 1%~8%；「狂暴」×2。 */
export function normalInjuryChance(physique: number, berserk: boolean): number {
  const raw =
    WORLD_BOSS_INJURY_BASE_RATE - ((physique - 50) / 10) * WORLD_BOSS_INJURY_PHYSIQUE_STEP;
  const clamped = Math.min(
    WORLD_BOSS_INJURY_RATE_MAX,
    Math.max(WORLD_BOSS_INJURY_RATE_MIN, raw),
  );
  return berserk ? Math.min(1, clamped * 2) : clamped;
}

/**
 * 单名弟子的判定结果：先判重伤，未重伤再判受伤。
 * 随机源按固定顺序取用：先重伤、再受伤（重伤时不会取第二个随机数）。
 */
export function rollOutcome(input: {
  /** 该弟子最近 60 分钟内已出战讨伐的次数（不含本次）。 */
  fatigueCount: number;
  physique: number;
  /** 当前关卡词缀是否「狂暴」。 */
  berserk: boolean;
  random: () => number;
}): { severe: boolean; injured: boolean } {
  const severeRate = severeInjuryChance(input.fatigueCount, input.physique, input.berserk);
  if (input.random() < severeRate) {
    return { severe: true, injured: false };
  }
  const injured = input.random() < normalInjuryChance(input.physique, input.berserk);
  return { severe: false, injured };
}

/* ---------- 奖励（2.8） ---------- */

/** 保底(L) = 10 × 宗门等级 × 1000（最小单位）。 */
export function rewardFloor(sectLevel: number): number {
  return WORLD_BOSS_REWARD_FLOOR_UNIT * Math.max(1, Math.floor(sectLevel));
}

/** 资源奖励的关卡系数 = 1 + 0.3 × (min(关卡, 5) − 1)。 */
export function stageRewardMultiplier(stage: number): number {
  const capped = Math.min(WORLD_BOSS_STAGE_REWARD_MAX_STAGE, Math.max(1, Math.floor(stage)));
  return 1 + WORLD_BOSS_STAGE_REWARD_STEP * (capped - 1);
}

/** 功勋的关卡系数 = 1 + 0.5 × (关卡 − 1)（三期原口径，不封顶）。 */
export function meritStageMultiplier(stage: number): number {
  return 1 + WORLD_BOSS_MERIT_STAGE_STEP * (Math.max(1, Math.floor(stage)) - 1);
}

/** 排名倍数：第 1 名 1.5、第 2 名 1.25、第 3 名 1.1，其余 1.0。 */
export function rankRewardMultiplier(rank: number): number {
  return RANK_MULTIPLIERS[Math.floor(rank) - 1] ?? 1;
}

/**
 * 一个参与宗门在该关的基础资源奖励（灵石 / 药材 / 矿石分别算）：
 *   max(该宗门产出(r) × 2.5, 保底(L)) × 关卡系数 × 排名倍数 ×（击退时 ×0.5）
 * 「击退」= 23:00 逃走时血量已被打掉 ≥70%。
 */
export function stageResourceRewards(input: {
  rates: Readonly<Record<string, number>>;
  sectLevel: number;
  stage: number;
  /** 1 = 伤害最高的宗门（并列取先达到者）。 */
  rank: number;
  /** 击退（而不是单纯逃走）。 */
  repelled?: boolean;
}): Record<string, number> {
  const factor =
    stageRewardMultiplier(input.stage) *
    rankRewardMultiplier(input.rank) *
    (input.repelled === true ? WORLD_BOSS_FLED_POOL_FACTOR : 1);
  const rewards: Record<string, number> = {};
  for (const resourceId of WORLD_BOSS_POOL_RESOURCES) {
    const rate = input.rates[resourceId] ?? 0;
    const base = Math.max(rate * WORLD_BOSS_KILL_POOL_RATE_FACTOR, rewardFloor(input.sectLevel));
    rewards[resourceId] = Math.floor(base * factor);
  }
  return rewards;
}

/** 最后一击奖（灵石）：max(产出(灵石) × 1, 保底(L)) × 关卡系数。 */
export function lastHitReward(rateStone: number, sectLevel: number, stage: number): number {
  const base = Math.max(rateStone * WORLD_BOSS_LAST_HIT_RATE_FACTOR, rewardFloor(sectLevel));
  return Math.floor(base * stageRewardMultiplier(stage));
}

/**
 * 奖励预览（面板「奖励」按钮）：按当前关卡与本宗门此刻的产出，列出各名次能拿到的资源。
 * 与发奖同一套函数（stageResourceRewards / lastHitReward），前端不复制公式。
 */
export function worldBossRewardPreview(input: {
  rates: Readonly<Record<string, number>>;
  sectLevel: number;
  stage: number;
}): {
  stage: number;
  tiers: { rank: number; multiplier: number; resources: Record<string, number>; topDamagePill: boolean }[];
  lastHitStone: number;
  /** 装备掉落说明（三期 2.1：「按本关伤害占比各自判定：仙品装备 ×1 概率 = 75% × √占比；未得时 40% 概率得 宝品装备 ×1」）。 */
  dropDescription: string;
} {
  const tiers = [1, 2, 3, 4].map((rank) => ({
    rank,
    multiplier: rankRewardMultiplier(rank),
    resources: stageResourceRewards({ rates: input.rates, sectLevel: input.sectLevel, stage: input.stage, rank }),
    topDamagePill: rank === 1,
  }));
  return {
    stage: input.stage,
    tiers,
    lastHitStone: lastHitReward(input.rates.spiritStone ?? 0, input.sectLevel, input.stage),
    dropDescription: bossDropDescription(input.stage),
  };
}

/** 已击退？打掉的血量比例达到阈值（含）。 */
export function isFledByDamage(maxHp: number, hp: number): boolean {
  if (maxHp <= 0) return false;
  return (maxHp - hp) / maxHp >= WORLD_BOSS_FLED_THRESHOLD;
}

/* ---------- 三期：功勋与功勋兑换（计划 2.3、2.4） ---------- */

/** 功勋资源 id（game-config 的第六种资源）。 */
export const BOSS_MERIT_RESOURCE_ID = 'bossMerit';
/** 功勋基数（展示单位）：base = max(WORLD_BOSS_MERIT_MIN, round(它 × 功勋关卡系数 × √伤害占比))。 */
export const WORLD_BOSS_MERIT_BASE = 10;
/** 功勋保底（展示单位）：伤害占比再小也不低于它。 */
export const WORLD_BOSS_MERIT_MIN = 2;

/**
 * 一个参与宗门在该关获得的功勋（展示单位整数）：
 *   base = max(2, round(10 × 功勋关卡系数 × √伤害占比))；击杀给 base，击退给 floor(base / 2)（至少 1）。
 * 伤害占比先夹到 [0, 1]；占比 ≤ 0 直接返回 0（蹭不到伤害就没有功勋）。
 */
export function worldBossMeritFor(input: {
  stage: number;
  damageShare: number;
  repelled: boolean;
}): number {
  if (input.damageShare <= 0) return 0;
  const share = Math.min(1, Math.max(0, input.damageShare));
  const base = Math.max(
    WORLD_BOSS_MERIT_MIN,
    Math.round(WORLD_BOSS_MERIT_BASE * meritStageMultiplier(input.stage) * Math.sqrt(share)),
  );
  return input.repelled ? Math.max(1, Math.floor(base / 2)) : base;
}

export type BossMeritShopItemId = 'xuantie' | 'spirit' | 'treasure' | 'immortal';

/** 功勋兑换的分类（弹窗里一类一个标签页；以后开放新的兑换物，在这里加分类、在价目表里加条目即可）。 */
export type MeritShopCategory = 'resource' | 'equipment';
export const MERIT_SHOP_CATEGORIES: readonly { id: MeritShopCategory; name: string }[] = [
  { id: 'resource', name: '资源' },
  { id: 'equipment', name: '装备' },
];

/**
 * 功勋兑换价目表（唯一一份，前端只渲染）：cost 是展示单位，扣款时 × 1000。
 * resource 类给 resourceId 对应的资源（按个数兑换）；equipment 类给一件 quality 品质的装备（自选部位）。
 */
export const WORLD_BOSS_MERIT_SHOP: readonly {
  id: BossMeritShopItemId;
  name: string;
  cost: number;
  category: MeritShopCategory;
  quality: EquipmentQuality | null;
}[] = [
  { id: 'xuantie', name: '玄铁', cost: 4, category: 'resource', quality: null },
  { id: 'spirit', name: '灵品装备', cost: 25, category: 'equipment', quality: 'spirit' },
  { id: 'treasure', name: '宝品装备', cost: 70, category: 'equipment', quality: 'treasure' },
  { id: 'immortal', name: '仙品装备', cost: 200, category: 'equipment', quality: 'immortal' },
];

/** 一次最多兑换多少个玄铁。 */
export const WORLD_BOSS_MERIT_XUANTIE_MAX = 100;

/** 按 id 找价目表项；未知 id 返回 undefined（调用方报 VALIDATION_ERROR）。 */
export function findMeritShopItem(id: string) {
  return WORLD_BOSS_MERIT_SHOP.find((item) => item.id === id);
}
