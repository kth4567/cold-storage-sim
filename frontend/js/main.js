// 冷库数字孪生前端 —— 渲染与交互层。
// 所有刚体动力学与热力学计算均在 Python 后端完成,
// 本文件只负责: Three.js 渲染 / 状态插值 / 用户输入上报。

import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import * as TEX from "./textures.js";
import { KP_BY_ID } from "../kp/kp-meta.js";

// ---------------------------------------------------------------- 基础
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a1420);
scene.fog = new THREE.FogExp2(0x1a2836, 0.010);

const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 160);
camera.position.set(0, 1.7, 13);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.classList.add("webgl");
document.body.appendChild(renderer.domElement);

// PBR 环境反射 (金属/冰面/水洼的反射来源)
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

// 黄昏天空穹顶
const skyDome = new THREE.Mesh(
  new THREE.SphereGeometry(120, 24, 12),
  new THREE.MeshBasicMaterial({ map: TEX.skyTexture(), side: THREE.BackSide, fog: false }),
);
scene.add(skyDome);

// 后处理: 渲染 -> 辉光 -> 色调映射输出
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.22, 0.5, 1.0);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

const controls = new PointerLockControls(camera, document.body);
// 自动化测试用钩子 (getter 延迟取值, 避免暂时性死区)
window.__debug = {
  camera, controls, frames: 0,
  get keys() { return keys; },
  get velocity() { return velocity; },
  get colliders() { return colliders; },
};

// 请求原始鼠标输入(绕过 Windows 指针加速), 转向速度与手速线性对应;
// 不支持 unadjustedMovement 的浏览器回退普通锁定
controls.lock = () => {
  const el = document.body;
  let p;
  try {
    p = el.requestPointerLock({ unadjustedMovement: true });
  } catch {
    p = el.requestPointerLock();
  }
  if (p && p.catch) p.catch(() => el.requestPointerLock());
};

// 丢弃指针锁定切换瞬间的异常大位移事件, 防止视角突跳
// (capture 阶段先于 PointerLockControls 的 document 监听器执行)
document.addEventListener("mousemove", (e) => {
  if (controls.isLocked && (Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250)) {
    e.stopImmediatePropagation();
  }
}, true);
const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const CENTER = new THREE.Vector2(0, 0);
const keys = {};
const colliders = [];
const fans = [];

// 传热学知识点热点: 场景网格 → 知识点 ID 列表 (kp/ 交互教学页)
const kpTargets = [];
const CARGO_KP = ["KP08", "KP09", "KP10"];   // 货物: 表面传热 / 非稳态 / 集中参数
function tagKP(mesh, ids) {
  mesh.userData.kp = ids;
  kpTargets.push(mesh);
  return mesh;
}

// ---------------------------------------------------------------- 知识云
// 每个部位悬浮一朵可见的"知识云", 准星对准 → 出现"点击查看"按钮 → 左键确认弹窗。
const KP_CLOUDS = [
  { pos: [6.5, 2.4, -4.0],    ids: ["KP01"], label: "墙体导热" },
  { pos: [-3.5, 5.45, -7.0],  ids: ["KP02"], label: "屋面辐射" },
  { pos: [2.0, 0.8, -7.5],    ids: ["KP03"], label: "地坪渗透" },
  { pos: [1.0, 2.9, 4.45],    ids: ["KP04"], label: "库门对流" },
  { pos: [0, 4.72, -3.1],     ids: ["KP05", "KP07"], label: "蒸发器·结霜" },
  { pos: [0, 4.72, -11.35],   ids: ["KP06"], label: "风机对流" },
  { pos: [1.15, 5.3, -7.5],   ids: ["KP11"], label: "管道保温" },
  { pos: [-3.9, 3.75, -8.75], ids: CARGO_KP, label: "货物降温" },
  { pos: [3.9, 3.75, -5.5],   ids: CARGO_KP, label: "货物降温" },
];
const kpClouds = [];          // {sprite, ids, label, baseY, phase}
let hoveredCloud = null;

function cloudTexture(kpIds, label) {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 256;
  const g = c.getContext("2d");
  // 云朵本体 (白色圆簇 + 淡蓝描边)
  const puffs = [[150, 150, 62], [230, 118, 74], [320, 138, 66], [390, 160, 50], [255, 172, 68], [170, 178, 50]];
  g.fillStyle = "rgba(255,255,255,0.96)";
  g.strokeStyle = "rgba(110,170,230,0.9)";
  g.lineWidth = 6;
  puffs.forEach(([x, y, r]) => { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); });
  puffs.forEach(([x, y, r]) => { g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke(); });
  g.fillStyle = "rgba(255,255,255,0.96)";
  puffs.forEach(([x, y, r]) => { g.beginPath(); g.arc(x, y, r - 4, 0, 7); g.fill(); });
  // 雪花 + 文案
  g.fillStyle = "#1668b8";
  g.font = "700 52px 'Microsoft YaHei'";
  g.textAlign = "center";
  g.fillText("❄ " + kpIds[0] + (kpIds.length > 1 ? " +" + (kpIds.length - 1) : ""), 268, 138);
  g.font = "700 40px 'Microsoft YaHei'";
  g.fillStyle = "#17415c";
  g.fillText(label, 268, 186);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function addKnowledgeClouds() {
  KP_CLOUDS.forEach((def, i) => {
    const mat = new THREE.SpriteMaterial({
      map: cloudTexture(def.ids, def.label),
      transparent: true, opacity: 0.92, depthWrite: false,
    });
    const s = new THREE.Sprite(mat);
    s.position.set(def.pos[0], def.pos[1], def.pos[2]);
    s.scale.set(1.05, 0.53, 1);
    s.userData.kpCloud = { ids: def.ids, label: def.label };
    s.renderOrder = 5;
    scene.add(s);
    kpClouds.push({ sprite: s, ids: def.ids, label: def.label, baseY: def.pos[1], phase: i * 1.37 });
  });
}

const ui = {};
["start", "startBtn", "targetLabel", "doorState", "doorDot", "miniDoor", "miniPlayer",
 "tIn", "rhIn", "tOut", "rhOut", "tProd", "tEvap", "frost", "compDot", "compState",
 "qCool", "qDoor", "qEnv", "power", "cop", "energy", "simClock", "alarmBanner",
 "connDot", "connText", "chart", "defrostBtn", "resetBtn", "spawnBtn",
 "kpModal", "kpModalBody", "kpModalClose", "kpPrompt"]
  .forEach((id) => { ui[id] = document.getElementById(id); });

// ---------------------------------------------------------------- 材质 (程序化贴图)
const concreteT = TEX.concreteMaps([6, 5]);
const panelT = TEX.panelWallMaps([4, 1]);
const doorT = TEX.doorMaps();
const iceT = TEX.iceMaps([3, 4]);
const cardboardT = [TEX.cardboardMap(0), TEX.cardboardMap(1), TEX.cardboardMap(2)];
const blobT = TEX.blobShadowTexture();

const cartonMats = cardboardT.map((t) => new THREE.MeshStandardMaterial({ map: t, roughness: 0.88 }));

const mats = {
  wall: new THREE.MeshStandardMaterial({
    map: panelT.map, bumpMap: panelT.bump, bumpScale: 0.03,
    roughness: 0.55, metalness: 0.15,
  }),
  floor: new THREE.MeshStandardMaterial({
    map: concreteT.map, roughnessMap: concreteT.rough,
    roughness: 1.0, metalness: 0.03,
  }),
  wet: new THREE.MeshPhysicalMaterial({
    color: 0x2f3d49, roughness: 0.04, metalness: 0,
    transparent: true, opacity: 0.82, envMapIntensity: 1.6,
  }),
  steel: new THREE.MeshStandardMaterial({ color: 0x8b99a4, roughness: 0.3, metalness: 0.8 }),
  darkSteel: new THREE.MeshStandardMaterial({ color: 0x2a333c, roughness: 0.42, metalness: 0.65 }),
  yellowPipe: new THREE.MeshStandardMaterial({ color: 0xc69420, roughness: 0.36, metalness: 0.35 }),
  carton: new THREE.MeshStandardMaterial({ map: cardboardT[0], roughness: 0.88, metalness: 0.0 }),
  pallet: new THREE.MeshStandardMaterial({ color: 0x85613d, roughness: 0.85, metalness: 0.0 }),
  compressor: new THREE.MeshStandardMaterial({ color: 0x0f5b43, roughness: 0.38, metalness: 0.55 }),
  coldMist: new THREE.PointsMaterial({
    color: 0xccefff, size: 0.16, transparent: true, opacity: 0.42,
    depthWrite: false, map: TEX.softParticleTexture(),
  }),
  doorMist: new THREE.PointsMaterial({
    color: 0xd8f2ff, size: 0.24, transparent: true, opacity: 0.0,
    depthWrite: false, map: TEX.softParticleTexture(),
  }),
  airStream: new THREE.PointsMaterial({
    color: 0xeafaff, size: 0.1, transparent: true, opacity: 0.0,
    depthWrite: false, map: TEX.softParticleTexture(),
  }),
  glassIce: new THREE.MeshStandardMaterial({
    map: iceT.map, roughness: 0.13, metalness: 0.0, envMapIntensity: 1.15,
  }),
};

function box(w, h, d, material, position, cast = true, receive = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.copy(position);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  scene.add(mesh);
  return mesh;
}

