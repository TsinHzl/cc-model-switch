#!/bin/bash
# 一键启动 cc-model-switch 静态服务（端口 15858）
# 已在运行时先 stop 再 start

set -euo pipefail
cd "$(dirname "$0")"

PORT=15858
PID_FILE=".server.pid"

# 已启动则先停（stop.sh 幂等，未运行时静默通过）
if [ -f "$PID_FILE" ] || lsof -ti :"$PORT" >/dev/null 2>&1; then
  ./stop.sh
fi

# dist 不存在时自动构建（依赖缺失时先安装）
if [ ! -f dist/index.html ]; then
  echo "dist/ 不存在，先构建…"
  if [ ! -d node_modules ]; then
    echo "node_modules 不存在，先安装依赖…"
    npm install
  fi
  npm run build
fi

nohup node server.mjs > .server.log 2>&1 &
echo $! > "$PID_FILE"

# 等待端口就绪（最多 5s）
for _ in $(seq 1 20); do
  if curl -s -o /dev/null --max-time 1 "http://127.0.0.1:${PORT}/"; then
    echo "✅ 已启动 → http://127.0.0.1:${PORT}（pid $(cat "$PID_FILE")，日志 .server.log）"
    exit 0
  fi
  sleep 0.25
done

echo "❌ 启动失败，最近日志："
tail -20 .server.log
exit 1
