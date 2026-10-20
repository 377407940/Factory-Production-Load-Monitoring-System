#!/bin/bash
# ============================================
# 工厂负载监控系统 — 部署到阿里云
# ============================================
# 前置：SSH config 已配置 aliyun 别名；服务器已装 Node 18+ / PM2
#
# 用法：
#   bash deploy.sh                 # 常规部署（前端 + 后端源码 + 重启）
#   bash deploy.sh <ssh别名>        # 指定 SSH 别名，默认 aliyun
#   DEPLOY_DEPS=1 bash deploy.sh   # 额外执行 npm install --production（依赖有变动时才需要）
#
# ⚠️ 四个容易踩的坑，别改回去：
#   1) 前端必须"整体替换"，不能只 scp 覆盖。dist/ 里文件名带 hash，只增不删会越堆越多
#      （2026-09-29 清过一次：255 个文件 / 32MB → 21 个 / 1.4MB）。
#      本机 Git Bash 没有 rsync，所以用「传到 dist.new → mv 切换」达到同样效果，
#      顺带是零停机的（不存在"先删再传"的 404 窗口）。
#   2) scp 的源用【相对路径】。Windows 的 scp 会把 `D:` 当主机名，绝对路径会失败。
#   3) 不要覆盖 server/.env —— 服务器上的那份是生产密钥，本地没有。
#   4) 不要在这里动 Nginx。/monitor/ 是 proxy_pass 到 localhost:4000，
#      静态文件由 Express 的 express.static 提供，不是 Nginx alias。改 Nginx 属独立运维动作。
# ============================================

set -euo pipefail

SSH_HOST="${1:-aliyun}"
REMOTE_DIR="/var/www/factory-monitor"
FE_PARENT="$REMOTE_DIR/frontend/dashboard"
BE_SRC="$REMOTE_DIR/server/src"
HERE="$(cd "$(dirname "$0")" && pwd)"

# ssh/scp 重试：本机 SSH 走 ~/.ssh/connect_fallback.sh 的代理回退，
# 偶发会冒出「Could not resolve hostname aliyun」（配置读取抖动），直接中断整个部署。
# 只对 255（ssh 自身连接类错误）重试；远端命令返回非 0 属于业务结果，不重试。
MAX_TRY=3
ssh_retry() {
  local n=1 rc=0
  while :; do
    ssh "$@" && return 0
    rc=$?
    [ "$rc" -ne 255 ] && return "$rc"
    [ "$n" -ge "$MAX_TRY" ] && return "$rc"
    echo "  ⚠️ ssh 连接失败(255)，重试 $n/$MAX_TRY ..." >&2
    n=$((n + 1)); sleep 3
  done
}
scp_retry() {
  local n=1 rc=0
  while :; do
    scp "$@" && return 0
    rc=$?
    [ "$n" -ge "$MAX_TRY" ] && return "$rc"
    echo "  ⚠️ scp 失败($rc)，重试 $n/$MAX_TRY ..." >&2
    n=$((n + 1)); sleep 3
  done
}

echo "=== 1. 构建前端 ==="
cd "$HERE/frontend/dashboard"
pnpm build
LOCAL_DIST_COUNT="$(find dist -type f | wc -l)"

echo ""
echo "=== 2. 上传前端（整体替换，不留旧 hash 文件）==="
ssh_retry "$SSH_HOST" "mkdir -p $FE_PARENT; rm -rf $FE_PARENT/dist.new; mkdir -p $FE_PARENT/dist.new"
scp_retry -r dist/* "$SSH_HOST:$FE_PARENT/dist.new/"
ssh_retry "$SSH_HOST" "cd $FE_PARENT; [ -d dist ] && mv dist dist.old; mv dist.new dist; rm -rf dist.old"
REMOTE_DIST_COUNT="$(ssh_retry "$SSH_HOST" "find $FE_PARENT/dist -type f | wc -l")"
echo "远端 dist 文件数: $REMOTE_DIST_COUNT（本地 $LOCAL_DIST_COUNT 个）"

echo ""
echo "=== 3. 上传后端源码（整体替换；一次性调试脚本不上服务器）==="
cd "$HERE/server/src"
ssh_retry "$SSH_HOST" "rm -rf /tmp/be_src.new; mkdir -p /tmp/be_src.new"
scp_retry -r * "$SSH_HOST:/tmp/be_src.new/"
ssh_retry "$SSH_HOST" "cd /tmp/be_src.new; rm -f probe_*.js debug_*.js diag_*.js; cd $REMOTE_DIR/server; rm -rf src.old; [ -d src ] && mv src src.old; mv /tmp/be_src.new src; rm -rf src.old"
echo "远端 server/src 文件数: $(ssh_retry "$SSH_HOST" "find $BE_SRC -type f | wc -l")"

echo ""
echo "=== 4. 上传依赖清单与 PM2 配置（不覆盖 .env）==="
cd "$HERE/server"
scp_retry package.json "$SSH_HOST:$REMOTE_DIR/server/"
if [ -f "$HERE/ecosystem.config.js" ]; then
  scp_retry "$HERE/ecosystem.config.js" "$SSH_HOST:$REMOTE_DIR/"
fi

if [ -n "${DEPLOY_DEPS:-}" ]; then
  echo "=== 4b. 安装后端依赖 ==="
  ssh_retry "$SSH_HOST" "cd $REMOTE_DIR/server && npm install --production"
else
  echo "（跳过依赖安装；package.json 有变动时用 DEPLOY_DEPS=1 bash deploy.sh）"
fi

echo ""
echo "=== 5. 重启服务 ==="
ssh_retry "$SSH_HOST" "pm2 restart factory-monitor --update-env"

echo ""
echo "=== 6. 验证 ==="
sleep 8
ssh_retry "$SSH_HOST" "curl -s -o /dev/null -w '后端 /api/monitor/health → %{http_code}\n' http://127.0.0.1:4000/api/monitor/health"
ssh_retry "$SSH_HOST" "curl -s -k -o /dev/null -w '前端 /monitor/           → %{http_code}\n' -A DingTalk https://k3-aitable.xyz/monitor/"

echo ""
echo "=== ✅ 部署完成 ==="
echo "前端: https://k3-aitable.xyz/monitor/"
echo "API:  https://k3-aitable.xyz/api/monitor/health"
