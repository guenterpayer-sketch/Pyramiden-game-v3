// Innenräume: 3D-Darstellung, Eingabe und Ablauf. Die Regeln stehen in logic.js.
import * as THREE from '../vendor/three.module.min.js';
import { PUZZLES } from './puzzles.js';
import {
  CENTER,
  ORIENTATIONS,
  TURNS,
  WALK,
  startState,
  move,
  turn,
  won,
  transpose,
  mulVec,
} from './logic.js';

// ---------- Persistenz (defensiv, Speicher kann fehlen) ----------
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
      /* Speicher nicht verfügbar: das Spiel läuft trotzdem */
    }
  },
};
const settings = { sound: true, ...store.get('innenraeume-settings', {}) };
const solved = new Set(store.get('innenraeume-solved', []));
const saveSettings = () => store.set('innenraeume-settings', settings);

// ---------- Ton (sehr leise, nur kurze Töne) ----------
let audio = null;
function ensureAudio() {
  if (audio) return;
  try {
    audio = new AudioContext();
  } catch {
    audio = null;
  }
}
function tone(freq, dur = 0.14, type = 'sine', vol = 0.06, when = 0) {
  if (!settings.sound || !audio) return;
  const t = audio.currentTime + when;
  const o = audio.createOscillator();
  const g = audio.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(audio.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}
const sfx = {
  step: () => tone(420, 0.12, 'triangle', 0.05),
  turn: () => {
    tone(260, 0.4, 'sine', 0.05);
    tone(390, 0.4, 'sine', 0.035, 0.08);
  },
  bump: () => tone(160, 0.1, 'square', 0.025),
  win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.6, 'sine', 0.06, i * 0.14)),
};

// ---------- Renderer und Szene ----------
const canvas = document.createElement('canvas');
canvas.id = 'scene';
document.body.prepend(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
const SKY = new THREE.Color('#ecd3a2');
scene.background = SKY;
scene.fog = new THREE.Fog(SKY, 26, 60);

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 200);

scene.add(new THREE.HemisphereLight('#fff3dc', '#b58a52', 1.25));
const sun = new THREE.DirectionalLight('#fff0cf', 2.4);
sun.position.set(9, 16, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 50 });
sun.shadow.bias = -0.0008;
scene.add(sun);

// Sandboden weit unter der Pyramide, bleibt beim Drehen unberührt
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(60, 64),
  new THREE.MeshStandardMaterial({ color: '#dcb273', roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -5.5;
ground.receiveShadow = true;
scene.add(ground);

// Fernes Dekor: kleine Pyramiden am Horizont
for (let i = 0; i < 5; i++) {
  const a = (i / 5) * Math.PI * 2 + 0.4;
  const d = 34 + (i % 2) * 8;
  const p = new THREE.Mesh(
    new THREE.ConeGeometry(4 + (i % 3), 6 + (i % 2) * 2, 4),
    new THREE.MeshStandardMaterial({ color: '#e2bd80', roughness: 0.9 }),
  );
  p.rotation.y = Math.PI / 4;
  p.position.set(Math.cos(a) * d, -5.5 + (3 + (i % 2)), Math.sin(a) * d);
  scene.add(p);
}

// ---------- Materialien und Geometrie ----------
const blockGeo = new THREE.BoxGeometry(0.98, 0.98, 0.98);
const stoneMat = new THREE.MeshStandardMaterial({ color: '#d7a866', roughness: 0.85 });
const goldMat = new THREE.MeshStandardMaterial({
  color: '#ffd45c',
  emissive: '#ffa020',
  emissiveIntensity: 0.7,
  metalness: 0.5,
  roughness: 0.3,
});
const robeMat = new THREE.MeshStandardMaterial({ color: '#2f6f9f', roughness: 0.6 });
const skinMat = new THREE.MeshStandardMaterial({ color: '#c68a5a', roughness: 0.7 });
const eyeMat = new THREE.MeshStandardMaterial({ color: '#2a1d10' });

// ---------- Ausrichtung als Quaternion ----------
function quatOf(o) {
  const m = ORIENTATIONS[o];
  const m4 = new THREE.Matrix4().set(
    m[0], m[1], m[2], 0,
    m[3], m[4], m[5], 0,
    m[6], m[7], m[8], 0,
    0, 0, 0, 1,
  );
  return new THREE.Quaternion().setFromRotationMatrix(m4);
}

// Richtung „nach oben“ in der unverdrehten Pyramide für Ausrichtung o
function upOf(o) {
  const n = mulVec(transpose(ORIENTATIONS[o]), [0, 1, 0]);
  return new THREE.Vector3(n[0], n[1], n[2]);
}

const TOP = 0.49; // halbe Blockhöhe, Standfläche liegt auf der Blockoberseite
// Standpunkt auf Block v in der Ausrichtung o, relativ zur Pyramide
function standPoint(v, o) {
  return new THREE.Vector3(v[0] - CENTER, v[1] - CENTER, v[2] - CENTER).addScaledVector(upOf(o), TOP);
}

// ---------- Spielfigur (bleibt in der Welt aufrecht) ----------
function buildPlayer() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.26, 4, 12), robeMat);
  body.position.y = 0.3;
  body.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), skinMat);
  head.position.y = 0.72;
  head.castShadow = true;
  g.add(body, head);
  for (const x of [-0.05, 0.05]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.023, 8, 6), eyeMat);
    eye.position.set(x, 0.74, 0.12);
    g.add(eye);
  }
  return g;
}

