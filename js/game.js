// Pyramidenpfad: 3D-Darstellung, Eingabe und Spielablauf. Die Regeln stehen in pyramid.js.
import * as THREE from '../vendor/three.module.min.js';
import { LEVELS } from './levels.js';
import {
  buildLevel,
  openNeighbors,
  shortestPath,
  cellGeometry,
  segmentGeometry,
  baseWalls,
  OUT,
  halfSize,
  pyramidHeight,
} from './pyramid.js';

// ---------- Speicher (defensiv, kann fehlen) ----------
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ohne Speicher läuft das Spiel trotzdem */
    }
  },
};
const settings = { sound: true, ...store.get('pyramidenpfad-settings', {}) };
const progress = store.get('pyramidenpfad-progress', {}); // { levelId: { stars, time } }

// ---------- Ton: leise, weich, nur kurze Klänge ----------
let audio = null;
let master = null;
function ensureAudio() {
  if (audio) return;
  try {
    audio = new AudioContext();
    master = audio.createGain();
    master.gain.value = settings.sound ? 1 : 0;
    master.connect(audio.destination);
    startAmbient();
  } catch {
    audio = null;
  }
}
function startAmbient() {
  // zwei sehr leise, tiefe Töne als Klangteppich
  for (const [freq, vol] of [[98, 0.018], [147, 0.012]]) {
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.value = vol;
    o.connect(g).connect(master);
    o.start();
  }
}
function applySound() {
  if (master) master.gain.value = settings.sound ? 1 : 0;
}
function tone(freq, dur = 0.3, type = 'sine', vol = 0.05, when = 0) {
  if (!audio || !settings.sound) return;
  const t = audio.currentTime + when;
  const o = audio.createOscillator();
  const g = audio.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}
const SCALE = [262, 294, 330, 392, 440, 523, 587, 659, 784]; // Pentatonik: klingt immer harmonisch
const sfx = {
  step: (ring) => tone(SCALE[Math.min(ring, SCALE.length - 1)], 0.35, 'sine', 0.05),
  bump: () => tone(150, 0.1, 'triangle', 0.03),
  star: () => [784, 988, 1175].forEach((f, i) => tone(f, 0.4, 'sine', 0.05, i * 0.08)),
  win: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.8, 'sine', 0.06, i * 0.15)),
};

// ---------- Renderer, Himmel, Licht ----------
const canvas = document.createElement('canvas');
canvas.id = 'scene';
document.body.prepend(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const FOG = new THREE.Color('#a7727c');
scene.fog = new THREE.Fog(FOG, 70, 190);

// Himmel als Farbverlauf, Dämmerung
{
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#10143a');
  grad.addColorStop(0.45, '#3f3680');
  grad.addColorStop(0.8, '#c9808a');
  grad.addColorStop(1, '#f1b98a');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  scene.background = tex;
}

// Sterne am Himmel
{
  const n = 450;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const el = 0.12 + Math.random() * 1.3;
    const r = 170;
    pos[i * 3] = Math.cos(a) * Math.cos(el) * r;
    pos[i * 3 + 1] = Math.sin(el) * r;
    pos[i * 3 + 2] = Math.sin(a) * Math.cos(el) * r;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.8, sizeAttenuation: false, color: '#fff7e0', transparent: true, opacity: 0.85, fog: false })));
}

scene.add(new THREE.HemisphereLight('#a8b4ff', '#8a5a48', 1.15));
const sun = new THREE.DirectionalLight('#ffd7a6', 2.4);
sun.position.set(-9, 13, 15);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 60 });
sun.shadow.bias = -0.0006;
scene.add(sun);

