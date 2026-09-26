<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

import type {
  ActiveExplorationView,
  BuildingView,
  DaoAttribute,
  DaoDebateInput,
  DaoDebateResult,
  ChallengeResultView,
  DiscipleView,
  EquipmentMainAttr,
  EquipmentSlotId,
  EquipmentView,
  ExploreChoiceResult,
  GameActionData,
  JourneyDirection,
  JourneyPreviewView,
  PublicSectView,
  RecruitOutcome,
  RecruitPreview,
  SecretRealmView,
  SectStateView,
  ShopResourceId,
  WheelSpinResult,
} from '../api/game';
import type { ToastTone } from '../types/ui';
import type { AvatarFrameId } from '../utils/avatarFrames';
import { ApiError } from '../api/client';
import { formatAmount, formatBp, formatRate, formatTime } from '../utils/format';
import {
  equipItem,
  fetchEquipment,
  fetchJourneyPreview,
  fetchRecruitPreview,
  fetchSecretRealms,
  forgeEquipment,
  salvageEquipment,
  shopBuy,
  shopSell,
  shopSellPill,
  unequipItem,
} from '../api/game';
import { isInjured, severeInjuryStatusLabel } from '../utils/discipleFilter';
import { resourceGlyph } from '../utils/glyph';
import { CHANGELOG } from '../data/changelog';
import AccountDialog from './AccountDialog.vue';
import ChangelogDialog from './ChangelogDialog.vue';
import AlchemyPanel from './AlchemyPanel.vue';
import ChallengeDialog from './ChallengeDialog.vue';
import ChallengeHistoryPanel from './ChallengeHistoryPanel.vue';
import DefenseLineupPanel from './DefenseLineupPanel.vue';
import DiscipleDetailDialog from './DiscipleDetailDialog.vue';
import DiscipleRoster from './DiscipleRoster.vue';
import BagDialog from './BagDialog.vue';
import EquipmentDialog from './EquipmentDialog.vue';
import EventLogPanel from './EventLogPanel.vue';
import ExplorePanel from './ExplorePanel.vue';
import ExplorePartyDialog from './ExplorePartyDialog.vue';
import GamblingHouseDialog from './GamblingHouseDialog.vue';
import LoadingState from './LoadingState.vue';
import RealmExploreDialog from './RealmExploreDialog.vue';
import ChatPanel from './ChatPanel.vue';
import DiscipleLeaderboardPanel from './DiscipleLeaderboardPanel.vue';
import LeaderboardPanel from './LeaderboardPanel.vue';
import RecruitDialog from './RecruitDialog.vue';
import ShopDialog from './ShopDialog.vue';
import WorldBossDialog from './WorldBossDialog.vue';
import MeritDialog from './MeritDialog.vue';
import ModalShell from './ModalShell.vue';

/**
 * 游戏主界面：服务端负责结算和规则，本组件只展示、本地平滑数值并派发操作。
 */
const props = defineProps<{
  state: SectStateView;
  busy: boolean;
  /** 写请求由 App 的全局 busy 门闩执行；本组件只处理弹窗状态与过期预览。 */
  recruitAction: (choice: number, batch: string) => Promise<GameActionData>;
  refreshRecruitAction: () => Promise<{ state: SectStateView; preview: RecruitPreview }>;
  /** 最近一次挑战的战报；App.vue 负责拿结果，这里只负责展示（null = 还没打过）。 */
  challengeResult: ChallengeResultView | null;
  /** V6 交互探索刚判定完的那一步；App.vue 负责拿结果，这里只负责展示（null = 还没判定）。 */
  exploreResult: ExploreChoiceResult | null;
  /** 0019 论道赌局最近一次结果；App.vue 负责拿结果，这里只负责展示（null = 还没打过）。 */
  daoDebateResult: DaoDebateResult | null;
  /** 0020 天机轮最近一次结果；App.vue 负责拿结果，这里只负责展示（null = 还没转过）。 */
  wheelResult: WheelSpinResult | null;
}>();

const emit = defineEmits<{
  refresh: [];
  logout: [];
  /** 0016：招募结果（App.vue 只负责赋值 state 与提示事件，见 onRecruitRefreshed）。 */
  recruited: [state: SectStateView];
  'recruit-refreshed': [state: SectStateView];
  assign: [discipleId: string, assignment: string];
  upgrade: [defId: string];
  'upgrade-sect': [];
  explore: [realmId: string, discipleIds: string[]];
  /**
   * V6 交互探索：与「速通」共用选人弹窗，提交时才分道。
   * 4 个请求事件都由 App.vue 绑定并负责调接口 / 写 state，本组件只派发与展示。
   */
  'explore-start': [realmId: string, discipleIds: string[]];
  'explore-resume': [];
  'explore-choose': [explorationId: string, choiceId: string];
  'explore-abandon': [explorationId: string];
  /** 结果看完了（或弹窗被关掉）：请 App.vue 清空 exploreResult。 */
  'dismiss-explore-result': [];
  challenge: [targetSectId: string, discipleIds: string[]];
  setDefenseLineup: [discipleIds: string[]];
  dismissChallengeResult: [];
  breakthrough: [discipleId: string];
  /** 名册多选底栏：批量换岗 / 批量破境（请求与提示都在 App.vue）。 */
  'batch-assign': [discipleIds: string[], assignment: string];
  'batch-breakthrough': [discipleIds: string[]];
  /** 名册「疗伤中」标签单个服丹走 use-pill；多选底栏的批量疗伤走这个（请求与提示都在 App.vue）。 */
  'batch-heal': [discipleIds: string[]];
  'craft-pill': [pillId: string, quantity: number];
  'use-pill': [pillId: string, discipleId: string, count: number];
  notify: [tone: ToastTone, title: string, message: string];
  /** 详情里保存私有备注（note 为空串 = 清空）；App.vue 绑定了这个名字。 */
  'save-note': [discipleId: string, note: string];
  /** 详情底部二次确认后的驱逐请求；App.vue 绑定了这个名字。 */
  expel: [discipleId: string];
  /**
   * 0014 历练：预览只是只读请求，由本组件自己拉（见 requestJourneyPreview）；
   * 仍按同一套事件名向 App.vue 转发一次，保持「详情 → 主界面 → App」的单一走向。
   */
  requestJourneyPreview: [discipleId: string];
  startJourney: [discipleId: string, direction: JourneyDirection, durationSeconds: number];
  claimJourney: [journeyId: string];
  /** 0017 保存头像框样式（白名单 id，见 utils/avatarFrames.ts）。 */
  setAvatarFrame: [discipleId: string, frameId: AvatarFrameId];
  /** 0019 赌坊：论道请求与悟道值加点都由 App.vue 绑定并调接口，这里只派发与展示。 */
  daoDebate: [input: DaoDebateInput];
  allocateDaoInsight: [discipleId: string, attribute: DaoAttribute, points: number];
  /** 0021 改名（宗门 500 灵石 / 弟子 50 灵石）：请求与提示都在 App.vue，这里只派发与展示。 */
  renameSect: [name: string];
  renameDisciple: [discipleId: string, name: string];
  /** 0020 天机轮：转动（带投入档位）与重置都由 App.vue 绑定并调接口，这里只派发与展示。 */
  wheelSpin: [tier: number];
  wheelReset: [];
}>();

/** 操作条里的弹窗开关：天机录 / 秘境探索 / 讨伐 / 江湖榜 / 守擂阵容 / 演武录 / 炼丹 / 炼器 / 赌坊 / 坊市（宗门晋升与建筑仍在右栏常驻）。 */
const openPanel = ref<
  | 'events'
  | 'explore'
  | 'leaderboard'
  | 'disciple-leaderboard'
  | 'defense-lineup'
  | 'challenge-history'
  | 'alchemy'
  | 'equipment'
  | 'bag'
  | 'gambling'
  | 'shop'
  | 'world-boss'
  | 'merit'
  | null
>(null);

/**
 * 赌坊里当前在玩哪个玩法：只为赌坊弹窗那一层的加载层文案（论道 / 天机轮 / 灵兽竞逐），
 * 由 GamblingHouseDialog 在切换玩法时上报。
 */
const gamblingGame = ref<'debate' | 'wheel' | 'beast-race'>('debate');
const gamblingLoadingText = computed(() => {
  if (gamblingGame.value === 'wheel') return '正在推演天机';
  return gamblingGame.value === 'beast-race' ? '灵兽竞逐中' : '正在论道';
});

function onGamblingGame(game: 'debate' | 'wheel' | 'beast-race'): void {
  gamblingGame.value = game;
}

/**
 * 操作条角标：还能招几个人（宗门等级决定的弟子上限 − 现有门人）。
 * 招不了（门人已满 / 灵石不够）时返回 0，按钮上就不显示角标。
 * 0021 起已无「每日 3 次」上限，剩余数不再受次数限制。
 */
const recruitBadge = computed(() => {
  const recruit = props.state.recruit;
  if (!recruit.canRecruit) return 0;
  return Math.max(0, recruit.remaining);
});

/**
 * 0021 宗门改名弹窗：价格与长度规则都来自 state.rename（前端不另造常量）。
 * 成功后服务端回填新名字，watch 到「state.sect.name === 草稿」就自动关掉弹窗；
 * 失败（例如灵石不足）时弹窗保持打开，由 App.vue 的统一错误提示说明原因。
 */
const showRenameDialog = ref(false);
const renameDraft = ref('');
// 与服务端同一口径：先 trim 再按码点计数（` 苍梧宗 ` 提交过去就是 3 个字）。
const renameLength = computed(() => Array.from(renameDraft.value.trim()).length);
const renameRangeLabel = computed(
  () =>
    `${String(props.state.rename.sectNameMinChars)}~${String(
      props.state.rename.sectNameMaxChars,
    )} 个字`,
);
const renameInvalid = computed(
  () =>
    renameLength.value < props.state.rename.sectNameMinChars ||
    renameLength.value > props.state.rename.sectNameMaxChars,
);
/** trim 后与当前宗门名不同才允许提交（同名请求服务端会早退，不扣费也不写库）。 */
const renameDirty = computed(() => renameDraft.value.trim() !== props.state.sect.name);
/** 灵石够不够：只决定按钮可用性，余额校验与扣费都由服务端裁决。 */
const renameAffordable = computed(
  () => (liveResources.value['spiritStone'] ?? 0) >= Number(props.state.rename.sectCost),
);
const renameCostLabel = computed(() => formatAmount(props.state.rename.sectCost));
const renameHint = computed(() => {
  if (renameInvalid.value) return `宗门名需 ${renameRangeLabel.value}`;
  if (!renameAffordable.value) return '灵石不足';
  return '宗门名不可与别家重名；重挂门匾后，江湖榜与战报都会显示新名字';
});

function openRenameDialog(): void {
  renameDraft.value = props.state.sect.name;
  showRenameDialog.value = true;
}

function closeRenameDialog(): void {
  showRenameDialog.value = false;
}

function onRenameInput(event: Event): void {
  renameDraft.value = (event.target as HTMLInputElement).value;
}

// 服务端回填了新名字（= 改名成功）就自动关弹窗，不需要额外的成功回调。
watch(
  () => props.state.sect.name,
  (next) => {
    if (showRenameDialog.value && next === renameDraft.value.trim()) showRenameDialog.value = false;
  },
);

/** 招贤弹窗：候选人 + 开关（点「张榜招贤」时才拉预览；「换一批」直接换本地这份）。 */
const recruitPreview = ref<RecruitPreview | null>(null);
const showRecruitDialog = ref(false);
const recruitLoading = ref(false);
/** 「换一批」在途（与 recruitLoading 分开：打开弹窗与刷新是两条路径）。 */
const recruitRefreshing = ref(false);
/** 招募提交在途（含批次过期后重新拉预览的那一段）：期间锁住候选卡与「换一批」。 */
const recruitSubmitting = ref(false);
const recruitLoadingText = computed(() => {
  if (recruitSubmitting.value) return '正在接引弟子入门';
  if (recruitRefreshing.value) return '正在推演新一批有缘人';
  return '正在寻访有缘人';
});

/** 二级弹窗：当前正在点将出征的秘境（null = 未打开）。 */
const exploreRealm = ref<SecretRealmView | null>(null);

/**
 * 本次「点将出征」要走哪条路：速通（旧逻辑）还是交互探索。
 * 两种模式复用同一个 ExplorePartyDialog，提交时才分叉。
 */
const exploreMode = ref<'speedrun' | 'interactive' | null>(null);

/** 交互探索弹窗是否打开；真正的渲染条件是它 + explorationShown 非空。 */
const exploreDialogOpen = ref(false);

