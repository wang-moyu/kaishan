import { describe, expect, it } from 'vitest';

import { PILL_IDS, PILL_RECIPES } from '../../apps/server/src/modules/game/alchemy';
import {
  SHOP_BUY_PRICE,
  SHOP_MAX_PILL_QUANTITY,
  SHOP_MAX_TRADE_AMOUNT,
  SHOP_PILL_PRICES,
  SHOP_PILL_SELL_RATIO,
  SHOP_SELL_PRICE,
  SHOP_TRADABLE_RESOURCES,
  UNITS_PER_DISPLAY,
  asShopTradableResource,
  shopBuyCost,
  shopPillPrice,
  shopPillRevenue,
  shopPillSellPrice,
  shopSellRevenue,
  toMinUnits,
} from '../../apps/server/src/modules/game/shop';

/**
 * 坊市纯函数（apps/server/src/modules/game/shop.ts）：
 * 价格体系、材料白名单、丹药回收价（docs/商店开发计划.md 第 2、5.1、7.1 节）。
 *
 * 这些常量是服务端与前端唯一的换算口径：接口把价格下发给前端，前端只做预览，
 * 不复制第二份公式；所以这里钉住的每一个数字都是「合同」。
 */
describe('坊市价格体系', () => {
  it('买入价：每 1 展示单位材料花 667 最小单位灵石（1 灵石 = 1.5 材料）', () => {
    expect(SHOP_BUY_PRICE).toBe(667);
    expect(shopBuyCost(0)).toBe(0);
    expect(shopBuyCost(1)).toBe(667);
    expect(shopBuyCost(6)).toBe(4002);
  });

  it('卖出价：每 1 展示单位材料得 500 最小单位灵石（2 材料 = 1 灵石）', () => {
    expect(SHOP_SELL_PRICE).toBe(500);
    expect(shopSellRevenue(0)).toBe(0);
    expect(shopSellRevenue(2)).toBe(1000);
    expect(shopSellRevenue(4)).toBe(2000);
  });

  it('买卖差价恒为正：任何数量的「买进再卖出」都必然亏灵石（不能套利）', () => {
    for (const amount of [1, 2, 3, 5, 10, 100, SHOP_MAX_TRADE_AMOUNT]) {
      expect(shopBuyCost(amount)).toBeGreaterThan(shopSellRevenue(amount));
    }
    // 差价比例就是 667 : 500。
    expect(shopBuyCost(3) - shopSellRevenue(3)).toBe(3 * (SHOP_BUY_PRICE - SHOP_SELL_PRICE));
  });

  it('金额一律是最小单位整数：不会出现浮点零头', () => {
    for (const value of [SHOP_BUY_PRICE, SHOP_SELL_PRICE, ...Object.values(SHOP_PILL_PRICES)]) {
      expect(Number.isInteger(value)).toBe(true);
    }
    for (const amount of [1, 3, 7, 999, SHOP_MAX_TRADE_AMOUNT]) {
      expect(Number.isInteger(shopBuyCost(amount))).toBe(true);
      expect(Number.isInteger(shopSellRevenue(amount))).toBe(true);
      expect(Number.isInteger(shopPillRevenue('healingPill', amount))).toBe(true);
    }
  });

  it('展示单位换算：1 展示单位 = 1000 最小单位（与 contracts 同口径）', () => {
    expect(UNITS_PER_DISPLAY).toBe(1000);
    expect(toMinUnits(0)).toBe(0);
    expect(toMinUnits(1)).toBe(1000);
    expect(toMinUnits(1_000)).toBe(1_000_000);
  });
});

