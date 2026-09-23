import {
  basisPointsSchema,
  countSchema,
  decimalAmountSchema,
  positiveIntSchema,
  stableIdSchema,
} from '@xiuxian/contracts';
import { z } from 'zod';

/**
 * 游戏配置 schema（P0-03 基线；数值出处均为 03 的「测试基线」，不是新决策）。
 *
 * 全部使用 strictObject：配置里出现未声明字段就直接失败，避免「字段名打错导致静默失效」。
 * 语义层面的引用/重复/范围检查在 validate.ts（schema 只能表达单字段约束）。
 */

/** 条目可见性：internal 的条目不会进入 /config/public。 */
export const configVisibilitySchema = z.enum(['public', 'internal']).default('public');
export type ConfigVisibility = z.infer<typeof configVisibilitySchema>;

/** 资源 id：灵石/灵气/药材/矿石等，小驼峰稳定标识。 */
export const resourceIdSchema = stableIdSchema;

/** 成本/产出：资源 id -> 最小单位十进制字符串。 */
export const amountByResourceSchema = z.record(resourceIdSchema, decimalAmountSchema);

export const resourceDefSchema = z.strictObject({
  id: resourceIdSchema,
  name: z.string().min(1).max(32),
  startAmount: decimalAmountSchema,
  capacity: decimalAmountSchema,
  /** 无派工时的基础产量/小时（最小单位）。 */
  baseRatePerHour: decimalAmountSchema,
  visibility: configVisibilitySchema,
});

export const buildingDefSchema = z.strictObject({
  id: stableIdSchema,
  name: z.string().min(1).max(32),
  maxLevel: positiveIntSchema,
  /** 升级成本 = 每个资源的 perLevel 值 × 当前等级（03 第 2 节）。 */
  upgradeCostPerLevel: amountByResourceSchema,
  visibility: configVisibilitySchema,
});

/**
 * 岗位（03 第 4 节的 assignment 枚举中 P1 有产出的几种）。
 * V5.1 第 3 节新增 `stoneMining`（采灵：每小时产灵石，人数上限由服务端按宗门等级限制）。
 */
export const positionIdSchema = z.enum(['cultivating', 'herbGathering', 'oreGathering', 'stoneMining']);

export const positionDefSchema = z.strictObject({
  id: positionIdSchema,
  name: z.string().min(1).max(32),
  /** 每个岗位上的弟子每小时产出（最小单位）。 */
  outputPerHourPerDisciple: amountByResourceSchema,
  visibility: configVisibilitySchema,
});

export const sectInitSchema = z.strictObject({
  initialLevel: positiveIntSchema,
  initialVeinLevel: positiveIntSchema,
  initialDiscipleCapacity: positiveIntSchema,
  initialBuildingCapacity: positiveIntSchema,
  /** 创建宗门时赠送的建筑（每类型仅一座）。 */
  initialBuildings: z.array(
    z.strictObject({
      defId: stableIdSchema,
      level: positiveIntSchema,
    }),
  ),
  /** 创建宗门时赠送的弟子与其初始岗位。 */
  initialDisciples: z.array(
    z.strictObject({
      realm: z.string().min(1).max(16),
      stage: positiveIntSchema,
      assignment: z.enum(['idle', 'cultivating', 'herbGathering', 'oreGathering']),
    }),
  ),
});

export const recruitmentConfigSchema = z.strictObject({
  dailyLimit: countSchema,
  cost: amountByResourceSchema,
});

export const cultivationConfigSchema = z.strictObject({
  /**
   * 每小时基础修为：非负整数（03 第 1 节：修为是无符号整数，不用「最小单位字符串」；
   * 03 第 4 节基线值 60）。
   */
  baseRatePerHour: countSchema,
  /** 资质系数 = baseBp + aptitude × perPointBp（基点，03 第 4 节基线 8000 + aptitude×40）。 */
  aptitudeCoefficientBaseBp: basisPointsSchema,
  aptitudeCoefficientPerPointBp: countSchema,
  /**
   * 各类成长加成归一化后的总上限：基点，但**允许超过 10000**（超过 1 倍加成），
   * 所以用非负整数而不是 basisPointsSchema。
   */
  maxTotalBonusBp: countSchema,
});

export const breakthroughConfigSchema = z.strictObject({
  baseChanceBp: basisPointsSchema,
  minChanceBp: basisPointsSchema,
  maxChanceBp: basisPointsSchema,
  /** 失败后保留门槛修为的比例（基点）。 */
  failureKeepBp: basisPointsSchema,
  cooldownSeconds: countSchema,
});

export const gameConfigContentSchema = z.strictObject({
  server: z.strictObject({
    code: z.string().min(1).max(32),
    /** V1 按 UTC+8 划分自然日/周（03 第 1 节，D05 待确认），这里只校验格式。 */
    timeZone: z.string().regex(/^(UTC[+-]\d{1,2}(:\d{2})?|[A-Za-z]+\/[A-Za-z_]+)$/u, '必须是 UTC 偏移或 IANA 时区名'),
  }),
  /** 离线经济上限（秒）：03 第 3 节的 C = 12 小时。 */
  offlineCapSeconds: z.int().min(0).max(86_400),
  resources: z.array(resourceDefSchema).min(1),
  buildings: z.array(buildingDefSchema).min(1),
  positions: z.array(positionDefSchema),
  sect: sectInitSchema,
  recruitment: recruitmentConfigSchema,
  cultivation: cultivationConfigSchema,
  breakthrough: breakthroughConfigSchema,
});

export type GameConfigContent = z.infer<typeof gameConfigContentSchema>;
export type ResourceDef = z.infer<typeof resourceDefSchema>;
export type BuildingDef = z.infer<typeof buildingDefSchema>;
export type PositionDef = z.infer<typeof positionDefSchema>;
