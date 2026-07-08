# -*- coding: utf-8 -*-
"""冷库数字孪生服务器。

FastAPI + WebSocket:
  * 60Hz 物理步进 (MuJoCo), 30Hz 状态广播
  * 热力学仿真与物理引擎耦合 (库门开度 -> 空气渗透)
  * REST: /api/state 快照, /api/history 温度历史
  * 静态托管 frontend/
"""

import asyncio
import json
import time
from collections import deque
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .physics import ColdRoomWorld
from .thermal import ColdRoomSim

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
FRAME_DT = 1 / 60
BROADCAST_EVERY = 2          # 30Hz

world = ColdRoomWorld()
therm = ColdRoomSim()
time_scale = 30.0            # 热力学仿真加速倍数
clients: set[WebSocket] = set()
history: deque = deque(maxlen=720)     # (simTime, tIn, tOut, rhIn, powerKw)
_last_hist = 0.0


async def sim_loop():
    global _last_hist
    frame = 0
    next_t = time.perf_counter()
    while True:
        world.step(FRAME_DT)
        therm.door_frac = world.door_frac
        therm.step(FRAME_DT * time_scale)

        if therm.sim_time - _last_hist >= 20.0:      # 每 20 仿真秒记一点
            _last_hist = therm.sim_time
            history.append([round(therm.sim_time, 1), round(therm.t_in, 2),
                            round(therm.t_out, 2), round(therm.rh_in * 100, 1),
                            round(therm.power / 1000, 2)])

        frame += 1
        if frame % BROADCAST_EVERY == 0 and clients:
            payload = world.state()
            payload["t"] = "state"
            payload["th"] = therm.snapshot()
            payload["scale"] = time_scale
            msg = json.dumps(payload, separators=(",", ":"))
            dead = []
            for ws in clients:
                try:
                    await ws.send_text(msg)
                except Exception:
                    dead.append(ws)
            for ws in dead:
                clients.discard(ws)

        next_t += FRAME_DT
        delay = next_t - time.perf_counter()
        if delay > 0:
            await asyncio.sleep(delay)
        else:                      # 落后则重置节拍, 不追帧
            next_t = time.perf_counter()
            await asyncio.sleep(0)


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(sim_loop())
    yield
    task.cancel()


app = FastAPI(title="冷库数字孪生", lifespan=lifespan)


@app.get("/api/state")
async def api_state():
    s = world.state()
    s["th"] = therm.snapshot()
    s["scale"] = time_scale
    return JSONResponse(s)


@app.get("/api/history")
async def api_history():
    return JSONResponse(list(history))


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    global time_scale, therm, _last_hist
    await ws.accept()
    clients.add(ws)
    await ws.send_text(json.dumps({
        "t": "init",
        "bodies": world.manifest(),
        "snapshot": therm.snapshot(),
        "scale": time_scale,
        "history": list(history),
    }, separators=(",", ":")))
    try:
        while True:
            raw = await ws.receive_text()
            try:
                m = json.loads(raw)
            except ValueError:
                continue
            c = m.get("c")
            if c == "player":
                world.set_player(m["pos"])
                if world.held:
                    world.update_hold(m["pos"], m["dir"])
            elif c == "door":
                world.toggle_door()
            elif c == "grab":
                if world.held:
                    world.release()
                else:
                    world.grab(m["pos"], m["dir"])
            elif c == "throw":
                world.release(throw_dir=m["dir"])
            elif c == "spawn":
                if world.spawn(m["pos"], m["dir"]) is None:
                    await ws.send_text(json.dumps(
                        {"t": "note", "msg": "无法生成货箱（空间不足或备用已用尽）"},
                        separators=(",", ":")))
            elif c == "reset":
                world.reset()
                therm = ColdRoomSim()        # 热力学/能耗/结霜一并复位
                history.clear()
                _last_hist = 0.0
            elif c == "defrost":
                therm.manual_defrost()
            elif c == "speed":
                v = float(m.get("v", 30))
                time_scale = max(1.0, min(v, 240.0))
    except WebSocketDisconnect:
        pass
    finally:
        clients.discard(ws)
        if world.held:
            world.release()


app.mount("/", StaticFiles(directory=str(FRONTEND), html=True), name="static")
