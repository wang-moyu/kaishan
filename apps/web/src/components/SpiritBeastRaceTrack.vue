<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';

/**
 * 灵兽竞逐的 SVG 赛跑动画：倒数 → 竞逐 → 冠军揭晓。
 *
 * 只负责「把服务端给的跑位序列演出来」：名次、冠军与输赢都由服务端决定，
 * 本组件不改任何结果。steps 在挂载时快照一次 —— 父组件每 5 秒轮询会换来新的 race 对象，
 * 不能让动画中途跟着跳。播完（或点跳过）emit('done')，由父组件切到结果页。
 */

interface TrackBeast {
  index: number;
  name: string;
  odds: number;
}

const props = defineProps<{
  beasts: TrackBeast[];
  /** 每只灵兽 N 步的进度（0~1），最后一步即终点进度（冠军 1.0）。 */
  steps: number[][];
  winnerIndex: number;
  /** 玩家押过的灵兽下标。 */
  picked: number[];
}>();

const emit = defineEmits<{ done: [] }>();

/* ---------- 版式 ---------- */
const W = 720;
const H = 330;
const START_X = 104;
const FINISH_X = 640;
const LANE_TOP = 100;
const LANE_H = 44;
const COUNTDOWN_MS = 2400;
const RACE_MS = 12_000;
const BURST_MS = 2800;

/** 麒麟金、玄龟青、朱雀赤、白虎素、青龙蓝（与 BEAST_NAMES 顺序一致）。 */
const COLORS = ['#e8bc6a', '#5fb8a4', '#e8664e', '#e2e8ea', '#52b8e6'];
const colorOf = (index: number): string => COLORS[index] ?? '#caa96a';
const glyphOf = (name: string): string => name.slice(-1);
const laneY = (index: number): number => LANE_TOP + index * LANE_H + LANE_H / 2;
const xOf = (progress: number): number => START_X + progress * (FINISH_X - START_X);

/* ---------- 跑位插值（挂载时快照，Hermite 平滑） ---------- */
const lanes = props.steps.map((lane) => [0, ...lane]);
const finals = lanes.map((lane) => lane[lane.length - 1] ?? 0);

function sample(lane: number[], t: number): number {
  const n = lane.length - 1;
  if (n <= 0) return 0;
  const x = Math.min(n, Math.max(0, t * n));
  const i = Math.min(n - 1, Math.floor(x));
  const u = x - i;
  const p0 = lane[Math.max(0, i - 1)]!;
  const p1 = lane[i]!;
  const p2 = lane[i + 1]!;
  const p3 = lane[Math.min(n, i + 2)]!;
  const m1 = (p2 - p0) / 2;
  const m2 = (p3 - p1) / 2;
  const u2 = u * u;
  const u3 = u2 * u;
  const v = (2 * u3 - 3 * u2 + 1) * p1 + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * p2 + (u3 - u2) * m2;
  return Math.min(1, Math.max(0, v));
}

/* ---------- 帧状态 ---------- */
const elapsed = ref(0);
const pos = ref<number[]>(lanes.map(() => 0));
const tail = ref<number[]>(lanes.map(() => 0));

const raceT = computed(() => (elapsed.value - COUNTDOWN_MS) / RACE_MS);
const burstT = computed(() => elapsed.value - COUNTDOWN_MS - RACE_MS);
const racing = computed(() => raceT.value > 0 && raceT.value < 1);
const lead = computed(() => Math.max(0, ...pos.value));

/** 实时名次：进度高者在前，同进度按下标。 */
const places = computed(() => {
  const order = pos.value.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p || a.i - b.i);
  const result: number[] = [];
  order.forEach((item, place) => {
    result[item.i] = place + 1;
  });
  return result;
});

const countdownText = computed(() => {
  const e = elapsed.value;
  if (e < 800) return '三';
  if (e < 1600) return '二';
  if (e < COUNTDOWN_MS) return '一';
  if (e < COUNTDOWN_MS + 700) return '开跑';
  return '';
});
/** 每个倒数字 800ms 内由大到小、由实到虚。 */
const countdownFrac = computed(() => {
  const e = elapsed.value;
  return e < COUNTDOWN_MS ? (e % 800) / 800 : (e - COUNTDOWN_MS) / 700;
});

