# 冷库数字孪生 · Python 物理仿真 (Cold Storage Digital Twin)

第一人称 3D 冷库巡检仿真。**后端 Python 驱动真实物理**：MuJoCo 刚体动力学引擎 +
第一性原理冷库热力学模型；前端 Three.js 只负责渲染，通过 WebSocket 实时同步。

> **给 AI 助手 / 帮忙部署的人：按下面「快速开始」三条命令即可运行，
> 无需编译、无需数据库、无需 GPU、无需联网下载前端资源（three.js 已内置在
> `frontend/vendor/`）。遇到问题直接看「常见问题排查」。**

---

## 快速开始

前置要求：**Python 3.10 – 3.14**（开发环境为 3.14），Windows / macOS / Linux 均可，
现代浏览器（Chrome / Edge / Firefox）。

```bash
# 1. 进入项目目录
cd cold-storage-sim

# 2. 安装依赖 (仅 4 个包; 中国大陆网络请用清华镜像, 见下方备注)
pip install -r requirements.txt

# 3. 启动 (默认端口 8017, 会自动打开浏览器)
python run.py
```

浏览器访问 **http://127.0.0.1:8017** 即可。

- Windows 用户也可以直接**双击 `start.bat`**（会自动检测并安装缺失依赖）。
- macOS / Linux 可执行 `bash start.sh`。
- 换端口：`python run.py 8080`。

### 中国大陆网络备注

pypi.org 直连可能断流。若 `pip install` 失败或卡住，改用清华镜像：

```bash
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
```

### 验证是否运行成功

```bash
curl http://127.0.0.1:8017/api/state
# 返回一段 JSON (刚体位姿 + 温度数据) 即为成功
```

---

## 操作说明

| 按键 | 功能 |
| --- | --- |
| 点击「进入冷库巡检」 | 锁定鼠标进入第一人称 |
| W / A / S / D + 鼠标 | 移动 / 视角（Shift 奔跑，空格跳跃） |
| E | 准星对准门开 / 关门（门有真实质量与惯量，会被货箱卡住） |
| F | 抓取 / 放下准星前的货箱、圆桶、皮球 |
| 鼠标左键 | 投掷手中物体 |
| G | 在视线前方生成新货箱 |
| R | 复位整个场景（刚体 + 热力学） |
| T | 手动化霜 |
| 1 / 2 / 3 | 热力学时间倍率 1× / 30× / 120× |
| Esc | 释放鼠标（可点击右侧控制面板按钮） |

**推荐体验流程**：按 `2`（30 倍速）→ 对门按 E 开门 → 观察右上角渗透热负荷飙到
100+ kW、库温陡升、雾气涌出、报警弹出 → 关门看压缩机把温度拉回来 → 湿气结霜
超过 8kg 自动进入化霜循环。把货箱扔到门口再关门，门会被真实卡住。

---

## 项目结构

```
cold-storage-sim/
├── run.py                  # 启动入口: python run.py [端口]
├── start.bat / start.sh    # 一键启动脚本 (自动装依赖)
├── requirements.txt        # fastapi / uvicorn / mujoco / numpy
├── backend/
│   ├── server.py           # FastAPI + WebSocket 服务器, 60Hz 仿真主循环
│   ├── physics.py          # MuJoCo 刚体世界 (库门铰链/货箱/抓取/投掷)
│   └── thermal.py          # 冷库热力学模型 (传热/渗透/制冷循环/结霜)
└── frontend/               # 纯静态, 由后端托管, 无需构建
    ├── index.html
    ├── css/style.css
    └── js/
        ├── main.js         # Three.js 场景 + WebSocket 同步 + 输入
        ├── textures.js     # 程序化 Canvas 贴图 (无外部图片依赖)
        └── ../vendor/      # three.js 0.164.1 及附加模块 (已本地化)
```

## 技术架构

```
浏览器 (Three.js 渲染 + 输入)
        ↕ WebSocket 30Hz 状态流 / 命令
Python 后端 (FastAPI, 60Hz 主循环)
        ├── MuJoCo 3.x 刚体物理: 库门(铰链+伺服) / 12+货箱 / 圆桶 / 皮球 /
        │   玩家运动学碰撞球(推箱) / 抓取(PD悬浮力) / 投掷
        └── 热力学仿真: 围护结构导热 + Gosney-Olama 开门空气渗透 +
            压缩机温控循环(卡诺折减COP) + 蒸发器结霜/电热化霜 +
            Magnus 湿度平衡 + 货物热惰性 (库门开度取自物理引擎真实门角)
```

## HTTP / WebSocket 接口

- `GET /api/state` —— 完整状态快照（刚体位姿数组 + 热力学参数）
- `GET /api/history` —— 库温 / 功率历史序列
- `WS /ws` —— 连接后收到 `init`（场景清单），之后 30Hz `state` 流；
  客户端命令：`door` `grab` `throw` `spawn` `reset` `defrost` `speed` `player`

---

## 常见问题排查（供 AI 助手参考）

| 症状 | 原因与解决 |
| --- | --- |
| `pip install` 失败 / 断流 / IncompleteRead | 用清华镜像：`pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple` |
| `No matching distribution found for mujoco` | Python 版本过旧或过新导致无预编译 wheel。安装 Python 3.10–3.14 后重试；确认 64 位 Python |
| 端口 8017 被占用 (`error while attempting to bind`) | 换端口：`python run.py 8020`，浏览器访问对应端口 |
| 页面能开但显示「连接断开」 | 后端进程没在运行；确认 `python run.py` 的终端没有报错退出 |
| 页面白屏 / 改动不生效 | 浏览器缓存，Ctrl+F5 强制刷新 |
| `ImportError: DLL load failed`（Windows, mujoco） | 安装 [VC++ 运行库](https://aka.ms/vs/17/release/vc_redist.x64.exe) 后重试 |
| 鼠标点「进入巡检」没反应 | 浏览器阻止了指针锁定，再点一次；不要在 iframe 里打开 |
| 帧率低 | 核显笔记本属正常（约 40-60fps）；关闭其他占 GPU 的程序 |

技术细节备注：仿真主循环在 `backend/server.py` 的 `sim_loop()`；物理步长 4ms、
渲染流 30Hz；热力学默认 30 倍速（UI 可调）。前端所有纹理为运行时 Canvas 程序化
生成，vendor 已包含全部 three.js 模块，**整个项目离线可运行**（除 pip 装依赖外
不需要任何网络）。
