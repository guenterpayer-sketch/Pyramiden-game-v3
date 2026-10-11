// Erzeugt js/puzzles.js. Aufruf: node tools/generate-puzzles.mjs
//
// Jedes Rätsel wird mit dem Solver aus js/logic.js geprüft:
//   - es ist mit Drehungen lösbar,
//   - es ist ohne Drehungen NICHT lösbar,
//   - die kürzeste Lösung hat eine Mindestlänge und eine Mindestzahl an Drehungen.
// Der Zufall ist festgelegt (Seed), damit das Ergebnis reproduzierbar ist.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TIERS, solve } from '../js/logic.js';

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

const PLAN = [
  { name: 'Der erste Schritt', q0: 0.1, q1: 0.1, minLen: 20, minRot: 2 },
  { name: 'Eine Treppe weiter', q0: 0.14, q1: 0.12, minLen: 30, minRot: 2 },
  { name: 'Drehen lohnt sich', q0: 0.17, q1: 0.15, minLen: 40, minRot: 2 },
  { name: 'Stufe um Stufe', q0: 0.2, q1: 0.18, minLen: 50, minRot: 3 },
  { name: 'Der Weg hinauf', q0: 0.22, q1: 0.2, minLen: 60, minRot: 3 },
  { name: 'Die Spitze', q0: 0.25, q1: 0.22, minLen: 70, minRot: 3 },
];

const SEED = 20260;
const MAX_ATTEMPTS = 20000;

function buildPuzzle(rand, plan, index) {
  // Stufe 0: Ring 3 breit, Kern 7x7 in der Mitte
  const n0 = TIERS[0].n;
  const grid0 = Array.from({ length: n0 }, (_, y) =>
    Array.from({ length: n0 }, (_, x) => (isCore(x, y, n0, TIERS[0].w) ? '_' : '.')),
  );
  // Stufe 1: Ring 2 breit, Kern 3x3
  const n1 = TIERS[1].n;
  const grid1 = Array.from({ length: n1 }, (_, y) =>
    Array.from({ length: n1 }, (_, x) => (isCore(x, y, n1, TIERS[1].w) ? '_' : '.')),
  );
  // Stufe 2: komplett begehbar, Ziel in der Mitte
  const grid2 = Array.from({ length: TIERS[2].n }, () => Array(TIERS[2].n).fill('.'));
  grid2[1][1] = 'G';

  const ringCells = (grid, n, w) => {
    const cells = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!isCore(x, y, n, w)) cells.push([x, y]);
    return cells;
  };

  // Treppen Stufe 0 -> 1: Felder am inneren Rand von Stufe 0 (direkt neben dem Kern)
  const inner0 = ringCells(grid0, n0, TIERS[0].w).filter(([x, y]) => touchesCore(x, y, n0, TIERS[0].w));
  // Gegenstück auf Stufe 1: äußerster Ring
  const outer1 = ringCells(grid1, n1, TIERS[1].w).filter(([x, y]) => edgeOf(x, y, n1) === 0);
  // Treppen Stufe 1 -> 2: innerer Ring von Stufe 1 (neben dem Kern) und Rand von Stufe 2
  const inner1 = ringCells(grid1, n1, TIERS[1].w).filter(([x, y]) => edgeOf(x, y, n1) === 1 && touchesCore(x, y, n1, TIERS[1].w));
  const border2 = [...ringCells(grid2, 3, 2)].filter(([x, y]) => !(x === 1 && y === 1));

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const g0 = grid0.map((r) => [...r]);
    const g1 = grid1.map((r) => [...r]);
    const g2 = grid2.map((r) => [...r]);

    const stairs0 = pick(rand, inner0, 2);
    const landing1 = pick(rand, outer1, 2);
    const stairs1 = pick(rand, inner1, 2);
    const landing2 = pick(rand, border2, 2);
    if (!stairs0 || !landing1 || !stairs1 || !landing2) continue;

    for (const [x, y] of ringCells(g0, n0, TIERS[0].w)) if (rand() < plan.q0) g0[y][x] = '#';
    for (const [x, y] of ringCells(g1, n1, TIERS[1].w)) if (rand() < plan.q1) g1[y][x] = '#';
    for (const [x, y] of stairs0) g0[y][x] = 'S';
    for (const [x, y] of landing1) g1[y][x] = 'S';
    for (const [x, y] of stairs1) g1[y][x] = 'S';
    for (const [x, y] of landing2) g2[y][x] = 'S';

    // Startfeld: ein freier Ringboden auf Stufe 0
    const freeStart = ringCells(g0, n0, TIERS[0].w).filter(([x, y]) => g0[y][x] === '.');
    const [sx, sy] = freeStart[Math.floor(rand() * freeStart.length)];
    g0[sy][sx] = 'P';

    const scramble = [0, 1, 2].map(() => Math.floor(rand() * 4));
    if (scramble.every((v) => v === 0)) continue;

    const puzzle = { id: `p${index + 1}`, name: plan.name, scramble, tiers: [g0, g1, g2].map((g) => g.map((r) => r.join(''))) };

    const withRot = solve(puzzle);
    if (!withRot) continue;
    if (withRot.actions.length < plan.minLen || withRot.rotations < plan.minRot) continue;
    if (solve(puzzle, { allowRotate: false })) continue;

    return { puzzle, solution: withRot };
  }
  return null;
}

function isCore(x, y, n, w) {
  return x >= w && y >= w && x < n - w && y < n - w;
}

function edgeOf(x, y, n) {
  return Math.min(x, y, n - 1 - x, n - 1 - y);
}

// Felder am Rand des Kerns (Nachbarfeld ist Kern)
function touchesCore(x, y, n, w) {
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
    const nx = x + dx;
    const ny = y + dy;
    return nx >= 0 && ny >= 0 && nx < n && ny < n && isCore(nx, ny, n, w);
  });
}

function pick(rand, list, count) {
  if (list.length < count) return null;
  const copy = [...list];
  const out = [];
  for (let i = 0; i < count; i++) out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]);
  return out;
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
    `${res.puzzle.id} ${res.puzzle.name}: Lösung ${res.solution.actions.length} Schritte ` +
      `(${res.solution.moves} Bewegungen, ${res.solution.rotations} Drehungen)`,
  );
}

const body = results
  .map(({ puzzle }) => {
    const tiers = puzzle.tiers.map((rows) => `      [\n${rows.map((r) => `        '${r}',`).join('\n')}\n      ],`).join('\n');
    return `  {\n    id: '${puzzle.id}',\n    name: '${puzzle.name}',\n    scramble: [${puzzle.scramble.join(', ')}],\n    tiers: [\n${tiers}\n    ],\n  },`;
  })
  .join('\n');

const file = `// Automatisch erzeugt von tools/generate-puzzles.mjs. Nicht von Hand bearbeiten.
// Zeichen: '.' Boden, 'S' Treppe, 'P' Start, 'G' Gipfel, '#' Mauer, '_' Kern

export const PUZZLES = [
${body}
];
`;

writeFileSync(OUT, file);
console.log(`geschrieben: ${OUT}`);
