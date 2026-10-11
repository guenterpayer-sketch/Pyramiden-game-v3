// Reine Spiellogik ohne Three.js. Wird vom Spiel, vom Rätselgenerator und von den Tests genutzt.
//
// Aufbau: Die Pyramide besteht aus drei Stufen (Ebenen). Jede Stufe ist ein quadratisches Raster.
// Begehbar ist nur der Rand (Ring) der Stufe. Der Kern in der Mitte wird von der nächsten Stufe
// überdeckt. Jede Stufe kann um 90° gedreht werden. Der Spieler steht immer auf einem Feld
// einer Stufe. Seine Position wird in Basiskoordinaten gespeichert, also in der unverdrehten
// Ausrichtung der Stufe. Dadurch wandert er beim Drehen automatisch mit.
//
// Zeichen im Rätselraster:
//   '.' Boden     'S' Treppe (begehbar, verbindet zwei Stufen)   'P' Start   'G' Gipfel (Ziel)
//   '#' Mauer (nicht begehbar)      '_' Kern (massiv, nicht begehbar)

export const TIERS = [
  { n: 13, w: 3 }, // unterste Stufe: 13x13, Ring 3 Felder breit
  { n: 7, w: 2 }, // mittlere Stufe: 7x7, Ring 2 Felder breit
  { n: 3, w: 2 }, // Gipfel: 3x3, komplett begehbar
];

const WALKABLE = '.SPG';
export const DIRS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

// Versatz einer Stufe im gemeinsamen Grundriss, damit alle Stufen mittig übereinander stehen
export function offset(k) {
  return (TIERS[0].n - TIERS[k].n) / 2;
}

// Dreht ein Feld um `steps` Viertelkreise im Uhrzeigersinn (Draufsicht) in einem n x n Raster
export function rotCell(x, y, n, steps) {
  let r = ((steps % 4) + 4) % 4;
  while (r--) [x, y] = [n - 1 - y, x];
  return [x, y];
}

export function charAt(p, k, x, y) {
  const row = p.tiers[k][y];
  return row === undefined ? undefined : row[x];
}

export function isStair(p, k, x, y) {
  return charAt(p, k, x, y) === 'S';
}

// Basiskoordinaten einer Stufe -> globaler Grundriss
export function toGlobal(k, r, x, y) {
  const [lx, ly] = rotCell(x, y, TIERS[k].n, r);
  return [lx + offset(k), ly + offset(k)];
}

// Globaler Grundriss -> Basiskoordinaten. Liegt das Feld außerhalb der Stufe, kommt null zurück.
export function toBase(k, r, gx, gy) {
  const n = TIERS[k].n;
  const lx = gx - offset(k);
  const ly = gy - offset(k);
  if (lx < 0 || ly < 0 || lx >= n || ly >= n) return null;
  return rotCell(lx, ly, n, 4 - r);
}

// Basiskoordinaten eines begehbaren Feldes, wenn es globale Position (gx, gy) hat, sonst null
function walkableAt(p, k, gx, gy, r) {
  const b = toBase(k, r, gx, gy);
  if (!b) return null;
  const ch = charAt(p, k, b[0], b[1]);
  return ch !== undefined && WALKABLE.includes(ch) ? b : null;
}

function findChar(p, k, ch) {
  for (let y = 0; y < p.tiers[k].length; y++) {
    const x = p.tiers[k][y].indexOf(ch);
    if (x >= 0) return [x, y];
  }
  return null;
}

export function startOf(p) {
  return findChar(p, 0, 'P');
}

export function goalOf(p) {
  return findChar(p, TIERS.length - 1, 'G');
}

export function newState(p) {
  const [x, y] = startOf(p);
  return { lvl: 0, x, y, rot: [...p.scramble] };
}

// Versucht einen Schritt (dx, dy) im aktuellen Grundriss. Gibt den neuen Zustand oder null zurück.
// Ein Schritt auf eine begehbare Nachbarfläche derselben Stufe ist immer möglich.
// Ein Wechsel auf eine andere Stufe klappt nur, wenn Startfeld und Zielfeld Treppen sind
// und sie im Grundriss direkt nebeneinander liegen.
export function move(p, s, dx, dy) {
  const k = s.lvl;
  const [gx, gy] = toGlobal(k, s.rot[k], s.x, s.y);
  const nx = gx + dx;
  const ny = gy + dy;

  const same = walkableAt(p, k, nx, ny, s.rot[k]);
  if (same) return { ...s, rot: [...s.rot], x: same[0], y: same[1] };

  if (!isStair(p, k, s.x, s.y)) return null;
  for (const k2 of [k - 1, k + 1]) {
    if (k2 < 0 || k2 >= TIERS.length) continue;
    const b = walkableAt(p, k2, nx, ny, s.rot[k2]);
    if (b && isStair(p, k2, b[0], b[1])) {
      return { lvl: k2, x: b[0], y: b[1], rot: [...s.rot] };
    }
  }
  return null;
}

// Dreht eine Stufe um 90° (dir = 1 im Uhrzeigersinn, dir = -1 dagegen). Der Spieler bleibt stehen
// und wandert mit seiner Stufe mit.
export function rotate(s, k, dir) {
  const rot = [...s.rot];
  rot[k] = (((rot[k] + dir) % 4) + 4) % 4;
  return { ...s, rot };
}

export function won(p, s) {
  return s.lvl === TIERS.length - 1 && charAt(p, s.lvl, s.x, s.y) === 'G';
}

// Sucht die kürzeste Lösung per Breitensuche. Gibt { actions, moves, rotations } oder null zurück.
export function solve(p, { allowRotate = true } = {}) {
  const keyOf = (s) => `${s.rot.join('')}|${s.lvl}|${s.x},${s.y}`;
  const s0 = newState(p);
  const seen = new Map([[keyOf(s0), null]]);
  const queue = [s0];

  for (let i = 0; i < queue.length; i++) {
    const s = queue[i];
    if (won(p, s)) {
      const actions = [];
      let entry = seen.get(keyOf(s));
      while (entry) {
        actions.unshift(entry.action);
        entry = seen.get(entry.prev);
      }
      return {
        actions,
        moves: actions.filter((a) => a.type === 'move').length,
        rotations: actions.filter((a) => a.type === 'rotate').length,
      };
    }

    const options = DIRS.map(([dx, dy]) => [move(p, s, dx, dy), { type: 'move', dx, dy }]);
    if (allowRotate) {
      for (let k = 0; k < TIERS.length; k++) {
        for (const dir of [1, -1]) options.push([rotate(s, k, dir), { type: 'rotate', lvl: k, dir }]);
      }
    }

    for (const [ns, action] of options) {
      if (!ns) continue;
      const key = keyOf(ns);
      if (seen.has(key)) continue;
      seen.set(key, { prev: keyOf(s), action });
      queue.push(ns);
    }
  }
  return null;
}
