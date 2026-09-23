import type { GameConfigContent } from '@xiuxian/game-core';

import { validatedGameConfig } from '../../config/loadGameConfig';
import { AppError } from '../../http/appError';
import { classifyDbError } from '../../infra/db/errors';
import { prepareStatements, type ParameterizedQuery } from '../../infra/db/repository';
import {
  decide,
  type ChoiceAnswer,
  type NoulAnswer,
  type Question,
} from '../../infra/openrouter/decisions';
import {
  alchemyUnlockBlockedReason,
  bodyTemperingTarget,
  findPillRecipe,
  BODY_TEMPERING_MAX_USES,
  CULTIVATION_PILL_GAIN,
  type PillAttribute,
  type PillId,
  type PillRecipe,
} from './alchemy';
import {
  ATTRIBUTE_INSIGHT_REWARDS,
  ATTRIBUTE_LABELS,
  ATTRIBUTE_MAX,
  ATTRIBUTE_STAKES,
  DAO_INSIGHT_CAP,
  DEBATE_DAILY_LIMIT,
  DEGRADED_WIN_RATES,
  FREE_BET_MIN,
  MULTIPLIER_HINTS,
  PRESET_INSIGHT_REWARDS,
  PRESET_RESOURCE_REWARDS,
  PRESET_STAKES,
  BEAST_NAMES,
  RACE_BEAST_COUNT,
  RACE_BET_MAX,
  RACE_BET_MIN,
  RACE_BROADCAST_PAYOUT_THRESHOLD,
  RACE_LOG_NAME,
  RACE_BETTING_MS,
  beastNameAt,
  beastWeightsFromRoundKey,
  generateRaceSteps,
  isRaceOperatingHour,
  raceFixedOdds,
  racePhaseOf,
  raceRankRandomOf,
  raceRanksOf,
  raceWeightedPick,
  WHEEL_RESET_COST,
  debateDayStateOf,
  debateTierProbability,
  freeBetReward,
  freeBetStake,
  gamblingUnlockBlockedReason,
  generateOpponentAttrs,
  generateRevealHints,
  generateWheelSlots,
  isBettableResource,
  wheelLayoutSeed,
  wheelReward,
  wheelSlotLabel,
  wheelSpinCost,
  wheelWeightedPick,
  type BetMode,
  type BettableAttribute,
  type BettableResource,
  type DebateDayState,
  type Multiplier,
  type WheelSlot,
  type WheelTier,
} from './gambling';
import {
  UNITS_PER_DISPLAY,
  asShopTradableResource,
  shopBuyCost,
  shopPillPrice,
  shopPillRevenue,
  shopSellRevenue,
  toMinUnits,
  type ShopTradableResource,
} from './shop';
import {
  CHALLENGE_DAILY_LIMIT,
  availableDefenders,
  asDefenseMode,
  asRewardTier,
  challengeDayStateOf,
  lineupContainsDisciple,
  planDefenseLineup,
  rewardTierForLevelDifference,
  shufflePick,
  type ChallengeDayState,
  type DefenseMode,
} from './challenge';
import {
  DEFENSE_LINEUP_SIZE,
  IDLE_ASSIGNMENT,
  RECRUIT_REFRESH_PER_LEVEL,
  SPIRITUAL_ARRAY_BUILDING_ID,
  STONE_MINING_ASSIGNMENT,
  STONE_MINING_LIMIT_HIGH,
  STONE_MINING_LIMIT_LOW,
  STONE_MINING_UNLOCK_SECT_LEVEL,
  breakthroughEnergyCost,
  dateKeyUtc8,
  effectiveCapacity,
  dayStartMs,
  findRealm,
  findSectLevel,
  findStage,
  findTalent,
  nextSectLevel,
  nextStageOf,
  realmIndex,
} from './constants';
import { drawEncounters, type EncounterDef } from './encounters';
import { EVENT_HISTORY_LIMIT, RECENT_EVENTS_IN_SYNC } from './events';
import {
  DISCIPLE_NAME_MAX_CHARS,
  DISCIPLE_NAME_MIN_CHARS,
  DISCIPLE_RENAME_COST,
  SECT_NAME_MAX_CHARS,
  SECT_NAME_MIN_CHARS,
  SECT_RENAME_COST,
  attributeScore,
  generateAttributes,
  generateCandidates,
  generateTalent,
  randomDiscipleName,
  randomGender,
  recruitBatchId,
  recruitBatchStatus,
  type RecruitCandidate,
} from './names';
import {
  ARENA_BUILDING_ID,
  SECRET_REALMS,
  discipleCombatPower,
  explorationSuccessChanceBp,
  findSecretRealm,
  partyCombatPower,
} from './realms';
import {
  BuildingRepository,
  ChallengeRepository,
  DiscipleRepository,
  EventLogRepository,
  ExplorationRepository,
  PillInventoryRepository,
  ResourceBalanceRepository,
  SectRepository,
  SparringRepository,
  alchemySnapshotGuardStatement,
  challengeSnapshotGuardStatement,
  deleteAlchemySnapshotGuardStatement,
  deleteChallengeSnapshotGuardStatement,
  deleteDiscipleSnapshotGuardStatement,
  deleteDiscipleStatement,
  discipleSnapshotGuardStatement,
  insertBuildingStatement,
  insertChallengeLogStatement,
  insertDiscipleStatement,
  insertEventLogStatement,
  insertExplorationStatement,
  insertResourceBalanceStatement,
  insertSectStatement,
  insertSparringLogStatement,
  settlementSnapshotGuardStatements,
  updateBuildingLevelStatement,
  updateDiscipleAssignmentStatement,
  updateDiscipleAvatarFrameStatement,
  updateDiscipleBodyTemperingStatement,
  updateDiscipleCultivationStatement,
  updateDiscipleInjuryStatement,
  updateDiscipleNameStatement,
  updateDiscipleNoteStatement,
  updateDiscipleProgressStatement,
  updatePillInventoryQuantityStatement,
  updateResourceSettledStatement,
  updateSectChallengeCounterStatement,
  updateSectDefenseLineupStatement,
  updateSectLevelStatement,
  updateSectNameStatement,
  updateSectRecruitCounterStatement,
  updateSectRecruitRefreshStatement,
  updateSectReputationStatement,
  updateSectSettledStatement,
  upsertPillInventoryStatement,
  type BuildingRow,
  type DiscipleRow,
  type EventLogRow,
  type PillInventoryRow,
  type ResourceBalanceRow,
  type SectRow,
} from './repository';

import {
  DiscipleJourneyRepository,
  claimDiscipleJourneyStatement,
  completeDiscipleJourneyStatement,
  deleteJourneyClaimSnapshotGuardStatement,
  deleteJourneyStartSnapshotGuardStatement,
  insertDiscipleJourneyStatement,
  journeyClaimSnapshotGuardStatement,
  journeyStartSnapshotGuardStatement,
  updateDiscipleJourneyReturnStatement,
} from './repository';
import type { DiscipleJourneyRow, RealmExplorationRow } from './repository';
import {
  RealmExplorationRepository,
  deleteRealmExploreSnapshotGuardStatement,
  insertRealmExplorationStatement,
  realmExploreSnapshotGuardStatement,
  updateExplorationResultStatement,
  updateRealmExplorationStageStatement,
} from './repository';
import {
  deleteGamblingSnapshotGuardStatement,
  gamblingSnapshotGuardStatement,
  insertDaoDebateLogStatement,
  updateDiscipleAttributeStatement,
  updateDiscipleDaoInsightStatement,
  updateDiscipleInsightAllocateStatement,
  updateSectDebateCounterStatement,
  updateSectWheelSeedStatement,
} from './repository';
import {
  ChatMessageRepository,
  insertChatMessageStatement,
} from './repository';
import {
  RaceRepository,
  insertRaceBetStatement,
  insertRaceRoundStatement,
  resourceDeltaStatement,
  settleRaceRoundStatement,
  updateRaceRoundPoolStatement,
} from './repository';
import { settleEconomy, type SettleResult } from './settle';

import {
  JOURNEY_DIRECTIONS,
  JOURNEY_DURATIONS_SECONDS,
  JOURNEY_HISTORY_LIMIT,
  JOURNEY_MAX_CONCURRENT,
  asJourneyDirection,
  cultivateJourneyReturn,
  findJourneyDirection,
  isJourneyDirection,
  isJourneyDuration,
  journeyAwayIds,
  journeyBaseRewardForDisciple,
  journeyDirectionBlockedReason,
  journeyDurationLabel,
  journeyEligibilityBlock,
  journeyEndsAt,
  journeyFinalReward,
  journeyInjuryUntil,
  journeyStatusOf,
  journeyThresholdOf,
  parseJourneyRewardResources,
  previewJourneyCultivation,
  rollJourneyOutcome,
  type JourneyBlock,
} from './journey';
import {
  breakthroughChanceBp,
  buildSectStateView,
  eventLogViewFromRow,
  upgradeCost,
  type ChallengeBlockedReason,
  type ChallengeRewardPreviewView,
  type EventLogView,
  type ChallengeHistoryEntryView,
  type ChallengeHistoryView,
  type ChallengeResultView,
  type ChallengeRoundView,
  type ExplorationResultView,
  type LeaderboardEntryView,
  type PublicSectChallengeView,
  type PublicSectView,
  type SecretRealmListView,
  type SectStateView,
  type SparHistoryView,
  type SparHistoryEntryView,
  type SparResultView,
  type JourneyClaimOutcomeView,
  type JourneyDirectionPreviewView,
  type JourneyDurationPreviewView,
  type JourneyPreviewView,
  type ActiveExplorationView,
  type EncounterView,
  type ExploreChoiceResultView,
  type DaoDebateResultView,
  type InsightAllocateOutcome,
  type DebateHistoryEntryView,
  type DebateHistoryView,
  type WheelSpinResultView,
  type RaceStateView,
  type RaceBeastView,
  type RaceMyBetView,
  type RaceBetFeedView,
  type RaceHistoryView,
  type RaceHistoryRoundView,
  type RaceBeastStatView,
  type ShopBuyResultView,
  type ShopSellResultView,
  type ShopSellPillResultView,
  type DiscipleLeaderboardEntryView,
  type DiscipleLeaderboardView,
  type ChatMessageView,
} from './view';

/**
 * 游戏服务（一次性可玩版本）。
 *
 * 每个命令都是同一套路：读快照 → 结算（纯函数）→ 校验 → 把「结算写回 + 命令写入」
 * 组装成**一次** D1 batch 提交 → 用内存中的新状态返回给前端。
 * 没有幂等键、没有版本号、没有事务守卫（任务卡明确要求）。
 */

export interface SectSnapshot {
  sect: SectRow;
  disciples: DiscipleRow[];
  buildings: BuildingRow[];
  balances: ResourceBalanceRow[];
  /** 丹药库存（可能为空数组；没有行的 pill 视为 0）。 */
  pillInventories: PillInventoryRow[];
  /** 主动挑战的当日次数（0012；日期键过期时已做日志兼容核对）。 */
  challengeDay: ChallengeDayState;
  /** 0019 赌坊：论道当日次数（dateKey + 已用 + 剩余；归一在 gambling.ts 完成）。 */
  debateDay: DebateDayState;
  /** 赌坊战绩汇总（聚合 dao_debate_log）。 */
  debateStats: DebateStats;
  /** 读快照时库里的最近事件行；本次结算刚触发的在本层另行合并（见 view.ts）。 */
  recentEvents: EventLogRow[];
  /** 0014：本宗未领取的历练记录（在外中 + 待领取）。 */
  journeys: DiscipleJourneyRow[];
  /** 0014：最近历练记录（含已领取，最多 10 条）。 */
  recentJourneys: DiscipleJourneyRow[];
  /** 0015：进行中的交互式秘境探索（每宗门同时最多一个）；null = 当前没有。 */
  activeExploration: RealmExplorationRow | null;
}

/** 全局唯一配置来源：启动期已校验过的配置内容（不在游戏模块里硬编码数值）。 */
export function gameConfig(): GameConfigContent {
  return validatedGameConfig.content;
}

/**
 * 主动挑战的当日次数口径（计划 4.2）：宗门行的日期键是今天就读 challenge_count，
 * 否则视为 0，但用 challenge_log 的日窗口查询做发布当天兼容核对（旧记录没有日期键）。
 * 展示值 clamp 到 0..3，数据异常不让前端出现负数。
 */
async function loadChallengeDayState(
  db: D1Database,
  sect: SectRow,
  now: number,
): Promise<ChallengeDayState> {
  const dateKey = dateKeyUtc8(now);
  const keyMatches = sect.challenge_date_key === dateKey;
  const legacyUsedToday = keyMatches
    ? 0
    : await new ChallengeRepository(db).countTodayByAttacker(sect.id, dateKey, dayStartMs(now));
  return challengeDayStateOf(sect, now, legacyUsedToday);
}

/** 赌坊战绩汇总（从 dao_debate_log 聚合；0020 起天机轮的转动也计入胜负与灵石净收益）。 */
export interface DebateStats {
  total: number;
  wins: number;
  losses: number;
  /**
   * 灵石净收益（最小单位，可为负）：论道只减败北的赌注（赢的奖励里已含退还的赌注），
   * 天机轮则每一次转动都减投入（无论输赢都先扣费）。
   */
  netSpiritStone: number;
  /** 累计获得的悟道值（只赢才有，不扣回）。 */
  totalInsight: number;
}

async function loadDebateStats(db: D1Database, sectId: string): Promise<DebateStats> {
  const row = await db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) AS wins,
         SUM(CASE WHEN result = 'lose' THEN 1 ELSE 0 END) AS losses,
        COALESCE(SUM(CASE
          WHEN result = 'win' AND json_extract(reward_detail, '$.type') = 'resource'
               AND json_extract(reward_detail, '$.resourceId') = 'spiritStone'
          THEN CAST(json_extract(reward_detail, '$.amount') AS INTEGER)
          ELSE 0
        END), 0)
        - COALESCE(SUM(CASE
          -- 论道：只有败北才真扣赌注（赢的奖励里已含退还的赌注 + 净赢），所以只减 lose 那一条；
          -- 天机轮（0020）：无论输赢都先扣投入，赢的奖励只是「投入 × 倍率」，
          -- 所以每一次转动都要按注额全额减，否则每次中奖都会把投入当成净赚。
          -- 灵兽竞逐（0024）同天机轮：每轮都减总投入，押中的赔付（含本金）在上面加回。
          WHEN (result = 'lose' AND bet_mode IN ('preset_spirit_stone', 'free_resource'))
               OR bet_mode IN ('wheel', 'beast_race')
          THEN CASE
            WHEN COALESCE(json_extract(stake_detail, '$.resourceId'), 'spiritStone') = 'spiritStone'
            THEN CAST(json_extract(stake_detail, '$.amount') AS INTEGER)
            ELSE 0
          END
          ELSE 0
        END), 0) AS net_spirit_stone,
         COALESCE(SUM(CASE
           WHEN result = 'win' AND json_extract(reward_detail, '$.type') = 'insight'
           THEN json_extract(reward_detail, '$.insight')
           ELSE 0
         END), 0) AS total_insight
       FROM dao_debate_log WHERE sect_id = ?`,
    )
    .bind(sectId)
    .first<{
      total: number;
      wins: number;
      losses: number;
      net_spirit_stone: number;
      total_insight: number;
    }>();
  return {
    total: Number(row?.total) || 0,
    wins: Number(row?.wins) || 0,
    losses: Number(row?.losses) || 0,
    netSpiritStone: Number(row?.net_spirit_stone) || 0,
    totalInsight: Number(row?.total_insight) || 0,
  };
}

const DEBATE_HISTORY_PAGE_SIZE = 10;

export async function listDebateHistory(
  db: D1Database,
  userId: string,
  page: number,
): Promise<DebateHistoryView> {
  const sect = await new SectRepository(db).findByUserId(userId);
  if (sect === null) {
    return { entries: [], total: 0, page: 1, pageSize: DEBATE_HISTORY_PAGE_SIZE, totalPages: 1 };
  }

  const countRow = await db
    .prepare('SELECT COUNT(*) AS cnt FROM dao_debate_log WHERE sect_id = ?')
    .bind(sect.id)
    .first<{ cnt: number }>();
  const total = Number(countRow?.cnt) || 0;
  const totalPages = Math.max(1, Math.ceil(total / DEBATE_HISTORY_PAGE_SIZE));
  const safePage = Math.max(1, Math.min(page, totalPages));
  const offset = (safePage - 1) * DEBATE_HISTORY_PAGE_SIZE;

  const { results } = await db
    .prepare(
      `SELECT id, disciple_name, bet_mode, multiplier, result,
              stake_detail, reward_detail, win_probability, created_at
       FROM dao_debate_log
       WHERE sect_id = ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(sect.id, DEBATE_HISTORY_PAGE_SIZE, offset)
    .all();

  const entries: DebateHistoryEntryView[] = (results ?? []).map((row) => ({
    id: String(row.id),
    discipleName: String(row.disciple_name),
    betMode: String(row.bet_mode),
    multiplier: Number(row.multiplier),
    result: row.result === 'win' ? ('win' as const) : ('lose' as const),
    stakeDetail: String(row.stake_detail),
    rewardDetail: String(row.reward_detail),
    winProbability: row.win_probability != null ? Number(row.win_probability) : null,
    createdAt: new Date(Number(row.created_at)).toISOString(),
  }));

  return { entries, total, page: safePage, pageSize: DEBATE_HISTORY_PAGE_SIZE, totalPages };
}

async function loadSnapshot(
  db: D1Database,
  userId: string,
  now: number,
): Promise<SectSnapshot | null> {
  const sect = await new SectRepository(db).findByUserId(userId);
  if (sect === null) {
    return null;
  }
  const [
    disciples,
    buildings,
    balances,
    pillInventories,
    recentEvents,
    challengeDay,
    journeys,
    recentJourneys,
    activeExploration,
  ] = await Promise.all([
    new DiscipleRepository(db).findBySectId(sect.id),
    new BuildingRepository(db).findBySectId(sect.id),
    new ResourceBalanceRepository(db).findBySectId(sect.id),
    new PillInventoryRepository(db).findBySectId(sect.id),
    new EventLogRepository(db).findRecentBySectId(sect.id, RECENT_EVENTS_IN_SYNC),
    loadChallengeDayState(db, sect, now),
    // 0014：未领取的历练（在外中 + 待领取）与最近历史（含已领取，最多 10 条）。
    new DiscipleJourneyRepository(db).findOpenBySectId(sect.id),
    new DiscipleJourneyRepository(db).findRecentBySectId(sect.id, JOURNEY_HISTORY_LIMIT),
    // 0015：进行中的交互式秘境探索（每宗门同时最多一个）。
    new RealmExplorationRepository(db).findActiveBySectId(sect.id),
  ]);
  // 0019 赌坊：论道当日次数（0019 是新表新列，没有需要按日志窗口兼容核对的旧记录）。
  const debateDay = debateDayStateOf(sect, now);
  const debateStats = await loadDebateStats(db, sect.id);
  return {
    sect,
    disciples,
    buildings,
    balances,
    pillInventories,
    challengeDay,
    debateDay,
    debateStats,
    recentEvents,
    journeys,
    recentJourneys,
    activeExploration,
  };
}

/**
 * 已结算的草稿：结算结果 + 命令附加语句。
 *
 * 结算的写回语句在构造时算好（只写真正变化的行），命令的写入用 `addStatement` 追加，
   * 最后 `commit()` 以快照守卫和写回同批提交，顺序即数组顺序（先结算，再消耗/产出）。
 */
class SectDraft {
  readonly config: GameConfigContent;
  readonly now: number;
  readonly settleResult: SettleResult;
  /** 当前宗门等级决定的弟子上限。 */
  readonly discipleCapacity: number;
  /** 当前宗门等级决定的建筑上限。 */
  readonly buildingCapacity: number;
  /** 当前宗门等级的资源容量倍率。 */
  readonly capacityMultiplier: number;
  readonly sect: SectRow;
  disciples: DiscipleRow[];
  readonly buildings: BuildingRow[];
  balances: ResourceBalanceRow[];
  /** 丹药库存（可变：炼制加、服用减；与写库语句一起在 commit 一次性提交）。 */
  pillInventories: PillInventoryRow[];
  /** 主动挑战的当日次数（可变：挑战受理后在本层更新，随 view() 返回新口径）。 */
  challengeDay: ChallengeDayState;
  /** 0019 赌坊：论道当日次数（可变：受理一次论道后在本层更新，随 view() 返回新口径）。 */
  debateDay: DebateDayState;
  readonly recruitUsedToday: number;

  private readonly statements: ParameterizedQuery[] = [];
  /** 0014：未领取的历练记录（在外中 + 待领取）；本批可能被完成 / 领取而改变。 */
  journeys: DiscipleJourneyRow[];
  /** 0014：读快照时的最近历练记录（含已领取）；与 journeys 合并去重后交给 view。 */
  recentJourneys: DiscipleJourneyRow[];
  /** 0015：进行中的交互式秘境探索（本批可能被推进 / 结束）。 */
  activeExploration: RealmExplorationRow | null;
  /** 0014：本批归队入账产生的语句（附在结算写回之后同批提交）。 */
  private readonly journeyReturnStatements: ParameterizedQuery[] = [];
  /** 0014：本批已完成归队的弟子 id（他们的修为/伤势由归队语句一次写完）。 */
  private readonly journeyReturnedDiscipleIds = new Set<string>();

  constructor(
    private readonly db: D1Database,
    private readonly base: SectSnapshot,
    now: number,
  ) {
    this.config = gameConfig();
    this.now = now;

    const levelDef = findSectLevel(Number(base.sect.level));
    this.discipleCapacity = levelDef.discipleCapacity;
    this.buildingCapacity = levelDef.buildingCapacity;
    this.capacityMultiplier = levelDef.capacityMultiplier;

    // 0014：未领取的历练记录（在外中 + 待领取）；最近历史另查一次，供摘要用。
    this.journeys = base.journeys.map((row) => ({ ...row }));
    this.recentJourneys = base.recentJourneys.map((row) => ({ ...row }));
    this.activeExploration = base.activeExploration === null ? null : { ...base.activeExploration };

    const lastSettledAt = Number(base.sect.last_settled_at);
    // 0014：未领取的历练就是「在外区间」；结算只屏蔽这些区间内的岗位产出与静修，
    // 结算窗口（含唯一的 12 小时上限）与随机事件判定仍然各只有一份。
    const absences = this.journeys.map((row) => ({
      discipleId: row.disciple_id,
      startMs: Number(row.started_at),
      endMs: Number(row.ends_at),
    }));
    this.settleResult = settleEconomy({
      config: this.config,
      lastSettledAt,
      now,
      resources: base.balances.map((row) => ({
        resourceId: row.resource_id,
        balance: Number(row.balance),
        remainder: Number(row.remainder),
      })),
      disciples: base.disciples.map((row) => ({
        id: row.id,
        aptitude: Number(row.aptitude),
        realmId: row.realm_id,
        stage: Number(row.stage),
        cultivation: Number(row.cultivation),
        cultivationRemainder: Number(row.cultivation_remainder),
        assignment: row.assignment,
        talent: row.talent,
      })),
      capacityMultiplier: this.capacityMultiplier,
      buildingLevels: Object.fromEntries(base.buildings.map((row) => [row.def_id, row.level])),
      absences,
    });

    this.sect = { ...base.sect, last_settled_at: this.settleResult.lastSettledAt };
    this.balances = base.balances.map((row) => {
      const settled = this.settleResult.resources.find((item) => item.resourceId === row.resource_id);
      if (settled === undefined) {
        return { ...row };
      }
      return { ...row, balance: settled.balance, remainder: settled.remainder };
    });
    this.disciples = base.disciples.map((row) => {
      const settled = this.settleResult.disciples.find((item) => item.id === row.id);
      if (settled === undefined) {
        return { ...row };
      }
      return { ...row, cultivation: settled.cultivation, cultivation_remainder: settled.cultivationRemainder };
    });
    this.buildings = base.buildings.map((row) => ({ ...row }));
    this.pillInventories = base.pillInventories.map((row) => ({ ...row }));
    this.challengeDay = base.challengeDay;
    this.debateDay = base.debateDay;

    const dateKey = dateKeyUtc8(now);
    this.recruitUsedToday = base.sect.recruit_date_key === dateKey ? Number(base.sect.recruit_count) : 0;

    // 0014：到期归队先于写回生成 —— 归队语句一次写完修为/余数/伤势，
    // settlementStatements 跳过这些弟子，避免同一列被两条 UPDATE 互相覆盖。
    this.applyJourneyReturns();
    this.statements = [...this.settlementStatements(lastSettledAt), ...this.journeyReturnStatements];
  }

  /** 结算写回：只写发生变化的行，避免无意义的 UPDATE。 */
  private settlementStatements(previousLastSettledAt: number): ParameterizedQuery[] {
    const statements: ParameterizedQuery[] = [];
    if (this.sect.last_settled_at !== previousLastSettledAt) {
      statements.push(updateSectSettledStatement(this.sect.id, this.sect.last_settled_at));
    }
    for (const [index, row] of this.balances.entries()) {
      const before = this.base.balances[index];
      if (before !== undefined && (before.balance !== row.balance || before.remainder !== row.remainder)) {
        statements.push(
          updateResourceSettledStatement(row, Number(row.balance), Number(row.remainder), this.now),
        );
      }
    }
    for (const [index, row] of this.disciples.entries()) {
      // 0014：本批已归队的弟子由归队语句一次写完（修为 + 余数 + 伤势），这里不重复写同一列。
      if (this.journeyReturnedDiscipleIds.has(row.id)) {
        continue;
      }
      const before = this.base.disciples[index];
      if (
        before !== undefined &&
        (before.cultivation !== row.cultivation || before.cultivation_remainder !== row.cultivation_remainder)
      ) {
        statements.push(
          updateDiscipleCultivationStatement(row.id, Number(row.cultivation), Number(row.cultivation_remainder)),
        );
      }
    }
    // 事件落库：与结算写回、命令写入共用同一次 batch（不单独 await 一次 db.batch/execute）。
    for (const event of this.settleResult.events) {
      statements.push(
        insertEventLogStatement({
          id: event.id,
          sectId: this.sect.id,
          eventId: event.eventId,
          description: event.description,
          effects: JSON.stringify(event.effects),
          now: this.now,
        }),
      );
    }
    return statements;
  }

  balanceOf(resourceId: string): number {
    const row = this.balances.find((item) => item.resource_id === resourceId);
    return row === undefined ? 0 : Number(row.balance);
  }

  resourceName(resourceId: string): string {
    return this.config.resources.find((item) => item.id === resourceId)?.name ?? resourceId;
  }

  /**
   * 坊市：某资源的容量上限（最小单位），与结算 / 视图同一口径（配置容量 × 等级倍率）。
   * 配置里没有的资源返回 0（正常路径不可达：余额行都来自配置里的资源）。
   */
  resourceCapacityOf(resourceId: string): number {
    const definition = this.config.resources.find((item) => item.id === resourceId);
    return definition === undefined ? 0 : effectiveCapacity(definition.capacity, this.capacityMultiplier);
  }

  /** 资源检查（只读，不扣减）：不足时抛 INSUFFICIENT_RESOURCE（文案与载荷与旧实现一致）。 */
  requireResourceAvailable(resourceId: string, amount: number): void {
    const balance = this.balanceOf(resourceId);
    if (balance < amount) {
      throw new AppError('INSUFFICIENT_RESOURCE', `${this.resourceName(resourceId)}不足`, {
        resourceId,
        required: String(amount),
        balance: String(balance),
        lacking: String(amount - balance),
      });
    }
  }

  /** 资源检查 + 扣减（负 delta），不足时抛 INSUFFICIENT_RESOURCE（带缺少数量）。 */
  requireResource(resourceId: string, amount: number): void {
    this.requireResourceAvailable(resourceId, amount);
    this.balances = this.balances.map((row) =>
      row.resource_id === resourceId
        ? { ...row, balance: Number(row.balance) - amount, updated_at: this.now }
        : row,
    );
    this.addStatement(resourceDeltaStatement(this.sect.id, resourceId, -amount, this.now));
  }

  addStatement(statement: ParameterizedQuery): void {
    this.statements.push(statement);
  }

  addDisciple(row: DiscipleRow): void {
    this.disciples.push(row);
    this.addStatement(insertDiscipleStatement({
      id: row.id,
      sectId: row.sect_id,
      name: row.name,
      gender: row.gender,
      aptitude: Number(row.aptitude),
      attack: Number(row.attack),
      defense: Number(row.defense),
      speed: Number(row.speed),
      luck: Number(row.luck),
      physique: Number(row.physique),
      talent: row.talent,
      realmId: row.realm_id,
      stage: Number(row.stage),
      assignment: row.assignment,
      bodyTemperingCount: Number(row.body_tempering_count),
      now: this.now,
    }));
  }

  discipleById(discipleId: string): DiscipleRow {
    const disciple = this.disciples.find((item) => item.id === discipleId);
    if (disciple === undefined) {
      throw new AppError('NOT_FOUND', '弟子不存在');
    }
    return disciple;
  }

  buildingByDefId(defId: string): BuildingRow {
    const building = this.buildings.find((item) => item.def_id === defId);
    if (building === undefined) {
      throw new AppError('NOT_FOUND', '建筑不存在');
    }
    return building;
  }

  /** 当前宗门某丹药的库存（非负整数；没有库存行视为 0）。 */
  pillQuantity(pillId: string): number {
    const row = this.pillInventories.find((item) => item.pill_id === pillId);
    return row === undefined ? 0 : Number(row.quantity);
  }

  /**
   * 坊市售丹的守卫快照：**读快照时**的库存数量（守卫比较的是写库前的库状态，
   * 不是内存里已经改过的值 —— 与 commitGambling 的 pill 快照同一口径）。
   */
  basePillQuantity(pillId: string): number {
    const row = this.base.pillInventories.find((item) => item.pill_id === pillId);
    return row === undefined ? 0 : Number(row.quantity);
  }

  /** 服用前置检查 + 扣库存 1（内存与写库语句一起追加；库存不足抛 INVALID_STATUS）。 */
  requirePill(pillId: string): void {
    this.removePill(pillId, 1);
  }

