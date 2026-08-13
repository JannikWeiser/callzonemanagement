# Callzone Management

Zeigt fuer einen Kletterwettkampf auf results.info, wer gerade an der Wand ist,
wer als naechstes dran ist und wer danach kommt - pro Wand/Bahn.

Kann lokal (Laptop + WLAN) oder gehostet (feste `https://`-URL, kein WLAN
noetig) laufen. Fuer Hosting siehe [HOSTING.md](HOSTING.md); der Rest dieser
Datei beschreibt den lokalen Start.

## Start

```bash
npm install
npm start
```

Der Server laeuft dann auf `http://localhost:4173`.

- **Auf dem Laptop:** einfach `http://localhost:4173` im Browser oeffnen.
- **Auf dem iPad:** im selben WLAN wie der Laptop sein, dann im Safari
  `http://<laptop-ip>:4173` oeffnen. Die aktuelle IP des Laptops findest du
  mit `ipconfig getifaddr en0` (Mac, WLAN) im Terminal.

## Benutzung

1. Event ID eingeben (aus der results.info-URL, z.B. `/event/2101/` -> `2101`)
   und Server waehlen (normalerweise `dav.results.info`, `dav-stage.results.info`
   nur zum Testen).
2. Altersklasse + Runde (Qualifikation/Finale) aus dem Dropdown waehlen.
3. "Anzeigen" - die Anzeige aktualisiert sich automatisch alle 3 Sekunden.

Die Auswahl wird im Browser gemerkt, ein Reload (z.B. nach WLAN-Aussetzer auf
dem iPad) zeigt automatisch wieder dieselbe Runde.

## Wie "an der Wand" ermittelt wird

results.info hat kein Feld fuer "klettert gerade". Die App leitet es ab: pro
Wand/Bahn wird die Startreihenfolge mit dem Wertungsstatus jedes Athleten
abgeglichen. Der erste Athlet in der Startreihenfolge ohne bestaetigtes
Ergebnis gilt als "an der Wand", der naechste als "naechste/r", der Rest als
Warteliste. Das funktioniert fuer Lead, Boulder (mehrere Waende parallel) und
Speed-Qualifikation. Speed-K.-o.-Runden (Duelle) werden nicht unterstuetzt.

## Architektur

Ein kleiner lokaler Node/Express-Server dient das Frontend aus und reicht
Anfragen an die results.info-API durch (inkl. des von results.info
verlangten `Referer`-Headers, den ein reiner Browser-Client nicht faelschen
kann). Er cached Antworten kurz serverseitig (Event-Struktur 20s,
Live-Ergebnisse 3s), damit mehrere Geraete gleichzeitig zuschauen koennen,
ohne results.info zu ueberlasten. Dadurch laeuft alles lokal im Hallen-WLAN,
ohne Hosting oder Internetzugang von aussen - alternativ laesst sich derselbe
Server unveraendert auf einem Hosting-Dienst wie Render deployen, siehe
[HOSTING.md](HOSTING.md).
