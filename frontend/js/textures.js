// 程序化真实感纹理工厂 —— 全部用 Canvas 现场生成, 不依赖外部贴图文件。
// 每个函数返回 THREE.CanvasTexture (已设置 colorSpace / wrap / anisotropy)。

import * as THREE from "three";

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")];
}

function tex(c, { srgb = true, repeat = [1, 1] } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  return t;
}

function noise(g, w, h, alpha, n = 4000, lo = 0, hi = 255) {
  for (let i = 0; i < n; i++) {
    const v = lo + Math.random() * (hi - lo);
    g.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}

// ---------------------------------------------------------------- 混凝土地坪
export function concreteMaps(repeat = [6, 5]) {
  const [c, g] = canvas(1024, 1024);
  g.fillStyle = "#8d9298";
  g.fillRect(0, 0, 1024, 1024);
  // 大块色斑
  for (let i = 0; i < 60; i++) {
    const r = 40 + Math.random() * 160;
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, r);
    const shade = 120 + Math.random() * 50;
    grd.addColorStop(0, `rgba(${shade},${shade + 4},${shade + 8},0.16)`);
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g.save();
    g.translate(Math.random() * 1024, Math.random() * 1024);
    g.fillStyle = grd;
    g.fillRect(-r, -r, r * 2, r * 2);
    g.restore();
  }
  noise(g, 1024, 1024, 0.05, 9000);
  // 油渍/水渍
  for (let i = 0; i < 14; i++) {
    const r = 20 + Math.random() * 70;
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, r);
    grd.addColorStop(0, "rgba(45,50,58,0.13)");
    grd.addColorStop(0.7, "rgba(45,50,58,0.05)");
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g.save();
    g.translate(Math.random() * 1024, Math.random() * 1024);
    g.fillStyle = grd;
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  // 伸缩缝
  g.strokeStyle = "rgba(52,58,66,0.85)";
  g.lineWidth = 3;
  [256, 512, 768].forEach((p) => {
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 1024); g.stroke();
    g.beginPath(); g.moveTo(0, p); g.lineTo(1024, p); g.stroke();
  });
  // 细裂纹
  g.strokeStyle = "rgba(70,75,82,0.4)";
  g.lineWidth = 1;
  for (let i = 0; i < 22; i++) {
    let x = Math.random() * 1024, y = Math.random() * 1024;
    g.beginPath();
    g.moveTo(x, y);
    for (let s = 0; s < 8; s++) {
      x += (Math.random() - 0.5) * 60;
      y += (Math.random() - 0.5) * 60;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  const map = tex(c, { repeat });

  // 粗糙度图: 亮=粗糙, 暗=光滑(磨光/湿润处)
  const [cr, gr] = canvas(512, 512);
  gr.fillStyle = "#b4b4b4";
  gr.fillRect(0, 0, 512, 512);
  noise(gr, 512, 512, 0.15, 4000, 120, 220);
  for (let i = 0; i < 10; i++) {
    const r = 30 + Math.random() * 80;
    const grd = gr.createRadialGradient(0, 0, 0, 0, 0, r);
    grd.addColorStop(0, "rgba(70,70,70,0.5)");
    grd.addColorStop(1, "rgba(0,0,0,0)");
    gr.save();
    gr.translate(Math.random() * 512, Math.random() * 512);
    gr.fillStyle = grd;
    gr.beginPath(); gr.arc(0, 0, r, 0, Math.PI * 2); gr.fill();
    gr.restore();
  }
  const rough = tex(cr, { srgb: false, repeat });
  return { map, rough };
}

// ---------------------------------------------------------------- 冷库保温板墙
export function panelWallMaps(repeat = [3, 1]) {
  const [c, g] = canvas(1024, 512);
  const grd = g.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0, "#e8ecef");
  grd.addColorStop(1, "#dde2e7");
  g.fillStyle = grd;
  g.fillRect(0, 0, 1024, 512);
  noise(g, 1024, 512, 0.03, 3000, 190, 245);
  // 板缝 (竖向, 每 ~1m) + 锁扣点
  for (let x = 0; x <= 1024; x += 128) {
    g.fillStyle = "rgba(140,150,158,0.85)";
    g.fillRect(x - 1, 0, 3, 512);
    g.fillStyle = "rgba(255,255,255,0.5)";
    g.fillRect(x + 2, 0, 1, 512);
  }
  // 底部踢脚泛黑
  const dirt = g.createLinearGradient(0, 430, 0, 512);
  dirt.addColorStop(0, "rgba(0,0,0,0)");
  dirt.addColorStop(1, "rgba(60,64,70,0.28)");
  g.fillStyle = dirt;
  g.fillRect(0, 430, 1024, 82);
  const map = tex(c, { repeat });

  const [cb, gb] = canvas(512, 256);
  gb.fillStyle = "#808080";
  gb.fillRect(0, 0, 512, 256);
  for (let x = 0; x <= 512; x += 64) {
    gb.fillStyle = "#3a3a3a";
    gb.fillRect(x - 1, 0, 2, 256);
  }
  const bump = tex(cb, { srgb: false, repeat });
  return { map, bump };
}

