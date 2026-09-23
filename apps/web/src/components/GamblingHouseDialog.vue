<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import type {
  DaoAttribute,
  DaoDebateInput,
  DaoDebateResult,
  DebateHistoryEntry,
  SectStateView,
  WheelSpinResult,
} from '../api/game';
import { fetchDebateHistory } from '../api/game';
import ModalShell from './ModalShell.vue';
import DisciplePicker from './DisciplePicker.vue';
import SpiritBeastRaceDialog from './SpiritBeastRaceDialog.vue';
import WheelDialog from './WheelDialog.vue';

/**
 * 赌坊主面板（弹窗内容）：每个玩法一个阶段，在同一组件里切换 ——
 * mode-select（玩法列表）/ 论道的 configure（赌注配置）· confrontation（对峙）· result（结果）
 * / wheel（天机轮，交给 WheelDialog 渲染）。
 * / beast-race（灵兽竞逐，交给 SpiritBeastRaceDialog 渲染）。
 *
 * 三种赌注模式的字段、解锁、每日次数、弟子归属与胜负都由服务端裁决：
 * 这里只按 betMode 收集各自的必填项，绝不自己算数额或改服务端文案
 * （stakeDescription / rewardDescription / message 原样展示）。
 * 天机轮同理：盘面、费用与落格全在服务端，本组件只把它当第二个玩法接进同一套 props / emits。
 * 灵兽竞逐同理：投注池、倍率与结算都在服务端，本组件只接入子组件（SpiritBeastRaceDialog 自行轮询与下注）。
 * 未解锁时只显示服务端的 blockedReason；受伤或在外历练的弟子不能出战（与挑战选人同一口径）。
 */
const props = defineProps<{
  state: SectStateView;
  busy: boolean;
  /** 刚做完的一次论道结果；null = 还没出过结果。 */
  result: DaoDebateResult | null;
  /** 刚转出的一次天机轮结果；null = 还没转过（上层每次转动前会清空）。 */
  wheelResult: WheelSpinResult | null;
}>();

const emit = defineEmits<{
  debate: [input: DaoDebateInput];
  close: [];
  reveal: [];
  wheelSpin: [tier: number];
  wheelReset: [];
  wheelReveal: [];
  /** 灵兽竞逐的 state 更新回执。 */
  'race-state-update': [state: SectStateView];
  /** 灵兽竞逐结果提示。 */
  'race-notify': [tone: 'success' | 'warning', title: string, message: string];
  game: [game: GamblingGame];
}>();

type GamblingGame = 'debate' | 'wheel' | 'beast-race';

/** 所有资源数量都是最小单位整数，1 展示单位 = 1000 最小单位（与 utils/format.ts 同口径）。 */
const UNITS_PER_DISPLAY = 1000;
/** 自由输入的最小赌注：展示 10 = 后端 FREE_BET_MIN（10000 最小单位）。 */
const FREE_BET_MIN_DISPLAY = 10;

type Stage = 'mode-select' | 'configure' | 'confrontation' | 'result' | 'wheel' | 'beast-race';

/** 挂载时停在玩法列表；只有「新结果到达」才切进 confrontation（不因父组件残留旧 result 跳阶段）。 */
const stage = ref<Stage>('mode-select');
const showRules = ref(false);
const showRecord = ref(false);

/* ---------- 赌坊记录：详细列表 + 分页 ---------- */

const historyEntries = ref<DebateHistoryEntry[]>([]);
const historyPage = ref(1);
const historyTotalPages = ref(1);
const historyLoading = ref(false);

async function loadHistory(page: number): Promise<void> {
  historyLoading.value = true;
  try {
    const data = await fetchDebateHistory(page);
    historyEntries.value = data.entries;
    historyPage.value = data.page;
    historyTotalPages.value = data.totalPages;
  } finally {
    historyLoading.value = false;
  }
}

function openRecord(): void {
  showRecord.value = true;
  loadHistory(1);
}

function historyPrev(): void {
  if (historyPage.value > 1) loadHistory(historyPage.value - 1);
}

function historyNext(): void {
  if (historyPage.value < historyTotalPages.value) loadHistory(historyPage.value + 1);
}

const BET_MODE_LABELS: Record<string, string> = {
  preset_spirit_stone: '预设灵石',
  free_resource: '自由资源',
  attribute: '属性赌注',
  // 0020 天机轮：记录列表里的倍率列对它是「投入档位」，所以文案要区分开。
  wheel: '天机轮',
  // 0024 灵兽竞逐
  beast_race: '灵兽竞逐',
  horse_race: '赛马',
};

