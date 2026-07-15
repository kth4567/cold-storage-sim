// 知识点页面公共层:课堂分节翻页骨架 + KaTeX 渲染 + 数学/绘图小工具。
// 页面结构约定:
//   <body data-kp="KP01"><div class="kp-wrap" id="wrap">
//     <section class="slide" data-title="定位与图景">…</section>
//     <section class="slide" data-title="核心公式">…</section>
//     …
//   </div></body>
// 公式写法: <div class="tex">q = \lambda \frac{\Delta T}{\delta}</div> (展示级)
//           <span class="ti">\mathrm{Bi}</span> (行内)

import { KP_META, KP_BY_ID } from "./kp-meta.js";

// ---------------------------------------------------------------- DOM
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const SVG_NS = "http://www.w3.org/2000/svg";

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
export const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "--");

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

// ---------------------------------------------------------------- 温度色标 (白底友好)
const RAMP = [
  { t: 0.0, c: [21, 101, 192] },   // 深冷蓝
  { t: 0.35, c: [100, 181, 246] }, // 冰青
  { t: 0.5, c: [222, 226, 230] },  // 中性浅灰
  { t: 0.68, c: [255, 167, 89] },  // 暖橙
  { t: 1.0, c: [217, 72, 15] },    // 热红
];

export function tempColor(t, tMin, tMax) {
  const u = clamp((t - tMin) / (tMax - tMin || 1e-9), 0, 1);
  for (let i = 1; i < RAMP.length; i++) {
    if (u <= RAMP[i].t) {
      const k = (u - RAMP[i - 1].t) / (RAMP[i].t - RAMP[i - 1].t);
      const c = RAMP[i - 1].c.map((v, j) => Math.round(lerp(v, RAMP[i].c[j], k)));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  return "rgb(217,72,15)";
}

// ---------------------------------------------------------------- 控件绑定
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

// ---------------------------------------------------------------- KaTeX
/** 渲染页面里所有 .tex(展示级) 与 .ti(行内) 元素 */
export function renderTeX(root = document) {
  if (typeof katex === "undefined") return;
  $$(".tex", root).forEach((el) => {
    if (el.dataset.done) return;
    const src = el.textContent;
    el.dataset.done = "1";
    katex.render(src, el, { displayMode: true, throwOnError: false });
  });
  $$(".ti", root).forEach((el) => {
    if (el.dataset.done) return;
    const src = el.textContent;
    el.dataset.done = "1";
    katex.render(src, el, { displayMode: false, throwOnError: false });
  });
}

// ---------------------------------------------------------------- 页面骨架
export function initPage() {
  const id = document.body.dataset.kp;
  const meta = KP_BY_ID[id];
  if (!meta) return null;
  document.title = `${meta.id} ${meta.title} · 数字冷库传热学`;

  const wrap = $("#wrap") || $(".kp-wrap");

  // 页眉
  const header = document.createElement("header");
  header.className = "kp-header";
  header.innerHTML = `
    <div class="kp-num">${meta.num}</div>
    <div class="kp-head-main">
      <h1 class="kp-title">${meta.title}</h1>
      <div class="kp-badges">
        <span class="badge">📍 冷库部位:${meta.part}</span>
        <span class="badge cat">${meta.cat}</span>
      </div>
    </div>
    <a class="kp-back" href="./index.html">↩ 知识点总览</a>`;
  wrap.prepend(header);

  // 分节翻页
  const slides = $$("section.slide", wrap);
  let cur = 0;
  const tabs = document.createElement("nav");
  tabs.className = "slide-tabs";
  slides.forEach((s, i) => {
    const b = document.createElement("button");
    b.innerHTML = `<span class="no">第 ${i + 1} 节</span>${s.dataset.title}`;
    b.addEventListener("click", () => show(i));
    tabs.appendChild(b);
  });
  header.after(tabs);

  const foot = document.createElement("div");
  foot.className = "slide-foot";
  foot.innerHTML = `
    <button id="slidePrev">← 上一节</button>
    <span class="pager" id="slidePager"></span>
    <button id="slideNext">下一节 →</button>
    <span class="keys-hint">键盘 ← → 也可翻页</span>`;
  wrap.appendChild(foot);

  function show(i) {
    cur = clamp(i, 0, slides.length - 1);
    slides.forEach((s, j) => s.classList.toggle("on", j === cur));
    $$("button", tabs).forEach((b, j) => b.classList.toggle("on", j === cur));
    $("#slidePager").textContent = `${cur + 1} / ${slides.length}`;
    $("#slidePrev").disabled = cur === 0;
    $("#slideNext").disabled = cur === slides.length - 1;
    scrollTo({ top: 0, behavior: "instant" });
  }
  $("#slidePrev").addEventListener("click", () => show(cur - 1));
  $("#slideNext").addEventListener("click", () => show(cur + 1));
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
    if (e.key === "ArrowLeft") show(cur - 1);
    if (e.key === "ArrowRight") show(cur + 1);
  });

  // 页脚 KP 间导航
  const idx = KP_META.findIndex((k) => k.id === id);
  const prev = KP_META[(idx + KP_META.length - 1) % KP_META.length];
  const next = KP_META[(idx + 1) % KP_META.length];
  const nav = document.createElement("nav");
  nav.className = "kp-nav";
  nav.innerHTML = `
    <a href="./${prev.file}"><div class="dir">← PREV</div><div class="name">${prev.id} ${prev.title}</div></a>
    <a href="./${next.file}" class="next"><div class="dir">NEXT →</div><div class="name">${next.id} ${next.title}</div></a>`;
  wrap.appendChild(nav);

  show(0);
  renderTeX();
  return meta;
}
