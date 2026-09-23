import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import {
  PASSWORD_HASH_PARAMS,
  hashPassword,
} from '../../apps/server/src/modules/auth/password';
import {
  accountSchema,
  normalizeAccount,
  passwordSchema,
} from '../../apps/server/src/modules/auth/schema';

/**
 * 受控账号管理工具（P0-04）。
 *
 * 为什么需要它：注册接口默认关闭（REGISTRATION_ENABLED=false），内测账号必须由受控入口创建，
 * 且不允许「万能管理密码」或任何未鉴权的调试接口。这个脚本是本地/运维侧工具：
 *
 *   npm run accounts -- create-user --account <账号>            # 密码从 stdin / 交互式隐藏输入读取
 *   npm run accounts -- revoke-sessions --account <账号>        # 撤销该账号的全部活跃会话
 *   npm run accounts -- list-users                              # 只列出摘要（不含哈希）
 *
 * 安全约定：
 * - 密码只在内存里出现：用与运行时**完全相同**的 Argon2id 参数（直接 import 运行时实现）哈希，
 *   只有哈希进库；明文既不打印、不写文件、不进命令行参数，也不是日志字段；
 * - 默认只操作本地 D1（--local + apps/server/.wrangler/state/dev）；
 * - 远程库必须同时给出 --remote 与 --confirm-remote（防止误触线上数据，见 05 的授权约定）；
 * - 已有账号不会被覆盖（create-user 撞账号直接失败）。
 *
 * 实现说明：脚本用 tsx 直接跑 TypeScript，并把 SQL 交给 `wrangler d1 execute` 执行，
 * 因此不需要额外的数据库驱动，也不会绕过 wrangler 的持久化目录约定。
 */

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const DB_NAME = 'xiuxian-game-db';
const WRANGLER_CONFIG = 'apps/server/wrangler.jsonc';
const LOCAL_PERSIST_DIR = 'apps/server/.wrangler/state/dev';
const WRANGLER_BIN = 'node_modules/wrangler/bin/wrangler.js';

export type Target = 'local' | 'remote';

export interface ManageOptions {
  command: 'create-user' | 'revoke-sessions' | 'list-users' | 'help';
  account?: string;
  target: Target;
  confirmRemote: boolean;
}

const USAGE = `受控账号管理（P0-04）

用法（推荐位置参数，见下方 npm 说明）：
  npm run accounts -- create-user <账号>
  npm run accounts -- revoke-sessions <账号>
  npm run accounts -- list-users

目标库：
  默认只操作本地 D1：apps/server/.wrangler/state/dev（对应 apps/server 的 --persist-to）。
  远程 D1 必须显式确认，两种等价写法：
    XIUXIAN_ACCOUNTS_TARGET=remote XIUXIAN_ACCOUNTS_CONFIRM_REMOTE=yes npm run accounts -- list-users
    npx tsx scripts/accounts/manage.ts list-users --remote --confirm-remote
  （远程属于云端操作，需要先取得授权，见 05。）

为什么文档用位置参数：npm run 会把所有以 -- 开头的参数当成 npm 自己的配置项并吞掉，
\`npm run accounts -- revoke-sessions --account x\` 里的 --account 到不了脚本。
需要显式 --account/--remote 时请直接调用 npx tsx scripts/accounts/manage.ts（不经 npm）。

密码输入：
  交互式终端下隐藏回显并要求输入两次；非交互场景（管道）从 stdin 读取一行。
  明文密码不会被打印、写入文件或记进日志。`;

/**
 * 解析命令行。
 *
 * 账号既可以是位置参数（`create-user <账号>`，npm run 传参推荐这种），
 * 也可以是 `--account <账号>` / `--account=<账号>`（直接跑 tsx 时用）。
 *
 * 目标库除了 `--remote --confirm-remote`，还接受环境变量
 * XIUXIAN_ACCOUNTS_TARGET / XIUXIAN_ACCOUNTS_CONFIRM_REMOTE——
 * 因为 npm run 会把 `--remote` 之类的长参数当成 npm 自己的配置项吞掉。
 */
