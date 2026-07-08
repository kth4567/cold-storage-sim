@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   冷库数字孪生 · Python 物理仿真
echo ============================================
python -c "import mujoco, fastapi, uvicorn, numpy" 2>nul
if errorlevel 1 (
    echo 首次运行, 正在安装依赖 ^(约 1-2 分钟^)...
    pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
    if errorlevel 1 (
        echo 镜像安装失败, 尝试官方源...
        pip install -r requirements.txt
    )
)
echo 启动服务器 http://127.0.0.1:8017 ...
python run.py
pause
