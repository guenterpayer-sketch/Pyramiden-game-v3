// Lichtpyramide: 3D-Darstellung, Eingabe und Spielablauf. Die Regeln stehen in board.js.
import * as THREE from '../vendor/three.module.min.js';
import { LEVELS } from './levels.js';
import { N, trace, cellFrame, apexPoint, pyramidHeight, A_BASE, A_TOP, OUT, apexId, cellId } from './board.js';

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
const settings = { sound: true, ...store.get('lichtpyramide-settings', {}) };
const progress = store.get('lichtpyramide-progress', {}); // { levelId: { moves, time } }

// ---------- Ton: leise, weich, kurze Klänge ----------
let audio = null;
let master = null;
function ensureAudio() {
  if (audio) return;
  try {
    audio = new AudioContext();
    master = audio.createGain();
    master.gain.value = settings.sound ? 1 : 0;
    master.connect(audio.destination);
    for (const [freq, vol] of [[110, 0.016], [165, 0.011], [220, 0.006]]) {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.value = vol;
      o.connect(g).connect(master);
      o.start();
    }
  } catch {
    audio = null;
  }
}
function tone(freq, dur = 0.4, type = 'sine', vol = 0.05, when = 0) {
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
const SCALE = [330, 392, 440, 523, 587, 659, 784, 880]; // Pentatonik, klingt immer harmonisch
const sfx = {
  flip: (ring) => {
    tone(SCALE[Math.min(ring, SCALE.length - 1)], 0.5, 'sine', 0.05);
    tone(SCALE[Math.min(ring, SCALE.length - 1)] * 1.5, 0.4, 'triangle', 0.02, 0.04);
  },
  bump: () => tone(160, 0.12, 'triangle', 0.03),
  crystal: () => [880, 1175, 1568].forEach((f, i) => tone(f, 0.5, 'sine', 0.04, i * 0.07)),
  win: () => [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, 0.9, 'sine', 0.06, i * 0.14)),
};

// ---------- Renderer und Himmel ----------
const canvas = document.createElement('canvas');
canvas.id = 'scene';
document.body.prepend(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#0c1030', 38, 95);
{
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#05061a');
  grad.addColorStop(0.5, '#141a4a');
  grad.addColorStop(0.85, '#2c2a6a');
  grad.addColorStop(1, '#3d3a86');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  scene.background = tex;
}

// Funkelnde Sterne und treibende Lichtpunkte
function makePoints(count, radius, size, color, opacity, yMin = -0.2) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const el = Math.asin(yMin + Math.random() * (1 - yMin));
    const r = radius * (0.6 + Math.random() * 0.4);
    pos[i * 3] = Math.cos(a) * Math.cos(el) * r;
    pos[i * 3 + 1] = Math.sin(el) * r;
    pos[i * 3 + 2] = Math.sin(a) * Math.cos(el) * r;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({ size, sizeAttenuation: false, color, transparent: true, opacity, fog: false, depthWrite: false }));
}
const farStars = makePoints(500, 120, 1.7, '#cfd8ff', 0.8);
scene.add(farStars);
const motes = makePoints(90, 16, 2.4, '#8fe8ff', 0.45, -0.5);
scene.add(motes);

// Weicher Lichtfleck unter der Pyramide
{
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 4, 128, 128, 128);
  grad.addColorStop(0, 'rgba(120,200,255,0.55)');
  grad.addColorStop(0.5, 'rgba(110,90,230,0.22)');
  grad.addColorStop(1, 'rgba(60,40,160,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(34, 34), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = -0.4;
  scene.add(pool);
}

scene.add(new THREE.HemisphereLight('#7f9bff', '#2a1850', 1.05));
const key = new THREE.DirectionalLight('#cfe2ff', 1.6);
key.position.set(-6, 14, 12);
scene.add(key);
const rim = new THREE.DirectionalLight('#b58cff', 1.1);
rim.position.set(10, 6, -10);
scene.add(rim);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 300);

