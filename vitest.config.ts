import { defineConfig } from 'vitest/config';

/**
 * 根级 vitest 只跑与平台无关的冒烟测试（工作区包导入等），运行在 node 环境。
 * Worker/D1 相关测试使用 workerd，配置在 apps/server/vitest.config.ts。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
