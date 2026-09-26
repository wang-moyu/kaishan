import { apiRequest, setCsrfToken } from './client';
import type { AvatarFrameId } from '../utils/avatarFrames';

/**
 * 游戏与账号接口（类型与后端 modules/game/view.ts 一一对应）。
 *
 * 金额/资源用「最小单位十进制字符串」，1 展示单位 = 1000 最小单位；
 * 前端只做展示格式化，所有 canXxx / blockedReason 都由服务端算好。
 */

export interface UserSummary {
  id: string;
  account: string;
  status: string;
  createdAt: string;
}

export interface MeData {
  user: UserSummary;
  sect: null;
  csrfToken: string;
}

export interface ResourceView {
  id: string;
  name: string;
  balance: string;
  capacity: string;
  ratePerHour: string;
  capped: boolean;
  discarded: string;
}

export interface DiscipleView {
  id: string;
  name: string;
  gender: string;
  aptitude: number;
  realmId: string;
  realmName: string;
  /** 境界在服务端境界表里的下标（0 = 最低）：排序用，不按境界名字符串比较。 */
  realmOrder: number;
  stage: number;
  stageName: string;
  cultivation: number;
  requiredCultivation: number | null;
  cultivationRatePerHour: number;
  assignment: string;
  assignmentName: string;
  injuredUntil: string | null;
  /** 重伤卧床（世界 Boss 造成，1 天）：ISO 字符串，格式与 injuredUntil 相同；null = 未重伤。 */
  severeInjuredUntil: string | null;
  canBreakthrough: boolean;
  /** 除灵气外的破境条件都已满足（批量破境按这个挑人，灵气整批合计后再判断）。 */
  breakthroughReadyExceptEnergy: boolean;
  blockedReason: string | null;
  breakthroughCost: string;
  breakthroughChanceBp: number;
  /** 战斗属性（只影响战力，资质只影响修炼）。 */
  attack: number;
  defense: number;
  speed: number;
  /** 0016 幸运 / 体魄（1~100）：只作用于单人定时历练的额外收获与受伤概率。 */
  luck: number;
  physique: number;
  talent: string;
  talentName: string;
  /** 当前战力（服务端按 realms.ts 公式算好）。 */
  combatPower: number;
  /**
   * 0028 装备加成（该弟子已穿装备的 5 项属性之和；没有装备时全 0）。
   * 战力已经计入这份加成，前端不要自己再加；上面的 attack/defense/… 仍是**基础属性**（最高 100）。
   */
  gear: {
    attack: number;
    defense: number;
    speed: number;
    luck: number;
    physique: number;
  };
  /** 0032 装备战力加成（基点，10000 = +100%）：身上装备按品质相加；战力已计入，前端只展示。 */
  gearPowerBonusBp: number;
  /**
   * 0016 综合评分：**当前**六项属性等权现算，固定一位小数（服务端 names.ts 的
   * attributeScore）。不是战力：境界、修为、天赋都不参与；服务端不落库，
   * 淬体丹改完攻/防/速之后随下一次 sync 自动更新。
   */
  attributeScore: number;
  /** 淬体丹：已服用次数 / 剩余次数与服务端算好的短板预览（null = 无短板或已用完）。 */
  bodyTemperingUses: number;
  bodyTemperingRemaining: number;
  bodyTemperingTarget: 'attack' | 'defense' | 'speed' | null;
  bodyTemperingGain: number;
  /** 聚气丹「服到满」（修为达到突破门槛）需要几颗；0 = 不可服用。 */
  cultivationPillsToFull: number;
  /** 淬体丹「服到满」的逐颗计划（服务端算好）；长度即需要几颗，空 = 不可服用。 */
  bodyTemperingPlan: { attribute: 'attack' | 'defense' | 'speed'; gain: number }[];
  /** 0013 掌门私有备注（单行纯文本，≤60 字；空串 = 未填写）。只在自己的 sync 状态里有值。 */
  note: string;
  /** 0017 头像框样式 id（白名单，见 utils/avatarFrames.ts）：旧、新弟子默认 `classic`。 */
  avatarFrameId: string;
  /** 0014 历练状态：none / active / ready + 名额与不可出发原因（全部服务端算好，前端只渲染）。 */
  journey: DiscipleJourneyView;

  /** 0019 悟道值：当前可用余额（赌坊赢得，可在弟子详情里分配到属性）。 */
  daoInsight: number;
  /** 0019 已累计分配的悟道值（上限与后端 DAO_INSIGHT_CAP 同口径，服务端保证不超）。 */
  daoInsightUsed: number;
  /** 0019 剩余可分配额度 = max(0, 上限 - daoInsightUsed)，服务端算好。 */
  daoInsightRemaining: number;
}

export interface BuildingView {
  defId: string;
  name: string;
  level: number;
  maxLevel: number;
  upgradeCost: Record<string, string> | null;
  canUpgrade: boolean;
  blockedReason: string | null;
}

export interface RecruitView {
  cost: Record<string, string>;
  /** 还能招几个人（= 弟子上限 − 现有弟子数）。0021 起已无「每日 3 次」上限。 */
  remaining: number;
  discipleCount: number;
  discipleCapacity: number;
  canRecruit: boolean;
  blockedReason: string | null;
}

export interface EventLogView {
  id: string;
  eventId: string;
  name: string;
  description: string;
  /** 资源变化：resourceId -> 最小单位数量（带符号）。 */
  effects: Record<string, string>;
  createdAt: string;
}

/** 可选岗位（与后端 view.ts 的 AssignmentOptionView 一一对应）。 */
export interface AssignmentOptionView {
  id: string;
  name: string;
  /** 该岗位当前占用人数（null = 该岗位无人数限制）。 */
  currentCount: number | null;
  /** 该岗位人数上限（null = 无限制）。 */
  maxCount: number | null;
}

/** 改名面板（与后端 view.ts 的 RenameView 一一对应）：价格是最小单位，前端 formatAmount 做除法。 */
export interface RenameView {
  /** 宗门改名消耗（灵石，最小单位）。 */
  sectCost: string;
  /** 弟子改名消耗（灵石，最小单位）。 */
  discipleCost: string;
  /** 宗门名长度规则（Unicode 码点）。 */
  sectNameMinChars: number;
  sectNameMaxChars: number;
  /** 弟子名长度规则（Unicode 码点）。 */
  discipleNameMinChars: number;
  discipleNameMaxChars: number;
}

export interface SectStateView {
  sect: {
    id: string;
    name: string;
    level: number;
    levelName: string;
    veinLevel: number;
    discipleCapacity: number;
    buildingCapacity: number;
    lastSettledAt: string;
    reputation: number;
    /** 守擂阵容（3 名弟子 id，顺序即出战顺序）；null = 尚未布阵。 */
    defenseLineup: string[] | null;
  };
  serverNow: string;
  resources: ResourceView[];
  disciples: DiscipleView[];
  buildings: BuildingView[];
  recruit: RecruitView;
  /** 改名消耗与名称长度规则（0021：宗门 / 弟子改名，规则与价格都由服务端给）。 */
  rename: RenameView;
  /** 可选岗位（含闲置）；有上限的岗位（如采灵）会给出 currentCount / maxCount。 */
  assignments: AssignmentOptionView[];
  /** 最近事件（新→旧，服务端最多返回 10 条）。 */
  recentEvents: EventLogView[];
  settle: {
    durationSeconds: number;
    cappedByOfflineLimit: boolean;
    clockWentBackwards: boolean;
    totalDiscarded: string;
  };
  /** 宗门升级信息；null = 已满级。 */
  sectUpgrade: SectUpgradeView | null;
  /** 炼丹面板（配方/库存/解锁状态，canCraft 与短板预览都由服务端算好）。 */
  alchemy: AlchemyView;
  /** 主动挑战的当日次数（每日 3 次；失败/零奖励同样消耗）。 */
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
    stats: {
      total: number;
      wins: number;
      losses: number;
      winRate: number;
      netSpiritStone: number;
      totalInsight: number;
    } | null;
    /** 0020 天机轮：赌坊未解锁时为 null；解锁后带当前格局与档位费用（全部服务端口径）。 */
    wheel: WheelView | null;
  };
  /** 0014 宗门历练名额与最近 10 条历练摘要（仅本宗可见，结果由服务端决定）。 */
  journey: JourneyView;
  /** V6 进行中的交互式秘境探索；null = 当前没有（刷新后据此恢复断点）。 */
  activeExploration: ActiveExplorationView | null;
  /** 0025 世界 Boss（讨伐）：是否可出手（按钮角标；只有 sync 会给真值）。 */
  worldBoss: { attackable: boolean };
  /**
   * 坊市面板：材料买卖价 + 可回收的丹药（价格单位都是最小单位灵石，前端只展示、不复算规则）。
   * 买入价 / 卖出价按「1 展示单位材料」计价，买入会被服务端再按材料容量上限挡一次。
   */
  shop: {
    /** 买 1 展示单位材料要花的灵石（最小单位，= 667）。 */
    buyPrice: number;
    /** 卖 1 展示单位材料能得的灵石（最小单位，= 500）。 */
    sellPrice: number;
    /** 可回收的丹药：有回收价的丹方都会下发（库存为 0 的也在列表里，前端自行标灰）；owned 是库存颗数。 */
    pills: Array<{ id: string; name: string; owned: number; sellPrice: number }>;
  };
}

