# Working rules for AI coding sessions on this repo

Read this before making any change. It's operational rules, not background —
for the "why" behind the code, read [ARCHITECTURE.md](ARCHITECTURE.md)
first; this file is about *how to work in this repo safely*, not what the
code does.

## 1. Before touching `public/app.js` or `server.js`

Read [ARCHITECTURE.md §5](ARCHITECTURE.md#5-core-algorithm-whos-at-the-wall)
(core algorithm) and [§6](ARCHITECTURE.md#6-design-decisions) (design
decisions) in full first. Several things in this codebase that *look* like
bugs or unnecessary complexity on first read are deliberate fixes for real,
previously-reported problems:

- `round.status === "pending"` short-circuit in `computeLane()` — removing
  it silently reintroduces the "athlete #1 shown as at the wall before the
  round starts" bug.
- `findCurrentIndex()`'s two-rule split (latest `"active"` entry wins,
  else last-`"confirmed"`+1) — do NOT simplify this to a single "status is
  not pending" check. `"active"` specifically means "a judge is
  live-scoring this right now, not yet confirmed" and must NOT be treated
  as done; conflating the two was a real shipped bug (see
  `CHANGELOG.md`, the entry that corrects the previous one). **This rule is
  for qualification rounds (`computeLane()`) only.**
  - It's `Math.max(lastActive, lastConfirmed + 1)`, NOT "prefer active
    whenever one exists" - a real bug ("Route 2 hängt" on an IFSC event),
    fixed after editing an already-confirmed result (a score correction)
    briefly set it back to `"active"` again, which used to yank the display
    backward to the athlete being corrected even though later athletes were
    already confirmed. Don't revert to unconditionally preferring
    `lastActive` - that reintroduces exactly this jump-backward bug. The
    normal live-judging case (nothing further along confirmed yet) is
    unaffected either way, since `lastConfirmed + 1` is behind `lastActive`
    there regardless.
