import { applyD1Migrations, env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app';
import { dateKeyUtc8 } from '../src/modules/game/constants';
import { discipleCombatPower } from '../src/modules/game/realms';
import {
  attackWorldBoss,
  equipItem,
  expelDisciple,
  exploreSectRealm,
  forgeEquipment,
  getEquipment,
  listDiscipleLeaderboard,
  previewJourney,
  processWorldBoss,
  salvageEquipment,
  sparWithSect,
  unequipItem,
  upgradeBuilding,
} from '../src/modules/game/service';
import { dataOf, TestClient } from './support/authClient';
/**
 * 装备系统 · 一期（docs/装备系统开发计划.md）。
 *
 * 覆盖：0028 迁移（equipment 表 + disciples 的 5 个 gear 列）、战力接入
 * （弟子视图 / 天骄榜 / 挑战 / 世界 Boss）、历练**不**计入装备；
 * 炼器 / 背包 / 穿戴 / 分解 / 驱逐接口与 Boss 掉落也在本文件后半段。
 *
 * 存储说明：本文件一份独立内存 D1，没有逐用例回滚 —— 每个用例用独立账号 / 宗门，
 * 断言按宗门 id 定界。
 *
 * 随机说明：战斗路径的浮动与暴击都用 `Math.random`。本文件把它钉成 0.5 ——
 * 浮动系数 0.85 + 0.5 × 0.3 = 1.0，于是「账面战力 = 浮动后的战力」，
 * 断言可以直接和 realms.ts 的 discipleCombatPower 对齐（暴击判定 0.5 > 20% 上限，必然不暴击）。
 */

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

const quietLogger = { info: () => {}, warn: () => {}, error: () => {} } as const;
const app = createApp({ logger: quietLogger });
const PASSWORD = 'password-123456';
const DAY_MS = 86_400_000;

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
    'cf-connecting-ip': `10.9.${Math.floor(seq / 250)}.${seq % 250}`,
  });
  const registered = await api.post('/api/v1/auth/register', { account, password: PASSWORD });
  expect(registered.status).toBe(200);
  const created = await api.post('/api/v1/game/create-sect', { name: `装备${seq}号` });
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

