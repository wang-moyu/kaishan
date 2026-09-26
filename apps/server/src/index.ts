import { createApp } from './app';
import { getDb } from './infra/db/client';
import { runScheduledTasks } from './scheduled';

const app = createApp();

// Worker 入口：/api/* 走 Hono，其余请求走 Assets 静态资源（SPA 回退到 index.html）。
// Node 版入口见 apps/server/node/server.ts（同一个 createApp 与定时任务）。
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return app.fetch(request, env, ctx);
    }
    return (env as unknown as { ASSETS: Fetcher }).ASSETS.fetch(request);
  },

  async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext) {
    await runScheduledTasks(getDb(env), Date.now());
  },
} satisfies ExportedHandler<Env>;