  /**
   * 坊市：扣减丹药库存 quantity（内存与写库语句一起追加；不足抛 INVALID_STATUS）。
   * 服用丹药的 requirePill 也走这里 —— 两者是同一件事，只是数量不同。
   * 没有库存行视为 0（同一 (sect, pill) 正常只有一行或零行）。
   */
  removePill(pillId: string, quantity: number): void {
    // 共享原语的兜底：只接受正整数（调用方由 schema / requirePill 保证，但 0 会让
    // 下面生成 `WHERE id = ...` 的空转语句，宁可在入口就拒绝）。
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new AppError('INVALID_STATUS', '丹药数量不合法');
    }
    const row = this.pillInventories.find((item) => item.pill_id === pillId);
    const owned = row === undefined ? 0 : Number(row.quantity);
    if (owned < quantity) {
      throw new AppError('INVALID_STATUS', '丹药库存不足');
    }
    const updated: PillInventoryRow = { ...row!, quantity: owned - quantity, updated_at: this.now };
    this.pillInventories = this.pillInventories.map((item) =>
      item.id === updated.id ? updated : item,
    );
    this.addStatement(updatePillInventoryQuantityStatement(updated, updated.quantity, this.now));
  }

  /** 炼制入库 +quantity（首次用 upsert 创建库存行；同一 (sect, pill) 永远只有一行）。 */
  addPill(pillId: string, quantity: number): void {
    const existing = this.pillInventories.find((item) => item.pill_id === pillId);
    let row: PillInventoryRow;
    if (existing === undefined) {
      row = {
        id: crypto.randomUUID(),
        sect_id: this.sect.id,
        pill_id: pillId,
        quantity,
        updated_at: this.now,
      };
      this.pillInventories = [...this.pillInventories, row];
    } else {
      row = { ...existing, quantity: Number(existing.quantity) + quantity, updated_at: this.now };
      this.pillInventories = this.pillInventories.map((item) =>
        item.id === row.id ? row : item,
      );
    }
    this.addStatement(upsertPillInventoryStatement(this.sect.id, pillId, row.quantity, this.now));
  }

  view(): SectStateView {
    // 容量/上限按「当前（可能刚升级的）等级」现算：upgradeSect 之后的同一请求里返回的
    // state 就已经是新倍率/新上限，不需要等下一次 sync。
    const levelDef = findSectLevel(Number(this.sect.level));
    return buildSectStateView({
      config: this.config,
      sect: this.sect,
      disciples: this.disciples,
      buildings: this.buildings,
      balances: this.balances,
      pillInventories: this.pillInventories,
      challengeDay: this.challengeDay,
      debateDay: this.debateDay,
      debateStats: this.base.debateStats,
      settleResult: this.settleResult,
      now: this.now,
      recentEventRows: this.base.recentEvents,
      capacityMultiplier: levelDef.capacityMultiplier,
      journeys: this.journeys,
      recentJourneys: this.recentRowsForView(),
      activeExploration: this.activeExplorationView(),
    });
  }

  async commit(options: {
    checkRecruitState?: boolean;
    staleRecruitBatchOnConflict?: boolean;
    /**
     * 坊市售丹：本次写入涉及的那条丹药库存（绝对值写回）。
     * 传了就进守卫 —— 这条库存必须仍是读快照时的数量，否则整批回滚。
     */
    pillId?: string;
  } = {}): Promise<void> {
    if (this.statements.length === 0) {
      return;
    }
    const commandId = crypto.randomUUID();
    const guard = settlementSnapshotGuardStatements(commandId, {
      sect: this.base.sect,
      balances: this.base.balances,
      disciples: this.base.disciples,
    }, {
      checkRecruitState: options.checkRecruitState,
      ...(options.pillId === undefined
        ? {}
        : { pill: { pillId: options.pillId, quantity: this.basePillQuantity(options.pillId) } }),
    });
    try {
      await this.db.batch(prepareStatements(this.db, [
        ...guard.guards,
        ...this.statements,
        ...guard.cleanup,
      ]));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/CHECK constraint failed: (?:valid = 1|mutation_guards)/i.test(message)) {
        if (options.staleRecruitBatchOnConflict) {
          throw new AppError('EXPIRED', '招贤名册已更新，请重新预览后再选择有缘人', {
            reason: 'stale_batch',
          });
        }
        throw new AppError('INVALID_STATUS', '宗门状态已变化，请刷新后重试');
      }
      throw error;
    }
  }

  async commitAlchemy(pillId: string, discipleId?: string): Promise<void> {
    const commandId = crypto.randomUUID();
    const disciple = discipleId === undefined
      ? undefined
      : this.base.disciples.find((row) => row.id === discipleId);
    const guard = alchemySnapshotGuardStatement(commandId, {
      sect: this.base.sect,
      balances: this.base.balances,
      buildings: this.base.buildings,
      pillId,
      pillQuantity: this.base.pillInventories.find((row) => row.pill_id === pillId)?.quantity ?? 0,
      ...(disciple === undefined ? {} : { disciple }),
    });
    try {
      await this.db.batch(prepareStatements(this.db, [
        guard,
        ...this.statements,
        deleteAlchemySnapshotGuardStatement(commandId),
      ]));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/CHECK constraint failed: (?:valid = 1|mutation_guards)/i.test(message)) {
        throw new AppError('INVALID_STATUS', '宗门状态已变化，请刷新后重试');
      }
      throw error;
    }
  }

  /**
   * 弟子命令的受保护提交（0013：备注 / 驱逐 / 守擂布阵共用）：
   * 首条 mutation_guards 快照语句重新核对宗门行、资源余额、members 每名弟子仍属本宗，
   * 以及（驱逐时）守擂阵容仍与读到的快照一致；任一并发改动让整批回滚并映射为业务错误。
   */
  async commitDisciple(
    members: readonly { id: string }[],
    defenseLineup?: string | null,
    options?: {
      /**
       * 0014：是否允许成员此刻仍在「尚未到期的历练」中。
       * 只有保存私有备注是 true（计划 2.3 明确允许在外保存备注），其余一律 false。
       */
      allowActiveJourney?: boolean;
    },
  ): Promise<void> {
    const commandId = crypto.randomUUID();
    const guard = discipleSnapshotGuardStatement(commandId, {
      sect: this.base.sect,
      balances: this.base.balances,
      members,
      now: this.now,
      rejectAwayMembers: options?.allowActiveJourney !== true,
      ...(defenseLineup === undefined ? {} : { defenseLineup }),
    });
    try {
      await this.db.batch(prepareStatements(this.db, [
        guard,
        ...this.statements,
        deleteDiscipleSnapshotGuardStatement(commandId),
      ]));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/CHECK constraint failed: (?:valid = 1|mutation_guards)/i.test(message)) {
        throw new AppError('INVALID_STATUS', '宗门状态已变化，请刷新后重试');
      }
      throw error;
    }
  }

  /**
   * 挑战 batch（0012）：守卫 + 结算 + 计数/奖励/日志 + 清理守卫一次提交。
   *
   * 并发保护（计划 5.7）：
   * - 首条 mutation_guards 快照语句在 batch 执行时重新校验攻方宗门行（等级/声望/
   *   结算时间/挑战日期键/计数）、资源余额、攻方出战弟子归属与守方等级/阵容；
   *   任何一个并发改动都会让 CHECK 失败并回滚整批，所以「成功场次 <= 3」和
   *   「奖励与日志同生共死」由数据库保证。
   * - challenge_log 的唯一部分索引（attacker, defender, challenge_date_key）兜底同日
   *   同目标的并发挑战，冲突映射成 DAILY_LIMIT 业务错误，不向前端暴露 SQL。
   */
  async commitChallenge(
    target: { id: string; level: number; defenseLineup: string | null },
    members: readonly { id: string }[],
    defenderIds: readonly string[],
  ): Promise<void> {
    const commandId = crypto.randomUUID();
    const guard = challengeSnapshotGuardStatement(commandId, {
      sect: this.base.sect,
      balances: this.base.balances,
      members,
      target,
      defenderIds,
      now: this.now,
    });
    try {
      await this.db.batch(prepareStatements(this.db, [
        guard,
        ...this.statements,
        deleteChallengeSnapshotGuardStatement(commandId),
      ]));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/CHECK constraint failed: (?:valid = 1|mutation_guards)/i.test(message)) {
        throw new AppError('INVALID_STATUS', '宗门状态已变化，请刷新后重试');
      }
      if (/UNIQUE constraint failed: challenge_log/i.test(message)) {
        throw new AppError('DAILY_LIMIT', '今日已挑战过该宗门（同一目标每日 1 次）');
      }
      throw error;
    }
  }

  /**
   * 赌坊 batch（0019）：守卫 + 结算 + 计数 / 记录 / 发奖 / 扣赌注 + 清理守卫一次提交。
   *
   * 并发保护（计划 14.4）：首条 mutation_guards 快照语句在 batch 执行时重新校验宗门行
   * （等级 / 结算时间 / 论道日期键 / 论道计数 / wheel_seed 视命令而定）、全部资源余额、
   * （中奖丹药时的）该丹药库存，以及（涉事弟子时）该弟子行、被押属性与悟道值两列；
   * 任一并发改动都会让 CHECK 失败并回滚整批 —— 所以
   * 「成功次数 <= 20」（论道与天机轮共享）「记录、奖励、扣减同生共死」都由数据库保证。
   */
  async commitGambling(options: {
    /** 赌注涉及的资源 id（灵石/药材/矿石）；属性赌注与纯加点时为 null。 */
    resourceId: string | null;
    /**
     * 涉事弟子（论道必传；悟道值加点也传）。
     * 只要传了就必须进守卫：论道赢了悟道值会写回弟子行，若不核对这一行，
     * 并发加点改掉的 dao_insight / dao_insight_used 会被本批按快照绝对值覆盖。
     */
    discipleId?: string;
    /** 本次写入涉及的那一列属性（属性赌注 / 被加点）；只发悟道值奖励时可省略。 */
    attribute?: BettableAttribute;
    /** 是否要求该弟子此刻没有「尚未到期的历练」（论道要求；加点不要求）。 */
    /** 是否要求该弟子此刻没有「尚未到期的历练」（论道要求；加点不要求）。 */
    rejectAway?: boolean;
    /** 0020 天机轮：中奖丹药的库存快照（守卫核对它没被并发改动；非丹药奖励时省略）。 */
    pill?: { pillId: string; quantity: number };
    /** 0020 天机轮：是否核对宗门行的 wheel_seed（转动与重置都要求格局仍是读到的那一版）。 */
    checkWheelSeed?: boolean;
  }): Promise<void> {
    const commandId = crypto.randomUUID();
    // 守卫比较的是写入前的库状态 → 用读快照时的弟子行（this.base），不是内存里改过的行。
    const baseDisciple =
      options.discipleId === undefined
        ? undefined
        : this.base.disciples.find((row) => row.id === options.discipleId);
    const disciple =
      baseDisciple === undefined
        ? undefined
        : {
            row: baseDisciple,
            ...(options.attribute === undefined ? {} : { attribute: options.attribute }),
          };
    const guard = gamblingSnapshotGuardStatement(commandId, {
      sect: this.base.sect,
      balances: this.base.balances,
      resourceId: options.resourceId,
      now: this.now,
      ...(disciple === undefined ? {} : { disciple }),
      ...(options.pill === undefined ? {} : { pill: options.pill }),
      ...(options.rejectAway === true ? { rejectAway: true } : {}),
      ...(options.checkWheelSeed === true ? { checkWheelSeed: true } : {}),
    });
    try {
      await this.db.batch(prepareStatements(this.db, [
        guard,
        ...this.statements,
        deleteGamblingSnapshotGuardStatement(commandId),
      ]));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/CHECK constraint failed: (?:valid = 1|mutation_guards)/i.test(message)) {
        throw new AppError('INVALID_STATUS', '宗门状态已变化，请刷新后重试');
      }
      throw error;
    }
  }

  /**
   * 0014：到期归队（在结算之后、写回生成之前调用）。
   *
   * - 修为按**返程时的剩余门槛**入账，`cultivation_awarded` 记录实际增加量（最高阶段为 0）；
   * - 伤势固定从到期时间起算 30 分钟，且只做一次（completed_at 非空不再进入），
   *   因此不会覆盖更晚的旧伤，也不会复活随后服用回春丹清掉的伤势；
   * - 归队语句与结算、领取同批提交；并发下 `completed_at IS NULL` 的条件让它最多生效一次。
   */
  private applyJourneyReturns(): void {
    for (const journey of this.journeys) {
      if (journey.completed_at !== null || Number(journey.ends_at) > this.now) {
        continue;
      }
      const index = this.disciples.findIndex((row) => row.id === journey.disciple_id);
      if (index === -1) {
        // 弟子行已不在本宗（正常路径不可达：未领取前不可驱逐，且守卫会兜住并发）。
        // 仍然要把记录收口：修为无处可入（记 0），但必须写 completed_at ——
        // 否则 claim 的条件更新永远不成立，玩家可以无限重复领取同一份资源。
        journey.completed_at = this.now;
        journey.cultivation_awarded = 0;
        this.journeyReturnStatements.push(
          completeDiscipleJourneyStatement(journey.id, journey.disciple_id, this.now, 0),
        );
        continue;
      }
      const disciple = this.disciples[index]!;
      const snapshotRow = this.base.disciples.find((row) => row.id === disciple.id);
      const result = cultivateJourneyReturn({
        // 在外期间不积累修为，所以「返程时的修为」就是结算开始时的值。
        beforeReturn:
          snapshotRow === undefined ? Number(disciple.cultivation) : Number(snapshotRow.cultivation),
        settledCultivation: Number(disciple.cultivation),
        settledRemainder: Number(disciple.cultivation_remainder),
        requiredCultivation: journeyThresholdOf(disciple.realm_id, Number(disciple.stage)),
        plannedCultivation: Number(journey.reward_cultivation),
      });
      const injuredUntil =
        Number(journey.injured) === 1
          ? Math.max(
              disciple.injured_until === null ? 0 : Number(disciple.injured_until),
              journeyInjuryUntil(Number(journey.ends_at)),
            )
          : disciple.injured_until === null
            ? null
            : Number(disciple.injured_until);

      this.disciples[index] = {
        ...disciple,
        cultivation: result.cultivation,
        cultivation_remainder: result.remainder,
        injured_until: injuredUntil,
      };
      journey.completed_at = this.now;
      journey.cultivation_awarded = result.awarded;
      this.journeyReturnedDiscipleIds.add(disciple.id);
      this.journeyReturnStatements.push(
        updateDiscipleJourneyReturnStatement(journey.id, disciple.id, this.sect.id, {
          cultivation: result.cultivation,
          remainder: result.remainder,
          injuredUntil,
        }),
        completeDiscipleJourneyStatement(journey.id, disciple.id, this.now, result.awarded),
      );
    }
  }

  /** 0014：仍未到期（在外）的人数；已到期待领取不占名额。 */
  activeJourneyCount(): number {
    return this.journeys.filter(
      (row) => row.claimed_at === null && Number(row.ends_at) > this.now,
    ).length;
  }

  /** 0014：仍在外的弟子 id 集合（唯一在外判定入口，所有写路径与视图共用）。 */
  awayDiscipleIds(): Set<string> {
    return journeyAwayIds(this.journeys, this.now);
  }

  /** 0014：该弟子未领取的历练记录（每名弟子最多一条，由唯一部分索引保证）。 */
  pendingJourneyOf(discipleId: string): DiscipleJourneyRow | undefined {
    return this.journeys.find((row) => row.disciple_id === discipleId && row.claimed_at === null);
  }

  /** 0014：按 id 取本宗**未领取**的记录（跨宗 / 已领取都返回 undefined）。 */
  openJourneyById(journeyId: string): DiscipleJourneyRow | undefined {
    return this.journeys.find((row) => row.id === journeyId && row.claimed_at === null);
  }

  /** 0014：读快照时的未领取记录（守卫必须用库值，不能用本批改过的内存值）。 */
  baseJourneyById(journeyId: string): DiscipleJourneyRow | undefined {
    return this.base.journeys.find((row) => row.id === journeyId);
  }

  /** 0014：本批是否已为该弟子完成归队入账（领取守卫据此决定要不要核对弟子行）。 */
  journeyReturnedInThisBatch(discipleId: string): boolean {
    return this.journeyReturnedDiscipleIds.has(discipleId);
  }

  /** 0014：出发写入（同一弟子重复出发由唯一部分索引兜底）。 */
  addJourney(row: DiscipleJourneyRow): void {
    this.journeys = [...this.journeys, row];
    this.recentJourneys = [row, ...this.recentJourneys];
    this.addStatement(
      insertDiscipleJourneyStatement({
        id: row.id,
        sectId: row.sect_id,
        discipleId: row.disciple_id,
        discipleName: row.disciple_name,
        direction: row.direction,
        durationSeconds: Number(row.duration_seconds),
        originalAssignment: row.original_assignment,
        startedAt: Number(row.started_at),
        endsAt: Number(row.ends_at),
        rewardCultivation: Number(row.reward_cultivation),
        rewardResources: row.reward_resources,
        extraHarvest: Number(row.extra_harvest) === 1,
        injured: Number(row.injured) === 1,
        injuryChanceBp: Number(row.injury_chance_bp),
        now: this.now,
      }),
    );
  }

  /**
   * 0014：领取入账（直接加余额、**不夹容量**，与秘境 / 挑战奖励同一口径；
   * 余额可能因此超过容量，下一次结算的 room 截断会处理）。
   */
  grantResource(resourceId: string, amount: number): void {
    if (amount === 0) {
      return;
    }
    const existing = this.balances.find((row) => row.resource_id === resourceId);
    if (existing === undefined) {
      const row: ResourceBalanceRow = {
        id: crypto.randomUUID(),
        sect_id: this.sect.id,
        resource_id: resourceId,
        balance: amount,
        remainder: 0,
        updated_at: this.now,
      };
      this.balances = [...this.balances, row];
      this.addStatement(
        insertResourceBalanceStatement({
          id: row.id,
          sectId: this.sect.id,
          resourceId,
          balance: amount,
          remainder: 0,
          now: this.now,
        }),
      );
      return;
    }
    this.addStatement(resourceDeltaStatement(this.sect.id, resourceId, amount, this.now));
    this.balances = this.balances.map((row) =>
      row.resource_id === resourceId
        ? { ...row, balance: Number(row.balance) + amount, updated_at: this.now }
        : row,
    );
  }

  /** 0014：领取标记（条件更新 + 内存同步）。 */
  markJourneyClaimed(journey: DiscipleJourneyRow): void {
    journey.claimed_at = this.now;
    this.addStatement(claimDiscipleJourneyStatement(journey.id, this.sect.id, this.now));
  }

  /** 0014：最近记录（与未领取记录合并去重，未领取的一方优先；新的在前，最多 10 条）。 */
  private recentRowsForView(): DiscipleJourneyRow[] {
    const byId = new Map<string, DiscipleJourneyRow>();
    for (const row of this.recentJourneys) {
      byId.set(row.id, row);
    }
    for (const row of this.journeys) {
      byId.set(row.id, row);
    }
    return [...byId.values()]
      .sort(
        (a, b) =>
          Number(b.started_at) - Number(a.started_at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
      )
      .slice(0, JOURNEY_HISTORY_LIMIT);
  }

  /**
   * 0014：出发的受保护提交。守卫在 batch 执行时复核宗门行（含守擂阵容原值）、资源余额、
   * 在外人数与不在外人数（堵住不同弟子并发出发绕过两人上限）、目标弟子的境界 / 伤势 /
   * 岗位 / 归属，以及「该弟子没有未领取记录」。
   */
  async commitJourneyStart(
    discipleId: string,
    activeCount: number,
    atHomeCount: number,
  ): Promise<void> {
    const commandId = crypto.randomUUID();
    const disciple = this.base.disciples.find((row) => row.id === discipleId);
    if (disciple === undefined) {
      throw new AppError('NOT_FOUND', '弟子不存在');
    }
    const guard = journeyStartSnapshotGuardStatement(commandId, {
      sect: this.base.sect,
      balances: this.base.balances,
      disciple,
      activeCount,
      atHomeCount,
      now: this.now,
    });
    try {
      await this.db.batch(
        prepareStatements(this.db, [
          guard,
          ...this.statements,
          deleteJourneyStartSnapshotGuardStatement(commandId),
        ]),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/CHECK constraint failed: (?:valid = 1|mutation_guards)/i.test(message)) {
        throw new AppError('INVALID_STATUS', '宗门状态已变化，请刷新后重试');
      }
      if (/UNIQUE constraint failed/i.test(message) && /disciple_journeys/i.test(message)) {
        throw new AppError('INVALID_STATUS', '该弟子已有未领取的历练记录');
      }
      throw error;
    }
  }

  /**
   * 0014：领取的受保护提交。领取是唯一真正发放资源的命令：
   * 守卫在 batch 执行时复核记录仍未领取、完成状态与奖赏快照未变，以及（本批同时归队时）
   * 弟子行未被并发改动；任一冲突整批回滚并映射为业务错误，绝不重复发奖。
   */
  async commitJourneyClaim(journeyId: string, returnDiscipleId: string | null): Promise<void> {
    const commandId = crypto.randomUUID();
    const journey = this.base.journeys.find((row) => row.id === journeyId);
    if (journey === undefined) {
      throw new AppError('NOT_FOUND', '历练记录不存在');
    }
    const disciple =
      returnDiscipleId === null
        ? undefined
        : this.base.disciples.find((row) => row.id === returnDiscipleId);
    const guard = journeyClaimSnapshotGuardStatement(commandId, {
      sect: this.base.sect,
      balances: this.base.balances,
      journey,
      ...(disciple === undefined ? {} : { disciple }),
    });
    try {
      await this.db.batch(
        prepareStatements(this.db, [
          guard,
          ...this.statements,
          deleteJourneyClaimSnapshotGuardStatement(commandId),
        ]),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/CHECK constraint failed: (?:valid = 1|mutation_guards)/i.test(message)) {
        // 区分「并发已领取」与普通快照冲突，给出诚实的文案（不改动任何数据）。
        const current = await new DiscipleJourneyRepository(this.db).findByIdForSect(
          journeyId,
          this.sect.id,
        );
        if (current !== null && current.claimed_at !== null) {
          throw new AppError('INVALID_STATUS', '该历练收获已领取');
        }
        throw new AppError('INVALID_STATUS', '宗门状态已变化，请刷新后重试');
      }
      throw error;
    }
  }

  /**
   * 0015：交互探索的受保护提交（开始 / 推进 / 放弃共用）。
   *
   * 守卫在 batch 执行时复核宗门行（等级 + 结算时间）与全部资源余额，避免与并发命令双重结算；
   * 推进 / 放弃时还复核这条探索记录的 status / current_stage / current_encounter /
   * rewards_collected 都未被并发改动 —— 同一关不会被结算两次，也不会重复发奖。
   * members 传入时还复核这些弟子仍属于本宗（开始探索时传队伍成员）。
   */
  async commitRealmExplore(
    exploration?: RealmExplorationRow,
    members?: readonly { id: string }[],
  ): Promise<void> {
    const commandId = crypto.randomUUID();
    const guard = realmExploreSnapshotGuardStatement(commandId, {
      sect: this.base.sect,
      balances: this.base.balances,
      ...(exploration === undefined ? {} : { exploration }),
      ...(members === undefined ? {} : { members }),
    });
    try {
      await this.db.batch(
        prepareStatements(this.db, [
          guard,
          ...this.statements,
          deleteRealmExploreSnapshotGuardStatement(commandId),
        ]),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/CHECK constraint failed: (?:valid = 1|mutation_guards)/i.test(message)) {
        throw new AppError('INVALID_STATUS', '宗门状态已变化，请刷新后重试');
      }
      // 迁移 0015 的部分唯一索引兜底「同一宗门同时只能有一场进行中的探索」。
      if (/UNIQUE constraint failed/i.test(message) && /realm_explorations/i.test(message)) {
        throw new AppError('INVALID_STATUS', '已有一场进行中的秘境探索');
      }
      throw error;
    }
  }

  /** 进行中探索的视图（null = 当前没有）；view() 与 getActiveExploration 共用同一份装配。 */
  activeExplorationView(): ActiveExplorationView | null {
    return this.activeExploration === null ? null : activeExplorationViewOf(this.activeExploration);
  }
}

async function draftFor(db: D1Database, userId: string, now: number): Promise<SectDraft> {
  const snapshot = await loadSnapshot(db, userId, now);
  if (snapshot === null) {
    throw new AppError('NOT_FOUND', '尚未创建宗门');
  }
  return new SectDraft(db, snapshot, now);
}

/** 读宗门状态：没有宗门返回 null（前端据此显示创建宗门）。 */
export async function getSectState(
  db: D1Database,
  userId: string,
  now: number,
): Promise<SectStateView | null> {
  // 与写请求交错时重新读取快照，不能让旧 sync 的绝对结算值覆盖新余额。
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const snapshot = await loadSnapshot(db, userId, now);
    if (snapshot === null) return null;
    const draft = new SectDraft(db, snapshot, now);
    try {
      await draft.commit();
      return draft.view();
    } catch (error) {
      if (!(error instanceof AppError && error.code === 'INVALID_STATUS') || attempt === 2) {
        throw error;
      }
    }
  }
  throw new AppError('INVALID_STATUS', '宗门状态已变化，请刷新后重试');
}

/** 创建宗门：初始弟子 / 建筑 / 资源按配置一次写入；宗门名全局唯一（0021）。 */
export async function createSect(
  db: D1Database,
  userId: string,
  name: string,
  now: number,
): Promise<SectStateView> {
  const config = gameConfig();
  const existing = await new SectRepository(db).findByUserId(userId);
  if (existing !== null) {
    throw new AppError('STATE_CONFLICT', '你已经创建过宗门');
  }

  // 0021：宗门名规则统一走 normalizeEntityName（与改名同一套口径：trim / 单行 / 2-12 个码点）。
  // 否则 7 个星平面字符的名字会「改名能过、建宗过不了」——zod 的 .length 数的是 UTF-16 单元。
  const normalizedName = normalizeEntityName(
    name,
    '宗门名',
    SECT_NAME_MIN_CHARS,
    SECT_NAME_MAX_CHARS,
  );

  // 0021：宗门名全局唯一——先查一次给友好文案，并发抢名交给 sects_name_uniq 唯一索引兜底。
  await requireSectNameAvailable(db, normalizedName);

  const sectId = crypto.randomUUID();
  const statements: ParameterizedQuery[] = [
    insertSectStatement({
      id: sectId,
      userId,
      name: normalizedName,
      level: config.sect.initialLevel,
      veinLevel: config.sect.initialVeinLevel,
      now,
    }),
  ];

  const disciples: DiscipleRow[] = config.sect.initialDisciples.map((template) => {
    // 0016：初始弟子与招贤候选人共用同一套属性生成规则（含幸运/体魄），
    // 只是随机源用 Math.random —— 初始弟子只生成一次，不需要可复现。
    const attributes = generateAttributes(Math.random);
    const row: DiscipleRow = {
      id: crypto.randomUUID(),
      sect_id: sectId,
      name: randomDiscipleName(),
      gender: randomGender(),
      ...attributes,
      talent: generateTalent(Math.random),
      realm_id: template.realm,
      stage: template.stage,
      cultivation: 0,
      cultivation_remainder: 0,
      assignment: template.assignment,
      injured_until: null,
      body_tempering_count: 0,
      note: '',
      // 0019：初始弟子悟道值为 0（只能通过赌坊获得）。
      dao_insight: 0,
      dao_insight_used: 0,
      avatar_frame_id: 'classic',
      created_at: now,
    };
    statements.push(
      insertDiscipleStatement({
        id: row.id,
        sectId,
        name: row.name,
        gender: row.gender,
        aptitude: row.aptitude,
        attack: row.attack,
        defense: row.defense,
        speed: row.speed,
        luck: row.luck,
        physique: row.physique,
        talent: row.talent,
        realmId: row.realm_id,
        stage: row.stage,
        assignment: row.assignment,
        bodyTemperingCount: 0,
        now,
      }),
    );
    return row;
  });

  const buildings: BuildingRow[] = config.sect.initialBuildings.map((template) => {
    const row: BuildingRow = {
      id: crypto.randomUUID(),
      sect_id: sectId,
      def_id: template.defId,
      level: template.level,
      created_at: now,
    };
    statements.push(
      insertBuildingStatement({ id: row.id, sectId, defId: row.def_id, level: row.level, now }),
    );
    return row;
  });

  const balances: ResourceBalanceRow[] = config.resources.map((resource) => {
    const row: ResourceBalanceRow = {
      id: crypto.randomUUID(),
      sect_id: sectId,
      resource_id: resource.id,
      balance: Number(resource.startAmount),
      remainder: 0,
      updated_at: now,
    };
    statements.push(
      insertResourceBalanceStatement({
        id: row.id,
        sectId,
        resourceId: row.resource_id,
        balance: row.balance,
        remainder: 0,
        now,
      }),
    );
    return row;
  });

  try {
    await db.batch(prepareStatements(db, statements));
  } catch (error) {
    // 并发抢名：唯一索引拦下后到的那个提交（预检在它之前已经放行过）。
    if (classifyDbError(error) === 'unique') {
      throw sectNameTakenError(normalizedName);
    }
    throw error;
  }

  const draft = new SectDraft(
    db,
    {
      sect: {
        id: sectId,
        user_id: userId,
        name: normalizedName,
        level: config.sect.initialLevel,
        vein_level: config.sect.initialVeinLevel,
        reputation: 0,
        last_settled_at: now,
        recruit_date_key: dateKeyUtc8(now),
        recruit_count: 0,
        recruit_refresh_level: config.sect.initialLevel,
        recruit_refresh_used: 0,
        defense_lineup: null,
        challenge_date_key: '',
        challenge_count: 0,
        debate_date_key: '',
        debate_count: 0,
        // 0020 天机轮：格局种子从 0 开始（迁移的列默认值也是 0，内存口径与库一致）。
        wheel_seed: 0,
        created_at: now,
      },
      disciples,
      buildings,
      balances,
      pillInventories: [],
      challengeDay: challengeDayStateOf(
        { challenge_date_key: '', challenge_count: 0 },
        now,
      ),
      // 0019：新宗门的论道计数从零开始（与挑战同口径：空日期键 + 0 次）。
      debateDay: debateDayStateOf({ debate_date_key: '', debate_count: 0 }, now),
      debateStats: { total: 0, wins: 0, losses: 0, netSpiritStone: 0, totalInsight: 0 },
      recentEvents: [],
      // 0014：新宗门还没有任何历练记录。
      journeys: [],
      recentJourneys: [],
      activeExploration: null,
    },
    now,
  );
  return draft.view();
}

/** 招募候选人预览（GET /game/recruit-preview 的 data）。 */
export interface RecruitPreview {
  candidates: RecruitCandidate[];
  /**
   * 0016 批次标识：这批候选人来自哪一次生成机会（生成规则版本 + 宗门 id + 日期键 +
   * 今日招募次数 + 刷新序号）。招募请求必须原样回传，服务端核对当前批次后才允许写入。
   */
  batch: string;
  canRecruit: boolean;
  blockedReason: string | null;
  cost: Record<string, string>;
  /** V5.2：本境界已用的招贤刷新次数（升级重置，按归一化后的值）。 */
  refreshUsed: number;
  /** V5.2：本境界的招贤刷新额度（RECRUIT_REFRESH_PER_LEVEL）。 */
  refreshLimit: number;
  /** V5.2：还剩几次刷新（= limit - used，不小于 0）。 */
  refreshRemaining: number;
}

/**
 * 招募判定文案（预览与招募共用）：null = 可以招募。
 * 0021 起「每日 3 次」上限已去掉：宗门等级决定的弟子上限是唯一门槛
 * （config.recruitment.dailyLimit 保留在配置里但不再参与判定，只作为历史字段）。
 */
function recruitBlockedReason(input: {
  config: GameConfigContent;
  discipleCount: number;
  discipleCapacity: number;
  balanceOf: (resourceId: string) => number;
}): string | null {
  const { config, discipleCount, discipleCapacity, balanceOf } = input;
  if (discipleCount >= discipleCapacity) {
    return '弟子上限已满';
  }
  const lacking = Object.entries(config.recruitment.cost).find(
    ([resourceId, amount]) => balanceOf(resourceId) < Number(amount),
  );
  if (lacking !== undefined) {
    const resourceName =
      config.resources.find((resource) => resource.id === lacking[0])?.name ?? lacking[0];
    return `${resourceName}不足`;
  }
  return null;
}

