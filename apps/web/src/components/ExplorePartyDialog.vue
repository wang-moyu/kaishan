<script setup lang="ts">
import { computed, ref } from 'vue';

import type { SecretRealmView, SectStateView } from '../api/game';
import { formatAmount } from '../utils/format';
import { selectionBlockReason } from '../utils/discipleFilter';
import DisciplePicker from './DisciplePicker.vue';

/**
 * 选人出征（二级弹窗内容）。
 *
 * 只负责选人与本地校验；战力、成功率、扣资源、弟子受伤全部由服务端判定。
 * 提交后由父级关闭本弹窗并调接口。
 */
const props = defineProps<{
  realm: SecretRealmView;
  state: SectStateView;
  busy: boolean;
}>();

const emit = defineEmits<{
  explore: [realmId: string, discipleIds: string[]];
}>();

const selected = ref<string[]>([]);


const resourceNameMap = computed<Record<string, string>>(() =>
  Object.fromEntries(props.state.resources.map((resource) => [resource.id, resource.name])),
);


/** 按队伍上限自动挑人（规则与选人控件同一份：疗伤中 / 在外历练都不能出征）。 */
function pickUpToMax(): void {
  const now = Date.now();
  selected.value = props.state.disciples
    .filter(
      (disciple) =>
        selectionBlockReason(disciple, now, { blockInjured: true, blockAway: true }) === null,
    )
    .slice(0, props.realm.maxParty)
    .map((disciple) => disciple.id);
}

const canSubmit = computed(
  () =>
    !props.busy
    && selected.value.length >= props.realm.minParty
    && selected.value.length <= props.realm.maxParty,
);

function submit(): void {
  if (!canSubmit.value) {
    return;
  }
  emit('explore', props.realm.id, [...selected.value]);
}
</script>

<template>
  <section class="explore-party" aria-labelledby="explore-party-title">
    <header class="section-heading panel-heading compact-heading">
      <div>
        <p class="eyebrow">点将出征</p>
        <h2 id="explore-party-title">{{ realm.name }}</h2>
      </div>
      <span class="count-badge">{{ selected.length }}/{{ realm.maxParty }} 人</span>
    </header>

    <p class="realm-desc">{{ realm.description }}</p>

    <div class="realm-meta">
      <span>难度 {{ realm.difficulty }}</span>
      <span v-if="realm.dailyLimit === null">不限次数</span>
      <span v-else>次数 {{ realm.usedToday }}/{{ realm.dailyLimit }}</span>
      <span>队伍 {{ realm.minParty }}~{{ realm.maxParty }} 人</span>
    </div>

    <div class="realm-tags">
      <span class="tag-label">奖励</span>
      <span v-for="(amount, resourceId) in realm.rewards" :key="resourceId" class="reward-tag is-gain">
        {{ resourceNameMap[resourceId] ?? resourceId }} {{ formatAmount(amount) }}
      </span>
      <span class="tag-label">消耗</span>
      <span v-for="(amount, resourceId) in realm.entryCost" :key="resourceId" class="reward-tag is-cost">
        {{ resourceNameMap[resourceId] ?? resourceId }} {{ formatAmount(amount) }}
      </span>
    </div>

    <DisciplePicker
      v-model:selected="selected"
      :disciples="state.disciples"
      :min="realm.minParty"
      :max="realm.maxParty"
      :busy="busy"
      title="选择出征弟子"
    >
      <template #actions>
        <button class="quiet-button" type="button" @click="pickUpToMax">按上限自动选</button>
      </template>
    </DisciplePicker>

    <button
      class="action-button primary-action realm-button"
      :class="{ 'is-disabled': !canSubmit }"
      type="button"
      :disabled="busy"
      :aria-disabled="!canSubmit"
      @click="submit"
    >
      <span>出发探索（{{ selected.length }}/{{ realm.maxParty }}）</span>
    </button>

  </section>
</template>
