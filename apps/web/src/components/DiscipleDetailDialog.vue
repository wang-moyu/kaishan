<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';

import type {
  AlchemyRecipeView,
  DaoAttribute,
  DiscipleJourneyView,
  DiscipleView,
  JourneyDirection,
  JourneyDirectionPreviewView,
  JourneyDurationPreviewView,
  JourneyOutcomeView,
  JourneyPreviewView,
  JourneyRecordView,
  SectStateView,
} from '../api/game';
import type { ToastTone } from '../types/ui';
import { formatAmount, formatBp, formatTime } from '../utils/format';
import { NOTE_MAX_LENGTH, cultivationProgress, discipleStatus, isInjured, journeyBadge } from '../utils/discipleFilter';
import {
  AVATAR_FRAME_OPTIONS,
  avatarFrameOption,
  isAvatarFrameId,
  resolveAvatarFrameId,
  type AvatarFrameId,
} from '../utils/avatarFrames';
import AssignmentSelect from './AssignmentSelect.vue';
import DiscipleAvatar from './DiscipleAvatar.vue';
import DiscipleRadarChart from './DiscipleRadarChart.vue';
import LoadingState from './LoadingState.vue';
import ModalShell from './ModalShell.vue';

/**
 * 弟子详情（弹窗内容）：固定紧凑头部 + 四个 Tab（概览 / 修行 / 历练 / 档案）。
 *
 * - 概览：六轴雷达图 + 当前属性与综合评分 + 简短修为摘要（雷达图必须在首 Tab）。
 * - 修行：修为、伤势、岗位、破境（胜算 / 消耗 / 原因）与丹药入口。
 * - 历练：出发预览、在外倒计时、领取归队收获，以及**此弟子**的近期历练记录。
 * - 档案：头像框选取、私有备注、驱逐与二次确认。
 *
 * 组件只拿 `discipleId` 对应的最新对象（由 SectScreen 每次渲染从 `state.disciples` 里取），
 * 自己不发请求、不复制任何服务端判定公式：能不能破境看 `canBreakthrough`，
 * 能不能服药看 `alchemy` 与字段预览，最终裁决都在 `/game/*`。
 * 所有写操作都只 emit，成功后弹窗保持打开并显示服务端回填的新值；
 * 驱逐成功时该弟子会从 `state.disciples` 消失，由 SectScreen 关掉弹窗。
 *
 * 切 Tab 只切面板，不重置本地草稿（备注、头像框、历练方向/时长都留在 ref 里）；
 * Tab 用真正的 tablist / tab / tabpanel，支持方向键与 Home/End。
 */
const props = defineProps<{
  state: SectStateView;
  disciple: DiscipleView;
  busy: boolean;
  /** 每秒本地平滑的修为（只用于显示）；null = 用服务端值。 */
  liveCultivation: number | null;
  /** 0014 历练预览（由 SectScreen 拉取与清理；本组件只渲染，不发请求）。 */
  journeyPreview: JourneyPreviewView | null;
  /** 预览请求在途（决定按钮的「推演中…」文案）。 */
  journeyPreviewLoading: boolean;
  /** 宗门最近历练记录（最多 10 条，来自 state.journey.recent，关掉弹窗也不会丢）。 */
  journeyRecent: JourneyRecordView[];
  /** 本地推进的服务端时钟（归队倒计时只读它，绝不读 Date.now()）。 */
  localNowMs: number;
}>();

const emit = defineEmits<{
  assign: [discipleId: string, assignment: string];
  breakthrough: [discipleId: string];
  usePill: [pillId: string, discipleId: string];
  saveNote: [discipleId: string, note: string];
  /** 0017 保存头像框样式（frameId 只可能是白名单里的固定 id）。 */
  setAvatarFrame: [discipleId: string, frameId: AvatarFrameId];
  /** 0019 分配悟道值（属性六选一 + 点数）：归属、余额与上限由服务端裁决，这里只 emit。 */
  allocateDaoInsight: [discipleId: string, attribute: DaoAttribute, points: number];
  /** 0021 弟子改名（2-6 个码点、一次 50 灵石）：规则与价格都由服务端裁决，这里只 emit。 */
  renameDisciple: [discipleId: string, name: string];
  expel: [discipleId: string];
  /** 0014 历练：拉预览 / 出发 / 领取。组件只 emit，请求与 state 回填都在上层。 */
  requestJourneyPreview: [discipleId: string];
  startJourney: [discipleId: string, direction: JourneyDirection, durationSeconds: number];
  claimJourney: [journeyId: string];
  notify: [tone: ToastTone, title: string, message: string];
}>();

const serverNowMs = computed(() => Date.parse(props.state.serverNow));
const injured = computed(() => isInjured(props.disciple, serverNowMs.value));

const progress = computed(() =>
  cultivationProgress(
    props.liveCultivation ?? props.disciple.cultivation,
    props.disciple.requiredCultivation,
  ),
);

const energyName = computed(
  () => props.state.resources.find((resource) => resource.id === 'spiritualEnergy')?.name ?? '灵气',
);

/* ---------- Tab 容器：真正的 tablist / tab / tabpanel ---------- */

const TABS = [
  { id: 'overview', label: '概览' },
  { id: 'training', label: '修行' },
  { id: 'journey', label: '历练' },
  { id: 'archive', label: '档案' },
] as const;

type TabId = (typeof TABS)[number]['id'];

const activeTab = ref<TabId>('overview');
const tabButtons = ref<Record<string, HTMLButtonElement | null>>({});

function tabButtonId(id: TabId): string {
  return `disciple-tab-${id}`;
}

function tabPanelId(id: TabId): string {
  return `disciple-panel-${id}`;
}

function setTabButton(id: TabId, element: Element | null): void {
  if (element instanceof HTMLButtonElement) tabButtons.value[id] = element;
  else delete tabButtons.value[id];
}

/** 方向键 / Home / End 在四个 Tab 之间移动（自动激活，焦点跟着走）。 */
function onTabKeydown(event: KeyboardEvent, current: TabId): void {
  const index = TABS.findIndex((tab) => tab.id === current);
  if (index < 0) return;
  let nextIndex = -1;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % TABS.length;
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    nextIndex = (index - 1 + TABS.length) % TABS.length;
  } else if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = TABS.length - 1;
  else return;

  const target = TABS[nextIndex];
  if (target === undefined) return;
  event.preventDefault();
  activeTab.value = target.id;
  void nextTick(() => tabButtons.value[target.id]?.focus());
}

/* ---------- 头部：姓名 / 境界 / 头像框 / 状态 ---------- */

/** 头部状态：在外或待领取时优先显示历练状态（含剩余时间），否则用现有状态优先级。 */
const headerStatus = computed(() => journeyBadge(props.disciple.journey, serverNowMs.value));
const headerStatusLabel = computed(
  () => headerStatus.value ?? discipleStatus(props.disciple, serverNowMs.value).label,
);

/* ---------- 私有备注：单行 input，保存时 trim，空串 = 清空 ---------- */

