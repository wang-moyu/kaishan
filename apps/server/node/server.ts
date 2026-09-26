import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { serve } from '@hono/node-server';

import { createApp } from '../src/app';
import { runScheduledTasks } from '../src/scheduled';
import { asD1, openDatabase } from './d1';
import { applyMigrations, applySeed, importDump, userTableCount } from './migrate';

/**
 * Node 版入口（与 Workers 版共用 createApp 与定时任务，只换运行时）：
 *
 *   node server.mjs                 启动（先跑迁移 + 种子，再监听端口、开定时任务）
 *   node server.mjs migrate         只跑迁移 + 种子
 *   node server.mjs backup <文件>   在线备份数据库（VACUUM INTO，服务运行中也能用）
 *   node server.mjs import <文件>   把 `wrangler d1 export` 导出的 SQL 导入空库
 *
 * 目录约定（部署后）：<HOME>/app/server.mjs，<HOME>/.env，<HOME>/data/xiuxian.db。
 * HOME = server.mjs 所在目录的上一级；可用环境变量 XIUXIAN_HOME 覆盖。
 */

const APP_DIR = dirname(fileURLToPath(import.meta.url));
const HOME = resolve(process.env.XIUXIAN_HOME ?? join(APP_DIR, '..'));

const envFile = join(HOME, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

/** 与 wrangler.production.jsonc 的 vars 同口径的默认值；.env 里写了就以 .env 为准。 */
const DEFAULT_VARS: Record<string, string> = {
  ENVIRONMENT: 'production',
  REGISTRATION_ENABLED: 'true',
  INVITE_CODES: '',
  SESSION_TTL_SECONDS: '604800',
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS: '5',
  LOGIN_RATE_LIMIT_WINDOW_SECONDS: '60',
  ALLOWED_ORIGINS: '',
  REALM_EXPLORE_ENABLED: 'true',
  /** 讨伐每日出手上限（0 = 不限）；改 .env 里的 WORLD_BOSS_DAILY_ATTACK_LIMIT 后重启即可。 */
  WORLD_BOSS_DAILY_ATTACK_LIMIT: '120',
  OPENROUTER_API_KEY: '',
};

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';
/** 在反向代理（宝塔 nginx）后面时取 X-Real-IP 作为客户端 IP；直接对外暴露时设为 0。 */
const TRUST_PROXY = (process.env.TRUST_PROXY ?? '1') !== '0';
const DB_PATH = resolve(HOME, process.env.DB_PATH ?? 'data/xiuxian.db');
const WEB_DIR = resolve(APP_DIR, process.env.WEB_DIR ?? 'web');
const MIGRATIONS_DIR = resolve(APP_DIR, process.env.MIGRATIONS_DIR ?? 'migrations');
const SEED_FILE = resolve(APP_DIR, process.env.SEED_FILE ?? 'seed.sql');

mkdirSync(dirname(DB_PATH), { recursive: true });

function migrate(): void {
  const db = openDatabase(DB_PATH);
  try {
    const applied = applyMigrations(db, MIGRATIONS_DIR);
    applySeed(db, SEED_FILE);
    console.log(applied.length > 0 ? `已执行迁移：${applied.join(', ')}` : '数据库已是最新');
  } finally {
    db.close();
  }
}

function backup(target: string | undefined): void {
  if (target === undefined) throw new Error('用法：node server.mjs backup <备份文件路径>');
  const file = resolve(target);
  mkdirSync(dirname(file), { recursive: true });
  const db = openDatabase(DB_PATH);
  try {
    db.prepare('VACUUM INTO ?').run(file);
  } finally {
    db.close();
  }
  // 同目录只保留最近 BACKUP_KEEP 份（默认 14）。
  const keep = Number(process.env.BACKUP_KEEP ?? 14);
  const dir = dirname(file);
  const backups = readdirSync(dir)
    .filter((name) => name.endsWith('.db'))
    .map((name) => ({ name, time: statSync(join(dir, name)).mtimeMs }))
    .sort((a, b) => b.time - a.time);
  for (const old of backups.slice(keep)) unlinkSync(join(dir, old.name));
  console.log(`已备份到 ${file}`);
}

function importFrom(source: string | undefined): void {
  if (source === undefined) throw new Error('用法：node server.mjs import <导出的 .sql 文件>');
  const db = openDatabase(DB_PATH);
  try {
    if (userTableCount(db) > 0 && !process.argv.includes('--force')) {
      throw new Error(`${DB_PATH} 已经有数据；确认要覆盖请先删掉该文件（或加 --force 直接往里导）`);
    }
    importDump(db, resolve(source));
  } finally {
    db.close();
  }
  console.log('导入完成，接着执行迁移…');
  migrate();
}

/* ---------- 静态资源（前端 dist），SPA 回退到 index.html ---------- */

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.txt': 'text/plain; charset=utf-8',
};

