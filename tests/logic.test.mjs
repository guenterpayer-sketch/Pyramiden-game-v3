import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ORIENTATIONS,
  TURNS,
  turnedOrientation,
  startState,
  move,
  turn,
  won,
  canStand,
  solve,
  transpose,
  mulVec,
  mulMat,
} from '../js/logic.js';
import { PUZZLES } from '../js/puzzles.js';

const key = (v) => v.join(',');

// Wiedergabe einer Lösung, damit wir prüfen, dass sie wirklich zum Ziel führt
function replay(p, actions) {
  let s = startState(p);
  for (const a of actions) {
    if (a.type === 'move') s = move(p, s, a.d);
    else s = turn(p, s, TURNS.find((t) => t.key === a.key));
    assert.ok(s, 'Lösungsschritt ist ungültig');
  }
  return s;
}

test('es gibt genau 24 Ausrichtungen, alle sind echte Drehungen', () => {
  assert.equal(ORIENTATIONS.length, 24);
  for (const m of ORIENTATIONS) {
    const id = mulMat(m, transpose(m));
    assert.deepEqual(id, [1, 0, 0, 0, 1, 0, 0, 0, 1], 'orthogonal');
    const det =
      m[0] * (m[4] * m[8] - m[5] * m[7]) -
      m[1] * (m[3] * m[8] - m[5] * m[6]) +
      m[2] * (m[3] * m[7] - m[4] * m[6]);
    assert.equal(det, 1, 'Determinante +1');
  }
});

test('vier gleiche Drehungen ergeben wieder die Ausgangslage', () => {
  for (const t of TURNS) {
    let o = 0;
    for (let i = 0; i < 4; i++) o = turnedOrientation(o, t);
    assert.equal(o, 0, `Drehung ${t.key}`);
  }
});

test('Drehung y+ dreht die Pyramide in die richtige Richtung', () => {
  // Eine Drehung um die y-Achse lässt den Punkt (1,0,0) in Richtung (0,0,-1) wandern
  const o = turnedOrientation(0, { axis: 'y', dir: 1 });
  assert.deepEqual(mulVec(ORIENTATIONS[o], [1, 0, 0]), [0, 0, -1]);
});

test('Stehen braucht einen Stützblock darunter', () => {
  // Über dem Block [0,1,0] liegt [0,2,0]; unter [0,1,0] liegt nichts
  const set = new Set(['0,2,0', '0,1,0', '1,1,0']);
  assert.equal(canStand(set, [0, 2, 0], 0), true, 'Block [0,1,0] stützt [0,2,0]');
  assert.equal(canStand(set, [0, 1, 0], 0), false, 'unter [0,1,0] fehlt die Stütze');
  assert.equal(canStand(set, [5, 5, 5], 0), false, 'kein Block vorhanden');
});

test('Schritt auf einen Block ohne Stütze ist nicht erlaubt', () => {
  const p = {
    cells: [
      [0, 1, 0],
      [0, 0, 0],
      [1, 1, 0],
    ],
    start: [0, 1, 0],
    goal: [1, 1, 0],
    scramble: 0,
  };
  // [1,1,0] hat keine Stütze darunter ([1,0,0] fehlt), also darf man nicht hinübergehen
  assert.equal(move(p, startState(p), [1, 0, 0]), null);
});

test('Drehung ist nur erlaubt, wenn der Spieler danach noch steht', () => {
  // Zwei Blöcke übereinander: Der Spieler steht auf dem oberen. Drehen wir um die z-Achse, liegt der Stützblock seitlich.
  const p = {
    cells: [
      [2, 2, 2],
      [2, 1, 2],
    ],
    start: [2, 2, 2],
    goal: [2, 1, 2],
    scramble: 0,
  };
  const s = startState(p);
  assert.equal(turn(p, s, TURNS.find((t) => t.key === 'z+')), null, 'würde fallen');
  // Die Drehung z+ geht danach nicht, aber y+ bleibt im Stand
  assert.ok(turn(p, s, TURNS.find((t) => t.key === 'y+')));
});

test('jedes Rätsel ist mit Drehungen lösbar', () => {
  for (const p of PUZZLES) {
    const sol = solve(p);
    assert.ok(sol, `${p.id} hat keine Lösung`);
    const end = replay(p, sol.actions);
    assert.ok(won(p, end), `${p.id}: Lösung führt nicht zum Ziel`);
  }
});

test('kein Rätsel ist ohne Drehungen lösbar', () => {
  for (const p of PUZZLES) {
    assert.equal(solve(p, { allowTurns: false }), null, `${p.id} ist ohne Drehung lösbar`);
  }
});

test('die Schwierigkeit steigt', () => {
  const lengths = PUZZLES.map((p) => {
    const s = solve(p);
    return s.moves + s.rotations;
  });
  for (let i = 1; i < lengths.length; i++) {
    assert.ok(lengths[i] >= lengths[i - 1], `${PUZZLES[i].id} ist kürzer als ${PUZZLES[i - 1].id}`);
  }
});

test('alle Rätsel haben eindeutige IDs und Blöcke im Raster', () => {
  const ids = new Set(PUZZLES.map((p) => p.id));
  assert.equal(ids.size, PUZZLES.length);
  for (const p of PUZZLES) {
    for (const c of p.cells) for (const v of c) assert.ok(v >= 0 && v < 5, `${p.id}: Koordinate außerhalb`);
    assert.ok(p.cells.some((c) => key(c) === key(p.goal)), `${p.id}: Ziel ist kein Block`);
    assert.ok(p.cells.some((c) => key(c) === key(p.start)), `${p.id}: Start ist kein Block`);
  }
});
