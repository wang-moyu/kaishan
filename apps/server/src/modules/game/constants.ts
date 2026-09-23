/**
 * 一次性可玩版本的游戏常量。
 *
 * 数值来源：
 * - 资源/建筑/岗位/招募/修炼/突破的基础数值全部来自 `packages/game-config`（不在这里硬编码）；
 * - 本文件只放**配置里没有**、由当前版本游戏规则确定的四类值：
 *   1. 境界阶段与修为门槛（任务卡：炼气三阶段 30/90/180；筑基/金丹为 P1 扩展，
 *      V2-1 再延长到元婴/化神，后几段门槛均是调参值，标记为“待调参”）；
 *   2. 突破消耗的灵气（任务卡只说“扣灵气”，没有配置项）；
 *   3. 聚灵阵对突破成功率的加成（03 第 4 节：P1 加成只看聚灵阵等级）；
 *   4. 宗门等级表 SECT_LEVELS（V2-1 第二节：等级名、弟子/建筑上限、容量倍率、升级条件）。
 */

export interface RealmStageDef {
  /** 阶段（1 起） */
  stage: number;
  /** 阶段名，例如「炼气一层」 */
  name: string;
  /** 突破到下一阶段所需修为；null 表示已是本版本最高阶段（不能突破） */
  requiredCultivation: number | null;
}

export interface RealmDef {
  id: string;
  name: string;
  stages: readonly RealmStageDef[];
}

/** 境界链。炼气三阶段门槛来自任务卡，筑基/金丹为本次扩展值（待调参）。 */
export const REALMS: readonly RealmDef[] = [
  {
    id: 'qiRefining',
    name: '炼气',
    stages: [
      { stage: 1, name: '炼气一层', requiredCultivation: 30 },
      { stage: 2, name: '炼气二层', requiredCultivation: 90 },
      { stage: 3, name: '炼气三层', requiredCultivation: 180 },
    ],
  },
  {
    id: 'foundationEstablishment',
    name: '筑基',
    stages: [
      { stage: 1, name: '筑基初期', requiredCultivation: 300 },
      { stage: 2, name: '筑基中期', requiredCultivation: 600 },
      { stage: 3, name: '筑基后期', requiredCultivation: 1200 },
    ],
  },
  {
    id: 'goldenCore',
    name: '金丹',
    stages: [
      { stage: 1, name: '金丹初期', requiredCultivation: 1800 },
      { stage: 2, name: '金丹中期', requiredCultivation: 3600 },
      { stage: 3, name: '金丹后期', requiredCultivation: 3600 },
    ],
  },
  {
    id: 'nascentSoul',
    name: '元婴',
    stages: [
      { stage: 1, name: '元婴初期', requiredCultivation: 5400 },
      { stage: 2, name: '元婴中期', requiredCultivation: 10800 },
      { stage: 3, name: '元婴后期', requiredCultivation: 21600 },
    ],
  },
  {
    id: 'spiritTransformation',
    name: '化神',
    stages: [
      { stage: 1, name: '化神初期', requiredCultivation: 32400 },
      { stage: 2, name: '化神中期', requiredCultivation: 64800 },
      { stage: 3, name: '化神后期', requiredCultivation: null },
    ],
  },
];

/** 突破消耗的灵气（最小单位）：每点阶段 20000（= 展示值 20），本次新增的调参值。 */
export const BREAKTHROUGH_ENERGY_COST_PER_STAGE = 20_000;

/** 聚灵阵每高一级的突破成功率加成（基点）。 */
export const BREAKTHROUGH_ARRAY_BONUS_BP_PER_LEVEL = 500;

/** 聚灵阵的建筑定义 id（加成来源）。 */
export const SPIRITUAL_ARRAY_BUILDING_ID = 'spiritualArray';

/** 聚灵阵每级给灵气基础产出的加成（基点，2000 = +20%）。 */
export const SPIRITUAL_ARRAY_ENERGY_BONUS_BP_PER_LEVEL = 2000;

/** 空闲岗位 id（不在配置里，属于弟子状态的枚举值）。 */
export const IDLE_ASSIGNMENT = 'idle';

