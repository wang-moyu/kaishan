import { findTalent } from './constants';

/**
 * 弟子随机生成与属性规则（任务卡「2.4 弟子随机生成」+ V4 第五节的种子化版本 +
 * docs/弟子属性与综合评分开发计划.md 第 2.1 / 2.3 节）。
 *
 * - 无参版本（randomDiscipleName / randomGender）直接用 `Math.random()`：创建宗门的初始弟子只生成一次；
 * - 带随机源的版本（generateXxx）由调用方注入 `() => number`，招募预览与招募本身共用同一 seed。
 *
 * 属性生成规则（初始弟子与招贤候选人共用 `generateAttributes`）：
 * - 资质 / 幸运 / 体魄：各独立取两次 `[0,1)` 随机数，`1 + floor(100 × (r1 + r2) / 2)`
 *   —— 中间常见、极值罕见，三项彼此独立；
 * - 攻 / 防 / 身法：**共用**同一个基础值 `15 + floor(random() × 71)`（15..85），
 *   每项再加独立偏移 `floor(random() × 31) − 15`（−15..15）并夹取到 1..100。
 *   于是出生时三项的最大差距不超过 30（也修掉了旧版三项各自独立 1..100 的极端割裂），
 *   同时仍允许偏科与少量接近 100 的弟子；资质 / 幸运 / 体魄不受这个基础值约束。
 */

const SURNAMES = [
  '云',
  '墨',
  '苏',
  '白',
  '顾',
  '沈',
  '叶',
  '陆',
  '江',
  '萧',
  '柳',
  '谢',
  '楚',
  '姜',
  '裴',
  '薛',
  '秦',
  '许',
  '方',
  '燕',
  '凌',
  '南宫',
  '上官',
  '司徒',
  '独孤',
] as const;

const GIVEN_NAMES = [
  '清和',
  '流云',
  '无咎',
  '青玄',
  '长风',
  '拾微',
  '闻笛',
  '砚舟',
  '惊蛰',
  '未名',
  '知微',
  '星澜',
  '疏影',
  '松声',
  '砚青',
  '微澜',
  '初霁',
  '望山',
  '怀玉',
  '拾光',
  '行舟',
  '半夏',
  '听雪',
  '明烛',
  '问天',
  '拂衣',
  '折月',
  '归远',
  '似锦',
  '织雪',
] as const;

export function randomDiscipleName(): string {
  const surname = SURNAMES[Math.floor(Math.random() * SURNAMES.length)] ?? '云';
  const given = GIVEN_NAMES[Math.floor(Math.random() * GIVEN_NAMES.length)] ?? '清和';
  return `${surname}${given}`;
}

export function randomGender(): 'male' | 'female' {
  return Math.random() < 0.5 ? 'male' : 'female';
}

/**
 * 基于种子的伪随机生成器（V4 第五节；用于招募预览的确定性）。
 * 同一个 seed 永远产生同一序列，刷新页面重新预览不会换人。
 */
export function seededRandom(seed: string): () => number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h = Math.imul(h ^ (h >>> 13), 0x45d9f3b);
    h ^= h >>> 16;
    return (h >>> 0) / 0x100000000;
  };
}

/** 带随机源的姓名生成（V4 5.1）：确定性命中招募预览与招募本身。 */
export function generateDiscipleName(random: () => number): string {
  const surname = SURNAMES[Math.floor(random() * SURNAMES.length)] ?? '云';
  const given = GIVEN_NAMES[Math.floor(random() * GIVEN_NAMES.length)] ?? '清和';
  return `${surname}${given}`;
}

export function generateGender(random: () => number): 'male' | 'female' {
  return random() < 0.5 ? 'male' : 'female';
}

export function generateTalent(random: () => number): string {
  const talents = ['herbGathering', 'mining', 'cultivation', 'combat'];
  return talents[Math.floor(random() * talents.length)] ?? 'combat';
}

/* ---------- 六项属性的生成与综合评分（计划 2.1 / 2.3） ---------- */