// Boden mit weichem Lichtkegel um die Pyramide
const groundTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  grad.addColorStop(0, '#c9a6a8');
  grad.addColorStop(0.35, '#8b6f8f');
  grad.addColorStop(1, '#2f2748');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const ground = new THREE.Mesh(new THREE.CircleGeometry(80, 64), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.02;
ground.receiveShadow = true;
scene.add(ground);

// Ferne dunkle Pyramiden am Horizont
for (let i = 0; i < 4; i++) {
  const a = i * 1.7 + 0.9;
  const d = 85 + (i % 2) * 25;
  const p = new THREE.Mesh(new THREE.ConeGeometry(9 + i * 2, 12 + i * 2, 4), new THREE.MeshStandardMaterial({ color: '#5a4468', roughness: 1 }));
  p.rotation.y = Math.PI / 4;
  p.position.set(Math.cos(a) * d, 5 + i, Math.sin(a) * d);
  scene.add(p);
}

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 400);

// ---------- Pyramide und Figur ----------
const pyrGroup = new THREE.Group(); // dreht sich um die senkrechte Achse
scene.add(pyrGroup);
let levelGroup = null;

const mats = {
  body: new THREE.MeshStandardMaterial({ color: '#c99e68', roughness: 0.95 }),
  tiles: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }),
  wall: new THREE.MeshStandardMaterial({ color: '#6e4d3b', roughness: 0.9 }),
  gold: new THREE.MeshStandardMaterial({ color: '#ffd45c', emissive: '#ffa820', emissiveIntensity: 0.8, metalness: 0.5, roughness: 0.3 }),
  robe: new THREE.MeshStandardMaterial({ color: '#3a6fb0', roughness: 0.6 }),
  skin: new THREE.MeshStandardMaterial({ color: '#d29a6a', roughness: 0.7 }),
  eye: new THREE.MeshStandardMaterial({ color: '#2a1d10' }),
  lantern: new THREE.MeshBasicMaterial({ color: '#fff0b0' }),
  beam: new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
  marker: new THREE.MeshBasicMaterial({
    map: (() => {
      // weiches Leuchten statt einer harten Scheibe
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
      grad.addColorStop(0, 'rgba(255,250,220,1)');
      grad.addColorStop(0.45, 'rgba(255,236,170,0.75)');
      grad.addColorStop(0.62, 'rgba(255,236,170,0.9)');
      grad.addColorStop(0.7, 'rgba(255,236,170,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })(),
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  }),
  hit: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  hint: new THREE.MeshBasicMaterial({ color: '#8fe3ff', transparent: true, opacity: 0.9 }),
  star: new THREE.MeshStandardMaterial({ color: '#ffe27a', emissive: '#ffc030', emissiveIntensity: 0.9, roughness: 0.3 }),
};

function buildPlayer() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.28, 4, 12), mats.robe);
  body.position.y = 0.31;
  body.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), mats.skin);
  head.position.y = 0.78;
  head.castShadow = true;
  g.add(body, head);
  for (const x of [-0.055, 0.055]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 6), mats.eye);
    eye.position.set(x, 0.8, 0.125);
    g.add(eye);
  }
  const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), mats.lantern);
  lantern.position.set(0.24, 0.5, 0.05);
  g.add(lantern);
  g.userData.lantern = lantern;
  return g;
}
const player = buildPlayer();
player.scale.setScalar(1.15);

// ---------- Spielzustand ----------
const view = { yaw: 0, targetYaw: 0, pitch: 0.58, dist: 30, userDist: 1 };
let game = null; // { index, spec, lv, pos, steps, elapsed, won, visited, collected, centers, normals }
let busy = false;
let currentFace = 0;
const tweens = [];
const particles = [];
let tileData = null; // { colors, attr, base }
let markerGroup = null;
let hintGroup = null;
let hintUntil = 0;
const starMeshes = new Map();
let beam = null;

const V = (arr) => new THREE.Vector3(arr[0], arr[1], arr[2]);

function disposeGroup(group) {
  group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
  });
}

function clearLevel() {
  if (levelGroup) {
    pyrGroup.remove(levelGroup);
    disposeGroup(levelGroup);
  }
  for (const p of particles.splice(0)) scene.remove(p.mesh);
  starMeshes.clear();
  tweens.length = 0;
  busy = false;
}

