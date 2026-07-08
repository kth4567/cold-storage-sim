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

// ---------------------------------------------------------------- 基础
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a1420);
scene.fog = new THREE.FogExp2(0x1a2836, 0.010);

const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 160);
camera.position.set(0, 1.7, 10.5);

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

const ui = {};
["start", "startBtn", "targetLabel", "doorState", "doorDot", "miniDoor", "miniPlayer",
 "tIn", "rhIn", "tOut", "rhOut", "tProd", "tEvap", "frost", "compDot", "compState",
 "qCool", "qDoor", "qEnv", "power", "cop", "energy", "simClock", "alarmBanner",
 "connDot", "connText", "chart", "defrostBtn", "resetBtn", "spawnBtn"]
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
  blueSteel: new THREE.MeshStandardMaterial({ color: 0x0b5b9c, roughness: 0.34, metalness: 0.35 }),
  redSteel: new THREE.MeshStandardMaterial({ color: 0xa33423, roughness: 0.36, metalness: 0.35 }),
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

  // 库内冷白灯管 (提高发光强度供辉光拾取)
  [[-3.6, 3.65, 0], [0, 3.65, -5.2], [3.6, 3.65, 0]].forEach((p) => {
    const light = new THREE.PointLight(0xe8f4ff, 25, 7.5, 2);
    light.position.set(p[0], p[1], p[2]);
    scene.add(light);
    const tube = box(0.18, 0.08, 2.1, new THREE.MeshStandardMaterial({
      color: 0xeef8ff, emissive: 0xd6f0ff, emissiveIntensity: 1.7, roughness: 0.2,
    }), new THREE.Vector3(p[0], 3.48, p[2]), false, false);
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

  // 门口投光灯: 暖光洒在入口
  const entrance = new THREE.PointLight(0xffe0b0, 15, 10, 2);
  entrance.position.set(0, 4.7, 6.2);
  scene.add(entrance);
  box(0.5, 0.12, 0.22, new THREE.MeshStandardMaterial({
    color: 0x2c3138, emissive: 0xffe2b0, emissiveIntensity: 1.5, roughness: 0.4,
  }), new THREE.Vector3(0, 4.62, 5.28), false, false);
}

function addGround() {
  box(38, 0.18, 34, mats.floor, new THREE.Vector3(4, -0.1, -1), false, true);
  // 水洼 (低粗糙度 + 环境反射 = 镜面湿地)
  const wet = box(18, 0.025, 9, mats.wet, new THREE.Vector3(8, 0.01, 7.3), false, true);
  wet.rotation.y = -0.03;
}

function addColdRoom() {
  const width = 9.5, depth = 12, height = 4.5, zc = -1;
  box(width, 0.18, depth, mats.wall, new THREE.Vector3(0, height, zc));
  box(0.18, height, depth, mats.wall, new THREE.Vector3(-width / 2, height / 2, zc));
  box(0.18, height, depth, mats.wall, new THREE.Vector3(width / 2, height / 2, zc));
  box(width, height, 0.18, mats.wall, new THREE.Vector3(0, height / 2, zc - depth / 2));
  // 门洞两侧 + 门楣 (门洞宽 2.6, x -1.3..1.3)
  box(3.45, height, 0.22, mats.wall, new THREE.Vector3(-3.025, height / 2, zc + depth / 2));
  box(3.45, height, 0.22, mats.wall, new THREE.Vector3(3.025, height / 2, zc + depth / 2));
  box(2.7, 1.0, 0.22, mats.wall, new THREE.Vector3(0, 4.0, zc + depth / 2));

  box(width - 0.25, 0.06, depth - 0.25, mats.glassIce, new THREE.Vector3(0, 0.04, zc), false, true);

  const ribMat = new THREE.LineBasicMaterial({ color: 0xddefff, transparent: true, opacity: 0.22 });
  for (let x = -4.1; x <= 4.1; x += 0.7) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, 0.15, zc - depth / 2 + 0.1),
      new THREE.Vector3(x, height - 0.1, zc - depth / 2 + 0.1),
    ]);
    scene.add(new THREE.Line(geo, ribMat));
  }

  addCollider(-4.85, -4.55, -7, 5.2);
  addCollider(4.55, 4.85, -7, 5.2);
  addCollider(-4.8, 4.8, -7.1, -6.75);
  addCollider(-4.8, -1.40, 4.85, 5.3);
  addCollider(1.40, 4.8, 4.85, 5.3);

  // 门框
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x5c6873, roughness: 0.36, metalness: 0.6 });
  box(3.2, 0.22, 0.3, frameMat, new THREE.Vector3(0, 4.55, 5.05));
  box(0.22, 4.5, 0.3, frameMat, new THREE.Vector3(-1.47, 2.25, 5.05));
  box(0.22, 4.5, 0.3, frameMat, new THREE.Vector3(1.47, 2.25, 5.05));
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
      rack.add(c);
    }
  }

  const pallet = new THREE.Mesh(new THREE.BoxGeometry(3.05, 0.16, 1), mats.pallet);
  pallet.position.set(0, 0.18, 0);
  rack.add(pallet);
  addCollider(x - 1.65, x + 1.65, z - 0.75, z + 0.75);
}

