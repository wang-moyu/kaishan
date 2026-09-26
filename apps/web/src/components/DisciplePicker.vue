<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

import type { DiscipleView } from '../api/game';
import { isInjured, selectionBlockReason, severeInjuryStatusLabel } from '../utils/discipleFilter';
import { severeRiskPercent } from '../utils/worldBossRisk';
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
    /**
     * 0027 世界 Boss 二期：弟子疲劳表（弟子 id → 最近 60 分钟出战讨伐的次数）。
     * 只有讨伐会传；传了才在卡片状态栏显示「本小时 n/3」/「冒进 xx%」/「必重伤」。
     */
    fatigue?: Record<string, number>;
    /** 讨伐：每个弟子最近 60 分钟内每次出战的时间（毫秒，升序），速览卡片据此显示「冒进冷却」。 */
    fatigueTimes?: Record<string, number[]>;
    /** 当前关卡是「狂暴」词缀：冒进概率 ×2（只有讨伐会传）。 */
    berserk?: boolean;
    /**
     * 0027 世界 Boss 二期：词缀推荐的额外排序属性 —— 在排序按钮里追加一个「xx ↓」按钮
     * （若已存在如「幸运 ↓」则不重复），不默认选中。
     */
    extraSort?: 'attack' | 'defense' | 'speed' | 'luck' | 'physique';
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

/**
 * 顶部排序的键：都是「从高到低」，比较口径与该组件 `ordered` 里的排序实现一致。
 * 除默认的 境界 / 战力 / 幸运 外，词缀推荐（extraSort）还会用到 攻击 / 防御 / 身法 / 体魄。
 */
type DiscipleSortKey = 'realm' | 'power' | 'luck' | 'attack' | 'defense' | 'speed' | 'physique';

/** extraSort 允许追加的排序属性。 */
type ExtraSortKey = 'attack' | 'defense' | 'speed' | 'luck' | 'physique';

const SORT_OPTIONS: readonly { value: DiscipleSortKey; label: string; hint: string }[] = [
  { value: 'realm', label: '境界 ↓', hint: '按大境界从高到低' },
  { value: 'power', label: '战力 ↓', hint: '按战力从高到低' },
  { value: 'luck', label: '幸运 ↓', hint: '按幸运值从高到低' },
];

/** extraSort 的按钮文案（「幸运 ↓」与 SORT_OPTIONS 重合，追加时按 value 去重）。 */
const EXTRA_SORT_OPTIONS: Record<ExtraSortKey, { label: string; hint: string }> = {
  attack: { label: '攻击 ↓', hint: '按攻击从高到低' },
  defense: { label: '防御 ↓', hint: '按防御从高到低' },
  speed: { label: '身法 ↓', hint: '按身法从高到低' },
  luck: { label: '幸运 ↓', hint: '按幸运值从高到低' },
  physique: { label: '体魄 ↓', hint: '按体魄从高到低' },
};

/** 排序按钮列表：默认三项 +（词缀推荐时）追加按钮；已存在的同名项不重复，且不默认选中。 */
const sortOptions = computed(() => {
  const options: { value: DiscipleSortKey; label: string; hint: string }[] = [...SORT_OPTIONS];
  const extra = props.extraSort;
  if (extra !== undefined && !options.some((option) => option.value === extra)) {
    options.push({ value: extra, ...EXTRA_SORT_OPTIONS[extra] });
  }
  return options;
});

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

/**
 * 卡片状态栏的疲劳标：只有状态正常（statusById 里没有）且 fatigue > 0 的弟子才有。
 * 1、2 次是提示（「本小时 n/3」），3 次起是红色风险，百分比按体魄修正后四舍五入：
 * 30% 档 = 0.30 − max(0, 体魄−50)/10 × 0.03，70% 档同理；5 次起必然重伤。
 * 「狂暴」词缀的 ×2 由调用方体现，这里只按基础概率 + 体魄修正。
 */
const fatigueById = computed(() => {
  const map = new Map<string, { text: string; danger: boolean }>();
  if (props.fatigue === undefined) return map;
  for (const disciple of props.disciples) {
    const label = fatigueStatusText(disciple);
    if (label !== null) map.set(disciple.id, label);
  }
  return map;
});

