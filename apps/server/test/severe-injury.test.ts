import { applyD1Migrations, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { SEVERE_INJURY_MS, dateKeyUtc8 } from '../src/modules/game/constants';
import { attackWorldBoss, processWorldBoss } from '../src/modules/game/service';

import { dataOf, errorOf, TestClient, type ApiResult } from './support/authClient';

/**
 * 世界 Boss 二期 · 阶段一：弟子「重伤」（docs/世界Boss二期开发计划.md 1.5）。
 *
 * 覆盖：结算不产出/不修炼、产速显示排除、到期恢复、各类写接口被拦、
 * 回春丹专门文案、批量接口跳过、守擂自动按空位处理。
 *
 * 存储说明：本文件一份独立内存 D1，没有逐用例回滚 —— 每个用例用独立账号/宗门，
 * 断言都按宗门 id 定界。
 *
 * 时间说明：重伤是「按截止时间判断」的纯状态，直接把 severe_injured_until 写进库即可；
 * 结算窗口用「把 last_settled_at 拨回 1 小时 + 再 sync 一次」制造。
 */

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

const quietLogger = { info: () => {}, warn: () => {}, error: () => {} } as const;
const app = createApp({ logger: quietLogger });
const PASSWORD = 'password-123456';
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

let seq = 0;

interface SectFixture {
  api: TestClient;
  userId: string;
  sectId: string;
  discipleIds: string[];
  state: () => Promise<Record<string, any>>;
}

async function makeSect(prefix: string): Promise<SectFixture> {
  seq += 1;
  const account = `${prefix}-${seq}`;
  const api = new TestClient(app, env, {
    'cf-connecting-ip': `10.6.${Math.floor(seq / 250)}.${seq % 250}`,
  });
  const registered = await api.post('/api/v1/auth/register', { account, password: PASSWORD });
  expect(registered.status).toBe(200);
  const created = await api.post('/api/v1/game/create-sect', { name: `重伤${seq}号` });
  expect(created.status).toBe(200);
  const state = dataOf(created) as Record<string, any>;
  const sectId = state.state.sect.id as string;

  const row = await env.DB.prepare('SELECT user_id FROM sects WHERE id = ?')
    .bind(sectId)
    .first<{ user_id: string }>();
  expect(row).not.toBeNull();

  return {
    api,
    userId: row!.user_id,
    sectId,
    discipleIds: (state.state.disciples as { id: string }[]).map((item) => item.id),
    state: async () => {
      const result = await api.get('/api/v1/game/sync');
      expect(result.status).toBe(200);
      return (dataOf(result) as Record<string, any>).state;
    },
  };
}

/* ---------- 库的直接读写 ---------- */

async function setSevereInjury(discipleId: string, until: number | null): Promise<void> {
  await env.DB.prepare('UPDATE disciples SET severe_injured_until = ? WHERE id = ?')
    .bind(until, discipleId)
    .run();
}

async function setLastSettledAt(sectId: string, value: number): Promise<void> {
  await env.DB.prepare('UPDATE sects SET last_settled_at = ? WHERE id = ?').bind(value, sectId).run();
}

async function setSectLevel(sectId: string, level: number): Promise<void> {
  await env.DB.prepare('UPDATE sects SET level = ? WHERE id = ?').bind(level, sectId).run();
}

async function setBalance(sectId: string, resourceId: string, balance: number): Promise<void> {
  const updated = await env.DB.prepare(
    'UPDATE resource_balances SET balance = ?, remainder = 0 WHERE sect_id = ? AND resource_id = ?',
  )
    .bind(balance, sectId, resourceId)
    .run();
  if (Number(updated.meta.changes) > 0) return;
  await env.DB.prepare(
    `INSERT INTO resource_balances (id, sect_id, resource_id, balance, remainder, updated_at)
     VALUES (?, ?, ?, ?, 0, ?)`,
  )
    .bind(crypto.randomUUID(), sectId, resourceId, balance, Date.now())
    .run();
}

async function fillBalances(sectId: string): Promise<void> {
  for (const resourceId of ['spiritStone', 'spiritualEnergy', 'herb', 'ore']) {
    await setBalance(sectId, resourceId, 5_000_000);
  }
}

async function discipleRow(discipleId: string): Promise<Record<string, any>> {
  const row = await env.DB.prepare('SELECT * FROM disciples WHERE id = ?')
    .bind(discipleId)
    .first<Record<string, any>>();
  expect(row).not.toBeNull();
  return row!;
}

async function setPillQuantity(sectId: string, pillId: string, quantity: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO pill_inventories (id, sect_id, pill_id, quantity, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (sect_id, pill_id) DO UPDATE SET quantity = excluded.quantity`,
  )
    .bind(crypto.randomUUID(), sectId, pillId, quantity, Date.now())
    .run();
}

/** 以「今天的 UTC+8 日期」为第 0 天，取第 dayOffset 天 UTC+8 的 hour:minute。 */
function dayAt(dayOffset: number, hour: number, minute = 30): number {
  const parts = dateKeyUtc8(Date.now()).split('-').map(Number);
  return (
    Date.UTC(parts[0] ?? 1970, (parts[1] ?? 1) - 1, parts[2] ?? 1, hour - 8, minute) +
    dayOffset * DAY_MS
  );
}

function rateOf(state: Record<string, any>, resourceId: string): number {
  const resource = (state.resources as { id: string; ratePerHour: string }[]).find(
    (item) => item.id === resourceId,
  );
  return Number(resource?.ratePerHour ?? 0);
}

function discipleOf(state: Record<string, any>, discipleId: string): Record<string, any> {
  const disciple = (state.disciples as { id: string }[]).find((item) => item.id === discipleId);
  expect(disciple).toBeTruthy();
  return disciple as Record<string, any>;
}

describe('二期阶段一：重伤的规则与结算', () => {
  it('重伤常量是 1 天', () => {
    expect(SEVERE_INJURY_MS).toBe(1 * 86_400_000);
  });

  it('重伤期间不产出、不修炼、产速按 0 显示；到期后恢复', async () => {
    const fixture = await makeSect('severe-rate');
    const now = Date.now();
    const state0 = await fixture.state();

    // 挑一名在静修的弟子（初始门人里有一位 cultivating）与一位采药/炼矿的弟子。
    const cultivator = (state0.disciples as Record<string, any>[]).find(
      (item) => item.assignment === 'cultivating',
    );
    const producer = (state0.disciples as Record<string, any>[]).find(
      (item) => item.assignment === 'herbGathering' || item.assignment === 'oreGathering',
    );
    expect(cultivator).toBeDefined();
    expect(producer).toBeDefined();

    const producingResource = producer!.assignment === 'herbGathering' ? 'herb' : 'ore';
    const rateBefore = rateOf(state0, producingResource);
    expect(Number(cultivator!.cultivationRatePerHour)).toBeGreaterThan(0);

    // 两名弟子打成重伤。
    await setSevereInjury(cultivator!.id as string, now + SEVERE_INJURY_MS);
    await setSevereInjury(producer!.id as string, now + SEVERE_INJURY_MS);

    const state1 = await fixture.state();
    // 产速显示排除重伤弟子：静修速率直接是 0。
    expect(Number(discipleOf(state1, cultivator!.id as string).cultivationRatePerHour)).toBe(0);
    // 该弟子不再贡献产出 —— 资源速率相应下降。
    expect(rateOf(state1, producingResource)).toBeLessThan(rateBefore);
    // 视图把重伤到期时间下发给前端。
    expect(discipleOf(state1, cultivator!.id as string).severeInjuredUntil).not.toBeNull();

    // 到期（把截止时间调到过去）后一切恢复。
    await setSevereInjury(cultivator!.id as string, now - 1000);
    await setSevereInjury(producer!.id as string, now - 1000);
    const state2 = await fixture.state();
    expect(Number(discipleOf(state2, cultivator!.id as string).cultivationRatePerHour)).toBeGreaterThan(
      0,
    );
    expect(rateOf(state2, producingResource)).toBe(rateBefore);
    // 视图下发的是「截止时间」原值（是否还在重伤由前端按服务器时间判断）。
    expect(
      new Date(discipleOf(state2, cultivator!.id as string).severeInjuredUntil).getTime(),
    ).toBeLessThanOrEqual(now);
  });

  it('重伤期间结算不涨修为；恢复后照常涨', async () => {
    const fixture = await makeSect('severe-settle');
    const cultivatorId = (await fixture.state()).disciples.find(
      (item: Record<string, any>) => item.assignment === 'cultivating',
    ).id as string;

    // 把境界抬高，避免修为撞到突破门槛（门槛会截断累计，看不出差别）。
    await env.DB.prepare(
      "UPDATE disciples SET realm_id = 'spiritTransformation', stage = 2, cultivation = 0, cultivation_remainder = 0 WHERE id = ?",
    )
      .bind(cultivatorId)
      .run();

    // 窗口 1：健康 → 修为增长。
    await setLastSettledAt(fixture.sectId, Date.now() - HOUR_MS);
    await fixture.state();
    const afterHealthy = Number((await discipleRow(cultivatorId)).cultivation);
    expect(afterHealthy).toBeGreaterThan(0);

    // 窗口 2：重伤 → 修为不变。
    await setSevereInjury(cultivatorId, Date.now() + 2 * DAY_MS);
    await setLastSettledAt(fixture.sectId, Date.now() - HOUR_MS);
    await fixture.state();
    expect(Number((await discipleRow(cultivatorId)).cultivation)).toBe(afterHealthy);

    // 窗口 3：恢复（到期）→ 又涨。
    await setSevereInjury(cultivatorId, Date.now() - 2 * HOUR_MS);
    await setLastSettledAt(fixture.sectId, Date.now() - HOUR_MS);
    await fixture.state();
    expect(Number((await discipleRow(cultivatorId)).cultivation)).toBeGreaterThan(afterHealthy);
  });
});

describe('二期阶段一：写接口一律被拦住', () => {
  it('转岗 / 破境 / 服丹 / 历练 / 秘境 / 演武场布阵 / 论道 都被拒', async () => {
    const fixture = await makeSect('severe-block');
    const [a, b, c] = fixture.discipleIds as [string, string, string];
    const now = Date.now();
    await fillBalances(fixture.sectId);
    await setSectLevel(fixture.sectId, 2);
    // 解开炼丹（宗门 2 级 + 灵药园 2 级），否则服药会先被「炼丹尚未开启」拦下。
    await env.DB.prepare("UPDATE buildings SET level = 2 WHERE sect_id = ? AND def_id = 'herbGarden'")
      .bind(fixture.sectId)
      .run();
    await setPillQuantity(fixture.sectId, 'healingPill', 3);
    await setPillQuantity(fixture.sectId, 'cultivationPill', 3);
    await env.DB.prepare('UPDATE disciples SET injured_until = ? WHERE id = ?')
      .bind(now + 10 * 60_000, a)
      .run();
    await setSevereInjury(a, now + SEVERE_INJURY_MS);

    const cases: { name: string; message?: string; call: () => Promise<ApiResult> }[] = [
      {
        name: '/game/assign',
        call: () => fixture.api.post('/api/v1/game/assign', { discipleId: a, assignment: 'idle' }),
      },
      {
        name: '/game/breakthrough',
        call: () => fixture.api.post('/api/v1/game/breakthrough', { discipleId: a }),
      },
      {
        name: '/game/use-pill 回春丹',
        message: '伤势过重，丹药无效',
        call: () =>
          fixture.api.post('/api/v1/game/use-pill', {
            pillId: 'healingPill',
            discipleId: a,
            count: 1,
          }),
      },
      {
        name: '/game/use-pill 聚气丹',
        call: () =>
          fixture.api.post('/api/v1/game/use-pill', {
            pillId: 'cultivationPill',
            discipleId: a,
            count: 1,
          }),
      },
      {
        name: '/game/start-journey',
        call: () =>
          fixture.api.post('/api/v1/game/start-journey', {
            discipleId: a,
            direction: 'gathering',
            durationSeconds: 7200,
          }),
      },
      {
        name: '/game/explore',
        call: () =>
          fixture.api.post('/api/v1/game/explore', { realmId: 'mistyForest', discipleIds: [a] }),
      },
      {
        name: '/game/realm-explore/start',
        call: () =>
          fixture.api.post('/api/v1/game/realm-explore/start', {
            realmId: 'mistyForest',
            discipleIds: [a],
          }),
      },
      {
        name: '/game/set-defense-lineup',
        call: () =>
          fixture.api.post('/api/v1/game/set-defense-lineup', { discipleIds: [a, b, c] }),
      },
      {
        name: '/game/dao-debate',
        call: () =>
          fixture.api.post('/api/v1/game/dao-debate', {
            discipleId: a,
            betMode: 'preset_spirit_stone',
            multiplier: 1,
            rewardType: 'resource',
          }),
      },
    ];

    for (const item of cases) {
      const result = await item.call();
      expect(result.status, item.name).toBeGreaterThanOrEqual(400);
      expect(result.status, item.name).toBeLessThan(500);
      const error = errorOf(result);
      expect(error.code, `${item.name} 的 code`).toBe('INVALID_STATUS');
      if (item.message !== undefined) {
        expect(error.message, `${item.name} 的文案`).toBe(item.message);
      } else {
        expect(error.message, `${item.name} 的文案`).toContain('重伤');
        expect(error.message, item.name).toContain('静养');
      }
    }

    // 回春丹有专门的文案（计划 1.3 第 5 条）。
    const healing = await fixture.api.post('/api/v1/game/use-pill', {
      pillId: 'healingPill',
      discipleId: a,
      count: 1,
    });
    expect(errorOf(healing).message).toBe('伤势过重，丹药无效');

    // 允许的操作不受影响：改名 / 备注 / 头像框 / 驱逐。
    const renamed = await fixture.api.post('/api/v1/game/rename-disciple', {
      discipleId: a,
      name: '重伤也要改名',
    });
    expect(renamed.status).toBe(200);
    const noted = await fixture.api.post('/api/v1/game/set-disciple-note', {
      discipleId: a,
      note: '卧床中',
    });
    expect(noted.status).toBe(200);
    const framed = await fixture.api.post('/api/v1/game/set-disciple-avatar-frame', {
      discipleId: a,
      frameId: 'classic',
    });
    expect(framed.status).toBe(200);
  });

  it('批量接口把重伤弟子记为跳过，其余照常执行', async () => {
    const fixture = await makeSect('severe-batch');
    const [a, b] = fixture.discipleIds as [string, string];
    await fillBalances(fixture.sectId);
    await setSevereInjury(a, Date.now() + SEVERE_INJURY_MS);

    const assigned = await fixture.api.post('/api/v1/game/assign-batch', {
      discipleIds: [a, b],
      assignment: 'idle',
    });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(200);
    const assignedData = dataOf(assigned) as Record<string, any>;
    expect(assignedData.outcome.skipped).toEqual([
      { discipleId: a, discipleName: expect.any(String), reason: '重伤卧床' },
    ]);
    expect(
      assignedData.outcome.assigned.map((item: { discipleId: string }) => item.discipleId),
    ).toContain(b);

    // 批量破境：只有重伤弟子时整批报错（一个都执行不了）。
    const alone = await fixture.api.post('/api/v1/game/breakthrough-batch', { discipleIds: [a] });
    expect(alone.status).toBeGreaterThanOrEqual(400);
    expect(errorOf(alone).code).toBe('INVALID_STATUS');

    // 与健康弟子同批：先把 b 摆到「真的可以破境」（修为到门槛 + 灵气充足），
    // 才能验证「重伤的跳过、别人照常」，而不是两个都因修为不够被跳过。
    await env.DB.prepare('UPDATE disciples SET cultivation = 30 WHERE id = ?').bind(b).run();
    await setBalance(fixture.sectId, 'spiritualEnergy', 5_000_000);
    const mixed = await fixture.api.post('/api/v1/game/breakthrough-batch', {
      discipleIds: [a, b],
    });
    expect(mixed.status, JSON.stringify(mixed.body)).toBe(200);
    const mixedData = dataOf(mixed) as Record<string, any>;
    expect(
      mixedData.outcome.skipped.some(
        (item: { discipleId: string; reason: string }) =>
          item.discipleId === a && item.reason === '重伤卧床',
      ),
    ).toBe(true);
  });

  it('讨伐出手也会拦住重伤弟子', async () => {
    const fixture = await makeSect('severe-boss');
    const [a] = fixture.discipleIds as [string];
    const noon = dayAt(0, 9);
    await setSevereInjury(a, noon + SEVERE_INJURY_MS);

    // 先让 Cron 造出今天的 Boss（09:00 UTC+8 在开放时段内）。
    await processWorldBoss(env.DB, noon);
    const code = await attackWorldBoss(env.DB, fixture.userId, { discipleIds: [a] }, noon + 60_000)
      .then(() => 'OK')
      .catch((error: { code?: string }) => error.code);
    expect(code).toBe('INVALID_STATUS');
  });
});

describe('二期阶段一：守擂自动按空位处理', () => {
  it('守擂阵容里的重伤弟子不上场：守方不足 3 人时不可被挑战', async () => {
    const attacker = await makeSect('severe-atk');
    const defender = await makeSect('severe-def');
    const [d1, d2, d3] = defender.discipleIds as [string, string, string];

    // 守方设置 3 人阵容。
    const lineup = await defender.api.post('/api/v1/game/set-defense-lineup', {
      discipleIds: [d1, d2, d3],
    });
    expect(lineup.status).toBe(200);

    // 挑战者视角：可以挑战。
    const before = await attacker.api.get(`/api/v1/game/sect/${defender.sectId}`);
    expect(before.status).toBe(200);
    const beforeData = dataOf(before) as Record<string, any>;
    expect(beforeData.sect.challenge.canChallenge).toBe(true);
    expect(beforeData.sect.challenge.blockedReason).toBeNull();

    // 阵容里的一名弟子重伤 → 守方可用人手不足 3 人，视为不能应战。
    await setSevereInjury(d1, Date.now() + SEVERE_INJURY_MS);

    const after = await attacker.api.get(`/api/v1/game/sect/${defender.sectId}`);
    const afterData = dataOf(after) as Record<string, any>;
    expect(afterData.sect.challenge.canChallenge).toBe(false);
    expect(afterData.sect.challenge.blockedReason).toBe('defender_insufficient');

    // 而且真的打不动：挑战接口也拒绝。
    const challenged = await attacker.api.post('/api/v1/game/challenge', {
      targetSectId: defender.sectId,
      discipleIds: attacker.discipleIds.slice(0, 3),
    });
    expect(challenged.status).toBeGreaterThanOrEqual(400);
    expect(errorOf(challenged).code).toBe('INVALID_STATUS');
  });
});