const coldParticles = [];
function addFan(x) {
  const group = new THREE.Group();
  group.position.set(x, 2.95, -6.82);
  scene.add(group);
  const housing = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.86, 0.25),
    new THREE.MeshStandardMaterial({ color: 0xe5edf5, roughness: 0.5, metalness: 0.2 }));
  housing.castShadow = true;
  group.add(housing);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.035, 12, 48), mats.darkSteel);
  ring.position.z = 0.16;
  group.add(ring);
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x536170, roughness: 0.42, metalness: 0.55 });
  const bladeGroup = new THREE.Group();
  bladeGroup.position.z = 0.18;
  group.add(bladeGroup);
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.42, 0.025), bladeMat);
    blade.position.y = 0.17;
    blade.rotation.z = i * Math.PI / 2 + 0.34;
    bladeGroup.add(blade);
  }
  fans.push(bladeGroup);
}

function addColdMist() {
  const count = 360;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const velocities = [];
  for (let i = 0; i < count; i++) {
    const fanX = [-1.7, 0, 1.7][i % 3];
    positions[i * 3] = fanX + (Math.random() - 0.5) * 0.55;
    positions[i * 3 + 1] = 2.72 + (Math.random() - 0.5) * 0.45;
    positions[i * 3 + 2] = -6.15 + Math.random() * 0.4;
    velocities.push(new THREE.Vector3((Math.random() - 0.5) * 0.18, (Math.random() - 0.5) * 0.04, 0.7 + Math.random() * 0.7));
  }
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(geo, mats.coldMist);
  scene.add(points);
  coldParticles.push({ points, positions, velocities, count });
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

function pipe(points, radius, material) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 70, radius, 12, false), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