// ---------- Aktuelles Rätsel ----------
const rig = new THREE.Group(); // dreht sich mit der ganzen Pyramide
scene.add(rig);
const decor = new THREE.Group();
rig.add(decor);
const blocksGroup = new THREE.Group();
rig.add(blocksGroup);
const player = buildPlayer();
rig.add(player);

// Durchsichtige Pyramide als Rahmen um die Gänge
const shellGeo = new THREE.ConeGeometry(3.7, 6.2, 4, 1, true);
shellGeo.rotateY(Math.PI / 4);
const shell = new THREE.Mesh(
  shellGeo,
  new THREE.MeshStandardMaterial({
    color: '#fff3d6',
    transparent: true,
    opacity: 0.1,
    side: THREE.DoubleSide,
    depthWrite: false,
    roughness: 1,
  }),
);
const shellEdges = new THREE.LineSegments(
  new THREE.EdgesGeometry(shellGeo),
  new THREE.LineBasicMaterial({ color: '#fff3d6', transparent: true, opacity: 0.55 }),
);
decor.add(shell, shellEdges);

let puz = null; // { index, p, state, goalMesh, moves, turns, elapsed, won }
const particles = [];
let busy = false;
const tweens = [];

function clearBlocks() {
  for (const child of [...blocksGroup.children]) {
    blocksGroup.remove(child);
  }
  for (const pa of particles.splice(0)) scene.remove(pa.mesh);
}

function buildPuzzle(index) {
  clearBlocks();
  const p = PUZZLES[index];
  const set = new Set(p.cells.map((c) => c.join(',')));
  const goalKey = p.goal.join(',');
  let goalMesh = null;
  for (const c of p.cells) {
    const isGoal = c.join(',') === goalKey;
    const mesh = new THREE.Mesh(blockGeo, isGoal ? goldMat : stoneMat);
    mesh.position.set(c[0] - CENTER, c[1] - CENTER, c[2] - CENTER);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    blocksGroup.add(mesh);
    if (isGoal) goalMesh = mesh;
  }
  puz = { index, p, state: startState(p), goalMesh, moves: 0, turns: 0, elapsed: 0, won: false };
  tweens.length = 0;
  busy = false;
  facingYaw = 0;
  rig.quaternion.copy(quatOf(puz.state.o));
  player.position.copy(standPoint(puz.state.v, puz.state.o));
  applyPlayerUpright();
  updateHud();
}