/**
 * 最后一条「进行中的探索」快照。
 *
 * 服务端在「本关通过且已是最后一关」或「判定失败」时会把 state.activeExploration 置为 null，
 * 但结算面板（总入账奖励 /「完成」）还得显示这一场的顶栏与进度，所以留一份快照；
 * 它只在「有未读结果」时参与渲染（见 explorationShown），其余时候一律以 state 为准。
 */
const lastExploration = ref<ActiveExplorationView | null>(null);

/** 交互探索的秘境定义在途（ExplorePanel 只给 realmId，这里补一次只读列表请求）。 */
const exploreRealmLoading = ref(false);

/** 挑战弹窗的目标宗门（null = 未打开）。 */
const challengeTarget = ref<PublicSectView | null>(null);

/** 本地平滑显示：按服务端给的产量随时间推进，上限为容量（刷新后以服务端为准）。 */
const liveResources = ref<Record<string, number>>({});
const liveCultivation = ref<Record<string, number>>({});

/**
 * 本地推进的服务端时钟：以 `state.serverNow` 为基准，加上收到 state 以来真实经过的时间。
 * 历练倒计时与「到期触发一次同步」都读它，保证展示基准始终是服务器时间。
 */
const localNowMs = ref(Date.parse(props.state.serverNow));

/**
 * 收到当前 state 的本机时刻。本地推算一律按「现在 − 这个时刻」的真实经过时间计算，
 * 不做每秒累加：后台标签页的计时器会被浏览器降频、电脑休眠时直接停摆，累加会越算越少。
 */
let seededAtMs = Date.now();

/**
 * 已经为哪几条历练请求过同步：到期归队只由服务端结算（刷新后 status 才会变成 ready），
 * 同一 journeyId 只请求一次，避免每秒重复打 refresh。
 */
const journeySyncRequested = new Set<string>();

function elapsedSinceSeedSeconds(): number {
  // 本机时钟被往回调时不倒推。
  return Math.max(0, (Date.now() - seededAtMs) / 1000);
}

function advanceLive(): void {
  const elapsed = elapsedSinceSeedSeconds();
  liveResources.value = Object.fromEntries(
    props.state.resources.map((resource) => {
      const balance = Number(resource.balance);
      const capacity = Number(resource.capacity);
      // 只阻止增长越界：探索奖励允许把余额顶到容量之上，这里不能把它压回去（否则界面会跳变）。
      const grown = Math.min(capacity, balance + (Number(resource.ratePerHour) / 3600) * elapsed);
      return [resource.id, balance >= capacity ? balance : grown];
    }),
  );
  liveCultivation.value = Object.fromEntries(
    props.state.disciples.map((disciple) => {
      const threshold = disciple.requiredCultivation;
      const next = disciple.cultivation + (disciple.cultivationRatePerHour / 3600) * elapsed;
      return [disciple.id, threshold === null ? next : Math.min(threshold, next)];
    }),
  );
  localNowMs.value = Date.parse(props.state.serverNow) + elapsed * 1000;
}

function seedFromState(): void {
  seededAtMs = Date.now();
  // 拿到了新 state，后台期间攒下的「到点待同步」随之作废。
  scheduledSyncDue = false;
  advanceLive();
  scheduleStateSync();
}

/** 到期（或已过 ends_at）的在外历练各请求一次同步；能否领取仍由服务端决定。 */
function syncExpiredJourneys(): void {
  const pending = new Set<string>();
  for (const disciple of props.state.disciples) {
    const journey = disciple.journey;
    if (journey.status !== 'active' || journey.journeyId === null || journey.endsAt === null) continue;
    pending.add(journey.journeyId);
    const endsAtMs = Date.parse(journey.endsAt);
    if (!Number.isFinite(endsAtMs) || endsAtMs > localNowMs.value) continue;
    if (journeySyncRequested.has(journey.journeyId)) continue;
    journeySyncRequested.add(journey.journeyId);
    emit('refresh');
  }
  // 已领取/已消失的记录不必继续记账，避免集合随会话无限增长。
  for (const journeyId of [...journeySyncRequested]) {
    if (!pending.has(journeyId)) journeySyncRequested.delete(journeyId);
  }
}

const timer = window.setInterval(() => {
  advanceLive();
  syncExpiredJourneys();
}, 1000);

/*
 * 按需同步。App.vue 每 10 分钟才定时同步一次；两次同步之间数字在本地推算，
 * 但「能不能点」（canUpgrade / canCraft / canBreakthrough / 疗伤）仍停在上次同步那一刻。
 * 这里算出下一个「状态会改变」的时刻，到点补一次同步：
 * - 某个当前不可用的操作（晋升宗门 / 建筑升级 / 破境 / 炼丹）按产量刚好攒够所需资源；
 * - 弟子修为到达突破门槛、伤势痊愈；
 * - 本轮灵兽竞逐下过注：结算后同步一次（派奖由 Cron 直接入账，不经过本页面的任何请求）。
 * 能否操作仍全部由服务端判定，这里只决定「什么时候去问」；距上次写库不足 5 分钟的
 * /game/sync 在服务端只读不写，代价很小。
 */
/** 到点后多等一会儿再同步，避开服务端结算的取整误差。 */
const SCHEDULED_SYNC_SLACK_MS = 2_000;
/** 两次按需同步的最小间隔：取整误差让同一时刻反复「差一点」时，不会连续打请求。 */
const SCHEDULED_SYNC_MIN_INTERVAL_MS = 15_000;
/** 超过这个时长的时刻不排：App.vue 的定时同步会先到，届时重新计算。 */
const SCHEDULED_SYNC_MAX_DELAY_MS = 30 * 60_000;
/** 灵兽竞逐开跑后多等一会儿，给 Cron 结算留出时间。 */
const RACE_SETTLE_SLACK_MS = 20_000;

let scheduledSyncTimer: number | undefined;
let lastScheduledSyncAt = 0;
/** 到点时标签页在后台：记下来，切回前台时补同步。 */
let scheduledSyncDue = false;
/** 下过注的那一轮预计结算完成的本机时刻；null = 没有待结算的下注。 */
let raceSettleAtMs: number | null = null;

/**
 * 按快照里的产量，把一份成本攒够还要多少秒。
 * 快照里已经够了（当前不可用另有原因）或永远攒不够（没有产量 / 超过容量）时返回 null。
 */
function secondsUntilAffordable(cost: Record<string, string> | null): number | null {
  if (cost === null) return null;
  let wait = 0;
  for (const [resourceId, amount] of Object.entries(cost)) {
    const resource = props.state.resources.find((item) => item.id === resourceId);
    if (resource === undefined) return null;
    const need = Number(amount);
    const balance = Number(resource.balance);
    if (balance >= need) continue;
    const ratePerSecond = Number(resource.ratePerHour) / 3600;
    if (ratePerSecond <= 0 || need > Number(resource.capacity)) return null;
    wait = Math.max(wait, (need - balance) / ratePerSecond);
  }
  return wait > 0 ? wait : null;
}

/** 距离下一个「服务端判定会改变」的时刻还有多少秒（相对收到 state 的时刻）；没有则返回 null。 */
function secondsUntilStateChange(): number | null {
  const state = props.state;
  const waits: number[] = [];
  const push = (wait: number | null): void => {
    if (wait !== null && wait > 0) waits.push(wait);
  };

  if (state.sectUpgrade !== null && !state.sectUpgrade.canUpgrade) {
    push(secondsUntilAffordable(state.sectUpgrade.cost));
  }
  for (const building of state.buildings) {
    if (!building.canUpgrade) push(secondsUntilAffordable(building.upgradeCost));
  }
  if (state.alchemy.unlocked) {
    for (const recipe of state.alchemy.recipes) {
      if (!recipe.canCraft) push(secondsUntilAffordable(recipe.cost));
    }
  }

  const serverNow = Date.parse(state.serverNow);
  for (const disciple of state.disciples) {
    const injuryWait =
      disciple.injuredUntil === null ? 0 : Math.max(0, (Date.parse(disciple.injuredUntil) - serverNow) / 1000);
    push(injuryWait);
    const threshold = disciple.requiredCultivation;
    if (disciple.canBreakthrough || threshold === null) continue;
    // 破境要同时满足：伤愈、修为到门槛、灵气够；三者都到位的那一刻才可能变成可破境。
    let cultivationWait = 0;
    if (disciple.cultivation < threshold) {
      if (disciple.cultivationRatePerHour <= 0) continue;
      cultivationWait = (threshold - disciple.cultivation) / (disciple.cultivationRatePerHour / 3600);
    }
    const energyWait = secondsUntilAffordable({ spiritualEnergy: disciple.breakthroughCost }) ?? 0;
    push(Math.max(injuryWait, cultivationWait, energyWait));
  }

  return waits.length === 0 ? null : Math.min(...waits);
}

function scheduleStateSync(): void {
  if (scheduledSyncTimer !== undefined) window.clearTimeout(scheduledSyncTimer);
  scheduledSyncTimer = undefined;
  // 当前 state 已经是结算之后拿到的（例如竞逐弹窗自己轮询到了结果），不必再补。
  if (raceSettleAtMs !== null && raceSettleAtMs <= seededAtMs) raceSettleAtMs = null;

  const targets: number[] = [];
  const wait = secondsUntilStateChange();
  if (wait !== null) targets.push(seededAtMs + wait * 1000 + SCHEDULED_SYNC_SLACK_MS);
  if (raceSettleAtMs !== null) targets.push(raceSettleAtMs);
  if (targets.length === 0) return;

  const target = Math.max(Math.min(...targets), lastScheduledSyncAt + SCHEDULED_SYNC_MIN_INTERVAL_MS);
  const delay = Math.max(0, target - Date.now());
  if (delay > SCHEDULED_SYNC_MAX_DELAY_MS) return;
  scheduledSyncTimer = window.setTimeout(runScheduledSync, delay);
}

function runScheduledSync(): void {
  scheduledSyncTimer = undefined;
  if (document.hidden) {
    scheduledSyncDue = true;
    return;
  }
  if (props.busy) {
    // 有写请求在途：它返回的 state 会重新排期；万一失败，稍后再试一次。
    scheduledSyncTimer = window.setTimeout(runScheduledSync, 3_000);
    return;
  }
  lastScheduledSyncAt = Date.now();
  emit('refresh');
}

/** 竞逐弹窗上报：本轮下过注，预计 settleInMs 毫秒后开跑结算。 */
function onRaceBetPending(settleInMs: number): void {
  raceSettleAtMs = Date.now() + settleInMs + RACE_SETTLE_SLACK_MS;
  scheduleStateSync();
}

/**
 * 界面按快照判定「资源不足」，但本地推算已经攒够了：说明判定过时了（通常按需同步会先一步到，
 * 这里是兜底）。返回 true 时已发起同步，调用方不必再提示快照里的旧原因。
 */
function resyncIfCostNowAffordable(cost: Record<string, string> | null): boolean {
  // 快照里本来就够（不可用另有原因）或永远攒不够：不是过时判定，照常提示。
  if (cost === null || secondsUntilAffordable(cost) === null) return false;
  const affordable = Object.entries(cost).every(
    ([resourceId, amount]) => (liveResources.value[resourceId] ?? 0) >= Number(amount),
  );
  if (!affordable) return false;
  emit('refresh');
  emit('notify', 'info', '正在同步宗门状态', '资源已经攒够，同步完成后即可再次操作。');
  return true;
}

watch(() => props.state, seedFromState, { immediate: true });

/** 离开超过这个时长再切回标签页就补同步（另一台设备上的操作、后台期间的入账都靠它校正）。 */
const RESYNC_AFTER_HIDDEN_MS = 60_000;
let hiddenAt: number | null = null;

/** 切回标签页时按需补一次同步（App.vue 的低频轮询在隐藏标签页里不跑）。 */
function onVisibilityChange(): void {
  if (document.hidden) {
    hiddenAt = Date.now();
    return;
  }
  advanceLive();
  const awayMs = hiddenAt === null ? 0 : Date.now() - hiddenAt;
  hiddenAt = null;
  if (props.busy) return;
  if (!scheduledSyncDue && awayMs < RESYNC_AFTER_HIDDEN_MS) return;
  scheduledSyncDue = false;
  emit('refresh');
}

onMounted(() => {
  document.addEventListener('visibilitychange', onVisibilityChange);
});

onUnmounted(() => {
  window.clearInterval(timer);
  if (scheduledSyncTimer !== undefined) window.clearTimeout(scheduledSyncTimer);
  document.removeEventListener('visibilitychange', onVisibilityChange);
});

