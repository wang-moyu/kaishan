/**
 * 弟子名册的筛选 / 排序 / 状态派生（纯函数，不碰 DOM、不依赖 Vue）。
 *
 * 为什么这里不直接 import `DiscipleView`：本文件会被根级 node 测试直接 import
 * （根 `tsconfig.json` 的 lib 只有 ES2022，没有 DOM），而 `../api/game` 会连带把使用
 * DOM 类型的 `../api/client` 拉进程序并报错。所以这里只声明「筛选所需字段」的最小结构，
 * 调用方传入完整的 `DiscipleView` 依然结构兼容（多余字段不影响）。
 *
 * 所有判定都用服务端给的字段：
 * - 疗伤：`injuredUntil > serverNow`（serverNow 由调用方传 `Date.parse(state.serverNow)`）；
 * - 可破境：只看 `canBreakthrough`，前端不复制破境公式，也不因本地动画满环而放行；
 * - 境界高低：先比 `realmOrder` 再比 `stage`，绝不按境界名字符串排序。
 */

/** 筛选所需的弟子字段子集（对应 `DiscipleView` 的一个子集）。 */
export interface FilterableDisciple {
  id: string;
  name: string;
  realmId: string;
  realmName: string;
  /** 境界在服务端境界表里的下标（0 = 最低）。 */
  realmOrder: number;
  /** 境界内的阶段序号。 */
  stage: number;
  /** 境界内的阶段名（如「炼气三层」）；阶段筛选用它做标签。 */
  stageName: string;
  assignment: string;
  assignmentName: string;
  cultivation: number;
  /** null = 已达当前版本上限。 */
  requiredCultivation: number | null;
  /** 静修每小时修为产出（修炼速度排序用）。 */
  cultivationRatePerHour: number;
  combatPower: number;
  /**
   * 0016 综合评分：服务端按**当前**六项属性等权现算（一位小数，见 names.ts 的 attributeScore）。
   * 前端只显示与排序，不另算权威值；战力 / 境界 / 天赋都不参与这个分数。
   */
  attributeScore: number;
  /** null = 未受伤。 */
  injuredUntil: string | null;
  canBreakthrough: boolean;
}

/** 服务端 `IDLE_ASSIGNMENT`（见 packages/game-core/src/config/schema.ts 的岗位枚举）。 */
export const IDLE_ASSIGNMENT_ID = 'idle';

/** 备注上限（与服务端 0013 迁移的 CHECK 一致）。 */
export const NOTE_MAX_LENGTH = 60;

/**
 * 状态展示优先级：疗伤中 > 可破境 > 已达当前版本上限 > 修为已满但暂不可破境 > 当前岗位名。
 * 列表行只显示这条优先级最高的一条，岗位名在其余情况下另以标签显示，不会消失。
 */
export type DiscipleStatusKey =
  | 'injured'
  | 'canBreakthrough'
  | 'capped'
  | 'cultivationFull'
  | 'assignment';

export interface DiscipleStatus {
  key: DiscipleStatusKey;
  label: string;
}

export type DiscipleStatusFilter = 'all' | 'canBreakthrough' | 'injured' | 'cultivationFull' | 'idle';

export type DiscipleSortKey =
  | 'recruitOrder'
  | 'combatPower'
  | 'attributeScore'
  | 'combatPowerAsc'
  | 'realm'
  | 'realmAsc'
  | 'cultivationProgressDesc'
  | 'cultivationProgressAsc'
  | 'cultivationRateDesc'
  | 'cultivationRateAsc';

export interface DiscipleFilter {
  /** 境界 id（空串 = 全部境界）。 */
  realmId: string;
  /** 境界内的阶段序号（null = 不限）；只在选了境界时生效，换境界会清空。 */
  stage: number | null;
  /** 岗位 id（空串 = 全部岗位）。 */
  assignment: string;
  status: DiscipleStatusFilter;
  /** 修为进度分档（按服务端原始比例判定，见 cultivationTier）。 */
  progress: CultivationProgressTier;
  sort: DiscipleSortKey;
}

export const DEFAULT_DISCIPLE_FILTER: DiscipleFilter = {
  realmId: '',
  stage: null,
  assignment: '',
  status: 'all',
  progress: 'all',
  sort: 'recruitOrder',
};

