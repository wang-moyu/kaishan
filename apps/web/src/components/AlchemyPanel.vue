<script setup lang="ts">
import { computed, ref } from 'vue';

import type { AlchemyRecipeView, SectStateView } from '../api/game';
import { formatAmount } from '../utils/format';

/**
 * 炼丹面板（弹窗内容）：**只负责配方炼制**。弟子服药入口已迁到弟子详情（计划 2.3：不保留
 * 两个相互冲突的服药入口）。
 *
 * 规则全部以服务端算好的 alchemy 字段为准：unlocked、canCraft、blockedReason 都不在前端复算；
 * 前端只做数量选择（1~服务端下发的上限）与按钮派发。
 */
const props = defineProps<{
  state: SectStateView;
  busy: boolean;
}>();

const emit = defineEmits<{
  craft: [pillId: string, quantity: number];
}>();

const QUANTITY_MIN = 1;
const quantityMax = computed(() => props.state.alchemy.maxCraftQuantity);

/** 每个配方的炼制数量（1~上限，默认 1）。 */
const quantities = ref<Record<string, number>>(
  Object.fromEntries(props.state.alchemy.recipes.map((recipe) => [recipe.id, 1])),
);

function setQuantity(pillId: string, value: number): void {
  const clamped = Number.isFinite(value)
    ? Math.min(quantityMax.value, Math.max(QUANTITY_MIN, Math.floor(value)))
    : QUANTITY_MIN;
  quantities.value = { ...quantities.value, [pillId]: clamped };
}

function stepQuantity(pillId: string, delta: number): void {
  setQuantity(pillId, (quantities.value[pillId] ?? QUANTITY_MIN) + delta);
}

function onQuantityInput(pillId: string, event: Event): void {
  const input = event.target as HTMLInputElement;
  // 输入过程中允许清空，失焦时再归一（见 onQuantityBlur）。
  if (input.value.trim() === '') return;
  setQuantity(pillId, Number(input.value));
}

function onQuantityBlur(pillId: string, event: Event): void {
  const input = event.target as HTMLInputElement;
  setQuantity(pillId, Number(input.value));
  input.value = String(quantities.value[pillId] ?? QUANTITY_MIN);
}

/** 按当前余额最多能炼几颗（封顶到上限）；一颗都炼不起时返回 0。 */
function affordableQuantity(recipe: AlchemyRecipeView): number {
  let most = quantityMax.value;
  for (const [resourceId, amount] of Object.entries(recipe.cost)) {
    const unit = Number(amount);
    if (unit <= 0) continue;
    most = Math.min(most, Math.floor((resourceBalance.value[resourceId] ?? 0) / unit));
  }
  return Math.max(0, most);
}

/** 「最大」：选到当前资源能炼的最多颗数（一颗都炼不起时停在 1，由炼制按钮提示资源不足）。 */
function selectMaxQuantity(recipe: AlchemyRecipeView): void {
  setQuantity(recipe.id, Math.max(QUANTITY_MIN, affordableQuantity(recipe)));
}

const resourceName = computed<Record<string, string>>(() =>
  Object.fromEntries(props.state.resources.map((resource) => [resource.id, resource.name])),
);
const resourceBalance = computed<Record<string, number>>(() =>
  Object.fromEntries(props.state.resources.map((resource) => [resource.id, Number(resource.balance)])),
);

function costText(cost: Record<string, string>, quantity = 1): string {
  return Object.entries(cost)
    .map(
      ([resourceId, amount]) =>
        `${resourceName.value[resourceId] ?? resourceId} ${formatAmount(Number(amount) * quantity)}`,
    )
    .join(' · ');
}

function canCraftSelected(recipe: AlchemyRecipeView): boolean {
  const quantity = quantities.value[recipe.id] ?? QUANTITY_MIN;
  return recipe.canCraft && Object.entries(recipe.cost).every(
    ([resourceId, amount]) => (resourceBalance.value[resourceId] ?? 0) >= Number(amount) * quantity,
  );
}

