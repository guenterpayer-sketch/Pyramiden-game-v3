// Erzeugt js/levels.js. Aufruf: node tools/generate-levels.mjs
//
// Vorgehen für jedes Rätsel:
//  1. Einen Lichtweg vom Sender zur Spitze bauen (abwechselnd waagerecht und aufwärts, mit Spiegeln an den Knicken).
//  2. Kristalle auf den Weg setzen, Prismen an einigen Knicken (mit einem Kristall am geraden Ausgang).
//  3. Täuschungen (zusätzliche Spiegel, feste Spiegel, Sperrsteine) abseits des Weges verteilen.
//  4. Die drehbaren Spiegel zufällig verstellen.
//  5. Alle Stellungen durchprobieren: Es muss genau eine oder sehr wenige Lösungen geben, und es müssen
//     mindestens `minFlip` Bauteile umgelegt werden.
// Der Zufall ist über einen festen Seed reproduzierbar.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { N, DIR, stepFrom, cellId, reflect, solveAll, rotatableIndices, distance } from '../js/board.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'js', 'levels.js');
const SEED = 7311;

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

const PLAN = [
  { name: 'Erster Funke', K: 3, P: 2, crystals: 0, splitters: 0, decoyM: 1, decoyF: 0, blockers: 3, minFlip: 2, maxSol: 1, target: 120 },
  { name: 'Umweg', K: 4, P: 2, crystals: 1, splitters: 0, decoyM: 2, decoyF: 1, blockers: 4, minFlip: 3, maxSol: 1, target: 180 },
  { name: 'Um die Ecke', K: 4, P: 3, crystals: 1, splitters: 0, decoyM: 3, decoyF: 1, blockers: 5, minFlip: 3, maxSol: 1, target: 240 },
  { name: 'Prisma', K: 5, P: 3, crystals: 1, splitters: 1, decoyM: 3, decoyF: 2, blockers: 6, minFlip: 4, maxSol: 1, target: 300 },
  { name: 'Doppelstrahl', K: 6, P: 3, crystals: 2, splitters: 2, decoyM: 4, decoyF: 2, blockers: 6, minFlip: 5, maxSol: 1, target: 420 },
  { name: 'Gipfelglanz', K: 7, P: 4, crystals: 2, splitters: 2, decoyM: 5, decoyF: 3, blockers: 8, minFlip: 6, maxSol: 1, target: 540 },
];

const orientFor = (din, dout) => {
  for (const o of [0, 1]) if (reflect(din, o) === dout) return o;
  throw new Error('kein Spiegel für diese Ablenkung');
};

// Baut den lösenden Weg. Gibt { emitter, path } oder null zurück.
function buildPath(rand, spec) {
  const { K, P } = spec;
  const used = new Set();
  let k = 0;
  let i = Math.floor(rand() * N);
  const emitter = { k, i, dir: rand() < 0.5 ? DIR.R : DIR.L };
  used.add(cellId(k, i));
  const path = [];
  let dir = emitter.dir;

  const push = (din, dout) => {
    const id = cellId(k, i);
    if (used.has(id)) return false;
    used.add(id);
    path.push({ k, i, turn: false, din, dout });
    return true;
  };

  for (let p = 0; p < P; p++) {
    const lh = 1 + Math.floor(rand() * 4);
    for (let s = 0; s < lh; s++) {
      const nx = stepFrom(K, k, i, dir);
      k = nx.k;
      i = nx.i;
      if (!push(dir, dir)) return null;
    }
    path[path.length - 1].turn = true;
    path[path.length - 1].dout = DIR.U;

    if (p < P - 1) {
      const room = K - 1 - k;
      if (room < 1) return null;
      const u = 1 + Math.floor(rand() * room);
      for (let s = 0; s < u; s++) {
        k += 1;
        if (!push(DIR.U, DIR.U)) return null;
      }
      const nextDir = rand() < 0.5 ? DIR.R : DIR.L;
      path[path.length - 1].turn = true;
      path[path.length - 1].dout = nextDir;
      dir = nextDir;
    } else {
      while (k + 1 <= K - 1) {
        k += 1;
        if (!push(DIR.U, DIR.U)) return null;
      }
    }
  }
  return { emitter, path, used };
}

