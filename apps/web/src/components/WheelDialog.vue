<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';

import type { SectStateView, WheelSlotView, WheelSpinResult, WheelView } from '../api/game';
import { formatAmount } from '../utils/format';
import ModalShell from './ModalShell.vue';

/**
 * 天机轮（赌坊第二个玩法）：纯 CSS + SVG 画盘，不用 canvas、不引第三方库。
 *
 * 服务端是唯一的规则来源：格面文案（slot.label）、各档位费用（costs）、重置费（resetCost）、
 * 落格（result.slotIndex）与奖励（result.message / result.reward）都原样渲染；
 * 这里只做一件事——把「停在第几格」换算成转盘角度。
 */
const props = defineProps<{
  state: SectStateView;
  busy: boolean;
  /** 转盘面板；null = 赌坊未解锁（入口此时已被禁用，这里只做兜底）。 */
  wheel: WheelView | null;
  /** 刚转出的一次结果；null = 还没转过（上层每次转动前都会清空）。 */
  result: WheelSpinResult | null;
}>();

const emit = defineEmits<{
  spin: [tier: number];
  reset: [];
  /** 转盘停稳、结果露出：与论道的 reveal 同一套处理，由 SectScreen 补一条提示。 */
  reveal: [];
}>();

const showOdds = ref(false);

/* ---------- 转盘几何 ---------- */

/** SVG 画布 200×200（对应 css 的 280px 圆盘，等比缩放），(100,100) 是盘心。 */
const VIEW_SIZE = 200;
const CENTER = VIEW_SIZE / 2;
const RADIUS = 92;
/** 格面文字的锚点半径：内圈避开盘心，外圈留出金边。 */
const LABEL_RADIUS = 55;
/** 服务端固定 8 格；张角仍按实际格数算，万一格数变了也不会错位。 */
const FALLBACK_SLOT_COUNT = 8;

/** 每格张角（8 格 → 45°）。 */
const slotAngle = computed(() => 360 / Math.max(1, props.wheel?.slots.length ?? FALLBACK_SLOT_COUNT));

/** 第 i 格中心相对 12 点的角度 = i × 张角 + 半个张角（8 格时就是 i×45 + 22.5）。 */
function slotCenterAngle(index: number): number {
  return index * slotAngle.value + slotAngle.value / 2;
}

/** 极坐标 → SVG 坐标：θ 从 12 点方向起、顺时针为正（与转盘视觉方向一致，也是指针的方向）。 */
function polar(angleDeg: number, radius: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: round(CENTER + radius * Math.sin(rad)), y: round(CENTER - radius * Math.cos(rad)) };
}

/** 路径坐标取三位小数：角度都是 22.5 的整数倍，取整只为保持 DOM 干净，不引入误差。 */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * 第 index 格的扇区路径：盘心 → 起始半径 → 沿弧扫过一格张角。
 * 每格一条 path（而不是一整个圆加分隔线），命中格高亮时可以直接复用同一条路径。
 */
function sectorPath(index: number): string {
  const from = polar(index * slotAngle.value, RADIUS);
  const to = polar((index + 1) * slotAngle.value, RADIUS);
  return `M ${CENTER} ${CENTER} L ${from.x} ${from.y} A ${RADIUS} ${RADIUS} 0 0 1 ${to.x} ${to.y} Z`;
}

/**
 * 格面文字沿半径排（转盘经典写法）：从 12 点位置量出的角度 θ 决定文字怎么转，
 * θ < 180° 的一侧向外读、另一侧向内读，任何一格最多只偏 90°，不会出现倒读的字。
 */
function labelRotate(centerAngle: number): number {
  return centerAngle < 180 ? centerAngle - 90 : centerAngle + 90;
}

/** 中文按 1 个字宽、其余按 0.55 估宽：超过 6 个字宽就缩一档字号。 */
function labelWidth(label: string): number {
  let width = 0;
  for (const char of label) {
    width += /[\u3000-\u9fff\uff00-\uffef]/.test(char) ? 1 : 0.55;
  }
  return width;
}

interface Sector {
  index: number;
  /** 只用来取格面文案与配色，不参与任何计算。 */
  slot: WheelSlotView;
  path: string;
  labelX: number;
  labelY: number;
  /** 文字自身的旋转角（绕自己的锚点转，锚点不动）。 */
  labelRotate: number;
  long: boolean;
}

