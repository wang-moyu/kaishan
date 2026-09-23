<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

import type { RaceHistoryView, RaceStateView, SectStateView } from '../api/game';
import { fetchRaceHistory, fetchRaceState, placeRaceBet } from '../api/game';
import { formatAmount } from '../utils/format';
import ModalShell from './ModalShell.vue';
import SpiritBeastRaceTrack from './SpiritBeastRaceTrack.vue';

const props = defineProps<{
  state: SectStateView;
  busy: boolean;
}>();

const emit = defineEmits<{
  /** 下注成功后更新 state。 */
  'state-update': [state: SectStateView];
  /** 返回赌坊玩法列表。 */
  back: [];
  /** 结果提示。 */
  notify: [tone: 'success' | 'warning', title: string, message: string];
}>();

const RACE_BET_MIN_DISPLAY = 10;
const RACE_BET_MAX_DISPLAY = 500;
const UNITS_PER_DISPLAY = 1000;

const race = ref<RaceStateView | null>(null);
const loading = ref(true);
const submitting = ref(false);
const errorMsg = ref('');

const selectedBeast = ref<number | null>(null);
/** 投注 / 抽水说明弹窗。 */
const showRules = ref(false);
const betInput = ref('');

let pollTimer: number | undefined;
let countdownTimer: number | undefined;
const countdown = ref(0);

const spiritStone = computed(() => {
  const r = props.state.resources.find((item) => item.id === 'spiritStone');
  return Number(r?.balance ?? '0');
});

const betDisplay = computed(() => Number(betInput.value.trim()));
const betMinUnits = computed(() => Math.round(betDisplay.value * UNITS_PER_DISPLAY));
const betValid = computed(
  () =>
    Number.isFinite(betDisplay.value) &&
    Number.isInteger(betDisplay.value) &&
    betDisplay.value >= RACE_BET_MIN_DISPLAY &&
    betDisplay.value <= RACE_BET_MAX_DISPLAY,
);
const affordable = computed(() => betValid.value && betMinUnits.value <= spiritStone.value);
const hasTries = computed(() => props.state.gambling.remaining > 0);

const canBet = computed(
  () =>
    selectedBeast.value !== null &&
    betValid.value &&
    affordable.value &&
    (hasTries.value || hasExistingBet.value) &&
    !submitting.value &&
    !props.busy &&
    race.value?.phase === 'betting',
);

const hasExistingBet = computed(() => (race.value?.myBets.length ?? 0) > 0);

const betHint = computed(() => {
  if (betInput.value.trim() !== '' && !betValid.value) {
    return `赌注需为 ${String(RACE_BET_MIN_DISPLAY)}~${String(RACE_BET_MAX_DISPLAY)} 的整数`;
  }
  if (betValid.value && !affordable.value) {
    return `灵石不足：当前 ${formatAmount(spiritStone.value)} 灵石`;
  }
  return '';
});

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

async function loadRaceState(): Promise<void> {
  try {
    const { state: newState, race: raceData } = await fetchRaceState();
    emit('state-update', newState);
    const prevPhase = race.value?.phase;
    const prevRoundKey = race.value?.roundKey;
    race.value = raceData;
    countdown.value = raceData.remainingSeconds;

    // 同一轮第一次看到已结算就播动画（Cron 整点结算，轮询可能直接从 betting 跳到 settled）。
    if (prevRoundKey === raceData.roundKey && prevPhase !== 'settled' && raceData.phase === 'settled') {
      startSettledAnimation(raceData);
    }
    if (prevRoundKey && prevRoundKey !== raceData.roundKey) {
      animPhase.value = 'idle';
      notified.value = false;
    }
  } catch {
    /* ignore polling errors */
  } finally {
    loading.value = false;
  }
}

