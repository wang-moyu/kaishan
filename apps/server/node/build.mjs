// 把 Node 版服务端打成一个文件，并组装成可直接上传的 release 目录：
//   apps/server/dist-node/
//     server.mjs     服务端（依赖全部打进来，服务器上不需要 npm install）
//     web/           前端构建产物（需先 npm run build:web）
//     migrations/    数据库迁移
//     seed.sql       种子数据
//     deploy.sh      服务器端部署脚本（备份 → 切换 → 重启 → 健康检查，失败自动回滚）
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(serverDir, '..', '..');
const out = join(serverDir, 'dist-node');

rmSync(out, { recursive: true, force: true });

await build({
  entryPoints: [join(serverDir, 'node', 'server.ts')],
  outfile: join(out, 'server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  legalComments: 'none',
  // 个别依赖是 CommonJS，ESM 产物里要有 require。
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
});

const webDist = join(root, 'apps', 'web', 'dist');
if (!existsSync(join(webDist, 'index.html'))) {
  throw new Error('找不到前端构建产物，请先运行 npm run build:web');
}
cpSync(webDist, join(out, 'web'), { recursive: true });
cpSync(join(root, 'migrations'), join(out, 'migrations'), { recursive: true });
cpSync(join(root, 'scripts', 'seed', 'seed.sql'), join(out, 'seed.sql'));
cpSync(join(root, 'deploy', 'server', 'deploy.sh'), join(out, 'deploy.sh'));

console.log(`Node 版已构建：${out}`);
