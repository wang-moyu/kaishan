<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';

import type { AssignmentOptionView, DiscipleView } from '../api/game';
import type {
  CultivationProgress,
  CultivationProgressTier,
  DiscipleFilter,
  DiscipleSortKey,
  DiscipleStatus,
  DiscipleStatusFilter,
} from '../utils/discipleFilter';
import {
  CULTIVATION_PROGRESS_FILTERS,
  DEFAULT_DISCIPLE_FILTER,
  DISCIPLE_SORT_OPTIONS,
  DISCIPLE_STATUS_FILTERS,
  breakthroughEligible,
  cultivationProgress,
  discipleStatus,
  filterDisciples,
  isFilterActive,
  journeyBadge,
  realmOptions,
  stageOptions,
} from '../utils/discipleFilter';
import DiscipleAvatar from './DiscipleAvatar.vue';

/**
 * 门人名册：境界 / 阶段 / 岗位 / 状态 / 修为进度筛选 + 排序 + 精简列表行 +
 * 头像快捷破境入口 + 「详情」入口。
 *
 * 所有筛选、排序、状态派生都在 `utils/discipleFilter.ts` 的纯函数里，本组件只持有筛选状态。
 * 列表行的行序固定为：① 头像 + 修为环 ② 姓名 + 境界阶段 ③ 当前状态
 * ④ 战力 + 综合评分 ⑤ 私有备注 ⑥ 头像破境入口或「详情」。
 * 修为数字不再常显：进度只看环长，具体数值在进度环 focus / hover 的气泡与读屏文案里。
 * 备注为空时这一行照样占位（只把文字换成占位符），卡片总高不随备注有无变化。
 * ③④ 两行各有最小高度，窄屏折行时只会把该行变高，不会遮住相邻行。
 * ③④ 两行各有最小高度，窄屏折行时只会把该行变高，不会遮住相邻行。
 *
 * 本地每秒平滑的修为只用于显示（进度环与数字），能不能破境一律看服务端状态：
 * 头像只有在 `requiredCultivation !== null && cultivation >= requiredCultivation` 时才是按钮，
 * 点了只开确认弹窗，真正的请求由上层在玩家确认后才发出。
 */
const props = defineProps<{
  disciples: DiscipleView[];
  assignments: AssignmentOptionView[];
  /** `Date.parse(state.serverNow)`，用于「疗伤中」判定。 */
  serverNowMs: number;
  /** 每秒本地推进的修为（只用于显示，不参与判定）。 */
  liveCultivation: Record<string, number>;
  busy: boolean;
  /** 详情弹窗正在看的弟子 id（null = 未打开）：关闭后把焦点还回对应「详情」按钮。 */
  detailId: string | null;
  /** 破境确认弹窗对应的弟子 id（null = 未打开）：关闭后把焦点还回头像按钮。 */
  breakthroughConfirmId: string | null;
}>();

const emit = defineEmits<{
  openDetail: [discipleId: string];
  /** 点击可破境的头像：只请求打开确认弹窗，不直接破境。 */
  requestBreakthrough: [discipleId: string];
}>();

function loadSavedFilter(): DiscipleFilter {
  try {
    const raw = localStorage.getItem('disciple-filter');
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DiscipleFilter>;
      return { ...DEFAULT_DISCIPLE_FILTER, ...parsed };
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_DISCIPLE_FILTER };
}

const filter = ref<DiscipleFilter>(loadSavedFilter());
const showMoreFilters = ref(false);
const activeMoreCount = computed(() =>
  Number(filter.value.stage !== null) +
  Number(filter.value.assignment !== '') +
  Number(filter.value.progress !== 'all'),
);

/**
 * 行内状态标签：历练状态优先（在外 / 待领取），其次疗伤，最后当前岗位。
 * key 直接进 `status-*` / `is-*` 类名，所以历练用 `journey` / `journey-ready` 两个新类。
 */
interface RosterStatus {
  key: string;
  label: string;
}

interface RosterRow {
  disciple: DiscipleView;
  status: DiscipleStatus;
  displayStatus: RosterStatus;
  /** 行上的历练类名（'' / is-journey / is-journey-ready）。 */
  journeyClass: string;
  /** 待领取：行与「详情」按钮上都要有可见入口。 */
  journeyReady: boolean;
  progress: CultivationProgress;
  /** 服务端修为已到门槛且非版本上限：头像此时才是可聚焦的破境入口。 */
  breakthroughEligible: boolean;
}

const realmFilters = computed(() => realmOptions(props.disciples));

/** 阶段筛选项：从完整名单派生，只在选了境界时有内容（从属筛选）。 */
const stageFilters = computed(() => stageOptions(props.disciples, filter.value.realmId));
const stageFilterEnabled = computed(() => filter.value.realmId !== '');