async function serveStatic(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  const pathname = decodeURIComponent(new URL(request.url).pathname);
  const candidate = normalize(join(WEB_DIR, pathname));
  const inside = candidate === WEB_DIR || candidate.startsWith(WEB_DIR + sep);
  let file = inside && existsSync(candidate) && statSync(candidate).isFile() ? candidate : null;
  // 找不到的路径：带扩展名的按 404，其余回退 index.html（前端路由）。
  if (file === null) {
    if (extname(pathname) !== '') return new Response('Not Found', { status: 404 });
    file = join(WEB_DIR, 'index.html');
  }
  const body = await readFile(file);
  const hashed = file.startsWith(join(WEB_DIR, 'assets') + sep);
  return new Response(request.method === 'HEAD' ? null : body, {
    headers: {
      'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    },
  });
}

/* ---------- 启动 ---------- */

/**
 * 客户端 IP：业务代码（登录限频）优先读 cf-connecting-ip。
 * 这里先删掉客户端自己带的 cf-connecting-ip / x-forwarded-for（防伪造绕过限频），
 * 再按部署方式填上真实 IP：代理后面取 X-Real-IP，直连取 socket 地址。
 */
function withClientIp(request: Request, incoming: { socket: { remoteAddress?: string | undefined } }): Request {
  const headers = new Headers(request.headers);
  const realIp = TRUST_PROXY ? headers.get('x-real-ip') : null;
  const ip = realIp ?? incoming.socket.remoteAddress ?? 'unknown';
  headers.delete('x-forwarded-for');
  headers.set('cf-connecting-ip', ip);
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  return new Request(request.url, {
    method: request.method,
    headers,
    ...(hasBody ? { body: request.body, duplex: 'half' } : {}),
  } as RequestInit);
}

function start(): void {
  migrate();

  const sqlite = openDatabase(DB_PATH);
  const db = asD1(sqlite);
  const env = { ...DEFAULT_VARS, ...pickVars(), DB: db } as unknown as Env;
  const app = createApp();

  const server = serve(
    {
      hostname: HOST,
      port: PORT,
      fetch: (request, bindings) => {
        const { pathname } = new URL(request.url);
        if (pathname.startsWith('/api/')) {
          return app.fetch(withClientIp(request, bindings.incoming), env);
        }
        return serveStatic(request);
      },
    },
    (info) => console.log(`开山立派已启动：http://${HOST}:${String(info.port)}（数据库 ${DB_PATH}）`),
  );

  // 与 Workers Cron 的 */10 对齐：每个整 10 分钟跑一次，上一轮跑完才排下一轮。
  const TICK_MS = 10 * 60 * 1000;
  let timer: NodeJS.Timeout | undefined;
  const scheduleNext = (): void => {
    const delay = TICK_MS - (Date.now() % TICK_MS) + 1000;
    timer = setTimeout(() => {
      void runScheduledTasks(db, Date.now()).finally(scheduleNext);
    }, delay);
  };
  scheduleNext();

  const shutdown = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    server.close(() => {
      sqlite.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

function pickVars(): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const key of Object.keys(DEFAULT_VARS)) {
    const value = process.env[key];
    if (value !== undefined) vars[key] = value;
  }
  return vars;
}

const [command, arg] = process.argv.slice(2);
try {
  if (command === 'migrate') migrate();
  else if (command === 'backup') backup(arg);
  else if (command === 'import') importFrom(arg);
  else if (command === undefined || command === 'serve') start();
  else throw new Error(`未知命令：${command}（可用：serve / migrate / backup / import）`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
