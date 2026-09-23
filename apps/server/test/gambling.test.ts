import { applyD1Migrations, env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app';
import {
  DAO_INSIGHT_CAP,
  DEBATE_DAILY_LIMIT,
  WHEEL_BIG_MULTIPLIER,
  WHEEL_RESET_COST,
  WHEEL_SLOT_COUNT,
  WHEEL_SPIN_COST,
  WHEEL_SLOT_WEIGHTS,
  generateWheelSlots,
  wheelLayoutSeed,
  type WheelSlot,
} from '../src/modules/game/gambling';

import {
  gamblingSnapshotGuardStatement,
  upsertPillInventoryStatement,
  type DiscipleRow,
  type ResourceBalanceRow,
  type SectRow,
} from '../src/modules/game/repository';

import { PILL_IDS, findPillRecipe } from '../src/modules/game/alchemy';

import { dataOf, errorOf, TestClient, type ApiResult } from './support/authClient';

/**
 * 赌坊（0019 迁移 + gambling.ts）：论道赌局与悟道值加点。
 *
 * 存储说明：本文件一份独立内存 D1，没有逐用例回滚 —— 每个用例用独立账号/宗门
 * （前缀递增），涉及计数的断言都按宗门 id 定界。
 *
 * 确定性说明：
 * - 结算时间拨到未来（时钟回拨 → 零产出零事件），资源与次数断言才精确；
 * - 测试环境没有 OPENROUTER_API_KEY → 胜率走 gambling.ts 的降级常量（1x = 50%），
 *   且 `win_probability` 落库为 NULL；
 * - Math.random 被 stub 成固定值（0.01 = 必胜，0.99 = 必败），胜负完全确定；
 *   stub 只在论道请求期间生效，建宗门/招募仍用真实随机。
 * - 天机轮落格由服务端一次 Math.random 决定：用同一手法把它钉在目标格所属的 1/8 区间里。
 */

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

const quietLogger = { info: () => {}, warn: () => {}, error: () => {} } as const;
const app = createApp({ logger: quietLogger });
const PASSWORD = 'password-123456';

/** 今天的 UTC+8 日期键（与 constants.dateKeyUtc8 同口径）。 */
const TODAY = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);

let seq = 0;

interface SectFixture {
  api: TestClient;
  sectId: string;
  discipleIds: string[];
  state: () => Promise<Record<string, any>>;
}

/** 注册 + 建宗门；返回宗门 id、弟子 id 与同步读取函数。 */
async function makeSect(prefix: string): Promise<SectFixture> {
  seq += 1;
  const account = `${prefix}-${seq}`;
  const api = new TestClient(app, env, {
    'cf-connecting-ip': `10.9.${Math.floor(seq / 250)}.${seq % 250}`,
  });
  const registered = await api.post('/api/v1/auth/register', { account, password: PASSWORD });
  expect(registered.status).toBe(200);
  const created = await api.post('/api/v1/game/create-sect', { name: `赌坊${seq}号` });
  expect(created.status).toBe(200);
  const state = dataOf(created) as Record<string, any>;
  return {
    api,
    sectId: state.state.sect.id as string,
    discipleIds: (state.state.disciples as { id: string }[]).map((item) => item.id),
    state: async () => {
      const result = await api.get('/api/v1/game/sync');
      expect(result.status).toBe(200);
      return (dataOf(result) as Record<string, any>).state;
    },
  };
}

/** 把结算时间拨到未来：请求内的结算变成零产出零事件，完全确定。 */
async function freezeSettlement(sectId: string): Promise<void> {
  await env.DB.prepare('UPDATE sects SET last_settled_at = ? WHERE id = ?')
    .bind(Date.now() + 60_000, sectId)
    .run();
}

/** 宗门升级到赌坊解锁线（2 级）。 */
async function unlockGambling(sectId: string): Promise<void> {
  await env.DB.prepare('UPDATE sects SET level = 2 WHERE id = ?').bind(sectId).run();
}

/** 把某项资源余额写成一个确定值（没有余额行时补一行）。 */
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

async function discipleRow(discipleId: string): Promise<Record<string, any>> {
  const row = await env.DB.prepare('SELECT * FROM disciples WHERE id = ?')
    .bind(discipleId)
    .first<Record<string, any>>();
  expect(row).not.toBeNull();
  return row!;
}

/** 直接构造弟子的赌注/属性前置状态（绕过接口，专测服务端判定）。 */
async function setDiscipleFields(
  discipleId: string,
  fields: Record<string, number>,
): Promise<void> {
  const columns = Object.keys(fields);
  const assignments = columns.map((column) => `${column} = ?`).join(', ');
  await env.DB.prepare(`UPDATE disciples SET ${assignments} WHERE id = ?`)
    .bind(...columns.map((column) => fields[column]), discipleId)
    .run();
}

async function debateCounter(sectId: string): Promise<{ key: string; count: number }> {
  const row = await env.DB.prepare(
    'SELECT debate_date_key, debate_count FROM sects WHERE id = ?',
  )
    .bind(sectId)
    .first<{ debate_date_key: string; debate_count: number }>();
  return { key: row!.debate_date_key, count: Number(row!.debate_count) };
}

async function debateLogs(sectId: string): Promise<Record<string, any>[]> {
  const rows = await env.DB.prepare(
    'SELECT * FROM dao_debate_log WHERE sect_id = ? ORDER BY created_at ASC',
  )
    .bind(sectId)
    .all<Record<string, any>>();
  return rows.results ?? [];
}

