# Changelog

Newest first. Each dated entry references its commit hash — run
`git show <hash>` for the exact diff. Rationale for *why* a change was made
lives in [ARCHITECTURE.md](ARCHITECTURE.md) (cross-referenced below by
section number); this file is the *what happened, when* log.

## Unreleased

### Added
- `ARCHITECTURE.md` — full technical documentation: results.info API
  reference, the "who's at the wall" algorithm, and rationale for every
  design decision.
- `AGENTS.md` — working rules for future AI coding sessions on this repo.
- `CHANGELOG.md` — this file.
- `HOSTING.md` rewritten with the correct deploy pipeline (see below) and a
  "where do I find X" reference table.

### Fixed
- `HOSTING.md` documented Render as auto-deploying on push. In practice,
  Auto-Deploy was not reliably active for this service, so a push alone did
  not make new code visible — a symptom first noticed when the
  `ifsc.results.info` option didn't appear on the live site after a push.
  Docs now describe the actual required workflow: push, then manually
  trigger **Manual Deploy → Deploy latest commit** in the Render dashboard.

---

## 2026-08-13 — `05f255a` Nicht gestartete Runden korrekt anzeigen, Warteliste ab 2 nummerieren

### Fixed
- A round with a published start list but `round.status === "pending"`
  (not yet started) showed athlete #1 as "an der Wand" — wrong, since
  nobody had climbed yet. Ascent status alone can't distinguish "not
  started" from "first athlete mid-climb" (both look like `pending`).
  `computeLane()` now checks `round.status` first; see
  [ARCHITECTURE.md §5.3](ARCHITECTURE.md#53-why-roundstatus-is-checked-before-the-ascent-status-walk).

### Changed
- The "upcoming" queue `<ol>` now starts numbering at **2** instead of 1,
  in all cases — "Nächste·r" is implicitly position 1. See
  [ARCHITECTURE.md §5.4](ARCHITECTURE.md#54-queue-numbering-starts-at-2).

---

## 2026-08-13 — `7e42f2d` Boulder-Startgruppen (Group A/B) unterstuetzen, Rundentitel fixen

### Fixed
- Boulder qualification rounds split into starting groups ("Group A" /
  "Group B", each climbing a separate set of boulders in parallel) briefly
  flashed the previous round's board, then showed "Keine Routen-Daten für
  diese Runde." Root cause: those rounds have no top-level `routes` field at
  all — routes are nested under `starting_groups[].routes` instead. See
  [ARCHITECTURE.md §4.4 Quirk A](ARCHITECTURE.md#44-response-shape--the-parts-that-matter-and-their-quirks).
  `collectRouteGroups()` added to normalize both shapes; each group now
  renders as its own labeled section of lanes.
- The board title showed only the discipline (e.g. "— Lead") because
  `round.category_round_name` was read, but that field doesn't exist — the
  correct fields are `round.category` and `round.round`. Fixed alongside the
  above while re-reading the real API response.

### Changed
- `.lanes` CSS grid renamed to `.lanes-grid` (one per group); new
  `.group-heading` style for the "Group A" / "Group B" section labels.

---

## 2026-08-13 — `b2c1d28` Route statt Wand benennen, ifsc.results.info hinzufuegen

### Changed
- Per-lane label changed from "Wand 1"/"Wand 2" to "Route 1"/"Route 2" (Speed
  keeps "Bahn"). See
  [ARCHITECTURE.md §6.5](ARCHITECTURE.md#65-naming-route-or-bahn-for-speed-not-wand).

### Added
- `ifsc.results.info` (IFSC/World Cup competitions) as a third selectable
  server, alongside `dav.results.info` and the staging host. Verified to run
  the identical API and Referer-gate mechanism before wiring it in.

---

## 2026-08-13 — `3c679da` Initial commit: Callzone Management

Everything up to and including the first hosted deploy, bundled into one
commit (the repo was initialized after this work was already done locally):

- Core app: Node/Express server proxying results.info (see
  [ARCHITECTURE.md §6.1](ARCHITECTURE.md#61-local-node-server-instead-of-a-static-frontend)
  for why a proxy is required at all), vanilla-JS frontend polling every 3s,
  the at-the-wall/next/queue inference algorithm
  ([ARCHITECTURE.md §5](ARCHITECTURE.md#5-core-algorithm-whos-at-the-wall)).
- Server-side response caching (20s events / 3s rounds), capped at 200
  entries.
- Bugfix: round-status label `"finished"` was unmapped in the UI (fell back
  to the raw API value instead of "beendet").
- Bugfix: rounds with zero routes rendered a blank board instead of an
  explanatory message.
- Bugfix: a `[hidden] { display: none }` CSS rule was being overridden by a
  more specific `.setup-row { display: flex }` rule, so error states didn't
  actually hide the stale form below them. Fixed with an explicit
  `[hidden] { display: none !important; }`.
- Multi-tablet support: URL query params (`?host=&event=&round=`) let a
  tablet be bookmarked straight to one fixed category, with a "Link für
  dieses Tablet" copy button on the board. See
  [ARCHITECTURE.md §6.4](ARCHITECTURE.md#64-url-query-params--localstorage-in-that-precedence-order).
- Hosting: `git init`, `.gitignore`, `render.yaml`, GitHub repo created,
  deployed to Render (free tier). See [HOSTING.md](HOSTING.md).
