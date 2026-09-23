import { applyD1Migrations, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { prepareStatements } from '../src/infra/db/repository';
import { attributeScore, generateAttributes, recruitBatchId } from '../src/modules/game/names';
import { findJourneyPlan, journeyInjuryChanceBp } from '../src/modules/game/journey';
import {
  DiscipleRepository,
  ResourceBalanceRepository,
  SectRepository,
  resourceDeltaStatement,
  settlementSnapshotGuardStatements,
} from '../src/modules/game/repository';

import { dataOf, errorOf, TestClient, type ApiResult } from './support/authClient';

/**
 * 弟子属性与综合评分（docs/弟子属性与综合评分开发计划.md 2.1 / 2.2 / 2.3 + 5.2）。
 *
 * 存储说明：本文件一份独立内存 D1，没有逐用例回滚 —— 每个用例用独立账号/宗门
 * （前缀 + 递增序号），涉及计数/余额的断言都按宗门 id 定界；需要「确定性余额」的
 * 用例先把 sects.last_settled_at 拨到未来（durationMs = 0 → 零产出、零事件）。
 *
 * 确定性说明：
 * - 招贤批次用例从预览响应里解析出 batch（`版本:宗门:日期键:招募次数:刷新序号`），
 *   不依赖真实时钟；跨天批次由测试自己用 recruitBatchId 拼一个「昨天」的合法批次；
 * - 历练概率用例把弟子的 luck/physique 用原始 SQL 钉成 1/50/100，再按文档公式在测试内
 *   独立重算（方向下限 + 表格值 + 体魄修正），与预览值逐位比对；
 * - 「不重掷」用例在出发后改写 luck/physique，再对照出发时落库的
 *   extra_harvest / injured / injury_chance_bp，证明到期与领取不重抽。
 *
 * 私密性说明：luck / physique / attributeScore 只进本宗私有 sync、招贤预览与招募回执；
 * 公开档案 / 排行榜 / 战报历史都必须在原始响应文本里搜不到这三个键（哨兵搜索）。
 */

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

const quietLogger = { info: () => {}, warn: () => {}, error: () => {} } as const;
const app = createApp({ logger: quietLogger });
const PASSWORD = 'password-123456';

let seq = 0;

/** 私有字段的三个键（哨兵搜索用，带引号避免命中别的子串）。 */
const PRIVATE_ATTRIBUTE_KEYS = ['"luck"', '"physique"', '"attributeScore"'] as const;

const HOUR = 3_600_000;

interface SectFixture {
  api: TestClient;
  sectId: string;
  /** 门内全部弟子 id。 */
  discipleIds: string[];
  state: () => Promise<Record<string, any>>;
  /** 招贤预览（只读）。 */
  recruitPreview: () => Promise<ApiResult>;
  recruit: (choice: number, batch: string | undefined) => Promise<ApiResult>;
  refresh: () => Promise<ApiResult>;
}

async function makeSect(prefix: string): Promise<SectFixture> {
  seq += 1;
  const account = `${prefix}-${seq}`;
  // 独立来源 IP 段：避免与其它测试文件的注册/挑战限频互相干扰。
  const api = new TestClient(app, env, {
    'cf-connecting-ip': `10.12.${Math.floor(seq / 250)}.${seq % 250}`,
  });

  const registered = await api.post('/api/v1/auth/register', { account, password: PASSWORD });
  expect(registered.status).toBe(200);
  const created = await api.post('/api/v1/game/create-sect', { name: `评分${String(seq)}宗` });
  expect(created.status).toBe(200);

  const state = dataOf(created) as Record<string, any>;
  return {
    api,
    sectId: state.state.sect.id as string,
    discipleIds: (state.state.disciples as { id: string }[]).map((disciple) => disciple.id),
    state: async () => {
      const result = await api.get('/api/v1/game/sync');
      expect(result.status).toBe(200);
      return (dataOf(result) as Record<string, any>).state as Record<string, any>;
    },
    recruitPreview: () => api.get('/api/v1/game/recruit-preview'),
    recruit: (choice: number, batch: string | undefined) =>
      batch === undefined
        ? api.post('/api/v1/game/recruit', { choice })
        : api.post('/api/v1/game/recruit', { choice, batch }),
    refresh: () => api.post('/api/v1/game/recruit-refresh'),
  };
}

/* ---------- 原始 SQL 断言辅助 ---------- */

async function freezeSettlement(sectId: string): Promise<void> {
  await env.DB.prepare('UPDATE sects SET last_settled_at = ? WHERE id = ?')
    .bind(Date.now() + 60_000, sectId)
    .run();
}

async function setBalance(sectId: string, resourceId: string, balance: number): Promise<void> {
  await env.DB.prepare('UPDATE resource_balances SET balance = ? WHERE sect_id = ? AND resource_id = ?')
    .bind(balance, sectId, resourceId)
    .run();
}

async function dbBalance(sectId: string, resourceId: string): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT balance FROM resource_balances WHERE sect_id = ? AND resource_id = ?',
  )
    .bind(sectId, resourceId)
    .first<{ balance: number }>();
  return Number(row?.balance ?? 0);
}

async function recruitCounter(sectId: string): Promise<{ dateKey: string; count: number }> {
  const row = await env.DB.prepare('SELECT recruit_date_key, recruit_count FROM sects WHERE id = ?')
    .bind(sectId)
    .first<{ recruit_date_key: string; recruit_count: number }>();
  return { dateKey: row?.recruit_date_key ?? '', count: Number(row?.recruit_count ?? 0) };
}

async function discipleRowCount(sectId: string): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS total FROM disciples WHERE sect_id = ?')
    .bind(sectId)
    .first<{ total: number }>();
  return Number(row?.total ?? 0);
}

