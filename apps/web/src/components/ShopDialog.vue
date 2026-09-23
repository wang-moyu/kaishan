<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';

import type { SectStateView, ShopResourceId } from '../api/game';
import { toDisplayUnits } from '../utils/format';

/**
 * 坊市（弹窗内容，外壳由 SectScreen 的 ModalShell 提供）：灵石 ↔ 药材/矿石的双向买卖 + 丹药回收。
 *
 * 服务端是唯一的价格与规则来源：买入价、卖出价、单颗丹药回收价都取自 state.shop，前端不复算也不写死常量；
 * 本组件只做三件事 —— 把「展示单位」数量换算成最小单位整数预览、把无效操作挡在按钮外、
 * 把玩家确认的那一笔交给上层（接口调用、state 回填与 toast 都在 SectScreen）。
 * 交易成功后 state 换成了新的，标签页与各页的数量草稿都留在原处，可以接着做下一笔。
 */
const props = defineProps<{
  state: SectStateView;
  busy: boolean;
}>();

const emit = defineEmits<{
  /** 买入材料：amount 是展示单位整数（≥ 1），换算由服务端负责。 */
  buy: [resourceId: ShopResourceId, amount: number];
  /** 卖出材料：amount 是展示单位整数（≥ 1）。 */
  sell: [resourceId: ShopResourceId, amount: number];
  /** 卖出丹药：quantity 是颗数（≥ 1）。 */
  sellPill: [pillId: string, quantity: number];
}>();

/**
 * 资源数量一律是最小单位整数：1 展示单位 = 1000 最小单位（与 utils/format.ts 同口径）。
 */
const UNITS_PER_DISPLAY = 1000;

/**
 * 灵石文案：坊市价格带三位小数的零头（667 最小单位 = 0.667 灵石），
 * utils/format.ts 的 formatAmount 只保留 1 位小数（会显示成 0.7），所以这里按最小单位
 * 的完整精度裁剪（最多 3 位，末尾多余的 0 去掉）—— 只用于展示，不用它参与任何计算。
 */
function formatStone(minUnits: number): string {
  const value = toDisplayUnits(minUnits);
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

/** 可交易材料（与后端 shop.ts 的 SHOP_TRADABLE_RESOURCES 同口径）；名字与库存都取自服务端资源表。 */
const RESOURCE_OPTIONS: readonly ShopResourceId[] = ['herb', 'ore'];

/* ---------- 标签页：真正的 tablist / tab / tabpanel（与弟子详情同一套约定） ---------- */

const TABS = [
  { id: 'buy', label: '买入' },
  { id: 'sell', label: '卖出' },
  { id: 'pill', label: '售丹' },
] as const;

type ShopTab = (typeof TABS)[number]['id'];

/** 挂载时停在买入页；交易成功后 state 换了新的，这里不动，留在当前标签页。 */
const tab = ref<ShopTab>('buy');
const tabButtons = ref<Record<string, HTMLButtonElement | null>>({});

function tabButtonId(id: ShopTab): string {
  return `shop-tab-${id}`;
}

function tabPanelId(id: ShopTab): string {
  return `shop-panel-${id}`;
}

function setTabButton(id: ShopTab, element: Element | null): void {
  if (element instanceof HTMLButtonElement) tabButtons.value[id] = element;
  else delete tabButtons.value[id];
}

/** 方向键 / Home / End 在三个标签页之间移动（自动激活，焦点跟着走）。 */
function onTabKeydown(event: KeyboardEvent, current: ShopTab): void {
  const index = TABS.findIndex((item) => item.id === current);
  if (index < 0) return;
  let nextIndex = -1;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % TABS.length;
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    nextIndex = (index - 1 + TABS.length) % TABS.length;
  } else if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = TABS.length - 1;
  else return;

  const target = TABS[nextIndex];
  if (target === undefined) return;
  event.preventDefault();
  tab.value = target.id;
  void nextTick(() => tabButtons.value[target.id]?.focus());
}

/* ---------- 台账：价格、余额、库存与容量 ---------- */

const shop = computed(() => props.state.shop);

function resourceOf(resourceId: string) {
  return props.state.resources.find((resource) => resource.id === resourceId) ?? null;
}

