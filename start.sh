#!/usr/bin/env bash
# 冷库数字孪生一键启动 (macOS / Linux)
cd "$(dirname "$0")"
if ! python3 -c "import mujoco, fastapi, uvicorn, numpy" 2>/dev/null; then
  echo "首次运行, 正在安装依赖..."
  pip3 install -r requirements.txt || \
  pip3 install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
fi
python3 run.py