/**
 * 招贤刷新额度的唯一归一化入口（读取 / 预览 / 刷新 / 招募共用）：
 * 宗门等级与「上次授予等级」不一致时视为已用 0 次（升级即重置，未用次数不累积）。
 * 返回写入用的 level（当前等级）与 used，以及展示用的 limit / remaining。
 * 归一化只发生在内存里，读取路径不会因此落库。
 */
function recruitRefreshQuota(
  sect: Pick<SectRow, 'level' | 'recruit_refresh_level' | 'recruit_refresh_used'>,
): { level: number; used: number; limit: number; remaining: number } {
  const level = Number(sect.level);
  const used = level === Number(sect.recruit_refresh_level) ? Number(sect.recruit_refresh_used) : 0;
  return {
    level,
    used,
    limit: RECRUIT_REFRESH_PER_LEVEL,
    remaining: Math.max(0, RECRUIT_REFRESH_PER_LEVEL - used),
  };
}

/**
 * 招募预览（V4 5.4）：**只读快照，不做结算**——与排行榜同理，预览不该有副作用
 * （否则长离线后打开一次弹窗就触发了结算与随机事件）。
 *
 * 候选人与 recruitDisciple 用完全相同的 seed 参数生成（宗门 id + UTC+8 自然日 +
 * 「今日已招募次数」+ 归一化后的「本境界已用刷新次数」），因此「预览 → 招募」拿到的是同一批人；
 * 招募成功后「今日已招募次数」+1、刷新后刷新序号 +1，下一次打开预览就是新的一批。
 *
 * 刷新额度只按归一化后的值计算返回，**不写库**（读取路径不能有副作用）。
 */
export async function previewRecruit(
  db: D1Database,
  userId: string,
  now: number,
): Promise<RecruitPreview> {
  const config = gameConfig();
  const sect = await new SectRepository(db).findByUserId(userId);
  if (sect === null) {
    throw new AppError('NOT_FOUND', '尚未创建宗门');
  }
  const [disciples, balances] = await Promise.all([
    new DiscipleRepository(db).findBySectId(sect.id),
    new ResourceBalanceRepository(db).findBySectId(sect.id),
  ]);

  const dateKey = dateKeyUtc8(now);
  // 与 SectDraft 的 recruitUsedToday 同一归一逻辑：日期 key 不匹配时视为 0（跨天重置）。
  const recruitUsedToday = sect.recruit_date_key === dateKey ? Number(sect.recruit_count) : 0;
  const discipleCapacity = findSectLevel(Number(sect.level)).discipleCapacity;
  const quota = recruitRefreshQuota(sect);

  const blockedReason = recruitBlockedReason({
    config,
    discipleCount: disciples.length,
    discipleCapacity,
    balanceOf: (resourceId) =>
      Number(balances.find((row) => row.resource_id === resourceId)?.balance ?? 0),
  });

  return {
    candidates: generateCandidates(sect.id, dateKey, recruitUsedToday, quota.used),
    batch: recruitBatchId({
      sectId: sect.id,
      dateKey,
      recruitCount: recruitUsedToday,
      refreshSeq: quota.used,
    }),
    canRecruit: blockedReason === null,
    blockedReason,
    cost: { ...config.recruitment.cost },
    refreshUsed: quota.used,
    refreshLimit: quota.limit,
    refreshRemaining: quota.remaining,
  };
}

/**
 * 招募三选一（V4 5.4）：结算 → 检查次数/上限/资源 → 取确定性候选人 `choice` →
 * 扣灵石 + 新建弟子 + 更新计数（**只有一次** `commit()`，单次 D1 batch）。
 */
export async function recruitDisciple(
  db: D1Database,
  userId: string,
  choice: number,
  batch: string | undefined,
  now: number,
): Promise<{
  state: SectStateView;
  outcome: {
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
  };
}> {
  const draft = await draftFor(db, userId, now);
  const { config } = draft;

  // 0016 批次核对：必须在任何扣减之前完成。预览过期（跨天 / 换过一批 / 已经招过一次 /
  // 生成规则版本变了 / 旧客户端根本没带标识）一律拒绝，且不扣资源、不扣招募次数。
  const dateKey = dateKeyUtc8(now);
  const refreshSeq = recruitRefreshQuota(draft.sect).used;
  const batchStatus = recruitBatchStatus(batch, {
    sectId: draft.sect.id,
    dateKey,
    recruitCount: draft.recruitUsedToday,
    refreshSeq,
  });
  if (batchStatus === 'missing') {
    // 旧客户端不带批次标识：明确拒绝并让它刷新页面重新预览，而不是猜一个候选人。
    throw new AppError('EXPIRED', '招贤名册已更新，请刷新页面后重新打开招贤台', {
      reason: 'missing_batch',
    });
  }
  if (batchStatus === 'stale') {
    throw new AppError('EXPIRED', '招贤名册已更新，请重新预览后再选择有缘人', {
      reason: 'stale_batch',
    });
  }

  if (draft.disciples.length >= draft.discipleCapacity) {
    throw new AppError('CAPACITY_FULL', '弟子已满，先升级宗门或遣散弟子（本版本暂不支持遣散）');
  }

  for (const [resourceId, amount] of Object.entries(config.recruitment.cost)) {
    draft.requireResource(resourceId, Number(amount));
  }

  // 与 previewRecruit 同 seed、同顺序生成：预览里第 N 张卡就是这里的 candidates[N]。
  // 刷新序号取归一化后的「本境界已用刷新次数」，与预览（含刷新接口返回的那一批）保持同一组参数；
  // 上面的批次核对也用同一组参数，因此这里选中的人一定就是玩家刚才看到的那张卡。
  // schema 已把 choice 限制在 0~2，这里再兜一层，越界直接报错而不是写入脏数据。
  const candidates = generateCandidates(
    draft.sect.id,
    dateKey,
    draft.recruitUsedToday,
    refreshSeq,
  );
  const candidate = candidates[choice];
  if (candidate === undefined) {
    throw new AppError('VALIDATION_ERROR', '候选人不存在', { choice });
  }

  const disciple: DiscipleRow = {
    id: crypto.randomUUID(),
    sect_id: draft.sect.id,
    name: candidate.name,
    gender: candidate.gender,
    aptitude: candidate.aptitude,
    attack: candidate.attack,
    defense: candidate.defense,
    speed: candidate.speed,
    luck: candidate.luck,
    physique: candidate.physique,
    talent: candidate.talent,
    realm_id: 'qiRefining',
    stage: 1,
    cultivation: 0,
    cultivation_remainder: 0,
    assignment: IDLE_ASSIGNMENT,
    injured_until: null,
    body_tempering_count: 0,
    note: '',
    avatar_frame_id: 'classic',
    // 0019：新招募的弟子悟道值为 0（只能通过赌坊获得；列默认值也是 0，这里显式写出）。
    dao_insight: 0,
    dao_insight_used: 0,
    created_at: now,
  };
  draft.addDisciple(disciple);
  draft.addStatement(
    updateSectRecruitCounterStatement(draft.sect.id, dateKeyUtc8(now), draft.recruitUsedToday + 1),
  );
  draft.sect.recruit_date_key = dateKeyUtc8(now);
  draft.sect.recruit_count = draft.recruitUsedToday + 1;

  await draft.commit({ checkRecruitState: true, staleRecruitBatchOnConflict: true });
  return {
    state: draft.view(),
    outcome: {
      discipleName: disciple.name,
      aptitude: Number(disciple.aptitude),
      luck: Number(disciple.luck),
      physique: Number(disciple.physique),
      attack: Number(disciple.attack),
      defense: Number(disciple.defense),
      speed: Number(disciple.speed),
      // 六项等权现算：与名册 / 详情共用服务端同一个纯函数，不落库。
      attributeScore: candidate.attributeScore,
      talent: disciple.talent,
      talentName: candidate.talentName,
    },
  };
}
 
/**
 * 招贤台刷新（V5.2）：结算 → 校验本境界刷新额度 → used+1（并把授予等级写成当前等级）
 * → 用「刷新后的 used」作刷新序号生成新一批候选人。
 *
 * 刷新免费：不扣资源、不动每日招募次数（recruit_count 与刷新计数相互独立）；
 * 额度按「升级即重置」归一化（见 recruitRefreshQuota）。只做一次 `draft.commit()`。
 * 返回的 preview 与随后 recruitDisciple 使用同一组 seed 参数（refreshSeq = 刷新后的 used），
 * 保证「预览第 N 张 = 招募时 candidates[N]」。次数用尽抛 DAILY_LIMIT。
 */
export async function refreshRecruit(
  db: D1Database,
  userId: string,
  now: number,
): Promise<{ state: SectStateView; preview: RecruitPreview }> {
  const draft = await draftFor(db, userId, now);
  const quota = recruitRefreshQuota(draft.sect);

  if (quota.used >= RECRUIT_REFRESH_PER_LEVEL) {
    throw new AppError('DAILY_LIMIT', '本境界的招贤刷新次数已用完（宗门晋升后重置）', {
      refreshLimit: RECRUIT_REFRESH_PER_LEVEL,
      refreshUsed: quota.used,
    });
  }

  const nextUsed = quota.used + 1;
  draft.addStatement(updateSectRecruitRefreshStatement(draft.sect.id, quota.level, nextUsed));
  draft.sect.recruit_refresh_level = quota.level;
  draft.sect.recruit_refresh_used = nextUsed;

  await draft.commit({ checkRecruitState: true });

  // 与 recruitDisciple 共用同一判定：刷新只换人，不改变能否招募的规则。
  const blockedReason = recruitBlockedReason({
    config: draft.config,
    discipleCount: draft.disciples.length,
    discipleCapacity: draft.discipleCapacity,
    balanceOf: (resourceId) => draft.balanceOf(resourceId),
  });

  return {
    state: draft.view(),
    preview: {
      candidates: generateCandidates(
        draft.sect.id,
        dateKeyUtc8(now),
        draft.recruitUsedToday,
        nextUsed,
      ),
      batch: recruitBatchId({
        sectId: draft.sect.id,
        dateKey: dateKeyUtc8(now),
        recruitCount: draft.recruitUsedToday,
        refreshSeq: nextUsed,
      }),
      canRecruit: blockedReason === null,
      blockedReason,
      cost: { ...draft.config.recruitment.cost },
      refreshUsed: nextUsed,
      refreshLimit: RECRUIT_REFRESH_PER_LEVEL,
      refreshRemaining: Math.max(0, RECRUIT_REFRESH_PER_LEVEL - nextUsed),
    },
  };
}

/** 派工：结算 → 校验岗位 → 更新弟子岗位。 */
export async function assignDisciple(
  db: D1Database,
  userId: string,
  discipleId: string,
  assignment: string,
  now: number,
): Promise<SectStateView> {
  const draft = await draftFor(db, userId, now);
  const validAssignments = new Set<string>([
    IDLE_ASSIGNMENT,
    ...draft.config.positions.map((position) => position.id),
  ]);
  if (!validAssignments.has(assignment)) {
    throw new AppError('VALIDATION_ERROR', '未知岗位', { assignment });
  }

  const disciple = draft.discipleById(discipleId);

  // 0014：在外弟子不能转岗（原岗位名额仍为他保留，归队后自动恢复产出）。
  requireNotAway(draft, disciple, '转岗');

  // V5.1 改动三：采灵岗位有人数上限（宗门 6 级前 1 人、6 级起 2 人）。
  // item.id !== discipleId：弟子本来就在采灵岗位时，重复派工不该算占位。
  if (assignment === STONE_MINING_ASSIGNMENT) {
    const limit =
      Number(draft.sect.level) >= STONE_MINING_UNLOCK_SECT_LEVEL
        ? STONE_MINING_LIMIT_HIGH
        : STONE_MINING_LIMIT_LOW;
    const currentCount = draft.disciples.filter(
      (item) => item.assignment === STONE_MINING_ASSIGNMENT && item.id !== discipleId,
    ).length;
    if (currentCount >= limit) {
      throw new AppError('CAPACITY_FULL', `采灵岗位已满（上限 ${limit} 人）`);
    }
  }

  const nextAssignment = assignment;
  draft.addStatement(updateDiscipleAssignmentStatement(disciple.id, nextAssignment));
  disciple.assignment = nextAssignment;

  // 驱逐可能在读快照后先提交；不能对已离宗弟子返回一次成功派工。
  await draft.commitDisciple([{ id: disciple.id }]);
  return draft.view();
}

/** 升级建筑：结算 → 检查等级上限与资源 → 扣资源 + 等级 +1。 */
export async function upgradeBuilding(
  db: D1Database,
  userId: string,
  defId: string,
  now: number,
): Promise<SectStateView> {
  const draft = await draftFor(db, userId, now);
  const building = draft.buildingByDefId(defId);
  const definition = draft.config.buildings.find((item) => item.id === defId);
  if (definition === undefined) {
    throw new AppError('NOT_FOUND', '建筑未在配置中定义');
  }
  if (building.level >= definition.maxLevel) {
    throw new AppError('INVALID_STATUS', `${definition.name}已达最高等级`, {
      maxLevel: definition.maxLevel,
    });
  }

  const cost = upgradeCost(definition.upgradeCostPerLevel, building.level);
  for (const [resourceId, amount] of Object.entries(cost)) {
    draft.requireResource(resourceId, Number(amount));
  }

  const nextLevel = building.level + 1;
  draft.addStatement(updateBuildingLevelStatement(building.id, nextLevel));
  building.level = nextLevel;

  await draft.commit();
  return draft.view();
}

export interface BreakthroughOutcome {
  discipleId: string;
  discipleName: string;
  success: boolean;
  chanceBp: number;
  roll: number;
  message: string;
}

/** 突破：结算 → 门槛/冷却/灵气检查 → 扣灵气 → 抽一次随机。 */
export async function breakthrough(
  db: D1Database,
  userId: string,
  discipleId: string,
  now: number,
): Promise<{ state: SectStateView; outcome: BreakthroughOutcome }> {
  const draft = await draftFor(db, userId, now);
  const disciple = draft.discipleById(discipleId);

  // 0014：在外弟子不能破境（服务端裁决）。
  requireNotAway(draft, disciple, '破境');
  const { config } = draft;

  const stage = findStage(disciple.realm_id, disciple.stage);
  if (stage.requiredCultivation === null) {
    throw new AppError('INVALID_STATUS', '已达本版本最高境界');
  }
  if (disciple.injured_until !== null && Number(disciple.injured_until) > now) {
    const remainingSeconds = Math.ceil((Number(disciple.injured_until) - now) / 1000);
    throw new AppError('COOLDOWN_ACTIVE', '突破失败后的调息尚未结束', { remainingSeconds });
  }
  if (Number(disciple.cultivation) < stage.requiredCultivation) {
    throw new AppError('INVALID_STATUS', '修为不足，先让弟子修炼', {
      required: stage.requiredCultivation,
      cultivation: Number(disciple.cultivation),
    });
  }

  const cost = breakthroughEnergyCost(disciple.stage);
  draft.requireResource('spiritualEnergy', cost);

  const arrayLevel =
    draft.buildings.find((building) => building.def_id === SPIRITUAL_ARRAY_BUILDING_ID)?.level ?? 0;
  const chanceBp = breakthroughChanceBp(config, arrayLevel);
  const roll = Math.floor(Math.random() * 10_000);
  const success = roll < chanceBp;

  if (success) {
    const next = nextStageOf(disciple.realm_id, disciple.stage);
    if (next === null) {
      throw new AppError('INVALID_STATUS', '已达本版本最高境界');
    }
    draft.addStatement(
      updateDiscipleProgressStatement(disciple.id, {
        realmId: next.realmId,
        stage: next.stage,
        cultivation: 0,
        remainder: 0,
        injuredUntil: null,
      }),
    );
    disciple.realm_id = next.realmId;
    disciple.stage = next.stage;
    disciple.cultivation = 0;
    disciple.cultivation_remainder = 0;
    disciple.injured_until = null;
  } else {
    const kept = Math.floor((stage.requiredCultivation * config.breakthrough.failureKeepBp) / 10_000);
    const injuredUntil = now + config.breakthrough.cooldownSeconds * 1000;
    draft.addStatement(
      updateDiscipleProgressStatement(disciple.id, {
        realmId: disciple.realm_id,
        stage: disciple.stage,
        cultivation: kept,
        remainder: 0,
        injuredUntil,
      }),
    );
    disciple.cultivation = kept;
    disciple.cultivation_remainder = 0;
    disciple.injured_until = injuredUntil;
  }

  // 同批核对弟子仍属本宗，避免驱逐先提交后白扣灵气、破境写入影响 0 行。
  await draft.commitDisciple([{ id: disciple.id }]);
  return {
    state: draft.view(),
    outcome: {
      discipleId: disciple.id,
      discipleName: disciple.name,
      success,
      chanceBp,
      roll,
      message: success
        ? `${disciple.name} 突破成功，境界提升`
        : `${disciple.name} 突破失败，修为跌落（保留 ${String(
            Math.floor((stage.requiredCultivation * config.breakthrough.failureKeepBp) / 10_000),
          )}）`,
    },
  };
}

/* ---------- 弟子管理（0013 迁移：私有备注 / 驱逐出师门） ---------- */

/** 私有备注上限（Unicode 码点；与 0013 迁移的 CHECK (length(note) <= 60) 同一口径）。 */
export const DISCIPLE_NOTE_MAX_CHARS = 60;

/**
 * 备注归一化（计划 2.4）：trim → 校验「单行纯文本、无控制字符、≤60 个 Unicode 字符」。
 *
 * - 允许空串（= 清空备注）；超长 / 含换行或控制字符一律 VALIDATION_ERROR，不静默截断；
 * - 按码点计数：SQLite 的 length() 对 TEXT 也按字符（码点）计数，两侧口径一致；
 * - 前端只做长度提示，服务端是最终裁决。
 */
export function normalizeDiscipleNote(raw: string): string {
  const note = raw.trim();
  // 覆盖 C0（\u0000-\u001F）、DEL、C1 控制区（\u0080-\u009F）与 U+2028/U+2029 行分隔符：
  // 这些都是「能造出折行或不可见控制」的字符，接口层必须自己挡住，不能只靠 UI 单行输入。
  if (/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/.test(note)) {
    throw new AppError('VALIDATION_ERROR', '备注只能是一行纯文本，不能包含换行或控制字符');
  }
  if ([...note].length > DISCIPLE_NOTE_MAX_CHARS) {
    throw new AppError('VALIDATION_ERROR', `备注最多 ${String(DISCIPLE_NOTE_MAX_CHARS)} 个字符`, {
      maxChars: DISCIPLE_NOTE_MAX_CHARS,
    });
  }
  return note;
}

/**
 * 保存弟子私有备注（计划 2.4）：结算 → 归属校验 → 归一化 → 单列写回。
 *
 * - 归属：discipleById 只在当前宗门的弟子里找，非本宗 / 不存在统一 NOT_FOUND；
 * - 幂等：只写 note 一列，不扣资源、不动计数、不触发事件，重复保存相同内容无额外游戏效果；
 * - 提交走 commitDisciple：批内重新核对宗门行、资源余额与目标弟子归属，并发时不产生半写。
 */
export async function setDiscipleNote(
  db: D1Database,
  userId: string,
  discipleId: string,
  note: string,
  now: number,
): Promise<SectStateView> {
  const draft = await draftFor(db, userId, now);
  const disciple = draft.discipleById(discipleId);
  const normalized = normalizeDiscipleNote(note);

  draft.addStatement(updateDiscipleNoteStatement(disciple.id, draft.sect.id, normalized));
  disciple.note = normalized;

  // 计划 2.3：在外期间**可以**继续保存私有备注，所以这条路径不要求成员「不在外」。
  await draft.commitDisciple([{ id: disciple.id }], undefined, { allowActiveJourney: true });
  return draft.view();
}

/**
 * 保存弟子头像框（0017：掌门私有外观，弟子交互优化计划第 3 节）。
 *
 * - 归属：discipleById 只在当前宗门的弟子里找，非本宗 / 不存在统一 NOT_FOUND（不泄露他人门人信息）；
 * - frameId 的合法值（21 个，见 schema.ts 的 AVATAR_FRAME_IDS）已由 setDiscipleAvatarFrameRequestSchema 白名单把关（不接受任意 URL / 路径 / 上传）；
 * - 幂等：与当前值相同时**显式早退**——不提交结算、不写库，不产生资源 / 计数 / 事件副作用；
 * - 提交走 commitDisciple：批内重新核对宗门行、资源余额与目标弟子归属，并发时不产生半写。
 */
export async function setDiscipleAvatarFrame(
  db: D1Database,
  userId: string,
  discipleId: string,
  frameId: string,
  now: number,
): Promise<SectStateView> {
  const draft = await draftFor(db, userId, now);
  const disciple = draft.discipleById(discipleId);

  // 幂等：存相同值不改任何一行（早退在结算写回之前，连「本该由 sync 落地的结算」也不提交）。
  if (disciple.avatar_frame_id === frameId) {
    return draft.view();
  }

  draft.addStatement(updateDiscipleAvatarFrameStatement(disciple.id, draft.sect.id, frameId));
  disciple.avatar_frame_id = frameId;

  // 头像框是纯外观，与私有备注一样允许在外历练期间更改（不要求成员「不在外」）。
  await draft.commitDisciple([{ id: disciple.id }], undefined, { allowActiveJourney: true });
  return draft.view();
}

/* ---------- 改名（宗门 / 弟子）：扣灵石的名称写回 ---------- */

/**
 * 名称归一化：trim → 校验「单行纯文本、无控制字符、长度在 [minChars, maxChars] 个码点之间」。
 *
 * - 与 normalizeDiscipleNote 同一口径：不静默截断，越界一律 VALIDATION_ERROR；
 * - 按码点计数：SQLite 的 length() 对 TEXT 也按字符（码点）计数，两侧口径一致；
 * - label 只用于错误文案（宗门名 / 弟子名）；长度规则来自 names.ts 的契约常量。
 */
export function normalizeEntityName(
  raw: string,
  label: string,
  minChars: number,
  maxChars: number,
): string {
  const name = raw.trim();
  // 与备注同一套字符黑名单：C0 / DEL / C1 控制区与 U+2028、U+2029 行分隔符，
  // 这些都是「能造出折行或不可见控制」的字符，接口层必须自己挡住，不能只靠 UI 单行输入。
  if (/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/.test(name)) {
    throw new AppError('VALIDATION_ERROR', `${label}只能是一行纯文本，不能包含换行或控制字符`);
  }
  const length = [...name].length;
  if (length < minChars) {
    throw new AppError('VALIDATION_ERROR', `${label}至少 ${String(minChars)} 个字符`, {
      minChars,
      maxChars,
    });
  }
  if (length > maxChars) {
    throw new AppError('VALIDATION_ERROR', `${label}最多 ${String(maxChars)} 个字符`, {
      minChars,
      maxChars,
    });
  }
  return name;
}

/**
 * 宗门名占用检查（0021）：建宗与改名共用的预检，只为给出友好文案。
 *
 * 真正的裁决是 0021 迁移建的 sects_name_uniq 唯一索引：并发下两个请求可能同时通过预检，
 * 由索引让后到的那批拿到 UNIQUE 失败并整体回滚（见两处 classifyDbError 的映射）。
 * `exceptSectId` 给改名用：自己保持原名不算冲突（同名幂等早退在调用方更早处理）。
 */
async function requireSectNameAvailable(
  db: D1Database,
  name: string,
  exceptSectId?: string,
): Promise<void> {
  const holder = await new SectRepository(db).findIdByName(name);
  if (holder !== null && holder !== exceptSectId) {
    throw sectNameTakenError(name);
  }
}

/** 0021 重名的统一回执：预检与唯一索引的并发失败路径共用同一句话、同一个错误码。 */
function sectNameTakenError(name: string): AppError {
  return new AppError('STATE_CONFLICT', `宗门名「${name}」已被占用，换一个吧`, { name });
}

/**
 * 宗门改名（一次 500 灵石）：结算 → 归一化 → 查重 → 余额校验并扣减 → 单列写回，一次受保护 batch。
 *
 * - 幂等：提交的名字与当前名字相同时**显式早退**——不扣灵石、不写库，也不做查重（免得和自己冲突）；
 * - 唯一：与已有宗门重名一律 STATE_CONFLICT（预检 + sects_name_uniq 双重保险），名字被占用时不扣费；
 * - 提交走 commit()：批内重新核对宗门行（level / last_settled_at）与资源余额，并发时不产生半写。
 */
export async function renameSect(
  db: D1Database,
  userId: string,
  name: string,
  now: number,
): Promise<SectStateView> {
  const draft = await draftFor(db, userId, now);
  const normalized = normalizeEntityName(name, '宗门名', SECT_NAME_MIN_CHARS, SECT_NAME_MAX_CHARS);

  if (draft.sect.name === normalized) {
    return draft.view();
  }

  // 顺序要紧：查重在扣费之前——名字被占用时连余额都不动。
  await requireSectNameAvailable(db, normalized, draft.sect.id);

  draft.requireResource('spiritStone', SECT_RENAME_COST);
  draft.addStatement(updateSectNameStatement(draft.sect.id, normalized));
  draft.sect.name = normalized;

  try {
    await draft.commit();
  } catch (error) {
    // 并发抢名：唯一索引拦下后到的那批（预检已经放行过），整批回滚后翻译成同一句话。
    if (classifyDbError(error) === 'unique') {
      throw sectNameTakenError(normalized);
    }
    throw error;
  }
  return draft.view();
}

/**
 * 弟子改名（一次 50 灵石）：结算 → 归属校验 → 归一化 → 余额校验并扣减 → 单列写回。
 *
 * - 归属：discipleById 只在当前宗门的弟子里找，非本宗 / 不存在统一 NOT_FOUND；
 * - 幂等：与当前姓名相同时早退，不扣灵石、不写库；
 * - 在外可改：与私有备注 / 头像框一致，允许在尚未到期的历练期间改名（allowActiveJourney）；
 * - 历史不回填：历练与赌坊记录里的 disciple_name 是当时的姓名快照，改名只影响此后的展示。
 */
export async function renameDisciple(
  db: D1Database,
  userId: string,
  discipleId: string,
  name: string,
  now: number,
): Promise<SectStateView> {
  const draft = await draftFor(db, userId, now);
  const disciple = draft.discipleById(discipleId);
  const normalized = normalizeEntityName(
    name,
    '弟子名',
    DISCIPLE_NAME_MIN_CHARS,
    DISCIPLE_NAME_MAX_CHARS,
  );

  if (disciple.name === normalized) {
    return draft.view();
  }

  draft.requireResource('spiritStone', DISCIPLE_RENAME_COST);
  draft.addStatement(updateDiscipleNameStatement(disciple.id, draft.sect.id, normalized));
  disciple.name = normalized;

  await draft.commitDisciple([{ id: disciple.id }], undefined, { allowActiveJourney: true });
  return draft.view();
}

/** 驱逐回执（纯命令结果，前端据此提示是否需要重新布阵）；不属于任何公开视图。 */
export interface ExpelDiscipleOutcome {
  discipleId: string;
  discipleName: string;
  /** 该弟子被驱逐前是否占用手动守擂阵容（true = 阵容已同批清空，需要重新布阵）。 */
  lineupCleared: boolean;
  /** 驱逐后宗门剩余弟子数（< 3 时无法组成主动挑战阵容、也不能被挑战）。 */
  remainingDisciples: number;
}

/**
 * 驱逐弟子（计划 2.5）：结算 → 归属校验 → 同一原子 batch 删除弟子行（含必要的阵容清理）。
 *
 * - 只允许驱逐自己的现存弟子；不存在 / 非本宗统一 NOT_FOUND（不泄露他人门人信息）；
 * - 允许驱逐到不足 3 人甚至 0 人：不返还资源 / 招募次数 / 培养成本，不降低宗门等级；
 * - 先结算该弟子截至当时的修为与岗位收益（结算写回与删除同在一条 batch 里，结算在前）；
 * - 以 `id + sect_id` 删除；若 ID 在本宗手动守擂阵容内，同批把阵容写成 NULL（提示重新布阵）；
 *   不在阵容内时阵容一个字都不改；
 * - 历史快照（challenge_log / sparring_log / explorations）与公开档案不回写；返回的 state 里
 *   人数相关视图（招募容量、宗门升级要求、守擂）已经是新人数。
 *
 * 并发（计划 2.5 末条）：commitDisciple 的首条快照守卫在 batch 执行时重新核对宗门行、资源
 * 余额、被驱逐弟子仍属本宗，以及阵容仍与读到的快照一致；任一冲突整批回滚并映射成
 * INVALID_STATUS，不会出现幽灵成功、失效手动阵容或半写。
 */
export async function expelDisciple(
  db: D1Database,
  userId: string,
  discipleId: string,
  now: number,
): Promise<{ state: SectStateView; outcome: ExpelDiscipleOutcome }> {
  const draft = await draftFor(db, userId, now);
  const disciple = draft.discipleById(discipleId);

  // 0014：在外弟子不能被驱逐；已归队但未领取的也要先领取。
  requireJourneySettled(draft, disciple, '驱逐');

  // 0015：正在交互探索中的弟子不能被驱逐 —— 否则这支队伍的成员会被抽走，探索记录就不成立了。
  if (explorationPartyIds(draft.activeExploration).includes(disciple.id)) {
    throw new AppError('INVALID_STATUS', `${disciple.name}正在秘境探索中，探索结束后才能驱逐`);
  }

  // 阵容守卫必须用「读到的库值」：守卫是本批第一条语句，此时本批写入还没执行。
  const lineupSnapshot = draft.sect.defense_lineup;
  const lineupCleared = lineupContainsDisciple(lineupSnapshot, disciple.id);

  draft.disciples = draft.disciples.filter((row) => row.id !== disciple.id);
  draft.addStatement(deleteDiscipleStatement(disciple.id, draft.sect.id));
  if (lineupCleared) {
    draft.addStatement(updateSectDefenseLineupStatement(draft.sect.id, null));
    draft.sect.defense_lineup = null;
  }

  await draft.commitDisciple([{ id: disciple.id }], lineupSnapshot);
  return {
    state: draft.view(),
    outcome: {
      discipleId: disciple.id,
      discipleName: disciple.name,
      lineupCleared,
      remainingDisciples: draft.disciples.length,
    },
  };
}

/**
 * 升级宗门：结算 → 条件判定（资源/建筑/弟子境界）→ 扣资源 + 提级 + 解锁新建筑（一次 batch）。
 *
 * 条件全部来自 SECT_LEVELS（数据），这里只做判定与报错；容量/上限在 view() 里按新等级现算。
 */
