import type { GameConfigContent } from '@xiuxian/game-core';

import {
  alchemyUnlockBlockedReason,
  bodyTemperingTarget,
  firstInsufficientResource,
  BODY_TEMPERING_MAX_USES,
  PILL_RECIPES,
  CULTIVATION_PILL_GAIN,
} from './alchemy';
import {
  CHALLENGE_DAILY_LIMIT,
  lineupContainsDisciple,
  type ChallengeDayState,
  type DefenseMode,
  type RewardTier,
} from './challenge';
import {
  DAO_INSIGHT_CAP,
  DEBATE_DAILY_LIMIT,
  WHEEL_RESET_COST,
  WHEEL_TIERS,
  gamblingUnlockBlockedReason,
  generateWheelSlots,
  wheelLayoutSeed,
  wheelSlotLabel,
  wheelSpinCost,
  type DebateDayState,
} from './gambling';
import { SHOP_BUY_PRICE, SHOP_PILL_PRICES, SHOP_SELL_PRICE } from './shop';
import {
  DEFENSE_LINEUP_SIZE,
  BREAKTHROUGH_ARRAY_BONUS_BP_PER_LEVEL,
  IDLE_ASSIGNMENT,
  SPIRITUAL_ARRAY_BUILDING_ID,
  SCRIPTURE_LIBRARY_BUILDING_ID,
  STONE_MINING_ASSIGNMENT,
  STONE_MINING_LIMIT_HIGH,
  STONE_MINING_LIMIT_LOW,
  STONE_MINING_UNLOCK_SECT_LEVEL,
  breakthroughEnergyCost,
  effectiveCapacity,
  findRealm,
  findSectLevel,
  findStage,
  findTalent,
  nextSectLevel,
  realmIndex,
} from './constants';
import { RECENT_EVENTS_IN_SYNC, eventNameOf, type TriggeredEvent } from './events';
import {
  DISCIPLE_NAME_MAX_CHARS,
  DISCIPLE_NAME_MIN_CHARS,
  DISCIPLE_RENAME_COST,
  SECT_NAME_MAX_CHARS,
  SECT_NAME_MIN_CHARS,
  SECT_RENAME_COST,
  attributeScore,
} from './names';
import { discipleCombatPower } from './realms';
import type {
  BuildingRow,
  DiscipleRow,
  EventLogRow,
  PillInventoryRow,
  ResourceBalanceRow,
  SectRow,
  DiscipleJourneyRow,
} from './repository';
import {
  JOURNEY_HISTORY_LIMIT,
  JOURNEY_MAX_CONCURRENT,
  JOURNEY_MIN_DISCIPLES_AT_HOME,
  findJourneyDirection,
  journeyAwayIds,
  journeyEligibilityBlockedReason,
  journeyInjuryUntil,
  journeyStatusOf,
  type JourneyDirection,
  type JourneyStatus,
  asJourneyDirection,
  parseJourneyRewardResources,
} from './journey';
import { cultivationRatePerHour, resourceRates, type DiscipleState, type SettleResult } from './settle';
/**
 * 接口返回的视图类型（前端只读这些字段，不需要再读配置）。
 *
 * 金额类字段用「最小单位十进制字符串」（03 第 1 节：1 展示单位 = 1000 最小单位）；
 * 修为是非负整数，直接用 number。canXxx / blockedReason 由服务端算好，前端不做规则判断。
 */

export interface ResourceView {
  id: string;
  name: string;
  balance: string;
  capacity: string;
  /** 当前产量（最小单位/小时），前端据此本地平滑显示。 */
  ratePerHour: string;
  capped: boolean;
  /** 本段结算因满仓丢弃的量。 */
  discarded: string;
}

export interface EventLogView {
  id: string;
  eventId: string;
  name: string;
  description: string;
  /** resourceId -> 最小单位数量（带符号的十进制字符串）。 */
  effects: Record<string, string>;
  /** ISO 时间字符串。 */
  createdAt: string;
}

export interface DiscipleView {
  id: string;
  name: string;
  gender: string;
  aptitude: number;
  /** V4 战斗属性（1~100）。 */
  attack: number;
  defense: number;
  speed: number;
  /** 0016 幸运 / 体魄（1~100）：只作用于单人定时历练的额外收获与受伤概率。 */
  luck: number;
  physique: number;
  /** 天赋 id 与展示名（无/未知天赋时 talentName 为「无」）。 */
  talent: string;
  talentName: string;
  /** 当前战力（展示用，由 realms.ts 的 discipleCombatPower 现算）。 */
  combatPower: number;
  /**
   * 0016 综合评分：**当前**六项属性等权现算，固定一位小数（names.ts 的 attributeScore）。
   * 不是战力、也不是岗位效率：境界、修为、天赋、战力都不参与；不落库，
   * 所以淬体丹改完攻/防/速之后，服丹回执与下一次 sync 的评分自动一致。
   */
  attributeScore: number;
  realmId: string;
  realmName: string;
  stage: number;
  /**
   * 境界在服务端 REALMS 表里的下标（0 = 最低，未知 id 视为 0）。
   * 只给前端排序用：境界高低不能按名称字符串比较。
   */
  realmOrder: number;
  stageName: string;
  cultivation: number;
  /** 突破门槛；null 表示已是本版本最高阶段。 */
  requiredCultivation: number | null;
  cultivationRatePerHour: number;
  assignment: string;
  assignmentName: string;
  injuredUntil: string | null;
  canBreakthrough: boolean;
  blockedReason: string | null;
  breakthroughCost: string;
  breakthroughChanceBp: number;
  /** 已服用淬体丹次数与剩余次数（上限 BODY_TEMPERING_MAX_USES）。 */
  bodyTemperingUses: number;
  bodyTemperingRemaining: number;
  /** 服务端算好的淬体短板预览；null = 无短板或次数已用完。 */
  bodyTemperingTarget: 'attack' | 'defense' | 'speed' | null;
  /** 本次服用淬体丹的提升量；无短板时为 0。 */
  bodyTemperingGain: number;
  /** 0019 悟道值：当前可用余额（非负整数；本版本只能通过论道赌局获得）。 */
  daoInsight: number;
  /** 0019 悟道值：累计已分配点数（上限 DAO_INSIGHT_CAP = 50）。 */
  daoInsightUsed: number;
  /** 0019 悟道值：剩余可分配额度 = max(0, 上限 - daoInsightUsed)。 */
  daoInsightRemaining: number;
  /**
   * 0013 掌门私有备注（单行纯文本，≤60 字，空串 = 未填写）。
   * 只出现在登录玩家自己的 SectStateView；公开档案 / 排行榜 / 战报不含此字段。
   */
  note: string;
  /**
   * 0017 头像框 id（'classic' 或 'frame01'…'frame20'，固定 21 个值；0018 扩到 20 张素材）。
   * 只出现在登录玩家自己的 SectStateView；公开档案 / 排行榜 / 战报 / 招贤候选人不含此字段。
   */
  avatarFrameId: string;
  /**
   * 0014 历练状态：none / active / ready + 名额与不可出发原因（全部服务端算好）。
   */
  journey: DiscipleJourneyView;
}

export interface BuildingView {
  defId: string;
  name: string;
  level: number;
  maxLevel: number;
  /** 升到下一级的消耗（最小单位）；已满级为 null。 */
  upgradeCost: Record<string, string> | null;
  canUpgrade: boolean;
  blockedReason: string | null;
}

/**
 * 招贤面板。
 * 0021 起「每日 3 次」上限已去掉：宗门等级决定的弟子上限是唯一门槛
 * （config.recruitment.dailyLimit 保留在配置里但不再参与判定，只作为历史字段）。
 */
export interface RecruitView {
  cost: Record<string, string>;
  /** 还能招几个人（= 弟子上限 − 现有弟子数，不小于 0）。 */
  remaining: number;
  discipleCount: number;
  discipleCapacity: number;
  canRecruit: boolean;
  blockedReason: string | null;
}

export interface AssignmentOptionView {
  id: string;
  name: string;
  /** 该岗位当前占用人数；null = 无人数限制（V5.1 改动三）。 */
  currentCount: number | null;
  /** 该岗位人数上限；null = 无人数限制。 */
  maxCount: number | null;
}

/** 宗门升级信息：条件逐条给前端（前端不做规则判断，只渲染 ✓/✗）。 */
export interface SectUpgradeView {
  nextLevel: number;
  nextLevelName: string;
  cost: Record<string, string>;
  requirements: { label: string; met: boolean }[];
  canUpgrade: boolean;
  blockedReason: string | null;
}

/** 单个丹方视图：owned / canCraft / blockedReason 都由服务端算好（丹方定义在 alchemy.ts）。 */
export interface AlchemyRecipeView {
  id: string;
  name: string;
  description: string;
  /** 单颗炼制成本（最小单位）。 */
  cost: Record<string, string>;
  /** 当前库存（非负整数；没有库存行视为 0）。 */
  owned: number;
  /** 是否可炼制（解锁 + 资源足够一颗；数量 × 成本的精确检查由 craft 服务执行）。 */
  canCraft: boolean;
  blockedReason: string | null;
}