function buildLevelScene(index) {
  clearLevel();
  const spec = LEVELS[index];
  const lv = buildLevel(spec);
  const { pyr } = lv;
  const K = spec.K;
  const H = pyramidHeight(K);

  levelGroup = new THREE.Group();
  pyrGroup.add(levelGroup);

  // Körper der Pyramide (Stumpf mit quadratischem Grundriss)
  const bodyGeo = new THREE.CylinderGeometry(halfSize(K, K) * Math.SQRT2, halfSize(K, 0) * Math.SQRT2, H, 4, 1, false);
  bodyGeo.rotateY(Math.PI / 4);
  bodyGeo.translate(0, H / 2, 0);
  const body = new THREE.Mesh(bodyGeo, mats.body);
  body.castShadow = true;
  body.receiveShadow = true;
  levelGroup.add(body);

  // Positionen und Normalen aller Felder
  const centers = [];
  const normals = [];
  for (let id = 0; id < pyr.nodeCount; id++) {
    const g = cellGeometry(pyr, id);
    centers.push(V(g.center));
    normals.push(V(g.normal));
  }
  centers[pyr.apex].y += 0.14; // Standfläche des Plateaus

  // Bodenplatten aller Felder in einem Netz, die Farben lassen sich einzeln ändern
  {
    const cellIds = [];
    for (let id = 0; id < pyr.nodeCount; id++) if (!pyr.nodes[id].apex) cellIds.push(id);
    const pos = new Float32Array(cellIds.length * 12);
    const nor = new Float32Array(cellIds.length * 12);
    const col = new Float32Array(cellIds.length * 12);
    const idx = [];
    const base = new Map();
    cellIds.forEach((id, i) => {
      const g = cellGeometry(pyr, id);
      const n = V(g.normal);
      const quad = g.quad.map(V);
      const c = quad.reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(0.25);
      quad.forEach((p, j) => {
        const q = c.clone().add(p.clone().sub(c).multiplyScalar(0.9)).addScaledVector(n, 0.012);
        pos.set([q.x, q.y, q.z], i * 12 + j * 3);
        nor.set([n.x, n.y, n.z], i * 12 + j * 3);
      });
      // Windung so, dass die Vorderseite nach außen zeigt (Ecken laufen von s0 nach s1, von außen gesehen im Uhrzeigersinn)
      idx.push(i * 4, i * 4 + 2, i * 4 + 1, i * 4, i * 4 + 3, i * 4 + 2);
      const t = pyr.nodes[id].ring / Math.max(1, K - 1);
      const shade = (pyr.nodes[id].u + pyr.nodes[id].f) % 2 === 0 ? 1 : 0.94;
      const color = new THREE.Color().setHSL(0.1, 0.45, (0.66 + 0.1 * t) * shade);
      base.set(id, { i, color });
      for (let j = 0; j < 4; j++) col.set([color.r, color.g, color.b], i * 12 + j * 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    const colorAttr = new THREE.BufferAttribute(col, 3);
    geo.setAttribute('color', colorAttr);
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, mats.tiles);
    mesh.receiveShadow = true;
    levelGroup.add(mesh);
    tileData = { colors: col, attr: colorAttr, base };
  }

  // Goldenes Plateau und Lichtsäule an der Spitze
  {
    const plat = new THREE.Mesh(new THREE.BoxGeometry(2, 0.14, 2), mats.gold);
    plat.position.set(0, H + 0.07, 0);
    plat.castShadow = true;
    levelGroup.add(plat);
    beam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.0, 10, 28, 1, true), mats.beam);
    beam.position.set(0, H + 5.2, 0);
    levelGroup.add(beam);
  }

  // Mauern an allen geschlossenen Rändern und rund um den Fuß
  {
    const segs = [];
    pyr.edges.forEach((e, i) => {
      if (!lv.open[i]) segs.push({ ...segmentGeometry(pyr, e.seg), h: 0.34 });
    });
    for (const w of baseWalls(pyr)) segs.push({ ...w, h: 0.5 });

    const T = 0.12;
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mats.wall, segs.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const basis = new THREE.Matrix4();
    const color = new THREE.Color();
    segs.forEach((s, i) => {
      const p0 = V(s.p0);
      const p1 = V(s.p1);
      const n = V(s.normal);
      const along = p1.clone().sub(p0);
      const len = along.length();
      const ex = along.normalize();
      const ey = n.clone().sub(ex.clone().multiplyScalar(n.dot(ex))).normalize();
      const ez = new THREE.Vector3().crossVectors(ex, ey);
      basis.makeBasis(ex, ey, ez);
      q.setFromRotationMatrix(basis);
      const center = p0.clone().add(p1).multiplyScalar(0.5).addScaledVector(n, s.h / 2 + 0.01);
      m.compose(center, q, new THREE.Vector3(len + T * 0.9, s.h, T));
      inst.setMatrixAt(i, m);
      inst.setColorAt(i, color.setScalar(0.88 + ((i * 37) % 13) / 60));
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = true;
    inst.receiveShadow = true;
    levelGroup.add(inst);
  }

  // Sterne in Sackgassen
  for (const id of lv.stars) {
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), mats.star);
    star.position.copy(centers[id]).addScaledVector(normals[id], 0.55);
    star.castShadow = true;
    levelGroup.add(star);
    starMeshes.set(id, star);
  }

  // Start markieren
  {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.42, 28), new THREE.MeshBasicMaterial({ color: '#9ff0c0', side: THREE.DoubleSide, transparent: true, opacity: 0.8 }));
    ring.position.copy(centers[lv.start]).addScaledVector(normals[lv.start], 0.03);
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normals[lv.start]);
    levelGroup.add(ring);
  }

  markerGroup = new THREE.Group();
  hintGroup = new THREE.Group();
  levelGroup.add(markerGroup, hintGroup);
  levelGroup.add(player);

  game = {
    index,
    spec,
    lv,
    pos: lv.start,
    steps: 0,
    elapsed: 0,
    won: false,
    visited: new Set([lv.start]),
    collected: new Set(),
    centers,
    normals,
  };
  hintUntil = 0;

  // Figur auf den Start stellen, mit Blick bergauf
  const n = normals[lv.start];
  const f = slopeForward(n);
  orientPlayer(n, f);
  player.position.copy(centers[lv.start]);
  playerForward = f;

  // Ansicht: die Seite des Starts zeigt zur Kamera
  currentFace = pyr.nodes[lv.start].f;
  view.yaw = view.targetYaw = faceYaw(currentFace, 0);
  pyrGroup.rotation.y = view.yaw;
  fitCamera();
  tintVisited(lv.start);
  rebuildMarkers();
  updateHud();
}