function addEquipment() {
  box(7, 0.35, 2.6, mats.darkSteel, new THREE.Vector3(9.4, 0.28, 4.4));
  box(1.35, 1.8, 1.1, new THREE.MeshStandardMaterial({ color: 0xd6d0bc, roughness: 0.58, metalness: 0.25 }), new THREE.Vector3(11.1, 1.34, 4.0));
  for (let i = 0; i < 3; i++) {
    cyl(0.45, 1.65, mats.compressor, new THREE.Vector3(7.1 + i * 1.45, 1.22, 4.35));
    cyl(0.18, 1.35, mats.darkSteel, new THREE.Vector3(7.1 + i * 1.45, 1.2, 3.35), new THREE.Euler(Math.PI / 2, 0, 0));
  }
  box(4.7, 1.9, 2.3, mats.steel, new THREE.Vector3(10.2, 3.2, -2.3));
  // 冷凝器支腿 (箱体底面 y=2.25)
  [[8.1, -3.2], [8.1, -1.4], [12.3, -3.2], [12.3, -1.4]].forEach(([x, z]) => {
    box(0.14, 2.3, 0.14, mats.darkSteel, new THREE.Vector3(x, 1.15, z));
  });
  const finMat = new THREE.MeshStandardMaterial({ color: 0x1a242e, roughness: 0.56, metalness: 0.4 });
  for (let i = 0; i < 7; i++) {
    box(0.06, 1.7, 2.35, finMat, new THREE.Vector3(8.05 + i * 0.7, 3.2, -2.3), false, true);
  }
  [[9.15, -2.95], [11.25, -1.65]].forEach(([x, z]) => {
    const topFan = new THREE.Group();
    topFan.position.set(x, 4.25, z);
    scene.add(topFan);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.04, 12, 48), mats.darkSteel);
    ring.rotation.x = Math.PI / 2;
    topFan.add(ring);
    fans.push(topFan);
  });

  // 制冷管路: 沿外墙门顶上方管廊 (y 3.95/4.12/4.29, z=5.34), 到对应风机 x 位
  // 垂直 90° 穿墙(加套管), 墙内沿吊顶到蒸发器风机
  pipe([[7.15, 1.75, 4.4], [6.9, 3.2, 5.0], [6.2, 3.95, 5.34], [1.7, 3.95, 5.34],
        [1.7, 3.95, 4.7], [1.7, 4.02, -4.6], [1.7, 3.1, -6.5]], 0.08, mats.blueSteel);
  pipe([[8.5, 1.55, 4.0], [7.6, 2.6, 4.9], [6.0, 4.12, 5.34], [0, 4.12, 5.34],
        [0, 4.12, 4.7], [0, 4.2, -4.6], [0, 3.1, -6.5]], 0.07, mats.yellowPipe);
  pipe([[10.2, 4.2, -2.3], [10.6, 4.6, 1.5], [9.0, 4.3, 5.0], [7.0, 4.29, 5.34],
        [-1.7, 4.29, 5.34], [-1.7, 4.29, 4.7], [-1.7, 4.2, -4.6], [-1.7, 3.1, -6.5]], 0.07, mats.redSteel);
  // 穿墙套管
  [[1.7, 3.95], [0, 4.12], [-1.7, 4.29]].forEach(([x, y]) => {
    cyl(0.13, 0.3, mats.darkSteel, new THREE.Vector3(x, y, 5.11), new THREE.Euler(Math.PI / 2, 0, 0), 20);
  });
  // 管廊墙面支架
  [[2.6, 3.95], [4.3, 3.95], [0.9, 4.12], [3.2, 4.12], [-1.0, 4.29], [2.0, 4.29]].forEach(([x, y]) => {
    box(0.06, 0.06, 0.26, mats.darkSteel, new THREE.Vector3(x, y, 5.23), false, false);
  });
  // 跨越段支撑立柱 (设备区到建筑之间 / 冷凝器到墙之间)
  box(0.1, 4.35, 0.1, mats.steel, new THREE.Vector3(5.35, 2.175, 5.34));
  box(0.1, 4.55, 0.1, mats.steel, new THREE.Vector3(10.55, 2.275, 1.5));
  addCollider(5.9, 12.8, 3.0, 5.8);
  addCollider(7.85, 12.55, -3.45, -1.15);
}