/** 属性合法区间（与 0016 迁移的两份 CHECK 一致）。 */
export const ATTRIBUTE_MIN = 1;
export const ATTRIBUTE_MAX = 100;

/** 幸运 / 体魄的「机制中性点」：旧弟子迁移后的默认值，也是旧历练概率不变的那个值。 */
export const ATTRIBUTE_NEUTRAL = 50;

/** 攻 / 防 / 身法共用的基础值区间：15..85。 */
const COMBAT_BASE_MIN = 15;
const COMBAT_BASE_SPAN = 71;

/** 三项各自的独立偏移：−15..15（因此三项最大差距不超过 30）。 */
const COMBAT_OFFSET_MIN = -15;
const COMBAT_OFFSET_SPAN = 31;

/** 六项属性（资质 / 攻 / 防 / 身法 / 幸运 / 体魄）。 */
export interface DiscipleAttributes {
  aptitude: number;
  attack: number;
  defense: number;
  speed: number;
  luck: number;
  physique: number;
}

/** 1..100 夹取（数据库 CHECK 之外再兜一层，脏值不会把公式带出区间）。 */
function clampAttribute(value: number): number {
  return Math.min(ATTRIBUTE_MAX, Math.max(ATTRIBUTE_MIN, value));
}

/** 中间值常见的 1..100 整数：两次独立 `[0,1)` 随机数取平均后映射。 */
function generateCenteredAttribute(random: () => number): number {
  const first = random();
  const second = random();
  return ATTRIBUTE_MIN + Math.floor(ATTRIBUTE_MAX * ((first + second) / 2));
}

/**
 * 一个弟子完整的一组六属性（初始弟子与招贤候选人共用同一函数）。
 *
 * 随机数消费顺序固定为：资质 → 幸运 → 体魄 → 攻/防/身法共用的基础值 → 攻偏移 → 防偏移 → 身法偏移，
 * 因此同一个随机源序列必然得到同一组属性（测试按这个顺序钉死边界）。
 */
export function generateAttributes(random: () => number): DiscipleAttributes {
  const aptitude = generateCenteredAttribute(random);
  const luck = generateCenteredAttribute(random);
  const physique = generateCenteredAttribute(random);
  const base = COMBAT_BASE_MIN + Math.floor(random() * COMBAT_BASE_SPAN);
  const offset = (): number =>
    COMBAT_OFFSET_MIN + Math.floor(random() * COMBAT_OFFSET_SPAN);
  return {
    aptitude,
    luck,
    physique,
    attack: clampAttribute(base + offset()),
    defense: clampAttribute(base + offset()),
    speed: clampAttribute(base + offset()),
  };
}

/**
 * 综合评分 = **当前**六项属性等权平均，固定一位小数（计划 2.1）。
 *
 * 公式：`Math.round(total × 10 / 6) / 10`。
 * 六项全 1 → 1.0；六项全 100 → 100.0；任意一项 +1 至少 +0.1（六项全 +1 至少 +1.0）。
 *
 * 这不是战力、也不是岗位效率：境界、修为、天赋、战力都不参与；服务端现算、**不落库**，
 * 所以淬体丹改完攻/防/速之后，服丹回执与下一次 sync 的评分自动一致。
 */
export function attributeScore(attributes: DiscipleAttributes): number {
  const total =
    attributes.aptitude +
    attributes.attack +
    attributes.defense +
    attributes.speed +
    attributes.luck +
    attributes.physique;
  return Math.round((total * 10) / 6) / 10;
}

/* ---------- 招贤批次标识（计划 2.3） ---------- */

/**
 * 弟子属性生成规则版本：招贤批次标识的一部分。
 * 改动属性生成或评分规则时必须 +1 —— 版本变了，旧预览的批次就不再等于当前批次，
 * 服务端会拒绝并让玩家重新预览（避免「预览按旧规则、招募按新规则」的错配）。
 */
export const DISCIPLE_RULE_VERSION = 2;