const matched = computed(() => filterDisciples(props.disciples, filter.value, props.serverNowMs));

const rows = computed<RosterRow[]>(() =>
  matched.value.map((disciple) => {
    const status = discipleStatus(disciple, props.serverNowMs);
    const badge = journeyBadge(disciple.journey, props.serverNowMs);
    const journeyReady = disciple.journey.status === 'ready';
    // 卡片只显示当前状态：疗伤优先，其余统一显示当前岗位。
    // 可破境由满环与头像按钮表达，不再重复占用状态标签。
    const rosterStatus: RosterStatus =
      status.key === 'injured' ? status : { key: 'assignment', label: disciple.assignmentName };
    return {
      disciple,
      status,
      // 历练标记优先于岗位名：在外/待领取的弟子不该看起来像在正常当值。
      displayStatus:
        badge === null
          ? rosterStatus
          : { key: journeyReady ? 'journey-ready' : 'journey', label: badge },
      journeyClass: badge === null ? '' : journeyReady ? 'is-journey-ready' : 'is-journey',
      journeyReady,
      progress: cultivationProgress(
        props.liveCultivation[disciple.id] ?? disciple.cultivation,
        disciple.requiredCultivation,
      ),
      // 判定只看服务端字段：本地动画值与取整百分比都不参与。
      breakthroughEligible: breakthroughEligible(disciple),
    };
  }),
);

const anyFilterActive = computed(() => isFilterActive(filter.value));

watch(filter, (v) => {
  try { localStorage.setItem('disciple-filter', JSON.stringify(v)); } catch { /* ignore */ }
}, { deep: true });

function resetFilter(): void {
  filter.value = { ...DEFAULT_DISCIPLE_FILTER };
  showMoreFilters.value = false;
}

/** 换境界时清掉阶段：阶段是从属筛选，不能留下一个看不见的隐藏条件。 */
function onRealmChange(event: Event): void {
  filter.value = { ...filter.value, realmId: (event.target as HTMLSelectElement).value, stage: null };
}

function onStageChange(event: Event): void {
  const raw = (event.target as HTMLSelectElement).value;
  filter.value = { ...filter.value, stage: raw === '' ? null : Number(raw) };
}

function onAssignmentChange(event: Event): void {
  filter.value = { ...filter.value, assignment: (event.target as HTMLSelectElement).value };
}

function onStatusChange(event: Event): void {
  filter.value = {
    ...filter.value,
    status: (event.target as HTMLSelectElement).value as DiscipleStatusFilter,
  };
}

function onProgressChange(event: Event): void {
  filter.value = {
    ...filter.value,
    progress: (event.target as HTMLSelectElement).value as CultivationProgressTier,
  };
}

function onSortChange(event: Event): void {
  filter.value = {
    ...filter.value,
    sort: (event.target as HTMLSelectElement).value as DiscipleSortKey,
  };
}

const stageValue = computed(() => (filter.value.stage === null ? '' : String(filter.value.stage)));

function ringClass(row: RosterRow): string {
  if (row.disciple.canBreakthrough) return 'is-ready';
  if (row.progress.capped) return 'is-capped';
  return row.progress.full ? 'is-full' : 'is-normal';
}

function ringStyle(row: RosterRow): Record<string, string> {
  return { '--progress-angle': `${row.progress.percent * 3.6}deg` };
}

function ringValueText(row: RosterRow): string {
  return row.progress.capped
    ? `${row.progress.percent}%，已达当前版本上限`
    : `${row.progress.percent}%，修为 ${row.progress.text}`;
}

function ringTooltip(row: RosterRow): string {
  return row.progress.capped ? '已达当前版本上限' : `修为 ${row.progress.text}`;
}

/**
 * 头像按钮的可读名称：用服务端修为（不是本地动画值）说明为什么这里可以点，
 * 并明确这是「查看确认」而不是「立即破境」。
 */
function breakthroughLabel(row: RosterRow): string {
  return `破境确认 · ${row.disciple.name} 修为 ${Math.floor(row.disciple.cultivation)}/${row.disciple.requiredCultivation}，查看胜算与消耗`;
}

function rowIndexStyle(index: number): Record<string, string> {
  // 入场错峰：只给前若干行延迟，避免长列表末尾等太久。
  return { '--row-order': String(Math.min(index, 8)) };
}

/** 「详情」按钮引用：弹窗关闭后把焦点还回触发它的那一行。 */
const rowButtons = ref<Record<string, HTMLButtonElement | null>>({});
/** 头像（破境入口）按钮引用：确认弹窗关闭后把焦点还回头像。 */
const avatarButtons = ref<Record<string, HTMLButtonElement | null>>({});
const realmSelect = ref<HTMLSelectElement | null>(null);