// ---------------------------------------------------------------- 瓦楞纸箱
export function cardboardMap(hue = 0) {
  const [c, g] = canvas(512, 512);
  const base = ["#b98e55", "#af8450", "#c2965d"][Math.abs(hue) % 3];
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 512);
  noise(g, 512, 512, 0.05, 4000, 120, 200);
  // 瓦楞横纹
  g.strokeStyle = "rgba(0,0,0,0.045)";
  g.lineWidth = 1;
  for (let y = 0; y < 512; y += 4) {
    g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke();
  }
  // 边缘压痕加深
  g.strokeStyle = "rgba(80,55,25,0.5)";
  g.lineWidth = 10;
  g.strokeRect(4, 4, 504, 504);
  // 封箱胶带
  g.fillStyle = "rgba(200,190,170,0.75)";
  g.fillRect(226, 0, 60, 512);
  g.fillStyle = "rgba(255,255,255,0.12)";
  g.fillRect(232, 0, 8, 512);
  // 印刷: 品名 + 标志
  g.fillStyle = "rgba(45,55,90,0.82)";
  g.font = "bold 44px 'Microsoft YaHei', sans-serif";
  g.fillText("冷冻食品", 70, 120);
  g.font = "26px 'Microsoft YaHei', sans-serif";
  g.fillText("净重 10kg  保持冷冻 -18°C", 70, 165);
  g.strokeStyle = "rgba(45,55,90,0.82)";
  g.lineWidth = 3;
  g.strokeRect(60, 70, 392, 120);
  // 易碎/雨伞标志
  g.font = "54px sans-serif";
  g.fillText("☂", 84, 420);
  g.fillText("❄", 160, 420);
  g.strokeRect(64, 360, 180, 84);
  return tex(c);
}

// ---------------------------------------------------------------- 拉丝金属门
export function doorMaps() {
  const [c, g] = canvas(512, 1024);
  g.fillStyle = "#c8cdd3";
  g.fillRect(0, 0, 512, 1024);
  // 拉丝
  for (let y = 0; y < 1024; y += 2) {
    const v = 185 + Math.random() * 30;
    g.fillStyle = `rgba(${v},${v + 3},${v + 6},0.35)`;
    g.fillRect(0, y, 512, 1);
  }
  // 面板压边
  g.strokeStyle = "rgba(120,128,136,0.7)";
  g.lineWidth = 4;
  g.strokeRect(28, 28, 456, 968);
  // 底部防撞板 + 划痕
  g.fillStyle = "#8f979e";
  g.fillRect(0, 850, 512, 174);
  g.strokeStyle = "rgba(70,76,82,0.5)";
  for (let i = 0; i < 30; i++) {
    g.lineWidth = 1 + Math.random();
    g.beginPath();
    const y = 855 + Math.random() * 160;
    g.moveTo(Math.random() * 200, y);
    g.lineTo(200 + Math.random() * 300, y + (Math.random() - 0.5) * 20);
    g.stroke();
  }
  // 警示标
  g.fillStyle = "#c93a2e";
  g.fillRect(60, 430, 200, 66);
  g.fillStyle = "#fff";
  g.font = "bold 34px 'Microsoft YaHei', sans-serif";
  g.fillText("保持关闭", 76, 476);
  const map = tex(c);

  const [cr, gr] = canvas(256, 512);
  gr.fillStyle = "#6a6a6a";
  gr.fillRect(0, 0, 256, 512);
  noise(gr, 256, 512, 0.2, 1500, 60, 140);
  gr.fillStyle = "#909090";
  gr.fillRect(0, 425, 256, 87);
  const rough = tex(cr, { srgb: false });
  return { map, rough };
}