const noteDraft = ref(props.disciple.note);
const serverNote = computed(() => props.disciple.note);
const noteLength = computed(() => Array.from(noteDraft.value).length);
const noteTooLong = computed(() => noteLength.value > NOTE_MAX_LENGTH);
/** 与服务端已保存内容（trim 后）不同才允许保存。 */
const noteDirty = computed(() => noteDraft.value.trim() !== serverNote.value);

// 服务端返回了新备注（保存成功、或服务端做了 trim）而本地没有未保存改动时，跟随服务端值。
watch(serverNote, (next) => {
  if (!noteDirty.value) noteDraft.value = next;
});

function onNoteInput(event: Event): void {
  noteDraft.value = (event.target as HTMLInputElement).value;
}

function saveNote(): void {
  if (props.busy || !noteDirty.value || noteTooLong.value) return;
  const note = noteDraft.value.trim();
  noteDraft.value = note;
  emit('saveNote', props.disciple.id, note);
}

/* ---------- 0021 改名：2-6 个码点、一次 50 灵石（长度规则与价格都来自 state.rename） ---------- */

const renameDraft = ref(props.disciple.name);
const serverName = computed(() => props.disciple.name);
// 与服务端同一口径：先 trim 再按码点计数（否则「 甲 」在前端算 3 字、服务端按 1 字拒绝）。
const renameLength = computed(() => Array.from(renameDraft.value.trim()).length);
const renameRangeLabel = computed(
  () =>
    `${String(props.state.rename.discipleNameMinChars)}~${String(
      props.state.rename.discipleNameMaxChars,
    )} 个字`,
);
/** 少于下限即非法（空串也要拦：不能把「清空输入框」当成合法提交）。 */
const renameTooShort = computed(
  () => renameLength.value < props.state.rename.discipleNameMinChars,
);
const renameTooLong = computed(() => renameLength.value > props.state.rename.discipleNameMaxChars);
const renameInvalid = computed(() => renameTooShort.value || renameTooLong.value);
/** trim 后与当前姓名不同才允许提交（同名请求服务端会早退，不扣费也不写库）。 */
const renameDirty = computed(() => renameDraft.value.trim() !== serverName.value);
/** 灵石够不够：只决定按钮可用性，余额校验与扣费都由服务端裁决。 */
const renameAffordable = computed(() => {
  // 资源 id 与 SectScreen 的配色判断用同一个字面量（服务端 resourceId 契约）。
  const balance = Number(
    props.state.resources.find((item) => item.id === 'spiritStone')?.balance ?? 0,
  );
  return balance >= Number(props.state.rename.discipleCost);
});
const renameCostLabel = computed(() => formatAmount(props.state.rename.discipleCost));
const renameHint = computed(() => {
  if (renameInvalid.value) return `姓名需 ${renameRangeLabel.value}`;
  if (!renameAffordable.value) return '灵石不足';
  return '旧记录仍保留改名前的姓名';
});

// 服务端回填了新姓名（改名成功）而本地没有未保存改动时跟随服务端。
watch(serverName, (next) => {
  if (!renameDirty.value) renameDraft.value = next;
});

function onRenameInput(event: Event): void {
  renameDraft.value = (event.target as HTMLInputElement).value;
}

function submitRename(): void {
  if (props.busy || !renameDirty.value || renameInvalid.value || !renameAffordable.value) return;
  emit('renameDisciple', props.disciple.id, renameDraft.value.trim());
}

/* ---------- 0017 头像框：固定白名单单选，保存后由服务端回填 ---------- */

/** 服务端当前值：未知 id 按旧样式显示（不渲染空白，也不接受任意 URL）。 */
const serverFrameId = computed<AvatarFrameId>(() => resolveAvatarFrameId(props.disciple.avatarFrameId));
const frameDraft = ref<AvatarFrameId>(serverFrameId.value);
const frameDirty = computed(() => frameDraft.value !== serverFrameId.value);

// 服务端回填了新样式、且本地没有未保存改动时跟随服务端（保存成功 / 别处改了状态）。
watch(serverFrameId, (next) => {
  if (!frameDirty.value) frameDraft.value = next;
});

function onFrameChange(event: Event): void {
  const value = (event.target as HTMLInputElement).value;
  // 只接受白名单：非法值直接忽略，不写进草稿（服务端同样会拒绝）。
  if (isAvatarFrameId(value)) frameDraft.value = value;
}

function saveAvatarFrame(): void {
  if (props.busy || !frameDirty.value) return;
  emit('setAvatarFrame', props.disciple.id, frameDraft.value);
}

const frameCurrentLabel = computed(() => avatarFrameOption(frameDraft.value).label);

/* ---------- 0019 悟道值加点：目标属性六选一 + 点数 ---------- */

/**
 * 总分配上限：直接由服务端字段推导（daoInsightUsed + daoInsightRemaining），
 * 不在前端另造 50 这个常量（与 apps/server/src/modules/game/gambling.ts 的 DAO_INSIGHT_CAP 同口径）。
 */
const daoInsightCap = computed(() => props.disciple.daoInsightUsed + props.disciple.daoInsightRemaining);

/** 属性上限：与 apps/server/src/modules/game/gambling.ts 的 ATTRIBUTE_MAX 同口径。 */
const ATTRIBUTE_MAX = 100;

/** 可加点属性（展示沿用雷达图的名词：speed 记为「身法」）。 */
const DAO_ATTRIBUTE_OPTIONS: readonly { value: DaoAttribute; label: string }[] = [
  { value: 'attack', label: '攻击' },
  { value: 'defense', label: '防御' },
  { value: 'speed', label: '身法' },
  { value: 'aptitude', label: '资质' },
  { value: 'luck', label: '幸运' },
  { value: 'physique', label: '体魄' },
];

const daoAttribute = ref<DaoAttribute>('attack');
const daoPointsInput = ref('1');

const daoAttributeValue = computed(() => props.disciple[daoAttribute.value]);

/** 本次可分配上限：可用悟道值 / 剩余分配额度 / 属性 100 上限三者取最小；用 Math.max(1, …) 防出现 0 上限。 */
const daoPointsMax = computed(() =>
  Math.max(
    1,
    Math.min(
      props.disciple.daoInsight,
      props.disciple.daoInsightRemaining,
      ATTRIBUTE_MAX - daoAttributeValue.value,
    ),
  ),
);

/** 是否还有可分配空间（可用悟道值、累计额度、属性未到 100 三者都要满足）。 */
const daoAllocatable = computed(
  () =>
    props.disciple.daoInsight > 0 &&
    props.disciple.daoInsightRemaining > 0 &&
    ATTRIBUTE_MAX - daoAttributeValue.value > 0,
);

const daoPoints = computed(() => Math.floor(Number(daoPointsInput.value)));
const daoPointsValid = computed(
  () => Number.isInteger(daoPoints.value) && daoPoints.value >= 1 && daoPoints.value <= daoPointsMax.value,
);

// 上限变化（换属性 / 服务端回填新状态）后把超额的草稿收回到上限，避免按钮无缘无故变灰。
watch(daoPointsMax, (max) => {
  const current = Number(daoPointsInput.value);
  if (!Number.isFinite(current) || current < 1 || current > max) daoPointsInput.value = String(max);
});

