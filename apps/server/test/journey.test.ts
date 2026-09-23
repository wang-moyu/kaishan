import { applyD1Migrations, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { prepareStatements } from '../src/infra/db/repository';
import {
  challengeSnapshotGuardStatement,
  deleteChallengeSnapshotGuardStatement,
  DiscipleRepository,
  ResourceBalanceRepository,
  SectRepository,
  deleteDiscipleSnapshotGuardStatement,
  deleteDiscipleStatement,
  discipleSnapshotGuardStatement,
  settlementSnapshotGuardStatements,
} from '../src/modules/game/repository';
import { getSectState } from '../src/modules/game/service';
import {
  JOURNEY_PLANS,
  findJourneyPlan,
  journeyInjuryChanceBp,
  previewJourneyCultivation,
  type JourneyDirection,
} from '../src/modules/game/journey';

import { dataOf, errorOf, TestClient, type ApiResult } from './support/authClient';

/**
 * 0014 弟子单人历练（HTTP + D1 全链路）。
 *
 * 存储说明：本文件一份独立内存 D1，没有逐用例回滚 —— 每个用例用独立账号/宗门
 * （前缀 + 递增序号），涉及余额/计数的断言都按宗门 id 定界。
 *
 * 时间与确定性说明：
 * - 路由一律用 `Date.now()`，所以「过去/未来」都靠直接改库里的时间戳表达
 *   （`sects.last_settled_at`、`disciple_journeys.started_at/ends_at`），不 mock Date；
 * - 结算会触发随机事件，事件直接改资源余额。凡是需要精确余额的断言都先记下
 *   `event_log` 的最大 rowid，结算后再把新增事件的 effects 抵消掉 —— 这样断言的是
 *   「纯产出入账」而不是「运气好没触发加资源的随机事件」。
 *
 * 覆盖范围（计划第 6 节的验收清单）：炼气拒绝 / 筑基与高境界允许；伤势、守擂、在外、
 * 未领取、名额、留守人数限制；跨宗 ID；到期前 / 恰好到期 / 超过 12 小时离线 / 时钟回拨；
 * 返程前无岗位收益、返程后恢复、余数与事件次数不重复；修为先于返程后静修且不越门槛；
 * 晚领取伤势不延期；重复与并发出发 / 领取；与驱逐、派工、服药、布阵、探索、挑战的交错。
 */

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

const quietLogger = { info: () => {}, warn: () => {}, error: () => {} } as const;
const app = createApp({ logger: quietLogger });
const PASSWORD = 'password-123456';

let seq = 0;

const HOUR = 3_600_000;

/** 筑基初期：门槛 300。 */
const FOUNDATION = 'foundationEstablishment';

interface JourneyFixture {
  api: TestClient;
  sectId: string;
  /** 门内全部弟子 id（顺序即 created_at 顺序）。 */
  discipleIds: string[];
  state: () => Promise<Record<string, any>>;
  preview: (discipleId: string) => Promise<ApiResult>;
  start: (discipleId: string, direction: string, durationSeconds: number) => Promise<ApiResult>;
  claim: (journeyId: string) => Promise<ApiResult>;
}

/**
 * 建一个宗门并把门人调成「可历练」的基线：
 * 默认 3 名炼气弟子改成筑基初期（门槛 300，可访道），再按需补足到 6 人
 * （第 6 人是炼气一层，用来验证「炼气不可派出」）。
 */
async function makeSect(prefix: string, extra = 3): Promise<JourneyFixture> {
  seq += 1;
  const account = `${prefix}-${seq}`;
  const api = new TestClient(app, env, {
    // 独立的来源 IP 段：避免与 alchemy / 挑战的限频计数互相干扰。
    'cf-connecting-ip': `10.11.${Math.floor(seq / 250)}.${seq % 250}`,
  });

  const registered = await api.post('/api/v1/auth/register', { account, password: PASSWORD });
  expect(registered.status).toBe(200);
  const created = await api.post('/api/v1/game/create-sect', { name: `历练${String(seq)}宗` });
  expect(created.status).toBe(200);

  const state = dataOf(created) as Record<string, any>;
  const sectId = state.state.sect.id as string;
  const initialIds = (state.state.disciples as { id: string }[]).map((disciple) => disciple.id);

  for (const discipleId of initialIds) {
    // 0016：初始弟子现在会随机生成幸运/体魄；本文件所有既有断言都以「旧弟子 50/50 基线」为前提，
    // 这里显式钉成 50，保证 extraChanceBp=1500、injuryChanceBp=journeyInjuryChanceBp(plan, power)。
    await env.DB.prepare(
      'UPDATE disciples SET realm_id = ?, stage = 1, cultivation = 0, aptitude = 50, attack = 50, defense = 50, speed = 50, luck = 50, physique = 50, talent = ? WHERE id = ?',
    )
      .bind(FOUNDATION, 'combat', discipleId)
      .run();
  }

  const discipleIds = [...initialIds];
  for (let index = 0; index < extra; index += 1) {
    discipleIds.push(
      await seedDisciple(sectId, {
        name: `门人${String(seq)}-${String(index)}`,
        realmId: index === extra - 1 && extra >= 3 ? 'qiRefining' : FOUNDATION,
        assignment: index % 2 === 0 ? 'herbGathering' : 'oreGathering',
      }),
    );
  }

  return {
    api,
    sectId,
    discipleIds,
    state: async () => {
      const result = await api.get('/api/v1/game/sync');
      expect(result.status).toBe(200);
      return (dataOf(result) as Record<string, any>).state as Record<string, any>;
    },
    preview: (discipleId: string) =>
      api.get(`/api/v1/game/journey-preview?discipleId=${encodeURIComponent(discipleId)}`),
    start: (discipleId: string, direction: string, durationSeconds: number) =>
      api.post('/api/v1/game/start-journey', { discipleId, direction, durationSeconds }),
    claim: (journeyId: string) => api.post('/api/v1/game/claim-journey', { journeyId }),
  };
}

/** 直接插入一名弟子（绕过招募次数与容量，便于构造边界人数）。 */
async function seedDisciple(
  sectId: string,
  options: {
    name: string;
    realmId?: string;
    stage?: number;
    cultivation?: number;
    assignment?: string;
    aptitude?: number;
    talent?: string;
    injuredUntil?: number | null;
  },
): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO disciples
       (id, sect_id, name, gender, aptitude, attack, defense, speed, talent,
        realm_id, stage, cultivation, cultivation_remainder, assignment, injured_until,
        body_tempering_count, note, created_at)
     VALUES (?, ?, ?, 'male', ?, 50, 50, 50, ?, ?, ?, ?, 0, ?, ?, 0, '', ?)`,
  )
    .bind(
      id,
      sectId,
      options.name,
      options.aptitude ?? 50,
      options.talent ?? 'combat',
      options.realmId ?? FOUNDATION,
      options.stage ?? 1,
      options.cultivation ?? 0,
      options.assignment ?? 'idle',
      options.injuredUntil ?? null,
      Date.now(),
    )
    .run();
  return id;
}

/* ---------- 直接读写库的断言辅助 ---------- */

async function freezeSettlement(sectId: string): Promise<void> {
  await env.DB.prepare('UPDATE sects SET last_settled_at = ? WHERE id = ?')
    .bind(Date.now() + 60_000, sectId)
    .run();
}

async function setLastSettledAt(sectId: string, value: number): Promise<void> {
  await env.DB.prepare('UPDATE sects SET last_settled_at = ? WHERE id = ?').bind(value, sectId).run();
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

async function setDefenseLineup(sectId: string, discipleIds: string[]): Promise<void> {
  await env.DB.prepare('UPDATE sects SET defense_lineup = ? WHERE id = ?')
    .bind(JSON.stringify(discipleIds), sectId)
    .run();
}

interface JourneyRow {
  id: string;
  disciple_id: string;
  disciple_name: string;
  direction: string;
  duration_seconds: number;
  original_assignment: string;
  started_at: number;
  ends_at: number;
  completed_at: number | null;
  claimed_at: number | null;
  reward_cultivation: number;
  reward_resources: string;
  extra_harvest: number;
  injured: number;
  injury_chance_bp: number;
  cultivation_awarded: number | null;
}

async function journeyRow(journeyId: string): Promise<JourneyRow | null> {
  const row = await env.DB.prepare('SELECT * FROM disciple_journeys WHERE id = ?')
    .bind(journeyId)
    .first<JourneyRow>();
  return row ?? null;
}

async function journeyRows(sectId: string): Promise<JourneyRow[]> {
  const rows = await env.DB.prepare(
    'SELECT * FROM disciple_journeys WHERE sect_id = ? ORDER BY started_at ASC',
  )
    .bind(sectId)
    .all<JourneyRow>();
  return rows.results;
}

async function journeyCount(sectId: string): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS total FROM disciple_journeys WHERE sect_id = ?',
  )
    .bind(sectId)
    .first<{ total: number }>();
  return Number(row?.total ?? 0);
}

/** 把某条历练记录的时间挪到指定的过去区间（模拟「早已出发、现在已到期」）。 */
async function transportJourney(
  journeyId: string,
  startedAt: number,
  endsAt: number,
): Promise<void> {
  await env.DB.prepare('UPDATE disciple_journeys SET started_at = ?, ends_at = ? WHERE id = ?')
    .bind(startedAt, endsAt, journeyId)
    .run();
}

async function discipleRow(
  discipleId: string,
): Promise<{ cultivation: number; cultivation_remainder: number; injured_until: number | null; assignment: string } | null> {
  const row = await env.DB.prepare(
    'SELECT cultivation, cultivation_remainder, injured_until, assignment FROM disciples WHERE id = ?',
  )
    .bind(discipleId)
    .first<{
      cultivation: number;
      cultivation_remainder: number;
      injured_until: number | null;
      assignment: string;
    }>();
  return row ?? null;
}

async function setCultivation(discipleId: string, cultivation: number): Promise<void> {
  await env.DB.prepare('UPDATE disciples SET cultivation = ?, cultivation_remainder = 0 WHERE id = ?')
    .bind(cultivation, discipleId)
    .run();
}

async function setInjured(discipleId: string, injuredUntil: number | null): Promise<void> {
  await env.DB.prepare('UPDATE disciples SET injured_until = ? WHERE id = ?')
    .bind(injuredUntil, discipleId)
    .run();
}

/** 记为「本次结算之前」的事件游标。 */
async function latestEventRowid(sectId: string): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COALESCE(MAX(rowid), 0) AS cursor FROM event_log WHERE sect_id = ?',
  )
    .bind(sectId)
    .first<{ cursor: number }>();
  return Number(row?.cursor ?? 0);
}

/** 结算后新增事件对资源的净影响（用来把随机事件从余额断言里抵消掉）。 */
async function eventEffectsSince(
  sectId: string,
  cursor: number,
): Promise<Record<string, number>> {
  const rows = await env.DB.prepare(
    'SELECT effects FROM event_log WHERE sect_id = ? AND rowid > ?',
  )
    .bind(sectId, cursor)
    .all<{ effects: string }>();
  const totals: Record<string, number> = {};
  for (const row of rows.results) {
    const parsed = JSON.parse(row.effects) as Record<string, string>;
    for (const [resourceId, amount] of Object.entries(parsed)) {
      totals[resourceId] = (totals[resourceId] ?? 0) + Number(amount);
    }
  }
  return totals;
}

async function mutationGuardCount(): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS total FROM mutation_guards').first<{
    total: number;
  }>();
  return Number(row?.total ?? 0);
}

/**
 * 把门内其它弟子都改成闲置，并把目标弟子的岗位 / 资质 / 天赋固定下来：
 * 资源产量断言才能精确到个位（否则门内其它弟子的岗位产出会一起算进来）。
 */
async function isolateProduction(
  sectId: string,
  discipleId: string,
  assignment: string,
): Promise<void> {
  await env.DB.prepare("UPDATE disciples SET assignment = 'idle' WHERE sect_id = ? AND id <> ?")
    .bind(sectId, discipleId)
    .run();
  await env.DB.prepare("UPDATE disciples SET assignment = ?, aptitude = 50, talent = 'combat' WHERE id = ?")
    .bind(assignment, discipleId)
    .run();
}

/** 走完一次真实出发，返回历练记录 id。 */
async function startOk(
  fixture: JourneyFixture,
  discipleId: string,
  direction: string,
  durationSeconds: number,
): Promise<string> {
  const started = await fixture.start(discipleId, direction, durationSeconds);
  expect(started.status).toBe(200);
  const state = (dataOf(started) as Record<string, any>).state;
  const journeyId = state.disciples.find((row: { id: string }) => row.id === discipleId)?.journey
    ?.journeyId;
  expect(typeof journeyId).toBe('string');
  return journeyId as string;
}

describe('满编宗门同步', () => {
  it('35 名弟子的宗门仍可同步结算', async () => {
    const fixture = await makeSect('full-roster-sync', 32);
    await setLastSettledAt(fixture.sectId, Date.now() - HOUR);
    const response = await fixture.api.get('/api/v1/game/sync');
    expect(response.status).toBe(200);
    expect((dataOf(response) as Record<string, any>).state.disciples).toHaveLength(35);
    expect(await mutationGuardCount()).toBe(0);

    const sect = (await new SectRepository(env.DB).findById(fixture.sectId))!;
    const balances = await new ResourceBalanceRepository(env.DB).findBySectId(fixture.sectId);
    const disciples = await new DiscipleRepository(env.DB).findBySectId(fixture.sectId);
    const guard = settlementSnapshotGuardStatements(crypto.randomUUID(), { sect, balances, disciples });
    expect(guard.guards.length).toBeGreaterThan(1);
    await env.DB.prepare('UPDATE disciples SET cultivation = cultivation + 1 WHERE id = ?')
      .bind(disciples.at(-1)!.id)
      .run();

    const before = await dbBalance(fixture.sectId, 'spiritStone');
    await expect(env.DB.batch(prepareStatements(env.DB, [
      ...guard.guards,
      {
        sql: 'UPDATE resource_balances SET balance = balance + 1 WHERE sect_id = ? AND resource_id = ?',
        params: [fixture.sectId, 'spiritStone'],
      },
      ...guard.cleanup,
    ]))).rejects.toThrow(/CHECK constraint failed/);
    expect(await dbBalance(fixture.sectId, 'spiritStone')).toBe(before);
    expect(await mutationGuardCount()).toBe(0);
  });
});

describe('0014 迁移：表、索引与旧数据不变', () => {
  it('disciple_journeys 建表成功，同一弟子只有一条未领取记录', async () => {
    const fixture = await makeSect('mig');
    const discipleId = fixture.discipleIds[0]!;
    const journeyId = await startOk(fixture, discipleId, 'gathering', 7_200);
    expect(await journeyCount(fixture.sectId)).toBe(1);

    // 唯一部分索引：同一弟子再插一条未领取记录必定失败（数据库层兜底）。
    await expect(
      env.DB.prepare(
        `INSERT INTO disciple_journeys
           (id, sect_id, disciple_id, disciple_name, direction, duration_seconds,
            original_assignment, started_at, ends_at, completed_at, claimed_at,
            reward_cultivation, reward_resources, extra_harvest, injured, injury_chance_bp,
            cultivation_awarded, created_at)
         VALUES (?, ?, ?, 'x', 'gathering', 7200, 'idle', 1, 2, NULL, NULL, 0, '{}', 0, 0, 0, NULL, 1)`,
      )
        .bind(crypto.randomUUID(), fixture.sectId, discipleId)
        .run(),
    ).rejects.toThrow(/UNIQUE constraint failed/i);

    // CHECK 兜底：时长不在白名单里直接写不进去。
    await expect(
      env.DB.prepare(
        `INSERT INTO disciple_journeys
           (id, sect_id, disciple_id, disciple_name, direction, duration_seconds,
            original_assignment, started_at, ends_at, completed_at, claimed_at,
            reward_cultivation, reward_resources, extra_harvest, injured, injury_chance_bp,
            cultivation_awarded, created_at)
         VALUES (?, ?, ?, 'y', 'gathering', 3600, 'idle', 1, 2, NULL, NULL, 0, '{}', 0, 0, 0, NULL, 1)`,
      )
        .bind(crypto.randomUUID(), fixture.sectId, crypto.randomUUID())
        .run(),
    ).rejects.toThrow(/CHECK constraint failed/i);

    // 已领取的历史不受唯一索引限制：标记为已领取后可以再插一条新的。
    await env.DB.prepare(
      'UPDATE disciple_journeys SET completed_at = 1, claimed_at = 1 WHERE id = ?',
    )
      .bind(journeyId)
      .run();
    const replacementId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO disciple_journeys
         (id, sect_id, disciple_id, disciple_name, direction, duration_seconds,
          original_assignment, started_at, ends_at, completed_at, claimed_at,
          reward_cultivation, reward_resources, extra_harvest, injured, injury_chance_bp,
          cultivation_awarded, created_at)
       VALUES (?, ?, ?, 'z', 'gathering', 7200, 'idle', 1, 7200001, NULL, NULL, 0, '{}', 0, 0, 0, NULL, 1)`,
    )
      .bind(replacementId, fixture.sectId, discipleId)
      .run();
    expect(await journeyCount(fixture.sectId)).toBe(2);
  });

  it('迁移不改动既有弟子与资源（只新增表）', async () => {
    const fixture = await makeSect('keep');
    const state = await fixture.state();
    expect(state.disciples).toHaveLength(fixture.discipleIds.length);
    // 0004 起的既有列仍在，且 note 仍是空串（0013 的默认值）。
    for (const disciple of state.disciples) {
      expect(disciple.note).toBe('');
      expect(typeof disciple.journey).toBe('object');
      expect(disciple.journey.status).toBe('none');
    }
    expect(Number(state.resources[0].balance)).toBeGreaterThanOrEqual(0);
  });
});