/* ---------- 远景：确定性的山形与云 ---------- */
function ridge(base: number, amp: number, seed: number, width: number): string {
  const pts: string[] = [`M0,${String(LANE_TOP)}`];
  for (let x = 0; x <= width; x += 12) {
    const y =
      base -
      amp * (0.55 * Math.sin(x / 97 + seed) + 0.3 * Math.sin(x / 41 + seed * 2) + 0.15 * Math.sin(x / 17 + seed * 3) + 1) /
        2;
    pts.push(`L${String(x)},${y.toFixed(1)}`);
  }
  pts.push(`L${String(width)},${String(LANE_TOP)}Z`);
  return pts.join(' ');
}
const farRidge = ridge(80, 58, 1.3, 1500);
const nearRidge = ridge(96, 44, 4.1, 1500);
const clouds = [
  { x: 120, y: 34, rx: 70, ry: 9 },
  { x: 420, y: 22, rx: 90, ry: 8 },
  { x: 760, y: 40, rx: 80, ry: 10 },
  { x: 1080, y: 28, rx: 100, ry: 9 },
];

/* ---------- 冠军揭晓：粒子 ---------- */
const particles = Array.from({ length: 36 }, (_, k) => {
  const angle = (k / 36) * Math.PI * 2 + ((k * 7919) % 13) / 13;
  return {
    angle,
    speed: 70 + ((k * 104729) % 97),
    r: 1.4 + (k % 3) * 0.8,
    color: k % 3 === 0 ? '#ead19a' : colorOf(props.winnerIndex),
  };
});
const winnerName = computed(() => props.beasts.find((b) => b.index === props.winnerIndex)?.name ?? '');
const pickedWinner = computed(() => props.picked.includes(props.winnerIndex));
const burstIn = computed(() => Math.min(1, Math.max(0, burstT.value) / 420));
/** 横幅弹入：带一点回弹的缩放。 */
const bannerScale = computed(() => {
  const u = burstIn.value;
  return u >= 1 ? 1 : 0.6 + 0.4 * (1 - Math.pow(1 - u, 3)) + Math.sin(u * Math.PI) * 0.12;
});

function particleAt(p: (typeof particles)[number]): { x: number; y: number; o: number } {
  const s = Math.max(0, burstT.value) / 1000;
  return {
    x: FINISH_X + Math.cos(p.angle) * p.speed * s,
    y: laneY(props.winnerIndex) + Math.sin(p.angle) * p.speed * s + 60 * s * s,
    o: Math.max(0, 1 - s / 1.8),
  };
}

/* ---------- 主循环 ---------- */
let raf = 0;
let startAt = 0;
let prevNow = 0;
let finished = false;

function finish(): void {
  if (finished) return;
  finished = true;
  cancelAnimationFrame(raf);
  emit('done');
}

function tick(now: number): void {
  if (startAt === 0) {
    startAt = now;
    prevNow = now;
  }
  elapsed.value = now - startAt;
  const t = raceT.value;
  const dt = Math.max(1, now - prevNow);
  prevNow = now;
  if (t > 0) {
    const next = lanes.map((lane) => sample(lane, Math.min(1, t)));
    tail.value = next.map((p, i) => {
      const speed = ((p - (pos.value[i] ?? 0)) / dt) * 1000;
      const target = Math.min(110, Math.max(0, speed * 620));
      return (tail.value[i] ?? 0) * 0.8 + target * 0.2;
    });
    pos.value = next;
  }
  if (burstT.value >= BURST_MS) {
    finish();
    return;
  }
  raf = requestAnimationFrame(tick);
}

onMounted(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    pos.value = [...finals];
    elapsed.value = COUNTDOWN_MS + RACE_MS + 1;
    window.setTimeout(finish, 900);
    return;
  }
  raf = requestAnimationFrame(tick);
});

onUnmounted(() => cancelAnimationFrame(raf));
</script>