function formatStake(entry: DebateHistoryEntry): string {
  try {
    const detail = JSON.parse(entry.stakeDetail) as Record<string, unknown>;
    if (entry.betMode === 'attribute') {
      const attrLabel = ATTRIBUTE_OPTIONS.find((o) => o.value === detail.attribute)?.label ?? String(detail.attribute);
      return `${attrLabel} -${String(detail.points)}点`;
    }
    if (entry.betMode === 'beast_race') {
      // 新记录：逐只列出押注额 + 冠军；旧记录（只写了押中的那只）退回原格式。
      if (Array.isArray(detail.bets)) {
        const bets = (detail.bets as { beastName?: string; amount?: string }[])
          .map((b) => `${String(b.beastName ?? '')} ${String(Number(b.amount) / UNITS_PER_DISPLAY)}`)
          .join('、');
        return `押 ${bets} · 冠军 ${String(detail.winnerName ?? '')}`;
      }
      return `押 ${String(detail.beastName ?? '')} · ${(entry.multiplier / 10).toFixed(1)}x`;
    }
    if (entry.betMode === 'horse_race') {
      const amount = Number(detail.amount) / UNITS_PER_DISPLAY;
      const odds = Number.isFinite(Number(detail.odds)) ? Number(detail.odds) : entry.multiplier / 10;
      return `押 ${String(detail.horseName ?? '')} ${odds.toFixed(1)}x · 赌注 ${String(amount)}`;
    }
    const amount = Number(detail.amount) / UNITS_PER_DISPLAY;
    const resName = resourceLabel(String(detail.resourceId ?? 'spiritStone'));
    return `${resName} ${String(amount)}`;
  } catch {
    return '—';
  }
}

/**
 * 记录列表的倍率列：赛马存的是「赔率 × 10」（3.2x 存 32，因为该列是 INTEGER），
 * 直接渲染会变成 32x，所以这里还原成赔率；其余玩法（含天机轮的投入档位）就是原值。
 */
function formatMultiplier(entry: DebateHistoryEntry): string {
  return entry.betMode === 'horse_race' || entry.betMode === 'beast_race'
    ? `${(entry.multiplier / 10).toFixed(1)}x`
    : `${String(entry.multiplier)}x`;
}

function formatReward(entry: DebateHistoryEntry): string {
  if (entry.result === 'lose') return '—';
  try {
    const detail = JSON.parse(entry.rewardDetail) as Record<string, unknown>;
    if (detail.type === 'resource') {
      const amount = Number(detail.amount) / UNITS_PER_DISPLAY;
      const resName = resourceLabel(String(detail.resourceId));
      return `${resName} +${String(amount)}`;
    }
    if (detail.type === 'insight') {
      return `悟道值 +${String(detail.insight)}`;
    }
    if (detail.type === 'pill') {
      // 0020 天机轮的丹药格：数量随投入档位走，名字仍从服务端名词表查。
      return `${pillLabel(String(detail.pillId))} ×${String(detail.quantity)}`;
    }
    return '—';
  } catch {
    return '—';
  }
}

