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
| validatePlan lehnt ab | `null`/Array/String, falsche `kind`, leere Sequenz, unbekannter Host (inkl. `constructor`), Event-ID `12a`/`../x`, Runden-ID mit `?`, >50 Einträge, >5 Spalten, doppelte Runde in einer Spalte, Paired in Split View, zu lange Namen, falscher Routen-Typ |
| Split-View-Normalisierung | leere Routenliste → `null`, leere Spalte erlaubt |
| relocateIndex | findet den Eintrag nach Umsortieren, `-1` wenn entfernt |
| affectedClients (watch) | nur Tablets, deren aktueller Eintrag verschwindet; Umsortieren/Hinzufügen betrifft niemanden; Typwechsel betrifft alle |
| affectedClients (Split View) | Entfernen in Spalte, entfernte Spalte, Gruppen-/Routenwechsel |
| removesOrReplaces | Fallback, wenn die Tablet-Liste nicht abrufbar ist |

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
| Wechsel watch ↔ Split View | funktioniert |
| Kaputte/zu große Bodies | JSON-Fehler statt HTML/Absturz (`400`/`413`) |
| Heartbeats | werden gezählt, ablaufen nach 15 s, nur mit Host-Key sichtbar, Client-IDs nie ausgegeben, ungültige IDs ignoriert |
| Heartbeat-Grenzen | höchstens 5 Schlüssel, je ≤ 60 Zeichen |
| Wiederherstellung | mit festem Secret unter derselben ID, neue Version, alter Host-Key und Passwort gelten weiter, zweiter Wiederherstellungs-Versuch überschreibt nichts |
| Wiederherstellung – Race | das Gerät mit dem **neueren** Plan gewinnt, nie über eine veröffentlichte Änderung |
| Wiederherstellung abgelehnt | gefälschter Key, fremder Record, kaputte Daten, ohne festes Secret nach Neustart |
| Limits | Sitzungs-Obergrenze (am längsten ungenutzte fliegt raus), 24-h-Ablauf, Anlege-Limit pro IP |

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
| S-03 | Leerer Editor (keine Runde/Spalte) → Create | Meldung „Add at least one round…“ | ✔ |
| S-04 | Single round wählen → Create | Plan mit einer Runde; Tablet zeigt sie ohne „Next up“ | ✔ |
| S-05 | Split View (2 Spalten) → Create | Plan `multi`; Tablet zeigt Spalten | ✔ |
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
| S-29b2 | Außerhalb einer Sitzung („Skip to next“ im normalen Board und in Split View) | Knopf ist wie bisher da und funktioniert (auch direkt nach einem Sitzungs-Board) | ✔ |
| S-29b3 | Hängende Runde in einer Sitzung: Host entfernt/ersetzt sie im Plan | Tablets wechseln nach Bestätigung auf die nächste unfertige Runde | ✔ (S-25) |
| S-29c | „Show next category’s startlist“ im Plan ein-/ausschalten | Tablet übernimmt die Einstellung | ✔ |
| S-29d | Paired Entry als aktueller Eintrag, Plan verschiebt ihn | Tablet bleibt auf dem Paired Entry, sein Zustand (Seite/Pin) bleibt erhalten | ✔ |
| S-29e | Plan wechselt zwischen normaler Ansicht und Split View | Tablet wechselt sauber die Anzeigeart (wie Neuöffnen) | ✔ |
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

### 2.5 Split-View-Sitzung