// ---------- Materialien ----------
const SIM_LIT = new THREE.Color(1.9, 1.35, 0.55); // über 1: leuchtet heller als Weiß
const mats = {
  body: new THREE.MeshStandardMaterial({ color: '#2a3580', emissive: '#10163f', emissiveIntensity: 0.6, roughness: 0.35, metalness: 0.5 }),
  tiles: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.2, side: THREE.DoubleSide }),
  glass: new THREE.MeshStandardMaterial({ color: '#9fefff', emissive: '#27b7e0', emissiveIntensity: 0.75, transparent: true, opacity: 0.82, roughness: 0.12, metalness: 0.2 }),
  glassFixed: new THREE.MeshStandardMaterial({ color: '#c9b8ff', emissive: '#6a4fd0', emissiveIntensity: 0.55, transparent: true, opacity: 0.85, roughness: 0.2, metalness: 0.4 }),
  prism: new THREE.MeshStandardMaterial({ color: '#ffd89a', emissive: '#e88a22', emissiveIntensity: 0.8, transparent: true, opacity: 0.88, roughness: 0.15, metalness: 0.3 }),
  base: new THREE.MeshStandardMaterial({ color: '#10163a', roughness: 0.7, metalness: 0.2 }),
  block: new THREE.MeshStandardMaterial({ color: '#2a1f5a', emissive: '#150f33', emissiveIntensity: 0.6, roughness: 0.25, metalness: 0.65 }),
  crystalOff: new THREE.MeshStandardMaterial({ color: '#c04c9a', emissive: '#7a1f66', emissiveIntensity: 0.35, roughness: 0.2, metalness: 0.3 }),
  emitter: new THREE.MeshBasicMaterial({ color: '#fff4c8' }),
  gold: new THREE.MeshStandardMaterial({ color: '#5a5496', emissive: '#ffb23a', emissiveIntensity: 0, metalness: 0.6, roughness: 0.3 }),
  beamCore: new THREE.MeshBasicMaterial({ color: '#fff7d6', transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending }),
  beamGlow: new THREE.MeshBasicMaterial({ color: '#ffc45a', transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending }),
  pulse: new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }),
  hit: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  hint: new THREE.MeshBasicMaterial({ color: '#8fe3ff', transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
  column: new THREE.MeshBasicMaterial({ color: '#ffe4a0', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
  edge: new THREE.LineBasicMaterial({ color: '#9fe9ff', transparent: true, opacity: 0.9 }),
};

// ---------- Spielzustand ----------
const view = { yaw: 0, targetYaw: 0, pitch: 0.52, dist: 30, userDist: 1 };
const pyrGroup = new THREE.Group();
scene.add(pyrGroup);
let levelGroup = null;
let game = null;
const tweens = [];
const particles = [];
let beamState = null; // { trace, depthOf(Map cell->depth), reveal, segMeshes }
const MAX_SEG = 600;

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const lerpV = (a, b, t) => a.clone().lerp(b, t);

function disposeGroup(g) {
  g.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
  });
}

function clearLevel() {
  if (levelGroup) {
    pyrGroup.remove(levelGroup);
    disposeGroup(levelGroup);
  }
  for (const p of particles.splice(0)) scene.remove(p.mesh);
  tweens.length = 0;
  beamState = null;
}

// ---------- Aufbau eines Rätsels ----------
function buildLevelScene(index) {
  clearLevel();
  const spec = LEVELS[index];
  const K = spec.K;
  const H = pyramidHeight(K);
  levelGroup = new THREE.Group();
  pyrGroup.add(levelGroup);

  // Frames aller Felder
  const frames = [];
  for (let k = 0; k < K; k++) {
    frames.push([]);
    for (let i = 0; i < N; i++) {
      const f = cellFrame(K, k, i);
      frames[k].push({
        ...f,
        center: V(f.center),
        n: V(f.n),
        eR: V(f.eR),
        eU: V(f.eU),
        LL: V(f.LL),
        LR: V(f.LR),
        UL: V(f.UL),
        UR: V(f.UR),
      });
    }
  }
  const apex = V(apexPoint(K));
  const centerOf = (id) => {
    if (id === apexId(K)) return apex.clone().add(new THREE.Vector3(0, 0.1, 0));
    const f = frames[Math.floor(id / N)][id % N];
    return f.center.clone().addScaledVector(f.n, 0.2);
  };

  // Körper (Stumpf) und Kanten
  const bodyGeo = new THREE.CylinderGeometry(A_TOP * Math.SQRT2, A_BASE * Math.SQRT2, H, 4, 1, false);
  bodyGeo.rotateY(Math.PI / 4);
  bodyGeo.translate(0, H / 2, 0);
  levelGroup.add(new THREE.Mesh(bodyGeo, mats.body));
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(bodyGeo, 20), mats.edge);
  levelGroup.add(edges);

  // Bodenplatten: ein Netz, Farben einzeln veränderbar
  const cellCount = K * N;
  const pos = new Float32Array(cellCount * 12);
  const nor = new Float32Array(cellCount * 12);
  const col = new Float32Array(cellCount * 12);
  const idx = [];
  const baseColors = [];
  for (let k = 0; k < K; k++) {
    for (let i = 0; i < N; i++) {
      const c = k * N + i;
      const f = frames[k][i];
      const mid = f.LL.clone().add(f.LR).add(f.UL).add(f.UR).multiplyScalar(0.25);
      [f.LL, f.LR, f.UR, f.UL].forEach((p, j) => {
        const q = mid.clone().add(p.clone().sub(mid).multiplyScalar(0.92)).addScaledVector(f.n, 0.01);
        pos.set([q.x, q.y, q.z], c * 12 + j * 3);
        nor.set([f.n.x, f.n.y, f.n.z], c * 12 + j * 3);
      });
      idx.push(c * 4, c * 4 + 1, c * 4 + 2, c * 4, c * 4 + 2, c * 4 + 3);
      const shade = (i + k) % 2 === 0 ? 1 : 0.82;
      const color = new THREE.Color().setHSL(0.64 + 0.012 * k, 0.5, 0.2 * shade + 0.015 * k);
      baseColors.push(color);
      for (let j = 0; j < 4; j++) col.set([color.r, color.g, color.b], c * 12 + j * 3);
    }
  }
  const tileGeo = new THREE.BufferGeometry();
  tileGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  tileGeo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  const colorAttr = new THREE.BufferAttribute(col, 3);
  tileGeo.setAttribute('color', colorAttr);
  tileGeo.setIndex(idx);
  levelGroup.add(new THREE.Mesh(tileGeo, mats.tiles));
  const tiles = { col, attr: colorAttr, base: baseColors };

  // Gipfel
  const platform = new THREE.Mesh(new THREE.BoxGeometry(A_TOP * 2, 0.16, A_TOP * 2), mats.gold.clone());
  platform.position.set(0, H + 0.06, 0);
  levelGroup.add(platform);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.1, 12, 24, 1, true), mats.column.clone());
  column.position.set(0, H + 6.2, 0);
  levelGroup.add(column);

  // Bauteile
  const comps = spec.comps.map((c) => ({ ...c }));
  const orient = comps.map((c) => c.o ?? 0);
  const objs = []; // pro Bauteil: { mesh, frame, anim, target, ... }
  const hitGroup = new THREE.Group();
  levelGroup.add(hitGroup);

  comps.forEach((c, ci) => {
    const f = frames[c.k][c.i];
    const size = Math.min(f.width, f.height);
    const o = { comp: c, frame: f, size, a: orient[ci], target: orient[ci] };
    if (c.t === 'M' || c.t === 'F' || c.t === 'S') {
      const mat = c.t === 'M' ? mats.glass : c.t === 'F' ? mats.glassFixed : mats.prism;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
      o.slab = slab;
      o.h = size * 0.85;
      o.fixedO = c.o;
      levelGroup.add(slab);
      if (c.t === 'F') {
        // Sockel zeigt: dieser Spiegel ist fest
        const plate = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mats.base);
        const m = new THREE.Matrix4().makeBasis(f.eR, f.n, f.eU.clone().negate());
        plate.quaternion.setFromRotationMatrix(m);
        plate.scale.set(f.width * 0.78, 0.08, f.height * 0.78);
        plate.position.copy(f.center).addScaledVector(f.n, 0.04);
        levelGroup.add(plate);
      }
      if (c.t === 'S') {
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(size * 0.18), mats.prism);
        gem.position.copy(f.center).addScaledVector(f.n, o.h + size * 0.12);
        o.gem = gem;
        levelGroup.add(gem);
      }
      // Unsichtbare Trefferfläche, damit man auch am Handy gut trifft (feste Spiegel melden sich ebenfalls)
      const hit = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), mats.hit);
      hit.scale.setScalar(Math.max(0.55, size * 0.62));
      hit.position.copy(f.center).addScaledVector(f.n, o.h * 0.5);
      hit.userData.comp = ci;
      hitGroup.add(hit);
      updateSlab(o, o.a);
    } else if (c.t === 'B') {
      const block = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mats.block);
      const m = new THREE.Matrix4().makeBasis(f.eR, f.n, f.eU.clone().negate());
      block.quaternion.setFromRotationMatrix(m);
      block.scale.set(f.width * 0.7, size * 0.62, f.height * 0.7);
      block.position.copy(f.center).addScaledVector(f.n, size * 0.31);
      levelGroup.add(block);
    } else if (c.t === 'C') {
      const mat = mats.crystalOff.clone();
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(size * 0.32), mat);
      gem.scale.set(1, 1.5, 1);
      gem.position.copy(f.center).addScaledVector(f.n, size * 0.5);
      levelGroup.add(gem);
      o.gem = gem;
      o.mat = mat;
      o.base = gem.position.clone();
      o.lit = 0;
    }
    objs.push(o);
  });

  // Sender: leuchtende Kugel mit Pfeil in Strahlrichtung
  {
    const f = frames[spec.emitter.k][spec.emitter.i];
    const orb = new THREE.Mesh(new THREE.SphereGeometry(Math.min(f.width, f.height) * 0.17, 18, 14), mats.emitter);
    orb.position.copy(f.center).addScaledVector(f.n, 0.3);
    levelGroup.add(orb);
    const dirVec = [f.eU, f.eR, f.eU.clone().negate(), f.eR.clone().negate()][spec.emitter.dir];
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.34, 14), mats.emitter);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirVec);
    cone.position.copy(orb.position).addScaledVector(dirVec, Math.min(f.width, f.height) * 0.36);
    levelGroup.add(cone);
    const halo = new THREE.Mesh(new THREE.SphereGeometry(Math.min(f.width, f.height) * 0.28, 14, 10), mats.beamGlow);
    halo.position.copy(orb.position);
    levelGroup.add(halo);
  }

  // Strahl: Zylinder zwischen den Feldmitten, Knotenkugeln und wandernde Lichtpunkte
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
  const sph = new THREE.SphereGeometry(1, 8, 6);
  const core = new THREE.InstancedMesh(cyl, mats.beamCore, MAX_SEG);
  const glow = new THREE.InstancedMesh(cyl, mats.beamGlow, MAX_SEG);
  const joints = new THREE.InstancedMesh(sph, mats.beamCore, MAX_SEG);
  const jointGlow = new THREE.InstancedMesh(sph, mats.beamGlow, MAX_SEG);
  const pulses = new THREE.InstancedMesh(sph, mats.pulse, MAX_SEG);
  for (const m of [core, glow, joints, jointGlow, pulses]) {
    m.count = 0;
    m.frustumCulled = false;
    levelGroup.add(m);
  }

  const hintRing = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.7, 32), mats.hint);
  hintRing.visible = false;
  levelGroup.add(hintRing);

  game = {
    index,
    spec,
    K,
    H,
    comps,
    orient,
    objs,
    frames,
    centerOf,
    tiles,
    platform,
    column,
    hitGroup,
    hintRing,
    beam: { core, glow, joints, jointGlow, pulses },
    moves: 0,
    elapsed: 0,
    won: false,
    solved: false,
    litCrystalCount: 0,
    hintUntil: 0,
    hintComp: -1,
  };

  // Ansicht: die Seite des Senders zeigt zur Kamera
  const f0 = frames[spec.emitter.k][spec.emitter.i];
  view.yaw = view.targetYaw = faceYaw(f0.f, 0);
  pyrGroup.rotation.y = view.yaw;
  fitCamera();
  retrace();
  updateHud();
}

