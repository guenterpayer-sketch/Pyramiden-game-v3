// Lichtpyramide: 3D-Darstellung, Eingabe und Spielablauf. Die Regeln stehen in board.js.
import * as THREE from '../vendor/three.module.min.js';
import { EffectComposer } from '../vendor/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/addons/postprocessing/OutputPass.js';
import { LEVELS } from './levels.js';
import { N, trace, cellFrame, cornerPoint, apexPoint, pyramidHeight, A_BASE, A_TOP, OUT, apexId, cellId, distance } from './board.js';

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
const settings = { sound: true, quality: 'auto', ...store.get('lichtpyramide-settings', {}) };
const progress = store.get('lichtpyramide-progress', {}); // { levelId: { stars, moves, time } }
const saveSettings = () => store.set('lichtpyramide-settings', settings);
const urlQuality = new URLSearchParams(location.search).get('q'); // für Tests: ?q=hoch oder ?q=niedrig
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// ---------- Klang: Glocken mit Hall, leiser Klangteppich ----------
let audio = null;
let bus = null;
let master = null;
function ensureAudio() {
  if (audio) return;
  try {
    audio = new AudioContext();
    master = audio.createGain();
    master.gain.value = settings.sound ? 1 : 0;
    master.connect(audio.destination);
    const reverb = audio.createConvolver();
    const len = Math.floor(audio.sampleRate * 2.8);
    const buf = audio.createBuffer(2, len, audio.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    reverb.buffer = buf;
    const wet = audio.createGain();
    wet.gain.value = 0.42;
    reverb.connect(wet).connect(master);
    bus = audio.createGain();
    bus.connect(master);
    bus.connect(reverb);
    // Klangteppich: drei leise Töne, die langsam atmen
    for (const [freq, vol, lfo] of [[110, 0.014, 0.05], [164.8, 0.01, 0.07], [220, 0.006, 0.04]]) {
      const o = audio.createOscillator();
      const g = audio.createGain();
      const l = audio.createOscillator();
      const lg = audio.createGain();
      o.frequency.value = freq;
      g.gain.value = vol;
      l.frequency.value = lfo;
      lg.gain.value = vol * 0.6;
      l.connect(lg).connect(g.gain);
      o.connect(g).connect(master);
      o.start();
      l.start();
    }
  } catch {
    audio = null;
  }
}
function bell(freq, when = 0, vol = 0.05, dur = 1.8) {
  if (!audio || !settings.sound) return;
  const t = audio.currentTime + when;
  for (const [mult, v, d] of [[1, 1, 1], [2.76, 0.35, 0.5], [5.4, 0.12, 0.25]]) {
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = freq * mult;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol * v, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur * d);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + dur * d + 0.05);
  }
}
const SCALE = [392, 440, 523, 587, 659, 784, 880, 1047];
const sfx = {
  flip: (ring) => bell(SCALE[ring % SCALE.length], 0, 0.045),
  undo: (ring) => bell(SCALE[ring % SCALE.length] / 2, 0, 0.04, 1.2),
  bump: () => bell(196, 0, 0.025, 0.4),
  crystal: () => [1319, 1760].forEach((f, i) => bell(f, i * 0.09, 0.03, 1.4)),
  apex: () => [523, 784, 1047].forEach((f) => bell(f, 0, 0.03, 2.4)),
  win: () => [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => bell(f, 0.1 + i * 0.13, 0.04, 2.6)),
};

// ---------- Renderer, Effekte, Qualität ----------
const canvas = document.createElement('canvas');
canvas.id = 'scene';
document.body.prepend(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 400);

let quality = urlQuality === 'niedrig' ? 'low' : urlQuality === 'hoch' ? 'high' : settings.quality === 'niedrig' ? 'low' : 'high';
let composer = null;
let bloom = null;
function applyQuality() {
  const high = quality === 'high';
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, high ? 2 : 1.25));
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (high && !composer) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.62, 0.5, 0.92);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }
  if (composer) {
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(window.innerWidth, window.innerHeight);
  }
  starMat.uniforms.pr.value = renderer.getPixelRatio();
  moteMat.uniforms.pr.value = renderer.getPixelRatio();
}