async function submitBet(): Promise<void> {
  if (!canBet.value || selectedBeast.value === null) return;
  submitting.value = true;
  errorMsg.value = '';
  try {
    const { state: newState, race: raceData } = await placeRaceBet(selectedBeast.value, betMinUnits.value);
    emit('state-update', newState);
    race.value = raceData;
    countdown.value = raceData.remainingSeconds;
    betInput.value = '';
    selectedBeast.value = null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    errorMsg.value = msg;
  } finally {
    submitting.value = false;
  }
}

function startPolling(): void {
  stopPolling();
  pollTimer = window.setInterval(() => {
    void loadRaceState();
  }, 5000);
}

function stopPolling(): void {
  if (pollTimer !== undefined) {
    window.clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

function startCountdown(): void {
  stopCountdown();
  countdownTimer = window.setInterval(() => {
    if (countdown.value > 0) countdown.value -= 1;
  }, 1000);
}

function stopCountdown(): void {
  if (countdownTimer !== undefined) {
    window.clearInterval(countdownTimer);
    countdownTimer = undefined;
  }
}

/* ---------- 封盘动画 ---------- */

type AnimPhase = 'idle' | 'racing' | 'result';
const animPhase = ref<AnimPhase>('idle');

function startSettledAnimation(data: RaceStateView): void {
  if (!data.steps || !data.ranks) {
    animPhase.value = 'result';
    notifyResult(data);
    return;
  }
  animPhase.value = 'racing';
}

/** SVG 动画播完（或跳过）：切到结果页并提示输赢。回放时不重复提示。 */
function finishAnimation(): void {
  animPhase.value = 'result';
  if (!notified.value && race.value) notifyResult(race.value);
  notified.value = true;
}

const notified = ref(false);

function notifyResult(data: RaceStateView): void {
  if (data.winnerIndex === null) return;
  const beastName = data.beasts[data.winnerIndex]?.name ?? '?';
  const myWin = Number(data.myWinnings ?? '0');
  const myBet = Number(data.myTotalBet);
  if (myBet > 0) {
    if (myWin > 0) {
      emit('notify', 'success', `灵兽竞逐 · ${beastName}夺冠`, `恭喜！你赢得 ${formatAmount(String(myWin))} 灵石`);
    } else {
      emit('notify', 'warning', `灵兽竞逐 · ${beastName}夺冠`, `很遗憾，你押注的灵兽未能夺冠，损失 ${formatAmount(String(myBet))} 灵石`);
    }
  }
}

/** 本轮我押在某只灵兽上的总额（最小单位）。 */
function myBetOn(beastIndex: number): number {
  return (race.value?.myBets ?? [])
    .filter((b) => b.beastIndex === beastIndex)
    .reduce((s, b) => s + Number(b.amount), 0);
}

/** 本轮净输赢 = 拿回（押中赔付，含本金） − 总投入。 */
const myNet = computed(() => Number(race.value?.myWinnings ?? '0') - Number(race.value?.myTotalBet ?? '0'));

function oddsText(odds: number): string {
  return odds > 0 ? `${odds.toFixed(1)}x` : '—';
}

/* ---------- 历史记录 ---------- */

type Tab = 'live' | 'history';
const activeTab = ref<Tab>('live');

const history = ref<RaceHistoryView | null>(null);
const historyPage = ref(1);
const historyLoading = ref(false);

async function loadHistory(page: number): Promise<void> {
  historyLoading.value = true;
  try {
    history.value = await fetchRaceHistory(page);
    historyPage.value = page;
  } catch { /* ignore */ } finally {
    historyLoading.value = false;
  }
}

function switchTab(tab: Tab): void {
  activeTab.value = tab;
  if (tab === 'history' && history.value === null) {
    void loadHistory(1);
  }
}

function formatRoundTime(roundKey: string): string {
  const parts = roundKey.split('T');
  if (parts.length < 2) return roundKey;
  const [date, time] = parts;
  return `${date!.slice(5)} ${time!}`;
}

function winRateText(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

watch(() => race.value?.phase, (phase) => {
  if (phase === 'sealed' && animPhase.value === 'idle') {
    // wait for next poll to get settled data
  }
});

onMounted(() => {
  void loadRaceState();
  startPolling();
  startCountdown();
});

onUnmounted(() => {
  stopPolling();
  stopCountdown();
});
</script>

<template>
  <section class="race-panel" aria-labelledby="gambling-dialog-title">
    <!-- Tab 切换 -->
    <div class="race-tabs">
      <button
        class="race-tab" :class="{ 'is-active': activeTab === 'live' }"
        type="button" @click="switchTab('live')"
      >当前竞逐</button>
      <button
        class="race-tab" :class="{ 'is-active': activeTab === 'history' }"
        type="button" @click="switchTab('history')"
      >历史记录</button>
    </div>

    <!-- ==================== 历史记录 Tab ==================== -->
    <template v-if="activeTab === 'history'">
      <template v-if="historyLoading && !history">
        <p class="race-note">加载中…</p>
      </template>
      <template v-else-if="history">
        <!-- 灵兽胜率统计 -->
        <div class="race-stats">
          <div v-for="s in history.beastStats" :key="s.index" class="race-stat-card">
            <strong>{{ s.name }}</strong>
            <span class="race-stat-wins">{{ s.wins }} 胜</span>
            <span class="race-stat-rate">{{ winRateText(s.winRate) }}</span>
          </div>
        </div>

        <!-- 历史列表 -->
        <ul v-if="history.rounds.length > 0" class="race-history-list">
          <li v-for="r in history.rounds" :key="r.roundKey" class="race-history-row">
            <span class="race-history-time">{{ formatRoundTime(r.roundKey) }}</span>
            <strong class="race-history-winner">{{ r.winnerName }}</strong>
            <span class="race-history-odds">{{ oddsText(r.winnerOdds) }}</span>
            <span class="race-history-pool">奖池 {{ formatAmount(r.totalPool) }}</span>
          </li>
        </ul>
        <p v-else class="race-note">暂无历史记录</p>

        <!-- 分页 -->
        <div v-if="history.total > history.pageSize" class="race-pager">
          <button
            class="action-button race-pager-button" type="button"
            :disabled="historyPage <= 1 || historyLoading"
            @click="loadHistory(historyPage - 1)"
          >上一页</button>
          <span class="race-pager-info">{{ historyPage }} / {{ Math.ceil(history.total / history.pageSize) }}</span>
          <button
            class="action-button race-pager-button" type="button"
            :disabled="historyPage >= Math.ceil(history.total / history.pageSize) || historyLoading"
            @click="loadHistory(historyPage + 1)"
          >下一页</button>
        </div>
      </template>

      <div class="race-foot">
        <button class="action-button race-foot-button" type="button" @click="emit('back')">返回赌坊</button>
      </div>
    </template>

    <!-- ==================== 当前竞逐 Tab ==================== -->
    <template v-else-if="loading">
      <p class="race-note">加载中…</p>
    </template>

    <!-- 休赛时段 -->
    <template v-else-if="race?.phase === 'closed'">
      <p class="eyebrow">灵兽竞逐 · 休赛中</p>
      <p class="race-note">灵兽竞逐仅在每日 08:00–23:00（UTC+8）开放。</p>
      <p class="race-note">距离下次开赛：{{ formatCountdown(countdown) }}</p>
      <div class="race-foot">
        <button class="action-button race-foot-button" type="button" @click="emit('back')">返回赌坊</button>
      </div>
    </template>

    <!-- 本轮无人投注 -->
    <template v-else-if="race?.phase === 'settled' && race.winnerIndex === null">
      <p class="eyebrow">灵兽竞逐 · 本轮无人投注</p>
      <p class="race-note">无人参与，灵兽们休息了一轮。</p>
      <p class="race-note">下一轮即将开始，倒计时：{{ formatCountdown(countdown) }}</p>
      <div class="race-foot">
        <button class="action-button race-foot-button" type="button" @click="emit('back')">返回赌坊</button>
      </div>
    </template>

    <!-- 结算后展示（带动画） -->
    <template v-else-if="race?.phase === 'settled' && animPhase === 'racing'">
      <p class="eyebrow">灵兽竞逐 · 开跑</p>
      <SpiritBeastRaceTrack
        :beasts="race.beasts"
        :steps="race.steps ?? []"
        :winner-index="race.winnerIndex ?? 0"
        :picked="race.myBets.map((b) => b.beastIndex)"
        @done="finishAnimation"
      />
    </template>

    <!-- 结算后结果 -->
    <template v-else-if="race?.phase === 'settled'">
      <p class="eyebrow">灵兽竞逐 · 已结算</p>
      <ul class="race-ranks" v-if="race.ranks">
        <li
          v-for="(beast, _i) in race!.beasts.slice().sort((a, b) => (race!.ranks![a.index] ?? 99) - (race!.ranks![b.index] ?? 99))"
          :key="beast.index"
          class="race-rank-row"
          :class="{ 'is-champion': beast.index === race.winnerIndex, 'is-picked': race.myBets.some(b => b.beastIndex === beast.index) }"
        >
          <span class="race-rank-no">第 {{ race.ranks[beast.index] }} 名</span>
          <strong class="race-rank-name">{{ beast.name }}</strong>
          <span class="race-rank-odds">{{ oddsText(beast.odds) }}</span>
          <span v-if="beast.index === race.winnerIndex" class="race-rank-tag">冠军</span>
          <span v-if="race.myBets.some(b => b.beastIndex === beast.index)" class="race-rank-tag is-picked">你押的 · {{ formatAmount(String(myBetOn(beast.index))) }}</span>
        </li>
      </ul>

      <template v-if="Number(race.myTotalBet) > 0">
        <div class="race-outcome" role="status" aria-live="polite">
          <strong class="race-outcome-label" :class="myNet >= 0 ? 'is-win' : 'is-lose'">
            {{ myNet > 0 ? '赢' : myNet < 0 ? '输' : '平' }}
          </strong>
          <p class="race-outcome-net">
            投入 {{ formatAmount(race.myTotalBet) }} · 拿回 {{ formatAmount(race.myWinnings ?? '0') }} · 净
            <strong :class="myNet >= 0 ? 'is-win' : 'is-lose'">
              {{ myNet >= 0 ? '+' : '-' }}{{ formatAmount(String(Math.abs(myNet))) }}
            </strong>
            灵石
          </p>
        </div>
      </template>

      <p class="race-note">下一轮即将开始，倒计时：{{ formatCountdown(countdown) }}</p>
      <div class="race-foot">
        <button v-if="race.steps" class="action-button race-foot-button" type="button" @click="animPhase = 'racing'">回放比赛</button>
        <button class="action-button race-foot-button" type="button" @click="emit('back')">返回赌坊</button>
      </div>
    </template>

    <!-- 投注/封盘阶段 -->
    <template v-else-if="race">
      <div class="race-head">
        <p class="eyebrow">
          灵兽竞逐 ·
          {{ race.phase === 'betting' ? '投注中' : '封盘中' }}
          <span class="race-countdown">{{ formatCountdown(countdown) }}</span>
        </p>
        <button class="race-rules-button" type="button" @click="showRules = true">说明</button>
      </div>

      <!-- 灵兽卡片 -->
      <div class="race-horses" role="radiogroup" aria-label="选择灵兽">
        <button
          v-for="beast in race.beasts"
          :key="beast.index"
          class="race-horse-card"
          :class="{ 'is-selected': selectedBeast === beast.index }"
          type="button"
          role="radio"
          :disabled="race.phase !== 'betting' || submitting"
          :aria-checked="selectedBeast === beast.index"
          @click="selectedBeast = beast.index"
        >
          <strong>{{ beast.name }}</strong>
          <small class="race-card-odds">倍率 {{ oddsText(beast.odds) }}</small>
          <small class="race-card-pool">投注 {{ formatAmount(beast.pool) }}</small>
        </button>
      </div>

      <!-- 投注池信息 -->
      <p class="race-pool-info">
        总投注池：{{ formatAmount(race.totalPool) }} 灵石
        <template v-if="race.myBets.length > 0">
          · 你已投 {{ formatAmount(race.myTotalBet) }} 灵石
        </template>
      </p>

      <!-- 投注动态（默认折叠） -->
      <details v-if="race.betFeed.length > 0" class="race-feed-details">
        <summary class="race-feed-summary">投注动态（{{ race.betFeed.length }} 条）</summary>
        <ul class="race-feed-list">
          <li v-for="(f, i) in race.betFeed" :key="i" class="race-feed-row">
            <span class="race-feed-sect">{{ f.sectName }}</span>
            <span class="race-feed-arrow">押</span>
            <strong class="race-feed-beast">{{ f.beastName }}</strong>
            <span class="race-feed-amount">{{ formatAmount(f.amount) }} 灵石</span>
          </li>
        </ul>
      </details>

      <!-- 我的投注列表 -->
      <ul v-if="race.myBets.length > 0" class="race-my-bets">
        <li v-for="(bet, i) in race.myBets" :key="i" class="race-my-bet-row">
          {{ bet.beastName }} · {{ formatAmount(bet.amount) }} 灵石
        </li>
      </ul>

      <!-- 下注表单 -->
      <template v-if="race.phase === 'betting'">
        <label class="race-amount">
          <span class="eyebrow">赌注（{{ RACE_BET_MIN_DISPLAY }}~{{ RACE_BET_MAX_DISPLAY }} 灵石）</span>
          <input
            class="disciple-input race-amount-input"
            type="number"
            inputmode="numeric"
            :min="RACE_BET_MIN_DISPLAY"
            :max="RACE_BET_MAX_DISPLAY"
            step="1"
            :placeholder="`${RACE_BET_MIN_DISPLAY} ~ ${RACE_BET_MAX_DISPLAY}`"
            :value="betInput"
            :disabled="submitting"
            @input="betInput = ($event.target as HTMLInputElement).value"
          />
        </label>

        <p v-if="betHint !== ''" class="blocked-hint">{{ betHint }}</p>
        <p v-if="errorMsg" class="blocked-hint">{{ errorMsg }}</p>

        <button
          class="action-button primary-action realm-button race-run-button"
          :class="{ 'is-disabled': !canBet }"
          type="button"
          :disabled="!canBet"
          @click="submitBet"
        >
          <span>{{ submitting ? '下注中…' : `下注 · ${betValid ? betDisplay : RACE_BET_MIN_DISPLAY} 灵石` }}</span>
        </button>

        <p v-if="!hasTries && !hasExistingBet" class="blocked-hint">
          今日 {{ state.gambling.dailyLimit }} 次机会（论道 / 天机轮 / 灵兽竞逐共享）已用尽，明日再来。
        </p>
      </template>
      <template v-else>
        <p class="race-note">已封盘，灵兽即将开跑…</p>
      </template>

      <div class="race-foot">
        <button class="action-button race-foot-button" type="button" :disabled="submitting" @click="emit('back')">
          返回赌坊
        </button>
      </div>
    </template>

    <ModalShell v-if="showRules" narrow label="灵兽竞逐说明" @close="showRules = false">
      <section class="race-rules-card" aria-labelledby="race-rules-title">
        <h2 id="race-rules-title" class="disciple-detail-title">投注说明</h2>
        <pre class="race-rules-text">每轮 10 分钟：逢 x2 分开盘投注，逢整十分封盘开跑并结算，
随后 2 分钟播放比赛、公布结果。每日 08:02–23:00 开放。

· 单注 10~500 灵石，同一轮可多次下注、押多只灵兽。
· 每轮首次下注占用 1 次赌坊次数（与论道、天机轮共享每日 50 次）。
· 只押冠军：押中得「赌注 × 倍率」（含本金），未押中则赌注归庄。
· 第 2~5 名与比赛过程只作展示，不影响输赢。</pre>
        <h2 class="disciple-detail-title">倍率与抽水</h2>
        <pre class="race-rules-text">每只灵兽每轮有实力值（1~10），开盘即定，整轮不变。
夺冠概率 = 该兽实力 ÷ 五兽实力之和
倍率 = 五兽实力之和 × 90% ÷ 该兽实力（保留一位小数）

即庄家抽水约 10%：长期看每押 100 灵石约返还 90，
押热门还是押冷门，平均回报都一样，区别只在波动大小。

例：实力 3 / 9 / 6 / 2 / 2，合计 22
　青龙实力 2：胜率约 9%，倍率 22 × 0.9 ÷ 2 ≈ 9.9x
　玄龟实力 9：胜率约 41%，倍率 22 × 0.9 ÷ 9 ≈ 2.2x

押中倍率 5x 及以上会全服广播。</pre>
        <button class="action-button primary-action realm-button" type="button" @click="showRules = false">
          <span>知道了</span>
        </button>
      </section>
    </ModalShell>
  </section>
</template>

<style scoped>
.race-panel {
  display: flex;
  flex-direction: column;
}

.race-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.race-rules-button {
  flex: 0 0 auto;
  padding: 2px 10px;
  border: 1px solid rgba(202, 169, 106, 0.4);
  border-radius: 2px;
  background: rgba(202, 169, 106, 0.08);
  color: var(--gold, #caa96a);
  font-size: 12px;
  cursor: pointer;
}

.race-rules-button:hover {
  background: rgba(202, 169, 106, 0.16);
}

.race-rules-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.race-rules-text {
  margin: 0;
  color: #c8d6ce;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
}

.race-countdown {
  color: var(--gold, #caa96a);
  font-size: 14px;
  font-weight: 600;
  margin-left: 8px;
}

.race-horses {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.race-horse-card {
  display: flex;
  min-width: 100px;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.014);
  color: #a9bcb2;
  text-align: left;
  transition: border-color 160ms ease, background-color 160ms ease, color 160ms ease;
}

.race-horse-card:not(:disabled):hover {
  border-color: rgba(119, 184, 154, 0.4);
}

.race-horse-card.is-selected {
  border-color: rgba(202, 169, 106, 0.55);
  color: var(--gold);
  background: rgba(202, 169, 106, 0.1);
}

.race-horse-card strong {
  font-size: 14px;
  font-weight: 600;
}

.race-card-odds {
  color: var(--gold, #caa96a);
  font-size: 11px;
}

.race-card-pool {
  color: #7d9186;
  font-size: 11px;
}

.race-horse-card.is-selected .race-card-odds {
  color: rgba(202, 169, 106, 0.95);
}

.race-pool-info {
  margin-top: 10px;
  color: #a9bcb2;
  font-size: 12px;
}

/* ---------- 投注动态 ---------- */

.race-feed-details {
  margin-top: 10px;
}

.race-feed-summary {
  color: #7d9186;
  font-size: 12px;
  cursor: pointer;
  user-select: none;
}

.race-feed-summary:hover {
  color: #a9bcb2;
}

.race-feed-list {
  max-height: 160px;
  margin: 6px 0 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
  /* 隐藏滚动条但保留滚动：Firefox 用 scrollbar-width，Chrome 109 用 ::-webkit-scrollbar */
  scrollbar-width: none;
}

.race-feed-list::-webkit-scrollbar {
  display: none;
}

.race-feed-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
  font-size: 12px;
}

.race-feed-sect {
  flex: 0 0 auto;
  max-width: 90px;
  overflow: hidden;
  color: #c8d6ce;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.race-feed-arrow {
  color: #7d9186;
}

.race-feed-beast {
  color: var(--gold, #caa96a);
  font-weight: 600;
}

.race-feed-amount {
  flex: 1 1 auto;
  color: #a9bcb2;
  text-align: right;
}

.race-my-bets {
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
}

.race-my-bet-row {
  padding: 3px 0;
  color: #c8d6ce;
  font-size: 12px;
}

.race-my-bet-row::before {
  content: '• ';
  color: var(--gold, #caa96a);
}

.race-amount {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 14px;
}

.race-amount-input {
  width: 100%;
}

.race-run-button {
  margin-top: 14px;
}

.race-note {
  margin-top: 8px;
  color: #7d9186;
  font-size: 12px;
  line-height: 1.6;
}

/* ---------- 结果 ---------- */

.race-ranks {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}

.race-rank-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--line);
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.02);
  font-size: 13px;
}

.race-rank-row.is-champion {
  border-color: var(--gold, #caa96a);
  background: rgba(202, 169, 106, 0.1);
}

.race-rank-row.is-champion .race-rank-name {
  color: var(--gold, #caa96a);
}

.race-rank-no {
  flex: 0 0 56px;
  color: #7d9186;
  font-size: 12px;
}

.race-rank-name {
  flex: 1 1 auto;
  color: #dce6e0;
}

.race-rank-odds {
  color: #a9bcb2;
  font-size: 12px;
}

.race-rank-tag {
  padding: 1px 6px;
  border: 1px solid rgba(202, 169, 106, 0.5);
  border-radius: 2px;
  color: var(--gold, #caa96a);
  font-size: 11px;
}

.race-rank-tag.is-picked {
  border-color: rgba(119, 184, 154, 0.5);
  color: #77b89a;
}

.race-outcome {
  margin-top: 16px;
}

.race-outcome-label {
  display: block;
  margin-top: 4px;
  font-family: 'STKaiti', 'KaiTi', serif;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.race-outcome-label.is-win,
.race-outcome-net .is-win {
  color: var(--gold, #caa96a);
}

.race-outcome-label.is-lose,
.race-outcome-net .is-lose {
  color: #b8735f;
}

.race-outcome-net {
  margin-top: 6px;
  color: #c8d6ce;
  font-size: 13px;
}

/* ---------- 底部按钮 ---------- */

.race-foot {
  display: flex;
  gap: 10px;
  margin-top: 18px;
}

.race-foot-button {
  flex: 1 1 0;
  padding: 8px 12px;
  font-size: 13px;
}

/* ---------- Tab 栏 ---------- */

.race-tabs {
  display: flex;
  gap: 0;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--line);
}

.race-tab {
  flex: 1 1 0;
  padding: 8px 0;
  border: none;
  border-bottom: 2px solid transparent;
  background: none;
  color: #7d9186;
  font-size: 13px;
  cursor: pointer;
  transition: color 160ms ease, border-color 160ms ease;
}

.race-tab:hover {
  color: #a9bcb2;
}

.race-tab.is-active {
  border-bottom-color: var(--gold, #caa96a);
  color: var(--gold, #caa96a);
}

/* ---------- 灵兽胜率统计 ---------- */

.race-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}

.race-stat-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 80px;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.014);
  text-align: center;
}

.race-stat-card strong {
  color: #dce6e0;
  font-size: 13px;
}

.race-stat-wins {
  color: var(--gold, #caa96a);
  font-size: 12px;
}

.race-stat-rate {
  color: #7d9186;
  font-size: 11px;
}

/* ---------- 历史列表 ---------- */

.race-history-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.race-history-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  font-size: 12px;
}

.race-history-time {
  flex: 0 0 82px;
  color: #7d9186;
}

.race-history-winner {
  flex: 0 0 44px;
  color: var(--gold, #caa96a);
  font-weight: 600;
}

.race-history-odds {
  flex: 0 0 46px;
  color: #a9bcb2;
}

.race-history-pool {
  flex: 1 1 auto;
  color: #7d9186;
  text-align: right;
}

/* ---------- 分页 ---------- */

.race-pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 12px;
}

.race-pager-button {
  padding: 4px 12px;
  font-size: 12px;
}

.race-pager-info {
  color: #7d9186;
  font-size: 12px;
}
</style>