function cyl(radius, height, material, position, rotation = new THREE.Euler(), segments = 32) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, segments), material);
  mesh.position.copy(position);
  mesh.rotation.copy(rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

function addCollider(minX, maxX, minZ, maxZ) {
  colliders.push({ minX, maxX, minZ, maxZ });
}

// ---------------------------------------------------------------- 静态场景
function addLighting() {
  // 黄昏环境光: 冷蓝天光 + 暖褐地面反光
  scene.add(new THREE.HemisphereLight(0x7d9dc4, 0x33302a, 0.55));
  const dusk = new THREE.DirectionalLight(0xb8cfe8, 0.75);
  dusk.position.set(-8, 16, 12);
  dusk.castShadow = true;
  dusk.shadow.mapSize.set(2048, 2048);
  dusk.shadow.camera.left = -24;
  dusk.shadow.camera.right = 24;
  dusk.shadow.camera.top = 24;
  dusk.shadow.camera.bottom = -24;
  dusk.shadow.camera.near = 1;
  dusk.shadow.camera.far = 60;
  dusk.shadow.bias = -0.0004;
  scene.add(dusk);

  // 库内冷白灯管 (提高发光强度供辉光拾取, 6 组两列三排)
  [[-3.5, 1.0], [3.5, 1.0], [-3.5, -4.5], [3.5, -4.5], [-3.5, -10.0], [3.5, -10.0]].forEach(([lx, lz]) => {
    const light = new THREE.PointLight(0xe8f4ff, 26, 9, 2);
    light.position.set(lx, 5.15, lz);
    scene.add(light);
    const tube = box(0.18, 0.08, 2.1, new THREE.MeshStandardMaterial({
      color: 0xeef8ff, emissive: 0xd6f0ff, emissiveIntensity: 1.7, roughness: 0.2,
    }), new THREE.Vector3(lx, 4.98, lz), false, false);
    tube.rotation.y = Math.PI / 2;
  });

  // 场地高杆暖光
  const yard = new THREE.PointLight(0xffcf94, 42, 22, 2);
  yard.position.set(9, 6.5, 8);
  scene.add(yard);
  box(0.09, 6.5, 0.09, mats.darkSteel, new THREE.Vector3(9.6, 3.25, 8.6));
  const lamp = box(0.55, 0.14, 0.3, new THREE.MeshStandardMaterial({
    color: 0x333333, emissive: 0xffd9a4, emissiveIntensity: 2.2, roughness: 0.4,
  }), new THREE.Vector3(9.3, 6.5, 8.25), false, false);
  lamp.rotation.z = 0.12;

  // 穿堂吊灯: 两盏暖光挂在穿堂顶板下
  [6.6, 8.8].forEach((lz) => {
    const lamp = new THREE.PointLight(0xffe0b0, 14, 8, 2);
    lamp.position.set(0, 3.9, lz);
    scene.add(lamp);
    box(0.5, 0.12, 0.22, new THREE.MeshStandardMaterial({
      color: 0x2c3138, emissive: 0xffe2b0, emissiveIntensity: 1.5, roughness: 0.4,
    }), new THREE.Vector3(0, 4.12, lz), false, false);
  });
}

function addGround() {
  box(38, 0.18, 34, mats.floor, new THREE.Vector3(4, -0.1, -1), false, true);
  // 水洼 (低粗糙度 + 环境反射 = 镜面湿地, 移到穿堂东侧场地)
  const wet = box(9, 0.025, 9, mats.wet, new THREE.Vector3(12.5, 0.01, 7.3), false, true);
  wet.rotation.y = -0.03;
}

function addColdRoom() {
  const width = 14, depth = 18, height = 6, zc = -4;
  tagKP(box(width, 0.18, depth, mats.wall, new THREE.Vector3(0, height, zc)), ["KP02"]);
  tagKP(box(0.18, height, depth, mats.wall, new THREE.Vector3(-width / 2, height / 2, zc)), ["KP01"]);
  tagKP(box(0.18, height, depth, mats.wall, new THREE.Vector3(width / 2, height / 2, zc)), ["KP01"]);
  tagKP(box(width, height, 0.18, mats.wall, new THREE.Vector3(0, height / 2, zc - depth / 2)), ["KP01"]);
  // 门洞两侧 + 门楣 (门洞宽 2.6, x -1.3..1.3)
  tagKP(box(5.7, height, 0.22, mats.wall, new THREE.Vector3(-4.15, height / 2, zc + depth / 2)), ["KP01"]);
  tagKP(box(5.7, height, 0.22, mats.wall, new THREE.Vector3(4.15, height / 2, zc + depth / 2)), ["KP01"]);
  tagKP(box(2.7, 2.5, 0.22, mats.wall, new THREE.Vector3(0, 4.75, zc + depth / 2)), ["KP01"]);

  tagKP(box(width - 0.25, 0.06, depth - 0.25, mats.glassIce, new THREE.Vector3(0, 0.04, zc), false, true), ["KP03"]);

  const ribMat = new THREE.LineBasicMaterial({ color: 0xddefff, transparent: true, opacity: 0.22 });
  for (let x = -6.3; x <= 6.3; x += 0.7) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, 0.15, zc - depth / 2 + 0.1),
      new THREE.Vector3(x, height - 0.1, zc - depth / 2 + 0.1),
    ]);
    scene.add(new THREE.Line(geo, ribMat));
  }

  addCollider(-7.10, -6.80, -13, 5.2);
  addCollider(6.80, 7.10, -13, 5.2);
  addCollider(-7.05, 7.05, -13.1, -12.75);
  addCollider(-7.05, -1.40, 4.85, 5.3);
  addCollider(1.40, 7.05, 4.85, 5.3);

  // 门框 (通高立柱直抵屋面线)
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x5c6873, roughness: 0.36, metalness: 0.6 });
  box(3.2, 0.22, 0.3, frameMat, new THREE.Vector3(0, 6.05, 5.05));
  box(0.22, 6.0, 0.3, frameMat, new THREE.Vector3(-1.47, 3.0, 5.05));
  box(0.22, 6.0, 0.3, frameMat, new THREE.Vector3(1.47, 3.0, 5.05));
}

// 收发货穿堂: 库门外缓冲间 (真实冷库进出货不直通室外), 外口 3m 宽挂软帘
function addAnteroom() {
  const h = 4.2;
  box(0.15, h, 4.8, mats.wall, new THREE.Vector3(-5, h / 2, 7.6));
  box(0.15, h, 4.8, mats.wall, new THREE.Vector3(5, h / 2, 7.6));
  box(3.5, h, 0.15, mats.wall, new THREE.Vector3(-3.25, h / 2, 10));
  box(3.5, h, 0.15, mats.wall, new THREE.Vector3(3.25, h / 2, 10));
  box(3.0, 1.0, 0.15, mats.wall, new THREE.Vector3(0, 3.7, 10));
  box(10.3, 0.16, 5.1, mats.wall, new THREE.Vector3(0, 4.28, 7.55));
  addCollider(-5.1, -4.9, 5.2, 10.1);
  addCollider(4.9, 5.1, 5.2, 10.1);
  addCollider(-5.1, -1.5, 9.9, 10.1);
  addCollider(1.5, 5.1, 9.9, 10.1);
}

function addRack(x, z) {
  const rack = new THREE.Group();
  rack.position.set(x, 0, z);
  scene.add(rack);
  const upright = new THREE.MeshStandardMaterial({ color: 0x0d5b9a, roughness: 0.42, metalness: 0.45 });
  const beam = new THREE.MeshStandardMaterial({ color: 0xb04a26, roughness: 0.5, metalness: 0.3 });
  const shelf = new THREE.MeshStandardMaterial({ color: 0x7f8d99, roughness: 0.52, metalness: 0.5 });

  [-1.45, 1.45].forEach((sx) => {
    [-0.48, 0.48].forEach((sz) => {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3.2, 0.1), upright);
      post.position.set(sx, 1.6, sz);
      post.castShadow = true;
      rack.add(post);
    });
  });

  [0.55, 1.65, 2.75].forEach((y) => {
    const deck = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.08, 1.1), shelf);
    deck.position.set(0, y, 0);
    deck.castShadow = true;
    deck.receiveShadow = true;
    rack.add(deck);
    [-0.6, 0.6].forEach((sz) => {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.1, 0.08), beam);
      rail.position.set(0, y + 0.08, sz);
      rail.castShadow = true;
      rack.add(rail);
    });
  });

  for (let level = 0; level < 3; level++) {
    for (let i = 0; i < 5; i++) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.42 + Math.random() * 0.14, 0.42),
        cartonMats[(level * 5 + i) % 3]);
      c.position.set(-1.12 + i * 0.56, 0.86 + level * 1.1, -0.18 + (i % 2) * 0.38);
      c.rotation.y = (Math.random() - 0.5) * 0.08;
      c.castShadow = true;
      tagKP(c, CARGO_KP);
      rack.add(c);
    }
  }

  const pallet = new THREE.Mesh(new THREE.BoxGeometry(3.05, 0.16, 1), mats.pallet);
  pallet.position.set(0, 0.18, 0);
  rack.add(pallet);
  addCollider(x - 1.65, x + 1.65, z - 0.75, z + 0.75);
}

const coldParticles = [];

