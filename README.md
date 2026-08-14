# Callzone Management

Zeigt fuer einen Kletterwettkampf auf results.info, wer gerade an der Wand ist,
wer als naechstes dran ist und wer danach kommt - pro Route/Bahn.

Kann lokal (Laptop + WLAN) oder gehostet (feste `https://`-URL, kein WLAN
noetig) laufen. Fuer Hosting siehe [HOSTING.md](HOSTING.md), fuer die
technische Doku inkl. Begruendungen fuer Design-Entscheidungen siehe
[ARCHITECTURE.md](ARCHITECTURE.md). Der Rest dieser Datei beschreibt den
lokalen Start.

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
   und Server waehlen: `dav.results.info` (DAV-Wettkaempfe), `ifsc.results.info`
   (IFSC/Weltcup-Wettkaempfe) oder `dav-stage.results.info` nur zum Testen.
2. Altersklasse + Runde (Qualifikation/Finale) aus dem Dropdown waehlen.
3. "Show" - die Anzeige aktualisiert sich automatisch alle 3 Sekunden.

Die Auswahl wird im Browser gemerkt, ein Reload (z.B. nach WLAN-Aussetzer auf
dem iPad) zeigt automatisch wieder dieselbe Runde.

Die App-Oberflaeche selbst (Buttons, Anzeigetexte) ist komplett auf
Englisch (fuer internationale Events) - diese README bleibt Deutsch.
Details siehe [ANLEITUNG.md](ANLEITUNG.md).

## Wie "an der Wand" ermittelt wird

results.info hat kein Feld fuer "klettert gerade". Die App leitet es ab: pro
Route/Bahn wird die Startreihenfolge mit dem Wertungsstatus jedes Athleten
abgeglichen. Der erste Athlet in der Startreihenfolge ohne bestaetigtes
Ergebnis gilt als "an der Wand", der naechste als "naechste/r", der Rest als
Warteliste. Das funktioniert fuer Lead, Boulder (mehrere Routen parallel,
inkl. Boulder-Gruppen A/B mit Umschalter) und Speed-Qualifikation.
Speed-K.-o.-Runden (Finale mit Turnierbaum) zeigen stattdessen die
aktuellen und kommenden Duelle der laufenden Stufe - siehe
[ARCHITECTURE.md §5.5](ARCHITECTURE.md#55-speed-elimination-heat-based-inference-computespeedelimination).

## Architektur

Kurzfassung: ein kleiner Node/Express-Server dient das Frontend aus und
reicht Anfragen an die results.info-API durch (inkl. des von results.info
verlangten `Referer`-Headers, den ein reiner Browser-Client nicht faelschen
kann), mit kurzem serverseitigem Cache. Vollstaendige Doku inkl. API-Details,
dem "an der Wand"-Algorithmus und Begruendungen fuer alle Design-
Entscheidungen: [ARCHITECTURE.md](ARCHITECTURE.md). Hosting: [HOSTING.md](HOSTING.md).

## Weitere Dokumente

- [ANLEITUNG.md](ANLEITUNG.md) - nicht-technische Bedienungsanleitung zum Weitergeben.
- [ARCHITECTURE.md](ARCHITECTURE.md) - technische Doku, API-Referenz, Begruendungen (Englisch).
- [HOSTING.md](HOSTING.md) - Deployment-Pipeline GitHub -> Render, wo man was findet.
- [CHANGELOG.md](CHANGELOG.md) - chronologisches Aenderungsprotokoll (Englisch).
- [AGENTS.md](AGENTS.md) - Arbeitsregeln fuer zukuenftige KI-Coding-Sessions in diesem Repo (Englisch).