function resourceName(resourceId: string): string {
  return resourceOf(resourceId)?.name ?? resourceId;
}

/** 资源余额（最小单位，整数）；查不到时按 0 处理 —— 按钮自然不可点，不会伪造余额。 */
function resourceBalance(resourceId: string): number {
  const resource = resourceOf(resourceId);
  return resource === null ? 0 : Number(resource.balance);
}

function resourceCapacity(resourceId: string): number {
  const resource = resourceOf(resourceId);
  return resource === null ? 0 : Number(resource.capacity);
}

/** 材料还能装多少（最小单位，负数截到 0）：买入超过容量会被服务端拒绝，前端先挡下来。 */
function resourceRoom(resourceId: string): number {
  return Math.max(0, resourceCapacity(resourceId) - resourceBalance(resourceId));
}

const spiritStone = computed(() => resourceBalance('spiritStone'));

/* ---------- 数量草稿（展示单位文本）：三个页面各一份，互不覆盖 ---------- */

const buyResourceId = ref<ShopResourceId>('herb');
const buyAmountInput = ref('');
const sellResourceId = ref<ShopResourceId>('herb');
const sellAmountInput = ref('');
const pillAmountInput = ref('');

/** 文本 → 数量：只认「正整数（展示单位）」；空串、0、负数、小数一律判无效（回 0）。 */
function parseAmount(input: string): number {
  const text = input.trim();
  if (text === '') return 0;
  const value = Number(text);
  return Number.isInteger(value) && value > 0 ? value : 0;
}

const buyAmount = computed(() => parseAmount(buyAmountInput.value));
const sellAmount = computed(() => parseAmount(sellAmountInput.value));
const pillAmount = computed(() => parseAmount(pillAmountInput.value));

/* ---------- 买入 ---------- */

/** 能买多少：买得起的量与装得下的量取小（都是在展示单位上取整）。 */
const buyMax = computed(() => {
  const price = shop.value.buyPrice;
  const affordable = price > 0 ? Math.floor(spiritStone.value / price) : 0;
  const room = Math.floor(resourceRoom(buyResourceId.value) / UNITS_PER_DISPLAY);
  return Math.max(0, Math.min(affordable, room));
});

/** 本次花费（最小单位灵石，整数乘法，不出现浮点误差）。 */
const buyCost = computed(() => buyAmount.value * shop.value.buyPrice);

/** 买入的阻止原因（null = 可以提交）；按钮 disabled 与提示文案共用这一份判断。 */
const buyBlockedReason = computed<string | null>(() => {
  if (buyAmount.value <= 0) return '请填写不小于 1 的整数数量（展示单位）。';
  if (buyCost.value > spiritStone.value) {
    return `灵石不足：本次需 ${formatStone(buyCost.value)}，现有 ${formatStone(spiritStone.value)}。`;
  }
  if (buyAmount.value > buyMax.value) {
    return `${resourceName(buyResourceId.value)}库存上限 ${formatStone(resourceCapacity(buyResourceId.value))}，最多还能买入 ${String(buyMax.value)}。`;
  }
  return null;
});

const buyCanSubmit = computed(() => !props.busy && buyBlockedReason.value === null);
/** 输入框中没有内容时不先报错，只在用户填了东西之后才说明拦下来的原因。 */
const buyHint = computed(() => (buyAmountInput.value.trim() === '' ? null : buyBlockedReason.value));
const buyButtonLabel = computed(() =>
  buyAmount.value > 0 ? `确认买入 · ${formatStone(buyCost.value)} 灵石` : '确认买入',
);

function submitBuy(): void {
  if (!buyCanSubmit.value) return;
  emit('buy', buyResourceId.value, buyAmount.value);
}

/* ---------- 卖出材料 ---------- */

/** 能卖多少：全部库存（展示单位整数）。 */
const sellMax = computed(() => Math.floor(resourceBalance(sellResourceId.value) / UNITS_PER_DISPLAY));

/** 本次获得（最小单位灵石，整数乘法）。 */
const sellRevenue = computed(() => sellAmount.value * shop.value.sellPrice);