// 制冷管路: 从东侧机房穿墙进库, 保温回气管(粗) + 铜供液管(细) 吊顶下
// 敷设, 沿库房纵向送至两台冷风机的立管接口; 每台冷风机的化霜排水管
// 坡向就近墙面落地。现代氟机冷风机库顶面无排管, 只走管路与吊架。
function addRefrigerantPiping() {
  const suctionMat = new THREE.MeshStandardMaterial({ color: 0xd9dee3, roughness: 0.82, metalness: 0.05 });
  const liquidMat = new THREE.MeshStandardMaterial({ color: 0xa96f33, roughness: 0.35, metalness: 0.8 });
  const drainMat = new THREE.MeshStandardMaterial({ color: 0xe6e9ec, roughness: 0.7, metalness: 0.05 });

  const seg = (mat, r, a, b) => {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 14), mat);
    m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    if (Math.abs(d.x) > 0.01) m.rotation.z = Math.PI / 2;
    else if (Math.abs(d.z) > 0.01) m.rotation.x = Math.PI / 2;
    m.castShadow = true;
    scene.add(m);
    return m;
  };
  const joint = (mat, r, p) => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(r * 1.35, 12, 10), mat);
    s.position.set(p[0], p[1], p[2]);
    scene.add(s);
  };

  // 回气管 (保温, DN100): 东墙 -> 西行 -> 折向库尾, 途经两台冷风机上方
  const SR = 0.055;
  tagKP(seg(suctionMat, SR, [6.91, 5.62, 3.9], [1.2, 5.62, 3.9]), ["KP11"]);
  tagKP(seg(suctionMat, SR, [1.2, 5.62, 3.9], [1.2, 5.62, -12.3]), ["KP11"]);
  [[1.2, 5.62, 3.9], [1.2, 5.62, -3.9], [1.2, 5.62, -12.15]].forEach((p) => joint(suctionMat, SR, p));

  // 供液管 (铜, DN25): 与回气管并行
  const LR = 0.026;
  tagKP(seg(liquidMat, LR, [6.91, 5.56, 3.72], [1.0, 5.56, 3.72]), ["KP11"]);
  tagKP(seg(liquidMat, LR, [1.0, 5.56, 3.72], [1.0, 5.56, -12.3]), ["KP11"]);
  [[1.0, 5.56, 3.72], [1.0, 5.56, -3.9], [1.0, 5.56, -12.15]].forEach((p) => joint(liquidMat, LR, p));

  // 管道吊架: 吊杆 + 横担, 沿走向每 ~2.5m 一处
  const trapeze = (x, z, alongX) => {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.23, 8), mats.darkSteel);
    rod.position.set(x, 5.795, z);
    scene.add(rod);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(alongX ? 0.06 : 0.46, 0.035, alongX ? 0.42 : 0.06), mats.darkSteel);
    bar.position.set(x, 5.665, z);
    scene.add(bar);
  };
  for (let z = 2.2; z > -12; z -= 2.5) trapeze(1.1, z, false);
  [3.2, 5.2].forEach((hx) => trapeze(hx, 3.81, true));

  // 穿墙洞封板 (东墙, 机房侧)
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.55, 0.55),
    new THREE.MeshStandardMaterial({ color: 0x5c6873, roughness: 0.4, metalness: 0.6 }));
  plate.position.set(6.93, 5.6, 3.81);
  scene.add(plate);

  // 库外段: 沿外墙落至压缩机组接管高度
  seg(suctionMat, SR, [7.0, 5.62, 3.9], [7.3, 5.62, 3.9]);
  seg(suctionMat, SR, [7.3, 5.62, 3.9], [7.3, 1.3, 3.9]);
  seg(suctionMat, SR, [7.3, 1.3, 3.9], [9.5, 1.3, 3.9]);
  joint(suctionMat, SR, [7.3, 5.62, 3.9]);
  joint(suctionMat, SR, [7.3, 1.3, 3.9]);
  seg(liquidMat, LR, [7.0, 5.56, 3.72], [7.3, 5.56, 3.72]);
  seg(liquidMat, LR, [7.3, 5.56, 3.72], [7.3, 1.15, 3.72]);
  seg(liquidMat, LR, [7.3, 1.15, 3.72], [9.5, 1.15, 3.72]);
  joint(liquidMat, LR, [7.3, 5.56, 3.72]);
  joint(liquidMat, LR, [7.3, 1.15, 3.72]);

  // 化霜排水管 (PVC): 后墙机组坡向后墙落地; 中段机组坡向东墙落地
  const DR = 0.032;
  seg(drainMat, DR, [1.55, 4.3, -12.15], [1.55, 4.3, -12.75]);
  seg(drainMat, DR, [1.55, 4.3, -12.75], [1.55, 0.08, -12.75]);
  joint(drainMat, DR, [1.55, 4.3, -12.75]);
  seg(drainMat, DR, [1.55, 4.3, -3.9], [6.75, 4.3, -3.9]);
  seg(drainMat, DR, [6.75, 4.3, -3.9], [6.75, 0.08, -3.9]);
  joint(drainMat, DR, [6.75, 4.3, -3.9]);

  // 每台冷风机液管支路阀组: 手动截止阀 (红手轮) + 电磁阀, 装在支路三通上游
  const valveMat = new THREE.MeshStandardMaterial({ color: 0x3a424b, roughness: 0.4, metalness: 0.7 });
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0xb03028, roughness: 0.5, metalness: 0.4 });
  [-3.9, -12.15].forEach((uz) => {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.13, 0.09), valveMat);
    body.position.set(1.0, 5.56, uz + 0.42);
    scene.add(body);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 8), valveMat);
    stem.position.set(1.0, 5.63, uz + 0.42);
    scene.add(stem);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.011, 8, 20), wheelMat);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(1.0, 5.69, uz + 0.42);
    scene.add(wheel);
    const solenoid = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.06), valveMat);
    solenoid.position.set(1.0, 5.62, uz + 0.72);
    scene.add(solenoid);
  });
}

// 吊顶综合管线: 电缆桥架 (机组动力/照明配电) + 消防喷淋干支管与下垂喷头
// —— 真实冷库顶面除制冷工艺管外的常规机电设施
function addCeilingServices() {
  const trayMat = new THREE.MeshStandardMaterial({ color: 0x4b555f, roughness: 0.5, metalness: 0.65 });
  const conduitMat = new THREE.MeshStandardMaterial({ color: 0xb9c2c9, roughness: 0.45, metalness: 0.5 });
  const fireMat = new THREE.MeshStandardMaterial({ color: 0xa63226, roughness: 0.55, metalness: 0.35 });
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xb08d3e, roughness: 0.35, metalness: 0.8 });

  const bar = (mat, w, h, d, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    scene.add(m);
    return m;
  };
  const tube = (mat, r, a, b) => {
    const dv = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, dv.length(), 10), mat);
    m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    if (Math.abs(dv.x) > 0.01) m.rotation.z = Math.PI / 2;
    else if (Math.abs(dv.z) > 0.01) m.rotation.x = Math.PI / 2;
    scene.add(m);
    return m;
  };

  // ---- 电缆桥架: 东墙引入 -> 沿库房纵向, 每 2.5m 吊架 ----
  const TY = 5.72;                     // 桥架底面高
  bar(trayMat, 4.31, 0.02, 0.32, 4.755, TY, 4.45);           // 引入段 (沿 x)
  [4.45 - 0.15, 4.45 + 0.15].forEach((bz) => bar(trayMat, 4.31, 0.09, 0.02, 4.755, TY + 0.045, bz));
  bar(trayMat, 0.32, 0.02, 17.1, 2.6, TY, -4.0);             // 纵向主段 (沿 z)
  [2.6 - 0.15, 2.6 + 0.15].forEach((bx) => bar(trayMat, 0.02, 0.09, 17.1, bx, TY + 0.045, -4.0));
  for (let z = 4.0; z > -12.5; z -= 2.5) {
    tube(mats.darkSteel, 0.013, [2.6, 5.91, z], [2.6, TY + 0.09, z]);
  }

  // ---- 照明线管: 桥架 -> 各灯具 (横穿吊顶, 末端下垂) ----
  [[-3.5, 1.0], [3.5, 1.0], [-3.5, -4.5], [3.5, -4.5], [-3.5, -10.0], [3.5, -10.0]].forEach(([lx, lz]) => {
    tube(conduitMat, 0.014, [2.6, 5.88, lz], [lx, 5.88, lz]);
    tube(conduitMat, 0.014, [lx, 5.88, lz], [lx, 5.06, lz]);
  });

  // ---- 机组动力: 桥架 -> 接线盒 (箱体顶) ----
  [-3.9, -12.15].forEach((uz) => {
    bar(trayMat, 0.14, 0.12, 0.12, 1.6, 5.62, uz);
    tube(conduitMat, 0.014, [1.6, 5.68, uz], [1.6, 5.88, uz]);
    tube(conduitMat, 0.014, [1.6, 5.88, uz], [2.6, 5.88, uz]);
  });

  // ---- 消防喷淋: 东墙引入干管 -> 纵向配水管 -> 5 路支管, 每路 4 只下垂喷头 ----
  const FY = 5.84;
  tube(fireMat, 0.048, [6.91, FY, -1.6], [-1.4, FY, -1.6]);            // 引入干管
  tube(fireMat, 0.048, [-1.4, FY, 3.1], [-1.4, FY, -11.2]);            // 纵向配水管
  const fj = (p) => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.062, 10, 8), fireMat);
    s.position.set(p[0], p[1], p[2]);
    scene.add(s);
  };
  fj([-1.4, FY, -1.6]);
  [3.1, -0.5, -4.1, -7.7, -11.2].forEach((bz) => {
    tube(fireMat, 0.028, [-6.4, FY, bz], [6.4, FY, bz]);               // 支管
    fj([-1.4, FY, bz]);
    [-5.25, -1.75, 1.75, 5.25].forEach((hx) => {                       // 下垂喷头
      tube(brassMat, 0.011, [hx, FY, bz], [hx, FY - 0.1, bz]);
      const deflector = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.006, 12), brassMat);
      deflector.position.set(hx, FY - 0.105, bz);
      scene.add(deflector);
    });
  });

  // 消防管穿墙封板
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.4, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x5c6873, roughness: 0.4, metalness: 0.6 }));
  plate.position.set(6.93, FY, -1.6);
  scene.add(plate);
}

