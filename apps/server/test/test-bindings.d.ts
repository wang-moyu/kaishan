import type { D1Migration } from '@cloudflare/vitest-pool-workers';

/**
 * 测试专用绑定：由 apps/server/vitest.config.ts 在 Node 侧读取 migrations/ 后注入 workerd。
 * 只在 test/ 下使用；生产代码不得引用 TEST_MIGRATIONS（它没有出现在 wrangler.jsonc 里）。
 */
declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

export {};