/** 丹药名取自服务端下发的炼丹面板（唯一一份名词表），查不到时退回 id。 */
function pillLabel(pillId: string): string {
  return props.state.alchemy.recipes.find((recipe) => recipe.id === pillId)?.name ?? pillId;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getMonth() + 1)}/${String(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ---------- 配置表单 ---------- */

/** 选中的出战弟子（选人控件统一给数组，单选所以最多 1 个）。 */
const selectedDiscipleIds = ref<string[]>([]);
const selectedDiscipleId = computed(() => selectedDiscipleIds.value[0] ?? null);
const betMode = ref<DaoDebateInput['betMode']>('preset_spirit_stone');
const multiplier = ref<DaoDebateInput['multiplier']>(1);
const rewardType = ref<'resource' | 'insight'>('resource');
const betResourceId = ref<'spiritStone' | 'herb' | 'ore'>('spiritStone');
/** 自由输入的数量草稿（展示单位文本）；提交时才 ×1000 换算成最小单位。 */
const freeAmountInput = ref('');
const betAttribute = ref<DaoAttribute>('attack');

const BET_MODES: readonly { value: DaoDebateInput['betMode']; label: string; hint: string }[] = [
  { value: 'preset_spirit_stone', label: '系统预设灵石', hint: '固定档位，赢可得灵石或悟道值' },
  { value: 'free_resource', label: '自由输入资源', hint: '自定义押注数量，赢可得 1.8 倍资源' },
  { value: 'attribute', label: '属性赌注', hint: '以弟子属性点为赌注，赢可得悟道值' },
];

/** 倍率只有 1 / 2 / 3 三档（与后端 Multiplier 同口径）。 */
const MULTIPLIER_OPTIONS = [1, 2, 3] as const;

/** 可赌资源白名单（与后端 gambling.ts 的 BETTABLE_RESOURCES 同口径）；名字取自服务端资源表。 */
const RESOURCE_OPTIONS = ['spiritStone', 'herb', 'ore'] as const;

/** 可赌 / 可加点属性（前端展示沿用雷达图的名词：speed 记为「身法」）。 */
const ATTRIBUTE_OPTIONS: readonly { value: DaoAttribute; label: string }[] = [
  { value: 'attack', label: '攻击' },
  { value: 'defense', label: '防御' },
  { value: 'speed', label: '身法' },
  { value: 'aptitude', label: '资质' },
  { value: 'luck', label: '幸运' },
  { value: 'physique', label: '体魄' },
];

/** 系统预设灵石赌注（展示单位）：与后端 PRESET_STAKES 同口径。 */
const PRESET_STAKES_DISPLAY: Record<number, number> = { 1: 100, 2: 200, 3: 300 };
/** 系统预设灵石奖励（展示单位）：与后端 PRESET_RESOURCE_REWARDS 同口径。 */
const PRESET_REWARDS_DISPLAY: Record<number, number> = { 1: 180, 2: 360, 3: 540 };
/** 系统预设悟道值奖励：与后端 PRESET_INSIGHT_REWARDS 同口径。 */
const PRESET_INSIGHT_DISPLAY: Record<number, number> = { 1: 1, 2: 2, 3: 3 };
/** 属性赌注点数：与后端 ATTRIBUTE_STAKES 同口径。 */
const ATTRIBUTE_STAKES_DISPLAY: Record<number, number> = { 1: 1, 2: 2, 3: 3 };
/** 属性赌注赢的悟道值：与后端 ATTRIBUTE_INSIGHT_REWARDS 同口径。 */
const ATTRIBUTE_INSIGHT_DISPLAY: Record<number, number> = { 1: 2, 2: 4, 3: 6 };

function resourceLabel(resourceId: string): string {
  return props.state.resources.find((resource) => resource.id === resourceId)?.name ?? resourceId;
}

function formatSpiritStone(minUnits: number): string {
  const display = minUnits / UNITS_PER_DISPLAY;
  return display >= 0 ? `+${String(display)}` : String(display);
}

const freeAmountDisplay = computed(() => Number(freeAmountInput.value.trim()));
const freeAmountMinUnits = computed(() => Math.round(freeAmountDisplay.value * UNITS_PER_DISPLAY));
/** 合法数量：展示单位整数，且不少于最小赌注（换算后必然 >= 10000 最小单位）。 */
const freeAmountValid = computed(
  () =>
    Number.isFinite(freeAmountDisplay.value) &&
    Number.isInteger(freeAmountDisplay.value) &&
    freeAmountDisplay.value >= FREE_BET_MIN_DISPLAY,
);

const unlocked = computed(() => props.state.gambling.unlocked);
const remaining = computed(() => props.state.gambling.remaining);
const dailyLimit = computed(() => props.state.gambling.dailyLimit);

/** 当前模式的必填项是否齐全（只有自由输入可能缺数量，其余两种都在白名单里选）。 */
const modeConfigured = computed(() => (betMode.value === 'free_resource' ? freeAmountValid.value : true));

const canSubmit = computed(
  () =>
    unlocked.value &&
    !props.busy &&
    remaining.value > 0 &&
    selectedDiscipleId.value !== null &&
    modeConfigured.value,
);

/** 组装本次请求：按 betMode 只带各自的必填字段（多余字段会被服务端 400 拒绝）。 */
function submit(): void {
  if (!canSubmit.value) return;
  const discipleId = selectedDiscipleId.value;
  if (discipleId === null) return;
  const base = { discipleId, betMode: betMode.value, multiplier: multiplier.value };
  if (betMode.value === 'preset_spirit_stone') {
    emit('debate', { ...base, rewardType: rewardType.value });
    return;
  }
  if (betMode.value === 'free_resource') {
    emit('debate', { ...base, resourceId: betResourceId.value, amount: freeAmountMinUnits.value });
    return;
  }
  emit('debate', { ...base, attribute: betAttribute.value });
}

function enterConfigure(): void {
  if (!unlocked.value) return;
  reportGame('debate');
  stage.value = 'configure';
}

/**
 * 玩法切换：只有赌坊弹窗的加载层文案要靠它（论道 / 天机轮），
 * 业务状态仍各自留在自己的阶段里。
 */
function reportGame(game: GamblingGame): void {
  emit('game', game);
}

/** 进入天机轮：格局与费用来自 state.gambling.wheel，未解锁或格面缺失时不放行。 */
function enterWheel(): void {
  if (!unlocked.value || props.state.gambling.wheel === null) return;
  reportGame('wheel');
  stage.value = 'wheel';
}


/** 天机轮的点按一律转发给上层：接口调用、state 覆盖与提示都在 App.vue / SectScreen。 */
function onWheelSpin(tier: number): void {
  if (props.busy) return;
  emit('wheelSpin', tier);
}

function onWheelReset(): void {
  if (props.busy) return;
  emit('wheelReset');
}

/** 转盘停稳：交给 SectScreen 补一条结果提示（与 reveal 同一套去重）。 */
function onWheelReveal(): void {
  emit('wheelReveal');
}

/* ---------- 0024 灵兽竞逐（赌坊第三个玩法） ---------- */

function enterBeastRace(): void {
  if (!unlocked.value) return;
  reportGame('beast-race');
  stage.value = 'beast-race';
}

function onRaceStateUpdate(newState: SectStateView): void {
  emit('race-state-update', newState);
}

function onRaceNotify(tone: 'success' | 'warning', title: string, message: string): void {
  emit('race-notify', tone, title, message);
}

/** 灵兽竞逐里的「返回赌坊」：回到玩法列表。 */
function backToModeSelect(): void {
  stage.value = 'mode-select';
}

/** 结果看完了回到配置（保留上一次的模式与选的弟子，方便连赌）。 */
function continueDebate(): void {
  reportGame('debate');
  stage.value = 'configure';
}

// 结果到达先进 confrontation（看对手属性），玩家点揭晓后再到 result。
// 天机轮 / 灵兽竞逐不参与这里：它们的结果由各自的子组件消费（stage 是 'wheel' | 'beast-race' 时不动）。
watch(
  () => props.result,
  (result) => {
    if (stage.value === 'wheel' || stage.value === 'beast-race') return;
    if (result !== null) {
      stage.value = 'confrontation';
    } else if (stage.value === 'result' || stage.value === 'confrontation') {
      stage.value = 'configure';
    }
  },
);

function revealResult(): void {
  stage.value = 'result';
  emit('reveal');
}

/** doc 11.3 的规则文案原文：前端只负责展示，不改写措辞与数值。 */
const RULES_TEXT = `论道赌局 · 玩法说明

选择一名弟子代表宗门参加论道比试。根据赌注模式不同，
可以押灵石、资源或弟子属性。

【系统预设灵石】
选择倍率档位，赢可获灵石或悟道值。

【自由输入资源】
自定义押注数量，赢可获 1.8 倍对应资源。

【属性赌注】
以弟子属性点为赌注，赢可获悟道值。
注意：输了属性会被扣减，没有下限！

悟道值可在弟子详情中分配到任意属性。
每个弟子最多累计分配 50 点悟道值。`;
</script>

<template>
  <section class="gambling-dialog" aria-labelledby="gambling-dialog-title">
    <header class="section-heading panel-heading compact-heading">
      <h2 id="gambling-dialog-title" class="gambling-title-gold">{{ stage === 'wheel' ? '天机轮' : '赌坊' }}</h2>
      <span class="count-badge">今日 {{ remaining }}/{{ dailyLimit }}</span>
    </header>

    <!-- ---------- 玩法列表 ---------- -->
    <template v-if="stage === 'mode-select'">
      <div class="gambling-toolbar">
        <p class="lineup-note">选择一种玩法，押上筹码与天机相搏。</p>
        <button class="quiet-button" type="button" @click="openRecord()">赌坊记录</button>
      </div>

      <p v-if="!unlocked" class="blocked-hint">
        {{ state.gambling.blockedReason ?? '赌坊尚未开启' }}
      </p>

      <ul class="gambling-games">
        <li>
          <button
            class="gambling-game-button"
            type="button"
            :disabled="busy || !unlocked"
            @click="enterConfigure"
          >
            <strong>论道赌局</strong>
            <small>押灵石、资源或弟子属性，与看不见的对手论道一场。</small>
          </button>
        </li>
        <li>
          <button
            class="gambling-game-button"
            type="button"
            :disabled="busy || !unlocked || state.gambling.wheel === null"
            @click="enterWheel"
          >
            <strong>天机轮</strong>
            <small>八格天机，落到哪格得哪格；花灵石可重排格局。</small>
          </button>
        </li>
        <li>
          <button
            class="gambling-game-button"
            type="button"
            :disabled="busy || !unlocked"
            @click="enterBeastRace"
          >
            <strong>灵兽竞逐</strong>
            <small>10 分钟一轮 · 互赌倍率 · 全服公共池</small>
          </button>
        </li>
      </ul>
    </template>

    <!-- ---------- 赌注配置 ---------- -->
    <template v-else-if="stage === 'configure'">
      <p v-if="!unlocked" class="blocked-hint">
        {{ state.gambling.blockedReason ?? '赌坊尚未开启' }}
      </p>

      <template v-else>
        <div class="configure-header">
          <h3 class="configure-title">论道赌局</h3>
          <button class="quiet-button" type="button" @click="showRules = true">说明</button>
        </div>

        <p class="eyebrow">赌注模式</p>
        <div class="gambling-modes" role="radiogroup" aria-label="赌注模式">
          <button
            v-for="mode in BET_MODES"
            :key="mode.value"
            class="gambling-choice"
            :class="{ 'is-selected': betMode === mode.value }"
            type="button"
            role="radio"
            :disabled="busy"
            :aria-checked="betMode === mode.value"
            @click="betMode = mode.value"
          >
            <strong>{{ mode.label }}</strong>
            <small>{{ mode.hint }}</small>
          </button>
        </div>

        <p class="eyebrow">倍率档位</p>
        <div class="gambling-multipliers" role="radiogroup" aria-label="倍率档位">
          <button
            v-for="option in MULTIPLIER_OPTIONS"
            :key="option"
            class="gambling-multiplier"
            :class="{ 'is-selected': multiplier === option }"
            type="button"
            role="radio"
            :disabled="busy"
            :aria-checked="multiplier === option"
            @click="multiplier = option"
          >
            {{ option }}x
          </button>
        </div>

        <!-- 系统预设：赢灵石或赢悟道值 -->
        <div v-if="betMode === 'preset_spirit_stone'" class="gambling-field">
          <p class="eyebrow">奖励类型</p>
          <div class="gambling-multipliers" role="radiogroup" aria-label="奖励类型">
            <button
              class="gambling-multiplier"
              :class="{ 'is-selected': rewardType === 'resource' }"
              type="button"
              role="radio"
              :disabled="busy"
              :aria-checked="rewardType === 'resource'"
              @click="rewardType = 'resource'"
            >
              灵石
            </button>
            <button
              class="gambling-multiplier"
              :class="{ 'is-selected': rewardType === 'insight' }"
              type="button"
              role="radio"
              :disabled="busy"
              :aria-checked="rewardType === 'insight'"
              @click="rewardType = 'insight'"
            >
              悟道值
            </button>
          </div>
          <p class="gambling-stake-hint">
            赌注：灵石 {{ PRESET_STAKES_DISPLAY[multiplier] }} ·
            赢：{{ rewardType === 'resource' ? `灵石 ${PRESET_REWARDS_DISPLAY[multiplier]}` : `悟道值 +${PRESET_INSIGHT_DISPLAY[multiplier]}` }}
          </p>
        </div>

        <!-- 自由输入：资源类型 + 数量（展示单位） -->
        <div v-else-if="betMode === 'free_resource'" class="gambling-field">
          <p class="eyebrow">押注资源</p>
          <div class="gambling-multipliers" role="radiogroup" aria-label="押注资源">
            <button
              v-for="resourceId in RESOURCE_OPTIONS"
              :key="resourceId"
              class="gambling-multiplier"
              :class="{ 'is-selected': betResourceId === resourceId }"
              type="button"
              role="radio"
              :disabled="busy"
              :aria-checked="betResourceId === resourceId"
              @click="betResourceId = resourceId"
            >
              {{ resourceLabel(resourceId) }}
            </button>
          </div>
          <label class="gambling-amount">
            <span class="eyebrow">押注数量（最少 {{ FREE_BET_MIN_DISPLAY }}）</span>
            <input
              class="disciple-input gambling-amount-input"
              type="number"
              inputmode="numeric"
              :min="FREE_BET_MIN_DISPLAY"
              step="1"
              placeholder="至少 10"
              :value="freeAmountInput"
              :disabled="busy"
              @input="freeAmountInput = ($event.target as HTMLInputElement).value"
            />
          </label>
          <p v-if="freeAmountInput.trim() !== '' && !freeAmountValid" class="blocked-hint">
            数量需为不少于 {{ FREE_BET_MIN_DISPLAY }} 的整数（展示单位）。
          </p>
          <p v-if="freeAmountValid" class="gambling-stake-hint">
            赌注：{{ resourceLabel(betResourceId) }} {{ freeAmountDisplay }} ·
            赢：{{ resourceLabel(betResourceId) }} {{ Math.floor(freeAmountDisplay * 1.8) }}
          </p>
        </div>

        <!-- 属性赌注：六选一 -->
        <div v-else class="gambling-field">
          <p class="eyebrow">押注属性</p>
          <div class="gambling-attributes" role="radiogroup" aria-label="押注属性">
            <button
              v-for="option in ATTRIBUTE_OPTIONS"
              :key="option.value"
              class="gambling-multiplier"
              :class="{ 'is-selected': betAttribute === option.value }"
              type="button"
              role="radio"
              :disabled="busy"
              :aria-checked="betAttribute === option.value"
              @click="betAttribute = option.value"
            >
              {{ option.label }}
            </button>
          </div>
          <p class="gambling-stake-hint">
            赌注：{{ ATTRIBUTE_OPTIONS.find(o => o.value === betAttribute)?.label }} -{{ ATTRIBUTE_STAKES_DISPLAY[multiplier] }} 点 ·
            赢：悟道值 +{{ ATTRIBUTE_INSIGHT_DISPLAY[multiplier] }}
          </p>
        </div>

        <DisciplePicker
          v-model:selected="selectedDiscipleIds"
          :disciples="state.disciples"
          mode="single"
          :min="1"
          :max="1"
          :busy="busy"
          title="选择出战弟子"
        />

        <button
          class="action-button primary-action realm-button"
          :class="{ 'is-disabled': !canSubmit }"
          type="button"
          :disabled="busy || remaining <= 0"
          :aria-disabled="!canSubmit"
          @click="submit"
        >
          <span>开始论道</span>
        </button>
        <p v-if="remaining <= 0" class="blocked-hint">今日赌坊次数已用尽（论道与天机轮共享），明日再来。</p>
        <p v-else-if="!modeConfigured" class="blocked-hint">请先填写合法的押注数量。</p>
      </template>
    </template>

    <!-- ---------- 对峙：展示双方属性 + 侦查提示 ---------- -->
    <template v-else-if="stage === 'confrontation'">
      <template v-if="result">
        <p class="eyebrow">论道对峙</p>
        <div class="confrontation-panel">
          <div class="confrontation-side">
            <strong>{{ result.discipleName }}</strong>
            <ul class="confrontation-attrs">
              <li v-for="option in ATTRIBUTE_OPTIONS" :key="option.value">
                {{ option.label }} {{ result.discipleAttributes[option.value] ?? '—' }}
              </li>
            </ul>
          </div>
          <span class="confrontation-vs">VS</span>
          <div class="confrontation-side">
            <strong>神秘对手</strong>
            <ul class="confrontation-attrs">
              <li v-for="option in ATTRIBUTE_OPTIONS" :key="option.value">
                {{ option.label }} {{ result.opponent[option.value] ?? '?' }}
              </li>
            </ul>
          </div>
        </div>

        <div v-if="result.revealHints.length > 0" class="gambling-reveals">
          <p class="eyebrow">幸运侦查</p>
          <ul>
            <li v-for="(hint, index) in result.revealHints" :key="index">{{ hint }}</li>
          </ul>
        </div>

        <button
          class="action-button primary-action realm-button confrontation-action"
          type="button"
          @click="revealResult"
        >
          <span>开始比试</span>
        </button>
      </template>
    </template>

    <!-- ---------- 天机轮：盘面/档位/结果全在子组件里，这里只接线。 ---------- -->
    <template v-else-if="stage === 'wheel'">
      <WheelDialog
        :state="state"
        :busy="busy"
        :wheel="state.gambling.wheel"
        :result="wheelResult"
        @spin="onWheelSpin"
        @reset="onWheelReset"
        @reveal="onWheelReveal"
      />
    </template>

    <!-- ---------- 灵兽竞逐：投注/封盘/结算全在子组件里，这里只接线。 ---------- -->
    <template v-else-if="stage === 'beast-race'">
      <SpiritBeastRaceDialog
        :state="state"
        :busy="busy"
        @state-update="onRaceStateUpdate"
        @notify="onRaceNotify"
        @back="backToModeSelect"
      />
    </template>

    <!-- ---------- 结果展示 ---------- -->
    <template v-else>
      <template v-if="result">
        <div class="challenge-outcome">
          <span
            class="result-badge"
            :class="result.result === 'win' ? 'is-win' : 'is-lose'"
            aria-hidden="true"
          >
            {{ result.result === 'win' ? '胜' : '负' }}
          </span>
          <span class="challenge-outcome-text">
            <strong>{{ result.discipleName }}</strong> · {{ result.message }}
          </span>
        </div>

        <dl class="gambling-result-facts">
          <div>
            <dt>赌注</dt>
            <dd>{{ result.stakeDescription }}</dd>
          </div>
          <div>
            <dt>结果</dt>
            <dd>{{ result.rewardDescription }}</dd>
          </div>
        </dl>

        <div class="gambling-result-actions">
          <button class="action-button" type="button" @click="emit('close')">返回</button>
          <button
            class="action-button primary-action realm-button"
            type="button"
            :disabled="busy"
            @click="continueDebate"
          >
            <span>继续论道</span>
          </button>
        </div>
      </template>
    </template>

    <!-- 规则说明：移到 configure 页面的 ? 按钮触发 -->
    <ModalShell v-if="showRules" narrow label="论道赌局说明" @close="showRules = false">
      <section class="gambling-rules-card" aria-labelledby="gambling-rules-title">
        <h2 id="gambling-rules-title" class="disciple-detail-title">玩法说明</h2>
        <pre class="gambling-rules">{{ RULES_TEXT }}</pre>
        <button class="action-button primary-action realm-button" type="button" @click="showRules = false">
          <span>知道了</span>
        </button>
      </section>
    </ModalShell>

    <!-- 赌坊记录：战绩汇总 + 详细列表 -->
    <ModalShell v-if="showRecord" narrow label="赌坊记录" @close="showRecord = false">
      <section class="gambling-record-card" aria-labelledby="gambling-record-title">
        <h2 id="gambling-record-title" class="disciple-detail-title">赌坊记录</h2>
        <template v-if="state.gambling.stats && state.gambling.stats.total > 0">
          <dl class="gambling-record-stats">
            <div>
              <dt>总场次</dt>
              <dd>{{ state.gambling.stats.total }}</dd>
            </div>
            <div>
              <dt>胜</dt>
              <dd class="record-win">{{ state.gambling.stats.wins }}</dd>
            </div>
            <div>
              <dt>负</dt>
              <dd class="record-lose">{{ state.gambling.stats.losses }}</dd>
            </div>
            <div>
              <dt>胜率</dt>
              <dd>{{ state.gambling.stats.winRate }}%</dd>
            </div>
            <div>
              <dt>灵石盈亏</dt>
              <dd :class="state.gambling.stats.netSpiritStone >= 0 ? 'record-win' : 'record-lose'">
                {{ formatSpiritStone(state.gambling.stats.netSpiritStone) }}
              </dd>
            </div>
            <div>
              <dt>累计悟道值</dt>
              <dd class="record-win">+{{ state.gambling.stats.totalInsight }}</dd>
            </div>
          </dl>

          <p class="eyebrow" style="margin-top: 16px">详细记录</p>
          <p v-if="historyLoading" class="blocked-hint">加载中…</p>
          <template v-else-if="historyEntries.length > 0">
            <ul class="history-list">
              <li v-for="entry in historyEntries" :key="entry.id" class="history-item">
                <div class="history-row-top">
                  <span
                    class="history-result-tag"
                    :class="entry.result === 'win' ? 'record-win' : 'record-lose'"
                  >{{ entry.result === 'win' ? '胜' : '负' }}</span>
                  <span class="history-disciple">{{ entry.discipleName }}</span>
                  <span class="history-mode">{{ BET_MODE_LABELS[entry.betMode] ?? entry.betMode }} {{ formatMultiplier(entry) }}</span>
                  <span class="history-time">{{ formatTime(entry.createdAt) }}</span>
                </div>
                <div class="history-row-bottom">
                  <span>赌注：{{ formatStake(entry) }}</span>
                  <span v-if="entry.result === 'win'">奖励：{{ formatReward(entry) }}</span>
                </div>
              </li>
            </ul>
            <div v-if="historyTotalPages > 1" class="history-pagination">
              <button
                class="quiet-button"
                type="button"
                :disabled="historyPage <= 1 || historyLoading"
                @click="historyPrev"
              >上一页</button>
              <span class="history-page-info">{{ historyPage }} / {{ historyTotalPages }}</span>
              <button
                class="quiet-button"
                type="button"
                :disabled="historyPage >= historyTotalPages || historyLoading"
                @click="historyNext"
              >下一页</button>
            </div>
          </template>
          <p v-else class="blocked-hint">暂无详细记录。</p>
        </template>
        <p v-else class="blocked-hint">暂无论道记录。</p>
        <button class="action-button primary-action realm-button" type="button" @click="showRecord = false">
          <span>知道了</span>
        </button>
      </section>
    </ModalShell>
  </section>
</template>

<style scoped>
.gambling-dialog {
  display: flex;
  flex-direction: column;
}

.gambling-title-gold {
  color: var(--gold, #caa96a);
  font-family: 'STKaiti', 'KaiTi', serif;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.1em;
}

.gambling-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 10px;
}

.gambling-toolbar .lineup-note {
  margin-top: 0;
}

.configure-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 6px;
}

.configure-title {
  margin: 0;
  color: var(--gold, #caa96a);
  font-family: 'STKaiti', 'KaiTi', serif;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.05em;
}

.configure-status {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  color: #93a99e;
  font-size: 12px;
}

.configure-sep {
  color: rgba(147, 169, 158, 0.4);
}

.gambling-games {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 14px;
  list-style: none;
}

.gambling-game-button {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 5px;
  padding: 14px;
  border: 1px solid rgba(202, 169, 106, 0.28);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.02);
  color: inherit;
  text-align: left;
}

.gambling-game-button:not(:disabled):hover {
  border-color: rgba(202, 169, 106, 0.5);
  background: rgba(202, 169, 106, 0.06);
}

.gambling-game-button strong {
  color: #dce6e0;
  font-family: 'STKaiti', 'KaiTi', serif;
  font-size: 15px;
  font-weight: 500;
  letter-spacing: 0.05em;
}

.gambling-game-button small {
  color: #93a99e;
  font-size: 12px;
  line-height: 1.5;
}

.gambling-modes {
  display: grid;
  gap: 8px;
  margin-top: 8px;
}

.gambling-choice {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.014);
  color: inherit;
  text-align: left;
}

