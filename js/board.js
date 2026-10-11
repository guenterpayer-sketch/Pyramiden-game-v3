// Lichtpyramide: Spielregeln und Geometrie, ohne Three.js (wird in Node getestet).
//
// Die Pyramide hat vier Seiten und K Ringe aus Feldern. Jeder Ring hat N Felder (4 pro Seite),
// auf jeder Höhe gleich viele. Dadurch liegt über jedem Feld genau ein Feld im nächsten Ring.
// Ein Lichtstrahl läuft von Feld zu Feld nach oben (U), rechts (R), unten (D) oder links (L).
// Rechts und links laufen um die Pyramide herum, auch um die Ecken auf die nächste Seite.
// Läuft der Strahl aus dem obersten Ring nach oben, trifft er die Spitze.
//
// Bauteile auf Feldern:
//   M  drehbarer Spiegel (zwei Stellungen: '/' = 0, '\' = 1)
//   F  fester Spiegel (Stellung o ist vorgegeben)
//   S  drehbares Prisma: der Strahl läuft geradeaus weiter UND wird zusätzlich gespiegelt
//   B  Sperrstein: der Strahl endet hier
//   C  Kristall: leuchtet, wenn der Strahl hindurchläuft (der Strahl läuft weiter)
//
// Ziel: Der Strahl erreicht die Spitze und alle Kristalle leuchten.

export const N = 16;
export const PER_FACE = N / 4;
export const DIR = { U: 0, R: 1, D: 2, L: 3 };

// ---------- Strahl ----------

// Spiegel '/' (o = 0): R<->U, L<->D. Spiegel '\' (o = 1): R<->D, L<->U.
const REFLECT = [
  [1, 0, 3, 2], // '/': aus U wird R, aus R wird U, aus D wird L, aus L wird D  (Index = Richtung)
  [3, 2, 1, 0], // '\': aus U wird L, aus R wird D, aus D wird R, aus L wird U
];
export const reflect = (dir, o) => REFLECT[o][dir];

export const cellId = (k, i) => k * N + i;
export const apexId = (K) => K * N;

// Nächstes Feld in Richtung dir. { apex: true } oben hinaus, { out: true } unten hinaus.
export function stepFrom(K, k, i, dir) {
  if (dir === DIR.U) return k + 1 >= K ? { apex: true } : { k: k + 1, i };
  if (dir === DIR.D) return k - 1 < 0 ? { out: true } : { k: k - 1, i };
  const ni = (i + (dir === DIR.R ? 1 : -1) + N) % N;
  return { k, i: ni };
}

const isRotatable = (c) => c.t === 'M' || c.t === 'S';

export function rotatableIndices(level) {
  const out = [];
  level.comps.forEach((c, idx) => {
    if (isRotatable(c)) out.push(idx);
  });
  return out;
}

// Verfolgt den Strahl. orient[idx] gibt die Stellung (0 oder 1) der drehbaren Bauteile an.
// Mit lite = true wird nur das Ergebnis berechnet, nicht der genaue Verlauf.
export function trace(level, orient, { lite = false } = {}) {
  const { K, emitter, comps } = level;
  const grid = new Map();
  comps.forEach((c, idx) => grid.set(cellId(c.k, c.i), idx));
  const emitterId = cellId(emitter.k, emitter.i);

  const segments = [];
  const lit = new Set([emitterId]);
  const litCrystals = new Set();
  const hit = new Set(); // Bauteile, die der Strahl berührt hat
  let apex = false;
  let maxDepth = 0;

  const seen = new Set();
  const queue = [{ k: emitter.k, i: emitter.i, dir: emitter.dir, depth: 0 }];
  for (let h = 0; h < queue.length; h++) {
    const { k, i, dir, depth } = queue[h];
    const state = (k * N + i) * 4 + dir;
    if (seen.has(state)) continue;
    seen.add(state);

    const nxt = stepFrom(K, k, i, dir);
    if (nxt.out) continue;
    if (nxt.apex) {
      apex = true;
      if (!lite) segments.push({ from: cellId(k, i), to: apexId(K), depth });
      maxDepth = Math.max(maxDepth, depth);
      continue;
    }
    const to = cellId(nxt.k, nxt.i);
    if (!lite) segments.push({ from: cellId(k, i), to, depth });
    lit.add(to);
    maxDepth = Math.max(maxDepth, depth);

    if (to === emitterId) continue; // der Sender schluckt Licht
    const idx = grid.get(to);
    if (idx === undefined) {
      queue.push({ k: nxt.k, i: nxt.i, dir, depth: depth + 1 });
      continue;
    }
    const c = comps[idx];
    const o = isRotatable(c) ? orient[idx] : c.o;
    hit.add(idx);
    if (c.t === 'B') continue;
    if (c.t === 'C') {
      litCrystals.add(idx);
      queue.push({ k: nxt.k, i: nxt.i, dir, depth: depth + 1 });
    } else if (c.t === 'M' || c.t === 'F') {
      queue.push({ k: nxt.k, i: nxt.i, dir: reflect(dir, o), depth: depth + 1 });
    } else if (c.t === 'S') {
      queue.push({ k: nxt.k, i: nxt.i, dir, depth: depth + 1 });
      queue.push({ k: nxt.k, i: nxt.i, dir: reflect(dir, o), depth: depth + 1 });
    }
  }

  const crystals = [];
  comps.forEach((c, idx) => {
    if (c.t === 'C') crystals.push(idx);
  });
  const solved = apex && crystals.every((idx) => litCrystals.has(idx));
  return { segments, lit, litCrystals, hit, apex, maxDepth, solved, crystals };
}

