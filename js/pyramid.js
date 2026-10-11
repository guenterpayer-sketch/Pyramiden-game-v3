// Pyramiden-Labyrinth: Geometrie und Labyrinth-Logik ohne Three.js.
//
// Die Pyramide ist ein Stumpf mit vier Seiten und einem goldenen Plateau oben. Ihre Hänge sind in
// Ringe (Stufen) aus Feldern aufgeteilt. Ring k hat auf jeder Seite 2*(K-k)+1 Felder.
// Jedes Feld ist ein Knoten. Zwei Felder, die sich einen Rand teilen, sind durch eine Kante
// verbunden. Das Labyrinth ist die Menge der Kanten, die offen sind. Alle anderen Ränder
// bekommen eine Mauer.
//
// Koordinaten: x nach rechts, y nach oben, z zur Kamera. Eine Einheit ist eine Feldbreite.

export const RISE = 0.75; // Höhe eines Rings
const CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];
// Nach außen zeigende Richtung jeder Seite im Grundriss (x, z)
export const OUT = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

export const ringCells = (K, k) => 2 * (K - k) + 1;
export const halfSize = (K, level) => K + 1 - level;
export const pyramidHeight = (K) => K * RISE;

// ---------- Geometrie ----------

export function cornerPoint(K, corner, level) {
  const a = halfSize(K, level);
  const [cx, cz] = CORNERS[((corner % 4) + 4) % 4];
  return [a * cx, level * RISE, a * cz];
}

// Punkt auf Seite f. s läuft von der Ecke f (0) zur Ecke f+1 (1), level ist die Höhe in Ringen.
export function facePoint(K, f, s, level) {
  const p = cornerPoint(K, f, level);
  const q = cornerPoint(K, f + 1, level);
  return [p[0] + (q[0] - p[0]) * s, p[1] + (q[1] - p[1]) * s, p[2] + (q[2] - p[2]) * s];
}

function normalize(v) {
  const len = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / len, v[1] / len, v[2] / len];
}

export function faceNormal(f) {
  const [dx, dz] = OUT[f];
  return normalize([dx * RISE, 1, dz * RISE]);
}

// Vier Eckpunkte eines Feldes und sein Mittelpunkt
export function cellGeometry(pyr, id) {
  const node = pyr.nodes[id];
  const { K } = pyr;
  if (node.apex) {
    const y = pyramidHeight(K);
    return { center: [0, y, 0], normal: [0, 1, 0], quad: null };
  }
  const ring = pyr.rings[node.ring];
  const s0 = node.u / ring.m;
  const s1 = (node.u + 1) / ring.m;
  const k = node.ring;
  return {
    center: facePoint(K, node.f, (node.u + 0.5) / ring.m, k + 0.5),
    normal: faceNormal(node.f),
    quad: [facePoint(K, node.f, s0, k), facePoint(K, node.f, s1, k), facePoint(K, node.f, s1, k + 1), facePoint(K, node.f, s0, k + 1)],
  };
}

// Endpunkte und Ausrichtung einer Mauer an einem Rand
export function segmentGeometry(pyr, seg) {
  const { K } = pyr;
  if (seg.type === 'side') {
    return { p0: facePoint(K, seg.f, seg.s, seg.ring), p1: facePoint(K, seg.f, seg.s, seg.ring + 1), normal: faceNormal(seg.f) };
  }
  if (seg.type === 'ridge') {
    const a = faceNormal((seg.corner + 3) % 4);
    const b = faceNormal(seg.corner % 4);
    return {
      p0: cornerPoint(K, seg.corner, seg.ring),
      p1: cornerPoint(K, seg.corner, seg.ring + 1),
      normal: normalize([a[0] + b[0], a[1] + b[1], a[2] + b[2]]),
    };
  }
  // 'level': waagerechter Rand zwischen zwei Ringen (oder zwischen oberstem Ring und Plateau)
  return { p0: facePoint(K, seg.f, seg.sa, seg.level), p1: facePoint(K, seg.f, seg.sb, seg.level), normal: faceNormal(seg.f) };
}