export function parseArgs(
  argv: readonly string[],
  env: Record<string, string | undefined> = process.env,
): ManageOptions {
  const [rawCommand, ...rest] = argv;
  const command = rawCommand ?? 'help';
  let account: string | undefined;
  let target: Target = env.XIUXIAN_ACCOUNTS_TARGET === 'remote' ? 'remote' : 'local';
  let confirmRemote = env.XIUXIAN_ACCOUNTS_CONFIRM_REMOTE === 'yes';
  let helpRequested = command === 'help' || command === '--help' || command === '-h';

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === undefined || token === '--') {
      continue;
    }
    if (token === '--account') {
      account = rest[index + 1];
      index += 1;
    } else if (token.startsWith('--account=')) {
      account = token.slice('--account='.length);
    } else if (token === '--local') {
      target = 'local';
    } else if (token === '--remote') {
      target = 'remote';
    } else if (token === '--confirm-remote') {
      confirmRemote = true;
    } else if (token === '--help' || token === '-h') {
      helpRequested = true;
    } else if (token.startsWith('-')) {
      throw new Error(`无法识别的参数：${token}`);
    } else if (account === undefined && command !== 'list-users') {
      // 位置参数形式的账号；list-users 不接受位置参数（避免被 npm 吞参后静默生效）
      account = token;
    } else {
      throw new Error(`多余的参数：${token}`);
    }
  }

  if (helpRequested) {
    return { command: 'help', target, confirmRemote };
  }
  if (command !== 'create-user' && command !== 'revoke-sessions' && command !== 'list-users') {
    throw new Error(`未知命令：${command}`);
  }
  if (command !== 'list-users' && (account === undefined || account.length === 0)) {
    throw new Error(`命令 ${command} 需要账号（位置参数或 --account）`);
  }
  return account === undefined ? { command, target, confirmRemote } : { command, account, target, confirmRemote };
}

/** 生成 SQL 文本字面量：单引号转义，避免脚本拼出可注入的语句。 */
export function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

interface StatementResult {
  results?: Record<string, unknown>[];
  success?: boolean;
  meta?: { changes?: number; rows_read?: number; rows_written?: number };
}

function wranglerArgs(options: ManageOptions, file: string): string[] {
  const args = [
    WRANGLER_BIN,
    'd1',
    'execute',
    DB_NAME,
    '--config',
    WRANGLER_CONFIG,
    '--file',
    file,
    '--json',
  ];
  args.push(options.target === 'remote' ? '--remote' : '--local', '--persist-to', LOCAL_PERSIST_DIR);
  return args;
}