/** 单个丹方（与后端 view.ts 的 AlchemyRecipeView 一一对应）。 */
export interface AlchemyRecipeView {
  id: string;
  name: string;
  description: string;
  /** 单颗炼制成本（最小单位）。 */
  cost: Record<string, string>;
  /** 当前库存（非负整数）。 */
  owned: number;
  /** 是否可炼制（解锁 + 资源足够一颗；数量 × 成本的精确检查由服务端执行）。 */
  canCraft: boolean;
  blockedReason: string | null;
}

/** 炼丹面板状态（与后端 view.ts 的 AlchemyView 一一对应）。 */
export interface AlchemyView {
  unlocked: boolean;
  blockedReason: string | null;
  recipes: AlchemyRecipeView[];
  /** 聚气丹单次修为增益（服务端下发，前端只渲染，不复制丹药常量）。 */
  cultivationPillGain: number;
  /** 单次炼制的数量上限（服务端下发）。 */
  maxCraftQuantity: number;
}

export interface BreakthroughOutcome {
  discipleId: string;
  discipleName: string;
  success: boolean;
  chanceBp: number;
  roll: number;
  message: string;
}

/** 炼制结果（与后端 service.ts 的 CraftPillOutcome 一一对应）。 */
export interface CraftPillOutcome {
  pillId: string;
  pillName: string;
  quantity: number;
  /** 本次炼制的实际总成本（单颗 × quantity）。 */
  cost: Record<string, string>;
}

/** 服用效果（与后端 service.ts 的 UsePillOutcome['effect'] 一一对应）。 */
export interface PillUseEffect {
  kind: 'heal' | 'cultivation' | 'bodyTempering';
  /** 总提升量。 */
  gain?: number;
  /** 淬体丹第一颗补的属性。 */
  attribute?: 'attack' | 'defense' | 'speed';
  /** 淬体丹各属性的累计提升量（连服时可能补到不止一项）。 */
  gains?: Partial<Record<'attack' | 'defense' | 'speed', number>>;
}

/** 服用结果（与后端 service.ts 的 UsePillOutcome 一一对应）。 */
export interface UsePillOutcome {
  pillId: string;
  pillName: string;
  discipleId: string;
  discipleName: string;
  /** 实际服用颗数（服务端按「服到满所需」与库存截断）。 */
  count: number;
  effect: PillUseEffect;
}

export interface GameActionData {
  state: SectStateView;
  outcome?:
    | BreakthroughOutcome
    | RecruitOutcome
    | CraftPillOutcome
    | UsePillOutcome;
}

/** 宗门升级面板信息（与后端 view.ts 的 SectUpgradeView 一一对应）。 */
export interface SectUpgradeView {
  nextLevel: number;
  nextLevelName: string;
  cost: Record<string, string>;
  requirements: { label: string; met: boolean }[];
  canUpgrade: boolean;
  blockedReason: string | null;
}

export async function fetchMe(): Promise<MeData> {
  const data = await apiRequest<MeData>('/api/v1/auth/me');
  setCsrfToken(data.csrfToken);
  return data;
}

export async function login(account: string, password: string): Promise<{ account: string }> {
  const data = await apiRequest<{ user: UserSummary; csrfToken: string }>('/api/v1/auth/login', {
    method: 'POST',
    body: { account, password },
  });
  setCsrfToken(data.csrfToken);
  return { account: data.user.account };
}

export async function register(
  account: string,
  password: string,
  inviteCode?: string,
): Promise<{ account: string }> {
  const body = inviteCode === undefined ? { account, password } : { account, password, inviteCode };
  const data = await apiRequest<{ user: UserSummary; csrfToken: string }>('/api/v1/auth/register', {
    method: 'POST',
    body,
  });
  setCsrfToken(data.csrfToken);
  return { account: data.user.account };
}

export async function logout(): Promise<void> {
  await apiRequest<{ loggedOut: boolean }>('/api/v1/auth/logout', { method: 'POST', body: {} });
  setCsrfToken(null);
}

/** 修改密码：成功后本账号其他设备的会话全部失效，当前会话保留（revokedSessions = 下线的设备数）。 */
export async function changePassword(
  oldPassword: string,
  newPassword: string,
): Promise<{ revokedSessions: number }> {
  return apiRequest<{ changed: boolean; revokedSessions: number }>('/api/v1/auth/change-password', {
    method: 'POST',
    body: { oldPassword, newPassword },
  });
}

export async function syncSect(): Promise<SectStateView | null> {
  const data = await apiRequest<{ state: SectStateView | null }>('/api/v1/game/sync');
  return data.state;
}

export async function createSect(name: string): Promise<SectStateView> {
  const data = await apiRequest<GameActionData>('/api/v1/game/create-sect', {
    method: 'POST',
    body: { name },
  });
  return data.state;
}

/** 招贤：choice 是弹窗里选中的候选人序号；batch 是预览下发的批次标识（0016，过期会被拒）。 */
export async function recruit(choice: number, batch: string): Promise<GameActionData> {
  return apiRequest<GameActionData>('/api/v1/game/recruit', {
    method: 'POST',
    body: { choice, batch },
  });
}

export async function assign(discipleId: string, assignment: string): Promise<SectStateView> {
  const data = await apiRequest<GameActionData>('/api/v1/game/assign', {
    method: 'POST',
    body: { discipleId, assignment },
  });
  return data.state;
}

export async function upgradeBuilding(defId: string): Promise<SectStateView> {
  const data = await apiRequest<GameActionData>('/api/v1/game/upgrade-building', {
    method: 'POST',
    body: { defId },
  });
  return data.state;
}

export async function breakthrough(discipleId: string): Promise<GameActionData> {
  return apiRequest<GameActionData>('/api/v1/game/breakthrough', {
    method: 'POST',
    body: { discipleId },
  });
}

/** 批量命令里被跳过的弟子（与后端 service.ts 的 BatchSkippedDisciple 一一对应）。 */
export interface BatchSkippedDisciple {
  discipleId: string;
  discipleName: string;
  reason: string;
}

/** 批量换岗结果（POST /game/assign-batch 的 outcome）。 */
export interface AssignBatchOutcome {
  assignment: string;
  assignmentName: string;
  assigned: { discipleId: string; discipleName: string }[];
  skipped: BatchSkippedDisciple[];
}

/** 批量破境结果（POST /game/breakthrough-batch 的 outcome）。 */
export interface BreakthroughBatchOutcome {
  results: BreakthroughOutcome[];
  skipped: BatchSkippedDisciple[];
  /** 本次共消耗的灵气（最小单位）。 */
  energySpent: string;
}

/** 批量疗伤结果（POST /game/heal-batch 的 outcome）。 */
export interface HealBatchOutcome {
  healed: { discipleId: string; discipleName: string }[];
  skipped: BatchSkippedDisciple[];
  pillsUsed: number;
}

/** 批量换岗：按数组顺序逐个转，不符合条件的由服务端跳过并列出原因。 */
export async function assignBatch(
  discipleIds: string[],
  assignment: string,
): Promise<{ state: SectStateView; outcome: AssignBatchOutcome }> {
  return apiRequest<{ state: SectStateView; outcome: AssignBatchOutcome }>('/api/v1/game/assign-batch', {
    method: 'POST',
    body: { discipleIds, assignment },
  });
}

/** 批量破境：不满足条件的跳过；灵气须够全部可破境弟子，否则整批拒绝。 */
export async function breakthroughBatch(
  discipleIds: string[],
): Promise<{ state: SectStateView; outcome: BreakthroughBatchOutcome }> {
  return apiRequest<{ state: SectStateView; outcome: BreakthroughBatchOutcome }>(
    '/api/v1/game/breakthrough-batch',
    { method: 'POST', body: { discipleIds } },
  );
}

