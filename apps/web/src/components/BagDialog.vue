<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import type {
  EquipmentItemView,
  EquipmentSlotId,
  EquipmentView,
  SectStateView,
} from '../api/game';

/**
 * 装备背包（弹窗内容，外壳由 SectScreen 用 ModalShell 提供）：筛选、多选分解。
 * 名称、颜色、分解返还都取自服务端的 `equipment` 视图。
 */
const props = defineProps<{
  state: SectStateView;
  equipment: EquipmentView;
  busy: boolean;
}>();

const emit = defineEmits<{
  /** 分解选中的背包装备（穿在身上的不可选；件数与返还矿石由服务端复核）。 */
  salvage: [equipmentIds: string[]];
}>();

/* ---------- 台账：余额、背包容量（名字与数值都取自服务端） ---------- */

function resourceName(resourceId: string): string {
  return props.state.resources.find((resource) => resource.id === resourceId)?.name ?? resourceId;
}

const bagCount = computed(() => props.equipment.bagCount);
const bagCapacity = computed(() => props.equipment.bagCapacity);
const oreName = computed(() => resourceName('ore'));

/* ---------- 背包：筛选 / 多选 / 分解 ---------- */

const SLOT_ALL = 'all';

const slotFilter = ref<typeof SLOT_ALL | EquipmentSlotId>(SLOT_ALL);
const qualityFilter = ref<string>(SLOT_ALL);

const slotOptions = computed<{ id: typeof SLOT_ALL | EquipmentSlotId; name: string }[]>(() => [
  { id: SLOT_ALL, name: '全部' },
  ...props.equipment.slots.map((slot) => ({ id: slot.id, name: slot.name })),
]);

/**
 * 品质筛选项只列**当前装备里出现过**的品质：品质名与颜色都来自服务端视图，
 * 前端不硬编码品质表；某一品质没有装备时就不显示这个 chip。
 */
const qualityOptions = computed<{ id: string; name: string }[]>(() => {
  const names = new Map<string, string>();
  for (const item of props.equipment.items) {
    if (!names.has(item.quality)) names.set(item.quality, item.qualityName);
  }
  return [...names].map(([id, name]) => ({ id, name }));
});

/** 被筛掉的品质会在切换筛选条件后失效，这里同步回「全部」。 */
watch(qualityOptions, (options) => {
  if (qualityFilter.value !== SLOT_ALL && !options.some((option) => option.id === qualityFilter.value)) {
    qualityFilter.value = SLOT_ALL;
  }
});

const visibleItems = computed<EquipmentItemView[]>(() =>
  props.equipment.items.filter(
    (item) =>
      (slotFilter.value === SLOT_ALL || item.slot === slotFilter.value) &&
      (qualityFilter.value === SLOT_ALL || item.quality === qualityFilter.value),
  ),
);

/** 可分解 = 在背包里（穿在身上的不占背包，也不能分解）。 */
function isSalvageable(item: EquipmentItemView): boolean {
  return item.discipleId === null;
}

const selectedIds = ref<string[]>([]);

/** 选中集合始终与最新视图对齐：已被穿上 / 已分解的装备自动从选择里剔除。 */
const selectedItems = computed<EquipmentItemView[]>(() =>
  props.equipment.items.filter((item) => isSalvageable(item) && selectedIds.value.includes(item.id)),
);

const salvageOreTotal = computed(() =>
  selectedItems.value.reduce(
    (sum, item) => sum + (props.equipment.salvageOre[item.quality] ?? 0),
    0,
  ),
);

const salvageNames = computed(() => selectedItems.value.map((item) => item.name).join('、'));

function isSelected(item: EquipmentItemView): boolean {
  return selectedIds.value.includes(item.id);
}

function toggleSelect(item: EquipmentItemView): void {
  if (props.busy || !isSalvageable(item)) return;
  selectedIds.value = isSelected(item)
    ? selectedIds.value.filter((id) => id !== item.id)
    : [...selectedIds.value, item.id];
}