/** 直接写弟子表上的 5 个冗余加成列（阶段一只做战力接入，写列的接口在阶段二）。 */
async function setGear(
  discipleId: string,
  gear: { attack?: number; defense?: number; speed?: number; luck?: number; physique?: number },
): Promise<void> {
  await env.DB.prepare(
    `UPDATE disciples
        SET gear_attack = ?, gear_defense = ?, gear_speed = ?, gear_luck = ?, gear_physique = ?
      WHERE id = ?`,
  )
    .bind(
      gear.attack ?? 0,
      gear.defense ?? 0,
      gear.speed ?? 0,
      gear.luck ?? 0,
      gear.physique ?? 0,
      discipleId,
    )
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

function discipleOf(state: Record<string, any>, discipleId: string): Record<string, any> {
  const disciple = (state.disciples as { id: string }[]).find((item) => item.id === discipleId);
  expect(disciple).toBeTruthy();
  return disciple as Record<string, any>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('0028 迁移：装备表与弟子加成列', () => {
  it('disciples 的 5 个 gear 列都是 NOT NULL DEFAULT 0', async () => {
    const columns = await env.DB.prepare('PRAGMA table_info(disciples)').all<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>();
    const byName = new Map((columns.results ?? []).map((item) => [item.name, item]));
    for (const name of ['gear_attack', 'gear_defense', 'gear_speed', 'gear_luck', 'gear_physique']) {
      const column = byName.get(name);
      expect(column, `${name} 列不存在`).toBeTruthy();
      expect(`${column!.type}|${Number(column!.notnull)}|${column!.dflt_value ?? ''}`).toBe(
        'INTEGER|1|0',
      );
    }
  });

  it('equipment 表与两条索引都在；每名弟子每个部位最多一件（背包行不受限）', async () => {
    const table = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'equipment'",
    ).first<{ name: string }>();
    expect(table?.name).toBe('equipment');

    const indexes = await env.DB.prepare(
      `SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'equipment'`,
    ).all<{ name: string; sql: string | null }>();
    const byName = new Map((indexes.results ?? []).map((item) => [item.name, item.sql ?? '']));
    expect(byName.has('equipment_sect_idx')).toBe(true);
    // 部分唯一索引：只在 disciple_id 非空时生效（背包里的多件可以同部位）。
    expect(byName.get('equipment_disciple_slot_uniq')).toContain('disciple_id IS NOT NULL');

    const sect = await makeSect('eq-mig');
    const discipleId = sect.discipleIds[0]!;
    const insert = (id: string, disciple: string | null, slot: string) =>
      env.DB.prepare(
        `INSERT INTO equipment
           (id, sect_id, disciple_id, slot, quality, name, main_attr, main_value,
            sub_attr, sub_value, source, created_at)
         VALUES (?, ?, ?, ?, 'common', '凡品·青锋剑', 'attack', 4, 'speed', 1, 'forge', ?)`,
      )
        .bind(id, sect.sectId, disciple, slot, Date.now())
        .run();

    // 背包行（disciple_id IS NULL）同部位可以有任意多件。
    await insert(crypto.randomUUID(), null, 'weapon');
    await insert(crypto.randomUUID(), null, 'weapon');
    // 穿在身上的同一部位只能一件。
    await insert(crypto.randomUUID(), discipleId, 'weapon');
    await expect(insert(crypto.randomUUID(), discipleId, 'weapon')).rejects.toThrow();
  });

  it('新宗门的 5 个加成列默认 0（sync 下发的 gear 全 0）', async () => {
    const sect = await makeSect('eq-default');
    const state = await sect.state();
    expect(sect.discipleIds).toHaveLength(3);
    for (const discipleId of sect.discipleIds) {
      expect(discipleOf(state, discipleId).gear).toEqual({
        attack: 0,
        defense: 0,
        speed: 0,
        luck: 0,
        physique: 0,
      });
    }
  });
});

describe('战力计入装备（计划 1.2）', () => {
  it('弟子视图：战力含装备加成、gear 回显；基础属性本身不变', async () => {
    const sect = await makeSect('eq-view');
    const discipleId = sect.discipleIds[0]!;
    const before = discipleOf(await sect.state(), discipleId);
    const basePower = discipleCombatPower(
      before.realmId,
      Number(before.stage),
      Number(before.attack),
      Number(before.defense),
      Number(before.speed),
      before.talent,
    );
    expect(before.combatPower).toBe(basePower);

    await setGear(discipleId, { attack: 20, defense: 5, speed: 3, luck: 7, physique: 9 });
    const after = discipleOf(await sect.state(), discipleId);
    expect(after.gear).toEqual({ attack: 20, defense: 5, speed: 3, luck: 7, physique: 9 });
    expect(after.combatPower).toBe(
      discipleCombatPower(
        before.realmId,
        Number(before.stage),
        Number(before.attack) + 20,
        Number(before.defense) + 5,
        Number(before.speed) + 3,
        before.talent,
      ),
    );
    expect(after.combatPower).toBeGreaterThan(basePower);
    // 装备只做加成：三项基础属性与综合评分都不动。
    expect(after.attack).toBe(before.attack);
    expect(after.defense).toBe(before.defense);
    expect(after.speed).toBe(before.speed);
    expect(after.attributeScore).toBe(before.attributeScore);
  });

  it('天骄榜：战力榜吃装备加成，综合评分不受影响', async () => {
    const sect = await makeSect('eq-board');
    const discipleId = sect.discipleIds[0]!;
    const before = discipleOf(await sect.state(), discipleId);
    // 给一个夸张的加成，保证它在战力榜上排第一（同库里其它宗门都是裸装）。
    await setGear(discipleId, { attack: 5000, speed: 1000 });
    const board = await listDiscipleLeaderboard(env.DB, sect.userId);
    const top = board.byCombatPower[0];
    expect(top?.discipleId).toBe(discipleId);
    expect(top?.combatPower).toBe(
      discipleCombatPower(
        before.realmId,
        Number(before.stage),
        Number(before.attack) + 5000,
        Number(before.defense),
        Number(before.speed) + 1000,
        before.talent,
      ),
    );
    // 综合评分仍是基础属性算出来的那一份。
    expect(top?.attributeScore).toBe(before.attributeScore);
  });

  it('天骄榜 · 装备榜（0032）：按装备战力加成排，带各部位品质，没穿装备的不上榜', async () => {
    const { fixture, now } = await frozenSect('eq-board-gear');
    const [full, single, bare] = fixture.discipleIds as [string, string, string];
    // full：一身仙品（+30%）；single：只穿一件灵品兵器（+4%）；bare：什么都不穿。
    for (const slot of ['weapon', 'armor', 'artifact']) {
      const item = await insertEquipment(fixture.sectId, {
        slot,
        quality: 'immortal',
        mainAttr: slot === 'weapon' ? 'attack' : slot === 'armor' ? 'defense' : 'speed',
        mainValue: 24,
        subAttr: 'luck',
        subValue: 8,
      });
      await equipItem(env.DB, fixture.userId, item, full, now);
    }
    const spiritWeapon = await insertEquipment(fixture.sectId, { quality: 'spirit', mainValue: 16 });
    await equipItem(env.DB, fixture.userId, spiritWeapon, single, now);

    const board = await listDiscipleLeaderboard(env.DB, fixture.userId);
    // 同一个库里其它用例也穿过装备，这里只看本宗门的三名弟子。
    const mine = board.byEquipment.filter((entry) => entry.sectId === fixture.sectId);
    expect(mine.map((entry) => entry.discipleId)).toEqual([full, single]);
    expect(board.byEquipment.some((entry) => entry.discipleId === bare)).toBe(false);
    expect(board.byEquipment.every((entry) => entry.gearPowerBonusBp > 0)).toBe(true);

    const [top, second] = mine as [(typeof mine)[number], (typeof mine)[number]];
    expect(top.gearPowerBonusBp).toBe(3000);
    expect(top.isMe).toBe(true);
    expect(top.gearSlots?.map((slot) => slot.quality)).toEqual(['immortal', 'immortal', 'immortal']);
    expect(top.gearSlots?.map((slot) => slot.slotName)).toEqual(['兵器', '护甲', '法器']);
    expect(second.gearPowerBonusBp).toBe(400);
    expect(second.gearSlots?.map((slot) => slot.quality)).toEqual(['spirit', null, null]);
    expect(second.gearSlots?.[1]?.color).toBeNull();
    // 名次连续、按加成降序。
    expect(board.byEquipment.map((entry) => entry.rank)).toEqual(
      board.byEquipment.map((_, index) => index + 1),
    );
    const bonuses = board.byEquipment.map((entry) => entry.gearPowerBonusBp);
    expect([...bonuses].sort((a, b) => b - a)).toEqual(bonuses);
    // 战力榜 / 综合榜不查装备表，不带部位明细。
    expect(board.byCombatPower.every((entry) => entry.gearSlots === undefined)).toBe(true);
  });

  it('挑战：战报里的每轮战力就是含装备的战力（攻方）', async () => {
    const attacker = await makeSect('eq-challenge-a');
    const defender = await makeSect('eq-challenge-b');
    const discipleId = attacker.discipleIds[0]!;
    const target = discipleOf(await attacker.state(), discipleId);
    const gear = { attack: 300, defense: 20, speed: 40 };
    await setGear(discipleId, gear);

    // Math.random = 0.5 → 浮动系数 1.0，战报里的数字就是账面战力。
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const challenged = await attacker.api.post('/api/v1/game/challenge', {
      targetSectId: defender.sectId,
      discipleIds: attacker.discipleIds,
    });
    expect(challenged.status).toBe(200);
    const rounds = (dataOf(challenged) as Record<string, any>).result.rounds as {
      attackerPower: number;
    }[];
    const expected = discipleCombatPower(
      target.realmId,
      Number(target.stage),
      Number(target.attack) + gear.attack,
      Number(target.defense) + gear.defense,
      Number(target.speed) + gear.speed,
      target.talent,
    );
    expect(rounds[0]?.attackerPower).toBe(expected);
    // 没穿装备时更低 —— 证明上面那个数字确实吃到了装备。
    expect(expected).toBeGreaterThan(
      discipleCombatPower(
        target.realmId,
        Number(target.stage),
        Number(target.attack),
        Number(target.defense),
        Number(target.speed),
        target.talent,
      ),
    );
  });

  it('世界 Boss：同一关、同一批弟子，穿上装备后这一次出手伤害更高', async () => {
    const sect = await makeSect('eq-boss');
    const discipleId = sect.discipleIds[0]!;
    const noon = dayAt(0, 12, 0);
    // Cron 先生成今天的第 1 关（12:00 在开放时段内）。
    await processWorldBoss(env.DB, noon);

    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const first = await attackWorldBoss(
      env.DB,
      sect.userId,
      { discipleIds: [discipleId] },
      noon + 60_000,
    );
    expect(first.result.members[0]?.outcome).toBe('normal');
    await setGear(discipleId, { attack: 300, defense: 100, speed: 100 });
    // 10 秒冷却之后同一名弟子再出手一次。
    const second = await attackWorldBoss(
      env.DB,
      sect.userId,
      { discipleIds: [discipleId] },
      noon + 120_000,
    );
    expect(second.result.damage).toBeGreaterThan(first.result.damage);
    expect(second.result.bossHp).toBeLessThan(first.result.bossHp);
  });

  it('历练不计入装备：受伤概率与额外收获只跟基础属性 / 幸运有关', async () => {
    const sect = await makeSect('eq-journey');
    const discipleId = sect.discipleIds[0]!;
    const now = dayAt(0, 12, 0);
    const snapshotOf = (preview: Awaited<ReturnType<typeof previewJourney>>) =>
      preview.directions.map((direction) => ({
        direction: direction.direction,
        durations: direction.durations.map((duration) => ({
          durationSeconds: duration.durationSeconds,
          cultivation: duration.cultivation,
          resources: duration.resources,
          extraChanceBp: duration.extraChanceBp,
          injuryChanceBp: duration.injuryChanceBp,
        })),
      }));

    const base = snapshotOf(await previewJourney(env.DB, sect.userId, discipleId, now));
    // 受伤概率与额外收获都要真的算过（不是 0 占位）。
    expect(base[0]?.durations[0]?.injuryChanceBp).toBeGreaterThan(0);
    expect(base[0]?.durations[0]?.extraChanceBp).toBeGreaterThan(0);

    // 巨量装备（含幸运 / 体魄）：如果历练读了装备，下面这一份必然与上面不同。
    await setGear(discipleId, {
      attack: 5000,
      defense: 5000,
      speed: 5000,
      luck: 80,
      physique: 60,
    });
    expect(snapshotOf(await previewJourney(env.DB, sect.userId, discipleId, now))).toEqual(base);

    // 对照：改**基础**幸运，额外收获概率必须跟着变（证明这份预览确实在按属性现算）。
    await env.DB.prepare('UPDATE disciples SET luck = 100 WHERE id = ?').bind(discipleId).run();
    const withBaseLuck = snapshotOf(await previewJourney(env.DB, sect.userId, discipleId, now));
    expect(withBaseLuck[0]?.durations[0]?.extraChanceBp).toBeGreaterThan(
      base[0]?.durations[0]?.extraChanceBp ?? 0,
    );
  });
});

/* ---------- 阶段二：接口测试用到的库级小工具 ---------- */

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

async function balanceOf(sectId: string, resourceId: string): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT balance FROM resource_balances WHERE sect_id = ? AND resource_id = ?',
  )
    .bind(sectId, resourceId)
    .first<{ balance: number }>();
  return Number(row?.balance ?? 0);
}