/** 批量疗伤（回春丹一人一颗）：无伤 / 重伤 / 在外的跳过；库存须够全部伤员，否则整批拒绝。 */
export async function healBatch(
  discipleIds: string[],
): Promise<{ state: SectStateView; outcome: HealBatchOutcome }> {
  return apiRequest<{ state: SectStateView; outcome: HealBatchOutcome }>('/api/v1/game/heal-batch', {
    method: 'POST',
    body: { discipleIds },
  });
}

/** 事件历史（GET /game/events，最近 20 条）。 */
export async function fetchEventLog(): Promise<EventLogView[]> {
  const data = await apiRequest<{ events: EventLogView[] }>('/api/v1/game/events');
  return data.events;
}

export async function upgradeSect(): Promise<SectStateView> {
  const data = await apiRequest<GameActionData>('/api/v1/game/upgrade-sect', {
    method: 'POST',
    body: {},
  });
  return data.state;
}

/** 秘境（与后端 view.ts 的 SecretRealmListView 一一对应）。 */
export interface SecretRealmView {
  id: string;
  name: string;
  description: string;
  difficulty: number;
  entryCost: Record<string, string>;
  rewards: Record<string, string>;
  /** 成功时的概率掉落说明（如「玄铁 1~2（15%）」）；没有则为 null。 */
  bonusDropText: string | null;
  minParty: number;
  maxParty: number;
  dailyLimit: number | null;
  usedToday: number;
  requiredSectLevel: number;
  locked: boolean;
  hasArena: boolean;
  /** V6：是否开放交互式「探索」（未开放时只显示「速通」）。 */
  exploreEnabled: boolean;
}

/** 一次探索的结果（与后端 view.ts 的 ExplorationResultView 一一对应）。 */
export interface ExplorationResult {
  realmName: string;
  success: boolean;
  chanceBp: number;
  roll: number;
  rewards: Record<string, string>;
  memberNames: string[];
  message: string;
}

export async function fetchSecretRealms(): Promise<SecretRealmView[]> {
  const data = await apiRequest<{ realms: SecretRealmView[] }>('/api/v1/game/realms');
  return data.realms;
}

export async function explore(
  realmId: string,
  discipleIds: string[],
): Promise<{ state: SectStateView; result: ExplorationResult }> {
  return apiRequest<{ state: SectStateView; result: ExplorationResult }>('/api/v1/game/explore', {
    method: 'POST',
    body: { realmId, discipleIds },
  });
}

/** 江湖榜条目（与后端 view.ts 的 LeaderboardEntryView 一一对应）。 */
export interface LeaderboardEntryView {
  sectId: string;
  name: string;
  level: number;
  levelName: string;
  reputation: number;
  discipleCount: number;
  /** 最高境界弟子（「镇派之宝」）；尚无可战弟子时为 null。 */
  topDisciple: {
    name: string;
    realmName: string;
    stageName: string;
  } | null;
  /** 是否是当前用户自己的宗门。 */
  isMe: boolean;
}

/** 公开档案里的弟子：只有能公开的字段（没有修为 / 岗位 / 受伤）。 */
export interface PublicDiscipleView {
  id: string;
  name: string;
  gender: string;
  aptitude: number;
  realmName: string;
  stageName: string;
  attack: number;
  defense: number;
  speed: number;
  talent: string;
  talentName: string;
  /** 境界下标 / 阶段 / 境界 id（排序、头像配色用；境界不能按名称字符串比较）。 */
  realmOrder: number;
  stage: number;
  realmId: string;
  /** 当前战力（服务端现算；只由已公开的字段算出，不泄漏私有属性）。 */
  combatPower: number;
}

/** 公开档案里的建筑：只有名字和等级（没有升级消耗）。 */
export interface PublicBuildingView {
  name: string;
  level: number;
}

/** 别人宗门的公开档案（与后端 view.ts 的 PublicSectView 一一对应）。 */
export interface PublicSectView {
  sectId: string;
  name: string;
  level: number;
  levelName: string;
  reputation: number;
  disciples: PublicDiscipleView[];
  buildings: PublicBuildingView[];
  /** 是否已设置**有效**的手动守擂阵容（不代表能否挑战；自动守擂也可挑战）。 */
  hasDefenseLineup: boolean;
  /** 挑战预览（相对当前用户）；观看者没有宗门时为 null。 */
  challenge: PublicSectChallengeView | null;
  createdAt: string;
}

/** 不可挑战的稳定原因码（与后端 view.ts 的 ChallengeBlockedReason 一致）。 */
export type ChallengeBlockedReason =
  | 'self'
  | 'daily_limit'
  | 'already_challenged_today'
  | 'defender_insufficient';

/** 守擂方式：有效手动阵容 / 临时自动守擂。 */
export type DefenseMode = 'configured' | 'automatic';

/** 奖励档位稳定标识（与后端 challenge.ts 的 RewardTier 一致）。 */
export type RewardTier =
  | 'lower_3_plus_no_reward'
  | 'lower_2'
  | 'lower_1'
  | 'equal'
  | 'higher_1'
  | 'higher_2'
  | 'higher_3_plus';

/** 「若胜利」的确切奖励预览（数值来自服务端档位表，前端不复制分支）。 */
export interface ChallengeRewardPreviewView {
  tier: RewardTier;
  reputation: number;
  spiritStone: number;
}

/** 公开档案里的挑战预览（与后端 view.ts 的 PublicSectChallengeView 一一对应）。 */
export interface PublicSectChallengeView {
  canChallenge: boolean;
  blockedReason: ChallengeBlockedReason | null;
  /** 守方弟子不足时为 null。 */
  defenseMode: DefenseMode | null;
  dailyLimit: number;
  usedToday: number;
  remaining: number;
  alreadyChallengedToday: boolean;
  /** 守方等级 - 攻方等级。 */
  levelDifference: number;
  rewardPreview: ChallengeRewardPreviewView;
}

/** 挑战中的一轮（战报用，带双方弟子名字）。 */
export interface ChallengeRoundView {
  round: number;
  attackerName: string;
  defenderName: string;
  attackerPower: number;
  defenderPower: number;
  winner: 'attacker' | 'defender';
}

/** 一次挑战的结果（与后端 view.ts 的 ChallengeResultView 一一对应）。 */
export interface ChallengeResultView {
  targetSectName: string;
  rounds: ChallengeRoundView[];
  result: 'win' | 'lose';
  reputationGained: number;
  spiritStoneGained: number;
  message: string;
  /** 开战快照：双方宗门等级与等级差（守方 - 攻方）。 */
  attackerLevel: number;
  defenderLevel: number;
  levelDifference: number;
  rewardTier: RewardTier;
  defenseMode: DefenseMode;
}

/** 挑战历史条目（从自己视角看）。 */
export interface ChallengeHistoryEntryView {
  id: string;
  attackerSectName: string;
  defenderSectName: string;
  rounds: ChallengeRoundView[];
  /** 从攻方视角的胜负。 */
  result: string;
  role: 'attacker' | 'defender';
  reputationGained: number;
  spiritStoneGained: number;
  /** 0012 开战快照；旧记录为 null（前端不伪造值）。 */
  attackerLevel: number | null;
  defenderLevel: number | null;
  levelDifference: number | null;
  rewardTier: RewardTier | null;
  defenseMode: DefenseMode | null;
  createdAt: string;
}

export interface ChallengeHistoryView {
  entries: ChallengeHistoryEntryView[];
  stats: { wins: number; losses: number; total: number };
}

export async function fetchLeaderboard(): Promise<LeaderboardEntryView[]> {
  const data = await apiRequest<{ entries: LeaderboardEntryView[] }>('/api/v1/game/leaderboard');
  return data.entries;
}

/** 弟子榜单条目（与后端 view.ts 的 DiscipleLeaderboardEntryView 一一对应）。 */
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
  /** 0032 装备战力加成（基点）；没穿装备为 0。 */
  gearPowerBonusBp: number;
  /** 装备榜才有：三个部位各穿了什么品质（没穿的部位 quality 为 null）。 */
  gearSlots?: DiscipleLeaderboardGearSlotView[];
  isMe: boolean;
}

export interface DiscipleLeaderboardGearSlotView {
  slot: string;
  slotName: string;
  quality: string | null;
  qualityName: string | null;
  color: string | null;
}

export interface DiscipleLeaderboardView {
  byCombatPower: DiscipleLeaderboardEntryView[];
  byAttributeScore: DiscipleLeaderboardEntryView[];
  /** 0032 装备榜：没穿装备的不上榜。 */
  byEquipment: DiscipleLeaderboardEntryView[];
}

export async function fetchDiscipleLeaderboard(): Promise<DiscipleLeaderboardView> {
  return apiRequest<DiscipleLeaderboardView>('/api/v1/game/disciple-leaderboard');
}