export async function upgradeSect(
  db: D1Database,
  userId: string,
  now: number,
): Promise<SectStateView> {
  const draft = await draftFor(db, userId, now);
  const next = nextSectLevel(Number(draft.sect.level));
  if (next === null) {
    throw new AppError('INVALID_STATUS', '宗门已达最高品阶');
  }

  // 1. 资源条件：不足时 requireResource 抛 INSUFFICIENT_RESOURCE（带缺少数量），满足则直接扣减。
  for (const [resourceId, amount] of Object.entries(next.upgradeCost)) {
    draft.requireResource(resourceId, Number(amount));
  }

  // 2. 建筑条件
  for (const requirement of next.buildingRequirements) {
    const building = draft.buildings.find((row) => row.def_id === requirement.defId);
    const buildingName =
      draft.config.buildings.find((item) => item.id === requirement.defId)?.name ??
      requirement.defId;
    if (building === undefined || building.level < requirement.minLevel) {
      throw new AppError(
        'INVALID_STATUS',
        `${buildingName}需要 ${requirement.minLevel} 级（当前 ${building?.level ?? 0} 级）`,
      );
    }
  }

  // 3. 弟子境界条件；提交时仍需确认用于晋升的弟子没有被并发驱逐。
  const requiredDisciples = new Set<string>();
  for (const requirement of next.discipleRequirements) {
    const requiredRealmIndex = realmIndex(requirement.minRealmId);
    const qualified = draft.disciples.filter(
      (disciple) => realmIndex(disciple.realm_id) >= requiredRealmIndex,
    );
    if (qualified.length < requirement.count) {
      const realmName = findRealm(requirement.minRealmId).name;
      throw new AppError(
        'INVALID_STATUS',
        `需要 ${requirement.count} 名${realmName}及以上弟子（当前 ${qualified.length} 名）`,
      );
    }
    for (const disciple of qualified.slice(0, requirement.count)) requiredDisciples.add(disciple.id);
  }

  // 4. 提级
  draft.sect.level = next.level;
  draft.addStatement(updateSectLevelStatement(draft.sect.id, next.level));

  // 5. 自动解锁（创建）本等级带来的新建筑；已存在则跳过，避免重复建筑行。
  for (const defId of next.unlockBuildings) {
    if (draft.buildings.some((row) => row.def_id === defId)) {
      continue;
    }
    const buildingRow: BuildingRow = {
      id: crypto.randomUUID(),
      sect_id: draft.sect.id,
      def_id: defId,
      level: 1,
      created_at: now,
    };
    draft.buildings.push(buildingRow);
    draft.addStatement(
      insertBuildingStatement({
        id: buildingRow.id,
        sectId: draft.sect.id,
        defId,
        level: 1,
        now,
      }),
    );
  }

  await draft.commitDisciple([...requiredDisciples].map((id) => ({ id })));
  return draft.view();
}

/**
 * 读最近事件（GET /game/events）：只查库即可（本次请求没有结算，不产生新事件）。
 * 没有宗门时返回空列表，避免在创建宗门页误报错。
 */
export async function listRecentEvents(db: D1Database, userId: string): Promise<EventLogView[]> {
  const sect = await new SectRepository(db).findByUserId(userId);
  if (sect === null) {
    return [];
  }
  const rows = await new EventLogRepository(db).findRecentBySectId(sect.id, EVENT_HISTORY_LIMIT);
  return rows.map(eventLogViewFromRow);
}

const SPAR_HISTORY_LIMIT = 20;

/** 切磋历史（GET /game/spar-history）：最近 20 条 + 攻方胜负统计。 */
export async function listSparHistory(db: D1Database, userId: string): Promise<SparHistoryView> {
  const sect = await new SectRepository(db).findByUserId(userId);
  if (sect === null) {
    return { entries: [], stats: { wins: 0, losses: 0, draws: 0, total: 0 } };
  }

  const sparRepo = new SparringRepository(db);
  const [rows, stats] = await Promise.all([
    sparRepo.findBySectId(sect.id, SPAR_HISTORY_LIMIT),
    sparRepo.statsBySectId(sect.id),
  ]);

  const sectIds = new Set<string>();
  for (const row of rows) {
    sectIds.add(row.attacker_sect_id);
    sectIds.add(row.defender_sect_id);
  }
  const sectRepo = new SectRepository(db);
  const sectNames = new Map<string, string>();
  for (const id of sectIds) {
    const s = await sectRepo.findById(id);
    sectNames.set(id, s?.name ?? '未知宗门');
  }

  const entries: SparHistoryEntryView[] = rows.map((row) => ({
    id: row.id,
    attackerSectId: row.attacker_sect_id,
    attackerSectName: sectNames.get(row.attacker_sect_id) ?? '未知宗门',
    defenderSectId: row.defender_sect_id,
    defenderSectName: sectNames.get(row.defender_sect_id) ?? '未知宗门',
    attackerPower: Number(row.attacker_power),
    defenderPower: Number(row.defender_power),
    result: row.result,
    reputationGained: Number(row.reputation_gained),
    role: row.attacker_sect_id === sect.id ? 'attacker' : 'defender',
    createdAt: new Date(Number(row.created_at)).toISOString(),
  }));

  return {
    entries,
    stats: { ...stats, total: stats.wins + stats.losses + stats.draws },
  };
}

/**
 * 探索秘境（V2-2 第五、八节）：结算 → 逐项校验 → 扣入场费 → 一次随机判定 → 发奖 / 弟子受伤。
 *
 * 校验顺序（全部失败都在任何写库之前抛出，见下方说明）：
 *   1. 秘境 id 存在（NOT_FOUND）
 *   2. 宗门等级 >= 秘境要求（INVALID_STATUS）
 *   3. 已建造演武场（INVALID_STATUS）
 *   4. 队伍人数在 [minParty, maxParty]（VALIDATION_ERROR）
 *   5. 队伍无重复弟子（VALIDATION_ERROR）
 *   6. 每个弟子存在、且不在疗伤冷却中（NOT_FOUND / INVALID_STATUS）
 *   7. 每日次数未用完（DAILY_LIMIT，按 UTC+8 自然日窗口统计）
 *   8. 入场费足够（INSUFFICIENT_RESOURCE，由 draft.requireResource 扣减）
 *
 * 写回：结算写回 + 入场费扣减 + （成功时）奖励 + （失败时）弟子伤势 + 探索记录，
 * 全部挂在同一个 draft 上，最后只做**一次** `draft.commit()`（单次 D1 batch）。
 * 也就是说任何一步抛错都不会产生半写：进程内的内存状态丢弃，DB 未被触碰。
 *
 * 奖励按文档原样直接加到余额，**不夹容量上限**（与结算里的 room 截断规则不同，这是任务文档
 * 给定的行为）：余额可能因此超过容量，下一次结算的 room=0（或低于容量）会丢弃产出的那部分。
 */
export async function exploreSectRealm(
  db: D1Database,
  userId: string,
  realmId: string,
  discipleIds: string[],
  now: number,
): Promise<{ state: SectStateView; result: ExplorationResultView }> {
  const draft = await draftFor(db, userId, now);
  const realm = findSecretRealm(realmId);
  if (!realm) {
    throw new AppError('NOT_FOUND', '秘境不存在');
  }

  // 1. 宗门等级检查
  if (Number(draft.sect.level) < realm.requiredSectLevel) {
    throw new AppError('INVALID_STATUS', `需要宗门 ${realm.requiredSectLevel} 级才能进入`);
  }

  // 2. 演武场检查：高阶秘境必须有演武场才能探索（V2-1 在 4 级解锁）
  const arena = draft.buildings.find((b) => b.def_id === ARENA_BUILDING_ID);
  if (realm.requiresArena && !arena) {
    throw new AppError('INVALID_STATUS', '需要先建造演武场');
  }

  // 3. 队伍人数检查
  if (discipleIds.length < realm.minParty || discipleIds.length > realm.maxParty) {
    throw new AppError('VALIDATION_ERROR', `需要 ${realm.minParty}~${realm.maxParty} 名弟子`);
  }

  // 4. 去重检查
  if (new Set(discipleIds).size !== discipleIds.length) {
    throw new AppError('VALIDATION_ERROR', '不能派遣重复弟子');
  }

  // 5. 弟子存在性与状态检查（不能是受伤弟子）
  const members: {
    realmId: string;
    stage: number;
    attack: number;
    defense: number;
    speed: number;
    talent: string;
    name: string;
  }[] = [];
  for (const id of discipleIds) {
    const disciple = draft.discipleById(id);
    // 0014：在外弟子不能出战探索。
    requireNotAway(draft, disciple, '出战');
    if (disciple.injured_until !== null && Number(disciple.injured_until) > now) {
      throw new AppError('INVALID_STATUS', `${disciple.name}正在疗伤，无法出战`);
    }
    members.push({
      realmId: disciple.realm_id,
      stage: Number(disciple.stage),
      attack: Number(disciple.attack),
      defense: Number(disciple.defense),
      speed: Number(disciple.speed),
      talent: disciple.talent,
      name: disciple.name,
    });
  }

  // 6. 每日次数检查（独立的 DB 读取，不参与 draft 的 batch）
  if (realm.dailyLimit !== null) {
    const dayStart = dayStartMs(now);
    const used = await new ExplorationRepository(db).countTodayBySectAndRealm(
      draft.sect.id,
      realmId,
      dayStart,
    );
    if (used >= realm.dailyLimit) {
      throw new AppError('DAILY_LIMIT', `今日${realm.name}探索次数已用完（${realm.dailyLimit}次/天）`);
    }
  }

  // 7. 扣资源（入场费）
  for (const [resourceId, amount] of Object.entries(realm.entryCost)) {
    draft.requireResource(resourceId, Number(amount));
  }

  // 8. 计算战力与成功率
  const power = partyCombatPower(members);
  const arenaLevel = arena?.level ?? 0;
  const chanceBp = explorationSuccessChanceBp(power, realm.difficulty, arenaLevel);
  const roll = Math.floor(Math.random() * 10_000);
  const success = roll < chanceBp;

  // 9. 成功：发放奖励（不夹容量上限，见函数头说明）
  const actualRewards: Record<string, string> = {};
  if (success) {
    for (const [resourceId, amount] of Object.entries(realm.rewards)) {
      draft.addStatement(resourceDeltaStatement(draft.sect.id, resourceId, Number(amount), now));
      draft.balances = draft.balances.map((row) =>
        row.resource_id === resourceId
          ? { ...row, balance: Number(row.balance) + Number(amount), updated_at: now }
          : row,
      );
      actualRewards[resourceId] = amount;
    }
  }

  // 10. 失败：队伍里所有弟子受伤（冷却 10 分钟）；只改 injured_until，不碰境界/修为
  const INJURY_DURATION_MS = 10 * 60 * 1000;
  if (!success) {
    for (const id of discipleIds) {
      const injuredUntil = now + INJURY_DURATION_MS;
      draft.addStatement(updateDiscipleInjuryStatement(id, injuredUntil));
      const disciple = draft.disciples.find((item) => item.id === id);
      if (disciple !== undefined) {
        disciple.injured_until = injuredUntil;
      }
    }
  }

  // 11. 写入探索记录
  const explorationId = crypto.randomUUID();
  draft.addStatement(
    insertExplorationStatement({
      id: explorationId,
      sectId: draft.sect.id,
      realmId,
      party: JSON.stringify(discipleIds),
      success,
      rewards: JSON.stringify(actualRewards),
      now,
    }),
  );

  // 结算、入场费、奖励/伤势与日志一起受成员归属守卫保护。
  await draft.commitDisciple(discipleIds.map((id) => ({ id })));
  return {
    state: draft.view(),
    result: {
      realmName: realm.name,
      success,
      chanceBp,
      roll,
      rewards: actualRewards,
      memberNames: members.map((m) => m.name),
      message: success
        ? `探索${realm.name}成功！获得丰厚奖励。`
        : `探索${realm.name}失败，弟子受伤需疗养。`,
    },
  };
}

/**
 * 秘境列表（V2-2 第六节）：只读，不结算、不写库。
 * 没有宗门时返回空列表（与 GET /game/events 一致，避免创建宗门页误报错）。
 */
export async function listSecretRealms(
  db: D1Database,
  env: Env,
  userId: string,
  now: number,
): Promise<SecretRealmListView[]> {
  const snapshot = await loadSnapshot(db, userId, now);
  if (snapshot === null) {
    return [];
  }

  const sectLevel = Number(snapshot.sect.level);
  const dayStart = dayStartMs(now);
  const arena = snapshot.buildings.find((b) => b.def_id === ARENA_BUILDING_ID);
  const exploreEnabled = realmExploreEnabled(env);
  const views: SecretRealmListView[] = [];

  for (const realm of SECRET_REALMS) {
    const locked = sectLevel < realm.requiredSectLevel;
    let usedToday = 0;
    if (realm.dailyLimit !== null && !locked) {
      usedToday = await new ExplorationRepository(db).countTodayBySectAndRealm(
        snapshot.sect.id,
        realm.id,
        dayStart,
      );
    }
    views.push({
      id: realm.id,
      name: realm.name,
      description: realm.description,
      difficulty: realm.difficulty,
      entryCost: realm.entryCost,
      rewards: realm.rewards,
      minParty: realm.minParty,
      maxParty: realm.maxParty,
      dailyLimit: realm.dailyLimit,
      usedToday,
      requiredSectLevel: realm.requiredSectLevel,
      locked,
      hasArena: arena !== undefined || !realm.requiresArena,
      exploreEnabled,
    });
  }
  return views;
}

/** 每日切磋总次数上限（V3 第四节；同一目标另有每日 1 次限制）。 */
const SPARRING_DAILY_LIMIT = 5;

/** 切磋奖励（最小单位）：只有胜利发放。 */
const SPARRING_WIN_REPUTATION = 10;
const SPARRING_WIN_SPIRIT_STONE = 100_000;

/** 实际战力 = 基础战力 × (0.85 ~ 1.15)（V3 第 4.2 节）。 */
function fluctuatedPower(basePower: number): number {
  return Math.floor(basePower * (0.85 + Math.random() * 0.3));
}

/** 镇派弟子：境界（realmIndex）→ 阶段 → 资质逐级比较取最高；没有弟子返回 null。 */
function topDiscipleOf(disciples: readonly DiscipleRow[]): LeaderboardEntryView['topDisciple'] {
  let best: DiscipleRow | null = null;
  for (const disciple of disciples) {
    if (
      best === null ||
      realmIndex(disciple.realm_id) > realmIndex(best.realm_id) ||
      (realmIndex(disciple.realm_id) === realmIndex(best.realm_id) &&
        (Number(disciple.stage) > Number(best.stage) ||
          (Number(disciple.stage) === Number(best.stage) &&
            Number(disciple.aptitude) > Number(best.aptitude))))
    ) {
      best = disciple;
    }
  }
  if (best === null) {
    return null;
  }
  return {
    name: best.name,
    realmName: findRealm(best.realm_id).name,
    stageName: findStage(best.realm_id, Number(best.stage)).name,
  };
}

/**
 * 江湖榜（V3 第二节）：综合榜，只读、不结算、不写库。
 *
 * 排序由 SQL 决定（等级 DESC → 声望 DESC → 创建时间 ASC，见 SectRepository.findAll）；
 * 3~5 个宗门不优化查询，逐个宗门查弟子列表找镇派弟子。
 */
export async function listLeaderboard(
  db: D1Database,
  userId: string,
): Promise<LeaderboardEntryView[]> {
  const sectRepository = new SectRepository(db);
  const discipleRepository = new DiscipleRepository(db);
  const [sects, mySect] = await Promise.all([
    sectRepository.findAll(),
    sectRepository.findByUserId(userId),
  ]);
  const mySectId = mySect?.id ?? null;

  const entries: LeaderboardEntryView[] = [];
  for (const sect of sects) {
    const disciples = await discipleRepository.findBySectId(sect.id);
    entries.push({
      sectId: sect.id,
      name: sect.name,
      level: Number(sect.level),
      levelName: findSectLevel(Number(sect.level)).name,
      reputation: Number(sect.reputation) || 0,
      discipleCount: disciples.length,
      topDisciple: topDiscipleOf(disciples),
      isMe: sect.id === mySectId,
    });
  }
  return entries;
}

const DISCIPLE_LEADERBOARD_SIZE = 10;

/**
 * 弟子榜单：战力 top 10 + 综合分 top 10，只读、不结算、不写库。
 *
 * 遍历所有宗门的弟子，服务端现算战力与综合评分（与 sync 视图同一口径），
 * 分别按两个维度取 top 10 返回。规模小（几十个弟子）不需要 SQL 层面优化。
 */
export async function listDiscipleLeaderboard(
  db: D1Database,
  userId: string,
): Promise<DiscipleLeaderboardView> {
  const sectRepository = new SectRepository(db);
  const discipleRepository = new DiscipleRepository(db);
  const [sects, mySect] = await Promise.all([
    sectRepository.findAll(),
    sectRepository.findByUserId(userId),
  ]);
  const mySectId = mySect?.id ?? null;
  const sectNames = new Map(sects.map((s) => [s.id, s.name]));

  interface RankedDisciple {
    row: DiscipleRow;
    sectId: string;
    combatPower: number;
    score: number;
  }
  const all: RankedDisciple[] = [];
  for (const sect of sects) {
    const disciples = await discipleRepository.findBySectId(sect.id);
    for (const d of disciples) {
      all.push({
        row: d,
        sectId: sect.id,
        combatPower: discipleCombatPower(
          d.realm_id, Number(d.stage),
          Number(d.attack), Number(d.defense), Number(d.speed),
          d.talent,
        ),
        score: attributeScore({
          aptitude: Number(d.aptitude),
          attack: Number(d.attack),
          defense: Number(d.defense),
          speed: Number(d.speed),
          luck: Number(d.luck),
          physique: Number(d.physique),
        }),
      });
    }
  }

  function toEntry(item: RankedDisciple, rank: number): DiscipleLeaderboardEntryView {
    const realm = findRealm(item.row.realm_id);
    const stage = findStage(item.row.realm_id, Number(item.row.stage));
    return {
      rank,
      discipleId: item.row.id,
      discipleName: item.row.name,
      gender: item.row.gender,
      realmId: item.row.realm_id,
      frameId: item.row.avatar_frame_id,
      sectId: item.sectId,
      sectName: sectNames.get(item.sectId) ?? '',
      realmName: realm.name,
      stageName: stage.name,
      realmOrder: realmIndex(realm.id),
      stage: Number(item.row.stage),
      combatPower: item.combatPower,
      attributeScore: item.score,
      talent: item.row.talent,
      talentName: findTalent(item.row.talent)?.name ?? '无',
      isMe: item.sectId === mySectId,
    };
  }

  const byCombatPower = [...all]
    .sort((a, b) => b.combatPower - a.combatPower || b.score - a.score)
    .slice(0, DISCIPLE_LEADERBOARD_SIZE)
    .map((item, i) => toEntry(item, i + 1));

  const byAttributeScore = [...all]
    .sort((a, b) => b.score - a.score || b.combatPower - a.combatPower)
    .slice(0, DISCIPLE_LEADERBOARD_SIZE)
    .map((item, i) => toEntry(item, i + 1));

  return { byCombatPower, byAttributeScore };
}

/**
 * 公开档案（V3 第三节）：只读、不结算、不写库。
 *
 * 只返回安全字段——**不含**资源余额、弟子修为/岗位/伤势、建筑升级消耗与招募计数；
 * 宗门不存在抛 NOT_FOUND。
 *
 * 0012 挑战预览：相对当前用户计算可挑战状态、阻止原因、守擂方式、当日次数、
 * 是否已挑战过、等级差与「若胜利」的确切奖励。只报告守擂方式，不暴露临时自动
 * 阵容的人选与顺序（自动阵容只在挑战真正受理时生成）。观看者自己没有宗门时
 * `challenge` 为 null（前端渲染为不可挑战）。
 */
export async function getPublicSect(
  db: D1Database,
  sectId: string,
  viewerUserId: string,
  now: number,
): Promise<PublicSectView> {
  const sect = await new SectRepository(db).findById(sectId);
  if (sect === null) {
    throw new AppError('NOT_FOUND', '宗门不存在');
  }

  const [disciples, buildings, viewerSect] = await Promise.all([
    new DiscipleRepository(db).findBySectId(sectId),
    new BuildingRepository(db).findBySectId(sectId),
    new SectRepository(db).findByUserId(viewerUserId),
  ]);
  const config = gameConfig();

  // 0014：守方实时在外状态参与裁决（跨宗读取只用于能否应战的安全判断，不公开他人结果）。
  const defenderAwayIds = journeyAwayIds(
    await new DiscipleJourneyRepository(db).findOpenBySectId(sectId),
    now,
  );
  const plan = planDefenseLineup(
    sect.defense_lineup,
    availableDefenders(disciples, defenderAwayIds),
  );
  let challenge: PublicSectChallengeView | null = null;
  if (viewerSect !== null) {
    const isSelf = viewerSect.id === sect.id;
    const challengeDay = await loadChallengeDayState(db, viewerSect, now);
    const alreadyChallengedToday = !isSelf
      ? await new ChallengeRepository(db).hasChallengedTargetToday(
          viewerSect.id,
          sect.id,
          challengeDay.dateKey,
          dayStartMs(now),
        )
      : false;

    let blockedReason: ChallengeBlockedReason | null = null;
    if (isSelf) {
      blockedReason = 'self';
    } else if (challengeDay.remaining <= 0) {
      blockedReason = 'daily_limit';
    } else if (alreadyChallengedToday) {
      blockedReason = 'already_challenged_today';
    } else if (!plan.canDefend) {
      blockedReason = 'defender_insufficient';
    }

    const levelDifference = Number(sect.level) - Number(viewerSect.level);
    const reward = rewardTierForLevelDifference(levelDifference);
    const preview: ChallengeRewardPreviewView = {
      tier: reward.tier,
      reputation: reward.reputation,
      spiritStone: reward.spiritStone,
    };
    challenge = {
      canChallenge: blockedReason === null,
      blockedReason,
      defenseMode: plan.canDefend ? plan.mode : null,
      dailyLimit: CHALLENGE_DAILY_LIMIT,
      usedToday: challengeDay.usedToday,
      remaining: challengeDay.remaining,
      alreadyChallengedToday,
      levelDifference,
      rewardPreview: preview,
    };
  }

  return {
    sectId: sect.id,
    name: sect.name,
    level: Number(sect.level),
    levelName: findSectLevel(Number(sect.level)).name,
    reputation: Number(sect.reputation) || 0,
    // 「有效手动守擂阵容」：3 个不重复、仍属于本宗的弟子；无效阵容不算已布阵。
    hasDefenseLineup: plan.canDefend && plan.mode === 'configured',
    challenge,
    disciples: disciples.map((disciple) => ({
      id: disciple.id,
      name: disciple.name,
      gender: disciple.gender,
      aptitude: Number(disciple.aptitude),
      attack: Number(disciple.attack),
      defense: Number(disciple.defense),
      speed: Number(disciple.speed),
      talent: disciple.talent,
      talentName: findTalent(disciple.talent)?.name ?? '无',
      realmId: disciple.realm_id,
      realmName: findRealm(disciple.realm_id).name,
      // 境界高低用服务端 REALMS 下标（前端排序只认它，不按境界名字符串比较）。
      realmOrder: realmIndex(disciple.realm_id),
      stage: Number(disciple.stage),
      stageName: findStage(disciple.realm_id, Number(disciple.stage)).name,
      combatPower: discipleCombatPower(
        disciple.realm_id,
        Number(disciple.stage),
        Number(disciple.attack),
        Number(disciple.defense),
        Number(disciple.speed),
        disciple.talent,
      ),
    })),
    buildings: buildings.map((building) => ({
      name: config.buildings.find((item) => item.id === building.def_id)?.name ?? building.def_id,
      level: Number(building.level),
    })),
    createdAt: new Date(Number(sect.created_at)).toISOString(),
  };
}

/**
 * 切磋（V3 第 4.3 节）：结算 → 逐项校验 → 战力浮动判定 → 胜利发奖 + 写切磋记录。
 *
 * 校验顺序（全部失败都在任何写库之前抛出）：
 *   1. 自己的宗门快照（draftFor，顺带结算）
 *   2. 目标宗门存在（NOT_FOUND）
 *   3. 不能打自己（VALIDATION_ERROR）
 *   4. 今日切磋总次数 < 5（DAILY_LIMIT，UTC+8 自然日窗口）
 *   5. 今日未与同一目标切磋过（DAILY_LIMIT）
 *   6. 攻方弟子存在 + 不在疗伤中（NOT_FOUND / INVALID_STATUS）
 *   7. 防方弟子存在且属于目标宗门（NOT_FOUND）；**不**检查防方伤势
 *   8. 双方战力（基础战力 ±15% 浮动）→ > 胜、< 负、== 平
 *   9. 胜利：声望 +10、灵石 +5000（写库语句 + 内存状态一起更新）
 *  10. 写 sparring_log
 *  11. 只做**一次** `draft.commit()`，返回 state + 切磋结果
 *
 * 也就是说任何一步抛错都不会产生半写：内存状态丢弃、DB 未被触碰。
 */
export async function sparWithSect(
  db: D1Database,
  userId: string,
  targetSectId: string,
  myDiscipleId: string,
  targetDiscipleId: string,
  now: number,
): Promise<{ state: SectStateView; result: SparResultView }> {
  const draft = await draftFor(db, userId, now);

  const targetSect = await new SectRepository(db).findById(targetSectId);
  if (targetSect === null) {
    throw new AppError('NOT_FOUND', '对方宗门不存在');
  }
  if (targetSect.id === draft.sect.id) {
    throw new AppError('VALIDATION_ERROR', '不能切磋自己的宗门');
  }

  const dayStart = dayStartMs(now);
  const sparring = new SparringRepository(db);
  if ((await sparring.countTodayByAttacker(draft.sect.id, dayStart)) >= SPARRING_DAILY_LIMIT) {
    throw new AppError('DAILY_LIMIT', `今日切磋次数已用完（${SPARRING_DAILY_LIMIT} 次/天）`);
  }
  if ((await sparring.countTodayByPair(draft.sect.id, targetSect.id, dayStart)) >= 1) {
    throw new AppError('DAILY_LIMIT', `今日已与${targetSect.name}切磋过（同一目标每日 1 次）`);
  }

  const myDisciple = draft.discipleById(myDiscipleId);
  if (myDisciple.injured_until !== null && Number(myDisciple.injured_until) > now) {
    throw new AppError('INVALID_STATUS', `${myDisciple.name}正在疗伤，无法出战`);
  }

  // 防方弟子只校验存在性与归属：受伤状态不影响防方（V3 第 4.1 节）。
  const targetDisciple = await new DiscipleRepository(db).findById(targetDiscipleId);
  if (targetDisciple === null || targetDisciple.sect_id !== targetSect.id) {
    throw new AppError('NOT_FOUND', '对方弟子不存在');
  }

  const myPower = fluctuatedPower(
    discipleCombatPower(
      myDisciple.realm_id,
      Number(myDisciple.stage),
      Number(myDisciple.attack),
      Number(myDisciple.defense),
      Number(myDisciple.speed),
      myDisciple.talent,
    ),
  );
  const targetPower = fluctuatedPower(
    discipleCombatPower(
      targetDisciple.realm_id,
      Number(targetDisciple.stage),
      Number(targetDisciple.attack),
      Number(targetDisciple.defense),
      Number(targetDisciple.speed),
      targetDisciple.talent,
    ),
  );
  const result: SparResultView['result'] =
    myPower > targetPower ? 'win' : myPower < targetPower ? 'lose' : 'draw';

  const reputationGained = result === 'win' ? SPARRING_WIN_REPUTATION : 0;
  const spiritStoneGained = result === 'win' ? SPARRING_WIN_SPIRIT_STONE : 0;
  if (result === 'win') {
    draft.addStatement(updateSectReputationStatement(draft.sect.id, reputationGained));
    draft.addStatement(
      resourceDeltaStatement(draft.sect.id, 'spiritStone', spiritStoneGained, now),
    );
    // 内存状态同步更新：本次返回的 state 里就是新声望 / 新灵石余额。
    draft.sect.reputation = (Number(draft.sect.reputation) || 0) + reputationGained;
    draft.balances = draft.balances.map((row) =>
      row.resource_id === 'spiritStone'
        ? { ...row, balance: Number(row.balance) + spiritStoneGained, updated_at: now }
        : row,
    );
  }

  draft.addStatement(
    insertSparringLogStatement({
      id: crypto.randomUUID(),
      attackerSectId: draft.sect.id,
      defenderSectId: targetSect.id,
      attackerDiscipleId: myDisciple.id,
      defenderDiscipleId: targetDisciple.id,
      attackerPower: myPower,
      defenderPower: targetPower,
      result,
      reputationGained,
      now,
    }),
  );

  // 唯一的一次 commit：结算写回 + 奖励 + 切磋记录同一个 batch。
  await draft.commit();
  return {
    state: draft.view(),
    result: {
      myDiscipleName: myDisciple.name,
      targetDiscipleName: targetDisciple.name,
      targetSectName: targetSect.name,
      myPower,
      targetPower,
      result,
      reputationGained,
      spiritStoneGained,
      message: sparMessage(result, myDisciple.name, targetDisciple.name, spiritStoneGained),
    },
  };
}

/** 切磋结果文案（胜/负/平）。 */
function sparMessage(
  result: SparResultView['result'],
  myName: string,
  targetName: string,
  spiritStoneGained: number,
): string {
  if (result === 'win') {
    return `${myName} 击败了 ${targetName}，宗门声望 +${SPARRING_WIN_REPUTATION}，获得灵石 ${String(
      spiritStoneGained / 1000,
    )}`;
  }
  if (result === 'lose') {
    return `${myName} 不敌 ${targetName}，切磋落败（无损失）`;
  }
  return `${myName} 与 ${targetName} 战成平手`;
}

/** 挑战历史展示条数上限（与旧的切磋历史一致）。 */
const CHALLENGE_HISTORY_LIMIT = 20;

/** 挑战单轮结果（V5 3.2）；单轮平局（浮动后战力恰好相等）算守方胜。 */
interface RoundResult {
  round: number;
  attackerPower: number;
  defenderPower: number;
  winner: 'attacker' | 'defender';
}

/** 挑战阵容成员快照：id + 名字 + 基础战力（浮动前的 discipleCombatPower）。 */
interface ChallengeMember {
  discipleId: string;
  name: string;
  power: number;
}

/** 挑战成员的完整属性（仅用于 jev 判定的上下文文本，不序列化到日志）。 */
interface ChallengeRichMember extends ChallengeMember {
  realmName: string;
  stage: number;
  attack: number;
  defense: number;
  speed: number;
  aptitude: number;
  luck: number;
  physique: number;
  talent: string | null;
}

/**
 * 3v3 逐对决斗（V5 3.2）：每轮取双方同序号弟子，战力 ±15% 浮动后高者胜该轮；
 * 先赢满 2 轮者胜整场（第 3 轮只在 1:1 时打）。单轮平局算守方胜。
 */
function resolveChallenge(
  attackerMembers: readonly ChallengeMember[],
  defenderMembers: readonly ChallengeMember[],
): { rounds: RoundResult[]; result: 'win' | 'lose' } {
  const rounds: RoundResult[] = [];
  let attackerWins = 0;
  let defenderWins = 0;

  for (let i = 0; i < DEFENSE_LINEUP_SIZE; i++) {
    if (attackerWins >= 2 || defenderWins >= 2) {
      break;
    }
    const aPower = fluctuatedPower(attackerMembers[i].power);
    const dPower = fluctuatedPower(defenderMembers[i].power);
    const winner: RoundResult['winner'] = aPower > dPower ? 'attacker' : 'defender';
    rounds.push({ round: i + 1, attackerPower: aPower, defenderPower: dPower, winner });
    if (winner === 'attacker') {
      attackerWins++;
    } else {
      defenderWins++;
    }
  }

  return { rounds, result: attackerWins >= 2 ? 'win' : 'lose' };
}

