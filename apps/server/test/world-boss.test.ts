import { applyD1Migrations, env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app';
import { SEVERE_INJURY_MS, dateKeyUtc8, dayStartMs } from '../src/modules/game/constants';
import { attackWorldBoss, exchangeBossMerit, getWorldBoss, processWorldBoss } from '../src/modules/game/service';
import { BOSS_XUANTIE_MIN_SHARE } from '../src/modules/game/equipment';
import {
  BOSS_MERIT_RESOURCE_ID,
  WORLD_BOSS_COOLDOWN_MS,
  WORLD_BOSS_INJURY_DURATION_MS,
  WORLD_BOSS_KILL_POOL_RATE_FACTOR,
  WORLD_BOSS_LAST_HIT_RATE_FACTOR,
  WORLD_BOSS_MIN_HP,
  WORLD_BOSS_ROUNDS_PER_STAGE,
  bossIndexFor,
  dayIndexUtc8,
  rankRewardMultiplier,
  rewardFloor,
  stageMaxHp,
  stageRewardMultiplier,
  worldBossMeritFor,
} from '../src/modules/game/worldBoss';

import { dataOf, errorOf, TestClient } from './support/authClient';

/**
 * 世界 Boss 二期（连战 · 随机词缀 · 疲劳/受伤/重伤）：服务层 + D1 的集成测试。
 *
 * 存储说明：本文件一份独立内存 D1，没有逐用例回滚 —— 每个用例用独立账号/宗门，
 * 关卡用**互不相同的 UTC+8 日期**（day_key 唯一）隔离；断言都按宗门 id / day_key 定界。
 *
 * 时间说明：讨伐只在 08:00–23:00 开放。service 的三个入口都显式收 `now`，
 * 用例自己决定「现在是第几天几点」；同时把宗门的 last_settled_at 拨到当天 23:59 之后
 * （结算窗口为 0），资源断言只受被测逻辑影响。
 *
 * 随机说明：伤害浮动 / 暴击 / 受伤 / 重伤都用 Math.random，用例按「取用顺序」注入固定值：
 * 每名弟子先判重伤（1 个随机数），未重伤再判受伤（第 2 个），全部判完才轮到伤害（浮动 + 暴击）。
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
  sectName: string;
  discipleIds: string[];
  state: () => Promise<Record<string, any>>;
}

async function makeSect(prefix: string): Promise<SectFixture> {
  seq += 1;
  const account = `${prefix}-${seq}`;
  const api = new TestClient(app, env, {
    'cf-connecting-ip': `10.5.${Math.floor(seq / 250)}.${seq % 250}`,
  });
  const registered = await api.post('/api/v1/auth/register', { account, password: PASSWORD });
  expect(registered.status).toBe(200);
  const created = await api.post('/api/v1/game/create-sect', { name: `讨伐${seq}号` });
  expect(created.status).toBe(200);
  const state = dataOf(created) as Record<string, any>;
  const sectId = state.state.sect.id as string;

  const row = await env.DB.prepare('SELECT user_id, name FROM sects WHERE id = ?')
    .bind(sectId)
    .first<{ user_id: string; name: string }>();
  expect(row).not.toBeNull();

  return {
    api,
    userId: row!.user_id,
    sectId,
    sectName: row!.name,
    discipleIds: (state.state.disciples as { id: string }[]).map((item) => item.id),
    state: async () => {
      const result = await api.get('/api/v1/game/sync');
      expect(result.status).toBe(200);
      return (dataOf(result) as Record<string, any>).state;
    },
  };
}

/* ---------- 时间与库的直接读写 ---------- */

/** 以「今天的 UTC+8 日期」为第 0 天，取第 dayOffset 天 UTC+8 的 hour:minute。 */
function dayAt(dayOffset: number, hour: number, minute = 30): number {
  const parts = dateKeyUtc8(Date.now()).split('-').map(Number);
  return (
    Date.UTC(parts[0] ?? 1970, (parts[1] ?? 1) - 1, parts[2] ?? 1, hour - 8, minute) +
    dayOffset * DAY_MS
  );
}

/** 把结算时间拨到「第 dayOffset 天 23:59 之后」：用例里任何 now 之间的结算窗口都是 0。 */
async function freezeDay(sectId: string, dayOffset: number): Promise<void> {
  await env.DB.prepare('UPDATE sects SET last_settled_at = ? WHERE id = ?')
    .bind(dayAt(dayOffset, 23, 59) + 60_000, sectId)
    .run();
}

async function balanceOf(sectId: string, resourceId: string): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT balance FROM resource_balances WHERE sect_id = ? AND resource_id = ?',
  )
    .bind(sectId, resourceId)
    .first<{ balance: number }>();
  return Number(row?.balance ?? 0);
}

async function pillCount(sectId: string, pillId: string): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT quantity FROM pill_inventories WHERE sect_id = ? AND pill_id = ?',
  )
    .bind(sectId, pillId)
    .first<{ quantity: number }>();
  return row === null ? 0 : Number(row.quantity);
}

async function ratesOf(fixture: SectFixture): Promise<Record<string, number>> {
  const state = await fixture.state();
  const rates: Record<string, number> = {};
  for (const resource of state.resources as { id: string; ratePerHour: string }[]) {
    rates[resource.id] = Number(resource.ratePerHour);
  }
  return rates;
}