export function findRealm(realmId: string): RealmDef {
  return REALMS.find((realm) => realm.id === realmId) ?? REALMS[0]!;
}

export function findStage(realmId: string, stage: number): RealmStageDef {
  const realm = findRealm(realmId);
  return realm.stages.find((item) => item.stage === stage) ?? realm.stages[0]!;
}

/** 下一阶段：同境界下一阶段，或下一个境界的第一阶段；已是最高阶段返回 null。 */
export function nextStageOf(realmId: string, stage: number): { realmId: string; stage: number } | null {
  const currentRealmIndex = REALMS.findIndex((realm) => realm.id === realmId);
  const realm = REALMS[currentRealmIndex];
  if (realm === undefined) {
    return null;
  }
  if (stage < realm.stages.length) {
    return { realmId: realm.id, stage: stage + 1 };
  }
  const nextRealm = REALMS[currentRealmIndex + 1];
  return nextRealm === undefined ? null : { realmId: nextRealm.id, stage: 1 };
}

/** 突破消耗：阶段越高越贵。 */
export function breakthroughEnergyCost(stage: number): number {
  return BREAKTHROUGH_ENERGY_COST_PER_STAGE * Math.max(1, stage);
}

/**
 * 自然日 key（UTC+8，见 03 第 1 节）：'YYYY-MM-DD'。
 * 只用于每日次数重置，不用来做业务时间裁决。
 */