export interface RecruitBatchInput {
  sectId: string;
  /** UTC+8 自然日键（跨天即失效）。 */
  dateKey: string;
  /** 今日已招募次数（招募成功后 +1，因此旧预览立即失效）。 */
  recruitCount: number;
  /** 本境界已用的刷新次数（「换一批」后 +1，旧预览立即失效）。 */
  refreshSeq: number;
}

/**
 * 招贤批次标识：生成规则版本 + 宗门 id + 日期键 + 今日招募次数 + 刷新序号。
 *
 * 预览下发、招募请求回传，服务端用本函数重算后比对。它**不是授权凭据**：
 * 归属、资源、次数等校验照旧执行；它只保证「选中的第 N 张卡」确实来自当前这一次生成机会。
 */
export function recruitBatchId(input: RecruitBatchInput): string {
  return [
    String(DISCIPLE_RULE_VERSION),
    input.sectId,
    input.dateKey,
    String(input.recruitCount),
    String(input.refreshSeq),
  ].join(':');
}

/** 批次比对结果：current = 可招募，stale = 旧批次，missing = 旧客户端没带标识。 */
export type RecruitBatchStatus = 'current' | 'stale' | 'missing';

export function recruitBatchStatus(
  batch: string | undefined,
  expected: RecruitBatchInput,
): RecruitBatchStatus {
  if (batch === undefined || batch === '') return 'missing';
  return batch === recruitBatchId(expected) ? 'current' : 'stale';
}

/** 招募候选人（V4 5.2）：招募预览与实际招募共用同一批人，含六属性与综合评分。 */
export interface RecruitCandidate extends DiscipleAttributes {
  name: string;
  gender: string;
  talent: string;
  talentName: string;
  /** 六项属性等权现算的综合评分（一位小数）。 */
  attributeScore: number;
}

/**
 * 根据宗门当前状态生成 3 个确定性候选人（V4 5.3；V5.2 加入刷新序号）。
 *
 * seed = `${sectId}:${dateKey}:${recruitCount}:${refreshSeq}`：
 *   - recruitCount：今日已招募次数（跨天重置）；
 *   - refreshSeq：本境界已用的招贤刷新次数（升级重置）。
 * 同一次机会（同一宗门、同一 UTC+8 自然日、同一已招募次数、同一刷新次数）永远生成同一批人，
 * 因此「预览第 N 张 = 招募时 candidates[N]」，而刷新一次（refreshSeq +1）就会真的换一批。
 */
export function generateCandidates(
  sectId: string,
  dateKey: string,
  recruitCount: number,
  refreshSeq = 0,
): RecruitCandidate[] {
  const seed = `${sectId}:${dateKey}:${recruitCount}:${refreshSeq}`;
  const random = seededRandom(seed);
  const candidates: RecruitCandidate[] = [];
  for (let i = 0; i < 3; i++) {
    const talent = generateTalent(random);
    const attributes = generateAttributes(random);
    candidates.push({
      name: generateDiscipleName(random),
      gender: generateGender(random),
      ...attributes,
      talent,
      talentName: findTalent(talent)?.name ?? talent,
      attributeScore: attributeScore(attributes),
    });
  }
  return candidates;
}

/* ---------- 改名规则（宗门名 / 弟子名）：长度上限与消耗 ---------- */

/**
/**
 * 名字长度规则（Unicode 码点；服务层校验与前端字数提示共用同一口径）。
 * 重名规则（0021）：**宗门名全局唯一**（建宗与改名都查重，另有 sects_name_uniq 唯一索引兜底）；
 * 弟子名允许重名（门内可以有同名弟子，招募与改名都不查重）。
 */
export const SECT_NAME_MIN_CHARS = 2;
export const SECT_NAME_MAX_CHARS = 12;
export const DISCIPLE_NAME_MIN_CHARS = 2;
export const DISCIPLE_NAME_MAX_CHARS = 6;

/** 改名消耗（灵石，最小单位；1 展示单位 = 1000 最小单位）：宗门一次 500、弟子一次 50。 */
export const SECT_RENAME_COST = 500 * 1000;
export const DISCIPLE_RENAME_COST = 50 * 1000;
