# Pyramidenpfad

Ein ruhiges 3D-Labyrinth auf den vier Seiten einer Pyramide. Die Mauern winden sich von allen Seiten nach oben. Ziel ist das goldene Plateau an der Spitze.

## Spielen

Die Datei `index.html` über einen Webserver öffnen. Es braucht kein Internet, Three.js liegt im Ordner `vendor/`.

    python3 -m http.server 8000

Dann `http://localhost:8000` im Browser öffnen. Auf dem Handy: dieselbe Adresse im WLAN öffnen oder die Dateien irgendwo online bereitstellen.

## Bedienung

- **Gehen:** Tippe (oder klicke) auf ein leuchtendes Feld direkt neben der Figur. Am Computer gehen auch die Pfeiltasten oder W A S D. Die Richtung gilt so, wie du sie auf dem Bildschirm siehst.
- **Pyramide drehen:** Mit Finger oder Maus ziehen. Die Buttons „Drehen“ (oder Q und E) drehen sie um eine Viertelrunde. Geht die Figur um eine Ecke auf die nächste Seite, dreht sich die Pyramide von selbst mit.
- **Tipp:** Der Button „Tipp“ (oder H) zeigt ein Stück des Weges nach oben.
- **Sterne:** In Sackgassen liegen drei Sterne pro Stufe. Sie einzusammeln ist freiwillig.
- **Zeit:** Die Zeit wird nur angezeigt. Es gibt ein Richtzeit-Balkenchen, aber kein Limit und keine Strafe.

## Wie die Pyramide aufgebaut ist

Die Pyramide hat vier Seiten und ein goldenes Plateau oben. Ihre Hänge sind in Ringe aus Feldern geteilt. Ring k hat auf jeder Seite 2·(K−k)+1 Felder. Das Labyrinth entsteht zuerst als Spannbaum über alle Felder. So ist jedes Feld erreichbar, und es gibt von jedem Feld genau einen Weg nach oben. Danach werden ein paar Mauern geöffnet, damit es auch Umwege gibt. Der Start liegt am Fuß der Pyramide an dem Feld mit dem weitesten Weg zur Spitze.

## Dateien

- `index.html`: Oberfläche und Styles
- `js/game.js`: 3D-Darstellung, Eingabe, Ablauf
- `js/pyramid.js`: Geometrie und Labyrinth (ohne Three.js, getestet)
- `js/levels.js`: die fünf Stufen (Größe, Seed, Richtzeit)
- `tests/maze.test.mjs`: Tests der Geometrie und der Labyrinthe
- `vendor/`: Three.js 0.170.0 (MIT-Lizenz, siehe `vendor/THREE-LICENSE.txt`)

## Entwicklung

    npm test

Die Tests prüfen unter anderem: Alle Felder liegen auf den Hängen, jede Stufe ist lösbar, der Weg ist ein kürzester Weg, die Wege werden von Stufe zu Stufe länger, die Sterne liegen in Sackgassen, und das Labyrinth ist bei gleichem Seed immer gleich.
