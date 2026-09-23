/**
 * 坊市系统（灵石 ↔ 材料双向买卖 + 丹药出售）—— 纯定义与纯计算。
 *
 * 与 alchemy.ts / gambling.ts 同一模式：规则是少量玩法常量，放在游戏模块代码里，
 * 不进 GameConfigContent，也不改公共配置哈希；坊市面板通过登录后的 /game/sync 返回。
 *
 * 本文件只放纯定义和纯计算：不读数据库、不取时间（不调用 Date.now()）、不用随机数。
 * 价格换算集中在这里，复用于 sync 视图（view.ts 的 buildSectStateView）与三个写路径
 * （service.ts 的 shopBuy / shopSell / shopSellPill）；前端只拿服务端下发的价格做预览，
 * 不复制第二份公式。
 *
 * 金额一律是**最小单位整数**（1 展示单位 = 1000 最小单位，前端 formatAmount 会除）；
 * 交易数量（amount）是**展示单位整数**，所以材料数量换算成最小单位时要乘 UNITS_PER_DISPLAY。
 */

import { MIN_UNITS_PER_DISPLAY_UNIT } from '@xiuxian/contracts';

/** 1 展示单位 = 1000 最小单位：复用 contracts 里的唯一一份定义，不在这里另写一个 1000。 */
export const UNITS_PER_DISPLAY = MIN_UNITS_PER_DISPLAY_UNIT;

/**
 * 买入价（灵石 → 材料）：每 1000 最小单位材料（= 1 展示单位）花 667 最小单位灵石。
 * 由「1 灵石 = 1.5 展示单位药材」反推：ceil(1000 / 1.5) = 667 —— 取整方向刻意偏贵，
 * 与卖出价一起形成差价（见 SHOP_SELL_PRICE 的注释），所以买进再卖出必然亏。
 */
export const SHOP_BUY_PRICE = 667;

/** 卖出价（材料 → 灵石）：每 1000 最小单位材料（= 1 展示单位）得 500 最小单位灵石（2 材料 = 1 灵石）。 */
export const SHOP_SELL_PRICE = 500;

/** 可买卖的材料白名单：只有药材与矿石（灵石与灵气不可交易）。 */
export const SHOP_TRADABLE_RESOURCES = ['herb', 'ore'] as const;
export type ShopTradableResource = (typeof SHOP_TRADABLE_RESOURCES)[number];

/**
 * 丹药回收价的分子 / 分母：70% = 7 / 10。
 * 刻意用整数运算而不是 `Math.floor(cost * 0.7)` —— 后者在浮点下把 22500 × 0.7
 * 算成 15749.999…，floor 成 15749（与丹方表里的 15750 不符）。
 */
const SHOP_PILL_SELL_NUMERATOR = 7;
const SHOP_PILL_SELL_DENOMINATOR = 10;

/** 丹药回收比例（文档口径的人读形式）：按炼制总成本的 70% 折算灵石。 */
export const SHOP_PILL_SELL_RATIO = SHOP_PILL_SELL_NUMERATOR / SHOP_PILL_SELL_DENOMINATOR;

/**
 * 丹药回收价（最小单位灵石）：写死在常量里，运行时不再依赖炼丹成本表。
 * 折算口径 = 材料按**卖出价**（× 卖出价 / 1000 = × 0.5）+ 灵石按原值 + 灵气按 0（不可交易），
 * 再按 shopPillSellPrice 折算（floor(成本 × 70%)，整数运算；丹方见 alchemy.ts 的 PILL_RECIPES）：
 * - 回春丹：herb 10000 × 0.5 + 灵石 15000 = 20000 → 14000
 * - 聚气丹：herb 25000 × 0.5 + 灵气 15000 × 0 + 灵石 10000 = 22500 → 15750
 * - 淬体丹：herb 40000 × 0.5 + 矿石 20000 × 0.5 + 灵石 30000 = 60000 → 42000
 * 新增丹方时必须同时补一条（tests/game/shop-rules.test.ts 会核对这张表的键与丹方一致）。
 */
export const SHOP_PILL_PRICES: Record<string, number> = {
  healingPill: 14_000,
  cultivationPill: 15_750,
  bodyTemperingPill: 42_000,
};

/** 单次买卖的材料数量上限（展示单位整数）：与 schema 同口径。 */
export const SHOP_MAX_TRADE_AMOUNT = 10_000;

/** 单次出售的丹药数量上限（颗）：与 schema 同口径。 */
export const SHOP_MAX_PILL_QUANTITY = 1_000;

/**
 * 材料白名单判定：非法 id（灵石 / 灵气 / 客户端乱传）返回 null。
 * 纯函数不抛错 —— 由调用方（service）决定用什么错误码拒绝。
 */
export function asShopTradableResource(resourceId: string): ShopTradableResource | null {
  return SHOP_TRADABLE_RESOURCES.find((id) => id === resourceId) ?? null;
}

/** 展示单位 → 最小单位。 */
export function toMinUnits(displayAmount: number): number {
  return displayAmount * UNITS_PER_DISPLAY;
}

/** 买入材料的灵石花费（最小单位）。 */
export function shopBuyCost(displayAmount: number): number {
  return displayAmount * SHOP_BUY_PRICE;
}

/** 卖出材料获得的灵石（最小单位）。 */
export function shopSellRevenue(displayAmount: number): number {
  return displayAmount * SHOP_SELL_PRICE;
}

/** 单颗丹药的回收价（最小单位）；未知 id 返回 null（不在这里抛错，由 service 拒绝）。 */
export function shopPillPrice(pillId: string): number | null {
  return SHOP_PILL_PRICES[pillId] ?? null;
}

/** 卖出丹药获得的灵石（最小单位）。 */
export function shopPillRevenue(pillId: string, quantity: number): number {
  return (shopPillPrice(pillId) ?? 0) * quantity;
}

/**
 * 由炼制总成本（最小单位灵石）折算回收价：`floor(成本 × 70%)`，整数运算。
 * SHOP_PILL_PRICES 就是这张公式在现有丹方上的结果 —— 测试会逐条核对，
 * 所以丹方改了成本而没更新价格表时会立刻失败，而不是安静地算错钱。
 */
export function shopPillSellPrice(costValue: number): number {
  return Math.floor((costValue * SHOP_PILL_SELL_NUMERATOR) / SHOP_PILL_SELL_DENOMINATOR);
}