const showDaoInsightHelp = ref(false);

function allocateDaoInsight(): void {
  if (props.busy || !daoAllocatable.value || !daoPointsValid.value) return;
  emit('allocateDaoInsight', props.disciple.id, daoAttribute.value, daoPoints.value);
}

/* ---------- 破境：判定与胜算/消耗全部来自服务端 ---------- */

function requestBreakthrough(): void {
  if (props.busy) return;
  if (!props.disciple.canBreakthrough) {
    emit(
      'notify',
      'warning',
      `${props.disciple.name}暂不可突破`,
      props.disciple.blockedReason ?? '当前条件尚未满足。',
    );
    return;
  }
  emit('breakthrough', props.disciple.id);
}

/* ---------- 0014 历练：状态、方向/时长选择与归队倒计时 ---------- */

/** 服务端给的历练状态与名额：本组件不复制任何门槛、奖励或概率公式。 */
const journey = computed<DiscipleJourneyView>(() => props.disciple.journey);
const outcome = computed<JourneyOutcomeView | null>(() => props.disciple.journey.outcome);

/** 资源 id → 名字（名字只在服务端的资源表里，前端不硬编码）。 */
const resourceNames = computed<Record<string, string>>(() =>
  Object.fromEntries(props.state.resources.map((resource) => [resource.id, resource.name])),
);

function resourceLabel(resourceId: string): string {
  return resourceNames.value[resourceId] ?? resourceId;
}

/** 奖励条目（名字与数量都格式化好）：模板只渲染，不在 v-for 里做取值判断。 */
interface ResourceLine {
  id: string;
  name: string;
  amount: string;
}

function resourceLines(resources: Record<string, string>): ResourceLine[] {
  return Object.entries(resources).map(([id, amount]) => ({
    id,
    name: resourceLabel(id),
    amount: formatAmount(amount),
  }));
}

/**
 * 出发前的计划器：只有预览属于当前弟子时才生效
 * （切换弟子后残留的旧预览直接忽略，绝不显示别人的数值）。
 */
const planner = computed<JourneyPreviewView | null>(() => {
  const preview = props.journeyPreview;
  if (preview === null || preview.discipleId !== props.disciple.id) return null;
  return preview;
});

/** 选中的方向/时长放在 ref 里：请求失败时保留当前选择，不会被打回默认值。 */
const selectedDirection = ref<JourneyDirection | null>(null);
const selectedDurationSeconds = ref<number | null>(null);

/** 生效方向：显式选中的可用方向，否则回落到第一个可选方向（不可选的不参与）。 */
const activeDirection = computed<JourneyDirectionPreviewView | null>(() => {
  const directions = planner.value?.directions ?? [];
  const picked = directions.find((item) => item.direction === selectedDirection.value);
  if (picked !== undefined && picked.available) return picked;
  return directions.find((item) => item.available) ?? null;
});

const activeDurations = computed<JourneyDurationPreviewView[]>(
  () => activeDirection.value?.durations ?? [],
);

/** 生效时长：显式选中的那一档，否则该方向的第一档（服务端给什么就显示什么）。 */
const activeDuration = computed<JourneyDurationPreviewView | null>(() => {
  const durations = activeDurations.value;
  const picked = durations.find((item) => item.durationSeconds === selectedDurationSeconds.value);
  return picked ?? durations[0] ?? null;
});

/** 这两个是给模板做「选中态」比较的原始值，避免在 v-for 里层层解引用。 */
const activeDirectionId = computed<JourneyDirection | null>(
  () => activeDirection.value?.direction ?? null,
);
const activeDurationSeconds = computed<number | null>(
  () => activeDuration.value?.durationSeconds ?? null,
);

function requestPreview(): void {
  if (props.busy || props.journeyPreviewLoading) return;
  emit('requestJourneyPreview', props.disciple.id);
}

function selectDirection(direction: JourneyDirectionPreviewView): void {
  if (props.busy || !direction.available) return;
  selectedDirection.value = direction.direction;
  // 换了方向后旧时长不一定还在，清空选择让它回落到该方向的第一档。
  selectedDurationSeconds.value = null;
}

function selectDuration(duration: JourneyDurationPreviewView): void {
  if (props.busy) return;
  selectedDurationSeconds.value = duration.durationSeconds;
}

function confirmStart(): void {
  if (props.busy) return;
  const direction = activeDirection.value;
  const duration = activeDuration.value;
  if (direction === null || duration === null) return;
  emit('startJourney', props.disciple.id, direction.direction, duration.durationSeconds);
}

function requestClaim(): void {
  if (props.busy) return;
  const journeyId = journey.value.journeyId;
  if (journeyId === null) return;
  emit('claimJourney', journeyId);
}

/** 修为预览：最高阶段为 0；受当前突破门槛限制时标「最多」（数值都来自服务端）。 */
function cultivationText(duration: JourneyDurationPreviewView): string {
  if (duration.cultivation <= 0) return '修为无增益';
  return `修为 +${duration.cultivation}${duration.cultivationCapped ? '（最多）' : ''}`;
}

/** 时长展示：两档都是整小时，把服务端给的秒数换算成小时。 */
function durationHours(seconds: number | null): string {
  if (seconds === null) return '—';
  return `${Math.round(seconds / 3600)} 小时`;
}

/** 入场错峰：只给前几项延迟，避免长列表末尾等太久（与名册行的做法一致）。 */
function journeyOrderStyle(index: number): Record<string, string> {
  return { '--journey-order': String(Math.min(index, 6)) };
}

/**
 * 在外剩余时间：只用 `localNowMs`（SectScreen 从服务端 serverNow 逐秒推进）计算，
 * 不读 `Date.now()`。归零也只显示「即将归队」——能不能领取由服务端的 status 决定，
 * 前端计时器不能自行判定可领取。
 */
const countdownText = computed<string>(() => {
  const endsAt = journey.value.endsAt;
  if (endsAt === null) return '—';
  const endsAtMs = Date.parse(endsAt);
  if (!Number.isFinite(endsAtMs) || !Number.isFinite(props.localNowMs)) return '—';
  const remainingMs = endsAtMs - props.localNowMs;
  if (remainingMs <= 0) return '即将归队';
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const ss = String(seconds).padStart(2, '0');
  if (hours > 0) return `${hours} 时 ${String(minutes).padStart(2, '0')} 分 ${ss} 秒`;
  return `${minutes} 分 ${ss} 秒`;
});

/** 结果里的伤势是否已过复原时间（过期仍保留「途中受伤」的结果文字）。 */
const outcomeHealed = computed<boolean>(() => {
  const injuredUntil = outcome.value?.injuredUntil ?? null;
  if (injuredUntil === null) return false;
  const until = Date.parse(injuredUntil);
  if (!Number.isFinite(until) || !Number.isFinite(props.localNowMs)) return false;
  return until <= props.localNowMs;
});

const outcomeLines = computed<ResourceLine[]>(() => resourceLines(outcome.value?.resources ?? {}));