const resourceName = computed<Record<string, string>>(() =>
  Object.fromEntries(props.state.resources.map((resource) => [resource.id, resource.name])),
);

/** 服务端当前时间（毫秒）：疗伤等时间判定统一用它，不受本机时钟影响。 */
const serverNowMs = computed(() => Date.parse(props.state.serverNow));

const settlementText = computed(() => {
  const seconds = props.state.settle.durationSeconds;
  if (seconds < 60) return '方才完成结算';
  if (seconds < 3600) return `已结算 ${Math.floor(seconds / 60)} 分钟收益`;
  return `已结算 ${Math.floor(seconds / 3600)} 小时收益`;
});

function costText(cost: Record<string, string> | null): string {
  if (cost === null) return '已臻满级';
  return Object.entries(cost)
    .map(([resourceId, amount]) => `${resourceName.value[resourceId] ?? resourceId} ${formatAmount(amount)}`)
    .join(' · ');
}

function resourcePercent(resourceId: string, capacity: string): number {
  const maximum = Number(capacity);
  if (maximum <= 0) return 0;
  return Math.min(100, Math.round(((liveResources.value[resourceId] ?? 0) / maximum) * 100));
}


function resourceClass(resourceId: string): string {
  if (resourceId === 'spiritStone') return 'resource-stone';
  if (resourceId === 'spiritualEnergy') return 'resource-energy';
  if (resourceId === 'herb') return 'resource-herb';
  if (resourceId === 'ore') return 'resource-ore';
  return 'resource-default';
}

function buildingGlyph(defId: string): string {
  if (defId === 'spiritualArray') return '阵';
  if (defId === 'herbGarden') return '圃';
  if (defId === 'missionHall') return '矿';
  if (defId === 'scriptureLibrary') return '经';
  if (defId === 'arenaHall') return '武';
  if (defId === 'forgeWorkshop') return '器';
  return '殿';
}

/** 宗门等级上限（与后端 SECT_LEVELS 一致）。 */
const MAX_SECT_LEVEL = 10;

/** 建筑等级用菱形字标显示（与后端建筑上限 5 级一致）。 */
const LEVEL_GLYPHS = ['壹', '贰', '叁', '肆', '伍'] as const;

/** 该建筑最大等级决定显示几个菱形。 */
function levelGlyphsFor(building: BuildingView): readonly string[] {
  return LEVEL_GLYPHS.slice(0, Math.min(building.maxLevel, LEVEL_GLYPHS.length));
}

function buildingDescription(defId: string): string {
  if (defId === 'spiritualArray') return '汇聚天地灵气，每级提升灵气产出';
  if (defId === 'herbGarden') return '培育灵植，为宗门积蓄药材';
  if (defId === 'missionHall') return '开采地脉灵矿，提升灵石产出';
  if (defId === 'scriptureLibrary') return '典藏万卷，加速弟子修炼';
  if (defId === 'arenaHall') return '锻炼武技，开启秘境探索';
  return '宗门基业，随等级提升效用';
}

/** 张榜招贤：先取本次候选人（服务端按宗门+当日+次数+刷新次数做种子，同一批不变），再弹窗三选一。 */
async function requestRecruit(): Promise<void> {
  if (props.busy || recruitLoading.value) return;
  showRecruitDialog.value = true;
  recruitPreview.value = null;
  recruitLoading.value = true;
  try {
    recruitPreview.value = await fetchRecruitPreview();
  } catch (caught) {
    showRecruitDialog.value = false;
    emit('notify', 'error', '招贤台未应', caught instanceof Error ? caught.message : '候选人生成失败');
  } finally {
    recruitLoading.value = false;
  }
}

/**
 * 「换一批」：消耗 1 次本境界刷新额度，服务端返回新一批候选人和写库后的 state。
 * 这里就地换掉弹窗里的候选人，并把 state 交给 App.vue（state 只在 App 赋值，这里只是转发服务端结果）。
 */
async function requestRecruitRefresh(): Promise<void> {
  if (props.busy || recruitRefreshing.value || recruitSubmitting.value) return;
  recruitRefreshing.value = true;
  try {
    const { state: next, preview } = await props.refreshRecruitAction();
    recruitPreview.value = preview;
    emit('recruit-refreshed', next);
    emit(
      'notify',
      'success',
      '天机已转',
      `换了一批有缘人，本境界还剩 ${preview.refreshRemaining} 次刷新。`,
    );
  } catch (caught) {
    emit('notify', 'error', '推演未成', caught instanceof Error ? caught.message : '刷新失败');
  } finally {
    recruitRefreshing.value = false;
  }
}

/** 把招贤回执和「破境 / 炼丹 / 服药」的回执区分开（它们共用 outcome 字段）。 */
function isRecruitOutcome(outcome: GameActionData['outcome']): outcome is RecruitOutcome {
  return outcome !== undefined && 'attributeScore' in outcome;
}

/**
 * 0016 批次过期：不重试同一个人、不扣费、不自动选人。
 * 重新拉一次预览，用新候选人顶掉弹窗里那一份并（必要时）重新打开，让玩家重新确认；
 * 重拉失败时直接把错误摆出来，而不是留一个无法提交的旧批次。
 */
async function recoverExpiredBatch(reason: string): Promise<void> {
  try {
    const fresh = await fetchRecruitPreview();
    recruitPreview.value = fresh;
    showRecruitDialog.value = true;
    emit(
      'notify',
      'warning',
      '这批有缘人已过时',
      `${reason}。已重新推演一批候选人，请重新确认后再选择；本次没有扣除资源与招募次数。`,
    );
  } catch (caught) {
    recruitPreview.value = null;
    showRecruitDialog.value = false;
    emit(
      'notify',
      'error',
      '重新推演失败',
      caught instanceof Error ? caught.message : '候选人生成失败，请稍后重试。',
    );
  }
}

/**
 * 选中一位候选人：把预览下发的批次标识原样回传，由服务端做最后裁决
 * （归属 / 次数 / 资源 / 批次都在服务端校验，前端不复制这些判定）。
 *
 * 成功：关掉弹窗、丢掉这一批候选人，把写库后的 state 交给 App.vue，并按回执提示新弟子的六属性摘要。
 * 失败：批次过期走 recoverExpiredBatch；其余错误保留当前弹窗与候选人，玩家可以原地重试。
 * 任何失败都不显示「已扣费」的状态——扣费与否只以服务端返回的 state 为准。
 */
async function onRecruitChoose(choice: number): Promise<void> {
  const preview = recruitPreview.value;
  if (props.busy || recruitSubmitting.value || recruitRefreshing.value || preview === null) return;
  recruitSubmitting.value = true;
  try {
    const data = await props.recruitAction(choice, preview.batch);
    showRecruitDialog.value = false;
    recruitPreview.value = null;
    emit('recruited', data.state);
    if (isRecruitOutcome(data.outcome)) {
      const outcome = data.outcome;
      emit(
        'notify',
        'success',
        '招贤有得',
        `新弟子 ${outcome.discipleName} 已入山门：资质 ${outcome.aptitude}，综合评分 ${outcome.attributeScore.toFixed(1)}，天赋「${outcome.talentName}」。`,
      );
    } else {
      emit('notify', 'success', '招贤有得', '招募完成，新弟子已入山门。');
    }
  } catch (caught) {
    if (caught instanceof ApiError && caught.code === 'EXPIRED') {
      await recoverExpiredBatch(caught.message);
    } else {
      emit('notify', 'error', '招募未成', caught instanceof Error ? caught.message : '请稍后重试。');
    }
  } finally {
    recruitSubmitting.value = false;
  }
}

function requestUpgrade(building: BuildingView): void {
  if (props.busy) return;
  if (!building.canUpgrade) {
    if (resyncIfCostNowAffordable(building.upgradeCost)) return;
    emit('notify', 'warning', `${building.name}暂不可升级`, building.blockedReason ?? '当前条件尚未满足。');
    return;
  }
  emit('upgrade', building.defId);
}

function requestUpgradeSect(): void {
  const upgrade = props.state.sectUpgrade;
  if (props.busy || upgrade === null) return;
  if (!upgrade.canUpgrade) {
    if (resyncIfCostNowAffordable(upgrade.cost)) return;
    emit('notify', 'warning', `暂不可晋升${upgrade.nextLevelName}`, upgrade.blockedReason ?? '当前条件尚未满足。');
    return;
  }
  emit('upgrade-sect');
}

/** 秘境列表里点「速通」：打开二级弹窗选人（旧逻辑不变）。 */
function onSelectRealm(realm: SecretRealmView): void {
  exploreMode.value = 'speedrun';
  exploreRealm.value = realm;
}

/**
 * 秘境列表里点「探索」：面板只给 realmId（列表在面板内部），
 * 这里补一次只读的秘境列表请求拿到定义，再打开同一个选人弹窗。
 */
async function onExploreStartRequest(realmId: string): Promise<void> {
  if (props.busy || exploreRealmLoading.value) return;
  exploreRealmLoading.value = true;
  try {
    const realms = await fetchSecretRealms();
    const realm = realms.find((item) => item.id === realmId);
    if (realm === undefined) {
      emit('notify', 'error', '秘境未寻得', '秘境列表已变化，请关掉面板重新打开。');
      return;
    }
    exploreMode.value = 'interactive';
    exploreRealm.value = realm;
  } catch (caught) {
    emit('notify', 'error', '秘境未寻得', caught instanceof Error ? caught.message : '秘境信息获取失败');
  } finally {
    exploreRealmLoading.value = false;
  }
}

/**
 * 选好人出发：关掉选人弹窗，按 exploreMode 分叉交给上层调接口（结果由 App.vue 提示）。
 * 交互探索不需要额外事件把弹窗叫起来：上层写回 state.activeExploration 后它就渲染出来了。
 */
function onPartyExplore(realmId: string, discipleIds: string[]): void {
  if (props.busy) return;
  const mode = exploreMode.value;
  exploreRealm.value = null;
  exploreMode.value = null;
  if (mode === 'interactive') {
    // 先把上一次的结果收起来；成功返回的 state 一到位，弹窗就自己出现。
    emit('dismiss-explore-result');
    exploreDialogOpen.value = true;
    emit('explore-start', realmId, discipleIds);
    return;
  }
  emit('explore', realmId, discipleIds);
}

/**
 * 面板顶部「继续探索」：断点已经在 state.activeExploration 里，不需要请求，
 * 打开弹窗即可；同时照本组件「详情 → 主界面 → App」的惯例向上转发一次事件名。
 */
function onExploreResume(): void {
  exploreDialogOpen.value = true;
  emit('explore-resume');
}

/** 遭遇选项：判定与推进全部由 App.vue / 服务端负责，这里只转发。 */
function onExploreChoose(explorationId: string, choiceId: string): void {
  if (props.busy) return;
  emit('explore-choose', explorationId, choiceId);
}

/** 放弃探索：二次确认已在弹窗里完成（window.confirm），这里只转发。 */
function onExploreAbandon(explorationId: string): void {
  if (props.busy) return;
  emit('explore-abandon', explorationId);
}

/** 「继续前进」：清掉结果，露出服务端已经推进好的下一个遭遇。 */
function onDismissExploreResult(): void {
  emit('dismiss-explore-result');
}

/** 关闭弹窗（「完成」/ Esc / 点遮罩）：探索是否结束由服务端说了算，这里只收界面。 */
function onCloseExploreDialog(): void {
  exploreDialogOpen.value = false;
  lastExploration.value = null;
  emit('dismiss-explore-result');
}

/**
 * 弹窗渲染用的探索：优先用 state 里的进行中记录（服务端权威）；
 * 只有「整场已经结束但玩家还没收下结算」时才回落到快照（服务端那时已把 activeExploration 置空）。
 */
const explorationShown = computed<ActiveExplorationView | null>(() => {
  if (props.state.activeExploration !== null) return props.state.activeExploration;
  return props.exploreResult === null ? null : lastExploration.value;
});

// 记录断点快照；探索真的结束（且结算已收下）时自动关掉弹窗。
watch(
  () => props.state.activeExploration,
  (exploration) => {
    if (exploration !== null) {
      lastExploration.value = exploration;
      return;
    }
    if (props.exploreResult !== null) return;
    exploreDialogOpen.value = false;
    lastExploration.value = null;
  },
);

/** 公开档案里点「挑战」：先丢弃上一场战报，再打开挑战弹窗。 */
function onChallengeRequest(sect: PublicSectView): void {
  if (props.busy) return;
  emit('dismissChallengeResult');
  challengeTarget.value = sect;
}

/**
 * 出手：把目标与出战阵容交给上层调接口。
 * 弹窗先留着——App.vue 拿到战报后会通过 `challengeResult` 把它切成战报态。
 */
