#!/usr/bin/env bash
# 服务器端部署脚本（GitHub Actions 把 release 传到 <HOME>/incoming/ 后通过 SSH 调用）：
#   1. 备份数据库 → 2. 切换版本（旧版保留为 app.prev）→ 3. 执行迁移
#   4. pm2 重启 → 5. 健康检查；迁移或健康检查失败就切回旧版本。
# 目录：<HOME>/app（当前版本）、<HOME>/.env、<HOME>/data/xiuxian.db、<HOME>/backups/
set -euo pipefail

INCOMING="$(cd "$(dirname "$0")" && pwd)"
HOME_DIR="$(dirname "$INCOMING")"
APP="$HOME_DIR/app"
PREV="$HOME_DIR/app.prev"
NAME="${PM2_NAME:-xiuxian}"
NODE_ARGS="--disable-warning=ExperimentalWarning"

# 非交互 SSH 的 PATH 可能不含 node / pm2 的目录；需要时在 <HOME>/deploy.env 里补 PATH。
[ -f "$HOME_DIR/deploy.env" ] && . "$HOME_DIR/deploy.env"
export PATH="$PATH:/usr/local/bin:/usr/bin"

PORT="$(grep -E '^PORT=' "$HOME_DIR/.env" 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '"'"'"' ')"
PORT="${PORT:-8787}"

cd "$HOME_DIR"

echo "==> 备份数据库"
node $NODE_ARGS "$INCOMING/server.mjs" backup "$HOME_DIR/backups/$(date +%Y%m%d-%H%M%S).db"

echo "==> 切换版本"
rm -rf "$PREV" "$HOME_DIR/app.failed"
[ -d "$APP" ] && mv "$APP" "$PREV"
mv "$INCOMING" "$APP"

rollback() {
  echo "!!! $1，回滚到上一版本"
  rm -rf "$HOME_DIR/app.failed"
  mv "$APP" "$HOME_DIR/app.failed"
  if [ -d "$PREV" ]; then
    mv "$PREV" "$APP"
    pm2 reload "$NAME" --update-env || true
  fi
  exit 1
}

echo "==> 执行迁移"
node $NODE_ARGS "$APP/server.mjs" migrate || rollback "迁移失败"

echo "==> 重启服务"
if pm2 describe "$NAME" >/dev/null 2>&1; then
  pm2 reload "$NAME" --update-env
else
  pm2 start "$APP/server.mjs" --name "$NAME" --cwd "$HOME_DIR" --node-args="$NODE_ARGS"
  pm2 save
fi

echo "==> 健康检查"
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$PORT/api/v1/health/ready" >/dev/null 2>&1; then
    echo "==> 部署完成"
    exit 0
  fi
  sleep 1
done
rollback "健康检查失败"