// ---------- Himmel: Nebel, Sterne, Spiegelungen ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Nebel als Panorama (waagerecht nahtlos), aus Rauschen in mehreren Stufen
function makeNebulaCanvas(w, h) {
  const rand = mulberry32(42);
  const perm = new Uint8Array(512);
  const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const vals = new Float32Array(256).map(() => rand());
  const val = (ix, iy, period) => vals[perm[(perm[((ix % period) + period) % period] + (iy & 255)) & 255]];
  const noise = (x, y, period) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const a = val(xi, yi, period);
    const b = val(xi + 1, yi, period);
    const c = val(xi, yi + 1, period);
    const d = val(xi + 1, yi + 1, period);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (x, y, period) => {
    let s = 0;
    let amp = 0.5;
    let f = 1;
    for (let o = 0; o < 5; o++) {
      s += amp * noise(x * f, y * f, period * f);
      amp *= 0.5;
      f *= 2;
    }
    return s;
  };
  const smooth = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  const P = 6;
  for (let y = 0; y < h; y++) {
    const v = y / h;
    // Grundfarbe: oben tiefes Blau, am Horizont violett, unten dunkel
    const top = [3, 4, 22];
    const mid = [26, 22, 74];
    const bot = [8, 8, 28];
    const t = v < 0.5 ? v / 0.5 : (v - 0.5) / 0.5;
    const from = v < 0.5 ? top : mid;
    const to = v < 0.5 ? mid : bot;
    const base = from.map((x, i) => x + (to[i] - x) * (v < 0.5 ? t * t : Math.sqrt(t)));
    const band = Math.exp(-(((v - 0.5) / 0.2) ** 2));
    for (let x = 0; x < w; x++) {
      const nx = (x / w) * P;
      const ny = v * 3;
      const n1 = fbm(nx, ny, P);
      const n2 = fbm(nx + 3, ny + 7.7, P);
      const neb = smooth(0.42, 0.8, n1) * (0.3 + 0.9 * band);
      const k = smooth(0.35, 0.68, n2);
      const tint = [110 + (40 - 110) * k, 64 + (170 - 64) * k, 220 + (205 - 220) * k];
      const rose = smooth(0.66, 0.85, n2) * 0.8;
      const i4 = (y * w + x) * 4;
      img.data[i4] = Math.min(255, base[0] + tint[0] * neb * 0.6 + 190 * rose * neb * 0.5);
      img.data[i4 + 1] = Math.min(255, base[1] + tint[1] * neb * 0.6 + 60 * rose * neb * 0.5);
      img.data[i4 + 2] = Math.min(255, base[2] + tint[2] * neb * 0.6 + 170 * rose * neb * 0.5);
      img.data[i4 + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // feiner Sternenstaub
  for (let i = 0; i < w * h * 0.0016; i++) {
    const x = rand() * w;
    const y = rand() * h * 0.85;
    g.fillStyle = `rgba(255,255,255,${0.15 + rand() * 0.5})`;
    g.fillRect(x, y, rand() < 0.1 ? 1.6 : 0.9, rand() < 0.1 ? 1.6 : 0.9);
  }
  return c;
}

const nebulaCanvas = makeNebulaCanvas(quality === 'high' ? 1024 : 512, quality === 'high' ? 512 : 256);
const nebulaTex = new THREE.CanvasTexture(nebulaCanvas);
nebulaTex.colorSpace = THREE.SRGBColorSpace;
nebulaTex.mapping = THREE.EquirectangularReflectionMapping;
scene.background = nebulaTex;

// Spiegelungen: derselbe Himmel mit ein paar hellen Lichtflächen
{
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  g.drawImage(nebulaCanvas, 0, 0, 512, 256);
  const blob = (x, y, r, color) => {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  };
  blob(80, 60, 70, 'rgba(150,230,255,0.95)');
  blob(300, 40, 90, 'rgba(255,235,210,0.9)');
  blob(420, 90, 60, 'rgba(200,150,255,0.85)');
  blob(200, 128, 120, 'rgba(120,110,255,0.35)');
  const envTex = new THREE.CanvasTexture(c);
  envTex.colorSpace = THREE.SRGBColorSpace;
  envTex.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(envTex).texture;
  envTex.dispose();
  pmrem.dispose();
}

// Funkelnde Sterne (eigener Shader: Größe und Funkeln je Stern)
function twinkleMaterial(color, strength) {
  return new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, pr: { value: 1 } },
    vertexShader: `
      attribute float size; attribute float phase; uniform float time; uniform float pr; varying float vA;
      void main() {
        vA = 0.45 + 0.55 * (0.5 + 0.5 * sin(time * (0.8 + fract(phase) * 1.6) + phase * 6.28));
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = size * pr;
      }`,
    fragmentShader: `
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vec3(${color}) * ${strength.toFixed(2)}, a * a * vA);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}
function makeTwinkles(count, rMin, rMax, sizeMin, sizeMax, mat, yMin = -0.1) {
  const rand = mulberry32(count * 7 + 1);
  const pos = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const phase = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2;
    const el = Math.asin(yMin + rand() * (1 - yMin));
    const r = rMin + rand() * (rMax - rMin);
    pos.set([Math.cos(a) * Math.cos(el) * r, Math.sin(el) * r, Math.sin(a) * Math.cos(el) * r], i * 3);
    size[i] = sizeMin + Math.pow(rand(), 3) * (sizeMax - sizeMin);
    phase[i] = rand() * 10;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}
const starMat = twinkleMaterial('1.0, 0.96, 0.88', 1.6);
const moteMat = twinkleMaterial('0.55, 0.9, 1.0', 1.2);
const stars = makeTwinkles(700, 80, 140, 1.2, 4.2, starMat, 0.05);
const motes = makeTwinkles(110, 6, 15, 1.5, 4.5, moteMat, -0.4);
scene.add(stars, motes);

// Sanftes Führungslicht von vorn oben (der Rest kommt aus den Spiegelungen des Himmels)
const keyLight = new THREE.DirectionalLight('#d6e4ff', 0.9);
keyLight.position.set(-4, 12, 9);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight('#c39bff', 0.7);
rimLight.position.set(8, 4, -8);
scene.add(rimLight);

// Weicher Lichtfleck und zwei Lichtringe unter der Pyramide
const softDot = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const pedestal = new THREE.Group();
scene.add(pedestal);
{
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(26, 26),
    new THREE.MeshBasicMaterial({ map: softDot, color: new THREE.Color(0.25, 0.32, 0.9), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = -0.45;
  pedestal.add(pool);
  for (const [r, c, o] of [[A_BASE * 1.62, [0.35, 0.9, 1.5], 0.9], [A_BASE * 1.9, [0.6, 0.45, 1.4], 0.55]]) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(r, 0.025, 6, 160),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(...c), transparent: true, opacity: o, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.4;
    pedestal.add(ring);
  }
}

// ---------- Texturen für Bodenplatten ----------
function canvasTex(draw, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
const tileMap = canvasTex((g, s) => {
  g.fillStyle = '#0d1030';
  g.fillRect(0, 0, s, s);
  const grad = g.createLinearGradient(0, s, s, 0);
  grad.addColorStop(0, '#9aa6d8');
  grad.addColorStop(0.55, '#ffffff');
  grad.addColorStop(1, '#c9d2ff');
  g.fillStyle = grad;
  roundRect(g, 7, 7, s - 14, s - 14, 16);
  g.fill();
});
const tileEdge = canvasTex((g, s) => {
  g.fillStyle = '#000';
  g.fillRect(0, 0, s, s);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 2.5;
  roundRect(g, 8.5, 8.5, s - 17, s - 17, 15);
  g.stroke();
});
const glowTileTex = canvasTex((g, s) => {
  g.clearRect(0, 0, s, s);
  const grad = g.createRadialGradient(s / 2, s / 2, 4, s / 2, s / 2, s * 0.62);
  grad.addColorStop(0, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0.18)');
  g.fillStyle = grad;
  roundRect(g, 7, 7, s - 14, s - 14, 16);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,1)';
  g.lineWidth = 3;
  roundRect(g, 8.5, 8.5, s - 17, s - 17, 15);
  g.stroke();
});

// ---------- Materialien ----------
const HDR = (r, g, b) => new THREE.Color(r, g, b); // Farben über 1 leuchten durch den Bloom-Effekt
const LIT = HDR(1.25, 0.78, 0.22);
const mats = {
  body: new THREE.MeshPhysicalMaterial({ color: '#16205e', emissive: '#080c2c', emissiveIntensity: 0.8, metalness: 0.35, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.15, envMapIntensity: 1.2 }),
  tiles: new THREE.MeshPhysicalMaterial({ vertexColors: true, map: tileMap, emissive: '#4f7dff', emissiveMap: tileEdge, emissiveIntensity: 0.45, metalness: 0.25, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.18, envMapIntensity: 0.9 }),
  glowTiles: new THREE.MeshBasicMaterial({ map: glowTileTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  ridge: new THREE.MeshBasicMaterial({ color: HDR(0.45, 1.25, 2.0) }),
  mirror: new THREE.MeshPhysicalMaterial({ color: '#eaf7ff', emissive: '#3d78b8', emissiveIntensity: 0.45, metalness: 0.9, roughness: 0.06, clearcoat: 1, envMapIntensity: 2.2 }),
  prismGlass: new THREE.MeshPhysicalMaterial({ color: '#ffb35c', metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.62, iridescence: 0.7, iridescenceIOR: 1.5, envMapIntensity: 1.4 }),
  rimM: new THREE.MeshBasicMaterial({ color: HDR(0.5, 1.6, 2.3) }),
  rimF: new THREE.MeshBasicMaterial({ color: HDR(1.0, 0.75, 2.2) }),
  rimS: new THREE.MeshBasicMaterial({ color: HDR(2.4, 1.3, 0.4) }),
  ringM: new THREE.MeshBasicMaterial({ color: HDR(0.4, 1.2, 1.8), transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
  ringS: new THREE.MeshBasicMaterial({ color: HDR(1.8, 0.95, 0.3), transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
  plate: new THREE.MeshPhysicalMaterial({ color: '#2a2460', metalness: 0.6, roughness: 0.3, clearcoat: 1, envMapIntensity: 1 }),
  obsidian: new THREE.MeshPhysicalMaterial({ color: '#0b0918', emissive: '#1a1040', emissiveIntensity: 0.35, metalness: 0.4, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.7, flatShading: true }),
  gem: new THREE.MeshBasicMaterial({ color: HDR(2.2, 1.2, 0.35) }),
  emitter: new THREE.MeshBasicMaterial({ color: HDR(3.2, 2.6, 1.5) }),
  spark: new THREE.MeshBasicMaterial({ color: HDR(2.5, 2.2, 1.6) }),
  beamCore: new THREE.MeshBasicMaterial({ color: HDR(3.4, 2.8, 1.7), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  beamGlow: new THREE.MeshBasicMaterial({ color: HDR(1.0, 0.62, 0.2), transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending }),
  pulse: new THREE.MeshBasicMaterial({ color: HDR(4, 3.8, 3.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  hit: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  hint: new THREE.MeshBasicMaterial({ color: HDR(2.4, 1.8, 0.6), transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
  platform: new THREE.MeshPhysicalMaterial({ color: '#3b3360', metalness: 0.85, roughness: 0.22, clearcoat: 1, envMapIntensity: 1.4 }),
};

// ---------- Spielzustand ----------
const view = { yaw: 0, targetYaw: 0, pitch: 0.5, dist: 30, userDist: 1, offX: 0, offY: 0 };
const pyrGroup = new THREE.Group();
scene.add(pyrGroup);
let levelGroup = null;
let game = null;
let mode = 'preview'; // 'preview' (hinter dem Startbildschirm) oder 'play'
let beamState = null;
const effects = []; // kurze Animationen: { t, dur, update(p), done() }
const particles = [];
const MAX_SEG = 700;

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function disposeGroup(g) {
  g.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material && o.userData.ownMaterial) o.material.dispose();
  });
}

function addEffect(dur, update, done) {
  effects.push({ t: 0, dur, update, done });
}

function tube(a, b, r, mat) {
  const dir = b.clone().sub(a);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, dir.length(), 8, 1, true), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return m;
}

function basisQuat(x, y, z) {
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

// ---------- Aufbau eines Rätsels ----------
function buildLevelScene(index) {
  if (levelGroup) {
    pyrGroup.remove(levelGroup);
    disposeGroup(levelGroup);
  }
  for (const p of particles.splice(0)) scene.remove(p.mesh);
  effects.length = 0;

  const spec = LEVELS[index];
  const K = spec.K;
  const H = pyramidHeight(K);
  levelGroup = new THREE.Group();
  pyrGroup.add(levelGroup);

  const frames = [];
  for (let k = 0; k < K; k++) {
    frames.push([]);
    for (let i = 0; i < N; i++) {
      const f = cellFrame(K, k, i);
      frames[k].push({ ...f, center: V(f.center), n: V(f.n), eR: V(f.eR), eU: V(f.eU), LL: V(f.LL), LR: V(f.LR), UL: V(f.UL), UR: V(f.UR) });
    }
  }
  const apex = V(apexPoint(K));
  const centerOf = (id) => {
    if (id === apexId(K)) return apex.clone().add(new THREE.Vector3(0, 0.12, 0));
    const f = frames[Math.floor(id / N)][id % N];
    return f.center.clone().addScaledVector(f.n, 0.22);
  };

  // Körper und leuchtende Kanten
  const bodyGeo = new THREE.CylinderGeometry(A_TOP * Math.SQRT2, A_BASE * Math.SQRT2, H, 4, 1, false);
  bodyGeo.rotateY(Math.PI / 4);
  bodyGeo.translate(0, H / 2, 0);
  levelGroup.add(new THREE.Mesh(bodyGeo, mats.body));
  for (let c = 0; c < 4; c++) {
    const b0 = V(cornerPoint(K, c, 0));
    const b1 = V(cornerPoint(K, c + 1, 0));
    const t0 = V(cornerPoint(K, c, K));
    const t1 = V(cornerPoint(K, c + 1, K));
    levelGroup.add(tube(b0, t0, 0.028, mats.ridge), tube(b0, b1, 0.034, mats.ridge), tube(t0, t1, 0.026, mats.ridge));
  }

  // Bodenplatten (Glas mit leuchtendem Rand) und darüber eine Leuchtschicht für das Licht
  const cellCount = K * N;
  const pos = new Float32Array(cellCount * 12);
  const pos2 = new Float32Array(cellCount * 12);
  const nor = new Float32Array(cellCount * 12);
  const uv = new Float32Array(cellCount * 8);
  const col = new Float32Array(cellCount * 12);
  const glowCol = new Float32Array(cellCount * 12);
  const idx = [];
  for (let k = 0; k < K; k++) {
    for (let i = 0; i < N; i++) {
      const c = k * N + i;
      const f = frames[k][i];
      const mid = f.LL.clone().add(f.LR).add(f.UL).add(f.UR).multiplyScalar(0.25);
      [f.LL, f.LR, f.UR, f.UL].forEach((p, j) => {
        const q = mid.clone().add(p.clone().sub(mid).multiplyScalar(0.97));
        const a = q.clone().addScaledVector(f.n, 0.012);
        const b = q.clone().addScaledVector(f.n, 0.03);
        pos.set([a.x, a.y, a.z], c * 12 + j * 3);
        pos2.set([b.x, b.y, b.z], c * 12 + j * 3);
        nor.set([f.n.x, f.n.y, f.n.z], c * 12 + j * 3);
      });
      uv.set([0, 0, 1, 0, 1, 1, 0, 1], c * 8);
      idx.push(c * 4, c * 4 + 1, c * 4 + 2, c * 4, c * 4 + 2, c * 4 + 3);
      const shade = (i + k) % 2 === 0 ? 1 : 0.86;
      const color = new THREE.Color().setHSL(0.635 + 0.01 * k, 0.6, (0.17 + 0.012 * k) * shade);
      for (let j = 0; j < 4; j++) col.set([color.r, color.g, color.b], c * 12 + j * 3);
    }
  }
  const tileGeo = new THREE.BufferGeometry();
  tileGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  tileGeo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  tileGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  tileGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  tileGeo.setIndex(idx);
  levelGroup.add(new THREE.Mesh(tileGeo, mats.tiles));

  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute('position', new THREE.BufferAttribute(pos2, 3));
  glowGeo.setAttribute('uv', new THREE.BufferAttribute(uv.slice(), 2));
  const glowAttr = new THREE.BufferAttribute(glowCol, 3);
  glowGeo.setAttribute('color', glowAttr);
  glowGeo.setIndex(idx);
  const glowMesh = new THREE.Mesh(glowGeo, mats.glowTiles);
  glowMesh.renderOrder = 2;
  levelGroup.add(glowMesh);

  // Gipfel: Plattform, Leuchtfläche, schwebender Ring, Lichtsäule
  const platform = new THREE.Mesh(new THREE.BoxGeometry(A_TOP * 2, 0.18, A_TOP * 2), mats.platform);
  platform.position.set(0, H + 0.07, 0);
  levelGroup.add(platform);
  const inlayMat = new THREE.MeshBasicMaterial({ color: HDR(0.12, 0.09, 0.04) });
  const inlay = new THREE.Mesh(new THREE.PlaneGeometry(A_TOP * 1.55, A_TOP * 1.55), inlayMat);
  inlay.userData.ownMaterial = true;
  inlay.rotation.x = -Math.PI / 2;
  inlay.position.set(0, H + 0.165, 0);
  levelGroup.add(inlay);
  const haloMat = new THREE.MeshBasicMaterial({ color: HDR(0.3, 0.22, 0.1) });
  const halo = new THREE.Mesh(new THREE.TorusGeometry(A_TOP * 0.95, 0.035, 8, 80), haloMat);
  halo.userData.ownMaterial = true;
  halo.rotation.x = Math.PI / 2;
  halo.position.set(0, H + 0.95, 0);
  levelGroup.add(halo);
  const columnMat = new THREE.MeshBasicMaterial({ color: HDR(1.4, 1.0, 0.45), transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.95, 14, 32, 1, true), columnMat);
  column.userData.ownMaterial = true;
  column.position.set(0, H + 7.2, 0);
  levelGroup.add(column);

  // Bauteile
  const comps = spec.comps.map((c) => ({ ...c }));
  const orient = comps.map((c) => c.o ?? 0);
  const objs = [];
  const hitGroup = new THREE.Group();
  levelGroup.add(hitGroup);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const rand = mulberry32(index * 97 + 5);

  comps.forEach((c, ci) => {
    const f = frames[c.k][c.i];
    const size = Math.min(f.width, f.height);
    const o = { comp: c, frame: f, size, a: orient[ci], from: orient[ci], to: orient[ci], p: 1 };
    const flat = basisQuat(f.eR, f.n, f.eU.clone().negate());
    if (c.t === 'M' || c.t === 'F' || c.t === 'S') {
      o.h = size * 0.82;
      o.slab = new THREE.Mesh(box, c.t === 'S' ? mats.prismGlass : mats.mirror);
      o.rim = new THREE.Mesh(box, c.t === 'M' ? mats.rimM : c.t === 'F' ? mats.rimF : mats.rimS);
      levelGroup.add(o.slab, o.rim);
      if (c.t === 'F') {
        const plate = new THREE.Mesh(box, mats.plate);
        plate.quaternion.copy(flat);
        plate.scale.set(f.width * 0.8, 0.06, f.height * 0.8);
        plate.position.copy(f.center).addScaledVector(f.n, 0.04);
        levelGroup.add(plate);
      } else {
        // Leuchtring am Fuß: zeigt, dass man hier tippen kann
        o.ringMat = (c.t === 'M' ? mats.ringM : mats.ringS).clone();
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.78, 0.92, 48), o.ringMat);
        ring.userData.ownMaterial = true;
        ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), f.n);
        ring.scale.setScalar(size * 0.55);
        ring.position.copy(f.center).addScaledVector(f.n, 0.045);
        levelGroup.add(ring);
        o.ring = ring;
      }
      if (c.t === 'S') {
        o.gem = new THREE.Mesh(new THREE.OctahedronGeometry(size * 0.13), mats.gem);
        levelGroup.add(o.gem);
      }
      const hit = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), mats.hit);
      hit.scale.setScalar(Math.max(0.55, size * 0.62));
      hit.position.copy(f.center).addScaledVector(f.n, o.h * 0.5);
      hit.userData.comp = ci;
      hitGroup.add(hit);
      updateSlab(o);
    } else if (c.t === 'B') {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(size * 0.36, 0), mats.obsidian);
      rock.quaternion.copy(flat).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI));
      rock.scale.set(1, 0.78, 1);
      rock.position.copy(f.center).addScaledVector(f.n, size * 0.26);
      levelGroup.add(rock);
    } else if (c.t === 'C') {
      o.mat = new THREE.MeshPhysicalMaterial({ color: '#ff7ccf', emissive: '#ff3fae', emissiveIntensity: 0.12, metalness: 0.1, roughness: 0.08, iridescence: 1, iridescenceIOR: 1.6, envMapIntensity: 1.6, flatShading: true });
      o.gem = new THREE.Mesh(new THREE.OctahedronGeometry(size * 0.32), o.mat);
      o.gem.userData.ownMaterial = true;
      o.gem.quaternion.copy(flat);
      o.gem.scale.set(1, 1.6, 1);
      o.base = f.center.clone().addScaledVector(f.n, size * 0.58);
      o.gem.position.copy(o.base);
      o.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot, color: HDR(2.4, 0.6, 1.6), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      o.glow.userData.ownMaterial = true;
      o.glow.position.copy(o.base);
      o.glow.scale.setScalar(size * 2.0);
      o.lit = 0;
      levelGroup.add(o.gem, o.glow);
    }
    objs.push(o);
  });

  // Sender: leuchtende Kugel, Lichthof, Pfeil und zwei kreisende Funken
  const ef = frames[spec.emitter.k][spec.emitter.i];
  const es = Math.min(ef.width, ef.height);
  const emitter = new THREE.Group();
  emitter.position.copy(ef.center).addScaledVector(ef.n, 0.32);
  levelGroup.add(emitter);
  emitter.add(new THREE.Mesh(new THREE.SphereGeometry(es * 0.15, 20, 16), mats.emitter));
  const eHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot, color: HDR(1.6, 1.2, 0.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  eHalo.userData.ownMaterial = true;
  eHalo.scale.setScalar(es * 1.3);
  emitter.add(eHalo);
  const dirVec = [ef.eU, ef.eR, ef.eU.clone().negate(), ef.eR.clone().negate()][spec.emitter.dir];
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.28, 16), mats.emitter);
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirVec);
  cone.position.copy(dirVec).multiplyScalar(es * 0.32);
  emitter.add(cone);
  const sparks = new THREE.Group();
  sparks.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), ef.n);
  for (let s = 0; s < 2; s++) {
    const sp = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), mats.spark);
    sp.position.set(Math.cos(s * Math.PI) * es * 0.28, 0, Math.sin(s * Math.PI) * es * 0.28);
    sparks.add(sp);
  }
  emitter.add(sparks);

  // Strahl als Instanzen: Kern, Schein, Gelenke, wandernde Lichtpunkte, Lichtblitze an Bauteilen
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
  const sph = new THREE.SphereGeometry(1, 10, 8);
  const beam = {
    core: new THREE.InstancedMesh(cyl, mats.beamCore, MAX_SEG),
    glow: new THREE.InstancedMesh(cyl, mats.beamGlow, MAX_SEG),
    joints: new THREE.InstancedMesh(sph, mats.beamCore, MAX_SEG),
    jointGlow: new THREE.InstancedMesh(sph, mats.beamGlow, MAX_SEG),
    pulses: new THREE.InstancedMesh(sph, mats.pulse, MAX_SEG),
  };
  for (const m of Object.values(beam)) {
    m.count = 0;
    m.frustumCulled = false;
    m.renderOrder = 3;
    levelGroup.add(m);
  }
  const flares = new THREE.Group();
  levelGroup.add(flares);

  const hintRing = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.0, 48), mats.hint);
  hintRing.visible = false;
  levelGroup.add(hintRing);

  // Bestmögliche Zahl an Zügen
  const sol = comps.map((c) => (c.t === 'M' || c.t === 'S' ? (c.sol ?? null) : null));
  const opt = distance({ comps }, orient, sol);

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
    glow: { col: glowCol, attr: glowAttr, level: new Float32Array(cellCount), target: new Float32Array(cellCount) },
    apexFx: { inlayMat, haloMat, columnMat, halo, lit: 0 },
    emitter: { sparks, eHalo },
    hitGroup,
    hintRing,
    beam,
    flares,
    opt,
    history: [],
    elapsed: 0,
    won: false,
    solved: false,
    litCrystalCount: 0,
    apexOn: false,
    hintUntil: 0,
    intro: 0,
  };

  // Ansicht: die Seite des Senders zeigt zur Kamera
  view.yaw = view.targetYaw = faceYaw(ef.f, 0);
  pyrGroup.rotation.y = view.yaw;
  fitCamera();
  retrace(0.9);
  updateHud();
}

// Spiegel aus der (animierten) Stellung a: 0 = '/', 1 = '\'
function updateSlab(o) {
  const f = o.frame;
  const a = o.a;
  const p0 = f.LL.clone().lerp(f.LR, a);
  const p1 = f.UR.clone().lerp(f.UL, a);
  const mid = p0.clone().add(p1).multiplyScalar(0.5);
  const along = p1.clone().sub(p0);
  const len = along.length();
  const ex = along.normalize();
  const ez = new THREE.Vector3().crossVectors(ex, f.n).normalize();
  const q = basisQuat(ex, f.n, ez);
  const hop = Math.sin(Math.PI * o.p) * 0.14 * (o.from !== o.to ? 1 : 0);
  o.slab.quaternion.copy(q);
  o.slab.scale.set(len * 0.84, o.h, 0.075);
  o.slab.position.copy(mid).addScaledVector(f.n, o.h / 2 + 0.03 + hop);
  o.rim.quaternion.copy(q);
  o.rim.scale.set(len * 0.84, 0.035, 0.065);
  o.rim.position.copy(mid).addScaledVector(f.n, o.h + 0.045 + hop);
  if (o.gem) o.gem.position.copy(mid).addScaledVector(f.n, o.h + o.size * 0.2 + hop);
}

// ---------- Strahl ----------
function retrace(delay = 0) {
  const t = trace({ K: game.K, emitter: game.spec.emitter, comps: game.comps }, game.orient);
  const depthOf = new Map();
  depthOf.set(cellId(game.spec.emitter.k, game.spec.emitter.i), 0);
  for (const s of t.segments) {
    const d = s.depth + 1;
    if (!depthOf.has(s.to) || depthOf.get(s.to) > d) depthOf.set(s.to, d);
  }
  const speed = Math.max(16, (t.maxDepth + 1) / 0.75);
  beamState = { trace: t, depthOf, reveal: -delay * speed, speed, done: false };
  game.solved = false;

  // Lichtblitze an den Bauteilen, die der Strahl berührt
  for (const c of [...game.flares.children]) {
    game.flares.remove(c);
    c.material.dispose();
  }
  for (const ci of t.hit) {
    const c = game.comps[ci];
    if (c.t === 'B' || c.t === 'C') continue;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot, color: HDR(2.2, 1.7, 0.9), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.position.copy(game.centerOf(cellId(c.k, c.i)));
    s.scale.setScalar(game.objs[ci].size * 0.9);
    s.userData.depth = depthOf.get(cellId(c.k, c.i)) ?? 0;
    s.userData.ownMaterial = true;
    game.flares.add(s);
  }
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
function setSeg(mesh, i, a, b, radius) {
  const dir = b.clone().sub(a);
  const len = dir.length();
  tmpQ.setFromUnitVectors(UP, dir.normalize());
  tmpM.compose(a.clone().add(b).multiplyScalar(0.5), tmpQ, tmpS.set(radius, len, radius));
  mesh.setMatrixAt(i, tmpM);
}
function setBall(mesh, i, p, radius) {
  tmpM.compose(p, tmpQ.identity(), tmpS.set(radius, radius, radius));
  mesh.setMatrixAt(i, tmpM);
}

function drawBeam(time) {
  const st = beamState;
  const segs = st.trace.segments;
  let n = 0;
  for (const s of segs) {
    if (n >= MAX_SEG) break;
    const grow = Math.min(1, Math.max(0, st.reveal - s.depth)); // Segment wächst von seinem Anfang aus
    if (grow <= 0) continue;
    const a = game.centerOf(s.from);
    const b = a.clone().lerp(game.centerOf(s.to), grow);
    const w = 1 + 0.12 * Math.sin(time * 3 + s.depth * 0.6);
    setSeg(game.beam.core, n, a, b, 0.042 * w);
    setSeg(game.beam.glow, n, a, b, 0.13 * w);
    setBall(game.beam.joints, n, b, 0.055 * w);
    setBall(game.beam.jointGlow, n, b, 0.16 * w);
    const ph = (time * 1.15 + s.depth * 0.21) % 1;
    setBall(game.beam.pulses, n, a.clone().lerp(b, ph), grow >= 1 ? 0.07 : 0);
    n++;
  }
  for (const m of Object.values(game.beam)) {
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
  }
}

// ---------- Züge ----------
function flip(ci, { record = true } = {}) {
  if (!game || game.won || mode !== 'play') return false;
  const c = game.comps[ci];
  const o = game.objs[ci];
  if (c.t === 'F') {
    sfx.bump();
    toast('Dieser violette Spiegel ist fest.');
    return false;
  }
  if (c.t !== 'M' && c.t !== 'S') return false;
  game.orient[ci] ^= 1;
  o.from = o.a;
  o.to = game.orient[ci];
  o.p = 0;
  if (record) {
    game.history.push(ci);
    sfx.flip(c.k);
  } else {
    sfx.undo(c.k);
  }
  ripple(o);
  retrace();
  game.hintUntil = 0;
  game.hintRing.visible = false;
  updateHud();
  return true;
}

function undo() {
  if (!game || game.won || mode !== 'play' || game.history.length === 0) return false;
  const ci = game.history.pop();
  flip(ci, { record: false });
  return true;
}

// Ein Lichtring breitet sich am Spiegel aus
function ripple(o) {
  const mat = (o.comp.t === 'S' ? mats.ringS : mats.ringM).clone();
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 48), mat);
  ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), o.frame.n);
  ring.position.copy(o.frame.center).addScaledVector(o.frame.n, 0.05);
  levelGroup.add(ring);
  addEffect(
    0.55,
    (p) => {
      ring.scale.setScalar(o.size * (0.4 + p * 0.55));
      mat.opacity = 0.9 * (1 - p);
    },
    () => {
      levelGroup?.remove(ring);
      ring.geometry.dispose();
      mat.dispose();
    },
  );
}

// ---------- Kamera ----------
const FOV = 42;
function fitCamera() {
  const aspect = window.innerWidth / window.innerHeight;
  const halfV = (FOV / 2) * (Math.PI / 180);
  const halfH = Math.atan(Math.tan(halfV) * aspect);
  const R = A_BASE * 1.42;
  view.dist = (R / Math.sin(Math.min(halfV, halfH))) * 1.28 * view.userDist;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
}

function updateCamera(dt) {
  const H = game ? game.H : 5.6;
  const ty = H * 0.4;
  camera.position.set(0, ty + view.dist * Math.sin(view.pitch), view.dist * Math.cos(view.pitch));
  camera.lookAt(0, ty, 0);
  // Auf dem Startbildschirm rückt die Pyramide neben (bzw. über) das Menü
  const w = window.innerWidth;
  const h = window.innerHeight;
  const startShown = !overlays.start.classList.contains('hidden');
  const tx = startShown && w > 720 ? -w * 0.2 : 0; // negativ: Bild rückt nach rechts
  const tyOff = startShown && w <= 720 ? h * 0.24 : startShown ? 0 : h * 0.035;
  const k = 1 - Math.exp(-dt * 4);
  view.offX += (tx - view.offX) * k;
  view.offY += (tyOff - view.offY) * k;
  if (Math.abs(view.offX) > 0.5 || Math.abs(view.offY) > 0.5) camera.setViewOffset(w, h, view.offX, view.offY, w, h);
  else camera.clearViewOffset();
}

const VIEW_OFFSET = 0.5;
function faceYaw(f, around) {
  const base = Math.atan2(-OUT[f][0], OUT[f][1]) + VIEW_OFFSET;
  const k = Math.round((around - base) / (Math.PI * 2));
  return base + k * Math.PI * 2;
}
function turnView(quarter) {
  const q = Math.PI / 2;
  view.targetYaw = Math.round((view.targetYaw - VIEW_OFFSET) / q) * q + VIEW_OFFSET + q * quarter;
}

// ---------- Tipp ----------
function showHint() {
  if (!game || game.won || mode !== 'play') return;
  const sol = game.comps.map((c, i) => (c.t === 'M' || c.t === 'S' ? (c.sol ?? game.orient[i]) : game.orient[i]));
  const t = trace({ K: game.K, emitter: game.spec.emitter, comps: game.comps }, sol);
  const depth = new Map();
  for (const s of t.segments) if (!depth.has(s.to) || depth.get(s.to) > s.depth) depth.set(s.to, s.depth);
  let best = -1;
  let bestD = Infinity;
  game.comps.forEach((c, i) => {
    if ((c.t !== 'M' && c.t !== 'S') || c.sol === null || c.sol === undefined || game.orient[i] === c.sol) return;
    const d = depth.get(cellId(c.k, c.i)) ?? 999;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  if (best < 0) {
    toast('Alle Spiegel stehen richtig.');
    return;
  }
  const o = game.objs[best];
  game.hintUntil = performance.now() + 8000;
  game.hintRing.position.copy(o.frame.center).addScaledVector(o.frame.n, 0.06);
  game.hintRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), o.frame.n);
  game.hintRing.scale.setScalar(o.size * 0.62);
  game.hintRing.visible = true;
  // Pyramide so drehen, dass der Spiegel zu sehen ist
  view.targetYaw = faceYaw(o.frame.f, view.targetYaw);
  toast('Der golden umrandete Spiegel steht noch falsch.');
}

// ---------- Gewinn ----------
function starsFor(moves, opt) {
  if (moves <= opt) return 3;
  if (moves <= opt + 2) return 2;
  return 1;
}

function win() {
  game.won = true;
  sfx.win();
  const moves = game.history.length;
  const stars = starsFor(moves, game.opt);
  game.result = { moves, stars, time: Math.round(game.elapsed) };
  const prev = progress[game.spec.id];
  if (!prev || stars > prev.stars || (stars === prev.stars && moves < prev.moves) || (stars === prev.stars && moves === prev.moves && game.result.time < prev.time)) {
    progress[game.spec.id] = game.result;
    store.set('lichtpyramide-progress', progress);
  }
  // Lichtwellen am Gipfel und aufsteigende Funken
  const top = V(apexPoint(game.K));
  for (let r = 0; r < 3; r++) {
    const mat = new THREE.MeshBasicMaterial({ color: HDR(2.0, 1.4, 0.5), transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1.0, 64), mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(top).add(new THREE.Vector3(0, 0.05, 0));
    levelGroup.add(ring);
    addEffect(
      2.2,
      (p) => {
        const q = Math.max(0, Math.min(1, (p * 2.2 - r * 0.35) / 1.5));
        ring.scale.setScalar(1 + q * 7);
        mat.opacity = q > 0 ? 0.8 * (1 - q) : 0;
      },
      () => {
        levelGroup?.remove(ring);
        ring.geometry.dispose();
        mat.dispose();
      },
    );
  }
  const origin = top.clone();
  pyrGroup.localToWorld(origin);
  const colors = [HDR(2.4, 1.8, 0.6), HDR(0.6, 1.8, 2.4), HDR(2.2, 0.7, 1.6), HDR(2.5, 2.5, 2.5)];
  for (let i = 0; i < 120; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), new THREE.MeshBasicMaterial({ color: colors[i % 4], transparent: true }));
    m.position.copy(origin);
    scene.add(m);
    const a = Math.random() * Math.PI * 2;
    const sp = 1 + Math.random() * 2.5;
    particles.push({ mesh: m, v: new THREE.Vector3(Math.cos(a) * sp, 2.5 + Math.random() * 4, Math.sin(a) * sp), life: 0, max: 2.4 + Math.random() });
  }
  setTimeout(() => {
    if (game && game.won && mode === 'play') showWin();
  }, 2300);
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

function crystalCounts() {
  const total = game.comps.filter((c) => c.t === 'C').length;
  let lit = 0;
  game.objs.forEach((o) => {
    if (o.comp.t === 'C' && o.reached) lit++;
  });
  return { total, lit };
}

function updateHud() {
  if (!game) return;
  const { total, lit } = crystalCounts();
  $('level-no').textContent = `Rätsel ${game.index + 1} von ${LEVELS.length}`;
  $('level-title').textContent = game.spec.name;
  $('stat-time').textContent = fmt(game.elapsed);
  $('stat-moves').textContent = String(game.history.length);
  $('stat-goal').textContent = `· bestmöglich ${game.opt}`;
  $('stat-crystal-wrap').classList.toggle('hidden', total === 0);
  $('stat-crystals').textContent = `${lit}/${total}`;
  $('timebar-fill').style.width = `${Math.min(1, game.elapsed / game.spec.target) * 100}%`;
  $('undo-btn').disabled = game.history.length === 0 || game.won;
}

let toastTimer = null;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

let tipTimer = null;
function showTip(text) {
  const el = $('tip');
  el.textContent = text;
  el.classList.remove('fade');
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => el.classList.add('fade'), 7000);
}

// Was ist in diesem Rätsel neu?
function introTip(index) {
  const kinds = (i) => new Set(LEVELS[i].comps.map((c) => c.t));
  const now = kinds(index);
  const before = new Set();
  for (let i = 0; i < index; i++) for (const k of kinds(i)) before.add(k);
  if (index === 0) return 'Tippe auf einen Spiegel mit Leuchtring. Er klappt um, und das Licht nimmt einen neuen Weg.';
  if (now.has('S') && !before.has('S')) return 'Neu: Orange Prismen teilen den Strahl. Ein Teil läuft geradeaus weiter.';
  if (now.has('C') && !before.has('C')) return 'Neu: Rosa Kristalle sollen alle leuchten, bevor das Licht oben ankommt.';
  if (now.has('F') && !before.has('F')) return 'Violette Spiegel sind fest. Plane um sie herum.';
  return 'Dreh die Pyramide, um auch die Rückseite zu sehen. Das Licht läuft um die Ecken.';
}

function showOnly(name) {
  for (const k of Object.keys(overlays)) overlays[k].classList.toggle('hidden', k !== name);
  hud.classList.toggle('hidden', name !== null);
}

function nextUnsolved() {
  const i = LEVELS.findIndex((l) => !progress[l.id]);
  return i < 0 ? 0 : i;
}

function openStart() {
  const list = $('levels');
  list.innerHTML = '';
  const next = nextUnsolved();
  LEVELS.forEach((spec, i) => {
    const b = document.createElement('button');
    b.className = 'card' + (i === next ? ' next' : '');
    const p = progress[spec.id];
    const s = p ? p.stars : 0;
    b.innerHTML = `<span class="num">${i + 1}</span><span class="name">${spec.name}</span><span class="stars">${[0, 1, 2].map((n) => `<span class="${n < s ? 'on' : ''}">★</span>`).join('')}</span>`;
    b.setAttribute('aria-label', `Rätsel ${i + 1}: ${spec.name}${p ? `, ${s} von 3 Sternen` : ''}`);
    b.addEventListener('click', () => startLevel(i));
    list.appendChild(b);
  });
  $('play-btn').textContent = Object.keys(progress).length ? `Weiter mit Rätsel ${next + 1}` : 'Spielen';
  mode = 'preview';
  if (!game || game.index !== next) buildLevelScene(next);
  showOnly('start');
}

function startLevel(index) {
  ensureAudio();
  mode = 'play';
  buildLevelScene(index);
  showOnly(null);
  showTip(introTip(index));
}

function showWin() {
  const r = game.result;
  $('win-title').textContent = r.stars === 3 ? 'Vollkommen' : 'Das Licht ist oben';
  $('win-time').textContent = fmt(r.time);
  $('win-moves').textContent = String(r.moves);
  $('win-best').textContent = String(game.opt);
  $('win-text').textContent =
    r.stars === 3 ? 'Mit den wenigsten möglichen Zügen gelöst.' : `Mit ${game.opt} Zügen geht es auch. Probier es ruhig noch einmal.`;
  const starEls = [...$('win-stars').children];
  starEls.forEach((el, i) => {
    el.className = '';
    setTimeout(() => el.classList.add('show', ...(i < r.stars ? ['on'] : [])), 250 + i * 220);
  });
  $('win-next').classList.toggle('hidden', game.index + 1 >= LEVELS.length);
  showOnly('win');
}

function openMenu() {
  if (!game || mode !== 'play') return;
  refreshToggles();
  showOnly('menu');
}

function refreshToggles() {
  const ql = { auto: 'automatisch', hoch: 'hoch', niedrig: 'niedrig' }[settings.quality] ?? 'automatisch';
  for (const id of ['start-sound', 'menu-sound']) $(id).querySelector('.val').textContent = settings.sound ? 'an' : 'aus';
  for (const id of ['start-quality', 'menu-quality']) $(id).querySelector('.val').textContent = ql;
}

function toggleSound() {
  settings.sound = !settings.sound;
  saveSettings();
  ensureAudio();
  if (master) master.gain.value = settings.sound ? 1 : 0;
  refreshToggles();
}

function cycleQuality() {
  settings.quality = { auto: 'hoch', hoch: 'niedrig', niedrig: 'auto' }[settings.quality] ?? 'auto';
  saveSettings();
  quality = settings.quality === 'niedrig' ? 'low' : 'high';
  perf.decided = settings.quality !== 'auto';
  applyQuality();
  refreshToggles();
}

const isPlaying = () => game && mode === 'play' && !hud.classList.contains('hidden');

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
  else if (k === 'z' || k === 'backspace') undo();
});

$('turn-left').addEventListener('click', () => turnView(-1));
$('turn-right').addEventListener('click', () => turnView(1));
$('undo-btn').addEventListener('click', undo);
$('hint-btn').addEventListener('click', showHint);
$('menu-btn').addEventListener('click', openMenu);
$('menu-resume').addEventListener('click', () => showOnly(null));
$('menu-restart').addEventListener('click', () => startLevel(game.index));
$('menu-select').addEventListener('click', openStart);
$('menu-sound').addEventListener('click', toggleSound);
$('start-sound').addEventListener('click', toggleSound);
$('menu-quality').addEventListener('click', cycleQuality);
$('start-quality').addEventListener('click', cycleQuality);
$('play-btn').addEventListener('click', () => startLevel(nextUnsolved()));
$('win-next').addEventListener('click', () => startLevel(game.index + 1));
$('win-select').addEventListener('click', openStart);
$('win-again').addEventListener('click', () => startLevel(game.index));

// Tippen auf einen Spiegel legt ihn um, Ziehen dreht die Pyramide
let pointer = null;
let hovered = -1;
const raycaster = new THREE.Raycaster();
function compAt(clientX, clientY) {
  if (!game) return -1;
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  pyrGroup.updateMatrixWorld(true);
  raycaster.setFromCamera(ndc, camera);
  // Das Bauteil, dessen Mitte dem Klick am nächsten liegt (im Verhältnis zur Trefferfläche)
  let best = -1;
  let bestScore = 1;
  const p = new THREE.Vector3();
  for (const h of game.hitGroup.children) {
    h.getWorldPosition(p);
    const score = raycaster.ray.distanceToPoint(p) / h.scale.x;
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
      view.pitch = Math.min(1.2, Math.max(0.18, view.pitch + (e.clientY - pointer.y) * 0.004));
      pointer.x = e.clientX;
      pointer.y = e.clientY;
    }
  } else if (isPlaying() && e.pointerType === 'mouse') {
    hovered = compAt(e.clientX, e.clientY);
    canvas.style.cursor = hovered >= 0 && game.comps[hovered].t !== 'F' ? 'pointer' : 'default';
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
    view.userDist = Math.min(1.35, Math.max(0.6, view.userDist + e.deltaY * 0.0008));
    fitCamera();
  },
  { passive: false },
);
window.addEventListener('resize', () => {
  applyQuality();
  fitCamera();
});

// ---------- Automatische Qualität: bei ruckelnder Darstellung Effekte reduzieren ----------
const perf = { frames: 0, sum: 0, decided: settings.quality !== 'auto' || !!urlQuality };
function watchPerformance(real) {
  if (perf.decided || mode !== 'play' || quality !== 'high') return;
  perf.frames++;
  if (perf.frames < 60) return; // Einschwingen abwarten
  perf.sum += real;
  if (perf.frames >= 180) {
    const avg = perf.sum / 120;
    perf.decided = true;
    if (avg > 0.034) {
      quality = 'low';
      applyQuality();
      toast('Effekte reduziert, damit es flüssig bleibt. Im Menü änderbar.');
    }
  }
}

// ---------- Schleife ----------
let last = performance.now();
function frame(now) {
  const real = Math.min(1, (now - last) / 1000);
  const dt = Math.min(0.05, real);
  last = now;
  const time = now / 1000;
  watchPerformance(real);

  starMat.uniforms.time.value = time;
  moteMat.uniforms.time.value = time;
  motes.rotation.y += dt * 0.02;
  pedestal.rotation.y += dt * 0.05;

  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.t += real;
    const p = Math.min(1, e.t / e.dur);
    e.update(p);
    if (p >= 1) {
      effects.splice(i, 1);
      e.done?.();
    }
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life += dt;
    p.v.y -= 2.2 * dt;
    p.v.multiplyScalar(1 - dt * 0.6);
    p.mesh.position.addScaledVector(p.v, dt);
    p.mesh.material.opacity = Math.max(0, 1 - p.life / p.max);
    if (p.life > p.max) {
      scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      particles.splice(i, 1);
    }
  }

  if (mode === 'preview' && !reduceMotion) view.targetYaw += dt * 0.12;
  view.yaw += (view.targetYaw - view.yaw) * (1 - Math.exp(-real * 5));
  pyrGroup.rotation.y = view.yaw;
  pyrGroup.position.y = reduceMotion ? 0 : Math.sin(time * 0.55) * 0.07;

  if (game) {
    // Einflug beim Start eines Rätsels
    if (game.intro < 1) {
      game.intro = Math.min(1, game.intro + real / 1.3);
      const e = easeOut(game.intro);
      levelGroup.position.y = -2.4 * (1 - e);
      levelGroup.scale.setScalar(0.86 + 0.14 * e);
    }
    if (isPlaying() && !game.won) {
      const before = Math.floor(game.elapsed);
      game.elapsed += real;
      if (Math.floor(game.elapsed) !== before) updateHud();
    }

    // Spiegel klappen mit kleinem Hüpfer um
    for (const o of game.objs) {
      if (o.slab && o.p < 1) {
        o.p = Math.min(1, o.p + real / 0.38);
        o.a = o.from + (o.to - o.from) * easeInOut(o.p);
        updateSlab(o);
        if (o.p >= 1) o.from = o.to;
      }
      if (o.ringMat) {
        const breathe = game.won ? 0.15 : 0.45 + 0.3 * Math.sin(time * 2.2 + o.comp.i);
        const hov = game.objs.indexOf(o) === hovered ? 0.4 : 0;
        o.ringMat.opacity = breathe + hov;
      }
      if (o.gem && o.comp.t === 'S') o.gem.rotation.y += dt * 1.4;
    }

    // Sender
    game.emitter.sparks.rotation.y += dt * 2.4;
    game.emitter.eHalo.material.opacity = 0.75 + 0.25 * Math.sin(time * 3);

    // Strahl wächst von der Quelle aus
    if (beamState) {
      const st = beamState;
      const wasDone = st.done;
      if (!st.done) {
        st.reveal += real * st.speed;
        if (st.reveal >= st.trace.maxDepth + 1) {
          st.reveal = st.trace.maxDepth + 1;
          st.done = true;
        }
      }
      drawBeam(time);

      // Felder leuchten nach, wenn das Licht sie erreicht
      const g = game.glow;
      for (let c = 0; c < g.level.length; c++) {
        const d = st.depthOf.get(c);
        g.target[c] = d !== undefined && d <= st.reveal ? 1 : 0;
        g.level[c] += (g.target[c] - g.level[c]) * (1 - Math.exp(-real * (g.target[c] > g.level[c] ? 10 : 4)));
        const v = g.level[c];
        for (let j = 0; j < 4; j++) g.col.set([LIT.r * v, LIT.g * v, LIT.b * v], c * 12 + j * 3);
      }
      g.attr.needsUpdate = true;

      for (const fl of game.flares.children) {
        const on = fl.userData.depth <= st.reveal;
        fl.material.opacity += ((on ? 0.75 + 0.25 * Math.sin(time * 4 + fl.userData.depth) : 0) - fl.material.opacity) * (1 - Math.exp(-real * 8));
      }

      // Kristalle
      let litNow = 0;
      for (const o of game.objs) {
        if (o.comp.t !== 'C') continue;
        const ci = game.objs.indexOf(o);
        o.reached = st.trace.litCrystals.has(ci) && st.depthOf.get(cellId(o.comp.k, o.comp.i)) <= st.reveal;
        o.lit += ((o.reached ? 1 : 0) - o.lit) * (1 - Math.exp(-real * 7));
        o.mat.emissiveIntensity = 0.12 + o.lit * 2.6;
        o.glow.material.opacity = o.lit * (0.8 + 0.2 * Math.sin(time * 3 + ci));
        o.gem.rotateY(dt * (0.3 + o.lit * 1.6));
        o.gem.position.copy(o.base).addScaledVector(o.frame.n, Math.sin(time * 2 + o.comp.i) * 0.05 * o.lit);
        if (o.reached) litNow++;
      }
      if (litNow !== game.litCrystalCount) {
        if (litNow > game.litCrystalCount && mode === 'play') sfx.crystal();
        game.litCrystalCount = litNow;
        updateHud();
      }

      // Gipfel
      const apexSeg = st.trace.segments.find((s) => s.to === apexId(game.K));
      const apexOn = !!apexSeg && apexSeg.depth + 1 <= st.reveal;
      if (apexOn && !game.apexOn && mode === 'play') sfx.apex();
      game.apexOn = apexOn;
      const ax = game.apexFx;
      ax.lit += ((apexOn ? 1 : 0) - ax.lit) * (1 - Math.exp(-real * 4));
      const l = 0.06 + ax.lit;
      ax.inlayMat.color.setRGB(2.6 * l, 1.8 * l, 0.7 * l);
      ax.haloMat.color.setRGB(2.4 * (0.12 + ax.lit), 1.7 * (0.12 + ax.lit), 0.6 * (0.12 + ax.lit));
      ax.columnMat.opacity = ax.lit * (0.16 + 0.04 * Math.sin(time * 2));
      ax.halo.rotation.z += dt * 0.4;
      ax.halo.position.y = game.H + 0.95 + Math.sin(time * 1.3) * 0.08;

      if (st.done && !wasDone) {
        game.solved = st.trace.solved;
        updateHud();
        if (game.solved && !game.won && mode === 'play') win();
      }
    }

    if (game.hintUntil) {
      if (now > game.hintUntil) {
        game.hintUntil = 0;
        game.hintRing.visible = false;
      } else {
        game.hintRing.material.opacity = 0.55 + 0.4 * Math.sin(now / 200);
      }
    }
    if (game.won) view.targetYaw += dt * 0.16;
  }

  updateCamera(real);
  if (quality === 'high' && composer) composer.render();
  else renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

applyQuality();
refreshToggles();
openStart();
requestAnimationFrame(frame);

// Schnittstelle für automatische Tests im Browser
window.__lp = {
  get state() {
    if (!game) return null;
    return { index: game.index, moves: game.history.length, won: game.won, solved: game.solved, orient: [...game.orient], yaw: view.yaw, targetYaw: view.targetYaw, revealDone: beamState ? beamState.done : false, mode, quality, opt: game.opt };
  },
  start: (i) => startLevel(i),
  flip: (ci) => flip(ci),
  undo: () => undo(),
  comps: () => game.comps.map((c) => ({ ...c })),
  orient: () => [...game.orient],
  idle: () => !!beamState && beamState.done && game.objs.every((o) => !o.slab || o.p >= 1) && game.intro >= 1,
  turn: (q) => turnView(q),
  // Bildschirmposition der Pyramidenmitte (für Tests des Bildausschnitts)
  centerScreen() {
    const p = new THREE.Vector3(0, (game ? game.H : 5.6) * 0.4, 0);
    p.project(camera);
    return { x: ((p.x + 1) / 2) * window.innerWidth, y: ((1 - p.y) / 2) * window.innerHeight };
  },
  yawSettled: () => Math.abs(view.yaw - view.targetYaw) < 0.01,
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
