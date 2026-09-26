<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';

import type { EquipmentMainAttr, EquipmentSlotId, MeritShopView, SectStateView } from '../api/game';
import { exchangeBossMerit, fetchMeritShop } from '../api/game';
import { formatAmount, toDisplayUnits } from '../utils/format';
import LoadingState from './LoadingState.vue';

/**
 * 功勋兑换（弹窗内容，外壳由 SectScreen 的 ModalShell 提供）。
 *
 * 分类（标签页）、价目、可选部位都来自 GET /game/merit-shop，前端不写死；以后开放新的兑换物，
 * 服务端加分类 / 条目即可。资源类按个数兑换，装备类一次一件、自选部位（法器再选主属性）。
 * 余额取自 state，兑换成功把新 state 交给上层。
 */
const props = defineProps<{
  state: SectStateView;
  busy: boolean;
}>();

const emit = defineEmits<{
  'state-update': [state: SectStateView];
  notify: [tone: 'success' | 'warning', title: string, message: string];
  /** 兑到装备：让上层刷新背包件数。 */
  'equipment-changed': [];
}>();

const shop = ref<MeritShopView | null>(null);
const loadError = ref<string | null>(null);
const submitting = ref(false);

onMounted(async () => {
  try {
    shop.value = await fetchMeritShop();
  } catch (caught) {
    loadError.value = caught instanceof Error ? caught.message : '功勋兑换读取失败';
  }
});

function balanceOf(resourceId: string): number {
  return Number(props.state.resources.find((resource) => resource.id === resourceId)?.balance ?? 0);
}

/** 功勋余额（展示单位）；价目也是展示单位，直接比。 */
const merit = computed(() => toDisplayUnits(balanceOf('bossMerit')));

/* ---------- 标签页：分类由服务端给（与坊市同一套 tablist 约定） ---------- */

const tabs = computed(() => shop.value?.categories ?? []);
const tab = ref('');
const tabButtons = ref<Record<string, HTMLButtonElement | null>>({});

watch(tabs, (list) => {
  if (list.length > 0 && !list.some((item) => item.id === tab.value)) tab.value = list[0]!.id;
});

function setTabButton(id: string, element: Element | null): void {
  if (element instanceof HTMLButtonElement) tabButtons.value[id] = element;
  else delete tabButtons.value[id];
}

function onTabKeydown(event: KeyboardEvent, current: string): void {
  const list = tabs.value;
  const index = list.findIndex((item) => item.id === current);
  if (index < 0) return;
  let nextIndex = -1;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % list.length;
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + list.length) % list.length;
  else if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = list.length - 1;
  else return;
  const target = list[nextIndex];
  if (target === undefined) return;
  event.preventDefault();
  tab.value = target.id;
  void nextTick(() => tabButtons.value[target.id]?.focus());
}

/* ---------- 资源：按个数兑换 ---------- */

const resourceItems = computed(() => shop.value?.items.filter((item) => item.category === 'resource') ?? []);
const resourceId = ref('');
const quantityInput = ref('1');

watch(resourceItems, (list) => {
  if (list.length > 0 && !list.some((item) => item.id === resourceId.value)) resourceId.value = list[0]!.id;
});

const resourceItem = computed(() => resourceItems.value.find((item) => item.id === resourceId.value) ?? null);
const maxQuantity = computed(() => shop.value?.maxResourceQuantity ?? 1);

/** 买得起的最多个数（不超过单次上限）。 */
const affordableQuantity = computed(() => {
  const item = resourceItem.value;
  if (item === null || item.cost <= 0) return 0;
  return Math.min(maxQuantity.value, Math.floor(merit.value / item.cost));
});

const quantity = computed(() => {
  const value = Number(quantityInput.value);
  return Number.isInteger(value) && value >= 1 ? value : 0;
});

const resourceCost = computed(() => (resourceItem.value?.cost ?? 0) * quantity.value);

const resourceBlocked = computed<string | null>(() => {
  if (resourceItem.value === null) return '暂无可兑换的资源';
  if (quantity.value <= 0) return '请输入兑换个数';
  if (quantity.value > maxQuantity.value) return `一次最多兑换 ${String(maxQuantity.value)} 个`;
  if (resourceCost.value > merit.value) return '功勋不足';
  return null;
});

/* ---------- 装备：一次一件，自选品质 / 部位 / 法器主属性 ---------- */