const sellBlockedReason = computed<string | null>(() => {
  if (sellAmount.value <= 0) return '请填写不小于 1 的整数数量（展示单位）。';
  if (sellAmount.value > sellMax.value) {
    return `${resourceName(sellResourceId.value)}库存不足：现有 ${formatStone(resourceBalance(sellResourceId.value))}。`;
  }
  return null;
});

const sellCanSubmit = computed(() => !props.busy && sellBlockedReason.value === null);
const sellHint = computed(() => (sellAmountInput.value.trim() === '' ? null : sellBlockedReason.value));
const sellButtonLabel = computed(() =>
  sellAmount.value > 0 ? `确认卖出 · 得 ${formatStone(sellRevenue.value)} 灵石` : '确认卖出',
);

function submitSell(): void {
  if (!sellCanSubmit.value) return;
  emit('sell', sellResourceId.value, sellAmount.value);
}

/* ---------- 售丹 ---------- */

const pills = computed(() => shop.value.pills);

/** 默认选中第一颗有库存的丹药（都没有库存时退回列表第一项，让「无库存」状态可见）。 */
const selectedPillId = ref<string | null>(
  props.state.shop.pills.find((pill) => pill.owned > 0)?.id ?? props.state.shop.pills[0]?.id ?? null,
);

const selectedPill = computed(() => pills.value.find((pill) => pill.id === selectedPillId.value) ?? null);

// 卖出后库存归零、或服务端换了清单：选中项若已不在列表里，收敛到仍然存在的第一颗。
watch(pills, (list) => {
  if (list.some((pill) => pill.id === selectedPillId.value)) return;
  selectedPillId.value = list.find((pill) => pill.owned > 0)?.id ?? list[0]?.id ?? null;
});

const pillMax = computed(() => Math.max(0, selectedPill.value?.owned ?? 0));

/** 本单获得（最小单位灵石，整数乘法）。 */
const pillRevenue = computed(() => pillAmount.value * (selectedPill.value?.sellPrice ?? 0));

const pillBlockedReason = computed<string | null>(() => {
  if (selectedPill.value === null) return '请先选择要出售的丹药。';
  if (selectedPill.value.owned <= 0) return `${selectedPill.value.name}已无库存。`;
  if (pillAmount.value <= 0) return '请填写不小于 1 的整数颗数。';
  if (pillAmount.value > pillMax.value) {
    return `${selectedPill.value.name}库存不足：现有 ${String(pillMax.value)} 颗。`;
  }
  return null;
});

const pillCanSubmit = computed(() => !props.busy && pillBlockedReason.value === null);
const pillHint = computed(() => (pillAmountInput.value.trim() === '' ? null : pillBlockedReason.value));
const pillButtonLabel = computed(() =>
  pillAmount.value > 0 ? `确认出售 · 得 ${formatStone(pillRevenue.value)} 灵石` : '确认出售',
);

function submitSellPill(): void {
  const pillId = selectedPillId.value;
  if (!pillCanSubmit.value || pillId === null) return;
  emit('sellPill', pillId, pillAmount.value);
}
</script>

