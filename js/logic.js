// Innenräume: reine Spiellogik ohne Three.js. Wird vom Spiel, vom Generator und von den Tests genutzt.
//
// Die Pyramide ist ein Würfelraster von SIZE x SIZE x SIZE Feldern. Begehbar sind nur die
// Blöcke aus `cells` (die Gänge im Inneren). Die Schwerkraft zeigt immer nach unten (-y).
// Die ganze Pyramide kann um die Achsen x, y und z in 90°-Schritten gedreht werden.
//
// Positionen des Spielers werden in Basiskoordinaten gespeichert (unverdrehte Pyramide).
// Der Spieler steht auf dem Block `v`, wenn unter ihm in der aktuellen Ausrichtung ein Stützblock liegt.
// Das gilt genau dann, wenn `v + R^T * (0,-1,0)` ein Block der Pyramide ist, mit R der Ausrichtung.

export const SIZE = 5;
export const CENTER = 2; // Mitte des Rasters (SIZE - 1) / 2, ganzzahlig

const DOWN = [0, -1, 0];

// Grunddrehungen um je 90° (Zeilen-Major, 9 Einträge)
const AXIS = {
  x: [1, 0, 0, 0, 0, -1, 0, 1, 0],
  y: [0, 0, 1, 0, 1, 0, -1, 0, 0],
  z: [0, -1, 0, 1, 0, 0, 0, 0, 1],
};

export function mulMat(a, b) {
  const out = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      for (let k = 0; k < 3; k++) out[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
    }
  }
  return out;
}

export function transpose(a) {
  return [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];
}

export function mulVec(m, v) {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

// Alle 24 Ausrichtungen, erzeugt durch Drehungen um die Weltachsen. Index 0 ist die Grundlage.
export const ORIENTATIONS = (() => {
  const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const list = [identity];
  const seen = new Set([identity.join(',')]);
  for (let i = 0; i < list.length; i++) {
    for (const axis of ['x', 'y', 'z']) {
      const m = mulMat(AXIS[axis], list[i]);
      if (!seen.has(m.join(','))) {
        seen.add(m.join(','));
        list.push(m);
      }
    }
  }
  return list;
})();

// Aktionen: Drehung der ganzen Pyramide um eine Weltachse. dir = 1 ist positiv, dir = -1 negativ.
export const TURNS = [
  { key: 'y+', axis: 'y', dir: 1 },
  { key: 'y-', axis: 'y', dir: -1 },
  { key: 'x+', axis: 'x', dir: 1 },
  { key: 'x-', axis: 'x', dir: -1 },
  { key: 'z+', axis: 'z', dir: 1 },
  { key: 'z-', axis: 'z', dir: -1 },
];

export function turnedOrientation(o, turn) {
  const g = turn.dir > 0 ? AXIS[turn.axis] : transpose(AXIS[turn.axis]);
  const m = mulMat(g, ORIENTATIONS[o]);
  return ORIENTATIONS.findIndex((x) => x.join(',') === m.join(','));
}

// Die vier Schritte auf der Ebene (in Weltkoordinaten)
export const WALK = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
];

const key = (v) => v.join(',');
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

function cellSet(p) {
  return new Set(p.cells.map((c) => key(c)));
}

// Ein Feld ist begehbar, wenn es zur Pyramide gehört und darunter (in der Ausrichtung o) ein Stützblock liegt.
export function canStand(set, v, o) {
  if (!set.has(key(v))) return false;
  const below = add(v, mulVec(transpose(ORIENTATIONS[o]), DOWN));
  return set.has(key(below));
}

export function startState(p) {
  return { o: p.scramble, v: [...p.start] };
}

// Schritt auf der Ebene in Weltrichtung d. Gibt den neuen Zustand oder null zurück.
export function move(p, s, d) {
  const set = cellSet(p);
  const target = add(s.v, mulVec(transpose(ORIENTATIONS[s.o]), d));
  if (!canStand(set, target, s.o)) return null;
  return { o: s.o, v: target };
}

// Drehung der ganzen Pyramide. Nur erlaubt, wenn der Spieler danach noch stehen kann.
export function turn(p, s, turnAction) {
  const set = cellSet(p);
  const o = turnedOrientation(s.o, turnAction);
  if (!canStand(set, s.v, o)) return null;
  return { o, v: s.v };
}

export function won(p, s) {
  return key(s.v) === key(p.goal);
}

// Kürzeste Lösung per Breitensuche. Gibt { actions, moves, rotations } oder null zurück.
export function solve(p, { allowTurns = true } = {}) {
  const stateKey = (s) => `${s.o}|${key(s.v)}`;
  const s0 = startState(p);
  const seen = new Map([[stateKey(s0), null]]);
  const queue = [s0];

  for (let i = 0; i < queue.length; i++) {
    const s = queue[i];
    if (won(p, s)) {
      const actions = [];
      let entry = seen.get(stateKey(s));
      while (entry) {
        actions.unshift(entry.action);
        entry = seen.get(entry.prev);
      }
      return {
        actions,
        moves: actions.filter((a) => a.type === 'move').length,
        rotations: actions.filter((a) => a.type === 'turn').length,
      };
    }

    const options = WALK.map((d) => [move(p, s, d), { type: 'move', d }]);
    if (allowTurns) for (const t of TURNS) options.push([turn(p, s, t), { type: 'turn', key: t.key }]);

    for (const [ns, action] of options) {
      if (!ns) continue;
      const k = stateKey(ns);
      if (seen.has(k)) continue;
      seen.set(k, { prev: stateKey(s), action });
      queue.push(ns);
    }
  }
  return null;
}
