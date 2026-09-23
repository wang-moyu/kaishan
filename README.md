# 开山立派

《开山立派》是一款修仙题材的宗门经营挂机文字网页游戏：从一处散修驻地起步，开山立派，直至仙门至尊，可多人在线。前后端都运行在 Cloudflare 上（Workers + D1），不需要自备服务器。

## 玩法简介

- **宗门经营**：弟子在修炼 / 药园 / 采矿 / 采灵岗位上产出资源，离线最多累计 12 小时收益；升级建筑、招募弟子、提升宗门等级（10 级）。
- **弟子成长**：炼气 → 筑基 → 金丹 → 元婴 → 化神，突破有成功率；天赋与六项属性影响产出和战力。
- **玩法**：秘境探索、弟子历练、炼丹、宗门挑战、坊市交易。
- **赌坊**：论道、天机轮、灵兽竞逐（10 分钟一轮的全服竞猜，整点开跑）。
- **社交**：全服聊天、宗门排行、天骄榜。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vue 3 + Vite |
| 后端 | Cloudflare Workers + Hono |
| 数据库 | Cloudflare D1 |
| 定时任务 | Workers Cron Triggers（灵兽竞逐结算） |

## 部署到 Cloudflare

### 方式一：一键部署

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wang-moyu/kaishan)

点击按钮后按页面提示操作：Cloudflare 会把仓库复制到你的 GitHub、创建 D1 数据库，并在部署时自动执行数据库迁移。表单里的 Worker 名称和数据库名称可以自行修改。

### 方式二：Fork + GitHub Actions

仓库自带 GitHub Actions：推送到 `main` 分支就会自动构建、执行数据库迁移并部署。

1. **Fork 本仓库。**
2. **创建 D1 数据库**（在 Cloudflare 控制台创建，或执行下面的命令），记下 `database_id`：
   ```bash
   npx wrangler d1 create xiuxian-game-db
   ```
3. **在 Cloudflare 创建 API Token**，使用模板「Edit Cloudflare Workers」，并额外加上 D1 的编辑权限。
4. **在 GitHub 仓库的 Settings → Secrets and variables → Actions 中添加三个 secret：**

   | 名称 | 内容 |
   |---|---|
   | `CLOUDFLARE_API_TOKEN` | 上一步创建的 Token |
   | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID |
   | `D1_DATABASE_ID` | 第 2 步记下的 `database_id` |

   并在同一页面的 **Variables** 标签中添加变量 `DEPLOY_ENABLED`，值为 `true`（未设置时部署流程会跳过）。

5. **推送到 `main`**（或在 Actions 页面手动重新运行），等待部署完成。
6. **可选：** 秘境探索可以接入 AI 判定。执行 `npx wrangler secret put OPENROUTER_API_KEY` 设置 OpenRouter 的 key；不设置时会自动改用本地随机判定，游戏照常可玩。

### 注册与账号

生产配置 `apps/server/wrangler.production.jsonc` 默认开放注册：

- `REGISTRATION_ENABLED`：是否允许注册（`"true"` / `"false"`）。
- `INVITE_CODES`：邀请码，多个用逗号分隔。留空表示注册不需要邀请码。

提示：登录和注册使用 Argon2id 密码哈希，CPU 开销较高。如果在 Workers 免费版上遇到 CPU 超限错误（1102），可以考虑升级到付费版。

## 本地开发

需要 Node.js 22.13 或以上。

```bash
npm ci
npm run db:migrate:local
npm run dev:server   # 终端 1：本地 Worker（127.0.0.1:8787）
npm run dev:web      # 终端 2：前端（localhost:5173）
```


## 许可证

[MIT](LICENSE)
