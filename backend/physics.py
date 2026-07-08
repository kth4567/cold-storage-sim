# -*- coding: utf-8 -*-
"""MuJoCo 刚体物理世界 —— 冷库场景。

坐标系约定: 直接使用 Three.js 坐标 (Y 轴向上), 重力设为 (0,-9.81,0),
因此位置/四元数无需在前后端之间做基变换, 仅四元数分量顺序转换
(MuJoCo wxyz -> Three.js xyzw)。

动态体:
  * 库门     铰链关节 + 位置伺服执行器, 有质量/惯量/阻尼, 可被货箱卡住
  * 货箱x12  自由刚体, 可推动/抓取/投掷/生成
  * 圆桶x2   圆柱刚体
  * 皮球x1   球体, condim=6 带滚动摩擦
  * 玩家     mocap 运动学球体, 与货箱碰撞(走路撞箱会推开), 站在门口能卡住门

碰撞位掩码 (rule: (ct1&ca2)|(ct2&ca1)):
  静态 ct=1 ca=0 | 货箱/桶/球 ct=2 ca=15 | 库门 ct=4 ca=10 | 玩家 ct=8 ca=0
  -> 门不与墙碰撞(门扇与门框视觉上搭接, 物理上由铰链限位约束),
     门与货箱/玩家碰撞(货箱可以卡门), 玩家不与静态墙碰撞(前端处理)。
"""

import math
import random

import mujoco
import numpy as np

DOOR_OPEN_ANGLE = 1.92           # rad, 向外开(+z 院子方向), 扫掠区无障碍
TIMESTEP = 0.004

# 静态障碍 xz 包围盒 (minX, maxX, minZ, maxZ), 供 spawn 落点校验
STATIC_AABBS = [
    (-4.85, -4.65, -7.1, 5.2), (4.65, 4.85, -7.1, 5.2),      # 左右墙
    (-4.85, 4.85, -7.1, -6.9),                                 # 后墙
    (-4.85, -1.3, 4.89, 5.11), (1.3, 4.85, 4.89, 5.11),        # 前墙两侧
    (5.9, 12.8, 3.0, 5.8),                                     # 压缩机平台
    (7.85, 12.55, -3.45, -1.15),                               # 冷凝器
] + [(x - 1.65, x + 1.65, z - 0.55, z + 0.55)                  # 货架 4 组
     for x in (-2.75, 2.75) for z in (-4.9, -2.45)] \
  + [(x - 0.15, x + 0.15, z - 0.15, z + 0.15)                  # 护柱 4 根
     for x, z in ((-3.8, 6.2), (3.8, 6.2), (6.2, 5.95), (13.1, 5.95))]

CRATE_COLORS = ["#b88745", "#a8793c", "#c29354", "#9c7038", "#b3824a"]


def _box(name, pos, half, rgba="0.5 0.5 0.5 1", extra=""):
    return (f'<geom name="{name}" type="box" pos="{pos[0]} {pos[1]} {pos[2]}" '
            f'size="{half[0]} {half[1]} {half[2]}" rgba="{rgba}" {extra}/>')