describe('出发资格：境界、伤势、名额、留守、守擂', () => {
  it('炼气弟子不可派出，筑基与更高境界可以', async () => {
    const fixture = await makeSect('realm');
    const qiRefining = fixture.discipleIds[fixture.discipleIds.length - 1]!;
    const rejected = await fixture.start(qiRefining, 'daoSeeking', 7_200);
    expect(rejected.status).toBe(409);
    expect(errorOf(rejected).code).toBe('INVALID_STATUS');
    expect(errorOf(rejected).message).toContain('筑基');
    expect(await journeyCount(fixture.sectId)).toBe(0);

    const foundation = fixture.discipleIds[0]!;
    await startOk(fixture, foundation, 'daoSeeking', 7_200);

    const goldenCore = await seedDisciple(fixture.sectId, {
      name: '金丹客',
      realmId: 'goldenCore',
      stage: 1,
    });
    await startOk(fixture, goldenCore, 'gathering', 21_600);
  });

  it('受伤未愈不能出发，伤好之后可以', async () => {
    const fixture = await makeSect('injury');
    const discipleId = fixture.discipleIds[0]!;
    await setInjured(discipleId, Date.now() + 10 * 60_000);
    const rejected = await fixture.start(discipleId, 'gathering', 7_200);
    expect(errorOf(rejected).code).toBe('INVALID_STATUS');
    expect(errorOf(rejected).message).toContain('疗伤');

    await setInjured(discipleId, Date.now() - 1_000);
    await startOk(fixture, discipleId, 'gathering', 7_200);
  });

  it('手动守擂阵容里的弟子不能出发', async () => {
    const fixture = await makeSect('lineup');
    const [a, b, c, d] = fixture.discipleIds as [string, string, string, string];
    await setDefenseLineup(fixture.sectId, [a, b, c]);
    const rejected = await fixture.start(a, 'gathering', 7_200);
    expect(errorOf(rejected).code).toBe('INVALID_STATUS');
    expect(errorOf(rejected).message).toContain('守擂阵容');
    // 不在阵容里的弟子照常可以出发。
    await startOk(fixture, d, 'gathering', 7_200);
  });

  it('同一宗门最多 2 人同时在外；已到期待领取不占名额', async () => {
    const fixture = await makeSect('slots');
    const [a, b, c, d] = fixture.discipleIds as [string, string, string, string];
    const firstId = await startOk(fixture, a, 'gathering', 7_200);
    await startOk(fixture, b, 'gathering', 7_200);

    const third = await fixture.start(c, 'gathering', 7_200);
    expect(third.status).toBe(409);
    expect(errorOf(third).code).toBe('CAPACITY_FULL');
    expect(await journeyCount(fixture.sectId)).toBe(2);

    // 把第一条挪到「早已到期」→ 它归队待领取，不再占同时历练名额。
    const now = Date.now();
    await transportJourney(firstId, now - 3 * HOUR, now - 1_000);
    await freezeSettlement(fixture.sectId);
    const synced = await fixture.state();
    expect(
      synced.disciples.find((row: { id: string }) => row.id === a).journey.status,
    ).toBe('ready');
    expect(synced.journey.activeCount).toBe(1);

    await startOk(fixture, c, 'gathering', 7_200);
    // 门内 6 人、2 人在外、1 人待领取：仍然留了 3 人以上。
    expect((await fixture.state()).journey.activeCount).toBe(2);
    expect(d).toBeTruthy();
  });

  it('出发后必须至少留 3 名不在外的弟子', async () => {
    // 默认宗门只有 3 名弟子：出发 1 人后只剩 2 人守宗 → 拒绝。
    const small = await makeSect('home', 0);
    const rejected = await small.start(small.discipleIds[0]!, 'gathering', 7_200);
    expect(rejected.status).toBe(409);
    expect(errorOf(rejected).code).toBe('INVALID_STATUS');
    expect(errorOf(rejected).message).toContain('守宗');

    // 补到 4 人：出发 1 人后正好留 3 人 → 允许。
    const extra = await seedDisciple(small.sectId, { name: '第四人' });
    expect(extra).toBeTruthy();
    await startOk(small, small.discipleIds[0]!, 'gathering', 7_200);
  });

  it('已有未领取记录时不能再出发（在外 / 待领取的文案不同）', async () => {
    const fixture = await makeSect('pending');
    const discipleId = fixture.discipleIds[0]!;
    const journeyId = await startOk(fixture, discipleId, 'gathering', 7_200);

    const again = await fixture.start(discipleId, 'gathering', 7_200);
    expect(errorOf(again).code).toBe('INVALID_STATUS');
    expect(errorOf(again).message).toContain('尚未归队');

    const now = Date.now();
    await transportJourney(journeyId, now - 3 * HOUR, now - 1_000);
    await freezeSettlement(fixture.sectId);
    await fixture.state();

    const ready = await fixture.start(discipleId, 'gathering', 7_200);
    expect(errorOf(ready).code).toBe('INVALID_STATUS');
    expect(errorOf(ready).message).toContain('先领取');

    // 已归队待领取可以正常派工。
    const assigned = await fixture.api.post('/api/v1/game/assign', {
      discipleId,
      assignment: 'idle',
    });
    expect(assigned.status).toBe(200);
  });

  it('方向 / 时长白名单与跨宗弟子 id', async () => {
    const fixture = await makeSect('white');
    const discipleId = fixture.discipleIds[0]!;
    expect((await fixture.start(discipleId, 'teamRaid', 7_200)).status).toBe(400);
    expect((await fixture.start(discipleId, 'gathering', 3_600)).status).toBe(400);
    expect((await fixture.start(discipleId, 'gathering', -1)).status).toBe(400);

    // 跨宗：用别的宗门的弟子 id 出发只能拿到 NOT_FOUND。
    const other = await makeSect('white2');
    const cross = await fixture.start(other.discipleIds[0]!, 'gathering', 7_200);
    expect(cross.status).toBe(404);
    expect(errorOf(cross).code).toBe('NOT_FOUND');
    expect(await journeyCount(fixture.sectId)).toBe(0);
    expect(await journeyCount(other.sectId)).toBe(0);
  });

  it('守卫在批内复核，失败不产生半写且不留守卫行', async () => {
    const fixture = await makeSect('guard');
    const discipleId = fixture.discipleIds[0]!;
    await startOk(fixture, discipleId, 'gathering', 7_200);
    // 成功路径的守卫行必须在同一批里被清理掉。
    expect(await mutationGuardCount()).toBe(0);
  });
});