// Position und Lage eines Spiegels aus seiner (animierten) Stellung a (0 = '/', 1 = '\')
function updateSlab(o, a) {
  const f = o.frame;
  const p0 = lerpV(f.LL, f.LR, a);
  const p1 = lerpV(f.UR, f.UL, a);
  const mid = p0.clone().add(p1).multiplyScalar(0.5);
  const along = p1.clone().sub(p0);
  const len = along.length();
  const ex = along.normalize();
  const ez = new THREE.Vector3().crossVectors(ex, f.n).normalize();
  const m = new THREE.Matrix4().makeBasis(ex, f.n, ez);
  o.slab.quaternion.setFromRotationMatrix(m);
  o.slab.scale.set(len * 0.82, o.h, 0.07);
  o.slab.position.copy(mid).addScaledVector(f.n, o.h / 2 + 0.02);
}

// ---------- Strahl berechnen und anzeigen ----------
function retrace() {
  const t = trace({ K: game.K, emitter: game.spec.emitter, comps: game.comps }, game.orient);
  // Tiefe, in der jedes Feld zuerst erreicht wird
  const depthOf = new Map();
  depthOf.set(cellId(game.spec.emitter.k, game.spec.emitter.i), 0);
  for (const s of t.segments) {
    const d = s.depth + 1;
    if (!depthOf.has(s.to) || depthOf.get(s.to) > d) depthOf.set(s.to, d);
  }
  beamState = { trace: t, depthOf, reveal: 0, done: false };
  game.solved = false;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

function setSeg(mesh, i, a, b, radius) {
  const dir = b.clone().sub(a);
  const len = dir.length();
  tmpQ.setFromUnitVectors(UP, dir.normalize());
  tmpM.compose(a.clone().add(b).multiplyScalar(0.5), tmpQ, new THREE.Vector3(radius, len, radius));
  mesh.setMatrixAt(i, tmpM);
}
function setBall(mesh, i, p, radius) {
  tmpM.compose(p, tmpQ.identity(), new THREE.Vector3(radius, radius, radius));
  mesh.setMatrixAt(i, tmpM);
}

// Zeichnet den Strahl bis zur aktuellen Enthüllungstiefe
function drawBeam(time) {
  const { beam } = game;
  const st = beamState;
  const segs = st.trace.segments.filter((s) => s.depth <= st.reveal);
  const n = Math.min(segs.length, MAX_SEG);
  for (let i = 0; i < n; i++) {
    const a = game.centerOf(segs[i].from);
    const b = game.centerOf(segs[i].to);
    setSeg(beam.core, i, a, b, 0.045);
    setSeg(beam.glow, i, a, b, 0.14);
    setBall(beam.joints, i, b, 0.06);
    setBall(beam.jointGlow, i, b, 0.19);
    const ph = (time * 1.3 + segs[i].depth * 0.17) % 1;
    setBall(beam.pulses, i, a.clone().lerp(b, ph), 0.075);
  }
  for (const m of Object.values(beam)) {
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
  }
}

// Felder, die der Strahl schon erreicht hat, leuchten warm
function paintTiles() {
  const { tiles } = game;
  const lit = beamState.depthOf;
  for (let c = 0; c < game.K * N; c++) {
    const d = lit.get(c);
    const on = d !== undefined && d <= beamState.reveal;
    const base = tiles.base[c];
    const color = on ? base.clone().lerp(SIM_LIT, 0.82) : base;
    for (let j = 0; j < 4; j++) tiles.col.set([color.r, color.g, color.b], c * 12 + j * 3);
  }
  tiles.attr.needsUpdate = true;
}

// ---------- Eingabe: Spiegel umlegen ----------
function flip(ci) {
  if (!game || game.won) return false;
  const c = game.comps[ci];
  const o = game.objs[ci];
  if (c.t === 'F') {
    sfx.bump();
    toast('Dieser Spiegel ist fest. Er lässt sich nicht drehen.');
    return false;
  }
  if (c.t !== 'M' && c.t !== 'S') return false;
  game.orient[ci] ^= 1;
  game.moves++;
  o.target = game.orient[ci];
  sfx.flip(c.k);
  retrace();
  game.hintUntil = 0;
  game.hintRing.visible = false;
  updateHud();
  return true;
}

// ---------- Kamera ----------
const FOV = 45;
function fitCamera() {
  if (!game) return;
  const aspect = window.innerWidth / window.innerHeight;
  const halfV = (FOV / 2) * (Math.PI / 180);
  const halfH = Math.atan(Math.tan(halfV) * aspect);
  const R = A_BASE * 1.5;
  view.dist = (R / Math.sin(Math.min(halfV, halfH))) * 1.12 * view.userDist;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
}

function updateCamera() {
  const H = game ? game.H : 5;
  const ty = H * 0.4;
  camera.position.set(0, ty + view.dist * Math.sin(view.pitch), view.dist * Math.cos(view.pitch));
  camera.lookAt(0, ty, 0);
}

const VIEW_OFFSET = 0.5; // leicht schräg, damit man zwei Seiten sieht
function faceYaw(f, around) {
  const base = Math.atan2(-OUT[f][0], OUT[f][1]) + VIEW_OFFSET;
  const k = Math.round((around - base) / (Math.PI * 2));
  return base + k * Math.PI * 2;
}
function turnView(quarter) {
  const q = Math.PI / 2;
  view.targetYaw = Math.round((view.targetYaw - VIEW_OFFSET) / q) * q + VIEW_OFFSET + q * quarter;
}

// ---------- Hinweis ----------
function showHint() {
  if (!game || game.won) return;
  // Welches Bauteil steht falsch? Das, das auf dem Lösungsweg am nächsten am Sender liegt.
  const sol = game.comps.map((c, i) => (c.t === 'M' || c.t === 'S' ? c.sol ?? game.orient[i] : game.orient[i]));
  const t = trace({ K: game.K, emitter: game.spec.emitter, comps: game.comps }, sol);
  const depth = new Map();
  for (const s of t.segments) if (!depth.has(s.to) || depth.get(s.to) > s.depth) depth.set(s.to, s.depth);
  let best = -1;
  let bestD = Infinity;
  game.comps.forEach((c, i) => {
    if ((c.t !== 'M' && c.t !== 'S') || c.sol === null || c.sol === undefined) return;
    if (game.orient[i] === c.sol) return;
    const d = depth.get(cellId(c.k, c.i)) ?? 999;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  if (best < 0) {
    toast('Alle Spiegel stehen richtig. Schau, ob alle Kristalle leuchten.');
    return;
  }
  const o = game.objs[best];
  game.hintComp = best;
  game.hintUntil = performance.now() + 8000;
  game.hintRing.position.copy(o.frame.center).addScaledVector(o.frame.n, 0.05);
  game.hintRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), o.frame.n);
  game.hintRing.scale.setScalar(Math.max(0.8, o.size * 0.9));
  game.hintRing.visible = true;
  toast('Der blau umrandete Spiegel steht falsch. Tippe darauf.');
}

// ---------- Gewinn ----------
function win() {
  game.won = true;
  sfx.win();
  const origin = V(apexPoint(game.K));
  pyrGroup.localToWorld(origin);
  for (let i = 0; i < 90; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), new THREE.MeshBasicMaterial({ color: ['#ffe27a', '#8fe8ff', '#ff9ad0', '#ffffff'][i % 4] }));
    m.position.copy(origin);
    scene.add(m);
    particles.push({ mesh: m, v: new THREE.Vector3((Math.random() - 0.5) * 5, Math.random() * 5 + 1, (Math.random() - 0.5) * 5), life: 0 });
  }
  const prev = progress[game.spec.id];
  if (!prev || game.moves < prev.moves || (game.moves === prev.moves && game.elapsed < prev.time)) {
    progress[game.spec.id] = { moves: game.moves, time: Math.round(game.elapsed) };
    store.set('lichtpyramide-progress', progress);
  }
  setTimeout(() => {
    if (game && game.won) showWin();
  }, 2000);
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