class ColdRoomWorld:
    def __init__(self):
        random.seed(7)
        self.bodies = []          # 动态体清单(发给前端)
        self.pool_ids = []        # 备用生成货箱
        self.held = None          # 抓取中的 body 名称
        self.hold_target = np.zeros(3)
        xml = self._build_xml()
        self.model = mujoco.MjModel.from_xml_string(xml)
        self.data = mujoco.MjData(self.model)
        mujoco.mj_forward(self.model, self.data)

        self.door_jnt = self.model.joint("door_hinge")
        self.door_act = self.model.actuator("door_servo").id
        self.player_mocap = self.model.body("player").mocapid[0]
        self._body_ids = [self.model.body(b["name"]).id for b in self.bodies]
        self._jnt_by_body = {}
        for b in self.bodies:
            bid = self.model.body(b["name"]).id
            jadr = self.model.body_jntadr[bid]
            self._jnt_by_body[b["name"]] = jadr
        self.door_target_open = False
        self._accum = 0.0

    # ------------------------------------------------------------------
    def _dyn_body(self, name, shape, pos, size, mass, color, euler="0 0 0",
                  friction="0.55 0.005 0.0001", condim=3, pool=False):
        """登记一个自由刚体并返回 MJCF 片段。size 为完整尺寸(米)。"""
        self.bodies.append({"name": name, "shape": shape, "size": size,
                            "color": color, "pool": pool})
        if shape == "box":
            geo = (f'<geom type="box" size="{size[0]/2} {size[1]/2} {size[2]/2}" '
                   f'mass="{mass}" friction="{friction}" condim="{condim}" '
                   f'contype="2" conaffinity="15"/>')
        elif shape == "cylinder":
            geo = (f'<geom type="cylinder" size="{size[0]} {size[1]/2}" euler="1.5708 0 0" '
                   f'mass="{mass}" friction="{friction}" condim="{condim}" '
                   f'contype="2" conaffinity="15"/>')
        else:  # sphere
            geo = (f'<geom type="sphere" size="{size[0]}" mass="{mass}" '
                   f'friction="{friction}" condim="{condim}" '
                   f'contype="2" conaffinity="15"/>')
        return (f'<body name="{name}" pos="{pos[0]} {pos[1]} {pos[2]}" euler="{euler}">'
                f'<freejoint/>{geo}</body>')

    def _build_xml(self) -> str:
        s = []   # 静态几何
        # 地坪
        s.append(_box("floor", (4, -0.15, -1), (19, 0.15, 17), extra='friction="0.8 0.01 0.0001"'))
        # 冷库围护 (内空 9.5 x 12 x 4.5, 中心 z=-1)
        s.append(_box("wall_l", (-4.75, 2.25, -1), (0.09, 2.25, 6)))
        s.append(_box("wall_r", (4.75, 2.25, -1), (0.09, 2.25, 6)))
        s.append(_box("wall_b", (0, 2.25, -7), (4.75, 2.25, 0.09)))
        s.append(_box("wall_fl", (-3.025, 2.25, 5), (1.725, 2.25, 0.11)))
        s.append(_box("wall_fr", (3.025, 2.25, 5), (1.725, 2.25, 0.11)))
        s.append(_box("header", (0, 4.0, 5), (1.35, 0.5, 0.11)))
        s.append(_box("ceiling", (0, 4.5, -1), (4.75, 0.09, 6)))
        # 货架 (4 组近似长方体, 靠后墙两排)
        for i, x in enumerate((-2.75, 2.75)):
            for j, z in enumerate((-4.9, -2.45)):
                s.append(_box(f"rack_{i}{j}", (x, 1.6, z), (1.65, 1.6, 0.55)))
        # 设备平台与机组
        s.append(_box("platform", (9.4, 0.28, 4.4), (3.5, 0.175, 1.3)))
        s.append(_box("equip_a", (9.35, 1.1, 4.4), (3.45, 1.1, 1.4)))
        s.append(_box("equip_b", (10.2, 2.0, -2.3), (2.35, 2.0, 1.15)))
        # 安全护柱 (与前端视觉一致, 货箱/皮球可撞)
        for k, (bx, bz) in enumerate(((-3.8, 6.2), (3.8, 6.2), (6.2, 5.95), (13.1, 5.95))):
            s.append(f'<geom name="bollard_{k}" type="cylinder" pos="{bx} 0.62 {bz}" '
                     f'size="0.13 0.625" euler="1.5708 0 0"/>')
        # 隐藏停放层 (备用货箱)
        s.append(_box("park_slab", (-10, -4.5, -10), (9, 0.1, 4)))

        d = []   # 动态体
        # 库门: 铰链在 x=1.35, 门扇覆盖 x -1.35..1.35, 高 3.55
        d.append(
            '<body name="door" pos="1.35 0 5.15">'
            '<joint name="door_hinge" type="hinge" axis="0 1 0" pos="0 0 0" '
            'range="-0.02 1.95" damping="90" frictionloss="4" limited="true"/>'
            '<geom name="door_slab" type="box" pos="-1.35 1.775 0" '
            'size="1.35 1.775 0.11" mass="95" friction="0.4 0.005 0.0001" '
            'contype="4" conaffinity="10"/>'
            "</body>")
        # 货箱: 门内堆垛 + 巷道散放 + 库外
        crate_pos = [
            (-0.45, 0.23, 2.05), (0.22, 0.23, 2.10), (-0.10, 0.23, 1.48),
            (-0.24, 0.69, 2.02), (0.04, 0.69, 1.70),
            (-0.10, 1.15, 1.86),
            (0.30, 0.23, -0.50), (-0.50, 0.23, -2.20), (0.15, 0.23, -4.60),
            (5.90, 0.23, 7.20), (6.60, 0.23, 6.90), (7.40, 0.23, 7.60),
        ]
        for i, p in enumerate(crate_pos):
            w = 0.50 + random.random() * 0.08
            dep = 0.42 + random.random() * 0.06
            col = CRATE_COLORS[i % len(CRATE_COLORS)]
            d.append(self._dyn_body(f"crate_{i}", "box", p, [w, 0.44, dep],
                                    mass=11 + random.random() * 5, color=col,
                                    euler=f"0 {random.uniform(-0.14, 0.14):.3f} 0"))
        # 备用货箱池 (停放在地下, spawn 时瞬移)
        for i in range(10):
            name = f"crate_p{i}"
            d.append(self._dyn_body(name, "box", (-16 + i * 1.6, -4.16, -10),
                                    [0.52, 0.44, 0.44], mass=12,
                                    color=CRATE_COLORS[i % len(CRATE_COLORS)], pool=True))
            self.pool_ids.append(name)
        # 圆桶
        d.append(self._dyn_body("barrel_0", "cylinder", (5.25, 0.43, 6.20),
                                [0.28, 0.84], mass=26, color="#2565a8"))
        d.append(self._dyn_body("barrel_1", "cylinder", (12.40, 0.43, 6.60),
                                [0.28, 0.84], mass=26, color="#a83a25"))
        # 皮球
        d.append(self._dyn_body("ball_0", "sphere", (0.0, 0.26, -6.05),
                                [0.24], mass=3.5, color="#d8452e",
                                friction="0.6 0.008 0.0003", condim=6))

        return f"""
<mujoco model="coldroom">
  <compiler angle="radian"/>
  <option gravity="0 -9.81 0" timestep="{TIMESTEP}" integrator="implicitfast"/>
  <default>
    <geom contype="1" conaffinity="0" friction="0.7 0.005 0.0001"/>
  </default>
  <worldbody>
    {''.join(s)}
    {''.join(d)}
    <body name="player" mocap="true" pos="0 0.95 10.5">
      <geom name="player_geom" type="sphere" size="0.35" contype="8" conaffinity="0"/>
    </body>
  </worldbody>
  <actuator>
    <position name="door_servo" joint="door_hinge" kp="550" kv="40"
              forcerange="-2200 2200" ctrlrange="-0.02 1.95"/>
  </actuator>
</mujoco>"""

    # ------------------------------------------------------------------
    def manifest(self):
        return [{"name": b["name"], "shape": b["shape"], "size": b["size"],
                 "color": b["color"], "pool": b["pool"]} for b in self.bodies]

    @property
    def door_angle(self) -> float:
        return float(self.data.qpos[self.door_jnt.qposadr[0]])

    @property
    def door_frac(self) -> float:
        return min(abs(self.door_angle) / abs(DOOR_OPEN_ANGLE), 1.0)

    # ------------------------------------------------------------------
    def set_player(self, pos):
        # 碰撞球中心跟随相机高度(眼高-0.75), 跳跃时能越过低处货箱
        y = min(max(pos[1] - 0.75, 0.4), 3.0)
        self.data.mocap_pos[self.player_mocap] = [pos[0], y, pos[2]]

    def toggle_door(self):
        self.door_target_open = not self.door_target_open
        self.data.ctrl[self.door_act] = DOOR_OPEN_ANGLE if self.door_target_open else 0.0
        return self.door_target_open

    def _body_pos(self, name):
        return self.data.xpos[self.model.body(name).id]

    def _free_qadr(self, name):
        jadr = self._jnt_by_body[name]
        return self.model.jnt_qposadr[jadr], self.model.jnt_dofadr[jadr]

    def grab(self, cam_pos, cam_dir) -> str | None:
        """选取视线前方 3m 内夹角最小的可抓刚体。"""
        cam = np.array(cam_pos, dtype=float)
        d = np.array(cam_dir, dtype=float)
        d /= (np.linalg.norm(d) + 1e-9)
        best, best_score = None, 0.0
        for b in self.bodies:
            p = self._body_pos(b["name"])
            v = p - cam
            dist = np.linalg.norm(v)
            if dist < 0.3 or dist > 3.2 or p[1] < -1:
                continue
            cos = float(np.dot(v / dist, d))
            if cos > 0.82:
                score = cos / (0.5 + dist)
                if score > best_score:
                    best, best_score = b["name"], score
        self.held = best
        if best is not None:
            self.update_hold(cam_pos, cam_dir)   # 立刻锚定悬持点, 避免拉向原点
        return best

    def release(self, throw_dir=None):
        if self.held is None:
            return
        name, self.held = self.held, None
        if throw_dir is not None:
            _, dofadr = self._free_qadr(name)
            d = np.array(throw_dir, dtype=float)
            d /= (np.linalg.norm(d) + 1e-9)
            vel = d * 8.5 + np.array([0, 1.4, 0])
            self.data.qvel[dofadr:dofadr + 3] = vel
            self.data.qvel[dofadr + 3:dofadr + 6] = np.random.uniform(-2, 2, 3)

    def update_hold(self, cam_pos, cam_dir):
        cam = np.array(cam_pos, dtype=float)
        d = np.array(cam_dir, dtype=float)
        n = np.linalg.norm(d)
        if n > 1e-6:
            d = d / n
        t = cam + d * 1.7
        t[1] = max(0.45, min(t[1], 2.7))
        self.hold_target = t

    def _spawn_point(self, cam_pos, cam_dir):
        """沿视线步进找落点: 射线被静态几何挡住即停(不隔墙传送),
        取最远的、以 0.45m 外扩仍不与障碍重叠的点; 找不到返回 None。"""
        cam = np.array(cam_pos, dtype=float)
        d = np.array(cam_dir, dtype=float)
        d /= (np.linalg.norm(d) + 1e-9)
        obstacles = list(STATIC_AABBS)
        if self.door_frac < 0.5:                    # 门未开足: 门洞区域视为实体
            obstacles.append((-1.4, 1.4, 4.85, 5.4))

        def blocked(px, pz, r):
            return any(px + r > a[0] and px - r < a[1] and
                       pz + r > a[2] and pz - r < a[3] for a in obstacles)

        best = None
        t = 0.3
        while t <= 1.6 + 1e-6:
            p = cam + d * t
            if blocked(p[0], p[2], 0.05):           # 视线被挡, 更远处不可达
                break
            if not (-14 < p[0] < 22 and -16 < p[2] < 15):
                break
            if t >= 0.6 and not blocked(p[0], p[2], 0.45):
                best = p.copy()
            t += 0.1
        if best is None:
            return None
        best[1] = min(max(best[1], 0.5), 3.5)
        return best, d

    def spawn(self, cam_pos, cam_dir) -> str | None:
        """从池中取一个货箱瞬移到视线前方空位。"""
        found = self._spawn_point(cam_pos, cam_dir)
        if found is None:
            return None
        pos, d = found
        for name in self.pool_ids:
            p = self._body_pos(name)
            if p[1] < -1.5:       # 仍在停放层
                qadr, dofadr = self._free_qadr(name)
                self.data.qpos[qadr:qadr + 3] = pos
                self.data.qpos[qadr + 3:qadr + 7] = [1, 0, 0, 0]
                self.data.qvel[dofadr:dofadr + 6] = 0
                self.data.qvel[dofadr:dofadr + 3] = d * 3.0
                mujoco.mj_forward(self.model, self.data)
                return name
        return None

    def reset(self):
        self.held = None
        self.door_target_open = False
        mujoco.mj_resetData(self.model, self.data)
        self.data.ctrl[self.door_act] = 0.0
        mujoco.mj_forward(self.model, self.data)

    # ------------------------------------------------------------------
    def step(self, dt: float):
        # 抓取: PD 悬浮力 + 重力补偿 + 角速度阻尼
        self.data.xfrc_applied[:] = 0
        if self.held is not None:
            bid = self.model.body(self.held).id
            mass = self.model.body_mass[bid]
            _, dofadr = self._free_qadr(self.held)
            pos = self.data.xpos[bid]
            vel = self.data.qvel[dofadr:dofadr + 3]
            f = mass * (55.0 * (self.hold_target - pos) - 11.0 * vel)
            f[1] += mass * 9.81
            fmax = mass * 60.0
            fn = np.linalg.norm(f)
            if fn > fmax:
                f *= fmax / fn
            self.data.xfrc_applied[bid, :3] = f
            self.data.xfrc_applied[bid, 3:] = -2.0 * mass * self.data.qvel[dofadr + 3:dofadr + 6]

        self._accum += dt
        n = int(self._accum / TIMESTEP)
        self._accum -= n * TIMESTEP
        for _ in range(min(n, 12)):
            mujoco.mj_step(self.model, self.data)

    # ------------------------------------------------------------------
    def state(self):
        out = []
        for bid in self._body_ids:
            p = self.data.xpos[bid]
            q = self.data.xquat[bid]     # w x y z
            out.append([round(float(p[0]), 4), round(float(p[1]), 4), round(float(p[2]), 4),
                        round(float(q[1]), 5), round(float(q[2]), 5),
                        round(float(q[3]), 5), round(float(q[0]), 5)])
        return {"b": out, "door": round(self.door_angle, 4),
                "held": self.held, "doorOpen": self.door_target_open}
