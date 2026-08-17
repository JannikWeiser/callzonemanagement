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
4. Im Dropdown die passende **Altersklasse und Runde** auswählen
   (z. B. „LEAD U13 m — Qualifikation").
5. Auf **„Show"** klicken.

Die Anzeige aktualisiert sich danach von selbst alle paar Sekunden – ihr
müsst nichts mehr tun.

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

1. Wie in Schritt 3 eine Runde im Dropdown auswählen, aber statt „Show"
   auf **„+ Add to sequence"** klicken. Die Runde erscheint in einer Liste
   darunter.
2. Nächste Runde im Dropdown wählen, wieder „+ Add to sequence" – so lange
   wiederholen, bis alle gewünschten Runden in der Liste stehen.
3. Reihenfolge per **Drag & Drop** anpassen (Eintrag anfassen und
   verschieben). Mit dem „×" lässt sich ein Eintrag wieder entfernen.
4. Auf **„Show sequence"** klicken.

Die Anzeige startet dann automatisch bei der ersten noch nicht
abgeschlossenen Runde der Liste (bereits fertige Runden werden beim Start
übersprungen) und schaltet danach von selbst weiter, sobald jeweils die
aktuelle Runde fertig ist. Der Tablet-Link merkt sich die ganze Sequenz,
lässt sich also genauso als Lesezeichen speichern wie bei einer einzelnen
Runde (Schritt 8).

## 6. Speed-Finale verschränkt laufen lassen (zwischen Startklassen abwechseln)

Bei Speed-Finalrunden läuft der Ablauf oft nicht "eine Startklasse komplett
zu Ende, dann die nächste", sondern verschränkt: erst das Achtelfinale von
Startklasse 1 und 2, dann das Viertelfinale von beiden, dann Halbfinale
usw. – erst wenn beide K.-o.-Bäume fertig sind, geht's mit der nächsten
Startklassen-Kombination weiter.

**Der einfache Weg – "Match finals (Speed)":**

1. Wie in Schritt 5 eine Speed-Finalrunde im Dropdown auswählen. Sobald es
   noch eine zweite Speed-Finalrunde im Event gibt, erscheint darunter ein
   neuer Haken **„Match finals (Speed) — alternate stage-by-stage with"**
   mit einem Dropdown daneben.
2. Haken setzen und im Dropdown die zweite Startklasse auswählen (z. B.
   „SPEED U15+ Männlich — Finale").
3. Auf **„+ Add to sequence"** klicken. Statt eines einzelnen Eintrags
   erscheint automatisch das abwechselnde Muster (5× pro Startklasse) in
   der Sequenz-Liste darunter.
4. Wie gewohnt auf **„Show sequence"** klicken.

Die Anzeige zeigt dann automatisch immer nur die aktuell offene Stufe der
gerade dran befindlichen Startklasse und springt selbstständig zur anderen
Startklasse, sobald deren Stufe (z. B. das Achtelfinale) fertig gewertet
ist – bis beide K.-o.-Bäume komplett durchgelaufen sind.

**Der manuelle Weg (mehr Kontrolle, z. B. für mehr als zwei Startklassen
oder unregelmäßige Muster):** wie in Schritt 5 jede Runde einzeln per
„+ Add to sequence" hinzufügen (Haken bei „Match finals" dabei **nicht**
setzen), dabei aber bei jedem Speed-Finale-Eintrag in der Liste per
Dropdown **„next stage only"** statt „whole round" wählen. Dieselbe Runde
lässt sich beliebig oft in die Liste einfügen – so entsteht z. B.
„Achtelfinale Klasse 1 (next stage only), Achtelfinale Klasse 2 (next stage
only), Viertelfinale Klasse 1, ...", ganz nach Bedarf per Drag & Drop
sortiert.

## 7. Speed-Training (ohne Live-Ergebnisse)

Trainingseinheiten laufen nicht über results.info und liefern deshalb keine
Live-Ergebnisse, aus denen die App "wer klettert gerade" ableiten könnte.
Die Startreihenfolge im Training entspricht aber meist der Reihenfolge aus
der echten Qualifikationsrunde – deshalb lässt sich diese Reihenfolge
wiederverwenden, das Weiterschalten erfolgt dann von Hand:

1. Wie in Schritt 3 die passende Runde auswählen (üblicherweise die
   **Qualifikationsrunde**, deren Startreihenfolge dem Training entspricht).
2. Häkchen bei **„Training mode (manual advance)"** setzen.
3. Auf **„Show"** klicken.

Statt der automatischen Live-Anzeige erscheint oben ein Bedienfeld mit
**„← Back"** und **„Next →"**. Jeder Klick auf „Next" schaltet **alle**
Bahnen/Routen gemeinsam einen Platz weiter (ein Klick reicht für alle
Spalten gleichzeitig) – gedacht für den Fall, dass alle Athlet·innen im
Training synchron nacheinander klettern. Die Position wird nicht
gespeichert: nach einem Neuladen der Seite startet die Anzeige wieder von
vorne.

## 8. Mehrere Tablets gleichzeitig (je eigene Startklasse)

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

## 9. Vollbild & Bildschirm wach halten

Oben auf dem Board gibt es den Button **„Fullscreen + Always On"**. Ein
Klick macht die Seite gleichzeitig vollbildig (keine Safari-Leiste mehr)
und verhindert, dass sich das Tablet-Display automatisch abschaltet oder
sperrt – gedacht für Tablets, die fest an der Wand hängen. Erneut klicken
("Exit fullscreen") beendet beides wieder.

Falls das auf einem älteren iPad nicht funktioniert: das "Wach halten"
braucht iPadOS 16.4 oder neuer. Vollbild funktioniert unabhängig davon,
sollte aber vor dem Wettkampf einmal kurz getestet werden.

## 10. Programm beenden

Im Terminal-Fenster `Strg + C` drücken (oder das Fenster schließen).

## Fehlermeldungen

| Meldung | Bedeutung |
|---|---|
| „Couldn't load event" | Event ID oder Server falsch – beides prüfen |
| „Connection lost" | Internetverbindung des Laptops prüfen (die Daten kommen live von results.info) |
| Anzeige friert ein | Seite im Browser neu laden – die zuletzt gewählte Runde wird automatisch wieder geöffnet |