<template>
  <section class="shop-dialog" aria-labelledby="shop-dialog-title">
    <header class="section-heading panel-heading compact-heading">
      <h2 id="shop-dialog-title" class="shop-title-gold">坊市</h2>
      <span class="count-badge">灵石 {{ formatStone(spiritStone) }}</span>
    </header>

    <p class="lineup-note shop-lead">
      以灵石买入药材与矿石，或把库中材料与丹药折价卖给行商。价格由坊市定，不限交易次数。
    </p>

    <div class="shop-tabs" role="tablist" aria-label="坊市交易分区">
      <button
        v-for="item in TABS"
        :id="tabButtonId(item.id)"
        :key="item.id"
        :ref="(element) => setTabButton(item.id, element as Element | null)"
        class="shop-tab"
        type="button"
        role="tab"
        :aria-selected="tab === item.id"
        :aria-controls="tabPanelId(item.id)"
        :tabindex="tab === item.id ? 0 : -1"
        :disabled="busy"
        @click="tab = item.id"
        @keydown="onTabKeydown($event, item.id)"
      >
        {{ item.label }}
      </button>
    </div>

    <div class="shop-panels">
      <!-- ---------- 买入：灵石 → 材料 ---------- -->
      <div
        v-show="tab === 'buy'"
        :id="tabPanelId('buy')"
        class="shop-panel"
        role="tabpanel"
        :aria-labelledby="tabButtonId('buy')"
        tabindex="0"
      >
        <p class="eyebrow">选择材料</p>
        <div class="shop-choices" role="radiogroup" aria-label="买入材料">
          <button
            v-for="resourceId in RESOURCE_OPTIONS"
            :key="resourceId"
            class="shop-choice"
            :class="{ 'is-selected': buyResourceId === resourceId }"
            type="button"
            role="radio"
            :disabled="busy"
            :aria-checked="buyResourceId === resourceId"
            @click="buyResourceId = resourceId"
          >
            <strong>{{ resourceName(resourceId) }}</strong>
            <small>现有 {{ formatStone(resourceBalance(resourceId)) }}</small>
          </button>
        </div>

        <div class="shop-field">
          <label class="eyebrow shop-field-label" for="shop-buy-amount">买入数量（展示单位）</label>
          <div class="shop-amount-row">
            <input
              id="shop-buy-amount"
              class="disciple-input shop-amount-input"
              type="number"
              inputmode="numeric"
              min="1"
              step="1"
              placeholder="至少 1"
              :value="buyAmountInput"
              :disabled="busy"
              :aria-invalid="buyHint !== null"
              @input="buyAmountInput = ($event.target as HTMLInputElement).value"
            />
            <button
              class="quiet-button shop-all-button"
              type="button"
              :disabled="busy || buyMax <= 0"
              @click="buyAmountInput = String(buyMax)"
            >
              全部
            </button>
          </div>
        </div>

        <dl class="shop-preview">
          <div>
            <dt>花费</dt>
            <dd>{{ buyAmount > 0 ? `${formatStone(buyCost)} 灵石` : '—' }}</dd>
          </div>
          <div>
            <dt>余额</dt>
            <dd>
              {{ formatStone(spiritStone) }} 灵石
              <small v-if="buyCanSubmit" class="shop-after">→ {{ formatStone(spiritStone - buyCost) }} 灵石</small>
            </dd>
          </div>
          <div>
            <dt>存放</dt>
            <dd>
              {{ formatStone(resourceBalance(buyResourceId)) }} /
              {{ formatStone(resourceCapacity(buyResourceId)) }}
            </dd>
          </div>
        </dl>

        <p v-if="buyHint" class="blocked-hint shop-hint">{{ buyHint }}</p>

        <button
          class="action-button primary-action realm-button shop-confirm"
          :class="{ 'is-disabled': !buyCanSubmit }"
          type="button"
          :disabled="busy || buyBlockedReason !== null"
          :aria-disabled="!buyCanSubmit"
          @click="submitBuy"
        >
          <span>{{ buyButtonLabel }}</span>
        </button>
      </div>

      <!-- ---------- 卖出：材料 → 灵石 ---------- -->
      <div
        v-show="tab === 'sell'"
        :id="tabPanelId('sell')"
        class="shop-panel"
        role="tabpanel"
        :aria-labelledby="tabButtonId('sell')"
        tabindex="0"
      >
        <p class="eyebrow">选择材料</p>
        <div class="shop-choices" role="radiogroup" aria-label="卖出材料">
          <button
            v-for="resourceId in RESOURCE_OPTIONS"
            :key="resourceId"
            class="shop-choice"
            :class="{ 'is-selected': sellResourceId === resourceId }"
            type="button"
            role="radio"
            :disabled="busy"
            :aria-checked="sellResourceId === resourceId"
            @click="sellResourceId = resourceId"
          >
            <strong>{{ resourceName(resourceId) }}</strong>
            <small>现有 {{ formatStone(resourceBalance(resourceId)) }}</small>
          </button>
        </div>

        <div class="shop-field">
          <label class="eyebrow shop-field-label" for="shop-sell-amount">卖出数量（展示单位）</label>
          <div class="shop-amount-row">
            <input
              id="shop-sell-amount"
              class="disciple-input shop-amount-input"
              type="number"
              inputmode="numeric"
              min="1"
              step="1"
              placeholder="至少 1"
              :value="sellAmountInput"
              :disabled="busy"
              :aria-invalid="sellHint !== null"
              @input="sellAmountInput = ($event.target as HTMLInputElement).value"
            />
            <button
              class="quiet-button shop-all-button"
              type="button"
              :disabled="busy || sellMax <= 0"
              @click="sellAmountInput = String(sellMax)"
            >
              全部
            </button>
          </div>
        </div>

        <dl class="shop-preview">
          <div>
            <dt>获得</dt>
            <dd>{{ sellAmount > 0 ? `${formatStone(sellRevenue)} 灵石` : '—' }}</dd>
          </div>
          <div>
            <dt>库存</dt>
            <dd>
              {{ formatStone(resourceBalance(sellResourceId)) }}
              <small v-if="sellCanSubmit" class="shop-after">
                → {{ formatStone(resourceBalance(sellResourceId) - sellAmount * UNITS_PER_DISPLAY) }}
              </small>
            </dd>
          </div>
          <div>
            <dt>余额</dt>
            <dd>
              {{ formatStone(spiritStone) }} 灵石
              <small v-if="sellCanSubmit" class="shop-after">→ {{ formatStone(spiritStone + sellRevenue) }} 灵石</small>
            </dd>
          </div>
        </dl>

        <p v-if="sellHint" class="blocked-hint shop-hint">{{ sellHint }}</p>

        <button
          class="action-button primary-action realm-button shop-confirm"
          :class="{ 'is-disabled': !sellCanSubmit }"
          type="button"
          :disabled="busy || sellBlockedReason !== null"
          :aria-disabled="!sellCanSubmit"
          @click="submitSell"
        >
          <span>{{ sellButtonLabel }}</span>
        </button>
      </div>

      <!-- ---------- 售丹：丹药 → 灵石 ---------- -->
      <div
        v-show="tab === 'pill'"
        :id="tabPanelId('pill')"
        class="shop-panel"
        role="tabpanel"
        :aria-labelledby="tabButtonId('pill')"
        tabindex="0"
      >
        <p class="eyebrow">选择丹药</p>
        <div v-if="pills.length > 0" class="shop-pills" role="radiogroup" aria-label="可回收丹药">
          <button
            v-for="(pill, index) in pills"
            :key="pill.id"
            class="shop-pill-row"
            :class="{ 'is-selected': selectedPillId === pill.id, 'is-empty': pill.owned <= 0 }"
            :style="{ animationDelay: `${String(index * 30)}ms` }"
            type="button"
            role="radio"
            :disabled="busy"
            :aria-checked="selectedPillId === pill.id"
            @click="selectedPillId = pill.id"
          >
            <span class="shop-pill-name">
              {{ pill.name }}
              <small v-if="pill.owned <= 0" class="shop-pill-tag">无库存</small>
            </span>
            <span class="shop-pill-owned">库存 {{ pill.owned }} 颗</span>
            <span class="shop-pill-price">{{ formatStone(pill.sellPrice) }} 灵石/颗</span>
          </button>
        </div>
        <div v-else class="empty-state shop-pills-empty">
          <span aria-hidden="true">丹</span>
          <strong>坊市暂无收丹</strong>
          <p>丹房炼出丹药后，即可在此折价卖出换取灵石。</p>
        </div>

        <div class="shop-field">
          <label class="eyebrow shop-field-label" for="shop-pill-amount">出售颗数</label>
          <div class="shop-amount-row">
            <input
              id="shop-pill-amount"
              class="disciple-input shop-amount-input"
              type="number"
              inputmode="numeric"
              min="1"
              step="1"
              placeholder="至少 1"
              :value="pillAmountInput"
              :disabled="busy || selectedPill === null"
              :aria-invalid="pillHint !== null"
              @input="pillAmountInput = ($event.target as HTMLInputElement).value"
            />
            <button
              class="quiet-button shop-all-button"
              type="button"
              :disabled="busy || pillMax <= 0"
              @click="pillAmountInput = String(pillMax)"
            >
              全部
            </button>
          </div>
        </div>

        <dl class="shop-preview">
          <div>
            <dt>获得</dt>
            <dd>{{ pillAmount > 0 ? `${formatStone(pillRevenue)} 灵石` : '—' }}</dd>
          </div>
          <div>
            <dt>库存</dt>
            <dd>
              {{ selectedPill === null ? '—' : `${String(pillMax)} 颗` }}
              <small v-if="pillCanSubmit" class="shop-after">
                → {{ String(pillMax - pillAmount) }} 颗
              </small>
            </dd>
          </div>
          <div>
            <dt>余额</dt>
            <dd>
              {{ formatStone(spiritStone) }} 灵石
              <small v-if="pillCanSubmit" class="shop-after">→ {{ formatStone(spiritStone + pillRevenue) }} 灵石</small>
            </dd>
          </div>
        </dl>

        <p v-if="pillHint" class="blocked-hint shop-hint">{{ pillHint }}</p>
        <p v-else-if="selectedPill === null" class="blocked-hint shop-hint">请先选择要出售的丹药。</p>

        <button
          class="action-button primary-action realm-button shop-confirm"
          :class="{ 'is-disabled': !pillCanSubmit }"
          type="button"
          :disabled="busy || pillBlockedReason !== null"
          :aria-disabled="!pillCanSubmit"
          @click="submitSellPill"
        >
          <span>{{ pillButtonLabel }}</span>
        </button>
      </div>
    </div>

    <footer class="shop-rates">
      <p class="eyebrow">价格说明（都按最小单位灵石计）</p>
      <ul>
        <li>
          买入：每 1 展示单位材料（1000 最小单位）花 {{ shop.buyPrice }} 灵石最小单位，约
          {{ formatStone(shop.buyPrice) }} 灵石。
        </li>
        <li>
          卖出：每 1 展示单位材料得 {{ shop.sellPrice }} 灵石最小单位，约
          {{ formatStone(shop.sellPrice) }} 灵石。
        </li>
        <li>丹药只收不卖：按丹方回收价折算，单颗价格见上方清单。</li>
      </ul>
    </footer>
  </section>
