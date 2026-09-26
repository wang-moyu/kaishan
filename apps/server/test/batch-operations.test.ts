import { applyD1Migrations, env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app';

import { dataOf, errorOf, TestClient } from './support/authClient';

/**
 * 批量操作（HTTP + D1 全链路）：批量转岗 /game/assign-batch、批量破境 /game/breakthrough-batch。
 *
 * 口径：不符合条件的弟子跳过并记原因，其余照常执行；一个都执行不了时整批报错、不写库。
 * 批量破境要求灵气够全部可破境弟子，不够整批拒绝（提示减少人数）。
 *
 * 存储说明：本文件一份独立内存 D1，每个用例用独立账号/宗门（前缀 + 递增序号）。
 * 结算冻结：把 last_settled_at 拨到未来，请求内不产生离线产出与随机事件，余额断言可精确比较。
 */

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

const quietLogger = { info: () => {}, warn: () => {}, error: () => {} } as const;
const app = createApp({ logger: quietLogger });
const PASSWORD = 'password-123456';

let seq = 0;

afterEach(() => {
  vi.restoreAllMocks();
});

interface BatchFixture {
  api: TestClient;
  sectId: string;
  /** 创建宗门时自带的弟子 id。 */
  discipleIds: string[];
}

async function makeSect(prefix: string): Promise<BatchFixture> {
  seq += 1;
  const api = new TestClient(app, env, {
    'cf-connecting-ip': `10.21.${Math.floor(seq / 250)}.${seq % 250}`,
  });
  const registered = await api.post('/api/v1/auth/register', {
    account: `${prefix}-${String(seq)}`,
    password: PASSWORD,
  });
  expect(registered.status).toBe(200);
  const created = await api.post('/api/v1/game/create-sect', { name: `批量${String(seq)}宗` });
  expect(created.status).toBe(200);
  const state = (dataOf(created) as Record<string, any>).state;
  return {
    api,
    sectId: state.sect.id as string,
    discipleIds: (state.disciples as { id: string }[]).map((disciple) => disciple.id),
  };
}

/** 直接插入一名弟子（绕过招募与容量，便于构造人数）。 */
async function seedDisciple(
  sectId: string,
  options: { realmId?: string; stage?: number; cultivation?: number; assignment?: string } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO disciples
       (id, sect_id, name, gender, aptitude, attack, defense, speed, talent,
        realm_id, stage, cultivation, cultivation_remainder, assignment, injured_until,
        body_tempering_count, note, created_at)
     VALUES (?, ?, ?, 'male', 50, 50, 50, 50, 'combat', ?, ?, ?, 0, ?, NULL, 0, '', ?)`,
  )
    .bind(
      id,
      sectId,
      `门人${id.slice(0, 4)}`,
      options.realmId ?? 'qiRefining',
      options.stage ?? 1,
      options.cultivation ?? 0,
      options.assignment ?? 'idle',
      Date.now(),
    )
    .run();
  return id;
}

async function freezeSettlement(sectId: string): Promise<void> {
  await env.DB.prepare('UPDATE sects SET last_settled_at = ? WHERE id = ?')
    .bind(Date.now() + 60_000, sectId)
    .run();
}

async function setBalance(sectId: string, resourceId: string, balance: number): Promise<void> {
  await env.DB.prepare(
    'UPDATE resource_balances SET balance = ?, remainder = 0 WHERE sect_id = ? AND resource_id = ?',
  )
    .bind(balance, sectId, resourceId)
    .run();
}

async function dbBalance(sectId: string, resourceId: string): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT balance FROM resource_balances WHERE sect_id = ? AND resource_id = ?',
  )
    .bind(sectId, resourceId)
    .first<{ balance: number }>();
  return Number(row?.balance ?? -1);
}

async function dbDisciple(id: string): Promise<Record<string, any> | null> {
  return env.DB.prepare('SELECT realm_id, stage, cultivation, assignment, injured_until FROM disciples WHERE id = ?')
    .bind(id)
    .first<Record<string, any>>();
}

async function guardRowCount(): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS total FROM mutation_guards').first<{ total: number }>();
  return Number(row?.total ?? -1);
}

/** 炼气一层门槛 30：修为 30 即可破境。 */
const QI_THRESHOLD = 30;

describe('批量转岗', () => {
  it('按顺序转岗；已在该岗位 / 在外 / 他宗 id 跳过；采灵岗位按顺序占满名额', async () => {
    const fixture = await makeSect('assign');
    const [a, b, c] = fixture.discipleIds as [string, string, string];
    // 开宗自带的弟子各有初始岗位，先统一拨回闲置。
    await env.DB.prepare("UPDATE disciples SET assignment = 'idle' WHERE sect_id = ?")
      .bind(fixture.sectId)
      .run();
    const d = await seedDisciple(fixture.sectId, { assignment: 'herbGathering' });
    const e = await seedDisciple(fixture.sectId);
    const away = await seedDisciple(fixture.sectId, { realmId: 'foundationEstablishment' });
    await seedDisciple(fixture.sectId);

    const started = await fixture.api.post('/api/v1/game/start-journey', {
      discipleId: away,
      direction: 'gathering',
      durationSeconds: 21_600,
    });
    expect(started.status).toBe(200);
    await freezeSettlement(fixture.sectId);

    const toHerb = await fixture.api.post('/api/v1/game/assign-batch', {
      discipleIds: [a, d, away, crypto.randomUUID(), b],
      assignment: 'herbGathering',
    });
    expect(toHerb.status).toBe(200);
    const herbData = dataOf(toHerb) as Record<string, any>;
    expect(herbData.outcome.assignmentName).toBe('药园');
    expect(herbData.outcome.assigned.map((item: { discipleId: string }) => item.discipleId)).toEqual([a, b]);
    expect(herbData.outcome.skipped.map((item: { reason: string }) => item.reason)).toEqual([
      '已在药园岗位',
      '外出历练中',
      '已不在本宗',
    ]);
    expect((await dbDisciple(a))?.assignment).toBe('herbGathering');
    expect((await dbDisciple(b))?.assignment).toBe('herbGathering');

    // 1 级宗门采灵上限 1 人：c 占满名额，e 被跳过。
    const toStone = await fixture.api.post('/api/v1/game/assign-batch', {
      discipleIds: [c, e],
      assignment: 'stoneMining',
    });
    expect(toStone.status).toBe(200);
    const stoneData = dataOf(toStone) as Record<string, any>;
    expect(stoneData.outcome.assigned.map((item: { discipleId: string }) => item.discipleId)).toEqual([c]);
    expect(stoneData.outcome.skipped).toEqual([
      { discipleId: e, discipleName: expect.any(String), reason: '采灵岗位已满（上限 1 人）' },
    ]);
    expect((await dbDisciple(e))?.assignment).toBe('idle');
    expect(await guardRowCount()).toBe(0);
  });

  it('吐纳岗位：每人每小时 10 灵气，上限 2 人；聚灵阵每级 +40% 灵气基础产出', async () => {
    const fixture = await makeSect('assign-energy');
    const a = await seedDisciple(fixture.sectId);
    const b = await seedDisciple(fixture.sectId);
    const c = await seedDisciple(fixture.sectId);
    await freezeSettlement(fixture.sectId);

    const toEnergy = await fixture.api.post('/api/v1/game/assign-batch', {
      discipleIds: [a, b, c],
      assignment: 'energyGathering',
    });
    expect(toEnergy.status).toBe(200);
    const data = dataOf(toEnergy) as Record<string, any>;
    expect(data.outcome.assignmentName).toBe('吐纳');
    expect(data.outcome.assigned.map((item: { discipleId: string }) => item.discipleId)).toEqual([a, b]);
    expect(data.outcome.skipped).toEqual([
      { discipleId: c, discipleName: expect.any(String), reason: '吐纳岗位已满（上限 2 人）' },
    ]);

    const state = data.state as Record<string, any>;
    const post = (state.assignments as { id: string; currentCount: number | null; maxCount: number | null }[])
      .find((item) => item.id === 'energyGathering');
    expect(post).toMatchObject({ currentCount: 2, maxCount: 2 });
    // 灵气产速 = 基础 20 × (1 + 聚灵阵 1 级 40%) + 吐纳 2 人 × 10 = 48（最小单位 48000）
    const energy = (state.resources as { id: string; ratePerHour: string }[]).find(
      (item) => item.id === 'spiritualEnergy',
    );
    expect(energy?.ratePerHour).toBe('48000');
  });

  it('一个都转不了时整批报错、不写库', async () => {
    const fixture = await makeSect('assign-none');
    const [a] = fixture.discipleIds as [string];
    await freezeSettlement(fixture.sectId);
    const before = (await dbDisciple(a))?.assignment as string;

    const rejected = await fixture.api.post('/api/v1/game/assign-batch', {
      discipleIds: [a],
      assignment: before,
    });
    expect(rejected.status).toBe(409);
    expect(errorOf(rejected).code).toBe('INVALID_STATUS');
    expect(errorOf(rejected).message).toContain('没有弟子可以转到');
    expect((await dbDisciple(a))?.assignment).toBe(before);
  });

  it('请求校验：空列表、重复弟子、未知岗位被拒绝', async () => {
    const fixture = await makeSect('assign-invalid');
    const [a] = fixture.discipleIds as [string];

    for (const body of [
      { discipleIds: [], assignment: 'idle' },
      { discipleIds: [a, a], assignment: 'idle' },
    ]) {
      const rejected = await fixture.api.post('/api/v1/game/assign-batch', body);
      expect(rejected.status).toBe(400);
      expect(errorOf(rejected).code).toBe('VALIDATION_ERROR');
    }

    const unknown = await fixture.api.post('/api/v1/game/assign-batch', {
      discipleIds: [a],
      assignment: 'nowhere',
    });
    expect(unknown.status).toBe(400);
    expect(errorOf(unknown).code).toBe('VALIDATION_ERROR');
  });
});

describe('批量破境', () => {
  it('可破境的逐人抽随机；修为不足 / 调息中跳过；灵气按人数扣', async () => {
    const fixture = await makeSect('bt');
    const ready = [
      await seedDisciple(fixture.sectId, { cultivation: QI_THRESHOLD }),
      await seedDisciple(fixture.sectId, { cultivation: QI_THRESHOLD }),
    ];
    const notReady = await seedDisciple(fixture.sectId, { cultivation: 5 });
    const injured = await seedDisciple(fixture.sectId, { cultivation: QI_THRESHOLD });
    await env.DB.prepare('UPDATE disciples SET injured_until = ? WHERE id = ?')
      .bind(Date.now() + 3_600_000, injured)
      .run();
    await setBalance(fixture.sectId, 'spiritualEnergy', 1_000_000);
    await freezeSettlement(fixture.sectId);

    // roll = 0 < 任何正成功率：全部成功。
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const result = await fixture.api.post('/api/v1/game/breakthrough-batch', {
      discipleIds: [ready[0], notReady, injured, ready[1]],
    });
    expect(result.status).toBe(200);
    const data = dataOf(result) as Record<string, any>;
    expect(data.outcome.results.map((item: { discipleId: string }) => item.discipleId)).toEqual(ready);
    expect(data.outcome.results.every((item: { success: boolean }) => item.success)).toBe(true);
    expect(data.outcome.skipped.map((item: { reason: string }) => item.reason)).toEqual([
      '修为未到门槛',
      '调息 / 疗伤中',
    ]);

    const spent = Number(data.outcome.energySpent);
    expect(spent).toBeGreaterThan(0);
    expect(await dbBalance(fixture.sectId, 'spiritualEnergy')).toBe(1_000_000 - spent);
    for (const id of ready) {
      expect(await dbDisciple(id)).toMatchObject({ realm_id: 'qiRefining', stage: 2, cultivation: 0 });
    }
    expect(await dbDisciple(notReady)).toMatchObject({ stage: 1, cultivation: 5 });
  });

  it('失败的弟子进入调息，修为按规则跌落', async () => {
    const fixture = await makeSect('bt-fail');
    const id = await seedDisciple(fixture.sectId, { cultivation: QI_THRESHOLD });
    await setBalance(fixture.sectId, 'spiritualEnergy', 1_000_000);
    await freezeSettlement(fixture.sectId);

    vi.spyOn(Math, 'random').mockReturnValue(0.9999);
    const result = await fixture.api.post('/api/v1/game/breakthrough-batch', { discipleIds: [id] });
    expect(result.status).toBe(200);
    const [first] = (dataOf(result) as Record<string, any>).outcome.results;
    expect(first.success).toBe(false);
    const row = await dbDisciple(id);
    expect(row?.stage).toBe(1);
    expect(Number(row?.injured_until)).toBeGreaterThan(Date.now());
  });

  it('灵气不够全部可破境弟子时整批拒绝，提示减少人数，不扣灵气', async () => {
    const fixture = await makeSect('bt-energy');
    const ids = [
      await seedDisciple(fixture.sectId, { cultivation: QI_THRESHOLD }),
      await seedDisciple(fixture.sectId, { cultivation: QI_THRESHOLD }),
    ];
    await freezeSettlement(fixture.sectId);
    const sync = await fixture.api.get('/api/v1/game/sync');
    const oneCost = Number(
      (dataOf(sync) as Record<string, any>).state.disciples.find((d: { id: string }) => d.id === ids[0])
        .breakthroughCost,
    );
    // 灵气为 0：单人不可破境，但「除灵气外已就绪」（批量确认弹窗据此挑人）。
    await setBalance(fixture.sectId, 'spiritualEnergy', 0);
    const drained = (dataOf(await fixture.api.get('/api/v1/game/sync')) as Record<string, any>).state.disciples.find(
      (d: { id: string }) => d.id === ids[0],
    );
    expect(drained.canBreakthrough).toBe(false);
    expect(drained.breakthroughReadyExceptEnergy).toBe(true);

    // 只够一个人。
    await setBalance(fixture.sectId, 'spiritualEnergy', oneCost);

    const rejected = await fixture.api.post('/api/v1/game/breakthrough-batch', { discipleIds: ids });
    expect(rejected.status).toBe(409);
    expect(errorOf(rejected).code).toBe('INSUFFICIENT_RESOURCE');
    expect(errorOf(rejected).message).toContain('请减少突破弟子数量');
    expect(await dbBalance(fixture.sectId, 'spiritualEnergy')).toBe(oneCost);
    for (const id of ids) {
      expect(await dbDisciple(id)).toMatchObject({ stage: 1, cultivation: QI_THRESHOLD });
    }
  });

  it('一个可破境的都没有时报 INVALID_STATUS', async () => {
    const fixture = await makeSect('bt-none');
    const id = await seedDisciple(fixture.sectId, { cultivation: 0 });
    await freezeSettlement(fixture.sectId);

    const rejected = await fixture.api.post('/api/v1/game/breakthrough-batch', { discipleIds: [id] });
    expect(rejected.status).toBe(409);
    expect(errorOf(rejected).code).toBe('INVALID_STATUS');
    expect(errorOf(rejected).message).toContain('修为未到门槛');
  });

  it('一次 25 人：成员守卫分片提交（D1 单语句参数上限），不残留守卫行', async () => {
    const fixture = await makeSect('bt-many');
    const ids: string[] = [];
    for (let index = 0; index < 25; index += 1) {
      ids.push(await seedDisciple(fixture.sectId, { cultivation: QI_THRESHOLD }));
    }
    await setBalance(fixture.sectId, 'spiritualEnergy', 10_000_000);
    await freezeSettlement(fixture.sectId);

    vi.spyOn(Math, 'random').mockReturnValue(0);
    const result = await fixture.api.post('/api/v1/game/breakthrough-batch', { discipleIds: ids });
    expect(result.status).toBe(200);
    expect((dataOf(result) as Record<string, any>).outcome.results).toHaveLength(25);
    for (const id of ids) {
      expect((await dbDisciple(id))?.stage).toBe(2);
    }
    expect(await guardRowCount()).toBe(0);
  });

  it('已被驱逐的弟子记为「已不在本宗」跳过，灵气只按实际破境人数扣', async () => {
    const fixture = await makeSect('bt-gone');
    const kept = await seedDisciple(fixture.sectId, { cultivation: QI_THRESHOLD });
    const gone = await seedDisciple(fixture.sectId, { cultivation: QI_THRESHOLD });
    await setBalance(fixture.sectId, 'spiritualEnergy', 1_000_000);
    await freezeSettlement(fixture.sectId);
    await env.DB.prepare('DELETE FROM disciples WHERE id = ?').bind(gone).run();

    vi.spyOn(Math, 'random').mockReturnValue(0);
    const result = await fixture.api.post('/api/v1/game/breakthrough-batch', { discipleIds: [kept, gone] });
    expect(result.status).toBe(200);
    const outcome = (dataOf(result) as Record<string, any>).outcome;
    expect(outcome.results).toHaveLength(1);
    expect(outcome.skipped).toEqual([{ discipleId: gone, discipleName: '未知弟子', reason: '已不在本宗' }]);
    expect(await dbBalance(fixture.sectId, 'spiritualEnergy')).toBe(1_000_000 - Number(outcome.energySpent));
    expect(await guardRowCount()).toBe(0);
  });
});
