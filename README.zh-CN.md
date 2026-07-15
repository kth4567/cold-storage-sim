# 冷库数字孪生 · Python 驱动的真实物理仿真

[English](README.md) | **简体中文**

![Python](https://img.shields.io/badge/Python-3.10--3.14-blue)
![MuJoCo](https://img.shields.io/badge/物理引擎-MuJoCo%203.x-orange)
![Three.js](https://img.shields.io/badge/渲染-Three.js-black)
![License](https://img.shields.io/badge/License-MIT-green)

第一人称 3D 冷库巡检仿真，**所有物理都是 Python 后端实时计算的真实模拟**：
MuJoCo 刚体世界（带真实质量的电动平移库门、可以推动/抓取/投掷的货箱，拿箱子
堵门道真的能把门卡住）+ 第一性原理制冷热力学模型（开门空气渗透且受穿堂与风幕
机削减、压缩机温控循环、蒸发器结霜与化霜）。14×18×6 m 库房、8 组货架 40 吨
冻品，由 2 台吊顶式冷风机（6 风机，额定 52 kW）制冷，制冷管路、消防喷淋、
桥架线管全部按真实冷库建模。浏览器只负责渲染——整个仿真世界跑在服务端，通过
WebSocket 以 30Hz 推流。

| 黄昏外观 | 库内全景 |
| --- | --- |
| ![](docs/screenshots/exterior.png) | ![](docs/screenshots/interior.png) |
| **吊顶冷风机与机电管线** | **开门冷气外泄** |
| ![](docs/screenshots/ceiling.png) | ![](docs/screenshots/door-open.png) |

> **给 AI 助手 / 帮忙部署的人：按下面「快速开始」三条命令即可运行，
> 无需编译、无需数据库、无需 GPU、运行时无需联网（three.js 已内置在
> `frontend/vendor/`）。遇到问题直接看「常见问题排查」。**

---

## 快速开始

前置要求：**Python 3.10 – 3.14**（开发环境为 3.14），Windows / macOS / Linux 均可，
现代浏览器（Chrome / Edge / Firefox）。

```bash
# 1. 进入项目目录
cd cold-storage-sim

# 2. 安装依赖 (仅 4 个包)
pip install -r requirements.txt

# 3. 启动 (默认端口 8017, 会自动打开浏览器)
python run.py
```

浏览器访问 **http://127.0.0.1:8017** 即可。

- Windows 用户也可以直接**双击 `start.bat`**（会自动检测并安装缺失依赖）。
- macOS / Linux 可执行 `bash start.sh`。
- 换端口：`python run.py 8080`。

国内网络 `pip install` 失败或卡住时，改用清华镜像：

```bash
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
```

验证是否运行成功：

```bash
curl http://127.0.0.1:8017/api/state    # 返回一段 JSON 即为成功
```

---

## 操作说明

| 按键 | 功能 |
| --- | --- |
| 点击「进入冷库巡检」 | 锁定鼠标进入第一人称 |
| W / A / S / D + 鼠标 | 移动 / 视角（Shift 奔跑，空格跳跃） |
| E | 准星对准门开 / 关门（电动平移门，有真实质量，货箱堵在门道会把门卡住） |
| F | 抓取 / 放下准星前的货箱、圆桶、皮球 |
| 鼠标左键 | 投掷手中物体 |
| G | 在视线前方生成新货箱 |
| R | 复位整个场景（刚体 + 热力学） |
| T | 手动化霜 |
| 1 / 2 / 3 | 热力学时间倍率 1× / 30× / 120× |
| Esc | 释放鼠标（可点击右侧控制面板按钮） |

**推荐体验流程**：按 `2`（30 倍速）→ 对门按 E 开门 → 观察右上角渗透热负荷跳到
50+ kW（多亏穿堂和风幕机在削峰）、库温陡升、雾气从软门帘涌出、「库温超限 /
开门超时」报警弹出 → 关门看压缩机把温度拉回来 → 放进来的湿气在蒸发器上结霜，
超过 8kg 自动进入化霜循环（化霜期间吊顶风机会停转）。把货箱扔到门道再关门，
门会被真实卡住。

---

## 技术架构

```
浏览器 (Three.js 渲染 + 输入)
        ↕ WebSocket 30Hz 状态流 / 命令
Python 后端 (FastAPI, 60Hz 主循环)
        ├── MuJoCo 3.x 刚体物理: 库门(平移+伺服) / 12+货箱 / 圆桶 / 皮球 /
        │   玩家运动学碰撞球(推箱) / 抓取(PD悬浮力) / 投掷
        └── 热力学仿真: 围护结构导热 + Gosney-Olama 开门空气渗透(穿堂+风幕削减) +
            门框电加热 + 压缩机温控循环(卡诺折减COP) + 双吊顶冷风机风机负荷 +
            蒸发器结霜/电热化霜 + Magnus 湿度平衡 + 货物热惰性
            (库门开度取自物理引擎真实滑移行程)
```

### 项目结构

```
cold-storage-sim/
├── run.py                  # 启动入口: python run.py [端口]
├── start.bat / start.sh    # 一键启动脚本 (自动装依赖)
├── requirements.txt        # fastapi / uvicorn / mujoco / numpy
├── backend/
│   ├── server.py           # FastAPI + WebSocket 服务器, 60Hz 仿真主循环
│   ├── physics.py          # MuJoCo 刚体世界 (平移库门/货箱/抓取/投掷)
│   └── thermal.py          # 冷库热力学模型 (传热/渗透/制冷循环/结霜)
└── frontend/               # 纯静态, 由后端托管, 无需构建
    ├── index.html
    ├── css/style.css
    └── js/
        ├── main.js         # Three.js 场景 + WebSocket 同步 + 输入
        ├── textures.js     # 程序化 Canvas 贴图 (无外部图片依赖)
        └── ../vendor/      # three.js 0.164.1 及附加模块 (已本地化)
```

### HTTP / WebSocket 接口

- `GET /api/state` —— 完整状态快照（刚体位姿数组 + 热力学参数）
- `GET /api/history` —— 库温 / 功率历史序列
- `WS /ws` —— 连接后收到 `init`（场景清单），之后 30Hz `state` 流；
  客户端命令：`door` `grab` `throw` `spawn` `reset` `defrost` `speed` `player`

---

## 常见问题排查（供 AI 助手参考）

| 症状 | 原因与解决 |
| --- | --- |
| `pip install` 失败 / 断流 | 用清华镜像：`pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple` |
| `No matching distribution found for mujoco` | Python 版本过旧或过新导致无预编译 wheel。安装 64 位 Python 3.10–3.14 后重试 |
| 端口 8017 被占用 | 换端口：`python run.py 8020` |
| 页面能开但显示「连接断开」 | 后端进程没在运行；确认 `python run.py` 的终端没有报错退出 |
| 页面白屏 / 改动不生效 | 浏览器缓存，Ctrl+F5 强制刷新 |
| `ImportError: DLL load failed`（Windows, mujoco） | 安装 [VC++ 运行库](https://aka.ms/vs/17/release/vc_redist.x64.exe) 后重试 |
| 鼠标点「进入巡检」没反应 | 浏览器阻止了指针锁定，再点一次；不要在 iframe 里打开 |
| 帧率低 | 核显笔记本属正常（约 40-60fps）；关闭其他占 GPU 的程序 |

实现细节备注：仿真主循环在 `backend/server.py` 的 `sim_loop()`；物理步长 4ms、
状态流 30Hz；热力学默认 30 倍速（UI 可调）。前端所有纹理为运行时 Canvas 程序化
生成，three.js 全部模块已本地化——**整个项目离线可运行**（仅 pip 装依赖需要一次网络）。

## 开源协议

[MIT](LICENSE)