/** 天骄榜点开的弟子公开档案（任何登录玩家可看；不含掌门备注等私有字段）。 */
export interface DiscipleProfileView {
  discipleId: string;
  name: string;
  gender: string;
  realmId: string;
  frameId: string;
  sectId: string;
  sectName: string;
  /** 是不是观看者自己宗门的弟子。 */
  isMe: boolean;
  realmName: string;
  stageName: string;
  talent: string;
  talentName: string;
  talentDescription: string;
  /** 基础属性（最高 100，不含装备）。 */
  aptitude: number;
  attack: number;
  defense: number;
  speed: number;
  luck: number;
  physique: number;
  /** 装备加成（已穿装备 5 项之和）。 */
  gear: { attack: number; defense: number; speed: number; luck: number; physique: number };
  /** 战力（计入装备，与天骄榜同口径）。 */
  combatPower: number;
  /** 综合评分（六项基础属性等权，不计装备）。 */
  attributeScore: number;
  bodyTemperingUses: number;
  daoInsightUsed: number;
  /** 当前伤势：severe = 重伤卧床，injured = 负伤，null = 无。 */
  injury: 'severe' | 'injured' | null;
  /** 已穿戴的装备（按部位排序）。 */
  equipment: EquipmentItemView[];
}

export async function fetchDiscipleProfile(discipleId: string): Promise<DiscipleProfileView> {
  return apiRequest<DiscipleProfileView>(
    `/api/v1/game/disciple-profile/${encodeURIComponent(discipleId)}`,
  );
}

export interface ChatMessageView {
  id: string;
  sectName: string;
  content: string;
  isMe: boolean;
  isSystem: boolean;
  createdAt: string;
}

export async function fetchChatMessages(afterId?: string): Promise<ChatMessageView[]> {
  const url = afterId
    ? `/api/v1/game/chat?after=${encodeURIComponent(afterId)}`
    : '/api/v1/game/chat';
  const data = await apiRequest<{ messages: ChatMessageView[] }>(url);
  return data.messages;
}

export async function sendChatMessage(content: string): Promise<ChatMessageView[]> {
  const data = await apiRequest<{ messages: ChatMessageView[] }>('/api/v1/game/chat', {
    method: 'POST',
    body: { content },
  });
  return data.messages;
}

export async function fetchPublicSect(sectId: string): Promise<PublicSectView> {
  const data = await apiRequest<{ sect: PublicSectView }>(`/api/v1/game/sect/${sectId}`);
  return data.sect;
}

/** 设置守擂阵容（固定 3 人，顺序即出战顺序）。 */
export async function setDefenseLineup(discipleIds: string[]): Promise<SectStateView> {
  const data = await apiRequest<{ state: SectStateView }>('/api/v1/game/set-defense-lineup', {
    method: 'POST',
    body: { discipleIds },
  });
  return data.state;
}

/** 发起 3v3 挑战（攻方 3 人，顺序即对阵顺序）。 */
export async function challenge(
  targetSectId: string,
  discipleIds: string[],
): Promise<{ state: SectStateView; result: ChallengeResultView }> {
  return apiRequest<{ state: SectStateView; result: ChallengeResultView }>('/api/v1/game/challenge', {
    method: 'POST',
    body: { targetSectId, discipleIds },
  });
}

export async function fetchChallengeHistory(): Promise<ChallengeHistoryView> {
  return apiRequest<ChallengeHistoryView>('/api/v1/game/challenge-history');
}

/** 招贤结果（与后端 service.ts 的 recruitDisciple outcome 一一对应）。 */
export interface RecruitOutcome {
  discipleName: string;
  aptitude: number;
  luck: number;
  physique: number;
  attack: number;
  defense: number;
  speed: number;
  /** 六项属性等权现算的综合评分（一位小数）。 */
  attributeScore: number;
  talent: string;
  talentName: string;
}

/** 招募候选人（与后端 names.ts 的 RecruitCandidate 一一对应，含六属性与综合评分）。 */
export interface RecruitCandidate {
  name: string;
  gender: string;
  aptitude: number;
  attack: number;
  defense: number;
  speed: number;
  /** 0016 幸运 / 体魄（1~100）：只作用于单人定时历练。 */
  luck: number;
  physique: number;
  talent: string;
  talentName: string;
  /** 0016 综合评分：当前六项属性等权现算，一位小数（服务端算好，前端不另算）。 */
  attributeScore: number;
}

/** 招募预览（GET /game/recruit-preview）：同一批候选人刷新不变，「换一批」后换人。 */
export interface RecruitPreview {
  candidates: RecruitCandidate[];
  /**
   * 0016 批次标识：这批候选人来自哪一次生成机会。招募时必须原样回传；
   * 与当前批次不一致（跨天 / 换过一批 / 已招过一次 / 版本变化）时服务端拒绝且不扣费。
   */
  batch: string;
  canRecruit: boolean;
  blockedReason: string | null;
  cost: Record<string, string>;
  /** 本境界已用刷新次数。 */
  refreshUsed: number;
  /** 本境界刷新额度（宗门晋升后重置）。 */
  refreshLimit: number;
  /** 还剩几次刷新。 */
  refreshRemaining: number;
}

export async function fetchRecruitPreview(): Promise<RecruitPreview> {
  return apiRequest<RecruitPreview>('/api/v1/game/recruit-preview');
}

/** 换一批有缘人（POST /game/recruit-refresh）：消耗 1 次本境界刷新额度，返回新一批候选人与最新状态。 */
export async function refreshRecruitPreview(): Promise<{
  state: SectStateView;
  preview: RecruitPreview;
}> {
  return apiRequest<{ state: SectStateView; preview: RecruitPreview }>(
    '/api/v1/game/recruit-refresh',
    { method: 'POST' },
  );
}

/** 炼制丹药（POST /game/craft-pill）：quantity 1~5，返回写库后的完整状态与炼制结果。 */
export async function craftPill(pillId: string, quantity: number): Promise<{
  state: SectStateView;
  outcome: CraftPillOutcome;
}> {
  return apiRequest<{ state: SectStateView; outcome: CraftPillOutcome }>('/api/v1/game/craft-pill', {
    method: 'POST',
    body: { pillId, quantity },
  });
}

/**
 * 服用丹药（POST /game/use-pill）：目标弟子必须属于当前宗门，返回写库后的完整状态与服用效果。
 * count = 想服几颗（「服到满」传所需颗数）；服务端会按所需与库存截断，实际颗数见 outcome.count。
 */
export async function usePill(pillId: string, discipleId: string, count = 1): Promise<{
  state: SectStateView;
  outcome: UsePillOutcome;
}> {
  return apiRequest<{ state: SectStateView; outcome: UsePillOutcome }>('/api/v1/game/use-pill', {
    method: 'POST',
    body: { pillId, discipleId, count },
  });
}

/**
 * 0013 保存弟子私有备注（POST /game/set-disciple-note）：note 为空串表示清空；
 * 服务端 trim 后校验「单行纯文本、≤60 个 Unicode 字符」，返回写库后的完整状态。
 */
export async function setDiscipleNote(discipleId: string, note: string): Promise<SectStateView> {
  const data = await apiRequest<{ state: SectStateView }>('/api/v1/game/set-disciple-note', {
    method: 'POST',
    body: { discipleId, note },
  });
  return data.state;
}

/**
 * 0017 设置弟子头像框（POST /game/set-disciple-avatar-frame）：
 * frameId 只接受白名单里的固定 id（`classic` / `frame01`–`frame20`），不是自由上传；
 * 跨宗或不存在按 `NOT_FOUND` 处理，重复保存同一个值不产生任何副作用。
 */
export async function setDiscipleAvatarFrame(
  discipleId: string,
  frameId: AvatarFrameId,
): Promise<SectStateView> {
  const data = await apiRequest<{ state: SectStateView }>(
    '/api/v1/game/set-disciple-avatar-frame',
    { method: 'POST', body: { discipleId, frameId } },
  );
  return data.state;
}

/**
 * 0021 宗门改名（POST /game/rename-sect）：一次 500 灵石（价目由 state.rename.sectCost 给出）。
 * 名称规则（2-12 个码点、单行纯文本）与灵石余额都由服务端最终裁决；
 * 提交的名字与当前名字相同则不扣费、不写库（服务端显式早退）。
 */
export async function renameSect(name: string): Promise<SectStateView> {
  const data = await apiRequest<{ state: SectStateView }>('/api/v1/game/rename-sect', {
    method: 'POST',
    body: { name },
  });
  return data.state;
}

/**
 * 0021 弟子改名（POST /game/rename-disciple）：一次 50 灵石、2-6 个码点。
 * 与私有备注同一规则：在外历练期间也能改；历史记录（历练 / 赌坊）里的姓名快照不回填。
 */