interface EquipmentRowFixture {
  id: string;
  disciple_id: string | null;
  slot: string;
  quality: string;
  name: string;
  main_attr: string;
  main_value: number;
  sub_attr: string;
  sub_value: number;
  source: string;
}

async function equipmentRows(sectId: string): Promise<EquipmentRowFixture[]> {
  const result = await env.DB.prepare(
    `SELECT id, disciple_id, slot, quality, name, main_attr, main_value, sub_attr, sub_value, source
       FROM equipment WHERE sect_id = ? ORDER BY created_at DESC, id DESC`,
  )
    .bind(sectId)
    .all<EquipmentRowFixture>();
  return result.results ?? [];
}

async function bagCountOf(sectId: string): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS total FROM equipment WHERE sect_id = ? AND disciple_id IS NULL',
  )
    .bind(sectId)
    .first<{ total: number }>();
  return Number(row?.total ?? 0);
}

interface GearBonusFixture {
  attack: number;
  defense: number;
  speed: number;
  luck: number;
  physique: number;
}

async function gearOf(discipleId: string): Promise<GearBonusFixture> {
  const row = await env.DB.prepare(
    `SELECT gear_attack, gear_defense, gear_speed, gear_luck, gear_physique
       FROM disciples WHERE id = ?`,
  )
    .bind(discipleId)
    .first<Record<string, number>>();
  return {
    attack: Number(row?.gear_attack ?? 0),
    defense: Number(row?.gear_defense ?? 0),
    speed: Number(row?.gear_speed ?? 0),
    luck: Number(row?.gear_luck ?? 0),
    physique: Number(row?.gear_physique ?? 0),
  };
}

/** 0032：弟子表上的装备战力加成列（基点）。 */
async function gearPowerBpOf(discipleId: string): Promise<number> {
  const row = await env.DB.prepare('SELECT gear_power_bp FROM disciples WHERE id = ?')
    .bind(discipleId)
    .first<{ gear_power_bp: number }>();
  return Number(row?.gear_power_bp ?? 0);
}

interface NewEquipmentFixture {
  discipleId?: string | null;
  slot?: string;
  quality?: string;
  mainAttr?: string;
  mainValue?: number;
  subAttr?: string;
  subValue?: number;
}

/** 直接入库一件装备（省去几十次炼器）；默认是背包里的凡品兵器。 */
async function insertEquipment(sectId: string, input: NewEquipmentFixture = {}): Promise<string> {
  const id = crypto.randomUUID();
  const slot = input.slot ?? 'weapon';
  await env.DB.prepare(
    `INSERT INTO equipment
       (id, sect_id, disciple_id, slot, quality, name, main_attr, main_value,
        sub_attr, sub_value, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'boss', ?)`,
  )
    .bind(
      id,
      sectId,
      input.discipleId ?? null,
      slot,
      input.quality ?? 'common',
      `测试·${id.slice(0, 8)}`,
      input.mainAttr ?? (slot === 'armor' ? 'defense' : 'attack'),
      input.mainValue ?? 4,
      input.subAttr ?? 'speed',
      input.subValue ?? 1,
      Date.now(),
    )
    .run();
  return id;
}

async function setSevereInjury(discipleId: string, until: number | null): Promise<void> {
  await env.DB.prepare('UPDATE disciples SET severe_injured_until = ? WHERE id = ?')
    .bind(until, discipleId)
    .run();
}