function talentLabel(talent: string | null): string {
  if (talent === null) return '无';
  return findTalent(talent)?.name ?? '无';
}

function challengeMemberLine(tag: string, m: ChallengeRichMember): string {
  return [
    `${tag}：${m.name}，${m.realmName}${String(m.stage)}阶`,
    `攻${String(m.attack)} 防${String(m.defense)} 速${String(m.speed)}`,
    `资质${String(m.aptitude)} 气运${String(m.luck)} 体质${String(m.physique)}`,
    `天赋=${talentLabel(m.talent)}，综合战力 ${String(m.power)}`,
  ].join('，');
}

function challengeStateText(
  attackers: readonly ChallengeRichMember[],
  defenders: readonly ChallengeRichMember[],
): string {
  const lines: string[] = ['修仙宗门 3v3 逐对决斗，每轮按序号一一对决。'];
  for (let i = 0; i < DEFENSE_LINEUP_SIZE; i++) {
    const a = attackers[i];
    const d = defenders[i];
    if (a === undefined || d === undefined) break;
    lines.push(`--- 第 ${String(i + 1)} 轮 ---`);
    lines.push(challengeMemberLine('攻方', a));
    lines.push(challengeMemberLine('守方', d));
    const ratio = d.power > 0 ? a.power / d.power : 100;
    if (ratio >= 2) lines.push('攻方实力远强于守方');
    else if (ratio >= 1.3) lines.push('攻方实力强于守方');
    else if (ratio >= 0.8) lines.push('双方实力接近');
    else if (ratio >= 0.5) lines.push('守方实力强于攻方');
    else lines.push('守方实力远强于攻方');
  }
  return lines.join('\n');
}

/**
 * 用 Decisions API 判定挑战各轮胜负。
 *
 * 一次请求里放 3 个 choice 问题（round1 / round2 / round3），返回每轮的胜负概率分布。
 * 调用方根据前两轮结果决定是否使用第三轮。失败时返回 null，触发本地降级。
 */
async function judgeChallengeRounds(
  apiKey: string,
  attackers: readonly ChallengeRichMember[],
  defenders: readonly ChallengeRichMember[],
): Promise<Record<string, number>[] | null> {
  try {
    const questions: Record<string, Question> = {};
    for (let i = 0; i < DEFENSE_LINEUP_SIZE; i++) {
      questions[`round${String(i + 1)}`] = {
        type: 'choice',
        instructions: `第 ${String(i + 1)} 轮对决：判断攻守双方谁会胜出。综合考虑双方境界、六维属性、天赋，尤其是速度差异带来的先手优势和气运带来的偶然性。`,
        criteria: {
          attacker: `攻方${attackers[i]!.name}胜出`,
          defender: `守方${defenders[i]!.name}胜出`,
        },
      };
    }
    const answers = await decide(
      apiKey,
      challengeStateText(attackers, defenders),
      questions,
    );
    const result: Record<string, number>[] = [];
    for (let i = 0; i < DEFENSE_LINEUP_SIZE; i++) {
      const answer = answers[`round${String(i + 1)}`] as ChoiceAnswer | undefined;
      if (answer?.probabilities === undefined) return null;
      const aProb = Number(answer.probabilities.attacker) || 0;
      const dProb = Number(answer.probabilities.defender) || 0;
      if (aProb + dProb <= 0) return null;
      result.push(answer.probabilities);
    }
    return result;
  } catch (error) {
    console.warn(
      `challenge_decisions_failed reason=${error instanceof Error ? error.name : 'unknown'}`,
    );
    return null;
  }
}

/**
 * 用 jev 概率分布解算挑战；降级时走原来的 fluctuatedPower 随机逻辑。
 */
function resolveChallengeWithProbabilities(
  attackerMembers: readonly ChallengeMember[],
  defenderMembers: readonly ChallengeMember[],
  roundProbabilities: readonly Record<string, number>[],
): { rounds: RoundResult[]; result: 'win' | 'lose' } {
  const rounds: RoundResult[] = [];
  let attackerWins = 0;
  let defenderWins = 0;

  for (let i = 0; i < DEFENSE_LINEUP_SIZE; i++) {
    if (attackerWins >= 2 || defenderWins >= 2) break;
    const probs = roundProbabilities[i]!;
    const aProb = Number(probs.attacker) || 0;
    const dProb = Number(probs.defender) || 0;
    const total = aProb + dProb;
    const roll = Math.random() * total;
    const winner: RoundResult['winner'] = roll < aProb ? 'attacker' : 'defender';
    const aPower = attackerMembers[i]!.power;
    const dPower = defenderMembers[i]!.power;
    rounds.push({ round: i + 1, attackerPower: aPower, defenderPower: dPower, winner });
    if (winner === 'attacker') attackerWins++;
    else defenderWins++;
  }

  return { rounds, result: attackerWins >= 2 ? 'win' : 'lose' };
}

/** 挑战记录里的阵容 JSON 快照 → 成员数组；非法输入退化为空数组。 */
function parseLineupMembers(text: string): ChallengeMember[] {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const members: ChallengeMember[] = [];
    for (const item of parsed) {
      if (item === null || typeof item !== 'object') {
        continue;
      }
      const row = item as Record<string, unknown>;
      members.push({
        discipleId: typeof row.discipleId === 'string' ? row.discipleId : '',
        name: typeof row.name === 'string' ? row.name : '未知',
        power: Number(row.power) || 0,
      });
    }
    return members;
  } catch {
    return [];
  }
}

/** 挑战记录里的每轮结果 JSON → RoundResult[]；非法输入退化为空数组。 */
function parseRoundResults(text: string): RoundResult[] {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const rounds: RoundResult[] = [];
    for (const item of parsed) {
      if (item === null || typeof item !== 'object') {
        continue;
      }
      const row = item as Record<string, unknown>;
      rounds.push({
        round: Number(row.round),
        attackerPower: Number(row.attackerPower),
        defenderPower: Number(row.defenderPower),
        winner: row.winner === 'attacker' ? 'attacker' : 'defender',
      });
    }
    return rounds;
  } catch {
    return [];
  }
}

/** 把逐轮结果与双方阵容（按序号）拼成带名字的战报视图。 */
function toChallengeRoundViews(
  results: readonly RoundResult[],
  attackerMembers: readonly ChallengeMember[],
  defenderMembers: readonly ChallengeMember[],
): ChallengeRoundView[] {
  return results.map((result) => ({
    round: result.round,
    attackerName: attackerMembers[result.round - 1]?.name ?? '未知',
    defenderName: defenderMembers[result.round - 1]?.name ?? '未知',
    attackerPower: result.attackerPower,
    defenderPower: result.defenderPower,
    winner: result.winner,
  }));
}

/**
 * 设置守擂阵容（V5 2.2）：结算 → 去重 → 逐个校验归属（不存在抛 NOT_FOUND）→ 写回。
 *
 * 注意：受伤的弟子**可以**放进守擂阵容（守擂是预设的，不检查伤势）。
 * 只有一次 `draft.commit()`：结算写回 + 阵容更新同一个 batch。
 */
export async function setDefenseLineup(
  db: D1Database,
  userId: string,
  discipleIds: string[],
  now: number,
): Promise<SectStateView> {
  const draft = await draftFor(db, userId, now);

  if (discipleIds.length !== DEFENSE_LINEUP_SIZE) {
    throw new AppError('VALIDATION_ERROR', `守擂阵容需要 ${DEFENSE_LINEUP_SIZE} 名弟子`);
  }
  if (new Set(discipleIds).size !== discipleIds.length) {
    throw new AppError('VALIDATION_ERROR', '不能重复选择同一名弟子');
  }
  for (const id of discipleIds) {
    // 归属校验：只看自己的弟子，不存在（含不属于本宗）抛 NOT_FOUND。
    const member = draft.discipleById(id);
    // 0014：在外弟子不能进入新守擂阵容（服务端裁决，不只靠前端禁用）。
    requireNotAway(draft, member, '进入守擂阵容');
  }

  const lineupJson = JSON.stringify(discipleIds);
  draft.addStatement(updateSectDefenseLineupStatement(draft.sect.id, lineupJson));
  draft.sect.defense_lineup = lineupJson;

  // 0013：提交时重新核对选中弟子仍属本宗 —— 与驱逐交错时不写入引用已离开弟子的失效阵容。
  await draft.commitDisciple(discipleIds.map((id) => ({ id })));
  return draft.view();
}

/**
 * 挑战（3v3 逐对决斗，0012 优化版）：结算 → 固定顺序校验 → 守方阵容快照 → 逐对决斗
 * → 奖励按等级差档位 → 计数/奖励/日志/结算一次受保护 batch 提交。
 *
 * 校验顺序（全部失败都在任何写库之前抛出，不消耗次数）：
 *   1. 自己的宗门快照（draftFor，顺带结算）
 *   2. 目标宗门存在、不是自己（NOT_FOUND / VALIDATION_ERROR）
 *   3. 攻方当日计数（UTC+8 归一 + 发布当天日志兼容核对）< 3（DAILY_LIMIT）
 *   4. 今日未挑战过该目标（DAILY_LIMIT；并发兜底靠唯一部分索引）
 *   5. 攻方恰好 3 名不重复、属于自己且未受伤的弟子（VALIDATION_ERROR / NOT_FOUND / INVALID_STATUS）
 *   6. 一次性加载守方当前全部弟子
 *   7. 守方阵容：有效手动阵容按原顺序；无效/未设置但弟子 >= 3 → 临时自动守擂
 *      （等概率不重复抽 3 名、随机排序、可含受伤弟子）；弟子 < 3 拒绝（INVALID_STATUS）
 *   8. 快照双方等级 → 等级差 → 奖励档位（奖励以开战快照为准）
 *   9. resolveChallenge 逐对决斗；胜利按档位发奖（失败/`<=-3` 胜利都是 0）
 *  10. commitChallenge：守卫 + 结算写回 + 计数 + 奖励 + 挑战日志（含快照）同一 batch；
 *      「受理一场战斗」的边界就是整个 batch 成功。
 */
export async function challengeSect(
  db: D1Database,
  userId: string,
  targetSectId: string,
  discipleIds: string[],
  now: number,
  env: Env,
): Promise<{ state: SectStateView; result: ChallengeResultView }> {
  const draft = await draftFor(db, userId, now);

  // 2. 目标存在且不是自己
  const targetSect = await new SectRepository(db).findById(targetSectId);
  if (targetSect === null) {
    throw new AppError('NOT_FOUND', '对方宗门不存在');
  }
  if (targetSect.id === draft.sect.id) {
    throw new AppError('VALIDATION_ERROR', '不能挑战自己的宗门');
  }

  // 3. 当日次数（UTC+8 归一；日期键过期时做日志兼容核对）
  const challengeDay = draft.challengeDay;
  if (challengeDay.remaining <= 0) {
    throw new AppError('DAILY_LIMIT', `今日挑战次数已用完（${CHALLENGE_DAILY_LIMIT} 次/天）`);
  }

  // 4. 同一目标每日 1 次（先查给友好报错；并发兜底在唯一部分索引）
  const challengeRepository = new ChallengeRepository(db);
  if (
    await challengeRepository.hasChallengedTargetToday(
      draft.sect.id,
      targetSect.id,
      challengeDay.dateKey,
      dayStartMs(now),
    )
  ) {
    throw new AppError('DAILY_LIMIT', `今日已挑战过${targetSect.name}（同一目标每日 1 次）`);
  }

  // 5. 攻方阵容：不重复、属于自己、未受伤
  if (discipleIds.length !== DEFENSE_LINEUP_SIZE) {
    throw new AppError('VALIDATION_ERROR', `攻方阵容需要 ${DEFENSE_LINEUP_SIZE} 名弟子`);
  }
  if (new Set(discipleIds).size !== discipleIds.length) {
    throw new AppError('VALIDATION_ERROR', '不能派遣重复弟子');
  }
  const attackerRichMembers: ChallengeRichMember[] = [];
  for (const id of discipleIds) {
    const disciple = draft.discipleById(id);
    // 0014：在外弟子不能出战挑战。
    requireNotAway(draft, disciple, '出战');
    if (disciple.injured_until !== null && Number(disciple.injured_until) > now) {
      throw new AppError('INVALID_STATUS', `${disciple.name}正在疗伤，无法出战`);
    }
    const stage = Number(disciple.stage);
    const attack = Number(disciple.attack);
    const defense = Number(disciple.defense);
    const speed = Number(disciple.speed);
    attackerRichMembers.push({
      discipleId: disciple.id,
      name: disciple.name,
      power: discipleCombatPower(disciple.realm_id, stage, attack, defense, speed, disciple.talent),
      realmName: findStage(disciple.realm_id, stage).name,
      stage,
      attack,
      defense,
      speed,
      aptitude: Number(disciple.aptitude),
      luck: Number(disciple.luck),
      physique: Number(disciple.physique),
      talent: disciple.talent,
    });
  }
  const attackerMembers: ChallengeMember[] = attackerRichMembers;

  // 6-7. 守方阵容：有效手动阵容按原顺序；否则临时自动守擂（弟子 < 3 拒绝，不消耗次数）
  const defenderDisciples = await new DiscipleRepository(db).findBySectId(targetSect.id);
  // 0014：被动挑战也要检查守方弟子的实时在外状态 —— 自动守擂只从未在外的弟子中选人
  // （跨宗读取只用于安全裁决，不公开他人的历练结果）。
  const defenderAwayIds = journeyAwayIds(
    await new DiscipleJourneyRepository(db).findOpenBySectId(targetSect.id),
    now,
  );
  // 候选池 = 不在外的守方弟子；手动阵容与自动守擂都只看这一份名单。
  const defenders = availableDefenders(defenderDisciples, defenderAwayIds);
  const plan = planDefenseLineup(targetSect.defense_lineup, defenders);
  if (!plan.canDefend) {
    throw new AppError('INVALID_STATUS', '对方门下弟子不足 3 人，暂时无法应战');
  }
  const defenseMode: DefenseMode = plan.mode;
  const toRichMember = (disciple: (typeof defenders)[number]): ChallengeRichMember => {
    const stage = Number(disciple.stage);
    const attack = Number(disciple.attack);
    const defense = Number(disciple.defense);
    const speed = Number(disciple.speed);
    return {
      discipleId: disciple.id,
      name: disciple.name,
      power: discipleCombatPower(disciple.realm_id, stage, attack, defense, speed, disciple.talent),
      realmName: findStage(disciple.realm_id, stage).name,
      stage,
      attack,
      defense,
      speed,
      aptitude: Number(disciple.aptitude),
      luck: Number(disciple.luck),
      physique: Number(disciple.physique),
      talent: disciple.talent,
    };
  };
  let defenderRichMembers: ChallengeRichMember[];
  if (plan.mode === 'configured') {
    defenderRichMembers = plan.manualIds.map((id) => toRichMember(defenders.find((row) => row.id === id)!));
  } else {
    defenderRichMembers = shufflePick(defenders.map(toRichMember), DEFENSE_LINEUP_SIZE);
  }
  const defenderMembers: ChallengeMember[] = defenderRichMembers;

  // 8. 开战快照：等级差与奖励档位（不从之后状态反推）
  const attackerLevel = Number(draft.sect.level);
  const defenderLevel = Number(targetSect.level);
  const levelDifference = defenderLevel - attackerLevel;
  const rewardTier = rewardTierForLevelDifference(levelDifference);

  // 9. 解算战斗：优先用 Decisions API 判定，失败时降级为本地随机浮动
  const apiKey = readStringVar(env.OPENROUTER_API_KEY);
  const roundProbs = apiKey !== undefined && apiKey.length > 0
    ? await judgeChallengeRounds(apiKey, attackerRichMembers, defenderRichMembers)
    : null;
  const resolved = roundProbs !== null
    ? resolveChallengeWithProbabilities(attackerMembers, defenderMembers, roundProbs)
    : resolveChallenge(attackerMembers, defenderMembers);
  const roundViews = toChallengeRoundViews(resolved.rounds, attackerMembers, defenderMembers);
  const attackerWins = resolved.rounds.filter((round) => round.winner === 'attacker').length;
  const defenderWins = resolved.rounds.filter((round) => round.winner === 'defender').length;

  const reputationGained = resolved.result === 'win' ? rewardTier.reputation : 0;
  const spiritStoneGained = resolved.result === 'win' ? rewardTier.spiritStone : 0;
  if (resolved.result === 'win' && (reputationGained > 0 || spiritStoneGained > 0)) {
    draft.addStatement(updateSectReputationStatement(draft.sect.id, reputationGained));
    draft.addStatement(resourceDeltaStatement(draft.sect.id, 'spiritStone', spiritStoneGained, now));
    // 内存状态同步更新：本次返回的 state 里就是新声望 / 新灵石余额。
    draft.sect.reputation = (Number(draft.sect.reputation) || 0) + reputationGained;
    draft.balances = draft.balances.map((row) =>
      row.resource_id === 'spiritStone'
        ? { ...row, balance: Number(row.balance) + spiritStoneGained, updated_at: now }
        : row,
    );
  }

  // 10-1. 计数写回：日期键归一到今天、计数 = 已用 + 1（内存同步，返回的 state 就是新值）。
  const usedAfter = challengeDay.usedToday + 1;
  draft.addStatement(
    updateSectChallengeCounterStatement(draft.sect.id, challengeDay.dateKey, usedAfter),
  );
  draft.sect.challenge_date_key = challengeDay.dateKey;
  draft.sect.challenge_count = usedAfter;

  // 10-2. 挑战日志（含开战快照；阵容与 rounds 是当场实际出战快照）。
  draft.addStatement(
    insertChallengeLogStatement({
      id: crypto.randomUUID(),
      attackerSectId: draft.sect.id,
      defenderSectId: targetSect.id,
      attackerLineup: JSON.stringify(attackerMembers),
      defenderLineup: JSON.stringify(defenderMembers),
      rounds: JSON.stringify(resolved.rounds),
      result: resolved.result,
      reputationGained,
      spiritStoneGained,
      attackerLevel,
      defenderLevel,
      rewardTier: rewardTier.tier,
      defenseMode,
      challengeDateKey: challengeDay.dateKey,
      now,
    }),
  );

  // 10-3. 唯一的一次受保护提交：守卫 + 结算 + 计数 + 奖励 + 日志同一个 batch。
  await draft.commitChallenge(
    {
      id: targetSect.id,
      level: defenderLevel,
      defenseLineup: targetSect.defense_lineup,
    },
    // 0013：提交时重新核对攻方出战弟子仍属本宗（与驱逐交错时不出现幽灵出战）。
    attackerMembers.map((member) => ({ id: member.discipleId })),
    defenderMembers.map((member) => member.discipleId),
  );

  // 13. 提交成功后返回含最新剩余次数的 state 与完整战斗结果。
  draft.challengeDay = {
    ...challengeDay,
    usedToday: usedAfter,
    remaining: Math.max(0, CHALLENGE_DAILY_LIMIT - usedAfter),
  };

  return {
    state: draft.view(),
    result: {
      targetSectName: targetSect.name,
      rounds: roundViews,
      result: resolved.result,
      reputationGained,
      spiritStoneGained,
      attackerLevel,
      defenderLevel,
      levelDifference,
      rewardTier: rewardTier.tier,
      defenseMode,
      message: challengeMessage(
        resolved.result,
        targetSect.name,
        attackerWins,
        defenderWins,
        reputationGained,
        spiritStoneGained,
      ),
    },
  };
}

/** 挑战结果文案（胜/负/零奖励胜）；灵石用展示单位。 */
function challengeMessage(
  result: 'win' | 'lose',
  targetSectName: string,
  attackerWins: number,
  defenderWins: number,
  reputationGained: number,
  spiritStoneGained: number,
): string {
  const score = `${String(attackerWins)}:${String(defenderWins)}`;
  if (result === 'win') {
    if (reputationGained === 0 && spiritStoneGained === 0) {
      return `你的阵容 ${score} 击败了 ${targetSectName}！对方等级过低，此胜没有奖励（已消耗 1 次挑战）。`;
    }
    return `你的阵容 ${score} 击败了 ${targetSectName}！声望 +${String(reputationGained)}，灵石 +${String(
      spiritStoneGained / 1000,
    )}`;
  }
  return `你的阵容 ${score} 不敌 ${targetSectName}，挑战失败（无奖励，已消耗 1 次挑战）`;
}

/**
 * 挑战历史（GET /game/challenge-history，V5 4.1）：最近 20 条 + 自身视角胜负统计。
 *
 * `role` 标识当前用户是攻方还是守方；记录的 `result` 存的是攻方视角，
 * 前端可结合 `role` 展示「自己的胜负」；`stats` 已经在服务端翻转为自身视角。
 */
export async function listChallengeHistory(
  db: D1Database,
  userId: string,
): Promise<ChallengeHistoryView> {
  const sect = await new SectRepository(db).findByUserId(userId);
  if (sect === null) {
    return { entries: [], stats: { wins: 0, losses: 0, total: 0 } };
  }

  const challengeRepository = new ChallengeRepository(db);
  const [rows, stats] = await Promise.all([
    challengeRepository.findBySectId(sect.id, CHALLENGE_HISTORY_LIMIT),
    challengeRepository.statsBySectId(sect.id),
  ]);

  const sectIds = new Set<string>();
  for (const row of rows) {
    sectIds.add(row.attacker_sect_id);
    sectIds.add(row.defender_sect_id);
  }
  const sectRepository = new SectRepository(db);
  const sectNames = new Map<string, string>();
  for (const id of sectIds) {
    const target = await sectRepository.findById(id);
    sectNames.set(id, target?.name ?? '未知宗门');
  }

  const entries: ChallengeHistoryEntryView[] = rows.map((row) => {
    const attackerMembers = parseLineupMembers(row.attacker_lineup);
    const defenderMembers = parseLineupMembers(row.defender_lineup);
    // 0012 快照：旧记录这些列为 NULL，原样透传（前端不伪造等级差/档位/守擂方式）。
    const attackerLevel = row.attacker_level === null ? null : Number(row.attacker_level);
    const defenderLevel = row.defender_level === null ? null : Number(row.defender_level);
    return {
      id: row.id,
      attackerSectName: sectNames.get(row.attacker_sect_id) ?? '未知宗门',
      defenderSectName: sectNames.get(row.defender_sect_id) ?? '未知宗门',
      rounds: toChallengeRoundViews(parseRoundResults(row.rounds), attackerMembers, defenderMembers),
      result: row.result,
      role: row.attacker_sect_id === sect.id ? 'attacker' : 'defender',
      reputationGained: Number(row.reputation_gained),
      spiritStoneGained: Number(row.spirit_stone_gained),
      attackerLevel,
      defenderLevel,
      // 等级差口径：守方等级 - 攻方等级（与开战预览/结果一致）
      levelDifference:
        attackerLevel === null || defenderLevel === null ? null : defenderLevel - attackerLevel,
      rewardTier: asRewardTier(row.reward_tier),
      defenseMode: asDefenseMode(row.defense_mode),
      createdAt: new Date(Number(row.created_at)).toISOString(),
    };
  });

  return {
    entries,
    stats: { wins: stats.wins, losses: stats.losses, total: stats.wins + stats.losses },
  };
}

/* ---------- 丹药系统（0011 迁移 + alchemy.ts） ---------- */

/** 炼制结果（POST /game/craft-pill 的 outcome）。 */
export interface CraftPillOutcome {
  pillId: PillId;
  pillName: string;
  quantity: number;
  /** 本次炼制的实际总成本（单颗 × quantity，最小单位）。 */
  cost: Record<string, string>;
}

/** 服用结果（POST /game/use-pill 的 outcome）。 */
export interface UsePillOutcome {
  pillId: PillId;
  pillName: string;
  discipleId: string;
  discipleName: string;
  effect: {
    kind: 'heal' | 'cultivation' | 'bodyTempering';
    /** cultivation / bodyTempering 的提升量。 */
    gain?: number;
    /** bodyTempering 服务端自动选中的短板属性。 */
    attribute?: PillAttribute;
  };
}

/** 建筑等级表（defId -> level），炼丹解锁判断用。 */
function buildingLevelsOf(buildings: readonly BuildingRow[]): Record<string, number> {
  return Object.fromEntries(buildings.map((row) => [row.def_id, row.level]));
}

/** 炼丹解锁检查（只在服务端实现；未解锁时 craft/use 一律 INVALID_STATUS）。 */
function requireAlchemyUnlocked(draft: SectDraft): void {
  const reason = alchemyUnlockBlockedReason(
    Number(draft.sect.level),
    buildingLevelsOf(draft.buildings),
  );
  if (reason !== null) {
    throw new AppError('INVALID_STATUS', reason);
  }
}

/** 配方查找：未知 pill id 抛 NOT_FOUND（不写库）。 */
function requirePillRecipe(pillId: string): PillRecipe {
  const recipe = findPillRecipe(pillId);
  if (recipe === undefined) {
    throw new AppError('NOT_FOUND', '未知丹方');
  }
  return recipe;
}

/**
 * 炼制丹药（即时命令，无队列）：结算 → 解锁/配方/资源校验 → 扣资源 + 库存 +quantity，
 * 只做**一次** `draft.commitAlchemy()`（单次 D1 batch，首条校验快照）。
 * 资源不足或快照冲突整次失败，不产生半写。
 */
export async function craftPill(
  db: D1Database,
  userId: string,
  pillId: string,
  quantity: number,
  now: number,
): Promise<{ state: SectStateView; outcome: CraftPillOutcome }> {
  const draft = await draftFor(db, userId, now);
  requireAlchemyUnlocked(draft);
  const recipe = requirePillRecipe(pillId);

  // 单次成本 = 单颗成本 × quantity；requireResource 逐项检查并扣减（不足抛 INSUFFICIENT_RESOURCE）。
  const cost: Record<string, string> = {};
  for (const [resourceId, amount] of Object.entries(recipe.cost)) {
    const total = Number(amount) * quantity;
    draft.requireResource(resourceId, total);
    cost[resourceId] = String(total);
  }

  draft.addPill(recipe.id, quantity);

  await draft.commitAlchemy(recipe.id);
  return {
    state: draft.view(),
    outcome: { pillId: recipe.id, pillName: recipe.name, quantity, cost },
  };
}

/**
 * 服用丹药（三条路径共用一套校验顺序）：
 *   结算 → 解锁检查 → 配方检查 → 弟子归属（discipleById 只在当前宗门里找）
 *   → 状态检查（不满足抛 INVALID_STATUS，且都在任何写库之前）
 *   → 扣库存 1 + 效果写回，只做**一次** `draft.commitAlchemy()`。
 *
 * - 回春丹：只清除有效伤势（injured_until > now），不碰修为/境界/属性。
 * - 聚气丹：修为 +min(120, 门槛 - 当前)，不越过突破门槛；cultivation_remainder 保持不变；
 *   已达本版本最高阶段或修为已满门槛的弟子不能用。
 * - 淬体丹：服务端自动选短板（attack -> defense -> speed），每名弟子最多 10 次；
 *   没有短板时拒绝。不使用随机数。
 */
export async function usePill(
  db: D1Database,
  userId: string,
  pillId: string,
  discipleId: string,
  now: number,
): Promise<{ state: SectStateView; outcome: UsePillOutcome }> {
  const draft = await draftFor(db, userId, now);
  requireAlchemyUnlocked(draft);
  const recipe = requirePillRecipe(pillId);
  const disciple = draft.discipleById(discipleId);

  // 0014：在外 / 有待领取记录的弟子不能服药（服务端裁决，不只禁用按钮）。
  requireNotAway(draft, disciple, '服药');

  if (recipe.id === 'healingPill') {
    if (disciple.injured_until === null || Number(disciple.injured_until) <= now) {
      throw new AppError('INVALID_STATUS', `${disciple.name}没有需要治疗的伤势`);
    }
    draft.requirePill(recipe.id);
    draft.addStatement(updateDiscipleInjuryStatement(disciple.id, null));
    disciple.injured_until = null;
    await draft.commitAlchemy(recipe.id, disciple.id);
    return {
      state: draft.view(),
      outcome: {
        pillId: recipe.id,
        pillName: recipe.name,
        discipleId: disciple.id,
        discipleName: disciple.name,
        effect: { kind: 'heal' },
      },
    };
  }

  if (recipe.id === 'cultivationPill') {
    const stage = findStage(disciple.realm_id, Number(disciple.stage));
    if (stage.requiredCultivation === null) {
      throw new AppError('INVALID_STATUS', `${disciple.name}已达本版本最高阶段，无法再服用聚气丹`);
    }
    if (Number(disciple.cultivation) >= stage.requiredCultivation) {
      throw new AppError('INVALID_STATUS', `${disciple.name}修为已达突破门槛，请先突破再服用聚气丹`);
    }
    const gain = Math.min(
      CULTIVATION_PILL_GAIN,
      stage.requiredCultivation - Number(disciple.cultivation),
    );
    draft.requirePill(recipe.id);
    const cultivation = Number(disciple.cultivation) + gain;
    // 修为余数保持不变：不因服药丢弃离线结算的小数余量。
    draft.addStatement(
      updateDiscipleCultivationStatement(disciple.id, cultivation, Number(disciple.cultivation_remainder)),
    );
    disciple.cultivation = cultivation;
    await draft.commitAlchemy(recipe.id, disciple.id);
    return {
      state: draft.view(),
      outcome: {
        pillId: recipe.id,
        pillName: recipe.name,
        discipleId: disciple.id,
        discipleName: disciple.name,
        effect: { kind: 'cultivation', gain },
      },
    };
  }

  // bodyTemperingPill
  const uses = Number(disciple.body_tempering_count);
  if (uses >= BODY_TEMPERING_MAX_USES) {
    throw new AppError(
      'INVALID_STATUS',
      `${disciple.name}已服用淬体丹 ${BODY_TEMPERING_MAX_USES} 次，药力已满`,
    );
  }
  const target = bodyTemperingTarget(
    Number(disciple.attack),
    Number(disciple.defense),
    Number(disciple.speed),
  );
  if (target === null) {
    throw new AppError('INVALID_STATUS', `${disciple.name}没有需要补齐的属性短板`);
  }
  draft.requirePill(recipe.id);
  const nextValue = Number(disciple[target.attribute]) + target.gain;
  const nextUses = uses + 1;
  disciple[target.attribute] = nextValue;
  disciple.body_tempering_count = nextUses;
  draft.addStatement(
    updateDiscipleBodyTemperingStatement(disciple.id, target.attribute, nextValue, nextUses),
  );
  await draft.commitAlchemy(recipe.id, disciple.id);
  return {
    state: draft.view(),
    outcome: {
      pillId: recipe.id,
      pillName: recipe.name,
      discipleId: disciple.id,
      discipleName: disciple.name,
      effect: { kind: 'bodyTempering', gain: target.gain, attribute: target.attribute },
    },
  };
}

