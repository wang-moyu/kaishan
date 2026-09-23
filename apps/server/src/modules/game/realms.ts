import { realmIndex } from './constants';

/**
 * 秘境定义与战力/成功率计算（V2-2 第二、三节）。
 *
 * 核心原则：简单直接。没有回合制、没有技能、没有装备——弟子属性 vs 秘境难度 →
 * 一个概率 → 出结果。秘境定义硬编码在这里（与 events.ts 的事件池同一做法），
 * 不进 game-config，也不进数据库。
 *
 * 金额一律是**最小单位**（03 第 1 节：1 展示单位 = 1000 最小单位）的十进制字符串。
 */

export interface SecretRealmDef {
  id: string;
  name: string;
  description: string;
  /** 难度值，用于与弟子战力对比计算成功率。 */
  difficulty: number;
  /** 进入消耗（最小单位）。 */
  entryCost: Record<string, string>;
  /** 成功奖励（最小单位）。 */
  rewards: Record<string, string>;
  /** 队伍人数：最少/最多。 */
  minParty: number;
  maxParty: number;
  /** 每日探索次数上限。null = 不限。 */
  dailyLimit: number | null;
  /** 需要的最低宗门等级。 */
  requiredSectLevel: number;
  /** 是否需要演武场才能探索；低阶秘境可跳过。 */
  requiresArena: boolean;
}

export const SECRET_REALMS: readonly SecretRealmDef[] = [
  {
    id: 'mistyForest',
    name: '迷雾森林',
    description: '雾气弥漫的低阶历练之地，危险不大但收获有限。',
    difficulty: 50,
    entryCost: { spiritStone: '10000' },
    rewards: { spiritStone: '30000', herb: '15000' },
    minParty: 1,
    maxParty: 2,
    dailyLimit: 3,
    requiredSectLevel: 1,
    requiresArena: false,
  },
  {
    id: 'savageMine',
    name: '蛮荒矿洞',
    description: '荒废已久的矿脉，偶有妖兽出没，但矿石资源丰富。',
    difficulty: 120,
    entryCost: { spiritStone: '20000' },
    rewards: { ore: '50000', spiritStone: '20000' },
    minParty: 1,
    maxParty: 2,
    dailyLimit: 3,
    requiredSectLevel: 1,
    requiresArena: false,
  },
  {
    id: 'fallenStarAbyss',
    name: '落星深渊',
    description: '陨星坠落形成的深渊，灵气浓郁但危机四伏。',
    difficulty: 250,
    entryCost: { spiritStone: '40000', spiritualEnergy: '20000' },
    rewards: { spiritStone: '80000', spiritualEnergy: '50000', herb: '30000' },
    minParty: 1,
    maxParty: 3,
    dailyLimit: 3,
    requiredSectLevel: 3,
    requiresArena: true,
  },
  {
    id: 'beastNest',
    name: '妖兽巢穴',
    description: '高阶妖兽的领地，风险极高但战利品丰厚。',
    difficulty: 500,
    entryCost: { spiritStone: '60000', spiritualEnergy: '30000' },
    rewards: { spiritStone: '150000', ore: '80000', herb: '60000' },
    minParty: 2,
    maxParty: 3,
    dailyLimit: 3,
    requiredSectLevel: 4,
    requiresArena: true,
  },
  {
    id: 'ancientRealm',
    name: '上古秘境',
    description: '远古大能留下的秘境，蕴含惊人机缘。',
    difficulty: 1000,
    entryCost: { spiritStone: '100000', spiritualEnergy: '50000' },
    rewards: { spiritStone: '300000', ore: '150000', herb: '100000', spiritualEnergy: '80000' },
    minParty: 2,
    maxParty: 3,
    dailyLimit: 3,
    requiredSectLevel: 6,
    requiresArena: true,
  },
  {
    id: 'tribulationRuins',
    name: '天劫遗迹',
    description: '渡劫失败的仙人遗迹，危险至极但宝物无数。',
    difficulty: 2000,
    entryCost: { spiritStone: '150000', spiritualEnergy: '80000' },
    rewards: { spiritStone: '500000', ore: '250000', herb: '200000', spiritualEnergy: '150000' },
    minParty: 3,
    maxParty: 3,
    dailyLimit: 3,
    requiredSectLevel: 8,
    requiresArena: true,
  },
];

export function findSecretRealm(realmId: string): SecretRealmDef | undefined {
  return SECRET_REALMS.find((realm) => realm.id === realmId);
}

/**
 * 单个弟子战力（V4 第三节）。
 * base = (境界序号×3 + 阶段) × 10
 * 属性加权 = (attack×0.4 + defense×0.35 + speed×0.25) / 100
 * power = base × (1 + 属性加权)；战斗天赋再 ×1.15
 * 例：炼气一层 = (0×3+1)×10 = 10，金丹三层 = (2×3+3)×10 = 90。
 */
export function discipleCombatPower(
  realmId: string,
  stage: number,
  attack: number,
  defense: number,
  speed: number,
  talent?: string,
): number {
  const rIdx = realmIndex(realmId);
  const base = (rIdx * 3 + stage) * 10;
  const attrBonus = (attack * 0.4 + defense * 0.35 + speed * 0.25) / 100;
  let power = Math.floor(base * (1 + attrBonus));
  if (talent === 'combat') {
    power = Math.floor(power * 1.15);
  }
  return power;
}

/** 队伍总战力（V4 第三节）：每个成员的属性/天赋都参与计算。 */
export function partyCombatPower(
  members: {
    realmId: string;
    stage: number;
    attack: number;
    defense: number;
    speed: number;
    talent?: string;
  }[],
): number {
  return members.reduce(
    (sum, m) => sum + discipleCombatPower(m.realmId, m.stage, m.attack, m.defense, m.speed, m.talent),
    0,
  );
}

/** 演武场加成：每级 +10% 战力。 */
export const ARENA_COMBAT_BONUS_BP_PER_LEVEL = 1000;

/** 演武场建筑 id（探索的前置建筑，也是战力加成的来源）。 */
export const ARENA_BUILDING_ID = 'arenaHall';

/**
 * 成功率（基点 0~9500）= power / (power + difficulty) × 10000，clamp 到 [500, 9500]。
 * 演武场等级加成后再 clamp。
 */
export function explorationSuccessChanceBp(
  power: number,
  difficulty: number,
  arenaLevel: number = 0,
): number {
  const bonusBp = arenaLevel * ARENA_COMBAT_BONUS_BP_PER_LEVEL;
  const effectivePower = Math.floor((power * (10_000 + bonusBp)) / 10_000);
  const raw = Math.floor((effectivePower / (effectivePower + difficulty)) * 10_000);
  return Math.min(9500, Math.max(500, raw));
}