function onChallengeSubmit(targetSectId: string, discipleIds: string[]): void {
  if (props.busy) return;
  emit('challenge', targetSectId, discipleIds);
}

/** 关掉挑战弹窗（含战报态）：清掉目标，并请上层丢弃战报。 */
function onCloseChallengeDialog(): void {
  challengeTarget.value = null;
  emit('dismissChallengeResult');
}

/** 0019 赌坊里点「开始论道」：请求由 App.vue 执行，这里只转发（弹窗留着等结果回填）。 */
function onDaoDebate(input: DaoDebateInput): void {
  if (props.busy) return;
  emit('daoDebate', input);
}

/** 赌坊结果只提示一次：把已提示过的结果对象记下来，避免「揭晓」与「关闭」各弹一条。 */
let notifiedDebate: DaoDebateResult | null = null;

/** 把这一局的输赢告诉玩家：「揭晓结果」与「对峙阶段直接关面板」两条路径共用。 */
function notifyDebateResult(result: DaoDebateResult): void {
  if (result === notifiedDebate) return;
  notifiedDebate = result;
  emit(
    'notify',
    result.result === 'win' ? 'success' : 'warning',
    `${result.result === 'win' ? '论道得胜' : '论道失利'} · ${result.discipleName}`,
    result.message,
  );
}

/** 弹窗里点「揭晓结果」：结果屏已经把输赢写出来了，这里补一条 toast。 */
function onGamblingRevealed(): void {
  const result = props.daoDebateResult;
  if (result !== null) notifyDebateResult(result);
}

/** 0020 天机轮里点「转动天机」：请求由 App.vue 执行，这里只转发（弹窗留着等结果回填）。 */
function onWheelSpin(tier: number): void {
  if (props.busy) return;
  emit('wheelSpin', tier);
}

/** 天机轮里点「重置转盘」：扣费与重排格局都在服务端，这里只转发。 */
function onWheelReset(): void {
  if (props.busy) return;
  emit('wheelReset');
}


/** 天机轮结果同样只提示一次（转动停稳与关闭面板两条路径共用）。 */
let notifiedWheel: WheelSpinResult | null = null;

function notifyWheelResult(result: WheelSpinResult): void {
  if (result === notifiedWheel) return;
  notifiedWheel = result;
  emit(
    'notify',
    result.reward.type === 'none' ? 'warning' : 'success',
    `天机轮 · ${result.slotLabel}`,
    result.message,
  );
}

/** 转盘停稳：结果面板已经在弹窗里写出来了，这里补一条 toast（关掉弹窗也不会漏消息）。 */
function onWheelRevealed(): void {
  const result = props.wheelResult;
  if (result !== null) notifyWheelResult(result);
}

/** 0024 灵兽竞逐结果提示：由子组件直接 emit，SectScreen 只转发。 */
function onRaceNotify(tone: 'success' | 'warning', title: string, message: string): void {
  emit('notify', tone, title, message);
}

/** 0025 讨伐结果提示：由子组件直接 emit，SectScreen 只转发（与 onRaceNotify 同一处理）。 */
function onWorldBossNotify(tone: 'success' | 'warning', title: string, message: string): void {
  emit('notify', tone, title, message);
}

/**
 * 关掉赌坊弹窗：结果由 App.vue 保留，下次打开仍是干净的玩法列表。
 * 但玩家可能在对峙阶段（或天机轮转动 / 灵兽竞逐中）直接按 Esc / 点右上角 X —— 那时账其实已经结算了，
 * 所以这里必须按各自的机会补发一次提示，不能让他「灵石少了却什么都没看到」。
 */
function onCloseGambling(): void {
  const result = props.daoDebateResult;
  if (result !== null) notifyDebateResult(result);
  const wheel = props.wheelResult;
  if (wheel !== null) notifyWheelResult(wheel);
  openPanel.value = null;
}

/* ---------- 坊市（商店）：接口在本组件调用，回执里的 state 交给 App 统一赋值 ---------- */

/** 坊市交易在途：与 props.busy（App 的全局门闩）分开，只锁坊市这一层，避免连点重复下单。 */
const shopSubmitting = ref(false);

/**
 * 坊市回执：App.vue 上「SectScreen 自己拿到新 state」的入口只有 @recruited / @recruit-refreshed，
 * 两者都指向 onRecruitRefreshed（state.value = next + announceEvents），所以复用同一个入口，
 * 不新增 App.vue 的绑定；坊市不写事件日志，announceEvents 不会因此多弹提示。
 */
function handOffShopState(next: SectStateView): void {
  emit('recruited', next);
}

/** 买入材料（POST /game/shop-buy）：数量换算、余额与材料容量都由服务端再校验一遍。 */
async function onShopBuy(resourceId: ShopResourceId, amount: number): Promise<void> {
  if (props.busy || shopSubmitting.value) return;
  shopSubmitting.value = true;
  try {
    const { state: next, result } = await shopBuy(resourceId, amount);
    handOffShopState(next);
    emit('notify', 'success', `买入 ${result.resourceName} ×${String(result.amount)}`, result.message);
  } catch (caught) {
    emit('notify', 'error', '交易未成', caught instanceof Error ? caught.message : '坊市暂时无法交割，请稍后重试。');
  } finally {
    shopSubmitting.value = false;
  }
}

/** 卖出材料（POST /game/shop-sell）：库存由服务端校验，成功后留在卖出页。 */
async function onShopSell(resourceId: ShopResourceId, amount: number): Promise<void> {
  if (props.busy || shopSubmitting.value) return;
  shopSubmitting.value = true;
  try {
    const { state: next, result } = await shopSell(resourceId, amount);
    handOffShopState(next);
    emit('notify', 'success', `卖出 ${result.resourceName} ×${String(result.amount)}`, result.message);
  } catch (caught) {
    emit('notify', 'error', '交易未成', caught instanceof Error ? caught.message : '坊市暂时无法交割，请稍后重试。');
  } finally {
    shopSubmitting.value = false;
  }
}

/** 卖出丹药（POST /game/shop-sell-pill）：颗数上限与库存都由服务端裁决，成功后留在售丹页。 */
async function onShopSellPill(pillId: string, quantity: number): Promise<void> {
  if (props.busy || shopSubmitting.value) return;
  shopSubmitting.value = true;
  try {
    const { state: next, result } = await shopSellPill(pillId, quantity);
    handOffShopState(next);
    emit('notify', 'success', `售出 ${result.pillName} ×${String(result.quantity)}`, result.message);
  } catch (caught) {
    emit('notify', 'error', '交易未成', caught instanceof Error ? caught.message : '坊市暂时无法交割，请稍后重试。');
  } finally {
    shopSubmitting.value = false;
  }
}

/* ---------- 0028 装备（炼器 / 背包 / 穿戴 / 卸下 / 分解） ---------- */

/**
 * 装备视图（GET /game/equipment 的只读结果）：打开炼器面板或弟子详情时拉一次，
 * 每次写操作成功后再拉一次（不做定时轮询）。
 */
const equipment = ref<EquipmentView | null>(null);
/** 装备写请求在途：与 props.busy 分开，只锁装备相关的按钮（避免连点重复炼器 / 分解）。 */
const equipmentSubmitting = ref(false);

/**
 * 装备回执里的 state：与坊市同一处理 —— App.vue 上「SectScreen 自己拿到新 state」的入口只有
 * @recruited / @recruit-refreshed（都指向同一个 onRecruitRefreshed），复用同一个入口，不新增绑定。
 */
function handOffEquipmentState(next: SectStateView): void {
  emit('recruited', next);
}

/** 拉取装备视图：失败只提示，不动已有数据（面板继续显示上一次的快照，可重试）。 */
async function loadEquipment(): Promise<void> {
  try {
    const data = await fetchEquipment();
    equipment.value = data.equipment;
  } catch (caught) {
    emit('notify', 'error', '装备未取到', caught instanceof Error ? caught.message : '装备信息获取失败');
  }
}

/** 打开炼器面板：先亮出上一次的快照，再拉一份最新的。 */
function openEquipment(): void {
  openPanel.value = 'equipment';
  void loadEquipment();
}

/**
 * 资源栏：四种常规资源走通用卡片；玄铁（装备二期，无产速）单独一个窄格；
 * 功勋（三期）只在首页「功勋」弹窗里看，不上资源栏、也不占窄格。
 */
const mainResources = computed(() =>
  props.state.resources.filter((resource) => resource.id !== 'xuantie' && resource.id !== 'bossMerit'),
);

/** 打开背包（资源栏最右侧的「背包」格）。 */
function openBag(): void {
  openPanel.value = 'bag';
  void loadEquipment();
}

// 资源栏的「背包 x/50」需要装备视图：进页面时取一次（之后炼器 / 分解 / 穿卸 / 打开面板时刷新；不做轮询）。
onMounted(() => {
  void loadEquipment();
});

/** 炼器（POST /game/forge-equipment）：法器必须带主属性；成功后刷新背包与余额。 */
async function onForgeEquipment(
  slot: EquipmentSlotId,
  mainAttr: EquipmentMainAttr | undefined,
  quality?: string,
): Promise<void> {
  if (props.busy || equipmentSubmitting.value) return;
  equipmentSubmitting.value = true;
  try {
    const { state: next, outcome } = await forgeEquipment(slot, mainAttr, quality);
    handOffEquipmentState(next);
    await loadEquipment();
    if (outcome.result === 'fail') {
      emit('notify', 'error', '炼器失败', '炉火失控，返还一半灵石与矿石，玄铁已损耗。');
    } else if (outcome.result === 'downgrade') {
      emit('notify', 'success', `火候偏差，炼得 ${outcome.name ?? ''}`, `${outcome.slotName} · 品质降了一档，已放入背包。`);
    } else {
      emit('notify', 'success', `炼得 ${outcome.name ?? ''}`, `${outcome.slotName} · 已放入背包。`);
    }
  } catch (caught) {
    emit('notify', 'error', '炼器未成', caught instanceof Error ? caught.message : '炉火不济，请稍后重试。');
  } finally {
    equipmentSubmitting.value = false;
  }
}

/** 分解（POST /game/salvage-equipment）：件数与返还矿石都由服务端复核，这里按回执提示。 */
async function onSalvageEquipment(equipmentIds: string[]): Promise<void> {
  if (props.busy || equipmentSubmitting.value || equipmentIds.length === 0) return;
  equipmentSubmitting.value = true;
  try {
    const { state: next, outcome } = await salvageEquipment(equipmentIds);
    handOffEquipmentState(next);
    await loadEquipment();
    emit(
      'notify',
      'success',
      `分解 ${String(outcome.count)} 件装备`,
      outcome.xuantie > 0
        ? `返还矿石 ${formatAmount(outcome.ore)}、玄铁 ${formatAmount(outcome.xuantie)}。`
        : `返还矿石 ${formatAmount(outcome.ore)}。`,
    );
  } catch (caught) {
    emit('notify', 'error', '分解未成', caught instanceof Error ? caught.message : '无法分解，请稍后重试。');
  } finally {
    equipmentSubmitting.value = false;
  }
}

/** 穿戴（弟子详情「装备」Tab 里点选背包里的同部位装备）：替换下来的那件自动回背包。 */
async function equipToDisciple(equipmentId: string, discipleId: string): Promise<void> {
  if (props.busy || equipmentSubmitting.value) return;
  equipmentSubmitting.value = true;
  try {
    const { state: next, outcome } = await equipItem(equipmentId, discipleId);
    handOffEquipmentState(next);
    await loadEquipment();
    const replaced = outcome.replacedName === null ? '' : `（${outcome.replacedName} 已换回背包）`;
    emit('notify', 'success', `${outcome.name} 已上身`, `${outcome.discipleName ?? '弟子'}·${outcome.slotName}${replaced}`);
  } catch (caught) {
    emit('notify', 'error', '穿戴未成', caught instanceof Error ? caught.message : '无法穿戴，请稍后重试。');
  } finally {
    equipmentSubmitting.value = false;
  }
}

/** 卸下（POST /game/unequip）：装备回背包；背包满时服务端会拒绝并给出原因。 */
async function unequipFromDisciple(equipmentId: string): Promise<void> {
  if (props.busy || equipmentSubmitting.value) return;
  equipmentSubmitting.value = true;
  try {
    const { state: next, outcome } = await unequipItem(equipmentId);
    handOffEquipmentState(next);
    await loadEquipment();
    emit('notify', 'success', `已卸下 ${outcome.name}`, '装备已放回背包。');
  } catch (caught) {
    emit('notify', 'error', '卸下未成', caught instanceof Error ? caught.message : '无法卸下，请稍后重试。');
  } finally {
    equipmentSubmitting.value = false;
  }
}