/* ---------- 弟子历练（0014 迁移：预览 / 出发 / 领取） ---------- */
/**
 * 0014：任何会读取或改变弟子出战资格的命令都复用同一「在外」判定
 * （计划 2.3「所有相关写路径在服务端检查，不能只禁用按钮」）。
 *
 * 只有**尚未到期**（status = 'active'）的弟子被挡住：转岗 / 破境 / 服药 / 探索 / 挑战 /
 * 进守擂阵容 / 驱逐都不能做。已归队待领取（status = 'ready'）的弟子已在外归来，
 * 可以正常工作与操作，只是不能再次出发、也不能被驱逐（见 requireJourneySettled）。
 *
 * 保存私有备注不在限制之列（计划 2.3 明确允许）。
 */
function requireNotAway(draft: SectDraft, disciple: DiscipleRow, action: string): void {
  const pending = draft.pendingJourneyOf(disciple.id);
  if (pending === undefined || journeyStatusOf(pending, draft.now) !== 'active') {
    return;
  }
  throw new AppError('INVALID_STATUS', `${disciple.name}正在外历练，尚未归队，无法${action}`);
}

/**
 * 0014：既在外又占用「未领取记录」的操作（驱逐）：已归队的也必须先领取
 * —— 否则未领取的收获会随着弟子一起消失。
 */
function requireJourneySettled(draft: SectDraft, disciple: DiscipleRow, action: string): void {
  const pending = draft.pendingJourneyOf(disciple.id);
  if (pending === undefined) {
    return;
  }
  if (journeyStatusOf(pending, draft.now) === 'active') {
    throw new AppError('INVALID_STATUS', `${disciple.name}正在外历练，尚未归队，无法${action}`);
  }
  throw new AppError('INVALID_STATUS', `${disciple.name}有未领取的历练收获，先领取后才能${action}`);
}

/**
 * 与方向无关的出发资格（预览与出发共用同一份输入装配，保证两处口径一致）。
 * 只读：不写库、不结算。
 */
function journeyEligibilityOf(input: {
  sect: SectRow;
  disciple: DiscipleRow;
  disciples: readonly DiscipleRow[];
  journeys: readonly DiscipleJourneyRow[];
  /** 0015：进行中的交互式秘境探索；其队伍成员同样「不在家」，不能被派出去历练。 */
  activeExploration: RealmExplorationRow | null;
  now: number;
}): JourneyBlock | null {
  const awayIds = journeyAwayIds(input.journeys, input.now);
  // 0015：秘境探索中的弟子不能被派出去历练 —— 否则这支探索队伍会被抽走一个成员。
  if (explorationPartyIds(input.activeExploration).includes(input.disciple.id)) {
    return {
      code: 'INVALID_STATUS',
      message: `${input.disciple.name}正在秘境探索中，探索结束后才能外出历练`,
    };
  }
  const pending = input.journeys.find(
    (row) => row.disciple_id === input.disciple.id && row.claimed_at === null,
  );
  return journeyEligibilityBlock({
    realmId: input.disciple.realm_id,
    injuredUntil: input.disciple.injured_until === null ? null : Number(input.disciple.injured_until),
    pending:
      pending === undefined
        ? null
        : {
            status: journeyStatusOf(pending, input.now) === 'active' ? 'active' : 'ready',
            direction: asJourneyDirection(pending.direction),
          },
    activeCount: input.journeys.filter(
      (row) => row.claimed_at === null && Number(row.ends_at) > input.now,
    ).length,
    discipleCount: input.disciples.length,
    othersAwayCount: awayIds.size - (awayIds.has(input.disciple.id) ? 1 : 0),
    inDefenseLineup: lineupContainsDisciple(input.sect.defense_lineup, input.disciple.id),
    now: input.now,
  });
}

/**
 * 计算奖励快照所需的弟子属性子集（出发时一次性快照，之后不再重算）。
 * luck / physique 是 0016 新增的两项：预览与出发读同一份值，出发之后改属性也不影响已锁定的结果。
 */
function journeyRewardInputOf(disciple: DiscipleRow): {
  realmId: string;
  stage: number;
  aptitude: number;
  talent: string;
  attack: number;
  defense: number;
  speed: number;
  luck: number;
  physique: number;
} {
  return {
    realmId: disciple.realm_id,
    stage: Number(disciple.stage),
    aptitude: Number(disciple.aptitude),
    talent: disciple.talent,
    attack: Number(disciple.attack),
    defense: Number(disciple.defense),
    speed: Number(disciple.speed),
    luck: Number(disciple.luck),
    physique: Number(disciple.physique),
  };
}

/**
 * 历练预览（GET /game/journey-preview 的 data）：**只读**，不做挂机结算、不写库 ——
 * 与招募预览同理，预览不该因为「打开一次弹窗」就触发结算与随机事件。
 * 最终资格以 POST /game/start-journey 的服务端校验为准；预览不展示任何随机结果。
 */
export async function previewJourney(
  db: D1Database,
  userId: string,
  discipleId: string,
  now: number,
): Promise<JourneyPreviewView> {
  const snapshot = await loadSnapshot(db, userId, now);
  if (snapshot === null) {
    throw new AppError('NOT_FOUND', '尚未创建宗门');
  }
  const disciple = snapshot.disciples.find((row) => row.id === discipleId);
  if (disciple === undefined) {
    throw new AppError('NOT_FOUND', '弟子不存在');
  }

  const eligibility = journeyEligibilityOf({
    activeExploration: snapshot.activeExploration,
    sect: snapshot.sect,
    disciple,
    disciples: snapshot.disciples,
    journeys: snapshot.journeys,
    now,
  });
  const threshold = journeyThresholdOf(disciple.realm_id, Number(disciple.stage));
  const cultivation = Number(disciple.cultivation);
  const rewardInput = journeyRewardInputOf(disciple);

  const directions: JourneyDirectionPreviewView[] = JOURNEY_DIRECTIONS.map((definition) => {
    const directionBlocked = journeyDirectionBlockedReason(definition.id, threshold, cultivation);
    const durations: JourneyDurationPreviewView[] = JOURNEY_DURATIONS_SECONDS.map(
      (durationSeconds) => {
        const base = journeyBaseRewardForDisciple(rewardInput, definition.id, durationSeconds);
        // 方向 × 时长都在 JOURNEY_PLANS 白名单里；查不到只可能是常量表被改坏了。
        const reward = base ?? { cultivation: 0, resources: {}, extraChanceBp: 0, injuryChanceBp: 0 };
        // 修为按当前剩余门槛截断（「最多」语义）；实际入账以返程时的剩余门槛为准。
        const preview = previewJourneyCultivation(reward.cultivation, threshold, cultivation);
        const resources: Record<string, string> = {};
        for (const [resourceId, amount] of Object.entries(reward.resources)) {
          resources[resourceId] = String(amount);
        }
        return {
          durationSeconds,
          durationLabel: journeyDurationLabel(durationSeconds),
          cultivation: preview.cultivation,
          cultivationCapped: preview.capped,
          resources,
          // 实际概率由服务端按出发时的幸运 / 体魄算好，前端不复制公式、也不写死 15%。
          extraChanceBp: reward.extraChanceBp,
          injuryChanceBp: reward.injuryChanceBp,
          endsAt: new Date(journeyEndsAt(now, durationSeconds)).toISOString(),
        };
      },
    );
    return {
      direction: definition.id,
      name: definition.name,
      description: definition.description,
      available: eligibility === null && directionBlocked === null,
      // 整体不合格时也要给出原因，前端不必自己推断。
      blockedReason: directionBlocked ?? eligibility?.message ?? null,
      durations,
    };
  });

  return {
    discipleId: disciple.id,
    discipleName: disciple.name,
    canStart: eligibility === null,
    blockedReason: eligibility?.message ?? null,
    activeCount: snapshot.journeys.filter(
      (row) => row.claimed_at === null && Number(row.ends_at) > now,
    ).length,
    maxConcurrent: JOURNEY_MAX_CONCURRENT,
    directions,
    serverNow: new Date(now).toISOString(),
  };
}

/**
 * 出发（POST /game/start-journey）：结算到出发时刻 → 校验资格 → 出发时抽一次随机
 * （额外收获 + 受伤各一次、互相独立）并落库 → 受保护提交。
 *
 * - 奖励快照与随机结果在**出发时**确定并保存，到期前不向前端公开；刷新 / 重复领取不会重抽；
 * - 所有校验都在写库之前完成，失败不产生半写；
 * - 提交走 commitJourneyStart：批内复核名额、留守人数、弟子状态与守擂阵容快照，
 *   不同弟子并发出发也无法绕过两人上限。
 */
export async function startJourney(
  db: D1Database,
  userId: string,
  discipleId: string,
  direction: string,
  durationSeconds: number,
  now: number,
): Promise<SectStateView> {
  if (!isJourneyDirection(direction)) {
    throw new AppError('VALIDATION_ERROR', '未知历练方向', { direction });
  }
  if (!isJourneyDuration(durationSeconds)) {
    throw new AppError('VALIDATION_ERROR', '未知历练时长', { durationSeconds });
  }

  const draft = await draftFor(db, userId, now);
  const disciple = draft.discipleById(discipleId);

  const eligibility = journeyEligibilityOf({
    activeExploration: draft.activeExploration,
    sect: draft.sect,
    disciple,
    disciples: draft.disciples,
    journeys: draft.journeys,
    now,
  });
  if (eligibility !== null) {
    throw new AppError(eligibility.code, eligibility.message);
  }
  const directionBlocked = journeyDirectionBlockedReason(
    direction,
    journeyThresholdOf(disciple.realm_id, Number(disciple.stage)),
    Number(disciple.cultivation),
  );
  if (directionBlocked !== null) {
    throw new AppError('INVALID_STATUS', directionBlocked);
  }

  // 名额与留守人数必须用「写入前」的库值：守卫在 batch 执行时按同一口径再复核一次。
  const activeCount = draft.activeJourneyCount();
  const atHomeCount = draft.disciples.length - draft.awayDiscipleIds().size;

  const base = journeyBaseRewardForDisciple(
    journeyRewardInputOf(disciple),
    direction,
    durationSeconds,
  );
  if (base === null) {
    throw new AppError('VALIDATION_ERROR', '该方向没有这个时长', { direction, durationSeconds });
  }
  // 两项概率都来自出发时的属性快照：幸运 → 额外收获，体魄 → 受伤（与预览同一口径）；
  // 结果随记录落库，到期 / 领取都不重抽。
  const roll = rollJourneyOutcome({
    extraChanceBp: base.extraChanceBp,
    injuryChanceBp: base.injuryChanceBp,
  });
  const reward = journeyFinalReward(base, roll.extraHarvest);
  const endsAt = journeyEndsAt(now, durationSeconds);
  const resources: Record<string, number> = {};
  for (const [resourceId, amount] of Object.entries(reward.resources)) {
    resources[resourceId] = amount;
  }

  draft.addJourney({
    id: crypto.randomUUID(),
    sect_id: draft.sect.id,
    disciple_id: disciple.id,
    disciple_name: disciple.name,
    direction,
    duration_seconds: durationSeconds,
    // 岗位快照：disciples.assignment 本身保持不变（原岗位名额继续为他保留）。
    original_assignment: disciple.assignment,
    started_at: now,
    ends_at: endsAt,
    completed_at: null,
    claimed_at: null,
    reward_cultivation: reward.cultivation,
    reward_resources: JSON.stringify(resources),
    extra_harvest: roll.extraHarvest ? 1 : 0,
    injured: roll.injured ? 1 : 0,
    injury_chance_bp: base.injuryChanceBp,
    cultivation_awarded: null,
    created_at: now,
  });

  await draft.commitJourneyStart(disciple.id, activeCount, atHomeCount);
  return draft.view();
}

/** 领取回执文案（服务端拼好；前端不复制规则）。 */
function journeyClaimMessage(input: {
  discipleName: string;
  directionName: string;
  cultivationAwarded: number;
  extraHarvest: boolean;
  injured: boolean;
}): string {
  const parts = [`${input.discipleName}${input.directionName}归来`];
  parts.push(
    input.cultivationAwarded > 0 ? `修为 +${String(input.cultivationAwarded)}` : '修为已至门槛',
  );
  if (input.extraHarvest) {
    parts.push('另有额外收获');
  }
  parts.push(input.injured ? '途中受伤' : '平安无事');
  return parts.join('，');
}

/**
 * 领取（POST /game/claim-journey）：结算 → （到期则）归队入账 → 资源一次性入账 → 标记已领取，
 * 全部在**同一次**受保护 batch 里完成。
 *
 * - 未先 sync 就直接领取也能正常工作（计划 2.3「领取与完成可能在同一请求发生」）；
 * - 资源在领取时一次性入账、领取前不占容量，领取后返回完整最新状态与实际结果；
 * - 重复 / 并发领取由 batch 首条守卫 + 条件更新共同兜底，绝不重复发奖；
 * - 守卫冲突时整批回滚：不改资源、不动记录。
 */
export async function claimJourney(
  db: D1Database,
  userId: string,
  journeyId: string,
  now: number,
): Promise<{ state: SectStateView; outcome: JourneyClaimOutcomeView }> {
  const draft = await draftFor(db, userId, now);

  // 库值用于区分「不存在 / 不属于本宗」与「已领取」；跨宗 id 一律 NOT_FOUND（不泄露他人记录）。
  const stored = await new DiscipleJourneyRepository(db).findByIdForSect(journeyId, draft.sect.id);
  if (stored === null) {
    throw new AppError('NOT_FOUND', '历练记录不存在');
  }
  if (stored.claimed_at !== null) {
    throw new AppError('INVALID_STATUS', '该历练收获已领取');
  }
  const journey = draft.openJourneyById(journeyId);
  if (journey === undefined) {
    throw new AppError('INVALID_STATUS', '该历练收获已领取');
  }
  if (journeyStatusOf(journey, now) === 'active') {
    throw new AppError('INVALID_STATUS', '尚未归队，无法领取');
  }

  const resources: Record<string, string> = {};
  for (const [resourceId, amount] of Object.entries(
    parseJourneyRewardResources(journey.reward_resources),
  )) {
    // 只入账「配置里存在、且是安全的非负整数」的资源：
    // 脏数据不该把余额写坏（NaN / 负数都不行），也不该凭空造资源。
    const parsed = Number(amount);
    if (
      draft.config.resources.some((item) => item.id === resourceId) &&
      Number.isSafeInteger(parsed) &&
      parsed > 0
    ) {
      resources[resourceId] = String(parsed);
      draft.grantResource(resourceId, parsed);
    }
  }
  draft.markJourneyClaimed(journey);

  await draft.commitJourneyClaim(
    journeyId,
    draft.journeyReturnedInThisBatch(journey.disciple_id) ? journey.disciple_id : null,
  );

  const direction = asJourneyDirection(journey.direction);
  const directionName = findJourneyDirection(direction).name;
  const injured = Number(journey.injured) === 1;
  const extraHarvest = Number(journey.extra_harvest) === 1;
  const cultivationAwarded = Number(journey.cultivation_awarded ?? 0);
  return {
    state: draft.view(),
    outcome: {
      journeyId: journey.id,
      discipleId: journey.disciple_id,
      discipleName: journey.disciple_name,
      direction,
      directionName,
      cultivationAwarded,
      resources: { ...resources },
      extraHarvest,
      injured,
      injuredUntil: injured
        ? new Date(journeyInjuryUntil(Number(journey.ends_at))).toISOString()
        : null,
      endsAt: new Date(Number(journey.ends_at)).toISOString(),
      message: journeyClaimMessage({
        discipleName: journey.disciple_name,
        directionName,
        cultivationAwarded,
        extraHarvest,
        injured,
      }),
    },
  };
}
/* ------------------------------------------------------------------ *
 * V6：交互式秘境探索（迁移 0015）
 *
 * 与「速通」（exploreSectRealm）并行的第二种玩法：点「探索」后逐个遭遇做选择，由
 * OpenRouter Decisions API 做结构化判定；API 不可用时降级为本地随机（与速通同一套
 * 成功率公式），绝不让玩家卡住。旧的速通路径保持原样不动。
 *
 * 关键取舍：
 * - 奖励不在中途发放，只在**这场探索结束时**（通关 / 失败 / 放弃）一次性入账，
 *   rewards_collected 是运行中的账本；这样一次探索只有一次发奖，也不会出现半截奖励。
 * - 耗时的 Decisions 调用安排在「结算窗口之外」：先只读预检 + 判定，判定完成后再取
 *   新鲜草稿应用结果。否则几秒的等待足以让并发命令推进结算，导致提交守卫整批回滚。
 * ------------------------------------------------------------------ */

/** 低级秘境（宗门 1~3 级可进）的关卡数。 */
export const EXPLORE_STAGES_LOW = 3;
/** 高级秘境（宗门 4 级以上可进）的关卡数。 */
export const EXPLORE_STAGES_HIGH = 5;

/**
 * 奖励倍率矩阵（基点，10000 = ×1.0）。
 * 行 = 选项风险等级，列 = 判定结果。failure 统一为 0。
 */
const REWARD_BP: Record<string, Record<ExploreOutcome, number>> = {
  risky: { great_success: 20_000, success: 12_000, failure: 0 },
  normal: { great_success: 15_000, success: 10_000, failure: 0 },
  safe: { great_success: 8_000, success: 3_000, failure: 0 },
};

/** 弟子受伤时长：与速通一致的 10 分钟。 */
const EXPLORE_INJURY_DURATION_MS = 10 * 60 * 1000;

/** 受伤概率阈值：Decisions 给出的 injury 概率大于它才真的受伤。 */
const EXPLORE_INJURY_THRESHOLD = 0.6;

export type ExploreOutcome = 'great_success' | 'success' | 'failure';

/**
 * 读一个字符串型绑定。
 *
 * `wrangler types` 会把 wrangler.jsonc 的 vars 生成成**字面量类型**（例如 `"false"`），
 * 而运行时可能被 .dev.vars / dashboard 覆盖成别的字符串；这里统一放宽成 string，
 * 避免类型上出现「不可能相等」的假象（与 config/authConfig.ts 的 readVar 同一做法）。
 */
function readStringVar(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** 交互式秘境探索总开关（未显式开启时前端只显示「速通」）。 */
export function realmExploreEnabled(env: Env): boolean {
  return readStringVar(env.REALM_EXPLORE_ENABLED) === 'true';
}

/** 把入库的遭遇 JSON 还原成视图；脏数据返回 null（不让一条坏记录卡死整个 sync）。 */
function encounterViewOf(json: string | null): EncounterView | null {
  if (json === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const rawChoices = Array.isArray(record.choices) ? record.choices : [];
  return {
    name: typeof record.name === 'string' ? record.name : '未知遭遇',
    description: typeof record.description === 'string' ? record.description : '',
    choices: rawChoices.flatMap((item) => {
      if (typeof item !== 'object' || item === null) {
        return [];
      }
      const choice = item as Record<string, unknown>;
      if (typeof choice.id !== 'string' || typeof choice.label !== 'string') {
        return [];
      }
      const risk = choice.risk;
      return [
        {
          id: choice.id,
          label: choice.label,
          riskHint: typeof choice.riskHint === 'string' ? choice.riskHint : '',
          risk:
            risk === 'safe' || risk === 'normal' || risk === 'risky'
              ? risk
              : ('normal' as const),
        },
      ];
    }),
  };
}

/** 遭遇定义 → 入库 JSON（只存展示与选项校验需要的字段，不存难度区间）。 */
function encounterJsonOf(encounter: EncounterDef): string {
  return JSON.stringify({
    id: encounter.id,
    name: encounter.name,
    description: encounter.description,
    choices: encounter.choices.map((choice) => ({
      id: choice.id,
      label: choice.label,
      riskHint: choice.riskHint,
      risk: choice.risk,
    })),
  });
}

/** 解析一个「resourceId -> 数量字符串」JSON；脏数据视为空账本。 */
function rewardsJsonOf(text: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [resourceId, amount] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof amount === 'string' || typeof amount === 'number') {
      out[resourceId] = String(amount);
    }
  }
  return out;
}

/** 解析一个字符串数组 JSON（used_encounters / party 共用）；脏数据视为空数组。 */
function stringArrayOf(text: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter((item): item is string => typeof item === 'string');
}

/** 进行中探索的出战弟子 id（脏数据视为空队伍）。 */
function explorationPartyIds(exploration: RealmExplorationRow | null): string[] {
  return exploration === null ? [] : stringArrayOf(exploration.party);
}

/** 探索记录 → 视图（realm 名从代码定义取；未知 realmId 退化成 id，不伪造名字）。 */
function activeExplorationViewOf(row: RealmExplorationRow): ActiveExplorationView {
  return {
    id: row.id,
    realmId: row.realm_id,
    realmName: findSecretRealm(row.realm_id)?.name ?? row.realm_id,
    totalStages: Number(row.total_stages),
    currentStage: Number(row.current_stage),
    // in_progress 的记录必有当前遭遇；脏数据兜一个空壳（前端继续不下去），好过整个 sync 报错。
    encounter: encounterViewOf(row.current_encounter) ?? {
      name: '未知遭遇',
      description: '',
      choices: [],
    },
    rewardsCollected: rewardsJsonOf(row.rewards_collected),
  };
}

/** 本关基础奖励 = floor(总奖励 / (总关卡数 + 1))，逐资源计算；0 不写入。 */
function stageBaseRewards(
  rewards: Record<string, string>,
  totalStages: number,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [resourceId, amount] of Object.entries(rewards)) {
    const base = Math.floor(Number(amount) / (totalStages + 1));
    if (base > 0) {
      out[resourceId] = String(base);
    }
  }
  return out;
}

/** 按基点倍率放大一份奖励（大成功用）。 */
function scaleRewards(rewards: Record<string, string>, bp: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [resourceId, amount] of Object.entries(rewards)) {
    const value = Math.floor((Number(amount) * bp) / 10_000);
    if (value > 0) {
      out[resourceId] = String(value);
    }
  }
  return out;
}

/** 账本累加（返回新对象，不改入参）。 */
function addRewards(
  ledger: Record<string, string>,
  delta: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = { ...ledger };
  for (const [resourceId, amount] of Object.entries(delta)) {
    out[resourceId] = String(Number(out[resourceId] ?? 0) + Number(amount));
  }
  return out;
}

/**
 * 用模型返回的概率分布做加权随机，而不是直接取最高概率项。
 * 这样"稳妥"选项也有小概率翻车，"冒险"选项也能赌出大成功。
 * 概率分布残缺时返回 null（触发降级）。
 */
function rollFromProbabilities(
  probabilities: Record<string, number> | undefined,
): ExploreOutcome | null {
  if (probabilities === undefined) {
    return null;
  }
  const gs = Number(probabilities.great_success) || 0;
  const su = Number(probabilities.success) || 0;
  const fa = Number(probabilities.failure) || 0;
  const total = gs + su + fa;
  if (total <= 0) {
    return null;
  }
  const roll = Math.random() * total;
  if (roll < gs) {
    return 'great_success';
  }
  if (roll < gs + su) {
    return 'success';
  }
  return 'failure';
}

/** noul 回答收窄到 0~1；非数字返回 null（触发降级）。 */
function normalizeProbability(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.min(1, Math.max(0, value));
}

/** 交给模型的上下文：难度 + 队伍战力 + 遭遇 + 所选行动（纯文本，不含玩家标识）。 */
function powerVsDifficultyHint(power: number, difficulty: number): string {
  const ratio = difficulty > 0 ? power / difficulty : 100;
  if (ratio >= 10) return '实力远超秘境难度，几乎不可能失败';
  if (ratio >= 4) return '实力碾压秘境，成功概率极高';
  if (ratio >= 2) return '实力优势明显，成功概率很高';
  if (ratio >= 1) return '实力与秘境难度相当';
  if (ratio >= 0.5) return '秘境难度高于实力，风险较大';
  return '秘境难度远超实力，极为凶险';
}

function exploreStateText(input: {
  realm: { name: string; difficulty: number };
  encounter: EncounterView;
  choice: { label: string; riskHint: string };
  power: number;
}): string {
  const hint = powerVsDifficultyHint(input.power, input.realm.difficulty);
  return [
    `秘境「${input.realm.name}」，难度 ${String(input.realm.difficulty)}，队伍战力 ${String(input.power)}（${hint}）。`,
    `遭遇：${input.encounter.name}——${input.encounter.description}`,
    `所选行动：${input.choice.label}（${input.choice.riskHint}）`,
  ].join('\n');
}

interface ExploreJudgement {
  outcome: ExploreOutcome;
  injuryProb: number;
  /** true = 走了本地降级路径（Decisions 不可用或返回形状不符）。 */
  degraded: boolean;
}

/**
 * 判定一次选择。
 *
 * 优先走 Decisions API；没有 key、调用失败、超时或返回形状不符时**一律降级**为本地随机
 * （与速通同一套成功率公式），保证玩家永远能继续。降级只记一条 warn，不向玩家泄露。
 */
async function judgeExploreChoice(input: {
  env: Env;
  realm: { id: string; name: string; difficulty: number };
  encounter: EncounterView;
  choice: { id: string; label: string; riskHint: string };
  power: number;
  arenaLevel: number;
}): Promise<ExploreJudgement> {
  const { env, realm, encounter, choice, power, arenaLevel } = input;
  const apiKey = readStringVar(env.OPENROUTER_API_KEY);
  if (apiKey !== undefined && apiKey.length > 0) {
    try {
      const questions: Record<string, Question> = {
        outcome: {
          type: 'choice',
          instructions: '根据队伍实力与所选行动的合理性，判断这次遭遇的结果。',
          criteria: {
            great_success: '实力远超难度，或选择巧妙，完美通过并额外收获',
            success: '顺利通过',
            failure: '实力不足或选择失误，探索失败',
          },
        },
        injury: {
          type: 'noul',
          instructions: '这次遭遇中队伍是否有弟子受伤。',
          criteria: {
            true: '选择冒险，或实力差距导致受伤',
            false: '安全通过，或选择了稳妥方案',
          },
        },
      };
      const answers = await decide(
        apiKey,
        exploreStateText({ realm, encounter, choice, power }),
        questions,
      );
      const outcome = rollFromProbabilities(
        (answers.outcome as ChoiceAnswer | undefined)?.probabilities,
      );
      const injuryProb = normalizeProbability((answers.injury as NoulAnswer | undefined)?.noul);
      if (outcome !== null && injuryProb !== null) {
        return { outcome, injuryProb, degraded: false };
      }
      console.warn(`explore_decisions_unexpected_shape realm=${realm.id}`);
    } catch (error) {
      // 只记原因类别，不打 API key、不打响应体。
      console.warn(
        `explore_decisions_failed realm=${realm.id} reason=${
          error instanceof Error ? error.name : 'unknown'
        }`,
      );
    }
  }

  const chanceBp = explorationSuccessChanceBp(power, realm.difficulty, arenaLevel);
  const roll = Math.floor(Math.random() * 10_000);
  const outcome: ExploreOutcome =
    roll < Math.floor(chanceBp * 0.3) ? 'great_success' : roll < chanceBp ? 'success' : 'failure';
  return { outcome, injuryProb: outcome === 'failure' ? 0.8 : 0.2, degraded: true };
}

/**
 * 受伤判定：概率超过阈值时在本场队伍里随机挑一名**仍在本宗**的弟子受伤 10 分钟。
 * 直接写回草稿（内存 + 语句），并返回视图的一部分；不满足条件返回 null。
 */
function rollExploreInjury(
  injuryProb: number,
  partyIds: readonly string[],
  draft: SectDraft,
  now: number,
): { discipleName: string; until: string } | null {
  if (injuryProb <= EXPLORE_INJURY_THRESHOLD) {
    return null;
  }
  const candidates = draft.disciples.filter((disciple) => partyIds.includes(disciple.id));
  if (candidates.length === 0) {
    return null;
  }
  const target = candidates[Math.floor(Math.random() * candidates.length)];
  if (target === undefined) {
    return null;
  }
  const until = now + EXPLORE_INJURY_DURATION_MS;
  draft.addStatement(updateDiscipleInjuryStatement(target.id, until));
  target.injured_until = until;
  return { discipleName: target.name, until: new Date(until).toISOString() };
}

/** 结果文案（成功 / 大成功 / 失败 / 中途继续），资源用展示单位由前端格式化。 */
function exploreChoiceMessage(input: {
  outcome: ExploreOutcome;
  encounter: EncounterView;
  realmName: string;
  finished: boolean;
  payout: Record<string, string>;
}): string {
  const paidOut = Object.keys(input.payout).length > 0;
  if (input.outcome === 'failure') {
    return paidOut
      ? `在「${input.encounter.name}」上失手，探索就此终止；已获奖励仍然归你。`
      : `在「${input.encounter.name}」上失手，探索就此终止。`;
  }
  if (input.outcome === 'great_success') {
    return input.finished
      ? `大成功突破「${input.encounter.name}」，${input.realmName}的通关奖励已入库。`
      : `大成功！以巧劲化解「${input.encounter.name}」，继续深入。`;
  }
  return input.finished
    ? `顺利走完「${input.encounter.name}」，${input.realmName}通关奖励已入库。`
    : `安然通过「${input.encounter.name}」，继续深入。`;
}
/** 当前进行中的交互探索（GET /game/realm-explore/active）；只读、不结算、不存在返回 null。 */
export async function getActiveExploration(
  db: D1Database,
  userId: string,
  now: number,
): Promise<ActiveExplorationView | null> {
  const snapshot = await loadSnapshot(db, userId, now);
  if (snapshot === null || snapshot.activeExploration === null) {
    return null;
  }
  return activeExplorationViewOf(snapshot.activeExploration);
}

/**
 * 开始交互探索：结算 → 校验（开关 / 秘境 / 等级 / 演武场 / 无进行中探索 / 人数 / 成员）
 * → 每日限次 → 扣入场费 → 抽第 1 关遭遇 → 建记录 + 速通表占坑 → 一次受保护 batch 提交。
 *
 * 每日限次与速通共享同一份 `explorations` 计数（同一张表、同一口径）。
 */