export const DISCIPLE_STATUS_FILTERS: readonly { value: DiscipleStatusFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'canBreakthrough', label: '可破境' },
  { value: 'injured', label: '疗伤' },
  { value: 'cultivationFull', label: '修为已满' },
  { value: 'idle', label: '闲置' },
];

/**
 * 修为进度分档（名册筛选用）。
 *
 * 分档一律按服务端 `cultivation / requiredCultivation` 的**原始比例**判定：
 * 99.6% 仍属于「75–不足 100%」，不能用显示用的整数百分比或本地平滑值替代。
 * `fullBlocked` / `breakthrough` / `capped` 三档互斥（版本上限不算「已满但不可破」）；
 * 「75–不足 100%」按 `cultivation < requiredCultivation` 与原始比例排除满修为者，
 * 所以同一名弟子不会同时落进两档。
 */
export type CultivationProgressTier =
  | 'all'
  | 'lt25'
  | 'gte25lt50'
  | 'gte50lt75'
  | 'gte75lt100'
  | 'fullBlocked'
  | 'breakthrough'
  | 'capped';

/**
 * 进度分档筛选项。文案故意与「状态」筛选里的「可破境」区分开（这里写「已满 · 可破境」），
 * 两个筛选同时使用时玩家不会误以为是同一件事。
 */
export const CULTIVATION_PROGRESS_FILTERS: readonly {
  value: CultivationProgressTier;
  label: string;
}[] = [
  { value: 'all', label: '全部进度' },
  { value: 'lt25', label: '0–不足 25%' },
  { value: 'gte25lt50', label: '25–不足 50%' },
  { value: 'gte50lt75', label: '50–不足 75%' },
  { value: 'gte75lt100', label: '75–不足 100%' },
  { value: 'fullBlocked', label: '已满 · 不可破境' },
  { value: 'breakthrough', label: '已满 · 可破境' },
  { value: 'capped', label: '已达版本上限' },
];

/**
 * 排序选项：默认（招募顺序）排在最前。
 *
 * 前四项保持 0016 的键与文案（`combatPower` = 战力高低、`attributeScore` = 综合评分高低、
 * `realm` = 境界高低）——`tests/web/disciple-filter.test.ts` 对它们的顺序与标签有断言；
 * 本轮新增的排序项排在后面，并在标签里写清方向，避免「高低」与「低高」两种写法混用造成误读。
 */
export const DISCIPLE_SORT_OPTIONS: readonly { value: DiscipleSortKey; label: string }[] = [
  { value: 'recruitOrder', label: '招募顺序' },
  { value: 'combatPower', label: '战力高低' },
  { value: 'attributeScore', label: '综合评分高低' },
  { value: 'realm', label: '境界高低' },
  { value: 'realmAsc', label: '境界（低→高）' },
  { value: 'combatPowerAsc', label: '战力（低→高）' },
  { value: 'cultivationProgressDesc', label: '修为进度（高→低）' },
  { value: 'cultivationProgressAsc', label: '修为进度（低→高）' },
  { value: 'cultivationRateDesc', label: '修炼速度（高→低）' },
  { value: 'cultivationRateAsc', label: '修炼速度（低→高）' },
];

/** 疗伤中：`injuredUntil > serverNow`（时间戳非法或 serverNow 缺失时不算受伤）。 */
export function isInjured(disciple: FilterableDisciple, serverNowMs: number): boolean {
  if (disciple.injuredUntil === null) return false;
  const until = Date.parse(disciple.injuredUntil);
  if (!Number.isFinite(until) || !Number.isFinite(serverNowMs)) return false;
  return until > serverNowMs;
}


/** 选人控件需要的字段子集：比 FilterableDisciple 多一个历练状态（判断是否在外）。 */
export interface SelectableDisciple extends FilterableDisciple {
  journey: { status: 'none' | 'active' | 'ready' };
}

/** 选人控件的禁用开关（默认全禁；守擂阵容允许带伤守阵）。 */
export interface SelectionBlockOptions {
  /** 受伤弟子是否禁选。 */
  blockInjured: boolean;
  /** 在外历练的弟子是否禁选（服务端 requireNotAway 会拒绝这些操作）。 */
  blockAway: boolean;
}

/**
 * 选人控件里「这名弟子为什么不能选」（null = 可选）。
 *
 * 与服务端同一口径：疗伤 = `injuredUntil > serverNow`；在外 = `journey.status === 'active'`
 * （`ready` 是「已归队待领取」，服务端也放行）。挑战 / 守擂 / 秘境 / 赌坊四处共用这一份判定，
 * 免得再出现「前端能选、提交被服务端打回」。
 */
