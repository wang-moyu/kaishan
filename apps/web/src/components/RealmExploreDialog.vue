<script setup lang="ts">
import { computed } from 'vue';

import type { ActiveExplorationView, ExploreChoiceResult, SectStateView } from '../api/game';
import { formatAmount, formatTime } from '../utils/format';

/**
 * 交互式秘境探索（弹窗内容，外层由 SectScreen 的 ModalShell 包裹）。
 *
 * 关卡推进完全由服务端决定：每次选择之后返回的 `state.activeExploration` 就是最新断点，
 * 本组件只用「`result` 是否为空」在遭遇态与结果态之间切换，绝不自己算 currentStage。
 *
 * 两种状态：
 * - `result === null` → 遭遇态：遭遇名 + 描述 + 2~3 个选项（label + riskHint）。
 * - `result !== null` → 结果态：判定结论、本关奖励、受伤信息，再按服务端给的
 *   `nextEncounter` / `finalRewards` 决定是「继续前进」还是「完成」。
 */
const props = defineProps<{
  state: SectStateView;
  exploration: ActiveExplorationView;
  busy: boolean;
  /** 刚判定完的一次选择；null = 正在等玩家选选项。 */
  result: ExploreChoiceResult | null;
}>();

const emit = defineEmits<{
  choose: [explorationId: string, choiceId: string];
  abandon: [explorationId: string];
  close: [];
  dismissResult: [];
}>();

const resourceNameMap = computed<Record<string, string>>(() =>
  Object.fromEntries(props.state.resources.map((resource) => [resource.id, resource.name])),
);

/** 运行中的奖励账本（尚未入账）；结算区另有服务端的「总入账奖励」。 */
const ledgerEntries = computed(() => Object.entries(props.exploration.rewardsCollected));

/**
 * 结果态里服务端已经推进过 currentStage（本关通过且还有下一关时），
 * 而通关 / 失败时用的是收尾前的快照 —— 两种情形下「刚判定的那一关」算法不同，
 * 这里按服务端给的 nextEncounter 判断，而不是猜。
 */
function judgedStageOf(exploration: ActiveExplorationView, result: ExploreChoiceResult | null): number {
  if (result !== null && result.nextEncounter !== null) {
    return exploration.currentStage; // 已推进：currentStage 就是刚通过的那一关
  }
  return exploration.currentStage + 1;
}

const stageNumber = computed(() => judgedStageOf(props.exploration, props.result));

/** 进度点里已完成的数量（通关时快照尚未推进，要补上最后这一关）。 */
const completedDots = computed(() => {
  const result = props.result;
  if (result !== null && result.nextEncounter === null && result.outcome !== 'failure') {
    return props.exploration.currentStage + 1;
  }
  return props.exploration.currentStage;
});

const dots = computed(() =>
  Array.from({ length: props.exploration.totalStages }, (_, index) => {
    const done = completedDots.value;
    if (index < done) {
      return { stage: index + 1, state: 'done' as const, label: `第 ${index + 1} 关：已通过` };
    }
    if (index === done) {
      return { stage: index + 1, state: 'current' as const, label: `第 ${index + 1} 关：当前关卡` };
    }
    return { stage: index + 1, state: 'pending' as const, label: `第 ${index + 1} 关：尚未抵达` };
  }),
);

const OUTCOME_LABELS: Record<ExploreChoiceResult['outcome'], { title: string; glyph: string; key: string }> = {
  great_success: { title: '大成功', glyph: '大', key: 'great' },
  success: { title: '顺利通过', glyph: '胜', key: 'success' },
  failure: { title: '判定失败', glyph: '败', key: 'failure' },
};

/** 结果态的整体色性（大成功 / 成功 / 失败）；遭遇态用不到，兜一个中性值。 */
const outcomeClass = computed(() =>
  props.result === null ? 'is-success' : `is-${OUTCOME_LABELS[props.result.outcome].key}`,
);

/** 通关时 `finalRewards` 是整场入账总额，账本（分关累计）就不再重复列一遍。 */
const showLedger = computed(() => props.result === null || props.result.finalRewards === null);
/** 判定档位的文案与字标（只在结果态用到）。 */
const outcome = computed(() => (props.result === null ? null : OUTCOME_LABELS[props.result.outcome]));

function choiceStyle(index: number): string {
  return `--choice-index: ${index}`;
}

/** 读屏播报用的一句话：遭遇态报关卡与遭遇名，结果态报判定与结论（常驻 live region）。 */
const statusText = computed(() => {
  const result = props.result;
  if (result === null) {
    return `第 ${stageNumber.value} 关遭遇「${props.exploration.encounter.name}」`;
  }
  return `${outcome.value?.title ?? ''}：${result.message}`;
});

function choose(choiceId: string): void {
  if (props.busy) return;
  emit('choose', props.exploration.id, choiceId);
}

/** 放弃：二次确认在本地完成（服务端只认已确认的请求），已获奖励照常入账。 */
function requestAbandon(): void {
  if (props.busy) return;
  const confirmed = window.confirm('放弃本次探索？已获奖励照常入账，入场费不予退还。');
  if (!confirmed) return;
  emit('abandon', props.exploration.id);
}
</script>