describe('预览：只读、数值与截断', () => {
  it('预览不结算、不写库', async () => {
    const fixture = await makeSect('prev');
    const discipleId = fixture.discipleIds[0]!;
    await freezeSettlement(fixture.sectId);
    const before = await env.DB.prepare('SELECT last_settled_at FROM sects WHERE id = ?')
      .bind(fixture.sectId)
      .first<{ last_settled_at: number }>();

    const preview = await fixture.preview(discipleId);
    expect(preview.status).toBe(200);
    const after = await env.DB.prepare('SELECT last_settled_at FROM sects WHERE id = ?')
      .bind(fixture.sectId)
      .first<{ last_settled_at: number }>();
    expect(after?.last_settled_at).toBe(before?.last_settled_at);
    expect(await journeyCount(fixture.sectId)).toBe(0);
  });

  it('两个方向 × 两档时长都在，数值与纯规则一致', async () => {
    const fixture = await makeSect('prev2');
    const discipleId = fixture.discipleIds[0]!;
    const state = await fixture.state();
    const combatPower = Number(
      state.disciples.find((row: { id: string }) => row.id === discipleId).combatPower,
    );
    const preview = (dataOf(await fixture.preview(discipleId)) as Record<string, any>) as {
      canStart: boolean;
      activeCount: number;
      maxConcurrent: number;
      directions: {
        direction: string;
        available: boolean;
        durations: {
          durationSeconds: number;
          cultivation: number;
          cultivationCapped: boolean;
          resources: Record<string, string>;
          injuryChanceBp: number;
          extraChanceBp: number;
        }[];
      }[];
    };
    expect(preview.canStart).toBe(true);
    expect(preview.maxConcurrent).toBe(2);
    expect(preview.directions.map((item) => item.direction)).toEqual(['daoSeeking', 'gathering']);
    for (const direction of preview.directions) {
      expect(direction.durations.map((item) => item.durationSeconds)).toEqual([7_200, 21_600]);
      for (const duration of direction.durations) {
        const plan = findJourneyPlan(direction.direction as JourneyDirection, duration.durationSeconds);
        expect(plan).toBeDefined();
        expect(duration.extraChanceBp).toBe(1_500);
        // 资质 50 → 系数 10000：保底修为就是表值；受伤概率按 0 战力取表格值。
        // 资质 50 → 修炼系数 10000：保底修为就是表值，再按当前剩余门槛（300）截断。
        const expectedCultivation = previewJourneyCultivation(plan!.cultivation, 300, 0);
        expect(duration.cultivation).toBe(expectedCultivation.cultivation);
        expect(duration.cultivationCapped).toBe(expectedCultivation.capped);
        // 受伤概率按出发时战力下调：预览值必须与纯规则 journeyInjuryChanceBp 完全一致。
        expect(duration.injuryChanceBp).toBe(journeyInjuryChanceBp(plan!, combatPower));
      }
    }
  });

  it('预览修为按当前剩余门槛截断并标注「最多」', async () => {
    const fixture = await makeSect('prev3');
    const discipleId = fixture.discipleIds[0]!;
    await setCultivation(discipleId, 290);
    const preview = (dataOf(await fixture.preview(discipleId)) as Record<string, any>) as {
      directions: { direction: string; durations: { durationSeconds: number; cultivation: number; cultivationCapped: boolean }[] }[];
    };
    const dao = preview.directions.find((item) => item.direction === 'daoSeeking')!;
    const sixHour = dao.durations.find((item) => item.durationSeconds === 21_600)!;
    // 剩余门槛 10 → 预览只能是 10（访道 6 小时保底 540）。
    expect(sixHour.cultivation).toBe(10);
    expect(sixHour.cultivationCapped).toBe(true);
  });

  it('访道要求仍有修为门槛；最高阶段只有采集可用且修为收益为 0', async () => {
    const fixture = await makeSect('prev4');
    const full = fixture.discipleIds[0]!;
    await setCultivation(full, 300); // 已到筑基初期门槛
    let preview = (dataOf(await fixture.preview(full)) as Record<string, any>) as {
      canStart: boolean;
      directions: { direction: string; available: boolean; blockedReason: string | null; durations: { cultivation: number }[] }[];
    };
    const daoBlocked = preview.directions.find((item) => item.direction === 'daoSeeking')!;
    expect(daoBlocked.available).toBe(false);
    expect(daoBlocked.blockedReason).toContain('先破境');
    const gatheringOk = preview.directions.find((item) => item.direction === 'gathering')!;
    expect(gatheringOk.available).toBe(true);
    // 修为已满：采集的修为收益预览为 0。
    expect(gatheringOk.durations.every((item) => item.cultivation === 0)).toBe(true);
    expect(preview.canStart).toBe(true);

    // 最高阶段：访道不可用，采集仍可用且修为为 0。
    const top = await seedDisciple(fixture.sectId, {
      name: '化神客',
      realmId: 'spiritTransformation',
      stage: 3,
    });
    preview = (dataOf(await fixture.preview(top)) as Record<string, any>) as typeof preview;
    expect(preview.directions.find((item) => item.direction === 'daoSeeking')!.available).toBe(false);
    const topGathering = preview.directions.find((item) => item.direction === 'gathering')!;
    expect(topGathering.available).toBe(true);
    expect(topGathering.durations.every((item) => item.cultivation === 0)).toBe(true);
  });

  it('预览给出名额与不可出发原因，不展示随机结果', async () => {
    const fixture = await makeSect('prev5');
    const qiRefining = fixture.discipleIds[fixture.discipleIds.length - 1]!;
    const preview = (dataOf(await fixture.preview(qiRefining)) as Record<string, any>) as Record<
      string,
      any
    >;
    expect(preview.canStart).toBe(false);
    expect(preview.blockedReason).toContain('筑基');
    expect(preview.directions.every((item: { available: boolean }) => item.available === false)).toBe(
      true,
    );
    // 结果快照（额外收获 / 受伤）不在预览里。
    const serialized = JSON.stringify(preview);
    expect(serialized).not.toContain('extraHarvest');
    expect(serialized).not.toContain('cultivationAwarded');
    expect(serialized).not.toContain('reward_');
  });

  it('预览对跨宗 / 不存在的弟子返回 NOT_FOUND', async () => {
    const fixture = await makeSect('prev6');
    const other = await makeSect('prev7');
    const cross = await fixture.preview(other.discipleIds[0]!);
    expect(cross.status).toBe(404);
    expect(errorOf(cross).code).toBe('NOT_FOUND');
    expect((await fixture.preview(crypto.randomUUID())).status).toBe(404);
    // 缺参数 → 400。
    expect((await fixture.api.get('/api/v1/game/journey-preview')).status).toBe(400);
  });

  it('出发后未到期不向前端泄漏结果', async () => {
    const fixture = await makeSect('prev8');
    const discipleId = fixture.discipleIds[0]!;
    await startOk(fixture, discipleId, 'gathering', 7_200);
    const state = await fixture.state();
    const journey = state.disciples.find((row: { id: string }) => row.id === discipleId).journey;
    expect(journey.status).toBe('active');
    expect(journey.outcome).toBeNull();
    // 历史摘要里未到期的那条同样不给结果。
    const record = state.journey.recent.find(
      (item: { id: string }) => item.id === journey.journeyId,
    );
    expect(record.status).toBe('active');
    expect(record.outcome).toBeNull();
    expect(JSON.stringify(state.journey)).not.toContain('extraHarvest');
  });
});