export function selectionBlockReason(
  disciple: SelectableDisciple,
  serverNowMs: number,
  options: SelectionBlockOptions,
): string | null {
  if (options.blockInjured && isInjured(disciple, serverNowMs)) return '疗伤中';
  if (options.blockAway && disciple.journey.status === 'active') return '在外历练';
  return null;
}
/**
 * 修为是否已无增长空间：null 门槛（已达当前版本上限）或已到门槛。
 * 注意：这不代表可破境——可破境只看 `canBreakthrough`。
 */
export function hasFullCultivation(disciple: FilterableDisciple): boolean {
  return (
    disciple.requiredCultivation === null || disciple.cultivation >= disciple.requiredCultivation
  );
}

/**
 * 修为进度的原始比例（0~1，不取整）。
 * - `requiredCultivation === null`（已达当前版本上限）视为 1；
 * - 门槛非法（非有限数或 ≤ 0）时按「有修为即算满、否则为 0」兜底，绝不产生 NaN 排序。
 */
export function cultivationRatio(disciple: FilterableDisciple): number {
  const required = disciple.requiredCultivation;
  if (required === null) return 1;
  if (!Number.isFinite(required) || required <= 0) {
    return Number.isFinite(disciple.cultivation) && disciple.cultivation > 0 ? 1 : 0;
  }
  const ratio = disciple.cultivation / required;
  if (!Number.isFinite(ratio)) return 0;
  return Math.min(1, Math.max(0, ratio));
}

/**
 * 当前所处的进度档。判定只看服务端字段（`cultivation` / `requiredCultivation` / `canBreakthrough`），
 * 不看本地动画值，也不看四舍五入后的整数百分比。
 */
export function cultivationTier(disciple: FilterableDisciple): CultivationProgressTier {
  if (disciple.canBreakthrough) return 'breakthrough';
  const required = disciple.requiredCultivation;
  if (required === null) return 'capped';
  if (disciple.cultivation >= required) return 'fullBlocked';
  const ratio = cultivationRatio(disciple);
  if (ratio < 0.25) return 'lt25';
  if (ratio < 0.5) return 'gte25lt50';
  if (ratio < 0.75) return 'gte50lt75';
  return 'gte75lt100';
}

/** 进度分档筛选（`all` 表示不限）。 */
export function matchesProgressFilter(
  disciple: FilterableDisciple,
  tier: CultivationProgressTier,
): boolean {
  if (tier === 'all') return true;
  return cultivationTier(disciple) === tier;
}

/**
 * 名册头像能否作为「破境确认」入口：服务端修为已达到当前门槛，且不是版本上限。
 *
 * 刻意不看 `canBreakthrough`——满修为但暂时被挡住时，玩家仍要能点开看清楚原因；
 * 也刻意不看本地动画值与取整百分比：能不能破只以服务端状态为准。
 */
export function breakthroughEligible(disciple: FilterableDisciple): boolean {
  return disciple.requiredCultivation !== null && disciple.cultivation >= disciple.requiredCultivation;
}

function formatCultivation(value: number): string {
  return String(Math.floor(value));
}

/** 列表行要显示的那一条状态（按优先级取最高的一条）。 */
export function discipleStatus(disciple: FilterableDisciple, serverNowMs: number): DiscipleStatus {
  if (isInjured(disciple, serverNowMs)) return { key: 'injured', label: '疗伤中' };
  if (disciple.canBreakthrough) return { key: 'canBreakthrough', label: '可破境' };
  if (disciple.requiredCultivation === null) return { key: 'capped', label: '已达当前版本上限' };
  if (disciple.cultivation >= disciple.requiredCultivation) {
    return { key: 'cultivationFull', label: '修为已满' };
  }
  return { key: 'assignment', label: disciple.assignmentName };
}

/** 历练状态里名册需要的最小结构（`DiscipleView.journey` 的一个子集）。 */
export interface JourneyBadge {
  status: 'none' | 'active' | 'ready';
  directionName: string | null;
  endsAt: string | null;
}

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/**
 * 名册行上的历练标记：在外显示「方向 · 剩余时间」；已归队待领取显示「已归队 · 待领取」；其余为 null。
 *
 * 剩余时间只按调用方给的 `serverNowMs`（服务端时间基准）估算，不读本机时钟；
 * 这里只做展示，不判定可否领取（可否领取只看服务端给的 `status`，前端计时器不能自行发奖）。
 */
