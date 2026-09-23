<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';

import type { DiscipleView } from '../api/game';
import { isInjured, selectionBlockReason } from '../utils/discipleFilter';
import DiscipleAvatar from './DiscipleAvatar.vue';

/**
 * 统一的选人控件（登门挑战 / 守擂阵容 / 秘境出征 / 赌坊论道 共用）。
 *
 * 只负责「候选过滤 + 选中与顺序 + 计数提示」：
 * - 选中值只有一个出口 `selected`：单选也走数组（最多 1 个），数组顺序就是点选顺序；
 * - 谁能选由 `selectionBlockReason` 统一裁决（疗伤 / 在外历练），与服务端同一口径；
 * - 「至少 N 人」「按钮什么时候可点」仍由调用方决定，这里只给提示位（默认提示 + `hint` 插槽）。
 */
const props = withDefaults(
  defineProps<{
    disciples: readonly DiscipleView[];
    /** 选中的弟子 id；顺序即点选顺序（= 出战顺序）。 */
    selected: readonly string[];
    /** single = 单选卡片（最多 1 人）。 */
    mode?: 'single' | 'multi';
    /** 最少几人（只用于提示文案；校验仍在调用方）。 */
    min?: number;
    /** 最多几人（满员后未选中的不可点）。 */
    max?: number;
    /** 受伤弟子是否禁选：守擂允许带伤守阵，传 false。 */
    blockInjured?: boolean;
    /** 在外历练的弟子是否禁选（服务端 requireNotAway 会拒绝，默认禁）。 */
    blockAway?: boolean;
    /** 初始排序：realm = 大境界从高到低（默认）；power = 战力；luck = 幸运值。 */
    sort?: DiscipleSortKey;
    /** 显示点选顺序角标（顺序有意义时打开）。 */
    showOrder?: boolean;
    /** 标题行文案。 */
    title?: string;
    busy?: boolean;
    emptyText?: string;
    /** 所有候选都被禁用时的提示（默认：都在疗伤或在外的统一文案）。 */
    allBlockedText?: string;
  }>(),
  {
    mode: 'multi',
    min: 1,
    max: 3,
    blockInjured: true,
    blockAway: true,
    sort: 'realm',
    showOrder: false,
    title: '选择弟子',
    busy: false,
    emptyText: '门下还没有弟子。',
    allBlockedText: '门下弟子都在疗伤或在外历练，暂时无人可出战。',
  },
);

const emit = defineEmits<{
  'update:selected': [discipleIds: string[]];
}>();

/** 顶部排序的三个键：都是「从高到低」，比较口径与 utils/discipleFilter 的 sortDisciples 一致。 */
type DiscipleSortKey = 'realm' | 'power' | 'luck';

const SORT_OPTIONS: readonly { value: DiscipleSortKey; label: string; hint: string }[] = [
  { value: 'realm', label: '境界 ↓', hint: '按大境界从高到低' },
  { value: 'power', label: '战力 ↓', hint: '按战力从高到低' },
  { value: 'luck', label: '幸运 ↓', hint: '按幸运值从高到低' },
];

/** 当前排序：初值由 `sort` prop 决定，之后由玩家在顶部切换。 */
const sortKey = ref<DiscipleSortKey>(props.sort);
watch(
  () => props.sort,
  (next) => {
    sortKey.value = next;
  },
);

/** 单选时给原生 radio 一个组名（同组才能用方向键切换）。 */
const groupName = `disciple-picker-${Math.random().toString(36).slice(2, 8)}`;

/** 每秒推进一次「现在」：疗伤到期 / 归队后自动恢复可选，不必等下一次 sync。 */
const nowTick = ref(Date.now());
const clock = window.setInterval(() => {
  nowTick.value = Date.now();
}, 1000);

onUnmounted(() => {
  window.clearInterval(clock);
});

/** 不能选的原因（疗伤中 / 在外历练）；null = 可选。 */
function blockReason(disciple: DiscipleView): string | null {
  return selectionBlockReason(disciple, nowTick.value, {
    blockInjured: props.blockInjured,
    blockAway: props.blockAway,
  });
}

const blockedIds = computed(
  () =>
    new Set(
      props.disciples
        .filter((disciple) => blockReason(disciple) !== null)
        .map((disciple) => disciple.id),
    ),
);

/**
 * 卡片上的状态标：被禁的（红）= 疗伤中 / 在外历练；允许但带状态的（灰）= 守擂里的带伤上阵。
 * 后者也要显示，不然「受伤能不能入队」在界面上完全看不出来。
 */
const statusById = computed(() => {
  const map = new Map<string, { text: string; blocked: boolean }>();
  for (const disciple of props.disciples) {
    const blocked = blockReason(disciple);
    if (blocked !== null) {
      map.set(disciple.id, { text: blocked, blocked: true });
    } else if (isInjured(disciple, nowTick.value)) {
      map.set(disciple.id, { text: '疗伤中', blocked: false });
    } else if (disciple.journey.status === 'active') {
      map.set(disciple.id, { text: '在外历练', blocked: false });
    }
  }
  return map;
});