async function setLuckPhysique(discipleId: string, luck: number, physique: number): Promise<void> {
  await env.DB.prepare('UPDATE disciples SET luck = ?, physique = ? WHERE id = ?')
    .bind(luck, physique, discipleId)
    .run();
}

/* ---------- 评分与历练概率的「测试内独立重算」 ---------- */

interface SixAttributes {
  aptitude: number;
  attack: number;
  defense: number;
  speed: number;
  luck: number;
  physique: number;
}

/** 综合评分公式（与实现分开写，避免用被测函数验证它自己）。 */
function scoreOf(attributes: SixAttributes): number {
  const total =
    attributes.aptitude +
    attributes.attack +
    attributes.defense +
    attributes.speed +
    attributes.luck +
    attributes.physique;
  return Math.round((total * 10) / 6) / 10;
}

/** 方向受伤下限（计划 2.2）。 */
const JOURNEY_FLOOR_BP: Record<string, number> = { daoSeeking: 200, gathering: 500 };

/** 方向 × 时长的基础受伤概率表格值（计划 2.2）。 */
const JOURNEY_TABLE_BP: Record<string, number> = {
  'daoSeeking:7200': 500,
  'daoSeeking:21600': 800,
  'gathering:7200': 1200,
  'gathering:21600': 1500,
};

/** 额外收获概率：1500 + (幸运 − 50) × 10。 */
function expectedExtraChanceBp(luck: number): number {
  return 1_500 + (luck - 50) * 10;
}

/** 最终受伤概率：方向下限 → 表格值 − floor(战力/50)×100 → 体魄修正 → 再与下限取大。 */
function expectedInjuryChanceBp(
  direction: string,
  durationSeconds: number,
  combatPower: number,
  physique: number,
): number {
  const floorBp = JOURNEY_FLOOR_BP[direction] as number;
  const tableBp = JOURNEY_TABLE_BP[`${direction}:${String(durationSeconds)}`] as number;
  const base = Math.max(floorBp, tableBp - Math.floor(Math.max(0, combatPower) / 50) * 100);
  const modified = Math.floor((base * (10_000 - (physique - 50) * 60)) / 10_000);
  return Math.max(floorBp, modified);
}

/* ---------- 历练测试专用脚手架 ---------- */

const FOUNDATION = 'foundationEstablishment';

interface JourneyFixture extends SectFixture {
  preview: (discipleId: string) => Promise<ApiResult>;
  start: (discipleId: string, direction: string, durationSeconds: number) => Promise<ApiResult>;
  claim: (journeyId: string) => Promise<ApiResult>;
}

/** 直接插入一名筑基弟子（绕过招募次数/容量，用于凑够「出发后留 3 人」）。 */
async function seedDisciple(
  sectId: string,
  options: { name: string; realmId?: string; stage?: number; luck?: number; physique?: number },
): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO disciples
       (id, sect_id, name, gender, aptitude, attack, defense, speed, talent,
        realm_id, stage, cultivation, cultivation_remainder, assignment, injured_until,
        body_tempering_count, note, luck, physique, created_at)
     VALUES (?, ?, ?, 'male', 50, 50, 50, 50, 'combat', ?, ?, 0, 0, 'idle', NULL, 0, '', ?, ?, ?)`,
  )
    .bind(
      id,
      sectId,
      options.name,
      options.realmId ?? FOUNDATION,
      options.stage ?? 1,
      options.luck ?? 50,
      options.physique ?? 50,
      Date.now(),
    )
    .run();
  return id;
}

/**
 * 建一个「可历练」的宗门：初始 3 名弟子改成筑基初期并钉死属性，再补 1 名筑基弟子，
 * 于是出发 1 人后仍留 3 人守宗；luck/physique 默认 50（旧弟子基线）。
 */
async function makeJourneySect(prefix: string): Promise<JourneyFixture> {
  const sect = await makeSect(prefix);
  for (const discipleId of sect.discipleIds) {
    await env.DB.prepare(
      `UPDATE disciples SET realm_id = ?, stage = 1, cultivation = 0, cultivation_remainder = 0,
         aptitude = 50, attack = 50, defense = 50, speed = 50, talent = 'combat',
         luck = 50, physique = 50, injured_until = NULL WHERE id = ?`,
    )
      .bind(FOUNDATION, discipleId)
      .run();
  }
  const extra = await seedDisciple(sect.sectId, { name: `备用${String(seq)}` });
  return {
    ...sect,
    discipleIds: [...sect.discipleIds, extra],
    preview: (discipleId: string) =>
      sect.api.get(`/api/v1/game/journey-preview?discipleId=${encodeURIComponent(discipleId)}`),
    start: (discipleId: string, direction: string, durationSeconds: number) =>
      sect.api.post('/api/v1/game/start-journey', { discipleId, direction, durationSeconds }),
    claim: (journeyId: string) => sect.api.post('/api/v1/game/claim-journey', { journeyId }),
  };
}

interface JourneyRow {
  extra_harvest: number;
  injured: number;
  injury_chance_bp: number;
  completed_at: number | null;
  claimed_at: number | null;
}

async function journeyRow(journeyId: string): Promise<JourneyRow> {
  const row = await env.DB.prepare(
    'SELECT extra_harvest, injured, injury_chance_bp, completed_at, claimed_at FROM disciple_journeys WHERE id = ?',
  )
    .bind(journeyId)
    .first<JourneyRow>();
  expect(row, '历练记录必须存在').toBeTruthy();
  return row as JourneyRow;
}

async function transportJourney(
  journeyId: string,
  startedAt: number,
  endsAt: number,
): Promise<void> {
  await env.DB.prepare('UPDATE disciple_journeys SET started_at = ?, ends_at = ? WHERE id = ?')
    .bind(startedAt, endsAt, journeyId)
    .run();
}

/* ---------- 挑战辅助（反泄漏用例需要一条战报与历史） ---------- */

async function makeStrong(sectId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE disciples SET realm_id = 'goldenCore', stage = 3, attack = 100, defense = 100, speed = 100,
       injured_until = NULL WHERE sect_id = ?`,
  )
    .bind(sectId)
    .run();
}

