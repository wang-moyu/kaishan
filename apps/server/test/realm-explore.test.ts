import { applyD1Migrations, env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app';
import { prepareStatements } from '../src/infra/db/repository';
import {
  RealmExplorationRepository,
  ResourceBalanceRepository,
  SectRepository,
  deleteRealmExploreSnapshotGuardStatement,
  realmExploreSnapshotGuardStatement,
  updateRealmExplorationStageStatement,
} from '../src/modules/game/repository';

import { dataOf, envWith, errorOf, TestClient, type ApiResult } from './support/authClient';

/**
 * V6 交互式秘境探索（0015 + OpenRouter Decisions + 降级）。
 *
 * 确定性说明：
 * - `sects.last_settled_at` 拨到未来 → 每次请求的结算都是零产出零事件，资源断言才精确；
 * - 判定走**降级路径**（测试环境不给 OPENROUTER_API_KEY），并用 `vi.spyOn(Math, 'random')`
 *   固定随机源 → `roll = floor(r * 10000)`：`0.0001` 必然大成功、`0.9999` 必然失败
 *   （迷雾森林 + 低阶弟子的成功率约 3973 基点，两侧都留足余量）。
 * - 开关（REALM_EXPLORE_ENABLED）在每个用例里用 `envWith` 显式覆盖，不依赖开发者本地的 .dev.vars。
 *
 * 存储说明：本文件一份独立内存 D1，没有逐用例回滚 —— 每个用例用独立账号/宗门。
 */

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

const quietLogger = { info: () => {}, warn: () => {}, error: () => {} } as const;
const app = createApp({ logger: quietLogger });
const PASSWORD = 'password-123456';

/** 探索开 / 关两种环境的客户端。都没有 OPENROUTER_API_KEY → 必然走本地降级。 */
const ENV_ON = envWith(env, { REALM_EXPLORE_ENABLED: 'true', OPENROUTER_API_KEY: '' });
const ENV_OFF = envWith(env, { REALM_EXPLORE_ENABLED: 'false', OPENROUTER_API_KEY: '' });

/**
 * 迷雾森林：难度 50、宗门 1 级可进 → 3 关；奖励 灵石30000/药材15000；入场费 灵石10000。
 *
 * 降级 + forceRandom(0.0001) → 必然大成功；抽到的第一个遭遇（beast_wolf）的 choices[0]
 * 是 risk: 'risky'，risky + great_success 的倍率 = 20000 基点 = ×2.0。
 */
const MISTY = {
  realmId: 'mistyForest',
  totalStages: 3,
  /** 单关 risky+大成功 奖励（base × 2.0）。 */
  greatStone: 15_000,
  greatHerb: 7_500,
  /** 每关基础（= 通关额外奖励）。 */
  baseStone: 7_500,
  baseHerb: 3_750,
  entryStone: 10_000,
};

let seq = 0;
let randomSpy: ReturnType<typeof vi.spyOn> | null = null;

function forceRandom(value: number): void {
  randomSpy?.mockRestore();
  randomSpy = vi.spyOn(Math, 'random').mockReturnValue(value);
}

afterEach(() => {
  randomSpy?.mockRestore();
  randomSpy = null;
});

interface SectFixture {
  api: TestClient;
  sectId: string;
  discipleIds: string[];
  state: () => Promise<Record<string, any>>;
}

async function makeSect(prefix: string, opts: { arena?: boolean; level?: number } = {}): Promise<SectFixture> {
  seq += 1;
  const account = `${prefix}-${seq}`;
  const api = new TestClient(app, ENV_ON, { 'cf-connecting-ip': `10.11.${Math.floor(seq / 250)}.${seq % 250}` });

  const registered = await api.post('/api/v1/auth/register', { account, password: PASSWORD });
  expect(registered.status).toBe(200);
  const created = await api.post('/api/v1/game/create-sect', { name: `秘境${String(seq)}宗` });
  expect(created.status).toBe(200);

  const state = dataOf(created) as Record<string, any>;
  const sectId = state.state.sect.id as string;

  if (opts.arena !== false) {
    await env.DB.prepare('INSERT INTO buildings (id, sect_id, def_id, level, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), sectId, 'arenaHall', 1, Date.now())
      .run();
  }
  if (opts.level !== undefined) {
    await env.DB.prepare('UPDATE sects SET level = ? WHERE id = ?').bind(opts.level, sectId).run();
  }

  return {
    api,
    sectId,
    discipleIds: (state.state.disciples as { id: string }[]).map((disciple) => disciple.id),
    state: async () => {
      const result = await api.get('/api/v1/game/sync');
      expect(result.status).toBe(200);
      return (dataOf(result) as Record<string, any>).state as Record<string, any>;
    },
  };
}

async function freezeSettlement(sectId: string): Promise<void> {
  await env.DB.prepare('UPDATE sects SET last_settled_at = ? WHERE id = ?')
    .bind(Date.now() + 60_000, sectId)
    .run();
}

async function dbBalance(sectId: string, resourceId: string): Promise<number> {
  const row = await env.DB.prepare('SELECT balance FROM resource_balances WHERE sect_id = ? AND resource_id = ?')
    .bind(sectId, resourceId)
    .first<{ balance: number }>();
  return Number(row?.balance ?? 0);
}

async function explorationRow(explorationId: string): Promise<Record<string, any> | null> {
  return env.DB.prepare('SELECT * FROM realm_explorations WHERE id = ?')
    .bind(explorationId)
    .first<Record<string, any>>();
}

async function explorationRowCount(sectId: string): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS total FROM realm_explorations WHERE sect_id = ?')
    .bind(sectId)
    .first<{ total: number }>();
  return Number(row?.total ?? 0);
}

async function legacyExplorationRows(sectId: string): Promise<Record<string, any>[]> {
  const rows = await env.DB.prepare('SELECT * FROM explorations WHERE sect_id = ? ORDER BY created_at')
    .bind(sectId)
    .all<Record<string, any>>();
  return rows.results ?? [];
}

async function mutationGuardCount(): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS total FROM mutation_guards').first<{ total: number }>();
  return Number(row?.total ?? 0);
}