// ---------- Figur ausrichten ----------
let playerForward = new THREE.Vector3(0, 0, 1);

// „Bergauf“ als Vorwärtsrichtung auf einer Fläche mit Normale n
function slopeForward(n) {
  const up = new THREE.Vector3(0, 1, 0);
  const f = up.clone().sub(n.clone().multiplyScalar(up.dot(n)));
  return f.lengthSq() < 1e-6 ? new THREE.Vector3(0, 0, 1) : f.normalize();
}

// Die Figur steht fast senkrecht (wie in der Welt), nur leicht zum Hang geneigt
function orientPlayer(n, forward) {
  const y = new THREE.Vector3(0, 1, 0).multiplyScalar(0.78).add(n.clone().multiplyScalar(0.22)).normalize();
  const z = forward.clone().sub(y.clone().multiplyScalar(forward.dot(y))).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  player.quaternion.setFromRotationMatrix(m);
}

// ---------- Kamera ----------
const FOV = 45;
function fitCamera() {
  if (!game) return;
  const K = game.spec.K;
  const A = K + 1;
  const aspect = window.innerWidth / window.innerHeight;
  const halfV = (FOV / 2) * (Math.PI / 180);
  const halfH = Math.atan(Math.tan(halfV) * aspect);
  const R = A * 1.42; // Umkreis des Fußes, damit es in jeder Drehung passt
  view.dist = (R / Math.sin(Math.min(halfV, halfH))) * 1.02 * view.userDist;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
}

function updateCamera() {
  const H = game ? pyramidHeight(game.spec.K) : 4;
  const ty = H * 0.42;
  camera.position.set(0, ty + view.dist * Math.sin(view.pitch), view.dist * Math.cos(view.pitch));
  camera.lookAt(0, ty, 0);
}