.gambling-choice.is-selected {
  border-color: rgba(202, 169, 106, 0.5);
  background: rgba(202, 169, 106, 0.08);
}

.gambling-choice strong {
  color: #dce6e0;
  font-size: 13px;
  font-weight: 500;
}

.gambling-choice small {
  color: #7d9186;
  font-size: 12px;
}

.gambling-multipliers,
.gambling-attributes {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.gambling-multiplier {
  padding: 7px 14px;
  border: 1px solid var(--line);
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.014);
  color: #a9bcb2;
  font-size: 13px;
}

.gambling-multiplier:not(:disabled):hover {
  border-color: rgba(119, 184, 154, 0.4);
}

.gambling-multiplier.is-selected {
  border-color: rgba(202, 169, 106, 0.55);
  color: var(--gold);
  background: rgba(202, 169, 106, 0.1);
}

.gambling-field {
  margin-top: 14px;
}

.gambling-amount {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 12px;
}

.gambling-amount-input {
  max-width: 160px;
}

.gambling-result-facts {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}

.gambling-result-facts div {
  display: flex;
  gap: 10px;
  font-size: 13px;
}

.gambling-result-facts dt {
  flex: 0 0 auto;
  color: var(--faint);
}

.gambling-result-facts dd {
  margin: 0;
  color: #dce6e0;
}

