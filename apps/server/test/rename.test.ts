import { applyD1Migrations, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { prepareStatements } from '../src/infra/db/repository';
import {
  DISCIPLE_NAME_MAX_CHARS,
  DISCIPLE_NAME_MIN_CHARS,
  DISCIPLE_RENAME_COST,
  SECT_NAME_MAX_CHARS,
  SECT_NAME_MIN_CHARS,
  SECT_RENAME_COST,
} from '../src/modules/game/names';
import { resourceDeltaStatement } from '../src/modules/game/repository';

import { dataOf, errorOf, TestClient, type ApiResult } from './support/authClient';

/**
 * 0021：宗门改名 / 弟子改名（消耗灵石）+ 宗门名全局唯一 + 去掉「每日招募 3 人上限」。
 *
 * 存储说明：本文件一份独立内存 D1，没有逐用例回滚 —— 每个用例用独立账号/宗门
 * （前缀 + 递增序号），涉及余额/人数的断言都按宗门 id 定界。
 *
 * 确定性说明：把 sects.last_settled_at 拨到未来（时钟回拨 → durationMs = 0 → 零产出、
 * 零随机事件），余额变化才只可能来自被断言的那条命令。每条要断言「恰好扣 N 灵石」的
 * 命令之前都会重新拨一次：一次成功提交会把 last_settled_at 写回 now，此后毫秒级产出
 * 会以余数累积，久了「恰好」就说不清了。
 *
 * 契约说明：价格与长度规则是前后端共用的契约（names.ts ↔ view.RenameView ↔ 前端字数
 * 提示），所以既断言响应里的字面量，也断言同一份后端常量（两处漂移会让提示与校验打架）。
 */

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

const quietLogger = { info: () => {}, warn: () => {}, error: () => {} } as const;
const app = createApp({ logger: quietLogger });
const PASSWORD = 'password-123456';

/** 弟子可历练的最低境界（journey.ts 的 JOURNEY_MIN_REALM_ID）。 */
const FOUNDATION = 'foundationEstablishment';

/** 余额补足目标（灵石最小单位，1 展示单位 = 1000 最小单位）：够改名 + 连招若干次。 */
const RICH = 1_000_000;

let seq = 0;

interface RenameFixture {
  api: TestClient;
  sectId: string;
  /** 建宗时的弟子 id（顺序即 created_at 顺序）。 */
  discipleIds: string[];
  state: () => Promise<Record<string, any>>;
  renameSect: (name: string) => Promise<ApiResult>;
  renameDisciple: (discipleId: string, name: string) => Promise<ApiResult>;
}

async function makeSect(prefix: string): Promise<RenameFixture> {
  seq += 1;
  const account = `${prefix}-${seq}`;
  const api = new TestClient(app, env, { 'cf-connecting-ip': `10.14.${Math.floor(seq / 250)}.${seq % 250}` });

  const registered = await api.post('/api/v1/auth/register', { account, password: PASSWORD });
  expect(registered.status).toBe(200);
  const created = await api.post('/api/v1/game/create-sect', { name: `改炼${String(seq)}宗` });
  expect(created.status).toBe(200);

  const data = dataOf(created) as Record<string, any>;
  const sectId = data.state.sect.id as string;
  const discipleIds = (data.state.disciples as { id: string }[]).map((disciple) => disciple.id);

  // 建宗后立刻拨到未来：后续用例默认就在「零产出」状态下做精确余额断言。
  await freezeSettlement(sectId);

  return {
    api,
    sectId,
    discipleIds,
    state: async () => {
      const result = await api.get('/api/v1/game/sync');
      expect(result.status).toBe(200);
      return (dataOf(result) as Record<string, any>).state as Record<string, any>;
    },
    renameSect: (name) => api.post('/api/v1/game/rename-sect', { name }),
    renameDisciple: (discipleId, name) => api.post('/api/v1/game/rename-disciple', { discipleId, name }),
  };
}

/* ---------- 直接读写库的断言辅助（断言按宗门 id 定界） ---------- */

/** 把 last_settled_at 拨到未来：下一次结算 elapsed = 0，零产出零事件。 */
async function freezeSettlement(sectId: string): Promise<void> {
  await env.DB.prepare('UPDATE sects SET last_settled_at = ? WHERE id = ?')
    .bind(Date.now() + 60_000, sectId)
    .run();
}

/** 把上一次结算时间拨到 msAgo 毫秒之前：用来证伪「显式早退」（真提交必然推进它）。 */
async function ageSettlement(sectId: string, msAgo: number): Promise<void> {
  await env.DB.prepare('UPDATE sects SET last_settled_at = ? WHERE id = ?')
    .bind(Date.now() - msAgo, sectId)
    .run();
}

async function lastSettledAt(sectId: string): Promise<number> {
  const row = await env.DB.prepare('SELECT last_settled_at FROM sects WHERE id = ?')
    .bind(sectId)
    .first<{ last_settled_at: number }>();
  return Number(row?.last_settled_at ?? 0);
}

/** 灵石余额（最小单位）：D1 是唯一真相，视图里的字符串只是渲染口径。 */
async function spiritStoneOf(sectId: string): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT balance FROM resource_balances WHERE sect_id = ? AND resource_id = ?',
  )
    .bind(sectId, 'spiritStone')
    .first<{ balance: number }>();
  return Number(row?.balance ?? -1);
}