function onDetailEquip(equipmentId: string, discipleId: string): void {
  void equipToDisciple(equipmentId, discipleId);
}

function onDetailUnequip(equipmentId: string): void {
  void unequipFromDisciple(equipmentId);
}
function onDetailAllocateDaoInsight(
  discipleId: string,
  attribute: DaoAttribute,
  points: number,
): void {
  if (props.busy) return;
  emit('allocateDaoInsight', discipleId, attribute, points);
}

/** 守擂阵容弹窗里点「确认阵容」：关掉弹窗，把阵容交给上层调接口。 */
function onSetLineupChoice(discipleIds: string[]): void {
  if (props.busy) return;
  openPanel.value = null;
  emit('setDefenseLineup', discipleIds);
}

/** 炼丹面板里点「炼制」：数量已在面板内选好（1~5），转发给上层调接口。 */
function onCraftPill(pillId: string, quantity: number): void {
  if (props.busy) return;
  emit('craft-pill', pillId, quantity);
}

/**
 * 弟子详情里点「服用」：目标弟子与服务端状态由服务端校验，转发给上层调接口。
 * （原文的全局「弟子用药」区块已迁入详情，炼丹面板只负责炼制。）
 */
function onUsePill(pillId: string, discipleId: string, count: number): void {
  if (props.busy) return;
  emit('use-pill', pillId, discipleId, count);
}

/* ---------- 弟子详情：只存 discipleId，每次渲染都从最新 state.disciples 取对象 ---------- */

const detailId = ref<string | null>(null);

/** 详情对应的弟子；驱逐成功后返回 null，弹窗随之关闭。 */
const detailDisciple = computed<DiscipleView | null>(() => {
  if (detailId.value === null) return null;
  return props.state.disciples.find((disciple) => disciple.id === detailId.value) ?? null;
});

/** 0014 历练预览（只读）：由本组件持有，弹窗关闭或换弟子时清掉，不缓存上一次的数值。 */
const journeyPreview = ref<JourneyPreviewView | null>(null);
const journeyPreviewLoading = ref(false);

watch(detailId, () => {
  journeyPreview.value = null;
});

/**
 * 出发成功后该弟子在 state 里立刻变成在外（领取后变成 none），旧预览的预计归队时间随之过期；
 * 这里只在「不再可出发」时丢弃预览——请求失败时状态仍是 none，选择因此不会被清掉。
 */
const detailJourneyStatus = computed(() => detailDisciple.value?.journey.status ?? 'none');

watch(detailJourneyStatus, (status) => {
  if (status !== 'none') journeyPreview.value = null;
});

// 所选弟子从 state.disciples 里消失（驱逐成功）时自动关闭详情，不依赖额外事件。
watch(detailDisciple, (disciple) => {
  if (detailId.value !== null && disciple === null) detailId.value = null;
});

/** 打开详情时顺带拉一份最新的装备视图（「装备」Tab 与穿戴入口都读它；失败不影响其他 Tab）。 */
function openDetail(discipleId: string): void {
  detailId.value = discipleId;
  void loadEquipment();
}

function closeDetail(): void {
  detailId.value = null;
}

function onDetailAssign(discipleId: string, assignment: string): void {
  if (props.busy) return;
  emit('assign', discipleId, assignment);
}

function onDetailBreakthrough(discipleId: string): void {
  if (props.busy) return;
  emit('breakthrough', discipleId);
}

function onDetailSaveNote(discipleId: string, note: string): void {
  if (props.busy) return;
  emit('save-note', discipleId, note);
}

function onDetailExpel(discipleId: string): void {
  if (props.busy) return;
  emit('expel', discipleId);
}

/**
 * 0014 拉历练预览：只读接口（不结算、不写库），所以由本组件自己调；
 * 失败只提示、不产生任何乐观数值，弹窗保持打开，玩家可以重试。
 */
async function onDetailRequestJourneyPreview(discipleId: string): Promise<void> {
  if (props.busy || journeyPreviewLoading.value) return;
  emit('requestJourneyPreview', discipleId);
  journeyPreviewLoading.value = true;
  journeyPreview.value = null;
  try {
    journeyPreview.value = await fetchJourneyPreview(discipleId);
  } catch (caught) {
    emit('notify', 'error', '历练预览未成', caught instanceof Error ? caught.message : '预览获取失败');
  } finally {
    journeyPreviewLoading.value = false;
  }
}

function onDetailStartJourney(
  discipleId: string,
  direction: JourneyDirection,
  durationSeconds: number,
): void {
  if (props.busy) return;
  emit('startJourney', discipleId, direction, durationSeconds);
}

function onDetailClaimJourney(journeyId: string): void {
  if (props.busy) return;
  emit('claimJourney', journeyId);
}

function onDetailNotify(tone: ToastTone, title: string, message: string): void {
  emit('notify', tone, title, message);
}

/* ---------- 名册头像快捷破境：只开确认弹窗，确认后才发请求 ---------- */

/** 破境确认弹窗对应的弟子 id（null = 未打开）；弟子对象每次渲染从最新 state.disciples 取。 */
const breakthroughConfirmId = ref<string | null>(null);
const breakthroughTarget = computed<DiscipleView | null>(() => {
  if (breakthroughConfirmId.value === null) return null;
  return (
    props.state.disciples.find((disciple) => disciple.id === breakthroughConfirmId.value) ?? null
  );
});

// 弟子从 state 里消失时自动收起弹窗，避免对着一份已经不存在的快照点确认。
watch(breakthroughTarget, (disciple) => {
  if (breakthroughConfirmId.value !== null && disciple === null) breakthroughConfirmId.value = null;
});

/** 灵气名来自服务端资源表，前端不硬编码。 */
const breakthroughEnergyName = computed(
  () => props.state.resources.find((resource) => resource.id === 'spiritualEnergy')?.name ?? '灵气',
);

/* ---------- 名册多选：批量换岗 / 批量破境 ---------- */

function onBatchAssign(discipleIds: string[], assignment: string): void {
  if (props.busy || discipleIds.length === 0) return;
  emit('batch-assign', discipleIds, assignment);
}

/** 批量破境确认弹窗对应的已选弟子（null = 未打开）。 */
const batchBreakthroughIds = ref<string[] | null>(null);
/** 本弹窗已提交过：等这次请求结束（busy 回落）就关弹窗，结果由 App.vue 的提示展示。 */
let batchBreakthroughSubmitted = false;

const batchBreakthroughSelected = computed<DiscipleView[]>(() => {
  const ids = batchBreakthroughIds.value;
  if (ids === null) return [];
  const byId = new Map(props.state.disciples.map((disciple) => [disciple.id, disciple]));
  return ids.flatMap((id) => {
    const disciple = byId.get(id);
    return disciple === undefined ? [] : [disciple];
  });
});

/** 可破境（除灵气外条件都满足，服务端字段）的弟子；灵气在下面整批合计。 */
const batchBreakthroughReady = computed(() =>
  batchBreakthroughSelected.value.filter((disciple) => disciple.breakthroughReadyExceptEnergy),
);
const batchBreakthroughSkipped = computed(() =>
  batchBreakthroughSelected.value.filter((disciple) => !disciple.breakthroughReadyExceptEnergy),
);
const batchBreakthroughCost = computed(() =>
  batchBreakthroughReady.value.reduce((sum, disciple) => sum + Number(disciple.breakthroughCost), 0),
);
const batchBreakthroughEnergy = computed(() => liveResources.value['spiritualEnergy'] ?? 0);
const batchBreakthroughAffordable = computed(
  () => batchBreakthroughEnergy.value >= batchBreakthroughCost.value,
);
/** 同一宗门的破境胜算只由聚灵阵决定，人人相同；取第一名可破境弟子的服务端字段。 */
const batchBreakthroughChanceBp = computed(
  () => batchBreakthroughReady.value[0]?.breakthroughChanceBp ?? 0,
);

function openBatchBreakthrough(discipleIds: string[]): void {
  if (props.busy || discipleIds.length === 0) return;
  batchBreakthroughSubmitted = false;
  batchBreakthroughIds.value = discipleIds;
}

function closeBatchBreakthrough(): void {
  batchBreakthroughIds.value = null;
}

function confirmBatchBreakthrough(): void {
  const ids = batchBreakthroughIds.value;
  if (props.busy || ids === null) return;
  if (batchBreakthroughReady.value.length === 0 || !batchBreakthroughAffordable.value) return;
  batchBreakthroughSubmitted = true;
  // 整份已选名单交给服务端：不符合条件的由服务端跳过并在结果里列出原因。
  emit('batch-breakthrough', ids);
}

watch(
  () => props.busy,
  (busy) => {
    if (!busy && batchBreakthroughSubmitted) {
      batchBreakthroughSubmitted = false;
      closeBatchBreakthrough();
    }
  },
);

/* ---------- 回春丹：名册「疗伤中」一点即服 / 多选批量疗伤 ---------- */

const HEALING_PILL_ID = 'healingPill';

const healingPillRecipe = computed(() =>
  props.state.alchemy.recipes.find((recipe) => recipe.id === HEALING_PILL_ID),
);
const healingPillName = computed(() => healingPillRecipe.value?.name ?? '回春丹');
const healingPillOwned = computed(() => healingPillRecipe.value?.owned ?? 0);

/** 炼丹未开启时的原因；已开启返回 null。 */
function alchemyLockedReason(): string | null {
  return props.state.alchemy.unlocked ? null : (props.state.alchemy.blockedReason ?? '炼丹尚未开启');
}

/** 名册里点「疗伤中」：不弹确认，直接服一颗；用不了（未开启 / 没库存）就只提示原因。最终裁决仍在服务端。 */
function onQuickHeal(discipleId: string): void {
  if (props.busy) return;
  let reason = alchemyLockedReason();
  if (reason === null && healingPillOwned.value < 1) {
    reason = `${healingPillName.value}库存不足，请先在炼丹房炼制。`;
  }
  if (reason !== null) {
    emit('notify', 'warning', `暂不可服用${healingPillName.value}`, reason);
    return;
  }
  emit('use-pill', HEALING_PILL_ID, discipleId, 1);
}

/** 批量疗伤确认弹窗对应的已选弟子（null = 未打开）。 */
const batchHealIds = ref<string[] | null>(null);
/** 本弹窗已提交过：等这次请求结束（busy 回落）就关弹窗，结果由 App.vue 的提示展示。 */
let batchHealSubmitted = false;

/** 不能用回春丹治的原因（与服务端同一口径：重伤 > 在外 > 无伤）；能治返回 null。 */
function healSkipReason(disciple: DiscipleView): string | null {
  if (severeInjuryStatusLabel(disciple, serverNowMs.value) !== null) return '重伤卧床，丹药无效';
  if (disciple.journey.status === 'active') return '外出历练中';
  if (!isInjured(disciple, serverNowMs.value)) return '没有伤势';
  return null;
}

interface BatchHealSkipped {
  disciple: DiscipleView;
  reason: string;
}

const batchHealRows = computed(() => {
  const healable: DiscipleView[] = [];
  const skipped: BatchHealSkipped[] = [];
  const byId = new Map(props.state.disciples.map((disciple) => [disciple.id, disciple]));
  for (const id of batchHealIds.value ?? []) {
    const disciple = byId.get(id);
    if (disciple === undefined) continue;
    const reason = healSkipReason(disciple);
    if (reason === null) healable.push(disciple);
    else skipped.push({ disciple, reason });
  }
  return { healable, skipped };
});
const batchHealAffordable = computed(
  () => healingPillOwned.value >= batchHealRows.value.healable.length,
);

function openBatchHeal(discipleIds: string[]): void {
  if (props.busy || discipleIds.length === 0) return;
  const reason = alchemyLockedReason();
  if (reason !== null) {
    emit('notify', 'warning', `暂不可服用${healingPillName.value}`, reason);
    return;
  }
  batchHealSubmitted = false;
  batchHealIds.value = discipleIds;
}

function closeBatchHeal(): void {
  batchHealIds.value = null;
}

function confirmBatchHeal(): void {
  const ids = batchHealIds.value;
  if (props.busy || ids === null) return;
  if (batchHealRows.value.healable.length === 0 || !batchHealAffordable.value) return;
  batchHealSubmitted = true;
  // 整份已选名单交给服务端：不需要 / 不能治的由服务端跳过并在结果里列出原因。
  emit('batch-heal', ids);
}