/** 炼丹面板视图（解锁判断只在服务端实现，前端只渲染）。 */
export interface AlchemyView {
  unlocked: boolean;
  blockedReason: string | null;
  recipes: AlchemyRecipeView[];
  /**
   * 聚气丹单次修为增益（= 服务端 alchemy.ts 的 CULTIVATION_PILL_GAIN）。
   * 由服务端下发，前端只渲染，避免在 UI 里复制一份丹药常量（计划 2.3「不复制判定公式」）。
   */
  cultivationPillGain: number;
}

/**
 * 0019 论道赌局结果视图（POST /game/dao-debate 的 result）。
 *
 * 文案（赌注/奖励描述与 message）在服务端拼好：单位换算与中文措辞只保留一份口径；
 * revealHints 是幸运侦查提示（纯展示，不参与胜负）；winProbability 是 jev 原始胜率，
 * 本地降级判定时为 null（前端据此判断「本次判定没有用模型」）。
 */
export interface DaoDebateResultView {
  discipleId: string;
  discipleName: string;
  /** 'preset_spirit_stone' | 'free_resource' | 'attribute'。 */
  betMode: string;
  multiplier: number;
  result: 'win' | 'lose';
  /** 赌注描述（给前端展示用）。 */
  stakeDescription: string;
  /** 奖励描述（给前端展示用）。 */
  rewardDescription: string;
  /** 侦查提示（幸运高时有值）。 */
  revealHints: string[];
  /** 对手六项属性（纯展示，基于弟子属性 × 倍率系数 + 随机扰动）。 */
  opponent: Record<string, number>;
  /**
   * 弟子下注当时的六项属性快照（与 opponent 同一时刻、同一口径）。
   * 结算可能改属性（属性赌注落败会扣点），而对峙界面要并排展示双方数值，
   * 所以必须读这份快照，不能读实时的弟子状态（否则两边数字不同源）。
   */
  discipleAttributes: Record<string, number>;
  /** jev 原始胜率（0~1 小数）；降级时为 null。 */
  winProbability: number | null;
  message: string;
}

/** 0019 悟道值加点回执（POST /game/allocate-dao-insight 的 outcome）。 */
export interface InsightAllocateOutcome {
  discipleId: string;
  discipleName: string;
  attribute: string;
  points: number;
  /** 加点后的该属性值。 */
  newValue: number;
  /** 加点后剩余的可用悟道值。 */
  remainingInsight: number;
  /** 加点后累计已分配点数（上限 DAO_INSIGHT_CAP）。 */
  totalUsed: number;
}

/**
 * 0020 天机轮的单个格子（SectStateView.gambling.wheel.slots 的元素）。
 *
 * 只给「这格是什么、多少倍、叫什么」：转盘怎么画由前端决定，
 * 但类型、倍率与格面文案一律是服务端的口径（计划 4.1），前端不复制奖励公式与中文名词。
 */
export interface WheelSlotView {
  /** 'spirit_stone' | 'big_spirit_stone' | 'herb' | 'ore' | 'pill' | 'nothing'。 */
  type: string;
  /** 格子倍率（0.8~1.5）；谢谢惠顾为 0，丹药格带值但不参与奖励计算。 */
  multiplier: number;
  /** 格面文案（如「灵石 ×1.3」「谢谢惠顾」）。 */
  label: string;
}

/**
 * 0020 天机轮面板（SectStateView.gambling.wheel）。
 *
 * seed 是格局种子（= sects.wheel_seed，重置 +1）；slots 由它确定性生成，
 * 所以每次 sync 看到的转盘都一样。costs / resetCost 也由服务端下发（计划 2.3 / 2.4）。
 */
export interface WheelView {
  seed: number;
  slots: WheelSlotView[];
  /** 各档位的转动费用（最小单位；1 展示单位 = 1000 最小单位）。 */
  costs: { tier: number; cost: number }[];
  /** 重置费用（最小单位）。 */
  resetCost: number;
}

/**
 * 0020 天机轮转动结果（POST /game/wheel-spin 的 result，计划 4.2）。
 *
 * 文案在服务端拼好；slotIndex 是命中的格子下标（对应 wheel.slots 的顺序），
 * 前端只用它决定转盘停在哪个角度，奖励一律照 reward 渲染。
 */
export interface WheelSpinResultView {
  /** 命中的格子下标（0 ~ slots.length-1）。 */
  slotIndex: number;
  /** 投入档位（1~5）。 */
  tier: number;
  /** 本次实际扣掉的灵石（最小单位，字符串）。 */
  cost: string;
  /** 命中格子的格面文案（与 wheel.slots[slotIndex].label 一致，结果面板直接渲染）。 */
  slotLabel: string;
  reward: {
    type: 'resource' | 'pill' | 'none';
    /** type = 'resource' 时有值。 */
    resourceId?: string;
    /** type = 'resource' 时有值（最小单位）。 */
    amount?: string;
    /** type = 'pill' 时有值。 */
    pillId?: string;
    pillName?: string;
    quantity?: number;
  };
  /** 服务端拼好的结果文案。 */
  message: string;
}

/**
 * 0024 灵兽竞逐状态（GET /game/race-state 的返回值）。
 *
 * 前端根据 phase 切换界面：betting 投注 → sealed 封盘/动画 → settled 结算结果 → closed 休赛。
 */
export interface RaceStateView {
  /** 当前轮次的 round_key（如 "2026-09-23T08:00"）。 */
  roundKey: string;
  /** 当前阶段。 */
  phase: 'betting' | 'sealed' | 'settled' | 'closed';
  /** 距下一阶段切换的剩余秒数。 */
  remainingSeconds: number;
  /** 5 只灵兽的信息。 */
  beasts: RaceBeastView[];
  /** 总投注池（最小单位）。 */
  totalPool: string;
  /** 当前玩家在本轮的投注列表。 */
  myBets: RaceMyBetView[];
  /** 当前玩家在本轮的投注总额（最小单位）。 */
  myTotalBet: string;
  /** 结算后：冠军下标（0~4），未结算时为 null。 */
  winnerIndex: number | null;
  /** 结算后：每匹灵兽的最终名次（1-based），未结算时为 null。 */
  ranks: number[] | null;
  /** 结算后：动画序列（5 × 8），未结算时为 null。 */
  steps: number[][] | null;
  /** 结算后：当前玩家本轮赢得的灵石（最小单位），未结算时为 null。 */
  myWinnings: string | null;
  /** 本轮所有投注动态（按时间倒序）。 */
  betFeed: RaceBetFeedView[];
}

export interface RaceBeastView {
  index: number;
  name: string;
  weight: number;
  winRate: number;
  /** 该灵兽上的总投注额（最小单位）。 */
  pool: string;
  /** 互赌倍率（一位小数）；无人投注时为 0。 */
  odds: number;
}

export interface RaceMyBetView {
  beastIndex: number;
  beastName: string;
  amount: string;
}

export interface RaceBetFeedView {
  sectName: string;
  beastIndex: number;
  beastName: string;
  amount: string;
}

export interface RaceBeastStatView {
  index: number;
  name: string;
  wins: number;
  winRate: number;
}

export interface RaceHistoryRoundView {
  roundKey: string;
  winnerIndex: number;
  winnerName: string;
  totalPool: string;
  winnerOdds: number;
  settledAt: number;
}