// Winkel, bei dem Seite f zur Kamera zeigt (nächstgelegene Entsprechung zu `around`)
// Die Ansicht ist leicht schräg (VIEW_OFFSET), damit man zwei Seiten sieht und die Form erkennt
const VIEW_OFFSET = 0.42;
function faceYaw(f, around) {
  const base = Math.atan2(-OUT[f][0], OUT[f][1]) + VIEW_OFFSET;
  const k = Math.round((around - base) / (Math.PI * 2));
  return base + k * Math.PI * 2;
}

function turnView(quarter) {
  const q = Math.PI / 2;
  view.targetYaw = Math.round((view.targetYaw - VIEW_OFFSET) / q) * q + VIEW_OFFSET + q * quarter;
}

// ---------- Anzeige der Felder ----------
function tintVisited(id) {
  const info = tileData.base.get(id);
  if (!info) return;
  const c = info.color.clone().lerp(new THREE.Color('#9ed8ee'), 0.55);
  for (let j = 0; j < 4; j++) tileData.colors.set([c.r, c.g, c.b], info.i * 12 + j * 3);
  tileData.attr.needsUpdate = true;
}

function clearMarkers() {
  for (const c of [...markerGroup.children]) {
    markerGroup.remove(c);
    c.geometry.dispose();
  }
}

function rebuildMarkers() {
  clearMarkers();
  const { lv, centers, normals } = game;
  for (const n of openNeighbors(lv, game.pos)) {
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.95), mats.marker);
    disc.position.copy(centers[n]).addScaledVector(normals[n], 0.04);
    disc.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normals[n]);
    disc.userData.pulse = true;
    markerGroup.add(disc);
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), mats.hit);
    hit.position.copy(centers[n]).addScaledVector(normals[n], 0.2);
    hit.userData.node = n;
    markerGroup.add(hit);
  }
  rebuildHint();
}

function rebuildHint() {
  for (const c of [...hintGroup.children]) {
    hintGroup.remove(c);
    c.geometry.dispose();
  }
  if (performance.now() > hintUntil || !game || game.won) return;
  const path = shortestPath(game.lv, game.pos, game.lv.apex) ?? [];
  for (const id of path.slice(1, 9)) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), mats.hint);
    dot.position.copy(game.centers[id]).addScaledVector(game.normals[id], 0.12);
    hintGroup.add(dot);
  }
}

// ---------- Bewegung ----------
function tween(duration, onUpdate, onDone) {
  tweens.push({ t0: performance.now(), duration, onUpdate, onDone });
}

function nodeFace(id) {
  const n = game.lv.pyr.nodes[id];
  return n.apex ? -1 : n.f;
}

function moveTo(node) {
  if (!game || busy || game.won) return false;
  if (!openNeighbors(game.lv, game.pos).includes(node)) {
    sfx.bump();
    return false;
  }
  const from = game.pos;
  const a = game.centers[from].clone();
  const b = game.centers[node].clone();
  const na = game.normals[from];
  const nb = game.normals[node];
  const dir = b.clone().sub(a);
  game.pos = node;
  game.steps++;
  busy = true;
  sfx.step(game.lv.pyr.nodes[node].ring);

  const startForward = playerForward.clone();
  const n = na.clone().add(nb).normalize();
  let target = dir.clone().sub(n.clone().multiplyScalar(dir.dot(n)));
  target = target.lengthSq() < 1e-6 ? startForward : target.normalize();
  playerForward = target;

  for (const c of markerGroup.children) c.visible = false;
  tween(
    0.28,
    (e) => {
      player.position.lerpVectors(a, b, e).addScaledVector(n, Math.sin(e * Math.PI) * 0.16);
      const nn = na.clone().lerp(nb, e).normalize();
      const ff = startForward.clone().lerp(target, Math.min(1, e * 2));
      orientPlayer(nn, ff);
    },
    () => {
      player.position.copy(b);
      orientPlayer(nb, target);
      busy = false;
      arrive(node);
    },
  );
  updateHud();
  return true;
}