</template>

<style scoped>
.shop-dialog {
  display: flex;
  flex-direction: column;
}

.shop-title-gold {
  color: var(--gold, #caa96a);
  font-family: 'STKaiti', 'KaiTi', serif;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.1em;
}

.shop-lead {
  margin-top: 8px;
}

/* ---------- 标签页 ---------- */

.shop-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-top: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--line);
}

.shop-tab {
  padding: 8px 10px;
  border: 1px solid rgba(119, 184, 154, 0.16);
  border-radius: 3px;
  color: #9db3a8;
  background: rgba(255, 255, 255, 0.02);
  font-size: 13px;
  letter-spacing: 0.06em;
  transition: border-color 140ms ease, background-color 140ms ease, color 140ms ease, transform 140ms ease;
}

.shop-tab:not(:disabled):hover {
  border-color: rgba(202, 169, 106, 0.3);
  color: #e4ece6;
}

.shop-tab:not(:disabled):active {
  transform: translateY(1px);
}

.shop-tab[aria-selected='true'] {
  border-color: rgba(202, 169, 106, 0.42);
  color: var(--gold-bright, #e0cd97);
  background: rgba(202, 169, 106, 0.08);
}

.shop-tab:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px rgba(202, 169, 106, 0.3);
}

.shop-panels {
  margin-top: 14px;
}