watch(
  () => props.busy,
  (busy) => {
    if (!busy && batchHealSubmitted) {
      batchHealSubmitted = false;
      closeBatchHeal();
    }
  },
);

/* ---------- 账号：查看账号信息 / 修改密码（弹窗自己调 auth 接口） ---------- */

const showAccountDialog = ref(false);

/* ---------- 更新说明：有没看过的新条目时「更新」按钮亮红点，打开即记为已读 ---------- */

const CHANGELOG_SEEN_KEY = 'changelog-seen';
const latestChangelogId = CHANGELOG[0]?.id ?? '';

function readSeenChangelog(): string {
  try {
    return localStorage.getItem(CHANGELOG_SEEN_KEY) ?? '';
  } catch {
    return '';
  }
}

const showChangelog = ref(false);
const changelogUnread = ref(latestChangelogId !== '' && readSeenChangelog() !== latestChangelogId);

function openChangelog(): void {
  showChangelog.value = true;
  changelogUnread.value = false;
  try {
    localStorage.setItem(CHANGELOG_SEEN_KEY, latestChangelogId);
  } catch {
    /* 存不下只是下次还会亮红点 */
  }
}

/** 头像点击：只开确认弹窗，不发请求（胜算、消耗与阻止原因都用服务端字段）。 */
function onRequestBreakthrough(discipleId: string): void {
  if (props.busy) return;
  breakthroughConfirmId.value = discipleId;
}

function closeBreakthroughConfirm(): void {
  breakthroughConfirmId.value = null;
}

/**
 * 确认破境：复用既有 `/game/breakthrough`（App.vue 负责调接口与回填 state）。
 * busy 期间按钮禁用，避免重复提交；返回的 state 一到，资格与按钮状态立即跟着更新。
 */
function confirmBreakthrough(): void {
  const disciple = breakthroughTarget.value;
  if (props.busy || disciple === null || !disciple.canBreakthrough) return;
  emit('breakthrough', disciple.id);
}

/** 0017 保存头像框：只转发白名单 id，归属与合法性都由服务端裁决。 */
function onDetailSetAvatarFrame(discipleId: string, frameId: AvatarFrameId): void {
  if (props.busy) return;
  emit('setAvatarFrame', discipleId, frameId);
}

/** 0021 宗门改名：只把新名字交给 App.vue，请求与提示都在上层。 */
function submitRenameSect(): void {
  if (props.busy || !renameDirty.value || renameInvalid.value || !renameAffordable.value) return;
  emit('renameSect', renameDraft.value.trim());
}

/** 0021 转发弟子改名：归属、余额与字数都由服务端裁决，这里只做一次 busy 门闩。 */
function onDetailRenameDisciple(discipleId: string, name: string): void {
  if (props.busy) return;
  emit('renameDisciple', discipleId, name);
}
</script>