export async function renameDisciple(discipleId: string, name: string): Promise<SectStateView> {
  const data = await apiRequest<{ state: SectStateView }>('/api/v1/game/rename-disciple', {
    method: 'POST',
    body: { discipleId, name },
  });
  return data.state;
}

/** 驱逐回执（与后端 service.ts 的 ExpelDiscipleOutcome 一一对应）。 */
export interface ExpelDiscipleOutcome {
  discipleId: string;
  discipleName: string;
  /** 该弟子被驱逐前占用手动守擂阵容，阵容已被同批清空（需要重新布阵）。 */
  lineupCleared: boolean;
  /** 驱逐后宗门剩余弟子数（< 3 时无法组成主动挑战阵容、也不能被挑战）。 */
  remainingDisciples: number;
}

/**
 * 0013 驱逐弟子（POST /game/expel-disciple）：只允许自己的现存弟子；
 * 不返还资源/招募次数，不降低宗门等级；成功后该弟子不再出现在返回的 state 里。
 */
export async function expelDisciple(discipleId: string): Promise<{
  state: SectStateView;
  outcome: ExpelDiscipleOutcome;
}> {
  return apiRequest<{ state: SectStateView; outcome: ExpelDiscipleOutcome }>(
    '/api/v1/game/expel-disciple',
    { method: 'POST', body: { discipleId } },
  );
}

/* ---------- 0014 弟子历练 ---------- */

/** 历练方向（与后端 journey.ts 的白名单一致）。 */
export type JourneyDirection = 'daoSeeking' | 'gathering';

/** 单条历练对弟子的归约状态（none = 没有未领取记录）。 */
export type JourneyStatusView = 'none' | 'active' | 'ready';

/** 历练结果（只在到期后公开；未领取时 claimedAt 为 null）。 */
export interface JourneyOutcomeView {
  /** 返程实际入账的修为（受返程门槛封顶；最高阶段为 0）。 */
  cultivationAwarded: number;
  /** 出发时快照的计划修为（含额外收获，未按门槛截断）。 */
  cultivationPlanned: number;
  /** 资源奖励（最小单位；领取时一次性入账）。 */
  resources: Record<string, string>;
  extraHarvest: boolean;
  injured: boolean;
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
  endsAt: string | null;
  /** 出发前岗位名（原岗位名额仍为该弟子保留）。 */
  originalAssignmentName: string | null;
  /** 已到期待领取时给出结果；未到期一律 null（服务端不泄漏结果）。 */
  outcome: JourneyOutcomeView | null;
  canStart: boolean;
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
  /** 额外收获概率（基点）：由**幸运**决定（1500 + (幸运 − 50) × 10；幸运 50 即 15%）。 */
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
  cultivationAwarded: number;
  resources: Record<string, string>;
  /** 本次入账的资源（最小单位，十进制字符串）。 */
  extraHarvest: boolean;
  injured: boolean;
  injuredUntil: string | null;
  endsAt: string;
  message: string;
}

/**
 * 0014 历练预览（GET /game/journey-preview）：只读，不做挂机结算。
 * 资格、奖励、概率与阻止原因全部由服务端算好，前端不复制任何公式。
 */
export async function fetchJourneyPreview(discipleId: string): Promise<JourneyPreviewView> {
  return apiRequest<JourneyPreviewView>(
    `/api/v1/game/journey-preview?discipleId=${encodeURIComponent(discipleId)}`,
  );
}

/** 0014 出发历练：方向与时长由预览给出，服务端重新校验并返回写库后的完整状态。 */
export async function startJourney(
  discipleId: string,
  direction: JourneyDirection,
  durationSeconds: number,
): Promise<SectStateView> {
  const data = await apiRequest<{ state: SectStateView }>('/api/v1/game/start-journey', {
    method: 'POST',
    body: { discipleId, direction, durationSeconds },
  });
  return data.state;
}

/** 0014 领取历练收获：资源一次性入账，返回最新状态与实际结果（重复领取不会重复发奖）。 */
export async function claimJourney(
  journeyId: string,
): Promise<{ state: SectStateView; outcome: JourneyClaimOutcomeView }> {
  return apiRequest<{ state: SectStateView; outcome: JourneyClaimOutcomeView }>(
    '/api/v1/game/claim-journey',
    { method: 'POST', body: { journeyId } },
  );
}

/* ---------- V6：交互式秘境探索 ---------- */

/** 一个遭遇选项（与后端 view.ts 的 EncounterChoiceView 一一对应）。 */
export interface EncounterChoiceView {
  id: string;
  label: string;
  riskHint: string;
  risk: 'safe' | 'normal' | 'risky';
}

/** 一次遭遇的展示内容（与后端 view.ts 的 EncounterView 一一对应）。 */
export interface EncounterView {
  name: string;
  description: string;
  choices: EncounterChoiceView[];
}

/** 进行中的交互探索（与后端 view.ts 的 ActiveExplorationView 一一对应）。 */
export interface ActiveExplorationView {
  id: string;
  realmId: string;
  realmName: string;
  totalStages: number;
  /** 已完成的关卡数（0 = 还没走完第一关）。 */
  currentStage: number;
  encounter: EncounterView;
  /** 运行中的奖励账本；真正的资源入账发生在整场结束时。 */
  rewardsCollected: Record<string, string>;
}

/** 判定结果（与后端 service.ts 的 ExploreOutcome 一致）。 */
export type ExploreOutcome = 'great_success' | 'success' | 'failure';

/** 一次选择的判定结果（与后端 view.ts 的 ExploreChoiceResultView 一一对应）。 */
export interface ExploreChoiceResult {
  outcome: ExploreOutcome;
  stageRewards: Record<string, string>;
  injury: { discipleName: string; until: string } | null;
  /** null = 这场探索结束了（通关或失败）。 */
  nextEncounter: EncounterView | null;
  /** 通关时整场入账的总奖励；未通关为 null。 */
  finalRewards: Record<string, string> | null;
  message: string;
}

/** 查询当前进行中的探索（刷新后恢复断点）；没有则 null。 */
export async function fetchActiveExploration(): Promise<ActiveExplorationView | null> {
  const data = await apiRequest<{ exploration: ActiveExplorationView | null }>(
    '/api/v1/game/realm-explore/active',
  );
  return data.exploration;
}

/** 开始交互探索（扣入场费 + 建记录 + 抽第一关遭遇）。 */
export async function startRealmExplore(
  realmId: string,
  discipleIds: string[],
): Promise<{ state: SectStateView; exploration: ActiveExplorationView }> {
  return apiRequest<{ state: SectStateView; exploration: ActiveExplorationView }>(
    '/api/v1/game/realm-explore/start',
    { method: 'POST', body: { realmId, discipleIds } },
  );
}

/** 提交一次选择（服务端判定；Decisions 不可用时自动降级，前端无感）。 */
export async function chooseRealmExplore(
  explorationId: string,
  choiceId: string,
): Promise<{ state: SectStateView; result: ExploreChoiceResult }> {
  return apiRequest<{ state: SectStateView; result: ExploreChoiceResult }>(
    '/api/v1/game/realm-explore/choose',
    { method: 'POST', body: { explorationId, choiceId } },
  );
}

/** 放弃探索（已获奖励照常入账，不退入场费）。 */
export async function abandonRealmExplore(
  explorationId: string,
): Promise<{ state: SectStateView }> {
  return apiRequest<{ state: SectStateView }>('/api/v1/game/realm-explore/abandon', {
    method: 'POST',
    body: { explorationId },
  });
}

/* ---------- 0019 赌坊（论道赌局） ---------- */

/** 六项可赌 / 可加点属性（与后端 gambling.ts 的 BETTABLE_ATTRIBUTES 同口径）。 */
export type DaoAttribute = 'attack' | 'defense' | 'speed' | 'aptitude' | 'luck' | 'physique';

/** 论道赌局入参（与后端 daoDebateRequestSchema 一一对应；多余字段会被服务端 400 拒绝）。 */
export interface DaoDebateInput {
  discipleId: string;
  betMode: 'preset_spirit_stone' | 'free_resource' | 'attribute';
  multiplier: 1 | 2 | 3;
  /** 模式「系统预设灵石」必填：赢灵石还是赢悟道值。 */
  rewardType?: 'resource' | 'insight';
  /** 模式「自由输入资源」必填：可赌资源白名单。 */
  resourceId?: 'spiritStone' | 'herb' | 'ore';
  /** 模式「自由输入资源」必填：赌注的**最小单位整数**（>= 10000）；展示单位 ×1000 后传入。 */
  amount?: number;
  /** 模式「属性赌注」必填：押注的属性。 */
  attribute?: DaoAttribute;
}