.shop-panel {
  outline: none;
}

.shop-panel:focus-visible {
  box-shadow: inset 0 0 0 1px rgba(119, 184, 154, 0.24);
}

/* ---------- 材料选择 ---------- */

.shop-choices {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 8px;
}

.shop-choice {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.014);
  color: inherit;
  transition: border-color 140ms ease, background-color 140ms ease;
}

.shop-choice:not(:disabled):hover {
  border-color: rgba(119, 184, 154, 0.4);
}

.shop-choice:not(:disabled):active {
  transform: translateY(1px);
}

.shop-choice.is-selected {
  border-color: rgba(202, 169, 106, 0.55);
  background: rgba(202, 169, 106, 0.1);
}

.shop-choice strong {
  color: #dce6e0;
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0.05em;
}

.shop-choice.is-selected strong {
  color: var(--gold, #caa96a);
}

.shop-choice small {
  color: #7d9186;
  font-size: 11px;
}

.shop-choices .shop-choice:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px rgba(202, 169, 106, 0.3);
}

/* ---------- 数量输入 ---------- */

.shop-field {
  margin-top: 14px;
}

.shop-field-label {
  display: block;
  font-size: 12px;
}

.shop-amount-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.shop-amount-input {
  flex: 0 1 160px;
  min-width: 96px;
}

