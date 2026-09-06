#!/bin/bash
# 双击启动健康日志（macOS）：服务器没跑就启动，已在跑就直接打开浏览器
cd "$(dirname "$0")"
if curl -s -m 2 http://127.0.0.1:8000/api/ping >/dev/null 2>&1; then
  echo "服务器已在运行，直接打开页面…"
  open "http://127.0.0.1:8000"
  exit 0
fi
echo "=============================================="
echo "  健康日志 · 正在启动..."
echo "  关闭本窗口或按 Ctrl+C 即可停止"
echo "=============================================="
python3 server.py
echo ""
echo "服务器已停止，本窗口可以直接关闭。"