/** 把语句交给 wrangler 执行；返回每条语句的结果（顺序与输入一致）。 */
function executeStatements(options: ManageOptions, statements: readonly string[]): StatementResult[] {
  // 临时文件放系统临时目录，不进仓库；wrangler 只接受文件或命令两种输入，
  // 用文件可以避免 Windows 上命令行引号/换行的转义问题。
  const dir = mkdtempSync(join(tmpdir(), 'xiuxian-accounts-'));
  try {
    const file = join(dir, 'statements.sql');
    writeFileSync(file, `${statements.join('\n')}\n`, 'utf8');

    const result = spawnSync(process.execPath, wranglerArgs(options, file), {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });

    if (result.error !== undefined) {
      throw result.error;
    }
    if (result.status !== 0) {
      const detail = `${result.stderr ?? ''}${result.stdout ?? ''}`.trim();
      throw new Error(`wrangler 执行失败（退出码 ${String(result.status)}）：\n${detail}`);
    }

    const parsed: unknown = JSON.parse(extractJson(result.stdout ?? ''));
    const entries = Array.isArray(parsed) ? (parsed as StatementResult[]) : [parsed as StatementResult];
    for (const entry of entries) {
      if (entry.success === false) {
        throw new Error('数据库拒绝了该语句（详见 wrangler 输出）');
      }
    }
    return entries;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** wrangler 可能在 JSON 前后打印提示行，这里截取第一个 JSON 值。 */
function extractJson(stdout: string): string {
  const start = stdout.search(/[[{]/u);
  if (start < 0) {
    throw new Error(`无法解析 wrangler 输出：${stdout.trim()}`);
  }
  const end = Math.max(stdout.lastIndexOf(']'), stdout.lastIndexOf('}'));
  return stdout.slice(start, end + 1);
}

function assertRemoteAllowed(options: ManageOptions): void {
  if (options.target === 'remote' && !options.confirmRemote) {
    throw new Error(
      '拒绝在远程 D1 上执行：请在命令里同时给出 --remote 与 --confirm-remote。\n' +
        '（远程资源属于云端操作，必须先取得明确授权；本地开发请用默认的 --local。）',
    );
  }
}

function validateAccount(account: string): string {
  const parsed = accountSchema.safeParse(account.trim());
  if (!parsed.success) {
    throw new Error(`账号不合法：${parsed.error.issues.map((issue) => issue.message).join('；')}`);
  }
  return normalizeAccount(account);
}

/** 交互式隐藏输入；终端不支持隐藏时退回普通输入（会在终端回显，脚本会提示）。 */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolvePromise) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const internal = rl as unknown as { _writeToOutput?: (text: string) => void };
    const original = internal._writeToOutput;
    if (typeof original === 'function') {
      internal._writeToOutput = (text: string) => {
        // readline 会把每个按键回显出来；只保留提示语本身
        if (text.includes(question)) {
          original.call(rl, question);
        }
      };
    } else {
      process.stderr.write('[提示] 当前 Node 版本无法隐藏输入，密码会在终端回显，请注意遮挡。\n');
    }
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolvePromise(answer);
    });
  });
}

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/u, '');
}

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    const piped = await readAllStdin();
    if (piped.length === 0) {
      throw new Error('没有从 stdin 读到密码');
    }
    return piped;
  }

  const first = await promptHidden('密码（不回显，至少 8 位）：');
  const second = await promptHidden('再次输入密码：');
  if (first !== second) {
    throw new Error('两次输入的密码不一致');
  }
  return first;
}

function toIso(timestamp: unknown): string {
  const value = Number(timestamp);
  return Number.isFinite(value) ? new Date(value).toISOString() : String(timestamp);
}

async function createUser(options: ManageOptions): Promise<void> {
  assertRemoteAllowed(options);
  const account = validateAccount(options.account ?? '');
  const password = await readPassword();
  const parsedPassword = passwordSchema.safeParse(password);
  if (!parsedPassword.success) {
    throw new Error(
      `密码不合法：${parsedPassword.error.issues.map((issue) => issue.message).join('；')}`,
    );
  }

  const existing = executeStatements(options, [
    `SELECT id, status FROM users WHERE normalized_account = ${sqlText(account)}`,
  ]);
  const found = existing[0]?.results?.[0];
  if (found !== undefined) {
    throw new Error(`账号 ${account} 已存在（id=${String(found.id)}），拒绝覆盖；如需重置请联系负责人走受控流程。`);
  }

  const now = Date.now();
  const id = crypto.randomUUID();
  const passwordHash = hashPassword(password);
  executeStatements(options, [
    `INSERT INTO users (id, normalized_account, password_hash, status, created_at, updated_at)
     VALUES (${sqlText(id)}, ${sqlText(account)}, ${sqlText(passwordHash)}, 'active', ${String(now)}, ${String(now)})`,
  ]);

  const verify = executeStatements(options, [
    `SELECT id, normalized_account, status, created_at FROM users WHERE id = ${sqlText(id)}`,
  ]);
  const row = verify[0]?.results?.[0];
  if (row === undefined) {
    throw new Error('写入后未查到账号，请检查数据库状态');
  }

  const params = PASSWORD_HASH_PARAMS;
  process.stdout.write(
    [
      '账号已创建（受控入口）：',
      `  id         ${String(row.id)}`,
      `  account    ${String(row.normalized_account)}`,
      `  status     ${String(row.status)}`,
      `  createdAt  ${toIso(row.created_at)}`,
      `  密码哈希   Argon2id m=${String(params.m)},t=${String(params.t)},p=${String(params.p)},dk=${String(params.dk)}（仅哈希入库）`,
      '明文密码未被打印、未写入任何文件、未记入日志。',
      '',
    ].join('\n'),
  );
}