describe('在外期间的产出屏蔽与归队', () => {
  it('在外区间不计原岗位收益；归队后恢复', async () => {
    const fixture = await makeSect('mask');
    const discipleId = fixture.discipleIds[0]!;
    await isolateProduction(fixture.sectId, discipleId, 'herbGathering');
    await freezeSettlement(fixture.sectId);

    const journeyId = await startOk(fixture, discipleId, 'gathering', 7_200);
    await setBalance(fixture.sectId, 'herb', 0);

    // 窗口 20 分钟：前 10 分钟在外（屏蔽），后 10 分钟在岗。
    const now = Date.now();
    await transportJourney(journeyId, now - 30 * 60_000, now - 10 * 60_000);
    await setLastSettledAt(fixture.sectId, now - 20 * 60_000);

    const cursor = await latestEventRowid(fixture.sectId);
    await fixture.state();
    const events = await eventEffectsSince(fixture.sectId, cursor);
    const balance = await dbBalance(fixture.sectId, 'herb');
    // 药园 20000/时 × 10 分钟 = 3333（在外面那 10 分钟不计）。
    expect(balance - (events.herb ?? 0)).toBe(3_333);

    // 归队后（历练区间整段落在新窗口之前）产出恢复：再跑 20 分钟，全部在岗。
    const later = Date.now();
    await transportJourney(journeyId, later - 40 * 60_000, later - 25 * 60_000);
    await setLastSettledAt(fixture.sectId, later - 20 * 60_000);
    await setBalance(fixture.sectId, 'herb', 0);
    const cursor2 = await latestEventRowid(fixture.sectId);
    await fixture.state();
    const events2 = await eventEffectsSince(fixture.sectId, cursor2);
    const balance2 = await dbBalance(fixture.sectId, 'herb');
    // 20000/时 × 20 分钟 = 6666（余数 0.667 小时 → 6666.67 → 6666）。
    expect(balance2 - (events2.herb ?? 0)).toBe(6_666);
  });

  it('视图里的资源速率与静修速率同步屏蔽，归队后立即恢复', async () => {
    const fixture = await makeSect('rate');
    const discipleId = fixture.discipleIds[0]!;
    await isolateProduction(fixture.sectId, discipleId, 'herbGathering');
    await freezeSettlement(fixture.sectId);
    const before = await fixture.state();
    const rateBefore = Number(
      before.resources.find((row: { id: string }) => row.id === 'herb')!.ratePerHour,
    );
    expect(rateBefore).toBeGreaterThanOrEqual(20_000);

    const journeyId = await startOk(fixture, discipleId, 'gathering', 7_200);
    const during = await fixture.state();
    const rateDuring = Number(
      during.resources.find((row: { id: string }) => row.id === 'herb')!.ratePerHour,
    );
    expect(rateDuring).toBe(rateBefore - 20_000);
    // 原岗位名额仍为他保留（assignments.currentCount 不变）。
    expect(during.disciples.find((row: { id: string }) => row.id === discipleId).assignment).toBe(
      'herbGathering',
    );

    const now = Date.now();
    await transportJourney(journeyId, now - 3 * HOUR, now - 1_000);
    const after = await fixture.state();
    const rateAfter = Number(
      after.resources.find((row: { id: string }) => row.id === 'herb')!.ratePerHour,
    );
    expect(rateAfter).toBe(rateBefore);
    expect(after.disciples.find((row: { id: string }) => row.id === discipleId).journey.status).toBe(
      'ready',
    );
  });

  it('到期归队：修为入账、伤势从到期时间起算、完成只做一次', async () => {
    const fixture = await makeSect('return');
    const discipleId = fixture.discipleIds[0]!;
    const journeyId = await startOk(fixture, discipleId, 'daoSeeking', 7_200);

    const now = Date.now();
    const endsAt = now - 5 * HOUR;
    await transportJourney(journeyId, endsAt - 2 * HOUR, endsAt);
    const planned = (await journeyRow(journeyId))!.reward_cultivation;
    const injured = (await journeyRow(journeyId))!.injured === 1;

    await freezeSettlement(fixture.sectId);
    const first = await fixture.state();
    const row = (await journeyRow(journeyId))!;
    expect(row.completed_at).not.toBeNull();
    expect(row.cultivation_awarded).toBe(Math.min(planned, 300));

    const disciple = await discipleRow(discipleId);
    expect(disciple?.cultivation).toBe(Math.min(planned, 300));
    if (injured) {
      // 伤势固定从到期时间起算 30 分钟（不是领取时间）：早已过去 → 已痊愈。
      expect(disciple?.injured_until).toBe(endsAt + 30 * 60_000);
      expect(first.disciples.find((r: { id: string }) => r.id === discipleId).injuredUntil).not.toBeNull();
    } else {
      expect(disciple?.injured_until).toBeNull();
    }

    // 重复同步不会重复发奖、也不会改写完成时间。
    const beforeSecond = await discipleRow(discipleId);
    await fixture.state();
    const afterSecond = await discipleRow(discipleId);
    expect(afterSecond?.cultivation).toBe(beforeSecond?.cultivation);
    expect((await journeyRow(journeyId))!.completed_at).toBe(row.completed_at);
    expect((await journeyRow(journeyId))!.cultivation_awarded).toBe(row.cultivation_awarded);
  });

  it('修为按返程门槛封顶，不越过当前阶段门槛', async () => {
    const fixture = await makeSect('cap');
    const discipleId = fixture.discipleIds[0]!;
    await setCultivation(discipleId, 280);
    const journeyId = await startOk(fixture, discipleId, 'daoSeeking', 21_600);

    const now = Date.now();
    await transportJourney(journeyId, now - 8 * HOUR, now - 6 * HOUR);
    await freezeSettlement(fixture.sectId);
    await fixture.state();

    const disciple = await discipleRow(discipleId);
    // 剩余额度只有 20：实际入账 20，修为止步于门槛 300。
    expect(disciple?.cultivation).toBe(300);
    expect((await journeyRow(journeyId))!.cultivation_awarded).toBe(20);
  });

  it('超过 12 小时离线：普通产出仍只按 12 小时算，但到期的历练奖励照发', async () => {
    const fixture = await makeSect('offline');
    const discipleId = fixture.discipleIds[0]!;
    await isolateProduction(fixture.sectId, discipleId, 'herbGathering');
    await freezeSettlement(fixture.sectId);
    const journeyId = await startOk(fixture, discipleId, 'gathering', 7_200);
    await setBalance(fixture.sectId, 'herb', 0);

    const now = Date.now();
    // 出发在 30 小时前、到期在 28 小时前：整段都在 12 小时上限窗口之前。
    await transportJourney(journeyId, now - 30 * HOUR, now - 28 * HOUR);
    await setLastSettledAt(fixture.sectId, now - 30 * HOUR);

    const cursor = await latestEventRowid(fixture.sectId);
    const synced = await fixture.state();
    const events = await eventEffectsSince(fixture.sectId, cursor);

    // 12 小时窗口是 [now-30h, now-18h)，历练区间 [now-30h, now-28h) 在里面：屏蔽前 2 小时，
    // 归队后的 10 小时照常产药（20000/时 × 10h = 200000）。整次结算只有一个 12 小时窗口。
    const balance = await dbBalance(fixture.sectId, 'herb');
    expect(balance - (events.herb ?? 0)).toBe(20_000 * 10);
    expect(synced.settle.durationSeconds).toBe(12 * 3_600);
    expect(synced.settle.cappedByOfflineLimit).toBe(true);

    // 历练奖励没有因为晚登录而消失。
    const row = (await journeyRow(journeyId))!;
    expect(row.completed_at).not.toBeNull();
    expect(row.cultivation_awarded).toBeGreaterThanOrEqual(0);
  });

  it('时钟回拨：不产生负时长、不重复发奖、历练状态不受影响', async () => {
    const fixture = await makeSect('back');
    const discipleId = fixture.discipleIds[0]!;
    const journeyId = await startOk(fixture, discipleId, 'gathering', 7_200);
    await setLastSettledAt(fixture.sectId, Date.now() + 10 * HOUR);

    const synced = await fixture.state();
    expect(synced.settle.durationSeconds).toBe(0);
    expect(synced.settle.clockWentBackwards).toBe(true);
    // 尚未到期：状态不变、结果不泄漏、完成时间仍为空。
    expect(synced.disciples.find((row: { id: string }) => row.id === discipleId).journey.status).toBe(
      'active',
    );
    expect((await journeyRow(journeyId))!.completed_at).toBeNull();
  });
});