/** 直接造一关（绕开出现逻辑，专测出手 / 连战 / 逃走 / 发奖）。 */
async function insertBoss(input: {
  dayKey: string;
  now: number;
  stage?: number;
  bossIndex?: number;
  affix?: string;
  roundDamage?: number;
  maxHp?: number;
  hp?: number;
  status?: string;
  killerSectId?: string | null;
  halfAnnounced?: number;
  rewardedAt?: number | null;
}): Promise<string> {
  const id = crypto.randomUUID();
  const maxHp = input.maxHp ?? 1_000_000;
  await env.DB.prepare(
    `INSERT INTO world_bosses
       (id, day_key, stage, boss_index, affix, round_damage, max_hp, hp, status,
        killer_sect_id, half_announced, rewarded_at, created_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  )
    .bind(
      id,
      input.dayKey,
      input.stage ?? 1,
      input.bossIndex ?? 0,
      input.affix ?? 'ironclad',
      input.roundDamage ?? 30_000,
      maxHp,
      input.hp ?? maxHp,
      input.status ?? 'active',
      input.killerSectId ?? null,
      input.halfAnnounced ?? 0,
      input.rewardedAt ?? null,
      input.now,
    )
    .run();
  return id;
}

async function bossRow(dayKey: string, stage = 1): Promise<Record<string, any> | null> {
  return env.DB.prepare('SELECT * FROM world_bosses WHERE day_key = ? AND stage = ?')
    .bind(dayKey, stage)
    .first<Record<string, any>>();
}

async function countBossRows(dayKey: string): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS total FROM world_bosses WHERE day_key = ?')
    .bind(dayKey)
    .first<{ total: number }>();
  return Number(row?.total ?? 0);
}

async function hitsOf(bossId: string): Promise<Record<string, any>[]> {
  const result = await env.DB.prepare(
    'SELECT * FROM world_boss_hits WHERE boss_id = ? ORDER BY created_at ASC',
  )
    .bind(bossId)
    .all<Record<string, any>>();
  return result.results ?? [];
}

async function battleRows(sectId: string): Promise<Record<string, any>[]> {
  const result = await env.DB.prepare(
    'SELECT * FROM disciple_boss_battles WHERE sect_id = ? ORDER BY created_at ASC',
  )
    .bind(sectId)
    .all<Record<string, any>>();
  return result.results ?? [];
}

/** 直接塞疲劳记录（用来把「本次是这一小时第几次」推到目标档位）。 */
async function addBattles(sectId: string, discipleId: string, count: number, now: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await env.DB.prepare(
      'INSERT INTO disciple_boss_battles (id, disciple_id, sect_id, created_at) VALUES (?, ?, ?, ?)',
    )
      .bind(crypto.randomUUID(), discipleId, sectId, now - 60_000 * (index + 1))
      .run();
  }
}


async function discipleRow(discipleId: string): Promise<Record<string, any>> {
  const row = await env.DB.prepare('SELECT * FROM disciples WHERE id = ?')
    .bind(discipleId)
    .first<Record<string, any>>();
  expect(row).not.toBeNull();
  return row!;
}

async function systemMessages(): Promise<string[]> {
  const result = await env.DB.prepare(
    "SELECT content FROM chat_messages WHERE user_id = 'system'",
  ).all<{ content: string }>();
  return (result.results ?? []).map((row) => row.content);
}

async function countMessages(predicate: (text: string) => boolean): Promise<number> {
  return (await systemMessages()).filter(predicate).length;
}

/** 断言 Promise 抛出的业务错误（没有抛错时返回 null）。 */
async function errorCodeOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? 'UNKNOWN';
  }
}

async function errorDetailsOf(promise: Promise<unknown>): Promise<Record<string, unknown> | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return (error as { details?: Record<string, unknown> }).details ?? null;
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('世界 Boss 二期：出现（Cron）', () => {
  it('08:00 之前不出现；08:30 的 Cron 建出第 1 关（带词缀）并广播一次', async () => {
    const fixture = await makeSect('spawn');
    await freezeDay(fixture.sectId, 0);
    const dayKey = dateKeyUtc8(dayAt(0, 9));

    await processWorldBoss(env.DB, dayAt(0, 7));
    expect(await bossRow(dayKey, 1)).toBeNull();

    const spawns = await countMessages((text) => text.includes('降临'));
    await processWorldBoss(env.DB, dayAt(0, 8, 30));
    const row = (await bossRow(dayKey, 1))!;
    expect(row.status).toBe('active');
    expect(Number(row.stage)).toBe(1);
    expect(Number(row.boss_index)).toBe(bossIndexFor(dayIndexUtc8(dayAt(0, 8, 30)), 1));
    expect(['ironclad', 'swift', 'brute', 'eerie', 'berserk']).toContain(row.affix as string);
    // 血量 = max(10000, 一轮伤害 × 3)；这个宗门活跃着，所以一轮伤害 > 0
    const roundDamage = Number(row.round_damage);
    expect(roundDamage).toBeGreaterThan(0);
    expect(Number(row.max_hp)).toBe(Math.max(WORLD_BOSS_MIN_HP, roundDamage * WORLD_BOSS_ROUNDS_PER_STAGE));
    expect(Number(row.hp)).toBe(Number(row.max_hp));
    expect(Number(row.half_announced)).toBe(0);
    expect(row.rewarded_at).toBeNull();
    expect(row.ended_at).toBeNull();
    expect(await countMessages((text) => text.includes('降临'))).toBe(spawns + 1);

    // 再跑两次：day_key + stage 唯一 → 不重复建、不重复广播。
    await processWorldBoss(env.DB, dayAt(0, 12));
    await processWorldBoss(env.DB, dayAt(0, 18));
    expect(await countBossRows(dayKey)).toBe(1);
    expect(await countMessages((text) => text.includes('降临'))).toBe(spawns + 1);
  });

  it('补位：最新一关已击杀却没有下一关（如一期旧 Boss，round_damage = 0）→ Cron 生成下一关并重算一轮伤害', async () => {
    const fixture = await makeSect('catchup');
    await freezeDay(fixture.sectId, 60);
    const now = dayAt(60, 10);
    const dayKey = dateKeyUtc8(now);
    await insertBoss({ dayKey, now: dayAt(60, 9), status: 'killed', hp: 0, roundDamage: 0, rewardedAt: dayAt(60, 9) });

    await processWorldBoss(env.DB, now);
    const next = (await bossRow(dayKey, 2))!;
    expect(next.status).toBe('active');
    const roundDamage = Number(next.round_damage);
    expect(roundDamage).toBeGreaterThan(0);
    expect(Number(next.max_hp)).toBe(stageMaxHp(roundDamage, 2));

    // 有进行中的关卡时不再补位
    await processWorldBoss(env.DB, dayAt(60, 11));
    expect(await countBossRows(dayKey)).toBe(2);
  });
});

describe('世界 Boss 二期：面板', () => {
  it('面板给出关卡 / 词缀 / 冷却 / 疲劳 / 连斩数与最高纪录', async () => {
    const fixture = await makeSect('panel');
    const now = dayAt(3, 10);
    await freezeDay(fixture.sectId, 3);
    await insertBoss({
      dayKey: dateKeyUtc8(now),
      now,
      stage: 2,
      bossIndex: 1,
      affix: 'eerie',
      roundDamage: 20_000,
      maxHp: stageMaxHp(20_000, 2),
    });

    const panel = await getWorldBoss(env.DB, fixture.userId, now);
    expect(panel.boss.phase).toBe('open');
    expect(panel.boss.attackable).toBe(true);
    expect(panel.boss.cooldownSeconds).toBe(0);
    expect(panel.boss.fatigue).toEqual({});
    expect(panel.boss.boss).not.toBeNull();
    expect(panel.boss.boss!.stage).toBe(2);
    expect(panel.boss.boss!.def.displayName).toBe('第 2 关 · 赤炎火蛟');
    expect(panel.boss.boss!.affix).toEqual({
      id: 'eerie',
      name: '邪祟',
      effect: '暴击率翻倍',
      tip: '派幸运高的弟子',
      sortAttribute: 'luck',
    });
    expect(panel.boss.boss!.maxHp).toBe(stageMaxHp(20_000, 2));
    expect(panel.boss.ranks).toEqual([]);
    expect(panel.boss.hits).toEqual([]);
    expect(panel.boss.boss!.phase).toBe('open');

    // 三期：功勋兑换价目改由 GET /game/merit-shop 下发（分类 → 标签页）。
    const shopRes = await fixture.api.get('/api/v1/game/merit-shop');
    expect(shopRes.status).toBe(200);
    const shop = (dataOf(shopRes) as { shop: Record<string, any> }).shop;
    expect(shop.categories).toEqual([
      { id: 'resource', name: '资源' },
      { id: 'equipment', name: '装备' },
    ]);
    expect(shop.items.map((item: { id: string }) => item.id)).toEqual(['xuantie', 'spirit', 'treasure', 'immortal']);
    expect(shop.items.map((item: { cost: number }) => item.cost)).toEqual([4, 25, 70, 200]);
    expect(shop.items.map((item: { category: string }) => item.category)).toEqual([
      'resource',
      'equipment',
      'equipment',
      'equipment',
    ]);
    expect(shop.slots.map((slot: { id: string }) => slot.id)).toEqual(['weapon', 'armor', 'artifact']);
    expect(shop.maxResourceQuantity).toBe(100);
    // 本人的掉落概率（还没出手 → 占比 0、高档概率 0）。
    expect(panel.boss.myDrop).toEqual({
      damageShare: 0,
      highChance: 0,
      // 第 2 关：高档灵品、低档凡品。
      highQualityName: '灵品',
      lowQualityName: '凡品',
    });
    expect(panel.boss.rewardPreview!.meritFullShare).toBe(
      worldBossMeritFor({ stage: 2, damageShare: 1, repelled: false }),
    );
    // 新建宗门就带功勋余额（0），但资源栏不展示它。
    const meritResource = panel.state.resources.find(
      (resource) => resource.id === BOSS_MERIT_RESOURCE_ID,
    );
    expect(meritResource?.balance).toBe('0');
    // view 里的角标与面板一致
    expect(panel.state.worldBoss.attackable).toBe(true);

    // 早上没到 08:00：未出现 + 提示 08:00 降临
    const early = await getWorldBoss(env.DB, fixture.userId, dayAt(4, 7));
    expect(early.boss.phase).toBe('before');
    expect(early.boss.attackable).toBe(false);
    expect(early.boss.opensAt).toBe(dayStartMs(dayAt(4, 7)) + 8 * HOUR_MS);

    // 23:00 之后：closed、不能再出手
    const closed = await getWorldBoss(env.DB, fixture.userId, dayAt(3, 23));
    expect(closed.boss.phase).toBe('closed');
    expect(closed.boss.attackable).toBe(false);
    expect(closed.boss.remainingSeconds).toBe(0);
  });

  it('出手入参校验：1~10 名、去重、多余字段一律 400', async () => {
    const fixture = await makeSect('validate');
    const empty = await fixture.api.post('/api/v1/game/world-boss/attack', { discipleIds: [] });
    expect(empty.status).toBe(400);
    expect(errorOf(empty).code).toBe('VALIDATION_ERROR');
    const tooMany = await fixture.api.post('/api/v1/game/world-boss/attack', {
      discipleIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'],
    });
    expect(tooMany.status).toBe(400);
    const strict = await fixture.api.post('/api/v1/game/world-boss/attack', {
      discipleIds: [fixture.discipleIds[0]!],
      extra: 1,
    });
    expect(strict.status).toBe(400);
  });
});

describe('世界 Boss 二期：出手', () => {
  it('出手写出手记录与疲劳记录、扣血，但不再发参与奖', async () => {
    const fixture = await makeSect('attack');
    const now = dayAt(5, 10);
    await freezeDay(fixture.sectId, 5);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const bossId = await insertBoss({ dayKey: dateKeyUtc8(now), now, affix: 'ironclad' });
    const member = fixture.discipleIds[0]!;
    const stoneBefore = await balanceOf(fixture.sectId, 'spiritStone');

    const result = await attackWorldBoss(env.DB, fixture.userId, { discipleIds: [member] }, now);
    expect(result.result.crit).toBe(false);
    expect(result.result.frenzy).toBe(false);
    expect(result.result.damage).toBeGreaterThan(0);
    expect(result.result.actualDamage).toBe(result.result.damage);
    expect(result.result.lastHit).toBe(false);
    expect(result.result.nextStage).toBeNull();
    expect(result.result.members).toEqual([
      { discipleId: member, discipleName: expect.any(String), outcome: 'normal' },
    ]);

    const row = (await bossRow(dateKeyUtc8(now), 1))!;
    expect(Number(row.hp)).toBe(1_000_000 - result.result.damage);

    const hits = await hitsOf(bossId);
    expect(hits).toHaveLength(1);
    expect(JSON.parse(hits[0]!.disciple_ids as string)).toEqual([member]);
    expect(JSON.parse(hits[0]!.injured_names as string)).toEqual([]);
    expect(JSON.parse(hits[0]!.severe_names as string)).toEqual([]);
    expect(Number(hits[0]!.damage)).toBe(result.result.damage);

    // 疲劳记录：本次出战的每名弟子各一行。
    expect((await battleRows(fixture.sectId)).length).toBe(1);

    // 二期取消参与奖：资源余额一分没动。
    expect(await balanceOf(fixture.sectId, 'spiritStone')).toBe(stoneBefore);

    // 面板：疲劳表、冷却、榜单
    expect(result.boss.fatigue[member]).toBe(1);
    expect(result.boss.cooldownSeconds).toBeGreaterThan(0);
    expect(result.boss.ranks).toHaveLength(1);
    expect(result.boss.ranks[0]!.isMe).toBe(true);
    expect(result.boss.hits).toHaveLength(1);
  });

  it('冷却 3 秒：拒绝时给出剩余秒数，过了就能再打', async () => {
    const fixture = await makeSect('cooldown');
    const now = dayAt(6, 10);
    await freezeDay(fixture.sectId, 6);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    await insertBoss({ dayKey: dateKeyUtc8(now), now });
    const discipleIds = [fixture.discipleIds[0]!];
    await attackWorldBoss(env.DB, fixture.userId, { discipleIds }, now);

    const details = await errorDetailsOf(
      attackWorldBoss(env.DB, fixture.userId, { discipleIds }, now + 1_000),
    );
    expect(details).not.toBeNull();
    expect(Number(details!.remainingSeconds)).toBe(2);
    expect(
      await errorCodeOf(attackWorldBoss(env.DB, fixture.userId, { discipleIds }, now + 1_000)),
    ).toBe('COOLDOWN_ACTIVE');

    // 冷却结束后照常出手
    const ok = await attackWorldBoss(
      env.DB,
      fixture.userId,
      { discipleIds },
      now + WORLD_BOSS_COOLDOWN_MS,
    );
    expect(ok.result.damage).toBeGreaterThan(0);
    expect(ok.boss.hits).toHaveLength(2);
    expect(ok.boss.fatigue[discipleIds[0]!]).toBe(2);
  });

  it('每日出手上限：用满后拒绝（DAILY_LIMIT），面板显示已用次数且不可出手；0 = 不限', async () => {
    const fixture = await makeSect('daily-limit');
    const now = dayAt(24, 10);
    await freezeDay(fixture.sectId, 24);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    await insertBoss({ dayKey: dateKeyUtc8(now), now, maxHp: 100_000_000 });
    const discipleIds = [fixture.discipleIds[0]!];

    // 上限 2：前两刀照常，第三刀（冷却已过）被拒
    await attackWorldBoss(env.DB, fixture.userId, { discipleIds }, now, 2);
    const second = await attackWorldBoss(
      env.DB,
      fixture.userId,
      { discipleIds },
      now + WORLD_BOSS_COOLDOWN_MS,
      2,
    );
    expect(second.boss.attacksToday).toBe(2);
    expect(second.boss.dailyAttackLimit).toBe(2);
    expect(second.boss.attackable).toBe(false);

    const later = now + WORLD_BOSS_COOLDOWN_MS * 2;
    expect(
      await errorCodeOf(attackWorldBoss(env.DB, fixture.userId, { discipleIds }, later, 2)),
    ).toBe('DAILY_LIMIT');
    expect(await errorDetailsOf(attackWorldBoss(env.DB, fixture.userId, { discipleIds }, later, 2))).toEqual({
      attacksToday: 2,
      dailyAttackLimit: 2,
    });
    const panel = await getWorldBoss(env.DB, fixture.userId, later, 2);
    expect(panel.boss.attacksToday).toBe(2);
    expect(panel.boss.attackable).toBe(false);

    // 上限调高或设为 0（不限）后立刻能继续打
    const unlimited = await attackWorldBoss(env.DB, fixture.userId, { discipleIds }, later, 0);
    expect(unlimited.boss.attacksToday).toBe(3);
    expect(unlimited.boss.dailyAttackLimit).toBe(0);
    expect(unlimited.boss.attackable).toBe(true);
  });

  it('疲劳 3 次起会重伤：这一刀不计伤害、写库、广播、之后不能再出战', async () => {
    const fixture = await makeSect('severe');
    const now = dayAt(7, 10);
    await freezeDay(fixture.sectId, 7);
    const member = fixture.discipleIds[0]!;
    await insertBoss({ dayKey: dateKeyUtc8(now), now });
    // 这一小时已经出战 3 次 → 本次的重伤概率 30%
    await addBattles(fixture.sectId, member, 3, now);
    // 第 1 个随机数给重伤判定（0.01 < 0.3 → 重伤），之后给伤害的浮动与暴击
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const before = await countMessages((text) => text.includes('重创'));
    const result = await attackWorldBoss(env.DB, fixture.userId, { discipleIds: [member] }, now);
    expect(result.result.members).toEqual([
      { discipleId: member, discipleName: expect.any(String), outcome: 'severe' },
    ]);
    // 全员重伤 → 伤害 0，但记录照写
    expect(result.result.damage).toBe(0);
    expect(result.result.actualDamage).toBe(0);
    expect((await bossRow(dateKeyUtc8(now), 1))!.hp).toBe(1_000_000);

    const row = await discipleRow(member);
    expect(Number(row.severe_injured_until)).toBeGreaterThanOrEqual(now + SEVERE_INJURY_MS - 1000);
    const hits = await hitsOf((await bossRow(dateKeyUtc8(now), 1))!.id as string);
    expect(JSON.parse(hits[0]!.severe_names as string)).toHaveLength(1);
    expect(await countMessages((text) => text.includes('重创'))).toBe(before + 1);
    expect(result.boss.fatigue[member]).toBe(4);

    // 重伤之后不能再出战（走的是阶段一的统一拦截）
    expect(
      await errorCodeOf(
        attackWorldBoss(env.DB, fixture.userId, { discipleIds: [member] }, now + 60_000),
      ),
    ).toBe('INVALID_STATUS');
  });

  it('普通受伤写 injured_until（30 分钟），伤害照常计算', async () => {
    const fixture = await makeSect('injured');
    const now = dayAt(8, 10);
    await freezeDay(fixture.sectId, 8);
    const member = fixture.discipleIds[0]!;
    await insertBoss({ dayKey: dateKeyUtc8(now), now });
    // 第 1 个随机数给重伤（疲劳 0 → 概率 0，不会重伤），第 2 个给受伤（0.01 < 3% → 受伤）
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const result = await attackWorldBoss(env.DB, fixture.userId, { discipleIds: [member] }, now);
    expect(result.result.members[0]!.outcome).toBe('injured');
    expect(result.result.damage).toBeGreaterThan(0);
    const row = await discipleRow(member);
    expect(Number(row.injured_until)).toBeGreaterThanOrEqual(now + WORLD_BOSS_INJURY_DURATION_MS - 1000);
    expect(Number(row.severe_injured_until) || 0).toBe(0);
  });

  it('「狂暴」让重伤概率翻倍：同样的随机数在铁甲下不算重伤', async () => {
    const berserkFixture = await makeSect('berserk');
    const ironcladFixture = await makeSect('ironclad');
    const berserkNow = dayAt(9, 10);
    const ironcladNow = dayAt(12, 10);
    await freezeDay(berserkFixture.sectId, 9);
    await freezeDay(ironcladFixture.sectId, 12);
    const berserkMember = berserkFixture.discipleIds[0]!;
    const ironcladMember = ironcladFixture.discipleIds[0]!;
    // 两个宗门各自打自己那一天的关卡（day_key + stage 唯一，不能共用同一天）。
    await insertBoss({ dayKey: dateKeyUtc8(berserkNow), now: berserkNow, affix: 'berserk' });
    await insertBoss({ dayKey: dateKeyUtc8(ironcladNow), now: ironcladNow, affix: 'ironclad' });
    await addBattles(berserkFixture.sectId, berserkMember, 3, berserkNow);
    await addBattles(ironcladFixture.sectId, ironcladMember, 3, ironcladNow);
    // 体魄固定在 50：狂暴档 30% × 2 = 60%，铁甲档只有 30%（弟子体魄是随机的，必须钉住）。
    await env.DB.prepare('UPDATE disciples SET physique = 50 WHERE id = ?').bind(berserkMember).run();
    await env.DB.prepare('UPDATE disciples SET physique = 50 WHERE id = ?').bind(ironcladMember).run();

    // 0.5 < 0.6（狂暴 30%×2）→ 重伤
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const berserkResult = await attackWorldBoss(
      env.DB,
      berserkFixture.userId,
      { discipleIds: [berserkMember] },
      berserkNow,
    );
    expect(berserkResult.result.members[0]!.outcome).toBe('severe');

    // 同样的 0.5，铁甲档只有 30% → 不重伤
    vi.restoreAllMocks();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const ironcladResult = await attackWorldBoss(
      env.DB,
      ironcladFixture.userId,
      { discipleIds: [ironcladMember] },
      ironcladNow,
    );
    expect(ironcladResult.result.members[0]!.outcome).toBe('normal');
  });
});

describe('世界 Boss 二期：连战', () => {
  it('打死立刻开下一关（血量 ×1.6、换 Boss 与词缀），且不会重复生成', async () => {
    const fixture = await makeSect('chain');
    const now = dayAt(10, 10);
    await freezeDay(fixture.sectId, 10);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const dayKey = dateKeyUtc8(now);
    await insertBoss({ dayKey, now, stage: 1, hp: 100, maxHp: 1_000_000, roundDamage: 20_000 });
    const before = await countMessages((text) => text.includes('一击斩落'));

    const result = await attackWorldBoss(
      env.DB,
      fixture.userId,
      { discipleIds: [fixture.discipleIds[0]!] },
      now,
    );
    expect(result.result.lastHit).toBe(true);
    expect(result.result.nextStage).toBe(2);
    expect(result.result.bossHp).toBe(0);

    // 第 2 关：换 Boss、换词缀、血量 = 一轮伤害 × 6
    const stage2 = (await bossRow(dayKey, 2))!;
    expect(stage2.status).toBe('active');
    expect(Number(stage2.max_hp)).toBe(stageMaxHp(20_000, 2));
    expect(Number(stage2.boss_index)).toBe(bossIndexFor(dayIndexUtc8(now), 2));
    expect(Number(stage2.round_damage)).toBe(20_000);
    // 面板直接切到新关卡
    expect(result.boss.boss!.stage).toBe(2);
    expect(result.boss.boss!.status).toBe('active');
    expect(result.boss.killedToday).toBe(1);
    expect(result.boss.bestStage).toBe(1);

    // 广播：击杀 + 下一关降临
    expect(await countMessages((text) => text.includes('一击斩落'))).toBe(before + 1);
    expect(await countMessages((text) => text.includes('已降临'))).toBe(1);

    // Cron 不会重复建：今天已经有第 1 关，也有第 2 关
    await processWorldBoss(env.DB, dayAt(10, 12));
    expect(await countBossRows(dayKey)).toBe(2);
  });

  it('22:30 力竭期打死仍然会立刻开下一关（伤害 ×1.5）', async () => {
    const fixture = await makeSect('chain-late');
    const now = dayAt(11, 22, 30);
    await freezeDay(fixture.sectId, 11);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const dayKey = dateKeyUtc8(now);
    await insertBoss({ dayKey, now, stage: 1, hp: 100, maxHp: 1_000_000, roundDamage: 20_000 });

    const result = await attackWorldBoss(
      env.DB,
      fixture.userId,
      { discipleIds: [fixture.discipleIds[0]!] },
      now,
    );
    expect(result.result.frenzy).toBe(true);
    expect(result.result.lastHit).toBe(true);
    expect(result.result.nextStage).toBe(2);
    expect((await bossRow(dayKey, 2))!.status).toBe('active');
  });
});

describe('世界 Boss 二期：Cron 逃走与发奖', () => {
  it('击杀发奖：基础份 × 关卡系数 × 排名倍数 + 丹药 + 最后一击，且只发一次', async () => {
    const fixture = await makeSect('reward');
    const now = dayAt(20, 10);
    await freezeDay(fixture.sectId, 20);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const dayKey = dateKeyUtc8(now);
    const rates = await ratesOf(fixture);

    await insertBoss({ dayKey, now, stage: 2, hp: 100, maxHp: 1_000_000, roundDamage: 20_000 });
    const killed = await attackWorldBoss(
      env.DB,
      fixture.userId,
      { discipleIds: [fixture.discipleIds[0]!] },
      now,
    );
    expect(killed.result.lastHit).toBe(true);
    // 连战会顺手开出第 3 关，把它挪走以免干扰发奖断言
    await env.DB.prepare('DELETE FROM world_bosses WHERE day_key = ? AND stage = 3')
      .bind(dayKey)
      .run();

    const before = {
      spiritStone: await balanceOf(fixture.sectId, 'spiritStone'),
      herb: await balanceOf(fixture.sectId, 'herb'),
      ore: await balanceOf(fixture.sectId, 'ore'),
      bossMerit: await balanceOf(fixture.sectId, BOSS_MERIT_RESOURCE_ID),
      cultivationPill: await pillCount(fixture.sectId, 'cultivationPill'),
      bodyTemperingPill: await pillCount(fixture.sectId, 'bodyTemperingPill'),
    };

    const rewardNotices = await countMessages((text) => text.includes('讨伐奖励已发放'));
    await processWorldBoss(env.DB, dayAt(20, 14));
    const noticesAfterReward = await countMessages((text) => text.includes('讨伐奖励已发放'));
    expect(noticesAfterReward).toBeGreaterThan(rewardNotices);

    // 讨伐奖励记录：该宗门天机录里有一条，写明名次，资源增减与实际入账一致。
    const rewardLogs = await env.DB.prepare("SELECT description, effects FROM event_log WHERE sect_id = ? AND event_id = 'worldBossReward'")
      .bind(fixture.sectId)
      .all<{ description: string; effects: string }>();
    expect(rewardLogs.results).toHaveLength(1);
    expect(rewardLogs.results[0]!.description).toContain('伤害第 1 名');
    expect(rewardLogs.results[0]!.description).toContain('聚气丹');
    expect(Number(JSON.parse(rewardLogs.results[0]!.effects).spiritStone)).toBeGreaterThan(0);
    // 三期：第 2 关、单宗门（占比 100%）→ 功勋 = max(2, round(10 × 1.5 × 1)) = 15 展示单位 = 15000 最小单位。
    expect(JSON.parse(rewardLogs.results[0]!.effects).bossMerit).toBe('15000');

    // 只有一个参与宗门 → 排名 1（×1.5），第 2 关（×1.2）：factor = 1.8
    const factor = stageRewardMultiplier(2) * rankRewardMultiplier(1);
    const share = (rate: number): number =>
      Math.floor(Math.max(rate * WORLD_BOSS_KILL_POOL_RATE_FACTOR, rewardFloor(1)) * factor);
    const lastHit = Math.floor(
      Math.max((rates.spiritStone ?? 0) * WORLD_BOSS_LAST_HIT_RATE_FACTOR, rewardFloor(1)) * stageRewardMultiplier(2),
    );

    expect((await balanceOf(fixture.sectId, 'spiritStone')) - before.spiritStone).toBe(
      share(rates.spiritStone ?? 0) + lastHit,
    );
    expect((await balanceOf(fixture.sectId, 'herb')) - before.herb).toBe(share(rates.herb ?? 0));
    expect((await balanceOf(fixture.sectId, 'ore')) - before.ore).toBe(share(rates.ore ?? 0));
    expect((await pillCount(fixture.sectId, 'cultivationPill')) - before.cultivationPill).toBe(1);
    expect((await pillCount(fixture.sectId, 'bodyTemperingPill')) - before.bodyTemperingPill).toBe(1);
    expect((await balanceOf(fixture.sectId, BOSS_MERIT_RESOURCE_ID)) - before.bossMerit).toBe(15_000);
    expect((await bossRow(dayKey, 2))!.rewarded_at).not.toBeNull();

    // 再跑两次 Cron：rewarded_at 已写 → 不再发
    await processWorldBoss(env.DB, dayAt(20, 15));
    await processWorldBoss(env.DB, dayAt(20, 16));
    expect(await countMessages((text) => text.includes('讨伐奖励已发放'))).toBe(noticesAfterReward);
    const rewardLogsAgain = await env.DB.prepare("SELECT COUNT(*) AS n FROM event_log WHERE sect_id = ? AND event_id = 'worldBossReward'")
      .bind(fixture.sectId)
      .first<{ n: number }>();
    expect(Number(rewardLogsAgain?.n)).toBe(1);
    expect(await pillCount(fixture.sectId, 'cultivationPill')).toBe(before.cultivationPill + 1);
    expect(await balanceOf(fixture.sectId, 'herb')).toBe(before.herb + share(rates.herb ?? 0));
    expect(await balanceOf(fixture.sectId, BOSS_MERIT_RESOURCE_ID)).toBe(before.bossMerit + 15_000);
  });

  it('奖励入账不超过资源容量：溢出作废并记进天机录；本来就超容量的不往下压', async () => {
    const fixture = await makeSect('reward-cap');
    const now = dayAt(90, 10);
    await freezeDay(fixture.sectId, 90);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const dayKey = dateKeyUtc8(now);

    await insertBoss({ dayKey, now, stage: 1, hp: 100, maxHp: 1_000_000, roundDamage: 20_000 });
    await attackWorldBoss(env.DB, fixture.userId, { discipleIds: [fixture.discipleIds[0]!] }, now);
    await env.DB.prepare('DELETE FROM world_bosses WHERE day_key = ? AND stage = 2').bind(dayKey).run();

    // 1 级宗门容量：灵石 5000000、药材 2000000（配置值 × 等级倍率 1）。
    // 灵石只差 1000 就满；药材本来就顶过了容量（探索奖励允许）。
    const setBalance = (resourceId: string, balance: number) =>
      env.DB.prepare('UPDATE resource_balances SET balance = ? WHERE sect_id = ? AND resource_id = ?')
        .bind(balance, fixture.sectId, resourceId)
        .run();
    await setBalance('spiritStone', 4_999_000);
    await setBalance('herb', 2_500_000);

    await processWorldBoss(env.DB, dayAt(90, 14));

    expect(await balanceOf(fixture.sectId, 'spiritStone')).toBe(5_000_000);
    expect(await balanceOf(fixture.sectId, 'herb')).toBe(2_500_000);
    const log = await env.DB.prepare(
      "SELECT description, effects FROM event_log WHERE sect_id = ? AND event_id = 'worldBossReward'",
    )
      .bind(fixture.sectId)
      .first<{ description: string; effects: string }>();
    expect(log!.description).toContain('仓库已满，溢出');
    expect(log!.description).toContain('灵石');
    expect(log!.description).toContain('药材');
    // 天机录只记实际入账：灵石只进了 1000，药材一分没进。
    const effects = JSON.parse(log!.effects) as Record<string, string>;
    expect(effects.spiritStone).toBe('1000');
    expect(effects.herb).toBeUndefined();
  });

  it('排名倍数按「对该关的总伤害」分配：伤害高的拿 ×1.5', async () => {
    const first = await makeSect('rank-a');
    const second = await makeSect('rank-b');
    const now = dayAt(30, 10);
    await freezeDay(first.sectId, 30);
    await freezeDay(second.sectId, 30);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const dayKey = dateKeyUtc8(now);
    const ratesA = await ratesOf(first);
    const ratesB = await ratesOf(second);

    // 两个宗门打同一关：A 派 1 人、B 派 3 人。把血量压到「A 打完之后只剩 1 点」，
    // B 的那一刀必定打死，而且 B 的总伤害（= A 的伤害 + 1）一定高于 A → B 排名第 1。
    const bossId = await insertBoss({ dayKey, now, maxHp: 10_000_000, roundDamage: 20_000 });
    const firstHit = await attackWorldBoss(
      env.DB,
      first.userId,
      { discipleIds: [first.discipleIds[0]!] },
      now,
    );
    await env.DB.prepare('UPDATE world_bosses SET hp = ? WHERE id = ?')
      .bind(firstHit.result.actualDamage + 1, bossId)
      .run();
    const killing = await attackWorldBoss(
      env.DB,
      second.userId,
      { discipleIds: second.discipleIds.slice(0, 3) },
      now,
    );
    expect(killing.result.lastHit).toBe(true);

    const beforeA = {
      spiritStone: await balanceOf(first.sectId, 'spiritStone'),
      herb: await balanceOf(first.sectId, 'herb'),
    };
    const beforeB = {
      spiritStone: await balanceOf(second.sectId, 'spiritStone'),
      herb: await balanceOf(second.sectId, 'herb'),
    };

    // 连战会开出第 2 关，删掉它以免 Cron 把它一起处理
    await env.DB.prepare('DELETE FROM world_bosses WHERE day_key = ? AND stage = 2')
      .bind(dayKey)
      .run();
    await processWorldBoss(env.DB, dayAt(30, 14));

    const factorA = stageRewardMultiplier(1) * rankRewardMultiplier(2);
    const factorB = stageRewardMultiplier(1) * rankRewardMultiplier(1);
    const shareOf = (rate: number, factor: number): number =>
      Math.floor(Math.max(rate * WORLD_BOSS_KILL_POOL_RATE_FACTOR, rewardFloor(1)) * factor);

    expect((await balanceOf(first.sectId, 'herb')) - beforeA.herb).toBe(
      shareOf(ratesA.herb ?? 0, factorA),
    );
    expect((await balanceOf(second.sectId, 'herb')) - beforeB.herb).toBe(
      shareOf(ratesB.herb ?? 0, factorB),
    );
    // 只有伤害第 1 名的 B 拿淬体丹；聚气丹两个宗门各一颗
    expect(await pillCount(first.sectId, 'cultivationPill')).toBe(1);
    expect(await pillCount(second.sectId, 'cultivationPill')).toBe(1);
    expect(await pillCount(first.sectId, 'bodyTemperingPill')).toBe(0);
    expect(await pillCount(second.sectId, 'bodyTemperingPill')).toBe(1);
    // 最后一击奖只给最后一击的宗门（B），灵石会比 A 多出这一份
    const lastHit = Math.floor(
      Math.max((ratesB.spiritStone ?? 0) * WORLD_BOSS_LAST_HIT_RATE_FACTOR, rewardFloor(1)) * stageRewardMultiplier(1),
    );
    expect((await balanceOf(second.sectId, 'spiritStone')) - beforeB.spiritStone).toBe(
      shareOf(ratesB.spiritStone ?? 0, factorB) + lastHit,
    );
    expect((await balanceOf(first.sectId, 'spiritStone')) - beforeA.spiritStone).toBe(
      shareOf(ratesA.spiritStone ?? 0, factorA),
    );
  });

  it('击退（≥70%）资源减半、没有丹药与最后一击', async () => {
    const fixture = await makeSect('repel');
    const now = dayAt(40, 10);
    await freezeDay(fixture.sectId, 40);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const dayKey = dateKeyUtc8(now);
    const rates = await ratesOf(fixture);

    const bossId = await insertBoss({ dayKey, now, maxHp: 1_000_000, roundDamage: 20_000 });
    await attackWorldBoss(env.DB, fixture.userId, { discipleIds: [fixture.discipleIds[0]!] }, now);
    // 模拟「打到剩 20%」再等到 23:00
    await env.DB.prepare('UPDATE world_bosses SET hp = 200000 WHERE id = ?').bind(bossId).run();

    const before = {
      spiritStone: await balanceOf(fixture.sectId, 'spiritStone'),
      herb: await balanceOf(fixture.sectId, 'herb'),
      cultivationPill: await pillCount(fixture.sectId, 'cultivationPill'),
      bodyTemperingPill: await pillCount(fixture.sectId, 'bodyTemperingPill'),
      bossMerit: await balanceOf(fixture.sectId, BOSS_MERIT_RESOURCE_ID),
    };

    await processWorldBoss(env.DB, dayAt(40, 23));
    const row = (await bossRow(dayKey, 1))!;
    expect(row.status).toBe('fled');
    expect(row.rewarded_at).not.toBeNull();

    const panel = await getWorldBoss(env.DB, fixture.userId, dayAt(40, 23));
    expect(panel.boss.boss!.fledOutcome).toBe('repelled');

    const halved = (rate: number): number =>
      Math.floor(
        Math.max(rate * WORLD_BOSS_KILL_POOL_RATE_FACTOR, rewardFloor(1)) *
          stageRewardMultiplier(1) *
          rankRewardMultiplier(1) *
          0.5,
      );
    expect((await balanceOf(fixture.sectId, 'herb')) - before.herb).toBe(halved(rates.herb ?? 0));
    expect((await balanceOf(fixture.sectId, 'spiritStone')) - before.spiritStone).toBe(
      halved(rates.spiritStone ?? 0),
    );
    expect(await pillCount(fixture.sectId, 'cultivationPill')).toBe(before.cultivationPill);
    expect(await pillCount(fixture.sectId, 'bodyTemperingPill')).toBe(before.bodyTemperingPill);
    // 三期：击退也发功勋，但减半（第 1 关、占比 100% → base 10 → 5 展示单位 = 5000 最小单位）。
    expect((await balanceOf(fixture.sectId, BOSS_MERIT_RESOURCE_ID)) - before.bossMerit).toBe(5_000);
  });

  it('不足 70% 逃走：什么也不发', async () => {
    const fixture = await makeSect('escape');
    const now = dayAt(41, 10);
    await freezeDay(fixture.sectId, 41);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const dayKey = dateKeyUtc8(now);

    await insertBoss({ dayKey, now, maxHp: 1_000_000, roundDamage: 20_000 });
    await attackWorldBoss(env.DB, fixture.userId, { discipleIds: [fixture.discipleIds[0]!] }, now);

    const before = {
      spiritStone: await balanceOf(fixture.sectId, 'spiritStone'),
      herb: await balanceOf(fixture.sectId, 'herb'),
      cultivationPill: await pillCount(fixture.sectId, 'cultivationPill'),
      bossMerit: await balanceOf(fixture.sectId, BOSS_MERIT_RESOURCE_ID),
    };
    await processWorldBoss(env.DB, dayAt(41, 23));
    const row = (await bossRow(dayKey, 1))!;
    expect(row.status).toBe('fled');
    expect(row.rewarded_at).not.toBeNull();
    expect(Number(row.hp)).toBeGreaterThan(Number(row.max_hp) * 0.3);

    expect(await balanceOf(fixture.sectId, 'spiritStone')).toBe(before.spiritStone);
    expect(await balanceOf(fixture.sectId, 'herb')).toBe(before.herb);
    expect(await pillCount(fixture.sectId, 'cultivationPill')).toBe(before.cultivationPill);
    // 三期：单纯逃走（<70%）不发功勋。
    expect(await balanceOf(fixture.sectId, BOSS_MERIT_RESOURCE_ID)).toBe(before.bossMerit);
  });

  it('占比不足 15% 的参与者每关也能得 1 个玄铁（击杀）', async () => {
    const small = await makeSect('xuantie-small');
    const big = await makeSect('xuantie-big');
    const now = dayAt(59, 9);
    await freezeDay(small.sectId, 59);
    await freezeDay(big.sectId, 59);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const dayKey = dateKeyUtc8(now);

    // 血量给足：小宗门 1 人打 1 次、大宗门 3 人打 8 次。
    // 出手间隔 > 1 小时 → 每名弟子的疲劳都回到 1，不会触发重伤（重伤会让这一刀不计伤害）。
    const bossId = await insertBoss({ dayKey, now, maxHp: 10_000_000_000, roundDamage: 20_000 });
    await attackWorldBoss(env.DB, small.userId, { discipleIds: [small.discipleIds[0]!] }, now);
    for (let hour = 0; hour < 8; hour += 1) {
      await attackWorldBoss(
        env.DB,
        big.userId,
        { discipleIds: big.discipleIds },
        dayAt(59, 10 + hour, 1 + hour),
      );
    }
    // 最后一刀：把血量压到 1，让大宗门击杀。
    await env.DB.prepare('UPDATE world_bosses SET hp = 1 WHERE id = ?').bind(bossId).run();
    await attackWorldBoss(env.DB, big.userId, { discipleIds: big.discipleIds }, dayAt(59, 19, 10));

    // 占比按 world_boss_hits 里的实际伤害算出来，不猜。
    const hits = await hitsOf(bossId);
    const totalDamage = hits.reduce((sum, hit) => sum + Number(hit.damage), 0);
    const smallDamage = hits
      .filter((hit) => hit.sect_id === small.sectId)
      .reduce((sum, hit) => sum + Number(hit.damage), 0);
    const smallShare = smallDamage / totalDamage;
    expect(smallShare).toBeGreaterThan(0);
    expect(smallShare).toBeLessThan(BOSS_XUANTIE_MIN_SHARE);

    const beforeSmall = await balanceOf(small.sectId, 'xuantie');
    const beforeBig = await balanceOf(big.sectId, 'xuantie');
    await processWorldBoss(env.DB, dayAt(59, 20));

    // 小宗门：占比不足 15% → 三期新规则每关 1 个（展示单位 1 = 1000 最小单位）。
    expect((await balanceOf(small.sectId, 'xuantie')) - beforeSmall).toBe(1_000);
    // 大宗门：占比 ≥15% 且伤害第 1 → 第 1 关按表取 top = 3 个 = 3000 最小单位。
    expect((await balanceOf(big.sectId, 'xuantie')) - beforeBig).toBe(3_000);
  });

  it('Cron 顺带清理 2 天前的疲劳记录', async () => {
    const fixture = await makeSect('cleanup');
    const now = dayAt(50, 10, 0); // 清理只在每小时第一个 10 分钟 tick 执行
    await freezeDay(fixture.sectId, 50);
    const member = fixture.discipleIds[0]!;

    await env.DB.prepare(
      'INSERT INTO disciple_boss_battles (id, disciple_id, sect_id, created_at) VALUES (?, ?, ?, ?)',
    )
      .bind(crypto.randomUUID(), member, fixture.sectId, now - 3 * DAY_MS)
      .run();
    await addBattles(fixture.sectId, member, 1, now);
    expect((await battleRows(fixture.sectId)).length).toBe(2);

    await processWorldBoss(env.DB, now);
    const left = await battleRows(fixture.sectId);
    expect(left).toHaveLength(1);
    expect(Number(left[0]!.created_at)).toBeGreaterThan(now - 2 * DAY_MS);
  });
});

/* ---------- 三期：功勋兑换的夹具 ---------- */

/** 直接写功勋余额（兑换用例只需要余额，不必真的打 Boss）。 */
async function setMerit(sectId: string, balance: number): Promise<void> {
  const updated = await env.DB.prepare(
    'UPDATE resource_balances SET balance = ?, remainder = 0 WHERE sect_id = ? AND resource_id = ?',
  )
    .bind(balance, sectId, BOSS_MERIT_RESOURCE_ID)
    .run();
  expect(Number(updated.meta.changes)).toBe(1);
}

interface EquipmentRowFixture {
  id: string;
  disciple_id: string | null;
  slot: string;
  quality: string;
  name: string;
  source: string;
}

async function equipmentRows(sectId: string): Promise<EquipmentRowFixture[]> {
  const result = await env.DB.prepare(
    `SELECT id, disciple_id, slot, quality, name, source
       FROM equipment WHERE sect_id = ? ORDER BY created_at DESC, id DESC`,
  )
    .bind(sectId)
    .all<EquipmentRowFixture>();
  return result.results ?? [];
}

/** 直接塞未穿戴装备（把背包填满；背包 = disciple_id IS NULL）。 */
async function fillBag(sectId: string, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO equipment
         (id, sect_id, disciple_id, slot, quality, name, main_attr, main_value,
          sub_attr, sub_value, source, created_at)
       VALUES (?, ?, NULL, 'weapon', 'common', ?, 'attack', 4, 'speed', 1, 'boss', ?)`,
    )
      .bind(id, sectId, `测试·${id.slice(0, 8)}`, Date.now())
      .run();
  }
}