export async function startRealmExplore(
  db: D1Database,
  env: Env,
  userId: string,
  realmId: string,
  discipleIds: string[],
  now: number,
): Promise<{ state: SectStateView; exploration: ActiveExplorationView }> {
  if (!realmExploreEnabled(env)) {
    throw new AppError('INVALID_STATUS', '交互式秘境探索尚未开启');
  }
  const draft = await draftFor(db, userId, now);
  const realm = findSecretRealm(realmId);
  if (realm === undefined) {
    throw new AppError('NOT_FOUND', '秘境不存在');
  }
  if (Number(draft.sect.level) < realm.requiredSectLevel) {
    throw new AppError('INVALID_STATUS', `需要宗门 ${String(realm.requiredSectLevel)} 级才能进入`);
  }
  const arena = draft.buildings.find((building) => building.def_id === ARENA_BUILDING_ID);
  if (realm.requiresArena && arena === undefined) {
    throw new AppError('INVALID_STATUS', '需要先建造演武场');
  }
  if (draft.activeExploration !== null) {
    throw new AppError('INVALID_STATUS', '已有一场进行中的秘境探索');
  }
  if (discipleIds.length < realm.minParty || discipleIds.length > realm.maxParty) {
    throw new AppError('VALIDATION_ERROR', `需要 ${String(realm.minParty)}~${String(realm.maxParty)} 名弟子`);
  }
  if (new Set(discipleIds).size !== discipleIds.length) {
    throw new AppError('VALIDATION_ERROR', '不能派遣重复弟子');
  }
  for (const id of discipleIds) {
    const disciple = draft.discipleById(id);
    requireNotAway(draft, disciple, '出战');
    if (disciple.injured_until !== null && Number(disciple.injured_until) > now) {
      throw new AppError('INVALID_STATUS', `${disciple.name}正在疗伤，无法出战`);
    }
  }
  if (realm.dailyLimit !== null) {
    const used = await new ExplorationRepository(db).countTodayBySectAndRealm(
      draft.sect.id,
      realmId,
      dayStartMs(now),
    );
    if (used >= realm.dailyLimit) {
      throw new AppError(
        'DAILY_LIMIT',
        `今日${realm.name}探索次数已用完（${String(realm.dailyLimit)}次/天）`,
      );
    }
  }
  for (const [resourceId, amount] of Object.entries(realm.entryCost)) {
    draft.requireResource(resourceId, Number(amount));
  }

  const totalStages = realm.requiredSectLevel <= 3 ? EXPLORE_STAGES_LOW : EXPLORE_STAGES_HIGH;
  const first = drawEncounters(realm.difficulty, 1, [])[0];
  if (first === undefined) {
    throw new AppError('INVALID_STATUS', '秘境场景数据缺失，暂时无法探索');
  }

  // 同一个 id 同时作为 realm_explorations 与 explorations 两行的主键：前者存交互进度，
  // 后者只做每日限次统计（开始时占坑 success=0，结束时回填真实结果）。
  const explorationId = crypto.randomUUID();
  const partyJson = JSON.stringify(discipleIds);
  const usedJson = JSON.stringify([first.id]);
  const encounterJson = encounterJsonOf(first);
  draft.activeExploration = {
    id: explorationId,
    sect_id: draft.sect.id,
    realm_id: realmId,
    party: partyJson,
    total_stages: totalStages,
    current_stage: 0,
    status: 'in_progress',
    current_encounter: encounterJson,
    used_encounters: usedJson,
    rewards_collected: '{}',
    created_at: now,
    updated_at: now,
  };
  draft.addStatement(
    insertRealmExplorationStatement({
      id: explorationId,
      sectId: draft.sect.id,
      realmId,
      party: partyJson,
      totalStages,
      currentEncounter: encounterJson,
      usedEncounters: usedJson,
      now,
    }),
  );
  draft.addStatement(
    insertExplorationStatement({
      id: explorationId,
      sectId: draft.sect.id,
      realmId,
      party: partyJson,
      success: false,
      rewards: '{}',
      now,
    }),
  );

  // 开始时不带记录快照（记录是本批刚建的）：并发兜底有两个 —— 0015 的部分唯一索引
  // （一个宗门同时只能有一场 in_progress）与 members 成员归属核对（队伍成员不能被并发抽走）。
  await draft.commitRealmExplore(undefined, discipleIds.map((id) => ({ id })));
  return {
    state: draft.view(),
    exploration: activeExplorationViewOf(draft.activeExploration),
  };
}

/**
 * 提交一次选择（核心命令）。
 *
 * 顺序刻意是「只读预检 → 调用 Decisions（可能数百毫秒~数秒）→ 取新鲜草稿 → 应用 → 受保护提交」：
 * 把慢调用放在结算窗口之外，避免等待期间其他命令推进结算导致守卫整批回滚。
 *
 * 奖励只在整场结束时一次性入账（通关 = 各关累计 + 一关通关奖励；失败 / 放弃 = 已累计部分）。
 */
export async function chooseRealmExplore(
  db: D1Database,
  env: Env,
  userId: string,
  explorationId: string,
  choiceId: string,
  now: number,
): Promise<{ state: SectStateView; result: ExploreChoiceResultView }> {
  // ---- 1. 只读预检（不结算、不写库）----
  const preflight = await loadSnapshot(db, userId, now);
  if (preflight === null) {
    throw new AppError('NOT_FOUND', '尚未创建宗门');
  }
  // 按 id + 本宗查（而不是「当前进行中」那条）：已结束的记录能给出精确的 INVALID_STATUS。
  const row = await new RealmExplorationRepository(db).findByIdForSect(
    explorationId,
    preflight.sect.id,
  );
  if (row === null) {
    throw new AppError('NOT_FOUND', '探索记录不存在');
  }
  if (row.status !== 'in_progress') {
    throw new AppError('INVALID_STATUS', '这场探索已经结束');
  }
  const encounter = encounterViewOf(row.current_encounter);
  if (encounter === null) {
    throw new AppError('INVALID_STATUS', '这场探索已经结束');
  }
  const choice = encounter.choices.find((item) => item.id === choiceId);
  if (choice === undefined) {
    throw new AppError('VALIDATION_ERROR', '选项无效');
  }
  const realm = findSecretRealm(row.realm_id);
  if (realm === undefined) {
    throw new AppError('NOT_FOUND', '秘境不存在');
  }
  const partyIds = explorationPartyIds(row);
  const party = preflight.disciples.filter((disciple) => partyIds.includes(disciple.id));
  const power = partyCombatPower(
    party.map((disciple) => ({
      realmId: disciple.realm_id,
      stage: Number(disciple.stage),
      attack: Number(disciple.attack),
      defense: Number(disciple.defense),
      speed: Number(disciple.speed),
      talent: disciple.talent,
    })),
  );
  const arenaLevel =
    preflight.buildings.find((building) => building.def_id === ARENA_BUILDING_ID)?.level ?? 0;

  // ---- 2. 判定（Decisions；失败 / 超时自动降级为本地随机）----
  const judgement = await judgeExploreChoice({ env, realm, encounter, choice, power, arenaLevel });

  // ---- 3. 判定完成后才取新鲜草稿并应用结果 ----
  const draft = await draftFor(db, userId, now);
  const current = draft.activeExploration;
  if (current === null || current.id !== explorationId || current.status !== 'in_progress') {
    // 等待期间这场探索已被并发结束 / 推进：本批什么都不做，交给前端刷新。
    throw new AppError('INVALID_STATUS', '宗门状态已变化，请刷新后重试');
  }
  // 守卫是本批第一条语句，比较的是**写入前**的库状态 → 必须传读取时的原值。
  const guardRow: RealmExplorationRow = { ...current };

  const totalStages = Number(current.total_stages);
  const stageBase = stageBaseRewards(realm.rewards, totalStages);
  const riskTier = REWARD_BP[choice.risk] ?? REWARD_BP.normal;
  const rewardBp = riskTier[judgement.outcome];
  const stageRewards = rewardBp > 0 ? scaleRewards(stageBase, rewardBp) : {};
  const collectedBefore = rewardsJsonOf(current.rewards_collected);
  const collectedAfter = addRewards(collectedBefore, stageRewards);

  let status = 'in_progress';
  let currentStage = Number(current.current_stage);
  let nextEncounter: string | null = current.current_encounter;
  let usedIds = stringArrayOf(current.used_encounters);
  let ledger = collectedAfter;
  /** 本批真正入账的奖励（只有整场结束时才非空）。 */
  let payout: Record<string, string> = {};
  let finalRewards: Record<string, string> | null = null;
  let injury: { discipleName: string; until: string } | null = null;

  if (judgement.outcome === 'failure') {
    status = 'failed';
    nextEncounter = null;
    ledger = collectedBefore;
    payout = collectedBefore;
  } else if (currentStage + 1 >= totalStages) {
    // 通关：各关累计 + 一关的通关奖励。
    status = 'completed';
    currentStage += 1;
    nextEncounter = null;
    ledger = addRewards(collectedAfter, stageBase);
    payout = ledger;
    finalRewards = ledger;
  } else {
    currentStage += 1;
    const next = drawEncounters(realm.difficulty, 1, usedIds)[0];
    if (next === undefined) {
      // 遭遇池被抽空（理论不可达）：按通关收尾，不让玩家卡在无法继续的状态。
      status = 'completed';
      nextEncounter = null;
      ledger = addRewards(collectedAfter, stageBase);
      payout = ledger;
      finalRewards = ledger;
    } else {
      usedIds = [...usedIds, next.id];
      nextEncounter = encounterJsonOf(next);
    }
  }

  // 受伤判定与 outcome 无关（设计文档 §6.3 第 4 步）：模型给出的 injury 概率
  // 在成功 / 大成功时同样有效 —— 「选正面迎战且判定通过但仍挂了彩」正是把 injury
  // 单独出题的原因；本地降级路径成功时给 0.2，低于阈值，所以只有模型能触发这种情况。
  injury = rollExploreInjury(judgement.injuryProb, partyIds, draft, now);

  const finished = status !== 'in_progress';
  draft.activeExploration = finished
    ? null
    : {
        ...current,
        current_stage: currentStage,
        current_encounter: nextEncounter,
        used_encounters: JSON.stringify(usedIds),
        rewards_collected: JSON.stringify(ledger),
        updated_at: now,
      };

  draft.addStatement(
    updateRealmExplorationStageStatement({
      id: current.id,
      currentStage,
      status,
      currentEncounter: nextEncounter,
      usedEncounters: JSON.stringify(usedIds),
      rewardsCollected: JSON.stringify(ledger),
      now,
    }),
  );
  // 速通表（每日限次口径）只在整场结束时回填真实结果：中段回填会把「本次实际发放」写成
  // 尚未入账的账面数字，语义失真（限次统计只看行数，本来不需要中段写）。
  if (finished) {
    draft.addStatement(
      updateExplorationResultStatement({
        explorationId: current.id,
        sectId: draft.sect.id,
        success: status === 'completed',
        rewards: JSON.stringify(payout),
      }),
    );
  }
  for (const [resourceId, amount] of Object.entries(payout)) {
    draft.grantResource(resourceId, Number(amount));
  }

  await draft.commitRealmExplore(guardRow);

  return {
    state: draft.view(),
    result: {
      outcome: judgement.outcome,
      stageRewards,
      injury,
      nextEncounter: finished ? null : encounterViewOf(nextEncounter),
      finalRewards,
      message: exploreChoiceMessage({
        outcome: judgement.outcome,
        encounter,
        realmName: realm.name,
        finished,
        payout,
      }),
    },
  };
}

/**
 * 放弃探索：已累计的奖励照常入账，记录标记 failed。
 * 与速通一致——放弃 / 失败都不返还入场费。
 */
export async function abandonRealmExplore(
  db: D1Database,
  userId: string,
  explorationId: string,
  now: number,
): Promise<{ state: SectStateView }> {
  const draft = await draftFor(db, userId, now);
  // 按 id + 本宗查（而不是「当前进行中」那条）：已结束的记录能给出精确的 INVALID_STATUS，
  // 而不是含糊的「记录不存在」；跨宗 id 同样落在这里。
  const row = await new RealmExplorationRepository(db).findByIdForSect(
    explorationId,
    draft.sect.id,
  );
  if (row === null) {
    throw new AppError('NOT_FOUND', '探索记录不存在');
  }
  if (row.status !== 'in_progress') {
    throw new AppError('INVALID_STATUS', '这场探索已经结束');
  }
  // 守卫比较的是写入前的库状态 → 传这条读出来的原值。
  const guardRow: RealmExplorationRow = { ...row };
  const ledger = rewardsJsonOf(row.rewards_collected);

  draft.activeExploration = null;
  draft.addStatement(
    updateRealmExplorationStageStatement({
      id: row.id,
      currentStage: Number(row.current_stage),
      status: 'failed',
      currentEncounter: null,
      usedEncounters: row.used_encounters,
      rewardsCollected: JSON.stringify(ledger),
      now,
    }),
  );
  draft.addStatement(
    updateExplorationResultStatement({
      explorationId: row.id,
      sectId: draft.sect.id,
      success: false,
      rewards: JSON.stringify(ledger),
    }),
  );
  for (const [resourceId, amount] of Object.entries(ledger)) {
    draft.grantResource(resourceId, Number(amount));
  }

  await draft.commitRealmExplore(guardRow);
  return { state: draft.view() };
}

/* ---------- 赌坊（0019 迁移 + gambling.ts：论道赌局与悟道值加点） ---------- */

/** 赌坊解锁检查（只在服务端实现；未解锁时 daoDebate 一律 INVALID_STATUS）。 */
function requireGamblingUnlocked(draft: SectDraft): void {
  const reason = gamblingUnlockBlockedReason(Number(draft.sect.level));
  if (reason !== null) {
    throw new AppError('INVALID_STATUS', reason);
  }
}

