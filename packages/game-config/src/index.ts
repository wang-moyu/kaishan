import type { GameConfigContent } from '@xiuxian/game-core';

/**
 * packages/game-config：带版本的静态配置（P0-03 基线）。
 *
 * 数值出处：除标注为 V2-1 的新增项外，全部来自 03 的「测试基线」：
 * - 四种资源的起始值/产量/容量：03 第 2 节（展示单位 ×1000 = 最小单位）；
 * - 建筑上限 5（P0 原为 3，V2-1 提高）与升级成本（灵石 50×当前等级、矿石 10×当前等级）：03 第 2 节；
 * - 藏经阁/演武场两座建筑：V2-1 第 3.2 节（V2-1 新增，非 03 基线）；
 * - 任务堂改名「灵矿」（id 仍是 missionHall，避免与库里已有 def_id 不匹配）：V5.1 第 2 节
 * - 岗位产量（药园 20 药材/小时、采矿 15 矿石/小时）：03 第 2 节；采灵 15 灵石/小时：V5.1 第 3 节；
 * - 弟子初始 3 人、初始等级上限 6/建筑上限 3、赠三座 Lv1 建筑：03 第 2 节（运行期上限由 SECT_LEVELS 等级决定）；
 * - 招募每日 3 次、每次 50 灵石：03 第 4 节；
 * - 修炼基础 60/小时、资质系数 8000 + 资质×40 基点：03 第 4 节；
 * - 突破基础 8000 基点、clamp 到 500～9500、失败保留 90%、冷却 5 分钟：03 第 4 节；
 * - 离线经济上限 12 小时 = 43200 秒：03 第 3 节（D04 待确认）。
 *
 * 资源类字段一律用「最小单位」十进制字符串（1 展示单位 = 1000 最小单位）；
 * 修为是非负整数，不用字符串。
 */

/** 版本号：内容变化时必须同步更新版本与 payloadHash（见 03 第 12 节）。 */
export const GAME_CONFIG_VERSION = 'v5.1.0';

/**
 * 内容哈希（sha256:，覆盖规范化后的 JSON）。
 * 修改 content 后必须重新计算，否则 Worker 启动与 config:hash 校验都会失败。
 */
export const GAME_CONFIG_PAYLOAD_HASH =
  'sha256:7cba811dc2e4ad282590c8c98299a82cb22a1ddb46c5f6dc55068b00dee16514';

export const GAME_CONFIG_CONTENT: GameConfigContent = {
  server: {
    code: 's1',
    timeZone: 'UTC+8',
  },
  offlineCapSeconds: 43_200,
  resources: [
    {
      id: 'spiritStone',
      name: '灵石',
      startAmount: '200000',
      capacity: '5000000',
      baseRatePerHour: '30000',
      visibility: 'public',
    },
    {
      id: 'spiritualEnergy',
      name: '灵气',
      startAmount: '100000',
      capacity: '3000000',
      baseRatePerHour: '20000',
      visibility: 'public',
    },
    {
      id: 'herb',
      name: '药材',
      startAmount: '40000',
      capacity: '2000000',
      baseRatePerHour: '0',
      visibility: 'public',
    },
    {
      id: 'ore',
      name: '矿石',
      startAmount: '40000',
      capacity: '2000000',
      baseRatePerHour: '0',
      visibility: 'public',
    },
  ],
  buildings: [
    {
      id: 'spiritualArray',
      name: '聚灵阵',
      maxLevel: 5,
      upgradeCostPerLevel: { spiritStone: '50000', ore: '10000' },
      visibility: 'public',
    },
    {
      id: 'herbGarden',
      name: '灵药园',
      maxLevel: 5,
      upgradeCostPerLevel: { spiritStone: '50000', ore: '10000' },
      visibility: 'public',
    },
    {
      id: 'missionHall',
      name: '灵矿',
      maxLevel: 5,
      upgradeCostPerLevel: { spiritStone: '50000', ore: '10000' },
      visibility: 'public',
    },
    {
      id: 'scriptureLibrary',
      name: '藏经阁',
      maxLevel: 5,
      upgradeCostPerLevel: { spiritStone: '60000', herb: '20000' },
      visibility: 'public',
    },
    {
      id: 'arenaHall',
      name: '演武场',
      maxLevel: 5,
      upgradeCostPerLevel: { spiritStone: '80000', ore: '30000' },
      visibility: 'public',
    },
  ],
  positions: [
    {
      id: 'cultivating',
      name: '修炼',
      // 修炼产出修为而不是资源（03 第 4 节：挂机修炼不持续扣灵气）
      outputPerHourPerDisciple: {},
      visibility: 'public',
    },
    {
      id: 'herbGathering',
      name: '药园',
      outputPerHourPerDisciple: { herb: '20000' },
      visibility: 'public',
    },
    {
      id: 'oreGathering',
      name: '采矿',
      outputPerHourPerDisciple: { ore: '15000' },
      visibility: 'public',
    },
    {
      // V5.1 第 3 节：采灵岗位（每小时 15000 最小单位 = 15 展示单位灵石/人）
      id: 'stoneMining',
      name: '采灵',
      outputPerHourPerDisciple: { spiritStone: '15000' },
      visibility: 'public',
    },
  ],
  sect: {
    initialLevel: 1,
    initialVeinLevel: 1,
    initialDiscipleCapacity: 6,
    initialBuildingCapacity: 3,
    initialBuildings: [
      { defId: 'spiritualArray', level: 1 },
      { defId: 'herbGarden', level: 1 },
      { defId: 'missionHall', level: 1 },
    ],
    initialDisciples: [
      { realm: 'qiRefining', stage: 1, assignment: 'cultivating' },
      { realm: 'qiRefining', stage: 1, assignment: 'herbGathering' },
      { realm: 'qiRefining', stage: 1, assignment: 'oreGathering' },
    ],
  },
  recruitment: {
    dailyLimit: 3,
    cost: { spiritStone: '50000' },
  },
  cultivation: {
    baseRatePerHour: 60,
    aptitudeCoefficientBaseBp: 8000,
    aptitudeCoefficientPerPointBp: 40,
    maxTotalBonusBp: 20_000,
  },
  breakthrough: {
    baseChanceBp: 8000,
    minChanceBp: 500,
    maxChanceBp: 9500,
    failureKeepBp: 9000,
    cooldownSeconds: 300,
  },
};

/** 供 Worker 启动校验使用的完整来源（版本 + 哈希 + 内容）。 */
export const gameConfigSource = {
  version: GAME_CONFIG_VERSION,
  payloadHash: GAME_CONFIG_PAYLOAD_HASH,
  content: GAME_CONFIG_CONTENT,
} as const;

export const PACKAGE_NAME = '@xiuxian/game-config' as const;