- `computeBoulderLane()` — used only when `round.discipline === "Boulder"`
  (checked in `buildLane()`, not inside `computeLane()` itself). Boulder
  qualification/two-group formats stage athletes through several boulders
  in a timed rotation (results.info already encodes the correct per-boulder
  arrival order via `route_start_positions` - no interval/clock logic
  needed), but a boulder can sit completely untouched for a while even
  after `round.status` is already `"active"` (an earlier boulder already
  has real progress) - `computeLane()`'s own `round.status === "pending"`
  guard can't catch that, since the ROUND has started, just not THIS
  boulder yet. Without `computeBoulderLane()`'s extra "has anyone gone
  active/confirmed on THIS route yet" check, a not-yet-reached boulder
  falls back to showing whoever's first in its own queue as already
  `"climbing"` - reproduced with mocked data: the same athlete shown as
  climbing on two different boulders simultaneously. **The "not started
  yet" return's exact shape for `onDeck`/`queue` took FIVE rounds of live
  feedback to land on - don't collapse it back to any earlier version:**
  - Filling `onDeck` with the boulder's own first-in-queue athlete
    unconditionally (like `queue[0]`) was the original bug - reads as
    "you're up soon" even when that athlete is several rotations away.
    Don't reintroduce `onDeck: ordered[0]` unconditionally.
  - Blanking `queue` too (`queue: []`) was the *next* iteration, also
    reported live as wrong in the other direction - staff want to see who's
    coming up at a not-yet-reached boulder. Don't collapse `queue` back to
    `[]`.
  - Leaving `onDeck` unconditionally blank (while `queue` stayed populated)
    was the iteration *after that* - still reported live as missing
    something: an athlete who's genuinely just finished their previous
    boulder and is now resting, one rotation out, should show as `"NEXT"`
    rather than jump straight from "a name in the list" to `"CLIMBING"`.
  - The *fourth* iteration made `onDeck` show the candidate once they were
    `DONE_STATUSES`-confirmed on every OTHER route where their own position
    was lower than their position on this one, checked athlete-first (walk
    the candidate's own `route_start_positions`) rather than by boulder
    name/order. Correct for the gap-2 qualification rotation, but reported
    live as **wrong for a World Series-style final** (gap = boulder count):
    a candidate with only ONE prior boulder got marked ready almost
    immediately, several heats before the target boulder had any real
    reason to be open - this check only looked at the candidate's own prior
    obligations, never at whether the route itself had genuinely made room
    (other athletes still working through the current boulder's own
    remaining slots). **Don't reintroduce this "confirmed on all own lower
    positions" check** - it's a real bug for any format where a boulder's
    opening depends on more than just the candidate's own progress.
  - **Current behavior (`boulderGroupFrontier(round, route)`):** `onDeck`
    shows the candidate once the route's own GROUP (via
    `collectRouteGroups()`, 6.6 - Course A/B, Group A/B, or the whole round
    if ungrouped) has real recorded progress (`active`/`DONE_STATUSES`
    ascents, anywhere in that group) reaching one position before the
    candidate's own position on this route. Confirmed against real
    `route_start_positions` data (fixtures `13712`, `13735`, `13709`/`13711`
    in §3) that position values are a literal shared "heat slot" number
    *within one group* - the same position value can appear on two
    different routes in the same group for two different athletes, meaning
    those two ascents genuinely happen at the same moment - which is what
    makes a group-wide frontier meaningful instead of just the candidate's
    own routes. **Scope this to the route's own group, not the whole
    round** - confirmed against real data (fixture `13709`) that Group A
    and Group B each have their own INDEPENDENT position numbering
    starting at 1, not a shared round-wide clock; a round-wide frontier
    would let a faster-judged group's high position values falsely mark a
    slower group's candidate "ready" early (verified live: with Course A
    fully confirmed and Course B untouched, Course B's boulders still
    correctly show blank `CLIMBING`/`NEXT` - no leakage). `queue` still
    shifts by one depending on whether `onDeck` got filled - `ordered.slice(0,
    6)` when it's still `null`, `ordered.slice(1, 7)` once `onDeck` is
    populated.
  Verified live (full rotation simulation, round `13712`, gap-2): a
  not-yet-reached boulder shows `CLIMBING —`, `NEXT —`, and a populated
  waiting list through heat 5; `NEXT` populates at heat 6, `CLIMBING`
  follows one heat later at heat 7 - unchanged from before this rewrite.
  Newly verified (round `13735`, gap = boulder count / World Series-style):
  `NEXT` now correctly stays blank through the boulder's first 3 heats and
  only populates on the 4th, one heat before the boulder actually opens.
  **Don't merge this logic into `computeLane()`** - Lead and Speed
  qualification share that function and were explicitly frozen when this
  was built; verified live that `computeBoulderLane()` is never invoked
  for either.

  **Once a route has real activity, `computeBoulderLane()` no longer falls
  through to `computeLane(round, route)` at all - it has its own
  "already reached" frontier rule. Don't reintroduce
  `return computeLane(round, route);` here.** Confirmed live against real,
  currently-judged data (event `1593`, round `13840`) that a Boulder
  ascent goes `pending` → `active` (a genuine try-counter increment - NOT
  triggered by the judge merely navigating to that athlete's screen) →
  `confirmed`, with no separate "moved to next athlete" API signal at all.
  `computeLane()`'s rule (`lastConfirmed + 1` is the new current athlete)
  assumes the next athlete starts climbing the instant the previous one is
  confirmed - reported live as wrong for Boulder specifically: it showed
  MELVILLE as `"climbing"` the moment LORENTZ was confirmed, before
  MELVILLE had done anything. Current behavior: track `lastActive` and
  `lastConfirmed` indices in the route's own ordered queue; if some entry
  is `"active"` **and** sits after `lastConfirmed`, that's the new
  `atWall` (normal forward progress); otherwise the frontier sticks at
  `lastConfirmed` (the previous athlete keeps showing as `"climbing"`)
  unless that's the last athlete in the queue, in which case the route is
  `finished`. The "after `lastConfirmed`" condition is the same
  post-hoc-edit backward-jump protection `findCurrentIndex()` already has
  for Lead (see above, `Math.max(lastActive, lastConfirmed + 1)`) -
  **don't drop it and unconditionally prefer `lastActive`**, or a judge
  reopening an earlier athlete's score to correct it will pull the display
  backward past someone already confirmed further along. Verified live
  (event `1593`) and via a controlled mocked simulation (round `13712`,
  real athlete IDs/positions) covering all three cases: sticks on the
  previous athlete until the next genuinely goes active; a reopened
  earlier entry does not jump the frontier backward; the last athlete
  confirmed with nobody active after correctly resolves to `"Round
  finished"`. See
  [ARCHITECTURE.md §5.6](ARCHITECTURE.md#56-boulder-rotation-formats-a-per-route-not-yet-reached-guard-computeboulderlane).
- `computeBoulderLane(round, route, finalMode)`'s third parameter and
  `isBoulderFinalRound()`/`renderBoulderModeToggle()` (6.17) - a manual,
  per-round "Intervall" vs "World Series" toggle for Boulder FINAL rounds
  only, because results.info's `format_identifier` doesn't distinguish
  these two physical formats (confirmed directly by the user: "Leider sagt
  das Format in dav-stage nichts darüber"). **`finalMode` only changes
  behavior inside the "not yet reached" branch, and only when it's
  literally the string `"world_series"`** - every other code path
  (Qualification, the already-reached sticky-frontier branch, Lead/Speed
  via `computeLane()`) is completely unaffected regardless of what gets
  passed, by construction (the parameter is only read in one place). Don't
  make Qualification rounds show the toggle or default to anything other
  than `"interval"` - `isBoulderFinalRound()` gates this via BOTH
  `discipline === "Boulder"` AND `format_identifier` starting with
  `"boulder_finals"`, deliberately excluding every qualification-style
  identifier. In `"world_series"` mode, the not-yet-reached branch computes
  a numeric `distance` from `boulderGroupFrontier()` (5.6) instead of just
  a boolean, and prepends `distance - 1` blank (`null`) slots to the queue
  array - **don't recompute the frontier differently for this mode**, the
  existing group-scoped `boulderGroupFrontier()` is correct here too
  (verified live, round `13833`/event `1593`, and via a controlled 9-athlete
  simulation) since a World Series final has no course split (a single
  ungrouped route group covering every boulder), so the group frontier is
  already equivalent to "whichever boulder is currently most advanced".
  `distance === 0` behaves identically to `"interval"` mode (onDeck
  populated, no padding) and `distance === 1` also renders byte-identical
  to `"interval"` (zero padding slots) - the two modes only ever visibly
  diverge once a candidate is more than one heat out, so don't expect (or
  introduce) any difference for a candidate that's already close. Mode is
  stored in `localStorage` keyed by `round.id`
  (`BOULDER_FINAL_MODE_KEY`/`loadBoulderFinalMode()`/`saveBoulderFinalMode()`),
  not per-tablet - it describes a property of the real event. See
  [ARCHITECTURE.md §6.17](ARCHITECTURE.md#617-boulder-final-display-mode-intervall-vs-world-series-manual-toggle-boulder-finals-only).
- `groupRoutesByCoursePrefix()` / the `round.discipline === "Boulder"`
  guard inside `collectRouteGroups()` - synthesizes Group-A/B-style tabs
  for Boulder's "2 Courses" format (`A1`/`A2`/`A3`/`B1`/`B2` route names,
  no `starting_groups` to read a group name from). The discipline check is
  the actual safety guarantee, not the naming pattern - don't remove it
  even though Lead's plain-number route names and Speed's single-letter
  (no digit) route names wouldn't currently match the pattern anyway;
  removing the check would apply this detection to Lead/Speed the moment
  either ever uses a matching naming scheme, which is exactly the kind of
  drift the discipline check exists to prevent. See
  [ARCHITECTURE.md §6.6](ARCHITECTURE.md#66-boulder-starting-group-tabs-default-to-one-group-at-a-time).
- `heatIsDone()` in `computeSpeedElimination()`/`stageHeatsRemaining()` —
  Speed-elimination heats deliberately do NOT use the `findCurrentIndex()`
  active/confirmed rule above. Confirmed live against real results.info
  data (see the `13740`/`13741`/`13748` fixtures in §3) that a
  Speed-elimination heat can carry a complete, valid, real time for both
  lanes - stage explicitly closed in results.info's own admin tool - and
  still report ascent status `"active"` forever; unlike qualification
  rounds, `"active"` apparently never resolves to `"confirmed"` here.
  `heatIsDone()` instead checks the recorded result directly, ignoring
  `status` entirely for Speed elimination. `dnf` and `dns` are handled
  *differently* - don't conflate them:
  - **`dns` (false start) OR `formatted_ascent_score === "NOT STARTED"`
    auto-decides the whole heat on its own** - the other lane wins as a
    "wildcard" *without ever getting its own ascent recorded*, confirmed
    live: `time_ms: 0` or `null`, `status: "active"`/`"pending"` forever on
    the winning lane. "Not started" is a real, separate results.info
    outcome (a no-show) with `dnf: false, dns: false` - the `formatted_ascent_score`
    text is the ONLY way to detect it. **Do NOT use `time_ms === null` as a
    shortcut for "not started"** - a completely untouched wildcard-*winner*
    ascent (the other lane in a plain `dns` heat) can also have
    `time_ms: null` with no `formatted_ascent_score`, so that alone would
    misfire - verified live on the exact heat that exposed this (see the
    `13739` fixture in §3).
  - **`dnf` (fall) does NOT auto-decide the heat** - a first version of
    this fix treated `dnf` the same as `dns`, which was wrong (corrected
    after user feedback): a fall only settles *that lane's own* result: the
    other lane still needs a real `time_ms > 0` before the heat counts as
    done.
  Don't simplify this back to "both lanes need a result" (unqualified) -
  that reintroduces the wildcard-heat-never-resolves bug for `dns`/"not
  started". Don't treat `dnf` as auto-deciding either - that lets a heat
  resolve before the surviving lane has actually finished their run. Don't
  "fix" this back to mirror `computeLane()`'s status-based rule - that's
  the original bug this replaced, verified stuck live on multiple
  rounds/events. See
  [ARCHITECTURE.md §5.5](ARCHITECTURE.md#55-speed-elimination-heat-based-inference-computespeedelimination).
- `collectRouteGroups()` handling both `round.routes` and
  `round.starting_groups[].routes` — Boulder-with-groups rounds have no
  `routes` field at all; assuming it always exists breaks those rounds.
- `queue.setAttribute("start", "2")` — intentional, not a stray leftover.
- The `[hidden] { display: none !important; }` rule in `styles.css` —
  needed because a more specific `.setup-row { display: flex }` rule was
  silently overriding the default `[hidden]` behavior.
- The setup screen's mode tabs (Single round / Sequence / Training) —
  don't add a new checkbox next to the round dropdown for a new optional
  behavior, even a small one. An earlier design did exactly that and it
  live-tested as confusing; new per-mode options belong inside whichever
  mode's own row, not as a fourth checkbox. See
  [ARCHITECTURE.md §6.11](ARCHITECTURE.md#611-setup-screen-modes-instead-of-independent-checkboxes).
- `earlierStageName(currentStageNameFor(dataA), currentStageNameFor(dataB))`
  in `pollPairedTick()` — the shared stage for a paired entry, computed
  **fresh every tick**, deliberately NOT persisted/only-ever-advanced.
  Several things this line buys, don't undo any of them:
  - `earlierStageName()` (comparing by canonical stage *name*, via
    `SPEED_STAGE_ORDER`/`stageNameRank()`) is what keeps both sides in
    lockstep - an earlier version let each side use its own
    `computeSpeedElimination()` result directly, which let a
    faster-progressing category skip ahead onto a later stage instead of
    the requested lockstep order (1/8 A, 1/8 B, 1/4 A, 1/4 B, ...) -
    reproduced live (see the `13742`+`13741` fixture in §3).
  - Comparing by **name**, not raw array *index* - a still-earlier version
    used `Math.min(currentStageIndexFor(dataA), currentStageIndexFor(dataB))`,
    which silently misaligns if the two sides' `speed_elimination_stages`
    arrays don't have the same stages at the same offsets (a smaller
    bracket can start directly at "1/4" with no "1/8" before it) - fixed
    after a proactive user review, not a live report; verified with a
    mocked bracket-size mismatch.
  - `currentStageNameFor()`'s `if (round.status === "pending") return null;`
    guard at the very top, BEFORE looking at `speed_elimination_stages` at
    all - a real bug ("wechselt nicht automatisch ... wartet auf 1/2
    finals"), fixed after a live report. Without it, a round that hasn't
    started yet (still waiting on its own semifinal to determine finalists)
    can still report its pre-generated skeleton's first stage name, which
    then competes on equal footing in `earlierStageName()` and can pin the
    shared stage on a side that isn't actually progressing - leaving BOTH
    sides empty and the display ping-ponging between two "Waiting for the
    next stage…" screens instead of showing whichever side has real
    content. Don't remove this guard or move it after the
    `speed_elimination_stages` check - the whole point is to short-circuit
    on `round.status` regardless of what the bracket skeleton itself says.
  - Recomputing fresh every tick (rather than a persisted cursor that only
    moves forward) is what makes a judge's later correction to an earlier
    stage (deleting and re-entering a result) self-correct automatically on
    the next poll - verified live (see the `13740`+`13741` reset scenario,
    discussed with the user rather than adding a manual reset button).
    Don't reintroduce a persisted `stageName`/`stageIndex` "for efficiency"
    - the statelessness is the point, not an accident.
  Don't revert `renderPairedBoard()` to calling the ordinary
  `renderBoard()`/`computeSpeedElimination()` for a paired entry's active
  side either - that's the exact mechanism that reintroduces the
  skip-ahead bug. See
  [ARCHITECTURE.md §6.12](ARCHITECTURE.md#612-paired-sequence-entries-interleaving-speed-finals-between-categories).
- **Training mode's Speed-only gating** (`updateTrainingEligibility()`,
  `opt.dataset.speed`, `#trainingHint`) - don't remove this to "simplify" the
  round dropdown. Boulder/Lead rounds don't fit Training mode's
  manual-roster-advance concept (no linear start order once Boulder
  starting groups split the field; Lead already has real live inference via
  Single round/Sequence mode). See
  [ARCHITECTURE.md §6.13](ARCHITECTURE.md#613-training-mode-manual-advance-same-rosterorder-as-qualification-controllable-from-a-second-device).
- **`pollToken`/`trainingPollToken`** - every async poll path checks its
  captured token against the current counter before mutating render state,
  and silently discards its result if a newer poll call has since started.
  Don't remove these checks to "simplify" a poll function - without them, a
  slower in-flight request can resolve after a newer one and overwrite
  fresh data with stale data. Two independent counters on purpose (main
  watch chain vs. Training mode) - don't merge them into one, the two modes
  are mutually exclusive with separate render targets. See
  [ARCHITECTURE.md §6.14](ARCHITECTURE.md#614-poll-overlap-protection-polltoken--trainingpolltoken).
- **No automatic stuck-heat watchdog in `pollPairedTick()` any more -
  `STUCK_TIMEOUT_MS` and `pairedState.stuckHeatId`/`stuckSince` were
  removed by explicit user request, don't reintroduce them.** (An earlier
  version of this file said the opposite - "not a bug waiting to be
  cleaned up, still needed as a safety net" - that guidance is superseded;
  the user weighed the tradeoff explicitly and chose to remove it anyway.)
  The only way to move a paired entry off a stuck heat now is the manual
  "Switch category now" button - the display never switches categories on
  its own except on a genuine stage completion. Known tradeoff, accepted
  on purpose: an unattended tablet with a genuinely stuck heat (no
  recorded result at all - equipment failure, an unresolved dispute) and
  nobody noticing will show a stale category indefinitely instead of
  self-correcting after 90s. See
  [ARCHITECTURE.md §6.12](ARCHITECTURE.md#612-paired-sequence-entries-interleaving-speed-finals-between-categories).
- `renderImpressumEmail()` (6.20) - don't inline the email address as a
  plain string in `index.html` again; it's deliberately assembled in
  `app.js` to avoid sitting in the page source as a scrapable string,
  while still rendering a fully normal `mailto:` link. Also don't put
  `.legal` back to `display: inline-block` on the same line as the
  feedback link - that was a real layout bug (fixed): once expanded, the
  tall body content broke the surrounding centered inline flow and
  visually reordered the two footer items. It needs its own line.
- The `.legal` disclosure (6.20) is ONE `<details>` covering FOUR documents
  (Impressum, Datenschutzerklärung, Datenquelle, Haftungsausschluss), each
  its own `<h4>` inside `.legal-body` - don't split it back into four
  separate `<details>` elements without a real reason, that was a
  deliberate choice to keep the footer to one interactive element
  ("maximal unauffällig"). The Datenquelle section deliberately does NOT
  mention any permission/arrangement/exemption for using the results.info
  API, even though one exists - the user explicitly asked for the public
  text to just name the data source plainly, nothing about a special
  arrangement. Don't add that back in without being asked. The Hosting
  paragraph assumes Render runs in a US region (confirmed by the user) -
  if that ever changes, the Drittlandtransfer/SCC/DPF wording needs
  updating, don't assume it's still accurate. None of this text is
  lawyer-reviewed - the user was told this explicitly and plans to have it
  checked; don't treat it as verified-correct in a future session. Summary
  label is "Legal Information" (matching `dav.results.info`'s own footer
  wording for the same kind of link, confirmed live) - not just "Legal".
  After user review of the first draft: no "privately operated, not on
  behalf of a club/company" sentence in the Impressum (not a § 5 DDG
  requirement, just noise); "Deine Rechte" IS kept (genuinely applicable,
  Render processes IPs to serve the site at all); "Haftung für Links" uses
  the user's own longer-form wording (states links were checked at the
  time of linking, no ongoing monitoring duty without concrete cause)
  rather than a shorter draft - don't silently swap any of these back.
  **Legal text uses § 5 DDG and § 25 Abs. 2 Nr. 2 TDDDG, NOT the older
  § 5 TMG / § 25 Abs. 2 Nr. 2 TTDSG** - both laws were renamed 14 May 2024
  (DSA implementation); confirmed live via web search, don't revert to the
  old names if this section is touched again. **A short Streitschlichtung
  (§ 36 VSBG) non-participation sentence IS included** (reverses an
  earlier "leave it out" call - kept as cheap defensive boilerplate even
  though § 36 VSBG likely doesn't strictly bind a private, non-commercial
  operator) - but do NOT add a link to the EU ODR/"OS-Plattform"
  (`ec.europa.eu/consumers/odr`) next to it, even though the two are often
  paired in older templates: that platform was shut down by the EU
  Commission on 20 July 2025, and a still-live link to it now risks being
  read as a misleading claim in itself. The two are legally separate
  mechanisms - don't conflate them if asked to touch this again.
- `.setup`'s `min-height: 100dvh` + `display: flex; flex-direction: column`
  and `.setup-footer`'s `margin-top: auto` (6.20) are a matched pair - the
  standard flexbox sticky-footer pattern, pinning the footer to the bottom
  of the setup screen when its content doesn't fill the viewport, while
  still scrolling normally (not overlapping) once content or the expanded
  Legal Information body exceeds it. Don't swap this for `position: fixed`
  - that would overlap content instead of gracefully falling back on a
  short viewport or once the disclosure is expanded.
- `public/qrcode.js` (6.18) — a vendored third-party file (Kazuhiko Arase's
  `qrcode-generator`, MIT), NOT project code - don't "clean up" its style,
  reformat it, or fold it into `app.js`. It's the ONE exception to "no
  external dependencies" in the browser, and it's an exception specifically
  because it's vendored (no CDN, no network call) - don't replace it with a
  CDN `<script src="https://...">` for "simplicity". Loaded before `app.js`
  in `index.html`; its top-level `var qrcode` becomes a plain global in
  this build-less setup, callable directly as `qrcode(0, 'M')`.
- `setShareLink()`/`setControlLink()` (6.18) - route every write to
  `el.shareLink.value`/`el.controlLink.value` through these, never assign
  the input's `.value` directly. There are four call sites
  (`startWatching()`, the Boulder group-tab click handler,
  `startTrainingSession()` x2) - missing even one leaves that link's QR
  code showing a stale/wrong URL while the text field itself is correct,
  which is worse than not having a QR code at all (looks right, scans
  wrong). Verified via a real decode (SVG → PNG → `zbarimg`), not just
  "an SVG got rendered" - if you touch this again, re-verify the same way,
  not just that `innerHTML` changed.
- `roundLabelCache`/`getRoundLabel()`/`updateNextInSequence()` (6.19) -
  don't reuse `el.roundSelect`'s `<option>` labels for this instead of a
  fresh fetch, even though it looks like duplicate work: `el.roundSelect`
  is only populated by the interactive "Load event" setup-screen flow
  (`populateRounds()`) and is EMPTY for the common real-world case of a
  tablet opened straight from a bookmarked `?host=...&rounds=...` link
  (6.1) - `startWatching()` is called directly there, `populateRounds()`
  never runs. The cache is keyed `"host:roundId"` and never invalidated
  within a session - safe because a round's category/round name is
  immutable for the tablet's lifetime; don't add TTL/expiry logic to it.
  `updateNextInSequence()` is called from exactly the two steady-state
  `return`s inside `pollCurrent()`'s loop, not the "superseded"/"fetch
  failed" ones - and is guarded by the same `pollToken` check as the rest
  of that function, so don't remove that guard even though this function
  "just" updates a text strip. `startWatching()` force-hides
  `#nextInSequence` immediately, before any poll can run - required
  because Training mode shares `#board` with Sequence mode but never calls
  `updateNextInSequence()`, so without the forced hide a stale strip from
  a prior Sequence-mode session would leak into a Training session.
- The in-memory training counter in `server.js` — the one deliberate
  exception to "the server has no persistent state" (see ARCHITECTURE.md
  §2). Don't "fix" it into `localStorage` only; the whole point is that a
  second device can read/write the same counter. See
  [ARCHITECTURE.md §6.13](ARCHITECTURE.md#613-training-mode-manual-advance-same-rosterorder-as-qualification-controllable-from-a-second-device).
- `requestWakeLock()`'s `sentinel.addEventListener("release", ...)` handler
  in the kiosk-mode code - a real bug ("Always On" stopped holding the
  screen awake after ~10 minutes in Safari Private Browsing, tab staying
  visible/fullscreen the whole time), fixed after a live report. The
  existing `visibilitychange` listener only covers the backgrounded-tab
  case; it never fires if the browser silently revokes the lock while the
  tab stays visible, which Private Browsing's stricter power/background
  policy can do. Don't remove the release listener as "redundant" with
  `visibilitychange` - they cover two different release triggers. The
  re-request inside it is guarded on `document.fullscreenElement` so a
  deliberate exit (which also releases the lock) doesn't cause an
  unwanted re-acquire loop. See
  [ARCHITECTURE.md §6.7](ARCHITECTURE.md#67-kiosk-mode-fullscreen--wake-lock-behind-one-button).
- The `fullscreenchange` handler's `el.controlShareRow` toggle (6.7/6.11) -
  **do NOT make this unconditional like `el.shareRow`'s toggle right above
  it.** `el.shareRow` is relevant in every mode this app has, so
  `el.shareRow.hidden = fullscreen` alone is correct. `el.controlShareRow`
  (the Training "link to control from another device" row, now with a QR
  code - 6.18) is normally hidden by default and only shown from inside
  `startTrainingSession()`'s non-control branch - copying the unconditional
  pattern here would incorrectly reveal it on exiting fullscreen from ANY
  mode, not just training. It must only be restored on exit when
  `currentSelection?.kind === "training" && !currentSelection?.control`.
  This was a real security-relevant bug (reported live): a wall tablet in
  fullscreen still showed a scannable QR code granting no-login control
  over the training session. See
  [ARCHITECTURE.md §6.7](ARCHITECTURE.md#67-kiosk-mode-fullscreen--wake-lock-behind-one-button).
- `updateHostLabel()` (6.21) reads `#host`'s own `<option>` text via
  `el.host.querySelector(...)` rather than a second hardcoded copy of the
  host display strings - if a host is ever added/renamed, only
  `index.html`'s `<option>`s and `server.js`'s `HOSTS` map need updating,
  not a third place. Don't hide `#hostLabel` in the `fullscreenchange`
  handler alongside `#shareRow`/`#controlShareRow` - unlike those, it's
  informational/troubleshooting text with no access-control concern, and
  deliberately stays visible in kiosk mode. See
  [ARCHITECTURE.md §6.21](ARCHITECTURE.md#621-host-label-next-to-the-status-line).

If a change requires touching one of these, update the corresponding
ARCHITECTURE.md section in the same change — don't let the doc drift from
the code.

## 2. Never guess results.info API field names — verify first

This has caused two real bugs already (`category_round_name` doesn't exist;
`round.routes` doesn't always exist). Before relying on any field not
already documented in
[ARCHITECTURE.md §4.4](ARCHITECTURE.md#44-response-shape--the-parts-that-matter-and-their-quirks),
fetch the real endpoint and read the actual JSON — don't infer from a
similar-looking endpoint or from memory of how it "should" work.

Quick verification pattern (works from a browser tab already on
`*.results.info`, avoids the Referer gate automatically):
```js
fetch('/api/v1/category_rounds/<id>/results').then(r => r.json()).then(console.log)
```
Or via `curl` with an explicit `Referer` header matching the host (see
[ARCHITECTURE.md §4.2](ARCHITECTURE.md#42-auth-the-referer-gate)).

## 3. Known live test fixtures

`dav-stage.results.info` has standing test events with real (fake-name)
athlete data — no need to hunt for a live competition to test against.

| Host | Event | Round ID | What it's good for |
|---|---|---|---|
| `stage` | 1593 "Bananacup Test Alex, Corinna & Jannik" | `13682` (LEAD U11 w Quali) | Default happy-path test: 2 routes, active, mixed pending/confirmed athletes |
| `stage` | 1593 | `13680` (LEAD U11 m Quali) | Second parallel round, for multi-tablet testing |
| `stage` | 1593 | `13678` (LEAD U15+ w Quali) | `status: "finished"` — completed-round rendering |
| `stage` | 1593 | e.g. `13679`, `13685` | `status: "pending"`, empty startlist — baseline not-started-round case |
| `stage` | 1593 | `13833` (BOULDER Herren+ Finale) | `format_identifier: "boulder_finals_ifsc_2026"`, real live-judged data (not the hand-edited `dav-stage` test event) — 8 finalists, 4 boulders, gap 4. The fixture that exposed the "candidate shown too close" bug in the not-yet-reached readiness check and verified its fix (6.17, "World Series" mode): at the point observed, Boulder 4's own candidate was still 3 heats out (Boulder 3 - the boulder immediately before it - had 3 more heats of its own queue to clear), reported live off this exact round. Also the round used to verify the toggle itself only appears for Boulder final rounds (not Qualification) and that already-reached boulders (Route 1 finished, Routes 2/3 with real climbers) render byte-identical regardless of which mode is selected. |
| `stage` | 1594 "Lead TTT Alex & Corinna" | `13709` (BOULDER Herren+ Quali) | `starting_groups` (Group A/B, 5 routes each), format `boulder_two_groups_ifsc_2026` — the Boulder-groups AND the rotation-format case. Real `route_start_positions` here confirmed the staggered per-boulder queue order (§5.6). **Caveat:** by now hand-edited across many separate test sessions/days (see each ascent's `modified` timestamp) — no longer represents a realistic single live rotation, don't trust it for "is the current climber plausible" checks; use a controlled mock (reset every route's ascents, then fill in only what a real fresh rotation would have) for that instead, the way §5.6's fix was actually verified. |
| `stage` | 1594 | `13719` (SPEED Herren+ Quali) | Speed qualification, routes `"A"`/`"B"` |
| `stage` | 1594 | `13689` (LEAD Herren+ Quali) | `status: "pending"` with 6 routes defined (no startlist published yet as of investigation) |
| `stage` | 1594 | `13739` (SPEED Herren+ Finale) | `speed_elimination_stages` — the K.O.-bracket case, live/active as of investigation with the "1/4" stage in progress |
| `stage` | 1594 | `13739` + `13741` (SPEED Herren+ / U15+ Männlich Finale) | Both live elimination rounds on the same event — used to verify paired sequence entries (6.12): the "Interleave two Speed finals" row, the "A ↔ B" single-row rendering, and the manual "Switch category now" override |
| `stage` | 1594 | `13742` + `13741` (SPEED U15+ Weiblich / Männlich Finale) | **The lockstep-skip bug, reproduced live.** At investigation time, Weiblich's 1/8 stage had real times entered but nothing yet confirmed, while Männlich's data had real times in *both* 1/8 and 1/4 already — exposed that letting each side report its own "current stage" independently lets a faster-progressing category skip ahead instead of waiting its turn. Also the source round for the stuck-heat watchdog fix (6.12): Weiblich's 1/8 heat 8 had one lane genuinely stuck at `"active"` with no path to `"confirmed"`. |
| `stage` | 1594 | `13719` (SPEED Herren+ Quali) | Also used to test Training mode's roster reuse (6.13) — finished round, real startlist/positions, safe to repeatedly step through without affecting anything live |
| `stage` | 1594 | `13739` (SPEED Herren+ Finale) | **The "not started" wildcard bug.** Heat #9 of stage "1/4": "Rutherford Ernest" has `dnf: false, dns: false, status: "confirmed", time_ms: null, formatted_ascent_score: "NOT STARTED"` (set via a distinct red dropdown button in results.info's admin UI, separate from the FALSE START checkbox) - a genuine no-show, not a false start. Opponent "Popper Karl" never got his own ascent touched at all. `heatIsDone()` originally only checked `dns`, so this heat never resolved. Also the fixture that proved `time_ms === null` alone isn't a safe "not started" signal: heat #11's wildcard-*winner* ("Fleming Alexander") also has `time_ms: null` but no `formatted_ascent_score` - only the score-text check correctly tells them apart. |
| `stage` | 1594 | `13748` (SPEED U 13 m Finale) | **The wildcard/false-start bug, reproduced on a full simulated competition (both U13 categories, interleaved, run through every stage to Final).** Heat #4 of stage "1/8": one lane `dns: true` (false start), the other lane (the wildcard winner, "Schrödinger Erwin") never got any ascent recorded at all - `time_ms: 0, status: "pending"`, no `dnf`/`dns` either. `heatIsDone()` originally required *both* lanes to have a result, so this heat never resolved and blocked all progress past it. Fixed by treating either lane's `dns` (only `dns`, not `dnf` - see the `heatIsDone()` bullet above) as instantly deciding the heat. results.info's own official standings table labels this outcome "WILDCARD" - useful search term if this round's data ever needs re-inspecting. |
| `stage` | 1594 | `13740` (SPEED Damen+ Finale) | **The `heatIsDone()` bug, reproduced on a plain single-round view (no pairing/interleaving involved).** After stage "1/8" was fully judged with real, complete times and explicitly closed in results.info's admin tool (with "1/4" heats already populated with real opponents), every single ascent in "1/8" still reported `status: "active"` - the board stayed stuck on 1/8's last heat instead of showing the real current stage "1/4". Proved this isn't a pairing-specific bug; the fix (checking `time_ms`/`dnf`/`dns` directly instead of `status`) lives in `computeSpeedElimination()`/`stageHeatsRemaining()` itself. (Earlier note for this fixture, now outdated: it used to be `status: "pending"` with no bracket at investigation time - kept as a reminder that this round's state moves on, re-check before reusing.) |
| `stage` | 1594 | `13711` (BOULDER U15+ Männlich Quali) | `format_identifier: "boulder_one_group_ifsc_2026_two_courses"` ("IFSC: 2 Courses 2026") — flat `routes[]` named `A1`/`A2`/`A3`/`B1`/`B2` (no `starting_groups`), where athletes split into two cohorts that start on Course A or Course B first, then swap to the other course partway through - `route_start_positions` already encodes this correctly (e.g. an athlete starting on Course A has low positions on A1-A3 and very high ones on B1-B2, and vice versa for the Course-B-first cohort). Verified live (mocked) that `computeBoulderLane()` (5.6) handles this with zero extra code, including the exact crossing-point moment when both cohorts are mid-swap - each boulder's queue naturally interleaves both cohorts in the right order since it's all driven by the same per-route position value, regardless of which "course" a boulder nominally belongs to. Also the fixture for the Course A/B tab switching (6.6) - `groupRoutesByCoursePrefix()` splits the flat `routes[]` by letter prefix, synthesizing "Course A"/"Course B" tab labels since there's no `starting_groups[].name` to read them from. |
| `stage` | 1594 | `13712` (BOULDER U15+ Weiblich Quali) | `format_identifier: "boulder_one_group_ifsc_2026"` ("IFSC: 1 group 2026") — flat `routes[]` (no `starting_groups`), i.e. the single-group sibling of `boulder_two_groups_ifsc_2026`. Verified live (mocked fill-up phase) that `computeBoulderLane()` handles it identically - the group-tabs code path never engages since `collectRouteGroups()` returns a single ungrouped set either way. |
| `stage` | 1594 | `13735` (BOULDER U11 w Finale) | `format_identifier: "boulder_finals_ifsc_2026"` ("IFSC: finals 2026 (points)") - a **parallel**, World Series-style Boulder final: for a given athlete, `route_start_positions` on boulder N+1 = position on boulder N **+ boulder count** (4 boulders here → +4 per move), so at most 2 boulders can be simultaneously "live" with different athletes. Verified live (mocked) two different boulders correctly showing two different athletes as `"climbing"` at once, and not-yet-reached boulders correctly staying empty. Also the fixture that exposed and then verified the fix for `boulderGroupFrontier()`'s "NEXT populates too early" bug (5.6) - heat-by-heat mock confirmed `NEXT` stays blank through the boulder's first 3 heats and populates on the 4th, one heat before it opens. See ARCHITECTURE.md §5.6. |
| `stage` | 1594 | `13736` (BOULDER U11 m Finale) | `format_identifier: "boulder_finals_one_by_one"` ("IFSC: Finals") - a **strictly sequential** Boulder final: for a given athlete, `route_start_positions` on boulder N+1 = position on boulder N **+ total finalist count** (8 finalists here → +8 per move), so boulder N+1 never starts until *every* finalist has gone through boulder N - only one boulder is ever "live", one athlete on it. Verified live (mocked) the full boulder-1→boulder-2 handoff, including boulder 1 correctly resolving to `finished: true`. **Before this was checked against real data, the assumption was that this format needs a different, single-shared-card UI - it doesn't; `computeBoulderLane()` already handles it via the exact same per-route queue mechanism, no new code.** See ARCHITECTURE.md §5.6. |
| `prod` | `2101` "KidsCup Hessen Bouldern + Lead Gießen" | — | Real `dav.results.info` event structure, all rounds pending as of investigation |
| `ifsc` | `1518` "World Climbing Asia Youth Series Quannan 2026" | — | Real `ifsc.results.info` event structure confirmation |
| `fasi` | `1203` "Campionato Italiano Para Climbing" | `24092` (LEAD B1 M Qualifica) | Confirmed `fasi.results.info` (Italy) runs the identical API/shape when this host was added - `d_cats[]`/`category_rounds[]`/`format_identifier` all matching byte-for-byte. |
| `usac` | `553` "Para Climbing: 2026 FA West Loop Local" | — | Confirmed `usac.results.info` (USA Climbing) identical shape when this host was added. |
| `saccas` | `995` "Bächli Bergsport Kids Climbing Cup 2026" | — | Confirmed `sac-cas.results.info` (Swiss Alpine Club) identical shape when this host was added. |
| `stage` | 1595 "Anleitung CallzoneManagement" | `13750` (LEAD Damen+ Quali) | **Two bugs reproduced here, at different times.** (1) Route with `"active"`/gap results at positions 4,5,6,7,9 but permanently-pending gaps at 1,2,3,8 (simulated no-shows) — correct "at the wall" is the position after the last confirmed one, not the first pending one. (2) Live-judging: Route 1 stayed `"active"` (never `"confirmed"`) for several athletes while Route 2's entries progressed to `"confirmed"` - proved `"active"` ≠ done, see Quirk C. This is the user's ongoing edge-case test round for this exact algorithm; keep checking it (or a fresh equivalent) whenever touching `findCurrentIndex()`/`computeLane()`. |
| `stage` | 1595 | `13782` (SPEED Damen+ Finale) | **The stage-advancement bug, reproduced.** `status: "under_appeal"`; stage "1/8" fully confirmed, stage "1/4" heat 9 already confirmed but heats 10-12 still pending — correct behavior is to show heat 10 as current, not get stuck on heat 9 or on stage "1/8". Also the source of the `"active"` ascent-status and `"under_appeal"` round-status values documented in Quirks C/D. |
| `stage` | 1595 | `13769`/`13770` (BOULDER Herren+/Damen+ Quali) | Active status, `starting_groups`, but zero results yet as of investigation — baseline "round started, nobody's climbed a given route yet" case. |
| `stage` | 1595 | `13785`/`13786` (BOULDER Herren+/Damen+ Finale) | `format_identifier: "boulder_finals_one_by_one"` — a Boulder finals format not seen elsewhere, but same `routes[]` shape as qualification, so no special-casing needed. `status: "pending"`, no startlist yet as of investigation. |

Event 1595 in particular is worth checking for fresh data on any future
Boulder/Speed bug report — it was purpose-built by the user as a test bed
for this app's edge cases, so it's likely to keep growing more scenarios
over time rather than being a one-off.

To simulate a state that doesn't currently exist live (e.g. a "pending round
with a published startlist", which no test fixture had at investigation
time), fetch a real active round's JSON, clone it, override the field you
need (e.g. `status: "pending"`), and call `renderBoard(mock)` directly in
the browser console — `app.js` is loaded as a plain script, so its
top-level functions are callable globals. Don't invent fixture data from
scratch; start from a real response so the shape stays accurate.

## 4. Verify in the actual browser before reporting a fix as done

Code review is not verification for this project. For every behavior change,
before saying it's fixed:
1. Start the local server (`preview_start` on the `callzone` launch config).
2. Load a real (or fixture, see §3) round that exercises the change.
3. Read the rendered output (`get_page_text` / screenshot), not just "no
   console errors" — confirm the actual displayed content is correct.
4. Do a quick regression check against an unrelated round to confirm nothing
   else broke.

## 5. Git and deployment

- **No global git identity is configured on this machine.** Don't run
  `git config --global ...` — that's an explicit user boundary (see the
  session's Git Safety Protocol). If a commit is needed and no identity is
  set, either ask the user to set it, or use an inline one-off override
  (`git -c user.name="..." -c user.email="..." commit ...`), which does not
  persist anything to `.git/config`.
- **This sandbox cannot `git push`.** There's no interactive terminal for
  GitHub auth here. Always hand the exact `git push` command back to the
  user to run in their own Terminal.
- **A `git push` alone does not update the live site.** Render's
  Auto-Deploy is not reliably active for this service. After any push,
  remind the user (or do it yourself if you have dashboard access) to go to
  the Render dashboard → the `callzone-management` service → **Manual
  Deploy → Deploy latest commit**. Full steps: [HOSTING.md §A](HOSTING.md).
- Only commit when the user explicitly asks, or as an established
  continuation of work they already approved this session — never commit
  proactively "to be safe".

## 6. Language conventions

- **The app's own UI** (`public/index.html`, all strings in
  `public/app.js`): **English only**, deliberately, no toggle — see
  [ARCHITECTURE.md §6.8](ARCHITECTURE.md#68-english-only-ui-no-language-switcher).
  Don't add German UI strings back, and don't build a language switcher
  without being asked — that was explicitly decided against.
- Maintenance documentation (`README.md`, `ANLEITUNG.md`, `HOSTING.md`) and
  git commit messages: **German** — this matches how the user communicates
  and who else might read these (other callzone volunteers). Note this is
  a *different* audience than the English app UI above (§6.8 explains why
  that split is intentional, not inconsistent).
- Code comments, `ARCHITECTURE.md`, this file, `CHANGELOG.md`: **English**.
- Don't mix within a file; match whichever convention that specific file
  already uses.
- Competition data itself (category/round names, athlete names) is
  pass-through from results.info and stays whatever language the organizer
  entered — never "translate" it.

## 7. Explicitly out of scope — don't build these without being asked

See [ARCHITECTURE.md §7](ARCHITECTURE.md#7-explicitly-out-of-scope-do-not-fix-without-asking)
for the full list and reasoning (a visual bracket tree, training-progress
persistence across server restarts, training mode inside a sequence, a
language switcher, auth, a real database, write access to results.info).
If a user report sounds like it needs one of these, say so and ask before
implementing rather than silently scoping it in.

## 8. Keeping docs in sync

Whenever you change behavior in `app.js` or `server.js`:
- Add a `CHANGELOG.md` entry (Unreleased section, mirror the existing entry
  style: what broke / what changed, one line, link to the relevant
  ARCHITECTURE.md section for the reasoning).
- If the change touches something ARCHITECTURE.md documents, update that
  section in the same pass — a stale architecture doc is worse than none,
  because it will be trusted.