function buildLevel(rand, spec, index) {
  const built = buildPath(rand, spec);
  if (!built) return null;
  const { emitter, path, used } = built;
  const { K } = spec;
  const comps = [];
  const take = (k, i) => used.add(cellId(k, i));
  const free = (k, i) => k >= 0 && k < K && !used.has(cellId(k, i));

  // Prismen: an einigen Knicken, mit Kristall am geraden Ausgang und Sperrstein dahinter
  const turns = path.filter((c) => c.turn);
  const splitterCells = new Set();
  let crystalsLeft = spec.crystals;
  for (const t of [...turns].sort(() => rand() - 0.5)) {
    if (splitterCells.size >= spec.splitters) break;
    const n1 = stepFrom(K, t.k, t.i, t.din);
    if (n1.apex || n1.out || !free(n1.k, n1.i)) continue;
    const n2 = stepFrom(K, n1.k, n1.i, t.din);
    splitterCells.add(cellId(t.k, t.i));
    comps.push({ k: n1.k, i: n1.i, t: 'C' });
    take(n1.k, n1.i);
    crystalsLeft = Math.max(0, crystalsLeft - 1);
    if (!n2.apex && !n2.out && free(n2.k, n2.i)) {
      comps.push({ k: n2.k, i: n2.i, t: 'B' });
      take(n2.k, n2.i);
    }
  }
  if (splitterCells.size < spec.splitters) return null;

  for (const c of path) {
    if (c.turn) {
      comps.push({ k: c.k, i: c.i, t: splitterCells.has(cellId(c.k, c.i)) ? 'S' : 'M', o: 0, sol: orientFor(c.din, c.dout) });
    }
  }
  // Kristalle auf geraden Wegstücken
  const straight = path.filter((c) => !c.turn);
  for (const c of [...straight].sort(() => rand() - 0.5).slice(0, crystalsLeft)) comps.push({ k: c.k, i: c.i, t: 'C' });

  // Täuschungen abseits des Weges
  const place = (t, extra = {}) => {
    for (let tries = 0; tries < 80; tries++) {
      const k = Math.floor(rand() * K);
      const i = Math.floor(rand() * N);
      if (!free(k, i)) continue;
      take(k, i);
      comps.push({ k, i, t, ...extra });
      return true;
    }
    return false;
  };
  for (let n = 0; n < spec.decoyM; n++) if (!place('M', { o: 0, sol: null })) return null;
  for (let n = 0; n < spec.decoyF; n++) if (!place('F', { o: rand() < 0.5 ? 0 : 1 })) return null;
  for (let n = 0; n < spec.blockers; n++) if (!place('B')) return null;

  // Reihenfolge festlegen, damit alles reproduzierbar bleibt
  comps.sort((a, b) => a.k - b.k || a.i - b.i);
  const level = { id: `l${index + 1}`, name: spec.name, K, target: spec.target, emitter, comps };

  // Verstellen: zufällige Anfangsstellung
  const rot = rotatableIndices(level);
  const solutions = solveAll(level);
  if (solutions.length === 0 || solutions.length > spec.maxSol) return null;

  for (let tries = 0; tries < 30; tries++) {
    const orient = new Array(comps.length).fill(0);
    for (const idx of rot) orient[idx] = rand() < 0.5 ? 0 : 1;
    const best = solutions.reduce((a, s) => (distance(level, orient, s) < distance(level, orient, a) ? s : a), solutions[0]);
    if (distance(level, orient, best) < spec.minFlip) continue;
    // Anfangsstellung und nächste Lösung eintragen
    for (const idx of rot) {
      comps[idx].o = orient[idx];
      comps[idx].sol = best[idx];
    }
    for (const c of comps) {
      if (c.t !== 'M' && c.t !== 'S') delete c.sol;
    }
    return { level, solutions: solutions.length, flips: distance(level, orient, best), rotatable: rot.length };
  }
  return null;
}

const rand = mulberry32(SEED);
const results = [];
for (let idx = 0; idx < PLAN.length; idx++) {
  let found = null;
  for (let attempt = 0; attempt < 20000 && !found; attempt++) found = buildLevel(rand, PLAN[idx], idx);
  if (!found) {
    console.error(`Kein Rätsel für "${PLAN[idx].name}" gefunden. Parameter lockern.`);
    process.exit(1);
  }
  results.push(found);
  console.log(
    `${found.level.id} ${found.level.name}: K=${found.level.K}, Bauteile ${found.level.comps.length}, drehbar ${found.rotatable}, ` +
      `Lösungen ${found.solutions}, umzulegen ${found.flips}`,
  );
}

const fmtComp = (c) => {
  const parts = [`k: ${c.k}`, `i: ${c.i}`, `t: '${c.t}'`];
  if (c.o !== undefined) parts.push(`o: ${c.o}`);
  if (c.sol !== undefined) parts.push(`sol: ${c.sol}`);
  return `{ ${parts.join(', ')} }`;
};
const body = results
  .map(({ level }) => {
    const e = level.emitter;
    return [
      '  {',
      `    id: '${level.id}',`,
      `    name: '${level.name}',`,
      `    K: ${level.K},`,
      `    target: ${level.target},`,
      `    emitter: { k: ${e.k}, i: ${e.i}, dir: ${e.dir} },`,
      '    comps: [',
      ...level.comps.map((c) => `      ${fmtComp(c)},`),
      '    ],',
      '  },',
    ].join('\n');
  })
  .join('\n');

writeFileSync(
  OUT,
  `// Automatisch erzeugt von tools/generate-levels.mjs. Nicht von Hand bearbeiten.
// Bauteile: M drehbarer Spiegel, F fester Spiegel, S Prisma, B Sperrstein, C Kristall.
// o: Stellung (0 = '/', 1 = '\\\\'). sol: Stellung in der Lösung (nur drehbare Bauteile).
// Richtungen: 0 = oben, 1 = rechts, 2 = unten, 3 = links.

export const LEVELS = [
${body}
];
`,
);
console.log(`geschrieben: ${OUT}`);
