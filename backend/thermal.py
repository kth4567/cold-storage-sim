# -*- coding: utf-8 -*-
"""冷库热力学仿真 —— 基于第一性原理的物理模型。

包含:
  * 围护结构导热           Q = U·A·(T_out - T_in)
  * 开门空气渗透           Gosney-Olama 中性面模型(显热+潜热+水分迁移)
  * 蒸发器/压缩机制冷循环   卡诺效率折减的 COP 模型, 温控器滞环启停
  * 蒸发器结霜与电热化霜    除湿量 -> 结霜量 -> 制冷量衰减 -> 化霜循环
  * 货物热惰性             空气-货物耦合一阶热容
  * 湿空气性质             Magnus 饱和水汽压(水面/冰面)

积分采用半隐式欧拉, 内部子步长上限保证数值稳定。
"""

import math

# ---------------- 物性常数 ----------------
P_ATM = 101325.0          # Pa
CP_AIR = 1006.0           # J/(kg·K)
L_VAP = 2.501e6           # 水汽化潜热 J/kg
L_SUB = 2.834e6           # 冰升华潜热 J/kg
L_FUS = 3.34e5            # 冰融化潜热 J/kg
G = 9.81


def p_sat(t_c: float) -> float:
    """饱和水汽压 Pa, t<0 用冰面 Magnus 公式。"""
    if t_c >= 0.0:
        return 611.2 * math.exp(17.62 * t_c / (243.12 + t_c))
    return 611.2 * math.exp(22.46 * t_c / (272.62 + t_c))


def w_sat(t_c: float) -> float:
    """饱和含湿量 kg水/kg干空气。"""
    e = p_sat(t_c)
    return 0.622 * e / (P_ATM - e)


def humidity_ratio(t_c: float, rh: float) -> float:
    e = p_sat(t_c) * max(0.0, min(rh, 1.0))
    return 0.622 * e / (P_ATM - e)


def rel_humidity(t_c: float, w: float) -> float:
    e = w * P_ATM / (0.622 + w)
    return max(0.0, min(e / p_sat(t_c), 1.0))


def air_density(t_c: float) -> float:
    return P_ATM / (287.05 * (t_c + 273.15))


def enthalpy(t_c: float, w: float) -> float:
    """湿空气比焓 J/kg干空气。"""
    return 1006.0 * t_c + w * (L_VAP + 1860.0 * t_c)