// 吊顶式冷风机 (DD 系列): 白色箱体吊装在顶板下, 正面一排 3 台大轴流风扇
// 水平吹风; 两台前后接力布置 (后墙一台朝门吹 + 库房中段一台续程),
// 底部回风口 + 接水盘, 顶部供液/回气立管接入吊顶主管路; 化霜时风扇停转
const MIST_SOURCES = [];            // 冷雾发生点, 由冷风机出风口填充
function addUnitCoolers() {
  const casingMat = new THREE.MeshStandardMaterial({ color: 0xf0f3f5, roughness: 0.5, metalness: 0.15 });
  const recessMat = new THREE.MeshStandardMaterial({ color: 0x14181d, roughness: 0.8, metalness: 0.2 });
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x1b2026, roughness: 0.45, metalness: 0.5, side: THREE.DoubleSide });
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x22282f, roughness: 0.4, metalness: 0.55, side: THREE.DoubleSide });
  const W = 3.9, H = 1.0, D = 0.75;   // 箱体尺寸
  const CY = 5.05;                    // 箱体中心高 (顶 5.55, 底 4.55, 货架顶上方 >1m 回风空间)
  const FAN_XS = [-1.25, 0, 1.25];    // 每台 3 风扇
  const R = 0.56;                     // 风筒半径 (叶轮直径 ~1m)
  const bladeGeo = new THREE.BoxGeometry(0.36, 0.3, 0.02);

  [-12.15, -3.9].forEach((uz) => {
    const g = new THREE.Group();
    g.position.set(0, CY, uz);
    scene.add(g);
    const front = D / 2;              // 出风面朝 +z (库门方向)

    const casing = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), casingMat);
    casing.castShadow = true;
    casing.receiveShadow = true;
    tagKP(casing, ["KP05", "KP07"]);   // 箱体 → 换热器 + 霜层
    g.add(casing);

    FAN_XS.forEach((fx) => {
      // 风扇暗色凹腔背景
      const recess = new THREE.Mesh(new THREE.CircleGeometry(R - 0.01, 28), recessMat);
      recess.position.set(fx, 0, front + 0.005);
      tagKP(recess, ["KP06"]);         // 风扇区 → 强制对流
      g.add(recess);
      // 短风筒 + 前沿包边
      const duct = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.22, 30, 1, true), ringMat);
      duct.rotation.x = Math.PI / 2;
      duct.position.set(fx, 0, front + 0.11);
      tagKP(duct, ["KP06"]);
      g.add(duct);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.028, 10, 36), ringMat);
      rim.position.set(fx, 0, front + 0.22);
      g.add(rim);
      // 叶轮: 轮毂 + 7 片宽桨叶, 绕 z 轴旋转 (水平送风)
      const rotor = new THREE.Group();
      rotor.position.set(fx, 0, front + 0.13);
      g.add(rotor);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.12, 18), bladeMat);
      hub.rotation.x = Math.PI / 2;
      rotor.add(hub);
      for (let i = 0; i < 7; i++) {
        const th = (i / 7) * Math.PI * 2;
        const blade = new THREE.Mesh(bladeGeo, bladeMat);
        blade.position.set(Math.cos(th) * 0.32, Math.sin(th) * 0.32, 0);
        blade.rotation.z = th;
        blade.rotateX(0.55);
        rotor.add(blade);
      }
      rotor.userData = { evap: true, speed: 16 };
      fans.push(rotor);
      MIST_SOURCES.push({ x: fx, y: CY, z: uz + front + 0.3 });
    });

    // 底部深色回风口 + 接水盘 (双水盘) + 排水短管
    const inlet = new THREE.Mesh(new THREE.BoxGeometry(W - 0.24, 0.03, D - 0.22), recessMat);
    inlet.position.y = -H / 2 - 0.005;
    g.add(inlet);
    const pan = new THREE.Mesh(new THREE.BoxGeometry(W + 0.12, 0.07, D + 0.28), mats.steel);
    pan.position.y = -H / 2 - 0.075;
    pan.castShadow = true;
    g.add(pan);
    const drain = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 10), mats.steel);
    drain.position.set(W / 2 - 0.4, -H / 2 - 0.18, 0);
    g.add(drain);

    // 吊杆 4 根接顶板 + 供液/回气立管上接吊顶主管路
    [[-W / 2 + 0.35, -D / 2 + 0.12], [W / 2 - 0.35, -D / 2 + 0.12],
     [-W / 2 + 0.35, D / 2 - 0.12], [W / 2 - 0.35, D / 2 - 0.12]].forEach(([rx, rz]) => {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.38, 8), mats.darkSteel);
      rod.position.set(rx, H / 2 + 0.18, rz);
      g.add(rod);
    });
    [[W / 2 - 0.75, 0.05, 0xd9dee3, 0.82, 0.05], [W / 2 - 0.95, 0.026, 0xa96f33, 0.35, 0.8]].forEach(([px, pr, pc, prough, pmetal]) => {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(pr, pr, 0.32, 12),
        new THREE.MeshStandardMaterial({ color: pc, roughness: prough, metalness: pmetal }));
      pipe.position.set(px, H / 2 + 0.16, 0);
      g.add(pipe);
    });
  });
}

function addColdMist() {
  const count = 480;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const velocities = [];
  const srcs = [];
  for (let i = 0; i < count; i++) {
    const s = MIST_SOURCES[i % MIST_SOURCES.length];
    srcs.push(s);
    positions[i * 3] = s.x + (Math.random() - 0.5) * 0.7;
    positions[i * 3 + 1] = s.y + (Math.random() - 0.5) * 0.5;
    positions[i * 3 + 2] = s.z + Math.random() * 0.3;
    velocities.push(new THREE.Vector3((Math.random() - 0.5) * 0.18, (Math.random() - 0.5) * 0.04, 0.9 + Math.random() * 0.8));
  }
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(geo, mats.coldMist);
  scene.add(points);
  coldParticles.push({ points, positions, velocities, srcs, count });
}

// 开门冷气外泄粒子 (强度由后端 door_frac 驱动)
let doorMistSys = null;
function addDoorMist() {
  const count = 300;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const vel = [];
  for (let i = 0; i < count; i++) {
    positions[i * 3] = -1.2 + Math.random() * 2.4;
    positions[i * 3 + 1] = 0.15 + Math.random() * 3.2;
    positions[i * 3 + 2] = 5.15 + Math.random() * 0.3;
    vel.push(new THREE.Vector3((Math.random() - 0.5) * 0.25, -0.25 - Math.random() * 0.3, 0.6 + Math.random() * 0.9));
  }
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(geo, mats.doorMist);
  scene.add(points);
  doorMistSys = { points, positions, vel, count };
}

// 风幕机气流粒子 (开门时自门楣垂直向下吹, 挡住热空气)
let airCurtainSys = null;
function addAirCurtain() {
  const count = 90;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const vel = [];
  for (let i = 0; i < count; i++) {
    positions[i * 3] = -1.3 + Math.random() * 2.6;
    positions[i * 3 + 1] = 3.5 - Math.random() * 3.3;
    positions[i * 3 + 2] = 4.74 + Math.random() * 0.12;
    vel.push(2.2 + Math.random() * 1.4);
  }
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(geo, mats.airStream);
  scene.add(points);
  airCurtainSys = { points, positions, vel, count };
}

function addEquipment() {
  box(7, 0.35, 2.6, mats.darkSteel, new THREE.Vector3(11.8, 0.28, 4.4));
  box(1.35, 1.8, 1.1, new THREE.MeshStandardMaterial({ color: 0xd6d0bc, roughness: 0.58, metalness: 0.25 }), new THREE.Vector3(13.5, 1.34, 4.0));
  for (let i = 0; i < 3; i++) {
    cyl(0.45, 1.65, mats.compressor, new THREE.Vector3(9.5 + i * 1.45, 1.22, 4.35));
    cyl(0.18, 1.35, mats.darkSteel, new THREE.Vector3(9.5 + i * 1.45, 1.2, 3.35), new THREE.Euler(Math.PI / 2, 0, 0));
  }
  box(4.7, 1.9, 2.3, mats.steel, new THREE.Vector3(12.6, 3.2, -2.3));
  // 冷凝器支腿 (箱体底面 y=2.25)
  [[10.5, -3.2], [10.5, -1.4], [14.7, -3.2], [14.7, -1.4]].forEach(([x, z]) => {
    box(0.14, 2.3, 0.14, mats.darkSteel, new THREE.Vector3(x, 1.15, z));
  });
  const finMat = new THREE.MeshStandardMaterial({ color: 0x1a242e, roughness: 0.56, metalness: 0.4 });
  for (let i = 0; i < 7; i++) {
    box(0.06, 1.7, 2.35, finMat, new THREE.Vector3(10.45 + i * 0.7, 3.2, -2.3), false, true);
  }
  [[11.55, -2.95], [13.65, -1.65]].forEach(([x, z]) => {
    const topFan = new THREE.Group();
    topFan.position.set(x, 4.25, z);
    scene.add(topFan);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.04, 12, 48), mats.darkSteel);
    ring.rotation.x = Math.PI / 2;
    topFan.add(ring);
    fans.push(topFan);
  });

  addCollider(8.3, 15.2, 3.0, 5.8);
  addCollider(10.25, 14.95, -3.45, -1.15);
}