function crystalTotals() {
  const total = game.comps.filter((c) => c.t === 'C').length;
  const lit = beamState ? [...beamState.trace.litCrystals].filter((idx) => beamState.depthOf.get(cellId(game.comps[idx].k, game.comps[idx].i)) <= beamState.reveal).length : 0;
  return { total, lit };
}

function updateHud() {
  if (!game) return;
  const { total, lit } = crystalTotals();
  $('level-title').textContent = `${game.index + 1}. ${game.spec.name}`;
  $('stats').textContent = `Zeit ${fmt(game.elapsed)} · Züge ${game.moves}` + (total ? ` · ◆ ${lit}/${total}` : '');
  const frac = Math.min(1, game.elapsed / game.spec.target);
  $('timebar-fill').style.width = `${frac * 100}%`;
  $('timenote').textContent = game.elapsed < game.spec.target ? `Richtzeit ${fmt(game.spec.target)}, nur zur Orientierung` : 'Kein Limit. Nimm dir alle Zeit.';
  const hasCrystals = total > 0;
  $('tip').textContent = hasCrystals ? 'Lenke den Strahl zur Spitze. Alle Kristalle ◆ sollen leuchten.' : 'Tippe auf einen Spiegel und lenke den Strahl zur Spitze.';
}

let toastTimer = null;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function showOnly(name) {
  for (const k of Object.keys(overlays)) overlays[k].classList.toggle('hidden', k !== name);
  hud.classList.toggle('hidden', name !== null);
}

