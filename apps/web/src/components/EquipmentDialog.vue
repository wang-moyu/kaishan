<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import type {
  EquipmentMainAttr,
  EquipmentSlotId,
  EquipmentSlotView,
  EquipmentView,
  SectStateView,
} from '../api/game';
import { formatAmount } from '../utils/format';

/**
 * 炼器（弹窗内容，外壳由 SectScreen 用 ModalShell 提供）。背包在单独的 BagDialog。
 *
 * 解锁状态、价格、可选部位与法器主属性候选都取自服务端的 `equipment` 视图，前端不复制规则。
 */
const props = defineProps<{
  state: SectStateView;
  equipment: EquipmentView;
  busy: boolean;
}>();

const emit = defineEmits<{
  /** 炼器：法器必须带 mainAttr（speed / luck），其他部位传 undefined；quality 为所选品质。 */
  forge: [slot: EquipmentSlotId, mainAttr: EquipmentMainAttr | undefined, quality: string];
}>();

/* ---------- 台账：余额、背包容量（名字与数值都取自服务端） ---------- */

function resourceName(resourceId: string): string {
  return props.state.resources.find((resource) => resource.id === resourceId)?.name ?? resourceId;
}

/** 资源余额（最小单位）；查不到时按 0 处理 —— 按钮自然不可点，不会伪造余额。 */
function resourceBalance(resourceId: string): number {
  return Number(props.state.resources.find((resource) => resource.id === resourceId)?.balance ?? 0);
}

const bagCount = computed(() => props.equipment.bagCount);
const bagCapacity = computed(() => props.equipment.bagCapacity);
/** 背包满 = 不能再炼器（分解 / 卸下也一并被服务端拦住）。 */
const bagFull = computed(() => bagCount.value >= bagCapacity.value);
const oreName = computed(() => resourceName('ore'));

/* ---------- 炼器 ---------- */

/** 只有法器有主属性候选（身法 / 幸运）；其余部位由服务端按规则固定。 */
function toMainAttr(id: string): EquipmentMainAttr | null {
  return id === 'speed' || id === 'luck' ? id : null;
}

const forgeSlot = ref<EquipmentSlotId>(props.equipment.slots[0]?.id ?? 'weapon');
const forgeMainAttr = ref<EquipmentMainAttr | null>(
  toMainAttr(props.equipment.slots[0]?.mainAttrChoices[0]?.id ?? ''),
);

const currentSlot = computed<EquipmentSlotView | null>(
  () => props.equipment.slots.find((slot) => slot.id === forgeSlot.value) ?? null,
);

/**
 * 换部位时把主属性对齐到该部位的候选（法器默认第一个候选；其他部位清空）。
 * 只在部位 id 变化时触发 —— 炼器 / 分解后装备视图被换成新对象，不会因此重置玩家的选择。
 */
watch(forgeSlot, (slotId) => {
  const slot = props.equipment.slots.find((item) => item.id === slotId) ?? null;
  const first = slot?.mainAttrChoices[0];
  forgeMainAttr.value = first === undefined ? null : toMainAttr(first.id);
});

function selectSlot(slot: EquipmentSlotView): void {
  if (props.busy) return;
  forgeSlot.value = slot.id;
}

/* 装备二期：品质由玩家选；默认选当前炼器坊能炼的最高品质。 */
const forgeQuality = ref<string>(
  [...props.equipment.forgeOptions].reverse().find((option) => option.unlocked)?.quality ?? 'common',
);

const currentOption = computed(
  () => props.equipment.forgeOptions.find((option) => option.quality === forgeQuality.value) ?? null,
);

const currentCost = computed<Record<string, string>>(() => currentOption.value?.cost ?? props.equipment.forgeCost);

/** 成功率文案：凡品必定成功；其余显示三种结果的概率。 */
const oddsText = computed(() => {
  const odds = currentOption.value?.odds;
  if (odds === undefined || odds.success >= 1) return '必定成功';
  const pct = (value: number) => `${String(Math.round(value * 100))}%`;
  return `成功 ${pct(odds.success)} · 降级 ${pct(odds.downgrade)} · 失败 ${pct(odds.fail)}`;
});

/** 单次消耗（最小单位 → 展示单位）。 */
const forgeCostText = computed(() =>
  Object.entries(currentCost.value)
    .map(([resourceId, amount]) => `${resourceName(resourceId)} ${formatAmount(amount)}`)
    .join(' · '),
);

/** 按当前余额还差哪几样（只用于提前置灰；最终裁决在服务端）。 */
const forgeMissing = computed(() =>
  Object.entries(currentCost.value)
    .filter(([resourceId, amount]) => resourceBalance(resourceId) < Number(amount))
    .map(([resourceId]) => resourceName(resourceId)),
);

const forgeHint = computed<string | null>(() => {
  if (bagFull.value) {
    return `背包已满（${String(bagCount.value)}/${String(bagCapacity.value)}），请先分解`;
  }
  if (forgeMissing.value.length > 0) {
    return `${forgeMissing.value.join('、')}不足`;
  }
  return null;
});

const canForge = computed(
  () =>
    props.equipment.unlocked &&
    (currentOption.value?.unlocked ?? true) &&
    !bagFull.value &&
    forgeMissing.value.length === 0 &&
    !props.busy,
);