/** 在外时被历练挡住的写操作共用这一句原因（规则仍由服务端判定）。 */
const awayHint = computed<string | null>(() =>
  journey.value.status === 'active' ? '在外历练期间不能转岗、破境、服药或再次出发。' : null,
);

/** 驱逐被历练挡住时的原因：在外与待领取措辞分开，玩家才知道下一步该做什么。 */
const expelBlockedHint = computed<string | null>(() => {
  if (journey.value.status === 'active') return '在外历练中不能驱逐，请等他归队。';
  if (journey.value.status === 'ready') return '先领取历练收获后才能驱逐。';
  return null;
});

/** 最近记录：结果文字在这里拼好，模板只渲染。 */
interface JournalEntry {
  id: string;
  discipleName: string;
  directionName: string;
  durationText: string;
  status: JourneyRecordView['status'];
  statusLabel: string;
  resultLines: string[];
}

const RECORD_STATUS_LABELS: Record<JourneyRecordView['status'], string> = {
  active: '在外中',
  ready: '待领取',
  claimed: '已领取',
};

/** 结果摘要：受伤与额外收获都必须有文字，不能只靠 Toast（计划 5）。 */
function recordResultLines(record: JourneyRecordView): string[] {
  const recordOutcome = record.outcome;
  if (recordOutcome === null) {
    return [`预计 ${formatTime(record.endsAt)} 归队，结果到期后可见。`];
  }
  const lines = [
    recordOutcome.cultivationAwarded > 0 ? `修为 +${recordOutcome.cultivationAwarded}` : '修为无增益',
  ];
  for (const entry of resourceLines(recordOutcome.resources)) {
    lines.push(`${entry.name} +${entry.amount}`);
  }
  if (recordOutcome.extraHarvest) lines.push('额外收获');
  if (recordOutcome.injured) lines.push('途中受伤');
  return lines;
}

/**
 * **此弟子**的近期记录：`state.journey.recent` 是宗门最近 10 条（不是个人完整履历），
 * 这里按 `discipleId` 过滤后展示，绝不冒称完整历史，也不为此新增历史接口。
 */
const journal = computed<JournalEntry[]>(() =>
  props.journeyRecent
    .filter((record) => record.discipleId === props.disciple.id)
    .map((record) => ({
      id: record.id,
      discipleName: record.discipleName,
      directionName: record.directionName,
      durationText: durationHours(record.durationSeconds),
      status: record.status,
      statusLabel: RECORD_STATUS_LABELS[record.status],
      resultLines: recordResultLines(record),
    })),
);

/* ---------- 丹药：详情只保留入口，点击后打开选择弹窗 ---------- */

const ATTRIBUTE_NAMES: Record<string, string> = { attack: '攻击', defense: '防御', speed: '身法' };
const PILL_ORDER = ['healingPill', 'cultivationPill', 'bodyTemperingPill'] as const;
const showPillPicker = ref(false);

interface PillOption {
  pillId: string;
  name: string;
  description: string;
  owned: number;
  /** 规则上可以服用（库存与最终裁决仍在服务端）。 */
  available: boolean;
  /** 本次效果预览（不可用时为空）。 */
  preview: string;
  /** 不可用 / 无库存时的原因。 */
  disabledReason: string;
}

const pillOptions = computed<PillOption[]>(() => {
  const byId = new Map<string, AlchemyRecipeView>(
    props.state.alchemy.recipes.map((recipe) => [recipe.id, recipe]),
  );
  const locked = !props.state.alchemy.unlocked;
  const lockedReason = props.state.alchemy.blockedReason ?? '炼丹尚未开启';
  // 单次增益由服务端下发（view.alchemy.cultivationPillGain），前端不复制这个常量。
  const gainPerPill = props.state.alchemy.cultivationPillGain;
  const disciple = props.disciple;
  const options: PillOption[] = [];

  for (const pillId of PILL_ORDER) {
    const recipe = byId.get(pillId);
    if (recipe === undefined) continue;

    let available = false;
    let preview = '';
    let reason = '';

    if (pillId === 'healingPill') {
      available = injured.value;
      preview = '清除伤势，立刻可再出战或突破';
      reason = '当前无恙，无需疗伤';
    } else if (pillId === 'cultivationPill') {
      const required = disciple.requiredCultivation;
      if (required === null) {
        reason = '已达当前版本上限，无法再靠丹药精进';
      } else {
        available = disciple.cultivation < required;
        preview = `修为 +${Math.min(gainPerPill, required - disciple.cultivation)}（达到 ${required} 门槛为止）`;
        reason = '修为已达门槛，无需进补';
      }
    } else {
      const target = disciple.bodyTemperingTarget;
      available = target !== null;
      preview =
        target === null
          ? ''
          : `本次补：${ATTRIBUTE_NAMES[target] ?? target} +${disciple.bodyTemperingGain}（已服 ${disciple.bodyTemperingUses} 次 · 剩余 ${disciple.bodyTemperingRemaining} 次）`;
      reason = '已无属性短板或淬体次数已用尽';
    }

    if (locked) {
      available = false;
      reason = lockedReason;
    }

    options.push({
      pillId,
      name: recipe.name,
      description: recipe.description,
      owned: recipe.owned,
      available,
      preview: available ? preview : '',
      disabledReason: available && recipe.owned < 1 ? '丹药库存不足，请先炼制' : reason,
    });
  }
  return options;
});

function usePill(option: PillOption): void {
  if (props.busy) return;
  // 在外历练期间服务端会拒绝服药，这里同步挡住（按钮已禁用，兜底键盘/程序化触发）。
  if (journey.value.status === 'active') {
    emit('notify', 'warning', `${props.disciple.name}正在外历练`, awayHint.value ?? '在外历练期间不能服药。');
    return;
  }
  if (!option.available || option.owned < 1) {
    emit('notify', 'warning', `暂不可服用${option.name}`, option.disabledReason);
    return;
  }
  showPillPicker.value = false;
  emit('usePill', option.pillId, props.disciple.id);
}

/* ---------- 驱逐：在「档案」Tab 内二次确认后才 emit ---------- */
const confirmingExpel = ref(false);
/**
 * 本次是否由自己提交过驱逐请求：只用来把按钮文案切成「驱逐中…」。
 * 任何 busy 结束（含其他操作、同步轮询）都要复位，否则别的操作在途时会误导性地显示「驱逐中…」。
 */
const expelSubmitted = ref(false);
const expelTrigger = ref<HTMLButtonElement | null>(null);
const expelConfirm = ref<HTMLButtonElement | null>(null);

watch(
  () => props.busy,
  (next) => {
    if (!next) expelSubmitted.value = false;
  },
);

function askExpel(): void {
  // 在外 / 待领取都会被服务端拒绝驱逐，这里同步挡住入口并说明原因。
  if (props.busy || journey.value.status !== 'none') return;
  confirmingExpel.value = true;
  void nextTick(() => expelConfirm.value?.focus());
}

function cancelExpel(): void {
  confirmingExpel.value = false;
  void nextTick(() => expelTrigger.value?.focus());
}

