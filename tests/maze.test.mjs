import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPyramid,
  buildLevel,
  cellGeometry,
  segmentGeometry,
  faceNormal,
  facePoint,
  distancesFrom,
  openNeighbors,
  shortestPath,
  ringCells,
} from '../js/pyramid.js';
import { LEVELS } from '../js/levels.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

test('Zahl der Felder stimmt: 4 Seiten, 2*(K-k)+1 Felder je Ring', () => {
  const pyr = buildPyramid(3);
  assert.deepEqual(pyr.rings.map((r) => r.m), [7, 5, 3]);
  assert.equal(pyr.nodeCount, 4 * (7 + 5 + 3) + 1);
  assert.equal(pyr.apex, pyr.nodeCount - 1);
  assert.equal(ringCells(7, 0), 15);
});

test('Nachbarschaft ist symmetrisch und jede Kante verbindet gültige Felder', () => {
  for (const K of [2, 3, 5, 7]) {
    const pyr = buildPyramid(K);
    for (const [e, edge] of pyr.edges.entries()) {
      assert.ok(edge.a >= 0 && edge.a < pyr.nodeCount && edge.b >= 0 && edge.b < pyr.nodeCount);
      assert.notEqual(edge.a, edge.b);
      assert.ok(pyr.adj[edge.a].some((n) => n.to === edge.b && n.edge === e));
      assert.ok(pyr.adj[edge.b].some((n) => n.to === edge.a && n.edge === e));
    }
  }
});

test('jedes Feld hat mindestens zwei Nachbarn im Ring und der Ring ist geschlossen', () => {
  const pyr = buildPyramid(4);
  for (const r of pyr.rings) {
    for (let i = 0; i < r.count; i++) {
      const next = r.offset + ((i + 1) % r.count);
      assert.ok(pyr.adj[r.offset + i].some((n) => n.to === next), `Ring ${r.k} Feld ${i}`);
    }
  }
});

test('die Ränder zwischen zwei Ringen sind lückenlos in Mauern oder Durchgänge aufgeteilt', () => {
  const pyr = buildPyramid(5);
  const sums = new Map();
  for (const e of pyr.edges) {
    if (e.seg.type !== 'level') continue;
    const key = `${e.seg.level}-${e.seg.f}`;
    sums.set(key, (sums.get(key) ?? 0) + (e.seg.sb - e.seg.sa));
  }
  assert.equal(sums.size, 4 * 5); // 4 Seiten, K Ränder (inklusive Plateau)
  for (const [key, sum] of sums) assert.ok(Math.abs(sum - 1) < 1e-9, `Rand ${key}: ${sum}`);
});

test('alle Felder und Mauern liegen auf den Hängen der Pyramide', () => {
  for (const K of [3, 6]) {
    const pyr = buildPyramid(K);
    for (let id = 0; id < pyr.nodeCount; id++) {
      const g = cellGeometry(pyr, id);
      if (!g.quad) continue;
      const f = pyr.nodes[id].f;
      const n = faceNormal(f);
      const origin = facePoint(K, f, 0, 0);
      for (const p of [...g.quad, g.center]) {
        assert.ok(Math.abs(dot(n, sub(p, origin))) < 1e-9, `Feld ${id} liegt nicht auf Seite ${f}`);
      }
    }
    for (const e of pyr.edges) {
      const g = segmentGeometry(pyr, e.seg);
      assert.ok(Math.hypot(...g.normal) > 0.999 && Math.hypot(...g.normal) < 1.001);
      // Die Mauer verläuft senkrecht zur Oberflächennormalen
      assert.ok(Math.abs(dot(g.normal, sub(g.p1, g.p0))) < 1e-9, 'Mauer liegt nicht auf der Fläche');
    }
  }
});

test('jede Stufe: alle Felder erreichbar, Lösung ist ein gültiger Weg zur Spitze', () => {
  for (const spec of LEVELS) {
    const level = buildLevel(spec);
    const { pyr } = level;
    const dist = distancesFrom(pyr, level.open, level.start);
    for (let id = 0; id < pyr.nodeCount; id++) assert.ok(dist[id] >= 0, `${spec.id}: Feld ${id} nicht erreichbar`);

    assert.equal(level.solution[0], level.start);
    assert.equal(level.solution.at(-1), pyr.apex);
    for (let i = 0; i + 1 < level.solution.length; i++) {
      assert.ok(openNeighbors(level, level.solution[i]).includes(level.solution[i + 1]));
    }
    assert.equal(level.solution.length - 1, dist[pyr.apex], 'Lösung ist ein kürzester Weg');
    assert.equal(pyr.nodes[level.start].ring, 0, 'Start liegt am Fuß');
  }
});

test('die Wege werden mit der Stufe länger und sind nicht trivial', () => {
  const lengths = LEVELS.map((s) => buildLevel(s).solution.length - 1);
  for (let i = 0; i < LEVELS.length; i++) {
    assert.ok(lengths[i] >= LEVELS[i].K * 4, `${LEVELS[i].id}: Weg nur ${lengths[i]} Schritte`);
  }
  for (let i = 1; i < lengths.length; i++) assert.ok(lengths[i] > lengths[i - 1], `Stufe ${i + 1} ist nicht länger`);
});

test('Sterne liegen in Sackgassen abseits des Weges', () => {
  for (const spec of LEVELS) {
    const level = buildLevel(spec);
    assert.equal(level.stars.length, 3, `${spec.id}: Sterne`);
    assert.equal(new Set(level.stars).size, 3);
    for (const s of level.stars) {
      assert.ok(!level.solution.includes(s));
      assert.equal(openNeighbors(level, s).length, 1, 'Sackgasse');
    }
  }
});

test('das Labyrinth ist bei gleichem Seed immer gleich', () => {
  const a = buildLevel(LEVELS[2]);
  const b = buildLevel(LEVELS[2]);
  assert.deepEqual([...a.open], [...b.open]);
  assert.equal(a.start, b.start);
  assert.deepEqual(a.stars, b.stars);
});

test('shortestPath findet den Weg und meldet fehlende Wege', () => {
  const level = buildLevel(LEVELS[0]);
  assert.deepEqual(shortestPath(level, level.start, level.start), [level.start]);
  const closed = { ...level, open: new Uint8Array(level.open.length) };
  assert.equal(shortestPath(closed, level.start, level.apex), null);
});