function arrive(node) {
  const { lv } = game;
  game.visited.add(node);
  tintVisited(node);

  if (lv.stars.includes(node) && !game.collected.has(node)) {
    game.collected.add(node);
    const star = starMeshes.get(node);
    if (star) star.visible = false;
    sfx.star();
    toast(`Stern gefunden: ${game.collected.size} von ${lv.stars.length}`);
  }

  // Die Ansicht folgt der Figur auf die nächste Seite, die Pyramide dreht sich dabei
  const f = nodeFace(node);
  if (f >= 0 && f !== currentFace) {
    currentFace = f;
    view.targetYaw = faceYaw(f, view.targetYaw);
  }

  if (node === lv.apex) {
    clearMarkers();
    win();
  } else {
    rebuildMarkers();
  }
  updateHud();
}

// Bildschirmrichtung -> Nachbarfeld, das in diese Richtung liegt
function pickByDirection(dx, dy) {
  if (!game) return -1;
  pyrGroup.updateMatrixWorld(true);
  const aspect = window.innerWidth / window.innerHeight;
  const proj = (id) => {
    const v = game.centers[id].clone();
    pyrGroup.localToWorld(v);
    v.project(camera);
    return [v.x * aspect, v.y];
  };
  const p0 = proj(game.pos);
  let best = -1;
  let bestScore = 0.5;
  for (const n of openNeighbors(game.lv, game.pos)) {
    const p = proj(n);
    const vx = p[0] - p0[0];
    const vy = p[1] - p0[1];
    const len = Math.hypot(vx, vy) || 1;
    const score = (vx * dx + vy * dy) / len;
    if (score > bestScore) {
      bestScore = score;
      best = n;
    }
  }
  return best;
}

function stepDirection(dx, dy) {
  const n = pickByDirection(dx, dy);
  if (n < 0) {
    sfx.bump();
    toast('Dort geht es nicht weiter. Tippe auf ein leuchtendes Feld.');
    return;
  }
  moveTo(n);
}

// ---------- Gewinn ----------
function win() {
  game.won = true;
  sfx.win();
  const origin = game.centers[game.lv.apex].clone();
  pyrGroup.localToWorld(origin);
  for (let i = 0; i < 80; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), new THREE.MeshBasicMaterial({ color: ['#ffd45c', '#fff3d6', '#ff9ac0', '#9fd8ff'][i % 4] }));
    m.position.copy(origin);
    scene.add(m);
    particles.push({ mesh: m, v: new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 4 + 1.5, (Math.random() - 0.5) * 4), life: 0 });
  }
  const stars = game.collected.size;
  const prev = progress[game.spec.id];
  if (!prev || stars > prev.stars || (stars === prev.stars && game.elapsed < prev.time)) {
    progress[game.spec.id] = { stars, time: Math.round(game.elapsed) };
    store.set('pyramidenpfad-progress', progress);
  }
  setTimeout(() => {
    if (game && game.won) showWin();
  }, 1800);
}

// ---------- Oberfläche ----------
const $ = (id) => document.getElementById(id);
const hud = $('hud');
const overlays = { start: $('start'), menu: $('menu'), win: $('win') };

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function updateHud() {
  if (!game) return;
  const total = game.lv.stars.length;
  $('level-title').textContent = `${game.index + 1}. ${game.spec.name}`;
  $('stats').textContent = `Zeit ${fmt(game.elapsed)} · Schritte ${game.steps} · ★ ${game.collected.size}/${total}`;
  const frac = Math.min(1, game.elapsed / game.spec.target);
  $('timebar-fill').style.width = `${frac * 100}%`;
  $('timenote').textContent = game.elapsed < game.spec.target ? `Richtzeit ${fmt(game.spec.target)}, nur zur Orientierung` : 'Kein Limit. Nimm dir alle Zeit.';
}

let toastTimer = null;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

function showOnly(name) {
  for (const key of Object.keys(overlays)) overlays[key].classList.toggle('hidden', key !== name);
  hud.classList.toggle('hidden', name !== null);
}