function clearSelection(): void {
  selectedIds.value = [];
  confirmingSalvage.value = false;
}

/** 二次确认（分解不可撤销）：确认后才提交。 */
const confirmingSalvage = ref(false);

function askSalvage(): void {
  if (props.busy || selectedItems.value.length === 0) return;
  confirmingSalvage.value = true;
}

function confirmSalvage(): void {
  if (props.busy || selectedItems.value.length === 0) return;
  const ids = selectedItems.value.map((item) => item.id);
  selectedIds.value = [];
  confirmingSalvage.value = false;
  emit('salvage', ids);
}
</script>

<template>
  <section class="equipment-panel" aria-labelledby="bag-title">
    <header class="section-heading panel-heading compact-heading">
      <h2 id="bag-title">背包</h2>
      <span class="count-badge">{{ bagCount }}/{{ bagCapacity }}</span>
    </header>

    <div class="equipment-filter-row" role="group" aria-label="按部位筛选">
          <span class="eyebrow">部位</span>
          <button
            v-for="option in slotOptions"
            :key="option.id"
            class="equipment-chip"
            :class="{ 'is-active': slotFilter === option.id }"
            type="button"
            :aria-pressed="slotFilter === option.id"
            @click="slotFilter = option.id"
          >
            {{ option.name }}
          </button>
        </div>

        <div v-if="qualityOptions.length > 0" class="equipment-filter-row" role="group" aria-label="按品质筛选">
          <span class="eyebrow">品质</span>
          <button
            class="equipment-chip"
            :class="{ 'is-active': qualityFilter === SLOT_ALL }"
            type="button"
            :aria-pressed="qualityFilter === SLOT_ALL"
            @click="qualityFilter = SLOT_ALL"
          >
            全部
          </button>
          <button
            v-for="option in qualityOptions"
            :key="option.id"
            class="equipment-chip"
            :class="{ 'is-active': qualityFilter === option.id }"
            type="button"
            :aria-pressed="qualityFilter === option.id"
            @click="qualityFilter = option.id"
          >
            {{ option.name }}
          </button>
        </div>

        <ul v-if="visibleItems.length > 0" class="equipment-list">
          <li
            v-for="item in visibleItems"
            :key="item.id"
            class="equipment-card"
            :class="{ 'is-worn': !isSalvageable(item), 'is-picked': isSelected(item) }"
            :style="{ borderColor: item.color }"
          >
            <label class="equipment-card-pick">
              <input
                type="checkbox"
                :checked="isSelected(item)"
                :disabled="busy || !isSalvageable(item)"
                :aria-label="isSalvageable(item) ? `选择分解 ${item.name}` : `${item.name} 已穿戴，不能分解`"
                @change="toggleSelect(item)"
              />
            </label>

            <div class="equipment-card-copy">
              <div class="equipment-card-title">
                <strong :style="{ color: item.color }">{{ item.name }}</strong>
                <span class="equipment-card-slot">{{ item.slotName }}</span>
              </div>
              <p class="equipment-card-attrs">
                主属性 {{ item.mainAttrName }} +{{ item.mainValue }} · 副属性 {{ item.subAttrName }} +{{ item.subValue }}
                · 战力 +{{ item.powerBonusBp / 100 }}%
              </p>
              <p class="equipment-card-owner">
                {{ isSalvageable(item) ? '背包' : `穿在 ${item.discipleName ?? '弟子'}身上` }}
                <template v-if="isSalvageable(item)">
                  · 分解返还{{ oreName }} {{ equipment.salvageOre[item.quality] ?? 0 }}
                </template>
              </p>
            </div>
          </li>
        </ul>

        <p v-else-if="equipment.items.length === 0" class="blocked-hint">
          还没有装备：去「炼器」打造，或讨伐妖王碰运气。
        </p>
        <p v-else class="blocked-hint">没有符合条件的装备。</p>

        <div v-if="selectedItems.length > 0 || confirmingSalvage" class="equipment-salvage">
          <p class="equipment-salvage-line">
            已选 <strong>{{ selectedItems.length }}</strong> 件 · 返还{{ oreName }}
            <strong>{{ salvageOreTotal }}</strong>
          </p>

          <template v-if="!confirmingSalvage">
            <div class="equipment-salvage-actions">
              <button class="quiet-button" type="button" :disabled="busy" @click="clearSelection">清空</button>
              <button
                class="action-button primary-action"
                type="button"
                :disabled="busy"
                @click="askSalvage"
              >
                分解 {{ selectedItems.length }} 件 · 返{{ oreName }} {{ salvageOreTotal }}
              </button>
            </div>
          </template>

          <div v-else class="equipment-salvage-confirm" role="group" aria-label="确认分解">
            <p>
              将分解 <strong>{{ selectedItems.length }}</strong> 件装备，返还{{ oreName }}
              <strong>{{ salvageOreTotal }}</strong>。
            </p>
            <p class="equipment-salvage-note">明细：{{ salvageNames }}。分解不可撤销。</p>
            <div class="equipment-salvage-actions">
              <button class="upgrade-button" type="button" :disabled="busy" @click="confirmingSalvage = false">
                取消
              </button>
              <button class="action-button primary-action" type="button" :disabled="busy" @click="confirmSalvage">
                确认分解
              </button>
            </div>
          </div>
        </div>
  </section>
