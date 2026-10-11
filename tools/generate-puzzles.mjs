// Erzeugt js/puzzles.js. Aufruf: node tools/generate-puzzles.mjs
//
// Jedes Rätsel wird mit dem Solver aus js/logic.js geprüft:
//   - es ist mit Drehungen lösbar,
//   - es ist ohne Drehungen NICHT lösbar,
//   - die kürzeste Lösung hat eine Mindestlänge und eine Mindestzahl an Drehungen.
// Der Zufall ist über einen festen Seed reproduzierbar.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SIZE, ORIENTATIONS, canStand, solve } from '../js/logic.js';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'js', 'puzzles.js');

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

// minLen: Mindestzahl an Zügen und Drehungen zusammen (kürzeste Lösung)
const PLAN = [
  { name: 'Der erste Gang', size: 12, minLen: 4, minRot: 1 },
  { name: 'Wand wird Boden', size: 16, minLen: 6, minRot: 1 },
  { name: 'Kopfüber', size: 20, minLen: 7, minRot: 2 },
  { name: 'Drei Achsen', size: 24, minLen: 8, minRot: 2 },
  { name: 'Das Innere', size: 28, minLen: 9, minRot: 2 },
  { name: 'Der Kern', size: 32, minLen: 10, minRot: 3 },
];

const SEED = 20262;
const MAX_ATTEMPTS = 60000;
const SAMPLES_PER_PUZZLE = 3000;
const DIRS6 = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

const k3 = (v) => v.join(',');

function randomShape(rand, size) {
  const cells = new Map();
  const start = [0, 1, 2].map(() => Math.floor(rand() * SIZE));
  cells.set(k3(start), start);
  let guard = 0;
  while (cells.size < size && guard++ < 100000) {
    const list = [...cells.values()];
    const base = list[Math.floor(rand() * list.length)];
    const d = DIRS6[Math.floor(rand() * 6)];
    const n = [base[0] + d[0], base[1] + d[1], base[2] + d[2]];
    if (n.some((c) => c < 0 || c >= SIZE)) continue;
    cells.set(k3(n), n);
  }
  return { cells: [...cells.values()], start };
}

// Größte Entfernung im Gang-Graphen von `start` (Schritte über Nachbarblöcke)
function farthest(cells, start) {
  const set = new Set(cells.map(k3));
  const dist = new Map([[k3(start), 0]]);
  const queue = [start];
  let best = start;
  for (let i = 0; i < queue.length; i++) {
    const v = queue[i];
    if (dist.get(k3(v)) > dist.get(k3(best))) best = v;
    for (const d of DIRS6) {
      const n = [v[0] + d[0], v[1] + d[1], v[2] + d[2]];
      if (set.has(k3(n)) && !dist.has(k3(n))) {
        dist.set(k3(n), dist.get(k3(v)) + 1);
        queue.push(n);
      }
    }
  }
  return best;
}

// Zufällige Gänge lösen sich oft schon nach wenigen Zügen. Deshalb werden viele Kandidaten
// geprüft und der anspruchsvollste behalten, der alle Bedingungen erfüllt.
function buildPuzzle(rand, plan, index) {
  let best = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (best && attempt >= SAMPLES_PER_PUZZLE) break;
    const { cells, start } = randomShape(rand, plan.size);
    const goal = farthest(cells, start);
    if (k3(goal) === k3(start)) continue;

    const set = new Set(cells.map(k3));
    // Ausrichtungen, in denen der Startblock einen Stützblock hat
    const options = ORIENTATIONS.map((_, o) => o).filter((o) => canStand(set, start, o) && o !== 0);
    if (options.length === 0) continue;
    const scramble = options[Math.floor(rand() * options.length)];

    const puzzle = { id: `p${index + 1}`, name: plan.name, cells, start, goal, scramble };
    const withTurns = solve(puzzle);
    if (!withTurns) continue;
    const length = withTurns.moves + withTurns.rotations;
    if (length < plan.minLen || withTurns.rotations < plan.minRot) continue;
    if (solve(puzzle, { allowTurns: false })) continue;

    if (!best || length > best.solution.moves + best.solution.rotations) {
      best = { puzzle, solution: withTurns };
    }
  }
  return best;
}

const rand = mulberry32(SEED);
const results = [];
for (let i = 0; i < PLAN.length; i++) {
  const res = buildPuzzle(rand, PLAN[i], i);
  if (!res) {
    console.error(`Kein Rätsel für "${PLAN[i].name}" gefunden. Parameter lockern.`);
    process.exit(1);
  }
  results.push(res);
  console.log(
    `${res.puzzle.id} ${res.puzzle.name}: ${res.puzzle.cells.length} Blöcke, Lösung ` +
      `${res.solution.moves} Schritte, ${res.solution.rotations} Drehungen`,
  );
}

const body = results
  .map(({ puzzle }) => {
    const cells = puzzle.cells.map((c) => `[${c.join(', ')}]`).join(', ');
    return [
      '  {',
      `    id: '${puzzle.id}',`,
      `    name: '${puzzle.name}',`,
      `    scramble: ${puzzle.scramble},`,
      `    start: [${puzzle.start.join(', ')}],`,
      `    goal: [${puzzle.goal.join(', ')}],`,
      `    cells: [`,
      ...chunk(puzzle.cells.map((c) => `[${c.join(', ')}]`), 8).map((line) => `      ${line.join(', ')},`),
      '    ],',
      '  },',
    ].join('\n');
  })
  .join('\n');

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const file = `// Automatisch erzeugt von tools/generate-puzzles.mjs. Nicht von Hand bearbeiten.
// cells: begehbare Blöcke [x, y, z] im Raster 0..${SIZE - 1}. scramble: Index der Startausrichtung.

export const PUZZLES = [
${body}
];
`;

writeFileSync(OUT, file);
console.log(`geschrieben: ${OUT}`);