describe('坊市可交易材料白名单', () => {
  it('只有药材与矿石可买卖（灵石与灵气不可交易）', () => {
    expect([...SHOP_TRADABLE_RESOURCES]).toEqual(['herb', 'ore']);
  });

  it('asShopTradableResource 只放行白名单，其余返回 null（由 service 拒绝）', () => {
    expect(asShopTradableResource('herb')).toBe('herb');
    expect(asShopTradableResource('ore')).toBe('ore');
    expect(asShopTradableResource('spiritStone')).toBeNull();
    expect(asShopTradableResource('spiritualEnergy')).toBeNull();
    expect(asShopTradableResource('')).toBeNull();
    expect(asShopTradableResource('wood')).toBeNull();
  });

  it('数量上限与 schema 同口径：材料 10000 展示单位、丹药 1000 颗', () => {
    expect(SHOP_MAX_TRADE_AMOUNT).toBe(10_000);
    expect(SHOP_MAX_PILL_QUANTITY).toBe(1_000);
  });
});

describe('坊市丹药回收价', () => {
  it('价格表的键与丹方完全一致（新增丹方必须同时补一条回收价）', () => {
    expect(Object.keys(SHOP_PILL_PRICES).sort()).toEqual([...PILL_IDS].sort());
  });

  it('回收价 = 炼制总成本（材料按卖出价折算、灵气按 0）× 70% 向下取整', () => {
    expect(SHOP_PILL_SELL_RATIO).toBe(0.7);
    for (const recipe of PILL_RECIPES) {
      const costValue = Object.entries(recipe.cost).reduce((total, [resourceId, amount]) => {
        const units = Number(amount);
        // 材料按**卖出价**折算（500 / 1000 = 0.5）；灵石按原值；灵气不可交易按 0。
        const value =
          resourceId === 'herb' || resourceId === 'ore'
            ? (units * SHOP_SELL_PRICE) / UNITS_PER_DISPLAY
            : resourceId === 'spiritStone'
              ? units
              : 0;
        return total + value;
      }, 0);
      expect(SHOP_PILL_PRICES[recipe.id]).toBe(shopPillSellPrice(costValue));
    }
  });

  it('回收价走整数运算：Math.floor(22500 × 0.7) 会算成 15749，必须用 shopPillSellPrice', () => {
    // 浮点陷阱本身（这就是不能直接 Math.floor(cost * 0.7) 的原因）。
    expect(Math.floor(22_500 * 0.7)).toBe(15_749);
    expect(shopPillSellPrice(20_000)).toBe(14_000);
    expect(shopPillSellPrice(22_500)).toBe(15_750);
    expect(shopPillSellPrice(60_000)).toBe(42_000);
    // 奇数成本的 floor：20001 × 7 / 10 = 14000.7 → 14000（换成 Math.round 会变成 14001）
    expect(shopPillSellPrice(20_001)).toBe(14_000);
  });

  it('回收价低于炼制成本：买卖丹药同样不能套利', () => {
    const costOf = (pillId: string): number =>
      Object.entries(PILL_RECIPES.find((recipe) => recipe.id === pillId)!.cost).reduce(
        (total, [, amount]) => total + Number(amount),
        0,
      );
    for (const pillId of PILL_IDS) {
      const price = SHOP_PILL_PRICES[pillId]!;
      expect(price).toBeGreaterThan(0);
      expect(price).toBeLessThan(costOf(pillId));
    }
  });

  it('已知回收价（最小单位灵石）：回春丹 14000 / 聚气丹 15750 / 淬体丹 42000', () => {
    expect(SHOP_PILL_PRICES['healingPill']).toBe(14_000);
    expect(SHOP_PILL_PRICES['cultivationPill']).toBe(15_750);
    expect(SHOP_PILL_PRICES['bodyTemperingPill']).toBe(42_000);
  });

  it('shopPillRevenue 按颗数累加；未知丹药按 0 计（service 会先拒绝）', () => {
    expect(shopPillRevenue('healingPill', 1)).toBe(14_000);
    expect(shopPillRevenue('healingPill', 3)).toBe(42_000);
    expect(shopPillRevenue('bodyTemperingPill', 10)).toBe(420_000);
    expect(shopPillRevenue('cultivationPill', 4)).toBe(63_000);
    expect(shopPillRevenue('unknownPill', 5)).toBe(0);
    expect(shopPillPrice('healingPill')).toBe(14_000);
    expect(shopPillPrice('unknownPill')).toBeNull();
  });
});
