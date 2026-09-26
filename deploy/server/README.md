# 部署到自己的服务器（Node + SQLite）

同一份代码有两种运行方式：

| | Cloudflare | 自己的服务器 |
|---|---|---|
| 入口 | `apps/server/src/index.ts` | `apps/server/node/server.ts` |
| 数据库 | D1 | 本地 SQLite 文件（Node 内置 `node:sqlite`，无需安装驱动） |
| 定时任务 | Workers Cron（每 10 分钟） | 进程内计时器（每个整 10 分钟） |
| 静态资源 | Workers Assets | 同一个 Node 进程直接提供 |

推送 `main` 后由 GitHub Actions 决定部署到哪（仓库 Settings → Secrets and variables → Actions → **Variables**）：

- `DEPLOY_CF`：默认部署到 Cloudflare；设为 `false` 关闭
- `DEPLOY_SERVER`：设为 `true` 部署到服务器

服务器**不拉 GitHub 代码、不构建**：Actions 在 GitHub 的机器上构建好（约 3.5MB 压缩包），通过 SSH 传上来直接运行，服务器上也不需要 `npm install`。

---

## 一、服务器准备（只做一次，Debian 12 + 宝塔）

### 1. 安装 Node 22 和 pm2

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
npm config set registry https://registry.npmmirror.com   # 国内镜像，装 pm2 更快
npm i -g pm2
pm2 startup systemd   # 开机自启，按提示执行它输出的那条命令
node -v               # 需要 >= 22.13
```

> 若用宝塔「Node.js 版本管理器」安装的 Node，非交互 SSH 可能找不到 `node` / `pm2`：
> 在 `/www/wwwroot/xiuxian/deploy.env` 里写一行 `export PATH="/www/server/nodejs/v22.x.x/bin:$PATH"`（换成实际路径）。

### 2. 建目录和配置

```bash
mkdir -p /www/wwwroot/xiuxian
nano /www/wwwroot/xiuxian/.env
```

`.env` 内容参考 [.env.example](.env.example)，不写的项都用默认值。最少只需要：

```
PORT=8787
OPENROUTER_API_KEY=你的key（没有就留空）
```

### 3. 部署用的 SSH 密钥

在自己电脑上生成一对专用密钥（不设密码）：

```bash
ssh-keygen -t ed25519 -f xiuxian_deploy -N "" -C "github-deploy"
```

把 `xiuxian_deploy.pub` 的内容追加到服务器上**部署用户**的 `~/.ssh/authorized_keys`（例如 `/root/.ssh/authorized_keys`）。
部署用户 = 运行 pm2 的用户，需要对 `/www/wwwroot/xiuxian` 有读写权限。

### 4. 宝塔站点（反向代理 + HTTPS）

1. 网站 → 添加站点：填新域名，PHP 版本选「纯静态」。
2. 站点设置 → 反向代理 → 添加：目标 URL `http://127.0.0.1:8787`，发送域名 `$host`。
3. 站点设置 → SSL → Let's Encrypt 申请证书，打开「强制 HTTPS」。
4. 不要在防火墙/安全组放行 8787：服务只监听 127.0.0.1，统一由 nginx 对外。

宝塔的反向代理模板默认带 `Host`、`X-Real-IP` 头，游戏靠它们做同源校验和登录限频，不要删。

### 5. GitHub 仓库设置

Settings → Secrets and variables → Actions：

| 类型 | 名称 | 值 |
|---|---|---|
| Secret | `SERVER_HOST` | 服务器 IP 或域名 |
| Secret | `SERVER_USER` | 部署用户，如 `root` |
| Secret | `SERVER_SSH_KEY` | `xiuxian_deploy` 私钥文件的完整内容 |
| Secret | `SERVER_PORT` | SSH 端口（是 22 可不填） |
| Variable | `DEPLOY_SERVER` | `true` |
| Variable | `SERVER_APP_DIR` | `/www/wwwroot/xiuxian`（就是这个值可不填） |
| Variable | `DEPLOY_CF` | 不想再部署 Cloudflare 时填 `false` |

配好后在 Actions 页面对 `Deploy` 点「Re-run」或推送一次 `main`，就会完成第一次部署。

---

## 二、把 D1 的数据搬过来（只做一次）

1. 在自己电脑上导出（在**没有 wrangler 配置文件的目录**里执行，例如桌面）：

   ```bash
   npx wrangler d1 export xiuxian-game-db --remote --output d1.sql
   ```

2. 用宝塔文件管理把 `d1.sql` 传到 `/www/wwwroot/xiuxian/`。
3. 在服务器上替换掉第一次部署生成的空库，再导入：

   ```bash
   cd /www/wwwroot/xiuxian
   pm2 stop xiuxian
   rm -f data/xiuxian.db data/xiuxian.db-wal data/xiuxian.db-shm
   node app/server.mjs import d1.sql
   pm2 start xiuxian
   ```

导入会顺带执行尚未执行过的迁移。

---

## 三、日常

- **更新**：推送 `main` 即可。服务器上会自动：备份数据库 → 切换新版本 → 执行迁移 → `pm2 reload` → 健康检查，失败自动切回旧版本。
- **日志**：`pm2 logs xiuxian`
- **讨伐每日出手上限**：在 `.env` 里写 `WORLD_BOSS_DAILY_ATTACK_LIMIT=120`（不写默认 120，`0` = 不限），改完 `pm2 restart xiuxian` 生效，不用重新部署。
- **备份**：每次部署前自动备份到 `backups/`，保留最近 14 份。手动备份：`node app/server.mjs backup backups/manual.db`
- **手动回滚代码**：

  ```bash
  cd /www/wwwroot/xiuxian && mv app app.bad && mv app.prev app && pm2 reload xiuxian
  ```

- **恢复数据库**：

  ```bash
  cd /www/wwwroot/xiuxian
  pm2 stop xiuxian
  cp backups/某个备份.db data/xiuxian.db && rm -f data/xiuxian.db-wal data/xiuxian.db-shm
  pm2 start xiuxian
  ```

目录结构：

```
/www/wwwroot/xiuxian/
  .env            配置
  app/            当前版本（server.mjs、web/、migrations/、seed.sql、deploy.sh）
  app.prev/       上一个版本
  data/xiuxian.db 数据库
  backups/        数据库备份
```

## 本地试跑

```bash
npm run build:node                 # 构建前端 + Node 服务端到 apps/server/dist-node
npm run start:node -w apps/server  # http://127.0.0.1:8787，数据在 apps/server/data/
```

`scripts/accounts/manage.ts`（账号管理脚本）目前只支持 D1；服务器版开着注册（`REGISTRATION_ENABLED=true`）时用不到它。