/** 列表接口（用该 fixture 自己的 env）。 */
async function realmsOf(fixture: SectFixture): Promise<Record<string, any>[]> {
  const result = await fixture.api.get('/api/v1/game/realms');
  expect(result.status).toBe(200);
  return (dataOf(result) as Record<string, any>).realms as Record<string, any>[];
}

/** 用固定的 env（开关可控）发起一次请求；用于验证开关本身。 */
async function realmsWith(api: TestClient): Promise<Record<string, any>[]> {
  const result = await api.get('/api/v1/game/realms');
  expect(result.status).toBe(200);
  return (dataOf(result) as Record<string, any>).realms as Record<string, any>[];
}

function startExplore(fixture: SectFixture, realmId: string, discipleIds?: string[]): Promise<ApiResult> {
  return fixture.api.post('/api/v1/game/realm-explore/start', {
    realmId,
    discipleIds: discipleIds ?? fixture.discipleIds.slice(0, 1),
  });
}

function chooseExplore(api: TestClient, explorationId: string, choiceId: string): Promise<ApiResult> {
  return api.post('/api/v1/game/realm-explore/choose', { explorationId, choiceId });
}

function abandonExplore(api: TestClient, explorationId: string): Promise<ApiResult> {
  return api.post('/api/v1/game/realm-explore/abandon', { explorationId });
}