export interface RaceHistoryView {
  beastStats: RaceBeastStatView[];
  rounds: RaceHistoryRoundView[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * 坊市的单种丹药（SectStateView.shop.pills 的元素）。
 * owned 是当前库存（颗），sellPrice 是单颗回收价（最小单位灵石，写死在 shop.ts）。
 */
export interface ShopPillView {
  id: string;
  name: string;
  owned: number;
  sellPrice: number;
}

/**
 * 坊市面板（SectStateView.shop，计划 4.1）。
 *
 * 价格一律由服务端下发（前端只做预览，不复制换算公式）；pills 覆盖全部有回收价的丹方，
 * 库存为 0 也照原样下发。坊市没有解锁条件：1 级宗门即可使用。
 */
export interface ShopView {
  /** 买 1 展示单位材料花多少灵石（最小单位）。 */
  buyPrice: number;
  /** 卖 1 展示单位材料得多少灵石（最小单位）。 */
  sellPrice: number;
  pills: ShopPillView[];
}

/** 坊市买入结果（POST /game/shop-buy 的 result，计划 4.2）。 */
export interface ShopBuyResultView {
  action: 'buy';
  resourceId: string;
  resourceName: string;
  /** 买入的材料数量（展示单位整数）。 */
  amount: number;
  /** 花费的灵石（最小单位）。 */
  cost: number;
  /** 服务端拼好的结果文案。 */
  message: string;
}

/** 坊市卖出材料结果（POST /game/shop-sell 的 result，计划 4.3）。 */
export interface ShopSellResultView {
  action: 'sell';
  resourceId: string;
  resourceName: string;
  /** 卖出的材料数量（展示单位整数）。 */
  amount: number;
  /** 获得的灵石（最小单位）。 */
  revenue: number;
  /** 服务端拼好的结果文案。 */
  message: string;
}

/** 坊市售丹结果（POST /game/shop-sell-pill 的 result，计划 4.4）。 */
export interface ShopSellPillResultView {
  action: 'sell-pill';
  pillId: string;
  pillName: string;
  /** 卖出的丹药颗数。 */
  quantity: number;
  /** 获得的灵石（最小单位）。 */
  revenue: number;
  /** 服务端拼好的结果文案。 */
  message: string;
}

/** 赌坊详细记录条目（GET /game/debate-history 的单条）。 */
export interface DebateHistoryEntryView {
  id: string;
  discipleName: string;
  betMode: string;
  multiplier: number;
  result: 'win' | 'lose';
  stakeDetail: string;
  rewardDetail: string;
  winProbability: number | null;
  createdAt: string;
}

/** 赌坊详细记录（GET /game/debate-history 的 data）：分页 + 条目列表。 */
export interface DebateHistoryView {
  entries: DebateHistoryEntryView[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** 单条历练对弟子的归约状态（none = 没有未领取记录）。 */
export type JourneyStatusView = JourneyStatus;

/** 历练结果（只在到期后公开；未领取时 claimedAt 为 null）。 */
export interface JourneyOutcomeView {
  /** 返程实际入账的修为（按返程时的剩余门槛封顶；最高阶段为 0）。 */
  cultivationAwarded: number;
  /** 出发时快照的计划修为（含额外收获，未按门槛截断）。 */
  cultivationPlanned: number;
  /** 资源奖励（最小单位；领取时一次性入账，不夹容量）。 */
  resources: Record<string, string>;
  /** 是否触发了额外收获（概率由出发时的幸运决定，见 journey.ts；不是固定 15%）。 */
  extraHarvest: boolean;
  /** 是否受伤（与额外收获独立，可同时发生）。 */
  injured: boolean;
  /** 出发时算出的实际受伤概率（基点）。 */
  injuryChanceBp: number;
  /** 伤势复原时间（从到期时间起算 30 分钟）；未受伤为 null。 */
  injuredUntil: string | null;
  completedAt: string | null;
  claimedAt: string | null;
}

/** 单个弟子的历练状态（DiscipleView.journey）。 */
export interface DiscipleJourneyView {
  status: JourneyStatusView;
  /** 未领取记录 id；status = 'none' 时为 null。 */
  journeyId: string | null;
  direction: JourneyDirection | null;
  directionName: string | null;
  durationSeconds: number | null;
  startedAt: string | null;
  /** 逻辑返程时间（服务器时间基准）。 */
  endsAt: string | null;
  /** 出发前岗位名（原岗位名额仍为该弟子保留）。 */
  originalAssignmentName: string | null;
  /** 已到期待领取时给出结果；未到期一律 null（不泄漏结果）。 */
  outcome: JourneyOutcomeView | null;
  /** 是否可以出发（只含与方向无关的资格）。方向自身限制见 GET /game/journey-preview。 */
  canStart: boolean;
  /** 不可出发的原因（status !== 'none' 时是归队 / 待领取说明）。 */
  blockedReason: string | null;
}

/** 最近历练摘要条目（仅本宗可见）。 */
export interface JourneyRecordView {
  id: string;
  discipleId: string;
  discipleName: string;
  direction: JourneyDirection;
  directionName: string;
  durationSeconds: number;
  status: 'active' | 'ready' | 'claimed';
  startedAt: string;
  endsAt: string;
  /** 未到期为 null。 */
  outcome: JourneyOutcomeView | null;
}

/** 宗门历练面板：名额 + 最近 10 条摘要。 */
export interface JourneyView {
  /** 尚未到期的在外人数（已到期待领取不占名额）。 */
  activeCount: number;
  maxConcurrent: number;
  /** 出发后至少要留的不在外弟子数。 */
  minAtHome: number;
  recent: JourneyRecordView[];
}

/** 单档时长的预览（GET /game/journey-preview 的 data；不展示随机结果）。 */
export interface JourneyDurationPreviewView {
  durationSeconds: number;
  durationLabel: string;
  /** 保底修为（已按当前剩余突破门槛截断；最高阶段为 0）。 */
  cultivation: number;
  /** true = 受当前突破门槛限制，展示为「最多」。 */
  cultivationCapped: boolean;
  /** 保底资源（最小单位）。 */
  resources: Record<string, string>;
  /** 额外收获概率（基点）：由幸运决定，1500 + (幸运 − 50) × 10；幸运 50 即 15%。 */
  extraChanceBp: number;
  /** 实际受伤概率（基点，已按出发时战力与体魄调整并 clamp 到方向下限）。 */
  injuryChanceBp: number;
  /** 预计返程时间（服务器时间基准）。 */
  endsAt: string;
}

/** 单个方向的预览。 */
export interface JourneyDirectionPreviewView {
  direction: JourneyDirection;
  name: string;
  description: string;
  /** 本方向当前是否可选；false 时 blockedReason 说明原因。 */
  available: boolean;
  blockedReason: string | null;
  durations: JourneyDurationPreviewView[];
}

/** 历练预览（只读，不结算、不写库；最终资格以 POST /game/start-journey 为准）。 */
export interface JourneyPreviewView {
  discipleId: string;
  discipleName: string;
  /** 是否可以出发（与方向无关的资格）。 */
  canStart: boolean;
  blockedReason: string | null;
  activeCount: number;
  maxConcurrent: number;
  directions: JourneyDirectionPreviewView[];
  serverNow: string;
}

/** 领取回执（POST /game/claim-journey 的 outcome）：本次实际入账的结果。 */
export interface JourneyClaimOutcomeView {
  journeyId: string;
  discipleId: string;
  discipleName: string;
  direction: JourneyDirection;
  directionName: string;
  /** 返程时实际入账的修为（受返程门槛封顶）。 */
  cultivationAwarded: number;
  /** 本次入账的资源（最小单位）。 */
  resources: Record<string, string>;
  extraHarvest: boolean;
  injured: boolean;
  /** 伤势复原时间（从到期时间起算 30 分钟）；未受伤为 null。 */
  injuredUntil: string | null;
  endsAt: string;
  message: string;
}

/** V6 交互式秘境探索：单个选项（label 与风险提示都由服务端下发，前端不复制文案）。 */
export interface EncounterChoiceView {
  id: string;
  label: string;
  /** 风险提示（例如「风险较高，可能受伤」）。 */
  riskHint: string;
  /** 选项风险等级（决定奖励倍率）；缺失时降级为 'normal'。 */
  risk: 'safe' | 'normal' | 'risky';
}

/** 当前等待玩家选择的遭遇场景。 */
export interface EncounterView {
  name: string;
  description: string;
  choices: EncounterChoiceView[];
}

/** 进行中的交互式探索（POST /game/realm-explore/start 与 GET /game/realm-explore/active）。 */
export interface ActiveExplorationView {
  id: string;
  /** 秘境 id（前端按 id 与秘境列表对应）。 */
  realmId: string;
  realmName: string;
  totalStages: number;
  /** 已完成的关卡数（0 = 还没走完第一关）。 */
  currentStage: number;
  encounter: EncounterView;
  /** 累计已得奖励（最小单位；key 为 resourceId）。 */
  rewardsCollected: Record<string, string>;
}

/** 单次选择的判定结果（POST /game/realm-explore/choose 的 result）。 */
export interface ExploreChoiceResultView {
  /** 决策模型判定；模型不可用时由服务端本地随机降级，取值不变。 */
  outcome: 'great_success' | 'success' | 'failure';
  /** 本关的账面奖励（整场结束时才真正入账；失败为空对象）。 */
  stageRewards: Record<string, string>;
  /** 本关受伤的弟子（未受伤为 null）。 */
  injury: { discipleName: string; until: string } | null;
  /** 成功时下一关的遭遇；通关或失败为 null。 */
  nextEncounter: EncounterView | null;
  /** 通关时的累计奖励（= rewardsCollected 入账后的总量）；未通关为 null。 */
  finalRewards: Record<string, string> | null;
  message: string;
}

/**
 * 改名面板（0021：宗门 / 弟子改名）。
 * 价格是灵石最小单位（1 展示单位 = 1000 最小单位，前端 formatAmount 做除法）；
 * 长度规则按 Unicode 码点，与后端 normalizeEntityName 同一口径。
 */
export interface RenameView {
  /** 宗门改名消耗（灵石，最小单位）。 */
  sectCost: string;
  /** 弟子改名消耗（灵石，最小单位）。 */
  discipleCost: string;
  /** 宗门名长度规则（码点）。 */
  sectNameMinChars: number;
  sectNameMaxChars: number;
  /** 弟子名长度规则（码点）。 */
  discipleNameMinChars: number;
  discipleNameMaxChars: number;
}

export interface SectStateView {
  sect: {
    id: string;
    name: string;
    level: number;
    /** 等级名称（例如「散修驻地」）。 */
    levelName: string;
    /** 声望（V3 多人互动）：切磋胜利 +10，失败/平局不变。 */
    reputation: number;
    /** 守擂阵容（弟子 id 数组，顺序即出战顺序）；null = 未设置（V5 2.4）。 */
    defenseLineup: string[] | null;
    veinLevel: number;
    discipleCapacity: number;
    buildingCapacity: number;
    lastSettledAt: string;
  };
  serverNow: string;
  resources: ResourceView[];
  disciples: DiscipleView[];
  buildings: BuildingView[];
  recruit: RecruitView;
  /** 改名消耗与名称长度规则（0021：规则与价格都由服务端给，前端只渲染与提示）。 */
  rename: RenameView;
  assignments: AssignmentOptionView[];
  /** 最近触发的事件（新的在前，最多 10 条）。 */
  recentEvents: EventLogView[];
  /** 本次结算的摘要（前端可选展示）。 */
  settle: {
    durationSeconds: number;
    cappedByOfflineLimit: boolean;
    clockWentBackwards: boolean;
    totalDiscarded: string;
  };
  /** 宗门升级信息。null = 已满级。 */
  sectUpgrade: SectUpgradeView | null;
  /** 炼丹面板（配方、库存、解锁状态；解锁判断只在服务端）。 */
  alchemy: AlchemyView;
  /** 主动挑战的当日次数（0012：每日 3 次；失败/零奖励同样消耗）。 */
  challenge: {
    dailyLimit: number;
    usedToday: number;
    remaining: number;
  };
  /** 0019 赌坊面板：解锁（宗门 2 级，不依赖建筑）与当日次数（20 次/天，论道 + 天机轮共享）。 */
  gambling: {
    unlocked: boolean;
    blockedReason: string | null;
    dailyLimit: number;
    usedToday: number;
    remaining: number;
    /** 0020 天机轮：赌坊未解锁时为 null；解锁后带当前格局与档位费用。 */
    wheel: WheelView | null;
    /** 0024 灵兽竞逐：当前轮次状态。 */
    race: RaceStateView | null;
  };
  /**
   * 坊市面板：材料买卖价格与可售丹药（没有解锁条件，1 级宗门即可使用）。
   * 价格与库存都由服务端算好，前端只渲染与预览（不复制换算公式）。
   */
  shop: ShopView;
  /** 0014 历练面板：名额 + 最近 10 条摘要（仅本宗可见）。 */
  journey: JourneyView;
  /** V6 交互式秘境探索：本宗当前进行中的一局；没有则 null（每宗门同时最多一局）。 */
  activeExploration: ActiveExplorationView | null;
}

/** 秘境列表视图（GET /game/realms）：规则（锁定/次数）由服务端算好，前端只渲染。 */
export interface SecretRealmListView {
  id: string;
  name: string;
  description: string;
  difficulty: number;
  entryCost: Record<string, string>;
  rewards: Record<string, string>;
  minParty: number;
  maxParty: number;
  /** 每日探索次数上限；null = 不限。 */
  dailyLimit: number | null;
  /** 今日已探索次数（仅 dailyLimit !== null 时统计，其余为 0）。 */
  usedToday: number;
  requiredSectLevel: number;
  /** 宗门等级不足 = true。 */
  locked: boolean;
  /** 宗门是否已建造演武场（没有则不能探索）。 */
  hasArena: boolean;
  /**
   * V6：交互式探索开关（由 env.REALM_EXPLORE_ENABLED 决定，只有 "true" 才是 true）；
   * 未启用时前端只显示「速通」，不显示「探索」。
   */
  exploreEnabled: boolean;
}

/** 单次探索结果（POST /game/explore 的 result）。 */
export interface ExplorationResultView {
  realmName: string;
  success: boolean;
  /** 本次成功率（基点，0~10000）。 */
  chanceBp: number;
  /** 本次随机掷点（0~9999）。 */
  roll: number;
  /** 成功时的实际奖励（最小单位）；失败为空对象。 */
  rewards: Record<string, string>;
  memberNames: string[];
  message: string;
}

/** 排行榜条目（V3 第二节）：综合榜，等级 → 声望 → 创建时间。 */
export interface LeaderboardEntryView {
  sectId: string;
  name: string;
  level: number;
  levelName: string;
  reputation: number;
  discipleCount: number;
  /** 最高境界弟子（用于展示「镇派之宝」）。 */
  topDisciple: {
    name: string;
    realmName: string;
    stageName: string;
  } | null;
  /** 是否是当前用户自己的宗门。 */
  isMe: boolean;
}

/** 弟子榜单条目（跨宗门，公开字段只读）。 */
export interface DiscipleLeaderboardEntryView {
  rank: number;
  discipleId: string;
  discipleName: string;
  gender: string;
  realmId: string;
  frameId: string;
  sectId: string;
  sectName: string;
  realmName: string;
  stageName: string;
  realmOrder: number;
  stage: number;
  combatPower: number;
  attributeScore: number;
  talent: string;
  talentName: string;
  /** 是否属于当前用户的宗门。 */
  isMe: boolean;
}

/** 弟子榜单（GET /game/disciple-leaderboard）：战力 top 10 + 综合分 top 10。 */
export interface DiscipleLeaderboardView {
  byCombatPower: DiscipleLeaderboardEntryView[];
  byAttributeScore: DiscipleLeaderboardEntryView[];
}

/** 全服聊天消息条目（GET /game/chat）。 */
export interface ChatMessageView {
  id: string;
  sectName: string;
  content: string;
  isMe: boolean;
  isSystem: boolean;
  createdAt: string;
}

/** 不可挑战的稳定原因码（前端据此渲染文案，不做规则判断）。 */
export type ChallengeBlockedReason =
  | 'self'
  | 'daily_limit'
  | 'already_challenged_today'
  | 'defender_insufficient';

/** 「若胜利」的确切奖励预览（数值来自 challenge.ts 档位表，前端不复制分支）。 */
export interface ChallengeRewardPreviewView {
  tier: RewardTier;
  reputation: number;
  spiritStone: number;
}

/** 公开档案里的挑战预览（相对当前用户计算；null = 观看者自己没有宗门）。 */
export interface PublicSectChallengeView {
  canChallenge: boolean;
  /** 稳定原因码；null = 可以挑战。 */
  blockedReason: ChallengeBlockedReason | null;
  /** 守擂方式：有效手动阵容 / 临时自动守擂；守方弟子不足时为 null。 */
  defenseMode: DefenseMode | null;
  /** 当日上限（固定 3）。 */
  dailyLimit: number;
  /** 当日已受理场次。 */
  usedToday: number;
  /** 当日剩余场次。 */
  remaining: number;
  /** 今日是否已挑战过该目标。 */
  alreadyChallengedToday: boolean;
  /** 守方等级 - 攻方等级。 */
  levelDifference: number;
  /** 若胜利可得的确切奖励。 */
  rewardPreview: ChallengeRewardPreviewView;
}

/**
 * 公开档案（V3 第三节）：只暴露安全字段，**不含**资源余额、修为进度、岗位、
 * 伤势、招募计数与建筑升级消耗。
 */
export interface PublicSectView {
  sectId: string;
  name: string;
  level: number;
  levelName: string;
  reputation: number;
  disciples: PublicDiscipleView[];
  buildings: PublicBuildingView[];
  /** 是否已设置**有效**的手动守擂阵容（0012 起不再代表「能否挑战」；自动守擂也可挑战）。 */
  hasDefenseLineup: boolean;
  /** 挑战预览（相对当前用户）；观看者没有宗门时为 null。 */
  challenge: PublicSectChallengeView | null;
  createdAt: string;
}

/** 公开档案里的弟子：名字/性别/境界/阶段/资质 + V4 的战斗属性与天赋。 */
export interface PublicDiscipleView {
  id: string;
  name: string;
  gender: string;
  aptitude: number;
  attack: number;
  defense: number;
  speed: number;
  talent: string;
  talentName: string;
  realmName: string;
  stageName: string;
  /** 境界在 REALMS 表里的下标（0 = 最低）：前端按境界排序只认它，不按名称字符串比较。 */
  realmOrder: number;
  /** 境界内的阶段序号（1 起）。 */
  stage: number;
  /** 境界 id：公开档案的头像与名册用同一套配色。 */
  realmId: string;
  /** 当前战力（服务端现算；只由已公开的字段算出，不泄漏私有属性）。 */
  combatPower: number;
}

/** 公开档案里的建筑：只有名称与等级，不含升级消耗。 */
export interface PublicBuildingView {
  name: string;
  level: number;
}

/** 切磋历史条目（GET /game/spar-history）。 */
export interface SparHistoryEntryView {
  id: string;
  attackerSectId: string;
  attackerSectName: string;
  defenderSectId: string;
  defenderSectName: string;
  attackerPower: number;
  defenderPower: number;
  /** 从攻方视角：'win' | 'lose' | 'draw'。 */
  result: string;
  reputationGained: number;
  /** 当前用户是攻方还是守方。 */
  role: 'attacker' | 'defender';
  createdAt: string;
}

/** 切磋战绩统计。 */
export interface SparStatsView {
  wins: number;
  losses: number;
  draws: number;
  total: number;
}

/** 切磋历史（GET /game/spar-history 的 data）。 */
export interface SparHistoryView {
  entries: SparHistoryEntryView[];
  stats: SparStatsView;
}

/** 单次切磋结果（POST /game/spar 的 result）。 */
export interface SparResultView {
  myDiscipleName: string;
  targetDiscipleName: string;
  targetSectName: string;
  myPower: number;
  targetPower: number;
  result: 'win' | 'lose' | 'draw';
  reputationGained: number;
  spiritStoneGained: number;
  message: string;
}

/** 挑战单轮战报（V5 3.4）：带双方弟子名字，供前端逐轮展示。 */
export interface ChallengeRoundView {
  round: number;
  attackerName: string;
  defenderName: string;
  attackerPower: number;
  defenderPower: number;
  /** 单轮平局（浮动后战力恰好相等）算守方胜。 */
  winner: 'attacker' | 'defender';
}

/** 单次挑战结果（POST /game/challenge 的 result，V5 3.4）。 */
export interface ChallengeResultView {
  targetSectName: string;
  rounds: ChallengeRoundView[];
  /** 从攻方（发起挑战方）视角。 */
  result: 'win' | 'lose';
  reputationGained: number;
  spiritStoneGained: number;
  message: string;
  /** 开战快照：双方宗门等级与等级差（守方 - 攻方）。 */
  attackerLevel: number;
  defenderLevel: number;
  levelDifference: number;
  /** 开战时匹配的奖励档位（失败也记录档位，实际发奖为 0）。 */
  rewardTier: RewardTier;
  /** 守擂方式快照：有效手动阵容 / 临时自动守擂。 */
  defenseMode: DefenseMode;
}

/** 挑战历史条目（GET /game/challenge-history，V5 4.1）。 */
export interface ChallengeHistoryEntryView {
  id: string;
  attackerSectName: string;
  defenderSectName: string;
  rounds: ChallengeRoundView[];
  /** 从攻方视角：'win' | 'lose'。 */
  result: string;
  /** 当前用户是攻方还是守方。 */
  role: 'attacker' | 'defender';
  reputationGained: number;
  spiritStoneGained: number;
  /**
   * 0012 开战快照；0012 迁移前的旧记录这些字段为 null，
   * 前端对 null 不显示占位（不伪造等级差/档位/守擂方式）。
   */
  attackerLevel: number | null;
  defenderLevel: number | null;
  levelDifference: number | null;
  rewardTier: RewardTier | null;
  defenseMode: DefenseMode | null;
  createdAt: string;
}

/** 挑战历史（GET /game/challenge-history 的 data）。 */
export interface ChallengeHistoryView {
  entries: ChallengeHistoryEntryView[];
  stats: { wins: number; losses: number; total: number };
}

export interface SectStateInput {
  config: GameConfigContent;
  sect: SectRow;
  disciples: readonly DiscipleRow[];
  buildings: readonly BuildingRow[];
  balances: readonly ResourceBalanceRow[];
  /** 丹药库存行（可能为空数组；没有行的 pill 视为库存 0）。 */
  pillInventories: readonly PillInventoryRow[];
  /** 主动挑战的当日次数状态（0012；日期键过期由调用方做兼容核对）。 */
  challengeDay: ChallengeDayState;
  /** 0019 赌坊：论道当日次数状态（日期键归一由调用方按 UTC+8 完成）。 */
  debateDay: DebateDayState;
  /** 赌坊战绩汇总（可选，sync 和论道返回时传入）。 */
  debateStats?: { total: number; wins: number; losses: number; netSpiritStone: number; totalInsight: number };
  settleResult: SettleResult;
  /** 库里的最近事件行；本次结算刚触发的事件在 buildSectStateView 里合并进来。 */
  recentEventRows: readonly EventLogRow[];
  now: number;
  /** 宗门等级的资源容量倍率（影响所有资源的实际容量）。 */
  /** 0014：本宗未领取的历练记录（在外中 + 待领取）。 */
  journeys: readonly DiscipleJourneyRow[];
  /** 0014：最近历练记录（含已领取，最多 10 条），新的在前。 */
  recentJourneys: readonly DiscipleJourneyRow[];
  /**
   * V6：本宗当前进行中的交互式探索（可选输入，避免其他调用方被迫传值）；
   * 视图输出统一用 `input.activeExploration ?? null`。
   */
  activeExploration?: ActiveExplorationView | null;
  capacityMultiplier: number;
}

export function buildSectStateView(input: SectStateInput): SectStateView {
  const {
    config,
    sect,
    disciples,
    buildings,
    balances,
    pillInventories,
    challengeDay,
    debateDay,
    settleResult,
    now,
    journeys,
    recentJourneys,
    recentEventRows,
    capacityMultiplier,
  } = input;
  // 速率按「当前状态」现算，而不是沿用本次结算用的旧状态：派工 / 升级藏经阁返回的那一帧里，
  // 前端看到的「每时产出」与静修速率就已经是新值（结算本身仍只用旧状态计已经过去的那段时间）。
  // 建筑等级表只建一次：资源速率（含灵矿加成）与藏经阁加成共用同一份数据。
  // 0014：仍在外的弟子（serverNow < endsAt）不贡献产出、静修速率为 0；到期后立即恢复（见 view 注释）。
  const buildingLevels: Record<string, number> = Object.fromEntries(
    buildings.map((building) => [building.def_id, building.level]),
  );
  const libraryLevel = buildingLevels[SCRIPTURE_LIBRARY_BUILDING_ID] ?? 0;
  const awayIds = journeyAwayIds(journeys, now);
  const rateDisciples = disciples.filter((disciple) => !awayIds.has(disciple.id));
  const resourceRatesNow = resourceRates(config, rateDisciples.map(toDiscipleState), buildingLevels);
  const ratesByDisciple = new Map(
    disciples.map((disciple) => [
      disciple.id,
      awayIds.has(disciple.id)
        ? 0
        : cultivationRatePerHour(config, toDiscipleState(disciple), libraryLevel),
    ]),
  );

  // 容量/上限一律按「当前（可能刚升级的）等级」现算，升级当次返回的就是新数值。
  const levelDef = findSectLevel(Number(sect.level));

  const balancesByResource = new Map(balances.map((row) => [row.resource_id, Number(row.balance)]));
  const arrayLevel =
    buildings.find((building) => building.def_id === SPIRITUAL_ARRAY_BUILDING_ID)?.level ?? 0;
  const energyBalance = balancesByResource.get('spiritualEnergy') ?? 0;
  const energyName = config.resources.find((resource) => resource.id === 'spiritualEnergy')?.name ?? '灵气';

  const resources: ResourceView[] = config.resources.map((definition) => {
    const row = balances.find((item) => item.resource_id === definition.id);
    const settled = settleResult.resources.find((item) => item.resourceId === definition.id);
    return {
      id: definition.id,
      name: definition.name,
      balance: String(row?.balance ?? 0),
      capacity: String(effectiveCapacity(definition.capacity, capacityMultiplier)),
      ratePerHour: String(resourceRatesNow.get(definition.id) ?? 0),
      capped: settled?.capped ?? false,
      discarded: String(settled?.discarded ?? 0),
    };
  });

  const assignmentNames = new Map<string, string>([
    [IDLE_ASSIGNMENT, '闲置'],
    ...config.positions.map((position) => [position.id, position.name] as const),
  ]);

  const pendingJourneys = new Map<string, DiscipleJourneyRow>();
  for (const row of journeys) {
    if (row.claimed_at === null) pendingJourneys.set(row.disciple_id, row);
  }


  const discipleViews: DiscipleView[] = disciples.map((disciple) => {
    const realm = findRealm(disciple.realm_id);
    const stage = findStage(disciple.realm_id, disciple.stage);
    const cost = breakthroughEnergyCost(disciple.stage);
    const chanceBp = breakthroughChanceBp(config, arrayLevel);
    const injured = disciple.injured_until !== null && disciple.injured_until > now;
    // 0014：历练状态（在外 / 待领取 / 名额与资格原因）全部在服务端算好，前端不复制公式。
    const journeyRow = pendingJourneys.get(disciple.id);
    const journeyView = buildDiscipleJourneyView({
      disciple,
      row: journeyRow,
      now,
      activeCount: awayIds.size,
      discipleCount: disciples.length,
      othersAwayCount:
        awayIds.size - (journeyRow !== undefined && awayIds.has(disciple.id) ? 1 : 0),
      inDefenseLineup: lineupContainsDisciple(sect.defense_lineup, disciple.id),
      assignmentNames,
    });
    const away = journeyView.status === 'active';

    let blockedReason: string | null = null;
    if (away) {
      // 在外期间不能破境（服务端也会拒绝），原因优先于修为/灵气。
      blockedReason = '正在外历练，尚未归队';
    } else if (stage.requiredCultivation === null) {
      blockedReason = '已达本版本最高境界（后续境界待开放）';
    } else if (injured) {
      blockedReason = `疗伤中（剩 ${Math.ceil(((disciple.injured_until ?? 0) - now) / 1000)} 秒）`;
    } else if (disciple.cultivation < stage.requiredCultivation) {
      blockedReason = `修为不足（需要 ${String(stage.requiredCultivation)}）`;
    } else if (energyBalance < cost) {
      blockedReason = `${energyName}不足（需要 ${String(cost)}）`;
    }

    // 淬体丹预览：服务端算好短板与提升量，前端不复制算法；次数用完视为无短板。
    const temperingUses = Number(disciple.body_tempering_count);
    const temperingTarget =
      temperingUses < BODY_TEMPERING_MAX_USES
        ? bodyTemperingTarget(
            Number(disciple.attack),
            Number(disciple.defense),
            Number(disciple.speed),
          )
        : null;

    return {
      id: disciple.id,
      name: disciple.name,
      gender: disciple.gender,
      aptitude: disciple.aptitude,
      attack: Number(disciple.attack),
      defense: Number(disciple.defense),
      speed: Number(disciple.speed),
      luck: Number(disciple.luck),
      physique: Number(disciple.physique),
      talent: disciple.talent,
      talentName: findTalent(disciple.talent)?.name ?? '无',
      combatPower: discipleCombatPower(
        disciple.realm_id,
        Number(disciple.stage),
        Number(disciple.attack),
        Number(disciple.defense),
        Number(disciple.speed),
        disciple.talent,
      ),
      // 六项属性等权现算：与招贤卡共用 names.ts 的同一个纯函数（服务端唯一评分口径）。
      attributeScore: attributeScore({
        aptitude: Number(disciple.aptitude),
        attack: Number(disciple.attack),
        defense: Number(disciple.defense),
        speed: Number(disciple.speed),
        luck: Number(disciple.luck),
        physique: Number(disciple.physique),
      }),
      realmId: realm.id,
      realmName: realm.name,
      // 境界高低用服务端的 REALMS 下标（前端排序只认这个，不按境界名字符串比较）。
      realmOrder: realmIndex(realm.id),
      stage: disciple.stage,
      stageName: stage.name,
      cultivation: Number(disciple.cultivation),
      requiredCultivation: stage.requiredCultivation,
      cultivationRatePerHour: ratesByDisciple.get(disciple.id) ?? 0,
      assignment: disciple.assignment,
      assignmentName: assignmentNames.get(disciple.assignment) ?? disciple.assignment,
      injuredUntil: disciple.injured_until === null ? null : new Date(disciple.injured_until).toISOString(),
      canBreakthrough: blockedReason === null,
      blockedReason,
      breakthroughCost: String(cost),
      breakthroughChanceBp: chanceBp,
      bodyTemperingUses: temperingUses,
      bodyTemperingRemaining: Math.max(0, BODY_TEMPERING_MAX_USES - temperingUses),
      bodyTemperingTarget: temperingTarget?.attribute ?? null,
      bodyTemperingGain: temperingTarget?.gain ?? 0,
      /** 0019 悟道值：可用余额 / 累计已分配 / 剩余可分配额度（服务端算好，前端不复制规则）。 */
      daoInsight: Number(disciple.dao_insight) || 0,
      daoInsightUsed: Number(disciple.dao_insight_used) || 0,
      daoInsightRemaining: Math.max(0, DAO_INSIGHT_CAP - (Number(disciple.dao_insight_used) || 0)),
      note: disciple.note,
      /** 0017 头像框 id（'classic' 或 'frame01'…'frame20'）：掌门私有的固定外观选择。 */
      avatarFrameId: disciple.avatar_frame_id,
      journey: journeyView,
    };
  });

  const buildingViews: BuildingView[] = buildings.map((building) => {
    const definition = config.buildings.find((item) => item.id === building.def_id);
    const maxLevel = definition?.maxLevel ?? 1;
    if (definition === undefined || building.level >= maxLevel) {
      return {
        defId: building.def_id,
        name: definition?.name ?? building.def_id,
        level: building.level,
        maxLevel,
        upgradeCost: null,
        canUpgrade: false,
        blockedReason: '已满级',
      };
    }

    const cost = upgradeCost(definition.upgradeCostPerLevel, building.level);
    const lacking = Object.entries(cost).find(
      ([resourceId, amount]) => (balancesByResource.get(resourceId) ?? 0) < Number(amount),
    );
    const resourceName =
      lacking === undefined
        ? ''
        : (config.resources.find((resource) => resource.id === lacking[0])?.name ?? lacking[0]);

    return {
      defId: building.def_id,
      name: definition.name,
      level: building.level,
      maxLevel,
      upgradeCost: cost,
      canUpgrade: lacking === undefined,
      blockedReason: lacking === undefined ? null : `${resourceName}不足`,
    };
  });

  const discipleCapacity = levelDef.discipleCapacity;
  const buildingCapacity = levelDef.buildingCapacity;
  const recruitRemaining = Math.max(0, discipleCapacity - disciples.length);
  const recruitCost = { ...config.recruitment.cost };
  const recruitLacking = Object.entries(recruitCost).find(
    ([resourceId, amount]) => (balancesByResource.get(resourceId) ?? 0) < Number(amount),
  );
  // 0021：「每日 3 次」上限已去掉——只有「弟子上限已满」与灵石不足两条门槛
  // （config.recruitment.dailyLimit 不再参与判定，保留在配置里只作为历史字段）。
  const recruitBlockedReason =
    disciples.length >= discipleCapacity
      ? '弟子上限已满'
      : recruitLacking !== undefined
        ? `${
            config.resources.find((resource) => resource.id === recruitLacking[0])?.name ??
            recruitLacking[0]
          }不足`
        : null;

  const sectUpgrade = buildSectUpgradeView({
    config,
    sectLevel: Number(sect.level),
    disciples,
    buildings,
    balancesByResource,
  });

  // 炼丹面板：解锁判断只在服务端（宗门等级 + 灵药园等级），canCraft 只预检单颗成本。
  const buildingLevelsForAlchemy: Record<string, number> = Object.fromEntries(
    buildings.map((building) => [building.def_id, building.level]),
  );
  const alchemyLockedReason = alchemyUnlockBlockedReason(Number(sect.level), buildingLevelsForAlchemy);
  const alchemyView: AlchemyView = {
    unlocked: alchemyLockedReason === null,
    cultivationPillGain: CULTIVATION_PILL_GAIN,
    blockedReason: alchemyLockedReason,
    recipes: PILL_RECIPES.map((recipe) => {
      const ownedRow = pillInventories.find((row) => row.pill_id === recipe.id);
      const lacking = alchemyLockedReason === null
        ? firstInsufficientResource(recipe.cost, (resourceId) => balancesByResource.get(resourceId) ?? 0)
        : null;
      const lackingName =
        lacking === undefined || lacking === null
          ? ''
          : (config.resources.find((resource) => resource.id === lacking)?.name ?? lacking);
      return {
        id: recipe.id,
        name: recipe.name,
        description: recipe.description,
        cost: { ...recipe.cost },
        owned: ownedRow === undefined ? 0 : Number(ownedRow.quantity),
        canCraft: alchemyLockedReason === null && lacking === null,
        blockedReason:
          alchemyLockedReason ?? (lacking === null ? null : `${lackingName}不足`),
      };
    }),
  };

  // 坊市面板：价格是代码常量（shop.ts）；可售丹药 = 丹方里有回收价的那几种
  // （价格表就是白名单），库存为 0 也照原样下发 —— 前端灰掉即可，不必等有库存才看见价格。
  const shopView: ShopView = {
    buyPrice: SHOP_BUY_PRICE,
    sellPrice: SHOP_SELL_PRICE,
    pills: PILL_RECIPES.flatMap((recipe) => {
      const sellPrice = SHOP_PILL_PRICES[recipe.id];
      if (sellPrice === undefined || sellPrice <= 0) {
        return [];
      }
      const ownedRow = pillInventories.find((row) => row.pill_id === recipe.id);
      return [{
        id: recipe.id,
        name: recipe.name,
        owned: ownedRow === undefined ? 0 : Number(ownedRow.quantity),
        sellPrice,
      }];
    }),
  };

  // 0014：宗门历练名额 + 最近 10 条摘要（仅本宗可见）。
  const journeySlot = journeySlotView({ rows: journeys, recent: recentJourneys, now });

  // 0019 赌坊面板：解锁只看宗门等级（不依赖建筑），当日次数来自归一后的 debateDay。
  // 0020 天机轮：解锁后每次都带当前格局；格局由 sect_id + wheel_seed 派生，只有重置才会变。
  const gamblingLockedReason = gamblingUnlockBlockedReason(Number(sect.level));
  const wheelView = gamblingLockedReason === null ? buildWheelView(sect, config, debateDay.dateKey) : null;
  const stats = input.debateStats;
  const gamblingView = {
    unlocked: gamblingLockedReason === null,
    blockedReason: gamblingLockedReason,
    dailyLimit: DEBATE_DAILY_LIMIT,
    usedToday: debateDay.usedToday,
    remaining: debateDay.remaining,
    stats: stats !== undefined
      ? {
          total: stats.total,
          wins: stats.wins,
          losses: stats.losses,
          winRate: stats.total > 0 ? Math.round((stats.wins / stats.total) * 100) : 0,
          netSpiritStone: stats.netSpiritStone,
          totalInsight: stats.totalInsight,
        }
      : null,
    // 0020 天机轮：格局 + 档位费用 + 重置费用（都是服务端口径，前端只渲染）。
    wheel: wheelView,
    // 0024 灵兽竞逐：轮次状态由前端单独 GET 拉取（不在 sync 里包含，因为要定时轮询），
    // buildSectStateView 只填 null 占位，前端通过 /game/race-state 独立获取。
    race: null,
  };

  return {
    sect: {
      id: sect.id,
      name: sect.name,
      level: sect.level,
      levelName: levelDef.name,
      reputation: Number(sect.reputation) || 0,
      defenseLineup: parseDefenseLineup(sect.defense_lineup),
      veinLevel: sect.vein_level,
      discipleCapacity,
      buildingCapacity,
      lastSettledAt: new Date(sect.last_settled_at).toISOString(),
    },
    serverNow: new Date(now).toISOString(),
    resources,
    disciples: discipleViews,
    buildings: buildingViews,
    recruit: {
      cost: recruitCost,
      remaining: recruitRemaining,
      discipleCount: disciples.length,
      discipleCapacity,
      canRecruit: recruitBlockedReason === null,
      blockedReason: recruitBlockedReason,
    },
    rename: {
      sectCost: String(SECT_RENAME_COST),
      discipleCost: String(DISCIPLE_RENAME_COST),
      sectNameMinChars: SECT_NAME_MIN_CHARS,
      sectNameMaxChars: SECT_NAME_MAX_CHARS,
      discipleNameMinChars: DISCIPLE_NAME_MIN_CHARS,
      discipleNameMaxChars: DISCIPLE_NAME_MAX_CHARS,
    },
    assignments: [
      { id: IDLE_ASSIGNMENT, name: '闲置', currentCount: null, maxCount: null },
      ...config.positions.map((position) => {
        if (position.id === STONE_MINING_ASSIGNMENT) {
          // 采灵岗位有人数上限：宗门 6 级前 1 人、6 级起 2 人（与 service 的派工判定同一套常量）。
          const limit =
            Number(sect.level) >= STONE_MINING_UNLOCK_SECT_LEVEL
              ? STONE_MINING_LIMIT_HIGH
              : STONE_MINING_LIMIT_LOW;
          const count = disciples.filter(
            (disciple) => disciple.assignment === STONE_MINING_ASSIGNMENT,
          ).length;
          return { id: position.id, name: position.name, currentCount: count, maxCount: limit };
        }
        return { id: position.id, name: position.name, currentCount: null, maxCount: null };
      }),
    ],
    recentEvents: mergeRecentEvents(settleResult.events, recentEventRows, now, RECENT_EVENTS_IN_SYNC),
    settle: {
      durationSeconds: Math.floor(settleResult.durationMs / 1000),
      cappedByOfflineLimit: settleResult.cappedByOfflineLimit,
      clockWentBackwards: settleResult.clockWentBackwards,
      totalDiscarded: String(settleResult.totalDiscarded),
    },
    sectUpgrade,
    alchemy: alchemyView,
    journey: journeySlot,
    activeExploration: input.activeExploration ?? null,
    challenge: {
      dailyLimit: CHALLENGE_DAILY_LIMIT,
      usedToday: challengeDay.usedToday,
      remaining: challengeDay.remaining,
    },
    /** 0019 赌坊面板（解锁判断与当日次数全部服务端算好，前端只渲染）。 */
    gambling: gamblingView,
    /** 坊市面板（价格与可售丹药全部服务端算好，前端只渲染与预览）。 */
    shop: shopView,
  };
}

/**
 * 0020 天机轮面板：格局由 sect_id + wheel_seed 确定性生成（同 seed 同格局），
 * 格面文案在这里拼好，资源名 / 丹药名都取自配置与 alchemy.ts（不复制第二份中文名词表）。
 * 档位费用与重置费用同样由服务端下发 —— 前端只渲染，不自己按档位算钱（计划 2.3 / 2.4）。
 */
function buildWheelView(sect: SectRow, config: GameConfigContent, dateKey: string): WheelView {
  const names = {
    resource: (resourceId: string): string =>
      config.resources.find((item) => item.id === resourceId)?.name ?? resourceId,
    pill: (pillId: string): string =>
      PILL_RECIPES.find((recipe) => recipe.id === pillId)?.name ?? pillId,
  };
  return {
    seed: Number(sect.wheel_seed) || 0,
    slots: generateWheelSlots(wheelLayoutSeed(sect.id, Number(sect.wheel_seed), dateKey)).map((slot) => ({
      type: slot.type,
      multiplier: slot.multiplier,
      label: wheelSlotLabel(slot, names),
    })),
    costs: WHEEL_TIERS.map((tier) => ({ tier, cost: wheelSpinCost(tier) })),
    resetCost: WHEEL_RESET_COST,
  };
}

/** 宗门升级信息：已满级返回 null。 */
function buildSectUpgradeView(input: {
  config: GameConfigContent;
  sectLevel: number;
  disciples: readonly DiscipleRow[];
  buildings: readonly BuildingRow[];
  balancesByResource: ReadonlyMap<string, number>;
}): SectUpgradeView | null {
  const { config, sectLevel, disciples, buildings, balancesByResource } = input;
  const next = nextSectLevel(sectLevel);
  if (next === null) {
    return null;
  }

  const requirements: { label: string; met: boolean }[] = [];
  const blockedReasons: string[] = [];

  // 建筑条件
  for (const req of next.buildingRequirements) {
    const building = buildings.find((item) => item.def_id === req.defId);
    const buildingName = config.buildings.find((item) => item.id === req.defId)?.name ?? req.defId;
    const currentLevel = building?.level ?? 0;
    const met = currentLevel >= req.minLevel;
    requirements.push({ label: `${buildingName} ${req.minLevel}级（当前${currentLevel}级）`, met });
    if (!met) {
      blockedReasons.push(`${buildingName}等级不足`);
    }
  }

  // 弟子境界条件
  for (const req of next.discipleRequirements) {
    const realmName = findRealm(req.minRealmId).name;
    const requiredRealmIndex = realmIndex(req.minRealmId);
    const qualified = disciples.filter(
      (disciple) => realmIndex(disciple.realm_id) >= requiredRealmIndex,
    ).length;
    const met = qualified >= req.count;
    requirements.push({ label: `${req.count}名${realmName}弟子（当前${qualified}名）`, met });
    if (!met) {
      blockedReasons.push(`${realmName}弟子不足`);
    }
  }

  // 资源条件
  for (const [resourceId, amount] of Object.entries(next.upgradeCost)) {
    const balance = balancesByResource.get(resourceId) ?? 0;
    if (balance < Number(amount)) {
      const resourceName =
        config.resources.find((item) => item.id === resourceId)?.name ?? resourceId;
      blockedReasons.push(`${resourceName}不足`);
    }
  }

  return {
    nextLevel: next.level,
    nextLevelName: next.name,
    cost: next.upgradeCost,
    requirements,
    canUpgrade: blockedReasons.length === 0,
    blockedReason: blockedReasons.length > 0 ? blockedReasons.join('；') : null,
  };
}

/** 升级消耗 = 配置里的每级消耗 × 当前等级（03 第 2 节：灵石 50×当前等级、矿石 10×当前等级）。 */
export function upgradeCost(
  costPerLevel: Record<string, string>,
  currentLevel: number,
): Record<string, string> {
  const cost: Record<string, string> = {};
  for (const [resourceId, amount] of Object.entries(costPerLevel)) {
    cost[resourceId] = String(Number(amount) * Math.max(1, currentLevel));
  }
  return cost;
}

/** 突破成功率（基点）：基础 + 聚灵阵等级加成，再按配置 clamp。 */
export function breakthroughChanceBp(config: GameConfigContent, arrayLevel: number): number {
  const base =
    config.breakthrough.baseChanceBp +
    Math.max(0, arrayLevel - 1) * BREAKTHROUGH_ARRAY_BONUS_BP_PER_LEVEL;
  return Math.min(config.breakthrough.maxChanceBp, Math.max(config.breakthrough.minChanceBp, base));
}

/**
 * 把「库里的最近事件」与「本次结算刚触发的事件」合并去重（按 id）、新的在前、截取 limit 条。
 * 刚插入的行在本请求读快照时还不存在，所以必须与本次触发的事件合并，不能只查库。
 */
export function mergeRecentEvents(
  triggered: readonly TriggeredEvent[],
  rows: readonly EventLogRow[],
  now: number,
  limit: number,
): EventLogView[] {
  const seen = new Set<string>();
  const merged: EventLogView[] = [];
  for (const event of triggered) {
    if (seen.has(event.id)) {
      continue;
    }
    seen.add(event.id);
    merged.push(triggeredEventView(event, now));
  }
  for (const row of rows) {
    if (seen.has(row.id)) {
      continue;
    }
    seen.add(row.id);
    merged.push(eventLogViewFromRow(row));
  }
  // createdAt 相同（同一轮结算触发的 2~3 个事件）时用 id 兜底，与库里的
  // `ORDER BY created_at DESC, id DESC` 保持同一顺序：这样「刚触发」的这一帧
  // 和下一次 sync 从库里读出来的顺序不会跳变。
  merged.sort((a, b) => {
    if (a.createdAt !== b.createdAt) {
      return a.createdAt < b.createdAt ? 1 : -1;
    }
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
  return merged.slice(0, limit);
}

/** event_log 行 -> 视图；name 由事件定义按 event_id 反查，查不到用 event_id 兜底。 */
export function eventLogViewFromRow(row: EventLogRow): EventLogView {
  return {
    id: row.id,
    eventId: row.event_id,
    name: eventNameOf(row.event_id),
    description: row.description,
    effects: parseEffects(row.effects),
    createdAt: new Date(Number(row.created_at)).toISOString(),
  };
}

function triggeredEventView(event: TriggeredEvent, now: number): EventLogView {
  return {
    id: event.id,
    eventId: event.eventId,
    name: event.name,
    description: event.description,
    effects: { ...event.effects },
    createdAt: new Date(now).toISOString(),
  };
}

/** effects 列的 JSON 解析；非法输入退化为空对象，避免脏数据让整个 state 读取失败。 */
function parseEffects(text: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object') {
      return {};
    }
    const effects: Record<string, string> = {};
    for (const [resourceId, amount] of Object.entries(parsed as Record<string, unknown>)) {
      effects[resourceId] = String(amount);
    }
    return effects;
  } catch {
    return {};
  }
}

/**
 * 守擂阵容列（JSON 数组字符串）→ 弟子 id 数组；null / 非法输入退化为 null，
 * 与 parseEffects 同理：脏数据不该让整个 state 读取失败。
 *
 * 长度不是 3 时同样返回 null：与 service 的 parseDefenseLineupIds 保持同一判定，
 * 避免「自己能看见阵容、别人却挑战不了」这种不一致。
 */
function parseDefenseLineup(text: string | null): string[] | null {
  if (text === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      return null;
    }
    const ids = parsed.filter((item): item is string => typeof item === 'string');
    return ids.length === DEFENSE_LINEUP_SIZE ? ids : null;
  } catch {
    return null;
  }
}

/** 弟子行 → 速率计算用的形状（与 service.ts 构造 settleEconomy 入参的映射保持一致）。 */
function toDiscipleState(row: DiscipleRow): DiscipleState {
  return {
    id: row.id,
    aptitude: Number(row.aptitude),
    realmId: row.realm_id,
    stage: Number(row.stage),
    cultivation: Number(row.cultivation),
    cultivationRemainder: Number(row.cultivation_remainder),
    assignment: row.assignment,
    talent: row.talent,
  };
}

/* ---------- 0014 弟子历练：状态视图 ---------- */

/**
 * 单条历练结果（计划 4.4「不要向未到期状态泄漏结果」）：
 * 未到期一律返回 null —— 即使在返回 JSON 的层面也看不到 `reward_*` 快照。
 */
function journeyOutcomeView(row: DiscipleJourneyRow, now: number): JourneyOutcomeView | null {
  if (journeyStatusOf(row, now) === 'active') {
    return null;
  }
  const injured = Number(row.injured) === 1;
  return {
    cultivationAwarded: Number(row.cultivation_awarded ?? 0),
    cultivationPlanned: Number(row.reward_cultivation),
    resources: parseJourneyRewardResources(row.reward_resources),
    extraHarvest: Number(row.extra_harvest) === 1,
    injured,
    injuryChanceBp: Number(row.injury_chance_bp),
    // 伤势固定从到期时间起算 30 分钟；晚登录可能已痊愈，但结果照实展示。
    injuredUntil: injured ? new Date(journeyInjuryUntil(Number(row.ends_at))).toISOString() : null,
    completedAt: row.completed_at === null ? null : new Date(Number(row.completed_at)).toISOString(),
    claimedAt: row.claimed_at === null ? null : new Date(Number(row.claimed_at)).toISOString(),
  };
}

/** 没有未领取记录时的弟子历练状态（纯展示，不参与任何判定）。 */
function noJourneyView(blockedReason: string | null): DiscipleJourneyView {
  return {
    status: 'none',
    journeyId: null,
    direction: null,
    directionName: null,
    durationSeconds: null,
    startedAt: null,
    endsAt: null,
    originalAssignmentName: null,
    outcome: null,
    canStart: blockedReason === null,
    blockedReason,
  };
}

/**
 * 每名弟子的历练状态。`canStart` 只代表「与方向无关的资格全部满足」；
 * 方向自身的限制（访道需要修为门槛）由 GET /game/journey-preview 逐方向给出，
 * 前端不复制任何一条公式。
 */
function buildDiscipleJourneyView(input: {
  disciple: DiscipleRow;
  row: DiscipleJourneyRow | undefined;
  now: number;
  activeCount: number;
  discipleCount: number;
  othersAwayCount: number;
  inDefenseLineup: boolean;
  assignmentNames: ReadonlyMap<string, string>;
}): DiscipleJourneyView {
  const { disciple, row, now } = input;
  const status: JourneyStatus = row === undefined ? 'none' : journeyStatusOf(row, now);
  const blockedReason = journeyEligibilityBlockedReason({
    realmId: disciple.realm_id,
    injuredUntil: disciple.injured_until === null ? null : Number(disciple.injured_until),
    pending:
      row === undefined || status === 'none'
        ? null
        : { status, direction: asJourneyDirection(row.direction) },
    activeCount: input.activeCount,
    discipleCount: input.discipleCount,
    othersAwayCount: input.othersAwayCount,
    inDefenseLineup: input.inDefenseLineup,
    now,
  });

  if (row === undefined || status === 'none') {
    return noJourneyView(blockedReason);
  }

  const direction = asJourneyDirection(row.direction);
  return {
    status,
    journeyId: row.id,
    direction,
    directionName: findJourneyDirection(direction).name,
    durationSeconds: Number(row.duration_seconds),
    startedAt: new Date(Number(row.started_at)).toISOString(),
    endsAt: new Date(Number(row.ends_at)).toISOString(),
    originalAssignmentName:
      input.assignmentNames.get(row.original_assignment) ?? row.original_assignment,
    outcome: journeyOutcomeView(row, now),
    canStart: false,
    blockedReason,
  };
}

/** 历史摘要条目状态：已领取 / 已到期待领取 / 仍在在外。 */
function journeyRecordStatus(row: DiscipleJourneyRow, now: number): 'active' | 'ready' | 'claimed' {
  if (row.claimed_at !== null) {
    return 'claimed';
  }
  return journeyStatusOf(row, now) === 'active' ? 'active' : 'ready';
}

/** 历史摘要（最近 10 条，仅本宗可见）；未到期条目同样不给 outcome。 */
export function journeyRecordViews(
  rows: readonly DiscipleJourneyRow[],
  now: number,
  limit: number,
): JourneyRecordView[] {
  return rows.slice(0, limit).map((row) => {
    const direction = asJourneyDirection(row.direction);
    return {
      id: row.id,
      discipleId: row.disciple_id,
      discipleName: row.disciple_name,
      direction,
      directionName: findJourneyDirection(direction).name,
      durationSeconds: Number(row.duration_seconds),
      status: journeyRecordStatus(row, now),
      startedAt: new Date(Number(row.started_at)).toISOString(),
      endsAt: new Date(Number(row.ends_at)).toISOString(),
      outcome: journeyOutcomeView(row, now),
    };
  });
}

/** 宗门历练面板（名额 + 每人状态由调用方拼进 DiscipleView.journey）。 */
export function journeySlotView(input: {
  rows: readonly DiscipleJourneyRow[];
  recent: readonly DiscipleJourneyRow[];
  now: number;
}): JourneyView {
  return {
    activeCount: input.rows.filter((row) => row.claimed_at === null && row.ends_at > input.now).length,
    maxConcurrent: JOURNEY_MAX_CONCURRENT,
    minAtHome: JOURNEY_MIN_DISCIPLES_AT_HOME,
    recent: journeyRecordViews(input.recent, input.now, JOURNEY_HISTORY_LIMIT),
  };
}