function openStart() {
  const list = $('levels');
  list.innerHTML = '';
  LEVELS.forEach((spec, i) => {
    const b = document.createElement('button');
    const p = progress[spec.id];
    const meta = p ? `✓ ★${p.stars}/3 · ${fmt(p.time)}` : `${spec.K} Ringe`;
    b.innerHTML = `<span>${i + 1}. ${spec.name}</span><span class="meta">${meta}</span>`;
    b.addEventListener('click', () => startLevel(i));
    list.appendChild(b);
  });
  showOnly('start');
}

function startLevel(index) {
  ensureAudio();
  buildLevelScene(index);
  showOnly(null);
}

function showWin() {
  const total = game.lv.stars.length;
  const stars = game.collected.size;
  $('win-stats').textContent =
    `Gelöst in ${fmt(game.elapsed)} mit ${game.steps} Schritten. Sterne: ${stars} von ${total}.` +
    (stars < total ? ' Die übrigen Sterne liegen in Sackgassen. Du kannst sie später noch suchen.' : ' Alle Sterne gefunden.');
  $('win-next').classList.toggle('hidden', game.index + 1 >= LEVELS.length);
  showOnly('win');
}

function openMenu() {
  if (!game) return;
  refreshSound();
  showOnly('menu');
}

function refreshSound() {
  for (const id of ['start-sound', 'menu-sound']) {
    $(id).textContent = settings.sound ? 'an' : 'aus';
    $(id).setAttribute('aria-pressed', String(settings.sound));
  }
}

function toggleSound() {
  settings.sound = !settings.sound;
  store.set('pyramidenpfad-settings', settings);
  ensureAudio();
  applySound();
  refreshSound();
}

function showHint() {
  if (!game || game.won) return;
  hintUntil = performance.now() + 7000;
  rebuildHint();
  toast('Die blauen Punkte zeigen ein Stück des Weges nach oben.');
}

// ---------- Eingabe ----------
const KEYS = {
  arrowup: [0, 1], w: [0, 1],
  arrowdown: [0, -1], s: [0, -1],
  arrowleft: [-1, 0], a: [-1, 0],
  arrowright: [1, 0], d: [1, 0],
};

const isPlaying = () => game && !hud.classList.contains('hidden');

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'escape') {
    if (!overlays.menu.classList.contains('hidden')) showOnly(null);
    else if (isPlaying()) openMenu();
    return;
  }
  if (!isPlaying()) return;
  if (KEYS[k]) {
    e.preventDefault();
    if (!busy && !game.won) stepDirection(...KEYS[k]);
  } else if (k === 'q') turnView(-1);
  else if (k === 'e') turnView(1);
  else if (k === 'h') showHint();
});

$('turn-left').addEventListener('click', () => turnView(-1));
$('turn-right').addEventListener('click', () => turnView(1));
$('hint-btn').addEventListener('click', showHint);
$('menu-btn').addEventListener('click', openMenu);
$('menu-resume').addEventListener('click', () => showOnly(null));
$('menu-restart').addEventListener('click', () => startLevel(game.index));
$('menu-select').addEventListener('click', openStart);
$('menu-sound').addEventListener('click', toggleSound);
$('start-sound').addEventListener('click', toggleSound);
$('win-next').addEventListener('click', () => startLevel(game.index + 1));
$('win-select').addEventListener('click', openStart);
$('win-again').addEventListener('click', () => startLevel(game.index));