/** 丹库总量（角标用）；原来的「N 条用药建议」随全局用药区块一起移除。 */
const totalOwned = computed(() =>
  props.state.alchemy.recipes.reduce((sum, recipe) => sum + recipe.owned, 0),
);

function onCraft(recipe: AlchemyRecipeView): void {
  if (props.busy || !canCraftSelected(recipe)) return;
  emit('craft', recipe.id, quantities.value[recipe.id] ?? QUANTITY_MIN);
}
</script>

<template>
  <section class="alchemy-panel" aria-labelledby="alchemy-title">
    <header class="section-heading panel-heading compact-heading">
      <div>
        <p class="eyebrow">灵药园 · 丹房</p>
        <h2 id="alchemy-title">炼丹</h2>
      </div>
      <span class="count-badge">丹库 {{ totalOwned }} 颗</span>
    </header>

    <div v-if="!state.alchemy.unlocked" class="empty-state alchemy-locked">
      <span aria-hidden="true">丹</span>
      <strong>炼丹尚未开启</strong>
      <p>需要：宗门 2 级、灵药园 2 级</p>
      <p v-if="state.alchemy.blockedReason" class="blocked-hint">{{ state.alchemy.blockedReason }}</p>
    </div>

    <template v-else>
      <ul class="alchemy-recipe-list">
        <li v-for="recipe in state.alchemy.recipes" :key="recipe.id" class="alchemy-recipe">
          <div class="alchemy-pill-glyph" aria-hidden="true">丹</div>

          <div class="alchemy-recipe-copy">
            <div class="alchemy-recipe-title">
              <strong>{{ recipe.name }}</strong>
              <span class="alchemy-owned">库存 {{ recipe.owned }}</span>
            </div>
            <p class="alchemy-recipe-desc">{{ recipe.description }}</p>
            <p class="alchemy-recipe-cost">
              {{ (quantities[recipe.id] ?? 1) === 1 ? '单颗' : `本次 ${quantities[recipe.id]} 颗` }} ·
              {{ costText(recipe.cost, quantities[recipe.id] ?? 1) }}
            </p>
            <p v-if="recipe.blockedReason || !canCraftSelected(recipe)" class="blocked-hint">
              {{ recipe.blockedReason ?? '所选数量的资源不足' }}
            </p>
          </div>

          <div class="alchemy-recipe-actions">
            <div class="alchemy-stepper" role="group" :aria-label="`炼制数量 · ${recipe.name}`">
              <button
                type="button"
                :disabled="busy || (quantities[recipe.id] ?? 1) <= 1"
                aria-label="减少一颗"
                @click="stepQuantity(recipe.id, -1)"
              >−</button>
              <input
                class="alchemy-quantity-input"
                type="number"
                inputmode="numeric"
                :min="1"
                :max="quantityMax"
                :value="quantities[recipe.id] ?? 1"
                :disabled="busy"
                :aria-label="`炼制数量 · ${recipe.name}`"
                @input="onQuantityInput(recipe.id, $event)"
                @blur="onQuantityBlur(recipe.id, $event)"
              />
              <button
                type="button"
                :disabled="busy || (quantities[recipe.id] ?? 1) >= quantityMax"
                aria-label="增加一颗"
                @click="stepQuantity(recipe.id, 1)"
              >+</button>
            </div>
            <button
              class="alchemy-max-button"
              type="button"
              :disabled="busy || affordableQuantity(recipe) < 1"
              :title="`按当前资源最多可炼 ${affordableQuantity(recipe)} 颗`"
              @click="selectMaxQuantity(recipe)"
            >最大</button>
            <button
              class="action-button primary-action alchemy-craft-button"
              :class="{ 'is-disabled': !canCraftSelected(recipe) }"
              type="button"
              :disabled="busy || !canCraftSelected(recipe)"
              @click="onCraft(recipe)"
            >
              <span>炼制</span>
            </button>
          </div>
        </li>
      </ul>

      <p class="alchemy-note">
        弟子服药已移至「弟子详情」：在门人名册里点某位弟子的「详情」，即可按他的伤势、修为与属性短板服用丹药。
      </p>
    </template>
  </section>
</template>
