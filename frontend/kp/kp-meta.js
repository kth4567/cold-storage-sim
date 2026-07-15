// 传热学知识点元数据 —— 全站单一数据源。
// 主场景浮窗 (main.js) 与各 KP 页面 (kp-common.js) 共同引用,
// 内容依据 docs/kp/README_知识点索引.md。

export const KP_META = [
  {
    id: "KP01", num: "01", file: "kp01.html",
    title: "一维稳态导热", part: "外墙 · 保温墙体", cat: "导热",
    formula: "q = λ·ΔT/δ,多层串联热阻",
    brief: "冷库外墙的漏热由各层热阻串联决定,保温层“吃掉”绝大部分温差——拖动厚度,亲手把温度折线拖陡。",
  },
  {
    id: "KP02", num: "02", file: "kp02.html",
    title: "辐射换热", part: "屋面 · 顶板", cat: "辐射",
    formula: "E = εσT⁴,太阳辐射得热",
    brief: "太阳能把屋面晒到远高于气温,表面颜色 (α/ε) 决定它吸收多少、放出多少——拖动太阳走完一天。",
  },
  {
    id: "KP03", num: "03", file: "kp03.html",
    title: "半无限大物体导热", part: "地板 · 地坪", cat: "非稳态导热",
    formula: "erf 解,穿透深度 δp ∼ √(αt)",
    brief: "冷量向地下渗透像波前推进,穿透深度随 √t 生长——看深度-时间热力图一层层变蓝。",
  },
  {
    id: "KP04", num: "04", file: "kp04.html",
    title: "自然对流", part: "库门 · 门板", cat: "对流",
    formula: "Nu = f(Ra),浮升力驱动边界层",
    brief: "门板冷面让贴壁空气变重下沉,形成看不见的“空气瀑布”——那层薄膜就是自然对流的热阻所在。",
  },
  {
    id: "KP05", num: "05", file: "kp05.html",
    title: "换热器传热", part: "蒸发器 · 盘管", cat: "相变 + 对流",
    formula: "Q = UA·ΔTlm,ε-NTU 法",
    brief: "空气一路降温、制冷剂恒温蒸发,两条线之间的“温差带”就是换热的驱动力——LMTD 与 ε-NTU 一眼看懂。",
  },
  {
    id: "KP06", num: "06", file: "kp06.html",
    title: "强制对流", part: "蒸发器 · 风机", cat: "对流",
    formula: "Nu = f(Re, Pr),h ∼ v⁰·⁶",
    brief: "风速抬升换热系数 h,但风机功耗按 v³ 飙升——转动旋钮,在收益与代价之间找经济风速。",
  },
  {
    id: "KP07", num: "07", file: "kp07.html",
    title: "霜层热阻", part: "蒸发器 · 霜层", cat: "相变 + 导热",
    formula: "R_frost = δf/λf,换热衰减",
    brief: "霜是“长在盘管上的保温层”:越厚换热越差,性能锯齿式衰减——按下除霜,看换热量瞬间复原。",
  },
  {
    id: "KP08", num: "08", file: "kp08.html",
    title: "表面传热与 Bi 判据", part: "货物 · 外表面", cat: "对流 + 导热",
    formula: "Bi = h·Lc/λ,内外热阻之比",
    brief: "货物降温快慢由内外热阻谁大说了算:Bi 跷跷板向哪边倾,降温就走哪条路——这是通向 KP09/KP10 的岔路口。",
  },
  {
    id: "KP09", num: "09", file: "kp09.html",
    title: "非稳态导热", part: "货物 · 内部中心", cat: "非稳态导热",
    formula: "∂T/∂t = α∇²T,Fo 与 Heisler 图",
    brief: "表面先冷、中心滞后——一场看得见的降温赛跑。傅里叶数 Fo 是时间裁判,决定中心什么时候追上来。",
  },
  {
    id: "KP10", num: "10", file: "kp10.html",
    title: "集中参数法", part: "小件 · 薄层货物", cat: "非稳态导热",
    formula: "θ* = e^(−t/τ),τ = ρVc/(hA)",
    brief: "Bi < 0.1 时整块货物近乎均匀降温,一条单指数曲线走到底——时间常数 τ 是唯一主角。",
  },
  {
    id: "KP11", num: "11", file: "kp11.html",
    title: "圆筒壁导热与管内强制对流", part: "蒸发器 · 管道", cat: "导热 + 对流",
    formula: "Q = 2πλL·ΔT / ln(r₂/r₁),临界半径",
    brief: "圆筒壁里温度沿半径按对数分布,细管保温还有“越包越漏”的临界半径反直觉拐点。",
  },
];

export const KP_BY_ID = Object.fromEntries(KP_META.map((k) => [k.id, k]));
