/**
 * 随机事件池与触发判定（P3 第一~三节）。
 *
 * 核心原则：事件就是「一次随机判定 + 立即生效的资源增减」，没有持续事件、没有选择
 * 分支、没有事件链；事件池直接硬编码，不读配置。
 *
 * 金额一律是**最小单位**（03 第 1 节：1 展示单位 = 1000 最小单位）的十进制字符串，
 * 正数=获得，负数=扣除（扣到 0 为止，不会负）。
 */

export interface EventEffect {
  type: 'resource';
  /** 对应 game-config 里的资源 id（spiritStone/herb/ore/spiritualEnergy）。 */
  resourceId: string;
  /** 最小单位；正数=获得，负数=扣除。 */
  amount: string;
}

export interface EventDef {
  id: string;
  name: string;
  description: string;
  /** 权重，越大越容易触发。 */
  weight: number;
  effects: EventEffect[];
}

/**
 * 已触发的事件：结算结果（SettleResult.events）与落库日志（event_log）共用的形状。
 * effects 拍平成 resourceId -> 带符号的最小单位数量，便于 JSON 落库与前端展示。
 */
export interface TriggeredEvent {
  /** event_log 行 id（crypto.randomUUID）。 */
  id: string;
  eventId: string;
  name: string;
  description: string;
  /** resourceId -> 带符号的最小单位数量字符串。 */
  effects: Record<string, string>;
}

/** 每小时触发一个事件的期望次数。 */
export const EVENT_TRIGGER_RATE_PER_HOUR = 2.0;
/** 单次结算最多触发的事件数（离线 12 小时最多 5 个，避免刷屏）。 */
export const MAX_EVENTS_PER_SETTLE = 5;
/** sync 返回的最近事件条数（新的在前）。 */
export const RECENT_EVENTS_IN_SYNC = 10;
/** GET /game/events 返回的最近事件条数（新的在前）。 */
export const EVENT_HISTORY_LIMIT = 20;

const MS_PER_HOUR = 3_600_000;

function effect(resourceId: string, amount: string): EventEffect {
  return { type: 'resource', resourceId, amount };
}

/**
 * 事件池（P3 第二节表格，硬编码）。
 * 权重约定：好事件 weight=10，坏事件 weight=5，大奖 ancient_ruin weight=2。
 */
export const EVENT_POOL: readonly EventDef[] = [
  {
    id: 'windfall',
    name: '灵石矿脉',
    description: '弟子偶然发现一处灵石矿脉！',
    weight: 10,
    effects: [effect('spiritStone', '80000')],
  },
  {
    id: 'herb_bloom',
    name: '灵药盛开',
    description: '灵药园中百花齐放，收获颇丰。',
    weight: 10,
    effects: [effect('herb', '60000')],
  },
  {
    id: 'bandit_raid',
    name: '山贼来袭',
    description: '一伙山贼偷袭了宗门，损失了一些灵石。',
    weight: 5,
    effects: [effect('spiritStone', '-30000')],
  },
  {
    id: 'wandering_master',
    name: '游方散修',
    description: '一位游方散修路过，赠送了珍贵矿石。',
    weight: 10,
    effects: [effect('ore', '40000')],
  },
  {
    id: 'spiritual_surge',
    name: '灵气潮汐',
    description: '天地灵气涌动，宗门灵气大涨！',
    weight: 10,
    effects: [effect('spiritualEnergy', '50000')],
  },
  {
    id: 'beast_attack',
    name: '妖兽侵袭',
    description: '妖兽袭击了矿场，矿石被毁。',
    weight: 5,
    effects: [effect('ore', '-20000')],
  },
  {
    id: 'merchant_visit',
    name: '行商到访',
    description: '行商以优惠价出售了一批灵草。',
    weight: 10,
    effects: [effect('herb', '40000'), effect('spiritStone', '-15000')],
  },
  {
    id: 'disciple_fortune',
    name: '弟子奇遇',
    description: '弟子外出历练，带回灵石和灵草。',
    weight: 10,
    effects: [effect('spiritStone', '30000'), effect('herb', '20000')],
  },
  {
    id: 'thunder_tribulation',
    name: '雷劫余波',
    description: '附近有人渡劫，雷劫余波波及宗门。',
    weight: 5,
    effects: [effect('spiritualEnergy', '-25000')],
  },
  {
    id: 'ancient_ruin',
    name: '上古遗迹',
    description: '弟子发现上古遗迹，获得大量资源！',
    weight: 2,
    effects: [effect('spiritStone', '50000'), effect('ore', '30000'), effect('herb', '30000')],
  },
];

/** 按 id 查事件定义（读库时用 event_id 反查 name）。 */
export function eventDefinition(eventId: string): EventDef | undefined {
  return EVENT_POOL.find((event) => event.id === eventId);
}

/** 事件的展示名；定义里查不到时用 event_id 兜底（event_log 没有 name 列）。 */
export function eventNameOf(eventId: string): string {
  return eventDefinition(eventId)?.name ?? eventId;
}

/** 按权重随机选一个事件；随机源可注入，便于测试。 */
export function pickEvent(
  random: () => number = Math.random,
  pool: readonly EventDef[] = EVENT_POOL,
): EventDef {
  const total = pool.reduce((sum, event) => sum + event.weight, 0);
  let roll = random() * total;
  for (const event of pool) {
    roll -= event.weight;
    if (roll < 0) {
      return event;
    }
  }
  return pool[pool.length - 1] as EventDef;
}

/**
 * 按经过的时长判定本次触发的事件（P3 第三节）。
 *
 * elapsedHours = durationMs / 1h（durationMs 已是按 12 小时上限截断后的实际计时）；
 * 期望次数 = elapsedHours × 2.0，整数部分必触发，小数部分按概率补 1，单次最多 5 个。
 * 随机源可注入（默认 Math.random），是与 settleEconomy 共用的随机来源。
 */
export function triggerEvents(
  durationMs: number,
  random: () => number = Math.random,
): TriggeredEvent[] {
  const elapsedHours = durationMs / MS_PER_HOUR;
  const expectedEvents = elapsedHours * EVENT_TRIGGER_RATE_PER_HOUR;
  const fractional = expectedEvents % 1;
  const count = Math.min(
    MAX_EVENTS_PER_SETTLE,
    Math.floor(expectedEvents) + (random() < fractional ? 1 : 0),
  );

  const triggered: TriggeredEvent[] = [];
  for (let index = 0; index < count; index += 1) {
    const definition = pickEvent(random);
    triggered.push({
      id: crypto.randomUUID(),
      eventId: definition.id,
      name: definition.name,
      description: definition.description,
      effects: Object.fromEntries(definition.effects.map((item) => [item.resourceId, item.amount])),
    });
  }
  return triggered;
}