async function makeWeak(sectId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE disciples SET realm_id = 'qiRefining', stage = 1, attack = 1, defense = 1, speed = 1
     WHERE sect_id = ?`,
  )
    .bind(sectId)
    .run();
}

describe('0016 迁移：disciples.luck / physique', () => {
  it('旧式 INSERT 省略两列仍可用，读回 50/50；两列都是 NOT NULL DEFAULT 50', async () => {
    const sect = await makeSect('dr-mig-default');

    const columns = await env.DB.prepare('PRAGMA table_info(disciples)').all<{
      name: string;
      notnull: number;
      dflt_value: string | null;
    }>();
    const all = columns.results ?? [];
    for (const key of ['luck', 'physique']) {
      const column = all.find((item) => item.name === key);
      expect(column, `0016 之后 disciples 必须有 ${key} 列`).toBeTruthy();
      expect(Number(column?.notnull)).toBe(1);
      expect(String(column?.dflt_value)).toContain('50');
    }

    // 迁移前写入的旧行没有这两列（等价于这里的 INSERT 省略）：读回来必须是 50/50。
    const legacyId = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO disciples (id, sect_id, name, aptitude, created_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(legacyId, sect.sectId, '旧行', 50, Date.now())
      .run();

    const row = await env.DB.prepare('SELECT luck, physique FROM disciples WHERE id = ?')
      .bind(legacyId)
      .first<{ luck: number; physique: number }>();
    expect(row?.luck).toBe(50);
    expect(row?.physique).toBe(50);
  });

  it('CHECK (luck/physique BETWEEN 1 AND 100) 拒绝 0 与 101，且失败后原值不变', async () => {
    const sect = await makeSect('dr-mig-check');
    const discipleId = sect.discipleIds[0] as string;

    for (const column of ['luck', 'physique']) {
      for (const bad of [0, 101]) {
        await expect(
          env.DB.prepare(`UPDATE disciples SET ${column} = ? WHERE id = ?`)
            .bind(bad, discipleId)
            .run(),
        ).rejects.toThrow(/CHECK/i);
      }
      // 边界内是合法的。
      await env.DB.prepare(`UPDATE disciples SET ${column} = 1 WHERE id = ?`).bind(discipleId).run();
      await env.DB.prepare(`UPDATE disciples SET ${column} = 100 WHERE id = ?`).bind(discipleId).run();
    }

    // 拒绝的 UPDATE 必须整条回滚：两列停在最后写入的合法值 100。
    const row = await env.DB.prepare('SELECT luck, physique FROM disciples WHERE id = ?')
      .bind(discipleId)
      .first<{ luck: number; physique: number }>();
    expect(row?.luck).toBe(100);
    expect(row?.physique).toBe(100);
  });

  it('迁移只加两列：旧属性 / 境界 / 修为 / 淬体次数 / 备注原样保留，新列取默认 50', async () => {
    const sect = await makeSect('dr-mig-keep');
    const legacyId = crypto.randomUUID();
    const legacy = {
      gender: 'female',
      aptitude: 73,
      attack: 12,
      defense: 88,
      speed: 41,
      talent: 'mining',
      realm_id: 'goldenCore',
      stage: 2,
      cultivation: 1234,
      cultivation_remainder: 567,
      assignment: 'herbGathering',
      injured_until: 1_893_456_000_000,
      body_tempering_count: 3,
      note: '迁移前备注-sentinel',
      created_at: 1_700_000_000_000,
    };

    // 只写旧列（不写 luck/physique）：迁移前老数据的等价形态。
    await env.DB.prepare(
      `INSERT INTO disciples
         (id, sect_id, name, gender, aptitude, attack, defense, speed, talent, realm_id, stage,
          cultivation, cultivation_remainder, assignment, injured_until, body_tempering_count, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        legacyId,
        sect.sectId,
        '旧字段弟子',
        legacy.gender,
        legacy.aptitude,
        legacy.attack,
        legacy.defense,
        legacy.speed,
        legacy.talent,
        legacy.realm_id,
        legacy.stage,
        legacy.cultivation,
        legacy.cultivation_remainder,
        legacy.assignment,
        legacy.injured_until,
        legacy.body_tempering_count,
        legacy.note,
        legacy.created_at,
      )
      .run();

    const row = await env.DB.prepare(
      `SELECT gender, aptitude, attack, defense, speed, talent, realm_id, stage, cultivation,
              cultivation_remainder, assignment, injured_until, body_tempering_count, note,
              created_at, luck, physique
       FROM disciples WHERE id = ?`,
    )
      .bind(legacyId)
      .first<Record<string, unknown>>();

    for (const [key, value] of Object.entries(legacy)) {
      expect(row?.[key], `${key} 不该被迁移改动`).toBe(value);
    }
    expect(row?.luck).toBe(50);
    expect(row?.physique).toBe(50);
  });
});