/** 论道赌局结果（与后端 view.ts 的 DaoDebateResultView 一一对应）。 */
export interface DaoDebateResult {
  discipleId: string;
  discipleName: string;
  betMode: string;
  multiplier: number;
  result: 'win' | 'lose';
  /** 赌注 / 奖励描述与 message 都由服务端拼好，前端只展示，不自己算数值。 */
  stakeDescription: string;
  rewardDescription: string;
  /** 幸运侦查提示（纯展示，不参与胜负）；幸运不足时为空数组。 */
  revealHints: string[];
  /** 对手六项属性（纯展示）。 */
  opponent: Record<string, number>;
  /**
   * 弟子下注当时的六项属性快照（与 opponent 同一时刻）。结算会改属性，
   * 所以对峙界面要读这里，而不是实时的 state.disciples。
   */
  discipleAttributes: Record<string, number>;
  /** jev 原始胜率（0~1）；null = 本次判定走了本地降级、没用模型。 */
  winProbability: number | null;
  message: string;
}

/** 悟道值加点回执（与后端 view.ts 的 InsightAllocateOutcome 一一对应）。 */
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
 * 0019 论道赌局（POST /game/dao-debate）：解锁、每日次数、弟子归属、余额与胜负
 * 全部由服务端裁决，返回写库后的完整状态与结果。
 */
export async function daoDebate(
  input: DaoDebateInput,
): Promise<{ state: SectStateView; result: DaoDebateResult }> {
  return apiRequest<{ state: SectStateView; result: DaoDebateResult }>('/api/v1/game/dao-debate', {
    method: 'POST',
    body: input,
  });
}

