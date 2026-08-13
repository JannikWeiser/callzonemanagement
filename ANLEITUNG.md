# Callzone Management – Kurzanleitung

Zeigt an, wer bei einem Kletterwettkampf gerade an der Wand ist, wer als
nächstes dran ist und wer danach kommt.

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
2. **Server:** `dav.results.info` auswählen (die Test-Option braucht ihr
   normalerweise nicht).
3. Auf **„Event laden"** klicken.
4. Im Dropdown die passende **Altersklasse und Runde** auswählen
   (z. B. „LEAD U13 m — Qualifikation").
5. Auf **„Anzeigen"** klicken.

Die Anzeige aktualisiert sich danach von selbst alle paar Sekunden – ihr
müsst nichts mehr tun.

## 4. Anzeige lesen

- **Oben, groß, orange:** Athlet·in, die/der gerade an der Wand ist
- **Darunter:** Athlet·in, die/der als Nächstes dran ist
- **Liste darunter:** die Athlet·innen, die danach folgen
- Bei Disziplinen mit mehreren Wänden gleichzeitig (z. B. Boulder mit 4
  Wänden) wird für jede Wand eine eigene Spalte angezeigt.

Über **„← andere Runde"** oben links könnt ihr jederzeit zu einer anderen
Altersklasse/Runde wechseln.

## 5. Mehrere Tablets gleichzeitig (je eigene Startklasse)

Jedes Gerät kann unabhängig eine eigene Altersklasse/Runde anzeigen – z. B.
Tablet 1 zeigt Boulder U11, Tablet 2 zeigt Lead U15, gleichzeitig, ohne dass
sie sich gegenseitig stören.

Damit ein Tablet nach dem Ausschalten/Neuladen sofort wieder **seine**
Startklasse zeigt (statt der Auswahl-Maske):

1. Auf dem Tablet einmal wie in Schritt 3 die gewünschte Runde auswählen.
2. Oben auf dem Board erscheint ein Feld **„Link für dieses Tablet"** mit
   einem Kopieren-Button.
3. Diesen Link als Lesezeichen speichern (oder als Icon auf den Homescreen
   legen: Teilen-Symbol → „Zum Home-Bildschirm").
4. Ab jetzt öffnet dieser Link auf diesem Tablet immer direkt die richtige
   Startklasse – auch nach einem Neustart.

Jedes Tablet bekommt so seinen eigenen Link mit seiner eigenen Runde.

## 6. Programm beenden

Im Terminal-Fenster `Strg + C` drücken (oder das Fenster schließen).

## Fehlermeldungen

| Meldung | Bedeutung |
|---|---|
| „Event konnte nicht geladen werden" | Event ID oder Server falsch – beides prüfen |
| „Verbindung verloren" | Internetverbindung des Laptops prüfen (die Daten kommen live von results.info) |
| Anzeige friert ein | Seite im Browser neu laden – die zuletzt gewählte Runde wird automatisch wieder geöffnet |