</template>

<style scoped>
.equipment-panel {
  min-width: 0;
}

.equipment-choice:focus-visible,
.equipment-chip:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px rgba(202, 169, 106, 0.3);
}

.equipment-filter-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
}

.equipment-filter-row .eyebrow {
  margin-right: 2px;
}

.equipment-chip {
  padding: 5px 10px;
  border: 1px solid rgba(119, 184, 154, 0.16);
  border-radius: 3px;
  color: #9db3a8;
  background: rgba(255, 255, 255, 0.02);
  font-size: 11px;
  letter-spacing: 0.05em;
  transition: border-color 140ms ease, background-color 140ms ease, color 140ms ease;
}

.equipment-chip:not(:disabled):hover {
  border-color: rgba(202, 169, 106, 0.3);
  color: #e4ece6;
}

.equipment-chip.is-active {
  border-color: rgba(202, 169, 106, 0.46);
  color: var(--gold-bright, #e0cd97);
  background: rgba(202, 169, 106, 0.09);
}

.equipment-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 8px;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}

.equipment-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.016);
}

.equipment-card.is-picked {
  background: rgba(202, 169, 106, 0.08);
}

.equipment-card.is-worn {
  opacity: 0.78;
}

.equipment-card-pick input {
  margin: 2px 0 0;
  accent-color: #caa96a;
}

.equipment-card-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.equipment-card-title strong {
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.04em;
}

.equipment-card-slot {
  color: #7d9186;
  font-size: 11px;
}

.equipment-card-attrs {
  margin: 4px 0 0;
  color: #cbd8d0;
  font-size: 12px;
}

.equipment-card-owner {
  margin: 2px 0 0;
  color: #7d9186;
  font-size: 11px;
}

.equipment-salvage {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
}

.equipment-salvage-line {
  margin: 0;
  color: #9db3a8;
  font-size: 12px;
}

.equipment-salvage-line strong {
  color: var(--gold-bright, #e0cd97);
  font-weight: 500;
}

.equipment-salvage-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.equipment-salvage-actions .action-button {
  flex: 1 1 0;
}

.equipment-salvage-confirm {
  margin-top: 8px;
  padding: 8px 10px;
  border: 1px solid rgba(202, 169, 106, 0.3);
  border-radius: 4px;
  background: rgba(202, 169, 106, 0.06);
}

.equipment-salvage-confirm p {
  margin: 0;
  color: #dce6e0;
  font-size: 12px;
}

.equipment-salvage-note {
  margin-top: 4px !important;
  color: #7d9186 !important;
  font-size: 11px !important;
}
</style>