const equipmentItems = computed(() => shop.value?.items.filter((item) => item.category === 'equipment') ?? []);
const equipmentId = ref('');
const slot = ref<EquipmentSlotId>('weapon');
const mainAttr = ref<EquipmentMainAttr>('speed');

watch(equipmentItems, (list) => {
  if (list.length > 0 && !list.some((item) => item.id === equipmentId.value)) equipmentId.value = list[0]!.id;
});

const equipmentItem = computed(() => equipmentItems.value.find((item) => item.id === equipmentId.value) ?? null);
const slotOptions = computed(() => shop.value?.slots ?? []);
const mainAttrChoices = computed(
  () => slotOptions.value.find((option) => option.id === slot.value)?.mainAttrChoices ?? [],
);

/** 「仙品装备」→「仙品」，拼成「仙品·兵器」。 */
const equipmentLabel = computed(() => {
  const item = equipmentItem.value;
  const slotName = slotOptions.value.find((option) => option.id === slot.value)?.name ?? '';
  return item === null ? '' : `${item.name.replace(/装备$/u, '')}·${slotName}`;
});

const equipmentBlocked = computed<string | null>(() => {
  if (equipmentItem.value === null) return '暂无可兑换的装备';
  if (equipmentItem.value.cost > merit.value) return '功勋不足';
  return null;
});

/* ---------- 兑换 ---------- */

async function submit(input: Parameters<typeof exchangeBossMerit>[0]): Promise<void> {
  if (submitting.value || props.busy) return;
  submitting.value = true;
  try {
    const data = await exchangeBossMerit(input);
    emit('state-update', data.state);
    const equipment = data.outcome.equipment;
    if (equipment === null) {
      emit('notify', 'success', '兑换成功', `玄铁 +${formatAmount(data.outcome.xuantie)}`);
    } else {
      emit('notify', 'success', `兑得 ${equipment.name}`, `${equipment.slotName} · 已放入背包。`);
      emit('equipment-changed');
    }
  } catch (caught) {
    emit('notify', 'warning', '兑换未成', caught instanceof Error ? caught.message : '兑换失败，请稍后再试');
  } finally {
    submitting.value = false;
  }
}

function submitResource(): void {
  if (resourceBlocked.value !== null || resourceItem.value === null) return;
  void submit({ itemId: resourceItem.value.id, quantity: quantity.value });
}

function submitEquipment(): void {
  if (equipmentBlocked.value !== null || equipmentItem.value === null) return;
  void submit({
    itemId: equipmentItem.value.id,
    slot: slot.value,
    ...(mainAttrChoices.value.length > 0 ? { mainAttr: mainAttr.value } : {}),
  });
}
</script>

