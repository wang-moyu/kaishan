import { applyD1Migrations, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { GAME_CONFIG_CONTENT } from '@xiuxian/game-config';

import { createApp } from '../src/app';
import { PILL_IDS, findPillRecipe } from '../src/modules/game/alchemy';
import { effectiveCapacity, findSectLevel } from '../src/modules/game/constants';
import {
  SHOP_BUY_PRICE,
  SHOP_MAX_PILL_QUANTITY,
  SHOP_MAX_TRADE_AMOUNT,
  SHOP_PILL_PRICES,
  SHOP_SELL_PRICE,
  SHOP_TRADABLE_RESOURCES,
  UNITS_PER_DISPLAY,
  shopBuyCost,
  shopPillRevenue,
  shopSellRevenue,
  toMinUnits,
} from '../src/modules/game/shop';

import { dataOf, errorOf, TestClient, type ApiResult } from './support/authClient';

/**
 * 坊市（shop.ts + shop-buy / shop-sell / shop-sell-pill）：灵石 ↔ 材料双向买卖 + 丹药出售。
 *
 * 存储说明：本文件一份独立内存 D1，没有逐用例回滚 —— 每个用例用独立账号/宗门（前缀递增），
 * 涉及余额的断言都按宗门 id 定界。
 *
 * 确定性说明：三个写路径都会先做离线结算（SectDraft 构造期），真实 elapsed 会让产出
 * 影响余额。需要精确断言的用例先把 sects.last_settled_at 拨到未来（时钟回拨 → durationMs = 0
 * → 零产出零事件）。价格 / 上限 / 回收价一律从 shop.ts 的常量取，不在测试里复制第二份数字。
 *
 * 坊市**没有解锁条件**：1 级宗门（无建筑）即可交易 —— 与赌坊（2 级）/ 炼丹（2 级 + 灵药园 2 级）不同。
 */

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

const quietLogger = { info: () => {}, warn: () => {}, error: () => {} } as const;
const app = createApp({ logger: quietLogger });
const PASSWORD = 'password-123456';

let seq = 0;

interface SectFixture {
  api: TestClient;
  sectId: string;
  state: () => Promise<Record<string, any>>;
}

/** 注册 + 建宗门；返回宗门 id 与同步读取函数（坊市与弟子无关，不需要弟子 id）。 */
async function makeSect(prefix: string): Promise<SectFixture> {
  seq += 1;
  const account = `${prefix}-${seq}`;
  const api = new TestClient(app, env, {
    'cf-connecting-ip': `10.8.${Math.floor(seq / 250)}.${seq % 250}`,
  });
  const registered = await api.post('/api/v1/auth/register', { account, password: PASSWORD });
  expect(registered.status).toBe(200);
  const created = await api.post('/api/v1/game/create-sect', { name: `坊市${seq}号` });
  expect(created.status).toBe(200);
  const state = dataOf(created) as Record<string, any>;
  return {
    api,
    sectId: state.state.sect.id as string,
    state: async () => {
      const result = await api.get('/api/v1/game/sync');
      expect(result.status).toBe(200);
      return (dataOf(result) as Record<string, any>).state;
    },
  };
}

/** 把结算时间拨到未来：请求内的结算变成零产出零事件，余额断言才精确。 */
async function freezeSettlement(sectId: string): Promise<void> {
  await env.DB.prepare('UPDATE sects SET last_settled_at = ? WHERE id = ?')
    .bind(Date.now() + 60_000, sectId)
    .run();
}

/** 把某项资源余额写成一个确定值（没有余额行时补一行，与 gambling.test.ts 同款）。 */
async function setBalance(sectId: string, resourceId: string, balance: number): Promise<void> {
  const updated = await env.DB.prepare(
    'UPDATE resource_balances SET balance = ? WHERE sect_id = ? AND resource_id = ?',
  )
    .bind(balance, sectId, resourceId)
    .run();
  if (Number(updated.meta.changes) > 0) {
    return;
  }
  await env.DB.prepare(
    `INSERT INTO resource_balances (id, sect_id, resource_id, balance, remainder, updated_at)
     VALUES (?, ?, ?, ?, 0, ?)`,
  )
    .bind(crypto.randomUUID(), sectId, resourceId, balance, Date.now())
    .run();
}

async function balanceOf(sectId: string, resourceId: string): Promise<number | null> {
  const row = await env.DB.prepare(
    'SELECT balance FROM resource_balances WHERE sect_id = ? AND resource_id = ?',
  )
    .bind(sectId, resourceId)
    .first<{ balance: number }>();
  return row === null ? null : Number(row.balance);
}

/** 直接造一条丹药库存（绝对值 upsert；同一宗门同一丹方永远只有一行）。 */
async function setPillQuantity(sectId: string, pillId: string, quantity: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO pill_inventories (id, sect_id, pill_id, quantity, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (sect_id, pill_id)
     DO UPDATE SET quantity = excluded.quantity, updated_at = excluded.updated_at`,
  )
    .bind(crypto.randomUUID(), sectId, pillId, quantity, Date.now())
    .run();
}

async function pillQuantityOf(sectId: string, pillId: string): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT quantity FROM pill_inventories WHERE sect_id = ? AND pill_id = ?',
  )
    .bind(sectId, pillId)
    .first<{ quantity: number }>();
  return row === null ? 0 : Number(row.quantity);
}

/** 1 级宗门下的药材容量：配置基础容量 × 等级倍率（与结算 / 买入校验同一口径）。 */
function herbCapacity(): number {
  const definition = GAME_CONFIG_CONTENT.resources.find((resource) => resource.id === 'herb');
  expect(definition, '配置里必须有药材').toBeTruthy();
  return effectiveCapacity(definition!.capacity, findSectLevel(1).capacityMultiplier);
}

/** 失败请求后的「state 未变」口径：余额 + 坊市面板（时间 / 结算字段不稳定，不比较）。 */
async function shopSnapshot(sect: SectFixture): Promise<Record<string, unknown>> {
  const state = await sect.state();
  return { resources: state.resources, shop: state.shop };
}

/** 断言一次被拒的请求没有动过任何余额与面板数据。 */
async function expectShopUnchanged(
  sect: SectFixture,
  before: Record<string, unknown>,
): Promise<void> {
  expect(await shopSnapshot(sect)).toEqual(before);
}

function buy(sect: SectFixture, body: Record<string, unknown>): Promise<ApiResult> {
  return sect.api.post('/api/v1/game/shop-buy', body);
}

function sell(sect: SectFixture, body: Record<string, unknown>): Promise<ApiResult> {
  return sect.api.post('/api/v1/game/shop-sell', body);
}

function sellPill(sect: SectFixture, body: Record<string, unknown>): Promise<ApiResult> {
  return sect.api.post('/api/v1/game/shop-sell-pill', body);
}

/* ---------- 买入材料（计划 4.2 / 7.2-1、4、10） ---------- */

describe('坊市：买入材料', () => {
  it('买入成功：灵石按 667 / 展示单位减少、材料 +1000 最小单位，cost 正确', async () => {
    const sect = await makeSect('shp-buy');
    await freezeSettlement(sect.sectId);
    await setBalance(sect.sectId, 'spiritStone', 100_000);
    await setBalance(sect.sectId, 'herb', 0);

    const bought = await buy(sect, { resourceId: 'herb', amount: 3 });
    expect(bought.status).toBe(200);
    const payload = dataOf(bought) as Record<string, any>;
    const cost = shopBuyCost(3);
    expect(cost).toBe(3 * SHOP_BUY_PRICE);
    expect(payload.result).toMatchObject({
      action: 'buy',
      resourceId: 'herb',
      resourceName: '药材',
      amount: 3,
      cost,
    });
    expect(payload.result.message).toContain('药材');
    expect(payload.result.message).toContain('3');

    expect(await balanceOf(sect.sectId, 'spiritStone')).toBe(100_000 - cost);
    expect(await balanceOf(sect.sectId, 'herb')).toBe(toMinUnits(3));
    // 写请求也会带回新 state（面板不必再单独 sync）。
    expect(payload.state.shop.buyPrice).toBe(SHOP_BUY_PRICE);
    const herbView = (payload.state.resources as Record<string, any>[]).find(
      (item) => item.id === 'herb',
    );
    expect(herbView?.balance).toBe(String(toMinUnits(3)));
  });

  it('灵石不足：INSUFFICIENT_RESOURCE，拒绝后余额与面板 state 原样不变', async () => {
    const sect = await makeSect('shp-buy-poor');
    await freezeSettlement(sect.sectId);
    const cost = shopBuyCost(3);
    await setBalance(sect.sectId, 'spiritStone', cost - 1);
    await setBalance(sect.sectId, 'herb', 0);
    const before = await shopSnapshot(sect);

    const rejected = await buy(sect, { resourceId: 'herb', amount: 3 });
    expect(rejected.status).toBe(409);
    expect(errorOf(rejected).code).toBe('INSUFFICIENT_RESOURCE');

    await expectShopUnchanged(sect, before);
    expect(await balanceOf(sect.sectId, 'spiritStone')).toBe(cost - 1);
    expect(await balanceOf(sect.sectId, 'herb')).toBe(0);
  });

  it('买入撞材料容量上限：CAPACITY_FULL，details 给出容量 / 余额 / 还能买多少', async () => {
    const sect = await makeSect('shp-buy-full');
    await freezeSettlement(sect.sectId);
    await setBalance(sect.sectId, 'spiritStone', 100_000);
    const capacity = herbCapacity();
    // 差 500 最小单位装满：再买 1 展示单位（1000 最小单位）一定越界。
    await setBalance(sect.sectId, 'herb', capacity - 500);
    const before = await shopSnapshot(sect);

    const rejected = await buy(sect, { resourceId: 'herb', amount: 1 });
    expect(rejected.status).toBe(409);
    const error = errorOf(rejected);
    expect(error.code).toBe('CAPACITY_FULL');
    expect(error.details?.resourceId).toBe('herb');
    expect(error.details?.capacity).toBe(String(capacity));
    expect(error.details?.balance).toBe(String(capacity - 500));
    // 500 < 1000：连 1 个展示单位都装不下。
    expect(error.details?.room).toBe('0');

    await expectShopUnchanged(sect, before);
    expect(await balanceOf(sect.sectId, 'herb')).toBe(capacity - 500);
  });
});

/* ---------- 卖出材料（计划 4.3 / 7.2-2、5） ---------- */

describe('坊市：卖出材料', () => {
  it('卖出成功：材料按 1000 最小单位 / 展示单位减少、灵石 +500 / 展示单位，revenue 正确', async () => {
    const sect = await makeSect('shp-sell');
    await freezeSettlement(sect.sectId);
    await setBalance(sect.sectId, 'herb', 50_000);
    await setBalance(sect.sectId, 'spiritStone', 1_000);

    const sold = await sell(sect, { resourceId: 'herb', amount: 4 });
    expect(sold.status).toBe(200);
    const payload = dataOf(sold) as Record<string, any>;
    const revenue = shopSellRevenue(4);
    expect(revenue).toBe(4 * SHOP_SELL_PRICE);
    expect(payload.result).toMatchObject({
      action: 'sell',
      resourceId: 'herb',
      resourceName: '药材',
      amount: 4,
      revenue,
    });
    expect(payload.result.message).toContain('药材');

    expect(await balanceOf(sect.sectId, 'herb')).toBe(50_000 - toMinUnits(4));
    expect(await balanceOf(sect.sectId, 'spiritStone')).toBe(1_000 + revenue);
    expect(payload.state.shop.sellPrice).toBe(SHOP_SELL_PRICE);
  });

  it('材料不足：INSUFFICIENT_RESOURCE，拒绝后余额与面板 state 原样不变', async () => {
    const sect = await makeSect('shp-sell-short');
    await freezeSettlement(sect.sectId);
    await setBalance(sect.sectId, 'herb', UNITS_PER_DISPLAY - 1);
    await setBalance(sect.sectId, 'spiritStone', 1_000);
    const before = await shopSnapshot(sect);

    const rejected = await sell(sect, { resourceId: 'herb', amount: 1 });
    expect(rejected.status).toBe(409);
    expect(errorOf(rejected).code).toBe('INSUFFICIENT_RESOURCE');

    await expectShopUnchanged(sect, before);
    expect(await balanceOf(sect.sectId, 'herb')).toBe(UNITS_PER_DISPLAY - 1);
    expect(await balanceOf(sect.sectId, 'spiritStone')).toBe(1_000);
  });
});

/* ---------- 售丹（计划 4.4 / 7.2-3、6、8） ---------- */

describe('坊市：售丹', () => {
  it('卖出成功：库存减少、灵石 +回收价 × 颗数，面板库存同步', async () => {
    const sect = await makeSect('shp-pill');
    await freezeSettlement(sect.sectId);
    await setPillQuantity(sect.sectId, 'healingPill', 3);
    await setBalance(sect.sectId, 'spiritStone', 0);

    const sold = await sellPill(sect, { pillId: 'healingPill', quantity: 2 });
    expect(sold.status).toBe(200);
    const payload = dataOf(sold) as Record<string, any>;
    const revenue = shopPillRevenue('healingPill', 2);
    expect(revenue).toBe(SHOP_PILL_PRICES['healingPill']! * 2);
    expect(payload.result).toMatchObject({
      action: 'sell-pill',
      pillId: 'healingPill',
      pillName: '回春丹',
      quantity: 2,
      revenue,
    });
    expect(payload.result.message).toContain('回春丹');

    expect(await pillQuantityOf(sect.sectId, 'healingPill')).toBe(1);
    expect(await balanceOf(sect.sectId, 'spiritStone')).toBe(revenue);
    // 面板里的库存是卖后的值（前端售丹页不用再 sync）。
    const pillPanel = (payload.state.shop.pills as Record<string, any>[]).find(
      (pill) => pill.id === 'healingPill',
    );
    expect(pillPanel?.owned).toBe(1);
  });

  it('丹药库存不足：INVALID_STATUS（丹药库存不足），库存与灵石都不动', async () => {
    const sect = await makeSect('shp-pill-short');
    await freezeSettlement(sect.sectId);
    await setBalance(sect.sectId, 'spiritStone', 0);

    // 没有库存行 = 0 颗：被拒且不建库存行、不发灵石。
    const beforeEmpty = await shopSnapshot(sect);
    const empty = await sellPill(sect, { pillId: 'healingPill', quantity: 1 });
    expect(empty.status).toBe(409);
    expect(errorOf(empty).code).toBe('INVALID_STATUS');
    expect(errorOf(empty).message).toBe('丹药库存不足');
    await expectShopUnchanged(sect, beforeEmpty);
    expect(await pillQuantityOf(sect.sectId, 'healingPill')).toBe(0);

    // 只有 1 颗却卖 2 颗，同样被拒。
    await setPillQuantity(sect.sectId, 'healingPill', 1);
    const beforeShort = await shopSnapshot(sect);
    const short = await sellPill(sect, { pillId: 'healingPill', quantity: 2 });
    expect(short.status).toBe(409);
    const error = errorOf(short);
    expect(error.code).toBe('INVALID_STATUS');
    expect(error.message).toBe('丹药库存不足');

    await expectShopUnchanged(sect, beforeShort);
    expect(await pillQuantityOf(sect.sectId, 'healingPill')).toBe(1);
    expect(await balanceOf(sect.sectId, 'spiritStone')).toBe(0);
  });

  it('未知丹方：NOT_FOUND，不扣库存、不发灵石、不建库存行', async () => {
    const sect = await makeSect('shp-pill-unknown');
    await freezeSettlement(sect.sectId);
    await setBalance(sect.sectId, 'spiritStone', 0);

    const rejected = await sellPill(sect, { pillId: 'unknownPill', quantity: 1 });
    expect(rejected.status).toBe(404);
    expect(errorOf(rejected).code).toBe('NOT_FOUND');
    expect(await balanceOf(sect.sectId, 'spiritStone')).toBe(0);
    const rows = await env.DB.prepare(
      'SELECT COUNT(*) AS total FROM pill_inventories WHERE sect_id = ?',
    )
      .bind(sect.sectId)
      .first<{ total: number }>();
    expect(Number(rows!.total)).toBe(0);
  });
});

/* ---------- 非法参数与不可交易资源（计划 2.1 / 7.2-7、9） ---------- */

describe('坊市：非法参数与不可交易资源', () => {
  it('灵石 / 灵气 / 未知 id 都不能买卖（schema 白名单，400，余额不动）', async () => {
    const sect = await makeSect('shp-bad-res');
    await freezeSettlement(sect.sectId);
    await setBalance(sect.sectId, 'spiritStone', 100_000);
    await setBalance(sect.sectId, 'spiritualEnergy', 50_000);
    await setBalance(sect.sectId, 'herb', 10_000);
    const before = await shopSnapshot(sect);

    for (const resourceId of ['spiritStone', 'spiritualEnergy', 'wood']) {
      const bought = await buy(sect, { resourceId, amount: 1 });
      expect(bought.status, `买入 ${resourceId}`).toBe(400);
      expect(errorOf(bought).code).toBe('VALIDATION_ERROR');

      const sold = await sell(sect, { resourceId, amount: 1 });
      expect(sold.status, `卖出 ${resourceId}`).toBe(400);
      expect(errorOf(sold).code).toBe('VALIDATION_ERROR');
    }

    await expectShopUnchanged(sect, before);
  });

  it('amount = 0 / 负数 / 非整数 / 超上限 → 400（买入与卖出都被挡）', async () => {
    const sect = await makeSect('shp-bad-amount');
    await freezeSettlement(sect.sectId);
    await setBalance(sect.sectId, 'spiritStone', 1_000_000);
    await setBalance(sect.sectId, 'herb', 1_000_000);
    const before = await shopSnapshot(sect);

    for (const amount of [0, -1, 1.5, SHOP_MAX_TRADE_AMOUNT + 1]) {
      const bought = await buy(sect, { resourceId: 'herb', amount });
      expect(bought.status, `买入 amount=${String(amount)}`).toBe(400);
      expect(errorOf(bought).code).toBe('VALIDATION_ERROR');

      const sold = await sell(sect, { resourceId: 'herb', amount });
      expect(sold.status, `卖出 amount=${String(amount)}`).toBe(400);
      expect(errorOf(sold).code).toBe('VALIDATION_ERROR');
    }

    await expectShopUnchanged(sect, before);
  });

  it('quantity = 0 / 负数 / 超上限 → 400（售丹）', async () => {
    const sect = await makeSect('shp-bad-quantity');
    await freezeSettlement(sect.sectId);
    await setPillQuantity(sect.sectId, 'healingPill', 2);
    await setBalance(sect.sectId, 'spiritStone', 0);

    for (const quantity of [0, -1, SHOP_MAX_PILL_QUANTITY + 1]) {
      const rejected = await sellPill(sect, { pillId: 'healingPill', quantity });
      expect(rejected.status, `售丹 quantity=${String(quantity)}`).toBe(400);
      expect(errorOf(rejected).code).toBe('VALIDATION_ERROR');
    }

    expect(await pillQuantityOf(sect.sectId, 'healingPill')).toBe(2);
    expect(await balanceOf(sect.sectId, 'spiritStone')).toBe(0);
  });
});

/* ---------- 面板（GET /game/sync，计划 4.1 / 7.2-11） ---------- */

describe('坊市面板：1 级宗门即可交易', () => {
  it('state.shop 结构完整：买卖价 + 三种丹方（名称 / 回收价 / 库存）+ 材料页数据', async () => {
    const sect = await makeSect('shp-panel');
    await freezeSettlement(sect.sectId);
    await setBalance(sect.sectId, 'herb', 12_000);
    await setBalance(sect.sectId, 'ore', 3_000);
    await setPillQuantity(sect.sectId, 'cultivationPill', 2);

    const state = await sect.state();
    const shop = state.shop as Record<string, unknown>;
    // 结构就是三个键：没有 unlocked / blockedReason —— 坊市不设解锁条件。
    expect(Object.keys(shop).sort()).toEqual(['buyPrice', 'pills', 'sellPrice']);
    expect(shop.buyPrice).toBe(SHOP_BUY_PRICE);
    expect(shop.sellPrice).toBe(SHOP_SELL_PRICE);

    // 售丹页的数据：三种丹方齐全（库存 0 也要下发展示），价格与库存都来自服务端。
    const pills = shop.pills as Record<string, any>[];
    expect(pills.map((pill) => pill.id)).toEqual([...PILL_IDS]);
    for (const pill of pills) {
      expect(pill.name).toBe(findPillRecipe(pill.id)!.name);
      expect(pill.sellPrice).toBe(SHOP_PILL_PRICES[pill.id]);
      expect(pill.owned).toBe(await pillQuantityOf(sect.sectId, pill.id));
    }
    expect(pills.find((pill) => pill.id === 'cultivationPill')?.owned).toBe(2);

    // 买入 / 卖出页的数据：可交易材料的名称与余额来自 state.resources。
    const resources = state.resources as Record<string, any>[];
    for (const resourceId of SHOP_TRADABLE_RESOURCES) {
      const view = resources.find((item) => item.id === resourceId);
      expect(view, `面板里必须有 ${resourceId}`).toBeTruthy();
      expect(typeof view!.name).toBe('string');
      expect(view!.balance).toBe(String(await balanceOf(sect.sectId, resourceId)));
    }

    // 1 级宗门（默认等级、无建筑）真的能交易 —— 不走赌坊 / 炼丹那样的解锁前置。
    const bought = await buy(sect, { resourceId: 'ore', amount: 1 });
    expect(bought.status).toBe(200);
    expect(await balanceOf(sect.sectId, 'ore')).toBe(3_000 + toMinUnits(1));
  });
});