<template>
  <section class="realm-explore" :aria-busy="busy" aria-labelledby="realm-explore-title">
    <header class="section-heading panel-heading compact-heading">
      <div>
        <p class="eyebrow">{{ result ? '判定结果' : '秘境遭遇' }}</p>
        <h2 id="realm-explore-title">{{ exploration.realmName }}</h2>
      </div>
      <span class="count-badge">第 {{ stageNumber }}/{{ exploration.totalStages }} 关</span>
    </header>

    <ol class="explore-progress">
      <li v-for="dot in dots" :key="dot.stage" class="explore-dot" :class="`is-${dot.state}`">
        <span class="explore-dot-ink" aria-hidden="true" />
        <span class="explore-dot-text">{{ dot.label }}</span>
      </li>
    </ol>

    <!-- 常驻 live region：遭遇与判定结论变化时由读屏播报（视觉上裁掉）。 -->
    <p class="explore-status-text" role="status">{{ statusText }}</p>
    <template v-if="result === null">
      <div class="explore-scene">
        <h3 class="explore-scene-name">{{ exploration.encounter.name }}</h3>
        <p class="explore-scene-desc">{{ exploration.encounter.description }}</p>
      </div>

      <ul class="explore-choices">
        <li
          v-for="(choice, index) in exploration.encounter.choices"
          :key="choice.id"
          class="explore-choice-item"
          :style="choiceStyle(index)"
        >
          <button
            class="explore-choice"
            :class="{ 'is-busy': busy }"
            type="button"
            :disabled="busy"
            :aria-disabled="busy"
            @click="choose(choice.id)"
          >
            <span class="explore-choice-label">{{ choice.label }}</span>
            <span class="explore-choice-risk">{{ busy ? '判定中…' : choice.riskHint }}</span>
          </button>
        </li>
      </ul>

      <p v-if="busy" class="explore-hint" role="status">正在与秘境同步，请勿重复下令。</p>
    </template>

    <template v-else>
      <div class="explore-outcome" :class="outcomeClass">
        <span
          class="result-badge"
          :class="result.outcome === 'failure' ? 'is-lose' : 'is-win'"
          aria-hidden="true"
        >
          {{ outcome?.glyph }}
        </span>
        <div class="explore-outcome-copy">
          <strong class="explore-outcome-title">{{ outcome?.title }}</strong>
          <p class="explore-outcome-message">{{ result.message }}</p>
        </div>
      </div>

      <div class="explore-rewards">
        <span class="tag-label">本关奖励</span>
        <span
          v-for="(amount, resourceId) in result.stageRewards"
          :key="resourceId"
          class="reward-tag is-gain"
        >
          {{ resourceNameMap[resourceId] ?? resourceId }} {{ formatAmount(amount) }}
        </span>
        <span v-if="Object.keys(result.stageRewards).length === 0" class="explore-rewards-empty">无奖励</span>
      </div>

      <p v-if="result.injury" class="explore-injury">
        {{ result.injury.discipleName }} 在此受伤，疗伤至 {{ formatTime(result.injury.until) }}，期间无法出战。
      </p>
    </template>

    <div v-if="showLedger" class="explore-ledger">
      <span class="tag-label">已获奖励</span>
      <span v-for="[resourceId, amount] in ledgerEntries" :key="resourceId" class="reward-tag is-gain">
        {{ resourceNameMap[resourceId] ?? resourceId }} {{ formatAmount(amount) }}
      </span>
      <span v-if="ledgerEntries.length === 0" class="explore-ledger-empty">尚无战利品入账</span>
    </div>

    <template v-if="result !== null">
      <div v-if="result.finalRewards !== null" class="explore-final">
        <span class="tag-label">总入账奖励</span>
        <span
          v-for="(amount, resourceId) in result.finalRewards"
          :key="resourceId"
          class="reward-tag is-gain"
        >
          {{ resourceNameMap[resourceId] ?? resourceId }} {{ formatAmount(amount) }}
        </span>
      </div>

      <button
        v-if="result.nextEncounter !== null"
        class="action-button primary-action realm-button explore-continue"
        :class="{ 'is-disabled': busy }"
        type="button"
        :disabled="busy"
        :aria-disabled="busy"
        @click="emit('dismissResult')"
      >
        <span>继续前进</span>
      </button>
      <p v-if="result.nextEncounter !== null" class="explore-hint">
        下一关：{{ result.nextEncounter.name }}
      </p>

      <button
        v-if="result.nextEncounter === null"
        class="action-button primary-action realm-button explore-continue"
        type="button"
        @click="emit('close')"
      >
        <span>完成</span>
      </button>
      <p v-if="result.nextEncounter === null && result.outcome === 'failure'" class="blocked-hint">
        探索终止：队伍带着已获奖励撤出秘境。
      </p>
    </template>

    <footer class="explore-footer">
      <button class="explore-abandon" type="button" :disabled="busy" @click="requestAbandon">
        放弃探索
      </button>
      <p class="explore-footer-note">放弃后已获奖励照常入账，入场费不予退还。</p>
    </footer>
  </section>
</template>