<template>
  <section class="merit-dialog" aria-labelledby="merit-dialog-title">
    <header class="merit-head">
      <h2 id="merit-dialog-title" class="merit-title">功勋兑换</h2>
      <p class="merit-balance">
        <span>现有功勋</span>
        <strong>{{ formatAmount(balanceOf('bossMerit')) }}</strong>
      </p>
    </header>

    <LoadingState v-if="shop === null && loadError === null" label="正在读取功勋兑换" detail="" />
    <p v-else-if="loadError" class="blocked-hint">{{ loadError }}</p>

    <template v-else-if="shop">
      <div class="merit-tabs" role="tablist" aria-label="兑换分类">
        <button
          v-for="item in tabs"
          :id="`merit-tab-${item.id}`"
          :key="item.id"
          :ref="(element) => setTabButton(item.id, element as Element | null)"
          class="merit-tab"
          type="button"
          role="tab"
          :aria-selected="tab === item.id"
          :aria-controls="`merit-panel-${item.id}`"
          :tabindex="tab === item.id ? 0 : -1"
          @click="tab = item.id"
          @keydown="onTabKeydown($event, item.id)"
        >
          {{ item.name }}
        </button>
      </div>

      <!-- ---------- 资源 ---------- -->
      <div
        v-show="tab === 'resource'"
        id="merit-panel-resource"
        class="merit-panel"
        role="tabpanel"
        aria-labelledby="merit-tab-resource"
        tabindex="0"
      >
        <div class="merit-choices" role="radiogroup" aria-label="兑换资源">
          <button
            v-for="item in resourceItems"
            :key="item.id"
            class="merit-choice"
            :class="{ 'is-selected': resourceId === item.id }"
            type="button"
            role="radio"
            :aria-checked="resourceId === item.id"
            @click="resourceId = item.id"
          >
            <strong>{{ item.name }}</strong>
            <small>{{ item.cost }} 功勋 / 个 · 现有 {{ formatAmount(balanceOf(item.id)) }}</small>
          </button>
        </div>

        <div class="merit-field">
          <label class="eyebrow merit-field-label" for="merit-quantity">兑换个数</label>
          <div class="merit-amount-row">
            <input
              id="merit-quantity"
              class="disciple-input merit-amount-input"
              type="number"
              inputmode="numeric"
              min="1"
              :max="maxQuantity"
              step="1"
              :value="quantityInput"
              :disabled="submitting"
              @input="quantityInput = ($event.target as HTMLInputElement).value"
            />
            <button
              class="quiet-button merit-all-button"
              type="button"
              :disabled="submitting || affordableQuantity <= 0"
              @click="quantityInput = String(affordableQuantity)"
            >
              最多
            </button>
          </div>
        </div>

        <dl class="merit-preview">
          <div>
            <dt>花费</dt>
            <dd>{{ quantity > 0 ? `${resourceCost} 功勋` : '—' }}</dd>
          </div>
          <div>
            <dt>获得</dt>
            <dd>{{ quantity > 0 && resourceItem ? `${resourceItem.name} ×${quantity}` : '—' }}</dd>
          </div>
        </dl>

        <p v-if="resourceBlocked && quantity > 0" class="blocked-hint merit-hint">{{ resourceBlocked }}</p>

        <button
          class="action-button primary-action realm-button merit-confirm"
          type="button"
          :disabled="busy || submitting || resourceBlocked !== null"
          @click="submitResource"
        >
          <span>{{ submitting ? '兑换中…' : `兑换 ${quantity > 0 ? quantity : ''} 个${resourceItem?.name ?? ''}` }}</span>
        </button>
      </div>

      <!-- ---------- 装备 ---------- -->
      <div
        v-show="tab === 'equipment'"
        id="merit-panel-equipment"
        class="merit-panel"
        role="tabpanel"
        aria-labelledby="merit-tab-equipment"
        tabindex="0"
      >
        <p class="eyebrow merit-field-label">品质</p>
        <div class="merit-choices merit-choices-3" role="radiogroup" aria-label="装备品质">
          <button
            v-for="item in equipmentItems"
            :key="item.id"
            class="merit-choice"
            :class="{ 'is-selected': equipmentId === item.id }"
            :style="equipmentId === item.id && item.color ? { borderColor: item.color } : undefined"
            type="button"
            role="radio"
            :aria-checked="equipmentId === item.id"
            @click="equipmentId = item.id"
          >
            <strong :style="item.color ? { color: item.color } : undefined">{{ item.name.replace(/装备$/u, '') }}</strong>
            <small>{{ item.cost }} 功勋</small>
          </button>
        </div>

        <p class="eyebrow merit-field-label merit-gap">部位</p>
        <div class="merit-choices merit-choices-3" role="radiogroup" aria-label="装备部位">
          <button
            v-for="option in slotOptions"
            :key="option.id"
            class="merit-choice"
            :class="{ 'is-selected': slot === option.id }"
            type="button"
            role="radio"
            :aria-checked="slot === option.id"
            @click="slot = option.id"
          >
            <strong>{{ option.name }}</strong>
          </button>
        </div>

        <template v-if="mainAttrChoices.length > 0">
          <p class="eyebrow merit-field-label merit-gap">法器主属性</p>
          <div class="merit-choices" role="radiogroup" aria-label="法器主属性">
            <button
              v-for="choice in mainAttrChoices"
              :key="choice.id"
              class="merit-choice"
              :class="{ 'is-selected': mainAttr === choice.id }"
              type="button"
              role="radio"
              :aria-checked="mainAttr === choice.id"
              @click="mainAttr = choice.id as EquipmentMainAttr"
            >
              <strong>{{ choice.name }}</strong>
            </button>
          </div>
        </template>

        <dl class="merit-preview">
          <div>
            <dt>花费</dt>
            <dd>{{ equipmentItem ? `${equipmentItem.cost} 功勋` : '—' }}</dd>
          </div>
          <div>
            <dt>获得</dt>
            <dd :style="equipmentItem?.color ? { color: equipmentItem.color } : undefined">{{ equipmentLabel || '—' }}</dd>
          </div>
        </dl>

        <p v-if="equipmentBlocked" class="blocked-hint merit-hint">{{ equipmentBlocked }}</p>

        <button
          class="action-button primary-action realm-button merit-confirm"
          type="button"
          :disabled="busy || submitting || equipmentBlocked !== null"
          @click="submitEquipment"
        >
          <span>{{ submitting ? '兑换中…' : `兑换 ${equipmentLabel}` }}</span>
        </button>
        <p class="merit-note">副属性随机；兑换必定成功，放入背包。</p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.merit-dialog {
  display: flex;
  flex-direction: column;
}