/** 满员后未选中的不可点（已选的仍可取消）。 */
const full = computed(() => props.selected.length >= props.max);

function isPicked(discipleId: string): boolean {
  return props.selected.includes(discipleId);
}

/** 点选顺序（1 起）；未选中返回 0。 */
function pickOrder(discipleId: string): number {
  return props.selected.indexOf(discipleId) + 1;
}

function disabled(disciple: DiscipleView): boolean {
  if (props.busy) return true;
  if (blockedIds.value.has(disciple.id)) return true;
  return full.value && !isPicked(disciple.id);
}

const ordered = computed(() => {
  const list = [...props.disciples];
  if (sortKey.value === 'power') {
    list.sort((a, b) => b.combatPower - a.combatPower);
  } else if (sortKey.value === 'luck') {
    list.sort((a, b) => b.luck - a.luck);
  } else {
    // 大境界从高到低，同境界再比阶段（与 utils/discipleFilter 的 sortDisciples 同口径）。
    list.sort((a, b) => b.realmOrder - a.realmOrder || b.stage - a.stage);
  }
  return list;
});

/** 人数提示：固定人数的玩法说「请选 3 名」，区间玩法说「至少…最多…」。 */
const countHint = computed(() =>
  props.min === props.max
    ? `请选择 ${String(props.min)} 名弟子（当前 ${String(props.selected.length)} 名）`
    : `至少选 ${String(props.min)} 名、最多 ${String(props.max)} 名（当前 ${String(
        props.selected.length,
      )} 名）`,
);

function toggle(disciple: DiscipleView, event: Event): void {
  const checked = (event.target as HTMLInputElement).checked;
  if (props.mode === 'single') {
    emit('update:selected', checked ? [disciple.id] : []);
    return;
  }
  const next = [...props.selected];
  const index = next.indexOf(disciple.id);
  if (checked && index < 0) {
    next.push(disciple.id);
  }
  if (!checked && index >= 0) {
    next.splice(index, 1);
  }
  emit('update:selected', next);
}

// 状态刷新后（开始疗伤 / 出发历练）把已经不可选的 id 从选中里剔除，
// 免得拿着服务端一定会拒绝的队伍去提交。
watch(
  [() => props.disciples, blockedIds],
  () => {
    const next = props.selected.filter((id) => !blockedIds.value.has(id));
    if (next.length !== props.selected.length) emit('update:selected', next);
  },
);
</script>

<template>
  <div class="disciple-picker">
    <div class="disciple-picker-head">
      <span class="eyebrow">{{ title }}</span>
      <slot name="actions" />
      <span class="count-badge">已选 {{ selected.length }}/{{ max }}</span>
    </div>

    <div class="disciple-picker-sort" role="group" aria-label="排序方式">
      <span class="dp-sort-label">排序</span>
      <button
        v-for="option in SORT_OPTIONS"
        :key="option.value"
        class="dp-sort-button"
        :class="{ 'is-active': sortKey === option.value }"
        type="button"
        :aria-pressed="sortKey === option.value"
        :title="option.hint"
        @click="sortKey = option.value"
      >
        {{ option.label }}
      </button>
    </div>

    <ul class="disciple-picker-grid">
      <li v-for="disciple in ordered" :key="disciple.id">
        <label
          class="dp-card"
          :class="{
            'is-picked': isPicked(disciple.id),
            'is-blocked': blockedIds.has(disciple.id),
          }"
          :aria-disabled="disabled(disciple)"
        >
          <input
            class="dp-input"
            :type="mode === 'single' ? 'radio' : 'checkbox'"
            :name="groupName"
            :checked="isPicked(disciple.id)"
            :disabled="disabled(disciple)"
            @change="toggle(disciple, $event)"
          />
          <span v-if="showOrder && pickOrder(disciple.id) > 0" class="dp-order" aria-hidden="true">
            {{ pickOrder(disciple.id) }}
          </span>
          <span v-else-if="isPicked(disciple.id)" class="dp-order is-check" aria-hidden="true">✓</span>
          <span class="dp-avatar">
            <DiscipleAvatar
              :name="disciple.name"
              :gender="disciple.gender"
              :realm-id="disciple.realmId"
              :frame-id="disciple.avatarFrameId"
            />
          </span>
          <span class="dp-name">{{ disciple.name }}</span>
          <span class="dp-meta">
            <span>{{ disciple.stageName }}</span>
            <span>战力 {{ disciple.combatPower }}</span>
          </span>
          <span class="dp-status-slot">
            <span
              v-if="statusById.has(disciple.id)"
              class="dp-status"
              :class="{ 'is-blocked': statusById.get(disciple.id)?.blocked }"
            >
              {{ statusById.get(disciple.id)?.text }}
            </span>
          </span>
        </label>
      </li>
    </ul>

    <p v-if="disciples.length === 0" class="blocked-hint">{{ emptyText }}</p>
    <p v-else-if="blockedIds.size === disciples.length" class="blocked-hint">{{ allBlockedText }}</p>
    <p v-else-if="selected.length < min" class="blocked-hint">{{ countHint }}</p>
    <slot name="hint" />
  </div>
</template>