async function revokeSessions(options: ManageOptions): Promise<void> {
  assertRemoteAllowed(options);
  const account = validateAccount(options.account ?? '');

  const found = executeStatements(options, [
    `SELECT id FROM users WHERE normalized_account = ${sqlText(account)}`,
  ]);
  const user = found[0]?.results?.[0];
  if (user === undefined) {
    throw new Error(`账号 ${account} 不存在`);
  }
  const userId = sqlText(String(user.id));

  // 说明：本地 D1 的 `wrangler d1 execute --json` 只回 meta.duration，不回 changes
  // （远程才带统计），所以撤销数量用「更新前后各查一次活跃会话数」得出，不依赖 meta。
  const before = executeStatements(options, [
    `SELECT COUNT(*) AS active FROM sessions WHERE user_id = ${userId} AND revoked_at IS NULL`,
  ]);
  const beforeCount = Number(before[0]?.results?.[0]?.active ?? 0);

  const revokedAt = Date.now();
  executeStatements(options, [
    `UPDATE sessions SET revoked_at = ${String(revokedAt)}
       WHERE user_id = ${userId} AND revoked_at IS NULL`,
  ]);

  const after = executeStatements(options, [
    `SELECT COUNT(*) AS active FROM sessions WHERE user_id = ${userId} AND revoked_at IS NULL`,
  ]);
  const afterCount = Number(after[0]?.results?.[0]?.active ?? 0);

  process.stdout.write(
    [
      '已撤销该账号的全部活跃会话：',
      `  account    ${account}`,
      `  userId     ${String(user.id)}`,
      `  revokedAt  ${toIso(revokedAt)}`,
      `  活跃会话   ${String(beforeCount)} -> ${String(afterCount)}`,
      beforeCount === 0 ? '（本来就没有活跃会话）' : '',
      '',
    ]
      .filter((line) => line.length > 0)
      .join('\n'),
  );
}

async function listUsers(options: ManageOptions): Promise<void> {
  assertRemoteAllowed(options);
  const now = Date.now();
  const result = executeStatements(options, [
    `SELECT u.normalized_account AS account, u.status, u.created_at,
            (SELECT COUNT(*) FROM sessions s
              WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > ${String(now)}) AS active_sessions
       FROM users u
      ORDER BY u.created_at ASC, u.normalized_account ASC`,
  ]);

  const rows = result[0]?.results ?? [];
  if (rows.length === 0) {
    process.stdout.write('（没有账号）\n');
    return;
  }

  process.stdout.write(`账号数：${String(rows.length)}\n`);
  for (const row of rows) {
    process.stdout.write(
      `  ${String(row.account)}  status=${String(row.status)}  ` +
        `活跃会话=${String(row.active_sessions)}  createdAt=${toIso(row.created_at)}\n`,
    );
  }
  process.stdout.write('（只输出摘要字段；password_hash 不在此列，避免误复制到别处）\n');
}

export async function run(argv: readonly string[]): Promise<number> {
  const options = parseArgs(argv);
  if (options.command === 'help') {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  if (options.command === 'create-user') {
    await createUser(options);
  } else if (options.command === 'revoke-sessions') {
    await revokeSessions(options);
  } else {
    await listUsers(options);
  }
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  await run(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`\n[失败] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
