import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  N,
  DIR,
  reflect,
  stepFrom,
  trace,
  solveAll,
  distance,
  rotatableIndices,
  cellFrame,
  facePoint,
  faceNormal,
  pyramidHeight,
  apexPoint,
} from '../js/board.js';
import { LEVELS } from '../js/levels.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const near = (a, b, eps = 1e-9) => Math.hypot(...sub(a, b)) < eps;

// ---------- Strahl ----------

test('Spiegel: "/" tauscht R<->U und L<->D, "\\" tauscht R<->D und L<->U', () => {
  assert.equal(reflect(DIR.R, 0), DIR.U);
  assert.equal(reflect(DIR.U, 0), DIR.R);
  assert.equal(reflect(DIR.L, 0), DIR.D);
  assert.equal(reflect(DIR.D, 0), DIR.L);
  assert.equal(reflect(DIR.R, 1), DIR.D);
  assert.equal(reflect(DIR.D, 1), DIR.R);
  assert.equal(reflect(DIR.L, 1), DIR.U);
  assert.equal(reflect(DIR.U, 1), DIR.L);
});

test('jeder Spiegel ist seine eigene Umkehrung', () => {
  for (const o of [0, 1]) for (let d = 0; d < 4; d++) assert.equal(reflect(reflect(d, o), o), d);
});

test('Schritte laufen um die Pyramide herum und aus dem Ring hinaus', () => {
  assert.deepEqual(stepFrom(3, 1, N - 1, DIR.R), { k: 1, i: 0 });
  assert.deepEqual(stepFrom(3, 1, 0, DIR.L), { k: 1, i: N - 1 });
  assert.deepEqual(stepFrom(3, 0, 4, DIR.U), { k: 1, i: 4 });
  assert.deepEqual(stepFrom(3, 2, 4, DIR.U), { apex: true });
  assert.deepEqual(stepFrom(3, 0, 4, DIR.D), { out: true });
});

const base = (comps, extra = {}) => ({ K: 2, emitter: { k: 0, i: 0, dir: DIR.R }, comps, ...extra });

test('ein Spiegel lenkt den Strahl zur Spitze', () => {
  const level = base([{ k: 0, i: 3, t: 'M' }]);
  assert.equal(trace(level, [0]).apex, true, '"/" lenkt nach oben');
  assert.equal(trace(level, [1]).apex, false, '"\\" lenkt nach unten hinaus');
});

test('Sperrstein stoppt den Strahl, Kristall lässt ihn durch', () => {
  const blocked = base([{ k: 0, i: 3, t: 'M' }, { k: 1, i: 3, t: 'B' }]);
  assert.equal(trace(blocked, [0, 0]).apex, false);
  const crystal = base([{ k: 0, i: 3, t: 'M' }, { k: 1, i: 3, t: 'C' }]);
  const r = trace(crystal, [0, 0]);
  assert.equal(r.apex, true);
  assert.deepEqual([...r.litCrystals], [1]);
  assert.equal(r.solved, true);
});

test('ohne leuchtenden Kristall ist das Rätsel nicht gelöst', () => {
  const level = base([{ k: 0, i: 3, t: 'M' }, { k: 0, i: 9, t: 'C' }]);
  const r = trace(level, [0, 0]);
  assert.equal(r.apex, true);
  assert.equal(r.solved, false);
});

test('fester Spiegel lenkt immer gleich ab', () => {
  const level = base([{ k: 0, i: 3, t: 'F', o: 0 }]);
  assert.equal(trace(level, [0]).apex, true);
  const other = base([{ k: 0, i: 3, t: 'F', o: 1 }]);
  assert.equal(trace(other, [0]).apex, false);
});

test('Prisma teilt den Strahl: geradeaus und abgelenkt', () => {
  // Strahl läuft nach rechts, Prisma bei i=3 ("/" lenkt nach oben), Kristall geradeaus bei i=6
  const level = base([{ k: 0, i: 3, t: 'S' }, { k: 0, i: 6, t: 'C' }]);
  const r = trace(level, [0, 0]);
  assert.equal(r.apex, true);
  assert.equal(r.solved, true, 'beide Äste: Spitze und Kristall');
  const wrong = trace(level, [1, 0]);
  assert.equal(wrong.apex, false);
  assert.equal(wrong.solved, false);
});

test('Schleifen hängen nicht: der Strahl endet, auch wenn er im Kreis läuft', () => {
  // Vier Spiegel bilden ein Rechteck, der Strahl wird im Kreis geführt
  const comps = [
    { k: 0, i: 4, t: 'F', o: 0 },
    { k: 1, i: 4, t: 'F', o: 1 },
    { k: 1, i: 0, t: 'F', o: 0 },
    { k: 0, i: 0, t: 'F', o: 1 },
  ];
  const level = { K: 3, emitter: { k: 0, i: 1, dir: DIR.R }, comps };
  const r = trace(level, new Array(comps.length).fill(0));
  assert.ok(r.segments.length > 0 && r.segments.length < 200);
});

test('zufällige Stellungen enden immer', () => {
  for (const level of LEVELS) {
    const orient = new Array(level.comps.length).fill(0);
    for (let n = 0; n < 200; n++) {
      for (const idx of rotatableIndices(level)) orient[idx] = (n * 2654435761 + idx * 40503) % 2;
      const r = trace(level, orient);
      assert.ok(r.segments.length < 2000);
    }
  }
});

// ---------- Geometrie ----------

