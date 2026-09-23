<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';

import type { ChallengeResultView, DiscipleView, PublicSectView, SectStateView } from '../api/game';
import { formatAmount } from '../utils/format';
import DisciplePicker from './DisciplePicker.vue';

/**
 * 发起挑战（弹窗内容）：选攻方 3 人，点击顺序就是对阵顺序。
 *
 * 挑战情报（剩余次数/等级差/胜利奖励/守擂方式）全部来自服务端预览；
 * 对方守擂阵容不可见（自动守擂连人选都不可见）；受伤弟子不能出战。
 * 打完以后（`result` 非 null）弹窗切换成战报态：逐轮显示双方弟子名字、战力、胜负，最后是总结果与实际奖励。
 */
const props = defineProps<{
  target: PublicSectView;
  state: SectStateView;
  busy: boolean;
  /** 刚打完的战报；null = 还在选人阶段。 */
  result: ChallengeResultView | null;
}>();

const emit = defineEmits<{
  challenge: [targetSectId: string, discipleIds: string[]];
  close: [];
}>();

const LINEUP_SIZE = 3;

const selected = ref<string[]>([]);


onUnmounted(() => {
  clearRevealTimers();
});

const discipleById = computed(
  () => new Map(props.state.disciples.map((disciple) => [disciple.id, disciple])),
);


/** 把已选三人按战力从高到低重排（省得手动取消重选）。 */
function sortByPower(): void {
  selected.value = [...selected.value].sort(
    (a, b) => (discipleById.value.get(b)?.combatPower ?? 0) - (discipleById.value.get(a)?.combatPower ?? 0),
  );
}

/** 服务端算好的挑战资格：能不能打、为什么不能打都由它裁决。 */
const canChallenge = computed(() => props.target.challenge?.canChallenge === true);

/** 不能挑战的原因文案（稳定原因码 → 中文）：只在挑战弹窗展示，档案页不重复。 */
const BLOCKED_LABELS: Record<string, string> = {
  self: '不能挑战自己的宗门',
  daily_limit: '今日挑战次数已用完',
  already_challenged_today: '今日已挑战过该宗门（同一目标每日 1 次）',
  defender_insufficient: '对方门下弟子不足 3 人，暂时无法应战',
};

const blockedText = computed(() => {
  const reason = props.target.challenge?.blockedReason;
  if (reason === null || reason === undefined) {
    return null;
  }
  return BLOCKED_LABELS[reason] ?? '暂时无法挑战';
});

const canSubmit = computed(
  () => !props.busy && canChallenge.value && selected.value.length === LINEUP_SIZE,
);

function submit(): void {
  if (!canSubmit.value) {
    return;
  }
  emit('challenge', props.target.sectId, [...selected.value]);
}

function slotDisciple(discipleId: string): DiscipleView | undefined {
  return discipleById.value.get(discipleId);
}

/** 战报比分（我方胜轮数 : 对方胜轮数）。 */
const scoreText = computed(() => {
  const result = props.result;
  if (result === null) {
    return '';
  }
  const wins = result.rounds.filter((round) => round.winner === 'attacker').length;
  return `${wins}:${result.rounds.length - wins}`;
});

/** 逐轮揭示：result 到达后每 800ms 多显示一轮，全部揭示后再显示总结果。 */
const revealedCount = ref(0);
let revealTimers: number[] = [];

function clearRevealTimers(): void {
  for (const id of revealTimers) window.clearTimeout(id);
  revealTimers = [];
}

watch(
  () => props.result,
  (result) => {
    clearRevealTimers();
    revealedCount.value = 0;
    if (result === null) return;
    for (let i = 0; i < result.rounds.length; i++) {
      revealTimers.push(
        window.setTimeout(() => { revealedCount.value = i + 1; }, (i + 1) * 800),
      );
    }
  },
);

const visibleRounds = computed(() => {
  if (props.result === null) return [];
  return props.result.rounds.slice(0, revealedCount.value);
});

const allRevealed = computed(() => {
  if (props.result === null) return false;
  return revealedCount.value >= props.result.rounds.length;
});

/** 挑战情报（来自服务端预览；null = 观看者没有宗门，面板不会放行到这里）。 */
const preview = computed(() => props.target.challenge);

const levelDiffText = computed(() => {
  const challenge = preview.value;
  if (challenge === null || challenge === undefined) {
    return '';
  }
  const diff = challenge.levelDifference;
  if (diff === 0) return '同级';
  return diff > 0 ? `对方高 ${diff} 级` : `对方低 ${-diff} 级`;
});
</script>