/** 让该弟子处于「在外历练」状态（直接造一条未领取的历练记录）。 */
async function sendAway(sectId: string, discipleId: string, now: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO disciple_journeys (
       id, sect_id, disciple_id, disciple_name, direction, duration_seconds, original_assignment,
       started_at, ends_at, completed_at, claimed_at, reward_cultivation, reward_resources,
       extra_harvest, injured, injury_chance_bp, cultivation_awarded, created_at
     ) VALUES (?, ?, ?, ?, 'daoSeeking', 7200, 'idle', ?, ?, NULL, NULL, 0, '{}', 0, 0, 1000, NULL, ?)`,
  )
    .bind(crypto.randomUUID(), sectId, discipleId, '在外弟子', now, now + 7_200_000, now)
    .run();
}

/** 固定 Math.random：0.01 → 必胜；0.99 → 必败（降级胜率最高 0.5）。 */
function forceWin(): void {
  vi.spyOn(Math, 'random').mockReturnValue(0.01);
}

function forceLose(): void {
  vi.spyOn(Math, 'random').mockReturnValue(0.99);
}

afterEach(() => {
  vi.restoreAllMocks();
});

function debate(sect: SectFixture, body: Record<string, unknown>): Promise<ApiResult> {
  return sect.api.post('/api/v1/game/dao-debate', body);
}

function allocate(sect: SectFixture, body: Record<string, unknown>): Promise<ApiResult> {
  return sect.api.post('/api/v1/game/allocate-dao-insight', body);
}

/* ---------- 解锁与 sync 面板 ---------- */

describe('赌坊解锁与面板状态', () => {
  it('1 级宗门：面板未解锁、论道被拒且不消耗次数', async () => {
    const sect = await makeSect('gh-lock');
    await freezeSettlement(sect.sectId);
    await setBalance(sect.sectId, 'spiritStone', 1_000_000);

    const state = await sect.state();
    expect(state.gambling.unlocked).toBe(false);
    expect(state.gambling.blockedReason).toContain('2 级');
    expect(state.gambling.dailyLimit).toBe(DEBATE_DAILY_LIMIT);
    expect(state.gambling.remaining).toBe(DEBATE_DAILY_LIMIT);

    forceWin();
    const rejected = await debate(sect, {
      discipleId: sect.discipleIds[0],
      betMode: 'preset_spirit_stone',
      multiplier: 1,
      rewardType: 'resource',
    });
    expect(rejected.status).toBeGreaterThanOrEqual(400);
    expect(errorOf(rejected).code).toBe('INVALID_STATUS');
    // 未解锁的失败不能留下任何痕迹。
    expect(await debateCounter(sect.sectId)).toEqual({ key: '', count: 0 });
    expect(await debateLogs(sect.sectId)).toHaveLength(0);
    expect(await balanceOf(sect.sectId, 'spiritStone')).toBe(1_000_000);
  });

  it('2 级宗门：面板解锁、弟子带悟道值三字段，次数随论道更新', async () => {
    const sect = await makeSect('gh-panel');
    await freezeSettlement(sect.sectId);
    await unlockGambling(sect.sectId);
    await setBalance(sect.sectId, 'spiritStone', 1_000_000);

    const before = await sect.state();
    expect(before.gambling.unlocked).toBe(true);
    expect(before.gambling.blockedReason).toBeNull();
    expect(before.gambling.usedToday).toBe(0);
    const discipleView = (before.disciples as Record<string, any>[]).find(
      (item) => item.id === sect.discipleIds[0],
    );
    expect(discipleView, 'sync 视图里必须有该弟子').toBeTruthy();
    expect(discipleView!.daoInsight).toBe(0);
    expect(discipleView!.daoInsightUsed).toBe(0);
    expect(discipleView!.daoInsightRemaining).toBe(DAO_INSIGHT_CAP);

    forceWin();
    const played = await debate(sect, {
      discipleId: sect.discipleIds[0],
      betMode: 'preset_spirit_stone',
      multiplier: 1,
      rewardType: 'insight',
    });
    expect(played.status).toBe(200);
    const playedState = (dataOf(played) as Record<string, any>).state;
    expect(playedState.gambling.usedToday).toBe(1);
    expect(playedState.gambling.remaining).toBe(DEBATE_DAILY_LIMIT - 1);
    const after = await sect.state();
    expect(after.gambling.usedToday).toBe(1);
    expect(after.gambling.remaining).toBe(DEBATE_DAILY_LIMIT - 1);
  });

  it('UTC+8 跨日重置：昨天的计数不影响今天，论道后按今天重新从 1 开始', async () => {
    const sect = await makeSect('gh-day');
    await freezeSettlement(sect.sectId);
    await unlockGambling(sect.sectId);
    await setBalance(sect.sectId, 'spiritStone', 1_000_000);
    await env.DB.prepare('UPDATE sects SET debate_date_key = ?, debate_count = ? WHERE id = ?')
      .bind('1970-01-01', DEBATE_DAILY_LIMIT, sect.sectId)
      .run();

    const state = await sect.state();
    expect(state.gambling.usedToday).toBe(0);
    expect(state.gambling.remaining).toBe(DEBATE_DAILY_LIMIT);

    forceWin();
    const played = await debate(sect, {
      discipleId: sect.discipleIds[0],
      betMode: 'preset_spirit_stone',
      multiplier: 1,
      rewardType: 'resource',
    });
    expect(played.status).toBe(200);
    expect(await debateCounter(sect.sectId)).toEqual({ key: TODAY, count: 1 });
  });
});

/* ---------- 模式 A：系统预设灵石 ---------- */

describe('模式 A：系统预设灵石', () => {
  it('落败：扣掉赌注、次数 +1、写一条 lose 记录（降级时 win_probability 为 NULL）', async () => {
    const sect = await makeSect('gh-a-lose');
    await freezeSettlement(sect.sectId);
    await unlockGambling(sect.sectId);
    await setBalance(sect.sectId, 'spiritStone', 1_000_000);

    forceLose();
    const result = await debate(sect, {
      discipleId: sect.discipleIds[0],
      betMode: 'preset_spirit_stone',
      multiplier: 2,
      rewardType: 'resource',
    });
    expect(result.status).toBe(200);
    const payload = dataOf(result) as Record<string, any>;
    expect(payload.result.result).toBe('lose');
    expect(payload.result.stakeDescription).toContain('灵石 200');
    expect(payload.result.rewardDescription).toBe('无');
    expect(payload.result.winProbability).toBeNull();
    expect(payload.state.gambling.usedToday).toBe(1);

    // 2x 赌注 = 200000 最小单位 → 1_000_000 - 200_000
    expect(await balanceOf(sect.sectId, 'spiritStone')).toBe(800_000);
    const logs = await debateLogs(sect.sectId);
    expect(logs).toHaveLength(1);
    expect(logs[0].result).toBe('lose');
    expect(logs[0].bet_mode).toBe('preset_spirit_stone');
    expect(logs[0].multiplier).toBe(2);
    expect(JSON.parse(logs[0].stake_detail)).toEqual({
      resourceId: 'spiritStone',
      amount: '200000',
    });
    expect(JSON.parse(logs[0].reward_detail)).toEqual({ type: 'none' });
    expect(logs[0].win_probability).toBeNull();
  });

  it('胜出赢灵石：赌注不动、奖励 +180000（1x）', async () => {
    const sect = await makeSect('gh-a-win');
    await freezeSettlement(sect.sectId);
    await unlockGambling(sect.sectId);
    await setBalance(sect.sectId, 'spiritStone', 1_000_000);

    forceWin();
    const result = await debate(sect, {
      discipleId: sect.discipleIds[0],
      betMode: 'preset_spirit_stone',
      multiplier: 1,
      rewardType: 'resource',
    });
    expect(result.status).toBe(200);
    expect((dataOf(result) as Record<string, any>).result.result).toBe('win');
    expect(await balanceOf(sect.sectId, 'spiritStone')).toBe(1_180_000);
    const logs = await debateLogs(sect.sectId);
    expect(JSON.parse(logs[0].reward_detail)).toEqual({
      type: 'resource',
      resourceId: 'spiritStone',
      amount: '180000',
    });
  });

  it('胜出赢悟道值：1x +1 / 3x +3，余额不动', async () => {
    const sect = await makeSect('gh-a-insight');
    await freezeSettlement(sect.sectId);
    await unlockGambling(sect.sectId);
    await setBalance(sect.sectId, 'spiritStone', 1_000_000);

    forceWin();
    const first = await debate(sect, {
      discipleId: sect.discipleIds[0],
      betMode: 'preset_spirit_stone',
      multiplier: 3,
      rewardType: 'insight',
    });
    expect(first.status).toBe(200);
    expect(await balanceOf(sect.sectId, 'spiritStone')).toBe(1_000_000);
    expect((await discipleRow(sect.discipleIds[0])).dao_insight).toBe(3);

    const state = await sect.state();
    const view = (state.disciples as Record<string, any>[]).find(
      (item) => item.id === sect.discipleIds[0],
    );
    expect(view, 'sync 视图里必须有该弟子').toBeTruthy();
    expect(view!.daoInsight).toBe(3);
  });

  it('参数与余额校验：缺 rewardType / 余额不足 / 倍率越界都被拒且不消耗次数', async () => {
    const sect = await makeSect('gh-a-check');
    await freezeSettlement(sect.sectId);
    await unlockGambling(sect.sectId);
    await setBalance(sect.sectId, 'spiritStone', 50_000);

    forceWin();
    const noRewardType = await debate(sect, {
      discipleId: sect.discipleIds[0],
      betMode: 'preset_spirit_stone',
      multiplier: 1,
    });
    expect(errorOf(noRewardType).code).toBe('VALIDATION_ERROR');

    const poor = await debate(sect, {
      discipleId: sect.discipleIds[0],
      betMode: 'preset_spirit_stone',
      multiplier: 1,
      rewardType: 'resource',
    });
    expect(errorOf(poor).code).toBe('INSUFFICIENT_RESOURCE');

    const badMultiplier = await debate(sect, {
      discipleId: sect.discipleIds[0],
      betMode: 'preset_spirit_stone',
      multiplier: 4,
      rewardType: 'resource',
    });
    expect(badMultiplier.status).toBe(400);

    expect(await debateCounter(sect.sectId)).toEqual({ key: '', count: 0 });
    expect(await balanceOf(sect.sectId, 'spiritStone')).toBe(50_000);
  });
});

/* ---------- 模式 B：自由输入资源 ---------- */

describe('模式 B：自由输入资源', () => {
  it('落败按 输入 × 倍率 扣；胜出按 floor(输入 × 倍率 × 1.8) 发', async () => {
    const sect = await makeSect('gh-b');
    await freezeSettlement(sect.sectId);
    await unlockGambling(sect.sectId);
    await setBalance(sect.sectId, 'herb', 1_000_000);

    forceLose();
    const lost = await debate(sect, {
      discipleId: sect.discipleIds[0],
      betMode: 'free_resource',
      multiplier: 2,
      resourceId: 'herb',
      amount: 10_000,
    });
    expect(lost.status).toBe(200);
    // 输入 10000 × 倍率 2 = 20000
    expect(await balanceOf(sect.sectId, 'herb')).toBe(980_000);

    forceWin();
    const won = await debate(sect, {
      discipleId: sect.discipleIds[0],
      betMode: 'free_resource',
      multiplier: 2,
      resourceId: 'herb',
      amount: 10_000,
    });
    expect(won.status).toBe(200);
    // floor(20000 × 1.8) = 36000
    expect(await balanceOf(sect.sectId, 'herb')).toBe(1_016_000);

    const logs = await debateLogs(sect.sectId);
    expect(logs).toHaveLength(2);
    expect(JSON.parse(logs[1].reward_detail)).toEqual({
      type: 'resource',
      resourceId: 'herb',
      amount: '36000',
    });
  });

  it('低于最小赌注、白名单外资源、非法数量都被拒', async () => {
    const sect = await makeSect('gh-b-check');
    await freezeSettlement(sect.sectId);
    await unlockGambling(sect.sectId);
    await setBalance(sect.sectId, 'ore', 1_000_000);

    forceWin();
    const tooSmall = await debate(sect, {
      discipleId: sect.discipleIds[0],
      betMode: 'free_resource',
      multiplier: 1,
      resourceId: 'ore',
      amount: 9_999,
    });
    expect(errorOf(tooSmall).code).toBe('VALIDATION_ERROR');

    const notBettable = await debate(sect, {
      discipleId: sect.discipleIds[0],
      betMode: 'free_resource',
      multiplier: 1,
      resourceId: 'spiritualEnergy',
      amount: 10_000,
    });
    expect(errorOf(notBettable).code).toBe('VALIDATION_ERROR');

    const notInteger = await debate(sect, {
      discipleId: sect.discipleIds[0],
      betMode: 'free_resource',
      multiplier: 1,
      resourceId: 'ore',
      amount: 10_000.5,
    });
    expect(notInteger.status).toBe(400);

    expect(await debateCounter(sect.sectId)).toEqual({ key: '', count: 0 });
    expect(await balanceOf(sect.sectId, 'ore')).toBe(1_000_000);
  });
});

/* ---------- 模式 C：属性赌注 ---------- */

describe('模式 C：属性赌注', () => {
  it('落败扣属性点（可以扣到 0）；胜出发悟道值', async () => {
    const sect = await makeSect('gh-c');
    await freezeSettlement(sect.sectId);
    await unlockGambling(sect.sectId);
    await setDiscipleFields(sect.discipleIds[0], { attack: 3, dao_insight: 0 });

    forceLose();
    const lost = await debate(sect, {
      discipleId: sect.discipleIds[0],
      betMode: 'attribute',
      multiplier: 3,
      attribute: 'attack',
    });
    expect(lost.status).toBe(200);
    expect((await discipleRow(sect.discipleIds[0])).attack).toBe(0);
    // 对峙界面读的是下注前的属性快照：落败扣点之后，快照里的攻击仍是 3（与 opponent 同源）。
    const lostPayload = dataOf(lost) as Record<string, any>;
    expect(lostPayload.result.discipleAttributes.attack).toBe(3);
    const lostDisciple = (lostPayload.state.disciples as { id: string; attack: number }[]).find(
      (row) => row.id === sect.discipleIds[0],
    );
    expect(lostDisciple?.attack).toBe(0);
    expect(JSON.parse((await debateLogs(sect.sectId))[0].stake_detail)).toEqual({
      attribute: 'attack',
      points: 3,
    });

    forceWin();
    const won = await debate(sect, {
      discipleId: sect.discipleIds[0],
      betMode: 'attribute',
      multiplier: 2,
      attribute: 'defense',
    });
    expect(won.status).toBe(200);
    // 2x 的悟道值奖励 = 4
    expect((await discipleRow(sect.discipleIds[0])).dao_insight).toBe(4);
    // 属性赌注赢的时候属性不动（defense 仍是建号时的值）。
    const row = await discipleRow(sect.discipleIds[0]);
    expect(JSON.parse((await debateLogs(sect.sectId))[1].reward_detail)).toEqual({
      type: 'insight',
      insight: 4,
    });
    expect(row.attack).toBe(0);
  });

  it('属性不足、缺 attribute、属性白名单外都被拒', async () => {
    const sect = await makeSect('gh-c-check');
    await freezeSettlement(sect.sectId);
    await unlockGambling(sect.sectId);
    await setDiscipleFields(sect.discipleIds[0], { speed: 2 });

    forceWin();
    const notEnough = await debate(sect, {
      discipleId: sect.discipleIds[0],
      betMode: 'attribute',
      multiplier: 3,
      attribute: 'speed',
    });
    expect(errorOf(notEnough).code).toBe('INVALID_STATUS');

    const missing = await debate(sect, {
      discipleId: sect.discipleIds[0],
      betMode: 'attribute',
      multiplier: 1,
    });
    expect(errorOf(missing).code).toBe('VALIDATION_ERROR');

    const unknownAttribute = await debate(sect, {
      discipleId: sect.discipleIds[0],
      betMode: 'attribute',
      multiplier: 1,
      attribute: 'charisma',
    });
    expect(unknownAttribute.status).toBe(400);

    expect(await debateCounter(sect.sectId)).toEqual({ key: '', count: 0 });
  });
});

/* ---------- 每日限次、弟子资格、归属 ---------- */

describe('论道限次与资格', () => {
  it('当日已满 DEBATE_DAILY_LIMIT（50）次 → DAILY_LIMIT；第 50 次仍可进行', async () => {
    const sect = await makeSect('gh-limit');
    await freezeSettlement(sect.sectId);
    await unlockGambling(sect.sectId);
    await setBalance(sect.sectId, 'spiritStone', 1_000_000);
    await setDiscipleFields(sect.discipleIds[0], { attack: 50 });

    forceWin();
    await env.DB.prepare('UPDATE sects SET debate_date_key = ?, debate_count = ? WHERE id = ?')
      .bind(TODAY, DEBATE_DAILY_LIMIT - 1, sect.sectId)
      .run();
    const last = await debate(sect, {
      discipleId: sect.discipleIds[0],
      betMode: 'preset_spirit_stone',
      multiplier: 1,
      rewardType: 'insight',
    });
    expect(last.status).toBe(200);
    expect(await debateCounter(sect.sectId)).toEqual({ key: TODAY, count: DEBATE_DAILY_LIMIT });

    // 已用满：再来一次被拒，且不写记录、不发奖。
    const rejected = await debate(sect, {
      discipleId: sect.discipleIds[0],
      betMode: 'preset_spirit_stone',
      multiplier: 1,
      rewardType: 'insight',
    });
    expect(errorOf(rejected).code).toBe('DAILY_LIMIT');
    expect(await debateLogs(sect.sectId)).toHaveLength(1);
    expect((await discipleRow(sect.discipleIds[0])).dao_insight).toBe(1);
  });

  it('受伤弟子与在外历练的弟子都不能参赌（也不消耗次数）', async () => {
    const sect = await makeSect('gh-elig');
    await freezeSettlement(sect.sectId);
    await unlockGambling(sect.sectId);
    await setBalance(sect.sectId, 'spiritStone', 1_000_000);
    const [first, second] = sect.discipleIds as [string, string];

    await setDiscipleFields(first, { injured_until: Date.now() + 600_000 });
    forceWin();
    const injured = await debate(sect, {
      discipleId: first,
      betMode: 'preset_spirit_stone',
      multiplier: 1,
      rewardType: 'resource',
    });
    expect(errorOf(injured).code).toBe('INVALID_STATUS');

    await sendAway(sect.sectId, second, Date.now());
    const away = await debate(sect, {
      discipleId: second,
      betMode: 'preset_spirit_stone',
      multiplier: 1,
      rewardType: 'resource',
    });
    expect(errorOf(away).code).toBe('INVALID_STATUS');

    expect(await debateCounter(sect.sectId)).toEqual({ key: '', count: 0 });
    expect(await debateLogs(sect.sectId)).toHaveLength(0);
  });

  it('跨宗与不存在的 discipleId 一律 NOT_FOUND', async () => {
    const mine = await makeSect('gh-own');
    const other = await makeSect('gh-other');
    await freezeSettlement(mine.sectId);
    await unlockGambling(mine.sectId);
    await setBalance(mine.sectId, 'spiritStone', 1_000_000);

    forceWin();
    const foreign = await debate(mine, {
      discipleId: other.discipleIds[0],
      betMode: 'preset_spirit_stone',
      multiplier: 1,
      rewardType: 'resource',
    });
    expect(errorOf(foreign).code).toBe('NOT_FOUND');

    const missing = await debate(mine, {
      discipleId: 'nobody',
      betMode: 'preset_spirit_stone',
      multiplier: 1,
      rewardType: 'resource',
    });
    expect(errorOf(missing).code).toBe('NOT_FOUND');
    expect(await debateLogs(mine.sectId)).toHaveLength(0);
    expect(await debateLogs(other.sectId)).toHaveLength(0);
  });
});

/* ---------- 悟道值加点 ---------- */

describe('悟道值加点', () => {
  it('成功：属性 + 点数、余额减少、累计已分配增加（回执与状态一致）', async () => {
    const sect = await makeSect('gh-alloc');
    await freezeSettlement(sect.sectId);
    await setDiscipleFields(sect.discipleIds[0], {
      dao_insight: 5,
      dao_insight_used: 12,
      defense: 50,
    });

    const result = await allocate(sect, {
      discipleId: sect.discipleIds[0],
      attribute: 'defense',
      points: 3,
    });
    expect(result.status).toBe(200);
    const payload = dataOf(result) as Record<string, any>;
    expect(payload.outcome).toMatchObject({
      attribute: 'defense',
      points: 3,
      newValue: 53,
      remainingInsight: 2,
      totalUsed: 15,
    });
    const row = await discipleRow(sect.discipleIds[0]);
    expect(row.defense).toBe(53);
    expect(row.dao_insight).toBe(2);
    expect(row.dao_insight_used).toBe(15);

    // sync 视图同步反映新值（daoInsightRemaining 是「剩余可分配额度」）。
    const view = ((await sect.state()).disciples as Record<string, any>[]).find(
      (item) => item.id === sect.discipleIds[0],
    );
    expect(view, 'sync 视图里必须有该弟子').toBeTruthy();
    expect(view!.defense).toBe(53);
    expect(view!.daoInsight).toBe(2);
    expect(view!.daoInsightUsed).toBe(15);
    expect(view!.daoInsightRemaining).toBe(DAO_INSIGHT_CAP - 15);

    // 悟道值加点不消耗论道次数、也不写论道记录。
    expect(await debateCounter(sect.sectId)).toEqual({ key: '', count: 0 });
    expect(await debateLogs(sect.sectId)).toHaveLength(0);
  });

  it('余额不足 / 超出累计 50 上限 / 超出属性 100 上限都被拒且不写库', async () => {
    const sect = await makeSect('gh-alloc-check');
    await freezeSettlement(sect.sectId);
    const discipleId = sect.discipleIds[0] as string;

    await setDiscipleFields(discipleId, { dao_insight: 1, dao_insight_used: 0, attack: 50 });
    const poor = await allocate(sect, { discipleId, attribute: 'attack', points: 2 });
    expect(errorOf(poor).code).toBe('INVALID_STATUS');

    await setDiscipleFields(discipleId, {
      dao_insight: 10,
      dao_insight_used: DAO_INSIGHT_CAP - 1,
    });
    const capped = await allocate(sect, { discipleId, attribute: 'attack', points: 2 });
    expect(errorOf(capped).code).toBe('INVALID_STATUS');

    await setDiscipleFields(discipleId, {
      dao_insight: 10,
      dao_insight_used: 0,
      defense: 100,
    });
    const maxed = await allocate(sect, { discipleId, attribute: 'defense', points: 1 });
    expect(errorOf(maxed).code).toBe('INVALID_STATUS');

    // 参数层防线：0 点 / 超 50 点 / 属性白名单外。
    await setDiscipleFields(discipleId, { dao_insight: 10, dao_insight_used: 0, attack: 50 });
    const zero = await allocate(sect, { discipleId, attribute: 'attack', points: 0 });
    expect(zero.status).toBe(400);
    const tooMany = await allocate(sect, { discipleId, attribute: 'attack', points: 51 });
    expect(tooMany.status).toBe(400);
    const unknown = await allocate(sect, { discipleId, attribute: 'charisma', points: 1 });
    expect(unknown.status).toBe(400);

    const row = await discipleRow(discipleId);
    expect(row.attack).toBe(50);
    expect(row.defense).toBe(100);
    expect(row.dao_insight).toBe(10);
    expect(row.dao_insight_used).toBe(0);
  });

  it('跨宗弟子 NOT_FOUND，且不动他人悟道值', async () => {
    const mine = await makeSect('gh-alloc-own');
    const other = await makeSect('gh-alloc-other');
    await freezeSettlement(mine.sectId);
    await setDiscipleFields(other.discipleIds[0], { dao_insight: 4 });

    const result = await allocate(mine, {
      discipleId: other.discipleIds[0],
      attribute: 'attack',
      points: 1,
    });
    expect(errorOf(result).code).toBe('NOT_FOUND');
    expect((await discipleRow(other.discipleIds[0])).dao_insight).toBe(4);
  });
});

/* ---------- 迁移约束（0019） ---------- */

describe('0019 迁移的数据库约束', () => {
  it('dao_insight 不能为负、dao_insight_used 不能超过 50、倍率只能是 1~999（0023 放宽后）', async () => {
    const sect = await makeSect('gh-db');
    const discipleId = sect.discipleIds[0] as string;

    await expect(
      env.DB.prepare('UPDATE disciples SET dao_insight = -1 WHERE id = ?').bind(discipleId).run(),
    ).rejects.toThrow(/CHECK/i);

    await expect(
      env.DB.prepare('UPDATE disciples SET dao_insight_used = 51 WHERE id = ?')
        .bind(discipleId)
        .run(),
    ).rejects.toThrow(/CHECK/i);

    // 0020 把 multiplier 的 CHECK 从 1~3 放宽到 1~5（天机轮投入档位），
    // 0023 再放宽到 1~999（赛马存「选中马的赔率 × 10」，冷门 18.9x → 189）；1000 仍然越界。
    await expect(
      env.DB.prepare(
        `INSERT INTO dao_debate_log (id, sect_id, disciple_id, disciple_name, bet_mode, multiplier,
           stake_detail, result, reward_detail, win_probability, created_at)
         VALUES (?, ?, ?, ?, 'horse_race', 1000, '{}', 'win', '{}', NULL, ?)`,
      )
        .bind(crypto.randomUUID(), sect.sectId, discipleId, '赛马', Date.now())
        .run(),
    ).rejects.toThrow(/CHECK/i);

    // 上界这一侧：天机轮最大档位 5 与赛马冷门赔率 189 都必须被接受。
    for (const [multiplier, betMode, name] of [
      [5, 'wheel', '天机轮'],
      [189, 'horse_race', '赛马'],
    ] as const) {
      await env.DB.prepare(
        `INSERT INTO dao_debate_log (id, sect_id, disciple_id, disciple_name, bet_mode, multiplier,
           stake_detail, result, reward_detail, win_probability, created_at)
         VALUES (?, ?, ?, ?, ?, ?, '{}', 'win', '{}', NULL, ?)`,
      )
        .bind(crypto.randomUUID(), sect.sectId, discipleId, name, betMode, multiplier, Date.now())
        .run();
    }
    expect(await debateLogs(sect.sectId)).toHaveLength(2);
  });

  it('新宗门与旧弟子的默认值：debate 计数为 0/空、悟道值为 0', async () => {
    const sect = await makeSect('gh-default');
    expect(await debateCounter(sect.sectId)).toEqual({ key: '', count: 0 });
    const row = await discipleRow(sect.discipleIds[0]);
    expect(Number(row.dao_insight)).toBe(0);
    expect(Number(row.dao_insight_used)).toBe(0);
  });
});

/* ---------- 复盘补测：发奖不动「累计已分配」、幸运/体魄下限、守卫覆盖面 ---------- */

describe('发奖与属性扣减的边界', () => {
  it('胜出发悟道值不会覆盖「累计已分配」列（并发加点的上限口径）', async () => {
    const sect = await makeSect('gh-a-used');
    await freezeSettlement(sect.sectId);
    await unlockGambling(sect.sectId);
    await setBalance(sect.sectId, 'spiritStone', 1_000_000);
    await setDiscipleFields(sect.discipleIds[0], { dao_insight: 0, dao_insight_used: 12 });

    forceWin();
    const result = await debate(sect, {
      discipleId: sect.discipleIds[0],
      betMode: 'preset_spirit_stone',
      multiplier: 2,
      rewardType: 'insight',
    });
    expect(result.status).toBe(200);
    const row = await discipleRow(sect.discipleIds[0]);
    expect(row.dao_insight).toBe(2);
    // 这一列只由加点写入；发奖写回时必须保持原值（否则累计 50 上限会被静默重置）。
    expect(row.dao_insight_used).toBe(12);

    const state = await sect.state();
    const view = (state.disciples as Record<string, any>[]).find(
      (item) => item.id === sect.discipleIds[0],
    );
    expect(view!.daoInsight).toBe(2);
    expect(view!.daoInsightUsed).toBe(12);
    expect(view!.daoInsightRemaining).toBe(DAO_INSIGHT_CAP - 12);
  });

  it('幸运 / 体魄最低保留 1 点：押到 0 会被服务端拒绝（不落到数据库 CHECK 上）', async () => {
    const sect = await makeSect('gh-floor');
    await freezeSettlement(sect.sectId);
    await unlockGambling(sect.sectId);
    const discipleId = sect.discipleIds[0] as string;
    await setDiscipleFields(discipleId, { luck: 3 });

    forceLose();
    // 3 点押 3x（3 点）会扣到 0，而 0016 的 CHECK 是 1..100 —— 必须在这里被挡住。
    const rejected = await debate(sect, {
      discipleId,
      betMode: 'attribute',
      multiplier: 3,
      attribute: 'luck',
    });
    expect(errorOf(rejected).code).toBe('INVALID_STATUS');
    expect((await discipleRow(discipleId)).luck).toBe(3);
    expect(await debateCounter(sect.sectId)).toEqual({ key: '', count: 0 });

    // 押到下限 1 点是允许的（3 点押 2x = 扣 2 点）。
    const allowed = await debate(sect, {
      discipleId,
      betMode: 'attribute',
      multiplier: 2,
      attribute: 'luck',
    });
    expect(allowed.status).toBe(200);
    expect((await discipleRow(discipleId)).luck).toBe(1);
    expect(await debateCounter(sect.sectId)).toEqual({ key: TODAY, count: 1 });
  });
});

describe('赌坊快照守卫（0019）', () => {
  /** 库里真实的宗门行 / 弟子行 / 资源行：守卫只比较这些值，不在测试里手写行字面量。 */
  async function guardRows(
    sectId: string,
    discipleId: string,
  ): Promise<{ sectRow: SectRow; disciple: DiscipleRow; balances: ResourceBalanceRow[] }> {
    const sectRow = await env.DB.prepare('SELECT * FROM sects WHERE id = ?')
      .bind(sectId)
      .first<SectRow>();
    const disciple = await env.DB.prepare('SELECT * FROM disciples WHERE id = ?')
      .bind(discipleId)
      .first<DiscipleRow>();
    const balances = await env.DB.prepare('SELECT * FROM resource_balances WHERE sect_id = ?')
      .bind(sectId)
      .all<ResourceBalanceRow>();
    expect(sectRow, '必须有宗门行').not.toBeNull();
    expect(disciple, '必须有弟子行').not.toBeNull();
    return { sectRow: sectRow!, disciple: disciple!, balances: balances.results ?? [] };
  }

  function placeholders(sql: string): number {
    return (sql.match(/\?/g) ?? []).length;
  }

  it('占位符与参数严格一一对应；只发悟道值奖励时也校验弟子行', async () => {
    const sect = await makeSect('gh-guard');
    const discipleId = sect.discipleIds[0] as string;
    const { sectRow, disciple, balances } = await guardRows(sect.sectId, discipleId);
    const now = Date.now();

    const noDisciple = gamblingSnapshotGuardStatement('cmd-a', {
      sect: sectRow,
      balances,
      resourceId: null,
      now,
    });
    const withDisciple = gamblingSnapshotGuardStatement('cmd-b', {
      sect: sectRow,
      balances,
      resourceId: 'spiritStone',
      disciple: { row: disciple },
      now,
    });
    const withAttribute = gamblingSnapshotGuardStatement('cmd-c', {
      sect: sectRow,
      balances,
      resourceId: 'spiritStone',
      disciple: { row: disciple, attribute: 'luck' },
      now,
    });
    const withAway = gamblingSnapshotGuardStatement('cmd-d', {
      sect: sectRow,
      balances,
      resourceId: 'spiritStone',
      disciple: { row: disciple, attribute: 'luck' },
      rejectAway: true,
      now,
    });

    for (const statement of [noDisciple, withDisciple, withAttribute, withAway]) {
      expect(placeholders(statement.sql)).toBe((statement.params ?? []).length);
    }
    // 只要传了弟子，就必须有弟子行校验（漏掉它会覆盖并发加点写下的 dao_insight*）。
    expect(withDisciple.sql).toContain('FROM disciples');
    expect(noDisciple.sql).not.toContain('FROM disciples');
    // 属性列来自白名单，且只多一个绑定参数。
    expect(withAttribute.sql).toContain('luck = ?');
    expect((withAttribute.params ?? []).length).toBe((withDisciple.params ?? []).length + 1);
    // rejectAway 再加两个参数（弟子 id + now）。
    expect((withAway.params ?? []).length).toBe((withAttribute.params ?? []).length + 2);
  });

  it('读快照之后弟子行被并发改动 → 整批回滚，不会按旧值写回', async () => {
    const sect = await makeSect('gh-guard-stale');
    const discipleId = sect.discipleIds[0] as string;
    const { sectRow, disciple, balances } = await guardRows(sect.sectId, discipleId);
    const guard = gamblingSnapshotGuardStatement('cmd-stale', {
      sect: sectRow,
      balances,
      resourceId: null,
      disciple: { row: disciple },
      now: Date.now(),
    });

    // 模拟并发：另一个请求在读快照之后改了 dao_insight_used。
    await setDiscipleFields(discipleId, { dao_insight_used: 20 });

    await expect(
      env.DB.batch([
        env.DB.prepare(guard.sql).bind(...(guard.params ?? [])),
        env.DB.prepare('UPDATE disciples SET dao_insight = 99 WHERE id = ?').bind(discipleId),
      ]),
    ).rejects.toThrow(/CHECK/i);

    // 整批回滚：并发写入保留，命令写入没有生效，守卫行也被回滚掉。
    const row = await discipleRow(discipleId);
    expect(row.dao_insight_used).toBe(20);
    expect(row.dao_insight).toBe(disciple.dao_insight);
    const guards = await env.DB.prepare(
      'SELECT COUNT(*) AS total FROM mutation_guards WHERE command_id = ?',
    )
      .bind('cmd-stale')
      .first<{ total: number }>();
    expect(Number(guards!.total)).toBe(0);
  });
});

/* ---------- 天机轮（0020 迁移 + 计划 4.2 / 4.3） ---------- */

/** sync 面板里的天机轮（调用方保证赌坊已解锁）。 */
function wheelPanel(state: Record<string, any>): Record<string, any> {
  const panel = state.gambling.wheel as Record<string, any> | null;
  expect(panel, 'sync 面板里必须有天机轮（赌坊已解锁）').toBeTruthy();
  return panel!;
}

function spin(sect: SectFixture, tier: number): Promise<ApiResult> {
  return sect.api.post('/api/v1/game/wheel-spin', { tier });
}

/** 重置请求体为空：路由不解析 JSON，所以这里不传 body。 */
function resetWheel(sect: SectFixture): Promise<ApiResult> {
  return sect.api.post('/api/v1/game/wheel-reset');
}

async function wheelSeedOf(sectId: string): Promise<number> {
  const row = await env.DB.prepare('SELECT wheel_seed FROM sects WHERE id = ?')
    .bind(sectId)
    .first<{ wheel_seed: number }>();
  expect(row, '必须有宗门行').not.toBeNull();
  return Number(row!.wheel_seed);
}

async function setWheelSeed(sectId: string, seed: number): Promise<void> {
  await env.DB.prepare('UPDATE sects SET wheel_seed = ? WHERE id = ?').bind(seed, sectId).run();
}

async function pillQuantityOf(sectId: string, pillId: string): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT quantity FROM pill_inventories WHERE sect_id = ? AND pill_id = ?',
  )
    .bind(sectId, pillId)
    .first<{ quantity: number }>();
  return row === null ? 0 : Number(row.quantity);
}

/** 直接造一条丹药库存：天机轮丹药格发奖是「快照 + 数量」的绝对值 upsert。 */
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

/**
 * 落格由服务端的一次 Math.random 决定：把它钉在目标格所属的 1/8 区间里
 * （沿用本文件 forceWin / forceLose 的同一手法；格局本身仍由 seed 确定性生成）。
 */
function landOnSlot(slotIndex: number, slots?: readonly WheelSlot[]): void {
  if (!slots) {
    vi.spyOn(Math, 'random').mockReturnValue((slotIndex + 0.5) / WHEEL_SLOT_COUNT);
    return;
  }
  let total = 0;
  for (const s of slots) total += WHEEL_SLOT_WEIGHTS[s.type];
  let acc = 0;
  for (let i = 0; i < slotIndex; i++) acc += WHEEL_SLOT_WEIGHTS[slots[i]!.type];
  const mid = acc + WHEEL_SLOT_WEIGHTS[slots[slotIndex]!.type] / 2;
  vi.spyOn(Math, 'random').mockReturnValue(mid / total);
}

/**
 * 把宗门转盘换成「格局里含指定类型格」的那一版，并返回该格的确定性下标。
 * 格局是 (sect_id, wheel_seed) 的纯函数，所以测试能用与服务端同一个生成器预先算好落点，
 * 不必去撞随机 seed。
 */
async function aimAtSlot(
  sect: SectFixture,
  type: WheelSlot['type'],
): Promise<{ seed: number; slotIndex: number; slot: WheelSlot; slots: WheelSlot[] }> {
  for (let seed = 0; seed < 200; seed += 1) {
    const slots = generateWheelSlots(wheelLayoutSeed(sect.sectId, seed, TODAY));
    const slotIndex = slots.findIndex((slot) => slot.type === type);
    if (slotIndex >= 0) {
      await setWheelSeed(sect.sectId, seed);
      return { seed, slotIndex, slot: slots[slotIndex]!, slots };
    }
  }
  throw new Error(`转盘格局里找不到 ${type} 格（试了 200 个 seed）`);
}

describe('天机轮：面板与转动（计划 4.1 / 4.2）', () => {
  it('转动成功：扣档位费、奖励入账、写 wheel 记录、次数 +1、slotIndex 与面板一致', async () => {
    const sect = await makeSect('wh-spin');
    await freezeSettlement(sect.sectId);
    await unlockGambling(sect.sectId);
    await setBalance(sect.sectId, 'spiritStone', 2_000_000);

    const panel = wheelPanel(await sect.state());
    expect(panel.seed).toBe(0);
    expect(panel.resetCost).toBe(WHEEL_RESET_COST);
    expect(panel.costs).toEqual([
      { tier: 1, cost: 50_000 },
      { tier: 2, cost: 100_000 },
      { tier: 3, cost: 150_000 },
      { tier: 4, cost: 200_000 },
      { tier: 5, cost: 250_000 },
    ]);
    const panelSlots = panel.slots as Record<string, any>[];
    expect(panelSlots).toHaveLength(WHEEL_SLOT_COUNT);
    // 面板格局必须与转动用的是同一个 (sect_id, wheel_seed) 派生结果。
    expect(panelSlots.map((slot) => slot.type)).toEqual(
      generateWheelSlots(wheelLayoutSeed(sect.sectId, 0, TODAY)).map((slot) => slot.type),
    );

    const realSlots = generateWheelSlots(wheelLayoutSeed(sect.sectId, 0, TODAY));
    const slotIndex = panelSlots.findIndex((slot) => slot.type === 'spirit_stone');
    expect(slotIndex).toBeGreaterThanOrEqual(0);
    const slot = panelSlots[slotIndex]!;
    const tier = 1;
    const cost = WHEEL_SPIN_COST * tier;
    const expectedAmount = String(Math.floor(cost * slot.multiplier + 1e-6));

    landOnSlot(slotIndex, realSlots);
    const spun = await spin(sect, tier);
    expect(spun.status).toBe(200);
    const payload = dataOf(spun) as Record<string, any>;
    const outcome = payload.result as Record<string, any>;

    expect(outcome.slotIndex).toBe(slotIndex);
    expect(outcome.tier).toBe(tier);
    expect(outcome.cost).toBe(String(cost));
    expect(outcome.slotLabel).toBe(slot.label);
    expect(outcome.message).toContain(slot.label);
    // 奖励口径：资源类 = floor(投入 × 格子倍率)。
    expect(outcome.reward).toEqual({
      type: 'resource',
      resourceId: 'spiritStone',
      amount: expectedAmount,
    });

    // 状态回执：命中格子的文案、次数与剩余都与响应一致。
    expect(payload.state.gambling.wheel.slots[slotIndex].label).toBe(outcome.slotLabel);
    expect(payload.state.gambling.usedToday).toBe(1);
    expect(payload.state.gambling.remaining).toBe(DEBATE_DAILY_LIMIT - 1);

    // 扣费与发奖：余额 = 初始 - 投入 + 奖励。
    expect(await balanceOf(sect.sectId, 'spiritStone')).toBe(
      2_000_000 - cost + Number(expectedAmount),
    );

    const logs = await debateLogs(sect.sectId);
    expect(logs).toHaveLength(1);
    expect(logs[0].bet_mode).toBe('wheel');
    expect(logs[0].disciple_id).toBe('');
    expect(logs[0].disciple_name).toBe('天机轮');
    expect(logs[0].multiplier).toBe(tier);
    expect(logs[0].result).toBe('win');
    expect(logs[0].win_probability).toBeNull();
    expect(JSON.parse(logs[0].stake_detail)).toEqual({ amount: String(cost) });
    expect(JSON.parse(logs[0].reward_detail)).toEqual({
      type: 'resource',
      resourceId: 'spiritStone',
      amount: expectedAmount,
    });
    expect(await debateCounter(sect.sectId)).toEqual({ key: TODAY, count: 1 });
  });

  it('大额灵石格：金额 = 投入 × 格子倍率 × 3，投入仍只扣一次', async () => {
    const sect = await makeSect('wh-big');
    await freezeSettlement(sect.sectId);
    await unlockGambling(sect.sectId);
    await setBalance(sect.sectId, 'spiritStone', 2_000_000);

    const { slotIndex, slot, slots } = await aimAtSlot(sect, 'big_spirit_stone');
    const tier = 2;
    const cost = WHEEL_SPIN_COST * tier;
    const expectedAmount = String(Math.floor(cost * slot.multiplier * WHEEL_BIG_MULTIPLIER + 1e-6));

    landOnSlot(slotIndex, slots);
    const spun = await spin(sect, tier);
    expect(spun.status).toBe(200);
    const outcome = (dataOf(spun) as Record<string, any>).result as Record<string, any>;
    expect(outcome.slotIndex).toBe(slotIndex);
    expect(outcome.reward).toEqual({
      type: 'resource',
      resourceId: 'spiritStone',
      amount: expectedAmount,
    });

    // 大额格也是灵石（与格面文案「灵石 ×…」同一口径）：余额 = 投入前 - 投入 + 奖励，
    // 而且不能凭空多出一条配置里不存在的资源余额。
    expect(await balanceOf(sect.sectId, 'spiritStone')).toBe(
      2_000_000 - cost + Number(outcome.reward.amount),
    );
    const balanceRows = await env.DB.prepare(
      'SELECT resource_id FROM resource_balances WHERE sect_id = ?',
    )
      .bind(sect.sectId)
      .all<{ resource_id: string }>();
    expect((balanceRows.results ?? []).map((row) => row.resource_id)).not.toContain(
      'big_spirit_stone',
    );

    expect(JSON.parse((await debateLogs(sect.sectId))[0]!.reward_detail)).toEqual({
      type: 'resource',
      resourceId: 'spiritStone',
      amount: expectedAmount,
    });
  });

  it('丹药格中奖：库存按档位颗数累加（在已有库存上叠加），响应与记录口径一致', async () => {
    const sect = await makeSect('wh-pill');
    await freezeSettlement(sect.sectId);
    await unlockGambling(sect.sectId);
    await setBalance(sect.sectId, 'spiritStone', 2_000_000);

    const { slotIndex, slot, slots } = await aimAtSlot(sect, 'pill');
    expect(slot.pillId).not.toBeNull();
    expect(PILL_IDS).toContain(slot.pillId);
    const pillId = slot.pillId as string;

    const panelSlots = wheelPanel(await sect.state()).slots as Record<string, any>[];
    expect(panelSlots[slotIndex]!.type).toBe('pill');
    expect(panelSlots[slotIndex]!.label).toBe(`${findPillRecipe(pillId)!.name} ×1~5`);

    // 先有 2 颗，中奖是「快照 + 档位颗数」的绝对值写回，不是覆盖成 3。
    await setPillQuantity(sect.sectId, pillId, 2);

    const tier = 3;
    landOnSlot(slotIndex, slots);
    const spun = await spin(sect, tier);
    expect(spun.status).toBe(200);
    const outcome = (dataOf(spun) as Record<string, any>).result as Record<string, any>;
    expect(outcome.slotIndex).toBe(slotIndex);
    // 丹药奖励 = 档位颗数，与格子倍率无关。
    expect(outcome.reward).toEqual({
      type: 'pill',
      pillId,
      pillName: findPillRecipe(pillId)!.name,
      quantity: tier,
    });
    expect(await pillQuantityOf(sect.sectId, pillId)).toBe(2 + tier);
    expect(await balanceOf(sect.sectId, 'spiritStone')).toBe(2_000_000 - WHEEL_SPIN_COST * tier);

    const logs = await debateLogs(sect.sectId);
    expect(logs).toHaveLength(1);
    expect(logs[0].result).toBe('win');
    expect(JSON.parse(logs[0].reward_detail)).toEqual({ type: 'pill', pillId, quantity: tier });
    expect(JSON.parse(logs[0].stake_detail)).toEqual({ amount: String(WHEEL_SPIN_COST * tier) });
  });

  it('谢谢惠顾：无奖励、投入照扣、记录为 lose + reward none', async () => {
    const sect = await makeSect('wh-nothing');
    await freezeSettlement(sect.sectId);
    await unlockGambling(sect.sectId);
    await setBalance(sect.sectId, 'spiritStone', 1_000_000);

    const { slotIndex, slots } = await aimAtSlot(sect, 'nothing');
    landOnSlot(slotIndex, slots);
    const spun = await spin(sect, 1);
    expect(spun.status).toBe(200);
    const outcome = (dataOf(spun) as Record<string, any>).result as Record<string, any>;
    expect(outcome.slotIndex).toBe(slotIndex);
    expect(outcome.slotLabel).toBe('谢谢惠顾');
    expect(outcome.reward).toEqual({ type: 'none' });
    expect(outcome.message).toContain('谢谢惠顾');

    expect(await balanceOf(sect.sectId, 'spiritStone')).toBe(1_000_000 - WHEEL_SPIN_COST);
    const logs = await debateLogs(sect.sectId);
    expect(logs).toHaveLength(1);
    expect(logs[0].result).toBe('lose');
    expect(JSON.parse(logs[0].reward_detail)).toEqual({ type: 'none' });
    expect(await debateCounter(sect.sectId)).toEqual({ key: TODAY, count: 1 });
  });
});

describe('天机轮：次数与余额的拒绝路径（计划 2.5 / 4.2）', () => {
  it('余额不足：INSUFFICIENT_RESOURCE，不扣费、不写记录、计数不增', async () => {
    const sect = await makeSect('wh-poor');
    await freezeSettlement(sect.sectId);
    await unlockGambling(sect.sectId);
    const balance = WHEEL_SPIN_COST * 5 - 1;
    await setBalance(sect.sectId, 'spiritStone', balance);

    landOnSlot(0);
    const rejected = await spin(sect, 5);
    expect(errorOf(rejected).code).toBe('INSUFFICIENT_RESOURCE');
    expect(await balanceOf(sect.sectId, 'spiritStone')).toBe(balance);
    expect(await debateLogs(sect.sectId)).toHaveLength(0);
    expect(await debateCounter(sect.sectId)).toEqual({ key: '', count: 0 });
    expect(await wheelSeedOf(sect.sectId)).toBe(0);
  });

  it('每日次数用尽（20/20）：DAILY_LIMIT，不扣费、不写记录', async () => {
    const sect = await makeSect('wh-limit');
    await freezeSettlement(sect.sectId);
    await unlockGambling(sect.sectId);
    await setBalance(sect.sectId, 'spiritStone', 1_000_000);
    await env.DB.prepare('UPDATE sects SET debate_date_key = ?, debate_count = ? WHERE id = ?')
      .bind(TODAY, DEBATE_DAILY_LIMIT, sect.sectId)
      .run();
    expect((await sect.state()).gambling.remaining).toBe(0);

    landOnSlot(0);
    const rejected = await spin(sect, 1);
    expect(errorOf(rejected).code).toBe('DAILY_LIMIT');
    expect(await balanceOf(sect.sectId, 'spiritStone')).toBe(1_000_000);
    expect(await debateLogs(sect.sectId)).toHaveLength(0);
    expect(await debateCounter(sect.sectId)).toEqual({ key: TODAY, count: DEBATE_DAILY_LIMIT });
  });

  it('与论道共享同一列次数：转一次后 remaining 减 1，接着论道在同一列上继续累加', async () => {
    const sect = await makeSect('wh-share');
    await freezeSettlement(sect.sectId);
    await unlockGambling(sect.sectId);
    await setBalance(sect.sectId, 'spiritStone', 2_000_000);

    const { slotIndex, slots } = await aimAtSlot(sect, 'spirit_stone');
    landOnSlot(slotIndex, slots);
    const spun = await spin(sect, 1);
    expect(spun.status).toBe(200);
    expect((dataOf(spun) as Record<string, any>).state.gambling.remaining).toBe(
      DEBATE_DAILY_LIMIT - 1,
    );

    const state = await sect.state();
    expect(state.gambling.usedToday).toBe(1);
    expect(state.gambling.remaining).toBe(DEBATE_DAILY_LIMIT - 1);
    expect(await debateCounter(sect.sectId)).toEqual({ key: TODAY, count: 1 });

    // 论道读的是同一列：计数到 2、剩余再减 1。
    forceWin();
    const debated = await debate(sect, {
      discipleId: sect.discipleIds[0],
      betMode: 'preset_spirit_stone',
      multiplier: 1,
      rewardType: 'insight',
    });
    expect(debated.status).toBe(200);
    expect(await debateCounter(sect.sectId)).toEqual({ key: TODAY, count: 2 });
    expect((dataOf(debated) as Record<string, any>).state.gambling.remaining).toBe(
      DEBATE_DAILY_LIMIT - 2,
    );
  });
});

describe('天机轮：重置（计划 4.3）', () => {
  it('重置成功：扣重置费、wheel_seed +1、格局重排、不消耗每日次数', async () => {
    const sect = await makeSect('wh-reset');
    await freezeSettlement(sect.sectId);
    await unlockGambling(sect.sectId);
    await setBalance(sect.sectId, 'spiritStone', 1_000_000);
    await env.DB.prepare('UPDATE sects SET debate_date_key = ?, debate_count = ? WHERE id = ?')
      .bind(TODAY, 5, sect.sectId)
      .run();

    // 挑一个「重置后格局一定不同」的起始 seed：格局是 (sect_id, wheel_seed) 的纯函数，可以预算。
    let startSeed = 0;
    for (let seed = 0; seed < 200; seed += 1) {
      const current = JSON.stringify(generateWheelSlots(wheelLayoutSeed(sect.sectId, seed, TODAY)));
      const next = JSON.stringify(generateWheelSlots(wheelLayoutSeed(sect.sectId, seed + 1, TODAY)));
      if (current !== next) {
        startSeed = seed;
        break;
      }
    }
    await setWheelSeed(sect.sectId, startSeed);

    const panelBefore = wheelPanel(await sect.state());
    expect(panelBefore.seed).toBe(startSeed);
    const slotsBefore = panelBefore.slots as Record<string, any>[];

    const resetResult = await resetWheel(sect);
    expect(resetResult.status).toBe(200);
    const payload = dataOf(resetResult) as Record<string, any>;
    expect(payload.state.gambling.wheel.seed).toBe(startSeed + 1);
    expect(await wheelSeedOf(sect.sectId)).toBe(startSeed + 1);
    expect(await balanceOf(sect.sectId, 'spiritStone')).toBe(1_000_000 - WHEEL_RESET_COST);
    // 重置不消耗每日次数、不写赌坊记录。
    expect(await debateCounter(sect.sectId)).toEqual({ key: TODAY, count: 5 });
    expect(await debateLogs(sect.sectId)).toHaveLength(0);

    // seed 一变整盘就变：格序与倍率都重排。
    const slotsAfter = (await sect.state()).gambling.wheel.slots as Record<string, any>[];
    expect(slotsAfter).not.toEqual(slotsBefore);
    expect(slotsAfter.map((slot) => slot.type)).toEqual(
      generateWheelSlots(wheelLayoutSeed(sect.sectId, startSeed + 1, TODAY)).map((slot) => slot.type),
    );
  });

  it('重置余额不足：INSUFFICIENT_RESOURCE，wheel_seed 与余额都不变', async () => {
    const sect = await makeSect('wh-reset-poor');
    await freezeSettlement(sect.sectId);
    await unlockGambling(sect.sectId);
    await setBalance(sect.sectId, 'spiritStone', WHEEL_RESET_COST - 1);
    await setWheelSeed(sect.sectId, 3);

    const rejected = await resetWheel(sect);
    expect(errorOf(rejected).code).toBe('INSUFFICIENT_RESOURCE');
    expect(await wheelSeedOf(sect.sectId)).toBe(3);
    expect(await balanceOf(sect.sectId, 'spiritStone')).toBe(WHEEL_RESET_COST - 1);
    expect(await debateCounter(sect.sectId)).toEqual({ key: '', count: 0 });
    expect(await debateLogs(sect.sectId)).toHaveLength(0);
  });

  it('宗门 1 级（未解锁）：两个接口都拒且不写库，面板 wheel 为 null', async () => {
    const sect = await makeSect('wh-locked');
    await freezeSettlement(sect.sectId);
    await setBalance(sect.sectId, 'spiritStone', 1_000_000);

    const state = await sect.state();
    expect(state.gambling.unlocked).toBe(false);
    expect(state.gambling.wheel).toBeNull();

    const spun = await spin(sect, 1);
    expect(errorOf(spun).code).toBe('INVALID_STATUS');
    const resetResult = await resetWheel(sect);
    expect(errorOf(resetResult).code).toBe('INVALID_STATUS');

    expect(await debateLogs(sect.sectId)).toHaveLength(0);
    expect(await debateCounter(sect.sectId)).toEqual({ key: '', count: 0 });
    expect(await balanceOf(sect.sectId, 'spiritStone')).toBe(1_000_000);
    expect(await wheelSeedOf(sect.sectId)).toBe(0);
  });
});

describe('天机轮快照守卫（0020）', () => {
  it('丹药库存快照过期 → 整批发奖回滚，守卫行也不留下', async () => {
    const sect = await makeSect('wh-guard-pill');
    const pillId = PILL_IDS[0] as string;
    await setPillQuantity(sect.sectId, pillId, 5);

    const sectRow = await env.DB.prepare('SELECT * FROM sects WHERE id = ?')
      .bind(sect.sectId)
      .first<SectRow>();
    const balances = (
      await env.DB.prepare('SELECT * FROM resource_balances WHERE sect_id = ?')
        .bind(sect.sectId)
        .all<ResourceBalanceRow>()
    ).results;
    expect(sectRow, '必须有宗门行').not.toBeNull();

    // 快照读到 3 颗，但库里已经是 5 颗（模拟并发的炼制 / 服用）。
    const guard = gamblingSnapshotGuardStatement('cmd-wheel-pill', {
      sect: sectRow!,
      balances: balances ?? [],
      resourceId: null,
      pill: { pillId, quantity: 3 },
      checkWheelSeed: true,
      now: Date.now(),
    });
    expect(guard.sql).toContain('pill_inventories');
    // 天机轮转动 / 重置都要求格局没被并发重置过。
    expect(guard.sql).toContain('wheel_seed = ?');
    expect((guard.sql.match(/\?/g) ?? []).length).toBe((guard.params ?? []).length);

    const upsert = upsertPillInventoryStatement(sect.sectId, pillId, 8, Date.now());
    await expect(
      env.DB.batch([
        env.DB.prepare(guard.sql).bind(...(guard.params ?? [])),
        env.DB.prepare(upsert.sql).bind(...(upsert.params ?? [])),
      ]),
    ).rejects.toThrow(/CHECK/i);

    // 整批回滚：并发写入保留、发奖没生效、守卫行也被回滚掉。
    expect(await pillQuantityOf(sect.sectId, pillId)).toBe(5);
    const guards = await env.DB.prepare(
      'SELECT COUNT(*) AS total FROM mutation_guards WHERE command_id = ?',
    )
      .bind('cmd-wheel-pill')
      .first<{ total: number }>();
    expect(Number(guards!.total)).toBe(0);
  });
});

/* ---------- 0020 天机轮：战绩口径、快照守卫与迁移约束 ---------- */

describe('天机轮的战绩口径与 0020 迁移约束', () => {
  it('中奖也扣投入：净收益 = 奖励 - 投入（不会把投入当成净赚）', async () => {
    const sect = await makeSect('wh-stats-big');
    await freezeSettlement(sect.sectId);
    await unlockGambling(sect.sectId);
    await setBalance(sect.sectId, 'spiritStone', 2_000_000);

    const { slotIndex, slot, slots } = await aimAtSlot(sect, 'big_spirit_stone');
    const tier = 2;
    const cost = WHEEL_SPIN_COST * tier;
    const reward = Math.floor(cost * slot.multiplier * WHEEL_BIG_MULTIPLIER + 1e-6);

    landOnSlot(slotIndex, slots);
    expect((await spin(sect, tier)).status).toBe(200);

    // 天机轮无论输赢都先扣投入，赢的奖励只是「投入 × 倍率」——
    // 净收益必须按 奖励 - 投入 计（只减败北赌注的老口径会在这里虚增一个投入额）。
    const stats = (await sect.state()).gambling.stats as Record<string, number>;
    expect(stats).toMatchObject({ total: 1, wins: 1, losses: 0, totalInsight: 0 });
    expect(stats.netSpiritStone).toBe(reward - cost);
  });

  it('丹药格中奖：净收益是 -投入（奖励不是灵石，投入不能凭空消失）', async () => {
    const sect = await makeSect('wh-stats-pill');
    await freezeSettlement(sect.sectId);
    await unlockGambling(sect.sectId);
    await setBalance(sect.sectId, 'spiritStone', 2_000_000);

    const { slotIndex, slots } = await aimAtSlot(sect, 'pill');
    const tier = 1;
    landOnSlot(slotIndex, slots);
    expect((await spin(sect, tier)).status).toBe(200);

    const stats = (await sect.state()).gambling.stats as Record<string, number>;
    expect(stats.wins).toBe(1);
    expect(stats.netSpiritStone).toBe(-WHEEL_SPIN_COST * tier);
  });

  it('守卫：丹药库存一致、只有 wheel_seed 过期 → 整批回滚（转动中途被重置）', async () => {
    const sect = await makeSect('wh-guard-seed');
    await freezeSettlement(sect.sectId);
    const sectRow = await env.DB.prepare('SELECT * FROM sects WHERE id = ?')
      .bind(sect.sectId)
      .first<SectRow>();
    expect(sectRow, '必须有宗门行').not.toBeNull();
    const balances =
      (
        await env.DB.prepare('SELECT * FROM resource_balances WHERE sect_id = ?')
          .bind(sect.sectId)
          .all<ResourceBalanceRow>()
      ).results ?? [];

    const guard = gamblingSnapshotGuardStatement('cmd-wheel-seed', {
      sect: sectRow!,
      balances,
      resourceId: 'spiritStone',
      checkWheelSeed: true,
      now: Date.now(),
    });
    // 同一个快照不要求核对 wheel_seed 时不该多绑参数：把该子句钉在 checkWheelSeed 上。
    const withoutSeed = gamblingSnapshotGuardStatement('cmd-wheel-noseed', {
      sect: sectRow!,
      balances,
      resourceId: 'spiritStone',
      now: Date.now(),
    });
    expect(guard.sql).toContain('wheel_seed = ?');
    expect(withoutSeed.sql).not.toContain('wheel_seed');
    expect((guard.params ?? []).length).toBe((withoutSeed.params ?? []).length + 1);

    // 模拟并发重置：读快照之后 wheel_seed 变了。
    await setWheelSeed(sect.sectId, Number(sectRow!.wheel_seed) + 1);

    await expect(
      env.DB.batch([
        env.DB.prepare(guard.sql).bind(...(guard.params ?? [])),
        env.DB.prepare('UPDATE sects SET debate_count = 9 WHERE id = ?').bind(sect.sectId),
      ]),
    ).rejects.toThrow(/CHECK/i);

    // 整批回滚：同批的计数写回没有生效，守卫行也没留下。
    expect(await debateCounter(sect.sectId)).toEqual({ key: '', count: 0 });
    const guards = await env.DB.prepare(
      'SELECT COUNT(*) AS total FROM mutation_guards WHERE command_id = ?',
    )
      .bind('cmd-wheel-seed')
      .first<{ total: number }>();
    expect(Number(guards!.total)).toBe(0);
  });

  it('0020 迁移：重建后索引仍在、wheel_seed 非负、旧的 1~3 倍率记录照旧可读', async () => {
    const indexes = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'dao_debate_log'",
    ).all<{ name: string }>();
    expect((indexes.results ?? []).map((row) => row.name)).toContain('dao_debate_log_sect_idx');

    const sect = await makeSect('wh-migration');
    const discipleId = sect.discipleIds[0] as string;
    await expect(
      env.DB.prepare('UPDATE sects SET wheel_seed = -1 WHERE id = ?').bind(sect.sectId).run(),
    ).rejects.toThrow(/CHECK/i);

    // 0019 写下的旧记录（倍率 1~3、带弟子、有 jev 胜率）在重建后的表里必须原样读得出来。
    await env.DB.prepare(
      `INSERT INTO dao_debate_log (id, sect_id, disciple_id, disciple_name, bet_mode, multiplier,
         stake_detail, result, reward_detail, win_probability, created_at)
       VALUES (?, ?, ?, '甲', 'preset_spirit_stone', 3,
               '{"resourceId":"spiritStone","amount":"300000"}', 'lose', '{"type":"none"}', 0.42, ?)`,
    )
      .bind(crypto.randomUUID(), sect.sectId, discipleId, Date.now())
      .run();

    const logs = await debateLogs(sect.sectId);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.multiplier).toBe(3);
    expect(logs[0]!.disciple_name).toBe('甲');
    expect(Number(logs[0]!.win_probability)).toBeCloseTo(0.42);
  });
});
