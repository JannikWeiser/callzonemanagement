# Callzone Management

Zeigt fuer einen Kletterwettkampf auf results.info, wer gerade an der Wand ist,
wer als naechstes dran ist und wer danach kommt - pro Route/Lane.

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

Der Server laeuft dann auf `http://localhost:4173`. (Nicht empfohlen, besser mit Domain hosten)

- **Auf dem Laptop:** einfach `http://localhost:4173` im Browser oeffnen.
- **Auf dem iPad:** im selben WLAN wie der Laptop sein, dann im Safari
  `http://<laptop-ip>:4173` oeffnen. Die aktuelle IP des Laptops findest du
  mit `ipconfig getifaddr en0` (Mac, WLAN) im Terminal.

## Benutzung

1. Event ID eingeben (aus der results.info-URL, z.B. `/event/2101/` -> `2101`)
   und Server waehlen: `dav.results.info` (DAV-Wettkaempfe), `ifsc.results.info`
   (IFSC/Weltcup-Wettkaempfe) oder `dav-stage.results.info` nur zum Testen.
2. Altersklasse + Runde (Qualifikation/Finale) aus dem Dropdown waehlen.
3. "Show" - die Anzeige aktualisiert sich automatisch alle 3 Sekunden. Statt
   einer einzelnen Runde laesst sich auch eine **Sequenz** mehrerer Runden
   zusammenstellen ("+ Add to sequence", Reihenfolge per Drag & Drop), die
   automatisch weiterschaltet, sobald die jeweils aktuelle Runde fertig ist
   - siehe [ANLEITUNG.md](ANLEITUNG.md) Abschnitt 5.

Die Auswahl wird im Browser gemerkt, ein Reload (z.B. nach WLAN-Aussetzer auf
dem iPad) zeigt automatisch wieder dieselbe Runde.

Die App-Oberflaeche selbst (Buttons, Anzeigetexte) ist komplett auf
Englisch - diese README bleibt Deutsch.
Details siehe [ANLEITUNG.md](ANLEITUNG.md).

## Wie "Climbing" ermittelt wird

results.info hat kein Feld fuer "klettert gerade" - nur einen Wertungsstatus
pro Athlet und Route: "pending" (noch nicht dran), "active" (Schiedsrichter
trägt gerade live ein, noch nicht bestätigt) oder "confirmed"/"locked"
(fertig gewertet). Die App leitet daraus ab: der/die Athlet·in mit dem
zuletzt eingetragenen "active"-Ergebnis gilt als "climbing" (an der Wand);
falls niemand aktuell "active" ist, die Position direkt nach dem zuletzt
bestätigten Ergebnis. Das funktioniert fuer Lead, Boulder (mehrere Routen
parallel, inkl. Boulder-Gruppen A/B mit Umschalter) und Speed-Qualifikation.
Speed-K.-o.-Runden (Finale mit Turnierbaum) zeigen dieselbe Logik pro Lane
(Lane A/B) statt pro Route - siehe
[ARCHITECTURE.md §5.2](ARCHITECTURE.md#52-the-inference-findcurrentindex--computelane-in-publicappjs)
und [§5.5](ARCHITECTURE.md#55-speed-elimination-heat-based-inference-computespeedelimination).

## Architektur

Kurzfassung: ein kleiner Node/Express-Server dient das Frontend aus und
reicht Anfragen an die results.info-API durch (inkl. des von results.info
verlangten `Referer`-Headers, den ein reiner Browser-Client nicht faelschen
kann), mit kurzem serverseitigem Cache. Vollstaendige Doku inkl. API-Details,
dem "Climbing"-Algorithmus und Begruendungen fuer alle Design-
Entscheidungen: [ARCHITECTURE.md](ARCHITECTURE.md). Hosting: [HOSTING.md](HOSTING.md).

## Weitere Dokumente

- [ANLEITUNG.md](ANLEITUNG.md) - nicht-technische Bedienungsanleitung zum Weitergeben.
- [ARCHITECTURE.md](ARCHITECTURE.md) - technische Doku, API-Referenz, Begruendungen (Englisch).
- [HOSTING.md](HOSTING.md) - Deployment-Pipeline GitHub -> Render, wo man was findet.
- [CHANGELOG.md](CHANGELOG.md) - chronologisches Aenderungsprotokoll (Englisch).
- [AGENTS.md](AGENTS.md) - Arbeitsregeln fuer zukuenftige KI-Coding-Sessions in diesem Repo (Englisch).
