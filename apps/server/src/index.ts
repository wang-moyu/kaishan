import { createApp } from './app';
import { getDb } from './infra/db/client';
import { settleCurrentRound } from './modules/game/service';

const app = createApp();

// Worker 入口：/api/* 走 Hono，其余请求走 Assets 静态资源（SPA 回退到 index.html）。
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return app.fetch(request, env, ctx);
    }
    return (env as unknown as { ASSETS: Fetcher }).ASSETS.fetch(request);
  },

  async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext) {
    const db = getDb(env);
    await settleCurrentRound(db, Date.now());
  },
} satisfies ExportedHandler<Env>;