export function dateKeyUtc8(timestamp: number): string {
  return new Date(timestamp + 8 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * UTC+8 当天 0 点的毫秒时间戳，用于按自然日窗口统计每日次数（V2-2 第五、六节）。
 * 与 dateKeyUtc8 同一时间基准：先把时间平移到 UTC+8，向下取整到当天 0 点，再平移回 UTC。
 */
export function dayStartMs(timestamp: number): number {
  const utc8OffsetMs = 8 * 3_600_000;
  const dayMs = 86_400_000;
  return Math.floor((timestamp + utc8OffsetMs) / dayMs) * dayMs - utc8OffsetMs;
}

/**
 * 宗门等级定义。
 *
 * 每级的弟子/建筑上限、资源容量倍率与升级条件都是**数据**，运行期只做条件判定，
 * 没有科技树或前置任务链，宗门升级规则由当前版本实现统一维护。
 */
export interface SectLevelDef {
  level: number;
  name: string;
  discipleCapacity: number;
  buildingCapacity: number;
  /** 资源容量倍率：所有资源的 base capacity × 此值 = 该等级的实际容量。 */
  capacityMultiplier: number;
  /** 升到此等级的资源消耗（最小单位）。level 1 是初始等级，不用。 */
  upgradeCost: Record<string, string>;
  /** 升到此等级需要的建筑条件。 */
  buildingRequirements: { defId: string; minLevel: number }[];
  /** 升到此等级需要的弟子境界条件：需要 count 名弟子的境界 >= minRealmId。 */
  discipleRequirements: { minRealmId: string; count: number }[];
  /** 升到此等级时自动解锁（创建）的建筑 def id。 */
  unlockBuildings: string[];
}

export const SECT_LEVELS: readonly SectLevelDef[] = [
  {
    level: 1,
    name: '散修驻地',
    discipleCapacity: 6,
    buildingCapacity: 3,
    capacityMultiplier: 1,
    upgradeCost: {},
    buildingRequirements: [],
    discipleRequirements: [],
    unlockBuildings: [],
  },
  {
    level: 2,
    name: '小门小派',
    discipleCapacity: 9,
    buildingCapacity: 4,
    capacityMultiplier: 1.5,
    upgradeCost: { spiritStone: '200000', ore: '100000' },
    buildingRequirements: [{ defId: 'spiritualArray', minLevel: 2 }],
    discipleRequirements: [{ minRealmId: 'foundationEstablishment', count: 1 }],
    unlockBuildings: ['scriptureLibrary'],
  },
  {
    level: 3,
    name: '三流宗门',
    discipleCapacity: 12,
    buildingCapacity: 4,
    capacityMultiplier: 2,
    upgradeCost: { spiritStone: '500000', ore: '200000', herb: '100000' },
    buildingRequirements: [{ defId: 'missionHall', minLevel: 2 }],
    discipleRequirements: [{ minRealmId: 'foundationEstablishment', count: 2 }],
    unlockBuildings: [],
  },
  {
    level: 4,
    name: '二流宗门',
    discipleCapacity: 15,
    buildingCapacity: 5,
    capacityMultiplier: 3,
    upgradeCost: { spiritStone: '1000000', ore: '400000', herb: '200000' },
    buildingRequirements: [{ defId: 'spiritualArray', minLevel: 3 }],
    discipleRequirements: [{ minRealmId: 'goldenCore', count: 1 }],
    unlockBuildings: ['arenaHall'],
  },
  {
    level: 5,
    name: '一流宗门',
    discipleCapacity: 20,
    buildingCapacity: 6,
    capacityMultiplier: 4,
    upgradeCost: { spiritStone: '2000000', ore: '800000', herb: '400000' },
    buildingRequirements: [{ defId: 'herbGarden', minLevel: 3 }],
    discipleRequirements: [{ minRealmId: 'goldenCore', count: 2 }],
    unlockBuildings: [],
  },
  {
    level: 6,
    name: '名门大派',
    discipleCapacity: 23,
    buildingCapacity: 6,
    capacityMultiplier: 5,
    upgradeCost: { spiritStone: '3000000', ore: '1200000', herb: '600000' },
    buildingRequirements: [{ defId: 'scriptureLibrary', minLevel: 2 }],
    discipleRequirements: [{ minRealmId: 'goldenCore', count: 3 }],
    unlockBuildings: [],
  },
  {
    level: 7,
    name: '地方霸主',
    discipleCapacity: 26,
    buildingCapacity: 7,
    capacityMultiplier: 7,
    upgradeCost: { spiritStone: '4000000', ore: '1600000', herb: '800000' },
    buildingRequirements: [{ defId: 'arenaHall', minLevel: 2 }],
    discipleRequirements: [{ minRealmId: 'nascentSoul', count: 1 }],
    unlockBuildings: [],
  },
  {
    level: 8,
    name: '十大宗门',
    discipleCapacity: 29,
    buildingCapacity: 7,
    capacityMultiplier: 10,
    upgradeCost: { spiritStone: '5000000', ore: '2000000', herb: '1000000' },
    buildingRequirements: [{ defId: 'scriptureLibrary', minLevel: 3 }],
    discipleRequirements: [{ minRealmId: 'nascentSoul', count: 2 }],
    unlockBuildings: [],
  },
  {
    level: 9,
    name: '顶级圣地',
    discipleCapacity: 32,
    buildingCapacity: 8,
    capacityMultiplier: 14,
    upgradeCost: {
      spiritStone: '5000000',
      ore: '2000000',
      herb: '1200000',
      spiritualEnergy: '2000000',
    },
    buildingRequirements: [{ defId: 'arenaHall', minLevel: 3 }],
    discipleRequirements: [{ minRealmId: 'spiritTransformation', count: 1 }],
    unlockBuildings: [],
  },
  {
    level: 10,
    name: '仙门至尊',
    discipleCapacity: 35,
    buildingCapacity: 8,
    capacityMultiplier: 20,
    upgradeCost: {
      spiritStone: '5000000',
      ore: '2000000',
      herb: '1500000',
      spiritualEnergy: '3000000',
    },
    buildingRequirements: [],
    discipleRequirements: [{ minRealmId: 'spiritTransformation', count: 3 }],
    unlockBuildings: [],
  },
];

export const MAX_SECT_LEVEL = SECT_LEVELS.length;

/** 查等级定义；越界（脏数据）退化为 1 级，避免视图整体报错。 */
export function findSectLevel(level: number): SectLevelDef {
  return SECT_LEVELS[level - 1] ?? SECT_LEVELS[0]!;
}

/** 下一等级定义；已满级返回 null。 */
export function nextSectLevel(currentLevel: number): SectLevelDef | null {
  return currentLevel >= MAX_SECT_LEVEL ? null : (SECT_LEVELS[currentLevel] ?? null);
}

/** 境界在 REALMS 数组中的下标，用于比较高低（未知 id 视为最低）。 */
export function realmIndex(realmId: string): number {
  const index = REALMS.findIndex((realm) => realm.id === realmId);
  return index < 0 ? 0 : index;
}

/** 实际资源容量 = 基础容量 × 宗门等级倍率（取整）。 */
export function effectiveCapacity(baseCapacity: string, multiplier: number): number {
  return Math.floor(Number(baseCapacity) * multiplier);
}

/** 藏经阁建筑 id（修炼加速来源）。 */
export const SCRIPTURE_LIBRARY_BUILDING_ID = 'scriptureLibrary';

/** 藏经阁每级给修炼速度的加成（基点，1000 = 10%）。 */
export const SCRIPTURE_LIBRARY_CULTIVATION_BONUS_BP_PER_LEVEL = 1000;

/** 灵矿（原任务堂）建筑 id：灵石基础产出的加成来源（V5.1 改动二）。 */
export const MISSION_HALL_BUILDING_ID = 'missionHall';

/** 灵矿每级给灵石基础产出的加成（基点，2000 = +20%）。 */
export const MISSION_HALL_SPIRIT_STONE_BONUS_BP_PER_LEVEL = 2000;

/** 采灵（灵石采集）岗位 id：对应配置里的 positions.id（V5.1 改动三）。 */
export const STONE_MINING_ASSIGNMENT = 'stoneMining';

/** 采灵岗位人数上限：宗门 6 级前每人限 1 人。 */
export const STONE_MINING_LIMIT_LOW = 1;

/** 采灵岗位人数上限：宗门 6 级起限 2 人。 */
export const STONE_MINING_LIMIT_HIGH = 2;

/** 采灵岗位人数上限提到 high 的宗门等级门槛。 */
export const STONE_MINING_UNLOCK_SECT_LEVEL = 6;

/**
 * 天赋定义（V4 第二节）。天赋是代码常量，不进 game-config：
 * 每个弟子的 talent 列存 id，这里的映射负责展示名与加成对象。
 *
 * 天赋与岗位的对应关系：
 * - `herbGathering` → 弟子在 `herbGathering` 岗位时产出 ×1.2
 * - `mining`        → 弟子在 `oreGathering` 岗位时产出 ×1.2
 * - `cultivation`   → 弟子在 `cultivating` 岗位时修炼速度 ×1.2
 * - `combat`        → 战力计算时 ×1.15
 */
export interface TalentDef {
  id: string;
  name: string;
  description: string;
}

export const TALENTS: readonly TalentDef[] = [
  { id: 'herbGathering', name: '采药天赋', description: '采药岗位产出 +20%' },
  { id: 'mining', name: '炼矿天赋', description: '采矿岗位产出 +20%' },
  { id: 'cultivation', name: '修炼天赋', description: '修炼速度 +20%' },
  { id: 'combat', name: '战斗天赋', description: '战斗力 +15%' },
];

export const TALENT_IDS = TALENTS.map((talent) => talent.id);

export function findTalent(talentId: string): TalentDef | undefined {
  return TALENTS.find((talent) => talent.id === talentId);
}

/** 天赋加成基点值（10000 = 1.0x）。 */
export const TALENT_POSITION_BONUS_BP = 2000; // 岗位产出 +20%
export const TALENT_CULTIVATION_BONUS_BP = 2000; // 修炼速度 +20%
export const TALENT_COMBAT_BONUS_BP = 1500; // 战斗力 +15%

/* ---------- V5 挑战系统 ---------- */
/** 守擂阵容 / 出战阵容固定 3 人；顺序即对阵顺序（view 与 service 共用同一判定）。 */
export const DEFENSE_LINEUP_SIZE = 3;
 
/* ---------- V5.2 招贤台刷新 ---------- */
/**
 * 每个宗门等级（境界）的招贤刷新额度：升级即重置，未用次数不累积。
 * 刷新免费（不消耗资源，也不消耗每日招募次数），只换一批候选人。
 */
export const RECRUIT_REFRESH_PER_LEVEL = 3;