function openStart() {
  const list = $('levels');
  list.innerHTML = '';
  LEVELS.forEach((spec, i) => {
    const b = document.createElement('button');
    const p = progress[spec.id];
    const meta = p ? `✓ ${p.moves} Züge · ${fmt(p.time)}` : `${spec.K} Ringe`;
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
  $('win-stats').textContent = `Gelöst in ${fmt(game.elapsed)} mit ${game.moves} Zügen. Der Strahl hat die Spitze erreicht.`;
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
  store.set('lichtpyramide-settings', settings);
  ensureAudio();
  if (master) master.gain.value = settings.sound ? 1 : 0;
  refreshSound();
}

const isPlaying = () => game && !hud.classList.contains('hidden');

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'escape') {
    if (!overlays.menu.classList.contains('hidden')) showOnly(null);
    else if (isPlaying()) openMenu();
    return;
  }
  if (!isPlaying()) return;
  if (k === 'q' || k === 'arrowleft') turnView(-1);
  else if (k === 'e' || k === 'arrowright') turnView(1);
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

// Tippen auf einen Spiegel legt ihn um, Ziehen dreht die Pyramide
let pointer = null;
const raycaster = new THREE.Raycaster();
function compAt(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  pyrGroup.updateMatrixWorld(true);
  raycaster.setFromCamera(ndc, camera);
  // Das Bauteil, dessen Mitte dem Strahl am nächsten liegt (im Verhältnis zur Trefferfläche).
  // So gewinnt bei dicht stehenden Spiegeln der, auf den man wirklich gezielt hat.
  let best = -1;
  let bestScore = 1;
  const p = new THREE.Vector3();
  for (const h of game.hitGroup.children) {
    h.getWorldPosition(p);
    const radius = h.scale.x;
    const score = raycaster.ray.distanceToPoint(p) / radius;
    if (score < bestScore) {
      bestScore = score;
      best = h.userData.comp;
    }
  }
  return best;
}

canvas.addEventListener('pointerdown', (e) => {
  pointer = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* nicht kritisch */
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (pointer) {
    if (!pointer.moved && Math.hypot(e.clientX - pointer.sx, e.clientY - pointer.sy) > 8) pointer.moved = true;
    if (pointer.moved) {
      view.yaw -= (e.clientX - pointer.x) * 0.008;
      view.targetYaw = view.yaw;
      view.pitch = Math.min(1.25, Math.max(0.2, view.pitch + (e.clientY - pointer.y) * 0.004));
      pointer.x = e.clientX;
      pointer.y = e.clientY;
    }
  } else if (isPlaying() && e.pointerType === 'mouse') {
    canvas.style.cursor = compAt(e.clientX, e.clientY) >= 0 ? 'pointer' : 'default';
  }
});
canvas.addEventListener('pointerup', (e) => {
  const p = pointer;
  pointer = null;
  if (!p || p.moved || !isPlaying() || game.won) return;
  const ci = compAt(e.clientX, e.clientY);
  if (ci >= 0) flip(ci);
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
  const real = Math.min(1, (now - last) / 1000);
  const dt = Math.min(0.05, real);
  last = now;
  const time = now / 1000;

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

  view.yaw += (view.targetYaw - view.yaw) * (1 - Math.exp(-dt * 5));
  pyrGroup.rotation.y = view.yaw;
  farStars.rotation.y += dt * 0.004;
  motes.rotation.y += dt * 0.03;

  if (game) {
    if (isPlaying() && !game.won) {
      const before = Math.floor(game.elapsed);
      game.elapsed += real;
      if (Math.floor(game.elapsed) !== before) updateHud();
    }

    // Spiegel gleiten in ihre neue Stellung
    for (const o of game.objs) {
      if (o.slab && o.comp.t !== 'F' && o.a !== o.target) {
        const d = o.target - o.a;
        o.a = Math.abs(d) < 0.01 ? o.target : o.a + d * (1 - Math.exp(-dt * 14));
        updateSlab(o, o.a);
      }
      if (o.gem && o.comp.t === 'S') o.gem.rotation.y += dt * 1.2;
    }

    // Strahl wird von der Quelle aus enthüllt
    if (beamState) {
      const st = beamState;
      const speed = Math.max(14, (st.trace.maxDepth + 1) / 0.8);
      const wasDone = st.done;
      if (!st.done) {
        st.reveal += dt * speed;
        if (st.reveal >= st.trace.maxDepth + 1) {
          st.reveal = st.trace.maxDepth + 1;
          st.done = true;
        }
        paintTiles();
      }
      drawBeam(time);

      // Kristalle und Gipfel reagieren, sobald der Strahl sie erreicht
      let litNow = 0;
      for (const o of game.objs) {
        if (o.comp.t !== 'C') continue;
        const idx = game.objs.indexOf(o);
        const reached = st.trace.litCrystals.has(idx) && st.depthOf.get(cellId(o.comp.k, o.comp.i)) <= st.reveal;
        o.lit += ((reached ? 1 : 0) - o.lit) * (1 - Math.exp(-dt * 8));
        o.mat.emissiveIntensity = 0.35 + o.lit * 1.7;
        o.mat.color.setHex(reached ? 0xff7ad0 : 0xc04c9a);
        o.gem.rotation.y += dt * (0.4 + o.lit * 1.5);
        o.gem.position.copy(o.base).addScaledVector(o.frame.n, Math.sin(time * 2 + o.comp.i) * 0.04 * o.lit);
        if (reached) litNow++;
      }
      const apexSeg = st.trace.segments.find((s) => s.to === apexId(game.K));
      const apexOn = apexSeg && apexSeg.depth <= st.reveal;
      const target = apexOn ? 1 : 0;
      game.platform.material.emissiveIntensity += (target * 2.2 - game.platform.material.emissiveIntensity) * (1 - Math.exp(-dt * 6));
      game.column.material.opacity += (target * 0.22 - game.column.material.opacity) * (1 - Math.exp(-dt * 5));

      if (litNow !== game.litCrystalCount) {
        if (litNow > game.litCrystalCount) sfx.crystal();
        game.litCrystalCount = litNow;
        updateHud();
      }
      if (st.done && !wasDone) {
        game.solved = st.trace.solved;
        updateHud();
        if (game.solved && !game.won) win();
      }
    }

    // Hinweisring pulsiert und verschwindet
    if (game.hintUntil) {
      if (now > game.hintUntil) {
        game.hintUntil = 0;
        game.hintRing.visible = false;
      } else {
        game.hintRing.material.opacity = 0.5 + 0.4 * Math.sin(now / 220);
      }
    }
    if (game.won) view.targetYaw += dt * 0.15;
  }

  updateCamera();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

refreshSound();
openStart();
requestAnimationFrame(frame);

// Schnittstelle für automatische Tests im Browser
window.__lp = {
  get state() {
    if (!game) return null;
    return { index: game.index, moves: game.moves, won: game.won, solved: game.solved, orient: [...game.orient], yaw: view.yaw, targetYaw: view.targetYaw, revealDone: beamState ? beamState.done : false };
  },
  start: (i) => startLevel(i),
  flip: (ci) => flip(ci),
  comps: () => game.comps.map((c) => ({ ...c })),
  orient: () => [...game.orient],
  idle: () => !!beamState && beamState.done && game.objs.every((o) => !o.slab || o.a === o.target),
  turn: (q) => turnView(q),
  yawSettled: () => Math.abs(view.yaw - view.targetYaw) < 0.01,
  // Bildschirmposition eines Bauteils und ob es der Kamera zugewandt ist
  compScreen(ci) {
    pyrGroup.updateMatrixWorld(true);
    const o = game.objs[ci];
    const p = o.frame.center.clone().addScaledVector(o.frame.n, (o.h ?? 0.4) * 0.5);
    pyrGroup.localToWorld(p);
    const nWorld = o.frame.n.clone().transformDirection(pyrGroup.matrixWorld);
    const toCam = camera.position.clone().sub(p).normalize();
    p.project(camera);
    const r = canvas.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height, facing: nWorld.dot(toCam), z: p.z };
  },
};