const sectors = computed<Sector[]>(() =>
  (props.wheel?.slots ?? []).map((slot, index) => {
    const center = slotCenterAngle(index);
    const anchor = polar(center, LABEL_RADIUS);
    return {
      index,
      slot,
      path: sectorPath(index),
      labelX: anchor.x,
      labelY: anchor.y,
      labelRotate: labelRotate(center),
      long: labelWidth(slot.label) > 6,
    };
  }),
);

/* ---------- 转动 ---------- */

/** 与 css 的过渡时长一致：4s cubic-bezier(0.17, 0.67, 0.12, 0.99)（计划 5.2）。 */
const SPIN_DURATION_MS = 4000;

/** 当前累计旋转角（度）。连续转动都在这上面继续加，所以永远不会回跳。 */
const rotation = ref(0);
/** idle = 可转动；spinning = 动画中；landed = 停稳、结果已露出。 */
const phase = ref<'idle' | 'spinning' | 'landed'>('idle');
/** 到手的结果：转动中先存着不显示，停稳后才摆出来（不在旋转过程中剧透）。 */
const shownResult = ref<WheelSpinResult | null>(null);

/**
 * 让第 index 格中心正对顶部指针所需的旋转量（0~360）：
 * 顺时针转 r 度后该格中心落在 r + index×张角 + 半个张角，令它 ≡ 0 (mod 360) 即正对指针，
 * 于是 r = −(index×45 + 22.5)，归一化到 0~360（第 0 格即 337.5°）。
 */
function alignRotation(index: number): number {
  return (360 - (slotCenterAngle(index) % 360)) % 360;
}

/**
 * 本次目标角度 = 当前累计角 + 随机 4~6 整圈 + 补到目标格的差值。
 * 只增不减：落点精确是那一格的中心，而盘面看起来永远朝同一个方向转。
 */
function nextRotation(index: number): number {
  const turns = 4 + Math.floor(Math.random() * 3);
  // 角度都是 0.5 的整数倍，在二进制里精确，累计再多圈也不会漂。
  const delta = (alignRotation(index) - (rotation.value % 360) + 360) % 360;
  return rotation.value + turns * 360 + delta;
}

let spinTimer: number | undefined;

/**
 * 兜底等待时长：reduced-motion 时 base.css 把过渡压到 0.01ms，
 * 计时也要跟着缩短，否则结果面板会白白等 4 秒才出现。
 */
function spinWaitMs(): number {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : SPIN_DURATION_MS;
}

/** 停稳：露出结果并请上层补提示。过渡被打断时也只落定一次。 */
function settle(): void {
  if (phase.value !== 'spinning') return;
  window.clearTimeout(spinTimer);
  phase.value = 'landed';
  emit('reveal');
}

function startSpin(index: number): void {
  rotation.value = nextRotation(index);
  phase.value = 'spinning';
  window.clearTimeout(spinTimer);
  spinTimer = window.setTimeout(settle, spinWaitMs() + 200);
}

/** 过渡结束才算停稳（只认 transform，字号之类的过渡不算）。 */
function onWheelTransitionEnd(event: TransitionEvent): void {
  if (event.propertyName !== 'transform') return;
  settle();
}

onUnmounted(() => {
  window.clearTimeout(spinTimer);
});

/**
 * 结果到达才开转：落点必须由服务端裁决，前端不猜格子。
 * 上层在每次转动前会清空 result（重置后也清），所以 null 就回到可转动状态，
 * 且转盘角度保持不动——重开面板时盘面不会莫名其妙地跳回去。
 */
watch(
  () => props.result,
  (result) => {
    if (result === null) {
      shownResult.value = null;
      if (phase.value === 'landed') phase.value = 'idle';
      return;
    }
    shownResult.value = result;
    const count = props.wheel?.slots.length ?? 0;
    if (result.slotIndex < 0 || result.slotIndex >= count) {
      // 越界（服务端不该发生）：不假装停在哪一格，只把服务端文案摆出来。
      phase.value = 'landed';
      emit('reveal');
      return;
    }
    startSpin(result.slotIndex);
  },
);

/* ---------- 档位、按钮与结果文案 ---------- */

