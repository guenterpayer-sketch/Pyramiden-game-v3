# Lichtpyramide

Ein ruhiges 3D-Rätsel. Eine leuchtende Kristallpyramide schwebt im Nachthimmel. Ein Lichtstrahl läuft über ihre Oberfläche, und du lenkst ihn mit Spiegeln bis zur Spitze. Der Strahl läuft auch um die Ecken auf die nächste Seite.

## Spielen

Die Dateien über einen Webserver öffnen. Three.js liegt im Ordner `vendor/`, das Spiel läuft also auch ohne Internet. Nur die Schriften kommen von Google Fonts. Ohne Netz werden Ersatzschriften verwendet.

    python3 -m http.server 8000

Dann `http://localhost:8000` im Browser öffnen.

## Regeln

- Der Strahl startet an der leuchtenden Kugel am Fuß der Pyramide und läuft in Pfeilrichtung.
- **Spiegel mit hellblauem Rand** lassen sich antippen und klappen dann um. Der Leuchtring am Fuß zeigt, dass man tippen kann.
- **Spiegel mit violettem Rand** sind fest.
- **Orange Prismen** teilen den Strahl: Ein Teil läuft geradeaus weiter, ein Teil wird abgelenkt. Sie lassen sich antippen.
- **Schwarze Obsidiansteine** halten den Strahl auf.
- **Rosa Kristalle** leuchten auf, wenn der Strahl hindurchläuft. Alle sollen leuchten.
- **Ziel:** Der Strahl erreicht den goldenen Gipfel, und alle Kristalle leuchten.

Es gibt zehn Rätsel mit sanft steigender Schwierigkeit. Für jedes Rätsel gibt es bis zu drei Sterne: drei bei der kleinstmöglichen Zahl an Zügen, zwei bei höchstens zwei Zügen mehr. Die Zeit wird nur angezeigt, es gibt kein Limit.

## Bedienung

| Aktion | Eingabe |
| --- | --- |
| Spiegel oder Prisma umlegen | Tippen oder Klicken |
| Pyramide drehen | Ziehen mit Finger oder Maus, die Knöpfe „Drehen“, oder Q und E (auch ← →) |
| Zug zurücknehmen | Knopf „Zurück“ oder Z |
| Tipp | Knopf „Tipp“ oder H. Er dreht die Pyramide zu einem Spiegel, der noch falsch steht, und markiert ihn golden. |
| Näher oder weiter weg | Mausrad |
| Menü | Knopf ☰ oder Esc |

## Effekte

Mit hoher Qualität leuchten Strahl, Kanten und Kristalle (Bloom), und Glas, Spiegel und Obsidian spiegeln den Himmel. Im Menü lässt sich die Qualität auf „automatisch“, „hoch“ oder „niedrig“ stellen. Bei „automatisch“ misst das Spiel kurz die Bildrate und schaltet bei ruckelnder Darstellung auf „niedrig“.

## Wie es aufgebaut ist

Die Pyramide hat vier Seiten und in jedem Rätsel dieselbe Form. Sie ist in Ringe aus Feldern geteilt, und jeder Ring hat 16 Felder (4 pro Seite). Dadurch liegt über jedem Feld genau ein Feld im nächsten Ring, und der Strahl läuft in vier Richtungen: oben, rechts, unten und links. Rechts und links gehen um die Pyramide herum.

Die Rätsel baut der Generator `tools/generate-levels.mjs`. Er legt zuerst einen lösenden Lichtweg an und verteilt dann Täuschungen und Sperrsteine. Danach probiert er alle Spiegelstellungen durch. Ein Rätsel wird nur übernommen, wenn es genau eine Lösung hat und mehrere Bauteile umgelegt werden müssen. Gezählt werden dabei nur die Spiegel, die der Strahl berührt.

## Dateien

- `index.html`: Oberfläche und Styles
- `js/board.js`: Spielregeln und Geometrie (ohne Three.js, getestet)
- `js/game.js`: 3D-Darstellung, Effekte, Eingabe, Ablauf
- `js/levels.js`: die zehn Rätsel (vom Generator erzeugt, nicht von Hand bearbeiten)
- `tools/generate-levels.mjs`: Rätselgenerator
- `tests/board.test.mjs`: Tests der Regeln, der Geometrie und aller Rätsel
- `vendor/`: Three.js 0.170.0 und die Nachbearbeitungs-Module für den Leuchteffekt (MIT-Lizenz, siehe `vendor/THREE-LICENSE.txt`)

## Entwicklung

    npm test                          # Tests
    node tools/generate-levels.mjs    # Rätsel neu erzeugen (fester Seed)
