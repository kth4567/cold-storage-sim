// 知识点页面公共层:页面骨架注入 + 数学/绘图小工具。
// 各 KP 页面只写自己的交互主体,页眉、页脚导航、标题由 initPage() 统一生成。

import { KP_META, KP_BY_ID } from "./kp-meta.js";

// ---------------------------------------------------------------- DOM
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const SVG_NS = "http://www.w3.org/2000/svg";

/** 创建 SVG 元素: svgEl("rect", { x: 0, width: 10, fill: "#fff" }, parent) */
export function svgEl(tag, attrs = {}, parent = null) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "text") el.textContent = v;
    else el.setAttribute(k, v);
  }
  if (parent) parent.appendChild(el);
  return el;
}

// ---------------------------------------------------------------- 数值
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;

/** 数字格式化: 自动千分位不需要, 固定小数位, NaN 显示 -- */
export const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "--");

/** 线性比例尺: const x = scale([0, 10], [40, 400]); x(5) → 220 */
export function scale([d0, d1], [r0, r1]) {
  const k = (r1 - r0) / (d1 - d0 || 1e-12);
  return (v) => r0 + (v - d0) * k;
}

/** 误差函数 erf (Abramowitz & Stegun 7.1.26, |ε|<1.5e-7) */
export function erf(x) {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return sign * y;
}

export const erfc = (x) => 1 - erf(x);

/** 二分法求根: f 在 [a,b] 上变号 */
export function solveBisect(f, a, b, iters = 60) {
  let fa = f(a);
  for (let i = 0; i < iters; i++) {
    const m = (a + b) / 2;
    const fm = f(m);
    if (fa * fm <= 0) b = m;
    else { a = m; fa = fm; }
  }
  return (a + b) / 2;
}

// ---------------------------------------------------------------- 温度色标
// 全站统一: 热橙 ↔ 冰青, 中点为中性灰蓝。
const RAMP = [
  { t: 0.0, c: [37, 118, 220] },   // 深冷蓝
  { t: 0.35, c: [92, 190, 255] },  // 冰青
  { t: 0.5, c: [188, 202, 216] },  // 中性
  { t: 0.68, c: [255, 172, 96] },  // 暖橙
  { t: 1.0, c: [235, 78, 34] },    // 热红
];

/** 温度 → 颜色。tempColor(-18, -30, 40) → "rgb(...)" (冷=蓝, 热=红) */
export function tempColor(t, tMin, tMax) {
  const u = clamp((t - tMin) / (tMax - tMin || 1e-9), 0, 1);
  for (let i = 1; i < RAMP.length; i++) {
    if (u <= RAMP[i].t) {
      const k = (u - RAMP[i - 1].t) / (RAMP[i].t - RAMP[i - 1].t);
      const c = RAMP[i - 1].c.map((v, j) => Math.round(lerp(v, RAMP[i].c[j], k)));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  return "rgb(235,78,34)";
}

// ---------------------------------------------------------------- 控件绑定
/**
 * 绑定滑杆与输出显示。
 * bindSlider("#dIns", "#dInsOut", (v) => `${v} mm`, onChange)
 * onChange 收到 Number 值; 返回 input 元素。
 */
export function bindSlider(inputSel, outputSel, format, onChange) {
  const input = typeof inputSel === "string" ? $(inputSel) : inputSel;
  const out = typeof outputSel === "string" ? $(outputSel) : outputSel;
  const sync = () => {
    const v = Number(input.value);
    if (out) out.textContent = format ? format(v) : String(v);
    onChange?.(v);
  };
  input.addEventListener("input", sync);
  sync();
  return input;
}

// ---------------------------------------------------------------- 页面骨架
/**
 * 注入页眉 + 页脚导航。页面需:
 *   <body data-kp="KP01"><div class="kp-wrap" id="wrap"> …页面主体… </div></body>
 */
export function initPage() {
  const id = document.body.dataset.kp;
  const meta = KP_BY_ID[id];
  if (!meta) return null;
  document.title = `${meta.id} ${meta.title} · 数字冷库传热学`;

  const wrap = $("#wrap") || $(".kp-wrap");
  const header = document.createElement("header");
  header.className = "kp-header";
  header.innerHTML = `
    <div class="kp-num">${meta.num}</div>
    <div class="kp-head-main">
      <div class="kp-kicker">COLD STORAGE · HEAT TRANSFER / ${meta.id}</div>
      <h1 class="kp-title">${meta.title}</h1>
      <div class="kp-badges">
        <span class="badge">📍 ${meta.part}</span>
        <span class="badge cat">${meta.cat}</span>
        <span class="badge" style="font-family:var(--mono)">${meta.formula}</span>
      </div>
    </div>
    <a class="kp-back" href="./index.html">↩ 知识点总览</a>`;
  wrap.prepend(header);

  const idx = KP_META.findIndex((k) => k.id === id);
  const prev = KP_META[(idx + KP_META.length - 1) % KP_META.length];
  const next = KP_META[(idx + 1) % KP_META.length];
  const nav = document.createElement("nav");
  nav.className = "kp-nav";
  nav.innerHTML = `
    <a href="./${prev.file}"><div class="dir">← PREV</div><div class="name">${prev.id} ${prev.title}</div></a>
    <a href="./${next.file}" class="next"><div class="dir">NEXT →</div><div class="name">${next.id} ${next.title}</div></a>`;
  wrap.appendChild(nav);
  return meta;
}