/** 档位与费用全部来自服务端，前端不写任何金额。 */
const costs = computed(() => props.wheel?.costs ?? []);
const remaining = computed(() => props.state.gambling.remaining);
const dailyLimit = computed(() => props.state.gambling.dailyLimit);

const tier = ref(costs.value[0]?.tier ?? 1);
const selectedCost = computed(
  () => costs.value.find((item) => item.tier === tier.value) ?? costs.value[0],
);

const hasTries = computed(() => remaining.value > 0);
const spinning = computed(() => phase.value === 'spinning');
const canSpin = computed(
  () =>
    props.wheel !== null &&
    selectedCost.value !== undefined &&
    !props.busy &&
    !spinning.value &&
    hasTries.value,
);
const canReset = computed(() => props.wheel !== null && !props.busy && !spinning.value);

const costText = computed(() => (selectedCost.value ? formatAmount(selectedCost.value.cost) : '—'));
const resetCostText = computed(() => (props.wheel ? formatAmount(props.wheel.resetCost) : '—'));

function spin(): void {
  if (!canSpin.value || selectedCost.value === undefined) return;
  emit('spin', selectedCost.value.tier);
}

function resetWheel(): void {
  if (!canReset.value) return;
  emit('reset');
}

/** 「继续」：收起结果面板回到可转动状态（盘面停在原处，等玩家再押一档）。 */
function continueSpin(): void {
  shownResult.value = null;
  phase.value = 'idle';
}

/** 停稳后才露出的结果；转动中即使结果已经到手也不显示。 */
const landedResult = computed(() => (phase.value === 'landed' ? shownResult.value : null));
const hitIndex = computed(() => landedResult.value?.slotIndex ?? null);


/** 读屏用的一句总览：格面文案同样来自服务端。 */
const wheelAriaLabel = computed(() => {
  const slots = props.wheel?.slots ?? [];
  return `天机轮转盘，共 ${slots.length} 格：${slots.map((slot) => slot.label).join('、')}`;
});
</script>

