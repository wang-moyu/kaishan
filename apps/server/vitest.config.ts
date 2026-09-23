import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// 在 workerd 中运行测试，并直接读取 wrangler.jsonc（绑定来自真实配置）：
// 不使用 mock 代替 Worker/D1 运行时（见 06 禁止行为）。
// 注意：@cloudflare/vitest-pool-workers 0.22 起改用 cloudflareTest 插件，
// 不再提供 defineWorkersConfig 的 '/config' 子路径导出。
//
// 状态隔离（见 02 第 6 节、05 第 1 节）：
// - 开发状态目录：apps/server/.wrangler/state/dev（由 dev / db:migrate:local / db:seed:local 使用）。
// - 测试状态：pool 使用 workerd 内存存储并做隔离，不落盘、不碰开发目录；0.22 起该行为固定。
// 迁移语句在 Node 侧读入后作为绑定注入 workerd，由测试文件自己决定何时 applyD1Migrations，
// 这样既能验证「未迁移时 ready 失败」，也能验证「迁移后 ready 通过」。
const testMigrations = await readD1Migrations('../../migrations');

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: { TEST_MIGRATIONS: testMigrations },
      },
    }),
  ],
});