// ---------- Kamera ----------
const orbit = { yaw: 0.75, pitch: 0.42, dist: 15.5 };
const target = new THREE.Vector3(0, 0.3, 0);
function updateCamera() {
  const cp = Math.cos(orbit.pitch);
  camera.position.set(
    target.x + orbit.dist * Math.sin(orbit.yaw) * cp,
    target.y + orbit.dist * Math.sin(orbit.pitch),
    target.z + orbit.dist * Math.cos(orbit.yaw) * cp,
  );
  camera.lookAt(target);
}

// Blickrichtung auf den Grundriss abbilden, damit Pfeiltasten zur Ansicht passen
function cameraDirections() {
  const fx = -Math.sin(orbit.yaw);
  const fz = -Math.cos(orbit.yaw);
  let fwd;
  if (Math.abs(fx) > Math.abs(fz)) fwd = [Math.sign(fx), 0, 0];
  else fwd = [0, 0, Math.sign(fz)];
  const right = [-fwd[2], 0, fwd[0]];
  return { forward: fwd, right };
}

// ---------- Figur bewegen und Pyramide drehen ----------
// Die Figur bleibt in der Welt aufrecht und schaut in die zuletzt gewählte Richtung
let facingYaw = 0;
function applyPlayerUpright() {
  const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), facingYaw);
  player.quaternion.copy(rig.quaternion.clone().invert()).multiply(yawQ);
}

function tween(duration, onUpdate, onDone) {
  tweens.push({ t0: performance.now(), duration, onUpdate, onDone });
}

function tryMove(d) {
  if (busy || !puz || puz.won) return;
  const s = puz.state;
  const ns = move(puz.p, s, d);
  if (!ns) {
    sfx.bump();
    toast('Dort geht es nicht weiter.');
    return;
  }
  const from = standPoint(s.v, s.o);
  const to = standPoint(ns.v, ns.o);
  const up = upOf(s.o);
  facingYaw = Math.atan2(d[0], d[2]);
  puz.state = ns;
  puz.moves++;
  busy = true;
  sfx.step();
  tween(
    0.22,
    (e) => {
      player.position.lerpVectors(from, to, e).addScaledVector(up, Math.sin(e * Math.PI) * 0.12);
      applyPlayerUpright();
    },
    () => {
      player.position.copy(to);
      busy = false;
      afterAction();
    },
  );
  updateHud();
}

function tryTurn(t) {
  if (busy || !puz || puz.won) return;
  const s = puz.state;
  const ns = turn(puz.p, s, t);
  if (!ns) {
    sfx.bump();
    toast('Wenn du so drehst, fällst du. Geh zuerst auf einen sicheren Block.');
    return;
  }
  const qa = rig.quaternion.clone();
  const qb = quatOf(ns.o);
  const pa = standPoint(s.v, s.o);
  const pb = standPoint(ns.v, ns.o);
  puz.state = ns;
  puz.turns++;
  busy = true;
  sfx.turn();
  tween(
    0.6,
    (e) => {
      const eased = e < 0.5 ? 2 * e * e : 1 - Math.pow(-2 * e + 2, 2) / 2;
      rig.quaternion.slerpQuaternions(qa, qb, eased);
      player.position.lerpVectors(pa, pb, eased);
      // kleiner Bogen nach oben in Weltkoordinaten
      const worldUp = new THREE.Vector3(0, 1, 0).applyQuaternion(rig.quaternion.clone().invert());
      player.position.addScaledVector(worldUp, Math.sin(eased * Math.PI) * 0.25);
      applyPlayerUpright();
    },
    () => {
      rig.quaternion.copy(qb);
      player.position.copy(pb);
      applyPlayerUpright();
      busy = false;
      afterAction();
    },
  );
  updateHud();
}

function afterAction() {
  if (won(puz.p, puz.state) && !puz.won) {
    puz.won = true;
    solved.add(puz.p.id);
    store.set('innenraeume-solved', [...solved]);
    celebrate();
  }
  updateHud();
}

