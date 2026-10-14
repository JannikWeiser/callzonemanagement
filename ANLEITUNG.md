# Callzone Management – Kurzanleitung

Zeigt an, wer bei einem Kletterwettkampf gerade an der Wand ist, wer als
nächstes dran ist und wer danach kommt.

**Hinweis:** Die App selbst (Buttons, Anzeigetexte) ist komplett auf
**Englisch**, damit sie auch bei internationalen Wettkämpfen (IFSC etc.)
verständlich ist. Diese Anleitung hier ist auf Deutsch, verweist aber auf
die englischen Beschriftungen in der App.

Es gibt zwei Varianten, die App zu erreichen – je nachdem, was eingerichtet
wurde:

- **Gehostet (empfohlen, falls eingerichtet):** feste Adresse wie
  `https://callzone-management.onrender.com`, funktioniert auf jedem Gerät
  mit Internet, kein WLAN-Abhängigkeit. Einrichtung einmalig, siehe
  [HOSTING.md](HOSTING.md).
- **Lokal:** Laptop startet den Server, andere Geräte müssen im selben WLAN
  sein. Siehe unten.

## 1. Programm starten (nur bei lokaler Nutzung, einmal pro Wettkampftag)

Auf dem Laptop, auf dem das Programm installiert ist:

1. Terminal öffnen.
2. In den Programmordner wechseln und starten:
   ```bash
   cd Desktop/CallZonemanagement
   npm start
   ```
3. Das Terminal-Fenster muss die ganze Zeit geöffnet bleiben, solange die
   Anzeige benutzt wird.

Bei der gehosteten Variante entfällt dieser Schritt komplett – die Adresse
ist einfach immer erreichbar.

## 2. Anzeige öffnen

- **Gehostet:** die feste URL (z. B. `https://callzone-management.onrender.com`)
  auf jedem Gerät im Browser öffnen.
