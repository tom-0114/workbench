#!/usr/bin/env bash
# 本机执行：构建前端、打包已提交的后端代码、上传阿里云 ECS 并重启后端（可重复执行）。
#   ./deploy.sh                         # 默认服务器 aliyun-ecs（~/.ssh/config 里的别名）
#   SERVER=root@8.153.19.195 ./deploy.sh
# 服务器上不是 git 仓库，按快照覆盖；server/.env、server/node_modules 保留不动。
set -euo pipefail
SERVER="${SERVER:-aliyun-ecs}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
[ -z "$(git status --porcelain)" ] || { echo "工作区有未提交改动，先提交再部署"; exit 1; }

echo "== 构建前端（$(git log --oneline -1)）"
# Git Bash 会把 /workbench/ 当成路径改写成 Windows 路径，需关掉环境变量转换
MSYS2_ENV_CONV_EXCL='*' WEB_BASE_PATH=/workbench/ npm run build >/dev/null

echo "== 打包"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
git archive HEAD server | tar -C "$STAGE" -xf -
rm -f "$STAGE/server/.env.example"
cp -r dist "$STAGE/dist"
tar -C "$STAGE" -czf "$STAGE/workbench-deploy.tgz" server dist

echo "== 上传并部署到 $SERVER"
scp -o BatchMode=yes -q "$STAGE/workbench-deploy.tgz" "$SERVER:/tmp/"
ssh -o BatchMode=yes "$SERVER" 'set -e
  APP=/opt/apps/workbench
  TS=$(date +%Y%m%d-%H%M%S)
  # 先备份库和代码：新后端启动时会自动改表结构，出问题可回滚；各留最近 10 份
  mkdir -p /opt/backups
  docker exec postgres pg_dump -U postgres -Fc workbench > "/opt/backups/workbench-db-$TS.dump"
  tar -C "$APP" --exclude=./server/node_modules -czf "/opt/backups/workbench-app-$TS.tgz" .
  ls -1t /opt/backups/workbench-db-*.dump | tail -n +11 | xargs -r rm -f
  ls -1t /opt/backups/workbench-app-*.tgz | tail -n +11 | xargs -r rm -f

  STAGE=$(mktemp -d)
  tar -C "$STAGE" -xzf /tmp/workbench-deploy.tgz
  cp "$STAGE"/server/* "$APP/server/"
  rm -rf "$APP/dist" && mv "$STAGE/dist" "$APP/dist"
  rm -rf "$STAGE" /tmp/workbench-deploy.tgz
  (cd "$APP/server" && npm ci --omit=dev --silent)
  chown -R www-data:www-data "$APP"
  systemctl restart workbench-api

  for i in $(seq 1 10); do
    sleep 1
    code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3002/api/auth/session || true)
    [ "$code" = 200 ] && { echo "后端已启动，备份：/opt/backups/workbench-*-$TS.*"; exit 0; }
  done
  echo "后端启动失败，最近日志："; journalctl -u workbench-api -n 30 --no-pager; exit 1'
echo "已部署：https://luckykit.cn/workbench/"
