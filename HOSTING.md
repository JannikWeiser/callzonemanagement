# Deployment-Pipeline: Laptop → GitHub → Render

Diese Seite beschreibt den kompletten Weg vom Code-Editor auf dem Laptop bis
zur live erreichbaren Seite unter `https://callzone-management.onrender.com`,
und wo man unterwegs was findet.

## Überblick

```
┌──────────────┐   git push    ┌────────────────┐   Manual Deploy   ┌───────────────────────────────┐
│   Laptop     │ ─────────────►│   GitHub-Repo   │ ─────────────────►│   Render (laeuft, hat URL)     │
│ (lokaler Code)│               │ (Code-Backup)   │  (im Dashboard    │ callzone-management.onrender.com│
└──────────────┘                └────────────────┘   manuell klicken)└───────────────────────────────┘
```

Zwei getrennte Schritte, die **beide** nötig sind, damit eine Code-Änderung
live sichtbar wird:

1. **Push zu GitHub** – lädt den Code hoch, ändert aber noch nichts an der
   laufenden Seite.
2. **Manual Deploy in Render** – erst das baut den neuen Code und ersetzt
   die laufende Version. **Ohne diesen Schritt bleibt die alte Version
   live, auch wenn GitHub schon den neuen Code hat.**

Das ist der Punkt, an dem es zuletzt gehakt hat (die `ifsc.results.info`-
Option war auf GitHub, aber nicht auf der Live-Seite, weil Schritt 2
gefehlt hat).

---

## A. Jede künftige Änderung live bringen (der Ablauf, den du am häufigsten brauchst)

### Schritt 1 – Code zu GitHub pushen

Im Terminal:

```bash
cd ~/Desktop/CallZonemanagement
git add .
git commit -m "Kurze Beschreibung der Änderung"
git push
```

Nach dem Push ist der neue Code auf GitHub sichtbar unter
**[github.com/JannikWeiser/callzonemanagement](https://github.com/JannikWeiser/callzonemanagement)**
– die Live-Seite zeigt an diesem Punkt **noch die alte Version**.

### Schritt 2 – Manual Deploy in Render auslösen

1. [dashboard.render.com](https://dashboard.render.com) öffnen, einloggen.
2. Den Service **callzone-management** anklicken.
3. Oben rechts auf **„Manual Deploy"** klicken.
4. Im Dropdown **„Deploy latest commit"** auswählen.
5. Render baut den neuen Code (Tab **„Logs"** zeigt den Fortschritt live,
   dauert meist 1–2 Minuten). Am Ende steht dort **„Your service is live"**.
6. Danach die Live-URL neu laden (bei iPad/Safari ggf. lange auf den
   Reload-Button drücken → „Ohne Inhaltsblocker neu laden" bzw. Cache
   umgehen), um sicherzugehen, dass keine alte Version aus dem
   Browser-Cache angezeigt wird.

**Warum manuell und nicht automatisch?** Render kann Deploys automatisch bei
jedem Push auslösen ("Auto-Deploy"), aber das ist bei diesem Service aktuell
nicht zuverlässig aktiv. Wer das ändern möchte: **Service → „Settings" →
„Build & Deploy" → „Auto-Deploy"** auf „Yes" stellen. Danach entfiele
Schritt 2 künftig automatisch. Bis das geprüft/aktiviert ist, gilt: **nach
jedem Push immer manuell deployen.**

---

## B. Wo finde ich …

| Was | Wo |
|---|---|
| **Die Live-Seite** (für Laptop/iPad im Wettkampf) | `https://callzone-management.onrender.com` – direkt als Lesezeichen speicherbar, siehe auch [ANLEITUNG.md](ANLEITUNG.md) Abschnitt 5 für Multi-Tablet-Links |
| **Der Code** | [github.com/JannikWeiser/callzonemanagement](https://github.com/JannikWeiser/callzonemanagement) |
| **Render-Dashboard** (Deploys, Logs, Einstellungen) | [dashboard.render.com](https://dashboard.render.com) → Service „callzone-management" |
| **Deploy-/Build-Logs** (bei Fehlern zuerst hier schauen) | Render-Dashboard → Service → Tab „Logs" |
| **Liste aller bisherigen Deploys** | Render-Dashboard → Service → Tab „Events" |
| **Auto-Deploy an/aus, Node-Version, Build-/Start-Befehl** | Render-Dashboard → Service → „Settings" → „Build & Deploy" |
| **Lokale Deploy-Konfiguration** (was Render beim Blueprint-Import liest) | [render.yaml](render.yaml) im Projektordner |
| **GitHub Personal Access Token verwalten/erneuern** | [github.com/settings/tokens](https://github.com/settings/tokens) |

---

## C. Einmalige Einrichtung (Referenz – schon erledigt, nur falls nochmal nötig, z. B. neues Projekt)

Der Code ist bereits vorbereitet: `git init` wurde ausgeführt, `.gitignore`
und `render.yaml` liegen im Ordner.

### 1. Ersten Commit erstellen

```bash
cd ~/Desktop/CallZonemanagement
git config user.name "Jannik Weiser"
git config user.email "weiser.jannik@gmail.com"
git add .
git commit -m "Callzone Management"
```

### 2. GitHub-Repo anlegen

1. Auf [github.com/new](https://github.com/new) einloggen.
2. Repository-Name z. B. `callzone-management`, **Private** oder öffentlich
   (beides funktioniert mit Render), nichts weiter ankreuzen.
3. „Create repository" klicken, dann die dort angezeigten Befehle ausführen:
   ```bash
   git remote add origin https://github.com/<username>/callzone-management.git
   git branch -M main
   git push -u origin main
   ```

### 3. Bei Render deployen

1. Auf [render.com](https://render.com) mit GitHub-Account einloggen
   (kostenlos, keine Kreditkarte nötig).
2. „New +" → „Blueprint" → das GitHub-Repo auswählen.
3. Render erkennt automatisch `render.yaml` und schlägt den Service
   `callzone-management` vor. „Apply" klicken.
4. Nach dem ersten Build (1–2 Min.) zeigt Render die feste URL an.

---

## D. Free-Tier-Verhalten

Der kostenlose Render-Tarif „schläft" nach ca. 15 Minuten ohne Aufrufe ein.
Der nächste Aufruf danach dauert dann bis zu ~30–60 Sekunden, bis die Seite
lädt (die App wird neu gestartet). Für einen Wettkampftag heißt das: die
Seite kurz vor dem Start einmal öffnen, damit sie „aufgewacht" ist, bevor es
losgeht. Ein bezahlter „Starter"-Tarif (aktuell ca. 7 $/Monat) hält die App
dauerhaft wach – für den gelegentlichen Einsatz an Wettkampftagen ist der
kostenlose Tarif aber völlig ausreichend.

---

## E. Troubleshooting

| Symptom | Ursache | Lösung |
|---|---|---|
| Neue Änderung auf GitHub sichtbar, aber nicht auf der Live-Seite | Schritt A.2 (Manual Deploy) vergessen | Render-Dashboard → Manual Deploy → Deploy latest commit |
| Deploy schlägt fehl (rot in „Events") | Meist ein Fehler im Code oder in `package.json` | Tab „Logs" öffnen, Fehlermeldung lesen (oder mir schicken) |
| Erster Aufruf nach Pause dauert ~1 Minute | Free-Tier-Sleep (siehe D.) | Normal, kurz warten |
| `git push` fragt nach Passwort und schlägt fehl | GitHub verlangt ein Personal Access Token statt Passwort | Siehe [github.com/settings/tokens](https://github.com/settings/tokens), Scope `repo` |