// Alle Stellungen der drehbaren Bauteile durchprobieren. Eine Lösung zählt nur über die Bauteile,
// die der Strahl berührt. Bauteile, die der Strahl nie trifft, dürfen beliebig stehen.
// Gibt pro verschiedener Lösung { sol, hit } zurück: sol[idx] = nötige Stellung oder null (egal).
export function solveAll(level) {
  const rot = rotatableIndices(level);
  const rotSet = new Set(rot);
  const total = 2 ** rot.length;
  const orient = new Array(level.comps.length).fill(0);
  const groups = new Map();
  for (let mask = 0; mask < total; mask++) {
    rot.forEach((idx, bit) => {
      orient[idx] = (mask >> bit) & 1;
    });
    const r = trace(level, orient, { lite: true });
    if (!r.solved) continue;
    const sol = level.comps.map((_, idx) => (rotSet.has(idx) && r.hit.has(idx) ? orient[idx] : null));
    const key = sol.join(',');
    if (!groups.has(key)) groups.set(key, sol);
  }
  return [...groups.values()];
}

// Zahl der Bauteile, die von orient auf die Lösung sol umgelegt werden müssen
export function distance(level, orient, sol) {
  return rotatableIndices(level).filter((idx) => sol[idx] !== null && sol[idx] !== orient[idx]).length;
}

// ---------- Geometrie ----------

export const A_BASE = 4.4; // halbe Kantenlänge am Fuß
export const A_TOP = 1.0; // halbe Kantenlänge des Gipfels
export const H_TOTAL = 5.6; // Gesamthöhe, in jedem Rätsel gleich
export const rise = (K) => H_TOTAL / K; // Höhe eines Rings
const CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];
export const OUT = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

export const halfSize = (K, level) => A_BASE - ((A_BASE - A_TOP) * level) / K;
export const pyramidHeight = () => H_TOTAL;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (v) => Math.hypot(v[0], v[1], v[2]);
const norm = (v) => {
  const l = len(v);
  return [v[0] / l, v[1] / l, v[2] / l];
};

export function cornerPoint(K, corner, level) {
  const a = halfSize(K, level);
  const [cx, cz] = CORNERS[((corner % 4) + 4) % 4];
  return [a * cx, level * rise(K), a * cz];
}

// Punkt auf Seite f: s läuft von Ecke f (0) zu Ecke f+1 (1), level ist die Höhe in Ringen
export function facePoint(K, f, s, level) {
  const p = cornerPoint(K, f, level);
  const q = cornerPoint(K, f + 1, level);
  return [p[0] + (q[0] - p[0]) * s, p[1] + (q[1] - p[1]) * s, p[2] + (q[2] - p[2]) * s];
}

export function faceNormal(K, f) {
  const run = (A_BASE - A_TOP) / K;
  const [dx, dz] = OUT[f];
  return norm([dx * rise(K), run, dz * rise(K)]);
}

// Lage eines Feldes. Von außen gesehen wächst der Index nach rechts (eR), eU zeigt bergauf,
// n steht senkrecht auf der Fläche. Es gilt eR x eU = n.
export function cellFrame(K, k, i) {
  const t0 = ((N - 1 - i) / N) * 4;
  const f = Math.min(3, Math.floor(t0 + 1e-9));
  const s0 = t0 - f;
  const s1 = s0 + 4 / N;
  const sm = (s0 + s1) / 2;
  const lm = k + 0.5;
  const center = facePoint(K, f, sm, lm);
  const n = faceNormal(K, f);
  const eR = norm(sub(facePoint(K, f, s0, lm), facePoint(K, f, s1, lm)));
  const upper = facePoint(K, f, sm, k + 1);
  const lower = facePoint(K, f, sm, k);
  // Die Spalten laufen zur Spitze zusammen, deshalb ist "oben" nicht genau senkrecht zu "rechts".
  // Für Bauteile wird ein rechtwinkliges Achsenkreuz gebraucht.
  const rawU = norm(sub(upper, lower));
  const d = rawU[0] * eR[0] + rawU[1] * eR[1] + rawU[2] * eR[2];
  const eU = norm([rawU[0] - d * eR[0], rawU[1] - d * eR[1], rawU[2] - d * eR[2]]);
  return {
    f,
    center,
    n,
    eR,
    eU,
    width: len(sub(facePoint(K, f, s0, lm), facePoint(K, f, s1, lm))),
    height: len(sub(upper, lower)),
    // Ecken: unten links, unten rechts, oben links, oben rechts (von außen gesehen)
    LL: facePoint(K, f, s1, k),
    LR: facePoint(K, f, s0, k),
    UL: facePoint(K, f, s1, k + 1),
    UR: facePoint(K, f, s0, k + 1),
  };
}

// Mittelpunkt der Spitze (Standfläche des Gipfels)
export function apexPoint(K) {
  return [0, pyramidHeight(K) + 0.14, 0];
}