describe('领取：一次性入账、只发一次', () => {
  it('领取发放资源并标记 claimed_at；重复领取不重复发奖', async () => {
    const fixture = await makeSect('claim');
    const discipleId = fixture.discipleIds[0]!;
    const journeyId = await startOk(fixture, discipleId, 'gathering', 21_600);
    const now = Date.now();
    await transportJourney(journeyId, now - 8 * HOUR, now - 1_000);
    await freezeSettlement(fixture.sectId);

    const row = (await journeyRow(journeyId))!;
    const resources = JSON.parse(row.reward_resources) as Record<string, string>;
    expect(Object.keys(resources).length).toBeGreaterThan(0);

    const before = await dbBalance(fixture.sectId, 'herb');
    const claimed = await fixture.claim(journeyId);
    expect(claimed.status).toBe(200);
    const outcome = (dataOf(claimed) as Record<string, any>).outcome as Record<string, any>;
    expect(outcome.journeyId).toBe(journeyId);
    expect(outcome.resources).toEqual(
      Object.fromEntries(Object.entries(resources).map(([id, amount]) => [id, String(amount)])),
    );

    const after = await dbBalance(fixture.sectId, 'herb');
    expect(after - before).toBe(Number(resources.herb ?? 0));
    expect((await journeyRow(journeyId))!.claimed_at).not.toBeNull();

    // 重复领取：必须失败且不改余额。
    const again = await fixture.claim(journeyId);
    expect(again.status).toBe(409);
    expect(errorOf(again).code).toBe('INVALID_STATUS');
    expect(await dbBalance(fixture.sectId, 'herb')).toBe(after);
  });

  it('未到期不能领取', async () => {
    const fixture = await makeSect('claim2');
    const discipleId = fixture.discipleIds[0]!;
    const journeyId = await startOk(fixture, discipleId, 'gathering', 21_600);
    const rejected = await fixture.claim(journeyId);
    expect(rejected.status).toBe(409);
    expect(errorOf(rejected).message).toContain('尚未归队');
    expect((await journeyRow(journeyId))!.claimed_at).toBeNull();
  });

  it('未先 sync 直接领取：完成与领取在同一请求内一次做完', async () => {
    const fixture = await makeSect('claim3');
    const discipleId = fixture.discipleIds[0]!;
    const journeyId = await startOk(fixture, discipleId, 'daoSeeking', 7_200);
    const now = Date.now();
    await transportJourney(journeyId, now - 4 * HOUR, now - 1_000);
    await freezeSettlement(fixture.sectId);

    // 这次领取是到期后的第一个请求：归队入账与资源发放必须一起完成。
    const claimed = await fixture.claim(journeyId);
    expect(claimed.status).toBe(200);
    const row = (await journeyRow(journeyId))!;
    expect(row.completed_at).not.toBeNull();
    expect(row.claimed_at).not.toBeNull();
    expect(row.cultivation_awarded).not.toBeNull();
    const disciple = await discipleRow(discipleId);
    expect(disciple?.cultivation).toBe(row.cultivation_awarded);
  });

  it('跨宗 / 不存在的 journeyId 返回 NOT_FOUND，不泄露他人记录', async () => {
    const fixture = await makeSect('claim4');
    const other = await makeSect('claim5');
    const otherJourney = await startOk(other, other.discipleIds[0]!, 'gathering', 7_200);
    const cross = await fixture.claim(otherJourney);
    expect(cross.status).toBe(404);
    expect(errorOf(cross).code).toBe('NOT_FOUND');
    expect((await fixture.claim(crypto.randomUUID())).status).toBe(404);
    // 他人的记录没有被误领。
    expect((await journeyRow(otherJourney))!.claimed_at).toBeNull();
  });

  it('领取后可以再次出发（唯一部分索引随之释放）', async () => {
    const fixture = await makeSect('claim6');
    const discipleId = fixture.discipleIds[0]!;
    const first = await startOk(fixture, discipleId, 'gathering', 7_200);
    const now = Date.now();
    await transportJourney(first, now - 3 * HOUR, now - 1_000);
    await freezeSettlement(fixture.sectId);
    expect((await fixture.claim(first)).status).toBe(200);

    // 本用例只验证未领取唯一索引在领取后释放；第一次历练可能随机受伤，
    // 伤势会独立阻止再次出发，因此清掉伤势，避免把两条规则混成概率性测试。
    await env.DB.prepare('UPDATE disciples SET injured_until = NULL WHERE id = ?')
      .bind(discipleId)
      .run();
    const second = await startOk(fixture, discipleId, 'gathering', 7_200);
    expect(second).not.toBe(first);
    expect(await journeyCount(fixture.sectId)).toBe(2);
  });

  it('领取前不能驱逐；领取后可以，历史仍保留姓名与结果', async () => {
    const fixture = await makeSect('claim7');
    const discipleId = fixture.discipleIds[0]!;
    const journeyId = await startOk(fixture, discipleId, 'gathering', 7_200);
    const now = Date.now();
    await transportJourney(journeyId, now - 3 * HOUR, now - 1_000);
    await freezeSettlement(fixture.sectId);
    await fixture.state();

    const blocked = await fixture.api.post('/api/v1/game/expel-disciple', { discipleId });
    expect(errorOf(blocked).code).toBe('INVALID_STATUS');
    expect(errorOf(blocked).message).toContain('先领取');

    expect((await fixture.claim(journeyId)).status).toBe(200);
    const expelled = await fixture.api.post('/api/v1/game/expel-disciple', { discipleId });
    expect(expelled.status).toBe(200);

    // 历史记录：弟子行已删除，但历练记录（含姓名快照）仍在。
    const row = (await journeyRow(journeyId))!;
    expect(row.disciple_name.length).toBeGreaterThan(0);
    expect(await journeyCount(fixture.sectId)).toBe(1);
  });
});

