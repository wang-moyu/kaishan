import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// 本地 Worker（wrangler dev）默认监听 127.0.0.1:8787。
// 开发时全部 /api 请求经此代理到 Worker；生产环境由 Cloudflare Route 把 /api/* 交给 Worker。
const workerDevTarget = 'http://127.0.0.1:8787';

const apiProxy = {
  '/api': { target: workerDevTarget },
};

export default defineConfig({
  plugins: [vue()],
  // 旧浏览器语法目标（见 02 第 7 节）；语法编译不等于 Web API/CSS 兼容，真机实测属于发布门禁
  build: {
    target: ['chrome109', 'firefox115'],
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: apiProxy,
    // 允许任意 Host：经 frp / ngrok / 内网穿透等隧道用别的域名访问时不报
    // "Blocked request. This host is not allowed."（Vite 的 DNS 重绑定防护，这里主动关掉）。
    allowedHosts: true,
  },
  // 构建预览同样代理 /api，便于本地检查构建产物；实际后端仍需另行启动 Worker
  preview: {
    port: 4173,
    strictPort: true,
    proxy: apiProxy,
    allowedHosts: true,
  }
});