<template>
  <div class="beast-track">
    <svg :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="`灵兽竞逐赛况，冠军${winnerName}`">
      <defs>
        <linearGradient id="bt-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#0b1411" />
          <stop offset="0.55" stop-color="#132822" />
          <stop offset="1" stop-color="#0e1a16" />
        </linearGradient>
        <linearGradient id="bt-ground" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#ffffff" stop-opacity="0.015" />
          <stop offset="1" stop-color="#ffffff" stop-opacity="0.05" />
        </linearGradient>
        <radialGradient id="bt-moon" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stop-color="#f3e2b4" stop-opacity="0.9" />
          <stop offset="0.6" stop-color="#caa96a" stop-opacity="0.25" />
          <stop offset="1" stop-color="#caa96a" stop-opacity="0" />
        </radialGradient>
        <linearGradient
          v-for="b in beasts"
          :id="`bt-tail-${b.index}`"
          :key="`t${b.index}`"
          x1="1" y1="0" x2="0" y2="0"
        >
          <stop offset="0" :stop-color="colorOf(b.index)" stop-opacity="0.85" />
          <stop offset="1" :stop-color="colorOf(b.index)" stop-opacity="0" />
        </linearGradient>
        <radialGradient v-for="b in beasts" :id="`bt-seal-${b.index}`" :key="`s${b.index}`" cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stop-color="#ffffff" stop-opacity="0.85" />
          <stop offset="0.35" :stop-color="colorOf(b.index)" />
          <stop offset="1" :stop-color="colorOf(b.index)" stop-opacity="0.75" />
        </radialGradient>
        <filter id="bt-glow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
        <filter id="bt-soft" x="-50%" y="-200%" width="200%" height="500%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>

      <!-- 天幕、月、远山、流云（随领先者进度视差平移） -->
      <rect :width="W" :height="H" fill="url(#bt-sky)" />
      <circle cx="590" cy="38" r="46" fill="url(#bt-moon)" />
      <g :transform="`translate(${-lead * 160 - elapsed * 0.004} 0)`" opacity="0.5">
        <ellipse
          v-for="(c, k) in clouds" :key="k"
          :cx="c.x" :cy="c.y" :rx="c.rx" :ry="c.ry"
          fill="#a9bcb2" opacity="0.18" filter="url(#bt-soft)"
        />
      </g>
      <path :d="farRidge" :transform="`translate(${-lead * 220} 0)`" fill="#1b332b" opacity="0.8" />
      <path :d="nearRidge" :transform="`translate(${-lead * 420} 0)`" fill="#10201b" />

      <!-- 赛道 -->
      <g v-for="b in beasts" :key="`lane${b.index}`">
        <rect
          x="0" :y="LANE_TOP + b.index * LANE_H" :width="W" :height="LANE_H"
          :fill="picked.includes(b.index) ? 'rgba(202,169,106,0.09)' : 'url(#bt-ground)'"
        />
        <rect v-if="picked.includes(b.index)" x="0" :y="LANE_TOP + b.index * LANE_H" width="3" :height="LANE_H" fill="#caa96a" />
        <line
          x1="0" :x2="W" :y1="LANE_TOP + (b.index + 1) * LANE_H" :y2="LANE_TOP + (b.index + 1) * LANE_H"
          stroke="#ffffff" stroke-opacity="0.06" stroke-dasharray="2 6"
        />
        <text x="14" :y="laneY(b.index) - 3" class="bt-name">{{ b.name }}</text>
        <text x="14" :y="laneY(b.index) + 12" class="bt-odds">
          {{ b.odds > 0 ? `${b.odds.toFixed(1)}x` : '—' }}{{ picked.includes(b.index) ? ' · 已押' : '' }}
        </text>
      </g>
      <line :x1="START_X" :x2="START_X" :y1="LANE_TOP" :y2="H" stroke="#a9bcb2" stroke-opacity="0.2" />

      <!-- 终点牌坊 -->
      <g>
        <line
          :x1="FINISH_X" :x2="FINISH_X" :y1="LANE_TOP" :y2="H"
          stroke="#caa96a" stroke-width="2" stroke-dasharray="6 4" opacity="0.8"
        />
        <line :x1="FINISH_X" :x2="FINISH_X" :y1="LANE_TOP" :y2="H" stroke="#ead19a" stroke-width="6" opacity="0.18" filter="url(#bt-glow)" />
        <rect :x="FINISH_X - 30" :y="LANE_TOP - 34" width="6" height="34" fill="#806331" />
        <rect :x="FINISH_X + 24" :y="LANE_TOP - 34" width="6" height="34" fill="#806331" />
        <path
          :d="`M${FINISH_X - 44},${LANE_TOP - 38} Q${FINISH_X},${LANE_TOP - 48} ${FINISH_X + 44},${LANE_TOP - 38} L${FINISH_X + 40},${LANE_TOP - 30} L${FINISH_X - 40},${LANE_TOP - 30}Z`"
          fill="#caa96a"
        />
        <rect :x="FINISH_X - 11" :y="LANE_TOP - 29" width="22" height="20" rx="2" fill="#10201b" stroke="#caa96a" />
        <text :x="FINISH_X" :y="LANE_TOP - 14" class="bt-gate">终</text>
      </g>

      <!-- 灵兽印章 -->
      <g
        v-for="b in beasts" :key="`beast${b.index}`"
        :transform="`translate(${xOf(pos[b.index] ?? 0)} ${laneY(b.index) + (racing ? Math.sin(elapsed / 110 + b.index * 1.7) * 2.2 : 0)})`"
      >
        <path
          v-if="(tail[b.index] ?? 0) > 2"
          :d="`M-12,-8 Q${-12 - (tail[b.index] ?? 0) * 0.5},-3 ${-12 - (tail[b.index] ?? 0)},0 Q${-12 - (tail[b.index] ?? 0) * 0.5},3 -12,8Z`"
          :fill="`url(#bt-tail-${b.index})`"
        />
        <circle r="19" :fill="colorOf(b.index)" opacity="0.35" filter="url(#bt-glow)" />
        <circle
          v-if="racing && places[b.index] === 1"
          r="21" fill="none" stroke="#ead19a" stroke-width="1.5"
          :opacity="0.5 + Math.sin(elapsed / 140) * 0.4"
        />
        <circle r="15" :fill="`url(#bt-seal-${b.index})`" stroke="#0b1411" stroke-width="1.5" />
        <text y="5.5" class="bt-glyph">{{ glyphOf(b.name) }}</text>
        <text
          v-if="raceT > 0"
          x="23" y="4" class="bt-place"
          :fill="places[b.index] === 1 ? '#ead19a' : '#7d9186'"
        >{{ places[b.index] }}</text>
      </g>

      <!-- 倒数 -->
      <text
        v-if="countdownText"
        :x="W / 2" :y="LANE_TOP + 132"
        class="bt-countdown"
        :opacity="1 - countdownFrac * 0.85"
        :transform="`translate(${W / 2} ${LANE_TOP + 110}) scale(${1.5 - countdownFrac * 0.5}) translate(${-W / 2} ${-(LANE_TOP + 110)})`"
      >{{ countdownText }}</text>

      <!-- 冠军揭晓 -->
      <g v-if="burstT > 0">
        <rect :width="W" :height="H" fill="#050a08" :opacity="burstIn * 0.45" />
        <g :transform="`translate(${FINISH_X} ${laneY(winnerIndex)}) rotate(${burstT * 0.02})`" :opacity="burstIn * 0.7">
          <path
            v-for="k in 12" :key="k"
            :d="`M0,0 L${Math.cos((k / 12) * Math.PI * 2 - 0.07) * 150},${Math.sin((k / 12) * Math.PI * 2 - 0.07) * 150} L${Math.cos((k / 12) * Math.PI * 2 + 0.07) * 150},${Math.sin((k / 12) * Math.PI * 2 + 0.07) * 150}Z`"
            fill="#ead19a" opacity="0.18"
          />
        </g>
        <circle
          v-for="(p, k) in particles" :key="`p${k}`"
          :cx="particleAt(p).x" :cy="particleAt(p).y" :r="p.r"
          :fill="p.color" :opacity="particleAt(p).o"
        />
        <g :transform="`translate(${FINISH_X} ${laneY(winnerIndex)}) scale(${1 + burstIn * 0.35})`">
          <circle r="24" :fill="colorOf(winnerIndex)" opacity="0.5" filter="url(#bt-glow)" />
          <circle r="15" :fill="`url(#bt-seal-${winnerIndex})`" stroke="#ead19a" stroke-width="2" />
          <text y="5.5" class="bt-glyph">{{ glyphOf(winnerName) }}</text>
        </g>
        <g :transform="`translate(${W / 2} ${LANE_TOP + 96}) scale(${bannerScale})`" :opacity="burstIn">
          <text y="0" class="bt-banner">{{ winnerName }} 夺魁</text>
          <text v-if="pickedWinner" y="30" class="bt-sub">押中了！</text>
        </g>
      </g>
    </svg>
    <button v-if="burstT < BURST_MS" class="bt-skip" type="button" @click="finish">跳过</button>
  </div>