function onForge(): void {
  if (!canForge.value) return;
  const slot = currentSlot.value;
  // 有主属性候选（法器）时必须选一个；其余部位不能带 mainAttr（服务端严格校验）。
  const hasChoices = (slot?.mainAttrChoices.length ?? 0) > 0;
  emit('forge', forgeSlot.value, hasChoices ? (forgeMainAttr.value ?? undefined) : undefined, forgeQuality.value);
}

</script>

<template>
  <section class="equipment-panel" aria-labelledby="equipment-title">
    <header class="section-heading panel-heading compact-heading">
      <h2 id="equipment-title">炼器</h2>
      <span class="count-badge">炼器坊 {{ equipment.workshopLevel }} 级 · 背包 {{ bagCount }}/{{ bagCapacity }}</span>
    </header>

    <p v-if="!equipment.unlocked" class="blocked-hint">
      {{ equipment.blockedReason ?? '炼器尚未开启，需要宗门 2 级' }}
    </p>

    <template v-else>
      <p class="eyebrow">选择品质</p>
      <div class="equipment-choices" role="group" aria-label="炼器品质">
        <button
          v-for="option in equipment.forgeOptions"
          :key="option.quality"
          class="equipment-choice"
          :class="{ 'is-selected': forgeQuality === option.quality }"
          type="button"
          :disabled="busy || !option.unlocked"
          :aria-pressed="forgeQuality === option.quality"
          @click="forgeQuality = option.quality"
        >
          <strong :style="option.unlocked ? { color: option.color } : undefined">{{ option.name }}</strong>
          <small v-if="!option.unlocked">炼器坊 {{ option.workshopLevel }} 级</small>
        </button>
      </div>

      <p class="eyebrow equipment-row-label">选择部位</p>
      <div class="equipment-choices" role="group" aria-label="炼器部位">
        <button
          v-for="slot in equipment.slots"
          :key="slot.id"
          class="equipment-choice"
          :class="{ 'is-selected': forgeSlot === slot.id }"
          type="button"
          :disabled="busy"
          :aria-pressed="forgeSlot === slot.id"
          @click="selectSlot(slot)"
        >
          <strong>{{ slot.name }}</strong>
        </button>
      </div>

      <template v-if="(currentSlot?.mainAttrChoices.length ?? 0) > 0">
        <p class="eyebrow equipment-row-label">法器主属性</p>
        <div class="equipment-choices" role="group" aria-label="法器主属性">
          <button
            v-for="choice in currentSlot?.mainAttrChoices ?? []"
            :key="choice.id"
            class="equipment-choice"
            :class="{ 'is-selected': forgeMainAttr === choice.id }"
            type="button"
            :disabled="busy"
            :aria-pressed="forgeMainAttr === choice.id"
            @click="forgeMainAttr = toMainAttr(choice.id)"
          >
            <strong>{{ choice.name }}</strong>
          </button>
        </div>
      </template>

      <dl class="equipment-facts">
        <div>
          <dt>成功率</dt>
          <dd>{{ oddsText }}</dd>
        </div>
        <div>
          <dt>单次消耗</dt>
          <dd>{{ forgeCostText }}</dd>
        </div>
        <div>
          <dt>现有{{ oreName }}</dt>
          <dd>{{ formatAmount(resourceBalance('ore')) }}</dd>
        </div>
        <div v-if="currentCost.xuantie !== undefined">
          <dt>现有玄铁</dt>
          <dd>{{ formatAmount(resourceBalance('xuantie')) }}</dd>
        </div>
        <div>
          <dt>现有灵石</dt>
          <dd>{{ formatAmount(resourceBalance('spiritStone')) }}</dd>
        </div>
      </dl>

      <p v-if="forgeHint !== null" class="blocked-hint">{{ forgeHint }}</p>

      <button
        class="action-button primary-action equipment-forge-button"
        :class="{ 'is-disabled': !canForge }"
        type="button"
        :disabled="!canForge"
        :aria-disabled="!canForge"
        @click="onForge"
      >
        <span>炼制</span>
      </button>
    </template>
  </section>
</template>

<style scoped>
.equipment-panel {
  min-width: 0;
}

.equipment-locked {
  margin-top: 12px;
}

.equipment-choices {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(84px, 1fr));
  gap: 8px;
  margin-top: 8px;
}

.equipment-row-label {
  margin-top: 14px;
}

.equipment-choice {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 4px;
  color: #cbd8d0;
  background: rgba(255, 255, 255, 0.014);
  font-size: 13px;
  letter-spacing: 0.05em;
  transition: border-color 140ms ease, background-color 140ms ease, color 140ms ease;
}

.equipment-choice:not(:disabled):hover {
  border-color: rgba(119, 184, 154, 0.4);
}

.equipment-choice.is-selected {
  border-color: rgba(202, 169, 106, 0.55);
  color: var(--gold-bright, #e0cd97);
  background: rgba(202, 169, 106, 0.1);
}

.equipment-choice:focus-visible,
.equipment-choice:disabled {
  color: #63756c;
  cursor: not-allowed;
}

.equipment-facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 12px;
  margin-top: 14px;
}

.equipment-facts > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid rgba(119, 184, 154, 0.12);
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.014);
}

.equipment-facts dt {
  color: #7d9186;
  font-size: 11px;
  letter-spacing: 0.04em;
}

.equipment-facts dd {
  margin: 0;
  color: #dce6e0;
  font-size: 12px;
}

.equipment-forge-button {
  width: 100%;
  min-height: 42px;
  justify-content: center;
  margin-top: 12px;
}
</style>