describe('V6 秘境探索：开关与列表', () => {
  it('未开启时列表 exploreEnabled=false，且 start 被拒绝', async () => {
    const fixture = await makeSect('v6-off');
    await freezeSettlement(fixture.sectId);

    // 换一个开关为 OFF 的客户端（每次请求都带这个 env），注册一个全新的宗门来验证开关本身。

    const offClient = new TestClient(app, ENV_OFF, { 'cf-connecting-ip': '10.11.250.1' });
    const acc = `v6-off-2-${String(seq)}`;
    const reg = await offClient.post('/api/v1/auth/register', { account: acc, password: PASSWORD });
    expect(reg.status).toBe(200);
    const created = await offClient.post('/api/v1/game/create-sect', { name: '关外宗' });
    expect(created.status).toBe(200);
    const offSectId = (dataOf(created) as Record<string, any>).state.sect.id as string;
    const offDisciple = (dataOf(created) as Record<string, any>).state.disciples[0].id as string;
    await env.DB.prepare('INSERT INTO buildings (id, sect_id, def_id, level, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), offSectId, 'arenaHall', 1, Date.now())
      .run();
    await env.DB.prepare('UPDATE sects SET last_settled_at = ? WHERE id = ?')
      .bind(Date.now() + 60_000, offSectId)
      .run();

    const realms = await realmsWith(offClient);
    expect(realms.length).toBeGreaterThan(0);
    for (const realm of realms) {
      expect(realm.exploreEnabled).toBe(false);
    }

    const rejected = await offClient.post('/api/v1/game/realm-explore/start', {
      realmId: MISTY.realmId,
      discipleIds: [offDisciple],
    });
    expect(errorOf(rejected).code).toBe('INVALID_STATUS');

    const active = await offClient.get('/api/v1/game/realm-explore/active');
    expect((dataOf(active) as Record<string, any>).exploration).toBeNull();
  });

  it('开启时列表 exploreEnabled=true', async () => {
    const fixture = await makeSect('v6-on');
    const realms = await realmsOf(fixture);
    expect(realms.find((realm) => realm.id === MISTY.realmId)?.exploreEnabled).toBe(true);
  });
});

describe('V6 秘境探索：开始', () => {
  it('扣入场费、建进行中记录、占坑速通表，并返回第一关遭遇', async () => {
    const fixture = await makeSect('v6-start');
    await freezeSettlement(fixture.sectId);
    const stoneBefore = await dbBalance(fixture.sectId, 'spiritStone');

    const result = await startExplore(fixture, MISTY.realmId);
    expect(result.status).toBe(200);
    const data = dataOf(result) as Record<string, any>;
    const exploration = data.exploration as Record<string, any>;

    expect(exploration.realmId).toBe(MISTY.realmId);
    expect(exploration.realmName).toBe('迷雾森林');
    expect(exploration.totalStages).toBe(MISTY.totalStages);
    expect(exploration.currentStage).toBe(0);
    expect(exploration.rewardsCollected).toEqual({});
    expect(typeof exploration.encounter.name).toBe('string');
    expect(exploration.encounter.name.length).toBeGreaterThan(0);
    expect(exploration.encounter.description.length).toBeGreaterThan(0);
    expect(exploration.encounter.choices.length).toBeGreaterThanOrEqual(2);
    expect(exploration.encounter.choices.length).toBeLessThanOrEqual(3);
    for (const choice of exploration.encounter.choices) {
      expect(typeof choice.id).toBe('string');
      expect(typeof choice.label).toBe('string');
      expect(typeof choice.riskHint).toBe('string');
      expect(choice.label.length).toBeGreaterThan(0);
    }

    // 返回的 state 里就带上了进行中的探索（前端无需再查一次）。
    expect(data.state.activeExploration.id).toBe(exploration.id);
    // 入场费已扣，且此时没有任何奖励入账。
    expect(await dbBalance(fixture.sectId, 'spiritStone')).toBe(stoneBefore - MISTY.entryStone);

    const row = await explorationRow(exploration.id as string);
    expect(row?.status).toBe('in_progress');
    expect(row?.current_stage).toBe(0);
    expect(row?.total_stages).toBe(MISTY.totalStages);
    expect(JSON.parse(row?.party as string)).toEqual([fixture.discipleIds[0]]);
    expect(JSON.parse(row?.used_encounters as string)).toEqual([JSON.parse(row?.current_encounter as string).id]);

    // 速通表占坑（每日限次口径），success 仍是 0。
    const legacy = await legacyExplorationRows(fixture.sectId);
    expect(legacy).toHaveLength(1);
    expect(Number(legacy[0]?.success)).toBe(0);
    expect(legacy[0]?.id).toBe(exploration.id);

    // sync 也能恢复断点。
    const synced = await fixture.state();
    expect(synced.activeExploration.id).toBe(exploration.id);
    expect(await mutationGuardCount()).toBe(0);
  });

  it('同一宗门不能同时开两场；成员校验与人数校验生效', async () => {
    const fixture = await makeSect('v6-start-guard');
    await freezeSettlement(fixture.sectId);

    // 人数超上限（迷雾森林 maxParty = 2）→ VALIDATION_ERROR
    const tooMany = await startExplore(fixture, MISTY.realmId, fixture.discipleIds.slice(0, 3));
    expect(errorOf(tooMany).code).toBe('VALIDATION_ERROR');
    // 重复弟子 → VALIDATION_ERROR
    const duplicated = await startExplore(fixture, MISTY.realmId, [fixture.discipleIds[0]!, fixture.discipleIds[0]!]);
    expect(errorOf(duplicated).code).toBe('VALIDATION_ERROR');
    // 未知秘境 → NOT_FOUND
    const unknown = await startExplore(fixture, 'noSuchRealm');
    expect(errorOf(unknown).code).toBe('NOT_FOUND');
    // 受伤弟子 → INVALID_STATUS
    await env.DB.prepare('UPDATE disciples SET injured_until = ? WHERE id = ?')
      .bind(Date.now() + 600_000, fixture.discipleIds[0]!)
      .run();
    const injured = await startExplore(fixture, MISTY.realmId);
    expect(errorOf(injured).code).toBe('INVALID_STATUS');
    await env.DB.prepare('UPDATE disciples SET injured_until = NULL WHERE id = ?')
      .bind(fixture.discipleIds[0]!)
      .run();

    await freezeSettlement(fixture.sectId);
    expect((await startExplore(fixture, MISTY.realmId)).status).toBe(200);
    // 第二场 → INVALID_STATUS，且库里仍只有一条记录。
    await freezeSettlement(fixture.sectId);
    const second = await startExplore(fixture, MISTY.realmId, [fixture.discipleIds[1]!]);
    expect(errorOf(second).code).toBe('INVALID_STATUS');
    expect(await explorationRowCount(fixture.sectId)).toBe(1);
  });

  it('没有演武场时不能开始', async () => {
    const fixture = await makeSect('v6-no-arena', { arena: false });
    await freezeSettlement(fixture.sectId);
    const result = await startExplore(fixture, MISTY.realmId);
    expect(errorOf(result).code).toBe('INVALID_STATUS');
  });
});

describe('V6 秘境探索：判定与推进', () => {
  it('大成功推进关卡但不中途发奖；通关时一次性入账累计 + 通关奖励', async () => {
    const fixture = await makeSect('v6-complete');
    await freezeSettlement(fixture.sectId);
    forceRandom(0.0001); // 必然大成功

    const started = await startExplore(fixture, MISTY.realmId);
    const exploration = (dataOf(started) as Record<string, any>).exploration as Record<string, any>;
    const explorationId = exploration.id as string;
    const stoneAfterEntry = await dbBalance(fixture.sectId, 'spiritStone');
    const herbAfterEntry = await dbBalance(fixture.sectId, 'herb');
    let choiceId = exploration.encounter.choices[0].id as string;

    // 第 1 关：大成功，进入第 2 关，但**不发奖**。
    const first = await chooseExplore(fixture.api, explorationId, choiceId);
    expect(first.status).toBe(200);
    const firstData = dataOf(first) as Record<string, any>;
    expect(firstData.result.outcome).toBe('great_success');
    expect(firstData.result.nextEncounter).not.toBeNull();
    expect(firstData.result.finalRewards).toBeNull();
    expect(firstData.result.stageRewards).toEqual({
      spiritStone: String(MISTY.greatStone),
      herb: String(MISTY.greatHerb),
    });
    expect(firstData.state.activeExploration.currentStage).toBe(1);
    expect(await dbBalance(fixture.sectId, 'spiritStone')).toBe(stoneAfterEntry);
    expect(await dbBalance(fixture.sectId, 'herb')).toBe(herbAfterEntry);

    // 第 2 关：同上。后续随机遭遇的首选项风险等级未必仍是 risky，
    // 所以最终奖励必须按每关实际返回的 stageRewards 累计，不能假定三关倍率相同。
    choiceId = firstData.result.nextEncounter.choices[0].id as string;
    const second = await chooseExplore(fixture.api, explorationId, choiceId);
    const secondData = dataOf(second) as Record<string, any>;
    expect(secondData.state.activeExploration.currentStage).toBe(2);
    expect(await dbBalance(fixture.sectId, 'spiritStone')).toBe(stoneAfterEntry);

    // 第 3 关（最后一关）：通关 → 三关各自的实际奖励 + 一关基础通关奖励一次性入账。
    choiceId = secondData.result.nextEncounter.choices[0].id as string;
    const third = await chooseExplore(fixture.api, explorationId, choiceId);
    expect(third.status).toBe(200);
    const thirdData = dataOf(third) as Record<string, any>;
    expect(thirdData.result.outcome).toBe('great_success');
    expect(thirdData.result.nextEncounter).toBeNull();
    const expectedStone =
      Number(firstData.result.stageRewards.spiritStone ?? 0) +
      Number(secondData.result.stageRewards.spiritStone ?? 0) +
      Number(thirdData.result.stageRewards.spiritStone ?? 0) +
      MISTY.baseStone;
    const expectedHerb =
      Number(firstData.result.stageRewards.herb ?? 0) +
      Number(secondData.result.stageRewards.herb ?? 0) +
      Number(thirdData.result.stageRewards.herb ?? 0) +
      MISTY.baseHerb;
    expect(thirdData.result.finalRewards).toEqual({
      spiritStone: String(expectedStone),
      herb: String(expectedHerb),
    });
    expect(await dbBalance(fixture.sectId, 'spiritStone')).toBe(
      stoneAfterEntry + expectedStone,
    );
    expect(await dbBalance(fixture.sectId, 'herb')).toBe(
      herbAfterEntry + expectedHerb,
    );

    // 结束时不再是「进行中」：state 里 activeExploration 归 null。
    expect(thirdData.state.activeExploration).toBeNull();
    const row = await explorationRow(explorationId);
    expect(row?.status).toBe('completed');
    expect(row?.current_stage).toBe(MISTY.totalStages);
    expect(row?.current_encounter).toBeNull();
    expect(JSON.parse(row?.rewards_collected as string)).toEqual({
      spiritStone: String(expectedStone),
      herb: String(expectedHerb),
    });
    // 速通表回填成功。
    expect(Number((await legacyExplorationRows(fixture.sectId))[0]?.success)).toBe(1);

    const synced = await fixture.state();
    expect(synced.activeExploration).toBeNull();
    // 结束后再 choose / abandon：记录仍在但已结束 → 精确的 INVALID_STATUS（前端据 sync 收尾）。
    const again = await chooseExplore(fixture.api, explorationId, choiceId);
    expect(errorOf(again).code).toBe('INVALID_STATUS');
    const abandonAgain = await abandonExplore(fixture.api, explorationId);
    expect(errorOf(abandonAgain).code).toBe('INVALID_STATUS');
    expect(await mutationGuardCount()).toBe(0);

    // 一局结束（status=completed）后，0015 的部分唯一索引必须随之释放：能再开一局。
    await freezeSettlement(fixture.sectId);
    const reopened = await startExplore(fixture, MISTY.realmId, [fixture.discipleIds[1]!]);
    expect(reopened.status).toBe(200);
    expect(((dataOf(reopened) as Record<string, any>).exploration as Record<string, any>).currentStage).toBe(0);
  });

  it('失败立即终止、保留已获奖励、随机一名弟子受伤', async () => {
    const fixture = await makeSect('v6-fail');
    await freezeSettlement(fixture.sectId);
    forceRandom(0.0001);
    const started = await startExplore(fixture, MISTY.realmId);
    const exploration = (dataOf(started) as Record<string, any>).exploration as Record<string, any>;
    const explorationId = exploration.id as string;
    const stoneAfterEntry = await dbBalance(fixture.sectId, 'spiritStone');

    // 第 1 关大成功（账本 +11250，不入账）。
    const first = await chooseExplore(fixture.api, explorationId, exploration.encounter.choices[0].id);
    const firstData = dataOf(first) as Record<string, any>;
    expect(await dbBalance(fixture.sectId, 'spiritStone')).toBe(stoneAfterEntry);

    // 第 2 关强制失败（降级路径下 injuryProb = 0.8 > 0.6 → 有人受伤）。
    forceRandom(0.9999);
    const second = await chooseExplore(
      fixture.api,
      explorationId,
      firstData.result.nextEncounter.choices[0].id,
    );
    expect(second.status).toBe(200);
    const secondData = dataOf(second) as Record<string, any>;
    expect(secondData.result.outcome).toBe('failure');
    expect(secondData.result.nextEncounter).toBeNull();
    expect(secondData.result.finalRewards).toBeNull();
    expect(secondData.result.injury).not.toBeNull();
    expect(typeof secondData.result.injury.discipleName).toBe('string');

    // 已获的第 1 关奖励入账（失败不退入场费）。
    expect(await dbBalance(fixture.sectId, 'spiritStone')).toBe(stoneAfterEntry + MISTY.greatStone);
    expect(secondData.state.activeExploration).toBeNull();

    const row = await explorationRow(explorationId);
    expect(row?.status).toBe('failed');
    expect(row?.current_encounter).toBeNull();
    expect(Number((await legacyExplorationRows(fixture.sectId))[0]?.success)).toBe(0);

    const injured = await env.DB.prepare('SELECT injured_until FROM disciples WHERE id = ?')
      .bind(fixture.discipleIds[0]!)
      .first<{ injured_until: number | null }>();
    expect(Number(injured?.injured_until ?? 0)).toBeGreaterThan(Date.now());
  });

  it('非法 choiceId 与跨宗 id 都被拒绝，且不推进记录', async () => {
    const owner = await makeSect('v6-owner');
    const stranger = await makeSect('v6-stranger');
    await freezeSettlement(owner.sectId);
    forceRandom(0.0001);

    const started = await startExplore(owner, MISTY.realmId);
    const exploration = (dataOf(started) as Record<string, any>).exploration as Record<string, any>;
    const explorationId = exploration.id as string;

    const badChoice = await chooseExplore(owner.api, explorationId, 'not-a-choice');
    expect(errorOf(badChoice).code).toBe('VALIDATION_ERROR');

    const crossChoose = await chooseExplore(stranger.api, explorationId, exploration.encounter.choices[0].id);
    expect(errorOf(crossChoose).code).toBe('NOT_FOUND');
    const crossAbandon = await abandonExplore(stranger.api, explorationId);
    expect(errorOf(crossAbandon).code).toBe('NOT_FOUND');

    // 记录没有被推进，也没有被别人的请求结算。
    const row = await explorationRow(explorationId);
    expect(row?.status).toBe('in_progress');
    expect(row?.current_stage).toBe(0);
    expect(Number((row?.rewards_collected as string) === '{}' ? 0 : 1)).toBe(0);
  });
});

describe('V6 秘境探索：Decisions 调用（模型可用 / 不可用）', () => {
  it('Decisions 调用失败时降级为本地随机，玩家不会被卡住', async () => {
    // 这个用例给一个「看起来有效」的 key 并且把 fetch 打断，专门覆盖降级分支
    // （前面的用例都是「没有 key」，走的是另一条短路）。
    const api = new TestClient(
      app,
      envWith(env, { REALM_EXPLORE_ENABLED: 'true', OPENROUTER_API_KEY: 'test-key-not-real' }),
      { 'cf-connecting-ip': '10.11.252.1' },
    );
    seq += 1;
    const account = `v6-degrade-${String(seq)}`;
    expect((await api.post('/api/v1/auth/register', { account, password: PASSWORD })).status).toBe(200);
    const created = await api.post('/api/v1/game/create-sect', { name: `降级${String(seq)}宗` });
    expect(created.status).toBe(200);
    const createdState = (dataOf(created) as Record<string, any>).state as Record<string, any>;
    const sectId = createdState.sect.id as string;
    const discipleId = createdState.disciples[0].id as string;
    await env.DB.prepare('INSERT INTO buildings (id, sect_id, def_id, level, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), sectId, 'arenaHall', 1, Date.now())
      .run();
    await freezeSettlement(sectId);

    forceRandom(0.0001); // 即便降级，判定结果也要由本地随机决定（这里固定成大成功）
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('decisions unreachable'));
    try {
      const started = await api.post('/api/v1/game/realm-explore/start', {
        realmId: MISTY.realmId,
        discipleIds: [discipleId],
      });
      expect(started.status).toBe(200);
      const exploration = (dataOf(started) as Record<string, any>).exploration as Record<string, any>;

      const chosen = await chooseExplore(
        api,
        exploration.id as string,
        exploration.encounter.choices[0].id as string,
      );
      expect(chosen.status).toBe(200);
      const result = (dataOf(chosen) as Record<string, any>).result as Record<string, any>;
      // 降级路径照样给出合法判定与下一关：格式与走模型时完全一致。
      expect(['great_success', 'success', 'failure']).toContain(result.outcome);
      expect(typeof result.message).toBe('string');
      if (result.outcome === 'failure') {
        expect(result.nextEncounter).toBeNull();
      } else {
        expect(result.nextEncounter).not.toBeNull();
      }
      // 记录确实被推进了（没有「请求失败就卡在原地」）。
      const row = await explorationRow(exploration.id as string);
      expect(Number(row?.current_stage)).toBe(result.outcome === 'failure' ? 0 : 1);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('Decisions 返回正常形状时采纳模型结果：成功也可以受伤，且请求形状符合契约', async () => {
    const api = new TestClient(
      app,
      envWith(env, { REALM_EXPLORE_ENABLED: 'true', OPENROUTER_API_KEY: 'test-key-ok' }),
      { 'cf-connecting-ip': '10.11.253.1' },
    );
    seq += 1;
    const account = `v6-model-${String(seq)}`;
    expect((await api.post('/api/v1/auth/register', { account, password: PASSWORD })).status).toBe(200);
    const created = await api.post('/api/v1/game/create-sect', { name: `模型${String(seq)}宗` });
    expect(created.status).toBe(200);
    const createdState = (dataOf(created) as Record<string, any>).state as Record<string, any>;
    const sectId = createdState.sect.id as string;
    const discipleId = createdState.disciples[0].id as string;
    await env.DB.prepare('INSERT INTO buildings (id, sect_id, def_id, level, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), sectId, 'arenaHall', 1, Date.now())
      .run();
    await freezeSettlement(sectId);

    // 模型说：完美通过，但过程中挂了彩（injury 概率 0.9 > 0.6）。
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          answers: {
            outcome: { choice: 'great_success', probabilities: { great_success: 0.9 } },
            injury: { noul: 0.9 },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    try {
      const started = await api.post('/api/v1/game/realm-explore/start', {
        realmId: MISTY.realmId,
        discipleIds: [discipleId],
      });
      expect(started.status).toBe(200);
      const exploration = (dataOf(started) as Record<string, any>).exploration as Record<string, any>;

      const chosen = await chooseExplore(
        api,
        exploration.id as string,
        exploration.encounter.choices[0].id as string,
      );
      expect(chosen.status).toBe(200);
      const result = (dataOf(chosen) as Record<string, any>).result as Record<string, any>;
      // 模型的 outcome 被采纳（不是本地随机的结果）。
      expect(result.outcome).toBe('great_success');
      // 受伤判定与 outcome 无关：成功照样可能有人挂彩。
      expect(result.injury).not.toBeNull();
      expect(result.injury.discipleName).toBeTruthy();
      expect(result.nextEncounter).not.toBeNull();

      // 请求形状契约：URL + state 文本 + 两个结构化问题。
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(String(url)).toBe('https://openrouter.ai/api/alpha/decisions');
      expect(String((init.headers as Record<string, string>).Authorization)).toBe('Bearer test-key-ok');
      const body = JSON.parse(String(init.body)) as Record<string, any>;
      expect(String(body.state)).toContain('迷雾森林');
      expect(Object.keys(body.questions as object).sort()).toEqual(['injury', 'outcome']);
      expect((body.questions as Record<string, any>).outcome.type).toBe('choice');
      expect((body.questions as Record<string, any>).injury.type).toBe('noul');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('V6 秘境探索：放弃与每日限次', () => {
  it('放弃后已获奖励入账、记录终止、不退入场费', async () => {
    const fixture = await makeSect('v6-abandon');
    await freezeSettlement(fixture.sectId);
    forceRandom(0.0001);
    const started = await startExplore(fixture, MISTY.realmId);
    const exploration = (dataOf(started) as Record<string, any>).exploration as Record<string, any>;
    const explorationId = exploration.id as string;
    const stoneAfterEntry = await dbBalance(fixture.sectId, 'spiritStone');

    await chooseExplore(fixture.api, explorationId, exploration.encounter.choices[0].id);
    expect(await dbBalance(fixture.sectId, 'spiritStone')).toBe(stoneAfterEntry);

    await freezeSettlement(fixture.sectId);
    const abandoned = await abandonExplore(fixture.api, explorationId);
    expect(abandoned.status).toBe(200);
    const data = dataOf(abandoned) as Record<string, any>;
    expect(data.state.activeExploration).toBeNull();
    // 已获的第 1 关奖励入账；入场费不退（净额 = 入场后的余额 + 该关奖励）。
    expect(await dbBalance(fixture.sectId, 'spiritStone')).toBe(stoneAfterEntry + MISTY.greatStone);

    const row = await explorationRow(explorationId);
    expect(row?.status).toBe('failed');
    expect(row?.current_encounter).toBeNull();
    // 放弃后不能再操作这一场。
    const again = await abandonExplore(fixture.api, explorationId);
    expect(errorOf(again).code).toBe('INVALID_STATUS');
    expect(await mutationGuardCount()).toBe(0);
  });

  it('探索队伍成员不能被派出去历练（预览与出发同一口径）', async () => {
    const fixture = await makeSect('v6-journey-block');
    await freezeSettlement(fixture.sectId);
    forceRandom(0.0001);
    const started = await startExplore(fixture, MISTY.realmId, [fixture.discipleIds[0]!]);
    expect(started.status).toBe(200);

    const journeyBody = {
      discipleId: fixture.discipleIds[0]!,
      direction: 'gathering',
      durationSeconds: 7_200,
    };
    await freezeSettlement(fixture.sectId);
    const blocked = await fixture.api.post('/api/v1/game/start-journey', journeyBody);
    expect(errorOf(blocked).code).toBe('INVALID_STATUS');
    expect(errorOf(blocked).message).toContain('探索');

    // 预览也要给出同一条原因（不能出现「预览说能走、出发被拒」）。
    const preview = await fixture.api.get(
      `/api/v1/game/journey-preview?discipleId=${fixture.discipleIds[0]!}`,
    );
    expect(preview.status).toBe(200);
    const previewData = dataOf(preview) as Record<string, any>;
    expect(previewData.canStart).toBe(false);
    expect(String(previewData.blockedReason)).toContain('探索');
  });

  it('速通与探索共享同一份每日限次计数', async () => {
    // 妖兽巢穴：宗门 4 级可进、每日 3 次、2~3 人。
    const fixture = await makeSect('v6-daily', { level: 4 });
    await freezeSettlement(fixture.sectId);
    forceRandom(0.0001);
    const party = fixture.discipleIds.slice(0, 2);

    // 探索占 1 次。
    const started = await startExplore(fixture, 'beastNest', party);
    expect(started.status).toBe(200);
    const exploration = (dataOf(started) as Record<string, any>).exploration as Record<string, any>;
    expect(exploration.totalStages).toBe(5); // 宗门 4 级 → 5 关
    await freezeSettlement(fixture.sectId);
    await abandonExplore(fixture.api, exploration.id);

    const realms = await realmsOf(fixture);
    expect(realms.find((realm) => realm.id === 'beastNest')?.usedToday).toBe(1);

    // 再用速通打两次 → 用满 3 次。
    for (let i = 0; i < 2; i += 1) {
      await freezeSettlement(fixture.sectId);
      const speedrun = await fixture.api.post('/api/v1/game/explore', {
        realmId: 'beastNest',
        discipleIds: party,
      });
      expect(speedrun.status).toBe(200);
    }
    const afterSpeedrun = await realmsOf(fixture);
    expect(afterSpeedrun.find((realm) => realm.id === 'beastNest')?.usedToday).toBe(3);

    // 第 4 次：探索与速通都应被 DAILY_LIMIT 拦下。
    await freezeSettlement(fixture.sectId);
    const exploreBlocked = await startExplore(fixture, 'beastNest', party);
    expect(errorOf(exploreBlocked).code).toBe('DAILY_LIMIT');
    await freezeSettlement(fixture.sectId);
    const speedrunBlocked = await fixture.api.post('/api/v1/game/explore', {
      realmId: 'beastNest',
      discipleIds: party,
    });
    expect(errorOf(speedrunBlocked).code).toBe('DAILY_LIMIT');
  });
});

describe('V6 秘境探索：与既有命令的交错', () => {
  it('探索队伍里的弟子不能被驱逐，非队伍成员可以', async () => {
    const fixture = await makeSect('v6-expel');
    await freezeSettlement(fixture.sectId);
    forceRandom(0.0001);
    const started = await startExplore(fixture, MISTY.realmId, [fixture.discipleIds[0]!]);
    expect(started.status).toBe(200);

    const blocked = await fixture.api.post('/api/v1/game/expel-disciple', {
      discipleId: fixture.discipleIds[0]!,
    });
    expect(errorOf(blocked).code).toBe('INVALID_STATUS');

    await freezeSettlement(fixture.sectId);
    const outsider = await fixture.api.post('/api/v1/game/expel-disciple', {
      discipleId: fixture.discipleIds[1]!,
    });
    expect(outsider.status).toBe(200);
  });

  it('并发的第二次 choose：旧快照被守卫拦下，整批回滚（同一关只结算一次）', async () => {
    const fixture = await makeSect('v6-stale-choose');
    await freezeSettlement(fixture.sectId);
    forceRandom(0.0001);
    const started = await startExplore(fixture, MISTY.realmId);
    const exploration = (dataOf(started) as Record<string, any>).exploration as Record<string, any>;
    const explorationId = exploration.id as string;

    const savedSect = await new SectRepository(env.DB).findById(fixture.sectId);
    expect(savedSect).not.toBeNull();
    const firstRead = await new RealmExplorationRepository(env.DB).findByIdForSect(
      explorationId,
      fixture.sectId,
    );
    expect(firstRead).not.toBeNull();

    const guardId = crypto.randomUUID();
    const guard = realmExploreSnapshotGuardStatement(guardId, {
      sect: savedSect!,
      balances: await new ResourceBalanceRepository(env.DB).findBySectId(fixture.sectId),
      exploration: firstRead!,
    });

    // 另一个请求先把这一关推进了（current_stage 0 → 1）。
    await env.DB.prepare(
      `UPDATE realm_explorations SET current_stage = 1, rewards_collected = '{"spiritStone":"${MISTY.greatStone}"}', updated_at = ? WHERE id = ?`,
    )
      .bind(Date.now(), explorationId)
      .run();

    await expect(
      env.DB.batch(
        prepareStatements(env.DB, [
          guard,
          updateRealmExplorationStageStatement({
            id: explorationId,
            currentStage: 1,
            status: 'in_progress',
            currentEncounter: firstRead!.current_encounter,
            usedEncounters: firstRead!.used_encounters,
            rewardsCollected: `{"spiritStone":"${MISTY.greatStone * 2}"}`,
            now: Date.now(),
          }),
          deleteRealmExploreSnapshotGuardStatement(guardId),
        ]),
      ),
    ).rejects.toThrow(/mutation_guards|valid = 1/);

    // 整批回滚：并发请求写的账本没被覆盖。
    const row = await explorationRow(explorationId);
    expect(Number(row?.current_stage)).toBe(1);
    expect(JSON.parse(row?.rewards_collected as string)).toEqual({ spiritStone: String(MISTY.greatStone) });
    expect(await mutationGuardCount()).toBe(0);
  });

  it('同一宗门并发开始两场探索：数据库只留一条进行中记录', async () => {
    const fixture = await makeSect('v6-concurrent-start');
    await freezeSettlement(fixture.sectId);

    const [first, second] = await Promise.all([
      startExplore(fixture, MISTY.realmId, [fixture.discipleIds[0]!]),
      startExplore(fixture, MISTY.realmId, [fixture.discipleIds[1]!]),
    ]);
    const statuses = [first.status, second.status].sort((a, b) => a - b);

    // 两个都可能「成功」地通过读后写检查，但部分唯一索引保证最多一条 in_progress 落库。
    const active = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM realm_explorations WHERE sect_id = ? AND status = 'in_progress'",
    )
      .bind(fixture.sectId)
      .first<{ total: number }>();
    expect(Number(active?.total)).toBe(1);
    expect(await explorationRowCount(fixture.sectId)).toBe(1);
    // 至少一个请求成功；失败的那个必须是业务错误而不是 500。
    expect(statuses[0]).toBe(200);
    if (statuses[1] !== 200) {
      const failed = first.status === 200 ? second : first;
      expect(errorOf(failed).code).toBe('INVALID_STATUS');
    }
  });
});