export function journeyBadge(journey: JourneyBadge | undefined, serverNowMs: number): string | null {
  if (journey === undefined) return null;
  if (journey.status === 'ready') return '已归队 · 待领取';
  if (journey.status !== 'active') return null;

  // endsAt 缺失/非法时没有剩余时间可算，只显示方向名。
  const direction = journey.directionName ?? '历练中';
  if (journey.endsAt === null) return direction;
  const endsAtMs = Date.parse(journey.endsAt);
  if (!Number.isFinite(endsAtMs) || !Number.isFinite(serverNowMs)) return direction;

  const remainingMs = endsAtMs - serverNowMs;
  if (remainingMs >= HOUR_MS) {
    return `${journey.directionName ?? '历练'} · 约 ${Math.ceil(remainingMs / HOUR_MS)} 小时后归队`;
  }
  return `${journey.directionName ?? '历练'} · 约 ${Math.max(1, Math.ceil(remainingMs / MINUTE_MS))} 分钟后归队`;
}

export interface CultivationProgress {
  /** 0~100 的整数百分比（进度环用）。 */
  percent: number;
  /** 可读数字，如 `90/180`；到达版本上限时为 `已达当前版本上限`。 */
  text: string;
  /** requiredCultivation === null：满环只代表本版本练到头，不代表可破境。 */
  capped: boolean;
  /** 已到门槛（此时未必可破境）。 */
  full: boolean;
}

/** 进度 = cultivation / requiredCultivation，clamp 到 0%~100%，并给出可读数字。 */
export function cultivationProgress(
  cultivation: number,
  requiredCultivation: number | null,
): CultivationProgress {
  if (requiredCultivation === null) {
    return { percent: 100, text: '已达当前版本上限', capped: true, full: false };
  }
  if (requiredCultivation <= 0) {
    return {
      percent: 100,
      text: `${formatCultivation(cultivation)}/${requiredCultivation}`,
      capped: false,
      full: cultivation >= requiredCultivation,
    };
  }
  const raw = (cultivation / requiredCultivation) * 100;
  const percent = Math.min(100, Math.max(0, Math.round(raw)));
  return {
    percent,
    text: `${formatCultivation(cultivation)}/${requiredCultivation}`,
    capped: false,
    full: cultivation >= requiredCultivation,
  };
}

/**
 * 状态筛选：全部 / 可破境 / 疗伤 / 修为已满（含已达当前版本上限）/ 闲置。
 *
 * 「修为已满」刻意排除 `canBreakthrough`：可破境是独立筛选项，且此时行内标签显示「可破境」，
 * 若同时落进「修为已满」会让筛选结果与看到的标签互相矛盾（规格 2.1 的状态语义）。
 * 已达当前版本上限（requiredCultivation === null）同样没有成长空间，一并归入「修为已满」。
 * 疗伤中的弟子仍会命中（规格 2.1 把「疗伤/灵气不足」视为修为满但不可操作的原因之一），
 * 需要只看伤势时用「疗伤」筛选。
 */
export function matchesStatusFilter(
  disciple: FilterableDisciple,
  status: DiscipleStatusFilter,
  serverNowMs: number,
): boolean {
  if (status === 'all') return true;
  if (status === 'canBreakthrough') return disciple.canBreakthrough;
  if (status === 'injured') return isInjured(disciple, serverNowMs);
  if (status === 'cultivationFull') return !disciple.canBreakthrough && hasFullCultivation(disciple);
  return disciple.assignment === IDLE_ASSIGNMENT_ID;
}

/** 境界 / 阶段 / 岗位 / 状态 / 进度五项组合筛选（每项空值或 all 表示不限）。 */
export function matchesFilters(
  disciple: FilterableDisciple,
  filter: DiscipleFilter,
  serverNowMs: number,
): boolean {
  if (filter.realmId !== '' && disciple.realmId !== filter.realmId) return false;
  // 阶段是从属筛选：没选境界时它不参与判定（UI 也会禁用并在换境界时清空，不留隐藏条件）。
  if (filter.realmId !== '' && filter.stage !== null && disciple.stage !== filter.stage) return false;
  if (filter.assignment !== '' && disciple.assignment !== filter.assignment) return false;
  if (!matchesStatusFilter(disciple, filter.status, serverNowMs)) return false;
  return matchesProgressFilter(disciple, filter.progress);
}