// ---------------------------------------------------------------- 现实感细节
let curtainGroup = null;
let outerCurtainGroup = null;
let sparkleSys = null;
let alarmBtnMesh = null;
function addRealismDetails() {
  // 建筑外墙底部踢脚板
  const skirtMat = new THREE.MeshStandardMaterial({ color: 0x262c33, roughness: 0.7, metalness: 0.2 });
  box(5.53, 0.4, 0.06, skirtMat, new THREE.Vector3(-4.235, 0.2, 5.13), false, false);
  box(5.53, 0.4, 0.06, skirtMat, new THREE.Vector3(4.235, 0.2, 5.13), false, false);
  box(0.06, 0.4, 18, skirtMat, new THREE.Vector3(-7.11, 0.2, -4), false, false);
  box(0.06, 0.4, 18, skirtMat, new THREE.Vector3(7.11, 0.2, -4), false, false);
  box(14, 0.4, 0.06, skirtMat, new THREE.Vector3(0, 0.2, -13.11), false, false);

  // 墙面标识牌
  const mkSign = (t, w, h, pos, rotY = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, metalness: 0.1 }));
    m.position.copy(pos);
    m.rotation.y = rotY;
    scene.add(m);
  };
  mkSign(TEX.signTexture(["1号低温冷库  -18℃"], { w: 1024, h: 192, bg: "#123f7d" }),
    2.4, 0.46, new THREE.Vector3(0, 3.78, 5.125));
  mkSign(TEX.signTexture(["低温环境", "注意防寒"]),
    0.72, 0.52, new THREE.Vector3(-3.0, 2.35, 5.125));
  mkSign(TEX.signTexture(["当心滑倒"], { bg: "#d8a012", fg: "#1c1c1c", h: 128 }),
    0.72, 0.38, new THREE.Vector3(-2.1, 2.35, 5.125));
  mkSign(TEX.signTexture(["收发货穿堂 · 闲人免进"], { w: 1024, h: 160, bg: "#155086" }),
    2.2, 0.34, new THREE.Vector3(0, 3.72, 10.09));

  // 库内紧急报警按钮 (门旁, 准星对准按 E 触发)
  alarmBtnMesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.26, 0.09),
    new THREE.MeshStandardMaterial({ color: 0xb32020, emissive: 0xff3020, emissiveIntensity: 0.6, roughness: 0.4 }));
  alarmBtnMesh.position.set(-2.0, 1.5, 4.85);
  alarmBtnMesh.userData.interactive = "alarm";
  scene.add(alarmBtnMesh);
  mkSign(TEX.signTexture(["紧急报警"], { bg: "#8a1414", h: 128 }),
    0.5, 0.2, new THREE.Vector3(-2.0, 1.78, 4.87), Math.PI);

  // 温度记录仪 (穿堂内, 门旁墙面)
  box(0.34, 0.46, 0.09, new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.5, metalness: 0.1 }),
    new THREE.Vector3(-3.9, 1.65, 5.16), false, false);
  const recScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.14),
    new THREE.MeshStandardMaterial({ color: 0x0a1a10, emissive: 0x2fd06a, emissiveIntensity: 0.9, roughness: 0.3 }));
  recScreen.position.set(-3.9, 1.76, 5.21);
  scene.add(recScreen);
  mkSign(TEX.signTexture(["温度记录仪"], { h: 96 }),
    0.4, 0.12, new THREE.Vector3(-3.9, 1.34, 5.21));

  // 压力平衡阀 (右前墙高处, 平衡开关门/降温造成的库内外气压差)
  const valveMat = new THREE.MeshStandardMaterial({ color: 0x9aa6b0, roughness: 0.45, metalness: 0.5 });
  box(0.52, 0.52, 0.1, valveMat, new THREE.Vector3(5.9, 5.05, 5.14), false, false);
  box(0.52, 0.52, 0.1, valveMat, new THREE.Vector3(5.9, 5.05, 4.86), false, false);
  for (let i = 0; i < 4; i++) {
    const slat = box(0.44, 0.07, 0.03, mats.darkSteel, new THREE.Vector3(5.9, 4.88 + i * 0.115, 5.2), false, false);
    slat.rotation.x = 0.55;
  }

  // PVC 软门帘 (门洞内侧, 开门时随气流摆动)
  curtainGroup = new THREE.Group();
  curtainGroup.position.set(0, 3.5, 4.93);
  scene.add(curtainGroup);
  const ct = TEX.stripCurtainTexture();
  for (let i = 0; i < 4; i++) {
    const geo = new THREE.PlaneGeometry(0.65, 3.42);
    geo.translate(0, -1.71, 0);      // 顶边为转轴
    const p = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      map: ct, transparent: true, side: THREE.DoubleSide, depthWrite: false,
      roughness: 0.22, metalness: 0, envMapIntensity: 0.7,
    }));
    p.position.set(-0.975 + i * 0.65, 0, 0);
    p.userData.phase = i * 1.7;
    curtainGroup.add(p);
  }

  // 穿堂外口软门帘 (外口无门, 软帘挡风遮尘)
  outerCurtainGroup = new THREE.Group();
  outerCurtainGroup.position.set(0, 3.2, 9.96);
  scene.add(outerCurtainGroup);
  for (let i = 0; i < 5; i++) {
    const geo = new THREE.PlaneGeometry(0.66, 3.12);
    geo.translate(0, -1.56, 0);
    const p = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      map: ct, transparent: true, side: THREE.DoubleSide, depthWrite: false,
      roughness: 0.22, metalness: 0, envMapIntensity: 0.7,
    }));
    p.position.set(-1.3 + i * 0.65, 0, 0);
    p.userData.phase = i * 1.3;
    outerCurtainGroup.add(p);
  }

  // 库内飘落霜晶
  const n = 240;
  const pos = new Float32Array(n * 3);
  const vel = [];
  for (let i = 0; i < n; i++) {
    pos[i * 3] = -6.6 + Math.random() * 13.2;
    pos[i * 3 + 1] = Math.random() * 5.7;
    pos[i * 3 + 2] = -12.7 + Math.random() * 17.5;
    vel.push(0.06 + Math.random() * 0.12);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({
    color: 0xe6f6ff, size: 0.045, transparent: true, opacity: 0.75,
    blending: THREE.AdditiveBlending, depthWrite: false, map: TEX.softParticleTexture(),
  }));
  scene.add(pts);
  sparkleSys = { pts, pos, vel, n };
}

function addSafetyDetails() {
  const bollardMat = new THREE.MeshStandardMaterial({ color: 0xe1ac18, roughness: 0.48, metalness: 0.24 });
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5, metalness: 0.1 });
  [[-3.8, 6.2], [3.8, 6.2], [8.6, 5.95], [15.5, 5.95]].forEach(([x, z]) => {
    cyl(0.13, 1.25, bollardMat, new THREE.Vector3(x, 0.62, z));
    cyl(0.135, 0.18, stripeMat, new THREE.Vector3(x, 0.48, z));
    cyl(0.135, 0.18, stripeMat, new THREE.Vector3(x, 0.9, z));
    addCollider(x - 0.15, x + 0.15, z - 0.15, z + 0.15);
  });
  box(0.08, 0.1, 16, mats.yellowPipe, new THREE.Vector3(8.6, 0.05, 6.2), false, false);
}