// Mauer rund um den Fuß der Pyramide
export function baseWalls(pyr) {
  const out = [];
  for (let f = 0; f < 4; f++) {
    out.push({ p0: facePoint(pyr.K, f, 0, 0), p1: facePoint(pyr.K, f, 1, 0), normal: faceNormal(f) });
  }
  return out;
}

// ---------- Aufbau des Graphen ----------

export function buildPyramid(K) {
  const rings = [];
  let offset = 0;
  for (let k = 0; k < K; k++) {
    const m = ringCells(K, k);
    rings.push({ k, m, offset, count: 4 * m });
    offset += 4 * m;
  }
  const apex = offset;
  const nodeCount = offset + 1;

  const nodes = new Array(nodeCount);
  for (const r of rings) {
    for (let i = 0; i < r.count; i++) nodes[r.offset + i] = { ring: r.k, f: Math.floor(i / r.m), u: i % r.m };
  }
  nodes[apex] = { ring: K, f: -1, u: 0, apex: true };

  const edges = [];
  const adj = Array.from({ length: nodeCount }, () => []);
  const addEdge = (a, b, seg) => {
    const edge = edges.length;
    edges.push({ a, b, seg });
    adj[a].push({ to: b, edge });
    adj[b].push({ to: a, edge });
  };

  // Nachbarn im selben Ring (auch um die Ecken der Pyramide herum)
  for (const r of rings) {
    for (let i = 0; i < r.count; i++) {
      const f = Math.floor(i / r.m);
      const u = i % r.m;
      const j = (i + 1) % r.count;
      const seg =
        u < r.m - 1 ? { type: 'side', f, ring: r.k, s: (u + 1) / r.m } : { type: 'ridge', corner: (f + 1) % 4, ring: r.k };
      addEdge(r.offset + i, r.offset + j, seg);
    }
  }

  // Übergänge zwischen zwei Ringen: überall dort, wo sich ihre Felder am Rand berühren
  for (let k = 0; k < K - 1; k++) {
    const lo = rings[k];
    const up = rings[k + 1];
    for (let f = 0; f < 4; f++) {
      const cuts = new Set([0, 1]);
      for (let u = 1; u < lo.m; u++) cuts.add(u / lo.m);
      for (let u = 1; u < up.m; u++) cuts.add(u / up.m);
      const pts = [...cuts].sort((x, y) => x - y);
      for (let i = 0; i + 1 < pts.length; i++) {
        const sa = pts[i];
        const sb = pts[i + 1];
        if (sb - sa < 1e-9) continue;
        const mid = (sa + sb) / 2;
        const ul = Math.min(lo.m - 1, Math.floor(mid * lo.m));
        const uu = Math.min(up.m - 1, Math.floor(mid * up.m));
        addEdge(lo.offset + f * lo.m + ul, up.offset + f * up.m + uu, { type: 'level', f, level: k + 1, sa, sb });
      }
    }
  }

  // Oberster Ring zum goldenen Plateau
  const top = rings[K - 1];
  for (let i = 0; i < top.count; i++) {
    const f = Math.floor(i / top.m);
    const u = i % top.m;
    addEdge(top.offset + i, apex, { type: 'level', f, level: K, sa: u / top.m, sb: (u + 1) / top.m });
  }

  return { K, rings, nodes, apex, nodeCount, edges, adj };
}

// ---------- Labyrinth ----------

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Entfernungen (in Schritten) über offene Kanten, -1 = nicht erreichbar
export function distancesFrom(pyr, open, src) {
  const dist = new Int32Array(pyr.nodeCount).fill(-1);
  dist[src] = 0;
  const queue = [src];
  for (let i = 0; i < queue.length; i++) {
    const v = queue[i];
    for (const { to, edge } of pyr.adj[v]) {
      if (open[edge] && dist[to] < 0) {
        dist[to] = dist[v] + 1;
        queue.push(to);
      }
    }
  }
  return dist;
}

