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
4. Oben erscheinen drei Reiter: **„Single round"**, **„Sequence"**,
   **„Training"**. Für eine einzelne Runde bleibt ihr bei „Single round"
   (voreingestellt).
5. Im Dropdown die passende **Altersklasse und Runde** auswählen
   (z. B. „LEAD U13 m — Qualifikation").
6. Auf **„Show"** klicken.

Die Anzeige aktualisiert sich danach von selbst alle paar Sekunden – ihr
müsst nichts mehr tun.

Die beiden anderen Reiter — **„Sequence"** (mehrere Runden nacheinander,
inkl. Speed-Verschränken) und **„Training"** (Speed-Training ohne
Live-Ergebnisse) — sind in den Schritten 5 und 6 unten beschrieben.

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