// ---------------------------------------------------------------- 天空 (黄昏 + 星点)
export function skyTexture() {
  const [c, g] = canvas(1024, 512);
  const grd = g.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0.0, "#080f1a");
  grd.addColorStop(0.42, "#122238");
  grd.addColorStop(0.68, "#2a4660");
  grd.addColorStop(0.85, "#635648");
  grd.addColorStop(1.0, "#84664a");
  g.fillStyle = grd;
  g.fillRect(0, 0, 1024, 512);
  // 星点 (上半天空, 大小/亮度随机)
  for (let i = 0; i < 220; i++) {
    const y = Math.pow(Math.random(), 1.8) * 260;
    const a = 0.25 + Math.random() * 0.65;
    const r = Math.random() < 0.12 ? 1.4 : 0.7;
    g.fillStyle = `rgba(235,242,255,${a})`;
    g.beginPath();
    g.arc(Math.random() * 1024, y, r, 0, Math.PI * 2);
    g.fill();
  }
  // 地平线附近薄云
  for (let i = 0; i < 8; i++) {
    const y = 330 + Math.random() * 90;
    const w = 120 + Math.random() * 260;
    const grd2 = g.createLinearGradient(0, y - 8, 0, y + 8);
    grd2.addColorStop(0, "rgba(0,0,0,0)");
    grd2.addColorStop(0.5, "rgba(150,130,110,0.14)");
    grd2.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd2;
    g.fillRect(Math.random() * 1024 - w / 2, y - 8, w, 16);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------- 墙面标识牌
export function signTexture(lines, { bg = "#1c4f9c", fg = "#ffffff", w = 512, h = 256, border = true } = {}) {
  const [c, g] = canvas(w, h);
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  if (border) {
    g.strokeStyle = fg;
    g.lineWidth = 6;
    g.strokeRect(12, 12, w - 24, h - 24);
  }
  g.fillStyle = fg;
  g.textAlign = "center";
  const size = Math.min(h / (lines.length + 0.8), w / (Math.max(...lines.map((l) => l.length)) * 1.1));
  g.font = `bold ${size}px 'Microsoft YaHei', sans-serif`;
  lines.forEach((line, i) => {
    g.fillText(line, w / 2, (h / (lines.length + 1)) * (i + 1) + size * 0.35);
  });
  return tex(c);
}

// ---------------------------------------------------------------- PVC 软门帘
export function stripCurtainTexture() {
  const [c, g] = canvas(512, 512);
  g.clearRect(0, 0, 512, 512);
  const strip = 512 / 8;
  for (let i = 0; i < 8; i++) {
    const x = i * strip;
    const grd = g.createLinearGradient(x, 0, x + strip, 0);
    grd.addColorStop(0, "rgba(190,220,240,0.55)");
    grd.addColorStop(0.15, "rgba(230,245,255,0.28)");
    grd.addColorStop(0.5, "rgba(205,230,248,0.38)");
    grd.addColorStop(0.85, "rgba(230,245,255,0.28)");
    grd.addColorStop(1, "rgba(150,185,210,0.6)");
    g.fillStyle = grd;
    g.fillRect(x + 2, 0, strip - 4, 512);
    // 高光竖线
    g.fillStyle = "rgba(255,255,255,0.35)";
    g.fillRect(x + strip * 0.22, 0, 3, 512);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------- 柔和圆形粒子
export function softParticleTexture() {
  const [c, g] = canvas(64, 64);
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grd.addColorStop(0, "rgba(255,255,255,0.9)");
  grd.addColorStop(0.5, "rgba(255,255,255,0.35)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// ---------------------------------------------------------------- 接触阴影(径向渐变)
export function blobShadowTexture() {
  const [c, g] = canvas(128, 128);
  const grd = g.createRadialGradient(64, 64, 8, 64, 64, 62);
  grd.addColorStop(0, "rgba(0,0,0,0.42)");
  grd.addColorStop(0.7, "rgba(0,0,0,0.18)");
  grd.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// ---------------------------------------------------------------- 冰面
export function iceMaps(repeat = [3, 4]) {
  const [c, g] = canvas(512, 512);
  g.fillStyle = "#cfe4f2";
  g.fillRect(0, 0, 512, 512);
  noise(g, 512, 512, 0.05, 3000, 200, 255);
  // 冰裂纹
  g.strokeStyle = "rgba(255,255,255,0.5)";
  for (let i = 0; i < 26; i++) {
    g.lineWidth = 0.6 + Math.random();
    let x = Math.random() * 512, y = Math.random() * 512;
    g.beginPath();
    g.moveTo(x, y);
    for (let s = 0; s < 6; s++) {
      x += (Math.random() - 0.5) * 90;
      y += (Math.random() - 0.5) * 90;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // 磨痕(走道)
  g.fillStyle = "rgba(180,200,215,0.25)";
  g.fillRect(190, 0, 130, 512);
  return { map: tex(c, { repeat }) };
}