function confirmExpel(): void {
  if (props.busy) return;
  expelSubmitted.value = true;
  emit('expel', props.disciple.id);
}
</script>

<template>
  <section class="disciple-detail">
    <!-- 紧凑头部：头像（含头像框）+ 姓名 / 境界 / 状态，滚动时始终可见。 -->
    <header class="disciple-detail-head">
      <div class="disciple-detail-portrait">
        <DiscipleAvatar
          :name="disciple.name"
          :gender="disciple.gender"
          :realm-id="disciple.realmId"
          :frame-id="disciple.avatarFrameId"
          variant="detail"
        />
      </div>
      <div class="disciple-detail-headline">
        <p class="eyebrow">门人详情</p>
        <h2 class="disciple-detail-name" :title="disciple.name">{{ disciple.name }}</h2>
        <p class="disciple-detail-headline-meta">
          <span class="realm-tag">{{ disciple.stageName }}</span>
          <span class="disciple-detail-headline-realm">{{ disciple.realmName }}</span>
          <span class="disciple-status">{{ headerStatusLabel }}</span>
        </p>
      </div>
      <span class="disciple-detail-headline-frame">{{ avatarFrameOption(disciple.avatarFrameId).label }}</span>
    </header>

    <div class="disciple-tabs" role="tablist" aria-label="弟子详情分区">
      <button
        v-for="tab in TABS"
        :id="tabButtonId(tab.id)"
        :key="tab.id"
        :ref="(element) => setTabButton(tab.id, element as Element | null)"
        class="disciple-tab"
        type="button"
        role="tab"
        :aria-selected="activeTab === tab.id"
        :aria-controls="tabPanelId(tab.id)"
        :tabindex="activeTab === tab.id ? 0 : -1"
        @click="activeTab = tab.id"
        @keydown="onTabKeydown($event, tab.id)"
      >
        {{ tab.label }}
      </button>
    </div>

    <div class="disciple-tab-panels">
      <!-- ---------- 概览 ---------- -->
      <div
        v-show="activeTab === 'overview'"
        :id="tabPanelId('overview')"
        class="disciple-tab-panel"
        role="tabpanel"
        :aria-labelledby="tabButtonId('overview')"
        tabindex="0"
      >
        <section class="disciple-detail-section" aria-labelledby="disciple-attr-title">
          <h3 id="disciple-attr-title" class="disciple-detail-title">当前属性</h3>

          <!-- 综合评分是服务端按「当前」六项属性等权现算的展示值，前端不复制公式、不做二次取整。 -->
          <div class="disciple-score">
            <span class="disciple-score-label">综合评分</span>
            <strong class="disciple-score-value">{{ disciple.attributeScore.toFixed(1) }}</strong>
            <span class="disciple-score-note">当前六项属性的等权平均，随淬体等属性变化更新；不含境界、修为、天赋与战力。</span>
          </div>

          <!-- 雷达图与精确数值并排（窄屏自动单列）：六轴都按服务端原值绘制。 -->
          <DiscipleRadarChart
            :name="disciple.name"
            :aptitude="disciple.aptitude"
            :attack="disciple.attack"
            :defense="disciple.defense"
            :speed="disciple.speed"
            :luck="disciple.luck"
            :physique="disciple.physique"
          />

          <div class="disciple-stats">
            <span class="stat-tag stat-talent">天赋 {{ disciple.talentName }}</span>
            <span class="stat-tag stat-power">战力 {{ disciple.combatPower }}</span>
          </div>

          <!-- 幸运 / 体魄只作用于单人定时历练，这里把「实际作用」写在数值旁边，避免被当成战力属性。 -->
          <dl class="disciple-attribute-effects">
            <div>
              <dt>幸运 {{ disciple.luck }}</dt>
              <dd>只作用于单人定时历练：影响该次历练的额外收获概率。</dd>
            </div>
            <div>
              <dt>体魄 {{ disciple.physique }}</dt>
              <dd>只作用于单人定时历练：影响该次历练的受伤概率。</dd>
            </div>
          </dl>

          <p class="disciple-detail-hint">
            资质影响修炼速度；攻 / 防 / 身法 决定战力。战力由服务端按攻防速与境界算出，与综合评分是两个独立数值。
          </p>
        </section>

        <!--
          0019 悟道值：赌坊赢来的点数在这里分配到六项属性之一。
          上限（总分配上限 = daoInsightUsed + daoInsightRemaining，属性 100）与最终裁决都在服务端，
          这里只是把「本次最多能分多少」算出来给玩家看，不复制服务端的加点公式。
        -->
        <section class="disciple-detail-section" aria-labelledby="disciple-dao-insight-title">
          <div class="dao-insight-heading">
            <h3 id="disciple-dao-insight-title" class="disciple-detail-title">悟道值</h3>
            <button class="quiet-button dao-insight-help" type="button" @click="showDaoInsightHelp = true">?</button>
          </div>
          <p class="disciple-detail-hint">当前可用 {{ disciple.daoInsight }} 点</p>

          <template v-if="daoAllocatable">
            <ul class="journey-directions" role="radiogroup" aria-label="加点属性">
              <li v-for="option in DAO_ATTRIBUTE_OPTIONS" :key="option.value" class="journey-direction">
                <button
                  class="journey-direction-button"
                  :class="{ 'is-selected': daoAttribute === option.value }"
                  type="button"
                  role="radio"
                  :disabled="busy"
                  :aria-checked="daoAttribute === option.value"
                  @click="daoAttribute = option.value"
                >
                  <strong>{{ option.label }}</strong>
                  <small>当前 {{ disciple[option.value] }}</small>
                </button>
              </li>
            </ul>

            <div class="disciple-note-row">
              <input
                class="disciple-input"
                type="number"
                inputmode="numeric"
                min="1"
                :max="daoPointsMax"
                step="1"
                aria-label="分配点数"
                :value="daoPointsInput"
                :disabled="busy"
                @input="daoPointsInput = ($event.target as HTMLInputElement).value"
              />
              <button
                class="action-button primary-action"
                type="button"
                :disabled="busy || !daoPointsValid"
                @click="allocateDaoInsight"
              >
                <span>分配</span>
              </button>
            </div>
            <p class="disciple-note-meta" role="status">
              本次可分配 1 ~ {{ daoPointsMax }} 点
            </p>
          </template>

          <ModalShell v-if="showDaoInsightHelp" narrow label="悟道值说明" @close="showDaoInsightHelp = false">
            <section class="dao-insight-help-card" aria-labelledby="dao-insight-help-title">
              <h2 id="dao-insight-help-title" class="disciple-detail-title">悟道值说明</h2>
              <p class="disciple-detail-hint">已分配 {{ disciple.daoInsightUsed }}/{{ daoInsightCap }} · 剩余可分配额度 {{ disciple.daoInsightRemaining }} 点</p>
              <pre class="dao-insight-help-text">1 点悟道值 = 1 点属性。