// ---------------------------------------------------------------- 现实感细节
let curtainGroup = null;
let sparkleSys = null;
function addRealismDetails() {
  // 建筑外墙底部踢脚板
  const skirtMat = new THREE.MeshStandardMaterial({ color: 0x262c33, roughness: 0.7, metalness: 0.2 });
  box(3.17, 0.4, 0.06, skirtMat, new THREE.Vector3(-3.165, 0.2, 5.13), false, false);
  box(3.17, 0.4, 0.06, skirtMat, new THREE.Vector3(3.165, 0.2, 5.13), false, false);
  box(0.06, 0.4, 12, skirtMat, new THREE.Vector3(-4.86, 0.2, -1), false, false);
  box(0.06, 0.4, 12, skirtMat, new THREE.Vector3(4.86, 0.2, -1), false, false);
  box(9.5, 0.4, 0.06, skirtMat, new THREE.Vector3(0, 0.2, -7.11), false, false);

  // 墙面标识牌
  const mkSign = (t, w, h, pos) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, metalness: 0.1 }));
    m.position.copy(pos);
    scene.add(m);
  };
  mkSign(TEX.signTexture(["1号低温冷库  -18℃"], { w: 1024, h: 192, bg: "#123f7d" }),
    2.4, 0.46, new THREE.Vector3(0, 3.78, 5.125));
  mkSign(TEX.signTexture(["低温环境", "注意防寒"]),
    0.72, 0.52, new THREE.Vector3(2.1, 2.35, 5.125));
  mkSign(TEX.signTexture(["当心滑倒"], { bg: "#d8a012", fg: "#1c1c1c", h: 128 }),
    0.72, 0.38, new THREE.Vector3(-2.1, 2.35, 5.125));

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

  // 库内飘落霜晶
  const n = 130;
  const pos = new Float32Array(n * 3);
  const vel = [];
  for (let i = 0; i < n; i++) {
    pos[i * 3] = -4.4 + Math.random() * 8.8;
    pos[i * 3 + 1] = Math.random() * 4.2;
    pos[i * 3 + 2] = -6.8 + Math.random() * 11.5;
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
  [[-3.8, 6.2], [3.8, 6.2], [6.2, 5.95], [13.1, 5.95]].forEach(([x, z]) => {
    cyl(0.13, 1.25, bollardMat, new THREE.Vector3(x, 0.62, z));
    cyl(0.135, 0.18, stripeMat, new THREE.Vector3(x, 0.48, z));
    cyl(0.135, 0.18, stripeMat, new THREE.Vector3(x, 0.9, z));
    addCollider(x - 0.15, x + 0.15, z - 0.15, z + 0.15);
  });
  box(0.08, 0.1, 16, mats.yellowPipe, new THREE.Vector3(6.2, 0.05, 6.2), false, false);
}

// ---------------------------------------------------------------- 库门 (后端物理驱动)
const doorGroup = new THREE.Group();
let doorSlabMesh = null;
function buildDoor() {
  doorGroup.position.set(1.35, 0, 5.15);
  scene.add(doorGroup);
  const slab = new THREE.Mesh(new THREE.BoxGeometry(2.7, 3.55, 0.22),
    new THREE.MeshStandardMaterial({ map: doorT.map, roughnessMap: doorT.rough, roughness: 1.0, metalness: 0.55 }));
  slab.position.set(-1.35, 1.775, 0);
  slab.castShadow = true;
  slab.receiveShadow = true;
  slab.userData.interactive = "door";
  doorGroup.add(slab);
  doorSlabMesh = slab;

  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.18, 24),
    new THREE.MeshStandardMaterial({ color: 0x27a347, roughness: 0.4, metalness: 0.45 }));
  handle.rotation.x = Math.PI / 2;
  handle.position.set(-1.05, 0.35, 0.2);
  slab.add(handle);
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.72, 0.1), mats.steel);
  lever.position.set(-1.05, 0, 0.31);
  slab.add(lever);
  // 铰链
  [-1.3, 0, 1.3].forEach((y) => {
    const knuckle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 12), mats.darkSteel);
    knuckle.position.set(1.32, y, 0);
    slab.add(knuckle);
  });
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

const doorTarget = { q: new THREE.Quaternion(), angle: 0 };

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
  doorTarget.angle = msg.door;
  doorTarget.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), msg.door);

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
  ui.miniDoor.style.transform = `rotate(${doorTarget.angle * 57.3}deg)`;

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

function checkCrosshair() {
  raycaster.setFromCamera(CENTER, camera);
  raycaster.far = 3.4;
  const candidates = [doorSlabMesh, ...dynMeshes.filter((m) => m.visible)];
  const hits = raycaster.intersectObjects(candidates, false);
  currentTarget = null;
  if (hits.length) {
    const m = hits[0].object;
    if (m.userData.interactive === "door") currentTarget = { kind: "door", mesh: m };
    else if (m.userData.grabbable) currentTarget = { kind: "body", mesh: m };
  }
  let label = "";
  if (performance.now() < noteUntil) label = noteText;
  else if (heldName) label = "按 F 放下 · 左键投掷";
  else if (currentTarget?.kind === "door") label = Math.abs(doorTarget.angle) > 0.3 ? "按 E 关门" : "按 E 开门";
  else if (currentTarget?.kind === "body") label = "按 F 抓取";
  ui.targetLabel.textContent = label;
  ui.targetLabel.classList.toggle("active", Boolean(label));
}