// ---------------------------------------------------------------- 库门 (电动平移门, 后端物理驱动)
const doorGroup = new THREE.Group();
let doorSlabMesh = null;
let airCurtainLED = null;
function buildDoor() {
  doorGroup.position.set(0, 0, 5.24);
  scene.add(doorGroup);
  const slab = new THREE.Mesh(new THREE.BoxGeometry(2.9, 3.7, 0.13),
    new THREE.MeshStandardMaterial({ map: doorT.map, roughnessMap: doorT.rough, roughness: 1.0, metalness: 0.55 }));
  slab.position.set(0, 1.85, 0);
  slab.castShadow = true;
  slab.receiveShadow = true;
  slab.userData.interactive = "door";
  tagKP(slab, ["KP04"]);
  doorGroup.add(slab);
  doorSlabMesh = slab;

  // 外侧竖向拉手
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.85, 0.09), mats.steel);
  lever.position.set(-1.15, -0.15, 0.11);
  slab.add(lever);
  // 内侧应急开门推杆 (被困人员从库内可推开, 教学安全点)
  const pushBar = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.11, 0.09),
    new THREE.MeshStandardMaterial({ color: 0x27a347, roughness: 0.4, metalness: 0.3 }));
  pushBar.position.set(-0.85, -0.8, -0.12);
  slab.add(pushBar);
  const escSign = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.3),
    new THREE.MeshStandardMaterial({ map: TEX.signTexture(["应急开门 · 推"], { bg: "#1c7a34", h: 128 }), roughness: 0.5 }));
  escSign.rotation.y = Math.PI;
  escSign.position.set(-0.85, -0.42, -0.075);
  slab.add(escSign);
  // 吊轮支架 (挂在导轨上随门滑动)
  [-1.1, 1.1].forEach((hx) => {
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.3, 0.08), mats.darkSteel);
    bracket.position.set(hx, 1.98, 0.02);
    slab.add(bracket);
    const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.06, 16), mats.steel);
    roller.rotation.x = Math.PI / 2;
    roller.position.set(hx, 2.13, 0.03);
    slab.add(roller);
  });

  // 导轨 (沿前墙外侧, 门向右滑) + 墙面支架 + 端部电机箱
  box(6.3, 0.12, 0.1, mats.darkSteel, new THREE.Vector3(1.45, 3.98, 5.3));
  [-1.3, 0.2, 1.7, 3.2, 4.4].forEach((bx) => {
    box(0.08, 0.08, 0.18, mats.darkSteel, new THREE.Vector3(bx, 3.98, 5.2), false, false);
  });
  box(0.55, 0.5, 0.35, new THREE.MeshStandardMaterial({ color: 0x2b4a68, roughness: 0.4, metalness: 0.5 }),
    new THREE.Vector3(4.35, 3.98, 5.33));
  // 地面导向槽
  box(6.0, 0.04, 0.08, mats.darkSteel, new THREE.Vector3(1.45, 0.02, 5.24), false, true);

  // 风幕机 (库内侧门楣上方, 开门时出风; 绿色 LED 指示运行)
  box(3.0, 0.3, 0.32, new THREE.MeshStandardMaterial({ color: 0xdfe5ea, roughness: 0.4, metalness: 0.35 }),
    new THREE.Vector3(0, 3.72, 4.72));
  box(2.8, 0.06, 0.2, mats.darkSteel, new THREE.Vector3(0, 3.55, 4.72), false, false);
  airCurtainLED = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.04),
    new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0x00ff66, emissiveIntensity: 0 }));
  airCurtainLED.position.set(1.35, 3.72, 4.55);
  scene.add(airCurtainLED);
}

// ---------------------------------------------------------------- 动态刚体
const dynMeshes = [];        // 与 manifest 顺序一致
const dynTargets = [];       // {p: Vector3, q: Quaternion}
const blobs = [];            // 接触阴影贴片
let heldName = null;

function buildDynamicBodies(manifest) {
  dynMeshes.forEach((m) => scene.remove(m));
  blobs.forEach((b) => scene.remove(b));
  dynMeshes.length = 0;
  dynTargets.length = 0;
  blobs.length = 0;
  manifest.forEach((b, i) => {
    let geo, mat;
    if (b.shape === "box") {
      geo = new THREE.BoxGeometry(b.size[0], b.size[1], b.size[2]);
      mat = new THREE.MeshStandardMaterial({ map: cardboardT[i % 3], roughness: 0.88 });
      mat.color.lerp(new THREE.Color(b.color), 0.18);   // 轻微色差区分箱体
    } else if (b.shape === "cylinder") {
      geo = new THREE.CylinderGeometry(b.size[0], b.size[0], b.size[1], 28);
      mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(b.color), roughness: 0.4, metalness: 0.55, envMapIntensity: 1.1,
      });
    } else {
      geo = new THREE.SphereGeometry(b.size[0], 24, 18);
      mat = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(b.color), roughness: 0.5, clearcoat: 0.7, clearcoatRoughness: 0.25,
      });
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.visible = !b.pool;
    mesh.userData.bodyName = b.name;
    mesh.userData.grabbable = true;
    mesh.userData.kp = CARGO_KP;       // 动态货箱同属货物类知识点
    scene.add(mesh);
    dynMeshes.push(mesh);
    dynTargets.push({ p: new THREE.Vector3(), q: new THREE.Quaternion(), init: false });

    // 接触阴影
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: blobT, transparent: true, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2;
    const s = (b.shape === "box" ? Math.max(b.size[0], b.size[2]) : b.size[0] * 2) * 1.55;
    blob.scale.set(s, s, 1);
    blob.renderOrder = 1;
    blob.visible = !b.pool;
    scene.add(blob);
    blobs.push(blob);
  });
}

const DOOR_TRAVEL = 2.75;                 // 与后端一致: 平移门全开行程 m
const doorTarget = { d: 0 };              // 后端下发的滑开位移

function applyState(msg) {
  const arr = msg.b;
  for (let i = 0; i < arr.length && i < dynMeshes.length; i++) {
    const s = arr[i];
    const t = dynTargets[i];
    t.p.set(s[0], s[1], s[2]);
    t.q.set(s[3], s[4], s[5], s[6]);
    if (!t.init) {
      t.init = true;
      dynMeshes[i].position.copy(t.p);
      dynMeshes[i].quaternion.copy(t.q);
    }
    dynMeshes[i].visible = s[1] > -1.5;
  }
  doorTarget.d = msg.door;

  // 抓取高亮
  if (msg.held !== heldName) {
    if (heldName) {
      const old = dynMeshes.find((m) => m.userData.bodyName === heldName);
      if (old) old.material.emissive.setHex(0x000000);
    }
    heldName = msg.held;
    if (heldName) {
      const now = dynMeshes.find((m) => m.userData.bodyName === heldName);
      if (now) now.material.emissive.setHex(0x1c4f8f);
    }
  }

  if (msg.th) updateHUD(msg.th, msg.scale, msg.doorOpen);
}

// ---------------------------------------------------------------- HUD
const chartData = [];
let lastChartPush = 0;
let latestTh = null;

function fmtSim(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return `仿真 ${h}:${String(m).padStart(2, "0")}`;
}

function updateHUD(th, scale, doorOpen) {
  latestTh = th;
  ui.tIn.textContent = th.tIn.toFixed(1) + " °C";
  ui.rhIn.textContent = th.rhIn.toFixed(1) + " %RH";
  ui.tProd.textContent = th.tProduct.toFixed(1) + " °C";
  ui.tOut.textContent = th.tOut.toFixed(1) + " °C";
  ui.rhOut.textContent = th.rhOut.toFixed(1) + " %RH";
  ui.qDoor.textContent = th.qDoor.toFixed(1) + " kW";
  ui.qEnv.textContent = th.qEnv.toFixed(1) + " kW";
  ui.tEvap.textContent = th.tEvap.toFixed(1) + " °C";
  ui.frost.textContent = th.frost.toFixed(2) + " kg";
  ui.qCool.textContent = th.qCool.toFixed(1) + " kW";
  ui.power.textContent = th.power.toFixed(1) + " kW";
  ui.cop.textContent = th.cop > 0 ? th.cop.toFixed(2) : "--";
  ui.energy.textContent = th.energy.toFixed(1) + " kWh";
  ui.simClock.textContent = fmtSim(th.simTime);

  const compMap = { on: ["运行中", ""], off: ["停机", "off"], defrost: ["化霜中", "warn"] };
  const [txt, cls] = compMap[th.comp] || ["--", "off"];
  ui.compState.textContent = txt;
  ui.compDot.className = "status-dot " + cls;

  ui.doorState.textContent = doorOpen ? "开启" : "关闭";
  ui.doorDot.className = "status-dot " + (doorOpen ? "warn" : "");
  ui.miniDoor.style.transform = `translateX(${(doorTarget.d * 4.2).toFixed(1)}px)`;

  if (th.alarms && th.alarms.length) {
    ui.alarmBanner.textContent = "⚠ " + th.alarms.join(" · ");
    ui.alarmBanner.classList.add("active");
  } else {
    ui.alarmBanner.classList.remove("active");
  }

  document.querySelectorAll("#controls button[data-speed]").forEach((b) => {
    b.classList.toggle("active", Number(b.dataset.speed) === scale);
  });

  const now = performance.now();
  if (now - lastChartPush > 1000) {
    lastChartPush = now;
    chartData.push({ tIn: th.tIn, tOut: th.tOut });
    if (chartData.length > 260) chartData.shift();
    drawChart();
  }
}

function drawChart() {
  const c = ui.chart, g = c.getContext("2d");
  const W = c.width, H = c.height;
  g.clearRect(0, 0, W, H);
  if (chartData.length < 2) return;
  let lo = -24, hi = -10;
  chartData.forEach((d) => { lo = Math.min(lo, d.tIn - 1); hi = Math.max(hi, d.tIn + 1); });
  const y = (v) => H - ((v - lo) / (hi - lo)) * (H - 14) - 7;
  const x = (i) => (i / (chartData.length - 1)) * (W - 4) + 2;
  // 设定点
  g.strokeStyle = "rgba(255,171,46,0.55)";
  g.setLineDash([4, 4]);
  g.beginPath(); g.moveTo(0, y(-18)); g.lineTo(W, y(-18)); g.stroke();
  g.setLineDash([]);
  // 库温
  g.strokeStyle = "#5fc2ff";
  g.lineWidth = 1.8;
  g.beginPath();
  chartData.forEach((d, i) => { i ? g.lineTo(x(i), y(d.tIn)) : g.moveTo(x(i), y(d.tIn)); });
  g.stroke();
  // 刻度
  g.fillStyle = "rgba(200,225,250,0.75)";
  g.font = "10px sans-serif";
  g.fillText(hi.toFixed(0) + "°", 4, 11);
  g.fillText(lo.toFixed(0) + "°", 4, H - 3);
}

