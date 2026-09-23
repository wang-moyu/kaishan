<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import type { DiscipleView, SectStateView } from '../api/game';
import DisciplePicker from './DisciplePicker.vue';

/**
 * 守擂阵容（弹窗内容）：预设 3 人按顺序迎战来犯之敌，顺序就是迎战顺序。
 *
 * 注意：守阵是预设行为，受伤弟子也可以放进去（服务端也不检查伤势）。
 */
const props = defineProps<{
  state: SectStateView;
  busy: boolean;
}>();

const emit = defineEmits<{
  setLineup: [discipleIds: string[]];
}>();

const LINEUP_SIZE = 3;

const selected = ref<string[]>([]);

/** 当前已生效的守擂阵容（null = 尚未布阵）。 */
const current = computed(() => props.state.sect.defenseLineup);

const discipleById = computed(
  () => new Map(props.state.disciples.map((disciple) => [disciple.id, disciple])),
);

// 每隔一秒不必要；这里只在 state 变化时把已选同步成服务端的当前阵容。
watch(
  () => props.state.sect.defenseLineup,
  (lineup) => {
    selected.value = lineup === null ? [] : [...lineup];
  },
  { immediate: true },
);

const canSubmit = computed(() => !props.busy && selected.value.length === LINEUP_SIZE);

function submit(): void {
  if (!canSubmit.value) {
    return;
  }
  emit('setLineup', [...selected.value]);
}

function slotDisciple(discipleId: string): DiscipleView | undefined {
  return discipleById.value.get(discipleId);
}
</script>

<template>
  <section class="defense-lineup" aria-labelledby="defense-lineup-title">
    <header class="section-heading panel-heading compact-heading">
      <div>
        <p class="eyebrow">守擂阵容</p>
        <h2 id="defense-lineup-title">山门布阵</h2>
      </div>
      <span class="count-badge">{{ selected.length }}/{{ LINEUP_SIZE }} 人</span>
    </header>

    <p class="lineup-note">预设 3 人按顺序迎战来犯之敌；尚未布阵时别人无法挑战你。守阵是预设行为，受伤弟子也能入选。</p>

    <div class="lineup-current">
      <p class="eyebrow">当前阵容</p>
      <ol v-if="current && current.length > 0" class="lineup-slots">
        <li v-for="(discipleId, index) in current" :key="`${discipleId}-${index}`" class="lineup-slot">
          <span class="slot-index">{{ index + 1 }}</span>
          <template v-if="slotDisciple(discipleId)">
            <span class="slot-name">{{ slotDisciple(discipleId)?.name }}</span>
            <span class="public-tag">{{ slotDisciple(discipleId)?.stageName }}</span>
            <span class="public-tag">战力 {{ slotDisciple(discipleId)?.combatPower }}</span>
          </template>
          <span v-else class="slot-name slot-gone">已离宗</span>
        </li>
      </ol>
      <p v-else class="lineup-empty">尚未布阵</p>
    </div>

    <DisciplePicker
      v-model:selected="selected"
      :disciples="state.disciples"
      :min="LINEUP_SIZE"
      :max="LINEUP_SIZE"
      sort="power"
      :block-injured="false"
      :busy="busy"
      show-order
      title="选择迎战弟子"
    />

    <button
      class="action-button primary-action realm-button"
      :class="{ 'is-disabled': !canSubmit }"
      type="button"
      :disabled="busy"
      :aria-disabled="!canSubmit"
      @click="submit"
    >
      <span>确认阵容</span>
    </button>
  </section>
</template>