document.addEventListener("keydown", (e) => {
  keys[e.code] = true;
  if (!controls.isLocked && !["Digit1", "Digit2", "Digit3", "KeyT", "KeyR"].includes(e.code)) return;
  switch (e.code) {
    case "KeyE":
      if (currentTarget?.kind === "door") send({ c: "door" });
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
  // 库门未开足时阻挡门洞
  if (Math.abs(doorTarget.angle) < 0.9 &&
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
        const inside = Math.abs(m.position.x) < 4.7 && m.position.z > -6.9 && m.position.z < 5.0;
        blob.position.set(m.position.x, inside ? 0.078 : 0.004, m.position.z);
        blob.material.opacity = THREE.MathUtils.clamp(0.55 - m.position.y * 0.16, 0.05, 0.5);
      }
    }
  }
  doorGroup.quaternion.slerp(doorTarget.q, k);

  // 门帘摆动 (幅度随开门气流增大) 与飘落霜晶
  if (curtainGroup) {
    const frac = Math.min(Math.abs(doorTarget.angle) / 1.92, 1);
    curtainGroup.children.forEach((p) => {
      p.rotation.x = Math.sin(elapsed * 1.6 + p.userData.phase) * (0.015 + frac * 0.11);
    });
  }
  if (sparkleSys) {
    for (let i = 0; i < sparkleSys.n; i++) {
      sparkleSys.pos[i * 3 + 1] -= sparkleSys.vel[i] * delta;
      sparkleSys.pos[i * 3] += Math.sin(elapsed * 0.8 + i) * 0.02 * delta;
      if (sparkleSys.pos[i * 3 + 1] < 0.12) sparkleSys.pos[i * 3 + 1] = 4.2;
    }
    sparkleSys.pts.geometry.attributes.position.needsUpdate = true;
  }

  // 蒸发器风机持续送风(仅化霜停); 冷凝器顶部风机跟随压缩机
  const evapRunning = latestTh ? latestTh.comp !== "defrost" : true;
  const compOn = latestTh ? latestTh.comp === "on" : true;
  fans.forEach((fan, index) => {
    if (index < 3 ? evapRunning : compOn) fan.rotation.z -= delta * (index < 3 ? 18 : 8);
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
      if (arr[i * 3 + 2] > 1.4 || arr[i * 3 + 1] < 1.2) {
        const fanX = [-1.7, 0, 1.7][i % 3];
        arr[i * 3] = fanX + (Math.random() - 0.5) * 0.55;
        arr[i * 3 + 1] = 2.72 + (Math.random() - 0.5) * 0.45;
        arr[i * 3 + 2] = -6.15 + Math.random() * 0.4;
      }
    }
    system.points.geometry.attributes.position.needsUpdate = true;
  });

  // 门口冷气瀑布
  if (doorMistSys) {
    const frac = Math.min(Math.abs(doorTarget.angle) / 1.92, 1);
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
  const x = THREE.MathUtils.clamp(88 + p.x * 6.2, 8, 172);
  const y = THREE.MathUtils.clamp(105 - p.z * 6.2, 8, 172);
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
  ui.start.style.display = "grid";
  ui.start.classList.add("compact");
  ui.startBtn.textContent = "继续巡检";
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
buildDoor();
[-2.75, 2.75].forEach((x) => [-4.9, -2.45].forEach((z) => addRack(x, z)));
[-1.7, 0, 1.7].forEach(addFan);
addColdMist();
addDoorMist();
addEquipment();
addSafetyDetails();
addRealismDetails();
connect();
animate();