function celebrate() {
  sfx.win();
  const origin = puz.goalMesh.getWorldPosition(new THREE.Vector3());
  for (let i = 0; i < 70; i++) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 6, 5),
      new THREE.MeshBasicMaterial({ color: ['#ffd45c', '#fff3d6', '#f0a040'][i % 3] }),
    );
    m.position.copy(origin);
    scene.add(m);
    const v = new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 3 + 1, (Math.random() - 0.5) * 3);
    particles.push({ mesh: m, v, life: 0 });
  }
  setTimeout(() => showWin(), 1800);
}

// ---------- Anzeige ----------
const $ = (id) => document.getElementById(id);
const hud = $('hud');
const overlays = { start: $('start'), menu: $('menu'), win: $('win') };

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function updateHud() {
  if (!puz) return;
  $('puzzle-title').textContent = `${puz.index + 1}. ${puz.p.name}`;
  $('stats').textContent = `Zeit ${formatTime(puz.elapsed)} · Schritte ${puz.moves} · Drehungen ${puz.turns}`;
}

let toastTimer = null;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function closeOverlays() {
  for (const el of Object.values(overlays)) el.classList.add('hidden');
  hud.classList.remove('hidden');
}

function openStart() {
  const list = $('puzzle-list');
  list.innerHTML = '';
  PUZZLES.forEach((p, i) => {
    const b = document.createElement('button');
    b.innerHTML = `<span>${i + 1}. ${p.name}</span><span class="${solved.has(p.id) ? 'done' : ''}">${solved.has(p.id) ? '✓ gelöst' : ''}</span>`;
    b.addEventListener('click', () => startPuzzle(i));
    list.appendChild(b);
  });
  hud.classList.add('hidden');
  for (const key of Object.keys(overlays)) overlays[key].classList.toggle('hidden', key !== 'start');
}

function startPuzzle(index) {
  ensureAudio();
  buildPuzzle(index);
  closeOverlays();
}

function openMenu() {
  if (!puz) return;
  refreshSoundButtons();
  for (const key of Object.keys(overlays)) overlays[key].classList.toggle('hidden', key !== 'menu');
  hud.classList.add('hidden');
}

function refreshSoundButtons() {
  for (const id of ['start-sound', 'menu-sound']) {
    $(id).textContent = settings.sound ? 'an' : 'aus';
    $(id).setAttribute('aria-pressed', String(settings.sound));
  }
}

function showWin() {
  $('win-stats').textContent = `Gelöst in ${formatTime(puz.elapsed)} mit ${puz.moves} Schritten und ${puz.turns} Drehungen. Nimm dir ruhig Zeit für das nächste Rätsel.`;
  const hasNext = puz.index + 1 < PUZZLES.length;
  $('win-next').classList.toggle('hidden', !hasNext);
  for (const key of Object.keys(overlays)) overlays[key].classList.toggle('hidden', key !== 'win');
  hud.classList.add('hidden');
}

// ---------- Eingabe ----------
const KEY_MOVES = {
  arrowup: 'up', w: 'up',
  arrowdown: 'down', s: 'down',
  arrowleft: 'left', a: 'left',
  arrowright: 'right', d: 'right',
};
const KEY_TURNS = { q: 'y-', e: 'y+', r: 'x+', f: 'x-', t: 'z+', g: 'z-' };

function directionFor(name) {
  const { forward, right } = cameraDirections();
  const neg = (v) => v.map((c) => -c);
  return { up: forward, down: neg(forward), right, left: neg(right) }[name];
}

function doMoveName(name) {
  tryMove(directionFor(name));
}

function doTurnKey(key) {
  const t = TURNS.find((x) => x.key === key);
  if (t) tryTurn(t);
}

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'escape') {
    if (!overlays.menu.classList.contains('hidden')) closeOverlays();
    else if (puz && !puz.won && hud.classList.contains('hidden') === false) openMenu();
    return;
  }
  // Tasten wirken nur im Spiel, nicht in Menüs
  if (!puz || puz.won || hud.classList.contains('hidden')) return;
  if (KEY_MOVES[k]) {
    e.preventDefault();
    doMoveName(KEY_MOVES[k]);
  } else if (KEY_TURNS[k]) {
    e.preventDefault();
    doTurnKey(KEY_TURNS[k]);
  }
});