// ---------------------------------------------------------------- 网络
let ws = null;
let wsOpen = false;

function connect() {
  const url = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws";
  ws = new WebSocket(url);
  ws.onopen = () => {
    wsOpen = true;
    ui.connDot.classList.add("ok");
    ui.connText.textContent = "已连接 · Python 物理引擎";
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.t === "init") {
      buildDynamicBodies(msg.bodies);
      // 用后端历史预填图表, 用快照立即点亮 HUD
      chartData.length = 0;
      (msg.history || []).slice(-260).forEach((e) => chartData.push({ tIn: e[1], tOut: e[2] }));
      lastChartPush = performance.now();
      drawChart();
      if (msg.snapshot) updateHUD(msg.snapshot, msg.scale, false);
    } else if (msg.t === "state") applyState(msg);
    else if (msg.t === "note") showNote(msg.msg);
  };
  ws.onclose = () => {
    wsOpen = false;
    ui.connDot.classList.remove("ok");
    ui.connText.textContent = "连接断开, 重连中…";
    setTimeout(connect, 1500);
  };
  ws.onerror = () => ws.close();
}

function send(obj) {
  if (wsOpen && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

const _dir = new THREE.Vector3();
function camPosDir() {
  camera.getWorldDirection(_dir);
  const p = controls.getObject().position;
  return { pos: [p.x, p.y, p.z], dir: [_dir.x, _dir.y, _dir.z] };
}

setInterval(() => {
  if (wsOpen && controls.isLocked) {
    const pd = camPosDir();
    send({ c: "player", pos: pd.pos, dir: pd.dir });
  }
}, 50);

// ---------------------------------------------------------------- 输入
let currentTarget = null;      // 准星目标 {kind, mesh}
let noteText = "", noteUntil = 0;
function showNote(t) {
  noteText = t;
  noteUntil = performance.now() + 1800;
}

function triggerManualAlarm() {
  showNote("报警已发送至值班室");
  if (alarmBtnMesh) {
    alarmBtnMesh.material.emissiveIntensity = 2.5;
    setTimeout(() => { alarmBtnMesh.material.emissiveIntensity = 0.6; }, 1600);
  }
}

let currentKp = null;          // 准星所指部位的知识点 ID 列表
function checkCrosshair() {
  raycaster.setFromCamera(CENTER, camera);
  raycaster.far = 3.4;
  const candidates = [doorSlabMesh, alarmBtnMesh, ...dynMeshes.filter((m) => m.visible)].filter(Boolean);
  const hits = raycaster.intersectObjects(candidates, false);
  currentTarget = null;
  if (hits.length) {
    const m = hits[0].object;
    if (m.userData.interactive === "door") currentTarget = { kind: "door", mesh: m };
    else if (m.userData.interactive === "alarm") currentTarget = { kind: "alarm", mesh: m };
    else if (m.userData.grabbable) currentTarget = { kind: "body", mesh: m };
  }

  // 知识云射线: 准星对准云朵 → 出现"点击查看"确认按钮
  raycaster.far = 13;
  const cloudHits = raycaster.intersectObjects(kpClouds.map((c) => c.sprite), false);
  hoveredCloud = cloudHits.length ? cloudHits[0].object.userData.kpCloud : null;
  currentKp = hoveredCloud ? hoveredCloud.ids : null;
  if (hoveredCloud && controls.isLocked && !heldName) {
    const names = hoveredCloud.ids.map((id) => KP_BY_ID[id]?.title).filter(Boolean);
    ui.kpPrompt.innerHTML = `🧊 <b>${hoveredCloud.label}</b> · ${names.length > 1 ? names.length + " 个知识点" : names[0]}<span>点击鼠标左键查看</span>`;
    ui.kpPrompt.classList.add("active");
  } else {
    ui.kpPrompt.classList.remove("active");
  }

  let label = "";
  if (performance.now() < noteUntil) label = noteText;
  else if (heldName) label = "按 F 放下 · 左键投掷";
  else if (currentTarget?.kind === "door") label = doorTarget.d > 0.4 ? "按 E 关门" : "按 E 开门";
  else if (currentTarget?.kind === "alarm") label = "按 E 触发紧急报警";
  else if (currentTarget?.kind === "body") label = "按 F 抓取";
  ui.targetLabel.textContent = label;
  ui.targetLabel.classList.toggle("active", Boolean(label));
}

// ---------------------------------------------------------------- 知识点浮窗
let kpModalOpen = false;
function openKpModal(ids) {
  ui.kpPrompt.classList.remove("active");
  ui.kpModalBody.innerHTML = ids.map((id) => {
    const k = KP_BY_ID[id];
    if (!k) return "";
    return `
      <div class="kp-pop-card">
        <div class="kp-pop-head">
          <span class="kp-pop-id">${k.id}</span>
          <span class="kp-pop-title">${k.title}</span>
          <span class="kp-pop-cat">${k.cat}</span>
        </div>
        <div class="kp-pop-formula">${k.formula}</div>
        <p class="kp-pop-brief">${k.brief}</p>
        <a class="kp-pop-go" href="./kp/${k.file}" target="_blank" rel="opener">进入交互页 →</a>
      </div>`;
  }).join("");
  kpModalOpen = true;
  ui.kpModal.classList.add("active");
  controls.unlock();
}

function closeKpModal(relock) {
  kpModalOpen = false;
  ui.kpModal.classList.remove("active");
  if (relock) controls.lock();
  else {
    ui.start.style.display = "grid";
    ui.start.classList.add("compact");
  }
}

document.addEventListener("keydown", (e) => {
  keys[e.code] = true;
  if (!controls.isLocked && !["Digit1", "Digit2", "Digit3", "KeyT", "KeyR"].includes(e.code)) return;
  switch (e.code) {
    case "KeyE":
      if (currentTarget?.kind === "door") send({ c: "door" });
      else if (currentTarget?.kind === "alarm") triggerManualAlarm();
      break;
    case "KeyQ":                          // Q = 点击的键盘替代
      if (controls.isLocked && hoveredCloud) openKpModal(hoveredCloud.ids);
      break;
    case "KeyF": {
      const pd = camPosDir();
      send({ c: "grab", pos: pd.pos, dir: pd.dir });
      break;
    }
    case "KeyG": {
      const pd = camPosDir();
      send({ c: "spawn", pos: pd.pos, dir: pd.dir });
      break;
    }
    case "KeyR": send({ c: "reset" }); break;
    case "KeyT": send({ c: "defrost" }); break;
    case "Digit1": send({ c: "speed", v: 1 }); break;
    case "Digit2": send({ c: "speed", v: 30 }); break;
    case "Digit3": send({ c: "speed", v: 120 }); break;
  }
});
document.addEventListener("keyup", (e) => { keys[e.code] = false; });

document.addEventListener("mousedown", (e) => {
  if (!controls.isLocked || e.button !== 0) return;
  if (heldName) {
    const pd = camPosDir();
    send({ c: "throw", dir: pd.dir });
  } else if (hoveredCloud) {
    openKpModal(hoveredCloud.ids);       // 点击确认: 打开知识点浮窗
  }
});

ui.defrostBtn.addEventListener("click", () => send({ c: "defrost" }));
ui.resetBtn.addEventListener("click", () => send({ c: "reset" }));
ui.spawnBtn.addEventListener("click", () => {
  const pd = camPosDir();
  send({ c: "spawn", pos: pd.pos, dir: pd.dir });
});
document.querySelectorAll("#controls button[data-speed]").forEach((b) => {
  b.addEventListener("click", () => send({ c: "speed", v: Number(b.dataset.speed) }));
});

// ---------------------------------------------------------------- 移动
const velocity = new THREE.Vector3();
const EYE_HEIGHT = 1.7;
const JUMP_SPEED = 6.5;      // 起跳初速 m/s (跳高约 1.1m)
const GRAVITY = 19.0;        // m/s^2
let velY = 0;
let onGround = true;

function canMoveTo(next) {
  const radius = 0.34;
  for (const c of colliders) {
    if (next.x + radius > c.minX && next.x - radius < c.maxX &&
        next.z + radius > c.minZ && next.z - radius < c.maxZ) return false;
  }
  // 库门未滑开足够时阻挡门洞
  if (doorTarget.d < 1.3 &&
      next.x > -1.45 && next.x < 1.45 && next.z > 4.78 && next.z < 5.5) return false;
  return true;
}

function updateMovement(delta) {
  if (!controls.isLocked) return;
  velocity.x -= velocity.x * 10 * delta;
  velocity.z -= velocity.z * 10 * delta;
  // 注意: 不能用 Number(keys.X || keys.Y) —— 未按过的键是 undefined,
  // Number(undefined)=NaN 会让整个轴瘫痪 (原始 demo 遗留 bug)
  const dir = new THREE.Vector3(
    (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0),
    0,
    (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0),
  );
  dir.normalize();
  // 帧率无关: velocity 单位 m/s (稳态=speed), 位移=velocity*delta
  // (原始 demo 直接 moveForward(velocity) 不乘 delta, 速度随帧率翻倍)
  const speed = keys.ShiftLeft ? 6.4 : 4.1;
  if (dir.z) velocity.z -= dir.z * speed * 10 * delta;
  if (dir.x) velocity.x -= dir.x * speed * 10 * delta;

  const obj = controls.getObject();
  const old = obj.position.clone();
  controls.moveRight(-velocity.x * delta);
  if (!canMoveTo(obj.position)) obj.position.copy(old);
  const afterX = obj.position.clone();
  controls.moveForward(-velocity.z * delta);
  if (!canMoveTo(obj.position)) obj.position.copy(afterX);

  // 跳跃: 竖直速度积分 + 地面判定
  if (keys.Space && onGround) {
    velY = JUMP_SPEED;
    onGround = false;
  }
  velY -= GRAVITY * delta;
  let y = obj.position.y + velY * delta;
  if (y <= EYE_HEIGHT) {
    y = EYE_HEIGHT;
    velY = 0;
    onGround = true;
  }
  obj.position.y = y;
}

// ---------------------------------------------------------------- 动画循环
function updateAnimations(delta, elapsed) {
  // 插值动态刚体 + 同步接触阴影
  const k = 1 - Math.exp(-16 * delta);
  for (let i = 0; i < dynMeshes.length; i++) {
    const t = dynTargets[i];
    if (!t.init) continue;
    const m = dynMeshes[i];
    m.position.lerp(t.p, k);
    m.quaternion.slerp(t.q, k);
    const blob = blobs[i];
    if (blob) {
      blob.visible = m.visible;
      if (m.visible) {
        const inside = Math.abs(m.position.x) < 6.9 && m.position.z > -12.9 && m.position.z < 5.0;
        blob.position.set(m.position.x, inside ? 0.078 : 0.004, m.position.z);
        blob.material.opacity = THREE.MathUtils.clamp(0.55 - m.position.y * 0.16, 0.05, 0.5);
      }
    }
  }
  doorGroup.position.x += (doorTarget.d - doorGroup.position.x) * k;

  // 门帘摆动 (幅度随开门气流增大) 与飘落霜晶
  if (curtainGroup) {
    const frac = Math.min(doorTarget.d / DOOR_TRAVEL, 1);
    curtainGroup.children.forEach((p) => {
      p.rotation.x = Math.sin(elapsed * 1.6 + p.userData.phase) * (0.015 + frac * 0.11);
    });
  }
  // 穿堂外口软帘 (常年小幅摆动)
  if (outerCurtainGroup) {
    outerCurtainGroup.children.forEach((p) => {
      p.rotation.x = Math.sin(elapsed * 1.1 + p.userData.phase) * 0.05;
    });
  }
  if (sparkleSys) {
    for (let i = 0; i < sparkleSys.n; i++) {
      sparkleSys.pos[i * 3 + 1] -= sparkleSys.vel[i] * delta;
      sparkleSys.pos[i * 3] += Math.sin(elapsed * 0.8 + i) * 0.02 * delta;
      if (sparkleSys.pos[i * 3 + 1] < 0.12) sparkleSys.pos[i * 3 + 1] = 5.7;
    }
    sparkleSys.pts.geometry.attributes.position.needsUpdate = true;
  }

  // 知识云: 轻轻浮动 + 悬停放大
  kpClouds.forEach((c) => {
    c.sprite.position.y = c.baseY + Math.sin(elapsed * 1.3 + c.phase) * 0.05;
    const target = (hoveredCloud === c.sprite.userData.kpCloud) ? 1.28 : 1.0;
    const cur2 = c.sprite.scale.x / 1.05;
    const k2 = cur2 + (target - cur2) * Math.min(delta * 10, 1);
    c.sprite.scale.set(1.05 * k2, 0.53 * k2, 1);
  });

  // 冷风机持续送风(仅化霜停); 冷凝器顶部风机跟随压缩机
  const evapRunning = latestTh ? latestTh.comp !== "defrost" : true;
  const compOn = latestTh ? latestTh.comp === "on" : true;
  fans.forEach((fan) => {
    const isEvap = fan.userData.evap === true;
    if (isEvap ? evapRunning : compOn) fan.rotation.z -= delta * (fan.userData.speed || (isEvap ? 18 : 8));
  });

  // 冷雾随化霜淡出/淡入, 不半空冻结
  mats.coldMist.opacity += ((evapRunning ? 0.42 : 0) - mats.coldMist.opacity) * Math.min(delta * 2, 1);
  coldParticles.forEach((system) => {
    const arr = system.positions;
    for (let i = 0; i < system.count; i++) {
      if (evapRunning) {
        arr[i * 3] += system.velocities[i].x * delta;
        arr[i * 3 + 1] += Math.sin(elapsed * 3 + i) * 0.05 * delta;
        arr[i * 3 + 2] += system.velocities[i].z * delta;
      }
      const src = system.srcs[i];
      if (arr[i * 3 + 2] > src.z + 8.0 || arr[i * 3 + 1] < 1.2) {
        arr[i * 3] = src.x + (Math.random() - 0.5) * 0.7;
        arr[i * 3 + 1] = src.y + (Math.random() - 0.5) * 0.5;
        arr[i * 3 + 2] = src.z + Math.random() * 0.3;
      }
    }
    system.points.geometry.attributes.position.needsUpdate = true;
  });

  // 风幕气流 + 运行指示灯 (随开门启停)
  if (airCurtainSys) {
    const frac = Math.min(doorTarget.d / DOOR_TRAVEL, 1);
    mats.airStream.opacity = frac > 0.05 ? 0.3 : 0;
    if (airCurtainLED) airCurtainLED.material.emissiveIntensity = frac > 0.05 ? 2.2 : 0;
    if (frac > 0.05) {
      const arr = airCurtainSys.positions;
      for (let i = 0; i < airCurtainSys.count; i++) {
        arr[i * 3 + 1] -= airCurtainSys.vel[i] * delta;
        if (arr[i * 3 + 1] < 0.1) arr[i * 3 + 1] = 3.5;
      }
      airCurtainSys.points.geometry.attributes.position.needsUpdate = true;
    }
  }

  // 门口冷气瀑布
  if (doorMistSys) {
    const frac = Math.min(doorTarget.d / DOOR_TRAVEL, 1);
    mats.doorMist.opacity = frac * 0.5;
    if (frac > 0.05) {
      const arr = doorMistSys.positions;
      for (let i = 0; i < doorMistSys.count; i++) {
        arr[i * 3] += doorMistSys.vel[i].x * delta;
        arr[i * 3 + 1] += doorMistSys.vel[i].y * delta;
        arr[i * 3 + 2] += doorMistSys.vel[i].z * delta * frac;
        if (arr[i * 3 + 2] > 8.2 || arr[i * 3 + 1] < 0.05) {
          arr[i * 3] = -1.2 + Math.random() * 2.4;
          arr[i * 3 + 1] = 0.15 + Math.random() * 3.2;
          arr[i * 3 + 2] = 5.15 + Math.random() * 0.3;
        }
      }
      doorMistSys.points.geometry.attributes.position.needsUpdate = true;
    }
    scene.fog.density = 0.015 + frac * 0.01 +
      (latestTh && latestTh.rhIn > 92 && latestTh.tIn < -5 ? 0.005 : 0);
  }
}

function updateMiniMap() {
  const p = controls.getObject().position;
  const x = THREE.MathUtils.clamp(90 + p.x * 4.2, 8, 172);
  const y = THREE.MathUtils.clamp(73 - p.z * 4.2, 8, 172);
  ui.miniPlayer.style.left = `${x}px`;
  ui.miniPlayer.style.top = `${y}px`;
}

function animate() {
  requestAnimationFrame(animate);
  window.__debug.frames++;
  const delta = Math.min(clock.getDelta(), 0.05);
  updateMovement(delta);
  checkCrosshair();
  updateAnimations(delta, clock.elapsedTime);
  updateMiniMap();
  composer.render();
}

// ---------------------------------------------------------------- 启动
ui.startBtn.addEventListener("click", () => controls.lock());
controls.addEventListener("lock", () => { ui.start.style.display = "none"; });
controls.addEventListener("unlock", () => {
  ui.startBtn.textContent = "继续巡检";
  if (kpModalOpen) return;             // 知识点浮窗打开时不弹"继续巡检"遮罩
  ui.start.style.display = "grid";
  ui.start.classList.add("compact");
});

ui.kpModalClose.addEventListener("click", () => closeKpModal(true));
ui.kpModal.addEventListener("mousedown", (e) => {
  if (e.target === ui.kpModal) closeKpModal(true);   // 点击遮罩空白处关闭
});
document.addEventListener("keydown", (e) => {
  if (e.code === "Escape" && kpModalOpen) closeKpModal(false);
});

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  composer.setSize(innerWidth, innerHeight);
});

addLighting();
addGround();
addColdRoom();
addAnteroom();
buildDoor();
addAirCurtain();
[-3.9, 3.9].forEach((x) => [-11.2, -8.75, -5.5, -3.05].forEach((z) => addRack(x, z)));
addRefrigerantPiping();
addCeilingServices();
addUnitCoolers();
addColdMist();
addDoorMist();
addEquipment();
addSafetyDetails();
addRealismDetails();
addKnowledgeClouds();
connect();
animate();