- **Lokal, auf demselben Laptop:** Browser öffnen, Adresse `http://localhost:4173`
- **Lokal, auf einem iPad/Tablet/zweiten Laptop:** Gerät muss im **selben
  WLAN** sein wie der Laptop, dann im Browser die IP-Adresse des Laptops
  eingeben, z. B. `http://192.168.1.23:4173`
  (die genaue Adresse verrät euch, wer das Programm gestartet hat, oder
  steht in der README). Falls die Seite nicht lädt ("Service antwortet
  nicht"): meist blockiert die macOS-Firewall eingehende Verbindungen zu
  Node, oder das iPad ist doch nicht im selben WLAN (z. B. Gäste-WLAN mit
  Geräte-Isolation) – in dem Fall lohnt sich die gehostete Variante.

## 3. Wettkampf auswählen

1. **Event ID** eintragen. Die findet ihr in der Adresse auf
   [results.info](https://dav.results.info), z. B. bei
   `dav.results.info/event/2101/` ist die Event ID `2101`.
2. **Server:** je nachdem, wo der Wettkampf ausgeschrieben ist –
   `dav.results.info` für DAV-Wettkämpfe, `ifsc.results.info` für
   IFSC-/Weltcup-Wettkämpfe (die Test-Option braucht ihr normalerweise
   nicht).
3. Auf **„Load event"** klicken.
4. Oben erscheinen drei Reiter: **„Single round"**, **„Training"** und
   **„Sequence – Advanced"**. Für eine einzelne Runde bleibt ihr bei „Single
   round" (voreingestellt).
5. Im Dropdown die passende **Altersklasse und Runde** auswählen
   (z. B. „LEAD U13 m — Qualifikation").
6. Auf **„Show"** klicken.

Die Anzeige aktualisiert sich danach von selbst alle paar Sekunden – ihr
müsst nichts mehr tun.

Die anderen Reiter — **„Training"** (Speed-Training ohne Live-Ergebnisse) und
**„Sequence – Advanced"** (mehrere Runden nacheinander, inkl.
Speed-Verschränken, **mehreren Kategorien nebeneinander** und **gemeinsamen
Sitzungen**) — sind in den Schritten 5 bis 7a unten beschrieben.

## 4. Anzeige lesen

- **Oben, groß, orange ("CLIMBING"):** Athlet·in, die/der gerade an der
  Wand ist
- **Darunter ("NEXT"):** Athlet·in, die/der als Nächstes dran ist
- **Liste darunter:** die Athlet·innen, die danach folgen
- Bei Disziplinen mit mehreren Routen gleichzeitig (z. B. Boulder mit 4
  Routen) wird für jede Route eine eigene Spalte angezeigt.

Über **„← switch round"** oben links könnt ihr jederzeit zu einer anderen
Altersklasse/Runde wechseln.

### Boulder mit Gruppe A / B

Boulder-Qualifikationen mit großem Feld laufen oft in zwei parallelen
Gruppen ("Group A" / "Group B") auf getrennten Wänden. Die App zeigt dann
oben zwei Reiter zum Umschalten – standardmäßig ist nur eine Gruppe
sichtbar (sonst wären es bis zu 10 Spalten auf einmal). Der Link im Feld
„Link for this tablet" merkt sich die gerade gewählte Gruppe mit, ihr könnt
also z. B. ein Tablet fest auf „Group A" verlinken und ein zweites auf
„Group B".

### Speed-Finale (K.-o.-System)

Bei Speed-Finalrunden (K.-o.-Baum mit 1/8-Finale, Viertelfinale,
Halbfinale, kleinem und großem Finale) zeigt die App eine eigene Spalte pro
Bahn (Lane A / Lane B) – genau wie bei der Quali: „CLIMBING" zeigt, wer
gerade auf dieser Bahn dran ist, „NEXT" die nächste Person auf derselben
Bahn, und darunter alle weiteren noch offenen Läufe der aktuellen Stufe
(z. B. alle verbleibenden Viertelfinal-Duelle) in der Reihenfolge, wie sie
dran sind. Sobald eine Stufe fertig ausgewertet ist, springt die Anzeige
automatisch zur nächsten (z. B. von Viertelfinale zu Halbfinale).

## 5. Mehrere Klassen nacheinander (Sequenz, z. B. für Speed)

Statt nur einer einzelnen Runde könnt ihr eine **Reihenfolge von Runden**
festlegen, die automatisch nacheinander angezeigt werden – z. B. „Quali
Speed Herren" → „Quali Speed Damen" → „Finale Speed Herren" → „Finale Speed
Damen". Sobald eine Runde komplett fertig ausgewertet ist, springt die
Anzeige von selbst zur nächsten.

1. Oben den Reiter **„Sequence"** wählen.
2. Eine Runde im Dropdown auswählen, dann auf **„+ Add to sequence"**
   klicken. Die Runde erscheint in einer Liste darunter.
3. Nächste Runde im Dropdown wählen, wieder „+ Add to sequence" – so lange
   wiederholen, bis alle gewünschten Runden in der Liste stehen.
4. Reihenfolge per **Drag & Drop** anpassen (Eintrag anfassen und
   verschieben). Mit dem „×" lässt sich ein Eintrag wieder entfernen.
5. Auf **„Show sequence"** klicken.

Die Anzeige startet dann automatisch bei der ersten noch nicht
abgeschlossenen Runde der Liste (bereits fertige Runden werden beim Start
übersprungen) und schaltet danach von selbst weiter, sobald jeweils die
aktuelle Runde fertig ist. Der Tablet-Link merkt sich die ganze Sequenz,
lässt sich also genauso als Lesezeichen speichern wie bei einer einzelnen
Runde (Schritt 7).

### Speed-Finale verschränkt laufen lassen (zwischen Startklassen abwechseln)

Bei Speed-Finalrunden läuft der Ablauf oft nicht "eine Startklasse komplett
zu Ende, dann die nächste", sondern verschränkt: erst das Achtelfinale von
Startklasse 1 und 2, dann das Viertelfinale von beiden, dann Halbfinale
usw. – erst wenn beide K.-o.-Bäume fertig sind, geht's mit der nächsten
Startklassen-Kombination weiter.

Im Reiter **„Sequence"** erscheint dafür, sobald das Event mindestens zwei
Speed-Finalrunden hat, ein eigener Bereich **„Interleave two Speed
finals"**:

1. Die beiden gewünschten Startklassen in den zwei Dropdowns auswählen
   (z. B. „SPEED Herren+ — Finale" und „SPEED U15+ Männlich — Finale").
2. Auf **„+ Add paired entry"** klicken. In der Sequenz-Liste erscheint
   **ein** Eintrag „A ↔ B" (nicht mehrere Einzeleinträge).
3. Wie gewohnt auf **„Show sequence"** klicken (ggf. erst weitere
   Einzelrunden oder Paare hinzufügen).

Die Anzeige hält beide Startklassen dabei bewusst auf derselben Stufe: erst
wenn **beide** Startklassen mit dem Achtelfinale durch sind, geht's für
beide gemeinsam mit dem Viertelfinale weiter – auch wenn eine Startklasse
schneller vorankommt als die andere (z. B. weil dort schon mehr Ergebnisse
eingetragen wurden). So entsteht zuverlässig genau die Reihenfolge
Achtelfinale Klasse 1 → Achtelfinale Klasse 2 → Viertelfinale Klasse 1 →
Viertelfinale Klasse 2 usw. Erst wenn beide K.-o.-Bäume komplett
durchgelaufen sind, geht die Sequenz zum nächsten Eintrag weiter.

**Falls es mal nicht automatisch weiterspringt** (z. B. weil ein einzelnes
Ergebnis in der Live-Wertung hängen bleibt): Nach **90 Sekunden ohne
Änderung** am aktuellen Duell schaltet die App von selbst zur anderen
Startklasse weiter. Wer nicht so lange warten will, klickt stattdessen
sofort selbst auf den Knopf **„⇄ Switch category now"**, der oben auf dem
Board erscheint, solange ein „A ↔ B"-Paar aktiv ist.

## 6. Speed-Training (ohne Live-Ergebnisse)

Trainingseinheiten laufen nicht über results.info und liefern deshalb keine
Live-Ergebnisse, aus denen die App "wer klettert gerade" ableiten könnte.
Die Startreihenfolge im Training entspricht aber meist der Reihenfolge aus
der echten Qualifikationsrunde – deshalb lässt sich diese Reihenfolge
wiederverwenden, das Weiterschalten erfolgt dann von Hand:

1. Oben den Reiter **„Training"** wählen.
2. Die passende Runde auswählen (üblicherweise die
   **Qualifikationsrunde**, deren Startreihenfolge dem Training entspricht).
3. Auf **„Start training"** klicken.

Statt der automatischen Live-Anzeige erscheint oben ein Bedienfeld mit
**„← Back"** und **„Next →"**. Jeder Klick auf „Next" schaltet **alle**
Bahnen/Routen gemeinsam einen Platz weiter (ein Klick reicht für alle
Spalten gleichzeitig) – gedacht für den Fall, dass alle Athlet·innen im
Training synchron nacheinander klettern. Die Position wird nicht dauerhaft
gespeichert: nach einem Neustart des Servers beginnt die Zählung wieder bei
0 (ein normaler Seiten-Reload ist unproblematisch, siehe unten).

### Von einem zweiten Gerät aus weiterschalten

Ihr müsst das Weiterschalten nicht zwingend auf dem Wand-Tablet selbst
bedienen. Auf dem Board erscheint zusätzlich zum normalen Tablet-Link ein
zweites Feld **„Link to control from another device"**:

1. Diesen zweiten Link auf einem beliebigen anderen Gerät öffnen (Handy,
   zweites Tablet, ...).
2. Dort erscheint eine schlanke Ansicht: nur die aktuellen Namen pro
   Bahn/Route, plus große **„← Back"**/**„Next →"**-Tasten.
3. Ein Tastendruck dort aktualisiert das Wand-Tablet automatisch innerhalb
   von etwa einer Sekunde – und umgekehrt: Tasten auf dem Wand-Tablet
   wirken sich genauso auf das zweite Gerät aus. Beide Geräte zeigen also
   immer denselben Stand.

Der Steuer-Link braucht keinen Login – wer den Link hat, kann mitschalten
(genau wie beim normalen Board-Link).

## 7. Mehrere Tablets gleichzeitig (je eigene Startklasse)

Jedes Gerät kann unabhängig eine eigene Altersklasse/Runde anzeigen – z. B.
Tablet 1 zeigt Boulder U11, Tablet 2 zeigt Lead U15, gleichzeitig, ohne dass
sie sich gegenseitig stören.

Damit ein Tablet nach dem Ausschalten/Neuladen sofort wieder **seine**
Startklasse zeigt (statt der Auswahl-Maske):

1. Auf dem Tablet einmal wie in Schritt 3 die gewünschte Runde auswählen.
2. Oben auf dem Board erscheint ein Feld **„Link for this tablet"** mit
   einem Kopieren-Button.
3. Diesen Link als Lesezeichen speichern (oder als Icon auf den Homescreen
   legen: Teilen-Symbol → „Zum Home-Bildschirm").
4. Ab jetzt öffnet dieser Link auf diesem Tablet immer direkt die richtige
   Startklasse – auch nach einem Neustart.

Jedes Tablet bekommt so seinen eigenen Link mit seiner eigenen Runde (und,
bei Boulder, seiner eigenen Gruppe).

## 7a. Gemeinsame Sitzung (ein Plan für mehrere Tablets)

Statt jedes Tablet einzeln einzurichten, kannst du **einen Plan veröffentlichen**,
dem alle Tablets folgen – und ihn später für alle gleichzeitig ändern.

**Wichtig:** Gemeinsame Sitzungen gibt es **nur im Reiter „Sequence – Advanced"**.
In „Single round" und „Training" taucht der Bereich „Shared session" gar nicht
auf; diese beiden Reiter sind für **ein** Gerät gedacht und verändern keine
Sitzung. Eine einzelne Runde veröffentlichst du als Sequence mit einer Runde.

**Sitzung erstellen (Host):**
1. Event laden, zum Reiter **Sequence (Advanced)** wechseln und die Sequenz
   zusammenstellen: Runden, **„+ Add paired entry"**, **„+ Add training"** und
   **„+ Add split view"** (mehrere Kategorien nebeneinander, siehe unten).
2. Unten **„Shared session (optional)"** aufklappen, ein **Host-Passwort**
   (mind. 4 Zeichen) eingeben und **„Create shared session…"** drücken.
3. Es erscheint ein **Link und ein QR-Code**. Auf jedem Tablet diesen Link
   öffnen (QR-Code scannen) – fertig. Das Tablet braucht kein Passwort.
   Im Host-Bereich steht außerdem **„Live on the tablets: …"** – dort siehst
   du sofort, welche Runden gerade veröffentlicht sind.

**Mehrere Kategorien nebeneinander („+ Add split view"):** Ein solcher Eintrag
der Sequence zeigt **1 bis 5 Kategorien nebeneinander** (Auswahl „Categories
side by side"). Das ist der frühere Reiter „Split View" – alle Funktionen sind
jetzt hier:
- Jede Spalte hat ihre **eigene Rundenfolge** (z. B. Quali → Finale; mit
  „+ Add Sequence" ergänzen, mit ▲▼ umsortieren, mit × entfernen), die
  unabhängig von den anderen Spalten durchläuft.
- Pro Spalte legst du **Gruppe und Routen/Boulder** fest. In einer Sitzung
  bestimmt der Host das; auf einem einzelnen Gerät (ohne Sitzung) gibt es
  zusätzlich die Tabs auf dem Board.
- Eine Spalte darf auch leer bleiben (zeigt „Round finished").
- Der Eintrag ist **fertig, wenn alle Spalten fertig sind** – dann geht die
  Sequenz zum nächsten Eintrag.
- **Jede Spalte soll einzeln weiterschalten** (z. B. Quali → Finale, ohne auf
  die andere Spalte zu warten)? Trage die Runden **pro Spalte hintereinander**
  ein („+ Add Sequence" in der Spalte). Hast du schon zwei Split-View-Einträge
  hintereinander angelegt, klicke beim unteren auf **„Continue the columns
  above"**: Seine Runden werden spaltenweise an den oberen Eintrag angehängt.
  Das geht nur bei gleicher Spaltenzahl und ohne Lead/Boulder in derselben
  Spalte zu mischen.
- Eine Runde darf in der **ganzen Sequenz nur einmal** vorkommen, auch nicht in
  zwei Spalten. Ein Split View kann nur Lead und Boulder enthalten, kein Speed.
- **Technische Zwischenfälle (TI)** und der JP-Link funktionieren in jeder Spalte.
- Alte Links mit `multi=…` und ein früher gespeicherter Split View öffnen sich
  weiterhin und werden als Sequence mit einem Split-View-Eintrag angezeigt.

**Plan später ändern:**
1. Im Reiter **Sequence (Advanced)** die Sequenz ändern (Reihenfolge,
   Runden hinzufügen/entfernen …).
   Dort steht „You have changes that are not applied to the tablets yet".
2. **„Apply to all tablets"** drücken. Betrifft die Änderung eine Runde,
   die gerade auf Tablets läuft, fragt das Programm vorher nach
   („3 tablets are showing something this change removes …").
3. Nur Verschieben oder Hinzufügen verändert **nichts** auf den Tablets –
   jedes Tablet bleibt bei **seiner** aktuellen Runde.

**Von einem anderen Gerät bearbeiten:** Auf dem Gerät „Shared session" →
**Session-ID** und **Host-Passwort** eingeben → **„Edit existing session"**.
Der aktuelle Plan wird in den Editor geladen. Nach 5 falschen Passwörtern
ist die Eingabe 60 Sekunden gesperrt.

### Training als Teil der Sequenz / Sitzung

Ein Speed-Training kann jetzt **mitten im Ablauf** stehen (z. B. Training →
Qualifikation):

1. Im Sequence-Editor **„+ Add training“** drücken und die Speed-Runde wählen,
   deren **Startliste** das Training verwendet. Dieselbe Runde darf zusätzlich
   als echte Runde in der Sequenz stehen.
2. Tablets zeigen das Training wie im Training-Modus (CLIMBING/NEXT). Das
   Weiterschalten macht ein **Steuer-Gerät**:
   - **In einer gemeinsamen Sitzung:** im Host-Bereich erscheint
     **„Link to control the training“** (Link + QR). Auf dem Handy öffnen,
     einmal das **Host-Passwort** eingeben, dann **Next/Back**. Mit
     **„Finish training“** endet das Training sofort, mit **„Restart
     training“** beginnt es von vorn.
   - **In einer normalen Sequenz (ohne Sitzung):** auf dem Board steht
     „Link to control from another device“ (ohne Passwort, wie bisher).
3. Sobald das Training **hinter dem letzten Athleten** angekommen ist, wechseln
   **alle Tablets gleichzeitig** zur nächsten Runde.

Gut zu wissen: Ein Training ohne veröffentlichte Startliste zeigt „No startlist
yet“ und wird **nicht** übersprungen. Nach einem Server-Neustart beginnt ein
Training wieder bei Athlet 1. Ein Training kann nicht in einem Split-View-Eintrag stehen.

### Technischer Zwischenfall (TI) – Jurypräsident

Wenn nach einem technischen Zwischenfall ein Athlet **nochmal klettern** darf
(nur **Lead** und **Boulder**, nicht Speed), trägt der Jurypräsident (JP) das
auf seinem Handy ein. Voraussetzung ist eine **gemeinsame Sitzung**.

**Wichtig:** Die Callzone **rechnet den Zeitpunkt nicht aus**. Das macht der
**TI-Rechner** (ti.comptools.cloud). Der JP übernimmt sein Ergebnis hier – die
Callzone zeigt es auf der Wand an.

1. Im Host-Bereich unter „Shared session“ den Block **„Jury President (JP) –
   technical incidents“** aufklappen. Dort stehen **Link und QR-Code** für den JP.
2. Der JP öffnet den Link am Handy und gibt **einmal das Host-Passwort** ein.
3. **TI eintragen** (alle Felder sind am Anfang leer):
   - die **Kategorie/Runde** und bei Boulder die **Gruppe/den Kurs**,
   - den **Athleten, der nochmal klettert**: die **Startnummer (Bib)** eintippen
     (auch „#12“ oder ein Namensteil geht). Es ist **jeder Athlet des Blocks**
     wählbar, auch einer, der gerade nicht mehr klettert oder dessen Ergebnis noch
     nicht eingetragen ist. Die Zeile darunter sagt, ob er ein Ergebnis hat, gerade
     klettert oder noch keines hat (rote Warnung – wählbar bleibt er trotzdem). Hat
     der nächste planmäßige Athlet schon gestartet, steht dort eine Fristwarnung,
   - bei Boulder: **auf welchem Boulder** der Athlet nochmal klettert,
   - dann das Ergebnis aus dem **TI-Rechner**, eine von drei Möglichkeiten:
     - **„Boulder 1 stays free in front of a start position“**: die Startposition
       eintippen, die der TI-Rechner bei „Lücke Boulder 1“ nennt („Call Zone B1:
       **vor Startposition X** niemanden aufrufen“). Darunter steht, welcher Athlet
       das ist – so fällt ein Tippfehler auf. Bei Szenario 1 („vor dem nächsten
       Athleten“) ebenfalls die Position des nächsten Athleten,
     - **„No gap needed (end of the start list)“**: der TI-Rechner sagt „keine nötig
       – Ende der Startliste“,
     - **„No new gap: uses the slot of another TI“**: der TI-Rechner sagt „nutzt den
       Slot von …“; den anderen TI aus der Liste wählen,
   - bei **Lead** gibt es nur „in front of a start position“ und „at the end of the
     start list“,
   - **„Add TI“**. Die Zeile darüber zeigt noch einmal, was gespeichert wird.
4. **Auf der Wand:** Bei Boulder steht der TI-Athlet (blau, „TI“) **nur auf seinem
   Boulder**, an der Stelle des Slots. Auf **allen anderen Bouldern der Gruppe**
   steht an dieser Stelle der Hinweis **„TI: no athlete“** (kursiv, blau umrandet, als Karte oder als Zeile in der Warteliste): dort wird in diesem Intervall
   niemand aufgerufen. Nutzt ein TI den Slot eines anderen, steht er auf seinem
   Boulder an dessen Stelle (kein zweiter Hinweis „TI: no athlete“). Bei Lead steht der Athlet
   auf seiner Route vor dem gewählten Athleten.
5. **Ändert der TI-Rechner eine Position** (neuer TI, gelöschter TI, Warnung „neuen
   Slot durchgeben!“), beim TI auf **„Edit“** tippen, die Startposition anpassen und
   **„Save changes“**. Wer den Slot eines anderen mitnutzt, wandert mit.
6. Wenn der Athlet geklettert ist, drückt der JP **„TI done“** – dann verschwindet
   der Eintrag, und der reguläre Athlet rückt wieder nach. **„Remove“** nimmt
   einen versehentlich angelegten TI zurück (hat ein anderer TI seinen Slot
   mitgenutzt, behält der die Position).

Gut zu wissen:
- Beginnt der Athlet, **vor dem** der TI steht, in results.info zu klettern,
  endet der TI **auf dieser Route von selbst** (in der JP-Liste steht dann
  „over“). Sonst würde die Wand weiter den TI-Athleten als CLIMBING zeigen.
- results.info erfasst die Wiederholung nicht. Bei Boulder bleibt deshalb der
  vorherige Athlet CLIMBING und der TI-Athlet steht als NEXT dahinter, bis seine
  Wertung wieder auf „active“ geht oder der JP „TI done“ drückt.
- Löscht du im **TI-Rechner** einen TI, dessen Lücke noch gebraucht wird (er bleibt
  dort als „Slot … (gelöscht)“ stehen), lass ihn hier **offen**, bis die Lücke
  vorbei ist. Einen eigenen Eintrag „nur Lücke“ gibt es noch nicht.
- Ein TI **„am Ende der Startliste“** hält die Sequenz auf dieser Runde, bis
  er mit „TI done“ beendet ist – die Tablets gehen nicht schon zur nächsten Runde.
- Nach einem **Server-Neustart** sind alle TIs weg (wie die Trainingsposition);
  die Tablets zeigen bis dahin den letzten Stand. Dann den TI neu eintragen.
- Der Link zeigt ohne Passwort nur die Liste; **ändern** geht nur mit Host-Passwort.

**Gut zu wissen:**
- Oben rechts am Tablet steht die Sitzungs-ID. Steht dort „offline" oder
  „ended", zeigt das Tablet weiter den **letzten Plan** – es bricht nichts ab.
- Im Host-Bereich steht, **wie viele Tablets online** sind.
- Training kann Teil einer Sitzung sein (siehe oben); das eigenständige Training (Abschnitt 6) bleibt davon unberührt.
- Das Passwort kann nicht zurückgesetzt werden – notier es dir. Notfalls eine
  neue Sitzung erstellen.

## 8. Vollbild & Bildschirm wach halten

Oben auf dem Board gibt es den Button **„Fullscreen + Always On"**. Ein
Klick macht die Seite gleichzeitig vollbildig (keine Safari-Leiste mehr)
und verhindert, dass sich das Tablet-Display automatisch abschaltet oder
sperrt – gedacht für Tablets, die fest an der Wand hängen. Erneut klicken
("Exit fullscreen") beendet beides wieder.

Falls das auf einem älteren iPad nicht funktioniert: das "Wach halten"
braucht iPadOS 16.4 oder neuer. Vollbild funktioniert unabhängig davon,
sollte aber vor dem Wettkampf einmal kurz getestet werden.

## 9. Programm beenden

Im Terminal-Fenster `Strg + C` drücken (oder das Fenster schließen).

## Fehlermeldungen

| Meldung | Bedeutung |
|---|---|
| „Couldn't load event" | Event ID oder Server falsch – beides prüfen |
| „Connection lost" | Internetverbindung des Laptops prüfen (die Daten kommen live von results.info) |
| Anzeige friert ein | Seite im Browser neu laden – die zuletzt gewählte Runde wird automatisch wieder geöffnet |
