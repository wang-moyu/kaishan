<script setup lang="ts">
import { computed } from 'vue';

import HelpTip from './HelpTip.vue';

/**
 * 弟子六轴雷达图（资质 / 攻击 / 防御 / 身法 / 幸运 / 体魄）：轻量 SVG，不引图表库。
 *
 * 0028 起：数值列表在基础属性后面补上装备加成 `(+n)`（加成为 0 时不显示，也不进比例尺）。
 *
 * 规则：六轴都按服务端原值 `1..100` 等比绘制（服务端保证属性 ≤ 100），不做归一化，
 * 也不把天赋（类别）、战力（含境界的派生值）画成轴。图形只是补充，旁边必须列出精确数值，
 * 并给 SVG 一段无障碍文本说明。
 */
const props = defineProps<{
  name: string;
  aptitude: number;
  attack: number;
  defense: number;
  speed: number;
  luck: number;
  physique: number;
  /**
   * 0028 装备加成：只在右侧数值列表里以 `(+n)` 标出（为 0 时不显示）。
   * 六轴仍按基础属性绘制 —— 加成后可以超过 100，不能进比例尺。
   */
  gear?: { attack: number; defense: number; speed: number; luck: number; physique: number };
  /** 每项属性的说明（给了就在名称后面加一个问号）；公开档案不传，不显示问号。 */
  help?: Partial<Record<'aptitude' | 'attack' | 'defense' | 'speed' | 'luck' | 'physique', string>>;
}>();

/** viewBox 尺寸：留出六个轴标签的空间，宽度由 CSS 控制（响应式）。 */
const VIEW_WIDTH = 240;
const VIEW_HEIGHT = 200;
const CX = 120;
const CY = 98;
/** 六边形半径：缩短到 66 后，六个标签（半径 84）仍在 240×200 的框内。 */
const RADIUS = 66;
const LABEL_RADIUS = RADIUS + 18;

/**
 * 轴顺序（顺时针，顶部起）：资质 / 攻击 / 防御 / 身法 / 幸运 / 体魄，相邻两轴 60°。
 * 角度按 SVG 坐标（y 轴向下）：-90 = 上，0 = 右，90 = 下，150 / -150 = 左下 / 左上。
 * anchor 让标签朝图形外侧展开：上下居中，右侧左对齐，左侧右对齐。
 */
const AXES = [
  { key: 'aptitude', label: '资质', angle: -90, anchor: 'middle' },
  { key: 'attack', label: '攻击', angle: -30, anchor: 'start' },
  { key: 'defense', label: '防御', angle: 30, anchor: 'start' },
  { key: 'speed', label: '身法', angle: 90, anchor: 'middle' },
  { key: 'luck', label: '幸运', angle: 150, anchor: 'end' },
  { key: 'physique', label: '体魄', angle: -150, anchor: 'end' },
] as const;

type AxisKey = (typeof AXES)[number]['key'];

function pointAt(angleDeg: number, radius: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CX + Math.cos(rad) * radius, y: CY + Math.sin(rad) * radius };
}

/** 刻度环：25% / 50% / 75% / 100%。 */
const rings = [0.25, 0.5, 0.75, 1] as const;

function ringPoints(fraction: number): string {
  return AXES.map((axis) => {
    const point = pointAt(axis.angle, RADIUS * fraction);
    return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
  }).join(' ');
}

/** 服务端保证 ≤ 100，这里只做防御性 clamp（不改比例尺）。 */
function clampValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/**
 * 0028 该轴的装备加成（资质没有装备加成，按 0 处理）；
 * 只用于数值列表的 `(+n)`，绝不影响图形比例尺。
 */
function gearBonus(key: AxisKey): number {
  if (key === 'aptitude') return 0;
  const value = props.gear?.[key] ?? 0;
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

const values = computed<Record<AxisKey, number>>(() => ({
  aptitude: props.aptitude,
  attack: props.attack,
  defense: props.defense,
  speed: props.speed,
  luck: props.luck,
  physique: props.physique,
}));

const axisPoints = computed(() =>
  AXES.map((axis) => {
    const value = clampValue(values.value[axis.key]);
    const point = pointAt(axis.angle, (RADIUS * value) / 100);
    return {
      key: axis.key,
      label: axis.label,
      value,
      // 0028 装备加成：只用于数值列表的 `(+n)`，不参与上面的坐标计算。
      bonus: gearBonus(axis.key),
      x: Number(point.x.toFixed(1)),
      y: Number(point.y.toFixed(1)),
      lineX: Number(pointAt(axis.angle, RADIUS).x.toFixed(1)),
      lineY: Number(pointAt(axis.angle, RADIUS).y.toFixed(1)),
      labelX: Number(pointAt(axis.angle, LABEL_RADIUS).x.toFixed(1)),
      labelY: Number(pointAt(axis.angle, LABEL_RADIUS).y.toFixed(1)) + 4,
      anchor: axis.anchor,
    };
  }),
);

const valuePoints = computed(() => axisPoints.value.map((point) => `${point.x},${point.y}`).join(' '));

/** 图旁的无障碍文本：把六条轴的值与装备加成直接念出来，不让图形成为唯一信息源。 */
const ariaLabel = computed(
  () =>
    `${props.name} 六轴属性雷达图（资质 / 攻击 / 防御 / 身法 / 幸运 / 体魄，每轴 1~100）：` +
    axisPoints.value
      .map((point) =>
        point.bonus > 0
          ? `${point.label} ${String(point.value)}（装备 +${String(point.bonus)}）`
          : `${point.label} ${String(point.value)}`,
      )
      .join('、'),
);
</script>

<template>
  <figure class="radar-figure">
    <svg class="radar-chart" :viewBox="`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`" role="img" :aria-label="ariaLabel">
      <g class="radar-grid">
        <polygon v-for="ring in rings" :key="ring" :points="ringPoints(ring)" />
      </g>
      <g class="radar-axis">
        <line
          v-for="point in axisPoints"
          :key="point.key"
          :x1="CX"
          :y1="CY"
          :x2="point.lineX"
          :y2="point.lineY"
        />
      </g>
      <polygon class="radar-area" :points="valuePoints" />
      <circle v-for="point in axisPoints" :key="`dot-${point.key}`" class="radar-dot" :cx="point.x" :cy="point.y" r="2.6" />
      <g class="radar-labels" aria-hidden="true">
        <text
          v-for="point in axisPoints"
          :key="`label-${point.key}`"
          :x="point.labelX"
          :y="point.labelY"
          :text-anchor="point.anchor"
        >
          {{ point.label }}
        </text>
      </g>
    </svg>

    <dl class="radar-values" :class="{ 'has-help': help !== undefined }">
      <div v-for="point in axisPoints" :key="point.key" class="radar-value-row">
        <dt>
          {{ point.label }}
          <HelpTip v-if="help?.[point.key]" :label="`${point.label}说明`" :text="help[point.key] ?? ''" />
        </dt>
        <dd>
          <span class="radar-value-number">{{ point.value }}</span>
          <!-- 0028 装备加成：`60 (+12)`；为 0 时不显示，也不进绘图比例尺。 -->
          <span v-if="point.bonus > 0" class="gear-bonus">(+{{ point.bonus }})</span>
          <span class="radar-value-track" aria-hidden="true"><i :style="{ width: `${point.value}%` }" /></span>
        </dd>
      </div>
    </dl>
  </figure>
</template>