<template>
  <section class="wheel-panel" aria-labelledby="gambling-dialog-title">

    <p v-if="!wheel" class="blocked-hint">
      {{ state.gambling.blockedReason ?? '天机轮尚未开启' }}
    </p>

    <template v-else>
      <div class="wheel-stage">
        <!-- 指针在 svg 之外：转的是盘，针永远指向正上方那一格。 -->
        <div class="wheel-pointer" aria-hidden="true"></div>
        <div class="wheel-plate" role="img" :aria-label="wheelAriaLabel">
          <svg
            class="wheel-svg"
            :viewBox="`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`"
            :style="{ transform: `rotate(${rotation}deg)` }"
            aria-hidden="true"
            @transitionend="onWheelTransitionEnd"
          >
            <circle class="wheel-halo" :cx="CENTER" :cy="CENTER" :r="RADIUS" />
            <path
              v-for="sector in sectors"
              :key="sector.index"
              class="wheel-sector"
              :class="{
                'is-alt': sector.index % 2 === 1,
                'is-big': sector.slot.type === 'big_spirit_stone',
                'is-nothing': sector.slot.type === 'nothing',
              }"
              :d="sector.path"
            />
            <path v-if="hitIndex !== null" class="wheel-hit" :d="sectorPath(hitIndex)" />
            <text
              v-for="sector in sectors"
              :key="`label-${sector.index}`"
              class="wheel-label"
              :class="{
                'is-long': sector.long,
                'is-big': sector.slot.type === 'big_spirit_stone',
                'is-nothing': sector.slot.type === 'nothing',
              }"
              :x="sector.labelX"
              :y="sector.labelY"
              :transform="`rotate(${sector.labelRotate} ${sector.labelX} ${sector.labelY})`"
              text-anchor="middle"
              dominant-baseline="central"
            >{{ sector.slot.label }}</text>
            <circle class="wheel-hub-ring" :cx="CENTER" :cy="CENTER" r="17" />
            <circle class="wheel-hub" :cx="CENTER" :cy="CENTER" r="13" />
          </svg>
        </div>
      </div>

      <!-- 停稳前是档位 + 转动，停稳后原地换成结果：位置固定，视线不用上下找。 -->
      <div v-if="landedResult === null" class="wheel-controls">
        <p class="eyebrow">投入档位</p>
        <div class="wheel-tiers" role="radiogroup" aria-label="投入档位">
          <button
            v-for="item in costs"
            :key="item.tier"
            class="wheel-tier"
            :class="{ 'is-selected': item.tier === tier }"
            type="button"
            role="radio"
            :disabled="busy || spinning"
            :aria-checked="item.tier === tier"
            @click="tier = item.tier"
          >
            <strong>{{ item.tier }}x</strong>
            <small>{{ formatAmount(item.cost) }} 灵石</small>
          </button>
        </div>

        <button
          class="action-button primary-action realm-button wheel-spin-button"
          :class="{ 'is-disabled': !canSpin }"
          type="button"
          :disabled="busy || spinning || !hasTries || wheel === null"
          :aria-disabled="!canSpin"
          @click="spin"
        >
          <span>{{ spinning ? '天机推演中…' : `转动天机 · ${costText} 灵石` }}</span>
        </button>

        <p v-if="!hasTries" class="blocked-hint">
          今日 {{ dailyLimit }} 次机会（论道与天机轮共享）已用尽，明日再来。
        </p>
      </div>

      <template v-else>
        <template v-if="landedResult">
          <div class="wheel-result" role="status" aria-live="polite">
            <p class="eyebrow">天机已定</p>
            <strong class="wheel-result-label">{{ landedResult.slotLabel }}</strong>
            <p class="wheel-result-message">{{ landedResult.message }}</p>
          </div>
          <button
            class="action-button primary-action realm-button wheel-spin-button"
            type="button"
        :disabled="busy"
            @click="continueSpin"
          >
            <span>继续</span>
          </button>
        </template>
      </template>

      <div class="wheel-foot">
        <button
          class="action-button wheel-foot-button"
          type="button"
          :disabled="!canReset"
          @click="resetWheel"
        >
          重置转盘 · {{ resetCostText }} 灵石
        </button>
        <button class="action-button wheel-foot-button" type="button" @click="showOdds = true">概率说明</button>
      </div>
    </template>

    <ModalShell v-if="showOdds" narrow label="天机轮概率说明" @close="showOdds = false">
      <section class="wheel-odds-card" aria-labelledby="wheel-odds-title">
        <h2 id="wheel-odds-title" class="disciple-detail-title">概率说明</h2>
        <pre class="wheel-odds-text">天机轮共 8 格，各格类型随机生成。
转动时并非等概率落格，各类型命中权重如下：

  大额灵石　　权重 1（最低）
  小额灵石　　权重 2
  草药　　　　权重 2
  矿石　　　　权重 2
  丹药　　　　权重 2
  谢谢惠顾　　权重 3（最高）

实际概率取决于当前转盘的格子组成。
例如 1 大额 + 3 小额 + 2 谢谢 + 1 草药 + 1 丹药：
大额 ≈ 6%，小额各 ≈ 12%，草药 ≈ 12%，
丹药 ≈ 12%，谢谢惠顾各 ≈ 18%。

花费 100 灵石可重置转盘，格子类型与倍率全部刷新。
每日论道与天机轮共享 50 次机会。</pre>
        <button class="action-button primary-action realm-button" type="button" @click="showOdds = false">
          <span>知道了</span>
        </button>
      </section>
    </ModalShell>
  </section>
</template>

<style scoped>
.wheel-panel {
  display: flex;
  flex-direction: column;
}

/* ---------- 转盘本体 ---------- */

.wheel-stage {
  position: relative;
  display: flex;
  justify-content: center;
  margin-top: 14px;
}

/* 顶部固定指针：金色朝下的三角形，压在盘面上缘。 */
.wheel-pointer {
  position: absolute;
  top: 0;
  left: 50%;
  z-index: 2;
  width: 0;
  height: 0;
  transform: translateX(-50%);
  border-top: 15px solid var(--gold, #caa96a);
  border-right: 9px solid transparent;
  border-left: 9px solid transparent;
  filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.55));
}