<template>
  <section class="challenge-dialog" aria-labelledby="challenge-dialog-title">
    <header class="section-heading panel-heading compact-heading">
      <div>
        <p class="eyebrow">{{ result ? '战报' : '登门挑战' }}</p>
        <h2 id="challenge-dialog-title">{{ target.name }}</h2>
      </div>
      <span class="count-badge">{{ target.levelName }}</span>
    </header>

    <!-- 战报态：逐轮揭示谁打谁、战力多少、谁赢，全部揭示后显示总结果。 -->
    <template v-if="result">
      <p class="lineup-note">
        双方各出 3 人逐对交手，先赢 2 轮者胜；单轮平局算守擂方胜。
      </p>

      <div class="lineup-current">
        <p class="eyebrow">{{ allRevealed ? '逐轮战报' : '对决中…' }}</p>
        <ol class="round-list is-flush">
          <li v-for="round in visibleRounds" :key="round.round" class="round-row round-reveal">
            <span class="round-no">第 {{ round.round }} 轮</span>
            <span class="round-side" :class="round.winner === 'attacker' ? 'is-win' : 'is-lose'">
              {{ round.attackerName }} {{ round.attackerPower }}
            </span>
            <span class="round-vs">对</span>
            <span class="round-side" :class="round.winner === 'defender' ? 'is-win' : 'is-lose'">
              {{ round.defenderName }} {{ round.defenderPower }}
            </span>
          </li>
        </ol>
      </div>

      <template v-if="allRevealed">
        <div class="challenge-outcome">
          <span class="result-badge" :class="result.result === 'win' ? 'is-win' : 'is-lose'" aria-hidden="true">
            {{ result.result === 'win' ? '胜' : '负' }}
          </span>
          <span class="challenge-outcome-text">
            <strong>{{ scoreText }}</strong>
            · {{ result.message }}
          </span>
        </div>

        <p class="challenge-reward-line">
          实际奖励：声望 +{{ result.reputationGained }}，灵石 +{{ formatAmount(result.spiritStoneGained) }}
          <template v-if="result.result === 'win' && result.reputationGained === 0 && result.spiritStoneGained === 0">
            （零奖励胜利）
          </template>
          <template v-else-if="result.result === 'lose'">（失败无奖励）</template>
          · 守擂方式：{{ result.defenseMode === 'configured' ? '手动阵容' : '临时自动' }}
        </p>

        <button class="action-button primary-action realm-button" type="button" @click="emit('close')">
          <span>知道了</span>
        </button>
      </template>
    </template>

    <template v-else>
      <div v-if="preview" class="challenge-info">
        <span>今日剩余 {{ preview.remaining }}/{{ preview.dailyLimit }} 次</span>
        <span>
          我方 {{ props.state.sect.level }} 级 · 对方 {{ props.target.level }} 级（{{ levelDiffText }}）
        </span>
        <span>
          若胜利：声望 +{{ preview.rewardPreview.reputation }}，灵石 +
          {{ formatAmount(preview.rewardPreview.spiritStone) }}
        </span>
        <span>
          {{ preview.defenseMode === 'configured' ? '对方已设置守擂阵容' : '对方将使用临时自动守擂' }}
        </span>
      </div>

      <p v-if="blockedText" class="blocked-hint is-warning">{{ blockedText }}</p>

      <p class="lineup-note">
        双方各出 3 人逐对交手，先赢 2 轮者胜；对方守擂阵容不可见。点击顺序就是对阵顺序。
      </p>

      <div class="lineup-current">
        <div class="disciple-picker-head">
          <span class="eyebrow">我方出战顺序（{{ selected.length }}/{{ LINEUP_SIZE }}）</span>
          <button
            class="quiet-button"
            type="button"
            :disabled="selected.length < 2"
            @click="sortByPower"
          >
            按战力重排
          </button>
        </div>
        <ol class="lineup-slots">
          <li v-for="index in LINEUP_SIZE" :key="index" class="lineup-slot">
            <span class="slot-index">{{ index }}</span>
            <template v-if="selected[index - 1]">
              <span class="slot-name">{{ slotDisciple(selected[index - 1])?.name }}</span>
              <span class="public-tag">战力 {{ slotDisciple(selected[index - 1])?.combatPower }}</span>
            </template>
            <span v-else class="slot-name slot-gone">待选</span>
          </li>
        </ol>
      </div>

      <DisciplePicker
        v-model:selected="selected"
        :disciples="state.disciples"
        :min="LINEUP_SIZE"
        :max="LINEUP_SIZE"
        :busy="busy"
        show-order
        title="选择出战弟子"
      />

      <button
        class="action-button primary-action realm-button"
        :class="{ 'is-disabled': !canSubmit }"
        type="button"
        :disabled="busy"
        :aria-disabled="!canSubmit"
        @click="submit"
      >
        <span>发起挑战（{{ selected.length }}/{{ LINEUP_SIZE }}）</span>
      </button>
      <p
        v-if="preview && preview.rewardPreview.spiritStone === 0"
        class="blocked-hint is-warning"
      >
        胜利无奖励，仍消耗 1 次：对方等级低出 3 级以上，此战只有胜负没有收益。
      </p>
    </template>
  </section>
</template>