function fatigueStatusText(disciple: DiscipleView): { text: string; danger: boolean } | null {
  const count = props.fatigue?.[disciple.id] ?? 0;
  if (count <= 0) return null;
  if (count >= 3) {
    // 与二次确认弹窗同一个算法（含体魄减免与「狂暴」×2）
    const risk = severeRiskPercent(count, disciple.physique, props.berserk === true);
    return { text: risk >= 100 ? '必重伤' : `冒进 ${String(risk)}%`, danger: true };
  }
  return { text: `本小时 ${String(count)}/3`, danger: false };
}

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
  } else if (sortKey.value === 'attack') {
    list.sort((a, b) => b.attack - a.attack);
  } else if (sortKey.value === 'defense') {
    list.sort((a, b) => b.defense - a.defense);
  } else if (sortKey.value === 'speed') {
    list.sort((a, b) => b.speed - a.speed);
  } else if (sortKey.value === 'physique') {
    list.sort((a, b) => b.physique - a.physique);
  } else {
    // 大境界从高到低，同境界再比阶段（与 utils/discipleFilter 的 sortDisciples 同口径）。
    list.sort((a, b) => b.realmOrder - a.realmOrder || b.stage - a.stage);
  }
  // 选不了的（疗伤 / 在外）沉到最后：折叠时第一排都是能直接出战的人（sort 是稳定的，组内顺序不变）。
  const blocked = blockedIds.value;
  return [...list.filter((d) => !blocked.has(d.id)), ...list.filter((d) => blocked.has(d.id))];
});

/*
 * 默认只显示第一排：多数时候是「排好序直接点前几个出手」，不必把整个名册铺开。
 * 网格是 auto-fill，一排几张取决于弹窗宽度，所以实测 grid-template-columns 的列数，宽度变化时重算。
 * 已选中但排在第一排之后的弟子仍然显示出来，免得「选了却看不见」。
 */
const gridEl = ref<HTMLElement | null>(null);
const columns = ref(0); // 0 = 尚未测量 → 先全部显示
const expanded = ref(false);
let resizeObserver: ResizeObserver | undefined;

function measureColumns(): void {
  const el = gridEl.value;
  if (el === null) return;
  const template = getComputedStyle(el).gridTemplateColumns;
  columns.value = template && template !== 'none' ? template.split(' ').filter(Boolean).length : 0;
}

onMounted(() => {
  measureColumns();
  if (typeof ResizeObserver !== 'undefined' && gridEl.value !== null) {
    resizeObserver = new ResizeObserver(measureColumns);
    resizeObserver.observe(gridEl.value);
  }
});

onUnmounted(() => {
  resizeObserver?.disconnect();
});

const collapsible = computed(() => columns.value > 0 && ordered.value.length > columns.value);

const visible = computed(() => {
  if (!collapsible.value || expanded.value) return ordered.value;
  const firstRow = ordered.value.slice(0, columns.value);
  const pickedBeyond = ordered.value.slice(columns.value).filter((d) => isPicked(d.id));
  return [...firstRow, ...pickedBeyond];
});

const hiddenCount = computed(() => ordered.value.length - visible.value.length);

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

/*
 * 属性速览小卡片（浮层）：
 * - 电脑端右键（contextmenu + preventDefault）；手机端长按 500ms（移动 > 10px 取消）。
 * - 只读展示，绝不改选中状态；点别处 / Esc / 滚动（capture）都关闭；同时只开一个。
 * - 位置用 getBoundingClientRect 夹在弹窗（.modal-card）可视区内，放不下就向上 / 向左翻转。
 */
const popoverDisciple = ref<DiscipleView | null>(null);
const popoverEl = ref<HTMLElement | null>(null);
const popoverAnchorEl = ref<HTMLElement | null>(null);
const popoverPos = ref({ left: 0, top: 0 });