/** 造一条「仍未到期的历练」→ 该弟子在外（requireNotAway 会拦）。 */
async function sendJourney(fixture: SectFixture, discipleId: string, now: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO disciple_journeys
       (id, sect_id, disciple_id, disciple_name, direction, duration_seconds,
        original_assignment, started_at, ends_at, completed_at, claimed_at,
        reward_cultivation, reward_resources, extra_harvest, injured, injury_chance_bp,
        cultivation_awarded, created_at)
     VALUES (?, ?, ?, '在外弟子', 'gathering', 7200, 'idle', ?, ?, NULL, NULL,
             100, '{}', 0, 0, 0, NULL, ?)`,
  )
    .bind(crypto.randomUUID(), fixture.sectId, discipleId, now, now + 3_600_000, now)
    .run();
}

/**
 * 冻结结算窗口的宗门（炼器解锁 + 资源充足）：把 last_settled_at 设成用例自己的 now，
 * 服务调用也传同一个 now → 结算窗口恒为 0，资源断言只反映命令本身的收支。
 */
async function frozenSect(
  prefix: string,
  level = 2,
): Promise<{ fixture: SectFixture; now: number }> {
  const fixture = await makeSect(prefix);
  const now = dayAt(0, 12, 0);
  await setSectLevel(fixture.sectId, level);
  await env.DB.prepare('UPDATE sects SET last_settled_at = ? WHERE id = ?')
    .bind(now, fixture.sectId)
    .run();
  for (const resourceId of ['spiritStone', 'spiritualEnergy', 'herb', 'ore']) {
    await setBalance(fixture.sectId, resourceId, 5_000_000);
  }
  return { fixture, now };
}

describe('装备接口：炼器 / 背包（计划 1.3、1.5）', () => {
  it('路由与面板：GET /game/equipment 给解锁状态与背包信息，POST /game/forge-equipment 落库', async () => {
    const { fixture } = await frozenSect('eq-route');
    const panel = await fixture.api.get('/api/v1/game/equipment');
    expect(panel.status).toBe(200);
    const equipment = (dataOf(panel) as Record<string, any>).equipment as Record<string, any>;
    expect(equipment.unlocked).toBe(true);
    expect(equipment.blockedReason).toBeNull();
    expect(equipment.bagCount).toBe(0);
    expect(equipment.bagCapacity).toBe(50);
    expect(equipment.forgeCost).toEqual({ ore: '150000', spiritStone: '80000' });
    expect(equipment.forgeQualityName).toBe('凡品');
    expect((equipment.slots as { id: string }[]).map((slot) => slot.id)).toEqual([
      'weapon',
      'armor',
      'artifact',
    ]);
    expect((equipment.slots as { mainAttrChoices: unknown[] }[])[2]?.mainAttrChoices).toHaveLength(2);
    expect(equipment.salvageOre).toEqual({ common: 50, spirit: 120, treasure: 250, immortal: 500 });

    const forged = await fixture.api.post('/api/v1/game/forge-equipment', { slot: 'weapon' });
    expect(forged.status).toBe(200);
    expect((dataOf(forged) as Record<string, any>).outcome.quality).toBe('common');

    const after = (dataOf(await fixture.api.get('/api/v1/game/equipment')) as Record<string, any>)
      .equipment as Record<string, any>;
    expect(after.bagCount).toBe(1);
    const item = (after.items as Record<string, any>[])[0]!;
    expect(item.discipleId).toBeNull();
    expect(item.discipleName).toBeNull();
    expect(item.slotName).toBe('兵器');
    expect(item.qualityName).toBe('凡品');
    expect(item.color).toBe('#b9c0c9');
    expect(item.name.startsWith('凡品·')).toBe(true);
    expect(item.subAttr).not.toBe(item.mainAttr);
  });

  it('宗门 1 级未解锁：面板给出原因，炼器被拒', async () => {
    const { fixture, now } = await frozenSect('eq-locked', 1);
    const panel = await getEquipment(env.DB, fixture.userId, now);
    expect(panel.equipment.unlocked).toBe(false);
    expect(panel.equipment.blockedReason).toBe('炼器尚未开启，需要宗门 2 级');
    await expect(
      forgeEquipment(env.DB, fixture.userId, 'weapon', undefined, now),
    ).rejects.toMatchObject({
      code: 'INVALID_STATUS',
      message: '炼器尚未开启，需要宗门 2 级',
    });
  });

  it('炼器：扣矿石 150 + 灵石 80、必定凡品、进背包；法器必须选主属性', async () => {
    const { fixture, now } = await frozenSect('eq-forge');
    const oreBefore = await balanceOf(fixture.sectId, 'ore');
    const stoneBefore = await balanceOf(fixture.sectId, 'spiritStone');

    const forged = await forgeEquipment(env.DB, fixture.userId, 'artifact', 'luck', now);
    expect(forged.outcome.quality).toBe('common');
    expect(forged.outcome.slotName).toBe('法器');
    expect(forged.outcome.cost).toEqual({ ore: '150000', spiritStone: '80000' });
    expect(await balanceOf(fixture.sectId, 'ore')).toBe(oreBefore - 150_000);
    expect(await balanceOf(fixture.sectId, 'spiritStone')).toBe(stoneBefore - 80_000);

    const rows = await equipmentRows(fixture.sectId);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.disciple_id).toBeNull();
    expect(row.quality).toBe('common');
    expect(row.main_attr).toBe('luck');
    expect(row.main_value).toBe(8);
    expect(row.name.startsWith('凡品·')).toBe(true);
    expect(['attack', 'defense', 'speed', 'physique']).toContain(row.sub_attr);
    expect(row.sub_value).toBeGreaterThanOrEqual(2);
    expect(row.sub_value).toBeLessThanOrEqual(4);

    await expect(
      forgeEquipment(env.DB, fixture.userId, 'artifact', undefined, now),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      forgeEquipment(env.DB, fixture.userId, 'artifact', 'attack', now),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      forgeEquipment(env.DB, fixture.userId, 'weapon', 'luck', now),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      forgeEquipment(env.DB, fixture.userId, 'weird', undefined, now),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await equipmentRows(fixture.sectId)).toHaveLength(1);
    expect(await balanceOf(fixture.sectId, 'ore')).toBe(oreBefore - 150_000);
  });

  it('背包满（50 件）：不能炼器、不能卸下，但仍然可以换装', async () => {
    const { fixture, now } = await frozenSect('eq-full');
    const discipleId = fixture.discipleIds[0]!;
    for (let i = 0; i < 50; i += 1) {
      await insertEquipment(fixture.sectId);
    }
    const worn = await insertEquipment(fixture.sectId, { discipleId, mainValue: 8 });
    expect(await bagCountOf(fixture.sectId)).toBe(50);

    await expect(
      forgeEquipment(env.DB, fixture.userId, 'weapon', undefined, now),
    ).rejects.toMatchObject({
      code: 'INVALID_STATUS',
      message: '背包已满（50/50），请先分解',
    });
    await expect(unequipItem(env.DB, fixture.userId, worn, now)).rejects.toMatchObject({
      code: 'INVALID_STATUS',
      message: '背包已满（50/50），请先分解',
    });
    const bagItem = (await equipmentRows(fixture.sectId)).find((row) => row.disciple_id === null)!;
    await equipItem(env.DB, fixture.userId, bagItem.id, discipleId, now);
    expect(await bagCountOf(fixture.sectId)).toBe(50);
    expect((await equipmentRows(fixture.sectId)).find((row) => row.id === worn)!.disciple_id).toBeNull();
  });
});

describe('装备接口：穿戴 / 卸下 / 分解 / 驱逐（计划 1.5）', () => {
  it('穿戴 / 换装 / 跨弟子转移：6 列加成（含 0032 战力加成）按装备表重新求和', async () => {
    const { fixture, now } = await frozenSect('eq-equip');
    const [a, b] = fixture.discipleIds as [string, string];
    const weaponA = await insertEquipment(fixture.sectId, {
      mainValue: 4,
      subAttr: 'speed',
      subValue: 2,
    });
    const weaponB = await insertEquipment(fixture.sectId, {
      quality: 'treasure',
      mainValue: 12,
      subAttr: 'defense',
      subValue: 5,
    });

    const first = await equipItem(env.DB, fixture.userId, weaponA, a, now);
    expect(first.outcome.discipleId).toBe(a);
    expect(first.outcome.replacedName).toBeNull();
    expect(await gearOf(a)).toEqual({ attack: 4, defense: 0, speed: 2, luck: 0, physique: 0 });
    // 凡品 +2%
    expect(await gearPowerBpOf(a)).toBe(200);
    expect(first.state.disciples.find((item) => item.id === a)!.gearPowerBonusBp).toBe(200);
    expect(await bagCountOf(fixture.sectId)).toBe(1);

    const swapped = await equipItem(env.DB, fixture.userId, weaponB, a, now);
    expect(swapped.outcome.replacedName).toBe(`测试·${weaponA.slice(0, 8)}`);
    expect(await gearOf(a)).toEqual({ attack: 12, defense: 5, speed: 0, luck: 0, physique: 0 });
    // 换成宝品：+7%（按装备表重算，不是 200 + 700）
    expect(await gearPowerBpOf(a)).toBe(700);
    expect(
      (await equipmentRows(fixture.sectId)).find((row) => row.id === weaponA)!.disciple_id,
    ).toBeNull();
    expect(await bagCountOf(fixture.sectId)).toBe(1);

    await equipItem(env.DB, fixture.userId, weaponB, b, now);
    expect(await gearOf(a)).toEqual({ attack: 0, defense: 0, speed: 0, luck: 0, physique: 0 });
    expect(await gearOf(b)).toEqual({ attack: 12, defense: 5, speed: 0, luck: 0, physique: 0 });
    expect(await gearPowerBpOf(a)).toBe(0);
    expect(await gearPowerBpOf(b)).toBe(700);
    expect(await bagCountOf(fixture.sectId)).toBe(1);
    const bView = discipleOf(await fixture.state(), b);
    expect(bView.gear).toEqual({ attack: 12, defense: 5, speed: 0, luck: 0, physique: 0 });
    expect(bView.gearPowerBonusBp).toBe(700);
    expect(bView.combatPower).toBe(
      discipleCombatPower(
        bView.realmId,
        Number(bView.stage),
        Number(bView.attack) + 12,
        Number(bView.defense) + 5,
        Number(bView.speed),
        bView.talent,
        700,
      ),
    );

    await expect(equipItem(env.DB, fixture.userId, weaponB, b, now)).rejects.toMatchObject({
      code: 'INVALID_STATUS',
    });
    await expect(equipItem(env.DB, fixture.userId, 'missing-item', a, now)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('卸下：放回背包、加成清零', async () => {
    const { fixture, now } = await frozenSect('eq-unequip');
    const discipleId = fixture.discipleIds[0]!;
    const item = await insertEquipment(fixture.sectId, {
      mainValue: 4,
      subAttr: 'luck',
      subValue: 2,
    });
    await equipItem(env.DB, fixture.userId, item, discipleId, now);
    expect(await gearOf(discipleId)).toEqual({
      attack: 4,
      defense: 0,
      speed: 0,
      luck: 2,
      physique: 0,
    });

    const off = await unequipItem(env.DB, fixture.userId, item, now);
    expect(off.outcome.discipleId).toBeNull();
    expect(await gearOf(discipleId)).toEqual({
      attack: 0,
      defense: 0,
      speed: 0,
      luck: 0,
      physique: 0,
    });
    expect((await equipmentRows(fixture.sectId)).find((row) => row.id === item)!.disciple_id).toBeNull();
    await expect(unequipItem(env.DB, fixture.userId, item, now)).rejects.toMatchObject({
      code: 'INVALID_STATUS',
    });
  });

  it('在外历练 / 重伤卧床：不能穿、不能卸，也不能拿走他身上的装备', async () => {
    const { fixture, now } = await frozenSect('eq-block');
    const [a, b, c] = fixture.discipleIds as [string, string, string];
    const wornByA = await insertEquipment(fixture.sectId, { discipleId: a });
    const inBag = await insertEquipment(fixture.sectId);

    await setSevereInjury(a, now + 3 * DAY_MS);
    await expect(unequipItem(env.DB, fixture.userId, wornByA, now)).rejects.toMatchObject({
      code: 'INVALID_STATUS',
    });
    await expect(equipItem(env.DB, fixture.userId, wornByA, b, now)).rejects.toMatchObject({
      code: 'INVALID_STATUS',
    });
    await setSevereInjury(b, now + 3 * DAY_MS);
    await expect(equipItem(env.DB, fixture.userId, inBag, b, now)).rejects.toMatchObject({
      code: 'INVALID_STATUS',
    });
    const wornByC = await insertEquipment(fixture.sectId, { discipleId: c });
    await sendJourney(fixture, c, now);
    await expect(equipItem(env.DB, fixture.userId, inBag, c, now)).rejects.toMatchObject({
      code: 'INVALID_STATUS',
    });
    await expect(equipItem(env.DB, fixture.userId, wornByC, a, now)).rejects.toMatchObject({
      code: 'INVALID_STATUS',
    });
    const rows = await equipmentRows(fixture.sectId);
    expect(rows.find((row) => row.id === wornByA)!.disciple_id).toBe(a);
    expect(rows.find((row) => row.id === wornByC)!.disciple_id).toBe(c);
    expect(rows.find((row) => row.id === inBag)!.disciple_id).toBeNull();
    expect(await gearOf(a)).toEqual({ attack: 0, defense: 0, speed: 0, luck: 0, physique: 0 });
  });

  it('分解：返还矿石、重复 id 去重、穿着的不能分解', async () => {
    const { fixture, now } = await frozenSect('eq-salvage');
    const discipleId = fixture.discipleIds[0]!;
    const common = await insertEquipment(fixture.sectId, { quality: 'common' });
    const treasure = await insertEquipment(fixture.sectId, { quality: 'treasure' });
    const oreBefore = await balanceOf(fixture.sectId, 'ore');

    const salvaged = await salvageEquipment(env.DB, fixture.userId, [common, treasure, common], now);
    expect(salvaged.outcome.count).toBe(2);
    expect(salvaged.outcome.ore).toBe(50_000 + 250_000);
    expect(await balanceOf(fixture.sectId, 'ore')).toBe(oreBefore + 300_000);
    expect(await equipmentRows(fixture.sectId)).toHaveLength(0);

    const worn = await insertEquipment(fixture.sectId, { discipleId });
    await expect(salvageEquipment(env.DB, fixture.userId, [worn], now)).rejects.toMatchObject({
      code: 'INVALID_STATUS',
    });
    await expect(
      salvageEquipment(env.DB, fixture.userId, ['missing-item'], now),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await equipmentRows(fixture.sectId)).toHaveLength(1);
    expect(await balanceOf(fixture.sectId, 'ore')).toBe(oreBefore + 300_000);
  });

  it('驱逐弟子：装备全部回背包，超出 50 件的部分自动分解成矿石', async () => {
    const { fixture, now } = await frozenSect('eq-expel');
    const discipleId = fixture.discipleIds[0]!;
    // 背包先占 49 件，他身上 3 件：按（部位 → id）排序，第一件进背包，其余两件自动分解。
    for (let i = 0; i < 49; i += 1) {
      await insertEquipment(fixture.sectId);
    }
    const weapon = await insertEquipment(fixture.sectId, {
      discipleId,
      slot: 'weapon',
      quality: 'treasure',
      mainAttr: 'attack',
      mainValue: 12,
      subAttr: 'defense',
      subValue: 5,
    });
    await insertEquipment(fixture.sectId, { discipleId, slot: 'armor', mainAttr: 'defense' });
    await insertEquipment(fixture.sectId, { discipleId, slot: 'artifact', mainAttr: 'luck' });
    expect(await bagCountOf(fixture.sectId)).toBe(49);

    const oreBefore = await balanceOf(fixture.sectId, 'ore');
    const result = await expelDisciple(env.DB, fixture.userId, discipleId, now);
    expect(result.outcome.equipmentReturned).toBe(1);
    // 自动分解的是护甲与法器两件**凡品**：50 + 50 展示单位 = 100000 最小单位。
    expect(result.outcome.salvagedOre).toBe(100_000);
    expect(await bagCountOf(fixture.sectId)).toBe(50);
    expect(await balanceOf(fixture.sectId, 'ore')).toBe(oreBefore + result.outcome.salvagedOre);
    const rows = await equipmentRows(fixture.sectId);
    expect(rows).toHaveLength(50);
    expect(rows.find((row) => row.id === weapon)!.disciple_id).toBeNull();
    expect(rows.filter((row) => row.slot === 'armor')).toHaveLength(0);
    expect(rows.filter((row) => row.slot === 'artifact')).toHaveLength(0);
  });
});

/* ---------- 阶段三：世界 Boss 掉落的夹具 ---------- */

async function insertBoss(input: {
  dayKey: string;
  now: number;
  stage?: number;
  roundDamage?: number;
  maxHp?: number;
  hp?: number;
  status?: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  const maxHp = input.maxHp ?? 1_000_000;
  await env.DB.prepare(
    `INSERT INTO world_bosses
       (id, day_key, stage, boss_index, affix, round_damage, max_hp, hp, status,
        killer_sect_id, half_announced, rewarded_at, created_at, ended_at)
     VALUES (?, ?, ?, 0, 'ironclad', ?, ?, ?, ?, NULL, 0, NULL, ?, NULL)`,
  )
    .bind(
      id,
      input.dayKey,
      input.stage ?? 1,
      input.roundDamage ?? 20_000,
      maxHp,
      input.hp ?? maxHp,
      input.status ?? 'active',
      input.now,
    )
    .run();
  return id;
}

async function systemMessages(): Promise<string[]> {
  const result = await env.DB.prepare(
    "SELECT content FROM chat_messages WHERE user_id = 'system'",
  ).all<{ content: string }>();
  return (result.results ?? []).map((row) => row.content);
}

/**
 * 两个宗门打同一关并把它打死：A 派 1 人（伤害低）、B 派 3 人补刀（总伤害更高 → 排名第 1）。
 * 随机源固定成 randomValue，掉落判定就跟着它走（三期：两家各自按 √占比 判高档，未中再判低档）：
 * 随机数 0 时两家都掉高档；0.99 同时高于高档与低档阈值 → 两家都不掉。
 */
async function killBossWithTwoSects(input: {
  prefix: string;
  dayOffset: number;
  stage: number;
  randomValue: number;
}): Promise<{ first: SectFixture; second: SectFixture; now: number }> {
  const first = await makeSect(`${input.prefix}-a`);
  const second = await makeSect(`${input.prefix}-b`);
  const now = dayAt(input.dayOffset, 10);
  const dayKey = dateKeyUtc8(now);
  vi.spyOn(Math, 'random').mockReturnValue(input.randomValue);

  const bossId = await insertBoss({
    dayKey,
    now,
    stage: input.stage,
    maxHp: 10_000_000,
    roundDamage: 20_000,
  });
  const hit = await attackWorldBoss(
    env.DB,
    first.userId,
    { discipleIds: [first.discipleIds[0]!] },
    now,
  );
  // 把血量压到「A 打完之后只剩 1 点」→ B 的那一刀必定打死，且总伤害一定高于 A。
  await env.DB.prepare('UPDATE world_bosses SET hp = ? WHERE id = ?')
    .bind(hit.result.actualDamage + 1, bossId)
    .run();
  const killing = await attackWorldBoss(
    env.DB,
    second.userId,
    { discipleIds: second.discipleIds },
    now,
  );
  expect(killing.result.lastHit).toBe(true);
  // 连战会顺手开出下一关，删掉以免 Cron 把它一起处理。
  await env.DB.prepare('DELETE FROM world_bosses WHERE day_key = ? AND stage = ?')
    .bind(dayKey, input.stage + 1)
    .run();
  await processWorldBoss(env.DB, dayAt(input.dayOffset, 14));
  return { first, second, now };
}

describe('世界 Boss 装备掉落（三期 2.1：人人有份）', () => {
  it('击杀掉落：每个参与宗门按 √伤害占比各自判定 —— 随机数 0 时两家都掉高档', async () => {
    // 第 2 关的高档是灵品：随机数 0 小于两家的高档概率（75% × √占比）→ 两家各掉 1 件灵品。
    const { first, second } = await killBossWithTwoSects({
      prefix: 'drop',
      dayOffset: 40,
      stage: 2,
      randomValue: 0,
    });

    const firstItems = await equipmentRows(first.sectId);
    expect(firstItems).toHaveLength(1);
    expect(firstItems[0]!.quality).toBe('spirit');
    expect(firstItems[0]!.source).toBe('boss');
    expect(firstItems[0]!.disciple_id).toBeNull();
    expect(firstItems[0]!.name.startsWith('灵品·')).toBe(true);
    // 副属性区间与主属性不同（与规则测试同一口径）。
    expect(firstItems[0]!.sub_attr).not.toBe(firstItems[0]!.main_attr);

    const secondItems = await equipmentRows(second.sectId);
    expect(secondItems).toHaveLength(1);
    expect(secondItems[0]!.quality).toBe('spirit');
    expect(secondItems[0]!.name.startsWith('灵品·')).toBe(true);

    // 只发一次：再跑两次 Cron 不会重复掉落。
    await processWorldBoss(env.DB, dayAt(40, 15));
    await processWorldBoss(env.DB, dayAt(40, 16));
    expect(await equipmentRows(first.sectId)).toHaveLength(1);
    expect(await equipmentRows(second.sectId)).toHaveLength(1);
  });

  it('随机数 0.99 同时高于高档与低档阈值：两家都不掉', async () => {
    const { first, second } = await killBossWithTwoSects({
      prefix: 'drop-miss',
      dayOffset: 41,
      stage: 2,
      randomValue: 0.99,
    });
    expect(await equipmentRows(first.sectId)).toHaveLength(0);
    expect(await equipmentRows(second.sectId)).toHaveLength(0);
  });

  it('击退（23:00 逃走且血量掉 ≥70%）不掉装备', async () => {
    const sect = await makeSect('drop-flee');
    const now = dayAt(42, 12, 0);
    const dayKey = dateKeyUtc8(now);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const bossId = await insertBoss({ dayKey, now, stage: 1, maxHp: 1_000_000, roundDamage: 20_000 });
    await attackWorldBoss(env.DB, sect.userId, { discipleIds: [sect.discipleIds[0]!] }, now);
    // 模拟别的宗门把它打到剩 20% 血：逃走时按「已击退」处理（资源 ×0.5），但一件装备都不掉。
    await env.DB.prepare('UPDATE world_bosses SET hp = ? WHERE id = ?').bind(200_000, bossId).run();
    await processWorldBoss(env.DB, dayAt(42, 23, 30));

    expect(await equipmentRows(sect.sectId)).toHaveLength(0);
    expect((await systemMessages()).some((text) => text.includes('获得 '))).toBe(false);
  });
});

describe('世界 Boss 掉落：仙品广播与背包已满', () => {
  /** 单宗门打死指定关卡（Boss 只剩 100 血，一击必杀）。 */
  async function killBossSolo(input: {
    prefix: string;
    dayOffset: number;
    stage: number;
  }): Promise<SectFixture> {
    const sect = await makeSect(input.prefix);
    const now = dayAt(input.dayOffset, 10);
    const dayKey = dateKeyUtc8(now);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    await insertBoss({ dayKey, now, stage: input.stage, maxHp: 1_000_000, hp: 100, roundDamage: 20_000 });
    const killed = await attackWorldBoss(
      env.DB,
      sect.userId,
      { discipleIds: [sect.discipleIds[0]!] },
      now,
    );
    expect(killed.result.lastHit).toBe(true);
    await env.DB.prepare('DELETE FROM world_bosses WHERE day_key = ? AND stage = ?')
      .bind(dayKey, input.stage + 1)
      .run();
    await processWorldBoss(env.DB, dayAt(input.dayOffset, 14));
    return sect;
  }

  it('第 5 关及以上掉仙品，并额外全服广播一次（只播一次）', async () => {
    const sect = await killBossSolo({ prefix: 'drop-immortal', dayOffset: 43, stage: 5 });
    const rows = await equipmentRows(sect.sectId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.quality).toBe('immortal');
    expect(rows[0]!.name.startsWith('仙品·')).toBe(true);

    const gains = (await systemMessages()).filter((text) =>
      text.includes(`获得 ${rows[0]!.name}！`),
    );
    expect(gains).toHaveLength(1);
    expect(gains[0]).toContain('【讨伐】');

    await processWorldBoss(env.DB, dayAt(43, 15));
    await processWorldBoss(env.DB, dayAt(43, 16));
    expect(await equipmentRows(sect.sectId)).toHaveLength(1);
    expect(
      (await systemMessages()).filter((text) => text.includes(`获得 ${rows[0]!.name}！`)),
    ).toHaveLength(1);
  });

  it('背包已满：这一件自动分解成对应品质的矿石（装备不丢、背包不超 50）', async () => {
    const sect = await makeSect('drop-full');
    for (let i = 0; i < 50; i += 1) {
      await insertEquipment(sect.sectId);
    }
    // 同一个文件里前面已经有仙品广播，所以这里比的是「获得」类消息的**增量**。
    const gainsBefore = (await systemMessages()).filter((text) => text.includes('获得 ')).length;
    const now = dayAt(44, 10);
    const dayKey = dateKeyUtc8(now);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    await insertBoss({ dayKey, now, stage: 3, maxHp: 1_000_000, hp: 100, roundDamage: 20_000 });
    const killed = await attackWorldBoss(
      env.DB,
      sect.userId,
      { discipleIds: [sect.discipleIds[0]!] },
      now,
    );
    expect(killed.result.lastHit).toBe(true);
    await env.DB.prepare('DELETE FROM world_bosses WHERE day_key = ? AND stage = 4')
      .bind(dayKey)
      .run();
    const oreBefore = await balanceOf(sect.sectId, 'ore');

    await processWorldBoss(env.DB, dayAt(44, 14));

    // 第 3 关第 1 名的掉落品质是宝品 → 分解返还 250 展示单位 = 250000 最小单位。
    expect(await equipmentRows(sect.sectId)).toHaveLength(50);
    expect(await bagCountOf(sect.sectId)).toBe(50);
    expect((await balanceOf(sect.sectId, 'ore')) - oreBefore).toBeGreaterThanOrEqual(250_000);
    expect((await systemMessages()).filter((text) => text.includes('获得 ')).length).toBe(
      gainsBefore,
    );
  });
});

describe('复核修复回归：守卫分片 / 内存回写 / 秘境与切磋战力', () => {
  it('分解 50 件（= 背包满的主动线）不再撞 D1 单条语句参数上限，且入账的矿石立刻出现在返回的 state 里', async () => {
    const { fixture, now } = await frozenSect('eq-salvage50');
    const ids: string[] = [];
    for (let i = 0; i < 50; i += 1) {
      ids.push(await insertEquipment(fixture.sectId));
    }
    const oreBefore = await balanceOf(fixture.sectId, 'ore');
    const salvaged = await salvageEquipment(env.DB, fixture.userId, ids, now);

    expect(salvaged.outcome.count).toBe(50);
    expect(salvaged.outcome.ore).toBe(50_000 * 50);
    expect(await equipmentRows(fixture.sectId)).toHaveLength(0);
    expect(await balanceOf(fixture.sectId, 'ore')).toBe(oreBefore + 2_500_000);
    // 返回的 state 立刻带上入账后的矿石（内存余额与写库语句同批更新）。
    const oreView = (salvaged.state.resources as { id: string; balance: string }[]).find(
      (resource) => resource.id === 'ore',
    );
    expect(Number(oreView?.balance)).toBe(oreBefore + 2_500_000);
  });

  it('穿戴 / 卸下返回的 state 立刻是新加成与新战力（不用等下一次 sync）', async () => {
    const { fixture, now } = await frozenSect('eq-inview');
    const discipleId = fixture.discipleIds[0]!;
    const before = discipleOf(await fixture.state(), discipleId);
    const item = await insertEquipment(fixture.sectId, {
      mainValue: 12,
      subAttr: 'speed',
      subValue: 5,
    });

    const equipped = await equipItem(env.DB, fixture.userId, item, discipleId, now);
    const after = discipleOf(equipped.state, discipleId);
    expect(after.gear).toEqual({ attack: 12, defense: 0, speed: 5, luck: 0, physique: 0 });
    // 0032：凡品另有 +2% 战力加成。
    expect(after.gearPowerBonusBp).toBe(200);
    expect(after.combatPower).toBe(
      discipleCombatPower(
        before.realmId,
        Number(before.stage),
        Number(before.attack) + 12,
        Number(before.defense),
        Number(before.speed) + 5,
        before.talent,
        200,
      ),
    );

    const off = await unequipItem(env.DB, fixture.userId, item, now);
    const unloaded = discipleOf(off.state, discipleId);
    expect(unloaded.gear).toEqual({ attack: 0, defense: 0, speed: 0, luck: 0, physique: 0 });
    expect(unloaded.combatPower).toBe(before.combatPower);
  });

  it('秘境速通（/game/explore）的成功率计入装备', async () => {
    const { fixture, now } = await frozenSect('eq-explore', 1);
    const discipleId = fixture.discipleIds[0]!;
    const plain = await exploreSectRealm(env.DB, fixture.userId, 'mistyForest', [discipleId], now);

    // 速通有受伤判定（本地随机），先清掉再测第二次，免得「正在疗伤」把用例变脆。
    await env.DB.prepare(
      `UPDATE disciples SET gear_attack = 4000, gear_defense = 4000, gear_speed = 4000,
                           injured_until = NULL
        WHERE id = ?`,
    )
      .bind(discipleId)
      .run();
    const geared = await exploreSectRealm(env.DB, fixture.userId, 'mistyForest', [discipleId], now);
    expect(geared.result.chanceBp).toBeGreaterThan(plain.result.chanceBp);
    expect(geared.result.chanceBp).toBeGreaterThan(plain.result.chanceBp);
  });

  it('切磋（/game/parry）的双方战力计入装备', async () => {
    const { fixture, now } = await frozenSect('eq-spar');
    const mine = fixture.discipleIds[0]!;
    const other = await makeSect('eq-spar-b');
    const view = discipleOf(await fixture.state(), mine);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    await env.DB.prepare(
      `UPDATE disciples SET gear_attack = 300, gear_defense = 40, gear_speed = 60 WHERE id = ?`,
    )
      .bind(mine)
      .run();

    const spar = await sparWithSect(
      env.DB,
      fixture.userId,
      other.sectId,
      mine,
      other.discipleIds[0]!,
      now,
    );
    // Math.random = 0.5 → 浮动系数 1.0，账面战力就是战报里的战力。
    expect(spar.result.myPower).toBe(
      discipleCombatPower(
        view.realmId,
        Number(view.stage),
        Number(view.attack) + 300,
        Number(view.defense) + 40,
        Number(view.speed) + 60,
        view.talent,
      ),
    );
  });
});

describe('装备二期：炼器坊 · 玄铁', () => {
  async function addWorkshop(sectId: string, level: number): Promise<void> {
    await env.DB.prepare(
      'INSERT INTO buildings (id, sect_id, def_id, level, created_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(crypto.randomUUID(), sectId, 'forgeWorkshop', level, Date.now())
      .run();
  }

  it('炼器坊 1 级炼不了灵品；宗门等级不够不能升级；升到 2 级后可炼灵品并扣玄铁', async () => {
    const { fixture, now } = await frozenSect('eq-v2-forge');
    await addWorkshop(fixture.sectId, 1);
    await setBalance(fixture.sectId, 'xuantie', 50_000);

    await expect(forgeEquipment(env.DB, fixture.userId, 'weapon', undefined, now, 'spirit')).rejects.toMatchObject({
      code: 'INVALID_STATUS',
    });
    // 宗门 2 级：升炼器坊 2 级需要宗门 3 级
    await expect(upgradeBuilding(env.DB, fixture.userId, 'forgeWorkshop', now)).rejects.toMatchObject({
      code: 'INVALID_STATUS',
    });

    await setSectLevel(fixture.sectId, 3);
    await upgradeBuilding(env.DB, fixture.userId, 'forgeWorkshop', now);
    expect(await balanceOf(fixture.sectId, 'xuantie')).toBe(35_000);

    // 固定随机数：0.99 → 判定为成功（失败 / 降级都在低区间）
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const forged = await forgeEquipment(env.DB, fixture.userId, 'weapon', undefined, now, 'spirit');
    random.mockRestore();
    expect(forged.outcome.result).toBe('success');
    expect(forged.outcome.quality).toBe('spirit');
    expect(await balanceOf(fixture.sectId, 'xuantie')).toBe(32_000);
    const panel = await getEquipment(env.DB, fixture.userId, now);
    expect(panel.equipment.workshopLevel).toBe(2);
    expect(panel.equipment.forgeOptions.map((option) => option.unlocked)).toEqual([true, true, false, false]);
  });

  it('炼器失败：不出装备，返还一半灵石与矿石，玄铁全损', async () => {
    const { fixture, now } = await frozenSect('eq-v2-fail');
    await addWorkshop(fixture.sectId, 2);
    await setBalance(fixture.sectId, 'xuantie', 10_000);
    const stoneBefore = await balanceOf(fixture.sectId, 'spiritStone');
    const oreBefore = await balanceOf(fixture.sectId, 'ore');
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    const result = await forgeEquipment(env.DB, fixture.userId, 'armor', undefined, now, 'spirit');
    random.mockRestore();
    expect(result.outcome.result).toBe('fail');
    expect(result.outcome.equipmentId).toBeNull();
    expect(await bagCountOf(fixture.sectId)).toBe(0);
    expect(await balanceOf(fixture.sectId, 'spiritStone')).toBe(stoneBefore - 125_000);
    expect(await balanceOf(fixture.sectId, 'ore')).toBe(oreBefore - 200_000);
    expect(await balanceOf(fixture.sectId, 'xuantie')).toBe(7_000);
  });

  it('分解灵品返还玄铁', async () => {
    const { fixture, now } = await frozenSect('eq-v2-salvage');
    await setBalance(fixture.sectId, 'xuantie', 0);
    const itemId = await insertEquipment(fixture.sectId, { quality: 'spirit' });
    const result = await salvageEquipment(env.DB, fixture.userId, [itemId], now);
    expect(result.outcome.xuantie).toBe(1000);
    expect(await balanceOf(fixture.sectId, 'xuantie')).toBe(1000);
  });
});
