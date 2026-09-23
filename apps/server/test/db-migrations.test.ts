import { applyD1Migrations, env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import seedSql from '../../scripts/seed/seed.sql?raw';
import { classifyDbError, toSafeDbError } from '../src/infra/db/errors';
import { ConfigVersionRepository, GameServerRepository } from '../src/infra/db/repositories';
import { REQUIRED_TABLES } from '../src/infra/db/readiness';
import { runSql } from './support/sql';

/**
 * 在真实 workerd + D1 中验证 P0-02 的迁移、约束与 seed 行为。
 *
 * 存储说明（@cloudflare/vitest-pool-workers 0.22 起）：每个测试文件拿到一份独立的内存 D1，
 * 但**不再有逐用例回滚**（isolatedStorage 选项已移除）。因此本文件里的用例不假设
 * 「上一个用例的数据消失了」：需要的行各自用独立主键创建，涉及计数的断言写成相对值。
 * 后续任务（P0-04/P0-05）的测试必须遵守同一约定，不要依赖回滚。
 */

// 应用 P0 迁移（迁移语句由 vitest.config.ts 在 Node 侧读入后注入）
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

/** 固定测试时间，避免依赖真实时钟（业务时间一律由服务端取，见 03 第 1 节）。 */
const NOW = 1_760_000_000_000;

function insertUser(id: string, account: string): Promise<unknown> {
  return env.DB.prepare(
    `INSERT INTO users (id, normalized_account, password_hash, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, account, 'pretend-hash', 'active', NOW, NOW)
    .run();
}

function insertSession(id: string, userId: string, tokenHash: string): Promise<unknown> {
  return env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(id, userId, tokenHash, NOW + 86_400_000, NOW)
    .run();
}

function insertReceipt(id: string, userId: string, key: string): Promise<unknown> {
  return env.DB.prepare(
    `INSERT INTO command_receipts
       (id, user_id, scope, idempotency_key, request_hash, response, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, userId, 'POST /sect/sync', key, 'hash-1', '{"ok":true}', NOW, NOW + 604_800_000)
    .run();
}

/** 把 Promise 的拒绝转成返回值，便于断言错误分类。 */
function capture(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

describe('D1 迁移与约束（P0-02）', () => {
  it('迁移表记录已应用，ready 通过并报告迁移数', async () => {
    const response = await SELF.fetch('https://example.com/api/v1/health/ready');

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      data: { status: string; appliedMigrations: number };
    };
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe('ready');
    // 迁移数直接对齐注入的迁移文件数：新增迁移无需再改这张断言
    expect(body.data.appliedMigrations).toBe(env.TEST_MIGRATIONS.length);
  });

  it('P0 必需表全部存在', async () => {
    const placeholders = REQUIRED_TABLES.map(() => '?').join(', ');
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS found FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`,
    )
      .bind(...REQUIRED_TABLES)
      .first<{ found: number }>();

    expect(Number(row?.found)).toBe(REQUIRED_TABLES.length);
  });

  it('users.normalized_account 唯一约束生效，且映射后不泄露表名', async () => {
    await insertUser('u1', 'alice');

    const error = await capture(insertUser('u2', 'alice'));

    expect(error).not.toBeNull();
    expect(classifyDbError(error)).toBe('unique');
    // 原始错误里有表名（供日志层使用），但安全映射后的对外消息没有
    expect(String(error)).toContain('users.normalized_account');
    expect(toSafeDbError(error).message).not.toContain('users');
  });

  it('sessions.token_hash 唯一、command_receipts(user_id, scope, key) 唯一', async () => {
    await insertUser('u-session', 'bob');
    await insertSession('sess1', 'u-session', 'token-hash-1');

    const duplicateSession = await capture(insertSession('sess2', 'u-session', 'token-hash-1'));
    expect(duplicateSession).not.toBeNull();
    expect(String(duplicateSession)).toMatch(/unique/i);

    await insertReceipt('receipt1', 'u-session', 'key-1');

    const duplicateReceipt = await capture(insertReceipt('receipt2', 'u-session', 'key-1'));
    expect(duplicateReceipt).not.toBeNull();
    expect(String(duplicateReceipt)).toMatch(/unique/i);

    // 同一 key 换 scope 是另一个幂等作用域，允许存在
    await env.DB.prepare(
      `INSERT INTO command_receipts
         (id, user_id, scope, idempotency_key, request_hash, response, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind('receipt3', 'u-session', 'POST /disciples/recruit', 'key-1', 'hash-2', '{}', NOW, NOW)
      .run();
  });

  it('mutation_guards 只接受 valid = 1（CHECK 约束）', async () => {
    await env.DB.prepare('INSERT INTO mutation_guards (command_id, valid) VALUES (?, ?)')
      .bind('cmd-ok', 1)
      .run();

    const error = await capture(
      env.DB.prepare('INSERT INTO mutation_guards (command_id, valid) VALUES (?, ?)')
        .bind('cmd-bad', 0)
        .run(),
    );

    expect(error).not.toBeNull();
    expect(classifyDbError(error)).toBe('constraint');
  });

  it('sessions.user_id 外键约束生效（不存在的账号不能建 session）', async () => {
    const error = await capture(insertSession('sess-orphan', 'no-such-user', 'token-hash-orphan'));

    expect(error).not.toBeNull();
    expect(classifyDbError(error)).toBe('constraint');
  });

  it('config_versions.version 唯一，findLatest 返回最新一条', async () => {
    const insertConfigVersion = (
      id: string,
      version: string,
      createdAt: number,
    ): Promise<unknown> =>
      env.DB.prepare(
        'INSERT INTO config_versions (id, version, payload_hash, created_at) VALUES (?, ?, ?, ?)',
      )
        .bind(id, version, `hash-${version}`, createdAt)
        .run();

    await insertConfigVersion('cfg1', 'v1', NOW);
    await insertConfigVersion('cfg2', 'v2', NOW + 1000);

    const duplicate = await capture(insertConfigVersion('cfg3', 'v2', NOW + 2000));
    expect(duplicate).not.toBeNull();
    expect(String(duplicate)).toMatch(/unique/i);

    const repository = new ConfigVersionRepository(env.DB);
    const latest = await repository.findLatest();
    expect(latest?.version).toBe('v2');
    expect((await repository.findByVersion('v1'))?.payload_hash).toBe('hash-v1');
  });

  it('seed 幂等：重复执行不新增，也不清掉已有数据', async () => {
    const repository = new GameServerRepository(env.DB);
    const beforeSeed = await repository.countAll();

    await runSql(env.DB, seedSql);
    const afterFirstSeed = await repository.countAll();

    // 单服只有一行：首次最多新增 1 行，且 s1 必须存在
    expect(afterFirstSeed - beforeSeed).toBeLessThanOrEqual(1);
    expect((await repository.findByCode('s1'))?.time_zone).toBe('UTC+8');

    // 再跑一次：不新增
    await runSql(env.DB, seedSql);
    expect(await repository.countAll()).toBe(afterFirstSeed);

    // 已有存档/运营数据必须被保留
    await env.DB.prepare(
      'INSERT INTO game_servers (id, code, time_zone, created_at) VALUES (?, ?, ?, ?)',
    )
      .bind('s-extra', 's-extra', 'UTC+8', NOW)
      .run();
    const afterManualInsert = await repository.countAll();

    await runSql(env.DB, seedSql);

    expect(await repository.countAll()).toBe(afterManualInsert);
    expect((await repository.findByCode('s-extra'))?.time_zone).toBe('UTC+8');
  });

  it('仓储查询参数化：注入串只当普通字符串', async () => {
    await runSql(env.DB, seedSql);
    const repository = new GameServerRepository(env.DB);
    const before = await repository.countAll();

    expect(await repository.findByCode("s1' OR '1'='1")).toBeNull();
    expect(await repository.findByCode("s1'; DROP TABLE game_servers; --")).toBeNull();

    // 表还在，行数也没变
    expect(await repository.countAll()).toBe(before);
    expect(await repository.findByCode('s1')).not.toBeNull();
  });
});

describe('0012 挑战优化迁移（每日次数 + 日志快照 + 唯一部分索引）', () => {
  /** 建一个用户 + 宗门（独立主键，不依赖回滚）。 */
  async function insertSectFixture(sectId: string): Promise<string> {
    const userId = `u-${sectId}`;
    await env.DB.prepare(
      `INSERT INTO users (id, normalized_account, password_hash, status, created_at, updated_at)
       VALUES (?, ?, 'pretend-hash', 'active', ?, ?)`,
    )
      .bind(userId, `challenge-${sectId}`, NOW, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO sects (id, user_id, name, level, vein_level, last_settled_at, recruit_date_key, recruit_count, created_at)
       VALUES (?, ?, ?, 1, 1, ?, '', 0, ?)`,
    )
      .bind(sectId, userId, `宗门${sectId}`, NOW, NOW)
      .run();
    return userId;
  }

  async function insertChallengeLog(values: {
    id: string;
    attackerSectId: string;
    defenderSectId: string;
    /** null = 模拟 0012 迁移前的旧记录（不带日期键）。 */
    dateKey?: string | null;
  }): Promise<unknown> {
    return env.DB.prepare(
      `INSERT INTO challenge_log (id, attacker_sect_id, defender_sect_id, attacker_lineup,
          defender_lineup, rounds, result, reputation_gained, spirit_stone_gained,
          attacker_level, defender_level, reward_tier, defense_mode, challenge_date_key, created_at)
       VALUES (?, ?, ?, '[]', '[]', '[]', 'win', 0, 0, 1, 1, 'equal', 'automatic', ?, ?)`,
    )
      .bind(
        values.id,
        values.attackerSectId,
        values.defenderSectId,
        values.dateKey ?? null,
        NOW,
      )
      .run();
  }

  it('旧宗门获得合法默认计数字段（date_key 空、计数 0），challenge_count 有 CHECK', async () => {
    await insertSectFixture('m12-default');
    const row = await env.DB.prepare(
      'SELECT challenge_date_key, challenge_count FROM sects WHERE id = ?',
    )
      .bind('m12-default')
      .first<{ challenge_date_key: string; challenge_count: number }>();
    expect(row?.challenge_date_key).toBe('');
    expect(Number(row?.challenge_count)).toBe(0);

    const negative = await env.DB.prepare(
      'UPDATE sects SET challenge_count = -1 WHERE id = ?',
    )
      .bind('m12-default')
      .run()
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(negative).not.toBeNull();
  });

  it('旧日志新快照列为 NULL 仍可读；新记录写入快照字段', async () => {
    await insertSectFixture('m12-log-a');
    await insertSectFixture('m12-log-b');
    await env.DB.prepare(
      `INSERT INTO challenge_log (id, attacker_sect_id, defender_sect_id, attacker_lineup,
          defender_lineup, rounds, result, reputation_gained, spirit_stone_gained, created_at)
       VALUES ('m12-old-log', 'm12-log-a', 'm12-log-b', '[]', '[]', '[]', 'win', 10, 100000, ?)`,
    )
      .bind(NOW)
      .run();

    const oldRow = await env.DB.prepare('SELECT * FROM challenge_log WHERE id = ?')
      .bind('m12-old-log')
      .first<Record<string, unknown>>();
    expect(oldRow?.attacker_level ?? null).toBeNull();
    expect(oldRow?.defender_level ?? null).toBeNull();
    expect(oldRow?.reward_tier ?? null).toBeNull();
    expect(oldRow?.defense_mode ?? null).toBeNull();
    expect(oldRow?.challenge_date_key ?? null).toBeNull();
    // 旧记录的业务字段仍然完好
    expect(oldRow?.result).toBe('win');

    await insertChallengeLog({
      id: 'm12-new-log',
      attackerSectId: 'm12-log-a',
      defenderSectId: 'm12-log-b',
      dateKey: '2026-09-19',
    });
    const newRow = await env.DB.prepare('SELECT * FROM challenge_log WHERE id = ?')
      .bind('m12-new-log')
      .first<Record<string, unknown>>();
    expect(newRow?.attacker_level).toBe(1);
    expect(newRow?.reward_tier).toBe('equal');
    expect(newRow?.defense_mode).toBe('automatic');
    expect(newRow?.challenge_date_key).toBe('2026-09-19');
  });

  it('同一日期键下同一攻守组合唯一；旧式记录（无日期键）不受约束', async () => {
    await insertSectFixture('m12-uniq-a');
    await insertSectFixture('m12-uniq-b');

    await insertChallengeLog({
      id: 'm12-uniq-first',
      attackerSectId: 'm12-uniq-a',
      defenderSectId: 'm12-uniq-b',
      dateKey: '2026-09-19',
    });
    const sameDayDuplicate = await insertChallengeLog({
      id: 'm12-uniq-dup',
      attackerSectId: 'm12-uniq-a',
      defenderSectId: 'm12-uniq-b',
      dateKey: '2026-09-19',
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(sameDayDuplicate).not.toBeNull();

    // 不同日期键的同组合允许（跨日重置）
    await insertChallengeLog({
      id: 'm12-uniq-next-day',
      attackerSectId: 'm12-uniq-a',
      defenderSectId: 'm12-uniq-b',
      dateKey: '2026-09-20',
    });

    // 旧式记录（date_key NULL）：同一攻守组合可以有多条（迁移前行为不受影响）
    await insertChallengeLog({ id: 'm12-legacy-1', attackerSectId: 'm12-uniq-a', defenderSectId: 'm12-uniq-b' });
    await insertChallengeLog({ id: 'm12-legacy-2', attackerSectId: 'm12-uniq-a', defenderSectId: 'm12-uniq-b' });
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM challenge_log WHERE attacker_sect_id = 'm12-uniq-a' AND challenge_date_key IS NULL",
    ).first<{ total: number }>();
    expect(Number(count?.total)).toBe(2);
  });
});