/* 直径 280px；窄屏跟着容器收，aspect-ratio 保证圆盘不被压成椭圆。 */
.wheel-plate {
  position: relative;
  width: min(280px, 100%);
  aspect-ratio: 1 / 1;
  border: 2px solid var(--gold, #caa96a);
  border-radius: 50%;
  background: radial-gradient(circle at 50% 50%, rgba(23, 49, 41, 0.9), rgba(8, 20, 17, 0.96));
  box-shadow: inset 0 0 26px rgba(0, 0, 0, 0.45), 0 12px 30px rgba(0, 0, 0, 0.32);
}

/* 转动：只过渡 transform，4s 缓出；停住后不回弹、不回跳。 */
.wheel-svg {
  display: block;
  width: 100%;
  height: 100%;
  transform-origin: 50% 50%;
  transition: transform 4s cubic-bezier(0.17, 0.67, 0.12, 0.99);
}

.wheel-halo {
  fill: none;
  stroke: rgba(202, 169, 106, 0.35);
  stroke-width: 1.2;
}

/* 扇区：普通格两色交替；大额灵石压亮、谢谢惠顾压到最暗（计划 5.4）。 */
.wheel-sector {
  fill: rgba(202, 169, 106, 0.08);
  stroke: rgba(6, 16, 15, 0.9);
  stroke-width: 1;
}

.wheel-sector.is-alt {
  fill: rgba(255, 255, 255, 0.02);
}

.wheel-sector.is-big {
  fill: rgba(202, 169, 106, 0.18);
}

.wheel-sector.is-nothing {
  fill: rgba(255, 255, 255, 0.01);
}

/* 命中格：停稳后点亮一次，指明落在哪一格。 */
.wheel-hit {
  fill: rgba(202, 169, 106, 0.22);
  stroke: var(--gold, #caa96a);
  stroke-width: 1.4;
  animation: wheel-hit-flash 420ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes wheel-hit-flash {
  from {
    opacity: 0.25;
  }
  to {
    opacity: 1;
  }
}

.wheel-label {
  fill: #dce6e0;
  font-family: 'STKaiti', 'KaiTi', serif;
  font-size: 10px;
  font-weight: 500;
}

/* 长格面缩一档字号，避免文字挤进邻格（页面缩放时字号跟着盘一起缩）。 */
.wheel-label.is-long {
  font-size: 8.5px;
}

.wheel-label.is-big {
  fill: var(--gold, #caa96a);
}

.wheel-label.is-nothing {
  fill: #7d9186;
}

.wheel-hub-ring {
  fill: none;
  stroke: rgba(202, 169, 106, 0.22);
  stroke-width: 0.8;
}

.wheel-hub {
  fill: #123026;
  stroke: rgba(202, 169, 106, 0.5);
  stroke-width: 1;
}

/* ---------- 档位与按钮 ---------- */

.wheel-controls {
  margin-top: 18px;
}

.wheel-tiers {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.wheel-tier {
  display: flex;
  min-width: 96px;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.014);
  color: #a9bcb2;
  text-align: left;
  transition: border-color 160ms ease, background-color 160ms ease, color 160ms ease;
}

.wheel-tier:not(:disabled):hover {
  border-color: rgba(119, 184, 154, 0.4);
}

.wheel-tier.is-selected {
  border-color: rgba(202, 169, 106, 0.55);
  color: var(--gold);
  background: rgba(202, 169, 106, 0.1);
}

.wheel-tier strong {
  font-size: 13px;
  font-weight: 600;
}

.wheel-tier small {
  color: #7d9186;
  font-size: 11px;
}

.wheel-tier.is-selected small {
  color: rgba(202, 169, 106, 0.85);
}

.wheel-spin-button {
  margin-top: 14px;
}

/* ---------- 结果 ---------- */

.wheel-result {
  margin-top: 18px;
}

.wheel-result-label {
  display: block;
  margin-top: 4px;
  color: var(--gold, #caa96a);
  font-family: 'STKaiti', 'KaiTi', serif;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.wheel-result-message {
  margin-top: 6px;
  color: #c8d6ce;
  font-size: 13px;
  line-height: 1.6;
}


.wheel-foot {
  display: flex;
  gap: 10px;
  margin-top: 18px;
}

.wheel-foot-button {
  flex: 1 1 0;
  padding: 8px 12px;
  font-size: 13px;
}

.wheel-odds-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.wheel-odds-text {
  margin: 0;
  color: #c8d6ce;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
}
</style>