/**
 * 用仓储语句把灵石补足 / 调整到 target：走 resourceDeltaStatement + prepareStatements +
 * DB.batch，与生产扣减同一条 SQL 路径（不用裸 UPDATE 直接改余额）。
 * 行不存在时 delta 会静默无效，所以这里读回校验一次，避免「以为补上了」。
 */
async function setSpiritStoneTo(sectId: string, target: number): Promise<void> {
  const current = await spiritStoneOf(sectId);
  expect(current, '宗门应有灵石余额行').toBeGreaterThanOrEqual(0);
  if (current !== target) {
    await env.DB.batch(
      prepareStatements(env.DB, [
        resourceDeltaStatement(sectId, 'spiritStone', target - current, Date.now()),
      ]),
    );
  }
  expect(await spiritStoneOf(sectId)).toBe(target);
}

async function sectNameOf(sectId: string): Promise<string> {
  const row = await env.DB.prepare('SELECT name FROM sects WHERE id = ?')
    .bind(sectId)
    .first<{ name: string }>();
  return row?.name ?? '';
}

async function discipleNameOf(discipleId: string): Promise<string> {
  const row = await env.DB.prepare('SELECT name FROM disciples WHERE id = ?')
    .bind(discipleId)
    .first<{ name: string }>();
  return row?.name ?? '';
}

/**
 * 直接插入一名可历练的弟子（绕过招募成本与容量）：出发要求门内至少留 3 人
 * （journey.ts 的 JOURNEY_MIN_DISCIPLES_AT_HOME），建宗只有 3 人，必须补到 4 人。
 */
