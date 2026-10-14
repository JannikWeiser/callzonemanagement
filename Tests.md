# Tests – was geprüft werden muss

Diese Datei listet **alles**, was bei Änderungen an der Anzeige und den
gemeinsamen Sitzungen geprüft werden muss: was automatisch läuft (`npm test`)
und was von Hand im Browser getestet wird. Die Spalte **Status** zeigt, was
bei der Einführung (2026-10-06, lokal, Stage-Daten) tatsächlich ausgeführt
wurde – `✔` = geprüft und in Ordnung, `○` = noch **nicht** geprüft (steht
unten unter „Nicht geprüft“).

Verwandte Dokumente: [ARCHITECTURE.md §6.45](ARCHITECTURE.md#645-wall-display-rework-greenredgrey-cards-container-query-font-sizes-speed-lane-swap)
(Anzeige), [§6.46](ARCHITECTURE.md#646-shared-sessions-one-published-plan-many-tablets-a-host-password)
(Sitzungen), [AGENTS.md §3](AGENTS.md) (Test-Events auf `dav-stage`).

---

## 0. Vorbereitung

**Automatische Tests** (brauchen kein Netzwerk, laufen in ~2 s):

```bash
cd ~/Desktop/CallZonemanagement
npm test
```

**Server für die manuellen Tests** (mit festem `SESSION_SECRET`, sonst kann
eine Sitzung nach einem Neustart nicht wiederhergestellt werden – siehe S-30):

```bash
SESSION_SECRET=test-secret-123 npm start
```

Dann im Browser <http://localhost:4173>. Testdaten: Event **1594** auf
`dav-stage.results.info (test)` (viele Runden, siehe AGENTS.md §3). Für
Sitzungstests praktisch, weil sie nie „fertig“ werden und ein Tablet daher
bei seiner Runde bleibt: Lead `13689`, `13690`, `13693` (pending); Boulder
`13709` (Gruppe A/B); Speed `13723` (Quali), `13739` + `13741` (Finale,
gepaart).

**Mehrere „Tablets“** = mehrere Browser-Tabs. Achtung: Tabs im selben
Browser teilen `localStorage`, also auch den **Host-Zugang**. Für ein echtes
„anderes Gerät“ (S-12/S-13) ein Privatfenster oder ein zweites Browser-Profil
nehmen – oder dort `localStorage.clear()` ausführen.

**Hilfsmittel in der Browser-Konsole** (Tab = Host): die
Rückfrage vor „Apply“ ist ein `window.confirm` und lässt sich so
automatisch beantworten: `window.confirm = () => true` (oder `false` zum
Abbrechen).

---

## 1. Automatische Tests (`npm test`)

`test/session-plan.test.js` – Plan-Logik (gemeinsam für Browser und Server):

| Test | Prüft |
|---|---|
| entryKey | Schlüssel für Einzel-/Paired-Eintrag, `null`-sicher |
| validatePlan normalisiert | Zahlen → Strings, feste Schlüsselreihenfolge, Vorschau-Standard an, zweimal normalisieren ändert nichts |
| Paired-Einträge | gleiche Runde auf beiden Seiten, doppelte Runde im Plan werden abgelehnt |
| validatePlan lehnt ab | `null`/Array/String, falsche `kind`, leere Sequenz, unbekannter Host (inkl. `constructor`), Event-ID `12a`/`../x`, Runden-ID mit `?`, >50 Einträge, >5 Spalten, doppelte Runde in einer Spalte, Paired/Training in einer Split-View-Spalte, 1–5 Spalten, zu lange Namen, falscher Routen-Typ |
| Split-View-Normalisierung | leere Routenliste → `null`, leere Spalte erlaubt |
| relocateIndex | findet den Eintrag nach Umsortieren, `-1` wenn entfernt |
| affectedClients (watch) | nur Tablets, deren aktueller Eintrag verschwindet; Umsortieren/Hinzufügen betrifft niemanden; Typwechsel betrifft alle |
| affectedClients (Split-View-Eintrag) | Identität über die Runden der Spalten (kompakter Schlüssel), Entfernen/Ändern einer Spalte, Gruppen-/Routenwechsel, Verschieben/Hinzufügen betrifft niemanden |
| removesOrReplaces | Fallback, wenn die Tablet-Liste nicht abrufbar ist |
| Training-Einträge | Schlüssel `training:<id>`, nur ein Training pro Runde, dieselbe Runde darf **zusätzlich** als echte Runde im Plan stehen, nie in Split View, Auswirkung auf Tablets wie bei jedem Eintrag |
| TI-Überlagerung (`applyTechnicalIncidents`) | TI vor einem Wartenden / vor NEXT / vor dem Athleten am Wand, am Ende der Startliste (nur wenn das Ende sichtbar ist; nach beendeter Runde → CLIMBING), mehrere TIs in Anlage-Reihenfolge, ohne TI/erledigt/andere Route/unbekannter Athlet → dasselbe Lane-Objekt, nichts wird verändert, „überholt“ (Athlet davor hat gestartet) und „läuft gerade“ (Re-Start wird bewertet) werden nicht gezeichnet, Warteliste bleibt bei 6, Runde ohne Startathleten |

`test/sessions.test.js` – Server-API:

| Test | Prüft |
|---|---|
| Anlegen | Passwort ≥ 4 Zeichen, ungültige Pläne (`400`), nichts bleibt zurück |
| Anlegen – Antwort | ID-Format, Version 1, Zugangsdaten; Passwort **nie** in Antwort/Speicher |
| Zuschauer-GET | voller Plan, `unchanged` bei aktueller Version, `404` bei unbekannter/ungültiger ID, Zuschauer sehen **nie** Zugangsdaten |
| Login | richtiges/falsches Passwort, fehlendes/falsches Format, unbekannte Sitzung |
| Login-Sperre | 5 Fehlversuche → `429` für 60 s (auch mit richtigem Passwort), danach geht es wieder, Erfolg setzt den Zähler zurück |
| Veröffentlichen | ohne/mit falschem/mit kaputtem Host-Key → `403`, mit Key → Version +1, Plan normalisiert |
| Konflikt | veraltete `baseVersion` → `409` mit aktuellem Plan, fehlende `baseVersion`, ungültiger Plan, fremdes Event/Host |
| Plan mit Split-View-Eintrag | wird angenommen; der alte Plan-Typ `multi` wird abgelehnt (`400`) |
| Kaputte/zu große Bodies | JSON-Fehler statt HTML/Absturz (`400`/`413`) |
| Heartbeats | werden gezählt, ablaufen nach 15 s, nur mit Host-Key sichtbar, Client-IDs nie ausgegeben, ungültige IDs ignoriert |
| Heartbeat-Grenzen | höchstens 5 Schlüssel, je ≤ 60 Zeichen |
| Wiederherstellung | mit festem Secret unter derselben ID, neue Version, alter Host-Key und Passwort gelten weiter, zweiter Wiederherstellungs-Versuch überschreibt nichts |
| Wiederherstellung – Race | das Gerät mit dem **neueren** Plan gewinnt, nie über eine veröffentlichte Änderung |
| Wiederherstellung abgelehnt | gefälschter Key, fremder Record, kaputte Daten, ohne festes Secret nach Neustart |
| Training-Zähler | Lesen für alle, Schreiben nur mit Host-Key, Grenzen 0..10000, `delta`/`set`, ungültige Bodies (`400`) |
| Training-Zähler – Geltungsbereich | nur für Training-Einträge des Plans (`404` sonst), pro Sitzung getrennt, Host-Key einer anderen Sitzung wirkt nicht, nichts wird für unbekannte Runden angelegt |
| Training-Zähler – Plan-Änderung | bleibt bei Umsortieren/Hinzufügen, wird beim Entfernen gelöscht, beim erneuten Hinzufügen wieder 0 |
| Training-Zähler – Neustart | nach Neustart/Wiederherstellung 0, alter Host-Key steuert weiter |
| Limits | Sitzungs-Obergrenze (am längsten ungenutzte fliegt raus), 24-h-Ablauf, Anlege-Limit pro IP |
| TI – Schreiben/Lesen | nur mit Host-Key anlegen (`403` sonst), Zuschauer sehen die Liste im normalen Poll, `tiVersion` ändert sich, Plan-Version bleibt, `unchanged` nur wenn beide Versionen passen |
| TI – Gültigkeit | nur Lead/Boulder (Speed → `400`), Runde muss im Plan sein, ungültige IDs, Athlet vor sich selbst, Routenliste leer/doppelt/zu lang, Rundenabfrage schlägt fehl → `502`, ohne Abfrage wird nichts angenommen |
| TI – erledigt/entfernen | beides nur mit Host-Key, „done“ zweimal ändert nichts, höchstens 10 erledigte bleiben, unbekannte TI → `404` |
| TI – Obergrenze | volle Sitzung wirft den ältesten **erledigten** raus, nie einen offenen |
| TI – Plan-Änderung | Umsortieren lässt TIs in Ruhe, Runde aus dem Plan → ihre TIs verschwinden |
| Technische Zwischenfälle, Overlay (Boulder) | Athlet nur auf seinem Boulder, leerer Platz auf den anderen, nie am Ende der Liste; Sicherheitsnetz pro Boulder; „underway“ nur für den Boulder des Athleten; `reuseOf` (kein zweiter leerer Platz, Reihenfolge zwischen mehreren Slots, folgt dem Eigentümer, erledigter/entfernter Eigentümer) |
| TI – Split-View-Spalten / Neustart | Runden in Spalten sind TI-fähig; nach Wiederherstellung ist die Liste leer |

**Gegenprobe:** Wer Server-Code ändert, sollte einmal absichtlich eine
Prüfung ausbauen (z. B. die Host-Key-Prüfung) und sehen, dass die Tests rot
werden – so wurde das bei der Einführung geprüft (2 Tests schlugen an).

---

## 2. Manuelle Tests – Gemeinsame Sitzungen

### 2.1 Sitzung anlegen und beitreten

| ID | Schritte | Erwartet | Status |
|---|---|---|---|
| S-01 | Event 1594 laden → Sequence → 3 Runden → „Shared session“ aufklappen → Passwort `pocket` → „Create shared session…“ | Host-Bereich: „Hosting session `<id>` · version 1“, Link + QR, Meldung „Session … is live“ | ✔ |
| S-02 | Passwort mit 3 Zeichen | Fehlermeldung „at least 4 characters“, nichts angelegt | ✔ |
| S-03 | Leerer Editor (keine Runde) → Create | Meldung „Add at least one round…“; in einem anderen Reiter als Sequence: „…created and edited in Sequence mode“ | ✔ |
| S-04 | Sequence mit **einer** Runde → Create | Plan mit einer Runde; Tablet zeigt sie ohne „Next up“ | ✔ |
| S-05 | Sequence mit einem Split-View-Eintrag (1–5 Spalten) → Create | Plan `kind: watch` mit `type: split`; Tablet zeigt die Spalten (siehe 2.5) | ✔ |
| S-06 | Link in neuem Tab öffnen (`?s=<id>`) | Board erscheint ohne Passwort, oben „… · Session `<id>`“, Link = `?s=<id>` | ✔ |
| S-07 | Link mit **großgeschriebener** ID (`?s=DT2AUYEA`) | wird normalisiert, funktioniert | ✔ |
| S-08 | Unbekannte ID (`?s=zzzzzzzz`) ohne Cache | Setup-Seite mit „Session … was not found …“ | ✔ |
| S-09 | Tablet lädt neu (`/` ohne URL) | geht automatisch zurück in die Sitzung (gespeichert als Verweis, nicht als Plan) | ✔ |
| S-10 | `localStorage` prüfen | enthält Sitzungs-ID + Eigenwerte (Route/Swap), **keinen** Plan unter `callzone-selection` | ✔ |

### 2.2 Host-Zugang und Passwort

| ID | Schritte | Erwartet | Status |
|---|---|---|---|
| S-12 | Anderes Gerät: „Existing session ID“ + richtiges Passwort → „Edit existing session“ | angemeldet, Event geladen, Plan im Editor, Meldung „Plan loaded“ | ✔ (gleicher Browser, Zugang vorher gelöscht) |
| S-13 | Falsches Passwort | „Wrong password“, kein Host-Zugang | ✔ |
| S-14 | 5× falsch, danach richtig | 6. Versuch „Too many wrong passwords, try again in 60 s“; auch das richtige Passwort wird in der Sperre abgelehnt; nach 60 s geht es | ✔ |
| S-15 | Unbekannte ID / leere ID beim Login | „Session … was not found“ / „Enter the session ID“ | ✔ |
| S-16 | „Stop hosting on this device“ | Host-Bereich weg, Zugangsdaten gelöscht, Sitzung läuft für die Tablets weiter | ✔ |
| S-17 | Tablet **ohne** Passwort versucht zu schreiben (direkter `PUT`) | `403` | ✔ (automatisch) |

### 2.3 Plan ändern und anwenden

| ID | Schritte | Erwartet | Status |
|---|---|---|---|
| S-26b | Sitzung anlegen (Sequence), Seite neu laden, dasselbe Event laden | Der Editor steht im Sequence-Reiter mit **dem Live-Plan** (nicht mit Standardwerten), Host-Bereich nennt „Live on the tablets: …“, „Apply“ geht ohne „Reload plan“ | ✔ |
| S-27b | In der Liste eine Runde ändern | gelber Hinweis erscheint; „Apply to all tablets“ setzt **genau** diese Sequenz, Tablet folgt, „Live on the tablets“ zeigt sie | ✔ |
| S-20 | Im Editor etwas ändern | gelber Hinweis „You have changes that are not applied…“ | ✔ |
| S-21 | Reihenfolge ändern (Tablet steht auf Runde X, X bleibt im Plan) → Apply | **keine** Rückfrage; Tablet bleibt auf X, X rutscht nur in der Liste | ✔ |
| S-22 | Runde hinzufügen → Apply | keine Rückfrage, Tablet bleibt auf seiner Runde | ✔ |
| S-23 | Aktuelle Runde eines Tablets **entfernen** → Apply | Rückfrage „N tablet(s) are showing something this change removes…“ | ✔ |
| S-24 | Rückfrage abbrechen | „Cancelled – nothing was changed“, Version bleibt, Entwurf bleibt | ✔ |
| S-25 | Rückfrage bestätigen | Tablets wechseln innerhalb von ≤ 6 s auf die erste **unfertige** Runde des neuen Plans | ✔ |
| S-26 | Apply ohne Änderung | „Nothing to apply“ | ✔ |
| S-27 | Zwei Hosts: Host B veröffentlicht, Host A (veraltet) wendet an | `409`: „Someone else changed the plan…“, nichts überschrieben | ✔ |
| S-28 | Danach „Reload plan from server“ | Editor zeigt Version von Host B, Hinweis verschwindet | ✔ |
| S-29 | Mit **2 Tablets online** eine gemeinsame aktuelle Runde entfernen | Rückfrage nennt „2 tablets“; Host-Bereich zeigt „2 tablets online“ | ✔ |
| S-29a | Tablet mit **lokaler** Route (`&route=2`) / Swap bleibt nach Plan-Änderung erhalten | Route/Swap unverändert | ✔ |
| S-29b | „Skip to next“ in einer Sitzung (normales Board **und** Split-View-Spalten) | Der Knopf ist **nicht vorhanden** (er würde nur ein Tablet verschieben); „Next up:“/„Next:“-Zeile bleibt | ✔ |
| S-29b2 | Außerhalb einer Sitzung („Skip to next“ im normalen Board und in einer Split-View-Spalte) | Knopf ist wie bisher da und funktioniert (auch direkt nach einem Sitzungs-Board) | ✔ |
| S-29b3 | Hängende Runde in einer Sitzung: Host entfernt/ersetzt sie im Plan | Tablets wechseln nach Bestätigung auf die nächste unfertige Runde | ✔ (S-25) |
| S-29c | „Show next category’s startlist“ im Plan ein-/ausschalten | Tablet übernimmt die Einstellung | ✔ |
| S-29d | Paired Entry als aktueller Eintrag, Plan verschiebt ihn | Tablet bleibt auf dem Paired Entry, sein Zustand (Seite/Pin) bleibt erhalten | ✔ |
| S-29e | Host ersetzt die Runde, auf der ein Tablet steht, durch einen Split-View-Eintrag (und umgekehrt) | Tablet wechselt sauber auf den ersten unfertigen Eintrag (wie Neuöffnen) | ✔ |
| S-29f | Editor nach Seiten-Neuladen: **ohne** „Reload plan from server“ auf Apply | Wird abgelehnt (Editor zeigt Standardwerte, würde Plan überschreiben) | ✔ |
| S-29g | „Show this session“ und zurück | Entwurf im Editor bleibt erhalten | ✔ |

### 2.4 Verbindung, Neustart, Wiederherstellung

| ID | Schritte | Erwartet | Status |
|---|---|---|---|
| S-30 | Server stoppen und mit **gleichem** `SESSION_SECRET` neu starten (Host-Gerät hat noch Zugang) | Tablets: kurz „offline“, dann „ended“, Host-Gerät stellt die Sitzung unter **derselben ID** wieder her, Tablets zeigen wieder normalen Status; Plan bleibt der **neueste** | ✔ |
| S-31 | Server stoppen (ohne Neustart) | Tablets zeigen weiter die letzte Runde, Label „(offline – showing last plan)“, Statuszeile „Connection lost“ | ✔ |
| S-32 | Server mit **anderem/ohne** `SESSION_SECRET` neu starten | Tablets: „(ended – showing last plan)“; Host-Bereich: „can’t be restored … create a new one“; keine fremde Übernahme möglich | ✔ |
| S-33 | Tablet-Seite neu laden, während der Server die Sitzung nicht kennt (Cache vorhanden) | zeigt den letzten Plan mit „ended“-Hinweis | ✔ |
| S-34 | Apply, während der Server aus ist | „Couldn’t reach the server – nothing was applied“, Version unverändert | ✔ |
| S-35 | Apply direkt nach Server-Neustart (Sitzung vergessen) | Wiederherstellung + erneuter Versuch, danach „Applied“ | ✔ |
| S-36 | Tablet geht zurück ins Setup („switch round“) | Sitzungs-Abfragen stoppen (`sessionTimer` null), Host sieht es nach ≤ 15 s nicht mehr als online | ✔ |

### 2.5 Split View als Eintrag der Sequence / Sitzung (6.50)

Reiter **Sequence · Advanced** → „+ Add split view“ (1 bis 5 Kategorien
nebeneinander). Der frühere Reiter „Split View“ existiert nicht mehr. Eine
Spalte ist eine eigene Rundenfolge; der Eintrag ist fertig, wenn **alle**
Spalten fertig sind. (Testrunden: Boulder `13709` (Gruppen), `13712`, `13711`,
Finale `13735`/`13736`, Lead `13682`/`13680`, Event 1593/1594; laufender Stand
mit Ergebnis-Mock in der Konsole.)

| ID | Schritte | Erwartet | Status |
|---|---|---|---|
| S-40 | „Categories side by side“ | Auswahl 1, 2, 3, 4, 5 (Standard 2), die Zahl der Spalten-Karten folgt | ✔ |
| S-41 | Spalte: „+ Add Sequence“, ▲▼, × | Runde ergänzen / umsortieren / entfernen; Speed wird nie angeboten; eine in einer anderen Spalte oder Zeile benutzte Runde auch nicht | ✔ |
| S-42 | Spalte mit Boulder-Gruppen: „Group“-Auswahl, Routen ankreuzen | Gruppe setzt die Routenauswahl zurück; Plan hat `group`/`route` (alle oder keine angekreuzt = `null`); nach Neuladen identisch (Editor = Live-Plan, „Nothing to apply“) | ✔ |
| S-43 | Sitzung mit 3-Spalten-Split anlegen, Tablet öffnen | drei Spalten nebeneinander mit Daten, Gruppen-/Route-Tabs **ausgeblendet**, kein „Skip to next“, „Next up: …“ nennt den folgenden Eintrag | ✔ |
| S-44 | Host ändert nur den Filter einer Spalte → Apply | Rückfrage („N tablets…“), Tablet übernimmt es, **Fortschritt der Spalten bleibt** | ✔ |
| S-45 | Host ändert die Spaltenzahl oder die Runden einer Spalte → Apply | Rückfrage; Tablets wechseln auf den neuen Eintrag (erste unfertige Stelle); technische Zwischenfälle bleiben, solange ihre Runde im Plan ist, sonst werden sie gelöscht | ✔ |
| S-46 | Spalte mit zwei Runden: erste wird fertig | Spalte wechselt auf die zweite („Next: …“ in der Spalte), andere Spalten unbeeinflusst | ✔ |
| S-47 | Alle Spalten fertig, dahinter ein weiterer Eintrag | Tablet wechselt dorthin (auch Split → Split, auch ein 5-Spalten-Eintrag mit leerer Spalte); ein bereits fertiger Split wird beim Öffnen übersprungen | ✔ |
| S-48 | 1 Spalte | Titel ist der Name der Runde (nicht „Split View“), sonst wie eine normale Anzeige | ✔ |
| S-49 | 5 Spalten | alle fünf nebeneinander, nichts läuft über den Rand | ✔ |
| S-49a | Normale Sequence (ohne Sitzung) mit Split-Eintrag | lokale Tabs (Gruppe/Route) pro Spalte, „Skip to next“ pro Spalte, Boulder-Final-Umschalter pro Spalte, globales „Skip to next“ springt zum nächsten Eintrag | ✔ |
| S-49b | Link-Round-Trip (Split, Training, Paired, einzelne Runde, gemischt – auch als einziger Eintrag) | `rounds=…m<Spalte>*<Spalte>…` wird wieder genauso gelesen; „Show sequence“ mit leerem Split meldet einen Fehler | ✔ |
| S-49c | Alter Link `?multi=…` und ein früher gespeicherter Split View (`callzone-selection`) | öffnen als Sequence mit einem Split-Eintrag (Spalten, Gruppe, Route bleiben) | ✔ |
| S-49d | Dieselbe Runde zweimal im Plan (zwei Spalten / Split + Runde) | Builder bietet sie nicht an, Server `400` | ✔ (Builder und Server-Test) |
| S-49e | Technischer Zwischenfall in einer Spalte (JP-Seite listet die Runden aller Spalten); TI „am Ende“ in einer Spalte | TI erscheint nur in der betroffenen Spalte; die Spalte (und damit der Eintrag) wird erst nach „TI done“ fertig | ✔ |
| S-49f | Plan enthält Runde, die nicht (mehr) existiert | Spalte zeigt die bekannte Meldung „round could not be found“; beim Laden in den Editor wird sie weggelassen und gemeldet | ○ |
| S-49h | Zwei Split-Einträge hintereinander (je 2 Spalten, je 1 Runde), beim unteren „Continue the columns above“ | ein Eintrag, jede Spalte hat 2 Runden; Zeile verschwindet; Button nur unter einem Split-Eintrag (nicht unter Runde, nicht beim ersten) | ✔ |
| S-49i | Zusammenführen mit ungleicher Spaltenzahl / Lead+Boulder in einer Spalte / unterschiedlichen Gruppen-Tabs | Button deaktiviert / Meldung, nichts geändert / Rückfrage (Abbrechen ändert nichts, OK behält Tabs des oberen) | ✔ |
| S-49j | Wiedergabe des zusammengeführten Eintrags, Runde 1 von Spalte 1 fertig (Fertig-Prüfung gemockt) | Spalte 1 zeigt sofort Runde 2, Spalte 2 bleibt bei Runde 1; „Next:“ je Spalte; Eintrag fertig erst wenn beide Spalten fertig | ✔ |
| S-49k | Sitzung mit zusammengeführtem Plan: anlegen, neu laden, später einen Split-Eintrag anhängen + zusammenführen + „Apply“; TI auf die zweite Runde einer Spalte | Editor = Live-Plan, kein „unapplied“; Version 2; TI `201`, Runde außerhalb des Plans `400` | ✔ |
| S-49g | Server-Neustart (festes `SESSION_SECRET`) mit Split-Plan | Host-Gerät stellt die Sitzung mit demselben Plan wieder her, TIs sind weg | ✔ |

### 2.5a Sitzungen nur im Sequence-Reiter

| ID | Schritte | Erwartet | Status |
|---|---|---|---|
| S-60 | Reiter-Leiste | Single round · Training · **Sequence Advanced** (kein „Split View“-Reiter mehr) | ✔ |
| S-61 | Single round und Training (auch wenn dieses Gerät eine Sitzung hostet) | Bereich „Shared session“ ist **nicht** sichtbar | ✔ |
| S-62 | Reiter wechseln mit gehosteter Sitzung | im Sequence-Reiter alles wieder da (Editor = Live-Plan, kein gelber Hinweis); Event laden in Single round springt **nicht** auf Sequence | ✔ |
| S-63 | In Single round eine andere Runde wählen und „Show round“ | verändert die Sitzung **nicht** | ✔ |
| S-64 | Alte Sitzung vom Typ „Split View“ (`kind: "multi"`) | Server lehnt Plan ab (`400`); ein von einer älteren Version gecachter Plan dieser Form wird ignoriert („Session … was not found“) | ✔ |
| S-65 | Lange Split-Schlüssel im Heartbeat (5 Spalten × viele Runden) | Schlüssel kommt unverkürzt an, ein unveränderter Plan betrifft 0 Tablets | ✔ (Server-Test) |

### 2.7 Training als Eintrag der Sequence / Sitzung (Stufe 4)

| ID | Schritte | Erwartet | Status |
|---|---|---|---|
| T-01 | Sequence-Modus mit geladenem Event | „+ Add training“ samt Hinweis „or add a Speed training (stepped manually):“ ist sichtbar; in Single round / Training **nicht** | ✔ |
| T-02 | „+ Add training“ | Zeile mit Abzeichen „TRAINING“ und Auswahl **nur Speed-Runden**; Standard = erste Speed-Runde ohne Training | ✔ |
| T-03 | Dieselbe Speed-Runde zusätzlich als normale Runde einfügen | erlaubt (Training beansprucht die Runde nicht); ein **zweites** Training auf derselben Runde wird nicht angeboten | ✔ |
| T-04 | Training mit „▲▼×“ verschieben/entfernen | wie jede andere Zeile; der Knopf „+ Add training“ ist deaktiviert, wenn jede Speed-Runde schon ein Training hat | ✔ |
| T-05 | Normale Sequence ohne Sitzung starten (`rounds=t13719,13689`) | Board zeigt das Training (Titel „… — Training“, CLIMBING/NEXT), „Next up:“ nennt die nächste Runde, Link enthält `t13719`, „Skip to next“ ist da | ✔ |
| T-06 | …dieselbe Sequence: Steuer-Link-Zeile | „Link to control from another device“ erscheint **nur solange** das Training aktuell ist; im Vollbild verborgen | ✔ (Anzeige); ○ (Vollbild) |
| T-07 | Steuer-Link öffnen, „Next“ | Board folgt innerhalb ~1 s (gemessen ≈ 0,6 s) | ✔ |
| T-08 | Zähler bis hinter den letzten Athleten | Board wechselt von selbst zur nächsten Runde, keine weiteren Training-Abfragen | ✔ |
| T-09 | Sitzung mit Training anlegen | Host-Bereich zeigt „Link to control the training“ (Link + QR), verschwindet, sobald das Training aus dem Plan entfernt ist | ✔ |
| T-10 | Tablet öffnet die Sitzung | zeigt das Training, Herz-Schlag meldet `training:<id>`, kein „Skip to next“ | ✔ |
| T-11 | Steuer-Link mit gespeichertem Host-Zugang | Back/Next/Restart/Finish sichtbar; Back/Restart bei Position 0, Next/Finish am Ende deaktiviert | ✔ |
| T-12 | Steuer-Link **ohne** Host-Zugang | Passwortfeld, Anzeige bleibt lesbar, Knöpfe fehlen; direkter Schreibversuch → `403` | ✔ |
| T-13 | Falsches Passwort / richtiges Passwort | „Wrong password“ / Knöpfe erscheinen, Zugang wird gespeichert | ✔ |
| T-14 | „Next“ am Steuer-Gerät | Tablet folgt in ≈ 0,6 s | ✔ |
| T-15 | „Finish training“ | Steuerung zeigt „Finished“, alle Tablets wechseln zur nächsten Runde | ✔ |
| T-16 | „Restart training“ (Rückfrage) | Position 0 auf Steuerung und Tablets (solange sie noch auf dem Eintrag sind) | ✔ |
| T-17 | Training ist der **letzte** Eintrag | Tablets zeigen „Round finished“ am Ende, „Restart“ bringt sie zurück | ✔ |
| T-18 | Plan mit **zwei** Trainings | Steuerung zeigt eine Auswahl; Wechsel zeigt die andere Startliste | ✔ |
| T-19 | Host entfernt das Training, während ein Tablet darauf steht → Apply | Rückfrage „1 tablet …“; Tablet springt zur ersten unfertigen Runde | ✔ |
| T-20 | Training wieder einfügen → Apply | beginnt bei Position 0 | ✔ |
| T-21 | Training auf einer Runde **ohne Startliste** | Board zeigt „No startlist yet …“, der Eintrag wird **nicht** übersprungen | ✔ |
| T-22 | Plan mit Training in „Edit existing session“ laden | Zeile „TRAINING“ erscheint im Editor | ✔ |
| T-23 | Eigenständiges Training (Modus Training, Steuer-Link) | unverändert, offene Steuerung, Back/Next sichtbar | ✔ (Back/Next; Rest unverändert aus Stufe 1/R-04) |
| T-24 | Server-Neustart während eines Trainings | Position springt auf 0 (bekannt/akzeptiert) | ○ |

### 2.8 Technischer Zwischenfall (TI) – Jurypräsident

Testrunden auf `dav-stage`: Lead `13682` (Event 1593; ist abgeschlossen – für
einen laufenden Zustand die Ergebnisse im Browser per `fetch`-Mock setzen,
siehe AGENTS.md §3/§4) und Boulder mit Gruppen `13709` (Event 1594).

| ID | Schritte | Erwartet | Status |
|---|---|---|---|
| TI-01 | Host-Bereich einer Sitzung öffnen | Block „Jury President (JP) – technical incidents“ (eingeklappt) mit Link `…?s=<id>&jp=1` und QR | ✔ |
| TI-02 | JP-Link ohne gespeicherten Host-Zugang | Passwortfeld, die TI-Liste ist sichtbar, Formular und Knöpfe fehlen; falsches Passwort → „Wrong password“; richtiges → Formular erscheint | ✔ |
| TI-03 | Schreibversuch ohne Host-Key per `fetch` | `403`, nichts gespeichert | ✔ |
| TI-05 | „Add TI“ (Athlet #402 vor #405) | Tablet zeigt nach wenigen Sekunden #402 mit blauem Rahmen und „TI“-Abzeichen als NEXT, #405 rutscht in die Warteliste | ✔ |
| TI-06 | Nächster Athlet wird fertig (#405 an der Wand) | #402 (blau, „TI“) ist CLIMBING, #405 NEXT | ✔ |
| TI-07 | #405 wird `active` (beginnt zu klettern) | TI verschwindet von selbst, #405 ist CLIMBING; JP-Liste: „over – the next athlete has started“ | ✔ |
| TI-08 | „TI done“ | Eintrag verschwindet auf allen Tablets, Liste zeigt „done“ | ✔ |
| TI-09 | „Remove“ | Eintrag verschwindet auch aus der Liste und vom Server | ✔ |
| TI-10 | TI „at the end of the start list“ nach beendeter Runde | Lane zeigt den TI-Athleten (blau, „TI“) als CLIMBING statt „Round finished“; `isRoundFullyFinished()` ist `false`, nach „TI done“ wieder `true` (Sequenz geht weiter) | ✔ |
| TI-11 | Boulder (5 Boulder, Runde `13712` mit simulierter Rotation): Bib 201 (Platz 1), Boulder 4, „Boulder 1 stays free in front of start position“ 9, „Add TI“ | Vorschau „Boulder 1 stays free in front of #209“; **Wand: leerer Platz „—“ vor #209 auf Boulder 1, 2, 3 (und 5, sobald #209 im Bild ist), der Athlet (blau, „TI“) nur auf Boulder 4** | ✔ |
| TI-12 | Dieselbe Runde, Rotation läuft weiter: #209 hat auf Boulder 1 und 2 schon gestartet | auf Boulder 1 und 2 ist der leere Platz weg (Sicherheitsnetz, pro Boulder), auf Boulder 3 und 5 bleibt er, auf Boulder 4 steht #201 (TI) vor #209 | ✔ |
| TI-13 | Sitzung mit Split-View-Eintrag | TI erscheint in der betroffenen Spalte | ✔ |
| TI-14 | Route-Tab „Route 1“ (einzelne Lane) | TI wird auch dort gezeigt | ✔ |
| TI-15 | Speed-Runde im JP-Formular wählen | Hinweis „not available for Speed rounds“, „Add TI“ deaktiviert; direkter Schreibversuch → `400` | ✔ |
| TI-16 | JP-Seite auf Handy-Breite (375 px) | kein horizontales Scrollen, Knöpfe gut tippbar | ✔ |
| TI-17 | Normale Links (ohne Sitzung) und Sequenzen | unverändert, keine Konsole-Fehler | ✔ |
| TI-18 | Server-Neustart mit TI (mit festem `SESSION_SECRET`) | Sitzung `404`, nach Wiederherstellung ist die TI-Liste leer, der alte Host-Key legt wieder TIs an | ✔ (Server, per API; Tablet-Anzeige danach ○) |
| TI-19 | JP-Link/QR mit echtem Handy, Touch-Bedienung der Dropdowns | funktioniert | ○ |
| TI-20 | Zwei Tablets, TI während sie auf verschiedenen Runden stehen | nur Tablets mit der betroffenen Runde zeigen den TI | ○ |
| TI-29 | JP-Seite offen, Host entfernt die gerade angezeigte Runde aus dem Plan | Dropdown springt auf die neue Runde **und** das Formular (Routen, Athleten) wird für diese Runde neu geladen; nichts von der alten bleibt stehen | ✔ |
| TI-28 | Wand: TI als NEXT-Karte und in der Warteliste | roter bzw. grüner Karteninhalt unverändert, blauer Rahmen + „TI“-Abzeichen in der Ecke; Listenzeile blau mit Abzeichen | ✔ |
| TI-30 | JP-Formular: Startnummer eintippen (`403`, `#403`, vollständiger Name, eindeutiger Namensteil) | Athlet wird erkannt, Zeile darunter: „#403 · NAME has a result on 1 of 1 route.“; unbekannte/zu kurze/mehrdeutige Eingabe → rote Zeile, „Add TI“ gesperrt | ✔ |
| TI-35 | Athlet eintippen, dessen nächster planmäßiger Athlet auf dem Boulder schon gestartet ist | rote Zeile „Deadline probably passed …“ (kein Sperren); kein Hinweis, wenn der nächste noch nicht gestartet ist | ✔ |
| TI-04 | JP-Formular Lead (`13682`): Runde, Bib, „in front of a start position“ 7 bzw. „at the end of the start list“ | Vorschau „before #407“ bzw. „at the end of the start list“; kein Boulder-Feld; Warnung, wenn der Athlet dort schon gestartet ist | ✔ |
| TI-22 | Boulder-Formular: Startposition tippen (`9`, `30`, `abc`, leer) | `9` → „= #209 · NAME“; `30` → „Behind the last athlete (position 21) - the end of the start list.“; `abc` → „Enter the start position as a number.“, Add gesperrt; leer → Add gesperrt | ✔ |
| TI-23 | Zweiter TI „uses the slot of another TI“ (Bib 203, Boulder 3, Slot von TI 1) | Auswahl bietet nur offene TIs anderer Boulder desselben Blocks; **Wand: auf Boulder 3 steht #203 an der Stelle des leeren Platzes von TI 1 (kein zweiter leerer Platz), auf Boulder 4 #201, auf Boulder 5 ein leerer Platz** | ✔ |
| TI-24 | „Edit“ bei TI 1: Startposition 9 → 11, „Save changes“ | Formular mit Bib/Boulder/Position gefüllt, Runde und Gruppe gesperrt, „Cancel“ sichtbar; nach dem Speichern leeres Formular; **Wand: #201 und der Mitnutzer #203 stehen jetzt vor #211** | ✔ |
| TI-26 | TI 1 entfernen, während TI 2 seinen Slot mitnutzt | TI 2 behält die Position (jetzt mit eigener Lücke: leere Plätze auf den anderen Bouldern) | ✔ |
| TI-27 | World-Series-Final `13735`: Bib 818, Boulder 3, Position 5 | wie jeder Boulder-TI (Athlet nur auf Boulder 3, leerer Platz auf den anderen vor demselben Athleten) | ✔ |
| TI-31 | Athlet ohne Ergebnis (`pending`) / gerade am Klettern (`active`) eintippen | `pending`: Warnung „has no result yet - only add this if the attempt is over…“ aber wählbar; `active`: „is climbing now“ | ✔ |
| TI-32 | Server: Boulder ohne `boulderRouteId`, Boulder außerhalb des Blocks, `reuseOf` ungültig (unbekannt, gleicher Boulder, anderer Block, selbst ein Mitnutzer), Lead mit Boulder-Feldern; `PUT` ohne Host-Key, Runde/Block ändern | `400` bzw. `403`/`404`; TI-Nummern werden nie neu vergeben | ✔ (Server-Test) |
| TI-34 | Overlay: `reuseOf` – Reihenfolge zwischen mehreren Slots, Eigentümer erledigt/entfernt, Position folgt dem Eigentümer | `npm test` | ✔ (Unit-Test) |
| TI-21 | Echter Ablauf in results.info (Wiederholung wirklich eintragen) | Verhalten von `active`/`restarted` beobachten; ggf. automatisches Ende nachrüsten (siehe ARCHITECTURE §6.48) | ○ |

### 2.6 Sicherheit und Robustheit

| ID | Schritte | Erwartet | Status |
|---|---|---|---|
| S-50 | Plan mit Gruppenname `<img src=x onerror=…>` | wird als Text behandelt, kein Skript läuft (`window.__xss` bleibt leer) | ✔ |
| S-51 | Passwort/Host-Key im Netzwerk-Tab der **Zuschauer-Tablets** | kommen in keiner Antwort an Zuschauer vor | ✔ (automatisch) |
| S-52 | Stand-alone Training-Modus | „Shared session“-Bereich ist ausgeblendet (ein Training als **Eintrag** der Sequence/Sitzung: siehe 2.7) | ✔ |
| S-53 | Plan mit 51 Einträgen / 6 Spalten per API | `400` | ✔ (automatisch) |
| S-54 | Sitzungs-QR-Code mit echtem Handy scannen | öffnet das Board | ○ |

---

## 3. Manuelle Tests – Anzeige (Stufe 1)

| ID | Prüfung | Erwartet | Status |
|---|---|---|---|
| A-01 | CLIMBING grün, NEXT rot, Rest grau, Vorschau der nächsten Kategorie dunkleres Grau/kursiv | Farben und Labels wie beschrieben; Labels stehen auf den Karten | ✔ |
| A-02 | Schriftgröße bei 2 Lanes, 1180×820 / 1920×1080 | ≈ 26 px / ≈ 47 px; Namen bis ca. 30 Zeichen in einer Zeile, längere brechen um | ✔ |
| A-03 | Einzelne Lane (Route-Tab) bei 1920×1080 | größere Schrift, Seite passt ohne zu scrollen | ✔ |
| A-04 | Split-View-Eintrag mit 3 Spalten | jede Lane richtet sich nach **ihrer eigenen** Breite; nichts läuft über den Rand | ✔ |
| A-05 | Handy-Breite 375 px | Mindestgrößen greifen, kein horizontales Scrollen | ✔ |
| A-06 | „⇔ Swap lanes“ bei Speed (Quali, Finale, Paired Entry, Training) | Reihenfolge der Lanes kehrt sich um, Überschrift bleibt „Lane A/B“, `swap=1` im Link, bleibt nach Neuladen | ✔ |
| A-07 | Swap bei Paired Entry | Stage-Synchronisation bleibt, kein „Weiterspringen“ | ✔ |
| A-08 | Swap-Knopf bei Lead/Boulder und in einem Split-View-Eintrag | nicht vorhanden | ✔ |
| A-09 | Swap in einer Sitzung (`?s=…&swap=1`) | wird als lokale Einstellung gespeichert, überlebt Plan-Änderungen | ✔ |
| A-10 | Safari < 16 (keine Container-Query-Einheiten) | alte Schriftgrößen als Fallback | ○ |

---

## 4. Regression – bestehende Funktionen (nach jeder größeren Änderung)

| ID | Prüfung | Erwartet | Status |
|---|---|---|---|
| R-01 | Single round (normaler Link, ohne Sitzung) | Board wie bisher, kein Sitzungs-Label, kein Sitzungs-Timer | ✔ |
| R-02 | Sequence (normal): Link `rounds=…`, Vorschau der nächsten Kategorie, „Skip to next“ | wie bisher | ✔ Start/Link und „Skip to next“ (springt auf die nächste Runde); Vorschau nur in der Sitzungsvariante (S-29c) erneut geprüft |
| R-03 | Paired Entry (normal) mit „Switch category now“ | wie bisher | ✔ Paired + Swap; „Switch category now“ nur ausgelöst (kein sichtbarer Seitenwechsel, die andere Seite hatte keine Heats) |
| R-04 | Training: Next/Back, Steuer-Link, `swap=1` | wie bisher; kein Sitzungsbereich | ✔ |
| R-05 | Sequence mit Split-View-Eintrag (ohne Sitzung) | Spalten, „Next:“-Zeile mit Skip-Knopf, Group/Route-Tabs **sichtbar** | ✔ |
| R-06 | Alte, bereits geteilte Links (`?host=…&event=…&rounds=…`) | öffnen unverändert | ✔ |
| R-07 | Konsole | keine JavaScript-Fehler (nur absichtlich provozierte HTTP-Fehler) | ✔ |
| R-08 | `npm audit` / App-Start ohne `SESSION_SECRET` | Start-Hinweis „SESSION_SECRET not set …“, App läuft normal | ✔ |
| R-09 | `RESULTS_API_KEY_*` (6.44) unverändert | weiterhin Referer-Fallback ohne Key | ○ (nicht berührt) |

---

## 5. Nicht geprüft / bekannte Grenzen

00. **Technische Zwischenfälle (TI):** echter Ablauf in results.info (TI-21),
   Handy/Touch (TI-19), Neustart mit TI (TI-18), mehrere Tablets (TI-20). Die
   Anzeige wurde mit simulierten Ergebnissen (Mock in der Browser-Konsole)
   geprüft, nicht mit einer live gewerteten Wiederholung.
0. **Training (Stufe 4) auf echten Geräten:** Steuerung vom Handy, Latenz im
   WLAN, Vollbild-Verhalten des Steuer-Links (T-06), Server-Neustart
   mitten im Training (T-24).

Diese Punkte konnten bei der Einführung **nicht** getestet werden – bitte vor
dem ersten echten Einsatz einmal durchgehen:

1. **Echte Tablets** (iPad, Safari/Chrome auf iOS): Bedienung des Host-Bereichs
   mit Touch, Passwortfeld, `window.confirm`-Rückfrage, QR-Scan (S-54).
2. **Render im Betrieb:** `SESSION_SECRET` als Umgebungsvariable gesetzt und
   danach einen Deploy/Neustart mit laufender Sitzung ausprobieren (S-30). Der
   Free-Tarif schläft nach 15 Minuten ohne Zugriffe ein – eine Sitzung ohne
   Tablets verschwindet damit.
3. **Safari < 16** (A-10) und sehr kleine/alte Geräte.
4. **Viele Tablets gleichzeitig** (> 10): nur die Server-Grenzen sind getestet,
   keine echte Last.
5. **Datenschutz-Text** (Abschnitt „Gemeinsame Sitzungen“) ist neu und
   nicht juristisch geprüft.
6. **Zwei Geräte-Zugriffe mit demselben Passwort gleichzeitig** wurden nur mit
   simuliertem zweitem Host (direkter API-Aufruf) getestet, nicht mit zwei
   echten Personen.
7. **Gesperrter Host:** Fremde können den Host für 60 s aussperren (5 falsche
   Passwörter pro IP) – bewusst akzeptiert, in ARCHITECTURE §6.46 dokumentiert.
8. **Die angezeigte Tablet-Zahl** kann nach dem Verlassen des Boards bis zu
   15 s zu hoch sein (Heartbeat läuft aus).