export function openNeighbors(level, id) {
  return level.pyr.adj[id].filter((n) => level.open[n.edge]).map((n) => n.to);
}

// Kürzester Weg von `from` nach `to` über offene Kanten (inklusive beider Enden) oder null
export function shortestPath(level, from, to) {
  const { pyr, open } = level;
  const prev = new Int32Array(pyr.nodeCount).fill(-2);
  prev[from] = -1;
  const queue = [from];
  for (let i = 0; i < queue.length && prev[to] === -2; i++) {
    const v = queue[i];
    for (const { to: w, edge } of pyr.adj[v]) {
      if (open[edge] && prev[w] === -2) {
        prev[w] = v;
        queue.push(w);
      }
    }
  }
  if (prev[to] === -2) return null;
  const path = [];
  for (let v = to; v !== -1; v = prev[v]) path.unshift(v);
  return path;
}

// Erzeugt ein Labyrinth. Zuerst ein Spannbaum, damit jedes Feld erreichbar ist und es genau einen
// Weg zwischen zwei Feldern gibt. Danach werden einige Mauern zufällig geöffnet, damit es auch Umwege gibt.
export function buildLevel(spec) {
  const pyr = buildPyramid(spec.K);
  const rand = mulberry32(spec.seed);
  const open = new Uint8Array(pyr.edges.length);

  const visited = new Uint8Array(pyr.nodeCount);
  const first = Math.floor(rand() * pyr.nodeCount);
  visited[first] = 1;
  const stack = [first];
  while (stack.length) {
    const v = stack[stack.length - 1];
    const options = pyr.adj[v].filter((n) => !visited[n.to]);
    if (options.length === 0) {
      stack.pop();
      continue;
    }
    const pick = options[Math.floor(rand() * options.length)];
    open[pick.edge] = 1;
    visited[pick.to] = 1;
    stack.push(pick.to);
  }

  for (let e = 0; e < open.length; e++) {
    if (!open[e] && rand() < (spec.loops ?? 0)) open[e] = 1;
  }

  // Start: das Feld am Fuß der Pyramide mit dem weitesten Weg zur Spitze
  const fromApex = distancesFrom(pyr, open, pyr.apex);
  let start = pyr.rings[0].offset;
  for (let i = 0; i < pyr.rings[0].count; i++) {
    const id = pyr.rings[0].offset + i;
    if (fromApex[id] > fromApex[start]) start = id;
  }

  const level = { spec, pyr, open, start, apex: pyr.apex };
  level.solution = shortestPath(level, start, pyr.apex);
  level.stars = pickStars(level, 3);
  return level;
}

// Sterne liegen in Sackgassen abseits des kürzesten Weges
function pickStars(level, count) {
  const { pyr, open, solution, start } = level;
  const onPath = new Set(solution);
  // Abstand jedes Feldes zum kürzesten Weg
  const toPath = new Int32Array(pyr.nodeCount).fill(-1);
  const queue = [...solution];
  for (const v of solution) toPath[v] = 0;
  for (let i = 0; i < queue.length; i++) {
    const v = queue[i];
    for (const { to, edge } of pyr.adj[v]) {
      if (open[edge] && toPath[to] < 0) {
        toPath[to] = toPath[v] + 1;
        queue.push(to);
      }
    }
  }
  const deadEnds = [];
  for (let id = 0; id < pyr.nodeCount; id++) {
    if (id === start || id === pyr.apex || onPath.has(id)) continue;
    const deg = pyr.adj[id].filter((n) => open[n.edge]).length;
    if (deg === 1) deadEnds.push(id);
  }
  deadEnds.sort((a, b) => toPath[b] - toPath[a] || a - b);
  const chosen = [];
  for (const id of deadEnds) {
    if (chosen.length >= count) break;
    const d = distancesFrom(pyr, open, id);
    if (chosen.every((c) => d[c] >= 5)) chosen.push(id);
  }
  return chosen;
}