/** 长按期间置位：吞掉松手时那次 click，保证长按弹小卡片不会改变选中状态。 */
const suppressClick = ref(false);
let longPressTimer: number | undefined;
let pressOrigin: { x: number; y: number } | null = null;
const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_PX = 10;

/** 小卡片里的当前状态（与卡片状态栏同口径；重伤额外倒算剩余时间）。 */
const popoverStatus = computed(() => {
  const disciple = popoverDisciple.value;
  if (disciple === null) return '';
  const severe = severeInjuryStatusLabel(disciple, nowTick.value);
  if (severe !== null) return severe;
  if (isInjured(disciple, nowTick.value)) return '疗伤中';
  if (disciple.journey.status === 'active') return '在外历练';
  return '正常';
});

/**
 * 冒进冷却：本小时已出战 ≥3 次时，再等多久才能回到 2 次以内（不会冒进）。
 * 疲劳按滑动 60 分钟计：倒数第 3 次那条记录满一小时后，次数就降到 2。随 nowTick 每秒刷新。
 */
const FATIGUE_WINDOW_MS = 60 * 60 * 1000;
const popoverRushCooldown = computed<string | null>(() => {
  const disciple = popoverDisciple.value;
  const times = disciple === null ? undefined : props.fatigueTimes?.[disciple.id];
  if (times === undefined) return null;
  const live = times.filter((time) => time + FATIGUE_WINDOW_MS > nowTick.value);
  if (live.length < 3) return null;
  const seconds = Math.max(0, Math.ceil((live[live.length - 3]! + FATIGUE_WINDOW_MS - nowTick.value) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
});

/** 小卡片里的「本小时 n/3」（只在传了 fatigue 时展示）。 */
const popoverFatigueCount = computed(() => {
  const disciple = popoverDisciple.value;
  if (disciple === null) return 0;
  return props.fatigue?.[disciple.id] ?? 0;
});

/**
 * 小卡片里的五行属性（0028：`攻击 60 (+12)`；括号是装备加成，为 0 时不显示）。
 * 排序仍按基础属性（不因为装备改变候选顺序）。
 */
const popoverAttributes = computed<
  { key: 'attack' | 'defense' | 'speed' | 'luck' | 'physique'; label: string; value: number; bonus: number }[]
>(() => {
  const disciple = popoverDisciple.value;
  if (disciple === null) return [];
  return [
    { key: 'attack', label: '攻击', value: disciple.attack, bonus: disciple.gear.attack },
    { key: 'defense', label: '防御', value: disciple.defense, bonus: disciple.gear.defense },
    { key: 'speed', label: '身法', value: disciple.speed, bonus: disciple.gear.speed },
    { key: 'luck', label: '幸运', value: disciple.luck, bonus: disciple.gear.luck },
    { key: 'physique', label: '体魄', value: disciple.physique, bonus: disciple.gear.physique },
  ];
});

function cancelLongPress(): void {
  if (longPressTimer !== undefined) {
    window.clearTimeout(longPressTimer);
    longPressTimer = undefined;
  }
  pressOrigin = null;
}

/** 点在别处才关闭；点在锚点卡片（长按松手的那次 click）或浮层自身不算「别处」。 */
function onDocumentClick(event: MouseEvent): void {
  const target = event.target as Node | null;
  if (target === null) return;
  if (popoverEl.value?.contains(target) === true) return;
  if (popoverAnchorEl.value?.contains(target) === true) return;
  closePopover();
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') closePopover();
}

function closePopover(): void {
  if (popoverDisciple.value === null) return;
  popoverDisciple.value = null;
  popoverAnchorEl.value = null;
  window.removeEventListener('click', onDocumentClick, true);
  window.removeEventListener('keydown', onDocumentKeydown, true);
  window.removeEventListener('scroll', closePopover, true);
  window.removeEventListener('resize', closePopover, true);
}

/** 依据锚点卡片与弹窗可视区夹出小卡片位置（必要时向上 / 向左翻转）。 */
function positionPopover(): void {
  const el = popoverEl.value;
  const anchor = popoverAnchorEl.value;
  if (el === null || anchor === null) return;
  const box = el.getBoundingClientRect();
  const card = anchor.getBoundingClientRect();
  const hostRect = anchor.closest('.modal-card')?.getBoundingClientRect();
  const bounds = {
    left: hostRect?.left ?? 0,
    top: hostRect?.top ?? 0,
    right: hostRect?.right ?? window.innerWidth,
    bottom: hostRect?.bottom ?? window.innerHeight,
  };
  const margin = 8;

  let left = card.left;
  if (left + box.width > bounds.right - margin) left = card.right - box.width;
  if (left < bounds.left + margin) left = bounds.left + margin;

  let top = card.bottom + 6;
  if (top + box.height > bounds.bottom - margin) top = card.top - box.height - 6;
  if (top < bounds.top + margin) top = bounds.top + margin;

  popoverPos.value = { left, top };
}

function openPopover(disciple: DiscipleView, anchor: HTMLElement): void {
  // 重新打开时先摘掉上一轮的监听，避免叠加。
  window.removeEventListener('click', onDocumentClick, true);
  window.removeEventListener('keydown', onDocumentKeydown, true);
  window.removeEventListener('scroll', closePopover, true);
  window.removeEventListener('resize', closePopover, true);

  popoverDisciple.value = disciple;
  popoverAnchorEl.value = anchor;
  const rect = anchor.getBoundingClientRect();
  popoverPos.value = { left: rect.left, top: rect.bottom + 6 };

  window.addEventListener('click', onDocumentClick, true);
  window.addEventListener('keydown', onDocumentKeydown, true);
  window.addEventListener('scroll', closePopover, true);
  window.addEventListener('resize', closePopover, true);

  // 渲染后量一次实际尺寸再夹位置（nextTick 在首次绘制前跑完，不会闪一下）。
  void nextTick(positionPopover);
}

function onCardContextMenu(disciple: DiscipleView, event: MouseEvent): void {
  event.preventDefault();
  openPopover(disciple, event.currentTarget as HTMLElement);
}

function onCardPointerDown(disciple: DiscipleView, event: PointerEvent): void {
  suppressClick.value = false;
  if (event.pointerType === 'mouse') return; // 鼠标走右键，不长按
  cancelLongPress();
  pressOrigin = { x: event.clientX, y: event.clientY };
  const anchor = event.currentTarget as HTMLElement;
  longPressTimer = window.setTimeout(() => {
    longPressTimer = undefined;
    suppressClick.value = true;
    openPopover(disciple, anchor);
  }, LONG_PRESS_MS);
}

function onCardPointerMove(event: PointerEvent): void {
  if (longPressTimer === undefined || pressOrigin === null) return;
  const moved =
    Math.abs(event.clientX - pressOrigin.x) > LONG_PRESS_MOVE_PX ||
    Math.abs(event.clientY - pressOrigin.y) > LONG_PRESS_MOVE_PX;
  if (moved) cancelLongPress();
}

function onCardPointerEnd(): void {
  cancelLongPress();
}

function onCardClick(event: MouseEvent): void {
  if (!suppressClick.value) return;
  event.preventDefault();
  event.stopPropagation();
  suppressClick.value = false;
}

onUnmounted(() => {
  cancelLongPress();
  closePopover();
});
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
        v-for="option in sortOptions"
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

    <ul ref="gridEl" class="disciple-picker-grid">
      <li v-for="disciple in visible" :key="disciple.id">
        <label
          class="dp-card"
          :class="{
            'is-picked': isPicked(disciple.id),
            'is-blocked': blockedIds.has(disciple.id),
          }"
          :aria-disabled="disabled(disciple)"
          @click="onCardClick"
          @contextmenu="onCardContextMenu(disciple, $event)"
          @pointerdown="onCardPointerDown(disciple, $event)"
          @pointerup="onCardPointerEnd"
          @pointercancel="onCardPointerEnd"
          @pointermove="onCardPointerMove"
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
            <span
              v-else-if="fatigueById.has(disciple.id)"
              class="dp-fatigue"
              :class="{ 'is-danger': fatigueById.get(disciple.id)?.danger }"
            >
              {{ fatigueById.get(disciple.id)?.text }}
            </span>
            <span v-else class="dp-luck">幸运 {{ disciple.luck }}</span>
          </span>
        </label>
      </li>
    </ul>

    <button
      v-if="collapsible && (expanded || hiddenCount > 0)"
      class="dp-more"
      type="button"
      @click="expanded = !expanded"
    >
      {{ expanded ? '收起' : `查看更多（还有 ${hiddenCount} 名）` }}
    </button>

    <p v-if="disciples.length === 0" class="blocked-hint">{{ emptyText }}</p>
    <p v-else-if="blockedIds.size === disciples.length" class="blocked-hint">{{ allBlockedText }}</p>
    <p v-else-if="selected.length < min" class="blocked-hint">{{ countHint }}</p>
    <slot name="hint" />

    <!-- 属性速览小卡片（右键 / 长按触发，只读，不改变选中状态） -->
    <div
      v-if="popoverDisciple"
      ref="popoverEl"
      class="dp-popover"
      role="dialog"
      aria-label="弟子属性速览"
      :style="{ left: `${popoverPos.left}px`, top: `${popoverPos.top}px` }"
    >
      <p class="dp-popover-name">{{ popoverDisciple.name }}</p>
      <p class="dp-popover-line">
        境界：{{ popoverDisciple.realmName }} · {{ popoverDisciple.stageName }}
      </p>
      <p class="dp-popover-line">天赋：{{ popoverDisciple.talentName }}</p>
      <p class="dp-popover-line">战力：{{ popoverDisciple.combatPower }}</p>
      <ul class="dp-popover-attrs">
        <!-- 0028：五行属性带上装备加成 `攻击 60 (+12)`（为 0 时不显示括号）。 -->
        <li v-for="attribute in popoverAttributes" :key="attribute.key">
          {{ attribute.label }} {{ attribute.value }}
          <span v-if="attribute.bonus > 0" class="gear-bonus">(+{{ attribute.bonus }})</span>
        </li>
        <li>资质 {{ popoverDisciple.aptitude }}</li>
      </ul>
      <p class="dp-popover-line">状态：{{ popoverStatus }}</p>
      <p v-if="fatigue !== undefined" class="dp-popover-line">
        本小时 {{ popoverFatigueCount }}/3
      </p>
      <p v-if="fatigueTimes !== undefined" class="dp-popover-line" :class="{ 'is-danger': popoverRushCooldown !== null }">
        {{ popoverRushCooldown === null ? '可安全出战' : `冒进冷却 ${popoverRushCooldown}` }}
      </p>
    </div>
  </div>
</template>

<style scoped>
/* 卡片状态栏的疲劳标：普通档（本小时 n/3）沿用回退色，风险档（冒进 / 必重伤）用红。 */
.dp-fatigue {
  color: #7d9186;
  font-size: 10px;
  line-height: 15px;
}

.dp-fatigue.is-danger {
  color: var(--red-bright);
}

/* 长按弹属性速览：禁掉长按选中文本 / 系统菜单，避免和 500ms 长按打架。 */
.disciple-picker .dp-card {
  user-select: none;
  -webkit-touch-callout: none;
}

/* 属性速览小卡片：fixed 定位（视口坐标，left/top 由 positionPopover 夹好）。 */
.dp-popover {
  position: fixed;
  z-index: 1000;
  min-width: 150px;
  max-width: 240px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 4px;
  color: #b9c8bf;
  background: rgba(8, 24, 20, 0.98);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
  font-size: 11px;
  line-height: 1.5;
  text-align: left;
  white-space: nowrap;
}

.dp-popover-name {
  margin: 0 0 3px;
  color: var(--gold-bright);
  font-family: 'STKaiti', 'KaiTi', serif;
  font-size: 13px;
}

.dp-popover-line {
  margin: 0;
  color: #93a99e;
}

.dp-popover-line.is-danger {
  color: #e8664e;
}

.dp-popover-attrs {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0 10px;
  margin: 4px 0;
  padding: 4px 0;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  list-style: none;
  color: #c8d6cd;
}

.dp-popover-attrs li {
  white-space: nowrap;
}
</style>
