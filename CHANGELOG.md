# Changelog

Newest first. Each dated entry references its commit hash — run
`git show <hash>` for the exact diff. Rationale for *why* a change was made
lives in [ARCHITECTURE.md](ARCHITECTURE.md) (cross-referenced below by
section number); this file is the *what happened, when* log.

## Unreleased

### Fixed
- **"At the wall" could get permanently stuck on an athlete/heat that never
  gets a result** (no-show, withdrawal, an unresolved review/appeal),
  showing them forever even after everyone later in start order already
  had confirmed results. Reported with reproduction data: a Lead route
  where positions 4-7 and 9 were confirmed but 1-3 and 8 stayed pending —
  the board was stuck on position 1 instead of showing the real next
  climber (position 10). Root cause: `computeLane()` searched for the
  *first* still-pending athlete instead of the position right after the
  *last confirmed* one. Same class of bug existed in
  `computeSpeedElimination()` for heats (reproduced with a real
  `under_appeal` round: stage "1/8" fully confirmed, stage "1/4" heat 9
  already confirmed, heats 10-12 pending — was at risk of never advancing
  past heat 9). Both now use a "last confirmed + 1" frontier instead of
  "first pending"; identical result in the normal no-gaps case, correct in
  the gap case. See
  [ARCHITECTURE.md §5.2](ARCHITECTURE.md#52-the-inference-computelane-in-publicappjs)
  and [§5.5](ARCHITECTURE.md#55-speed-elimination-heat-based-inference-computespeedelimination).
- Speed elimination now shows a distinct "Waiting for the next stage…"
  message during the brief window after a stage finishes but before
  results.info has populated the next stage's heats, instead of
  prematurely showing "Round finished".
- Documented two previously-unseen API values encountered while
  reproducing the above: ascent status `"active"` (a third non-pending
  value alongside `"confirmed"`/`"locked"`) and round status
  `"under_appeal"`. See
  [ARCHITECTURE.md §4.4 Quirks C/C.1/D](ARCHITECTURE.md#44-response-shape--the-parts-that-matter-and-their-quirks).

---

## 2026-08-14 — `f9d7809` Speed-Finale Lane-Ansicht, Kiosk-Modus Link ausblenden, Cleanup

### Changed
- **Speed elimination now renders per-lane columns (Lane A / Lane B),
  matching qualification rounds**, instead of the one-card-per-heat
  "matchup" layout shipped in `480f5e3`. Same underlying heat-based
  inference (5.5), different presentation — user feedback after the
  matchup-card version was live: it didn't match the rest of the app and
  was harder to scan.
  `heatMatchupLine()`/`makeHeatCard()`/`sortedHeatAthletes()` removed
  (dead after the switch to `athleteForLane()`/`buildSpeedLane()`), along
  with the now-unused `.card-athlete--heat` CSS.
- **Kiosk mode now also hides the "Link for this tablet" row** while in
  fullscreen (was left visible, which is clutter/an exposed copyable URL
  on an otherwise clean wall display). Tied to the `fullscreenchange`
  event so it also un-hides correctly on Esc-key/swipe exits, not only the
  kiosk button. See
  [ARCHITECTURE.md §6.7](ARCHITECTURE.md#67-kiosk-mode-fullscreen--wake-lock-behind-one-button).

### Fixed
- `server.js`'s "unknown host" error message still listed only `"prod"`
  and `"stage"`, left stale since `ifsc` was added in `b2c1d28`. Now built
  from `Object.keys(HOSTS)` so it can't drift out of sync again.

### Internal
- `renderBoard()`: removed two redundant `groupTabs.hidden = true`
  assignments (one per early-return branch) in favor of a single one at
  the top of the function, since every branch except the multi-group case
  wants tabs hidden.

---

## 2026-08-14 — `480f5e3` Speed-Finale, Boulder-Gruppen-Tabs, Englisch, Kiosk-Modus

### Added
- **Speed elimination (K.O. bracket) support.** Finals rounds
  (`speed_elimination_stages` present) now render instead of showing "No
  route data for this round." Shipped as one card per heat showing both
  lanes' athletes ("lane-vs-lane matchup"); replaced by a per-lane column
  layout in the entry above after user feedback. See
  [§4.4 Quirk F](ARCHITECTURE.md#44-response-shape--the-parts-that-matter-and-their-quirks).
- **Boulder starting-group tabs.** Rounds with ≥2 groups (e.g. "Group A" /
  "Group B") now show one group at a time via tab buttons instead of all
  groups' lanes stacked at once (up to 10 tiles), fixing a reported
  usability problem on tablet screens. The selected group is part of the
  per-tablet share link (`&group=`) and saved selection, consistent with
  the existing round-level deep-linking. See
  [ARCHITECTURE.md §6.6](ARCHITECTURE.md#66-boulder-starting-group-tabs-default-to-one-group-at-a-time).
- **Kiosk mode.** New "Fullscreen + Always On" button combines the
  Fullscreen API and the Screen Wake Lock API behind one action, for
  tablets mounted at the venue. See
  [ARCHITECTURE.md §6.7](ARCHITECTURE.md#67-kiosk-mode-fullscreen--wake-lock-behind-one-button).
  Requires iPadOS/Safari 16.4+ for the always-on part; verify on the actual
  hardware before relying on it.

### Changed
- **UI is now English-only**, replacing the previous German UI text
  (buttons, labels, error messages). Deliberate choice for international
  (IFSC) events, not a toggle — see
  [ARCHITECTURE.md §6.8](ARCHITECTURE.md#68-english-only-ui-no-language-switcher).
  Maintenance docs (this file's prose aside, `README.md`, `ANLEITUNG.md`,
  `HOSTING.md`) stay German. `ANLEITUNG.md` updated to reference the new
  English button labels and to document the two features above.

### Considered, not built
- **Speed training fallback (manual/offline queue mode).** Training
  sessions have no results.info round behind them at all, so there's no
  live data to poll — would need a standalone manually-advanced queue (type
  in a list, "Next"/"Back" buttons) rather than an API integration fix.
  Explicitly deferred to a later update per user decision; not started.

---

## 2026-08-14 — `d0301c8` Technische Dokumentation ergaenzen (Architecture, Hosting, Changelog, Agents)

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
  [ARCHITECTURE.md §6.5](ARCHITECTURE.md#65-naming-route-or-lane-for-speed-not-wandbahn).

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
