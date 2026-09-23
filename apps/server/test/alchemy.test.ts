import { applyD1Migrations, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { prepareStatements } from '../src/infra/db/repository';
import { REQUIRED_TABLES } from '../src/infra/db/readiness';
import { PILL_IDS } from '../src/modules/game/alchemy';
import {
  BuildingRepository,
  DiscipleRepository,
  PillInventoryRepository,
  ResourceBalanceRepository,
  SectRepository,
  alchemySnapshotGuardStatement,
  deleteAlchemySnapshotGuardStatement,
} from '../src/modules/game/repository';

import { dataOf, errorOf, TestClient } from './support/authClient';

/**
 * 丹药系统（0011 迁移 + alchemy.ts + craft-pill/use-pill）。
 *
 * 存储说明（@cloudflare/vitest-pool-workers 0.22+）：本文件一份独立内存 D1，但**没有逐用例回滚**。
 * 因此每个用例用独立账号/宗门（自带主键），涉及计数的断言都按宗门 id 定界，不假设上一个用例的数据消失。
 *
 * 确定性说明：craft/use 都会先做离线结算（SectDraft 构造期），真实 elapsed 会让随机事件
 * 影响资源余额。需要精确断言余额的用例，先把 sects.last_settled_at 拨到未来（clock 回拨 →
 * durationMs = 0 → 零产出、零事件）。「craft 先结算」用例则拨到 1 小时前，用下界断言
 * （事件对 herb 只加不减、对 spiritStone 的最坏扣除也有余量），对所有随机结果都成立。
 */

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

const quietLogger = { info: () => {}, warn: () => {}, error: () => {} } as const;
const app = createApp({ logger: quietLogger });
const PASSWORD = 'password-123456';

let accountSeq = 0;

interface SectFixture {
  api: TestClient;
  sectId: string;
  discipleIds: string[];
  state: () => Promise<Record<string, any>>;
}

async function makeSect(): Promise<SectFixture> {
  accountSeq += 1;
  const account = `alch-${accountSeq}`;
  const ip = `10.7.${Math.floor(accountSeq / 250)}.${accountSeq % 250}`;
  const api = new TestClient(app, env, { 'cf-connecting-ip': ip });

  const registered = await api.post('/api/v1/auth/register', { account, password: PASSWORD });
  expect(registered.status).toBe(200);
  const created = await api.post('/api/v1/game/create-sect', { name: `丹房宗${accountSeq}` });
  expect(created.status).toBe(200);

  const state = dataOf(created) as Record<string, any>;
  const sectId = state.state.sect.id as string;
  const discipleIds = (state.state.disciples as { id: string }[]).map((d) => d.id);

  return {
    api,
    sectId,
    discipleIds,
    state: async () => {
      const result = await api.get('/api/v1/game/sync');
      expect(result.status).toBe(200);
      return (dataOf(result) as Record<string, any>).state;
    },
  };
}

/** 直接把资源余额写成指定值（绕开结算/事件，用于精确断言）。 */
async function setBalance(sectId: string, resourceId: string, balance: number): Promise<void> {
  await env.DB.prepare(
    'UPDATE resource_balances SET balance = ? WHERE sect_id = ? AND resource_id = ?',
  )
    .bind(balance, sectId, resourceId)
    .run();
}

/** 把 last_settled_at 拨到未来：下次结算 elapsed=0（时钟回拨），零产出零事件，完全确定。 */
async function freezeSettlement(sectId: string): Promise<void> {
  await env.DB.prepare('UPDATE sects SET last_settled_at = ? WHERE id = ?')
    .bind(Date.now() + 60_000, sectId)
    .run();
}

/** 解锁炼丹：宗门 2 级 + 灵药园 2 级（直接改库；走完整升级链路与本测试主题无关）。 */
async function unlockAlchemy(sectId: string): Promise<void> {
  await env.DB.prepare('UPDATE sects SET level = 2 WHERE id = ?').bind(sectId).run();
  await env.DB.prepare('UPDATE buildings SET level = 2 WHERE sect_id = ? AND def_id = ?')
    .bind(sectId, 'herbGarden')
    .run();
}

async function setPillStock(sectId: string, pillId: string, quantity: number): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO pill_inventories (id, sect_id, pill_id, quantity, updated_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(crypto.randomUUID(), sectId, pillId, quantity, Date.now())
    .run();
}

async function pillRowCount(sectId: string): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS total FROM pill_inventories WHERE sect_id = ?',
  )
    .bind(sectId)
    .first<{ total: number }>();
  return Number(row?.total ?? 0);
}