每个弟子最多累计分配 {{ daoInsightCap }} 点。
分配点数受可用悟道值、累计上限与属性 100 上限共同限制。
悟道值通过赌坊论道获得。</pre>
              <button class="action-button primary-action realm-button" type="button" @click="showDaoInsightHelp = false">
                <span>知道了</span>
              </button>
            </section>
          </ModalShell>
        </section>

        <section class="disciple-detail-section" aria-labelledby="disciple-overview-cultivation">
          <h3 id="disciple-overview-cultivation" class="disciple-detail-title">修为摘要</h3>
          <p class="disciple-detail-realm">
            <span class="realm-tag">{{ disciple.stageName }}</span>
            <span>{{ disciple.realmName }}</span>
          </p>
          <div class="disciple-detail-progress">
            <span>修为 {{ progress.text }}</span>
            <span>{{ progress.percent }}%</span>
          </div>
          <p class="disciple-detail-hint">
            {{
              progress.capped
                ? '已达当前版本上限：修为不再增长，满环也不代表可以破境。'
                : `静修 +${disciple.cultivationRatePerHour}/时`
            }}
          </p>
        </section>
      </div>

      <!-- ---------- 修行 ---------- -->
      <div
        v-show="activeTab === 'training'"
        :id="tabPanelId('training')"
        class="disciple-tab-panel"
        role="tabpanel"
        :aria-labelledby="tabButtonId('training')"
        tabindex="0"
      >
        <section class="disciple-detail-section" aria-labelledby="disciple-realm-title">
          <h3 id="disciple-realm-title" class="disciple-detail-title">境界与修为</h3>
          <p class="disciple-detail-realm">
            <span class="realm-tag">{{ disciple.stageName }}</span>
            <span>{{ disciple.realmName }}</span>
          </p>
          <div class="disciple-detail-progress">
            <span>{{ progress.text }}</span>
            <span>{{ progress.percent }}%</span>
          </div>
          <div
            class="disciple-cultivation-track"
            role="progressbar"
            aria-label="修为进境"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-valuenow="progress.percent"
            :aria-valuetext="progress.text"
          >
            <span :style="{ width: `${progress.percent}%` }" />
          </div>
          <p class="disciple-detail-hint">
            {{
              progress.capped
                ? '已达当前版本上限：修为不再增长，满环也不代表可以破境。'
                : `静修 +${disciple.cultivationRatePerHour}/时`
            }}
          </p>
        </section>

        <section class="disciple-detail-section" aria-labelledby="disciple-job-title">
          <h3 id="disciple-job-title" class="disciple-detail-title">当前差遣</h3>
          <AssignmentSelect
            :model-value="disciple.assignment"
            :options="state.assignments"
            :disabled="busy || journey.status === 'active'"
            :label="disciple.name"
            @change="emit('assign', disciple.id, $event)"
          />
          <p v-if="awayHint" class="blocked-hint">{{ awayHint }}</p>
        </section>

        <section class="disciple-detail-section" aria-labelledby="disciple-injury-title">
          <h3 id="disciple-injury-title" class="disciple-detail-title">伤势</h3>
          <p v-if="injured" class="disciple-detail-injury">
            疗伤中 · 预计 {{ formatTime(disciple.injuredUntil) }} 复原
          </p>
          <p v-else class="disciple-detail-hint">无恙，可以出战、探索与破境。</p>
        </section>

        <section class="disciple-detail-section" aria-labelledby="disciple-break-title">
          <h3 id="disciple-break-title" class="disciple-detail-title">破境</h3>
          <dl class="disciple-facts">
            <div>
              <dt>破境胜算</dt>
              <dd>{{ formatBp(disciple.breakthroughChanceBp) }}</dd>
            </div>
            <div>
              <dt>灵气消耗</dt>
              <dd>{{ formatAmount(disciple.breakthroughCost) }} {{ energyName }}</dd>
            </div>
          </dl>
          <p v-if="disciple.blockedReason" class="blocked-hint">{{ disciple.blockedReason }}</p>
          <!-- 在外时即便服务端还没把 canBreakthrough 打成 false，也一律挡住破境。 -->
          <p v-if="awayHint" class="blocked-hint">{{ awayHint }}</p>
          <button
            class="action-button primary-action disciple-break-button"
            :class="{ 'is-disabled': !disciple.canBreakthrough || journey.status === 'active' }"
            type="button"
            :disabled="busy || journey.status === 'active'"
            :aria-disabled="!disciple.canBreakthrough || journey.status === 'active'"
            @click="requestBreakthrough"
          >
            <span>破境</span>
          </button>
        </section>

        <section class="disciple-detail-section" aria-labelledby="disciple-pill-title">
          <h3 id="disciple-pill-title" class="disciple-detail-title">丹药服用</h3>
          <p v-if="!state.alchemy.unlocked" class="blocked-hint">
            {{ state.alchemy.blockedReason ?? '炼丹尚未开启' }}
          </p>
          <button
            class="action-button primary-action disciple-pill-launch"
            type="button"
            :disabled="busy || !state.alchemy.unlocked || journey.status === 'active'"
            @click="showPillPicker = true"
          >
            服用丹药
          </button>
          <p v-if="awayHint" class="blocked-hint">{{ awayHint }}</p>
          <p class="disciple-detail-hint">点击后选择丹药；配方炼制仍在「炼丹」面板。</p>
        </section>
      </div>

      <!-- ---------- 历练 ---------- -->
      <div
        v-show="activeTab === 'journey'"
        :id="tabPanelId('journey')"
        class="disciple-tab-panel"
        role="tabpanel"
        :aria-labelledby="tabButtonId('journey')"
        tabindex="0"
      >
        <section class="disciple-detail-section disciple-journey" aria-labelledby="disciple-journey-title">
          <h3 id="disciple-journey-title" class="disciple-detail-title">历练</h3>
          <p class="disciple-journey-quota">
            在外 <strong>{{ state.journey.activeCount }}</strong>/{{ state.journey.maxConcurrent }} 人 · 至少留守
            {{ state.journey.minAtHome }} 人
          </p>

          <template v-if="journey.status === 'none'">
            <!-- 不可出发时只显示服务端的原因（筑基门槛 / 疗伤中 / 名额已满 / 在守擂阵容中）。 -->
            <template v-if="!journey.canStart">
              <p class="blocked-hint">{{ journey.blockedReason ?? '当前不可出发' }}</p>
              <button class="action-button primary-action disciple-journey-start" type="button" disabled>
                <span>确认出发</span>
              </button>
            </template>

            <button
              v-if="journey.canStart && planner === null && !journeyPreviewLoading"
              class="action-button primary-action disciple-journey-launch"
              type="button"
              :disabled="busy"
              @click="requestPreview"
            >
              <span>查看历练预览</span>
            </button>

            <LoadingState
              v-if="journeyPreviewLoading"
              compact
              label="正在推演历练"
              detail="正在计算各方向的奖励、修为与风险。"
            />

            <div v-if="journey.canStart && planner !== null" class="disciple-journey-planner">
              <p class="disciple-detail-hint">
                {{ planner.discipleName }} 可出发 · 宗门在外 {{ planner.activeCount }}/{{ planner.maxConcurrent }} 人
              </p>

              <ul class="journey-directions" role="radiogroup" aria-label="历练方向">
                <li
                  v-for="(item, index) in planner.directions"
                  :key="item.direction"
                  class="journey-direction"
                  :style="journeyOrderStyle(index)"
                >
                  <button
                    class="journey-direction-button"
                    :class="{
                      'is-selected': activeDirectionId === item.direction,
                      'is-blocked': !item.available,
                    }"
                    type="button"
                    role="radio"
                    :disabled="busy || !item.available"
                    :aria-checked="activeDirectionId === item.direction"
                    @click="selectDirection(item)"
                  >
                    <strong>{{ item.name }}</strong>
                    <small>{{ item.description }}</small>
                  </button>
                  <p v-if="!item.available" class="blocked-hint">{{ item.blockedReason ?? '当前不可选' }}</p>
                </li>
              </ul>

              <ul v-if="activeDurations.length > 0" class="journey-durations" role="radiogroup" aria-label="历练时长">
                <li
                  v-for="(option, index) in activeDurations"
                  :key="option.durationSeconds"
                  :style="journeyOrderStyle(index)"
                >
                  <button
                    class="journey-duration-chip"
                    :class="{ 'is-selected': activeDurationSeconds === option.durationSeconds }"
                    type="button"
                    role="radio"
                    :disabled="busy"
                    :aria-checked="activeDurationSeconds === option.durationSeconds"
                    @click="selectDuration(option)"
                  >
                    <span class="journey-duration-head">
                      <strong>{{ option.durationLabel }}</strong>
                      <em>{{ cultivationText(option) }}</em>
                    </span>
                    <span class="journey-duration-tags">
                      <span v-for="line in resourceLines(option.resources)" :key="line.id" class="journey-tag">
                        {{ line.name }} +{{ line.amount }}
                      </span>
                      <span class="journey-tag is-extra">额外收获 {{ formatBp(option.extraChanceBp) }}</span>
                      <span class="journey-tag is-risk">实际受伤 {{ formatBp(option.injuryChanceBp) }}</span>
                    </span>
                    <span class="journey-return">预计 {{ formatTime(option.endsAt) }} 归队</span>
                  </button>
                </li>
              </ul>

              <p v-if="planner.blockedReason" class="blocked-hint">{{ planner.blockedReason }}</p>
              <button
                class="action-button primary-action disciple-journey-start"
                type="button"
                :disabled="busy || activeDurationSeconds === null"
                @click="confirmStart"
              >
                <span>确认出发</span>
              </button>
              <p class="disciple-detail-hint">
                数值为服务端预览（不含随机结果）；出发后原岗位收益与静修暂停，到期按服务端时间归队。
              </p>
            </div>
          </template>

          <div v-if="journey.status === 'active'" class="journey-away">
            <p class="journey-state-line">
              <span class="realm-tag">{{ journey.directionName ?? '历练' }}</span>
              <span class="journey-state-badge">在外历练中</span>
              <span class="journey-duration">{{ durationHours(journey.durationSeconds) }}</span>
            </p>
            <dl class="disciple-facts">
              <div>
                <dt>预计归队</dt>
                <dd>{{ formatTime(journey.endsAt) }}</dd>
              </div>
              <div>
                <dt>剩余时间</dt>
                <dd class="journey-countdown">{{ countdownText }}</dd>
              </div>
            </dl>
            <p class="disciple-detail-hint">
              原岗位「{{ journey.originalAssignmentName ?? '闲置' }}」仍为他保留；在外期间该岗位收益与静修暂停。
            </p>
            <button class="action-button primary-action disciple-journey-start" type="button" disabled>
              <span>在外历练中</span>
            </button>
          </div>

          <div v-if="journey.status === 'ready'" class="journey-ready">
            <p class="journey-state-line">
              <span class="realm-tag">{{ journey.directionName ?? '历练' }}</span>
              <span class="journey-state-badge is-ready">已归队 · 待领取</span>
              <span class="journey-duration">{{ durationHours(journey.durationSeconds) }}</span>
            </p>

            <template v-if="outcome !== null">
              <dl class="disciple-facts">
                <div>
                  <dt>实际入账修为</dt>
                  <dd>+{{ outcome.cultivationAwarded }}</dd>
                </div>
                <div>
                  <dt>出发时计划</dt>
                  <dd>{{ outcome.cultivationPlanned }}</dd>
                </div>
              </dl>
              <ul v-if="outcomeLines.length > 0" class="journey-reward-list">
                <li v-for="line in outcomeLines" :key="line.id">
                  <span class="journey-tag">{{ line.name }}</span>
                  <strong>+{{ line.amount }}</strong>
                </li>
              </ul>
              <p v-else class="disciple-detail-hint">本次没有资源奖励。</p>
              <p v-if="outcome.extraHarvest" class="journey-flag is-extra">额外收获：修为与各项资源按保底值再加五成。</p>
              <p v-if="outcome.injured" class="journey-flag is-risk">
                途中受伤 ·
                {{ outcomeHealed ? '已痊愈' : `预计 ${formatTime(outcome.injuredUntil)} 复原` }}
              </p>
            </template>

            <button
              class="action-button primary-action disciple-journey-start"
              type="button"
              :disabled="busy"
              @click="requestClaim"
            >
              <span>{{ busy ? '领取中…' : '领取历练收获' }}</span>
            </button>
            <p class="disciple-detail-hint">领取前不能再次派他历练，也不能被驱逐；资源在领取时一次性入账。</p>
          </div>

          <!--
            此弟子的近期记录：数据来自 state.journey.recent（宗门最近 10 条），
            这里按 discipleId 过滤，标题只写「此弟子的近期历练」，不冒称完整履历。
          -->
          <div class="journey-history">
            <h4 class="disciple-journey-subtitle">此弟子的近期历练</h4>
            <ul v-if="journal.length > 0" class="journey-history-list">
              <li v-for="entry in journal" :key="entry.id" class="journey-record" :class="`is-${entry.status}`">
                <div class="journey-record-head">
                  <strong class="journey-record-name">{{ entry.discipleName }}</strong>
                  <span class="journey-tag">{{ entry.directionName }}</span>
                  <span class="journey-duration">{{ entry.durationText }}</span>
                  <span class="journey-record-status" :class="`is-${entry.status}`">{{ entry.statusLabel }}</span>
                </div>
                <ul class="journey-record-result">
                  <li v-for="(line, index) in entry.resultLines" :key="index">{{ line }}</li>
                </ul>
              </li>
            </ul>
            <p v-else class="disciple-detail-hint">他近期没有历练记录。</p>
            <p class="disciple-detail-hint">只显示宗门最近 10 条记录中属于他的部分，不是他的完整履历。</p>
          </div>
        </section>
      </div>

      <!-- ---------- 档案 ---------- -->
      <div
        v-show="activeTab === 'archive'"
        :id="tabPanelId('archive')"
        class="disciple-tab-panel"
        role="tabpanel"
        :aria-labelledby="tabButtonId('archive')"
        tabindex="0"
      >
        <section class="disciple-detail-section" aria-labelledby="disciple-frame-title">
          <h3 id="disciple-frame-title" class="disciple-detail-title">头像框</h3>
          <!-- 图像单选控件：固定二十种样式 + 旧式，不接受任意上传或 URL。 -->
          <div class="disciple-frame-grid" role="radiogroup" aria-label="头像框样式">
            <label
              v-for="option in AVATAR_FRAME_OPTIONS"
              :key="option.id"
              class="disciple-frame-option"
              :class="{ 'is-selected': frameDraft === option.id }"
            >
              <input
                class="disciple-frame-radio"
                type="radio"
                name="disciple-avatar-frame"
                :value="option.id"
                :checked="frameDraft === option.id"
                :disabled="busy"
                @change="onFrameChange"
              />
              <span class="disciple-frame-preview disciple-ring">
                <DiscipleAvatar
                  :name="disciple.name"
                  :gender="disciple.gender"
                  :realm-id="disciple.realmId"
                  :frame-id="option.id"
                />
              </span>
              <span class="disciple-frame-label">{{ option.label }}</span>
            </label>
          </div>
          <div class="disciple-note-row">
            <button
              class="action-button disciple-frame-save"
              :class="{ 'is-dirty': frameDirty }"
              type="button"
              :disabled="busy || !frameDirty"
              @click="saveAvatarFrame"
            >
              {{ busy && frameDirty ? '保存中…' : '保存头像框' }}
            </button>
          </div>
          <p class="disciple-note-meta" role="status">
            当前：{{ frameCurrentLabel }} · {{ frameDirty ? '有未保存的改动' : '已保存' }}
          </p>
        </section>

        <section class="disciple-detail-section" aria-labelledby="disciple-rename-title">
          <h3 id="disciple-rename-title" class="disciple-detail-title">改名</h3>
          <div class="disciple-note-row">
            <input
              class="disciple-input"
              type="text"
              aria-label="弟子姓名"
              :placeholder="renameRangeLabel"
              :value="renameDraft"
              @input="onRenameInput"
            />
            <button
              class="action-button disciple-note-save"
              :class="{ 'is-dirty': renameDirty }"
              type="button"
              :disabled="busy || !renameDirty || renameInvalid || !renameAffordable"
              @click="submitRename"
            >
              改名
            </button>
          </div>
          <p
            class="disciple-note-meta"
            :class="{ 'is-error': renameInvalid || !renameAffordable }"
            role="status"
          >
            {{ renameLength }}/{{ state.rename.discipleNameMaxChars }} 字 · 一次
            {{ renameCostLabel }} 灵石 · {{ renameHint }}
          </p>
        </section>

        <section class="disciple-detail-section" aria-labelledby="disciple-note-title">
          <h3 id="disciple-note-title" class="disciple-detail-title">私有备注</h3>
          <div class="disciple-note-row">
            <input
              class="disciple-input"
              type="text"
              aria-label="私有备注"
              placeholder="只有你看得到，可留空"
              :value="noteDraft"
              @input="onNoteInput"
            />
            <button
              class="action-button disciple-note-save"
              :class="{ 'is-dirty': noteDirty }"
              type="button"
              :disabled="busy || !noteDirty || noteTooLong"
              @click="saveNote"
            >
              保存
            </button>
          </div>
          <p class="disciple-note-meta" :class="{ 'is-error': noteTooLong }" role="status">
            {{ noteLength }}/{{ NOTE_MAX_LENGTH }} 字 · {{ noteTooLong ? '备注超出字数上限' : '保存空内容即清空这条备注' }}
          </p>
        </section>

        <section class="disciple-detail-section disciple-danger" aria-labelledby="disciple-expel-title">
          <h3 id="disciple-expel-title" class="disciple-detail-title">驱逐出师门</h3>

          <template v-if="!confirmingExpel">
            <p class="disciple-detail-hint">
              驱逐后该弟子不再属于本宗，其占用的岗位收益同时结算。
            </p>
            <!-- 历练期间（在外或待领取）服务端会拒绝驱逐，这里先禁用并说明原因。 -->
            <p v-if="expelBlockedHint" class="blocked-hint">{{ expelBlockedHint }}</p>
            <button
              ref="expelTrigger"
              class="action-button disciple-danger-button"
              type="button"
              :disabled="busy || journey.status !== 'none'"
              @click="askExpel"
            >
              驱逐弟子
            </button>
          </template>

          <div v-else class="disciple-expel-confirm" role="group" aria-labelledby="disciple-expel-confirm-title">
            <p id="disciple-expel-confirm-title" class="disciple-expel-question">
              确认驱逐「{{ disciple.name }}」？
            </p>
            <ul class="disciple-expel-warnings">
              <li>不返还培养消耗的资源与已用招募次数，也不降低宗门等级。</li>
              <li>若他在守擂阵容中，阵容会被清空，需要重新布阵。</li>
              <li>门下不足 3 人时无法组成主动挑战阵容，也无法被其他宗门挑战。</li>
            </ul>
            <div class="disciple-expel-actions">
              <button class="action-button" type="button" :disabled="busy" @click="cancelExpel">取消</button>
              <button
                ref="expelConfirm"
                class="action-button primary-action disciple-expel-confirm-button"
                type="button"
                :disabled="busy"
                @click="confirmExpel"
              >
                {{ busy && expelSubmitted ? '驱逐中…' : '确认驱逐' }}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>

    <!-- 二级弹窗：叠在详情之上，Esc 只关这一层（焦点被限制在最上层弹窗内）。 -->
    <ModalShell
      v-if="showPillPicker"
      narrow
      :label="`选择丹药 · ${disciple.name}`"
      @close="showPillPicker = false"
    >
      <section class="disciple-pill-picker" aria-labelledby="disciple-pill-picker-title">
        <header class="section-heading panel-heading compact-heading">
          <div>
            <p class="eyebrow">丹库</p>
            <h2 id="disciple-pill-picker-title">选择要服用的丹药</h2>
          </div>
        </header>
        <ul class="disciple-pill-list">
          <li
            v-for="option in pillOptions"
            :key="option.pillId"
            class="disciple-pill"
            :class="{ 'is-blocked': !option.available || option.owned < 1 }"
          >
            <div class="disciple-pill-copy">
              <div class="disciple-pill-title">
                <strong>{{ option.name }}</strong>
                <span class="alchemy-owned">库存 {{ option.owned }}</span>
              </div>
              <p class="disciple-pill-desc">{{ option.description }}</p>
              <p v-if="option.available && option.preview !== ''" class="disciple-pill-effect">
                本次效果：{{ option.preview }}
              </p>
              <p v-if="!option.available || option.owned < 1" class="blocked-hint">
                {{ option.owned < 1 ? '丹药库存不足，请先炼制' : option.disabledReason }}
              </p>
            </div>
            <button
              class="upgrade-button disciple-pill-button"
              type="button"
              :disabled="busy || !option.available || option.owned < 1"
              @click="usePill(option)"
            >
              <span>选择</span>
            </button>
          </li>
        </ul>
      </section>
    </ModalShell>
  </section>
</template>