document.querySelectorAll('[data-move]').forEach((b) =>
  b.addEventListener('click', () => doMoveName(b.dataset.move)),
);
document.querySelectorAll('[data-turn]').forEach((b) =>
  b.addEventListener('click', () => doTurnKey(b.dataset.turn)),
);

$('menu-btn').addEventListener('click', openMenu);
$('menu-resume').addEventListener('click', closeOverlays);
$('menu-restart').addEventListener('click', () => {
  buildPuzzle(puz.index);
  closeOverlays();
});
$('menu-select').addEventListener('click', openStart);
const toggleSound = () => {
  settings.sound = !settings.sound;
  saveSettings();
  refreshSoundButtons();
  ensureAudio();
};
$('menu-sound').addEventListener('click', toggleSound);
$('start-sound').addEventListener('click', toggleSound);
$('win-next').addEventListener('click', () => startPuzzle(puz.index + 1));
$('win-select').addEventListener('click', openStart);
$('win-again').addEventListener('click', () => {
  buildPuzzle(puz.index);
  closeOverlays();
});

// Kamera mit der Maus drehen, Mausrad zoomt
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY };
});
window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  orbit.yaw -= (e.clientX - drag.x) * 0.006;
  orbit.pitch = Math.min(1.2, Math.max(0.12, orbit.pitch + (e.clientY - drag.y) * 0.004));
  drag = { x: e.clientX, y: e.clientY };
});
window.addEventListener('pointerup', () => {
  drag = null;
});
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    orbit.dist = Math.min(26, Math.max(9, orbit.dist + e.deltaY * 0.01));
  },
  { passive: false },
);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// ---------- Schleife ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  // Animationen
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    const t = Math.min(1, (now - tw.t0) / (tw.duration * 1000));
    tw.onUpdate(t);
    if (t >= 1) {
      tweens.splice(i, 1);
      tw.onDone();
    }
  }

  // Partikel
  for (let i = particles.length - 1; i >= 0; i--) {
    const pa = particles[i];
    pa.life += dt;
    pa.v.y -= 6 * dt;
    pa.mesh.position.addScaledVector(pa.v, dt);
    if (pa.life > 2.5) {
      scene.remove(pa.mesh);
      particles.splice(i, 1);
    }
  }

  // Die Zeit läuft nur, wenn gespielt wird (nicht in Menüs), und dient nur der Anzeige
  const playing = puz && !puz.won && !hud.classList.contains('hidden');
  if (playing) {
    const before = Math.floor(puz.elapsed);
    puz.elapsed += dt;
    if (Math.floor(puz.elapsed) !== before) updateHud();
  }
  if (puz) {
    goldMat.emissiveIntensity = puz.won ? 1.4 : 0.8 + 0.3 * Math.sin(now / 500);
  }

  if (puz && puz.won) orbit.yaw += dt * 0.12;
  updateCamera();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// Start: Rätselauswahl
refreshSoundButtons();
openStart();
requestAnimationFrame(frame);

// Kleine Hilfe für Tests im Browser
window.__innenraeume = {
  get state() {
    return puz ? { o: puz.state.o, v: [...puz.state.v], won: puz.won, index: puz.index, moves: puz.moves, turns: puz.turns } : null;
  },
  playerWorld() {
    player.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    player.getWorldPosition(v);
    return [v.x, v.y, v.z];
  },
  standWorld() {
    const sp = puz ? standPoint(puz.state.v, puz.state.o) : null;
    if (!sp) return null;
    rig.updateMatrixWorld(true);
    const w = sp.clone().applyMatrix4(rig.matrixWorld);
    return [w.x, w.y, w.z];
  },
  start(i) {
    startPuzzle(i);
  },
  move: (name) => doMoveName(name),
  turn: (key) => doTurnKey(key),
  busy: () => busy,
};
