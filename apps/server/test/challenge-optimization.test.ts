import { applyD1Migrations, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { REWARD_TIERS } from '../src/modules/game/challenge';

import { dataOf, errorOf, TestClient, type ApiResult } from './support/authClient';

/**
 * 宗门挑战优化（0012）：每日 3 次、等级差奖励、自动守擂、并发保护与旧数据兼容。
 *
 * 存储说明：本文件一份独立内存 D1，没有逐用例回滚 —— 每个用例用独立账号/宗门
 * （前缀递增），涉及计数的断言都按宗门 id 定界。
 *
 * 确定性说明：结算时间拨到未来（时钟回拨 → 零产出零事件）保证次数/资源断言精确；
 * 攻方弟子金丹三阶 + 满属性（战力 ~180），守方弟子炼气一层 + 1 属性（战力 ~10），
 * ±15% 战力浮动不会翻转胜负，胜/负完全确定。
 */

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

const quietLogger = { info: () => {}, warn: () => {}, error: () => {} } as const;
const app = createApp({ logger: quietLogger });
const PASSWORD = 'password-123456';
const TODAY = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);

let seq = 0;

interface SectFixture {
  api: TestClient;
  sectId: string;
  discipleIds: string[];
  userId: string;
  state: () => Promise<Record<string, any>>;
}

/** 注册 + 建宗门；返回宗门 id、弟子 id 与同步读取函数。 */
async function makeSect(prefix: string): Promise<SectFixture> {
  seq += 1;
  const account = `${prefix}-${seq}`;
  const api = new TestClient(app, env, {
    'cf-connecting-ip': `10.8.${Math.floor(seq / 250)}.${seq % 250}`,
  });
  const registered = await api.post('/api/v1/auth/register', { account, password: PASSWORD });
  expect(registered.status).toBe(200);
  const userIdRow = await env.DB.prepare('SELECT id FROM users WHERE normalized_account = ?')
    .bind(account)
    .first<{ id: string }>();
  const created = await api.post('/api/v1/game/create-sect', { name: `宗门${seq}号` });
  expect(created.status).toBe(200);
  const state = dataOf(created) as Record<string, any>;
  return {
    api,
    sectId: state.state.sect.id as string,
    discipleIds: (state.state.disciples as { id: string }[]).map((d) => d.id),
    userId: userIdRow!.id,
    state: async () => {
      const result = await api.get('/api/v1/game/sync');
      expect(result.status).toBe(200);
      return (dataOf(result) as Record<string, any>).state;
    },
  };
}

/** 把结算时间拨到未来：挑战流程内的结算变成零产出零事件，完全确定。 */
async function freezeSettlement(sectId: string): Promise<void> {
  await env.DB.prepare('UPDATE sects SET last_settled_at = ? WHERE id = ?')
    .bind(Date.now() + 60_000, sectId)
    .run();
}

async function setSectLevel(sectId: string, level: number): Promise<void> {
  await env.DB.prepare('UPDATE sects SET level = ? WHERE id = ?').bind(level, sectId).run();
}

/** 攻方配置：金丹三阶满属性（确定性获胜）。 */
async function makeStrong(sectId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE disciples SET realm_id = 'goldenCore', stage = 3, attack = 100, defense = 100, speed = 100,
       injured_until = NULL WHERE sect_id = ?`,
  )
    .bind(sectId)
    .run();
}

/** 守方配置：炼气一层 1 属性（确定性落败）。 */
async function makeWeak(sectId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE disciples SET realm_id = 'qiRefining', stage = 1, attack = 1, defense = 1, speed = 1
     WHERE sect_id = ?`,
  )
    .bind(sectId)
    .run();
}