<template>
  <main class="game-shell" :aria-busy="busy">
    <header class="game-topbar">
      <div class="sect-identity">
        <img class="sect-logo" src="/brand-logo.png" alt="" aria-hidden="true" />
        <div class="sect-identity-text">
          <div class="sect-name-row">
            <h1>{{ state.sect.name }}</h1>
            <button
              class="sect-rename"
              type="button"
              :disabled="busy"
              aria-label="宗门改名"
              title="改名"
              @click="openRenameDialog"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 20h4L20 8l-4-4L4 16v4Z" />
                <path d="M14 6l4 4" />
              </svg>
            </button>
          </div>
          <p class="eyebrow sect-world">太初界 · 掌门府</p>
        </div>
      </div>

      <dl class="sect-metrics" aria-label="宗门概况">
        <div>
          <dt>宗门品阶</dt>
          <dd><b>LV.</b>{{ state.sect.level }}<span class="sect-metric-title">{{ state.sect.levelName }}</span></dd>
        </div>
        <div><dt>声望</dt><dd>{{ state.sect.reputation }}</dd></div>
        <div><dt>门下弟子</dt><dd>{{ state.recruit.discipleCount }}<b>/{{ state.sect.discipleCapacity }}</b></dd></div>
      </dl>

      <div class="header-actions">
        <button
          class="icon-action"
          type="button"
          :disabled="busy"
          aria-label="同步宗门状态"
          @click="emit('refresh')"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20 7v5h-5M4 17v-5h5M6.1 8.4A7 7 0 0 1 18.5 7M17.9 15.6A7 7 0 0 1 5.5 17" />
          </svg>
          <span>同步</span>
        </button>
        <button
          class="icon-action"
          type="button"
          :aria-label="changelogUnread ? '更新说明（有新内容）' : '更新说明'"
          @click="openChangelog"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 3h9l3 3v15H6V3Zm3 6h6m-6 4h6m-6 4h4" />
          </svg>
          <span>更新</span>
          <i v-if="changelogUnread" class="icon-action-dot" aria-hidden="true" />
        </button>
        <button class="icon-action" type="button" aria-label="账号与密码" @click="showAccountDialog = true">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0" />
          </svg>
          <span>账号</span>
        </button>
        <button class="icon-action" type="button" :disabled="busy" aria-label="退出登录" @click="emit('logout')">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M10 5H5v14h5m5-4 4-3-4-3m4 3H9" />
          </svg>
          <span>离开</span>
        </button>
      </div>
    </header>


    <div class="overview-row">
      <section class="overview-panel" aria-labelledby="resource-title">
        <header class="section-heading overview-heading">
          <h2 id="resource-title" class="home-section-title">山门百业，生生不息</h2>
          <div class="settlement-badge">
            <span class="pulse-dot" aria-hidden="true" />
            <span>{{ settlementText }} · {{ formatTime(state.sect.lastSettledAt) }}</span>
          </div>
        </header>

        <ul class="resource-grid">
          <li
            v-for="resource in mainResources"
            :key="resource.id"
            class="resource-card"
            :class="[
              resourceClass(resource.id),
              {
                'is-near-capacity': resourcePercent(resource.id, resource.capacity) >= 90,
                'is-at-capacity': (liveResources[resource.id] ?? 0) >= Number(resource.capacity),
              },
            ]"
          >
            <div class="resource-glyph" aria-hidden="true">{{ resourceGlyph(resource.id) }}</div>
            <div class="resource-main">
              <span class="resource-name">{{ resource.name }}</span>
              <strong>{{ formatAmount(liveResources[resource.id] ?? 0) }}</strong>
              <span class="resource-capacity">库容 {{ formatAmount(resource.capacity) }}</span>
            </div>
            <div class="resource-rate">
              <span>产速</span>
              <strong>+{{ formatRate(resource.ratePerHour) }}<small>/时</small></strong>
            </div>
            <div class="resource-track" aria-hidden="true">
              <span :style="{ width: `${resourcePercent(resource.id, resource.capacity)}%` }" />
            </div>
          </li>
          <li class="resource-card narrow-card">
            <div class="resource-glyph" aria-hidden="true">铁</div>
            <div class="resource-main">
              <span class="resource-name">玄铁</span>
              <strong>{{ formatAmount(liveResources.xuantie ?? 0) }}</strong>
            </div>
          </li>
          <li class="resource-card bag-card">
            <button class="bag-card-button" type="button" aria-label="打开背包" @click="openBag">
              <div class="resource-glyph" aria-hidden="true">囊</div>
              <div class="resource-main">
                <span class="resource-name">背包</span>
                <strong>{{ equipment ? equipment.bagCount : '—' }}<small> / {{ equipment ? equipment.bagCapacity : 50 }}</small></strong>
              </div>
            </button>
          </li>
        </ul>
      </section>

      <section class="log-shortcuts" aria-labelledby="rank-title">
        <h2 id="rank-title" class="log-shortcuts-title">榜单</h2>
        <div class="log-shortcuts-buttons">
          <button class="action-chip" type="button" @click="openPanel = 'leaderboard'">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3.5 14.6 9l6 .9-4.3 4.2 1 6-5.3-2.8-5.3 2.8 1-6L3.4 9.9l6-.9 2.6-5.5Z" />
            </svg>
            <span>江湖榜</span>
          </button>
          <button class="action-chip" type="button" @click="openPanel = 'disciple-leaderboard'">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm-5 8a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm10 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm-5 6v6m-5-4v4m10-4v4" />
            </svg>
            <span>天骄榜</span>
          </button>
        </div>
      </section>

      <section class="log-shortcuts" aria-labelledby="log-title">
        <h2 id="log-title" class="log-shortcuts-title">日志</h2>
        <div class="log-shortcuts-buttons">
          <button class="action-chip" type="button" @click="openPanel = 'events'">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 4h9a2 2 0 0 1 2 2v12a2 2 0 0 0 2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm2 4h5m-5 4h5" />
            </svg>
            <span>天机录</span>
          </button>
          <button class="action-chip" type="button" @click="openPanel = 'challenge-history'">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 4h6v6H4zm10 0h6v6h-6zM4 14h6v6H4zm10 2a4 4 0 1 0 0-0" />
            </svg>
            <span>演武录</span>
            <span v-if="state.challenge.remaining > 0" class="chip-badge">{{ state.challenge.remaining }}</span>
          </button>
        </div>
      </section>
    </div>

    <nav class="action-bar" aria-label="宗门操作" role="toolbar">
      <button
        class="action-chip"
        type="button"
        :disabled="busy || recruitLoading"
        :aria-label="recruitBadge > 0 ? `招贤台（还可招募 ${recruitBadge} 人）` : '招贤台'"
        :title="recruitBadge > 0 ? `还可招募 ${recruitBadge} 人（弟子上限 − 现有门人）` : '张榜招贤'"
        @click="requestRecruit"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-6.5 9.5a6.5 6.5 0 0 1 13 0M18 14.5v6m3-3h-6" />
        </svg>
        <span>招贤台</span>
        <span v-if="recruitBadge > 0" class="chip-badge">{{ recruitBadge }}</span>
      </button>
      <button class="action-chip" type="button" @click="openPanel = 'alchemy'">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 3h6M10 3v4.2a6.5 6.5 0 1 0 4 0V3m-4.8 11h9.6" />
        </svg>
        <span>炼丹</span>
      </button>
      <button class="action-chip" type="button" @click="openEquipment">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 4h9l7 7-6 6-7-7V4Zm3 3h.01M15 18l2.5 2.5M18 15l2.5 2.5" />
        </svg>
        <span>炼器</span>
      </button>
      <button class="action-chip" type="button" @click="openPanel = 'defense-lineup'">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3.2 5 6.3v5.2c0 4.1 2.9 7.8 7 9.3 4.1-1.5 7-5.2 7-9.3V6.3L12 3.2Zm-3 8.6h6" />
        </svg>
        <span>守擂阵容</span>
      </button>
      <button class="action-chip" type="button" @click="openPanel = 'explore'">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm3.4 5.6-2.1 5-5 2.1 2.1-5 5-2.1Z" />
        </svg>
        <span>秘境探索</span>
      </button>
      <button
        class="action-chip"
        type="button"
        aria-label="讨伐：全服共讨妖王"
        title="每日 08:00 妖王降临，全服共讨"
        @click="openPanel = 'world-boss'"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M14.5 3.2 20.8 9.5 9.6 20.7 3.3 21l.3-6.3L14.5 3.2Zm-8.6 12.5 3.4 3.4M16.2 6.9l1 1" />
        </svg>
        <span>讨伐</span>
        <span v-if="state.worldBoss?.attackable" class="chip-badge">!</span>
      </button>
      <button class="action-chip" type="button" aria-label="功勋兑换" @click="openPanel = 'merit'">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 3h8l-1.5 5h-5L8 3Zm4 5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm0 3.2 1.1 2.2 2.4.35-1.75 1.7.4 2.4L12 16.7l-2.15 1.15.4-2.4-1.75-1.7 2.4-.35L12 11.2Z" />
        </svg>
        <span>功勋</span>
      </button>
      <button class="action-chip" type="button" @click="openPanel = 'gambling'">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 5h14v14H5zM8.5 9h.01M12 12h.01M15.5 15h.01" />
        </svg>
        <span>赌坊</span>
      </button>
      <button class="action-chip" type="button" @click="openPanel = 'shop'">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 4.2v14.6M4.4 7.6h15.2M8.4 18.8h7.2M4.4 7.6 2.4 12.4h4L4.4 7.6Zm15.2 0-2 4.8h4l-2-4.8Z" />
        </svg>
        <span>坊市</span>
      </button>
    </nav>

    <div class="management-grid">
      <section class="game-panel disciple-panel" aria-labelledby="disciple-title">
        <header class="section-heading panel-heading">
          <h2 id="disciple-title" class="home-section-title">弟子修行</h2>
          <span class="count-badge">{{ state.disciples.length }} 位门人</span>
        </header>

        <DiscipleRoster
          :disciples="state.disciples"
          :assignments="state.assignments"
          :server-now-ms="serverNowMs"
          :live-cultivation="liveCultivation"
          :busy="busy"
          :detail-id="detailId"
          :breakthrough-confirm-id="breakthroughConfirmId"
          @open-detail="openDetail"
          @request-breakthrough="onRequestBreakthrough"
          @request-batch-breakthrough="openBatchBreakthrough"
          @batch-assign="onBatchAssign"
          @quick-heal="onQuickHeal"
          @request-batch-heal="openBatchHeal"
        />
      </section>

      <aside class="management-rail">
        <ChatPanel />
        <section v-if="state.sectUpgrade" class="game-panel sect-upgrade-panel" aria-labelledby="sect-upgrade-title">
          <header class="section-heading panel-heading compact-heading">
            <h2 id="sect-upgrade-title" class="home-section-title">{{ state.sectUpgrade.nextLevelName }}</h2>
            <span class="count-badge">{{ state.sect.level }}/{{ MAX_SECT_LEVEL }}</span>
          </header>

          <div class="upgrade-body">
            <ul class="upgrade-requirements">
              <li v-for="req in state.sectUpgrade.requirements" :key="req.label" class="requirement-row">
                <span class="requirement-mark" :class="req.met ? 'req-met' : 'req-unmet'" aria-hidden="true">{{ req.met ? '✓' : '✗' }}</span>
                <span class="requirement-label">{{ req.label }}</span>
              </li>
            </ul>

            <p class="upgrade-cost">
              <span class="eyebrow">消耗</span>
              <span>{{ costText(state.sectUpgrade.cost) }}</span>
            </p>

            <button
              class="action-button primary-action sect-upgrade-button"
              :class="{ 'is-disabled': !state.sectUpgrade.canUpgrade }"
              type="button"
              :disabled="busy"
              :aria-disabled="!state.sectUpgrade.canUpgrade"
              @click="requestUpgradeSect"
            >
              <span>晋升宗门</span>
            </button>

            <p v-if="state.sectUpgrade.blockedReason" class="blocked-hint">{{ state.sectUpgrade.blockedReason }}</p>
          </div>
        </section>
        <section class="game-panel building-panel" aria-labelledby="building-title">
          <header class="section-heading panel-heading compact-heading">
            <h2 id="building-title" class="home-section-title">山门建筑</h2>
            <span class="count-badge">{{ state.buildings.length }}/{{ state.sect.buildingCapacity }}</span>
          </header>

          <ul v-if="state.buildings.length > 0" class="building-list">
            <li v-for="building in state.buildings" :key="building.defId" class="building-card">
              <div class="building-glyph" aria-hidden="true">{{ buildingGlyph(building.defId) }}</div>
              <div class="building-copy">
                <div>
                  <strong>{{ building.name }}</strong>
                  <span
                    v-for="(glyph, index) in levelGlyphsFor(building)"
                    :key="index"
                    :class="{ dim: building.level < index + 1 }"
                  >{{ glyph }}</span>
                </div>
                <p>{{ buildingDescription(building.defId) }}</p>
                <small>{{ costText(building.upgradeCost) }}</small>
              </div>
              <button
                class="upgrade-button"
                :class="{ 'is-disabled': !building.canUpgrade }"
                type="button"
                :disabled="busy"
                :aria-disabled="!building.canUpgrade"
                :aria-label="`升级${building.name}`"
                @click="requestUpgrade(building)"
              >
                <span>{{ building.level >= building.maxLevel ? '满级' : '升级' }}</span>
                <svg v-if="building.level < building.maxLevel" viewBox="0 0 18 18" aria-hidden="true">
                  <path d="m5 11 4-4 4 4" />
                </svg>
              </button>
            </li>
          </ul>

          <div v-else class="empty-state compact-empty">
            <span aria-hidden="true">山</span>
            <strong>暂无建筑</strong>
          </div>
        </section>
      </aside>
    </div>

    <footer class="game-footer">
      <span>天地法则由服务端裁定</span>
      <i aria-hidden="true" />
      <span>宗门每六十息自动同步</span>
      <i aria-hidden="true" />
      <span>离线期间亦会持续修行</span>
    </footer>
    <ModalShell v-if="openPanel === 'events'" label="近期异象" @close="openPanel = null">
      <EventLogPanel :state="state" />
    </ModalShell>

    <ModalShell
      v-if="openPanel === 'explore'"
      label="秘境探索"
      :loading="exploreRealmLoading"
      loading-text="正在确认秘境信息"
      @close="openPanel = null"
    >
      <ExplorePanel
        :state="state"
        :busy="busy"
        @select="onSelectRealm"
        @explore-start="onExploreStartRequest"
        @explore-resume="onExploreResume"
      />
    </ModalShell>

    <!-- 炼丹：解锁/库存/canCraft 都由服务端算好，只保留炼制；弟子服药入口已移入弟子详情。 -->
    <ModalShell
      v-if="openPanel === 'alchemy'"
      label="炼丹"
      :loading="busy"
      loading-text="正在炼制丹药"
      @close="openPanel = null"
    >
      <AlchemyPanel
        :state="state"
        :busy="busy"
        @craft="onCraftPill"
      />
    </ModalShell>

    <!--
      炼器 / 背包：装备视图只在打开时拉一次（GET /game/equipment，不做定时轮询），
      炼器与分解由本组件调接口，回执里的 state 交给 App 统一赋值（见 handOffEquipmentState）。
    -->
    <ModalShell
      v-if="openPanel === 'equipment'"
      label="炼器"
      :loading="equipmentSubmitting"
      loading-text="正在开炉炼器"
      @close="openPanel = null"
    >
      <EquipmentDialog
        v-if="equipment"
        :state="state"
        :equipment="equipment"
        :busy="busy || equipmentSubmitting"
        @forge="onForgeEquipment"
      />
      <LoadingState v-else label="正在清点宗门装备" />
    </ModalShell>

    <ModalShell
      v-if="openPanel === 'bag'"
      label="背包"
      :loading="equipmentSubmitting"
      loading-text="正在分解装备"
      @close="openPanel = null"
    >
      <BagDialog
        v-if="equipment"
        :state="state"
        :equipment="equipment"
        :busy="busy || equipmentSubmitting"
        @salvage="onSalvageEquipment"
      />
      <LoadingState v-else label="正在清点宗门装备" />
    </ModalShell>

    <!-- 选人出征：叠在秘境列表之上，Esc / 点遮罩只关这一层。 -->
    <ModalShell
      v-if="exploreRealm"
      narrow
      :loading="busy"
      loading-text="正在派遣弟子出发"
      :label="`选择弟子 · ${exploreRealm.name}`"
      @close="exploreRealm = null"
    >
      <ExplorePartyDialog
        :realm="exploreRealm"
        :state="state"
        :busy="busy"
        @explore="onPartyExplore"
      />
    </ModalShell>

    <!--
      V6 交互探索：叠在秘境列表之上（Esc 只关这一层）。
      整场结束时服务端会把 state.activeExploration 置空，此时靠 lastExploration 快照
      把「总入账奖励 + 完成」这一屏撑到玩家收下为止。
    -->
    <ModalShell
      v-if="exploreDialogOpen && explorationShown"
      :loading="busy"
      loading-text="正在裁定秘境结果"
      :label="`秘境探索 · ${explorationShown.realmName}`"
      @close="onCloseExploreDialog"
    >
      <RealmExploreDialog
        :state="state"
        :exploration="explorationShown"
        :busy="busy"
        :result="exploreResult"
        @choose="onExploreChoose"
        @abandon="onExploreAbandon"
        @close="onCloseExploreDialog"
        @dismiss-result="onDismissExploreResult"
      />
    </ModalShell>

    <ModalShell v-if="openPanel === 'leaderboard'" label="江湖榜" @close="openPanel = null">
      <LeaderboardPanel :state="state" :busy="busy" @challenge="onChallengeRequest" />
    </ModalShell>

    <ModalShell v-if="openPanel === 'disciple-leaderboard'" label="天骄榜" @close="openPanel = null">
      <DiscipleLeaderboardPanel :busy="busy" />
    </ModalShell>

    <ModalShell
      v-if="openPanel === 'defense-lineup'"
      label="守擂阵容"
      :loading="busy"
      loading-text="正在保存守擂阵容"
      @close="openPanel = null"
    >
      <DefenseLineupPanel :state="state" :busy="busy" @set-lineup="onSetLineupChoice" />
    </ModalShell>

    <ModalShell v-if="openPanel === 'challenge-history'" label="演武录" @close="openPanel = null">
      <ChallengeHistoryPanel :state="state" />
    </ModalShell>

    <!-- 赌坊：每个玩法一个阶段，都在同一弹窗里切换；结果由 App.vue 回填（论道 / 天机轮各一份）。 -->
    <ModalShell
      v-if="openPanel === 'gambling'"
      :loading="busy"
      :loading-text="gamblingLoadingText"
      label="赌坊"
      @close="onCloseGambling"
    >
      <GamblingHouseDialog
        :state="state"
        :busy="busy"
        :result="daoDebateResult"
        :wheel-result="wheelResult"
        @debate="onDaoDebate"
        @wheel-spin="onWheelSpin"
        @wheel-reset="onWheelReset"
        @wheel-reveal="onWheelRevealed"
        @race-state-update="(s: SectStateView) => emit('recruited', s)"
        @race-notify="onRaceNotify"
        @race-bet-pending="onRaceBetPending"
        @game="onGamblingGame"
        @close="onCloseGambling"
        @reveal="onGamblingRevealed"
      />
    </ModalShell>
  <!-- 功勋兑换：价目打开时拉一次；兑换回执里的 state 交给 App，兑到装备顺手刷新背包件数。 -->
  <ModalShell v-if="openPanel === 'merit'" :loading="busy" label="功勋" @close="openPanel = null">
    <MeritDialog
      :state="state"
      :busy="busy"
      @state-update="(s: SectStateView) => emit('recruited', s)"
      @notify="onWorldBossNotify"
      @equipment-changed="loadEquipment"
    />
  </ModalShell>

  <!-- 0025 世界 Boss（讨伐）：只在打开时 / 出手后 / 点刷新时请求，不做定时轮询。 -->
  <ModalShell
    v-if="openPanel === 'world-boss'"
    :loading="busy"
    label="讨伐"
    @close="openPanel = null"
  >
    <WorldBossDialog
      :state="state"
      :busy="busy"
      @state-update="(s: SectStateView) => emit('recruited', s)"
      @notify="onWorldBossNotify"
    />
  </ModalShell>

    <!--
      坊市：三笔交易都在 ShopDialog 里当场算预览，接口调用与 toast 在本组件；
      回执里的 state 交给 App 统一赋值（见 handOffShopState），交易成功留在当前标签页。
    -->
    <ModalShell
      v-if="openPanel === 'shop'"
      :loading="shopSubmitting"
      loading-text="正在与坊市交割"
      label="坊市"
      @close="openPanel = null"
    >
      <ShopDialog
        :state="state"
        :busy="busy || shopSubmitting"
        @buy="onShopBuy"
        @sell="onShopSell"
        @sell-pill="onShopSellPill"
      />
    </ModalShell>

    <!-- 登门挑战：叠在江湖榜 / 公开档案之上，Esc 只关这一层；打完原地切成战报态。 -->
    <ModalShell
      v-if="challengeTarget"
      narrow
      :loading="busy"
      loading-text="正在等待挑战结果"
      :label="`挑战 · ${challengeTarget.name}`"
      @close="onCloseChallengeDialog"
    >
      <ChallengeDialog
        :target="challengeTarget"
        :state="state"
        :busy="busy"
        :result="challengeResult"
        @challenge="onChallengeSubmit"
        @close="onCloseChallengeDialog"
      />
    </ModalShell>

    <!--
      招贤台：点「张榜招贤」拉到候选人后才打开。
      提交与批次过期重拉都在本组件（见 onRecruitChoose / recoverExpiredBatch），
      App.vue 只收写库后的 state；提交在途时整张弹窗的候选卡与「换一批」一起锁住。
    -->
    <ModalShell
      v-if="showRecruitDialog"
      label="招贤台"
      :loading="recruitLoading || recruitRefreshing || recruitSubmitting"
      :loading-text="recruitLoadingText"
      @close="showRecruitDialog = false"
    >
      <RecruitDialog
        v-if="recruitPreview"
        :preview="recruitPreview"
        :cost-text="costText(state.recruit.cost)"
        :busy="busy || recruitRefreshing || recruitSubmitting"
        :refreshing="recruitRefreshing"
        :submitting="recruitSubmitting"
        @choose="onRecruitChoose"
        @refresh="requestRecruitRefresh"
      />
    </ModalShell>

    <!--
      弟子详情：只存 discipleId，每次渲染都从最新 state.disciples 取对象（不缓存快照）；
      key 绑定 id，切换弟子时重置内部草稿（备注、驱逐确认步）。驱逐成功后该 id 从 state 里
      消失，watch 会关掉弹窗并把焦点还给名册里对应的「详情」按钮。
    -->
    <ModalShell
      v-if="detailDisciple"
      fixed-height
      :loading="busy || equipmentSubmitting"
      loading-text="正在处理弟子事务"
      :label="`弟子详情 · ${detailDisciple.name}`"
      @close="closeDetail"
    >
      <DiscipleDetailDialog
        :key="detailDisciple.id"
        :state="state"
        :disciple="detailDisciple"
        :busy="busy || equipmentSubmitting"
        :live-cultivation="liveCultivation[detailDisciple.id] ?? null"
        :journey-preview="journeyPreview"
        :journey-preview-loading="journeyPreviewLoading"
        :journey-recent="state.journey.recent"
        :local-now-ms="localNowMs"
        :equipment="equipment"
        @assign="onDetailAssign"
        @breakthrough="onDetailBreakthrough"
        @use-pill="onUsePill"
        @save-note="onDetailSaveNote"
        @expel="onDetailExpel"
        @request-journey-preview="onDetailRequestJourneyPreview"
        @start-journey="onDetailStartJourney"
        @claim-journey="onDetailClaimJourney"
        @notify="onDetailNotify"
        @set-avatar-frame="onDetailSetAvatarFrame"
        @allocate-dao-insight="onDetailAllocateDaoInsight"
        @rename-disciple="onDetailRenameDisciple"
        @equip="onDetailEquip"
        @unequip="onDetailUnequip"
      />
    </ModalShell>

    <!--
      名册头像的破境确认：唯一会发 /game/breakthrough 的入口是「确认破境」。
      取消 / Esc / 点遮罩只关这一层，不发请求；资格以服务端字段为准并随 state 即时更新。
    -->
    <ModalShell
      v-if="breakthroughTarget"
      narrow
      :loading="busy"
      loading-text="正在等待破境结果"
      :label="`破境确认 · ${breakthroughTarget.name}`"
      @close="closeBreakthroughConfirm"
    >
      <section class="disciple-break-confirm" aria-labelledby="disciple-break-confirm-title">
        <header class="section-heading panel-heading compact-heading">
          <div>
            <p class="eyebrow">破境确认</p>
            <h2 id="disciple-break-confirm-title">{{ breakthroughTarget.name }}</h2>
          </div>
          <span class="count-badge">{{ breakthroughTarget.stageName }}</span>
        </header>

        <dl class="disciple-facts">
          <div>
            <dt>破境胜算</dt>
            <dd>{{ formatBp(breakthroughTarget.breakthroughChanceBp) }}</dd>
          </div>
          <div>
            <dt>灵气消耗</dt>
            <dd>{{ formatAmount(breakthroughTarget.breakthroughCost) }} {{ breakthroughEnergyName }}</dd>
          </div>
        </dl>

        <!-- 失败后果只做定性说明（消耗的灵气不退、修为跌落、进入调息），不复刻服务端公式。 -->
        <p class="disciple-detail-hint">
          失败后果：本次消耗的{{ breakthroughEnergyName }}不退，修为会跌落到本阶段的保底值，并进入调息；
          调息结束前不能再次破境。
        </p>

        <p v-if="!breakthroughTarget.canBreakthrough" class="blocked-hint">
          {{ breakthroughTarget.blockedReason ?? '当前条件尚未满足，暂时无法破境。' }}
        </p>

        <div class="disciple-break-confirm-actions">
          <button class="action-button" type="button" :disabled="busy" @click="closeBreakthroughConfirm">
            取消
          </button>
          <button
            class="action-button primary-action"
            type="button"
            :disabled="busy || !breakthroughTarget.canBreakthrough"
            :aria-disabled="!breakthroughTarget.canBreakthrough"
            @click="confirmBreakthrough"
          >
            <span>{{ busy ? '破境中…' : '确认破境' }}</span>
          </button>
        </div>
      </section>
    </ModalShell>

    <!-- 名册多选 · 批量破境确认：列出可破境与将被跳过的弟子、整批灵气消耗；灵气不够时不能提交。 -->
    <ModalShell
      v-if="batchBreakthroughIds !== null"
      narrow
      :loading="busy"
      loading-text="正在逐一破境"
      label="批量破境确认"
      @close="closeBatchBreakthrough"
    >
      <section class="disciple-break-confirm" aria-labelledby="batch-break-confirm-title">
        <header class="section-heading panel-heading compact-heading">
          <div>
            <p class="eyebrow">批量破境</p>
            <h2 id="batch-break-confirm-title">{{ batchBreakthroughReady.length }} 名弟子可破境</h2>
          </div>
          <span class="count-badge">已选 {{ batchBreakthroughSelected.length }} 人</span>
        </header>

        <dl v-if="batchBreakthroughReady.length > 0" class="disciple-facts">
          <div>
            <dt>每人胜算</dt>
            <dd>{{ formatBp(batchBreakthroughChanceBp) }}</dd>
          </div>
          <div>
            <dt>{{ breakthroughEnergyName }}消耗</dt>
            <dd>
              {{ formatAmount(batchBreakthroughCost) }}
              <span class="batch-break-balance">/ 现有 {{ formatAmount(batchBreakthroughEnergy) }}</span>
            </dd>
          </div>
        </dl>

        <ul v-if="batchBreakthroughReady.length > 0" class="batch-break-list">
          <li v-for="disciple in batchBreakthroughReady" :key="disciple.id">
            <span class="batch-break-name">{{ disciple.name }}</span>
            <span class="realm-tag">{{ disciple.stageName }}</span>
            <span class="batch-break-cost">{{ formatAmount(disciple.breakthroughCost) }} {{ breakthroughEnergyName }}</span>
          </li>
        </ul>

        <div v-if="batchBreakthroughSkipped.length > 0" class="batch-break-skipped">
          <p class="eyebrow">以下 {{ batchBreakthroughSkipped.length }} 人不满足条件，将被跳过</p>
          <ul>
            <li v-for="disciple in batchBreakthroughSkipped" :key="disciple.id">
              {{ disciple.name }}：{{ disciple.blockedReason ?? '当前条件尚未满足' }}
            </li>
          </ul>
        </div>

        <p class="disciple-detail-hint">
          失败后果：本次消耗的{{ breakthroughEnergyName }}不退，修为会跌落到本阶段的保底值，并进入调息；
          调息结束前不能再次破境。
        </p>

        <p v-if="batchBreakthroughReady.length === 0" class="blocked-hint">所选弟子都不满足突破条件。</p>
        <p v-else-if="!batchBreakthroughAffordable" class="blocked-hint">
          {{ breakthroughEnergyName }}不足，请减少突破弟子数量。
        </p>

        <div class="disciple-break-confirm-actions">
          <button class="action-button" type="button" :disabled="busy" @click="closeBatchBreakthrough">
            取消
          </button>
          <button
            class="action-button primary-action"
            type="button"
            :disabled="busy || batchBreakthroughReady.length === 0 || !batchBreakthroughAffordable"
            @click="confirmBatchBreakthrough"
          >
            <span>{{ busy ? '破境中…' : `确认破境（${batchBreakthroughReady.length} 人）` }}</span>
          </button>
        </div>
      </section>
    </ModalShell>

    <!-- 名册多选 · 批量疗伤确认：列出要治的伤员与将被跳过的弟子、回春丹消耗；库存不够时整批不能提交。 -->
    <ModalShell
      v-if="batchHealIds !== null"
      narrow
      :loading="busy"
      loading-text="正在服用回春丹"
      label="批量疗伤确认"
      @close="closeBatchHeal"
    >
      <section class="disciple-break-confirm" aria-labelledby="batch-heal-confirm-title">
        <header class="section-heading panel-heading compact-heading">
          <div>
            <p class="eyebrow">批量疗伤</p>
            <h2 id="batch-heal-confirm-title">{{ batchHealRows.healable.length }} 名弟子待疗伤</h2>
          </div>
          <span class="count-badge">已选 {{ batchHealIds.length }} 人</span>
        </header>

        <dl v-if="batchHealRows.healable.length > 0" class="disciple-facts">
          <div>
            <dt>{{ healingPillName }}消耗</dt>
            <dd>
              {{ batchHealRows.healable.length }} 颗
              <span class="batch-break-balance">/ 库存 {{ healingPillOwned }} 颗</span>
            </dd>
          </div>
        </dl>

        <ul v-if="batchHealRows.healable.length > 0" class="batch-break-list">
          <li v-for="disciple in batchHealRows.healable" :key="disciple.id">
            <span class="batch-break-name">{{ disciple.name }}</span>
            <span class="realm-tag">{{ disciple.stageName }}</span>
            <span class="batch-break-cost">疗伤至 {{ formatTime(disciple.injuredUntil) }}</span>
          </li>
        </ul>

        <div v-if="batchHealRows.skipped.length > 0" class="batch-break-skipped">
          <p class="eyebrow">以下 {{ batchHealRows.skipped.length }} 人不需要或不能服用，将被跳过</p>
          <ul>
            <li v-for="item in batchHealRows.skipped" :key="item.disciple.id">
              {{ item.disciple.name }}：{{ item.reason }}
            </li>
          </ul>
        </div>

        <p v-if="batchHealRows.healable.length === 0" class="blocked-hint">所选弟子都不需要疗伤。</p>
        <p v-else-if="!batchHealAffordable" class="blocked-hint">
          {{ healingPillName }}不足：需要 {{ batchHealRows.healable.length }} 颗，库存 {{ healingPillOwned }} 颗，请减少人数或先炼制。
        </p>

        <div class="disciple-break-confirm-actions">
          <button class="action-button" type="button" :disabled="busy" @click="closeBatchHeal">取消</button>
          <button
            class="action-button primary-action"
            type="button"
            :disabled="busy || batchHealRows.healable.length === 0 || !batchHealAffordable"
            @click="confirmBatchHeal"
          >
            <span>{{ busy ? '服丹中…' : `确认疗伤（${batchHealRows.healable.length} 人）` }}</span>
          </button>
        </div>
      </section>
    </ModalShell>

    <ChangelogDialog v-if="showChangelog" @close="showChangelog = false" />

    <AccountDialog
      v-if="showAccountDialog"
      :sect-name="state.sect.name"
      @close="showAccountDialog = false"
      @notify="(tone, title, message) => emit('notify', tone, title, message)"
    />

    <!--
      0021 宗门改名：二级弹窗（不做底栏）。价格与长度规则来自 state.rename；
      成功后服务端回填新名字，watch 会自动关掉这一层（失败时保持打开，错误由 App.vue 提示）。
    -->
    <ModalShell
      v-if="showRenameDialog"
      narrow
      :loading="busy"
      loading-text="正在更换山门牌匾"
      label="宗门改名"
      @close="closeRenameDialog"
    >
      <section class="disciple-break-confirm" aria-labelledby="sect-rename-title">
        <header class="section-heading panel-heading compact-heading">
          <div>
            <p class="eyebrow">宗门改名</p>
            <h2 id="sect-rename-title">{{ state.sect.name }}</h2>
          </div>
          <span class="count-badge">{{ renameLength }}/{{ state.rename.sectNameMaxChars }}</span>
        </header>

        <div class="disciple-note-row">
          <input
            class="disciple-input"
            type="text"
            aria-label="宗门名称"
            :placeholder="renameRangeLabel"
            :value="renameDraft"
            @input="onRenameInput"
          />
        </div>

        <p
          class="disciple-note-meta"
          :class="{ 'is-error': renameInvalid || !renameAffordable }"
          role="status"
        >
          {{ renameLength }}/{{ state.rename.sectNameMaxChars }} 字 · 一次 {{ renameCostLabel }} 灵石 ·
          {{ renameHint }}
        </p>

        <div class="disciple-break-confirm-actions">
          <button class="action-button" type="button" :disabled="busy" @click="closeRenameDialog">
            取消
          </button>
          <button
            class="action-button primary-action"
            type="button"
            :disabled="busy || !renameDirty || renameInvalid || !renameAffordable"
            @click="submitRenameSect"
          >
            <span>{{ busy ? '改名中…' : '确认改名' }}</span>
          </button>
        </div>
      </section>
    </ModalShell>
  </main>
</template>