</template>

<style scoped>
.beast-track {
  position: relative;
  margin-top: 8px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 4px;
}

.beast-track svg {
  display: block;
  width: 100%;
  height: auto;
}

.bt-name {
  fill: #dce6e0;
  font-size: 13px;
}

.bt-odds {
  fill: #caa96a;
  font-size: 11px;
}

.bt-gate,
.bt-glyph,
.bt-countdown,
.bt-banner,
.bt-sub {
  font-family: 'STKaiti', 'KaiTi', serif;
  text-anchor: middle;
}

.bt-gate {
  fill: #ead19a;
  font-size: 14px;
}

.bt-glyph {
  fill: #0b1411;
  font-size: 16px;
  font-weight: 700;
}

.bt-place {
  font-size: 11px;
  font-weight: 700;
}

.bt-countdown {
  fill: #ead19a;
  font-size: 64px;
  font-weight: 700;
}

.bt-banner {
  fill: #ead19a;
  font-size: 34px;
  font-weight: 700;
  letter-spacing: 0.12em;
  paint-order: stroke;
  stroke: #050a08;
  stroke-width: 4px;
}

.bt-sub {
  fill: #77b89a;
  font-size: 16px;
}

.bt-skip {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 2px 10px;
  border: 1px solid rgba(169, 188, 178, 0.3);
  border-radius: 2px;
  background: rgba(11, 20, 17, 0.6);
  color: #a9bcb2;
  font-size: 12px;
  cursor: pointer;
}

.bt-skip:hover {
  color: #ead19a;
}
</style>