async function pillQuantity(sectId: string, pillId: string): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT quantity FROM pill_inventories WHERE sect_id = ? AND pill_id = ?',
  )
    .bind(sectId, pillId)
    .first<{ quantity: number }>();
  return row === null ? 0 : Number(row.quantity);
}

async function dbBalance(sectId: string, resourceId: string): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT balance FROM resource_balances WHERE sect_id = ? AND resource_id = ?',
  )
    .bind(sectId, resourceId)
    .first<{ balance: number }>();
  return Number(row?.balance ?? 0);
}

function recipeOf(state: Record<string, any>, pillId: string): Record<string, any> {
  const recipes = state.alchemy.recipes as Record<string, any>[];
  const recipe = recipes.find((item) => item.id === pillId);
  expect(recipe, `sync 应返回配方 ${pillId}`).toBeTruthy();
  return recipe as Record<string, any>;
}

describe('丹药系统：迁移与库存表', () => {
  it('0011 迁移成功：required tables 含 pill_inventories，ready 通过且迁移数与文件数一致', async () => {
    expect(REQUIRED_TABLES).toContain('pill_inventories');

    const response = await app.request(
      'https://example.com/api/v1/health/ready',
      undefined,
      env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      data: { status: string; appliedMigrations: number };
    };
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe('ready');
    expect(body.data.appliedMigrations).toBe(env.TEST_MIGRATIONS.length);
  });

  it('已有弟子迁移后 body_tempering_count 默认 0（不写该列的插入语句兼容）', async () => {
    const sect = await makeSect();
    await env.DB.prepare(
      `INSERT INTO disciples
         (id, sect_id, name, gender, aptitude, attack, defense, speed, talent,
          realm_id, stage, cultivation, cultivation_remainder, assignment, injured_until, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, NULL, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        sect.sectId,
        '迁移老弟子',
        'male',
        50,
        50,
        50,
        50,
        'none',
        'qiRefining',
        1,
        'idle',
        Date.now(),
      )
      .run();

    const row = await env.DB.prepare(
      'SELECT body_tempering_count FROM disciples WHERE sect_id = ? AND name = ?',
    )
      .bind(sect.sectId, '迁移老弟子')
      .first<{ body_tempering_count: number }>();
    expect(Number(row?.body_tempering_count)).toBe(0);
  });

  it('pill_inventories.quantity 有 CHECK >= 0 约束', async () => {
    const sect = await makeSect();
    const error = await env.DB.prepare(
      'INSERT INTO pill_inventories (id, sect_id, pill_id, quantity, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(crypto.randomUUID(), sect.sectId, 'healingPill', -1, Date.now())
      .run()
      .then(
        () => null,
        (caught: unknown) => caught,
      );
    expect(error).not.toBeNull();
  });

  it('同一宗门同一 pill_id 唯一（UNIQUE 约束）', async () => {
    const sect = await makeSect();
    const insert = (): Promise<unknown> =>
      env.DB.prepare(
        'INSERT INTO pill_inventories (id, sect_id, pill_id, quantity, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
        .bind(crypto.randomUUID(), sect.sectId, 'cultivationPill', 1, Date.now())
        .run();
    await insert();
    const error = await insert().then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).not.toBeNull();
    // 不同 pill_id 不冲突
    await setPillStock(sect.sectId, 'healingPill', 2);
    expect(await pillQuantity(sect.sectId, 'healingPill')).toBe(2);
  });
});

describe('丹药系统：并发快照守卫', () => {
  it('资源快照过期时整批回滚，不产生免费丹药', async () => {
    const sect = await makeSect();
    await unlockAlchemy(sect.sectId);
    await freezeSettlement(sect.sectId);
    await setBalance(sect.sectId, 'herb', 100_000);

    const savedSect = await new SectRepository(env.DB).findById(sect.sectId);
    expect(savedSect).not.toBeNull();
    const guardId = crypto.randomUUID();
    const guard = alchemySnapshotGuardStatement(guardId, {
      sect: savedSect!,
      balances: await new ResourceBalanceRepository(env.DB).findBySectId(sect.sectId),
      buildings: await new BuildingRepository(env.DB).findBySectId(sect.sectId),
      pillId: 'healingPill',
      pillQuantity: 0,
    });

    // 另一个请求已经消耗了药材，旧草稿不能继续创建库存。
    await setBalance(sect.sectId, 'herb', 90_000);
    await expect(env.DB.batch(prepareStatements(env.DB, [
      guard,
      { sql: 'INSERT INTO pill_inventories (id, sect_id, pill_id, quantity, updated_at) VALUES (?, ?, ?, ?, ?)',
        params: [crypto.randomUUID(), sect.sectId, 'healingPill', 1, Date.now()] },
      deleteAlchemySnapshotGuardStatement(guardId),
    ]))).rejects.toThrow(/mutation_guards|valid = 1/);
    expect(await pillRowCount(sect.sectId)).toBe(0);
    expect(await dbBalance(sect.sectId, 'herb')).toBe(90_000);
  });

  it('库存快照过期时整批回滚，不允许第二次服用同一颗丹药', async () => {
    const sect = await makeSect();
    await unlockAlchemy(sect.sectId);
    await freezeSettlement(sect.sectId);
    await setPillStock(sect.sectId, 'healingPill', 1);
    const discipleId = sect.discipleIds[0] as string;
    const injury = Date.now() + 600_000;
    await env.DB.prepare('UPDATE disciples SET injured_until = ? WHERE id = ?')
      .bind(injury, discipleId).run();

    const savedSect = await new SectRepository(env.DB).findById(sect.sectId);
    expect(savedSect).not.toBeNull();
    const guardId = crypto.randomUUID();
    const disciple = (await new DiscipleRepository(env.DB).findBySectId(sect.sectId))
      .find((row) => row.id === discipleId);
    expect(disciple).toBeDefined();
    const guard = alchemySnapshotGuardStatement(guardId, {
      sect: savedSect!,
      balances: await new ResourceBalanceRepository(env.DB).findBySectId(sect.sectId),
      buildings: await new BuildingRepository(env.DB).findBySectId(sect.sectId),
      pillId: 'healingPill',
      pillQuantity: 1,
      disciple: disciple!,
    });

    await env.DB.prepare('UPDATE pill_inventories SET quantity = 0 WHERE sect_id = ? AND pill_id = ?')
      .bind(sect.sectId, 'healingPill').run();
    await expect(env.DB.batch(prepareStatements(env.DB, [
      guard,
      { sql: 'UPDATE disciples SET injured_until = NULL WHERE id = ?', params: [discipleId] },
      deleteAlchemySnapshotGuardStatement(guardId),
    ]))).rejects.toThrow(/mutation_guards|valid = 1/);
    expect(await pillQuantity(sect.sectId, 'healingPill')).toBe(0);
    const current = await env.DB.prepare('SELECT injured_until FROM disciples WHERE id = ?')
      .bind(discipleId).first<{ injured_until: number | null }>();
    expect(current?.injured_until).toBe(injury);
    expect(await new PillInventoryRepository(env.DB).findBySectId(sect.sectId)).toHaveLength(1);
  });
});

describe('丹药系统：解锁与配方', () => {
  it('宗门等级不足：craft 与 use 都返回 INVALID_STATUS，sync 标记未解锁', async () => {
    const sect = await makeSect();
    const craft = await sect.api.post('/api/v1/game/craft-pill', {
      pillId: 'healingPill',
      quantity: 1,
    });
    expect(craft.status).toBe(409);
    expect(errorOf(craft).code).toBe('INVALID_STATUS');

    const use = await sect.api.post('/api/v1/game/use-pill', {
      pillId: 'healingPill',
      discipleId: sect.discipleIds[0],
    });
    expect(errorOf(use).code).toBe('INVALID_STATUS');

    const state = await sect.state();
    expect(state.alchemy.unlocked).toBe(false);
    expect(state.alchemy.blockedReason).toContain('宗门 2 级');
    expect(await pillRowCount(sect.sectId)).toBe(0);
  });

  it('宗门 2 级但灵药园 1 级：仍不能炼制/服用', async () => {
    const sect = await makeSect();
    await env.DB.prepare('UPDATE sects SET level = 2 WHERE id = ?').bind(sect.sectId).run();

    const craft = await sect.api.post('/api/v1/game/craft-pill', {
      pillId: 'healingPill',
      quantity: 1,
    });
    expect(errorOf(craft).code).toBe('INVALID_STATUS');
    expect(errorOf(craft).message).toContain('灵药园');

    const use = await sect.api.post('/api/v1/game/use-pill', {
      pillId: 'healingPill',
      discipleId: sect.discipleIds[0],
    });
    expect(errorOf(use).code).toBe('INVALID_STATUS');
  });

  it('解锁后 sync 返回三种配方、库存 0、canCraft 按余额判定', async () => {
    const sect = await makeSect();
    await unlockAlchemy(sect.sectId);

    const state = await sect.state();
    expect(state.alchemy.unlocked).toBe(true);
    expect(state.alchemy.blockedReason).toBeNull();
    expect(state.alchemy.recipes).toHaveLength(3);
    for (const pillId of PILL_IDS) {
      const recipe = recipeOf(state, pillId);
      expect(recipe.owned).toBe(0);
      // 初始资源足够每种丹药炼一颗
      expect(recipe.canCraft).toBe(true);
      expect(recipe.blockedReason).toBeNull();
    }
  });

  it('未知 pill id 返回 NOT_FOUND，不写库', async () => {
    const sect = await makeSect();
    await unlockAlchemy(sect.sectId);

    const craft = await sect.api.post('/api/v1/game/craft-pill', {
      pillId: 'doesNotExist',
      quantity: 1,
    });
    expect(craft.status).toBe(404);
    expect(errorOf(craft).code).toBe('NOT_FOUND');

    const use = await sect.api.post('/api/v1/game/use-pill', {
      pillId: 'doesNotExist',
      discipleId: sect.discipleIds[0],
    });
    expect(errorOf(use).code).toBe('NOT_FOUND');

    expect(await pillRowCount(sect.sectId)).toBe(0);
  });
});

describe('丹药系统：炼制', () => {
  it('炼制 1 颗正确扣资源、增加库存，响应 state 与 DB 一致', async () => {
    const sect = await makeSect();
    await unlockAlchemy(sect.sectId);
    await setBalance(sect.sectId, 'herb', 100_000);
    await setBalance(sect.sectId, 'spiritStone', 200_000);
    await freezeSettlement(sect.sectId);

    const result = await sect.api.post('/api/v1/game/craft-pill', {
      pillId: 'healingPill',
      quantity: 1,
    });
    expect(result.status).toBe(200);
    const data = dataOf(result) as Record<string, any>;

    // outcome 契约
    expect(data.outcome.pillId).toBe('healingPill');
    expect(data.outcome.pillName).toBe('回春丹');
    expect(data.outcome.quantity).toBe(1);
    expect(data.outcome.cost).toEqual({ herb: '10000', spiritStone: '15000' });

    // state 契约：余额与库存同步更新
    const balances = Object.fromEntries(
      (data.state.resources as { id: string; balance: string }[]).map((r) => [r.id, r.balance]),
    );
    expect(balances.herb).toBe('90000');
    expect(balances.spiritStone).toBe('185000');
    expect(recipeOf(data.state, 'healingPill').owned).toBe(1);

    expect(await dbBalance(sect.sectId, 'herb')).toBe(90_000);
    expect(await pillQuantity(sect.sectId, 'healingPill')).toBe(1);
    const guardRows = await env.DB.prepare('SELECT COUNT(*) AS total FROM mutation_guards')
      .first<{ total: number }>();
    expect(guardRows?.total).toBe(0);
  });

  it('炼制数量 1~5 生效；0、负数、小数、超过 5 被 VALIDATION_ERROR 拒绝', async () => {
    const sect = await makeSect();
    await unlockAlchemy(sect.sectId);
    await freezeSettlement(sect.sectId);
    await setBalance(sect.sectId, 'herb', 500_000);
    await setBalance(sect.sectId, 'spiritualEnergy', 500_000);
    await setBalance(sect.sectId, 'spiritStone', 500_000);

    const result = await sect.api.post('/api/v1/game/craft-pill', {
      pillId: 'cultivationPill',
      quantity: 3,
    });
    expect(result.status).toBe(200);
    const data = dataOf(result) as Record<string, any>;
    expect(data.outcome.cost).toEqual({
      herb: '75000',
      spiritualEnergy: '45000',
      spiritStone: '30000',
    });
    expect(recipeOf(data.state, 'cultivationPill').owned).toBe(3);
    expect(await pillQuantity(sect.sectId, 'cultivationPill')).toBe(3);

    for (const quantity of [0, -1, 1.5, 6]) {
      const rejected = await sect.api.post('/api/v1/game/craft-pill', {
        pillId: 'cultivationPill',
        quantity,
      });
      expect(rejected.status).toBe(400);
      expect(errorOf(rejected).code).toBe('VALIDATION_ERROR');
    }
    expect(await pillQuantity(sect.sectId, 'cultivationPill')).toBe(3);
  });

  it('资源不足整次失败：不扣资源、不增加库存', async () => {
    const sect = await makeSect();
    await unlockAlchemy(sect.sectId);
    await freezeSettlement(sect.sectId);
    await setBalance(sect.sectId, 'herb', 9_999);
    await setBalance(sect.sectId, 'spiritStone', 200_000);

    const rejected = await sect.api.post('/api/v1/game/craft-pill', {
      pillId: 'healingPill',
      quantity: 2,
    });
    expect(errorOf(rejected).code).toBe('INSUFFICIENT_RESOURCE');

    expect(await dbBalance(sect.sectId, 'herb')).toBe(9_999);
    expect(await dbBalance(sect.sectId, 'spiritStone')).toBe(200_000);
    expect(await pillRowCount(sect.sectId)).toBe(0);
  });

  it('多次炼制复用同一库存行（不产生重复行）', async () => {
    const sect = await makeSect();
    await unlockAlchemy(sect.sectId);
    await freezeSettlement(sect.sectId);
    await setBalance(sect.sectId, 'herb', 400_000);
    await setBalance(sect.sectId, 'ore', 400_000);
    await setBalance(sect.sectId, 'spiritStone', 400_000);

    for (let round = 0; round < 2; round += 1) {
      const result = await sect.api.post('/api/v1/game/craft-pill', {
        pillId: 'bodyTemperingPill',
        quantity: 1,
      });
      expect(result.status).toBe(200);
    }

    expect(await pillRowCount(sect.sectId)).toBe(1);
    expect(await pillQuantity(sect.sectId, 'bodyTemperingPill')).toBe(2);
  });

  it('craft 会先结算离线收益：herb 为 0 时靠 1 小时药园产出完成炼制', async () => {
    const sect = await makeSect();
    await unlockAlchemy(sect.sectId);
    // 初始弟子里有一位在药园岗位（herb 20000/小时）。把 herb 清零、结算时间拨到 1 小时前。
    await setBalance(sect.sectId, 'herb', 0);
    await setBalance(sect.sectId, 'spiritStone', 300_000);
    await env.DB.prepare('UPDATE sects SET last_settled_at = ? WHERE id = ?')
      .bind(Date.now() - 3_600_000, sect.sectId)
      .run();

    const result = await sect.api.post('/api/v1/game/craft-pill', {
      pillId: 'healingPill',
      quantity: 1,
    });
    expect(result.status).toBe(200);
    const data = dataOf(result) as Record<string, any>;

    // 结算至少产出 20000 药材（事件对 herb 只加不减），炼制消耗 10000，余额 >= 10000。
    const herb = Number(
      (data.state.resources as { id: string; balance: string }[]).find((r) => r.id === 'herb')
        ?.balance ?? 0,
    );
    expect(herb).toBeGreaterThanOrEqual(10_000);
    expect(await pillQuantity(sect.sectId, 'healingPill')).toBe(1);
  });
});

describe('丹药系统：服用', () => {
  it('回春丹：清除有效伤势并扣库存；无伤弟子被拒绝且不扣库存', async () => {
    const sect = await makeSect();
    await unlockAlchemy(sect.sectId);
    await freezeSettlement(sect.sectId);
    await setPillStock(sect.sectId, 'healingPill', 2);

    const injuredUntil = Date.now() + 10 * 60 * 1000;
    const discipleId = sect.discipleIds[0] as string;
    await env.DB.prepare('UPDATE disciples SET injured_until = ? WHERE id = ?')
      .bind(injuredUntil, discipleId)
      .run();

    const result = await sect.api.post('/api/v1/game/use-pill', {
      pillId: 'healingPill',
      discipleId,
    });
    expect(result.status).toBe(200);
    const data = dataOf(result) as Record<string, any>;
    expect(data.outcome.effect).toEqual({ kind: 'heal' });
    expect(data.outcome.discipleName).toBeTruthy();

    const healed = (data.state.disciples as { id: string; injuredUntil: string | null }[]).find(
      (d) => d.id === discipleId,
    );
    expect(healed?.injuredUntil).toBeNull();
    expect(await pillQuantity(sect.sectId, 'healingPill')).toBe(1);

    // 再服一次：已经没有伤势 → INVALID_STATUS，库存不动
    const rejected = await sect.api.post('/api/v1/game/use-pill', {
      pillId: 'healingPill',
      discipleId,
    });
    expect(errorOf(rejected).code).toBe('INVALID_STATUS');
    expect(await pillQuantity(sect.sectId, 'healingPill')).toBe(1);
  });

  it('聚气丹：增加修为但不超过阶段门槛；满门槛/最高阶段弟子不能用', async () => {
    const sect = await makeSect();
    await unlockAlchemy(sect.sectId);
    await freezeSettlement(sect.sectId);
    await setPillStock(sect.sectId, 'cultivationPill', 5);

    const discipleId = sect.discipleIds[0] as string;
    // 修为 25 / 门槛 30：gain 被 min(120, 30-25) 截断为 5，超出部分不保留。
    await env.DB.prepare('UPDATE disciples SET cultivation = 25 WHERE id = ?')
      .bind(discipleId)
      .run();

    const result = await sect.api.post('/api/v1/game/use-pill', {
      pillId: 'cultivationPill',
      discipleId,
    });
    expect(result.status).toBe(200);
    const data = dataOf(result) as Record<string, any>;
    expect(data.outcome.effect).toEqual({ kind: 'cultivation', gain: 5 });
    const after = (data.state.disciples as { id: string; cultivation: number }[]).find(
      (d) => d.id === discipleId,
    );
    expect(after?.cultivation).toBe(30);
    expect(await pillQuantity(sect.sectId, 'cultivationPill')).toBe(4);

    // 已满门槛：拒绝（提示先突破），库存不动
    const atThreshold = await sect.api.post('/api/v1/game/use-pill', {
      pillId: 'cultivationPill',
      discipleId,
    });
    expect(errorOf(atThreshold).code).toBe('INVALID_STATUS');
    expect(errorOf(atThreshold).message).toContain('突破');
    expect(await pillQuantity(sect.sectId, 'cultivationPill')).toBe(4);

    // 最高阶段弟子（requiredCultivation = null）：拒绝
    const topId = sect.discipleIds[1] as string;
    await env.DB.prepare(
      "UPDATE disciples SET realm_id = 'spiritTransformation', stage = 3, cultivation = 0 WHERE id = ?",
    )
      .bind(topId)
      .run();
    const topRejected = await sect.api.post('/api/v1/game/use-pill', {
      pillId: 'cultivationPill',
      discipleId: topId,
    });
    expect(errorOf(topRejected).code).toBe('INVALID_STATUS');
    expect(await pillQuantity(sect.sectId, 'cultivationPill')).toBe(4);
  });

  it('淬体丹：自动补最明显短板（32/76/76→攻 +5）；没有短板时拒绝', async () => {
    const sect = await makeSect();
    await unlockAlchemy(sect.sectId);
    await freezeSettlement(sect.sectId);
    await setPillStock(sect.sectId, 'bodyTemperingPill', 3);

    const discipleId = sect.discipleIds[0] as string;
    await env.DB.prepare('UPDATE disciples SET attack = 32, defense = 76, speed = 70 WHERE id = ?')
      .bind(discipleId)
      .run();

    // 先验证 sync 给出的服务端短板预览：攻 gap 41 最大，gain 5。
    let state = await sect.state();
    let preview = (state.disciples as Record<string, any>[]).find((d) => d.id === discipleId);
    expect(preview?.bodyTemperingTarget).toBe('attack');
    expect(preview?.bodyTemperingGain).toBe(5);
    expect(preview?.bodyTemperingUses).toBe(0);
    expect(preview?.bodyTemperingRemaining).toBe(10);

    const result = await sect.api.post('/api/v1/game/use-pill', {
      pillId: 'bodyTemperingPill',
      discipleId,
    });
    expect(result.status).toBe(200);
    const data = dataOf(result) as Record<string, any>;
    expect(data.outcome.effect).toEqual({ kind: 'bodyTempering', gain: 5, attribute: 'attack' });
    const after = (data.state.disciples as Record<string, any>[]).find((d) => d.id === discipleId);
    expect(after?.attack).toBe(37);
    expect(after?.defense).toBe(76);
    expect(after?.speed).toBe(70);
    expect(after?.bodyTemperingUses).toBe(1);
    expect(await pillQuantity(sect.sectId, 'bodyTemperingPill')).toBe(2);

    // 三项均衡：没有可补短板 → INVALID_STATUS 且不扣库存
    const balancedId = sect.discipleIds[1] as string;
    await env.DB.prepare('UPDATE disciples SET attack = 50, defense = 50, speed = 50 WHERE id = ?')
      .bind(balancedId)
      .run();
    const rejected = await sect.api.post('/api/v1/game/use-pill', {
      pillId: 'bodyTemperingPill',
      discipleId: balancedId,
    });
    expect(errorOf(rejected).code).toBe('INVALID_STATUS');
    expect(await pillQuantity(sect.sectId, 'bodyTemperingPill')).toBe(2);

    state = await sect.state();
    preview = (state.disciples as Record<string, any>[]).find((d) => d.id === balancedId);
    expect(preview?.bodyTemperingTarget).toBeNull();
  });

  it('淬体丹：属性不会超过 100，10 次上限后拒绝且预览为空', async () => {
    const sect = await makeSect();
    await unlockAlchemy(sect.sectId);
    await freezeSettlement(sect.sectId);
    await setPillStock(sect.sectId, 'bodyTemperingPill', 5);

    const discipleId = sect.discipleIds[0] as string;
    // 攻 90 / 防 84 / 速 84：攻 gap = 84 - 90 < 0 不可补；防与速 gap 同为 3 → 选防，
    // gain = min(5, max(1, 1 + 0)=1, 100-84=16) = 1（小差距每次只 +1 的递减路径）。
    await env.DB.prepare('UPDATE disciples SET attack = 90, defense = 84, speed = 84 WHERE id = ?')
      .bind(discipleId)
      .run();

    const result = await sect.api.post('/api/v1/game/use-pill', {
      pillId: 'bodyTemperingPill',
      discipleId,
    });
    expect(result.status).toBe(200);
    const data = dataOf(result) as Record<string, any>;
    expect(data.outcome.effect).toEqual({ kind: 'bodyTempering', gain: 1, attribute: 'defense' });

    // 用满 10 次：直接把计数拨到 10，再服用被拒绝，sync 预览为空、剩余 0。
    await env.DB.prepare('UPDATE disciples SET body_tempering_count = 10 WHERE id = ?')
      .bind(discipleId)
      .run();
    const rejected = await sect.api.post('/api/v1/game/use-pill', {
      pillId: 'bodyTemperingPill',
      discipleId,
    });
    expect(errorOf(rejected).code).toBe('INVALID_STATUS');
    expect(errorOf(rejected).message).toContain('10');

    const state = await sect.state();
    const preview = (state.disciples as Record<string, any>[]).find((d) => d.id === discipleId);
    expect(preview?.bodyTemperingTarget).toBeNull();
    expect(preview?.bodyTemperingRemaining).toBe(0);
  });

  it('不能把其他宗门的弟子作为服药目标', async () => {
    const mine = await makeSect();
    const other = await makeSect();
    await unlockAlchemy(mine.sectId);
    await freezeSettlement(mine.sectId);
    await setPillStock(mine.sectId, 'healingPill', 1);

    // 给对方弟子制造一个有效伤势：如果归属校验被绕过，回春丹会把它清掉。
    const foreignDiscipleId = other.discipleIds[0] as string;
    const foreignInjury = Date.now() + 10 * 60 * 1000;
    await env.DB.prepare('UPDATE disciples SET injured_until = ? WHERE id = ?')
      .bind(foreignInjury, foreignDiscipleId)
      .run();

    const result = await mine.api.post('/api/v1/game/use-pill', {
      pillId: 'healingPill',
      discipleId: foreignDiscipleId,
    });
    expect(result.status).toBe(404);
    expect(errorOf(result).code).toBe('NOT_FOUND');
    expect(await pillQuantity(mine.sectId, 'healingPill')).toBe(1);
    // 对方宗门的弟子没有被改动（伤势原样保留）
    const row = await env.DB.prepare('SELECT injured_until FROM disciples WHERE id = ?')
      .bind(foreignDiscipleId)
      .first<{ injured_until: number | null }>();
    expect(Number(row?.injured_until)).toBe(foreignInjury);
  });

  it('库存不足时服药返回 INVALID_STATUS（丹药库存不足）', async () => {
    const sect = await makeSect();
    await unlockAlchemy(sect.sectId);
    await freezeSettlement(sect.sectId);
    await setPillStock(sect.sectId, 'healingPill', 0);

    // 弟子确实有伤势，让校验走到库存检查那一层。
    const discipleId = sect.discipleIds[0] as string;
    await env.DB.prepare('UPDATE disciples SET injured_until = ? WHERE id = ?')
      .bind(Date.now() + 10 * 60 * 1000, discipleId)
      .run();

    const result = await sect.api.post('/api/v1/game/use-pill', {
      pillId: 'healingPill',
      discipleId,
    });
    expect(errorOf(result).code).toBe('INVALID_STATUS');
    expect(errorOf(result).message).toContain('库存不足');
    // 弟子伤势没有被清除（失败不产生部分写入）
    const row = await env.DB.prepare('SELECT injured_until FROM disciples WHERE id = ?')
      .bind(discipleId)
      .first<{ injured_until: number | null }>();
    expect(row?.injured_until).not.toBeNull();
  });
});

describe('丹药系统：契约与中间件', () => {
  it('未登录调用 craft-pill 返回 401', async () => {
    const anonymous = new TestClient(app, env, { 'cf-connecting-ip': '10.7.254.1' });
    const result = await anonymous.post('/api/v1/game/craft-pill', {
      pillId: 'healingPill',
      quantity: 1,
    });
    expect(result.status).toBe(401);
    expect(errorOf(result).code).toBe('UNAUTHENTICATED');
  });

  it('缺 CSRF 与跨源写请求被现有中间件拒绝', async () => {
    const sect = await makeSect();
    await unlockAlchemy(sect.sectId);

    const noCsrf = await sect.api.post(
      '/api/v1/game/craft-pill',
      { pillId: 'healingPill', quantity: 1 },
      { csrfToken: null },
    );
    expect(noCsrf.status).toBe(403);
    expect(errorOf(noCsrf).code).toBe('CSRF_INVALID');

    const crossOrigin = await sect.api.post(
      '/api/v1/game/craft-pill',
      { pillId: 'healingPill', quantity: 1 },
      { origin: 'https://evil.example' },
    );
    expect(errorOf(crossOrigin).code).toBe('CSRF_INVALID');
    expect(await pillRowCount(sect.sectId)).toBe(0);
  });
});