describe('六属性与综合评分', () => {
  it('新建宗门的每名弟子六项都在 1..100，评分等于测试内重算的公式，攻/防/速最大差距不超过 30', async () => {
    const sect = await makeSect('dr-rating');
    const state = await sect.state();
    expect((state.disciples as unknown[]).length).toBeGreaterThan(0);

    for (const disciple of state.disciples as Record<string, any>[]) {
      for (const key of ['aptitude', 'attack', 'defense', 'speed', 'luck', 'physique']) {
        expect(Number.isInteger(disciple[key]), `${key} 必须是整数`).toBe(true);
        expect(disciple[key]).toBeGreaterThanOrEqual(1);
        expect(disciple[key]).toBeLessThanOrEqual(100);
      }
      // 只有私有 sync 才给综合评分；评分必须与服务端同一口径。
      expect(disciple.attributeScore).toBeCloseTo(
        scoreOf({
          aptitude: Number(disciple.aptitude),
          attack: Number(disciple.attack),
          defense: Number(disciple.defense),
          speed: Number(disciple.speed),
          luck: Number(disciple.luck),
          physique: Number(disciple.physique),
        }),
        5,
      );

      const combat = [Number(disciple.attack), Number(disciple.defense), Number(disciple.speed)];
      expect(Math.max(...combat) - Math.min(...combat)).toBeLessThanOrEqual(30);
    }
  });

  it('生成器边界：随机源恒为 0 / 接近 1 时六项分别触底 1 与触顶 100，评分 1.0 / 100.0', () => {
    const lowest = generateAttributes(() => 0);
    expect(lowest).toEqual({ aptitude: 1, attack: 1, defense: 1, speed: 1, luck: 1, physique: 1 });
    expect(attributeScore(lowest)).toBe(1);
    expect(attributeScore(lowest)).toBeCloseTo(scoreOf(lowest), 5);

    const highest = generateAttributes(() => 0.9999);
    expect(highest).toEqual({
      aptitude: 100,
      attack: 100,
      defense: 100,
      speed: 100,
      luck: 100,
      physique: 100,
    });
    expect(attributeScore(highest)).toBe(100);
    expect(attributeScore(highest)).toBeCloseTo(scoreOf(highest), 5);
  });
});