class ColdRoomSim:
    """14m x 18m x 6m 低温冷库 (-18°C 设定)。"""

    # ---- 几何与围护结构 ----
    ROOM_W, ROOM_D, ROOM_H = 14.0, 18.0, 6.0
    VOLUME = ROOM_W * ROOM_D * ROOM_H                       # 1512 m3
    A_ENV = 2 * ROOM_W * ROOM_D + 2 * (ROOM_W + ROOM_D) * ROOM_H   # 888 m2
    U_ENV = 0.30                # 100mm 聚氨酯板 W/(m2·K)
    DOOR_W, DOOR_H = 2.6, 3.55  # 库门尺寸 m

    # ---- 门区配套 (真实冷库标配) ----
    ANTE_DT = 7.0               # 穿堂(缓冲间)比室外低 K: 有遮蔽、无日照、与库体换热
    AIR_CURTAIN_ETA = 0.65      # 风幕机对开门渗透的削减效率 (典型 0.6~0.8)
    Q_AIR_CURTAIN = 550.0       # 风幕机电功率 W (仅开门时运行)
    Q_DOOR_HEATER = 300.0       # 门框电加热丝 W (防冻结, 常开)

    # ---- 货物 ----
    M_PRODUCT = 40000.0         # kg 冻品 (8 组货架)
    CP_PRODUCT = 2000.0         # J/(kg·K) 冻结状态
    UA_PRODUCT = 3000.0         # 空气-货物换热 W/K

    # ---- 内部负荷 ----
    Q_FANS = 3600.0             # 2 台吊顶冷风机共 6 台风机电机 W (持续送风, 仅化霜停)
    Q_LIGHTS = 600.0            # 照明 W (6 组灯管)
    Q_COND_FANS = 1500.0        # 2 台冷凝器风机 W (库外, 只计电耗不入热平衡)

    # ---- 制冷机组 ----
    Q_RATED = 52000.0           # 额定制冷量 W (T_in=-18 工况)
    ETA_CARNOT = 0.45           # 卡诺效率比
    EVAP_APPROACH = 8.0         # 蒸发温度趋近 K
    COND_APPROACH = 12.0        # 冷凝温度趋近 K
    SETPOINT = -18.0
    HYSTERESIS = 1.2            # 温控滞环 ±K
    COIL_FLOW = 13.0            # 蒸发器风量 m3/s

    # ---- 化霜 ----
    FROST_DEFROST_TRIG = 8.0    # kg 触发化霜
    DEFROST_POWER = 18000.0     # 电热化霜 W
    DEFROST_LEAK = 0.30         # 化霜热量泄入库内比例

    def __init__(self):
        # 状态量
        self.t_in = -18.6            # 库内空气温度 °C
        self.t_product = -18.2       # 货物温度 °C
        self.w_in = w_sat(-18.6) * 0.85
        self.t_out_base = 28.7       # 室外基准温度
        self.rh_out = 0.56
        self.frost = 1.5             # 蒸发器结霜量 kg
        self.compressor_on = True
        self.defrosting = False
        self.door_frac = 0.0         # 库门开度 0~1 (由物理引擎注入)
        self.sim_time = 0.0          # 仿真累计秒
        self.energy_kwh = 0.0
        self.door_open_time = 0.0    # 连续开门秒数
        # 输出观测量
        self.q_cool = 0.0
        self.q_door = 0.0
        self.q_env = 0.0
        self.power = 0.0
        self.cop = 0.0
        self.t_evap = self.t_in - self.EVAP_APPROACH
        self.alarms: list[str] = []

    # ------------------------------------------------------------------
    @property
    def t_out(self) -> float:
        """室外温度: 缓慢日周期波动。"""
        return self.t_out_base + 2.5 * math.sin(self.sim_time * 2 * math.pi / 86400.0)

    @property
    def rh_in(self) -> float:
        return rel_humidity(self.t_in, self.w_in)

    # ------------------------------------------------------------------
    def _door_infiltration(self):
        """Gosney-Olama 开门空气交换: 返回(显热+潜热 W, 水分 kg/s)。

        库门开向穿堂而非露天: 交换空气取穿堂温度(室外-ANTE_DT);
        门楣风幕机开门即启, 按 AIR_CURTAIN_ETA 削减渗透。"""
        if self.door_frac <= 0.01:
            return 0.0, 0.0
        t_amb = self.t_out - self.ANTE_DT          # 穿堂空气温度
        a_open = self.DOOR_W * self.DOOR_H * self.door_frac
        h_eff = self.DOOR_H * max(self.door_frac, 0.35)
        rho_i = air_density(self.t_in)
        rho_o = air_density(t_amb)
        if rho_i <= rho_o:
            return 0.0, 0.0
        w_out = humidity_ratio(t_amb, self.rh_out)
        dh = enthalpy(t_amb, w_out) - enthalpy(self.t_in, self.w_in)   # J/kg
        # 密度差驱动的重力流, 流动因子 Fm≈0.68, 门道阻力 0.8, 风幕再削减
        fm = 0.68 * 0.8 * (1.0 - self.AIR_CURTAIN_ETA)
        q = 0.221 * a_open * rho_i * dh * math.sqrt(1.0 - rho_o / rho_i) \
            * math.sqrt(G * h_eff) * fm
        # 对应体积流量 -> 水分迁移
        v_dot = q / (rho_i * dh) if dh > 1.0 else 0.0
        m_water = v_dot * max(rho_o * w_out - rho_i * self.w_in, 0.0)
        return max(q, 0.0), m_water

    def _refrigeration(self):
        """制冷量 W(显热), 除湿 kg/s, 电功率 W, COP。"""
        self.t_evap = self.t_in - self.EVAP_APPROACH
        t_cond = self.t_out + self.COND_APPROACH
        te_k, tc_k = self.t_evap + 273.15, t_cond + 273.15
        cop_carnot = te_k / max(tc_k - te_k, 5.0)
        cop = self.ETA_CARNOT * cop_carnot

        # 结霜使传热恶化, 风阻增大 -> 容量衰减
        frost_mult = max(0.30, 1.0 - self.frost / 40.0)
        # 库温升高时蒸发压力升高, 容量略增(经验 3%/K)
        cap_mult = 1.0 + 0.03 * (self.t_in - self.SETPOINT)
        q_total = self.Q_RATED * frost_mult * max(cap_mult, 0.3)

        # 蒸发器除湿: 送风含湿量降到盘管饱和含湿量
        rho = air_density(self.t_in)
        w_coil = w_sat(self.t_evap)
        m_dehum = max(self.COIL_FLOW * rho * (self.w_in - w_coil), 0.0) * 0.75
        q_latent = m_dehum * (L_SUB if self.t_evap < 0 else L_VAP)
        q_latent = min(q_latent, 0.45 * q_total)     # 潜热占比上限
        if q_latent > 0:
            m_dehum = q_latent / (L_SUB if self.t_evap < 0 else L_VAP)
        q_sensible = q_total - q_latent
        power = q_total / max(cop, 0.4)
        return q_sensible, m_dehum, power, cop

    # ------------------------------------------------------------------
    def step(self, dt_sim: float):
        """推进 dt_sim 仿真秒(内部自动子步)。"""
        remaining = dt_sim
        while remaining > 1e-9:
            h = min(remaining, 0.5)
            self._substep(h)
            remaining -= h

    def _substep(self, h: float):
        self.sim_time += h
        rho_i = air_density(self.t_in)
        m_air = rho_i * self.VOLUME

        # ---- 开门 ----
        q_door, m_water_in = self._door_infiltration()
        self.q_door = q_door
        if self.door_frac > 0.3:
            self.door_open_time += h
        else:
            self.door_open_time = 0.0

        # ---- 围护结构 ----
        self.q_env = self.U_ENV * self.A_ENV * (self.t_out - self.t_in)

        # ---- 温控器 ----
        if self.defrosting:
            self.compressor_on = False
        elif self.t_in > self.SETPOINT + self.HYSTERESIS:
            self.compressor_on = True
        elif self.t_in < self.SETPOINT - self.HYSTERESIS:
            self.compressor_on = False

        # ---- 化霜逻辑 ----
        q_defrost_leak = 0.0
        if not self.defrosting and self.frost >= self.FROST_DEFROST_TRIG:
            self.defrosting = True
        if self.defrosting:
            melt = self.DEFROST_POWER / L_FUS * h        # kg 融霜
            self.frost = max(self.frost - melt, 0.0)
            q_defrost_leak = self.DEFROST_POWER * self.DEFROST_LEAK
            self.power = self.DEFROST_POWER
            self.q_cool, self.cop = 0.0, 0.0
            if self.frost <= 0.05:
                self.defrosting = False
        elif self.compressor_on:
            q_sens, m_dehum, power, cop = self._refrigeration()
            self.q_cool, self.cop = q_sens, cop
            self.power = power + self.Q_COND_FANS
            if self.t_evap < 0:
                self.frost += m_dehum * h                # 除湿结为霜
            self.w_in = max(self.w_in - m_dehum * h / m_air, 1e-5)
        else:
            self.q_cool, self.power, self.cop = 0.0, 0.0, 0.0
            # 停机时盘管缓慢回温至库温 (时间常数 ~3min)
            self.t_evap += (self.t_in - self.t_evap) * min(h / 180.0, 1.0)

        # ---- 门区配套电耗 (加热丝常开, 风幕机随门启停; 热量基本不入库内) ----
        self.power += self.Q_DOOR_HEATER
        if self.door_frac > 0.05:
            self.power += self.Q_AIR_CURTAIN

        # ---- 风机/照明 (蒸发器风机持续送风, 仅化霜停; 照明常开) ----
        q_fans = self.Q_FANS if not self.defrosting else 0.0
        fan_power = q_fans
        q_internal = q_fans + self.Q_LIGHTS

        # ---- 货物耦合 ----
        q_prod = self.UA_PRODUCT * (self.t_product - self.t_in)
        self.t_product += (-q_prod) / (self.M_PRODUCT * self.CP_PRODUCT) * h

        # ---- 空气能量平衡 ----
        q_net = (self.q_env + q_door + q_internal + q_prod
                 + q_defrost_leak - self.q_cool)
        self.t_in += q_net / (m_air * CP_AIR) * h

        # ---- 水分平衡 (含货物表面升华 ~3kg/天) ----
        self.w_in += (m_water_in + 3.5e-5) * h / m_air
        self.w_in = min(self.w_in, w_sat(self.t_in) * 1.02)   # 过饱和成雾析出

        # ---- 能耗累计 ----
        self.energy_kwh += (self.power + fan_power + self.Q_LIGHTS) / 3.6e6 * h

        # ---- 报警 ----
        alarms = []
        if self.t_in > -12.0:
            alarms.append("库温超限")
        if self.door_open_time > 90.0:
            alarms.append("开门超时")
        if self.frost > 6.0:
            alarms.append("蒸发器结霜严重")
        self.alarms = alarms

    # ------------------------------------------------------------------
    def manual_defrost(self):
        if self.frost > 0.2:
            self.defrosting = True

    def snapshot(self) -> dict:
        return {
            "tIn": round(self.t_in, 2),
            "rhIn": round(self.rh_in * 100, 1),
            "tOut": round(self.t_out, 2),
            "rhOut": round(self.rh_out * 100, 1),
            "tProduct": round(self.t_product, 2),
            "tEvap": round(self.t_evap, 1),
            "frost": round(self.frost, 2),
            "comp": "defrost" if self.defrosting else ("on" if self.compressor_on else "off"),
            "qCool": round(self.q_cool / 1000, 2),
            "qDoor": round(self.q_door / 1000, 2),
            "qEnv": round(self.q_env / 1000, 2),
            "power": round(self.power / 1000, 2),
            "cop": round(self.cop, 2),
            "energy": round(self.energy_kwh, 2),
            "doorOpenTime": round(self.door_open_time, 1),
            "alarms": self.alarms,
            "simTime": round(self.sim_time, 1),
        }