describe('世界 Boss 三期：功勋兑换（计划 2.4）', () => {
  it('功勋不足：INSUFFICIENT_RESOURCE，什么都不扣', async () => {
    const fixture = await makeSect('merit-poor');
    const now = dayAt(70, 12, 0);
    await freezeDay(fixture.sectId, 70);
    await setMerit(fixture.sectId, 0);

    expect(
      await errorCodeOf(
        exchangeBossMerit(env.DB, fixture.userId, { itemId: 'xuantie', quantity: 1 }, now),
      ),
    ).toBe('INSUFFICIENT_RESOURCE');
    expect(await balanceOf(fixture.sectId, BOSS_MERIT_RESOURCE_ID)).toBe(0);
    expect(await balanceOf(fixture.sectId, 'xuantie')).toBe(0);
  });

  it('玄铁 ×3：功勋 −12000、玄铁 +3000（价目 4 个功勋 / 个）', async () => {
    const fixture = await makeSect('merit-xuantie');
    const now = dayAt(71, 12, 0);
    await freezeDay(fixture.sectId, 71);
    await setMerit(fixture.sectId, 100_000);

    const result = await exchangeBossMerit(
      env.DB,
      fixture.userId,
      { itemId: 'xuantie', quantity: 3 },
      now,
    );
    expect(result.outcome).toEqual({
      itemId: 'xuantie',
      cost: 12_000,
      xuantie: 3_000,
      equipment: null,
    });
    expect(await balanceOf(fixture.sectId, BOSS_MERIT_RESOURCE_ID)).toBe(88_000);
    expect(await balanceOf(fixture.sectId, 'xuantie')).toBe(3_000);
    // 随命令返回的 state 立刻就是新余额（不用等下一次 sync）。
    const merit = result.state.resources.find((resource) => resource.id === BOSS_MERIT_RESOURCE_ID);
    expect(merit?.balance).toBe('88000');
  });

  it('灵品兵器：功勋 −25000，装备进背包（source = boss、未穿戴）', async () => {
    const fixture = await makeSect('merit-weapon');
    const now = dayAt(72, 12, 0);
    await freezeDay(fixture.sectId, 72);
    await setMerit(fixture.sectId, 100_000);

    const result = await exchangeBossMerit(
      env.DB,
      fixture.userId,
      { itemId: 'spirit', slot: 'weapon' },
      now,
    );
    expect(result.outcome.cost).toBe(25_000);
    expect(result.outcome.xuantie).toBe(0);
    expect(result.outcome.equipment).toMatchObject({
      slot: 'weapon',
      slotName: '兵器',
      quality: 'spirit',
    });
    expect(await balanceOf(fixture.sectId, BOSS_MERIT_RESOURCE_ID)).toBe(75_000);

    const rows = await equipmentRows(fixture.sectId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.quality).toBe('spirit');
    expect(rows[0]!.slot).toBe('weapon');
    expect(rows[0]!.source).toBe('boss');
    expect(rows[0]!.disciple_id).toBeNull();
    expect(rows[0]!.name.startsWith('灵品·')).toBe(true);
  });

  it('法器不带主属性 / 兵器带主属性 / 玄铁带部位 / 装备 quantity 2：一律 VALIDATION_ERROR', async () => {
    const fixture = await makeSect('merit-invalid');
    const now = dayAt(73, 12, 0);
    await freezeDay(fixture.sectId, 73);
    await setMerit(fixture.sectId, 1_000_000);

    const cases = [
      { itemId: 'spirit', slot: 'artifact' },
      { itemId: 'spirit', slot: 'weapon', mainAttr: 'attack' },
      { itemId: 'xuantie', quantity: 1, slot: 'weapon' },
      { itemId: 'spirit', slot: 'weapon', quantity: 2 },
    ];
    for (const input of cases) {
      expect(await errorCodeOf(exchangeBossMerit(env.DB, fixture.userId, input, now))).toBe(
        'VALIDATION_ERROR',
      );
    }
    // 一次都没成功 → 功勋没动、背包里也没有东西。
    expect(await balanceOf(fixture.sectId, BOSS_MERIT_RESOURCE_ID)).toBe(1_000_000);
    expect(await equipmentRows(fixture.sectId)).toHaveLength(0);
  });

  it('背包满（50 件）：INVALID_STATUS，功勋未扣', async () => {
    const fixture = await makeSect('merit-full');
    const now = dayAt(74, 12, 0);
    await freezeDay(fixture.sectId, 74);
    await setMerit(fixture.sectId, 100_000);
    await fillBag(fixture.sectId, 50);

    expect(
      await errorCodeOf(
        exchangeBossMerit(env.DB, fixture.userId, { itemId: 'spirit', slot: 'armor' }, now),
      ),
    ).toBe('INVALID_STATUS');
    expect(await balanceOf(fixture.sectId, BOSS_MERIT_RESOURCE_ID)).toBe(100_000);
    expect(await equipmentRows(fixture.sectId)).toHaveLength(50);
  });

  it('兑得仙品：额外全服广播一条「以功勋兑换」', async () => {
    const fixture = await makeSect('merit-immortal');
    const now = dayAt(75, 12, 0);
    await freezeDay(fixture.sectId, 75);
    await setMerit(fixture.sectId, 300_000);

    const result = await exchangeBossMerit(
      env.DB,
      fixture.userId,
      { itemId: 'immortal', slot: 'artifact', mainAttr: 'luck' },
      now,
    );
    expect(result.outcome.equipment!.quality).toBe('immortal');
    const gains = (await systemMessages()).filter((text) => text.includes('以功勋兑换'));
    expect(gains).toHaveLength(1);
    expect(gains[0]).toContain(fixture.sectName);
    expect(gains[0]).toContain(result.outcome.equipment!.name);
  });

  it('路由层：多余字段 / 未知兑换项一律 400', async () => {
    const fixture = await makeSect('merit-route');
    const extra = await fixture.api.post('/api/v1/game/world-boss/exchange', {
      itemId: 'xuantie',
      extra: 1,
    });
    expect(extra.status).toBe(400);
    expect(errorOf(extra).code).toBe('VALIDATION_ERROR');
    const unknown = await fixture.api.post('/api/v1/game/world-boss/exchange', { itemId: 'xxx' });
    expect(unknown.status).toBe(400);
  });
});
