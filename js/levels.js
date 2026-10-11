// Die Stufen des Spiels. K ist die Zahl der Ringe, seed legt das Labyrinth fest.
// target ist die Richtzeit in Sekunden. Sie dient nur der Orientierung, es gibt kein Limit.
// Die Seeds sind so gewählt, dass der kürzeste Weg etwa 30, 45, 60, 80 und 105 Schritte lang ist.
export const LEVELS = [
  { id: 'l1', name: 'Erste Stufen', K: 3, seed: 46, loops: 0.04, target: 180 },
  { id: 'l2', name: 'Sanfter Aufstieg', K: 4, seed: 54, loops: 0.04, target: 240 },
  { id: 'l3', name: 'Windungen', K: 5, seed: 236, loops: 0.03, target: 330 },
  { id: 'l4', name: 'Sternenpfad', K: 6, seed: 64, loops: 0.03, target: 450 },
  { id: 'l5', name: 'Die Spitze', K: 7, seed: 161, loops: 0.02, target: 600 },
];