.gambling-reveals {
  margin-top: 12px;
}

.gambling-reveals ul {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 6px;
  padding-left: 18px;
  color: #93a99e;
  font-size: 12px;
}

.gambling-result-actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}

.gambling-result-actions .action-button {
  flex: 1 1 0;
}

.gambling-rules-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.gambling-rules {
  margin: 0;
  color: #c8d6ce;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
}

.gambling-stake-hint {
  margin-top: 8px;
  color: #93a99e;
  font-size: 12px;
  line-height: 1.5;
}

.confrontation-panel {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-top: 10px;
}

.confrontation-side {
  flex: 1 1 0;
  padding: 10px;
  border: 1px solid rgba(202, 169, 106, 0.2);
  border-radius: 6px;
  text-align: center;
}

.confrontation-side strong {
  display: block;
  margin-bottom: 8px;
  color: #dce6e0;
  font-family: 'STKaiti', 'KaiTi', serif;
  font-size: 14px;
  letter-spacing: 0.05em;
}

.confrontation-attrs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  justify-content: center;
  margin: 0;
  padding: 0;
  color: #93a99e;
  font-size: 12px;
  list-style: none;
}

.confrontation-vs {
  display: flex;
  align-items: center;
  padding-top: 30px;
  color: rgba(202, 169, 106, 0.6);
  font-family: 'STKaiti', 'KaiTi', serif;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.1em;
}