function setRowButton(discipleId: string, element: Element | null): void {
  if (element instanceof HTMLButtonElement) {
    rowButtons.value[discipleId] = element;
  } else {
    delete rowButtons.value[discipleId];
  }
}

function setAvatarButton(discipleId: string, element: Element | null): void {
  if (element instanceof HTMLButtonElement) {
    avatarButtons.value[discipleId] = element;
  } else {
    delete avatarButtons.value[discipleId];
  }
}

watch(
  () => props.detailId,
  (next, previous) => {
    if (previous === null || previous === undefined || next !== null) return;
    void nextTick(() => {
      const button = rowButtons.value[previous];
      // 驱逐后该行已不存在；焦点退回始终存在的境界筛选框。
      if (button && document.contains(button)) button.focus();
      else realmSelect.value?.focus();
    });
  },
);

watch(
  () => props.breakthroughConfirmId,
  (next, previous) => {
    if (previous === null || previous === undefined || next !== null) return;
    void nextTick(() => {
      const button = avatarButtons.value[previous];
      // 修为/资格变化后头像可能不再是按钮（例如被派出去历练）；此时退回境界筛选框。
      if (button && document.contains(button)) button.focus();
      else realmSelect.value?.focus();
    });
  },
);
</script>

<template>
  <div class="disciple-roster">
    <div class="disciple-toolbar">
      <div class="disciple-toolbar-main">
        <label class="disciple-field">
          <span class="disciple-field-label">境界</span>
          <span class="disciple-select">
            <select ref="realmSelect" class="disciple-input" :value="filter.realmId" @change="onRealmChange">
              <option value="">全部境界</option>
              <option v-for="realm in realmFilters" :key="realm.realmId" :value="realm.realmId">
                {{ realm.realmName }}
              </option>
            </select>
          </span>
        </label>

        <label class="disciple-field">
          <span class="disciple-field-label">状态</span>
          <span class="disciple-select">
            <select class="disciple-input" :value="filter.status" @change="onStatusChange">
              <option v-for="option in DISCIPLE_STATUS_FILTERS" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </span>
        </label>

        <label class="disciple-field disciple-field-sort">
          <span class="disciple-field-label">排序</span>
          <span class="disciple-select">
            <select class="disciple-input" :value="filter.sort" @change="onSortChange">
              <option v-for="option in DISCIPLE_SORT_OPTIONS" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </span>
        </label>

        <button
          class="quiet-button disciple-more"
          :class="{ 'is-active': activeMoreCount > 0 || showMoreFilters }"
          type="button"
          aria-controls="disciple-extra-filters"
          :aria-expanded="showMoreFilters"
          @click="showMoreFilters = !showMoreFilters"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16l-6.5 7v5l-3 1v-6L4 6Z" /></svg>
          <span>更多筛选</span>
          <span v-if="activeMoreCount > 0" class="disciple-more-count">{{ activeMoreCount }}</span>
        </button>
        <button class="quiet-button disciple-reset" type="button" :disabled="!anyFilterActive" @click="resetFilter">
          重置
        </button>
      </div>

      <div id="disciple-extra-filters" v-show="showMoreFilters" class="disciple-toolbar-extra">
        <!-- 阶段依附境界；换境界时阶段选择会清空。 -->
        <label class="disciple-field">
          <span class="disciple-field-label">阶段</span>
          <span class="disciple-select">
            <select class="disciple-input" :value="stageValue" :disabled="!stageFilterEnabled" @change="onStageChange">
              <option value="">{{ stageFilterEnabled ? '全部阶段' : '先选境界' }}</option>
              <option v-for="option in stageFilters" :key="option.stage" :value="String(option.stage)">
                {{ option.stageName }}
              </option>
            </select>
          </span>
        </label>

        <label class="disciple-field">
          <span class="disciple-field-label">岗位</span>
          <span class="disciple-select">
            <select class="disciple-input" :value="filter.assignment" @change="onAssignmentChange">
              <option value="">全部岗位</option>
              <option v-for="option in assignments" :key="option.id" :value="option.id">
                {{ option.name }}
              </option>
            </select>
          </span>
        </label>

        <label class="disciple-field">
          <span class="disciple-field-label">修为进度</span>
          <span class="disciple-select">
            <select class="disciple-input" :value="filter.progress" @change="onProgressChange">
              <option v-for="option in CULTIVATION_PROGRESS_FILTERS" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </span>
        </label>
      </div>
    </div>

    <p class="disciple-count" role="status" aria-live="polite">
      匹配 <strong>{{ rows.length }}</strong> / 共 <strong>{{ disciples.length }}</strong> 位门人
    </p>

    <ul v-if="rows.length > 0" class="disciple-list">
      <li
        v-for="(row, index) in rows"
        :key="row.disciple.id"
        class="disciple-row"
        :class="[`status-${row.displayStatus.key}`, row.journeyClass]"
        :style="rowIndexStyle(index)"
      >
        <div class="disciple-row-media">
          <!--
            可破境：头像本身是按钮（点开确认弹窗，不发请求）。
            按钮内部不再嵌可聚焦的进度条，进度用 aria-label 表达（具体数值在进度环的气泡里）。
          -->
          <button
            v-if="row.breakthroughEligible"
            :ref="(element) => setAvatarButton(row.disciple.id, element as Element | null)"
            class="disciple-ring disciple-ring-button"
            :class="ringClass(row)"
            :style="ringStyle(row)"
            :data-progress="ringTooltip(row)"
            type="button"
            :disabled="busy"
            :aria-label="breakthroughLabel(row)"
            @click="emit('requestBreakthrough', row.disciple.id)"
          >
            <DiscipleAvatar
              :name="row.disciple.name"
              :gender="row.disciple.gender"
              :realm-id="row.disciple.realmId"
              :frame-id="row.disciple.avatarFrameId"
            />
          </button>

          <!-- 未满修为：头像保持纯展示（不是假按钮），进度条仍可聚焦并被读屏念出。 -->
          <div
            v-else
            class="disciple-ring"
            :class="ringClass(row)"
            :style="ringStyle(row)"
            :data-progress="ringTooltip(row)"
            tabindex="0"
            role="progressbar"
            :aria-label="`${row.disciple.name}修为进度`"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-valuenow="row.progress.percent"
            :aria-valuetext="ringValueText(row)"
          >
            <DiscipleAvatar
              :name="row.disciple.name"
              :gender="row.disciple.gender"
              :realm-id="row.disciple.realmId"
              :frame-id="row.disciple.avatarFrameId"
            />
          </div>
        </div>

        <div class="disciple-row-info">
          <!-- 姓名与境界阶段合并到同一行；修为数字不再常显，进度只看环长。 -->
          <p class="disciple-row-head">
            <strong class="disciple-row-name" :title="row.disciple.name">{{ row.disciple.name }}</strong>
            <span class="realm-tag">{{ row.disciple.stageName }}</span>
          </p>
        </div>

        <!-- 状态单独占一行：不再和境界标签挤在同一行里抢宽度。
             历练标记（在外 / 待领取）也在这里，玩家一眼能看出这名弟子不在宗门正常当值。 -->
        <div class="disciple-card-status">
          <span class="disciple-status" :class="`is-${row.displayStatus.key}`">
            {{ row.displayStatus.label }}
          </span>
        </div>

        <div class="disciple-card-meta">
          <span class="disciple-row-power">战力 {{ row.disciple.combatPower }}</span>
          <span class="disciple-row-score">综合评分 {{ row.disciple.attributeScore.toFixed(1) }}</span>
        </div>

        <!-- 备注为空也保留这一行：占位符顶住行高，卡片总高不随备注有无变化。 -->
        <p
          class="disciple-row-note"
          :class="{ 'is-empty': row.disciple.note === '' }"
          :title="row.disciple.note || undefined"
          :aria-hidden="row.disciple.note === ''"
        >
          {{ row.disciple.note || '—' }}
        </p>

        <!-- 待领取时按钮上再挂一个「待领取」标记：玩家知道点这里去领历练收获。 -->
        <button
          :ref="(element) => setRowButton(row.disciple.id, element as Element | null)"
          class="disciple-detail-button"
          :class="{ 'is-journey-ready': row.journeyReady }"
          type="button"
          :aria-label="
            row.journeyReady ? `查看 ${row.disciple.name} 的详情并领取历练收获` : `查看 ${row.disciple.name} 的详情`
          "
          @click="emit('openDetail', row.disciple.id)"
        >
          <span>详情</span>
          <span v-if="row.journeyReady" class="journey-ready-marker">待领取</span>
        </button>
      </li>
    </ul>

    <div v-else-if="disciples.length === 0" class="empty-state">
      <span aria-hidden="true">寂</span>
      <strong>门下尚无弟子</strong>
      <p>可从上方操作栏的「招贤台」张榜迎接有缘之人。</p>
    </div>

    <div v-else class="empty-state compact-empty disciple-empty-filter">
      <span aria-hidden="true">寻</span>
      <strong>没有符合条件的门人</strong>
      <p>当前筛选条件下没有结果，可放宽条件或直接重置。</p>
      <button class="quiet-button" type="button" @click="resetFilter">重置筛选</button>
    </div>
  </div>
</template>
