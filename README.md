# Innenräume

Ein ruhiges 3D-Logikrätsel im Browser. Eine Pyramide mit Gängen im Inneren, die du drehen und kippen kannst. Ziel ist der goldene Block.

## Spielen

Die Datei `index.html` in einem Browser öffnen. Es braucht keinen Server und kein Internet, Three.js liegt im Ordner `vendor/`.

Bei manchen Browsern startet ein lokaler Server besser, etwa:

    python3 -m http.server 8000

und dann `http://localhost:8000` öffnen.

## Regeln

- Die Schwerkraft zeigt immer nach unten.
- Du gehst nur auf Blöcken, unter denen ein Stützblock liegt.
- Die ganze Pyramide lässt sich um drei Achsen in 90°-Schritten drehen. Dadurch wird eine Wand zum Boden und neue Gänge entstehen.
- Eine Drehung ist nur erlaubt, wenn du danach noch auf einem Block stehst. Du fällst nicht.
- Die Zeit wird nur angezeigt. Es gibt kein Zeitlimit.

## Steuerung

| Aktion | Tasten | Maus / Touch |
| --- | --- | --- |
| Gehen | Pfeiltasten oder W A S D | Pfeil-Buttons |
| Drehen um die Hochachse | Q / E | Buttons „Drehen“ |
| Kippen um die x-Achse | R / F | Buttons „Kippen“ |
| Kippen um die z-Achse | T / G | Buttons „Kippen“ |
| Blick drehen | Maus ziehen | Ziehen |
| Nähe | Mausrad | |
| Menü | Esc | Button „Menü“ |

Die Gehrichtung bezieht sich auf die Kamera: „vorwärts“ ist die Richtung von dir weg.

## Dateien

- `index.html`: Oberfläche und Styles
- `js/game.js`: 3D-Darstellung, Eingabe, Ablauf
- `js/logic.js`: reine Spiellogik (Ausrichtungen, Schritte, Drehungen, Solver)
- `js/puzzles.js`: die Rätsel. Wird vom Generator erzeugt, nicht von Hand bearbeitet
- `tools/generate-puzzles.mjs`: erzeugt `js/puzzles.js`
- `tests/logic.test.mjs`: Tests der Logik und Prüfung aller Rätsel
- `vendor/`: Three.js 0.170.0 (MIT-Lizenz, siehe `vendor/THREE-LICENSE.txt`)

## Entwicklung

    npm test              # Logik-Tests und Prüfung aller Rätsel
    npm run generate      # Rätsel neu erzeugen (Zufall mit festem Seed)

Jedes Rätsel wird beim Erzeugen geprüft: Es ist mit Drehungen lösbar, ohne Drehungen aber nicht, und die Lösung hat eine Mindestlänge.