.merit-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  /* 右上角是弹窗的关闭按钮（绝对定位）：与其它弹窗的 .section-heading 一样让出 40px */
  padding: 0 40px 12px 0;
  border-bottom: 1px solid var(--line);
}

.merit-title {
  margin: 0;
  color: var(--gold, #caa96a);
  font-family: 'STKaiti', 'KaiTi', serif;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.1em;
}

.merit-balance {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0;
  color: var(--muted, #92a79d);
  font-size: 12px;
  letter-spacing: 0.08em;
}

.merit-balance strong {
  color: var(--gold-bright, #ead19a);
  font-size: 22px;
  font-weight: 600;
  letter-spacing: 0;
  font-variant-numeric: tabular-nums;
}

/* ---------- 标签页（与坊市同一套样式） ---------- */

.merit-tabs {
  display: grid;
  grid-auto-columns: minmax(0, 1fr);
  grid-auto-flow: column;
  gap: 8px;
  margin-top: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--line);
}

.merit-tab {
  padding: 8px 10px;
  border: 1px solid rgba(119, 184, 154, 0.16);
  border-radius: 3px;
  color: #9db3a8;
  background: rgba(255, 255, 255, 0.02);
  font-size: 13px;
  letter-spacing: 0.06em;
  transition: border-color 140ms ease, background-color 140ms ease, color 140ms ease;
}

.merit-tab:hover {
  border-color: rgba(202, 169, 106, 0.3);
  color: #e4ece6;
}

.merit-tab[aria-selected='true'] {
  border-color: rgba(202, 169, 106, 0.42);
  color: var(--gold-bright, #e0cd97);
  background: rgba(202, 169, 106, 0.08);
}

.merit-tab:focus-visible,
.merit-choice:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px rgba(202, 169, 106, 0.3);
}

.merit-panel {
  margin-top: 14px;
  outline: none;
}

/* ---------- 选项卡片 ---------- */

.merit-choices {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 8px;
}

.merit-choices-3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.merit-choice {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 10px 8px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.014);
  color: inherit;
  transition: border-color 140ms ease, background-color 140ms ease;
}

.merit-choice:hover {
  border-color: rgba(119, 184, 154, 0.4);
}

.merit-choice.is-selected {
  border-color: rgba(202, 169, 106, 0.55);
  background: rgba(202, 169, 106, 0.1);
}

.merit-choice strong {
  color: #dce6e0;
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0.05em;
}

.merit-choice.is-selected strong {
  color: var(--gold, #caa96a);
}

.merit-choice small {
  color: #7d9186;
  font-size: 11px;
  text-align: center;
}

.merit-field-label {
  display: block;
  font-size: 12px;
}

.merit-gap {
  margin-top: 14px;
}

/* ---------- 数量 ---------- */

.merit-field {
  margin-top: 14px;
}

.merit-amount-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.merit-amount-input {
  flex: 0 1 160px;
  min-width: 96px;
}

.merit-all-button {
  flex: 0 0 auto;
  border: 1px solid rgba(202, 169, 106, 0.22);
  border-radius: 3px;
}

/* ---------- 预览与确认 ---------- */

.merit-preview {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 14px 0 0;
}

.merit-preview > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
  border: 1px solid rgba(202, 169, 106, 0.15);
  border-radius: 4px;
}

.merit-preview dt {
  color: var(--faint, #7d9186);
  font-size: 11px;
  letter-spacing: 0.1em;
}

.merit-preview dd {
  margin: 0;
  color: #dce6e0;
  font-size: 13px;
  overflow-wrap: anywhere;
}

.merit-hint {
  margin-top: 10px;
}

.merit-confirm {
  width: 100%;
  margin-top: 14px;
}

.merit-note {
  margin: 8px 0 0;
  color: var(--faint, #7d9186);
  font-size: 12px;
  text-align: center;
}
</style>
