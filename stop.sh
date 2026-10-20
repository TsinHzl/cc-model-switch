#!/bin/bash
# 一键停止 cc-model-switch 静态服务（幂等：未运行时静默通过）

cd "$(dirname "$0")"

PORT=15858
PID_FILE=".server.pid"

# 优先按 pidfile 精确停
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill "$PID" 2>/dev/null; then
    echo "🛑 已停止（pid $PID）"
  fi
  rm -f "$PID_FILE"
fi

# 兜底：清掉占用 15858 的残留进程（含 pidfile 丢失/pid 复用异常场景）
LEFT=$(lsof -ti :"$PORT" 2>/dev/null || true)
if [ -n "$LEFT" ]; then
  kill $LEFT 2>/dev/null || true
  echo "🛑 已清理端口 $PORT 残留进程：$(echo $LEFT | tr '\n' ' ')"
fi

exit 0