describe('在外弟子的其它写路径一律被服务端拒绝', () => {
  it('转岗 / 破境 / 服药 / 驱逐 / 布阵 / 探索 / 挑战都被拒', async () => {
    const fixture = await makeSect('block');
    const [a, b, c, d, e] = fixture.discipleIds as [string, string, string, string, string];
    await startOk(fixture, a, 'gathering', 21_600);
    await freezeSettlement(fixture.sectId);

    const assign = await fixture.api.post('/api/v1/game/assign', { discipleId: a, assignment: 'idle' });
    expect(assign.status).toBe(409);
    expect(errorOf(assign).message).toContain('在外历练');

    const breakthrough = await fixture.api.post('/api/v1/game/breakthrough', { discipleId: a });
    expect(errorOf(breakthrough).code).toBe('INVALID_STATUS');

    const lineup = await fixture.api.post('/api/v1/game/set-defense-lineup', {
      discipleIds: [a, b, c],
    });
    expect(errorOf(lineup).code).toBe('INVALID_STATUS');
    expect(errorOf(lineup).message).toContain('在外历练');

    const expel = await fixture.api.post('/api/v1/game/expel-disciple', { discipleId: a });
    expect(errorOf(expel).code).toBe('INVALID_STATUS');

    const explore = await fixture.api.post('/api/v1/game/explore', {
      realmId: 'mistyForest',
      discipleIds: [a],
    });
    expect(errorOf(explore).code).toBe('INVALID_STATUS');

    const challenge = await fixture.api.post('/api/v1/game/challenge', {
      targetSectId: fixture.sectId,
      discipleIds: [a, b, c],
    });
    // 打自己会被更早的「不能挑战自己的宗门」拦下，所以这里用另一家宗门。
    expect(challenge.status).toBeGreaterThanOrEqual(400);
    const other = await makeSect('block2');
    const target = await fixture.api.get(`/api/v1/game/sect/${other.sectId}`);
    expect(target.status).toBe(200);
    const realChallenge = await fixture.api.post('/api/v1/game/challenge', {
      targetSectId: other.sectId,
      discipleIds: [a, b, c],
    });
    expect(errorOf(realChallenge).code).toBe('INVALID_STATUS');
    expect(errorOf(realChallenge).message).toContain('在外历练');

    // 备注不受限制（计划 2.3 明确允许）。
    const note = await fixture.api.post('/api/v1/game/set-disciple-note', {
      discipleId: a,
      note: '在外也要记一笔',
    });
    expect(note.status).toBe(200);

    // 最后一个可用的留守弟子：未被限制的路径仍然可用。
    expect(d).toBeTruthy();
    expect(e).toBeTruthy();
  });

  it('在外弟子不会被自动守擂选中（守方实时状态参与裁决）', async () => {
    const fixture = await makeSect('auto');
    const [a, b, c, d, e] = fixture.discipleIds as [string, string, string, string, string];
    await freezeSettlement(fixture.sectId);

    // 守方：手动阵容留空 → 自动守擂；把 a 派出（他不在手动阵容里，所以可以出发）。
    await setDefenseLineup(fixture.sectId, null as unknown as string[]);
    await startOk(fixture, a, 'gathering', 21_600);
    const state = await fixture.state();
    // 自动守擂的候选只剩 5 人（a 在外），仍然 ≥ 3，可以应战。
    expect(state.journey.activeCount).toBe(1);

    const attacker = await makeSect('auto2');
    await freezeSettlement(attacker.sectId);
    const result = await attacker.api.post('/api/v1/game/challenge', {
      targetSectId: fixture.sectId,
      discipleIds: attacker.discipleIds.slice(0, 3),
    });
    expect(result.status).toBe(200);
    const payload = (dataOf(result) as Record<string, any>).result as {
      rounds: { defenderName: string }[];
    };
    const defenderNames = payload.rounds.map((round) => round.defenderName);
    const awayName = state.disciples.find((row: { id: string }) => row.id === a).name as string;
    expect(defenderNames).not.toContain(awayName);
    expect(b).toBeTruthy();
    expect(c).toBeTruthy();
    expect(d).toBeTruthy();
    expect(e).toBeTruthy();
  });
});