/** 赌坊详细记录条目（与后端 view.ts 的 DebateHistoryEntryView 一一对应）。 */
export interface DebateHistoryEntry {
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

/** 赌坊详细记录分页（与后端 view.ts 的 DebateHistoryView 一一对应）。 */
export interface DebateHistoryPage {
  entries: DebateHistoryEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** 战绩汇总（只在这里返回；sync 里的 gambling.stats 已不再下发）。 */
  stats: NonNullable<SectStateView['gambling']['stats']>;
}

/** 0019 赌坊详细记录（GET /game/debate-history?page=N）：只读、分页、不结算。 */
export async function fetchDebateHistory(page = 1): Promise<DebateHistoryPage> {
  return apiRequest<DebateHistoryPage>(`/api/v1/game/debate-history?page=${String(page)}`);
}

/** 0019 分配悟道值（POST /game/allocate-dao-insight）：points 1~50，服务端再做归属与上限校验。 */
export async function allocateDaoInsight(
  discipleId: string,
  attribute: DaoAttribute,
  points: number,
): Promise<{ state: SectStateView; outcome: InsightAllocateOutcome }> {
  return apiRequest<{ state: SectStateView; outcome: InsightAllocateOutcome }>(
    '/api/v1/game/allocate-dao-insight',
    { method: 'POST', body: { discipleId, attribute, points } },
  );
}

/* ---------- 0020 天机轮（赌坊第二个玩法） ---------- */

/** 天机轮的单个格子（与后端 view.ts 的 WheelSlotView 一一对应）。 */
export interface WheelSlotView {
  /** 'spirit_stone' | 'big_spirit_stone' | 'herb' | 'ore' | 'pill' | 'nothing'。 */
  type: string;
  /** 格子倍率（0.8~1.5）；谢谢惠顾为 0，丹药格带值但不参与奖励计算。 */
  multiplier: number;
  /** 服务端拼好的格面文案（如「灵石 ×1.3」「谢谢惠顾」）—— 前端只渲染，不自己拼。 */
  label: string;
}

/**
 * 天机轮面板（与后端 view.ts 的 WheelView 一一对应）：赌坊未解锁时为 null。
 * 格局由服务端按 seed 确定性生成，档位费用与重置费用也由服务端下发。
 */
export interface WheelView {
  seed: number;
  slots: WheelSlotView[];
  /** 各档位的转动费用（最小单位；1 展示单位 = 1000 最小单位）。 */
  costs: { tier: number; cost: number }[];
  /** 重置费用（最小单位）。 */
  resetCost: number;
}

/** 天机轮转动入参（与后端 wheelSpinRequestSchema 一一对应）：投入档位 1~5。 */
export interface WheelSpinInput {
  tier: number;
}

/** 天机轮转动结果（与后端 view.ts 的 WheelSpinResultView 一一对应）。 */
export interface WheelSpinResult {
  /** 命中的格子下标（对应 state.gambling.wheel.slots 的顺序）。 */
  slotIndex: number;
  tier: number;
  /** 本次实际扣掉的灵石（最小单位）。 */
  cost: string;
  /** 命中格子的格面文案（结果面板直接渲染）。 */
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
 * 0020 天机轮转动（POST /game/wheel-spin）：扣费、落格、发奖与每日次数
 * 全部由服务端裁决，返回写库后的完整状态与结果。
 */
export async function wheelSpin(
  input: WheelSpinInput,
): Promise<{ state: SectStateView; result: WheelSpinResult }> {
  return apiRequest<{ state: SectStateView; result: WheelSpinResult }>(
    '/api/v1/game/wheel-spin',
    { method: 'POST', body: input },
  );
}

/** 0020 天机轮重置（POST /game/wheel-reset）：扣重置费、格局整盘重排，不消耗每日次数。 */
export async function wheelReset(): Promise<{ state: SectStateView }> {
  return apiRequest<{ state: SectStateView }>('/api/v1/game/wheel-reset', { method: 'POST' });
}

/* ---------- 0024 灵兽竞逐（赌坊第三个玩法） ---------- */

export interface RaceBeastView {
  index: number;
  name: string;
  weight: number;
  winRate: number;
  pool: string;
  odds: number;
}

export interface RaceMyBetView {
  beastIndex: number;
  beastName: string;
  amount: string;
}

export interface RaceStateView {
  roundKey: string;
  phase: 'betting' | 'sealed' | 'settled' | 'closed';
  remainingSeconds: number;
  beasts: RaceBeastView[];
  totalPool: string;
  myBets: RaceMyBetView[];
  myTotalBet: string;
  winnerIndex: number | null;
  ranks: number[] | null;
  steps: number[][] | null;
  myWinnings: string | null;
  betFeed: RaceBetFeedView[];
}

export interface RaceBetFeedView {
  sectName: string;
  beastIndex: number;
  beastName: string;
  amount: string;
}

export async function fetchRaceState(): Promise<{ state: SectStateView; race: RaceStateView }> {
  return apiRequest<{ state: SectStateView; race: RaceStateView }>(
    '/api/v1/game/race-state',
  );
}

export async function placeRaceBet(
  beastIndex: number,
  betAmount: number,
): Promise<{ state: SectStateView; race: RaceStateView }> {
  return apiRequest<{ state: SectStateView; race: RaceStateView }>(
    '/api/v1/game/race-bet',
    { method: 'POST', body: { beastIndex, betAmount } },
  );
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

export async function fetchRaceHistory(page: number): Promise<RaceHistoryView> {
  return apiRequest<RaceHistoryView>(`/api/v1/game/race-history?page=${String(page)}`);
}

/* ---------- 坊市（材料买卖与丹药回收） ---------- */

/** 可交易材料（与后端 shop.ts 的 SHOP_TRADABLE_RESOURCES 同口径）：灵石与灵气都不可买卖。 */
export type ShopResourceId = 'herb' | 'ore';

/** 买入回执（与后端 shop.ts 的 ShopBuyResult 一一对应）。 */
export interface ShopBuyResult {
  action: 'buy';
  resourceId: string;
  resourceName: string;
  /** 买入的**展示单位**数量（= 服务端入账的最小单位 ÷ 1000）。 */
  amount: number;
  /** 花费灵石（最小单位）。 */
  cost: number;
  /** 服务端拼好的文案。 */
  message: string;
}

/** 卖出材料回执（与后端 shop.ts 的 ShopSellResult 一一对应）。 */
export interface ShopSellResult {
  action: 'sell';
  resourceId: string;
  resourceName: string;
  /** 卖出的**展示单位**数量。 */
  amount: number;
  /** 获得灵石（最小单位）。 */
  revenue: number;
  message: string;
}

/** 售丹回执（与后端 shop.ts 的 ShopSellPillResult 一一对应）。 */
export interface ShopSellPillResult {
  action: 'sell-pill';
  pillId: string;
  pillName: string;
  /** 卖出的颗数。 */
  quantity: number;
  /** 获得灵石（最小单位）。 */
  revenue: number;
  message: string;
}

/**
 * 坊市买入材料（POST /game/shop-buy）：amount 是**展示单位整数**（≥ 1）。
 * 余额、可交易白名单与材料容量上限全部由服务端裁决，返回写库后的完整状态与回执。
 */
export async function shopBuy(
  resourceId: ShopResourceId,
  amount: number,
): Promise<{ state: SectStateView; result: ShopBuyResult }> {
  return apiRequest<{ state: SectStateView; result: ShopBuyResult }>('/api/v1/game/shop-buy', {
    method: 'POST',
    body: { resourceId, amount },
  });
}

/** 坊市卖出材料（POST /game/shop-sell）：amount 是**展示单位整数**（≥ 1），库存由服务端校验。 */
export async function shopSell(
  resourceId: ShopResourceId,
  amount: number,
): Promise<{ state: SectStateView; result: ShopSellResult }> {
  return apiRequest<{ state: SectStateView; result: ShopSellResult }>('/api/v1/game/shop-sell', {
    method: 'POST',
    body: { resourceId, amount },
  });
}

/** 坊市卖出丹药（POST /game/shop-sell-pill）：quantity 是颗数（≥ 1），库存由服务端校验。 */
export async function shopSellPill(
  pillId: string,
  quantity: number,
): Promise<{ state: SectStateView; result: ShopSellPillResult }> {
  return apiRequest<{ state: SectStateView; result: ShopSellPillResult }>(
    '/api/v1/game/shop-sell-pill',
    { method: 'POST', body: { pillId, quantity } },
  );
}

/* ---------- 0025/0027 世界 Boss（讨伐，二期） ---------- */

export interface WorldBossDefView {
  index: number;
  name: string;
  /** 带关卡的显示名（如「第 2 关 · 赤炎火蛟」）。 */
  displayName: string;
  sealCharacter: string;
  color: string;
  description: string;
}

/** 词缀推荐排序属性（与 DisciplePicker 的 extraSort 同一个联合类型）。 */
export type WorldBossSortAttribute = 'attack' | 'defense' | 'speed' | 'luck' | 'physique';

/** 本关随机词缀。 */
export interface WorldBossAffixView {
  id: string;
  name: string;
  /** 效果文案（一行，保持简短）。 */
  effect: string;
  /** 配队提示。 */
  tip: string;
  /** 推荐排序属性（追加到选人组件的排序按钮里）。 */
  sortAttribute: WorldBossSortAttribute;
}

export interface WorldBossRankView {
  sectId: string;
  sectName: string;
  damage: number;
  attempts: number;
  isTopDamage: boolean;
  isLastHit: boolean;
  isMe: boolean;
}

export interface WorldBossHitView {
  sectId: string;
  sectName: string;
  discipleNames: string[];
  /** 本次受伤（普通受伤，30 分钟）的弟子名。 */
  injuredNames: string[];
  /** 本次被打成重伤（静养 1 天）的弟子名。 */
  severeNames: string[];
  damage: number;
  isCrit: boolean;
  isLastHit: boolean;
  createdAt: number;
}

/** 未出现 / 讨伐中 / 力竭中 / 已结束（UTC+8 时间段）。 */
export type WorldBossPhase = 'before' | 'open' | 'frenzy' | 'closed';

export interface WorldBossCurrentView {
  id: string;
  dayKey: string;
  /** 第几关（每天从 1 开始，连战递增）。 */
  stage: number;
  def: WorldBossDefView;
  affix: WorldBossAffixView;
  maxHp: number;
  hp: number;
  status: 'active' | 'killed' | 'fled';
  phase: WorldBossPhase;
  killerSectName: string | null;
  fledOutcome: 'repelled' | 'escaped' | null;
  endedAt: number | null;
}

/** 一次出手里某名弟子的判定结果。 */
export interface WorldBossMemberOutcomeView {
  discipleId: string;
  discipleName: string;
  outcome: 'normal' | 'injured' | 'severe';
}

export interface WorldBossView {
  boss: WorldBossCurrentView | null;
  phase: WorldBossPhase;
  /** 今天的出现时间（毫秒），未出现时用于「08:00 降临」提示。 */
  opensAt: number;
  remainingSeconds: number;
  /** 今日已连斩 N 只。 */
  killedToday: number;
  /** 史上最高「一天连斩 M 只」。 */
  bestStage: number;
  /** 出手冷却剩余秒数（0 = 可以出手）。 */
  cooldownSeconds: number;
  /** 本宗门弟子疲劳表：弟子 id → 最近 60 分钟的出战次数。 */
  fatigue: Record<string, number>;
  /** 最近 60 分钟内每次出战讨伐的时间（毫秒，升序），用于「冒进冷却」倒计时。 */
  fatigueTimes: Record<string, number[]>;
  /** 此刻能否出手：Boss 在讨伐中 + 开放时段 + 今日出手次数没用满。 */
  attackable: boolean;
  /** 本宗门今天已出手次数。 */
  attacksToday: number;
  /** 每日出手上限（0 = 不限；由服务端配置）。 */
  dailyAttackLimit: number;
  ranks: WorldBossRankView[];
  hits: WorldBossHitView[];
  topHit: WorldBossHitView | null;
  /**
   * 奖励预览：当前关卡、按本宗门此刻产出算的各名次奖励；rank 4 = 第 4 名及以后；资源为最小单位。
   * dropDescription 是 0028 的装备掉落说明（服务端拼好，前端直接渲染）。
   */
  rewardPreview: {
    stage: number;
    tiers: { rank: number; multiplier: number; resources: Record<string, number>; topDamagePill: boolean }[];
    lastHitStone: number;
    dropDescription: string;
    /** 三期：本关伤害占比 100% 时的功勋（展示单位）；实际按 √占比 折算，保底 2。 */
    meritFullShare: number;
    /** 本关击杀的玄铁：伤害占比 ≥ minSharePercent% 才有，第 1 名拿 top；below = 不足门槛时的数量。 */
    xuantie: { top: number; others: number; below: number; minSharePercent: number };
  } | null;
  /**
   * 三期：本宗门在当前关的掉落概率（boss 为 null 时为 null）。
   * 伤害占比与概率都由服务端算好（高档 = 75% × √占比），前端只渲染，不复制公式。
   */
  myDrop: {
    /** 本宗门对本关的伤害占比（0~1；还没出手为 0）。 */
    damageShare: number;
    /** 击杀时掉高档装备的概率（0~1）。 */
    highChance: number;
    /** 高档品质名（第 1～2 关灵品、第 3～4 关宝品、第 5 关起仙品）。 */
    highQualityName: string;
    /** 低档品质名。 */
    lowQualityName: string;
  } | null;
}

export interface WorldBossAttackResultView {
  damage: number;
  actualDamage: number;
  crit: boolean;
  frenzy: boolean;
  lastHit: boolean;
  bossHp: number;
  bossMaxHp: number;
  /** 击杀后立刻开出的下一关关卡号；没击杀为 null。 */
  nextStage: number | null;
  /** 本次每名弟子的判定结果（正常 / 受伤 / 重伤）。 */
  members: WorldBossMemberOutcomeView[];
}

export async function fetchWorldBoss(): Promise<{ state: SectStateView; boss: WorldBossView }> {
  return apiRequest<{ state: SectStateView; boss: WorldBossView }>('/api/v1/game/world-boss');
}

export async function attackWorldBoss(discipleIds: string[]): Promise<{
  state: SectStateView;
  result: WorldBossAttackResultView;
  boss: WorldBossView;
}> {
  return apiRequest<{
    state: SectStateView;
    result: WorldBossAttackResultView;
    boss: WorldBossView;
  }>('/api/v1/game/world-boss/attack', { method: 'POST', body: { discipleIds } });
}

/**
 * 三期功勋兑换入参（与后端 worldBossExchangeRequestSchema 一一对应；多余字段会被服务端 400 拒绝）。
 * 部位 / 主属性的组合合法性（法器必须选身法 / 幸运等）由服务端校验。
 */
/** 功勋兑换（GET /game/merit-shop）：分类（标签页）、价目、可选部位都由服务端给。 */
export interface MeritShopView {
  categories: { id: string; name: string }[];
  items: {
    id: string;
    name: string;
    /** 价格（功勋，展示单位）。 */
    cost: number;
    category: string;
    /** 装备类的品质与品质色；资源类为 null。 */
    quality: string | null;
    color: string | null;
  }[];
  slots: EquipmentSlotView[];
  /** 资源类一次最多兑换几个。 */
  maxResourceQuantity: number;
}

export async function fetchMeritShop(): Promise<MeritShopView> {
  const data = await apiRequest<{ shop: MeritShopView }>('/api/v1/game/merit-shop');
  return data.shop;
}

export interface BossMeritExchangeInput {
  /** xuantie（玄铁）| spirit（灵品）| treasure（宝品）| immortal（仙品）。 */
  itemId: string;
  /** 换玄铁时的个数（1~100）；换装备只能缺省或 1。 */
  quantity?: number;
  /** 换装备时的部位（weapon / armor / artifact）；换玄铁不许带。 */
  slot?: string;
  /** 法器必须带（speed / luck）；其它部位不许带。 */
  mainAttr?: string;
}

/** 功勋兑换回执（POST /game/world-boss/exchange 的 outcome，与后端 service.ts 的 BossMeritExchangeOutcome 一一对应）。 */
export interface BossMeritExchangeOutcome {
  itemId: string;
  /** 花掉的功勋（最小单位）。 */
  cost: number;
  /** 兑换到的玄铁（最小单位）；兑换装备时为 0。 */
  xuantie: number;
  /** 兑换到的装备；兑换玄铁时为 null。 */
  equipment: { id: string; name: string; quality: string; slot: string; slotName: string } | null;
}

/**
 * 三期功勋兑换（POST /game/world-boss/exchange）：价格、余额、背包与部位都最终由服务端裁决，
 * 必定成功、不需要炼器坊；成功返回写库后的完整状态与兑换回执。
 */
export async function exchangeBossMerit(
  input: BossMeritExchangeInput,
): Promise<{ state: SectStateView; outcome: BossMeritExchangeOutcome }> {
  return apiRequest<{ state: SectStateView; outcome: BossMeritExchangeOutcome }>(
    '/api/v1/game/world-boss/exchange',
    { method: 'POST', body: input },
  );
}

/* ---------- 0028 装备（炼器 / 背包 / 穿戴 / 分解） ---------- */

/** 装备部位（与后端 equipment.ts 的 EQUIPMENT_SLOTS 同口径）。 */
export type EquipmentSlotId = 'weapon' | 'armor' | 'artifact';

/** 法器可选的主属性（只有法器需要玩家选，其余部位由服务端按规则固定）。 */
export type EquipmentMainAttr = 'speed' | 'luck';

/**
 * 单件装备视图（背包卡片与弟子装备格共用）。
 * 品质名 / 颜色、部位名与属性名都由服务端下发，前端只渲染，不复制一份规则表。
 */
export interface EquipmentItemView {
  id: string;
  /** weapon | armor | artifact。 */
  slot: EquipmentSlotId;
  slotName: string;
  /** common | spirit | treasure | immortal。 */
  quality: string;
  qualityName: string;
  /** 品质色（卡片边框用），如 `#fbbf24`。 */
  color: string;
  /** `{品质名}·{部位名}`，如「仙品·紫金葫芦」。 */
  name: string;
  mainAttr: string;
  mainAttrName: string;
  mainValue: number;
  subAttr: string;
  subAttrName: string;
  subValue: number;
  source: 'forge' | 'boss';
  /** 0032 穿在身上时给弟子的战力加成（基点，按品质）。 */
  powerBonusBp: number;
  /** 穿在谁身上；null = 在背包里（背包 = 本宗未穿戴的装备）。 */
  discipleId: string | null;
  discipleName: string | null;
  createdAt: string;
}

/** 一个可炼部位；法器的 mainAttrChoices 非空（玩家必须选身法或幸运）。 */
export interface EquipmentSlotView {
  id: EquipmentSlotId;
  name: string;
  mainAttrChoices: { id: string; name: string }[];
}

/**
 * 装备面板视图（GET /game/equipment）。
 * 解锁判断、背包计数、炼器价格、可选部位与主属性候选、分解返还都由服务端算好。
 */
export interface EquipmentView {
  unlocked: boolean;
  blockedReason: string | null;
  /** 背包已用件数（穿在身上的不占背包）。 */
  bagCount: number;
  bagCapacity: number;
  /** 单次炼器消耗（最小单位）。 */
  forgeCost: Record<string, string>;
  /** 一期只能炼的品质（凡品）。 */
  forgeQuality: string;
  forgeQualityName: string;
  /** 装备二期：炼器坊等级（决定可炼的最高品质）。 */
  workshopLevel: number;
  /** 装备二期：各品质炼造选项（消耗为最小单位；unlocked = 炼器坊等级已够）。 */
  forgeOptions: {
    quality: string;
    name: string;
    color: string;
    workshopLevel: number;
    unlocked: boolean;
    cost: Record<string, string>;
    /** 成功 / 降级 / 失败概率（0~1）。 */
    odds: { success: number; downgrade: number; fail: number };
  }[];
  slots: EquipmentSlotView[];
  /** 品质 id → 分解返还的矿石（**展示单位**，直接显示数字即可）。 */
  salvageOre: Record<string, number>;
  /** 本宗全部装备（背包 + 已穿戴），新的在前。 */
  items: EquipmentItemView[];
}

/** 炼器回执（POST /game/forge-equipment 的 outcome）。 */
export interface ForgeEquipmentOutcome {
  /** success = 所选品质；downgrade = 低一档；fail = 没出装备（refund 为返还的灵石 / 矿石）。 */
  result: 'success' | 'downgrade' | 'fail';
  equipmentId: string | null;
  name: string | null;
  slot: string;
  slotName: string;
  quality: string | null;
  refund: Record<string, number>;
  cost: Record<string, string>;
}

/** 穿戴 / 卸下回执（POST /game/equip、/game/unequip 的 outcome）。 */
export interface EquipChangeOutcome {
  equipmentId: string;
  name: string;
  slot: EquipmentSlotId;
  slotName: string;
  /** 现在穿在谁身上；卸下后为 null（已回背包）。 */
  discipleId: string | null;
  discipleName: string | null;
  /** 换装时被顶替回背包的那件装备名；没有为 null。 */
  replacedName: string | null;
}

/** 分解回执（POST /game/salvage-equipment 的 outcome）。 */
export interface SalvageEquipmentOutcome {
  /** 实际分解的件数（已去重）。 */
  count: number;
  /** 返还的矿石（**最小单位**，用 formatAmount 显示）。 */
  ore: number;
  /** 装备二期：返还的玄铁（最小单位）。 */
  xuantie: number;
}

/** 0028 读取装备面板（GET /game/equipment）：只读，不结算；装备明细不放进 /game/sync。 */
export async function fetchEquipment(): Promise<{
  state: SectStateView;
  equipment: EquipmentView;
}> {
  return apiRequest<{ state: SectStateView; equipment: EquipmentView }>('/api/v1/game/equipment');
}

/** 0028 炼器（POST /game/forge-equipment）：法器必须给 mainAttr（speed / luck），其他部位不能给。 */
export async function forgeEquipment(
  slot: EquipmentSlotId,
  mainAttr?: EquipmentMainAttr,
  quality?: string,
): Promise<{ state: SectStateView; outcome: ForgeEquipmentOutcome }> {
  return apiRequest<{ state: SectStateView; outcome: ForgeEquipmentOutcome }>(
    '/api/v1/game/forge-equipment',
    {
      method: 'POST',
      body: {
        slot,
        ...(mainAttr === undefined ? {} : { mainAttr }),
        ...(quality === undefined ? {} : { quality }),
      },
    },
  );
}

/** 0028 穿戴（POST /game/equip）：目标弟子与装备归属、在外 / 重伤都由服务端校验。 */
export async function equipItem(
  equipmentId: string,
  discipleId: string,
): Promise<{ state: SectStateView; outcome: EquipChangeOutcome }> {
  return apiRequest<{ state: SectStateView; outcome: EquipChangeOutcome }>('/api/v1/game/equip', {
    method: 'POST',
    body: { equipmentId, discipleId },
  });
}

/** 0028 卸下（POST /game/unequip）：装备回背包；背包满时服务端会拒绝。 */
export async function unequipItem(
  equipmentId: string,
): Promise<{ state: SectStateView; outcome: EquipChangeOutcome }> {
  return apiRequest<{ state: SectStateView; outcome: EquipChangeOutcome }>(
    '/api/v1/game/unequip',
    { method: 'POST', body: { equipmentId } },
  );
}

/** 0028 分解（POST /game/salvage-equipment）：1~50 件（重复 id 由服务端去重），只能分解背包里的。 */
export async function salvageEquipment(
  equipmentIds: string[],
): Promise<{ state: SectStateView; outcome: SalvageEquipmentOutcome }> {
  return apiRequest<{ state: SectStateView; outcome: SalvageEquipmentOutcome }>(
    '/api/v1/game/salvage-equipment',
    { method: 'POST', body: { equipmentIds } },
  );
}