async function seedJourneyDisciple(sectId: string, name: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO disciples
       (id, sect_id, name, gender, aptitude, attack, defense, speed, luck, physique, talent,
        realm_id, stage, cultivation, cultivation_remainder, assignment, injured_until,
        body_tempering_count, note, created_at)
     VALUES (?, ?, ?, 'male', 50, 50, 50, 50, 50, 50, 'combat', ?, 1, 0, 0, 'idle', NULL, 0, '', ?)`,
  )
    .bind(id, sectId, name, FOUNDATION, Date.now())
    .run();
  return id;
}

/** 该弟子未领取的历练记录（历史姓名快照 + 领取状态）。 */
async function journeyRowOf(
  discipleId: string,
): Promise<{ disciple_name: string; claimed_at: number | null } | null> {
  const row = await env.DB.prepare(
    'SELECT disciple_name, claimed_at FROM disciple_journeys WHERE disciple_id = ?',
  )
    .bind(discipleId)
    .first<{ disciple_name: string; claimed_at: number | null }>();
  return row ?? null;
}

async function recruitCounter(sectId: string): Promise<{ dateKey: string; count: number }> {
  const row = await env.DB.prepare('SELECT recruit_date_key, recruit_count FROM sects WHERE id = ?')
    .bind(sectId)
    .first<{ recruit_date_key: string; recruit_count: number }>();
  return { dateKey: row?.recruit_date_key ?? '', count: Number(row?.recruit_count ?? 0) };
}

/* ---------- 建宗重名（0021：预检 + sects_name_uniq 唯一索引） ---------- */

/**
 * 注册一个还没有宗门的新账号，用给定名字建宗并断言被拒（STATE_CONFLICT），
 * 再换一个合法名字建宗成功：证明「被拒时没有留下半个宗门」。
 */
async function expectCreateSectRejected(takenName: string): Promise<void> {
  seq += 1;
  const api = new TestClient(app, env, {
    'cf-connecting-ip': `10.16.${Math.floor(seq / 250)}.${seq % 250}`,
  });
  const registered = await api.post('/api/v1/auth/register', {
    account: `founding-taken-${seq}`,
    password: PASSWORD,
  });
  expect(registered.status).toBe(200);

  const rejected = await api.post('/api/v1/game/create-sect', { name: takenName });
  expect(errorOf(rejected).code, `建宗重名应被拒：${takenName}`).toBe('STATE_CONFLICT');

  const ok = await api.post('/api/v1/game/create-sect', { name: `补名${String(seq)}宗` });
  expect(ok.status).toBe(200);
}

/* ---------- 宗门改名 ---------- */

describe('0021 宗门改名：扣 500 灵石、重名拒绝、校验与幂等', () => {
  it('改名成功：trim 后写回 sects.name，灵石恰好扣 500000（最小单位）', async () => {
    const sect = await makeSect('rename-sect-ok');
    await setSpiritStoneTo(sect.sectId, RICH);

    const newName = '苍梧清宗';
    const balanceBefore = await spiritStoneOf(sect.sectId);

    // 冻结结算后再提交：余额变化只可能来自这次改名（不多扣、也不少扣）。
    await freezeSettlement(sect.sectId);
    const result = await sect.renameSect(`  ${newName}  `);

    expect(result.status).toBe(200);
    const state = (dataOf(result) as Record<string, any>).state as Record<string, any>;
    // 服务端 trim：返回的名字就是最终落库的名字（前后空白不会当成名字的一部分）。
    expect(state.sect.name).toBe(newName);
    expect(await sectNameOf(sect.sectId)).toBe(newName);
    // 恰好 500000：把展示单位当最小单位（少扣 1000 倍）或按字节收费都会在这里挂。
    expect(await spiritStoneOf(sect.sectId)).toBe(balanceBefore - 500_000);
    expect(SECT_RENAME_COST).toBe(500_000);
  });

  it('灵石不足：返回 INSUFFICIENT_RESOURCE，名字与余额都不变', async () => {
    const sect = await makeSect('rename-sect-poor');
    // 差 1 个最小单位（499999 < 500000）：边界上必须拒绝，且不能「先扣再报错」半写。
    await setSpiritStoneTo(sect.sectId, SECT_RENAME_COST - 1);
    const nameBefore = await sectNameOf(sect.sectId);

    await freezeSettlement(sect.sectId);
    const result = await sect.renameSect('倾家荡产宗');

    expect(errorOf(result).code).toBe('INSUFFICIENT_RESOURCE');
    expect(await sectNameOf(sect.sectId)).toBe(nameBefore);
    expect(await spiritStoneOf(sect.sectId)).toBe(SECT_RENAME_COST - 1);
  });

  it('非法名字：空串 / 1 字 / 13 字 / 换行 / 控制字符都是 VALIDATION_ERROR 且不扣费', async () => {
    const sect = await makeSect('rename-sect-invalid');
    await setSpiritStoneTo(sect.sectId, RICH);
    const nameBefore = await sectNameOf(sect.sectId);
    const balanceBefore = await spiritStoneOf(sect.sectId);

    const badNames = [
      '', // trim 后长度为 0（低于下限）
      '一', // 1 个码点（低于下限 2）
      '一'.repeat(13), // 13 个码点（高于上限 12）
      '前\n后', // 换行：UI 单行 input 造不出来，接口必须挡住
      '前\u0001后', // C0 控制字符
      '   ', // 纯空白：trim 后等同空串
    ];
    for (const bad of badNames) {
      await freezeSettlement(sect.sectId);
      const result = await sect.renameSect(bad);
      expect(errorOf(result).code, `名字 ${JSON.stringify(bad)} 应被拒`).toBe('VALIDATION_ERROR');
      // 归一化 / 校验都发生在扣费之前：非法名字一个最小单位都不能留下痕迹。
      expect(await spiritStoneOf(sect.sectId)).toBe(balanceBefore);
      expect(await sectNameOf(sect.sectId)).toBe(nameBefore);
    }
  });

  it('幂等：同名提交 → 200 且连结算写回都不发生（反证：换个名字会推进 last_settled_at）', async () => {
    const sect = await makeSect('rename-sect-idempotent');
    await setSpiritStoneTo(sect.sectId, RICH);
    const current = await sectNameOf(sect.sectId);

    // 把上次结算拨到 1 小时前：只要这次真的走了提交路径，就一定会结算这 1 小时的产出
    // 并把 last_settled_at 推到 now —— 只看「余额没变」区分不了「显式早退」与「空操作照常提交」。
    await ageSettlement(sect.sectId, 3_600_000);
    const settledAtBefore = await lastSettledAt(sect.sectId);
    const balanceBefore = await spiritStoneOf(sect.sectId);

    const repeated = await sect.renameSect(`  ${current}  `);
    expect(repeated.status).toBe(200);
    expect((dataOf(repeated) as Record<string, any>).state.sect.name).toBe(current);
    expect(await spiritStoneOf(sect.sectId)).toBe(balanceBefore);
    expect(await lastSettledAt(sect.sectId)).toBe(settledAtBefore);

    // 反证：同样的「一小时未结算」状态下换个名字，写回立刻发生。
    const renamed = await sect.renameSect('刷新名字宗');
    expect(renamed.status).toBe(200);
    expect(await lastSettledAt(sect.sectId)).not.toBe(settledAtBefore);
    expect(await sectNameOf(sect.sectId)).toBe('刷新名字宗');
  });

  it('重名被拒：A 宗改成 B 宗的名字 → STATE_CONFLICT，名字与余额都不变（不扣费）', async () => {
    const first = await makeSect('rename-dup-a');
    const second = await makeSect('rename-dup-b');
    await setSpiritStoneTo(first.sectId, RICH);

    const taken = await sectNameOf(second.sectId);
    const ownBefore = await sectNameOf(first.sectId);
    await freezeSettlement(first.sectId);
    const balanceBefore = await spiritStoneOf(first.sectId);

    const result = await first.renameSect(taken);

    // 0021：宗门名全局唯一（预检给文案 + sects_name_uniq 唯一索引兜底）。
    expect(errorOf(result).code).toBe('STATE_CONFLICT');
    // 查重在扣费之前：被占用时一个灵石都不动。
    expect(await spiritStoneOf(first.sectId)).toBe(balanceBefore);
    expect(await sectNameOf(first.sectId)).toBe(ownBefore);

    // 前后空白不影响判定：trim 后与占用者的名字相同，同样是冲突。
    await freezeSettlement(first.sectId);
    expect(errorOf(await first.renameSect(`  ${taken}  `)).code).toBe('STATE_CONFLICT');
    expect(await sectNameOf(first.sectId)).toBe(ownBefore);
  });

  it('重名判定是 BINARY 口径：大小写不同视为不同名字（与索引口径一致）', async () => {
    const lower = await makeSect('rename-case-lower');
    const upper = await makeSect('rename-case-upper');
    // 两个宗门都要先有 500 灵石，否则先改的那个会以 INSUFFICIENT_RESOURCE（也是 409）失败。
    await setSpiritStoneTo(lower.sectId, RICH);
    await setSpiritStoneTo(upper.sectId, RICH);

    // 先把 lower 改成全小写英文名，再把 upper 改成同名但大写不同——两者应当都能落库。
    await freezeSettlement(lower.sectId);
    expect((await lower.renameSect('qingyun')).status).toBe(200);
    await freezeSettlement(upper.sectId);
    expect((await upper.renameSect('QingYun')).status).toBe(200);

    expect(await sectNameOf(lower.sectId)).toBe('qingyun');
    expect(await sectNameOf(upper.sectId)).toBe('QingYun');
  });

  it('建宗也查重：用已有宗门名建宗 → STATE_CONFLICT，且库里仍只有一行这个名字', async () => {
    const existing = await makeSect('founding-taken');
    const taken = await sectNameOf(existing.sectId);

    // 另起一个账号（还没建宗）：拿已占用的名字建宗必须被拒，且失败后仍可换名字建宗（不留半个宗门）。
    await expectCreateSectRejected(taken);
    await expectCreateSectRejected(`  ${taken}  `);

    const rows = await env.DB.prepare('SELECT COUNT(*) AS c FROM sects WHERE name = ?')
      .bind(taken)
      .first<{ c: number }>();
    expect(Number(rows?.c ?? 0)).toBe(1);
  });
});

/* ---------- 弟子改名 ---------- */

describe('0021 弟子改名：扣 50 灵石、长度规则、归属与历史快照', () => {
  it('改名成功：state.disciples 里姓名更新，灵石恰好扣 50000，且不误伤其他弟子', async () => {
    const sect = await makeSect('rename-disciple-ok');
    await setSpiritStoneTo(sect.sectId, RICH);

    const target = sect.discipleIds[0] as string;
    const others = await Promise.all(
      sect.discipleIds.slice(1).map(async (id) => ({ id, name: await discipleNameOf(id) })),
    );
    const balanceBefore = await spiritStoneOf(sect.sectId);

    await freezeSettlement(sect.sectId);
    const result = await sect.renameDisciple(target, '  凌霜客  ');

    expect(result.status).toBe(200);
    const state = (dataOf(result) as Record<string, any>).state as Record<string, any>;
    const view = (state.disciples as Record<string, any>[]).find((item) => item.id === target);
    expect(view?.name).toBe('凌霜客');
    expect(await discipleNameOf(target)).toBe('凌霜客');
    expect(await spiritStoneOf(sect.sectId)).toBe(balanceBefore - 50_000);
    expect(DISCIPLE_RENAME_COST).toBe(50_000);

    // 单列写回：同宗其他弟子的姓名一个字都不改。
    for (const other of others) {
      expect(await discipleNameOf(other.id)).toBe(other.name);
    }
  });

  it('弟子名按 Unicode 码点限 2~6：2 字 / 6 字 / 4 个星平面字符成功，7 字拒绝，同名不扣费', async () => {
    const sect = await makeSect('rename-disciple-length');
    await setSpiritStoneTo(sect.sectId, RICH);
    const target = sect.discipleIds[0] as string;

    // 下限边界：2 个码点成功。
    await freezeSettlement(sect.sectId);
    let balanceBefore = await spiritStoneOf(sect.sectId);
    expect((await sect.renameDisciple(target, '甲乙')).status).toBe(200);
    expect(await discipleNameOf(target)).toBe('甲乙');
    expect(await spiritStoneOf(sect.sectId)).toBe(balanceBefore - DISCIPLE_RENAME_COST);

    // 上限边界：6 个码点成功。
    await freezeSettlement(sect.sectId);
    balanceBefore = await spiritStoneOf(sect.sectId);
    expect((await sect.renameDisciple(target, '丙丁戊己庚辛')).status).toBe(200);
    expect(await discipleNameOf(target)).toBe('丙丁戊己庚辛');
    expect(await spiritStoneOf(sect.sectId)).toBe(balanceBefore - DISCIPLE_RENAME_COST);

    // 口径是「码点」不是「UTF-16 单元」：4 个星平面字符 = 8 个 UTF-16 单元、只有 4 个码点，
    // 按码点必须放行（否则前端字数提示与后端校验会错位）。
    const astral = '𝔞𝔟𝔠𝔡';
    expect([...astral].length).toBe(4);
    await freezeSettlement(sect.sectId);
    balanceBefore = await spiritStoneOf(sect.sectId);
    expect((await sect.renameDisciple(target, astral)).status).toBe(200);
    expect(await discipleNameOf(target)).toBe(astral);
    expect(await spiritStoneOf(sect.sectId)).toBe(balanceBefore - DISCIPLE_RENAME_COST);

    // 越界：7 个码点 → VALIDATION_ERROR，一分不扣、名字不变。
    await freezeSettlement(sect.sectId);
    balanceBefore = await spiritStoneOf(sect.sectId);
    expect(errorOf(await sect.renameDisciple(target, '七'.repeat(7))).code).toBe('VALIDATION_ERROR');
    expect(await discipleNameOf(target)).toBe(astral);
    expect(await spiritStoneOf(sect.sectId)).toBe(balanceBefore);

    // 幂等：改成同名 → 200，不花 50 灵石买空操作。
    await freezeSettlement(sect.sectId);
    balanceBefore = await spiritStoneOf(sect.sectId);
    const same = await sect.renameDisciple(target, ` ${astral} `);
    expect(same.status).toBe(200);
    const sameState = (dataOf(same) as Record<string, any>).state as Record<string, any>;
    const sameView = (sameState.disciples as Record<string, any>[]).find((item) => item.id === target);
    expect(sameView?.name).toBe(astral);
    expect(await spiritStoneOf(sect.sectId)).toBe(balanceBefore);
  });

  it('不存在的 discipleId 与非本宗弟子都返回 NOT_FOUND，且两个宗门余额/姓名都不变', async () => {
    const owner = await makeSect('rename-owner');
    const stranger = await makeSect('rename-stranger');
    await setSpiritStoneTo(owner.sectId, RICH);
    await setSpiritStoneTo(stranger.sectId, RICH);

    const victim = owner.discipleIds[0] as string;
    const victimName = await discipleNameOf(victim);

    await freezeSettlement(owner.sectId);
    const ownerBalance = await spiritStoneOf(owner.sectId);

    const unknown = await owner.renameDisciple('no-such-disciple-id', '查无此人');
    expect(errorOf(unknown).code).toBe('NOT_FOUND');
    expect(await spiritStoneOf(owner.sectId)).toBe(ownerBalance);

    // 跨宗：B 拿着 A 的弟子 id 改名必须无法命中（不能改到别人门下的弟子）。
    await freezeSettlement(stranger.sectId);
    const strangerBalance = await spiritStoneOf(stranger.sectId);
    const cross = await stranger.renameDisciple(victim, '越权改名');
    expect(errorOf(cross).code).toBe('NOT_FOUND');

    expect(await discipleNameOf(victim)).toBe(victimName);
    expect(await spiritStoneOf(stranger.sectId)).toBe(strangerBalance);
    expect(await spiritStoneOf(owner.sectId)).toBe(ownerBalance);
  });

  it('历练中也能改名（200），但 disciple_journeys.disciple_name 仍是旧名（历史快照不回填）', async () => {
    const sect = await makeSect('rename-journey');
    await setSpiritStoneTo(sect.sectId, RICH);

    // 出发要求门内至少留 3 人，建宗只有 3 人 → 直接补一名筑基弟子凑到 4 人。
    const traveler = await seedJourneyDisciple(sect.sectId, '远行者甲');
    await freezeSettlement(sect.sectId);

    // 方向 / 时长取 journey.ts 白名单里的合法值（JOURNEY_DIRECTIONS × JOURNEY_DURATIONS_SECONDS）：
    // 采集 2 小时，对境界没有额外门槛（访道还要求当前阶段有剩余修为门槛）。
    const started = await sect.api.post('/api/v1/game/start-journey', {
      discipleId: traveler,
      direction: 'gathering',
      durationSeconds: 7_200,
    });
    expect(started.status).toBe(200);

    const journey = await journeyRowOf(traveler);
    expect(journey, '出发后应落一条 disciple_journeys 记录').not.toBeNull();
    expect(journey?.disciple_name).toBe('远行者甲');
    expect(journey?.claimed_at).toBeNull();

    const newName = '归途客';
    await freezeSettlement(sect.sectId);
    const balanceBefore = await spiritStoneOf(sect.sectId);
    const renamed = await sect.renameDisciple(traveler, newName);

    // 在外历练不挡改名（与私有备注 / 头像框一致：allowActiveJourney）。
    expect(renamed.status).toBe(200);
    const state = (dataOf(renamed) as Record<string, any>).state as Record<string, any>;
    const view = (state.disciples as Record<string, any>[]).find((item) => item.id === traveler);
    expect(view?.name).toBe(newName);
    expect(await discipleNameOf(traveler)).toBe(newName);
    expect(await spiritStoneOf(sect.sectId)).toBe(balanceBefore - DISCIPLE_RENAME_COST);

    // 快照不回填：历练记录里的姓名是出发当时的名字，改名只影响此后的展示。
    const after = await journeyRowOf(traveler);
    expect(after?.disciple_name).toBe('远行者甲');
    // 改名不结束、也不领取这次历练。
    expect(after?.claimed_at).toBeNull();
  });

  it('弟子重名仍然允许：同宗两名弟子可以同名（0021 只约束宗门名）', async () => {
    const sect = await makeSect('rename-disciple-dup');
    await setSpiritStoneTo(sect.sectId, RICH);
    const [first, second] = sect.discipleIds;

    // 唯一索引只建在 sects.name 上：门内重名是有意保留的（改名、招募都不查重）。
    await freezeSettlement(sect.sectId);
    expect((await sect.renameDisciple(first as string, '同名人')).status).toBe(200);
    await freezeSettlement(sect.sectId);
    expect((await sect.renameDisciple(second as string, '同名人')).status).toBe(200);

    const rows = await env.DB.prepare(
      'SELECT COUNT(*) AS c FROM disciples WHERE sect_id = ? AND name = ?',
    )
      .bind(sect.sectId, '同名人')
      .first<{ c: number }>();
    expect(Number(rows?.c ?? 0)).toBe(2);
  });
});

/* ---------- 招募：每日上限已去掉 ---------- */

describe('0021 招募已无每日上限：弟子上限是唯一门槛', () => {
  it('同一天连续招募 6 次全部 200（老逻辑第 4 次会 DAILY_LIMIT），招满后只剩「弟子上限已满」', async () => {
    const sect = await makeSect('recruit-no-daily-limit');
    await setSpiritStoneTo(sect.sectId, RICH);

    // 先按公开接口驱逐建宗自带的 3 人：1 级宗门弟子上限 6 人，腾空后才能在同一天连招 ≥4 次，
    // 「第 4 次仍然成功」才真正落在被改掉的旧逻辑上（旧逻辑按 UTC+8 自然日计数）。
    for (const discipleId of sect.discipleIds) {
      await freezeSettlement(sect.sectId);
      const expelled = await sect.api.post('/api/v1/game/expel-disciple', { discipleId });
      expect(expelled.status).toBe(200);
    }

    for (let index = 0; index < 6; index += 1) {
      // 每次招募前重新预览拿最新 batch（招募成功后旧批次立即失效）。
      const preview = await sect.api.get('/api/v1/game/recruit-preview');
      expect(preview.status).toBe(200);
      const previewData = dataOf(preview) as Record<string, any>;
      expect(previewData.canRecruit, `第 ${String(index + 1)} 次招募前应可招募`).toBe(true);
      expect(previewData.blockedReason).toBeNull();

      await freezeSettlement(sect.sectId);
      const result = await sect.api.post('/api/v1/game/recruit', {
        choice: 0,
        batch: previewData.batch as string,
      });
      // 关键断言：第 4 次及以后仍然是 200 —— 旧逻辑（每日 3 次）在这里会返回 DAILY_LIMIT。
      expect(result.status, `第 ${String(index + 1)} 次招募`).toBe(200);

      const state = (dataOf(result) as Record<string, any>).state as Record<string, any>;
      const recruitView = state.recruit as Record<string, any>;
      // remaining = 弟子上限 − 现有人数：只按人数算，与"今天招了几个"无关。
      expect(recruitView.remaining).toBe(recruitView.discipleCapacity - recruitView.discipleCount);
      // RecruitView 里不再有每日上限字段。
      expect('dailyLimit' in recruitView).toBe(false);
      expect('usedToday' in recruitView).toBe(false);

      if (index === 5) {
        expect(recruitView.discipleCount).toBe(recruitView.discipleCapacity);
        expect(recruitView.remaining).toBe(0);
        expect(recruitView.canRecruit).toBe(false);
        expect(recruitView.blockedReason).toBe('弟子上限已满');
      }
    }

    // 满员后预览同样只报「弟子上限已满」（不是每日次数用尽）。
    const blockedPreview = await sect.api.get('/api/v1/game/recruit-preview');
    const blockedData = dataOf(blockedPreview) as Record<string, any>;
    expect(blockedData.canRecruit).toBe(false);
    expect(blockedData.blockedReason).toBe('弟子上限已满');

    // D1 旁证：这一天的招募计数确实走到了 6（旧逻辑根本到不了 6）。
    expect((await recruitCounter(sect.sectId)).count).toBe(6);
  });
});

/* ---------- 契约 ---------- */

describe('0021 改名契约：价格与长度规则随 state 下发', () => {
  it('state.rename 的价格（灵石最小单位字符串）与长度规则与 names.ts 常量一致', async () => {
    const sect = await makeSect('rename-contract');
    const state = await sect.state();
    const rename = state.rename as Record<string, unknown>;

    // 前端不复制常量：价格用最小单位字符串（1 展示单位 = 1000），长度按 Unicode 码点。
    expect(rename.sectCost).toBe('500000');
    expect(rename.discipleCost).toBe('50000');
    expect(rename.sectNameMinChars).toBe(2);
    expect(rename.sectNameMaxChars).toBe(12);
    expect(rename.discipleNameMinChars).toBe(2);
    expect(rename.discipleNameMaxChars).toBe(6);

    // 同一份契约在后端常量里也必须成立（两处漂移会让前端字数提示与后端校验打架）。
    expect(String(SECT_RENAME_COST)).toBe('500000');
    expect(String(DISCIPLE_RENAME_COST)).toBe('50000');
    expect(`${String(SECT_NAME_MIN_CHARS)}-${String(SECT_NAME_MAX_CHARS)}`).toBe('2-12');
    expect(`${String(DISCIPLE_NAME_MIN_CHARS)}-${String(DISCIPLE_NAME_MAX_CHARS)}`).toBe('2-6');

    // 招贤面板也不再下发每日上限字段（0021 之后的视图契约）。
    const recruitView = state.recruit as Record<string, unknown>;
    expect('dailyLimit' in recruitView).toBe(false);
    expect('usedToday' in recruitView).toBe(false);
    expect(recruitView.remaining).toBe(
      (recruitView.discipleCapacity as number) - (recruitView.discipleCount as number),
    );
  });
});

/* ---------- 建宗与改名同一套名称口径（0021 一致性修复） ---------- */

describe('0021 建宗名称口径：按 Unicode 码点算（与改名一致）', () => {
  /** 注册一个还没有宗门的新账号，返回它的客户端。 */
  async function freshClient(prefix: string): Promise<TestClient> {
    seq += 1;
    const api = new TestClient(app, env, { 'cf-connecting-ip': `10.15.${Math.floor(seq / 250)}.${seq % 250}` });
    const registered = await api.post('/api/v1/auth/register', {
      account: `${prefix}-${seq}`,
      password: PASSWORD,
    });
    expect(registered.status).toBe(200);
    return api;
  }

  it('7 个星平面字符（7 码点 / 14 个 UTF-16 单元）建宗成功，且名字先 trim 再落库', async () => {
    const api = await freshClient('founding-astral');
    const astral = '𝔞𝔟𝔠𝔡𝔢𝔣𝔤';
    // 旧的 zod 口径（.max(12) 数 UTF-16 单元）会按 14 单元拒掉这个名字；
    // 改名按码点放行，建宗也必须放行，否则同一字段两套口径。
    expect([...astral].length).toBe(7);
    expect(astral.length).toBe(14);

    const created = await api.post('/api/v1/game/create-sect', { name: `  ${astral}  ` });
    expect(created.status).toBe(200);
    const state = (dataOf(created) as Record<string, any>).state as Record<string, any>;
    expect(state.sect.name).toBe(astral);
  });

  it('建宗的非法名字与改名同一套判定：空串 / 1 字 / 13 字 / 换行 / 控制字符，且失败不留半个宗门', async () => {
    const badNames = ['', '一', '一'.repeat(13), '前\n后', '前\u0001后'];
    for (const bad of badNames) {
      const api = await freshClient('founding-bad');
      const created = await api.post('/api/v1/game/create-sect', { name: bad });
      expect(errorOf(created).code, `名字 ${JSON.stringify(bad)} 应被拒`).toBe('VALIDATION_ERROR');

      // 没有被拒后写坏的状态：同一个账号换合法名字立刻能建宗（否则就是半写）。
      const retry = await api.post('/api/v1/game/create-sect', { name: `补救${String(seq)}宗` });
      expect(retry.status).toBe(200);
    }
  });
});