| ID | Schritte | Erwartet | Status |
|---|---|---|---|
| S-40 | Spalte mit Boulder-Gruppe A/B: Auswahl „Group“ | Routenauswahl wird auf die Gruppe zurückgesetzt | ✔ |
| S-41 | Routen ankreuzen (2 von 5) | Plan hat `route: ["2","3"]`, **alle** angekreuzt oder **keine** = `null` | ✔ |
| S-42 | Tablet-Anzeige | zeigt genau diese Gruppe/Routen; Gruppen-/Route-Tabs sind **ausgeblendet** | ✔ |
| S-43 | Host wechselt Gruppe (A → B) → Apply | Rückfrage (betrifft das Tablet), Tablet wechselt die Gruppe | ✔ |
| S-44 | Normales (Nicht-Sitzungs-)Split-View mit Gruppe/Route | URL enthält `multi=…~Group B~2+3`, Board zeigt sie | ✔ |
| S-45 | Plan enthält Runde, die nicht (mehr) existiert | Spalte zeigt die bekannte Meldung „round could not be found“, kein Absturz; beim Laden in den Editor wird sie weggelassen und gemeldet | ✔ |

### 2.6 Sicherheit und Robustheit

| ID | Schritte | Erwartet | Status |
|---|---|---|---|
| S-50 | Plan mit Gruppenname `<img src=x onerror=…>` | wird als Text behandelt, kein Skript läuft (`window.__xss` bleibt leer) | ✔ |
| S-51 | Passwort/Host-Key im Netzwerk-Tab der **Zuschauer-Tablets** | kommen in keiner Antwort an Zuschauer vor | ✔ (automatisch) |
| S-52 | Training-Modus | „Shared session“-Bereich ist ausgeblendet | ✔ |
| S-53 | Plan mit 51 Einträgen / 6 Spalten per API | `400` | ✔ (automatisch) |
| S-54 | Sitzungs-QR-Code mit echtem Handy scannen | öffnet das Board | ○ |

---

## 3. Manuelle Tests – Anzeige (Stufe 1)

| ID | Prüfung | Erwartet | Status |
|---|---|---|---|
| A-01 | CLIMBING grün, NEXT rot, Rest grau, Vorschau der nächsten Kategorie dunkleres Grau/kursiv | Farben und Labels wie beschrieben; Labels stehen auf den Karten | ✔ |
| A-02 | Schriftgröße bei 2 Lanes, 1180×820 / 1920×1080 | ≈ 26 px / ≈ 47 px; Namen bis ca. 30 Zeichen in einer Zeile, längere brechen um | ✔ |
| A-03 | Einzelne Lane (Route-Tab) bei 1920×1080 | größere Schrift, Seite passt ohne zu scrollen | ✔ |
| A-04 | Split View mit 3 Spalten | jede Lane richtet sich nach **ihrer eigenen** Breite; nichts läuft über den Rand | ✔ |
| A-05 | Handy-Breite 375 px | Mindestgrößen greifen, kein horizontales Scrollen | ✔ |
| A-06 | „⇔ Swap lanes“ bei Speed (Quali, Finale, Paired Entry, Training) | Reihenfolge der Lanes kehrt sich um, Überschrift bleibt „Lane A/B“, `swap=1` im Link, bleibt nach Neuladen | ✔ |
| A-07 | Swap bei Paired Entry | Stage-Synchronisation bleibt, kein „Weiterspringen“ | ✔ |
| A-08 | Swap-Knopf bei Lead/Boulder und in Split View | nicht vorhanden | ✔ |
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
| R-05 | Split View (normal) | Spalten, „Next:“-Zeile mit Skip-Knopf, Group/Route-Tabs **sichtbar** | ✔ |
| R-06 | Alte, bereits geteilte Links (`?host=…&event=…&rounds=…`) | öffnen unverändert | ✔ |
| R-07 | Konsole | keine JavaScript-Fehler (nur absichtlich provozierte HTTP-Fehler) | ✔ |
| R-08 | `npm audit` / App-Start ohne `SESSION_SECRET` | Start-Hinweis „SESSION_SECRET not set …“, App läuft normal | ✔ |
| R-09 | `RESULTS_API_KEY_*` (6.44) unverändert | weiterhin Referer-Fallback ohne Key | ○ (nicht berührt) |

---

## 5. Nicht geprüft / bekannte Grenzen

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
