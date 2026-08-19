# Changelog

Newest first. Each dated entry references its commit hash — run
`git show <hash>` for the exact diff. Rationale for *why* a change was made
lives in [ARCHITECTURE.md](ARCHITECTURE.md) (cross-referenced below by
section number); this file is the *what happened, when* log.

## Unreleased

### Added
- **Setup-screen modes (Single round / Sequence / Training)** replace an
  earlier scatter of independent checkboxes ("Match finals", "Training
  mode") that live-tested as confusing — unclear which checkbox belonged
  with which dropdown. Each mode now shows only its own controls. See
  [ARCHITECTURE.md §6.11](ARCHITECTURE.md#611-setup-screen-modes-instead-of-independent-checkboxes).
- **Paired sequence entries, for interleaving Speed finals between
  categories.** In Sequence mode, "Interleave two Speed finals" adds a
  single "A ↔ B" entry to the sequence list (not a bare round entry, and
  not one row per stage) that alternates between the two categories' stages
  in lockstep (1/8 A, 1/8 B, 1/4 A, 1/4 B, ...), advancing the outer
  sequence once both brackets are fully finished. A "⇄ Switch category now"
  button is always available on the board while such an entry is active, as
  a manual fallback. Share link's `&rounds=` param gains an `idA+idB` token
  form for a paired entry. See
  [ARCHITECTURE.md §6.12](ARCHITECTURE.md#612-paired-sequence-entries-interleaving-speed-finals-between-categories).
- **Fixed: paired sequence entries could skip ahead instead of alternating
  in lockstep.** The first version let each side report its own "current
  stage" independently and switched whenever one ran dry; live-tested
  against two categories entered at different paces and found broken — the
  faster category raced ahead onto a later stage instead of waiting for the
  slower one's turn. Replaced with a shared stage cursor
  (`pairedState.stageIndex`) that only advances once **both** sides
  genuinely have nothing left at the current named stage, keeping the
  requested alternating order intact regardless of how unevenly the two
  brackets' results are actually being entered. See
  [ARCHITECTURE.md §6.12](ARCHITECTURE.md#612-paired-sequence-entries-interleaving-speed-finals-between-categories).
- **Stuck-heat watchdog for paired sequence entries.** Reported after live
  testing: the automatic category switch didn't trigger when a stage's last
  heat never resolved (one lane's ascent status stayed `"active"` forever,
  suspected upstream live-scoring gap — checked results.info's raw response
  directly, confirmed there's no separate "stage finished" signal to read
  instead). If the current heat hasn't changed in 90 seconds, the app now
  force-switches to the other category anyway; the manual button above
  remains for an immediate override. Scoped to this switch decision only —
  the core "who's at the wall" inference still trusts a live `"active"`
  entry forever, unchanged. See
  [ARCHITECTURE.md §6.12](ARCHITECTURE.md#612-paired-sequence-entries-interleaving-speed-finals-between-categories).
- **Training mode, now controllable from a second device.** Reuses a
  chosen round's roster/order with manual Next/Back advance (no live
  results exist for a training session). The manual position now lives on
  the server (`/api/training/:host/:roundId`, a small in-memory counter)
  instead of only in the wall tablet's local state, so a second device
  (e.g. a phone) can drive it while the wall tablet just displays — the
  board screen offers a distinct "Link to control from another device"
  that opens a deliberately minimal controller view (names + two big
  buttons) instead of the full board. See
  [ARCHITECTURE.md §6.13](ARCHITECTURE.md#613-training-mode-manual-advance-same-rosterorder-as-qualification-controllable-from-a-second-device).
- **Sequence mode: an ordered, auto-advancing playlist of rounds.** Setup
  screen gained "+ Add to sequence" (next to the existing single-round
  dropdown, which is unchanged) and a drag-to-reorder list; "Show sequence"
  watches the whole ordered list, automatically switching to the next round
  as soon as the current one is fully finished (every lane/group/heat, not
  just the visible group tab). A tablet loading a sequence where the first
  few rounds are already done catches up through them immediately rather
  than idling. Share link gains `&rounds=id1,id2,id3` (comma-separated);
  the original single `&round=id` form still works unchanged. Requested
  explicitly for Speed, where Quali Men → Quali Women → Final Men → Final
  Women is a fixed known order. See
  [ARCHITECTURE.md §6.10](ARCHITECTURE.md#610-sequence-mode-an-ordered-playlist-of-rounds-auto-advancing).

### Changed
- **"At the wall" card label renamed to "climbing"** per user preference
  (shorter, reads better). Label text only — internal field/class names
  unchanged. See
  [ARCHITECTURE.md §6.9](ARCHITECTURE.md#69-climbing-instead-of-at-the-wall-as-the-card-label).

### Fixed
- **A paired sequence entry could misalign its shared stage cursor when the
  two brackets have different sizes.** Raised proactively by the user during
  a full code review, not a live bug report. The stage cursor compared each
  side's stage by raw array *index* into `speed_elimination_stages` — only
  safe if both sides' arrays have the same stages at the same offsets, which
  isn't guaranteed (a smaller bracket can start directly at a later stage,
  e.g. "1/4" with no "1/8" before it). `pollPairedTick()` now matches by
  stage *name* instead (`earlierStageName(currentStageNameFor(dataA),
  currentStageNameFor(dataB))`, using a canonical `SPEED_STAGE_ORDER` list),
  which stays correct regardless of how deep either side's bracket is.
  Verified live with a mocked bracket-size mismatch. See
  [ARCHITECTURE.md §6.12](ARCHITECTURE.md#612-paired-sequence-entries-interleaving-speed-finals-between-categories).
- **Training mode could be started for Boulder/Lead rounds, where its
  manual-roster-advance concept doesn't apply.** Raised proactively by the
  user. The round dropdown now tags each entry as Speed or not; picking a
  non-Speed round while in Training mode disables "Start training" and shows
  an inline explainer instead. See
  [ARCHITECTURE.md §6.13](ARCHITECTURE.md#613-training-mode-manual-advance-same-rosterorder-as-qualification-controllable-from-a-second-device).
- **No protection against overlapping poll calls landing out of order.**
  Raised proactively by the user. A slower "old" poll's response could
  resolve after a faster "new" one and silently overwrite it with stale
  data. Added a per-polling-loop token counter (`pollToken` for the main
  watch chain, `trainingPollToken` for Training mode) that every
  state-mutating step checks before applying its result, discarding it if a
  newer poll has since started. Verified live with a mocked race between a
  delayed "old" response and an instant "new" one. See
  [ARCHITECTURE.md §6.14](ARCHITECTURE.md#614-poll-overlap-protection-polltoken--trainingpolltoken).
- **A "not started" no-show didn't hand the opponent a wildcard, only a
  false start did.** Raised by the user after spotting it in results.info's
  admin tool: an athlete can be marked "Not Started" via a separate control
  from the FALSE START checkbox - a genuine no-show, not a false start.
  Confirmed live: that ascent has `dnf: false, dns: false` (neither flag!),
  distinguishable only via `formatted_ascent_score === "NOT STARTED"`.
  `ascentIsAutoDecided()` now treats this the same as a `dns` false start -
  the opponent gets the wildcard without needing their own result either.
  Deliberately does NOT key off `time_ms === null` as a shortcut - a
  wildcard-*winner*'s own untouched ascent can also be `null`, which would
  have caused false positives. See
  [ARCHITECTURE.md §5.5](ARCHITECTURE.md#55-speed-elimination-heat-based-inference-computespeedelimination).
- **A paired sequence entry's shared stage cursor couldn't recover if a
  judge reopened and corrected an earlier stage** (deleting a result,
  re-entering it - e.g. a false-start ruling overturned on review) while the
  display had already moved ahead to a later stage. Raised proactively by
  the user, not reported as a live bug. `pollPairedTick()`'s stage index is
  now computed fresh every tick (`Math.min()` of both sides' own current
  stage) instead of being persisted and only ever advancing - so a
  correction like that is picked up automatically on the next poll, the
  same "no memory, always re-derive" property the single-round view already
  had. No manual reset control was added - discussed and found unnecessary,
  since the automatic recompute already covers it. See
  [ARCHITECTURE.md §6.12](ARCHITECTURE.md#612-paired-sequence-entries-interleaving-speed-finals-between-categories).
- **A Speed-elimination heat decided by a false start never advanced, even
  with the earlier `heatIsDone()` fix in place.** Reproduced on a full
  simulated competition (both U13 categories, interleaved, run through
  every stage to the Final): when one lane false-starts (`dns`), the other
  lane wins/advances as a "wildcard" under Speed climbing rules without
  ever getting its own ascent recorded at all - confirmed live, that
  lane's ascent stays `time_ms: 0, status: "pending"` forever. `heatIsDone()`
  required *both* lanes to have a result, so a wildcard heat never resolved
  and permanently blocked everything after it. Now a `dns` on either lane
  alone decides the heat, matching how results.info's own official
  standings label the outcome ("WILDCARD"). A `dnf` (fall) is deliberately
  handled differently and does NOT auto-decide the heat - the surviving
  lane still needs their own real time before the heat counts as done
  (an intermediate version of this fix treated `dnf` the same as `dns`,
  which was wrong - corrected before shipping). See
  [ARCHITECTURE.md §5.5](ARCHITECTURE.md#55-speed-elimination-heat-based-inference-computespeedelimination).
- **"Switch category now" appeared to do nothing on a paired sequence
  entry.** Root cause: clicking it set the target category, but the very
  next check ("does this side have anything to show right now?") would
  immediately flip back to the original side if the newly-chosen category
  happened to have nothing at its current stage yet (e.g. hasn't started) -
  silently undoing the click before it was ever visible. A new
  `pairedState.manualPin` flag now protects a manual choice from that
  auto-revert for the one tick right after the click; normal ticks
  afterward still auto-switch away from a genuinely empty side as before.
  See
  [ARCHITECTURE.md §6.12](ARCHITECTURE.md#612-paired-sequence-entries-interleaving-speed-finals-between-categories).
- **Speed-elimination heats could get stuck on an old stage forever, even
  with real complete results recorded past it — reproduced on a plain
  single-round view, no pairing/interleaving needed.** Root cause: unlike
  qualification rounds (where the fix below correctly relies on ascent
  status eventually reaching `"confirmed"`), a Speed-elimination heat's
  ascent status apparently never reaches `"confirmed"` in this codebase's
  results.info environment — even after a real, valid time was entered for
  both lanes and the stage was explicitly closed in results.info's own
  admin tool. `computeSpeedElimination()`/`stageHeatsRemaining()` now judge
  a heat as "done" from the recorded result itself (`time_ms > 0`, or
  `dnf`/`dns`) instead of the `status` field — scoped to Speed elimination
  only; qualification rounds are untouched, since their `"active"` →
  `"confirmed"` transition has held up in practice. This also directly
  fixes "Round finished" detection and sequence-mode advancement for Speed
  finals, which depend on the same heat-done check. See
  [ARCHITECTURE.md §5.5](ARCHITECTURE.md#55-speed-elimination-heat-based-inference-computespeedelimination).
- **Corrected a wrong assumption from the previous fix below: ascent
  status `"active"` does NOT mean "already climbed".** It means a judge is
  live-scoring that attempt right now and hasn't confirmed it yet - during
  Lead/Boulder live judging, an athlete can still be at the wall (or just
  off it) while their result shows `"active"`. Treating `"active"` the same
  as `"confirmed"` (as the previous fix did) meant the board could jump to
  the next athlete before the current one was actually confirmed done.
  Fixed by splitting the inference into two explicit rules instead of one
  "not pending" check: **the latest `"active"` entry wins if one exists,
  otherwise fall back to the position after the last `"confirmed"`/`"locked"`
  entry.** This also fixes the equivalent issue in
  `computeSpeedElimination()` for heats. Clarified with the user: no
  fallback/timeout logic if an entry stays `"active"` forever without ever
  being confirmed - always trust the latest `"active"` entry, by design.
  See
  [ARCHITECTURE.md §5.2](ARCHITECTURE.md#52-the-inference-findcurrentindex--computelane-in-publicappjs),
  [§5.5](ARCHITECTURE.md#55-speed-elimination-heat-based-inference-computespeedelimination),
  and the corrected
  [§4.4 Quirk C](ARCHITECTURE.md#44-response-shape--the-parts-that-matter-and-their-quirks).

---

## 2026-08-14 — `de004f5` Fix: 'an der Wand' haengt nicht mehr bei fehlenden Ergebnissen fest

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
  [ARCHITECTURE.md §5.2](ARCHITECTURE.md#52-the-inference-findcurrentindex--computelane-in-publicappjs)
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
