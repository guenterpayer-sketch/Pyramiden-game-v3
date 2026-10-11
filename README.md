# Lichtpyramide

Ein ruhiges 3D-Rätsel. Eine dunkle Kristallpyramide schwebt im Nachthimmel. Ein Lichtstrahl läuft über ihre Oberfläche, und du lenkst ihn mit Spiegeln bis zur Spitze. Der Strahl läuft auch um die Ecken auf die nächste Seite.

## Spielen

Die Dateien über einen Webserver öffnen. Es braucht kein Internet, Three.js liegt im Ordner `vendor/`.

    python3 -m http.server 8000

Dann `http://localhost:8000` im Browser öffnen.

## Regeln

- Der Strahl startet an der leuchtenden Kugel am Fuß der Pyramide und läuft in Pfeilrichtung.
- **Blaue Spiegel** lassen sich antippen und klappen dann um. Der Strahl sucht sofort einen neuen Weg.
- **Violette Spiegel** sind fest.
- **Orange Prismen** teilen den Strahl: Er läuft geradeaus weiter und wird zugleich abgelenkt. Sie lassen sich antippen.
- **Schwarze Steine** halten den Strahl auf.
- **Rosa Kristalle ◆** leuchten, wenn der Strahl hindurchläuft. Sie sollen alle leuchten.
- **Ziel:** Der Strahl erreicht die goldene Spitze, und alle Kristalle leuchten.
- Die Zeit wird nur angezeigt. Es gibt kein Limit, nur eine Richtzeit zur Orientierung.

## Bedienung

| Aktion | Eingabe |
| --- | --- |
| Spiegel oder Prisma umlegen | Tippen oder Klicken |
| Pyramide drehen | Ziehen mit Finger oder Maus, oder Buttons „Drehen“, oder Q und E (auch ← →) |
| Näher oder weiter weg | Mausrad |
| Tipp | Button „Tipp“ oder H. Er zeigt einen Spiegel, der falsch steht. |
| Menü | Button „Menü“ oder Esc |

## Wie es aufgebaut ist

Die Pyramide hat vier Seiten und in jedem Rätsel dieselbe Form. Sie ist in Ringe aus Feldern geteilt, und jeder Ring hat 16 Felder (4 pro Seite). Dadurch liegt über jedem Feld genau ein Feld im nächsten Ring, und der Strahl läuft in vier Richtungen: oben, rechts, unten, links. Rechts und links gehen um die Pyramide herum. Läuft der Strahl aus dem obersten Ring nach oben, trifft er die Spitze.

Die Rätsel werden vom Generator `tools/generate-levels.mjs` gebaut. Er legt zuerst einen lösenden Lichtweg an und verteilt dann Täuschungen und Sperrsteine. Danach probiert er alle Spiegelstellungen durch. Ein Rätsel wird nur übernommen, wenn es genau eine Lösung hat (gezählt über die Spiegel, die der Strahl berührt) und mindestens zwei Bauteile umgelegt werden müssen.

## Dateien

- `index.html`: Oberfläche und Styles
- `js/board.js`: Spielregeln und Geometrie (ohne Three.js, getestet)
- `js/game.js`: 3D-Darstellung, Eingabe, Ablauf
- `js/levels.js`: die sechs Rätsel (vom Generator erzeugt, nicht von Hand bearbeiten)
- `tools/generate-levels.mjs`: Rätselgenerator
- `tests/board.test.mjs`: Tests der Regeln, der Geometrie und aller Rätsel
- `vendor/`: Three.js 0.170.0 (MIT-Lizenz, siehe `vendor/THREE-LICENSE.txt`)

## Entwicklung

    npm test                          # Tests
    node tools/generate-levels.mjs    # Rätsel neu erzeugen (fester Seed)