/**
 * 排序：默认保持 `state.disciples` 的原顺序（招募顺序）。
 * 相同排序值保持原顺序（Array.prototype.sort 在 ES2019 起保证稳定）。
 *
 * 修为进度用原始比例跨境界比较（版本上限视为 100%）；修炼速度用服务端给的每小时产出。
 * 并列时不追加任何隐藏的比较键（综合评分并列也在内），靠稳定排序保留招募顺序，
 * 所以并列只有「招募顺序」一种结果。
 */
export function sortDisciples<T extends FilterableDisciple>(
  disciples: readonly T[],
  sort: DiscipleSortKey,
): T[] {
  const list = [...disciples];
  if (sort === 'combatPower') {
    list.sort((a, b) => b.combatPower - a.combatPower);
  } else if (sort === 'attributeScore') {
    list.sort((a, b) => b.attributeScore - a.attributeScore);
  } else if (sort === 'combatPowerAsc') {
    list.sort((a, b) => a.combatPower - b.combatPower);
  } else if (sort === 'realm') {
    list.sort((a, b) => b.realmOrder - a.realmOrder || b.stage - a.stage);
  } else if (sort === 'realmAsc') {
    list.sort((a, b) => a.realmOrder - b.realmOrder || a.stage - b.stage);
  } else if (sort === 'cultivationProgressDesc') {
    list.sort((a, b) => cultivationRatio(b) - cultivationRatio(a));
  } else if (sort === 'cultivationProgressAsc') {
    list.sort((a, b) => cultivationRatio(a) - cultivationRatio(b));
  } else if (sort === 'cultivationRateDesc') {
    list.sort((a, b) => b.cultivationRatePerHour - a.cultivationRatePerHour);
  } else if (sort === 'cultivationRateAsc') {
    list.sort((a, b) => a.cultivationRatePerHour - b.cultivationRatePerHour);
  }
  return list;
}

/** 筛选 + 排序；返回新数组，不改动入参。 */
export function filterDisciples<T extends FilterableDisciple>(
  disciples: readonly T[],
  filter: DiscipleFilter,
  serverNowMs: number,
): T[] {
  return sortDisciples(
    disciples.filter((disciple) => matchesFilters(disciple, filter, serverNowMs)),
    filter.sort,
  );
}

export interface RealmFilterOption {
  realmId: string;
  realmName: string;
  realmOrder: number;
}

/** 境界筛选项：从当前弟子的 realmOrder/realmId/realmName 去重派生，按 realmOrder 升序。 */
export function realmOptions(disciples: readonly FilterableDisciple[]): RealmFilterOption[] {
  const byId = new Map<string, RealmFilterOption>();
  for (const disciple of disciples) {
    if (byId.has(disciple.realmId)) continue;
    byId.set(disciple.realmId, {
      realmId: disciple.realmId,
      realmName: disciple.realmName,
      realmOrder: disciple.realmOrder,
    });
  }
  return [...byId.values()].sort((a, b) => a.realmOrder - b.realmOrder);
}

export interface StageFilterOption {
  stage: number;
  stageName: string;
}

/**
 * 境界内阶段筛选项：从**完整弟子名单**（不是当前筛选结果）里取该境界出现过的阶段，
 * 按 `stage` 数值升序，标签用对应的 `stageName`。
 * 没选境界时返回空数组（阶段筛选此时不可用，换境界时调用方负责清空已选阶段）。
 */
export function stageOptions(
  disciples: readonly FilterableDisciple[],
  realmId: string,
): StageFilterOption[] {
  if (realmId === '') return [];
  const byStage = new Map<number, StageFilterOption>();
  for (const disciple of disciples) {
    if (disciple.realmId !== realmId) continue;
    if (byStage.has(disciple.stage)) continue;
    byStage.set(disciple.stage, { stage: disciple.stage, stageName: disciple.stageName });
  }
  return [...byStage.values()].sort((a, b) => a.stage - b.stage);
}

/** 是否处于非默认筛选（决定「重置」按钮与无结果文案）。 */
export function isFilterActive(filter: DiscipleFilter): boolean {
  return (
    filter.realmId !== '' ||
    filter.stage !== null ||
    filter.assignment !== '' ||
    filter.status !== 'all' ||
    filter.progress !== 'all' ||
    filter.sort !== 'recruitOrder'
  );
}
