# Changelog

Newest first. Each dated entry references its commit hash — run
`git show <hash>` for the exact diff. Rationale for *why* a change was made
lives in [ARCHITECTURE.md](ARCHITECTURE.md) (cross-referenced below by
section number); this file is the *what happened, when* log.

## Unreleased

### Fixed
- **Boulder/route cards could visibly overflow past a Multimode column's own
  border** — `.lanes-grid`'s shared `minmax(320px, 1fr)` grid-column floor
  (used everywhere in the app) doesn't account for `.multi-block`'s own
  padding/border, so a Multimode column at or near its own 320px minimum
  had less than 320px of content width left, but its inner boulder/route
  grid still demanded 320px per track — visibly poking out past the
  column's border instead of wrapping. Reported live with a screenshot.
  Fixed with a Multimode-scoped, smaller floor (`minmax(260px, 1fr)`) on
  `.multi-block .lanes-grid`, verified overflow-free at multiple widths
  down to the narrowest column size. See
  [ARCHITECTURE.md §6.23](ARCHITECTURE.md#623-multimode-up-to-5-categories-side-by-side-each-with-its-own-independent-sequence).
- **Multimode's shared status line kept saying "Updated ..." during a real
  results.info outage** — `pollOneMultiColumn()` catches its own fetch
  errors and returns `{ error }` instead of throwing, so `pollMulti()`'s
  only bail-out check (`results.some(r => r === null)`) never caught an
  all-columns failure, unlike every other poll path in the app
  (`pollRound`/`pollCurrent`/the paired poll), which all show "Connection
  lost: ..." on the same kind of failure. `pollMulti()` now checks whether
  every configured column's result carries an error and reports
  "Connection lost" the same way, recovering automatically once any tick
  succeeds again. Found by a structured code review, not a live report.
  See [ARCHITECTURE.md §6.23](ARCHITECTURE.md#623-multimode-up-to-5-categories-side-by-side-each-with-its-own-independent-sequence).
- **A stale setup error banner survived switching setup modes** — e.g.
  clicking "Show sequence" with an empty sequence, then switching to the
  Multimode tab, left the Sequence-mode error message on screen over the
  now-showing Multimode UI. `setMode()` itself still can't clear it
  unconditionally (`populateRounds()` calls it internally right after
  setting its own "no categories/rounds" error), so the mode-tab click
  listener now clears it explicitly before calling `setMode()`. See
  [ARCHITECTURE.md §6.25](ARCHITECTURE.md#625-cleanup-pass-a-stale-setup-error-banner-and-merging-sequencemultimodes-row-builder-duplication).
- **A Multimode column with no route data left a visible empty gap** —
  `renderMultiBoard()`'s `routeTabsEl` had no default `hidden = true`
  (unlike its sibling `groupTabsEl`, which does), so a round with no
  `routes`/`starting_groups` at all showed a blank margin above "No route
  data for this round." Now defaults to hidden like every other
  freshly-created per-column element. See
  [ARCHITECTURE.md §6.23](ARCHITECTURE.md#623-multimode-up-to-5-categories-side-by-side-each-with-its-own-independent-sequence).
- **A stale code comment still described the discipline lock as shared
  across every Multimode column** — left over from before it became
  per-column (§6.24); rewritten to match what `availableFor()` actually
  does.
- **"+ Add paired entry" (interleaved Speed finals) had no explanation left
  in the UI, reported as the feature being missing** — the Sequence-mode
  builder redesign (see "Changed" below) dropped the old `#pairedRow`
  block's inline explanatory sentence along with its static controls,
  leaving a bare button next to "+ Add round" with no hint what it does.
  The underlying paired lockstep/switch-button mechanism was never broken
  (re-verified live end to end). Added `#pairedEntryHint`, a small
  permanent label ("or interleave two Speed finals:") between the two
  buttons, visible under the same condition as the button itself. See
  [ARCHITECTURE.md §6.12](ARCHITECTURE.md#612-paired-sequence-entries-interleaving-speed-finals-between-categories).
- **Uneven, inconsistent-looking borders between Multimode columns** —
  `.multi-columns` set `align-items: start`, so each `.multi-block` was
  only as tall as its own content; columns rarely have identical content
  length (one with a "Next: …" line, one without; different route counts),
  so the bottom borders across one row landed at different heights,
  reported live with a screenshot showing the resulting uneven margins.
  Now left at the grid default (`stretch`), so every card in a row shares
  the tallest one's height and the borders line up cleanly.
- **"+ Add Sequence" could add a duplicate of the round already shown** —
  the button appended whatever the one shared dropdown currently showed,
  which (unless the user had changed it first) was the same round the
  column was already displaying. Redesigned: every step of a column's
  sequence is now its own live dropdown (not just the first), each
  excluding whichever round every other step in that column already uses,
  and "+ Add Sequence" always seeds its new step with an unused round.
  While fixing this, found and fixed a second bug in the discipline-lock
  logic: a column with an already-built 2+-round sequence wasn't
  contributing to the lock in time for its *own* re-render, so its later
  steps briefly listed every discipline again right after being edited.
- **Multimode's Speed rejection never actually fired (type mismatch)** —
  `populateRounds()` stored `roundId` as the raw number
  `round.category_round_id` from the API, but every other roundId in this
  app (URL params, `<select>` values, sequence tokens) is a string. The
  Multimode discipline-lock lookup (`entries.find(e => e.roundId ===
  roundId)`) used strict equality, so it silently never matched - the
  cheap Speed pre-check never ran, and if a Speed round was the *first*
  one added to a Multimode column, it was accepted outright (no
  rejection, `multiDiscipline` locked to "Speed") instead of being turned
  away. Fixed at the source: `entries[].roundId` is now always a string.
  Found and fixed only after re-testing every rejection path with a fresh
  page load rather than trusting the first pass.
- **Stale "Boulder final format" toggle leaking into Training mode and the
  paired Speed sequence view** — `renderTrainingBoard()` and
  `renderPairedBoard()` never reset `#boulderModeRow`, so if a Boulder
  final round had been viewed earlier in the session, its Intervall/World
  Series toggle stayed visible (and clickable) after switching to a Speed
  Training session or a paired Speed sequence, even though neither can
  ever be Boulder. Both now hide it unconditionally at the top of their
  render function, same as `renderBoard()`/`renderMultiBoard()` already
  did.
- **Empty, visible "group tabs" gap in Multimode columns without Boulder
  starting groups** — `renderMultiBoard()`'s per-column `groupTabsEl` was
  created without an explicit default `hidden` state; for a round that
  never gets a group-tabs row (anything but a multi-group Boulder round -
  in particular every Lead round), the empty container was left visible,
  showing as a blank gap between the column heading and its route tabs.
  Now defaults to `hidden` like the singleton `#groupTabs` does in
  `renderBoard()`, only shown once `renderGroupTabs()` actually has
  something to put in it.

### Changed
- **Sequence mode's and Multimode's row builders now share their
  underlying code instead of two near-identical copies** — both were
  explicitly built to match each other's interaction pattern and had
  independently hit the exact same "+ Add duplicates what's already
  showing" bug before being fixed separately. Extracted three shared
  primitives: `usedIdsExcluding()` (what round ids are already claimed
  elsewhere in a list), `buildRoundSelect()` (one live, self-filtering
  `<select>` row), and `buildRemoveButton()` (the "×" remove control). No
  behavior change — regression-tested both modes' add/edit/remove/exclude
  flows before and after. Also removed two pieces of dead state found
  during the same pass: `renderMultiColumnsConfig()`'s unused `host`
  parameter, and Multimode draft items' write-only `label` field. See
  [ARCHITECTURE.md §6.25](ARCHITECTURE.md#625-cleanup-pass-a-stale-setup-error-banner-and-merging-sequencemultimodes-row-builder-duplication).
- **`#pairedEntryHint` and `#addPairedToSequence` now derive their visibility
  from one written condition instead of two separately-typed copies of the
  same expression** — purely internal, no observable change; reduces the
  risk of the two silently drifting apart on a future edit to either.
- **A redundant CSS rule removed** (`public/styles.css`) — `.sequence-pair
  select` duplicated `.sequence-item select`'s identical declaration; since
  `.sequence-pair` is always a direct child of a `.sequence-item`, the
  broader selector already covered it.
- **Multimode columns can now mix disciplines — one column can show Boulder
  while another shows Lead** — the discipline lock used to be shared
  across the whole selection, so whichever column picked first (Lead or
  Boulder) silently locked every other column to that same discipline;
  reported live as "I only ever see Boulder, I want to see both
  disciplines." The lock is now computed per column instead: a column's
  own sequence still has to stay one discipline throughout ("Quali →
  Finale" for one category), but different columns are fully independent
  of each other. This also simplified `renderMultiColumnsConfig()` —
  the old shared lock needed a two-pass, checked-twice-per-column
  computation purely to handle cross-column accumulation order, which no
  longer exists now that a column's lock only ever depends on itself. See
  [ARCHITECTURE.md §6.24](ARCHITECTURE.md#624-multimode-discipline-lock-is-per-column-not-shared-across-the-whole-selection).
- **Multimode columns no longer auto-pick a first round — "+ Add Sequence"
  is now required for every entry, including the first** — a fresh column
  used to silently pre-fill itself with the first available round with no
  click at all; reported live (screenshot of a fresh setup screen) that
  every column should start truly empty instead, requiring the same
  deliberate "+ Add Sequence" click the second and later entries already
  needed. Removed the auto-seed-from-nothing branch entirely. The
  now-unused `cleared` flag (it only ever existed to stop that auto-seed
  from undoing a deliberately emptied column) was removed along with it.
  See
  [ARCHITECTURE.md §6.23](ARCHITECTURE.md#623-multimode-up-to-5-categories-side-by-side-each-with-its-own-independent-sequence).
- **Sequence mode's builder redesigned to match Multimode's** — every
  entry in the list (a plain round, or one side of a paired Speed entry,
  6.12) is now its own live `<select>`, not a static label added via a
  separate shared dropdown+button. "+ Add round"/"+ Add paired entry"
  always seed a new entry with round(s) not already used elsewhere in the
  sequence, so nothing is ever added as a duplicate by default — the same
  bug class just fixed in Multimode's own builder. Drag-reorder is kept.
  The shared "Category / round" picker is no longer used by Sequence mode
  at all (it now picks entirely within its own section, like Multimode
  does). See
  [ARCHITECTURE.md §6.10](ARCHITECTURE.md#610-sequence-mode-an-ordered-playlist-of-rounds-auto-advancing).
- **Training mode's round picker only lists Speed rounds** — previously
  showed every round in the event and only turned away a Lead/Boulder
  pick after the fact (a disabled "Start training" button plus a hint).
  Same "don't offer what can't be used" approach Multimode's discipline
  filtering already uses. See
  [ARCHITECTURE.md §6.13](ARCHITECTURE.md#613-training-mode-manual-advance-same-rosterorder-as-qualification-controllable-from-a-second-device).
- **"Switch round" button hidden in fullscreen/kiosk mode**, same as the
  share-link row — clutter on an unattended wall display, rarely needed
  mid-event, always reachable by exiting fullscreen first. Group tabs,
  route tabs, and the Boulder-format toggle deliberately stay visible,
  since those may need adjusting without leaving kiosk mode. See
  [ARCHITECTURE.md §6.7](ARCHITECTURE.md#67-kiosk-mode-fullscreen--wake-lock-behind-one-button).

### Added
- **Multimode — up to 5 categories side by side, each with its own
  independent sequence** — a fourth setup mode alongside Single round /
  Sequence / Training. Each column has its own heading, group tabs,
  Boulder-format toggle, and route tabs (fully independent of the other
  columns), and can itself be a multi-round sequence ("Quali → Finale")
  that auto-advances on its own schedule whenever that column's own current
  round finishes — unrelated to what the other columns are doing. Lead and
  Boulder only; Speed is out of scope. Setup screen: pick a column count
  (2–5) first, then fill in a dedicated card per column — its own round
  picker and its own small round list, all visible and editable at once.
  Whatever a column's round picker currently shows is that column's round
  with no click needed — and this applies to every step of a sequence, not
  just the first: each step is its own live dropdown, and "+ Add Sequence"
  only ever appends a new step (pre-filled with a round not already used
  in that column, never a duplicate by default). Every step's own picker
  only ever offers rounds that are Lead/Boulder (never Speed), match
  whichever discipline an earlier column already locked in, and aren't
  already used elsewhere in that same column — nothing invalid or
  duplicate can be selected in the first place, so there's no error
  message for the common case anymore. A column doesn't need a round configured at
  all (useful for reserving more columns than there are currently-known
  categories to fill them with) - it just shows the same "Round finished"
  placeholder an actually-finished round gets; "Show Multimode" only
  refuses if every column is empty. A column with an actual 2+-round
  sequence shows its own "Next: …" line on the board once it's playing,
  same idea as the existing single-strip version in normal Sequence mode.
  Columns render side by side in a responsive grid (as many as fit the
  screen width, wrapping onto further rows otherwise, one per row below
  640px) - the actual point being to see every category at once on a big
  enough display - and card text inside Multimode is noticeably smaller
  than everywhere else in the app (fits 25+ characters per line even at
  the narrowest column width), so a narrow column stays readable. Share
  link/QR code work the same way as every other mode. See
  [ARCHITECTURE.md §6.23](ARCHITECTURE.md#623-multimode-up-to-5-categories-side-by-side-each-with-its-own-independent-sequence).
- **Route tabs — dedicate one tablet to one or more routes/boulders** — a
  new tab row below the group tabs lets a tablet show just "Boulder 2" (or
  several, e.g. "Boulder 1" + "Boulder 3" together) instead of the full
  lanes grid, for events with enough tablets to give each route its own
  dedicated wall display, or to split routes across a few extra tablets.
  Tab labels use the same "Route"/"Lane"/"Boulder" prefix as the lane
  headings, so a Boulder round reads "Boulder 1"/"Boulder 2" rather than
  just "1"/"2". Reuses the existing group-tabs/URL-param/share-link
  mechanism (6.6/6.4/6.18) at one level deeper granularity, so picking
  route(s) once and bookmarking the resulting share link/QR code pins that
  tablet to them permanently, same workflow as the existing round
  deep-links. Selecting exactly one route also renders it noticeably
  larger (bigger cards, bigger text) than the multi-lane grid, since the
  point is legibility from further away. See
  [ARCHITECTURE.md §6.22](ARCHITECTURE.md#622-route-tabs-dedicating-one-tablet-to-one-or-more-routesboulders).
- **Host label next to the status line** — small, muted text showing which
  results.info tenant the board is pointed at (e.g. "fasi.results.info"),
  right next to "Updated HH:MM:SS". Added now that the Server dropdown has
  six options instead of three, making a wrong-host mistake more plausible
  and harder to notice from the board alone. Stays visible in fullscreen
  (unlike the share-link rows) since it's informational, not a security
  concern, and most useful for remote troubleshooting exactly while a
  tablet is running unattended. See
  [ARCHITECTURE.md §6.21](ARCHITECTURE.md#621-host-label-next-to-the-status-line).
- **Three new results.info hosts**: `fasi.results.info` (FASI, Italy),
  `usac.results.info` (USA Climbing), `sac-cas.results.info` (SAC/CAS,
  Switzerland), added to the Server dropdown alongside DAV and IFSC — the
  respective federations wanted the same tool. Confirmed live against real
  events on all three (auth gate behavior, and the actual event/round JSON
  shapes, not just assumed from the existing hosts) before adding. No
  logic changes needed — `server.js`'s `HOSTS` map is host-agnostic by
  design (4.1), this was purely three new map entries plus three
  `<option>`s. Legal Information disclosure (see below) stays German-only
  for now, per explicit request.
- **"Legal Information" disclosure, setup screen only, pinned to the
  bottom of the screen** — a collapsed `<details>` under the feedback
  link, expanding five sections at once when clicked: Impressum (§ 5 DDG),
  a privacy policy (no cookies/tracking; `localStorage` usage explained
  with reference to § 25 Abs. 2 Nr. 2 TDDDG; Render Services, Inc. hosting
  in the US, with SCCs + EU-US Data Privacy Framework as the transfer
  basis; Art. 15-21 DSGVO rights), a data-source note (results.info /
  Vertical-Life GmbH, no mention of any usage arrangement), a liability
  disclaimer (no guarantee on live-data accuracy — on-site judges' ruling
  always wins; full-form "Haftung für Links" clause), and a short
  Streitschlichtung (§ 36 VSBG) non-participation sentence (deliberately
  without a link to the EU ODR/OS-Plattform, which was shut down 20 July
  2025). Stays minimally intrusive (one small link, collapsed by default)
  while remaining always reachable, and now sits flush at the bottom of
  the setup screen (flexbox sticky-footer pattern) instead of right after
  the form with dead space below it. Email assembled client-side (not
  written as a plain string in the HTML) to avoid casual scraping while
  staying a fully functional `mailto:` link. Drafted using standard German
  patterns, not legal advice — the user plans to have it reviewed before
  relying on it. Two outdated law references (§ 5 TMG, § 25 Abs. 2 Nr. 2
  TTDSG) caught in a second review pass and corrected to their current
  names (§ 5 DDG, § 25 Abs. 2 Nr. 2 TDDDG — both renamed 14 May 2024). See
  [ARCHITECTURE.md §6.20](ARCHITECTURE.md#620-legal-information-disclosure-impressum-datenschutzerklärung-datenquelle-haftungsausschluss-setup-screen-only-collapsed-by-default-pinned-to-the-bottom-of-the-screen).
- **QR codes next to both share-link fields** ("Link for this tablet",
  "Link to control from another device") — scan with a phone to open the
  exact same link instead of typing or copy-pasting. Generated client-side
  via a vendored, dependency-free library (`public/qrcode.js`, MIT), no
  CDN/network dependency. Verified with a real decode (rendered to PNG,
  read back with `zbarimg`) that the QR payload matches the visible link
  text exactly, including after a Boulder group-tab switch. See
  [ARCHITECTURE.md §6.18](ARCHITECTURE.md#618-qr-codes-next-to-the-tabletcontrol-share-links).
- **"Next up" strip in Sequence mode** — shows the upcoming category/round
  below the lanes once the current sequence entry is confirmed and there's
  another one queued after it, including the "A ↔ B" form for a paired
  (interleaved Speed) entry. Only appears with 2+ sequence entries; hidden
  for a single round or in Training mode. See
  [ARCHITECTURE.md §6.19](ARCHITECTURE.md#619-next-up-strip-in-sequence-mode).
- **Boulder final display mode toggle ("Intervall" / "World Series"), Boulder
  finals only.** results.info's `format_identifier` doesn't distinguish
  IFSC's two physical Boulder final formats, so this is a manual per-round
  choice (shown in the board header, only for rounds where
  `format_identifier` starts with `"boulder_finals"` — Qualification never
  shows it and always keeps the existing "Intervall" reading). "World
  Series" mode pads a not-yet-reached boulder's queue with blank
  placeholder slots so a candidate's real waiting-list position reflects
  how many heats away they genuinely are, instead of always sitting at the
  front — reported live off a real event (round `13833`): a candidate 3
  heats out from Boulder 4 was shown right at the top of its queue, when
  their real wait was still driven by Boulder 3's own remaining progress.
  Verified live (event `1593`) and via a controlled simulation that the
  padding count decrements by one every heat, promoting to `"NEXT"` at
  exactly the same heat "Intervall" mode already would have. See
  [ARCHITECTURE.md §6.17](ARCHITECTURE.md#617-boulder-final-display-mode-intervall-vs-world-series-manual-toggle-boulder-finals-only).
- **Feedback footer on the setup screen** ("Request a Feature or Send a
  Message"), linking out to a Google Form. Nested inside `#setup` so it
  automatically hides on the board (unattended, wall-mounted during a
  competition — an external link there would be clutter and an accidental
  tap risk) without needing any new visibility logic. See
  [ARCHITECTURE.md §6.16](ARCHITECTURE.md#616-feedback-footer-setup-screen-only).
- **Boulder qualification and finals support**, covering every
  `format_identifier` variant checked so far: `boulder_two_groups_ifsc_2026`,
  `boulder_one_group_ifsc_2026`, `boulder_one_group_ifsc_2026_two_courses`
  (qualification-style rotations), `boulder_finals_ifsc_2026` (parallel
  final), `boulder_finals_one_by_one` (sequential final). Fixed a gap where
  a boulder nobody had reached yet could show a phantom "current climber"
  (`computeBoulderLane()`, scoped to Boulder only, Lead/Speed untouched).
  The "2 Courses" format additionally gets the same Group A/B-style tab
  switching as the nested `starting_groups` format, synthesized from route
  naming (`A1`/`B1`/... → "Course A"/"Course B") since results.info
  supplies no group name for this shape. See
  [ARCHITECTURE.md §5.6](ARCHITECTURE.md#56-boulder-rotation-formats-a-per-route-not-yet-reached-guard-computeboulderlane)
  and
  [§6.6](ARCHITECTURE.md#66-boulder-starting-group-tabs-default-to-one-group-at-a-time).
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
- **Removed the automatic 90s stuck-heat watchdog from paired (interleaved)
  Speed entries.** Explicitly requested: the paired display should only
  switch categories on a genuine stage completion or a human clicking
  "⇄ Switch category now" — never silently after a timeout. Accepted
  tradeoff: an unattended tablet with a genuinely stuck heat (no recorded
  result at all) and nobody noticing now shows a stale category
  indefinitely instead of self-correcting after 90 seconds; the manual
  button is the only way to move past it. `STUCK_TIMEOUT_MS` and
  `pairedState.stuckHeatId`/`stuckSince` removed entirely rather than left
  unused. See
  [ARCHITECTURE.md §6.12](ARCHITECTURE.md#612-paired-sequence-entries-interleaving-speed-finals-between-categories).

### Fixed
- **The Training "link to control from another device" row (with its QR
  code) stayed visible in fullscreen/kiosk mode** — reported live: unlike
  the plain tablet-link row (already hidden in fullscreen), this one is a
  genuine access-control concern on an unattended wall tablet, since the
  control link needs no login and now carries a scannable QR code.
  `fullscreenchange` now hides it too, restoring it on exit only for the
  tablet that's actually the training wall-display side
  (`kind === "training" && !control`) — not unconditionally, which would
  have incorrectly revealed it after exiting fullscreen in any unrelated
  mode. Verified live for both the training case (hides/restores
  correctly) and a plain watch-mode board (stays hidden throughout). See
  [ARCHITECTURE.md §6.7](ARCHITECTURE.md#67-kiosk-mode-fullscreen--wake-lock-behind-one-button).
- **A not-yet-reached Boulder route's `"NEXT"` card showed a candidate
  several heats too early for a World Series-style final (gap = boulder
  count, at most 2 boulders live at once)** — reported live off a
  hand-drawn heat/boulder table: an athlete who only has ONE boulder to
  finish before this one (the norm for that format) got shown as `"NEXT"`
  the moment they were confirmed there, well before the target boulder had
  any real reason to be open (other athletes were still working through
  the current boulder's own remaining slots). The readiness check only
  looked at the candidate's own prior obligations, not whether the route
  itself had genuinely made room. Replaced with `boulderGroupFrontier()`:
  readiness is now based on the group's real furthest-progressed position
  (confirmed against real data that `route_start_positions` values are a
  shared "heat slot" number within one route group, not a per-route
  independent rank) rather than the candidate's own routes alone. Scoped
  to the route's own group (Course A/B, or Group A/B) so a faster group
  can't leak progress into a slower one's readiness — confirmed against
  real data that each group has its own independent position numbering.
  Verified: round `13712`'s qualification result (gap 2) unchanged, round
  `13735`'s World Series-style result (gap = boulder count) now correct —
  `NEXT` stays blank through the boulder's first 3 heats and populates on
  the 4th, one heat before it opens — and Course A/B group-scoping holds
  (one course fully confirmed doesn't affect the other's readiness). See
  [ARCHITECTURE.md §5.6](ARCHITECTURE.md#56-boulder-rotation-formats-a-per-route-not-yet-reached-guard-computeboulderlane).
- **A not-yet-reached Boulder route jumped straight from "a name in the
  waiting list" to `"CLIMBING"`, with no `"NEXT"` step in between** — even
  for an athlete who had genuinely just finished their previous boulder
  and was resting, one rotation away. `computeBoulderLane()`'s "not
  started yet" guard now shows that athlete as `"NEXT"` specifically once
  the group's real progress reaches one position before their own here
  (see the entry above for the final version of this rule — this entry's
  original fix used an athlete-centric readiness check, later replaced).
  `CLIMBING` still stays blank until the boulder is actually reached, and
  the waiting list below still shows the fuller upcoming order regardless.
  This replaces two earlier iterations in this same Unreleased batch (a
  version that showed `"NEXT"` unconditionally — too early — and one that
  blanked it unconditionally — too late), both live-reported as wrong in
  their own direction. Verified with a full rotation simulation (round
  `13712`): boulder 4 shows `CLIMBING —`/`NEXT —` through heat 5, `NEXT`
  populates at heat 6 (its candidate now confirmed on boulders 1–3), and
  `CLIMBING` follows one heat later at heat 7. See
  [ARCHITECTURE.md §5.6](ARCHITECTURE.md#56-boulder-rotation-formats-a-per-route-not-yet-reached-guard-computeboulderlane).
- **A Boulder route flipped to the next athlete as `"CLIMBING"` the instant
  the previous one was confirmed, even though that next athlete hadn't
  actually started a try yet.** Reported live while watching real judging
  (event `1593`): the judge confirms LORENTZ on boulder 2, and the app
  immediately shows MELVILLE as climbing — before MELVILLE has done
  anything. Confirmed against real, currently-live-judged data that a
  Boulder ascent goes `pending` → `active` (a genuine try-counter
  increment — not triggered by the judge merely navigating to that
  athlete's screen) → `confirmed`, with no separate "moved to next
  athlete" API signal at all. `computeBoulderLane()` no longer falls
  through to `computeLane()` once a route has activity — it now keeps
  showing the last *confirmed* athlete as `"climbing"` until the next one
  genuinely goes `"active"`, with the same post-hoc-edit backward-jump
  protection Lead already has (5.2) applied independently here. Verified
  live against the real event and via a controlled simulation (round
  `13712`) covering all three cases: sticks until active, doesn't jump
  backward on a reopened earlier score, and still correctly detects
  `"Round finished"`. See
  [ARCHITECTURE.md §5.6](ARCHITECTURE.md#56-boulder-rotation-formats-a-per-route-not-yet-reached-guard-computeboulderlane).
- **Boulder rotation formats (e.g. `boulder_two_groups_ifsc_2026`) could
  show a "current climber" on a boulder nobody had reached yet — including
  the same athlete shown as `"climbing"` on two different boulders at
  once.** Found during a deliberate investigation, before shipping, not a
  live report. This format stages athletes through several boulders in a
  staggered pipeline (results.info already encodes the correct per-boulder
  arrival order via `startlist[].route_start_positions` — no interval/clock
  logic needed in the app at all), but a boulder can go completely
  untouched for several intervals even after the round overall is already
  `"active"` — `computeLane()`'s existing "has the round started"
  (`round.status`) guard can't tell that apart from the normal
  live-judging gap it's designed to catch. New `computeBoulderLane()`
  additionally checks whether anyone has actually gone active/confirmed on
  that *specific* boulder yet; if not, it shows the same "not started"
  state a not-yet-started round already gets, instead of guessing at
  someone who hasn't arrived. Scoped strictly to Boulder
  (`round.discipline === "Boulder"`) via a wrapper around, not a change to,
  `computeLane()` — Lead and Speed qualification (frozen for this round of
  changes) are verified to never even call the new function, and every
  already-progressed boulder in real test data produces byte-identical
  output to before. See
  [ARCHITECTURE.md §5.6](ARCHITECTURE.md#56-boulder-rotation-formats-a-per-route-not-yet-reached-guard-computeboulderlane).
- **A Lead/Boulder qualification route could jump backward after a result
  was edited post-confirmation.** Reported live: "Route 2 hängt" on an IFSC
  event, traced to a score correction on an already-confirmed athlete,
  which briefly sets their ascent back to `"active"` while it's re-checked.
  `findCurrentIndex()` used to let any `"active"` entry win outright, so the
  display jumped back to the athlete being corrected even though later
  athletes were already confirmed — real progress had moved well past them.
  Now takes `Math.max(lastActive, lastConfirmed + 1)` instead: an `"active"`
  entry still wins whenever nothing further along is confirmed yet (the
  normal live-judging case, unchanged), but no longer overrides an
  already-confirmed frontier. See
  [ARCHITECTURE.md §5.2](ARCHITECTURE.md#52-the-inference-findcurrentindex--computelane-in-publicappjs).
- **A paired sequence entry didn't hand off to the other category while one
  side hadn't started at all yet** (e.g. waiting on its own semifinal to
  determine finalists). `currentStageNameFor()` used to report a
  not-started round's pre-generated first-stage name regardless of
  `round.status`, which could rank *earlier* than the other side's real
  progress and pin the shared stage there — leaving both sides empty
  (the not-started one because it's not ready, the progressing one because
  it had already moved past that stage) and the display ping-ponging
  between two "Waiting for the next stage…" screens instead of showing the
  side with real content. Now returns `null` immediately for
  `round.status === "pending"`, deferring unconditionally to the other
  side, the same as an entirely-absent bracket already did. The manual "⇄
  Switch category now" button is unaffected and still available. See
  [ARCHITECTURE.md §6.12](ARCHITECTURE.md#612-paired-sequence-entries-interleaving-speed-finals-between-categories).
- **"Fullscreen + Always On" stopped keeping the screen awake after about
  10 minutes in Safari Private Browsing**, even with the tab staying
  visible and fullscreen the whole time (so the existing
  backgrounded-tab re-acquisition never triggered). Private Browsing
  applies stricter background/power policies and can silently revoke the
  Wake Lock outside this app's control. Now also listens for the wake lock
  sentinel's own `"release"` event — which fires whenever the lock is let
  go for any reason — and immediately re-requests it, guarded so a
  deliberate exit doesn't trigger an unwanted re-acquire loop. Best-effort:
  if Private Browsing keeps revoking it regardless, each release is one
  more retry, not a fix for the underlying policy — not running the kiosk
  tablet in Private/Incognito mode remains the reliable option. See
  [ARCHITECTURE.md §6.7](ARCHITECTURE.md#67-kiosk-mode-fullscreen--wake-lock-behind-one-button).
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