/** 最小单位 → 展示单位文案（1 展示单位 = 1000 最小单位）；只用于服务端拼好的中文文案。 */
function displayAmount(minUnits: number): string {
  const value = minUnits / 1000;
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

/**
 * 属性扣减后的下限：luck / physique 在 0016 迁移（0018 重建时原样保留）里就带
 * CHECK (1..100)，所以这两项最低保留 1 点 —— 文档 3.3 的「可以扣到 0」对它们不成立，
 * 服务端在写库前挡住，而不是让 CHECK 失败变成一条 500。
 * 其余四项（攻 / 防 / 速 / 资质）仍按文档允许扣到 0。
 */
function attributeFloorOf(attribute: BettableAttribute): number {
  return attribute === 'luck' || attribute === 'physique' ? 1 : 0;
}

/** 弟子六项属性快照（jev 状态文本与侦查文案共用）。 */
function debateAttributesOf(disciple: DiscipleRow): Record<BettableAttribute, number> {
  return {
    attack: Number(disciple.attack),
    defense: Number(disciple.defense),
    speed: Number(disciple.speed),
    aptitude: Number(disciple.aptitude),
    luck: Number(disciple.luck),
    physique: Number(disciple.physique),
  };
}

/**
 * 论道的 jev 状态文本：双方六项属性，不含战力/天赋/倍率等额外信息，
 * 让模型纯粹按数值对比分类。
 */
function debateStateText(
  disciple: DiscipleRow,
  opponent: Record<BettableAttribute, number>,
): string {
  const attrs = debateAttributesOf(disciple);
  return [
    `弟子：攻击${String(attrs.attack)} 防御${String(attrs.defense)} ` +
      `速度${String(attrs.speed)} 资质${String(attrs.aptitude)} 幸运${String(attrs.luck)} ` +
      `体魄${String(attrs.physique)}`,
    `对手：攻击${String(opponent.attack)} 防御${String(opponent.defense)} ` +
      `速度${String(opponent.speed)} 资质${String(opponent.aptitude)} 幸运${String(opponent.luck)} ` +
      `体魄${String(opponent.physique)}`,
  ].join('\n');
}

/** 胜率判定结果：probability 是实际掷骰用的胜率，raw 是档位映射后的原始胜率（降级为 null）。 */
interface DebateJudgement {
  probability: number;
  raw: number | null;
}

/**
 * 判定一次论道的胜率（计划 4.2~4.4）。
 *
 * 发一个 choice 问题（五档分类），用各档概率加权映射成最终胜率，
 * 再用倍率锚 clamp 防止不同倍率的胜率趋同。
 * 没有 key、调用失败 / 超时 / 返回形状不符时
 * **一律降级**为本地固定胜率 DEGRADED_WIN_RATES，保证玩家永远能继续。
 */
async function judgeDebateOutcome(input: {
  env: Env;
  disciple: DiscipleRow;
  multiplier: Multiplier;
  opponent: Record<BettableAttribute, number>;
}): Promise<DebateJudgement> {
  const apiKey = readStringVar(input.env.OPENROUTER_API_KEY);
  if (apiKey !== undefined && apiKey.length > 0) {
    try {
      const questions: Record<string, Question> = {
        win: {
          type: 'choice',
          instructions: '根据双方六项属性的具体数值对比，判断弟子相对于对手的综合实力档位。',
          criteria: {
            disciple_clear: '弟子在多数属性上更高，或少数属性大幅领先',
            disciple_slight: '弟子总体略高，但差距不大',
            even: '双方互有高低、总体相当',
            opponent_slight: '对手总体略高，但差距不大',
            opponent_clear: '对手在多数属性上更高，或少数属性大幅领先',
          },
        },
      };
      const answers = await decide(
        apiKey,
        debateStateText(input.disciple, input.opponent),
        questions,
      );
      const answer = answers.win as ChoiceAnswer | undefined;
      const probability = debateTierProbability(answer?.probabilities, input.multiplier);
      if (probability !== null) {
        return { probability, raw: probability };
      }
      console.warn(`gambling_decisions_unexpected_shape disciple=${input.disciple.id}`);
    } catch (error) {
      console.warn(
        `gambling_decisions_failed disciple=${input.disciple.id} reason=${
          error instanceof Error ? error.name : 'unknown'
        }`,
      );
    }
  }
  return { probability: DEGRADED_WIN_RATES[input.multiplier] / 10_000, raw: null };
}

/** 赌注方案：三种模式在校验后各自收窄，发奖/扣减时不必再判 betMode 字符串。 */
type DebatePlan =
  | {
      mode: 'preset_spirit_stone';
      /** 赢什么：灵石（resource）或悟道值（insight）。 */
      rewardType: 'resource' | 'insight';
      /** 赌注额（最小单位）。 */
      stake: number;
      stakeDescription: string;
    }
  | {
      mode: 'free_resource';
      resourceId: BettableResource;
      /** 玩家输入的原始数量（赢奖按它 × 倍率 × 1.8 计算）。 */
      amount: number;
      /** 实际赌注 = 输入数量 × 倍率。 */
      stake: number;
      stakeDescription: string;
    }
  | {
      mode: 'attribute';
      attribute: BettableAttribute;
      /** 赌注点数。 */
      stake: number;
      stakeDescription: string;
    };

/** 写入 dao_debate_log.reward_detail 的 JSON（'none' = 败北无奖励）。 */
type DebateRewardDetail =
  | { type: 'resource'; resourceId: string; amount: string }
  | { type: 'insight'; insight: number }
  | { type: 'none' };

/**
 * 论道赌局（POST /game/dao-debate）。
 *
 * 与其它写命令同一套路：结算 → 解锁 / 次数 / 弟子 / 赌注校验（全部只读，不产生写入）
 * → jev 判定胜率（失败降级）→ 掷骰 → 发奖或扣赌注 → 计数 + 记录
 * → **一次**受保护 batch 提交（守卫 + 结算写回 + 全部命令写入）。
 */
export async function daoDebate(
  db: D1Database,
  userId: string,
  input: {
    discipleId: string;
    betMode: BetMode;
    multiplier: Multiplier;
    /** 模式 A：赢什么（'resource' = 灵石，'insight' = 悟道值）。 */
    rewardType?: 'resource' | 'insight';
    /** 模式 B：押哪种资源（白名单在 gambling.ts 的 BETTABLE_RESOURCES）。 */
    resourceId?: string;
    /** 模式 B：押多少（最小单位，>= FREE_BET_MIN）。 */
    amount?: number;
    /** 模式 C：押哪项属性。 */
    attribute?: BettableAttribute;
  },
  now: number,
  env: Env,
): Promise<{ state: SectStateView; result: DaoDebateResultView }> {
  const draft = await draftFor(db, userId, now);
  requireGamblingUnlocked(draft);

  // 每日次数（UTC+8 归一在 gambling.ts 的 debateDayStateOf 里完成）。
  const day = draft.debateDay;
  if (day.remaining <= 0) {
    throw new AppError(
      'DAILY_LIMIT',
      `今日赌坊次数已用完（论道与天机轮共 ${String(DEBATE_DAILY_LIMIT)} 次/天）`,
    );
  }

  // 出战弟子：属于本宗、不在外历练、不在疗伤（与挑战同一口径）。
  const disciple = draft.discipleById(input.discipleId);
  requireNotAway(draft, disciple, '论道');
  if (disciple.injured_until !== null && Number(disciple.injured_until) > now) {
    throw new AppError('INVALID_STATUS', `${disciple.name}正在疗伤，无法参加论道`);
  }

  const multiplier = input.multiplier;
  let plan: DebatePlan;
  if (input.betMode === 'preset_spirit_stone') {
    // 模式 A：固定档位灵石赌注，赢可以选灵石或悟道值。
    const rewardType = input.rewardType;
    if (rewardType !== 'resource' && rewardType !== 'insight') {
      throw new AppError('VALIDATION_ERROR', '请选择论道胜出后的奖励类型');
    }
    const stake = PRESET_STAKES[multiplier];
    draft.requireResourceAvailable('spiritStone', stake);
    plan = {
      mode: 'preset_spirit_stone',
      rewardType,
      stake,
      stakeDescription: `灵石 ${displayAmount(stake)}`,
    };
  } else if (input.betMode === 'free_resource') {
    // 模式 B：自由输入资源数量（只能赢资源），实际赌注 = 输入 × 倍率。
    const resourceId = input.resourceId ?? '';
    if (!isBettableResource(resourceId)) {
      throw new AppError('VALIDATION_ERROR', '可押注的资源只有灵石、药材与矿石');
    }
    const amount = input.amount ?? 0;
    if (!Number.isInteger(amount) || amount < FREE_BET_MIN) {
      throw new AppError(
        'VALIDATION_ERROR',
        `自由押注至少 ${displayAmount(FREE_BET_MIN)} ${draft.resourceName(resourceId)}`,
      );
    }
    const stake = freeBetStake(amount, multiplier);
    draft.requireResourceAvailable(resourceId, stake);
    plan = {
      mode: 'free_resource',
      resourceId,
      amount,
      stake,
      stakeDescription: `${draft.resourceName(resourceId)} ${displayAmount(stake)}`,
    };
  } else {
    // 模式 C：以弟子属性点为赌注（只能赢悟道值）。
    const attribute = input.attribute;
    if (attribute === undefined) {
      throw new AppError('VALIDATION_ERROR', '请选择要押注的属性');
    }
    const stake = ATTRIBUTE_STAKES[multiplier];
    const current = Number(disciple[attribute]);
    if (current < stake) {
      throw new AppError(
        'INVALID_STATUS',
        `${disciple.name}的${ATTRIBUTE_LABELS[attribute]}只有 ${String(current)} 点，不足以押 ${String(stake)} 点`,
      );
    }
    const floor = attributeFloorOf(attribute);
    if (current - stake < floor) {
      throw new AppError(
        'INVALID_STATUS',
        `${disciple.name}的${ATTRIBUTE_LABELS[attribute]}押 ${String(stake)} 点会跌破下限 ${String(floor)} 点（该项最低保留 ${String(floor)} 点）`,
      );
    }
    plan = {
      mode: 'attribute',
      attribute,
      stake,
      stakeDescription: `${ATTRIBUTE_LABELS[attribute]} ${String(stake)} 点`,
    };
  }

  const attrs = debateAttributesOf(disciple);
  const revealHints = generateRevealHints(attrs, multiplier, Number(disciple.luck));
  const opponent = generateOpponentAttrs(attrs, multiplier);

  // 胜率判定（jev 或降级）→ 掷骰。Math.random 只在服务端用一次。
  const judgement = await judgeDebateOutcome({ env, disciple, multiplier, opponent });
  const result: 'win' | 'lose' = Math.random() < judgement.probability ? 'win' : 'lose';

  // 结算：赢 → 发奖（赌注原封不动）；输 → 扣赌注（资源或属性点）。
  let rewardDetail: DebateRewardDetail;
  let rewardDescription: string;
  if (result === 'win') {
    if (plan.mode === 'preset_spirit_stone' && plan.rewardType === 'insight') {
      const gain = PRESET_INSIGHT_REWARDS[multiplier];
      const nextInsight = Number(disciple.dao_insight) + gain;
      disciple.dao_insight = nextInsight;
      draft.addStatement(
        updateDiscipleDaoInsightStatement(disciple.id, nextInsight, Number(disciple.dao_insight_used)),
      );
      rewardDetail = { type: 'insight', insight: gain };
      rewardDescription = `悟道值 +${String(gain)}`;
    } else if (plan.mode === 'free_resource') {
      const gain = freeBetReward(plan.amount, multiplier);
      draft.grantResource(plan.resourceId, gain);
      rewardDetail = { type: 'resource', resourceId: plan.resourceId, amount: String(gain) };
      rewardDescription = `${draft.resourceName(plan.resourceId)} +${displayAmount(gain)}`;
    } else if (plan.mode === 'attribute') {
      const gain = ATTRIBUTE_INSIGHT_REWARDS[multiplier];
      const nextInsight = Number(disciple.dao_insight) + gain;
      disciple.dao_insight = nextInsight;
      draft.addStatement(
        updateDiscipleDaoInsightStatement(disciple.id, nextInsight, Number(disciple.dao_insight_used)),
      );
      rewardDetail = { type: 'insight', insight: gain };
      rewardDescription = `悟道值 +${String(gain)}`;
    } else {
      // 模式 A + 灵石奖励。
      const gain = PRESET_RESOURCE_REWARDS[multiplier];
      draft.grantResource('spiritStone', gain);
      rewardDetail = { type: 'resource', resourceId: 'spiritStone', amount: String(gain) };
      rewardDescription = `灵石 +${displayAmount(gain)}`;
    }
  } else if (plan.mode === 'attribute') {
    const nextValue = Math.max(
      attributeFloorOf(plan.attribute),
      Number(disciple[plan.attribute]) - plan.stake,
    );
    disciple[plan.attribute] = nextValue;
    draft.addStatement(
      updateDiscipleAttributeStatement(disciple.id, plan.attribute, nextValue),
    );
    rewardDetail = { type: 'none' };
    rewardDescription = '无';
  } else {
    draft.requireResource(plan.mode === 'free_resource' ? plan.resourceId : 'spiritStone', plan.stake);
    rewardDetail = { type: 'none' };
    rewardDescription = '无';
  }

  // 计数写回：日期键归一到今天、计数 = 已用 + 1（内存同步，返回的 state 就是新值）。
  const usedAfter = day.usedToday + 1;
  draft.addStatement(updateSectDebateCounterStatement(draft.sect.id, day.dateKey, usedAfter));
  draft.sect.debate_date_key = day.dateKey;
  draft.sect.debate_count = usedAfter;

  // 论道记录（赌注与奖励详情是当场快照 JSON；胜率记 jev 原值，降级为 null）。
  const stakeDetail =
    plan.mode === 'attribute'
      ? { attribute: plan.attribute, points: plan.stake }
      : { resourceId: plan.mode === 'free_resource' ? plan.resourceId : 'spiritStone', amount: String(plan.stake) };
  draft.addStatement(
    insertDaoDebateLogStatement({
      id: crypto.randomUUID(),
      sectId: draft.sect.id,
      discipleId: disciple.id,
      discipleName: disciple.name,
      betMode: plan.mode,
      multiplier,
      stakeDetail: JSON.stringify(stakeDetail),
      result,
      rewardDetail: JSON.stringify(rewardDetail),
      winProbability: judgement.raw,
      now,
    }),
  );

  // 唯一的一次受保护提交：守卫 + 结算 + 资源/属性/悟道值 + 计数 + 记录同一个 batch。
  await draft.commitGambling({
    resourceId:
      plan.mode === 'attribute' ? null : plan.mode === 'free_resource' ? plan.resourceId : 'spiritStone',
    // 论道一定带上弟子：赢悟道值会写回弟子行，守卫必须核对该行（见 commitGambling 注释）。
    discipleId: disciple.id,
    ...(plan.mode === 'attribute' ? { attribute: plan.attribute } : {}),
    rejectAway: true,
  });
  draft.debateDay = {
    ...day,
    usedToday: usedAfter,
    remaining: Math.max(0, DEBATE_DAILY_LIMIT - usedAfter),
  };

  if (multiplier === 3 && result === 'win') {
    try {
      await broadcastSystemMessage(
        db,
        `${draft.sect.name}在论道赌局中获得3x奖励：${rewardDescription}`,
        now,
      );
    } catch { /* 广播失败不影响主流程 */ }
  }

  const message =
    result === 'win'
      ? `论道胜出：${disciple.name}击败了${MULTIPLIER_HINTS[multiplier]}，赢得${rewardDescription}（今日还剩 ${String(draft.debateDay.remaining)} 次）`
      : `论道落败：${disciple.name}不敌${MULTIPLIER_HINTS[multiplier]}，损失${plan.stakeDescription}（今日还剩 ${String(draft.debateDay.remaining)} 次）`;

  return {
    state: draft.view(),
    result: {
      discipleId: disciple.id,
      discipleName: disciple.name,
      betMode: plan.mode,
      multiplier,
      result,
      stakeDescription: plan.stakeDescription,
      rewardDescription,
      revealHints,
      opponent,
      discipleAttributes: attrs,
      winProbability: judgement.raw,
      message,
    },
  };
}

/**
 * 悟道值加点（POST /game/allocate-dao-insight，计划 7.2）。
 *
 * 1 悟道值 = 1 属性点，属性上限 100，每个弟子累计分配上限 DAO_INSIGHT_CAP。
 * 悟道值是已得资产，所以**不要求**赌坊解锁、也不限制在外历练的弟子；
 * 属性 + 余额 + 累计三项一次写完（同一 batch，带快照守卫）。
 */
export async function allocateDaoInsight(
  db: D1Database,
  userId: string,
  discipleId: string,
  attribute: BettableAttribute,
  points: number,
  now: number,
): Promise<{ state: SectStateView; outcome: InsightAllocateOutcome }> {
  const draft = await draftFor(db, userId, now);
  const disciple = draft.discipleById(discipleId);

  if (!Number.isInteger(points) || points < 1) {
    throw new AppError('VALIDATION_ERROR', '每次至少要分配 1 点悟道值');
  }
  const insight = Number(disciple.dao_insight);
  if (insight < points) {
    throw new AppError(
      'INVALID_STATUS',
      `${disciple.name}的悟道值不足（可用 ${String(insight)} 点）`,
    );
  }
  const used = Number(disciple.dao_insight_used);
  if (used + points > DAO_INSIGHT_CAP) {
    throw new AppError(
      'INVALID_STATUS',
      `${disciple.name}已累计分配 ${String(used)}/${String(DAO_INSIGHT_CAP)} 点悟道值，本次最多再分配 ${String(Math.max(0, DAO_INSIGHT_CAP - used))} 点`,
    );
  }
  const current = Number(disciple[attribute]);
  if (current + points > ATTRIBUTE_MAX) {
    throw new AppError(
      'INVALID_STATUS',
      `${disciple.name}的${ATTRIBUTE_LABELS[attribute]}已达 ${String(ATTRIBUTE_MAX)} 上限，本次最多再加 ${String(Math.max(0, ATTRIBUTE_MAX - current))} 点`,
    );
  }

  const newValue = current + points;
  const nextInsight = insight - points;
  const nextUsed = used + points;
  disciple[attribute] = newValue;
  disciple.dao_insight = nextInsight;
  disciple.dao_insight_used = nextUsed;
  draft.addStatement(
    updateDiscipleInsightAllocateStatement(disciple.id, attribute, newValue, nextInsight, nextUsed),
  );

  await draft.commitGambling({ resourceId: null, discipleId: disciple.id, attribute });

  return {
    state: draft.view(),
    outcome: {
      discipleId: disciple.id,
      discipleName: disciple.name,
      attribute,
      points,
      newValue,
      remainingInsight: nextInsight,
      totalUsed: nextUsed,
    },
  };
}

/* ---------- 天机轮（0020 迁移 + gambling.ts 的转盘规则） ---------- */

/**
 * 天机轮记录写进 dao_debate_log.disciple_name 的展示名（0020 迁移的约定）：
 * 转盘没有出战弟子，但两列仍是 0019 的 NOT NULL —— 所以 disciple_id 记空串、
 * disciple_name 记「天机轮」，赌坊记录列表照旧直接渲染这一列，不必为转盘单开分支。
 */
const WHEEL_LOG_NAME = '天机轮';

/**
 * 本宗当前的转盘格局（0020）：由 sect_id + wheel_seed 确定性生成。
 * 与 view.ts 的 buildWheelView 是同一个 seed 口径 —— 玩家界面上看到的转盘，
 * 就是这里转动用的那张转盘（服务端不存格位，也不需要存）。
 */
function draftWheelSlots(draft: SectDraft): WheelSlot[] {
  return generateWheelSlots(wheelLayoutSeed(draft.sect.id, Number(draft.sect.wheel_seed) || 0, draft.debateDay.dateKey));
}

/** 格面与奖励文案要用的名字表：资源名取自配置、丹药名取自 alchemy.ts（各只有一份）。 */
function wheelNamesOf(draft: SectDraft): {
  resource: (resourceId: string) => string;
  pill: (pillId: string) => string;
} {
  return {
    resource: (resourceId: string) => draft.resourceName(resourceId),
    pill: (pillId: string) => findPillRecipe(pillId)?.name ?? pillId,
  };
}

/**
 * 天机轮转动（POST /game/wheel-spin，计划 4.2 / 6.2）。
 *
 * 与其它写命令同一套路：结算 → 解锁 / 次数 / 余额校验（全部只读）→ 服务端按格局选格并结算奖励
 * → 扣费、发奖、计数、记录 → **一次**受保护 batch 提交。
 *
 * 落格用一次 Math.random（随机在服务端）；格局本身完全由 seed 决定 ——
 * 前端不参与任何判定，只拿 slotIndex 把转盘转到对应角度。
 */
export async function wheelSpin(
  db: D1Database,
  userId: string,
  tier: WheelTier,
  now: number,
): Promise<{ state: SectStateView; result: WheelSpinResultView }> {
  const draft = await draftFor(db, userId, now);
  requireGamblingUnlocked(draft);

  // 每日次数：与论道共享同一个计数列（计划 2.5），用满 20 次后两个玩法一起关闭。
  const day = draft.debateDay;
  if (day.remaining <= 0) {
    throw new AppError(
      'DAILY_LIMIT',
      `今日赌坊次数已用完（论道与天机轮共 ${String(DEBATE_DAILY_LIMIT)} 次/天）`,
    );
  }

  // 费用 = 1x 档费用 × 档位（1x→展示 50 … 5x→展示 250）。
  const cost = wheelSpinCost(tier);
  draft.requireResourceAvailable('spiritStone', cost);

  const slots = draftWheelSlots(draft);
  const slotIndex = wheelWeightedPick(slots, Math.random());
  const slot = slots[slotIndex]!;
  const reward = wheelReward(slot, tier, cost);
  const names = wheelNamesOf(draft);
  const slotLabel = wheelSlotLabel(slot, names);

  // 校验全部通过后才真正扣费（与论道同一顺序：先只读检查、后写），语句与内存一起改。
  draft.requireResource('spiritStone', cost);
  // 丹药发奖是「快照 + 数量」的绝对值 upsert，先记下这条库存的当前数量交给守卫核对，
  // 否则并发的炼制 / 服用会被这一批静默覆盖。
  let pillSnapshot: { pillId: string; quantity: number } | null = null;
  if (reward.type === 'resource') {
    draft.grantResource(reward.resourceId, Number(reward.amount));
  } else if (reward.type === 'pill') {
    pillSnapshot = { pillId: reward.pillId, quantity: draft.pillQuantity(reward.pillId) };
    draft.addPill(reward.pillId, reward.quantity);
  }

  // 计数写回：日期键归一到今天、计数 = 已用 + 1（内存同步，返回的 state 就是新值）。
  const usedAfter = day.usedToday + 1;
  draft.addStatement(updateSectDebateCounterStatement(draft.sect.id, day.dateKey, usedAfter));
  draft.sect.debate_date_key = day.dateKey;
  draft.sect.debate_count = usedAfter;

  // 天机轮记录：multiplier 存投入档位（0020 迁移已把 CHECK 放宽到 1~5）；
  // 转盘不用 jev，所以 win_probability 恒为 null；谢谢惠顾算 lose（计划 3.2）。
  draft.addStatement(
    insertDaoDebateLogStatement({
      id: crypto.randomUUID(),
      sectId: draft.sect.id,
      discipleId: '',
      discipleName: WHEEL_LOG_NAME,
      betMode: 'wheel',
      multiplier: tier,
      stakeDetail: JSON.stringify({ amount: String(cost) }),
      result: reward.type === 'none' ? 'lose' : 'win',
      rewardDetail: JSON.stringify(reward),
      winProbability: null,
      now,
    }),
  );

  // 唯一的一次受保护提交：守卫（含 wheel_seed）+ 结算 + 扣费 / 发奖 + 计数 + 记录同一个 batch。
  // checkWheelSeed：格局被重置过就说明这一转的依据已经不存在，乐观锁拒绝并整批回滚。
  await draft.commitGambling({
    resourceId: 'spiritStone',
    ...(pillSnapshot === null ? {} : { pill: pillSnapshot }),
    checkWheelSeed: true,
  });

  draft.debateDay = {
    ...day,
    usedToday: usedAfter,
    remaining: Math.max(0, DEBATE_DAILY_LIMIT - usedAfter),
  };

  if (tier === 5 && slot.type === 'big_spirit_stone' && reward.type === 'resource') {
    try {
      await broadcastSystemMessage(
        db,
        `${draft.sect.name}在天机轮中获得5x大额灵石奖励：${displayAmount(Number(reward.amount))}灵石`,
        now,
      );
    } catch { /* 广播失败不影响主流程 */ }
  }

  const rewardDescription =
    reward.type === 'resource'
      ? `${names.resource(reward.resourceId)} +${displayAmount(Number(reward.amount))}`
      : reward.type === 'pill'
        ? `${names.pill(reward.pillId)} ×${String(reward.quantity)}`
        : '无奖励';
  const message =
    reward.type === 'none'
      ? `天机轮停在了「${slotLabel}」：投入 ${displayAmount(cost)} 灵石，这次没有收获（今日还剩 ${String(draft.debateDay.remaining)} 次）`
      : `天机轮停在了「${slotLabel}」：投入 ${displayAmount(cost)} 灵石，赢得${rewardDescription}（今日还剩 ${String(draft.debateDay.remaining)} 次）`;

  return {
    state: draft.view(),
    result: {
      slotIndex,
      tier,
      cost: String(cost),
      slotLabel,
      reward:
        reward.type === 'resource'
          ? { type: 'resource', resourceId: reward.resourceId, amount: reward.amount }
          : reward.type === 'pill'
            ? {
                type: 'pill',
                pillId: reward.pillId,
                pillName: names.pill(reward.pillId),
                quantity: reward.quantity,
              }
            : { type: 'none' },
      message,
    },
  };
}

/**
 * 天机轮重置（POST /game/wheel-reset，计划 4.3 / 6.2）。
 *
 * 花 WHEEL_RESET_COST（展示 100）灵石换一次整盘重排：wheel_seed + 1 → 格局的类型与倍率
 * 全部重新随机（格局是 seed 的函数，seed 一变整盘就变）。
 * 不消耗每日次数、不限次数：有灵石就能重置（计划 2.4）。
 */
export async function wheelReset(
  db: D1Database,
  userId: string,
  now: number,
): Promise<{ state: SectStateView }> {
  const draft = await draftFor(db, userId, now);
  requireGamblingUnlocked(draft);

  // requireResource 同时完成检查与扣减（不足时抛 INSUFFICIENT_RESOURCE，带缺少数量）。
  draft.requireResource('spiritStone', WHEEL_RESET_COST);

  const nextSeed = (Number(draft.sect.wheel_seed) || 0) + 1;
  draft.addStatement(updateSectWheelSeedStatement(draft.sect.id, nextSeed));
  draft.sect.wheel_seed = nextSeed;

  // checkWheelSeed：并发的两次重置只能成功一次，不会出现「扣两次费、种子只 +1」。
  await draft.commitGambling({ resourceId: 'spiritStone', checkWheelSeed: true });

  return { state: draft.view() };
}

/**
 * 灵兽竞逐：获取当前轮次状态（GET /game/race-state）。
 */
export async function getRaceState(
  db: D1Database,
  userId: string,
  now: number,
): Promise<{ state: SectStateView; race: RaceStateView }> {
  const draft = await draftFor(db, userId, now);
  const raceView = await buildRaceStateView(db, draft.sect.id, now);
  return { state: draft.view(), race: raceView };
}

async function buildRaceStateView(
  db: D1Database,
  sectId: string,
  now: number,
): Promise<RaceStateView> {
  const phaseInfo = racePhaseOf(now);

  if (phaseInfo.phase === 'closed') {
    return {
      roundKey: phaseInfo.roundKey,
      phase: 'closed',
      remainingSeconds: Math.ceil(phaseInfo.remainingMs / 1000),
      beasts: BEAST_NAMES.map((name, i) => ({
        index: i, name, weight: 0, winRate: 0, pool: '0', odds: 0,
      })),
      totalPool: '0',
      myBets: [],
      myTotalBet: '0',
      winnerIndex: null,
      ranks: null,
      steps: null,
      myWinnings: null,
      betFeed: [],
    };
  }

  const repo = new RaceRepository(db);
  const round = await repo.findRoundByKey(phaseInfo.roundKey);

  if (round === null) {
    const weights = beastWeightsFromRoundKey(phaseInfo.roundKey);
    const totalW = weights.reduce((s, w) => s + w, 0);
    return {
      roundKey: phaseInfo.roundKey,
      phase: phaseInfo.phase === 'sealed' ? 'settled' : phaseInfo.phase,
      remainingSeconds: Math.ceil(phaseInfo.remainingMs / 1000),
      beasts: weights.map((w, i) => ({
        index: i, name: beastNameAt(i), weight: w, winRate: totalW > 0 ? w / totalW : 0,
        pool: '0', odds: raceFixedOdds(w, totalW),
      })),
      totalPool: '0',
      myBets: [],
      myTotalBet: '0',
      winnerIndex: null,
      ranks: null,
      steps: null,
      myWinnings: null,
      betFeed: [],
    };
  }

  const weights: number[] = JSON.parse(round.beast_weights) as number[];
  const totalW = weights.reduce((s, w) => s + w, 0);
  const pools = await repo.beastPoolsByRound(round.id);
  const poolMap = new Map(pools.map((p) => [p.beast_index, p.total]));
  const totalPool = round.total_pool;

  const beasts: RaceBeastView[] = weights.map((w, i) => {
    const pool = poolMap.get(i) ?? 0;
    return {
      index: i, name: beastNameAt(i), weight: w,
      winRate: totalW > 0 ? w / totalW : 0,
      pool: String(pool),
      odds: raceFixedOdds(w, totalW),
    };
  });

  const [myBetRows, feedRows] = await Promise.all([
    repo.betsByRoundAndSect(round.id, sectId),
    repo.betFeedByRound(round.id),
  ]);
  const myBets: RaceMyBetView[] = myBetRows.map((b) => ({
    beastIndex: b.beast_index,
    beastName: beastNameAt(b.beast_index),
    amount: String(b.amount),
  }));
  const myTotalBet = myBetRows.reduce((s, b) => s + b.amount, 0);
  const betFeed: RaceBetFeedView[] = feedRows.map((r) => ({
    sectName: r.sect_name,
    beastIndex: r.beast_index,
    beastName: beastNameAt(r.beast_index),
    amount: String(r.amount),
  }));

  let winnerIndex: number | null = null;
  let ranks: number[] | null = null;
  let steps: number[][] | null = null;
  let myWinnings: string | null = null;
  let phase: 'betting' | 'sealed' | 'settled' = phaseInfo.phase as 'betting' | 'sealed';

  if (round.status === 'settled') {
    phase = 'settled';
    winnerIndex = round.winner_index;
    if (winnerIndex !== null) {
      ranks = raceRanksOf(weights, winnerIndex, raceRankRandomOf(round.round_key));
      steps = generateRaceSteps(ranks);
      const winnerW = weights[winnerIndex] ?? 1;
      const odds = raceFixedOdds(winnerW, totalW);
      let myWin = 0;
      for (const bet of myBetRows) {
        if (bet.beast_index === winnerIndex) {
          myWin += Math.floor(bet.amount * odds + 1e-6);
        }
      }
      myWinnings = String(myWin);
    }
  }

  return {
    roundKey: phaseInfo.roundKey,
    phase,
    remainingSeconds: Math.ceil(phaseInfo.remainingMs / 1000),
    beasts,
    totalPool: String(totalPool),
    myBets,
    myTotalBet: String(myTotalBet),
    winnerIndex,
    ranks,
    steps,
    myWinnings,
    betFeed,
  };
}

/**
 * 0024 灵兽竞逐：下注（POST /game/race-bet）。
 */
export async function placeRaceBet(
  db: D1Database,
  userId: string,
  input: { beastIndex: number; betAmount: number },
  now: number,
): Promise<{ state: SectStateView; race: RaceStateView }> {
  const draft = await draftFor(db, userId, now);
  requireGamblingUnlocked(draft);

  if (!isRaceOperatingHour(now)) {
    throw new AppError('VALIDATION_ERROR', '灵兽竞逐仅在每日 8:00–23:00（UTC+8）开放');
  }

  const phaseInfo = racePhaseOf(now);
  if (phaseInfo.phase !== 'betting') {
    throw new AppError('VALIDATION_ERROR', '当前已封盘，请等待下一轮');
  }

  if (input.beastIndex < 0 || input.beastIndex >= RACE_BEAST_COUNT) {
    throw new AppError('VALIDATION_ERROR', '没有这只灵兽', { beastIndex: input.beastIndex });
  }
  if (input.betAmount < RACE_BET_MIN || input.betAmount > RACE_BET_MAX) {
    throw new AppError(
      'VALIDATION_ERROR',
      `赌注需要在 ${displayAmount(RACE_BET_MIN)} ~ ${displayAmount(RACE_BET_MAX)} 灵石之间`,
      { min: RACE_BET_MIN, max: RACE_BET_MAX },
    );
  }

  draft.requireResourceAvailable('spiritStone', input.betAmount);

  const repo = new RaceRepository(db);
  let round = await repo.findRoundByKey(phaseInfo.roundKey);

  if (round === null) {
    const weights = beastWeightsFromRoundKey(phaseInfo.roundKey);
    const roundId = crypto.randomUUID();
    await repo.execute(insertRaceRoundStatement({
      id: roundId,
      roundKey: phaseInfo.roundKey,
      beastWeights: JSON.stringify(weights),
      now,
    }));
    round = { id: roundId, round_key: phaseInfo.roundKey, beast_weights: JSON.stringify(weights), status: 'betting', winner_index: null, total_pool: 0, settled_at: null, created_at: now };
  }

  if (round.status !== 'betting') {
    throw new AppError('VALIDATION_ERROR', '当前已封盘，请等待下一轮');
  }

  const isFirstBet = !(await repo.hasBetInRound(round.id, draft.sect.id));

  if (isFirstBet) {
    const day = draft.debateDay;
    if (day.remaining <= 0) {
      throw new AppError(
        'DAILY_LIMIT',
        `今日赌坊次数已用完（论道、天机轮与灵兽竞逐共 ${String(DEBATE_DAILY_LIMIT)} 次/天）`,
      );
    }
    const usedAfter = day.usedToday + 1;
    draft.addStatement(updateSectDebateCounterStatement(draft.sect.id, day.dateKey, usedAfter));
    draft.sect.debate_date_key = day.dateKey;
    draft.sect.debate_count = usedAfter;
    draft.debateDay = {
      ...day,
      usedToday: usedAfter,
      remaining: Math.max(0, DEBATE_DAILY_LIMIT - usedAfter),
    };
  }

  draft.requireResource('spiritStone', input.betAmount);

  draft.addStatement(insertRaceBetStatement({
    id: crypto.randomUUID(),
    roundId: round.id,
    sectId: draft.sect.id,
    beastIndex: input.beastIndex,
    amount: input.betAmount,
    now,
  }));
  draft.addStatement(updateRaceRoundPoolStatement(round.id, input.betAmount));

  await draft.commitGambling({ resourceId: 'spiritStone' });

  const raceView = await buildRaceStateView(db, draft.sect.id, now);
  return { state: draft.view(), race: raceView };
}

/**
 * 0024 灵兽竞逐：结算当前应结算的轮次（Cron Trigger 调用）。
 *
 * 找到所有 status='betting' 且已过结算时间的轮次，逐个结算。
 * Workers 不等未完成的 Promise，所以每步都必须 await。
 */
export async function settleCurrentRound(db: D1Database, now: number): Promise<void> {
  const repo = new RaceRepository(db);
  const rounds = await repo.findBettingRoundsBefore(now);

  for (const round of rounds) {
    const roundStartUtc8 = new Date(round.round_key + ':00.000Z').getTime() + 8 * 3_600_000;
    const roundStartMs = roundStartUtc8 - 8 * 3_600_000;
    // 投注期（8 分钟）一结束就结算：封盘后不再接受下注，剩下 2 分钟留给前端播动画、看结果。
    if (now - roundStartMs < RACE_BETTING_MS) continue;

    const weights: number[] = JSON.parse(round.beast_weights) as number[];
    const winnerIndex = raceWeightedPick(weights, Math.random());

    const totalW = weights.reduce((s, w) => s + w, 0);
    const winnerW = weights[winnerIndex] ?? 1;
    const odds = raceFixedOdds(winnerW, totalW);

    const bets = await repo.betsByRound(round.id);

    const stmts: ParameterizedQuery[] = [];
    stmts.push(settleRaceRoundStatement(round.id, winnerIndex, now));

    // 按宗门汇总本轮下注：每个下过注的宗门都写一条赌坊记录（押中 win / 未押中 lose），
    // 记录里带上押了哪几只、各押多少、总投入与拿回，战绩统计据此扣本金、算净收益。
    const sectBets = new Map<string, { perBeast: Map<number, number>; stake: number; payout: number }>();
    for (const bet of bets) {
      let entry = sectBets.get(bet.sect_id);
      if (entry === undefined) {
        entry = { perBeast: new Map(), stake: 0, payout: 0 };
        sectBets.set(bet.sect_id, entry);
      }
      entry.perBeast.set(bet.beast_index, (entry.perBeast.get(bet.beast_index) ?? 0) + bet.amount);
      entry.stake += bet.amount;
      if (bet.beast_index === winnerIndex) {
        entry.payout += Math.floor(bet.amount * odds + 1e-6);
      }
    }

    const sectPayouts = new Map<string, { total: number; sectName: string }>();
    for (const [sectId, entry] of sectBets) {
      if (entry.payout > 0) {
        stmts.push(resourceDeltaStatement(sectId, 'spiritStone', entry.payout, now));
        sectPayouts.set(sectId, { total: entry.payout, sectName: '' });
      }
    }

    if (sectPayouts.size > 0) {
      const sectIds = [...sectPayouts.keys()];
      const placeholders = sectIds.map(() => '?').join(',');
      const sectRows = await new ParamRepository2(db).allRaw<{ id: string; name: string }>({
        sql: `SELECT id, name FROM sects WHERE id IN (${placeholders})`,
        params: sectIds,
      });
      for (const row of sectRows) {
        const entry = sectPayouts.get(row.id);
        if (entry !== undefined) entry.sectName = row.name;
      }
    }

    for (const [sectId, entry] of sectBets) {
      const picked = [...entry.perBeast.keys()].sort((a, b) => a - b);
      const pickedWeight = picked.reduce((s, i) => s + (weights[i] ?? 0), 0);
      stmts.push(insertDaoDebateLogStatement({
        id: crypto.randomUUID(),
        sectId,
        discipleId: '',
        discipleName: RACE_LOG_NAME,
        betMode: 'beast_race',
        multiplier: Math.max(1, Math.round(odds * 10)),
        stakeDetail: JSON.stringify({
          resourceId: 'spiritStone',
          amount: String(entry.stake),
          bets: picked.map((i) => ({ beastIndex: i, beastName: beastNameAt(i), amount: String(entry.perBeast.get(i) ?? 0) })),
          winnerIndex,
          winnerName: beastNameAt(winnerIndex),
        }),
        result: entry.payout > 0 ? 'win' : 'lose',
        rewardDetail: JSON.stringify(
          entry.payout > 0
            ? { type: 'resource', resourceId: 'spiritStone', amount: String(entry.payout) }
            : { type: 'none' },
        ),
        winProbability: totalW > 0 ? pickedWeight / totalW : null,
        now,
      }));
    }

    const prepared = prepareStatements(db, stmts);
    await db.batch(prepared);

    if (odds >= RACE_BROADCAST_PAYOUT_THRESHOLD && sectPayouts.size > 0) {
      for (const [, info] of sectPayouts) {
        if (info.total > 0 && info.sectName) {
          try {
            await broadcastSystemMessage(
              db,
              `${info.sectName}在灵兽竞逐中押中${beastNameAt(winnerIndex)}（${odds.toFixed(1)}x），赢得${displayAmount(info.total)}灵石！`,
              now,
            );
          } catch {
            /* 广播失败不影响主流程 */
          }
        }
      }
    }
  }
}

const RACE_HISTORY_PAGE_SIZE = 10;

export async function getRaceHistory(db: D1Database, page: number): Promise<RaceHistoryView> {
  const repo = new RaceRepository(db);
  const total = await repo.countSettledRounds();
  const offset = (page - 1) * RACE_HISTORY_PAGE_SIZE;
  const rounds = await repo.listSettledRounds(RACE_HISTORY_PAGE_SIZE, offset);

  const historyRounds: RaceHistoryRoundView[] = rounds.map((r) => {
    const winnerIndex = r.winner_index ?? 0;
    const ws: number[] = JSON.parse(r.beast_weights) as number[];
    const totalW = ws.reduce((s, w) => s + w, 0);
    const winnerW = ws[winnerIndex] ?? 1;
    return {
      roundKey: r.round_key,
      winnerIndex,
      winnerName: beastNameAt(winnerIndex),
      totalPool: String(r.total_pool),
      winnerOdds: raceFixedOdds(winnerW, totalW),
      settledAt: r.settled_at ?? r.created_at,
    };
  });

  const winCounts = await repo.beastWinCounts();
  const winMap = new Map(winCounts.map((w) => [w.winner_index, w.cnt]));
  const beastStats: RaceBeastStatView[] = BEAST_NAMES.map((name, i) => {
    const wins = winMap.get(i) ?? 0;
    return { index: i, name, wins, winRate: total > 0 ? Math.round((wins / total) * 1000) / 1000 : 0 };
  });

  return { beastStats, rounds: historyRounds, total, page, pageSize: RACE_HISTORY_PAGE_SIZE };
}

class ParamRepository2 {
  constructor(private readonly db: D1Database) {}
  async allRaw<T>(query: ParameterizedQuery): Promise<T[]> {
    const stmt = query.params && query.params.length > 0
      ? this.db.prepare(query.sql).bind(...query.params)
      : this.db.prepare(query.sql);
    const result = await stmt.all<T>();
    return result.results ?? [];
  }
}

/* ---------- 坊市（shop.ts 的纯规则 + 受保护 batch 提交） ---------- */

/**
 * 坊市文案里的灵石数量：买入价是 667 最小单位（= 0.667 灵石）这种零头，
 * displayAmount 的两位小数会把它抹成 0.67，所以这里保留三位再裁掉多余的 0。
 */
function shopAmountText(minUnits: number): string {
  const value = minUnits / UNITS_PER_DISPLAY;
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

/** 坊市可交易材料的第一道判定：灵石 / 灵气 / 客户端乱传的 id 一律拒绝（计划 2.1）。 */
function requireTradableResource(resourceId: string): ShopTradableResource {
  const traded = asShopTradableResource(resourceId);
  if (traded === null) {
    throw new AppError('VALIDATION_ERROR', '该资源不能在坊市交易', { resourceId });
  }
  return traded;
}

/**
 * 坊市买入（POST /game/shop-buy，计划 4.2 / 5.2）：灵石 → 材料。
 *
 * 与其它写命令同一套路：结算 → 全部只读校验（材料白名单 / 灵石余额 / 材料容量）→
 * 扣灵石、加材料 → **一次**受保护 batch（`commit()` 的守卫会核对全部资源余额，
 * 并发的结算或交易只会让这一批回滚重试，不会写出半笔交易）。
 *
 * 容量用与结算同一口径的 effectiveCapacity：买入不允许把材料顶到容量之外
 * （超出的部分在结算里会被算成溢出：room = 0，之后的产出全部丢弃），所以提前拒绝，并在 details 里给出还能买多少。
 */
export async function shopBuy(
  db: D1Database,
  userId: string,
  resourceId: string,
  amount: number,
  now: number,
): Promise<{ state: SectStateView; result: ShopBuyResultView }> {
  const draft = await draftFor(db, userId, now);
  const traded = requireTradableResource(resourceId);
  const cost = shopBuyCost(amount);
  const gained = toMinUnits(amount);

  draft.requireResourceAvailable('spiritStone', cost);
  const capacity = draft.resourceCapacityOf(traded);
  const balance = draft.balanceOf(traded);
  if (balance + gained > capacity) {
    const room = Math.max(0, Math.floor((capacity - balance) / UNITS_PER_DISPLAY));
    throw new AppError(
      'CAPACITY_FULL',
      `${draft.resourceName(traded)}将超过容量上限（最多还能买入 ${String(room)}）`,
      {
        resourceId: traded,
        capacity: String(capacity),
        balance: String(balance),
        room: String(room),
      },
    );
  }

  // 校验全部通过后才真正扣减：requireResource 同时完成检查与扣减，语句与内存一起改。
  draft.requireResource('spiritStone', cost);
  draft.grantResource(traded, gained);
  await draft.commit();

  return {
    state: draft.view(),
    result: {
      action: 'buy',
      resourceId: traded,
      resourceName: draft.resourceName(traded),
      amount,
      cost,
      message: `买入 ${draft.resourceName(traded)} ×${String(amount)}，花费 ${shopAmountText(cost)} 灵石`,
    },
  };
}

/**
 * 坊市卖出材料（POST /game/shop-sell，计划 4.3 / 5.2）：材料 → 灵石。
 *
 * 扣的是 `amount × UNITS_PER_DISPLAY` 最小单位材料（amount 是展示单位整数）；
 * 卖得的灵石与秘境 / 挑战 / 历练奖励同一口径 —— 直接加余额、不夹容量
 * （只有买入要挡容量，理由见 shopBuy）。
 */
export async function shopSell(
  db: D1Database,
  userId: string,
  resourceId: string,
  amount: number,
  now: number,
): Promise<{ state: SectStateView; result: ShopSellResultView }> {
  const draft = await draftFor(db, userId, now);
  const traded = requireTradableResource(resourceId);
  const revenue = shopSellRevenue(amount);

  // requireResource 同时完成检查与扣减（不足抛 INSUFFICIENT_RESOURCE，带缺少数量）。
  draft.requireResource(traded, toMinUnits(amount));
  draft.grantResource('spiritStone', revenue);
  await draft.commit();

  return {
    state: draft.view(),
    result: {
      action: 'sell',
      resourceId: traded,
      resourceName: draft.resourceName(traded),
      amount,
      revenue,
      message: `卖出 ${draft.resourceName(traded)} ×${String(amount)}，获得 ${shopAmountText(revenue)} 灵石`,
    },
  };
}

/**
 * 坊市售丹（POST /game/shop-sell-pill，计划 4.4 / 5.2）：丹药 → 灵石。
 *
 * 丹药只能卖不能买：回收价出自 shop.ts 的 SHOP_PILL_PRICES（丹方以外的一律拒绝，
 * 价格表就是白名单）。库存扣减是**绝对值**写回，所以 commit 必须带上 pillId ——
 * 守卫会核对这条库存仍是读到的数量，并发的炼制 / 服用不会被这一批覆盖。
 */
export async function shopSellPill(
  db: D1Database,
  userId: string,
  pillId: string,
  quantity: number,
  now: number,
): Promise<{ state: SectStateView; result: ShopSellPillResultView }> {
  const draft = await draftFor(db, userId, now);
  // 未知丹方抛 NOT_FOUND（与炼制 / 服用同一文案）；有丹方但没回收价再抛一次。
  const recipe = requirePillRecipe(pillId);
  const price = shopPillPrice(recipe.id);
  if (price === null || price <= 0) {
    throw new AppError('VALIDATION_ERROR', '该丹药暂不可出售', { pillId: recipe.id });
  }
  const revenue = shopPillRevenue(recipe.id, quantity);

  draft.removePill(recipe.id, quantity);
  draft.grantResource('spiritStone', revenue);
  await draft.commit({ pillId: recipe.id });

  return {
    state: draft.view(),
    result: {
      action: 'sell-pill',
      pillId: recipe.id,
      pillName: recipe.name,
      quantity,
      revenue,
      message: `卖出 ${recipe.name} ×${String(quantity)}，获得 ${shopAmountText(revenue)} 灵石`,
    },
  };
}

// ── 全服聊天 ──

const CHAT_RATE_LIMIT_MS = 5_000;
const CHAT_PAGE_SIZE = 50;

export async function listChatMessages(
  db: D1Database,
  userId: string,
  afterId?: string,
): Promise<ChatMessageView[]> {
  const repo = new ChatMessageRepository(db);
  const rows = afterId
    ? await repo.findAfterId(afterId, CHAT_PAGE_SIZE)
    : await repo.findRecent(CHAT_PAGE_SIZE);

  const ordered = afterId ? rows : rows.slice().reverse();

  const SYSTEM_USER_ID = 'system';
  return ordered.map((row) => ({
    id: row.id,
    sectName: row.sect_name,
    content: row.content,
    isMe: row.user_id === userId,
    isSystem: row.user_id === SYSTEM_USER_ID,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export async function sendChatMessage(
  db: D1Database,
  userId: string,
  content: string,
  now: number,
): Promise<ChatMessageView[]> {
  const sectRepo = new SectRepository(db);
  const chatRepo = new ChatMessageRepository(db);

  const sect = await sectRepo.findByUserId(userId);
  if (sect === null) {
    throw new AppError('NOT_FOUND', '尚未建宗');
  }

  const latest = await chatRepo.findLatestByUserId(userId);
  if (latest !== null && now - latest.created_at < CHAT_RATE_LIMIT_MS) {
    throw new AppError('VALIDATION_ERROR', '发言太快，请稍后再试');
  }

  const id = crypto.randomUUID();
  const stmt = insertChatMessageStatement({
    id,
    userId,
    sectName: sect.name,
    content: content.trim(),
    now,
  });
  await chatRepo.execute(stmt);

  return listChatMessages(db, userId);
}

async function broadcastSystemMessage(db: D1Database, content: string, now: number): Promise<void> {
  const repo = new ChatMessageRepository(db);
  await repo.execute(insertChatMessageStatement({
    id: crypto.randomUUID(),
    userId: 'system',
    sectName: '系统',
    content,
    now,
  }));
}