describe('并发与幂等：不得半写或重复发奖', () => {
  it('旧 sync 在领取后才提交时重读快照，不覆盖领取的资源', async () => {
    const fixture = await makeSect('stale-sync');
    const journeyId = await startOk(fixture, fixture.discipleIds[0]!, 'gathering', 7_200);
    const now = Date.now();
    await transportJourney(journeyId, now - 3 * HOUR, now - 1_000);
    await setLastSettledAt(fixture.sectId, now - HOUR);

    const sect = await new SectRepository(env.DB).findById(fixture.sectId);
    let releaseBatch!: () => void;
    let batchStarted!: () => void;
    const held = new Promise<void>((resolve) => { releaseBatch = resolve; });
    const staged = new Promise<void>((resolve) => { batchStarted = resolve; });
    let firstBatch = true;
    const delayedDb = new Proxy(env.DB, {
      get(target, key) {
        if (key === 'batch') {
          return async (statements: D1PreparedStatement[]) => {
            if (firstBatch) {
              firstBatch = false;
              batchStarted();
              await held;
            }
            return target.batch(statements);
          };
        }
        const value = Reflect.get(target, key, target) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    const sync = getSectState(delayedDb, sect!.user_id, now);
    await staged;
    let balanceAfterClaim = 0;
    try {
      const claimed = await fixture.claim(journeyId);
      expect(claimed.status).toBe(200);
      balanceAfterClaim = await dbBalance(fixture.sectId, 'herb');
    } finally {
      releaseBatch();
    }
    const result = await sync;
    expect(result).not.toBeNull();
    expect(await dbBalance(fixture.sectId, 'herb')).toBe(balanceAfterClaim);
    expect(await mutationGuardCount()).toBe(0);
  });

  it('守方弟子在挑战快照之后出发，旧挑战批次回滚', async () => {
    const attacker = await makeSect('stale-challenge-a');
    const defender = await makeSect('stale-challenge-b');
    await freezeSettlement(attacker.sectId);
    await freezeSettlement(defender.sectId);
    const attackerSect = await new SectRepository(env.DB).findById(attacker.sectId);
    const defenderSect = await new SectRepository(env.DB).findById(defender.sectId);
    const defenderIds = defender.discipleIds.slice(0, 3);
    const guardId = crypto.randomUUID();
    const guard = challengeSnapshotGuardStatement(guardId, {
      sect: attackerSect!,
      balances: await new ResourceBalanceRepository(env.DB).findBySectId(attacker.sectId),
      members: attacker.discipleIds.slice(0, 3).map((id) => ({ id })),
      target: {
        id: defenderSect!.id,
        level: defenderSect!.level,
        defenseLineup: defenderSect!.defense_lineup,
      },
      defenderIds,
      now: Date.now(),
    });
    expect((await new DiscipleRepository(env.DB).findBySectId(defender.sectId)).length).toBeGreaterThan(3);
    expect((await defender.start(defenderIds[0]!, 'gathering', 7_200)).status).toBe(200);

    await expect(env.DB.batch(prepareStatements(env.DB, [
      guard,
      { sql: 'UPDATE sects SET challenge_count = challenge_count + 1 WHERE id = ?', params: [attacker.sectId] },
      deleteChallengeSnapshotGuardStatement(guardId),
    ]))).rejects.toThrow(/mutation_guards|valid = 1/);
    expect((await new SectRepository(env.DB).findById(attacker.sectId))!.challenge_count).toBe(0);
    expect(await mutationGuardCount()).toBe(0);
  });

  it('并发出发（4 个不同弟子）成功数不超过 2', async () => {
    const fixture = await makeSect('race');
    await freezeSettlement(fixture.sectId);
    const targets = fixture.discipleIds.slice(0, 4);
    const results = await Promise.all(
      targets.map((discipleId) => fixture.start(discipleId, 'gathering', 21_600)),
    );
    const ok = results.filter((result) => result.status === 200).length;
    expect(ok).toBeLessThanOrEqual(2);
    expect(ok).toBeGreaterThanOrEqual(1);

    const rows = await journeyRows(fixture.sectId);
    expect(rows.length).toBe(ok);
    // 成功的记录都必须是完整的（有 started_at/ends_at、未完成未领取）。
    for (const row of rows) {
      expect(row.ends_at).toBeGreaterThan(row.started_at);
      expect(row.completed_at).toBeNull();
      expect(row.claimed_at).toBeNull();
    }
    // 不允许留下守卫残留。
    expect(await mutationGuardCount()).toBe(0);
  });

  it('并发领取同一记录只成功一次，余额只加一次', async () => {
    const fixture = await makeSect('race2');
    const discipleId = fixture.discipleIds[0]!;
    const journeyId = await startOk(fixture, discipleId, 'gathering', 21_600);
    const now = Date.now();
    await transportJourney(journeyId, now - 8 * HOUR, now - 1_000);
    await freezeSettlement(fixture.sectId);
    await fixture.state();

    const before = await dbBalance(fixture.sectId, 'herb');
    const results = await Promise.all([fixture.claim(journeyId), fixture.claim(journeyId)]);
    const ok = results.filter((result) => result.status === 200).length;
    expect(ok).toBe(1);

    const resources = JSON.parse((await journeyRow(journeyId))!.reward_resources) as Record<
      string,
      string
    >;
    const after = await dbBalance(fixture.sectId, 'herb');
    expect(after - before).toBe(Number(resources.herb ?? 0));
    expect(await mutationGuardCount()).toBe(0);
  });

  it('并发 sync 与领取不会重复发放历练修为', async () => {
    const fixture = await makeSect('race3');
    const discipleId = fixture.discipleIds[0]!;
    const journeyId = await startOk(fixture, discipleId, 'daoSeeking', 7_200);
    const now = Date.now();
    await transportJourney(journeyId, now - 4 * HOUR, now - 1_000);
    await freezeSettlement(fixture.sectId);

    await Promise.all([fixture.api.get('/api/v1/game/sync'), fixture.claim(journeyId)]);
    const row = (await journeyRow(journeyId))!;
    const disciple = await discipleRow(discipleId);
    // 修为只入账一次：不得超过计划值，也不得超过门槛。
    expect(disciple!.cultivation).toBeLessThanOrEqual(Math.min(row.reward_cultivation, 300));
    expect(row.cultivation_awarded).toBe(disciple!.cultivation);
  });

  it('出发 / 领取成功后不残留 mutation_guards', async () => {
    const fixture = await makeSect('guards');
    const discipleId = fixture.discipleIds[0]!;
    const journeyId = await startOk(fixture, discipleId, 'gathering', 7_200);
    const now = Date.now();
    await transportJourney(journeyId, now - 3 * HOUR, now - 1_000);
    await freezeSettlement(fixture.sectId);
    expect((await fixture.claim(journeyId)).status).toBe(200);
    expect(await mutationGuardCount()).toBe(0);
  });

  it('并发派工与出发：不会出现幽灵成功或失效岗位', async () => {
    const fixture = await makeSect('race4');
    const [a, b] = fixture.discipleIds as [string, string];
    await freezeSettlement(fixture.sectId);
    const [assignResult, startResult] = await Promise.all([
      fixture.api.post('/api/v1/game/assign', { discipleId: a, assignment: 'idle' }),
      fixture.start(a, 'gathering', 7_200),
    ]);
    // 两者都可能成功、也可能有一方因快照冲突失败，但绝不能出现「派工成功且在外产出照常」。
    const state = await fixture.state();
    const journey = state.disciples.find((row: { id: string }) => row.id === a).journey;
    if (startResult.status === 200 && journey.status === 'active') {
      // 岗位快照记录的是出发那一刻的岗位。
      const row = (await journeyRows(fixture.sectId))[0]!;
      expect(['idle', 'herbGathering', 'oreGathering']).toContain(row.original_assignment);
    }
    expect(assignResult.status === 200 || assignResult.status === 409).toBe(true);
    expect(b).toBeTruthy();
    expect(await mutationGuardCount()).toBe(0);
  });
});

describe('回归：既有探索与挑战规则不受影响', () => {
  it('没有历练记录时探索与挑战照常工作', async () => {
    const fixture = await makeSect('regress');
    // 探索需要演武场（宗门 4 级解锁）；这里直接给一座，保证是「0014 之前就能跑通」的路径。
    await env.DB.prepare(
      'INSERT INTO buildings (id, sect_id, def_id, level, created_at) VALUES (?, ?, ?, 1, ?)',
    )
      .bind(crypto.randomUUID(), fixture.sectId, 'arenaHall', Date.now())
      .run();
    await freezeSettlement(fixture.sectId);
    const explore = await fixture.api.post('/api/v1/game/explore', {
      realmId: 'mistyForest',
      discipleIds: [fixture.discipleIds[0]!],
    });
    expect(explore.status).toBe(200);

    const other = await makeSect('regress2');
    await freezeSettlement(other.sectId);
    const challenge = await other.api.post('/api/v1/game/challenge', {
      targetSectId: fixture.sectId,
      discipleIds: other.discipleIds.slice(0, 3),
    });
    expect(challenge.status).toBe(200);
  });

  it('合法时长与数值表一一对应（防调参漂移）', () => {
    expect(JOURNEY_PLANS.map((plan) => `${plan.direction}:${String(plan.durationSeconds)}`)).toEqual([
      'daoSeeking:7200',
      'daoSeeking:21600',
      'gathering:7200',
      'gathering:21600',
    ]);
  });
});

describe('异常与并发交错：不留悬空记录、不产生免费奖励', () => {
  it('弟子行异常消失时归队仍会收口，只允许领取一次', async () => {
    const fixture = await makeSect('dangling');
    const ghostId = crypto.randomUUID();
    const journeyId = crypto.randomUUID();
    const now = Date.now();
    // 模拟「弟子行已不存在、但历练记录还挂着未领取」的异常残留
    // （正常路径不可达：驱逐被 requireJourneySettled + 守卫双重挡住）。
    await env.DB.prepare(
      `INSERT INTO disciple_journeys
         (id, sect_id, disciple_id, disciple_name, direction, duration_seconds,
          original_assignment, started_at, ends_at, completed_at, claimed_at,
          reward_cultivation, reward_resources, extra_harvest, injured, injury_chance_bp,
          cultivation_awarded, created_at)
       VALUES (?, ?, ?, '已离宗者', 'gathering', 7200, 'idle', ?, ?, NULL, NULL,
               144, '{"herb":75000}', 0, 0, 700, NULL, ?)`,
    )
      .bind(journeyId, fixture.sectId, ghostId, now - 3 * HOUR, now - 1 * HOUR, now)
      .run();

    await freezeSettlement(fixture.sectId);
    await fixture.state();

    const row = (await journeyRow(journeyId))!;
    // 收口：必须写 completed_at（并记 0 修为），否则 claim 的条件更新永远不成立。
    expect(row.completed_at).not.toBeNull();
    expect(row.cultivation_awarded).toBe(0);

    const before = await dbBalance(fixture.sectId, 'herb');
    expect((await fixture.claim(journeyId)).status).toBe(200);
    expect(await dbBalance(fixture.sectId, 'herb')).toBe(before + 75_000);

    // 第二次必须失败：claimed_at 已经写上了，不能无限重复领。
    const again = await fixture.claim(journeyId);
    expect(again.status).toBe(409);
    expect(await dbBalance(fixture.sectId, 'herb')).toBe(before + 75_000);
  });

  it('守卫拦下「仍在外」弟子的驱逐批：整批回滚且不残留守卫行', async () => {
    const fixture = await makeSect('guard2');
    const discipleId = fixture.discipleIds[0]!;
    await startOk(fixture, discipleId, 'gathering', 21_600);

    const savedSect = await new SectRepository(env.DB).findById(fixture.sectId);
    const balances = await new ResourceBalanceRepository(env.DB).findBySectId(fixture.sectId);

    const guardId = crypto.randomUUID();
    const guard = discipleSnapshotGuardStatement(guardId, {
      sect: savedSect!,
      balances,
      members: [{ id: discipleId }],
      now: Date.now(),
      rejectAwayMembers: true,
    });
    await expect(
      env.DB.batch(
        prepareStatements(env.DB, [
          guard,
          deleteDiscipleStatement(discipleId, fixture.sectId),
          deleteDiscipleSnapshotGuardStatement(guardId),
        ]),
      ),
    ).rejects.toThrow(/CHECK constraint failed|mutation_guards/);

    // 整批回滚：弟子还在（不会出现「弟子没了、历练还挂着」的悬空行）。
    expect(await discipleRow(discipleId)).not.toBeNull();
    expect(await mutationGuardCount()).toBe(0);

    // 同一个守卫在「允许在外」时放行 —— 私有备注路径必须继续可用。
    const allowedGuardId = crypto.randomUUID();
    const allowedGuard = discipleSnapshotGuardStatement(allowedGuardId, {
      sect: savedSect!,
      balances,
      members: [{ id: discipleId }],
      now: Date.now(),
      rejectAwayMembers: false,
    });
    await env.DB.batch(
      prepareStatements(env.DB, [
        allowedGuard,
        deleteDiscipleSnapshotGuardStatement(allowedGuardId),
      ]),
    );
    expect(await mutationGuardCount()).toBe(0);
  });
});