.confrontation-action {
  margin-top: 16px;
  padding: 8px 20px;
  font-size: 13px;
}

.gambling-record-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.gambling-record-stats {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin: 0;
}

.gambling-record-stats div {
  display: flex;
  justify-content: space-between;
  padding: 8px 12px;
  border: 1px solid rgba(202, 169, 106, 0.15);
  border-radius: 4px;
  font-size: 13px;
}

.gambling-record-stats dt {
  color: var(--faint, #7d9186);
}

.gambling-record-stats dd {
  margin: 0;
  color: #dce6e0;
  font-weight: 500;
}

.record-win {
  color: #77b89a;
}

.record-lose {
  color: #c47272;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.history-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border: 1px solid rgba(202, 169, 106, 0.12);
  border-radius: 4px;
  font-size: 12px;
}

.history-row-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.history-result-tag {
  font-weight: 600;
  font-size: 13px;
}

.history-disciple {
  color: #dce6e0;
}

.history-mode {
  color: #93a99e;
}

.history-time {
  margin-left: auto;
  color: var(--faint, #7d9186);
}

.history-row-bottom {
  display: flex;
  gap: 16px;
  color: #93a99e;
}

.history-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 10px;
}

.history-page-info {
  color: #93a99e;
  font-size: 12px;
}
</style>