/** 反转：守方强、攻方弱 → 攻方确定性落败。 */
async function makeStrongDefender(sectId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE disciples SET realm_id = 'goldenCore', stage = 3, attack = 100, defense = 100, speed = 100
     WHERE sect_id = ?`,
  )
    .bind(sectId)
    .run();
}

async function challenge(
  attacker: SectFixture,
  defenderSectId: string,
  discipleIds?: string[],
): Promise<ApiResult> {
  return attacker.api.post('/api/v1/game/challenge', {
    targetSectId: defenderSectId,
    discipleIds: discipleIds ?? attacker.discipleIds.slice(0, 3),
  });
}

async function challengeCount(sectId: string): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT challenge_count FROM sects WHERE id = ?',
  )
    .bind(sectId)
    .first<{ challenge_count: number }>();
  return Number(row?.challenge_count ?? 0);
}

async function challengeLogRows(attackerSectId: string, defenderSectId?: string): Promise<Record<string, any>[]> {
  const sql = defenderSectId === undefined
    ? 'SELECT * FROM challenge_log WHERE attacker_sect_id = ? ORDER BY created_at'
    : 'SELECT * FROM challenge_log WHERE attacker_sect_id = ? AND defender_sect_id = ? ORDER BY created_at';
  const params = defenderSectId === undefined ? [attackerSectId] : [attackerSectId, defenderSectId];
  const out = await env.DB.prepare(sql).bind(...params).all<Record<string, any>>();
  return out.results ?? [];
}

async function reputationOf(sectId: string): Promise<number> {
  const row = await env.DB.prepare('SELECT reputation FROM sects WHERE id = ?')
    .bind(sectId)
    .first<{ reputation: number }>();
  return Number(row?.reputation ?? 0);
}

describe('挑战优化：等级差奖励档位（胜利）', () => {
  const CASES: { diff: number; tier: string; reputation: number; spiritStone: number }[] = [
    { diff: -3, tier: 'lower_3_plus_no_reward', reputation: 0, spiritStone: 0 },
    { diff: -2, tier: 'lower_2', reputation: 5, spiritStone: 50_000 },
    { diff: -1, tier: 'lower_1', reputation: 8, spiritStone: 75_000 },
    { diff: 0, tier: 'equal', reputation: 10, spiritStone: 100_000 },
    { diff: 1, tier: 'higher_1', reputation: 13, spiritStone: 125_000 },
    { diff: 2, tier: 'higher_2', reputation: 15, spiritStone: 150_000 },
    { diff: 3, tier: 'higher_3_plus', reputation: 20, spiritStone: 200_000 },
  ];

  for (const testCase of CASES) {
    it(`等级差 ${testCase.diff >= 0 ? '+' : ''}${testCase.diff} → 档位 ${testCase.tier}`, async () => {
      const defenderLevel = 5;
      const attackerLevel = defenderLevel - testCase.diff;
      expect(attackerLevel).toBeGreaterThanOrEqual(1);
      expect(attackerLevel).toBeLessThanOrEqual(10);

      const attacker = await makeSect('rw-atk');
      const defender = await makeSect('rw-def');
      await Promise.all([
        setSectLevel(attacker.sectId, attackerLevel),
        setSectLevel(defender.sectId, defenderLevel),
        makeStrong(attacker.sectId),
        makeWeak(defender.sectId),
        freezeSettlement(attacker.sectId),
      ]);

      const result = await challenge(attacker, defender.sectId);
      expect(result.status).toBe(200);
      const data = dataOf(result) as Record<string, any>;

      // 响应结果：胜 + 档位奖励（零奖励胜利也算胜）
      expect(data.result.result).toBe('win');
      expect(data.result.attackerLevel).toBe(attackerLevel);
      expect(data.result.defenderLevel).toBe(defenderLevel);
      expect(data.result.levelDifference).toBe(testCase.diff);
      expect(data.result.rewardTier).toBe(testCase.tier);
      expect(data.result.defenseMode).toBe('automatic');
      expect(data.result.reputationGained).toBe(testCase.reputation);
      expect(data.result.spiritStoneGained).toBe(testCase.spiritStone);

      // state 同步：声望/灵石/剩余次数
      expect(data.state.sect.reputation).toBe(testCase.reputation);
      const spiritStone = (data.state.resources as { id: string; balance: string }[]).find(
        (r) => r.id === 'spiritStone',
      );
      expect(Number(spiritStone?.balance)).toBe(200_000 + testCase.spiritStone);
      expect(data.state.challenge).toEqual({ dailyLimit: 3, usedToday: 1, remaining: 2 });

      // 数据库：计数 1、日志快照一致、奖励最多发一次
      expect(await challengeCount(attacker.sectId)).toBe(1);
      const logs = await challengeLogRows(attacker.sectId, defender.sectId);
      expect(logs).toHaveLength(1);
      expect(logs[0]?.reward_tier).toBe(testCase.tier);
      expect(Number(logs[0]?.attacker_level)).toBe(attackerLevel);
      expect(Number(logs[0]?.defender_level)).toBe(defenderLevel);
      expect(logs[0]?.defense_mode).toBe('automatic');
      expect(logs[0]?.challenge_date_key).toBe(TODAY);
      expect(Number(logs[0]?.reputation_gained)).toBe(testCase.reputation);
      expect(await reputationOf(attacker.sectId)).toBe(testCase.reputation);
    });
  }
});

describe('挑战优化：每日 3 次与跨日重置', () => {
  it('前 3 场受理、第 4 场拒绝；失败不产生半写', async () => {
    const attacker = await makeSect('lim-atk');
    await makeStrong(attacker.sectId);
    await freezeSettlement(attacker.sectId);

    const defenders: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const defender = await makeSect(`lim-def-${index}`);
      await makeWeak(defender.sectId);
      defenders.push(defender.sectId);
    }

    for (let index = 0; index < 3; index += 1) {
      const result = await challenge(attacker, defenders[index]!);
      expect(result.status).toBe(200);
      const data = dataOf(result) as Record<string, any>;
      expect(data.state.challenge.remaining).toBe(2 - index);
    }
    expect(await challengeCount(attacker.sectId)).toBe(3);
    expect(await challengeLogRows(attacker.sectId)).toHaveLength(3);

    const fourth = await challenge(attacker, defenders[3]!);
    expect(fourth.status).toBe(409);
    expect(errorOf(fourth).code).toBe('DAILY_LIMIT');
    expect(await challengeCount(attacker.sectId)).toBe(3);
    expect(await challengeLogRows(attacker.sectId)).toHaveLength(3);

    const state = await attacker.state();
    expect(state.challenge).toEqual({ dailyLimit: 3, usedToday: 3, remaining: 0 });
  });

  it('失败也消耗 1 次（确定性落败），奖励 0', async () => {
    const attacker = await makeSect('lose-atk');
    const defender = await makeSect('lose-def');
    await makeWeak(attacker.sectId);
    await makeStrongDefender(defender.sectId);
    await freezeSettlement(attacker.sectId);

    const result = await challenge(attacker, defender.sectId);
    expect(result.status).toBe(200);
    const data = dataOf(result) as Record<string, any>;
    expect(data.result.result).toBe('lose');
    expect(data.result.reputationGained).toBe(0);
    expect(data.result.spiritStoneGained).toBe(0);
    expect(data.result.message).toContain('无奖励，已消耗 1 次挑战');
    // 档位仍按开战等级差记录
    expect(data.result.rewardTier).toBe(rewardTierOf(data.result.levelDifference));
    expect(data.state.challenge.usedToday).toBe(1);
    expect(await challengeCount(attacker.sectId)).toBe(1);
    expect(await reputationOf(attacker.sectId)).toBe(0);
  });

  it('UTC+8 跨日重置：旧日期键的已用 3 次不影响新的一天', async () => {
    const attacker = await makeSect('day-atk');
    const defender = await makeSect('day-def');
    await makeStrong(attacker.sectId);
    await makeWeak(defender.sectId);
    await freezeSettlement(attacker.sectId);
    await env.DB.prepare(
      "UPDATE sects SET challenge_date_key = '2020-01-01', challenge_count = 3 WHERE id = ?",
    )
      .bind(attacker.sectId)
      .run();

    // 旧日期键 → 当日使用量归 0（兼容核对也没有今天的旧日志）
    const state = await attacker.state();
    expect(state.challenge).toEqual({ dailyLimit: 3, usedToday: 0, remaining: 3 });

    const result = await challenge(attacker, defender.sectId);
    expect(result.status).toBe(200);
    expect(await challengeCount(attacker.sectId)).toBe(1);
    const row = await env.DB.prepare('SELECT challenge_date_key FROM sects WHERE id = ?')
      .bind(attacker.sectId)
      .first<{ challenge_date_key: string }>();
    expect(row?.challenge_date_key).toBe(TODAY);
  });

  it('前置校验失败不消耗次数', async () => {
    const attacker = await makeSect('val-atk');
    const defender = await makeSect('val-def');
    await makeStrong(attacker.sectId);
    await freezeSettlement(attacker.sectId);

    // 目标不存在
    const missing = await challenge(attacker, crypto.randomUUID());
    expect(missing.status).toBe(404);
    // 挑战自己
    const self = await challenge(attacker, attacker.sectId);
    expect(errorOf(self).code).toBe('VALIDATION_ERROR');
    // 攻方阵容人数不对
    const twoIds = await challenge(attacker, defender.sectId, attacker.discipleIds.slice(0, 2));
    expect(errorOf(twoIds).code).toBe('VALIDATION_ERROR');
    // 攻方弟子受伤
    await env.DB.prepare('UPDATE disciples SET injured_until = ? WHERE id = ?')
      .bind(Date.now() + 600_000, attacker.discipleIds[0])
      .run();
    const injured = await challenge(attacker, defender.sectId);
    expect(errorOf(injured).code).toBe('INVALID_STATUS');
    // 守方弟子不足 3 人
    await env.DB.prepare(
      "DELETE FROM disciples WHERE sect_id = ? AND id NOT IN (?, ?)",
    )
      .bind(defender.sectId, defender.discipleIds[0], defender.discipleIds[1])
      .run();
    const insufficient = await challenge(attacker, defender.sectId);
    expect(errorOf(insufficient).code).toBe('INVALID_STATUS');

    // 全部失败：次数 0、无日志
    expect(await challengeCount(attacker.sectId)).toBe(0);
    expect(await challengeLogRows(attacker.sectId)).toHaveLength(0);
    const state = await attacker.state();
    expect(state.challenge.usedToday).toBe(0);
  });

  it('同一目标当日第二次被拒绝且不多扣次数', async () => {
    const attacker = await makeSect('dup-atk');
    const defender = await makeSect('dup-def');
    await makeStrong(attacker.sectId);
    await makeWeak(defender.sectId);
    await freezeSettlement(attacker.sectId);

    const first = await challenge(attacker, defender.sectId);
    expect(first.status).toBe(200);
    const second = await challenge(attacker, defender.sectId);
    expect(second.status).toBe(409);
    expect(errorOf(second).code).toBe('DAILY_LIMIT');
    expect(await challengeCount(attacker.sectId)).toBe(1);
    expect(await challengeLogRows(attacker.sectId, defender.sectId)).toHaveLength(1);
    const state = await attacker.state();
    expect(state.challenge.usedToday).toBe(1);
  });
});

describe('挑战优化：守擂阵容', () => {
  it('有效手动阵容优先且严格保留顺序；defenseMode=configured', async () => {
    const attacker = await makeSect('ln-atk');
    const defender = await makeSect('ln-def');
    await makeStrong(attacker.sectId);
    await makeWeak(defender.sectId);
    await freezeSettlement(attacker.sectId);
    // 手动顺序：第 3、1、2 名弟子
    const manualOrder = [defender.discipleIds[2], defender.discipleIds[0], defender.discipleIds[1]];
    await env.DB.prepare('UPDATE sects SET defense_lineup = ? WHERE id = ?')
      .bind(JSON.stringify(manualOrder), defender.sectId)
      .run();

    const result = await challenge(attacker, defender.sectId);
    expect(result.status).toBe(200);
    const data = dataOf(result) as Record<string, any>;
    expect(data.result.defenseMode).toBe('configured');
    const logs = await challengeLogRows(attacker.sectId, defender.sectId);
    expect(logs).toHaveLength(1);
    const lineup = JSON.parse(logs[0]?.defender_lineup as string) as { discipleId: string; name: string }[];
    // 日志快照的守方顺序 = 手动顺序
    expect(lineup.map((member) => member.discipleId)).toEqual(manualOrder);
    // 战报里的守方名字与手动顺序按轮次对位（先胜 2 局可能提前结束，不足 3 轮）
    expect(data.result.rounds).toHaveLength(2);
    for (const round of data.result.rounds as { round: number; defenderName: string }[]) {
      expect(round.defenderName).toBe(lineup[round.round - 1]?.name);
    }
  });

  it('无阵容时自动守擂：3 人不重复、都属于守方，战斗与日志同一快照', async () => {
    const attacker = await makeSect('au-atk');
    const defender = await makeSect('au-def');
    await makeStrong(attacker.sectId);
    await freezeSettlement(attacker.sectId);
    // 给守方第 4 名弟子：自动守擂从 4 人里抽 3 人
    await env.DB.prepare(
      `INSERT INTO disciples (id, sect_id, name, gender, aptitude, attack, defense, speed, talent,
          realm_id, stage, cultivation, cultivation_remainder, assignment, injured_until, body_tempering_count, created_at)
       VALUES (?, ?, '守方替补', 'male', 50, 1, 1, 1, 'none', 'qiRefining', 1, 0, 0, 'idle', NULL, 0, ?)`,
    )
      .bind(crypto.randomUUID(), defender.sectId, Date.now())
      .run();
    const defenderDisciples = (
      await env.DB.prepare('SELECT id FROM disciples WHERE sect_id = ?')
        .bind(defender.sectId)
        .all<{ id: string }>()
    ).results.map((row) => row.id);
    expect(defenderDisciples).toHaveLength(4);

    const result = await challenge(attacker, defender.sectId);
    expect(result.status).toBe(200);
    const data = dataOf(result) as Record<string, any>;
    expect(data.result.defenseMode).toBe('automatic');

    const logs = await challengeLogRows(attacker.sectId, defender.sectId);
    expect(logs).toHaveLength(1);
    const lineup = JSON.parse(logs[0]?.defender_lineup as string) as { discipleId: string; name: string; power: number }[];
    expect(lineup).toHaveLength(3);
    expect(new Set(lineup.map((member) => member.discipleId)).size).toBe(3);
    for (const member of lineup) {
      expect(defenderDisciples).toContain(member.discipleId);
      expect(member.power).toBeGreaterThan(0); // 没有 0 战力占位
    }
    // 战报与日志用同一份快照（先胜 2 局可能提前结束，按轮次对位）
    const roundList = data.result.rounds as { round: number; defenderName: string }[];
    expect(roundList).toHaveLength(2);
    for (const round of roundList) {
      expect(round.defenderName).toBe(lineup[round.round - 1]?.name);
    }
  });

  it('自动守擂可选中受伤弟子', async () => {
    const attacker = await makeSect('inj-atk');
    const defender = await makeSect('inj-def');
    await makeStrong(attacker.sectId);
    await makeWeak(defender.sectId);
    await freezeSettlement(attacker.sectId);
    // 守方全部 3 名弟子都受伤：仍可被挑战（守擂不检查伤势）
    await env.DB.prepare('UPDATE disciples SET injured_until = ? WHERE sect_id = ?')
      .bind(Date.now() + 600_000, defender.sectId)
      .run();

    const result = await challenge(attacker, defender.sectId);
    expect(result.status).toBe(200);
  });

  it('手动阵容含失效 ID → 回退自动守擂，不用 0 战力占位', async () => {
    const attacker = await makeSect('fb-atk');
    const defender = await makeSect('fb-def');
    await makeStrong(attacker.sectId);
    await makeWeak(defender.sectId);
    await freezeSettlement(attacker.sectId);
    await env.DB.prepare('UPDATE sects SET defense_lineup = ? WHERE id = ?')
      .bind(JSON.stringify([defender.discipleIds[0], 'ghost-id', defender.discipleIds[1]]), defender.sectId)
      .run();

    const result = await challenge(attacker, defender.sectId);
    expect(result.status).toBe(200);
    const data = dataOf(result) as Record<string, any>;
    expect(data.result.defenseMode).toBe('automatic');
    const logs = await challengeLogRows(attacker.sectId, defender.sectId);
    const lineup = JSON.parse(logs[0]?.defender_lineup as string) as { discipleId: string; power: number }[];
    for (const member of lineup) {
      expect(defender.discipleIds).toContain(member.discipleId);
      expect(member.power).toBeGreaterThan(0);
    }
  });

  it('守方不足 3 名弟子时拒绝且不消耗次数', async () => {
    const attacker = await makeSect('short-atk');
    const defender = await makeSect('short-def');
    await makeStrong(attacker.sectId);
    await freezeSettlement(attacker.sectId);
    await env.DB.prepare('DELETE FROM disciples WHERE sect_id = ? AND id != ?')
      .bind(defender.sectId, defender.discipleIds[0])
      .run();

    const result = await challenge(attacker, defender.sectId);
    expect(result.status).toBe(409);
    expect(errorOf(result).code).toBe('INVALID_STATUS');
    expect(await challengeCount(attacker.sectId)).toBe(0);
    expect(await challengeLogRows(attacker.sectId)).toHaveLength(0);
  });
});

describe('挑战优化：公开预览与契约', () => {
  it('公开档案返回挑战预览；挑战后 already_challenged_today=true', async () => {
    const attacker = await makeSect('pub-atk');
    const defender = await makeSect('pub-def');
    await setSectLevel(attacker.sectId, 3);
    await setSectLevel(defender.sectId, 4);
    await makeStrong(attacker.sectId);
    await makeWeak(defender.sectId);
    await freezeSettlement(attacker.sectId);

    const before = await attacker.api.get(`/api/v1/game/sect/${defender.sectId}`);
    expect(before.status).toBe(200);
    const sectBefore = (dataOf(before) as Record<string, any>).sect as Record<string, any>;
    expect(sectBefore.hasDefenseLineup).toBe(false);
    expect(sectBefore.challenge).not.toBeNull();
    expect(sectBefore.challenge.canChallenge).toBe(true);
    expect(sectBefore.challenge.blockedReason).toBeNull();
    expect(sectBefore.challenge.defenseMode).toBe('automatic');
    expect(sectBefore.challenge.dailyLimit).toBe(3);
    expect(sectBefore.challenge.remaining).toBe(3);
    expect(sectBefore.challenge.alreadyChallengedToday).toBe(false);
    expect(sectBefore.challenge.levelDifference).toBe(1);
    expect(sectBefore.challenge.rewardPreview).toEqual({
      tier: 'higher_1',
      reputation: 13,
      spiritStone: 125_000,
    });
    // 公开档案不暴露自动阵容人选（阵容相关只有 mode 标志）
    expect(JSON.stringify(sectBefore)).not.toContain('defenseLineupMembers');

    const result = await challenge(attacker, defender.sectId);
    expect(result.status).toBe(200);

    const after = await attacker.api.get(`/api/v1/game/sect/${defender.sectId}`);
    const sectAfter = (dataOf(after) as Record<string, any>).sect as Record<string, any>;
    expect(sectAfter.challenge.canChallenge).toBe(false);
    expect(sectAfter.challenge.blockedReason).toBe('already_challenged_today');
    expect(sectAfter.challenge.alreadyChallengedToday).toBe(true);
    expect(sectAfter.challenge.usedToday).toBe(1);
    expect(sectAfter.challenge.remaining).toBe(2);
  });

  it('次数用完 → daily_limit；守方弟子不足 → defender_insufficient；自己 → self', async () => {
    const viewer = await makeSect('pv-view');
    const target = await makeSect('pv-target');
    await makeStrong(viewer.sectId);
    await freezeSettlement(viewer.sectId);

    await env.DB.prepare(
      "UPDATE sects SET challenge_date_key = ?, challenge_count = 3 WHERE id = ?",
    )
      .bind(TODAY, viewer.sectId)
      .run();
    const limited = await viewer.api.get(`/api/v1/game/sect/${target.sectId}`);
    let sect = (dataOf(limited) as Record<string, any>).sect as Record<string, any>;
    expect(sect.challenge.blockedReason).toBe('daily_limit');
    expect(sect.challenge.canChallenge).toBe(false);
    expect(sect.challenge.remaining).toBe(0);

    await env.DB.prepare(
      "UPDATE sects SET challenge_date_key = '', challenge_count = 0 WHERE id = ?",
    )
      .bind(viewer.sectId)
      .run();
    await env.DB.prepare('DELETE FROM disciples WHERE sect_id = ? AND id != ?')
      .bind(target.sectId, target.discipleIds[0])
      .run();
    const insufficient = await viewer.api.get(`/api/v1/game/sect/${target.sectId}`);
    sect = (dataOf(insufficient) as Record<string, any>).sect as Record<string, any>;
    expect(sect.challenge.blockedReason).toBe('defender_insufficient');
    expect(sect.challenge.defenseMode).toBeNull();

    const selfView = await viewer.api.get(`/api/v1/game/sect/${viewer.sectId}`);
    sect = (dataOf(selfView) as Record<string, any>).sect as Record<string, any>;
    expect(sect.challenge.blockedReason).toBe('self');
    expect(sect.challenge.canChallenge).toBe(false);
  });

  it('没有宗门的登录用户查看公开档案 → challenge 为 null', async () => {
    const bare = await makeSect('nb-bare');
    const target = await makeSect('nb-target');
    // 先删引用行再删宗门行，制造「已登录但没宗门」的观看者
    for (const table of ['disciples', 'buildings', 'resource_balances', 'event_log', 'pill_inventories']) {
      await env.DB.prepare(`DELETE FROM ${table} WHERE sect_id = ?`).bind(bare.sectId).run();
    }
    await env.DB.prepare('DELETE FROM sects WHERE id = ?').bind(bare.sectId).run();
    const result = await bare.api.get(`/api/v1/game/sect/${target.sectId}`);
    const sect = (dataOf(result) as Record<string, any>).sect as Record<string, any>;
    expect(sect.challenge).toBeNull();
  });

  it('演武录：新记录带快照，旧记录快照为 null 仍可读', async () => {
    const attacker = await makeSect('hist-atk');
    const defender = await makeSect('hist-def');
    await setSectLevel(attacker.sectId, 4);
    await setSectLevel(defender.sectId, 5);
    await makeStrong(attacker.sectId);
    await makeWeak(defender.sectId);
    await freezeSettlement(attacker.sectId);

    // 旧式记录（无任何快照列）：放到两天前 —— 兼容口径会把「今天窗口内的旧记录」
    // 算作当日已挑战（发布当天保护），两天前的旧记录不影响今天的挑战。
    await env.DB.prepare(
      `INSERT INTO challenge_log (id, attacker_sect_id, defender_sect_id, attacker_lineup,
          defender_lineup, rounds, result, reputation_gained, spirit_stone_gained, created_at)
       VALUES (?, ?, ?, '[]', '[]', '[]', 'lose', 0, 0, ?)`,
    )
      .bind(crypto.randomUUID(), attacker.sectId, defender.sectId, Date.now() - 48 * 3_600_000)
      .run();

    const newBattle = await challenge(attacker, defender.sectId);
    expect(newBattle.status).toBe(200);

    const historyResult = await attacker.api.get('/api/v1/game/challenge-history');
    const historyData = dataOf(historyResult) as Record<string, any>;
    const entries = historyData.entries as Record<string, any>[];
    expect(entries).toHaveLength(2);

    const oldEntry = entries.find((entry) => entry.attackerLevel === null);
    expect(oldEntry).toBeTruthy();
    expect(oldEntry?.result).toBe('lose');
    expect(oldEntry?.defenderLevel ?? null).toBeNull();
    expect(oldEntry?.levelDifference ?? null).toBeNull();
    expect(oldEntry?.rewardTier ?? null).toBeNull();
    expect(oldEntry?.defenseMode ?? null).toBeNull();

    const newEntry = entries.find((entry) => entry.attackerLevel !== null);
    expect(newEntry?.attackerLevel).toBe(4);
    expect(newEntry?.defenderLevel).toBe(5);
    expect(newEntry?.levelDifference).toBe(1);
    expect(newEntry?.rewardTier).toBe('higher_1');
    expect(newEntry?.defenseMode).toBe('automatic');
    expect(newEntry?.result).toBe('win');
  });
});

describe('挑战优化：并发与安全', () => {
  it('并发挑战同一目标：恰好 1 场成功、1 份奖励、1 条日志', async () => {
    const attacker = await makeSect('cc-atk');
    const defender = await makeSect('cc-def');
    await setSectLevel(attacker.sectId, 3);
    await setSectLevel(defender.sectId, 3);
    await makeStrong(attacker.sectId);
    await makeWeak(defender.sectId);
    await freezeSettlement(attacker.sectId);
    const reputationBefore = await reputationOf(attacker.sectId);

    const results = await Promise.all([
      challenge(attacker, defender.sectId),
      challenge(attacker, defender.sectId),
      challenge(attacker, defender.sectId),
    ]);
    const successes = results.filter((result) => result.status === 200);
    expect(successes).toHaveLength(1);

    expect(await challengeCount(attacker.sectId)).toBe(1);
    const logs = await challengeLogRows(attacker.sectId, defender.sectId);
    expect(logs).toHaveLength(1);
    // 奖励最多发一次（同级胜利 = 10 声望 / 100000 灵石）
    expect(await reputationOf(attacker.sectId) - reputationBefore).toBe(10);
    const failed = results.filter((result) => result.status !== 200);
    for (const result of failed) {
      const code = (result.body as { error?: { code?: string } }).error?.code;
      expect(['DAILY_LIMIT', 'INVALID_STATUS']).toContain(code);
    }
  });

  it('并发挑战 4 个不同目标：成功场次不超过 3，计数与日志一致', async () => {
    const attacker = await makeSect('cm-atk');
    await makeStrong(attacker.sectId);
    await freezeSettlement(attacker.sectId);
    const defenders: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const defender = await makeSect(`cm-def-${index}`);
      await makeWeak(defender.sectId);
      defenders.push(defender.sectId);
    }

    const results = await Promise.all([
      challenge(attacker, defenders[0]!),
      challenge(attacker, defenders[1]!),
      challenge(attacker, defenders[2]!),
      challenge(attacker, defenders[3]!),
    ]);
    const successes = results.filter((result) => result.status === 200);
    expect(successes.length).toBeLessThanOrEqual(3);
    expect(successes.length).toBeGreaterThanOrEqual(1);

    const count = await challengeCount(attacker.sectId);
    const logs = await challengeLogRows(attacker.sectId);
    // 计数、日志、成功场次三方一致：没有「扣次数无日志」或「有奖励无次数」
    expect(count).toBe(successes.length);
    expect(logs).toHaveLength(successes.length);
    // 每条成功日志都有唯一 (defender, day)，且守方不重复
    expect(new Set(logs.map((log) => log.defender_sect_id)).size).toBe(successes.length);
    const reputationDelta = successes.reduce(
      (sum, result) => sum + ((dataOf(result) as Record<string, any>).result.reputationGained as number),
      0,
    );
    expect(await reputationOf(attacker.sectId)).toBe(reputationDelta);
  });

  it('现有安全保护不被绕过：未登录 401、缺 CSRF 与跨源 CSRF_INVALID', async () => {
    const anonymous = new TestClient(app, env, { 'cf-connecting-ip': '10.8.254.1' });
    const unauth = await anonymous.post('/api/v1/game/challenge', {
      targetSectId: crypto.randomUUID(),
      discipleIds: ['a', 'b', 'c'],
    });
    expect(unauth.status).toBe(401);
    expect(errorOf(unauth).code).toBe('UNAUTHENTICATED');

    const attacker = await makeSect('sec-atk');
    const noCsrf = await attacker.api.post(
      '/api/v1/game/challenge',
      { targetSectId: crypto.randomUUID(), discipleIds: ['a', 'b', 'c'] },
      { csrfToken: null },
    );
    expect(errorOf(noCsrf).code).toBe('CSRF_INVALID');
    const crossOrigin = await attacker.api.post(
      '/api/v1/game/challenge',
      { targetSectId: crypto.randomUUID(), discipleIds: ['a', 'b', 'c'] },
      { origin: 'https://evil.example' },
    );
    expect(errorOf(crossOrigin).code).toBe('CSRF_INVALID');
  });
});

/** 纯函数兜底：集成里用档位表反查（失败用例的档位断言）。 */
function rewardTierOf(levelDifference: number): string {
  if (levelDifference <= -3) return 'lower_3_plus_no_reward';
  if (levelDifference >= 3) return 'higher_3_plus';
  return REWARD_TIERS[levelDifference + 3]!.tier;
}
