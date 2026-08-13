# Callzone Management im Internet hosten (GitHub + Render)

Damit die App über eine feste `https://...`-URL erreichbar ist – ohne dass
Laptop und Tablet im selben WLAN sein müssen. Kostenlos, dauert ca. 10
Minuten, einmalig.

Der Code ist bereits vorbereitet: `git init` wurde ausgeführt, `.gitignore`
und `render.yaml` (Render-Konfiguration) liegen im Ordner. Du musst nur noch
ein GitHub-Repo anlegen, den Code hochladen und Render damit verbinden.

## 1. Ersten Commit erstellen

Terminal im Projektordner öffnen:

```bash
cd ~/Desktop/CallZonemanagement
```

Falls du noch nie mit Git gearbeitet hast, einmalig deinen Namen/E-Mail
setzen (nur für Commit-Historie, kann irgendwas sein):

```bash
git config user.name "Jannik Weiser"
git config user.email "weiser.jannik@gmail.com"
```

Dann alles committen:

```bash
git add .
git commit -m "Callzone Management"
```

## 2. GitHub-Repo anlegen

1. Auf [github.com/new](https://github.com/new) einloggen (Account nötig,
   falls noch keiner existiert – kostenlos).
2. Repository-Name z. B. `callzone-management`.
3. **Private** wählen, falls der Code nicht öffentlich sichtbar sein soll
   (Render funktioniert mit beidem).
4. **Nichts** ankreuzen (kein README, keine .gitignore – haben wir schon).
5. „Create repository" klicken.

GitHub zeigt danach Befehle unter „…or push an existing repository from the
command line" – die im Terminal ausführen, z. B.:

```bash
git remote add origin https://github.com/<dein-username>/callzone-management.git
git branch -M main
git push -u origin main
```

Beim ersten Push fragt Git nach GitHub-Login (Browser-Fenster öffnet sich
automatisch zur Bestätigung).

## 3. Bei Render deployen

1. Auf [render.com](https://render.com) mit GitHub-Account einloggen
   (kostenlos, keine Kreditkarte nötig für den Free-Tier).
2. „New +" → „Blueprint".
3. Das gerade erstellte GitHub-Repo auswählen. Render erkennt automatisch
   die `render.yaml` und schlägt den Service `callzone-management` vor.
4. „Apply" klicken. Render baut und startet die App (dauert 1–2 Minuten).
5. Danach zeigt Render eine URL, z. B.
   `https://callzone-management.onrender.com` – das ist deine feste Adresse,
   von Laptop, iPad, überall mit Internet erreichbar.

## Wichtig: Free-Tier-Verhalten

Der kostenlose Render-Tarif „schläft" nach ca. 15 Minuten ohne Aufrufe ein.
Der nächste Aufruf danach dauert dann bis zu ~30–60 Sekunden, bis die Seite
lädt (die App wird neu gestartet). Für einen Wettkampftag heißt das: die
Seite kurz vor dem Start einmal öffnen, damit sie „aufgewacht" ist, bevor es
losgeht. Falls das stört, gibt es bei Render einen bezahlten „Starter"-Tarif
(aktuell ca. 7 $/Monat), der die App dauerhaft wach hält – für den
gelegentlichen Einsatz an Wettkampftagen ist der kostenlose Tarif aber völlig
ausreichend.

## Danach

- Die Event-ID-/Runden-Auswahl und die Multi-Tablet-Links (siehe
  [ANLEITUNG.md](ANLEITUNG.md), Abschnitt 5) funktionieren identisch – nur
  dass die URL jetzt `https://callzone-management.onrender.com/...` statt
  `http://<laptop-ip>:4173/...` lautet.
- Der Laptop muss nicht mehr laufen, während die Anzeige benutzt wird.
- Für spätere Änderungen am Code: `git add . && git commit -m "..." && git push`
  – Render deployt automatisch neu.