.shop-all-button {
  flex: 0 0 auto;
  border: 1px solid rgba(202, 169, 106, 0.22);
  border-radius: 3px;
}

.shop-all-button:not(:disabled):focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px rgba(202, 169, 106, 0.3);
}

/* ---------- 预览：固定三行，数量变化时只换数字，不改变布局 ---------- */

.shop-preview {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 14px 0 0;
}

.shop-preview > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
  border: 1px solid rgba(202, 169, 106, 0.15);
  border-radius: 4px;
}

.shop-preview dt {
  color: var(--faint, #7d9186);
  font-size: 11px;
  letter-spacing: 0.1em;
}

.shop-preview dd {
  margin: 0;
  color: #dce6e0;
  font-size: 13px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.shop-after {
  display: block;
  margin-top: 2px;
  color: rgba(202, 169, 106, 0.85);
  font-size: 12px;
  animation: shop-after-in 180ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes shop-after-in {
  from {
    opacity: 0;
    transform: translateY(3px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.shop-hint {
  margin-top: 10px;
}

.shop-confirm {
  width: 100%;
  margin-top: 14px;
}

/* ---------- 丹药清单 ---------- */

.shop-pills {
  display: grid;
  gap: 8px;
  margin-top: 8px;
}

.shop-pill-row {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 4px 12px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.014);
  color: inherit;
  text-align: left;
  animation: shop-row-in 240ms cubic-bezier(0.22, 1, 0.36, 1) both;
  transition: border-color 140ms ease, background-color 140ms ease;
}

@keyframes shop-row-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.shop-pill-row:not(:disabled):hover {
  border-color: rgba(119, 184, 154, 0.4);
}

.shop-pill-row:not(:disabled):active {
  transform: translateY(1px);
}

.shop-pill-row.is-selected {
  border-color: rgba(202, 169, 106, 0.55);
  background: rgba(202, 169, 106, 0.1);
}

.shop-pill-row.is-empty {
  color: #6f8378;
}

.shop-pill-row:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px rgba(202, 169, 106, 0.3);
}

.shop-pill-name {
  min-width: 0;
  color: #dce6e0;
  font-size: 13px;
  overflow-wrap: anywhere;
}

.shop-pill-row.is-selected .shop-pill-name {
  color: var(--gold, #caa96a);
}

.shop-pill-tag {
  margin-left: 6px;
  padding: 1px 5px;
  border: 1px solid rgba(196, 114, 114, 0.4);
  border-radius: 2px;
  color: #c47272;
  font-size: 11px;
}

.shop-pill-owned,
.shop-pill-price {
  color: #93a99e;
  font-size: 12px;
  white-space: nowrap;
}

.shop-pills-empty {
  margin-top: 8px;
}

/* ---------- 价格说明 ---------- */

.shop-rates {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}

.shop-rates ul {
  display: grid;
  gap: 4px;
  margin: 6px 0 0;
  padding-left: 18px;
  color: #93a99e;
  font-size: 12px;
  line-height: 1.6;
}

/* 窄屏：标签页与预览改成单列/两列，丹药行把价格换到第二行，避免相互挤压。 */
@media (max-width: 560px) {
  .shop-preview {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .shop-pill-row {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .shop-pill-price {
    grid-column: 1 / -1;
  }
}

@media (max-width: 380px) {
  .shop-preview {
    grid-template-columns: minmax(0, 1fr);
  }
}

/* 关掉动效时，列表进场不再错峰，免得元素先消失一瞬。 */
@media (prefers-reduced-motion: reduce) {
  .shop-pill-row,
  .shop-after {
    animation: none;
  }
}
</style>