test('jedes Feld hat eine gültige Lage: eR x eU = n, senkrecht, nach außen', () => {
  for (const K of [3, 5, 7]) {
    for (let k = 0; k < K; k++) {
      for (let i = 0; i < N; i++) {
        const c = cellFrame(K, k, i);
        assert.ok(near(cross(c.eR, c.eU), c.n, 1e-9), `Feld ${k},${i}: eR x eU != n`);
        assert.ok(Math.abs(dot(c.eR, c.n)) < 1e-9 && Math.abs(dot(c.eU, c.n)) < 1e-9);
        // n zeigt von der Achse weg
        assert.ok(dot(c.n, [c.center[0], 0, c.center[2]]) > 0, `Feld ${k},${i}: n zeigt nach innen`);
        // alle Ecken liegen auf der Ebene der Seite
        for (const p of [c.LL, c.LR, c.UL, c.UR, c.center]) {
          assert.ok(Math.abs(dot(c.n, sub(p, facePoint(K, c.f, 0, 0)))) < 1e-9);
        }
        assert.ok(c.width > 0.1 && c.height > 0.5);
      }
    }
  }
});

test('Nachbarfelder grenzen genau aneinander: rechts, links und oben (auch um die Ecken)', () => {
  const K = 5;
  for (let k = 0; k < K; k++) {
    for (let i = 0; i < N; i++) {
      const c = cellFrame(K, k, i);
      const right = cellFrame(K, k, (i + 1) % N);
      assert.ok(near(c.LR, right.LL, 1e-9) && near(c.UR, right.UL, 1e-9), `rechts von ${k},${i}`);
      if (k + 1 < K) {
        const up = cellFrame(K, k + 1, i);
        assert.ok(near(c.UL, up.LL, 1e-9) && near(c.UR, up.LR, 1e-9), `über ${k},${i}`);
      }
    }
  }
});

test('"rechts" zeigt von außen gesehen nach rechts (Index wächst nach rechts)', () => {
  const K = 4;
  for (let f = 0; f < 4; f++) {
    const i = f * 4 + 1; // ein Feld in der Mitte der Seite (Seiten laufen rückwärts durchnummeriert)
    const c = cellFrame(K, 0, i);
    // Ein Betrachter außerhalb schaut gegen n, sein "oben" ist eU. Sein "rechts" ist Blickrichtung x oben = (-n) x eU = eU x n.
    const viewerRight = cross(c.eU, c.n);
    assert.ok(dot(viewerRight, c.eR) > 0.99, `Seite ${c.f}`);
  }
});

test('der Gipfel liegt über der Mitte', () => {
  for (const K of [3, 7]) {
    const a = apexPoint(K);
    assert.equal(a[0], 0);
    assert.equal(a[2], 0);
    assert.ok(a[1] > pyramidHeight(K));
    assert.ok(Math.hypot(...faceNormal(K, 0)) > 0.999);
  }
});

// ---------- Rätsel ----------

test('jedes Rätsel hat gültige, nicht überlappende Bauteile', () => {
  for (const level of LEVELS) {
    const seen = new Set([`${level.emitter.k},${level.emitter.i}`]);
    for (const c of level.comps) {
      assert.ok(c.k >= 0 && c.k < level.K && c.i >= 0 && c.i < N, `${level.id}: Feld außerhalb`);
      const key = `${c.k},${c.i}`;
      assert.ok(!seen.has(key), `${level.id}: Feld ${key} doppelt belegt`);
      seen.add(key);
      assert.ok(['M', 'F', 'S', 'B', 'C'].includes(c.t));
    }
    assert.equal(level.emitter.k, 0, 'Sender steht am Fuß');
  }
});

test('jedes Rätsel hat genau eine Lösung und ist am Anfang nicht gelöst', () => {
  for (const level of LEVELS) {
    const solutions = solveAll(level);
    assert.equal(solutions.length, 1, `${level.id}: ${solutions.length} Lösungen`);
    const orient = level.comps.map((c) => c.o ?? 0);
    assert.equal(trace(level, orient).solved, false, `${level.id} ist schon gelöst`);
  }
});

test('die gespeicherte Lösung löst das Rätsel wirklich', () => {
  for (const level of LEVELS) {
    const orient = level.comps.map((c) => c.o ?? 0);
    level.comps.forEach((c, idx) => {
      if ((c.t === 'M' || c.t === 'S') && c.sol !== null && c.sol !== undefined) orient[idx] = c.sol;
    });
    const r = trace(level, orient);
    assert.equal(r.solved, true, `${level.id}`);
    assert.equal(r.apex, true);
  }
});

test('es müssen mehrere Bauteile umgelegt werden, und die Rätsel werden größer', () => {
  const sizes = LEVELS.map((l) => l.comps.length);
  const flipsOf = (level) => {
    const orient = level.comps.map((c) => c.o ?? 0);
    const sol = level.comps.map((c) => (c.t === 'M' || c.t === 'S' ? (c.sol ?? null) : null));
    return distance(level, orient, sol);
  };
  for (const level of LEVELS) assert.ok(flipsOf(level) >= 2, `${level.id}: nur ${flipsOf(level)} umzulegen`);
  assert.equal(LEVELS.length, 10);
  for (const s of sizes) assert.ok(s >= sizes[0], 'kein Rätsel ist kleiner als das erste');
  assert.ok(sizes.at(-1) > sizes[0] * 2, 'das letzte Rätsel ist deutlich größer');
  assert.ok(flipsOf(LEVELS.at(-1)) > flipsOf(LEVELS[0]), 'das letzte Rätsel braucht mehr Züge');
});

test('spätere Rätsel enthalten Kristalle und Prismen', () => {
  const kinds = (level) => new Set(level.comps.map((c) => c.t));
  assert.ok(LEVELS.some((l) => kinds(l).has('C')));
  assert.ok(LEVELS.some((l) => kinds(l).has('S')));
  assert.ok(LEVELS.some((l) => kinds(l).has('F')));
});
