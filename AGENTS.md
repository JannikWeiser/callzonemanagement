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
- `STUCK_TIMEOUT_MS` / the 90s watchdog in `pollPairedTick()` — originally
  added to cover for a heat's `status` never reaching `"confirmed"`; that
  root cause is now fixed directly at the source (`heatIsDone()` above), so
  this watchdog is a narrower fallback now, for a heat that never gets any
  recorded result at all. Not arbitrary and not a bug waiting to be
  "cleaned up" into the core inference - still needed as a safety net,
  scoped only to the paired-entry category-switch decision. See
  [ARCHITECTURE.md §6.12](ARCHITECTURE.md#612-paired-sequence-entries-interleaving-speed-finals-between-categories).
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
| `stage` | 1594 "Lead TTT Alex & Corinna" | `13709` (BOULDER Herren+ Quali) | `starting_groups` (Group A/B, 5 routes each) — the Boulder-groups case |
| `stage` | 1594 | `13719` (SPEED Herren+ Quali) | Speed qualification, routes `"A"`/`"B"` |
| `stage` | 1594 | `13689` (LEAD Herren+ Quali) | `status: "pending"` with 6 routes defined (no startlist published yet as of investigation) |
| `stage` | 1594 | `13739` (SPEED Herren+ Finale) | `speed_elimination_stages` — the K.O.-bracket case, live/active as of investigation with the "1/4" stage in progress |
| `stage` | 1594 | `13739` + `13741` (SPEED Herren+ / U15+ Männlich Finale) | Both live elimination rounds on the same event — used to verify paired sequence entries (6.12): the "Interleave two Speed finals" row, the "A ↔ B" single-row rendering, and the manual "Switch category now" override |
| `stage` | 1594 | `13742` + `13741` (SPEED U15+ Weiblich / Männlich Finale) | **The lockstep-skip bug, reproduced live.** At investigation time, Weiblich's 1/8 stage had real times entered but nothing yet confirmed, while Männlich's data had real times in *both* 1/8 and 1/4 already — exposed that letting each side report its own "current stage" independently lets a faster-progressing category skip ahead instead of waiting its turn. Also the source round for the stuck-heat watchdog fix (6.12): Weiblich's 1/8 heat 8 had one lane genuinely stuck at `"active"` with no path to `"confirmed"`. |
| `stage` | 1594 | `13719` (SPEED Herren+ Quali) | Also used to test Training mode's roster reuse (6.13) — finished round, real startlist/positions, safe to repeatedly step through without affecting anything live |
| `stage` | 1594 | `13739` (SPEED Herren+ Finale) | **The "not started" wildcard bug.** Heat #9 of stage "1/4": "Rutherford Ernest" has `dnf: false, dns: false, status: "confirmed", time_ms: null, formatted_ascent_score: "NOT STARTED"` (set via a distinct red dropdown button in results.info's admin UI, separate from the FALSE START checkbox) - a genuine no-show, not a false start. Opponent "Popper Karl" never got his own ascent touched at all. `heatIsDone()` originally only checked `dns`, so this heat never resolved. Also the fixture that proved `time_ms === null` alone isn't a safe "not started" signal: heat #11's wildcard-*winner* ("Fleming Alexander") also has `time_ms: null` but no `formatted_ascent_score` - only the score-text check correctly tells them apart. |
| `stage` | 1594 | `13748` (SPEED U 13 m Finale) | **The wildcard/false-start bug, reproduced on a full simulated competition (both U13 categories, interleaved, run through every stage to Final).** Heat #4 of stage "1/8": one lane `dns: true` (false start), the other lane (the wildcard winner, "Schrödinger Erwin") never got any ascent recorded at all - `time_ms: 0, status: "pending"`, no `dnf`/`dns` either. `heatIsDone()` originally required *both* lanes to have a result, so this heat never resolved and blocked all progress past it. Fixed by treating either lane's `dns` (only `dns`, not `dnf` - see the `heatIsDone()` bullet above) as instantly deciding the heat. results.info's own official standings table labels this outcome "WILDCARD" - useful search term if this round's data ever needs re-inspecting. |
| `stage` | 1594 | `13740` (SPEED Damen+ Finale) | **The `heatIsDone()` bug, reproduced on a plain single-round view (no pairing/interleaving involved).** After stage "1/8" was fully judged with real, complete times and explicitly closed in results.info's admin tool (with "1/4" heats already populated with real opponents), every single ascent in "1/8" still reported `status: "active"` - the board stayed stuck on 1/8's last heat instead of showing the real current stage "1/4". Proved this isn't a pairing-specific bug; the fix (checking `time_ms`/`dnf`/`dns` directly instead of `status`) lives in `computeSpeedElimination()`/`stageHeatsRemaining()` itself. (Earlier note for this fixture, now outdated: it used to be `status: "pending"` with no bracket at investigation time - kept as a reminder that this round's state moves on, re-check before reusing.) |
| `prod` | `2101` "KidsCup Hessen Bouldern + Lead Gießen" | — | Real `dav.results.info` event structure, all rounds pending as of investigation |
| `ifsc` | `1518` "World Climbing Asia Youth Series Quannan 2026" | — | Real `ifsc.results.info` event structure confirmation |
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