describe('淬体丹：评分按当前属性重算，回执与下次 sync 一致', () => {
  it('服丹回执的 attributeScore 现算、只补短板、不动幸运/体魄，且下次 sync 与 DB 行一致', async () => {
    const sect = await makeSect('dr-pill-tempering');
    await freezeSettlement(sect.sectId);

    // 直接用 SQL 解锁炼丹（宗门 2 级 + 灵药园 2 级），与 alchemy.test 同一手法：
    // 走完整升级链路（还要求一名筑基弟子）与本用例主题无关，只会引入噪音。
    await env.DB.prepare('UPDATE sects SET level = 2, recruit_refresh_level = 2 WHERE id = ?')
      .bind(sect.sectId)
      .run();
    await env.DB.prepare('UPDATE buildings SET level = 2 WHERE sect_id = ? AND def_id = ?')
      .bind(sect.sectId, 'herbGarden')
      .run();
    await env.DB.prepare(
      'INSERT INTO pill_inventories (id, sect_id, pill_id, quantity, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(crypto.randomUUID(), sect.sectId, 'bodyTemperingPill', 3, Date.now())
      .run();

    const unlocked = await sect.state();
    expect(unlocked.alchemy.unlocked).toBe(true);

    // 挑一名有明显短板的弟子，并把幸运/体魄钉成非 50：验证丹方只动攻防速、
    // 且 0016 新增的运气列不被淬体的写回扰动。
    const discipleId = sect.discipleIds[0] as string;
    await env.DB.prepare(
      'UPDATE disciples SET aptitude = 61, attack = 32, defense = 76, speed = 70, luck = 37, physique = 82 WHERE id = ?',
    )
      .bind(discipleId)
      .run();

    const before = ((await sect.state()).disciples as Record<string, any>[]).find(
      (item) => item.id === discipleId,
    ) as Record<string, any>;
    expect(before.bodyTemperingTarget, '32/76/70 的短板必须是攻击').toBe('attack');
    expect(before.bodyTemperingUses).toBe(0);
    const pre: SixAttributes = {
      aptitude: Number(before.aptitude),
      attack: Number(before.attack),
      defense: Number(before.defense),
      speed: Number(before.speed),
      luck: Number(before.luck),
      physique: Number(before.physique),
    };
    expect(pre.aptitude).toBe(61);
    expect(pre.luck).toBe(37);
    expect(pre.physique).toBe(82);
    // 61 + 32 + 76 + 70 + 37 + 82 = 358 → round(358×10/6)/10 = 59.7
    expect(scoreOf(pre)).toBe(59.7);

    await freezeSettlement(sect.sectId);
    const used = await sect.api.post('/api/v1/game/use-pill', {
      pillId: 'bodyTemperingPill',
      discipleId,
    });
    expect(used.status).toBe(200);
    const usedData = dataOf(used) as Record<string, any>;
    expect(usedData.outcome.effect).toEqual({ kind: 'bodyTempering', gain: 5, attribute: 'attack' });

    const receipt = (usedData.state.disciples as Record<string, any>[]).find(
      (item) => item.id === discipleId,
    ) as Record<string, any>;
    const after: SixAttributes = {
      aptitude: Number(receipt.aptitude),
      attack: Number(receipt.attack),
      defense: Number(receipt.defense),
      speed: Number(receipt.speed),
      luck: Number(receipt.luck),
      physique: Number(receipt.physique),
    };

    // 回执里的评分必须是按「当前」六属性现算的，不是出发前的缓存值。
    const scoreFormula =
      Math.round(
        ((after.aptitude +
          after.attack +
          after.defense +
          after.speed +
          after.luck +
          after.physique) *
          10) /
          6,
      ) / 10;
    expect(receipt.attributeScore).toBeCloseTo(scoreFormula, 5);
    expect(receipt.attributeScore).toBeCloseTo(scoreOf(after), 5);
    // 61 + 37 + 76 + 70 + 37 + 82 = 363 → round(363×10/6)/10 = 60.5
    expect(receipt.attributeScore).toBe(60.5);
    expect(receipt.attributeScore).toBeGreaterThanOrEqual(scoreOf(pre) + 0.1);

    // 只有短板属性变化（攻击 32→37），另两项与资质/幸运/体魄原样。
    expect(after.attack).toBe(pre.attack + 5);
    expect(after.defense).toBe(pre.defense);
    expect(after.speed).toBe(pre.speed);
    const changed = (['attack', 'defense', 'speed'] as const).filter((key) => after[key] !== pre[key]);
    expect(changed).toEqual([before.bodyTemperingTarget]);
    expect(after.aptitude).toBe(pre.aptitude);
    expect(after.luck).toBe(pre.luck);
    expect(after.physique).toBe(pre.physique);
    expect(receipt.bodyTemperingUses).toBe(before.bodyTemperingUses + 1);

    // 回执与下一次 sync 一致（评分与六属性都不能漂移）。
    await freezeSettlement(sect.sectId);
    const synced = ((await sect.state()).disciples as Record<string, any>[]).find(
      (item) => item.id === discipleId,
    ) as Record<string, any>;
    expect(synced.attributeScore).toBe(receipt.attributeScore);
    for (const key of ['aptitude', 'attack', 'defense', 'speed', 'luck', 'physique'] as const) {
      expect(synced[key]).toBe(after[key]);
    }

    // 数据库层：淬体次数 +1，luck/physique 未被丹药写回扰动。
    const row = await env.DB.prepare(
      'SELECT body_tempering_count, luck, physique FROM disciples WHERE id = ?',
    )
      .bind(discipleId)
      .first<{ body_tempering_count: number; luck: number; physique: number }>();
    expect(Number(row?.body_tempering_count)).toBe(1);
    expect(Number(row?.luck)).toBe(37);
    expect(Number(row?.physique)).toBe(82);
  });
});

describe('招贤批次：预览等于招募、过期批次不扣资源/次数', () => {
  it('提交守卫原子核对刷新计数：旧快照不能在刷新已提交后扣费', async () => {
    const sect = await makeSect('dr-recruit-guard');
    await freezeSettlement(sect.sectId);
    const [sectRow, balances, disciples] = await Promise.all([
      new SectRepository(env.DB).findById(sect.sectId),
      new ResourceBalanceRepository(env.DB).findBySectId(sect.sectId),
      new DiscipleRepository(env.DB).findBySectId(sect.sectId),
    ]);
    expect(sectRow).not.toBeNull();

    // 刷新只改变 recruit_refresh_used：结算时间、余额与弟子数量都保持旧快照。
    expect((await sect.refresh()).status).toBe(200);
    const afterRefresh = await new SectRepository(env.DB).findById(sect.sectId);
    expect(afterRefresh?.last_settled_at).toBe(sectRow?.last_settled_at);
    expect(afterRefresh?.recruit_refresh_used).toBe(Number(sectRow?.recruit_refresh_used) + 1);
    const balanceBefore = await dbBalance(sect.sectId, 'spiritStone');

    const guard = settlementSnapshotGuardStatements(
      crypto.randomUUID(),
      { sect: sectRow!, balances, disciples },
      { checkRecruitState: true },
    );
    await expect(
      env.DB.batch(prepareStatements(env.DB, [
        ...guard.guards,
        resourceDeltaStatement(sect.sectId, 'spiritStone', -50_000, Date.now()),
        ...guard.cleanup,
      ])),
    ).rejects.toThrow(/CHECK constraint failed/i);
    expect(await dbBalance(sect.sectId, 'spiritStone')).toBe(balanceBefore);
  });

  it('提交守卫也核对招募日期与次数，不能只依赖结算时间', async () => {
    const sect = await makeSect('dr-recruit-counter-guard');
    await freezeSettlement(sect.sectId);
    const [sectRow, balances, disciples] = await Promise.all([
      new SectRepository(env.DB).findById(sect.sectId),
      new ResourceBalanceRepository(env.DB).findBySectId(sect.sectId),
      new DiscipleRepository(env.DB).findBySectId(sect.sectId),
    ]);
    expect(sectRow).not.toBeNull();
    await env.DB.prepare('UPDATE sects SET recruit_date_key = ?, recruit_count = 1 WHERE id = ?')
      .bind('2026-09-21', sect.sectId)
      .run();
    const balanceBefore = await dbBalance(sect.sectId, 'spiritStone');
    const guard = settlementSnapshotGuardStatements(
      crypto.randomUUID(),
      { sect: sectRow!, balances, disciples },
      { checkRecruitState: true },
    );
    await expect(
      env.DB.batch(prepareStatements(env.DB, [
        ...guard.guards,
        resourceDeltaStatement(sect.sectId, 'spiritStone', -50_000, Date.now()),
        ...guard.cleanup,
      ])),
    ).rejects.toThrow(/CHECK constraint failed/i);
    expect(await dbBalance(sect.sectId, 'spiritStone')).toBe(balanceBefore);
  });

  it('招募到的弟子（回执与 state）与产生该批次的预览候选完全一致，成功招一次 recruit_count +1', async () => {
    const sect = await makeSect('dr-recruit-match');
    await freezeSettlement(sect.sectId);
    await setBalance(sect.sectId, 'spiritStone', 500_000);

    const preview = dataOf(await sect.recruitPreview()) as Record<string, any>;
    expect(typeof preview.batch).toBe('string');
    const candidate = (preview.candidates as Record<string, any>[])[0] as Record<string, any>;
    // 招贤预览是私有契约：必须带六属性与评分。
    for (const key of ['aptitude', 'attack', 'defense', 'speed', 'luck', 'physique', 'attributeScore']) {
      expect(candidate).toHaveProperty(key);
    }

    const counterBefore = await recruitCounter(sect.sectId);
    const countBefore = await discipleRowCount(sect.sectId);

    const result = await sect.recruit(0, preview.batch as string);
    expect(result.status).toBe(200);
    const data = dataOf(result) as Record<string, any>;
    const outcome = data.outcome as Record<string, any>;
    expect(outcome.discipleName).toBe(candidate.name);
    for (const key of ['aptitude', 'attack', 'defense', 'speed', 'luck', 'physique']) {
      expect(outcome[key]).toBe(candidate[key]);
    }
    expect(outcome.attributeScore).toBeCloseTo(candidate.attributeScore as number, 5);

    const state = data.state as Record<string, any>;
    const known = new Set(sect.discipleIds);
    const fresh = (state.disciples as Record<string, any>[]).find((item) => !known.has(item.id));
    expect(fresh, '招贤应产生一名新弟子').toBeTruthy();
    for (const key of ['aptitude', 'attack', 'defense', 'speed', 'luck', 'physique']) {
      expect(fresh?.[key]).toBe(candidate[key]);
    }
    expect(fresh?.attributeScore).toBeCloseTo(candidate.attributeScore as number, 5);

    // 新建宗门时 recruit_date_key 还是空串；成功招一次后日期键被写成今天、计数 +1。
    const counterAfter = await recruitCounter(sect.sectId);
    expect(counterAfter.count).toBe(counterBefore.count + 1);
    expect(counterAfter.dateKey.length).toBeGreaterThan(0);
    expect(await discipleRowCount(sect.sectId)).toBe(countBefore + 1);
  });

  it('同一批次用第二次 → 410 EXPIRED(stale_batch)，灵石/招募次数/人数都不动', async () => {
    const sect = await makeSect('dr-recruit-reuse');
    await freezeSettlement(sect.sectId);
    await setBalance(sect.sectId, 'spiritStone', 500_000);

    const preview = dataOf(await sect.recruitPreview()) as Record<string, any>;
    expect((await sect.recruit(0, preview.batch as string)).status).toBe(200);

    await freezeSettlement(sect.sectId);
    const balanceAfterFirst = await dbBalance(sect.sectId, 'spiritStone');
    const counterAfterFirst = await recruitCounter(sect.sectId);
    const countAfterFirst = await discipleRowCount(sect.sectId);

    const reuse = await sect.recruit(1, preview.batch as string);
    expect(reuse.status).toBe(410);
    expect(errorOf(reuse).code).toBe('EXPIRED');
    expect(errorOf(reuse).details?.reason).toBe('stale_batch');

    expect(await dbBalance(sect.sectId, 'spiritStone')).toBe(balanceAfterFirst);
    expect(await recruitCounter(sect.sectId)).toEqual(counterAfterFirst);
    expect(await discipleRowCount(sect.sectId)).toBe(countAfterFirst);
  });

  it('不带批次标识 → 410 EXPIRED(missing_batch)，什么都不扣', async () => {
    const sect = await makeSect('dr-recruit-missing');
    await freezeSettlement(sect.sectId);
    await setBalance(sect.sectId, 'spiritStone', 500_000);

    const balanceBefore = await dbBalance(sect.sectId, 'spiritStone');
    const counterBefore = await recruitCounter(sect.sectId);
    const countBefore = await discipleRowCount(sect.sectId);

    const missing = await sect.recruit(0, undefined);
    expect(missing.status).toBe(410);
    expect(errorOf(missing).code).toBe('EXPIRED');
    expect(errorOf(missing).details?.reason).toBe('missing_batch');

    expect(await dbBalance(sect.sectId, 'spiritStone')).toBe(balanceBefore);
    expect(await recruitCounter(sect.sectId)).toEqual(counterBefore);
    expect(await discipleRowCount(sect.sectId)).toBe(countBefore);
  });

  it('刷新后旧批次 → 410，新批次可招募且与刷新返回的候选一致', async () => {
    const sect = await makeSect('dr-recruit-refresh');
    await freezeSettlement(sect.sectId);
    await setBalance(sect.sectId, 'spiritStone', 500_000);

    const before = dataOf(await sect.recruitPreview()) as Record<string, any>;
    const staleBatch = before.batch as string;
    const candidateBefore = (before.candidates as Record<string, any>[])[0] as Record<string, any>;

    const refreshed = await sect.refresh();
    expect(refreshed.status).toBe(200);
    const refreshedData = dataOf(refreshed) as Record<string, any>;
    const freshBatch = (refreshedData.preview as Record<string, any>).batch as string;
    expect(freshBatch).not.toBe(staleBatch);

    await freezeSettlement(sect.sectId);
    const balanceBefore = await dbBalance(sect.sectId, 'spiritStone');
    const stale = await sect.recruit(0, staleBatch);
    expect(stale.status).toBe(410);
    expect(errorOf(stale).details?.reason).toBe('stale_batch');
    expect(await dbBalance(sect.sectId, 'spiritStone')).toBe(balanceBefore);

    const ok = await sect.recruit(0, freshBatch);
    expect(ok.status).toBe(200);
    const outcome = (dataOf(ok) as Record<string, any>).outcome as Record<string, any>;
    const freshCandidate = (refreshedData.preview as Record<string, any>).candidates as Record<
      string,
      any
    >[];
    expect(outcome.discipleName).toBe(freshCandidate[0]?.name);
    expect(outcome.attributeScore).toBeCloseTo(freshCandidate[0]?.attributeScore as number, 5);
    // 刷新确实换了人（旧批次与新批次的候选不应完全相同）。
    expect(refreshedData.preview).not.toEqual(before);
    expect(candidateBefore.name).not.toBe(undefined);
  });

  it('跨天批次被拒：用「昨天」的日期键拼出的旧批次 → 410 且不扣资源/次数', async () => {
    const sect = await makeSect('dr-recruit-crossday');
    await freezeSettlement(sect.sectId);
    await setBalance(sect.sectId, 'spiritStone', 500_000);

    const preview = dataOf(await sect.recruitPreview()) as Record<string, any>;
    const parts = (preview.batch as string).split(':');
    // `${DISCIPLE_RULE_VERSION}:${sectId}:${dateKey}:${recruitCount}:${refreshSeq}`
    expect(parts).toHaveLength(5);
    const [, batchSectId, dateKey, recruitCount, refreshSeq] = parts;
    expect(batchSectId).toBe(sect.sectId);

    // 把日期键整体前移一天，得到「昨天预览、今天才提交」的批次标识。
    const yesterday = new Date(Date.parse(`${dateKey as string}T00:00:00Z`) - 86_400_000)
      .toISOString()
      .slice(0, 10);
    const crossDayBatch = recruitBatchId({
      sectId: batchSectId as string,
      dateKey: yesterday,
      recruitCount: Number(recruitCount),
      refreshSeq: Number(refreshSeq),
    });
    expect(crossDayBatch).not.toBe(preview.batch);

    const balanceBefore = await dbBalance(sect.sectId, 'spiritStone');
    const counterBefore = await recruitCounter(sect.sectId);
    const countBefore = await discipleRowCount(sect.sectId);

    const rejected = await sect.recruit(0, crossDayBatch);
    expect(rejected.status).toBe(410);
    expect(errorOf(rejected).code).toBe('EXPIRED');
    expect(errorOf(rejected).details?.reason).toBe('stale_batch');

    expect(await dbBalance(sect.sectId, 'spiritStone')).toBe(balanceBefore);
    expect(await recruitCounter(sect.sectId)).toEqual(counterBefore);
    expect(await discipleRowCount(sect.sectId)).toBe(countBefore);
  });
});

describe('历练：幸运/体魄概率与出发快照不重掷', () => {
  it('幸运 1/50/100 → 额外收获 1010/1500/2000；体魄 1/50/100 的受伤概率与公式逐位一致', async () => {
    const fixture = await makeJourneySect('dr-journey-prob');
    const discipleId = fixture.discipleIds[0] as string;
    await freezeSettlement(fixture.sectId);

    const state = await fixture.state();
    const combatPower = Number(
      (state.disciples as Record<string, any>[]).find((row) => row.id === discipleId)?.combatPower,
    );
    expect(Number.isFinite(combatPower)).toBe(true);

    // 幸运三档：体魄固定 50（受伤概率保持表格基线）。
    for (const luck of [1, 50, 100]) {
      await setLuckPhysique(discipleId, luck, 50);
      const preview = dataOf(await fixture.preview(discipleId)) as Record<string, any>;
      for (const direction of preview.directions as Record<string, any>[]) {
        for (const duration of direction.durations as Record<string, any>[]) {
          expect(duration.extraChanceBp).toBe(expectedExtraChanceBp(luck));
          expect(duration.injuryChanceBp).toBe(
            expectedInjuryChanceBp(direction.direction, duration.durationSeconds, combatPower, 50),
          );
        }
      }
    }

    // 体魄三档：幸运固定 50（额外收获基线）；覆盖 2 方向 × 2 时长共 4 行。
    for (const physique of [1, 50, 100]) {
      await setLuckPhysique(discipleId, 50, physique);
      const preview = dataOf(await fixture.preview(discipleId)) as Record<string, any>;
      let rows = 0;
      for (const direction of preview.directions as Record<string, any>[]) {
        for (const duration of direction.durations as Record<string, any>[]) {
          expect(duration.extraChanceBp).toBe(1_500);
          expect(duration.injuryChanceBp).toBe(
            expectedInjuryChanceBp(direction.direction, duration.durationSeconds, combatPower, physique),
          );
          rows += 1;
        }
      }
      expect(rows).toBe(4);
    }
  });

  it('出发把预览时的最终 injuryChanceBp 原样落库', async () => {
    const fixture = await makeJourneySect('dr-journey-store');
    const discipleId = fixture.discipleIds[0] as string;
    await freezeSettlement(fixture.sectId);

    // 非中性幸运/体魄，证明落库值确实来自出发时的属性快照。
    await setLuckPhysique(discipleId, 80, 25);
    const preview = dataOf(await fixture.preview(discipleId)) as Record<string, any>;
    const dao = (preview.directions as Record<string, any>[]).find(
      (item) => item.direction === 'daoSeeking',
    ) as Record<string, any>;
    const sixHour = (dao.durations as Record<string, any>[]).find(
      (item) => item.durationSeconds === 7_200,
    ) as Record<string, any>;

    const started = await fixture.start(discipleId, 'daoSeeking', 7_200);
    expect(started.status).toBe(200);

    const row = await env.DB.prepare('SELECT injury_chance_bp FROM disciple_journeys WHERE disciple_id = ?')
      .bind(discipleId)
      .first<{ injury_chance_bp: number }>();
    expect(Number(row?.injury_chance_bp)).toBe(sixHour.injuryChanceBp);
  });

  it('出发后改幸运/体魄并重复 sync/领取：extraHarvest / injured / injuryChanceBp 不重掷', async () => {
    const fixture = await makeJourneySect('dr-journey-noreroll');
    const discipleId = fixture.discipleIds[0] as string;
    await freezeSettlement(fixture.sectId);

    await setLuckPhysique(discipleId, 40, 40);
    const started = await fixture.start(discipleId, 'gathering', 7_200);
    expect(started.status).toBe(200);
    const startedState = dataOf(started) as Record<string, any>;
    const journeyId = (startedState.state.disciples as Record<string, any>[]).find(
      (row) => row.id === discipleId,
    )?.journey.journeyId as string;
    expect(typeof journeyId).toBe('string');

    const before = await journeyRow(journeyId);

    // 出发后把属性改到极端：如果实现重掷/重算，落库值会变。
    await setLuckPhysique(discipleId, 100, 1);
    await freezeSettlement(fixture.sectId);

    for (let i = 0; i < 2; i += 1) {
      const synced = await fixture.state();
      const journey = (synced.disciples as Record<string, any>[]).find((row) => row.id === discipleId)
        ?.journey as Record<string, any>;
      expect(journey.status).toBe('active');
      expect(journey.outcome).toBeNull();
    }

    const mid = await journeyRow(journeyId);
    expect(mid.extra_harvest).toBe(before.extra_harvest);
    expect(mid.injured).toBe(before.injured);
    expect(mid.injury_chance_bp).toBe(before.injury_chance_bp);

    // 把到期时间挪到过去：归队后的结果必须与出发快照一致。
    const now = Date.now();
    await transportJourney(journeyId, now - 3 * HOUR, now - 1_000);
    await freezeSettlement(fixture.sectId);

    const ready = await fixture.state();
    const readyJourney = (ready.disciples as Record<string, any>[]).find((row) => row.id === discipleId)
      ?.journey as Record<string, any>;
    expect(readyJourney.status).toBe('ready');
    expect(readyJourney.outcome.extraHarvest).toBe(before.extra_harvest === 1);
    expect(readyJourney.outcome.injured).toBe(before.injured === 1);
    expect(readyJourney.outcome.injuryChanceBp).toBe(Number(before.injury_chance_bp));

    const claimed = await fixture.claim(journeyId);
    expect(claimed.status).toBe(200);
    const claimOutcome = (dataOf(claimed) as Record<string, any>).outcome as Record<string, any>;
    expect(claimOutcome.extraHarvest).toBe(before.extra_harvest === 1);
    expect(claimOutcome.injured).toBe(before.injured === 1);

    // 领取前后落库值不变；重复领取失败也不改写。
    const after = await journeyRow(journeyId);
    expect(after.extra_harvest).toBe(before.extra_harvest);
    expect(after.injured).toBe(before.injured);
    expect(after.injury_chance_bp).toBe(before.injury_chance_bp);
    expect(after.claimed_at).not.toBeNull();

    const again = await fixture.claim(journeyId);
    expect(again.status).toBe(409);
    const againRow = await journeyRow(journeyId);
    expect(againRow.injury_chance_bp).toBe(before.injury_chance_bp);
    expect(againRow.extra_harvest).toBe(before.extra_harvest);
  });

  it('旧弟子 50/50 的预览与加属性之前完全一致，纯规则在战力 0 时就是表格值 500', async () => {
    const fixture = await makeJourneySect('dr-journey-legacy');
    const discipleId = fixture.discipleIds[0] as string;
    await freezeSettlement(fixture.sectId);
    await setLuckPhysique(discipleId, 50, 50);

    const state = await fixture.state();
    const combatPower = Number(
      (state.disciples as Record<string, any>[]).find((row) => row.id === discipleId)?.combatPower,
    );
    const preview = dataOf(await fixture.preview(discipleId)) as Record<string, any>;
    for (const direction of preview.directions as Record<string, any>[]) {
      for (const duration of direction.durations as Record<string, any>[]) {
        expect(duration.extraChanceBp).toBe(1_500);
        expect(duration.injuryChanceBp).toBe(
          expectedInjuryChanceBp(direction.direction, duration.durationSeconds, combatPower, 50),
        );
      }
    }

    // 纯规则基线：战力 0、体魄 50 → 访道 2 小时就是表值 500（加属性前的概率）。
    const plan = findJourneyPlan('daoSeeking', 7_200);
    expect(plan).toBeDefined();
    expect(journeyInjuryChanceBp(plan!, 0, 50)).toBe(500);
  });
});

describe('公开契约不泄漏私有字段（luck / physique / attributeScore）', () => {
  it('私有 sync 带这三项；公开档案 / 排行榜 / 战报与历史都搜不到', async () => {
    const attacker = await makeSect('dr-leak-a');
    const defender = await makeSect('dr-leak-b');
    await freezeSettlement(attacker.sectId);
    await freezeSettlement(defender.sectId);

    // 正向对照：私有 sync 确实带这三项（否则下面的「搜不到」毫无意义）。
    const privateState = await attacker.state();
    const privateDisciple = (privateState.disciples as Record<string, any>[])[0] as Record<
      string,
      any
    >;
    const privateKeys = Object.keys(privateDisciple);
    expect(privateKeys).toContain('luck');
    expect(privateKeys).toContain('physique');
    expect(privateKeys).toContain('attributeScore');

    // 公开档案：对任何人（含自己）都不该出现这三项。
    for (const viewer of [attacker.api, defender.api]) {
      const profile = await viewer.get(`/api/v1/game/sect/${defender.sectId}`);
      expect(profile.status).toBe(200);
      const text = JSON.stringify(profile.body);
      for (const key of PRIVATE_ATTRIBUTE_KEYS) {
        expect(text).not.toContain(key);
      }
    }

    const leaderboard = await attacker.api.get('/api/v1/game/leaderboard');
    expect(leaderboard.status).toBe(200);
    for (const key of PRIVATE_ATTRIBUTE_KEYS) {
      expect(JSON.stringify(leaderboard.body)).not.toContain(key);
    }

    // 打一场（确定性胜负），战报正文与双方历史里都不能带私有字段。
    await makeStrong(attacker.sectId);
    await makeWeak(defender.sectId);
    const battle = await attacker.api.post('/api/v1/game/challenge', {
      targetSectId: defender.sectId,
      discipleIds: attacker.discipleIds.slice(0, 3),
    });
    expect(battle.status).toBe(200);
    const battleResult = (dataOf(battle) as Record<string, any>).result;
    for (const key of PRIVATE_ATTRIBUTE_KEYS) {
      expect(JSON.stringify(battleResult)).not.toContain(key);
    }

    const history = await attacker.api.get('/api/v1/game/challenge-history');
    expect(history.status).toBe(200);
    for (const key of PRIVATE_ATTRIBUTE_KEYS) {
      expect(JSON.stringify(history.body)).not.toContain(key);
    }
  });
});