// Ziehen dreht die Pyramide, ein kurzes Tippen auf ein leuchtendes Feld bewegt die Figur
let pointer = null;
const raycaster = new THREE.Raycaster();
canvas.addEventListener('pointerdown', (e) => {
  pointer = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, id: e.pointerId };
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* nicht kritisch */
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (!pointer) return;
  if (!pointer.moved && Math.hypot(e.clientX - pointer.sx, e.clientY - pointer.sy) > 8) pointer.moved = true;
  if (!pointer.moved) return;
  view.yaw -= (e.clientX - pointer.x) * 0.008;
  view.targetYaw = view.yaw;
  view.pitch = Math.min(1.2, Math.max(0.3, view.pitch + (e.clientY - pointer.y) * 0.004));
  pointer.x = e.clientX;
  pointer.y = e.clientY;
});
canvas.addEventListener('pointerup', (e) => {
  const p = pointer;
  pointer = null;
  if (!p || p.moved || !isPlaying() || busy || game.won) return;
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  pyrGroup.updateMatrixWorld(true);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(markerGroup.children.filter((c) => c.userData.node !== undefined), false);
  if (hits.length) moveTo(hits[0].object.userData.node);
});
canvas.addEventListener('pointercancel', () => {
  pointer = null;
});
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    view.userDist = Math.min(1.3, Math.max(0.6, view.userDist + e.deltaY * 0.0008));
    fitCamera();
  },
  { passive: false },
);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  fitCamera();
});

// ---------- Schleife ----------
let last = performance.now();
function frame(now) {
  const real = Math.min(1, (now - last) / 1000); // echte Zeit, auch bei langsamen Geräten
  const dt = Math.min(0.05, real); // Bewegungen bleiben bei Rucklern stabil
  last = now;

  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    const t = Math.min(1, (now - tw.t0) / (tw.duration * 1000));
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    tw.onUpdate(eased);
    if (t >= 1) {
      tweens.splice(i, 1);
      tw.onDone();
    }
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life += dt;
    p.v.y -= 6 * dt;
    p.mesh.position.addScaledVector(p.v, dt);
    if (p.life > 2.6) {
      scene.remove(p.mesh);
      particles.splice(i, 1);
    }
  }

  // Pyramide sanft zur Zielrichtung drehen
  view.yaw += (view.targetYaw - view.yaw) * (1 - Math.exp(-dt * 5));
  pyrGroup.rotation.y = view.yaw;

  if (game) {
    if (isPlaying() && !game.won) {
      const before = Math.floor(game.elapsed);
      game.elapsed += real;
      if (Math.floor(game.elapsed) !== before) updateHud();
    }
    const pulse = 0.5 + 0.5 * Math.sin(now / 450);
    mats.marker.opacity = 0.55 + 0.4 * pulse;
    mats.gold.emissiveIntensity = game.won ? 1.5 : 0.7 + 0.3 * pulse;
    mats.beam.opacity = game.won ? 0.3 : 0.07 + 0.04 * pulse;
    for (const s of starMeshes.values()) {
      s.rotation.y += dt * 1.5;
      s.position.y += Math.sin(now / 400 + s.id) * 0.0015;
    }
    if (hintUntil && now > hintUntil) {
      hintUntil = 0;
      rebuildHint();
    }
    if (game.won) view.targetYaw += dt * 0.15;
    for (const c of markerGroup.children) if (!busy) c.visible = true;
  }

  updateCamera();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

refreshSound();
openStart();
requestAnimationFrame(frame);

// Schnittstelle für automatische Tests im Browser
window.__pyr = {
  get state() {
    return game
      ? { pos: game.pos, steps: game.steps, won: game.won, index: game.index, stars: game.collected.size, face: currentFace, yaw: view.yaw, targetYaw: view.targetYaw }
      : null;
  },
  start: (i) => startLevel(i),
  busy: () => busy,
  solution: () => [...game.lv.solution],
  neighbors: () => openNeighbors(game.lv, game.pos),
  moveTo: (n) => moveTo(n),
  pick: (dx, dy) => pickByDirection(dx, dy),
  stars: () => [...game.lv.stars],
  screenOf(id) {
    pyrGroup.updateMatrixWorld(true);
    const v = game.centers[id].clone().addScaledVector(game.normals[id], 0.2);
    pyrGroup.localToWorld(v);
    v.project(camera);
    const r = canvas.getBoundingClientRect();
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height, v.z];
  },
  playerWorld() {
    pyrGroup.updateMatrixWorld(true);
    return player.getWorldPosition(new THREE.Vector3()).toArray();
  },
  centerWorld(id) {
    pyrGroup.updateMatrixWorld(true);
    return pyrGroup.localToWorld(game.centers[id].clone()).toArray();
  },
};
