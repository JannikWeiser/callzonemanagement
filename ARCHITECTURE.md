# Architecture & Design Decisions — Callzone Management

Status: current as of the codebase in this repository. Written to be read by
humans and by AI coding assistants picking up this project later. Every
non-obvious decision below states *why*, not just *what*, so a future change
doesn't accidentally re-introduce a bug that was already fixed for a reason
that isn't visible in the diff alone.

If you are an AI assistant reading this before making a change: read
section 5 (core algorithm) and section 6 (design decisions) in full before
touching `public/app.js` or `server.js` — several things that look like bugs
at first glance are deliberate, and the reasoning is documented there.

---

## 1. What this is

A live "callzone" display for climbing competitions run on the
[results.info](https://dav.results.info) platform (DAV / IFSC). It shows,
per route/wall, who is currently climbing, who is next, and who is queued
after that — so isolation/callzone staff know who to send to the wall next.

Data comes from results.info's public JSON API, which this app polls every
3 seconds. There is no official API documentation; everything in section 4
was reverse-engineered from the live site (see method notes inline).

## 2. System overview

```
┌────────────┐   HTTP (poll every 3s)   ┌──────────────────┐   HTTPS + Referer header   ┌─────────────────┐
│  Browser   │ ───────────────────────► │  Node/Express     │ ──────────────────────────►│  results.info    │
│ (app.js)   │ ◄─────────────────────── │  server (server.js)│ ◄──────────────────────────│  public JSON API │
└────────────┘        JSON              └──────────────────┘          JSON                └─────────────────┘
```

The browser never talks to results.info directly — it can't, see 4.2. The
Node server is a thin proxy + short-TTL cache + static file host. It has no
database and no auth. The one exception to "no persistent state" is a tiny
in-memory counter for Training mode's manual position (6.13) — not backed
by results.info at all, and lost on restart, but real shared state
nonetheless; see 6.13 for why that's an acceptable exception to "stateless
proxy".

## 3. File map

| File | Responsibility |
|---|---|
| `server.js` | Express server: serves `public/`, proxies `/api/event/:host/:eventId` and `/api/round/:host/:roundId` to results.info with the required `Referer` header, short in-memory cache. Also `/api/training/:host/:roundId` (GET/POST), an unrelated tiny in-memory counter for Training mode's remote control (6.13) — not a results.info proxy. |
| `public/index.html` | Static shell: setup form (Event ID / server / round dropdown) and the board (lanes + share-link box). No inline JS. |
| `public/app.js` | All client logic: fetching, polling, the at-the-wall/next/queue algorithm, rendering, URL deep-linking, localStorage persistence. Plain script (no bundler, no framework, no modules — loaded via a single `<script src="app.js">`). |
| `public/styles.css` | All styling. Dark, high-contrast, large type for at-a-glance reading on a mounted tablet. CSS custom properties for colors. |
| `package.json` | `type: module` (server.js uses ESM `import`), single dependency: `express`. `engines.node >= 18` (native `fetch` requirement). |
| `render.yaml` | Render Blueprint: one free web service, `npm install` / `npm start`, pinned `NODE_VERSION`. |
| `.gitignore` | Excludes `node_modules/`, `.DS_Store`, `.claude/` (local tooling config, not part of the app), `*.log`. |

Documentation files: `README.md` (quick start), `ANLEITUNG.md` (non-technical
end-user guide, German), `HOSTING.md` (deployment pipeline), this file
(architecture/rationale).

## 4. The results.info API

Undocumented publicly. Reverse-engineered by inspecting network requests
made by the results.info web app itself (Chrome DevTools / browser
automation) and confirmed with `curl`. Treat everything below as "true as of
investigation date", not as a stable contract — results.info could change it
without notice.

### 4.1 Hosts

| Key used in this app | Host | Purpose |
|---|---|---|
| `prod` | `https://dav.results.info` | DAV (Deutscher Alpenverein) competitions |
| `ifsc` | `https://ifsc.results.info` | IFSC / World Cup competitions |
| `stage` | `https://dav-stage.results.info` | Staging/test environment, used for development |

All three run the identical API and identical auth mechanism (verified with
`curl` against each — see 4.2). Adding another `*.results.info` tenant is a
one-line change in `server.js`'s `HOSTS` map plus one `<option>` in
`index.html`.

### 4.2 Auth: the Referer gate

There is no API key and no login required to *read* competition data. But
every `/api/v1/...` request is rejected with `401 {"message":"Not
Authorized!"}` **unless** the request carries a `Referer` header matching
that exact host (e.g. `Referer: https://dav.results.info/` for the `prod`
host). CORS headers are wide open (`Access-Control-Allow-Origin: *`), so this
is not a CORS restriction — the server-side app logic explicitly checks the
`Referer` header, most likely as basic anti-hotlinking, not real security
(the data itself is fully public on the website).

Verified with:
```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Accept: application/json" \
  "https://dav-stage.results.info/api/v1/live"                                    # 401

curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Accept: application/json" -H "Referer: https://dav-stage.results.info/" \
  "https://dav-stage.results.info/api/v1/live"                                    # 200
```

**This is the entire reason a backend proxy exists at all** (see 6.1). A
pure static-file frontend (GitHub Pages, etc.) cannot set a custom `Referer`
on `fetch()` — browsers control that header — so it would always get 401.
`server.js`'s `refererFor(host)` sets it to the upstream host's own origin on
every outgoing request, which works because it's a server-to-server request,
not subject to browser Referer policy.

### 4.3 Endpoints this app uses

| Endpoint | Used for | Notes |
|---|---|---|
| `GET /api/v1/events/{eventId}` | Populating the round/category dropdown after "Event laden" | Returns event metadata plus `d_cats[]` (age-category × discipline), each with `category_rounds[]`. |
| `GET /api/v1/category_rounds/{categoryRoundId}/results` | The live poll (every 3s) once a round is selected | Returns the combined ranking + startlist + routes for one round. This is the endpoint `computeLane()` operates on. |

Other endpoints exist (`/api/v1/live`, `/api/v1/routes/{id}/startlist`,
`/api/v1/routes/{id}/results`, `/api/v1/starting_groups/{id}/results`,
per-athlete pages, etc.) but are not used — `category_rounds/{id}/results`
already returns everything needed (ranking + startlist + route list) in one
call, which is why it was chosen over combining the more granular endpoints.

### 4.4 Response shape — the parts that matter, and their quirks

This is the part most likely to bite a future change. Field names below are
exact.

**Event endpoint** (`/api/v1/events/{id}`): relevant field is `d_cats[]`,
each with `dcat_name` (e.g. `"BOULDER U13 m"`) and `category_rounds[]`, each
with `category_round_id`, `name` (e.g. `"Qualifikation"`, `"Finale"`), and
`status` (see below).

**Round endpoint** (`/api/v1/category_rounds/{id}/results`): top-level fields
actually used:

```jsonc
{
  "category": "U11 w",            // NOT "category_round_name" - that field does not exist
  "round": "Qualifikation",       // combine with "category" for a human title
  "discipline": "Lead",           // "Lead" | "Boulder" | "Speed"
  "status": "active",             // "pending" | "active" | "finished" — see 5.3
  "routes": [ /* … */ ],          // present for Lead/Speed and single-group Boulder rounds
  "starting_groups": [ /* … */ ], // present INSTEAD of "routes" for multi-group Boulder rounds — see below
  "ranking": [ /* … */ ],         // flat list, only athletes who have at least one route result yet
  "startlist": [ /* … */ ]        // flat list, ALL athletes, start order per route
}
```

**Quirk A — `routes` vs `starting_groups`.** Boulder qualification rounds
with a large field are often split into "Group A" / "Group B" climbing
separate boulders in parallel. For those rounds, the top-level `routes` key
is **absent entirely** (not an empty array — literally not present), and the
routes instead live nested under `starting_groups[].routes`, one sub-array
per group, each route additionally carrying `parent_name` (the group name).
`app.js`'s `collectRouteGroups(round)` normalizes both shapes into a common
`[{ groupName, routes }]` list so the rest of the rendering code doesn't
care which shape it got. **Do not assume `round.routes` always exists.**

**Quirk B — `ranking` only contains athletes who have started.** An athlete
with zero recorded results for the round is not in `ranking` at all (not
present with all-pending ascents — just absent). `computeLane()` treats
"absent from ranking" the same as an explicit `"pending"` ascent status via
`?? "pending"` — this is required, not optional.

**Quirk C — `ascents[].status` values seen, and what they actually mean:**
`"pending"` (not judged, not started), `"active"` (**a judge is live-scoring
this attempt right now — entered, but not yet confirmed**), `"confirmed"`
and `"locked"` (fully done, locked in). **Correction from an earlier
version of this doc:** `"active"` was previously assumed to mean the same
as `"confirmed"` (i.e. "already climbed"). That's wrong for the live-judging
workflow described by the user: a referee enters a result live while the
athlete is still on the wall (or just off it), which sets status `"active"`,
and only the explicit "Confirm" action moves it to `"confirmed"`. Until
confirmed, the athlete should still be treated as being at the wall — see
§5.2 for the corrected inference logic (`findCurrentIndex()`). There is no
separate `"in_progress"` status distinct from `"active"`.

**Quirk C.1 — results can be entered out of start-order, or never at all.**
An athlete's ascent can permanently stay `"pending"` (no-show, withdrawal,
an unresolved review) while athletes *after* them in start order already
have a confirmed result — judge/review workflows don't guarantee sequential
entry. See §5.2 for why the "at the wall" inference falls back to the
position *after the highest confirmed one*, not the *first not-pending*
one, when nobody currently has a live `"active"` entry.

**Quirk D — `round.status` values seen:** `"pending"`, `"active"`,
`"finished"`, and `"under_appeal"` (a round can apparently sit in this
state independently of whether its heats/ascents are done — observed on a
Speed elimination round with its 1/8 stage fully confirmed and its 1/4
stage in progress). Only `"pending"` is specifically checked by this app
(5.3); every other value is treated the same as `"active"` for rendering
purposes. `round.status` is a *round-level* field, not per-athlete and not
per-route — it's the only reliable signal for "has this round started at
all".

**Quirk E — `startlist[].route_start_positions[]`** gives each athlete's
start position *per route*, e.g. an athlete might be position 1 on Route "1"
and position 14 on Route "2". For Boulder-with-groups rounds, an athlete only
has `route_start_positions` entries for the routes belonging to their own
group — this is what makes filtering by `route.id` automatically correct
per group with no extra group-membership check needed.

**Quirk F — Speed elimination rounds are a completely different shape.**
Rounds with `format_identifier: "speed_elimination_ifsc_2026"` have **no**
`routes`, **no** `ranking`-with-`route_id`-ascents in the sense used
elsewhere, and instead expose `speed_elimination_stages[]`:

```jsonc
{
  "speed_elimination_stages": [
    {
      "stage_id": 0,
      "stage_name": "1/8",       // then "1/4", "1/2", "Small Final", "Final"
      "heats": [
        {
          "id": 18683,
          "number": 1,            // globally sequential across ALL stages (1..16 for a 16-athlete bracket)
          "athletes": [            // empty [] until this heat's pairing is known
            {
              "athlete_id": 9283, "name": "Mark Twain",  // NOTE: "Firstname Lastname", unlike ranking/startlist elsewhere ("LASTNAME Firstname")
              "firstname": "Mark", "lastname": "Twain",
              "bib": "208", "route_name": "A",           // which lane this athlete races in, for THIS heat
              "ascents": [ { "route_id": 22299, "status": "pending" /* | "confirmed" */, "time_ms": 11108, ... } ],
              "stage_result": { "winner": false, "qualified": false, "time": 11108, ... }
            }
          ]
        }
      ]
    }
  ]
}
```

Critically, **results.info computes bracket advancement itself**: as soon as
a stage is fully judged, the next stage's heats are populated with the real
winning athletes (`athletes.length` goes from `0` to `2`, ascent `status`
starts at `"pending"`). This app never computes "who advances" — it only
reads the bracket. See §5.6.

## 5. Core algorithm: "who's at the wall"

### 5.1 The problem

results.info has no single "currently climbing" flag. What it exposes, per
athlete per route, is an ascent status - `"pending"` (not judged),
`"active"` (a judge is live-scoring this attempt right now, not yet
confirmed), or `"confirmed"`/`"locked"` (fully done) - and that athlete's
fixed start position on the route (Quirk C).

### 5.2 The inference (`findCurrentIndex()` / `computeLane()` in `public/app.js`)

For one route (one physical wall/lane), walk the start order and combine two
signals:

1. **If anyone has a live (`"active"`) entry, the LATEST one in start order
   is at the wall** — *unless* it sits behind an already-confirmed frontier
   (see below). A judge can start live-scoring the next athlete before
   confirming the previous one's result, so if two athletes are
   simultaneously `"active"`, the later one in start order is the one
   actually on the wall right now.
2. **Otherwise, it's the position right after the last `"confirmed"`/`"locked"`
   entry** ("last confirmed + 1"). Anyone entirely absent from `ranking`
   (Quirk B) counts as not-confirmed here, same as an explicit `"pending"`
   status.

Concretely (`findCurrentIndex(items, isActive, isConfirmed)`): walk `ordered`
front to back once, remembering the index of the most recent item matching
each rule, then take **`Math.max(lastActive, lastConfirmed + 1)`** — not
just "prefer active whenever one exists". Then:

- `atWall = ordered[currentIndex]`, `onDeck = ordered[currentIndex + 1]`,
  `queue = ordered.slice(currentIndex + 2, currentIndex + 8)` (next 6).
- If `currentIndex >= ordered.length`, the whole route is done →
  `finished: true`, rendered as "Round finished" instead of the three cards.

**Why rule 2 is "last confirmed + 1" and not "first not-pending"** (a real
bug, fixed after a user report with reproduction data — see
`CHANGELOG.md`): results.info doesn't guarantee sequential result entry. An
athlete can stay `"pending"` forever - a no-show, a withdrawal, a review
that never gets finalized (Quirk C.1) - while athletes *after* them in
start order already have a confirmed result, e.g. positions 4-7 and 9
confirmed while 1-3 and 8 stay pending forever. "First not-pending" would
get permanently stuck showing position 1 as at the wall long after the
round had actually reached position 9. "Last confirmed + 1" instead tracks
the highest point of actual progress and correctly reports position 10 as
next up, silently leaving the permanently-pending gaps (1-3, 8) out of the
display entirely - the right behavior for a callzone tool, whose job is to
say who to send to the wall next, not to chase unresolved administrative
gaps.

**Why rule 1 exists at all, and takes priority over rule 2:** without it, an
athlete currently being live-scored (`"active"`, not yet `"confirmed"`)
would be indistinguishable from "hasn't climbed yet" under rule 2 alone,
and rule 2 would report the position *before* them as still at the wall -
one step behind reality. Checking for the latest `"active"` entry first
closes that gap directly from the live-judging signal, without waiting for
a confirm action that might lag behind the actual climb by anywhere from
seconds to minutes.

In the fully-normal case (no gaps, no live in-progress entries at poll
time) both rules reduce to the same thing as the original naive "first
pending" approach - this is a strict generalization, not a behavior change
for well-behaved data.

**Why `Math.max(lastActive, lastConfirmed + 1)` and not "active always
wins"** (a real bug, fixed after a live report — "Route 2 hängt" on an
IFSC event, reproduced as: a result gets edited *after* being confirmed —
a score correction — which briefly sets that athlete's ascent back to
`"active"` again while someone re-checks it. An earlier version of this
function let that `"active"` entry win outright, same as the normal
live-judging case, which yanked the display backward to the athlete being
corrected — even though athletes well after them in start order were
already confirmed, meaning real progress had moved on. `Math.max()` fixes
this without losing the normal case: if nothing further along is
confirmed yet, `lastConfirmed + 1` is behind (or equal to) `lastActive`, so
the active entry still wins exactly as before — this only changes the
outcome when a stray `"active"` sits *behind* an already-confirmed
frontier, which only happens for a post-hoc edit.

**This inference trusts a live `"active"` entry forever, deliberately, with
one narrow exception:** there's no timeout here, and none should be added -
an athlete can legitimately stay `"active"` for a long time (a slow climb,
a judging discussion) and cutting that off early would be worse than
waiting. The one place a timeout *does* exist is the paired sequence
entry's category-switch decision (6.12) - a materially different situation
(a stuck heat there blocks the whole callzone from moving on, not just one
card going stale), addressed with a narrowly-scoped watchdog rather than by
changing this core rule.

### 5.3 Why `round.status` is checked before the ascent-status walk

Naively applying 5.2 has a bug: **before the round has started at all**,
every athlete's status is `pending`, so `currentIndex` would resolve to `0`
and athlete #1 would be shown as "at the wall" — even though nobody has
climbed yet and they haven't been called up. Ascent status alone cannot
distinguish "nobody has started this route yet" from "athlete #1 is
mid-climb right now", because both look identical (first athlete, status
`pending`).

The fix: check `round.status === "pending"` first. If the round itself is
marked not-started, skip the ascent-status walk entirely and treat the whole
start order as not-yet-called: `atWall: null` (rendered as "—"), `onDeck:
ordered[0]` (the actual first starter), `queue: ordered.slice(1, 7)`. Once
`round.status` flips to `"active"` (which results.info does when the round
actually begins), the normal 5.2 logic takes back over.

This was a deliberate late addition (see git history) after a real report:
a round with a published start list but not yet started was showing athlete
#1 as already at the wall. **Do not remove the `round.status === "pending"`
branch** — reverting to pure ascent-status inference reintroduces that bug.

### 5.4 Queue numbering starts at 2

The rendered `<ol>` for the "upcoming" list uses `start="2"`
(`list.setAttribute("start", "2")` in `buildLane()` and again in
`renderSpeedElimination()`), not the HTML default of 1. Rationale: "next"
(onDeck) is conceptually queue position 1 — it has its own card above the
list. If the list below also started at 1, there would be two different
people (or heats) both visually labeled "1", which reads as contradictory.
Starting the list at 2 makes the numbers a continuous, unambiguous queue
position across both the onDeck card and the list. This applies uniformly,
including in the not-started-round case from 5.3 (there, `onDeck` is the
actual first starter, so the list correctly starts at the second starter).

### 5.5 Speed elimination: heat-based inference (`computeSpeedElimination()`)

Same underlying problem as 5.1 (no "currently running" field), same style of
fix, but at *heat* granularity instead of *athlete-position* granularity,
because Quirk F's data shape has no linear start order to walk.

1. Flatten `speed_elimination_stages[].heats[]` into one list, in stage
   order then heat `number` order (both already correctly ordered by the
   API — no re-sorting needed).
2. A heat is **ready** once it has 2 athletes (`athletes.length === 2`) —
   before that, results.info hasn't determined the pairing yet (still
   waiting on the previous stage).
3. A heat is **done** once it has a real recorded outcome — checked
   directly on the data (`heatIsDone()`), **not** via the ascent `status`
   field the way §5.2's qualification-round rule 2 does.
   `ascentIsAutoDecided()`/`ascentHasResult()` split `dnf` and `dns` apart
   deliberately — they behave differently under Speed climbing rules, not
   interchangeably:
   - **Either lane is `dns` (false start) OR explicitly marked "not
     started"** — either one auto-decides the whole heat: the other lane
     wins/advances as a "wildcard" *without ever getting their own ascent
     recorded at all*. Confirmed live: the wildcard-winning lane's ascent
     stays `time_ms: 0 (or null), status: "active"/"pending"` forever — no
     time, no `dnf`, no `dns` — and results.info's own official standings
     label that outcome "WILDCARD". Requiring *both* lanes to have a result
     (an earlier version of this function did) leaves a wildcard heat
     permanently stuck, since the winning lane's ascent never gets touched
     at all. "Not started" is a **third, separate outcome from `dnf`/`dns`
     entirely** — a no-show, not a false start — confirmed live: that
     ascent has `dnf: false, dns: false`, distinguishable only via
     `formatted_ascent_score === "NOT STARTED"`. `time_ms === null` alone
     is *not* a safe stand-in for this check: a completely untouched
     wildcard-*winner* ascent (the other lane in a `dns` case) can also
     have `time_ms: null` with no `formatted_ascent_score` at all, so
     checking the score text specifically is what avoids misfiring on that
     - confirmed live on the exact heat that exposed this (see the
     `13739` fixture in AGENTS.md §3).
   - **A `dnf` (fall) does NOT auto-decide the heat** — unlike a false
     start, a fall doesn't hand the other lane an automatic win; that lane
     still has to actually finish their own run and get a real recorded
     time (a first version of this fix treated `dnf` the same as `dns` and
     had this backwards — corrected after user feedback). A `dnf` ascent
     does still count as *that lane's own* result being settled (no more
     time is coming for them), so once the other lane finishes with a real
     time, the heat is done — just not before.
   - **Or both lanes have a real time** (`time_ms > 0`, neither `dnf` nor
     `dns`) — the normal case, both athletes actually climbed.
   Any of this is a deliberate divergence from 5.2's ascent-`status`
   approach, not an oversight: confirmed live against real results.info
   data (`git show` the fix commits for the reproductions) that a
   Speed-elimination heat can carry a complete, valid time for both lanes —
   with the stage explicitly closed in results.info's own admin tool — and
   still report ascent status `"active"` forever. Unlike qualification
   rounds, where `"active"` reliably resolves to `"confirmed"` (5.2), it
   apparently never does here. An earlier version of this function mirrored
   5.2 exactly (latest-`"active"`-wins, else last-`"confirmed"`-plus-one)
   and got permanently stuck on whichever heat was last touched, no matter
   how much real progress happened afterward. Reproduced on multiple rounds
   across three separate test sessions, not a one-off glitch.
4. Find `currentIndex` via `findCurrentHeatIndex(heats)`: the position
   right after the last **done** heat (scanning once, remembering the
   highest done index seen) — **not** "the first not-done heat". A heat
   that never gets a result at all (equipment failure, an unresolved
   dispute) should not permanently block heats after it from being
   recognized as current, the same "last-frontier, not first-gap"
   reasoning as §5.2's rule 2, just driven by recorded results instead of
   ascent status. Observed live on a real `under_appeal` round: stage
   "1/8" fully confirmed, stage "1/4" heat 9 already confirmed, heats 10-12
   still pending — "first not-done" would have stopped at heat 9 forever;
   the frontier approach correctly lands on heat 10.
5. If `currentIndex` is past the end of the flattened list, the whole
   bracket is done → `finished: true`, rendered as "Round finished".
   If `heats[currentIndex]` exists but isn't **ready** yet, results.info
   just hasn't populated the next stage yet (previous stage finished a
   moment ago) → a distinct "Waiting for the next stage…" message, not
   "Round finished". This is an expected, brief transition state, not an
   error.
6. Otherwise, `current = heats[currentIndex]` and its `stageName` (e.g.
   `"1/4"`) is the "current stage". **User-requested behavior (not just
   next-heat):** rather than only showing the single next heat,
   `computeSpeedElimination()` returns *every* heat from `currentIndex`
   onward whose `stageName` matches the current stage, in order — i.e. the
   full remaining heat sheet of the active round (e.g. all 4 quarterfinal
   heats in turn), not just a 1-ahead preview.

**Rendering (`renderSpeedElimination()`/`buildSpeedLane()` in
`public/app.js`) mirrors the qualification layout: one column per lane**
(`Lane A` / `Lane B`), each with its own at-the-wall/next/queue chain —
*not* a combined two-athlete "matchup" card. For each lane, `athleteForLane()`
picks that lane's athlete out of each heat in the current stage's heat
list, producing a plain ordered list of athletes exactly like
`computeLane()`'s `ordered` array for qualification routes, then reuses
`makeCard()` unchanged. A single `.group-heading`-styled "Stage: 1/4" label
sits above both lane columns (reusing the same CSS class as the Boulder
group headings, 6.6 — a stage name and a group name serve the same visual
role: a shared label for a row of lanes).

This replaced an earlier version that rendered one card per *heat* (both
lanes stacked in one card) — changed after user feedback that it didn't
match the rest of the app and was harder to scan than the familiar
per-lane column layout used everywhere else.

Detection: `renderBoard()` branches into this path whenever
`round.speed_elimination_stages` is a non-empty array, before falling back
to the qualification-style `collectRouteGroups()` path.

### 5.6 Boulder rotation formats: a per-route "not yet reached" guard (`computeBoulderLane()`)

**The physical format:** IFSC-style Boulder qualification (and some final
formats reusing the same shape — `format_identifier` values like
`boulder_two_groups_ifsc_2026`) rotates athletes through several boulders
in a staggered pipeline on a fixed timer (typically 4–5 minutes per
attempt): athlete 1 climbs boulder 1, rests one interval while athlete 2
starts boulder 1, then athlete 1 moves to boulder 2 while athlete 3 starts
boulder 1, and so on — each athlete visiting boulders 1, 2, 3, ... in
order, offset in time from everyone else. With two starting groups (6.6),
this runs identically and in parallel per group, each on its own block of
boulders — no special-casing needed there, it already works the same way
Lead's starting groups do.

**Confirmed across every qualification format_identifier variant seen so
far** — `boulder_two_groups_ifsc_2026` (nested `starting_groups`),
`boulder_one_group_ifsc_2026` (flat `routes[]`, single group), and
`boulder_one_group_ifsc_2026_two_courses` (flat `routes[]` named e.g.
`A1`/`A2`/`A3`/`B1`/`B2`, where athletes split into two cohorts starting on
Course A or B first and swap to the other partway through) — all render
correctly with zero extra code, `computeBoulderLane()` unchanged.
`route_start_positions` already encodes whichever physical shape the
rotation actually takes, including the two-courses swap: verified live
(mocked) at the exact crossing-point moment, where each boulder's queue
correctly interleaves both cohorts by position value alone, with no
awareness in the code of "courses" or "cohorts" as a concept at all — see
the `13711`/`13712` fixtures in AGENTS.md §3.

**Also confirmed for both Boulder final formats — again with zero extra
code, superseding an earlier (wrong) assumption.** Two final
`format_identifier`s were checked with real startlists:
`boulder_finals_ifsc_2026` and `boulder_finals_one_by_one`. Before seeing
real data, the working assumption was that a Boulder final needs a
different, single-shared-card rendering (only one athlete on the wall for
the whole final, unlike qualification's independent per-boulder lanes) —
that assumption turned out to be unnecessary. Both finals formats still
express themselves through the exact same `route_start_positions`
per-route-queue mechanism as qualification, just with different pacing,
readable directly off the position numbers:

- `boulder_finals_ifsc_2026`: for a given athlete, their position on
  boulder *N+1* is their position on boulder *N* plus the **boulder
  count** (e.g. 4 boulders → +4 per move). This means multiple boulders
  can be genuinely simultaneously "live" with different athletes on each
  — a parallel final, structurally identical in spirit to qualification's
  rotation. Verified live (mocked) that two boulders can correctly show
  two different athletes as `"climbing"` at the same time.
- `boulder_finals_one_by_one`: for a given athlete, their position on
  boulder *N+1* is their position on boulder *N* plus the **total number
  of finalists** (e.g. 8 finalists → +8 per move). This means boulder
  *N+1*'s positions never begin until *every* finalist has gone through
  boulder *N* — only one boulder is ever "live" at a time, and only one
  athlete on it, matching the "one by one" name. Verified live (mocked)
  the full boulder-1-to-boulder-2 handoff: boulder 1 correctly resolves to
  `finished: true` once everyone there is confirmed, boulder 2 correctly
  picks up with its own first athlete, boulders 3/4 correctly stay in the
  "not yet reached" state the whole time.

Either way, each boulder is still just an independent lane driven by its
own `route_start_positions`-ordered queue plus `computeBoulderLane()`'s
"has anyone started this route yet" guard — the gap size between an
athlete's own consecutive boulder positions is what encodes the pacing
difference, and the algorithm never needs to know or care what that gap
means. Matches the user's confirmed design choice: show all boulders as
separate cards, with only the one(s) actually in progress showing a real
climber. See the `13735`/`13736` fixtures in AGENTS.md §3.

**No interval/clock logic needed — confirmed via real data.** results.info
already encodes each boulder's correct, staggered arrival order directly:
`startlist[].route_start_positions` gives every athlete an independent
position *per boulder* (Quirk E), and — confirmed against a real
`boulder_two_groups_ifsc_2026` round — these values increment by roughly 2
per boulder for a given athlete (one climbing interval + one rest interval
per move), producing exactly the queue order the physical rotation
implies. `orderedAthletesForRoute()` (5.2) already sorts by this per-route
position, so each boulder can be treated as its own independent "lane"
with its own queue — same mechanism Lead already uses for its own routes,
no rotation-schedule math needed in this app at all. This also means the
app doesn't need to track wall-clock time or interval length — it reacts
purely to recorded results, so it self-corrects if the real pace deviates
from the nominal schedule (a delay, a dispute), consistent with the
"always re-derive from live data" property the rest of the app already
has.

**The gap this alone doesn't cover, and why (a real bug, found and fixed
during this rotation-format investigation, before it ever shipped —
reproduced with mocked data, not a live report):** `computeLane()`'s
`round.status === "pending"` guard (5.3) only catches "the round as a
whole hasn't started". For a staggered rotation, the round is already
`"active"` as soon as boulder 1 has climbers — but boulder 2 can go
completely untouched by anyone for several intervals after that, and
`round.status` can't tell the difference. Reproduced live with a mocked
fresh-start scenario (only boulder 1 has real progress, boulders 2–5
completely untouched): `computeLane()`'s ordinary "nobody active or
confirmed → position 0" fallback fired independently on *every* boulder,
each picking whoever is first in *that* boulder's own queue — including
the same athlete showing as `"climbing"` on two different boulders
simultaneously, and boulders 3/4/5 each showing a "current climber" who
hadn't actually started there at all.

**Fix, scoped to Boulder only:** `computeBoulderLane(round, route)` —
checks whether *anyone* in that route's own ordered queue has gone
`"active"` or been confirmed there yet. If nobody has, `atWall` stays
`null` (blank `CLIMBING`, exactly like a not-yet-started round) and
`queue` keeps the upcoming order visible in the waiting list below — but
`onDeck` (the prominent "NEXT" card) needs one more signal before it's
allowed to show a name: the candidate (the boulder's own first-in-queue
athlete) must be genuinely one rotation away from starting here, not
several rotations out. This took **five** iterations to land on, each
driven by live feedback, not a guess:

1. The *first* version filled `onDeck` with the boulder's first-in-queue
   athlete unconditionally (same as `queue[0]`) while `atWall` stayed
   blank — technically accurate, but reported live as misleading: reads as
   "you're up next" even when that athlete is several rotations away (the
   last boulder of a 5-boulder round showed its very first occupant as
   `"NEXT"` from the moment the round opened).
2. The *second* version blanked `onDeck` **and** emptied `queue`
   entirely — reported live as having gone too far the other way: staff
   want to see who's coming up overall, just without the false-urgency
   framing the `"NEXT"` card specifically carries.
3. The *third* version restored `queue` but left `onDeck` unconditionally
   blank — reported live as still missing something: an athlete who has
   *actually* just finished their previous boulder and is now resting,
   genuinely one rotation from starting here, should surface as `"NEXT"`
   rather than jump straight from "a name in the waiting list" to
   `"CLIMBING"` with no step in between.
4. The *fourth* version introduced a readiness check: the candidate must
   be confirmed on every OTHER route where their own position is lower
   than their position here (checked athlete-first, walking the
   candidate's own position-ordered ascent list — not by boulder name/order
   like "is boulder N−1 done", since the "2 Courses" format (6.6) has no
   single well-defined "previous boulder" to name for a course's first
   stop). Verified via a full rotation simulation (round `13712`,
   gap-of-2 pattern): boulder 4 shows `CLIMBING —`, `NEXT —` through heat
   5, `NEXT` populates at heat 6, `CLIMBING` follows at heat 7 — correct
   for this format, but reported live as **wrong for a World Series-style
   final** (gap = boulder count, at most 2 boulders live at once, see the
   "physical formats" note further down): a candidate who'd only ever
   climb ONE boulder before this one (the norm for that format) got
   confirmed on it almost immediately, well before the boulder they're
   headed to next has any real reason to be open yet — `"NEXT"` showed
   several heats too early, because this check only looked at the
   candidate's *own* prior obligations, not at whether the *route itself*
   had genuinely made room yet (other athletes still working through the
   current boulder's remaining capacity).
5. **Current version — `boulderGroupFrontier(round, route)`:** replaces
   the athlete-centric check with one based on real recorded progress.
   Confirmed against real `route_start_positions` data (fixtures `13712`,
   `13735`, `13709`/`13711` in AGENTS.md §3) that position values are a
   literal shared "heat slot" number *within one route group* — not a
   per-route-independent rank — so the same position value can appear on
   two different routes in the same group for two different athletes,
   meaning those two ascents genuinely happen at the same moment. This
   lets readiness be computed from the group's actual furthest-progressed
   position (the highest position with a real active/confirmed ascent,
   anywhere in the same group) instead of the candidate's own routes
   alone: the candidate is ready once that frontier reaches one position
   before their own position here. Scoped to the route's own group (via
   `collectRouteGroups()`, 6.6), not the whole round — confirmed against
   real data (fixture `13709`, `starting_groups`) that Group A and Group B
   each have their own independent position numbering starting at 1, not
   a shared round-wide clock; a round-wide frontier would let a
   faster-judged group's high position values falsely mark a slower
   group's candidate "ready" early. Re-verified round `13712`'s gap-of-2
   result is unchanged (`NEXT` at heat 6, `CLIMBING` at heat 7) and newly
   verified the World Series case is now correct (fixture `13735`, gap =
   boulder count): `NEXT` stays blank through heats 1–3, populates at heat
   4 — one heat before the boulder actually opens — and `CLIMBING` follows
   at heat 5. Also verified the group-scoping itself: with Course A (13711)
   fully confirmed and Course B completely untouched, Course B's routes
   still correctly show blank `CLIMBING`/`NEXT` — Course A's progress does
   not leak across the group boundary.

This also naturally subsumes `round.status === "pending"` (if the round
hasn't started, trivially nobody's touched any route either), so no
separate check for that is needed.

**Once the route has real activity, it no longer falls through to
`computeLane()` at all — Boulder has its own "already reached" frontier
rule, a fourth iteration on top of the three above.** This was originally a
straight `return computeLane(round, route);` (verified byte-identical to
calling it directly, for every already-progressed boulder in the hand-edited
test-stage data available at the time). Real, currently-being-judged data
(event `1593`, round `13840`, live on-site) showed that assumption doesn't
hold: `computeLane()`'s rule (5.2 — the athlete after the last *confirmed*
one is always shown as `"climbing"`) assumes the next athlete starts
climbing the instant the previous one is confirmed. For Boulder, confirmed
live judging shows a real gap — an ascent goes `pending` → `active` (the
judge genuinely starts recording a try — a try-counter increment with an
updated timestamp; simply navigating to the athlete's screen does **not**
trigger this) → `confirmed` (Edit/save, instantaneous, no separate
"advanced to next athlete" signal exists in the API at all). For however
long the next athlete hasn't started a try yet, `computeLane()` would show
them as `"climbing"` before they've done anything — reported live as wrong:
the *previous* (last confirmed) athlete should keep showing as `"climbing"`
until the *next* one is genuinely `"active"`, not the instant they're
next in line. `"NEXT"` already correctly names who that will be, one
position ahead, via the existing `onDeck` field.

`computeBoulderLane()` now computes this frontier itself instead of
delegating: track `lastActive` and `lastConfirmed` indices in the route's
own ordered queue. If some entry is `"active"` **and** sits after the last
confirmed one, that's the new frontier (`atWall`) — normal forward
progress. If nothing is active, the frontier sticks at `lastConfirmed`
(the previous athlete keeps showing) unless that's the very last athlete in
the queue, in which case the route is genuinely `finished`. The "after the
last confirmed one" condition is deliberate — the exact same post-hoc-edit
protection `findCurrentIndex()` already has for Lead (5.2, `Math.max(lastActive,
lastConfirmed + 1)`): a judge reopening an *earlier* athlete's score to
correct it (setting their ascent back to `"active"`) must not pull the
display backward past someone already confirmed further along. Verified
live and via a controlled mocked simulation (round `13712`, real athlete
IDs, real `route_start_positions` order) against all three cases: sticks on
the previous athlete until the next genuinely goes active; a reopened
earlier entry does not pull the frontier backward; the last athlete
confirmed with nobody active after them correctly resolves to `"Round
finished"`. Also re-verified against real live data on event `1593`,
matching the same behavior end-to-end (LORENTZ Hendrik stayed `"climbing"`
on boulder 2 until MELVILLE Herman's ascent genuinely went `"active"`, at
which point the display correctly flipped).

`buildLane()` dispatches on `round.discipline === "Boulder"` — a
discipline check, not a format-identifier check, so it covers qualification,
the two-group format, and any future Boulder final format reusing the same
`routes`/`starting_groups` shape, while leaving Lead and Speed
qualification (which share the exact same `buildLane()`/`computeLane()`
call path) **provably untouched**: verified live that `computeBoulderLane()`
is never even invoked when rendering a Lead or Speed-qualification round.
This was a deliberate constraint, not an afterthought — Lead and Speed
were explicitly frozen ("fertig, dürfen nicht mehr verändert werden")
before this investigation started, so the fix could not risk touching
`computeLane()` itself, even though the same guard would arguably also be
a correct generalization for Lead's own routes (e.g. a hypothetical
offset-start multi-route Lead format). That's deliberately out of scope
here — revisit only if Lead is explicitly reopened.

**Resolved — confirmed against a real, currently-live-judged Boulder
round (event `1593`, round `13840`, on-site judging, not the hand-edited
`dav-stage` test data):** Boulder ascent `status` reliably reaches
`"confirmed"` the same way Lead's does — no Speed-elimination-style
stuck state (5.5) observed. The real transition sequence is `pending` →
`active` → `confirmed`, and specifically: `"active"` is set only by a
genuine try-counter increment (the judge actually starts recording a try),
**not** by the judge merely navigating to that athlete's screen — confirmed
by live step-by-step testing (navigate only → no change; start a try →
`status: "active"` with `top_tries` incremented and an updated timestamp).
There is no separate API signal for "judge moved to the next athlete" —
`"confirmed"` happens the instant Edit/save is pressed. This directly
informed the sticky-frontier "already reached" logic above.

**Open questions — not yet verified, worth re-checking against a real live
event before fully trusting this for a real competition:**
- **`boulder_finals_one_by_one`'s actual ascent field shape is unverified
  against real populated data.** Unlike every other format checked here,
  this one round had no `points_per_boulder_settings` in its round-level
  data at all, suggesting a different (non-points) scoring mechanism - but
  every test against it used a hand-built mock `ranking` array with
  `status`/`top`/`zone`/`points` fields copied from the other formats,
  never a real ascent object actually returned by results.info for this
  specific format. Re-verify field names/shape the first time this format
  has real recorded results (per AGENTS.md §2 - never trust an assumed
  shape over real data).
- **Sequence mode's auto-advance has not been live-tested with a Boulder
  round in the list.** `isRoundFullyFinished()` still calls plain
  `computeLane()` directly rather than `computeBoulderLane()` - reasoned to
  be safe (in every code path `computeBoulderLane()`'s `finished` value is
  identical to what `computeLane()` alone already returns, so the two are
  provably interchangeable for this one field), but that reasoning has not
  been exercised end-to-end via an actual Sequence-mode run with a Boulder
  entry in it.

## 6. Design decisions

### 6.1 Local Node server instead of a static frontend

**Decision:** a small Express server proxies results.info, rather than the
browser calling results.info directly from a static site (GitHub Pages,
etc.).

**Why:** the Referer gate (4.2) makes a pure static frontend impossible —
browsers won't let JS set an arbitrary `Referer`, so every request from a
statically-hosted page would get 401. A server-side proxy that sets the
correct `Referer` per outgoing request is the only way around this without
depending on results.info changing their access policy.

### 6.2 Server-side caching (20s events / 3s rounds), capped at 200 entries

**Why cache at all:** multiple devices (laptop + several tablets, each
possibly polling a different round) hit this server independently. Without
a shared cache, N tablets polling every 3s would each independently hit
results.info every 3s — this server's cache means results.info only sees
one upstream request per unique event/round per TTL window, regardless of
how many tablets are watching.

**Why 20s for events vs 3s for rounds:** event/round *structure* (which
categories exist, round names) changes rarely — 20s staleness there is
invisible to users. Live results need to feel real-time for a callzone
display, so rounds get a much shorter TTL, chosen to match the client's own
3s poll interval (no point caching shorter than clients poll).

**Why capped at 200 entries:** the server is designed to be left running
across a full competition day (or, in the hosted case, indefinitely). Without
a cap, the in-memory `Map` would grow by one entry per unique event/round ID
ever queried, unbounded. 200 is comfortably above what a single competition
day across several tablets would touch; oldest entries are evicted first
(`Map` preserves insertion order).

### 6.3 Vanilla JS, no framework, no build step

**Why:** the app is small (one screen, a handful of DOM updates driven by
polling). A framework or bundler would add a build step, which adds friction
for a project meant to be run with nothing but `npm install && npm start`,
and adds nothing this app's complexity actually needs. `public/app.js` is
loaded directly via `<script src="app.js">` (not `type="module"`), so all
its top-level `function` declarations are plain globals — this was
deliberately relied on for debugging (functions like `renderBoard` and
`computeLane` are callable directly from the browser console/devtools
without any build tooling).

### 6.4 URL query params + localStorage, in that precedence order

**Problem this solves:** multiple tablets, each meant to always show one
fixed category (and, for Boulder, one fixed starting group — see 6.6),
without re-selecting it from a dropdown after every reload (power loss,
Safari tab reload, etc.).

**Decision:** on load, `readUrlSelection()` (URL `?host=&event=&round=&group=`)
takes precedence over `loadSelection()` (last manually-picked selection,
`localStorage`). A "Link for this tablet" box on the board shows the exact
URL for the currently-watched round (and group, if applicable), meant to be
bookmarked/added to the home screen on that specific tablet.

**Why this order and not the reverse:** URL params represent an explicit,
durable assignment ("this physical tablet always shows Boulder U11 Group A")
that should survive even if someone else used that same browser to look at
a different round manually in between — a bookmark should be trustworthy.
localStorage alone would get silently overwritten by the last manual
selection on that device, which defeats the "each tablet has its permanent
category" use case this feature exists for.

### 6.5 Naming: "Route" (or "Lane" for Speed), not "Wand"/"Bahn"

Earlier revision used German "Wand 1" / "Wand 2" as the per-lane label.
Changed to "Route 1" / "Route 2" after user feedback — "Wand" (wall) is
ambiguous when a single physical wall hosts multiple named routes, whereas
the athlete currently climbing is still described as being "at the wall" in
the card label, which is a different, correct use of the word (a
description of the athlete's location, not a lane identifier). Speed lanes
use the term "Lane" (was "Bahn" before the English-only pass, 6.8), the
climbing-specific term for side-by-side speed lanes.

### 6.6 Boulder starting-group tabs, default to one group at a time

**Problem:** a Boulder round split into starting groups (Quirk A) renders
one `.lanes-grid` per group — for a 2-group × 5-boulder round that's 10
lane tiles at once, which doesn't fit a tablet screen without heavy
scrolling, defeating the "glance at it" purpose of a callzone board.

**Decision:** when a round has ≥2 named groups, `renderBoard()` shows a
row of tab buttons (one per group name, taken verbatim from
`starting_groups[].name` — already "Group A"/"Group B" from the API, no
translation needed) and renders **only** the selected group's lanes.
Default is the first group unless the URL/saved selection already names a
valid group for this round. Switching tabs re-renders instantly from
`lastRoundData` (the last poll response, cached in a module-level variable)
rather than waiting for the next 3s poll, and updates both the saved
selection and the share-link box — so mid-session switching immediately
becomes the new bookmarkable state.

**Why tabs instead of always showing both:** the two groups climb in
parallel in reality, so hiding one isn't a data-completeness compromise —
it's a per-tablet display choice, consistent with 6.4's "one tablet, one
thing to watch" model. A tablet physically stationed at Group A's boulders
doesn't need Group B's lanes taking up its screen; the tab (or a
group-scoped bookmark link) lets it show only what's relevant to it, while
a different tablet can be scoped to Group B.

**Extended to Boulder's "2 Courses" format, which has no
`starting_groups` at all to read a group name from.** Requested by the
user once the format was confirmed working (5.6) but noted as missing
this exact tab behavior. `format_identifier:
"boulder_one_group_ifsc_2026_two_courses"` puts its course split entirely
in route *naming* (`A1`/`A2`/`A3`/`B1`/`B2`, no `starting_groups`
wrapper) — `groupRoutesByCoursePrefix()` detects this structurally (every
route name is a letter prefix plus digits, at least two distinct
prefixes) rather than hardcoding that one format_identifier string, so a
future "3 courses" variant using the same naming convention would pick
this up automatically too. Synthesizes the tab label itself as
`"Course A"`/`"Course B"` (from the letter prefix, English to match the
rest of the UI, 6.8) since results.info supplies no group name for this
shape the way `starting_groups[].name` already does for the nested case.
Scoped to `round.discipline === "Boulder"` inside `collectRouteGroups()`
— Lead and Speed qualification share that exact function and must stay
unaffected (frozen); verified live that neither's route naming
(plain numbers for Lead, single letters with no digit suffix for Speed)
would even match the detection pattern regardless, but the discipline
check is the actual guarantee, not incidental naming luck. Everything
downstream (tab rendering, `currentSelection.group` persistence, the
`&group=` share-link param) needed zero changes — it already only cared
about *how many* named groups came back from `collectRouteGroups()`, not
where the names came from.

### 6.7 Kiosk mode: Fullscreen + Wake Lock behind one button

**Problem:** the whole point of this app is to run unattended on a tablet
mounted at the venue — but by default, Safari shows its chrome (address
bar, tab strip) and iPadOS will dim/lock the screen after a few minutes of
no touch input, both undesirable for a wall-mounted display.

**Decision:** one "Fullscreen + Always On" button (`el.kioskBtn`) triggers
both browser APIs together, since they're always wanted together for this
use case: `document.documentElement.requestFullscreen()` and
`navigator.wakeLock.request("screen")`. Both are wrapped in `try`/`catch`
independently — a browser without Wake Lock support (or a fullscreen
request denied for some reason) should still get the other one rather than
the whole action silently failing.

**Wake Lock re-acquisition — two separate triggers, not one:**

1. Per spec, the Screen Wake Lock is automatically released when the tab is
   backgrounded (`visibilitychange` to `"hidden"`) — e.g. if the tablet's
   screen was manually turned off and back on. A `visibilitychange`
   listener re-requests the lock once the page is visible again, but only
   while still in fullscreen (treated as a proxy for "still in kiosk mode"
   — exiting fullscreen also drops the wake lock via the `fullscreenchange`
   listener, so both stay in sync through one user action).
2. **The sentinel's own `"release"` event** (a real bug, fixed after a live
   report: on an iPad running in Safari Private Browsing, Always On stopped
   holding the screen awake after about 10 minutes — while the tab stayed
   visible and fullscreen the whole time, which the `visibilitychange`
   listener above never covers, since the tab was never backgrounded).
   Private Browsing is known to apply stricter background/power policies
   than a normal tab, so the browser can revoke the lock silently, for
   reasons outside this app's control. The spec-correct way to catch that
   is listening for the sentinel's own `"release"` event, which fires
   whenever the lock is let go for *any* reason, not just an explicit
   `release()` call — `requestWakeLock()` does this and immediately
   re-requests, guarded by the same "still visible and fullscreen" check
   (so a deliberate exit, which releases the lock on purpose, doesn't
   trigger an unwanted re-acquire loop — verified live with a mocked
   sentinel: releasing while still fullscreen re-requests, releasing after
   fullscreen has already been exited does not). This is best-effort — if
   the browser keeps revoking it (a hard policy Private Browsing enforces
   that a page genuinely cannot override), each release triggers one more
   retry rather than a tight loop, since the event only fires once per
   acquisition. **Private Browsing itself is not something this app can
   detect or work around further** — if retries alone don't hold up over a
   full competition day, the recommendation is to not run the kiosk tablet
   in Private/Incognito mode at all, not a code fix.

**Also hides the share-link row while in fullscreen:** the `fullscreenchange`
listener additionally toggles `el.shareRow.hidden`. Rationale: the "Link for
this tablet" box (6.4) is only useful *before* mounting a tablet, to set up
its bookmark — once running unattended at the venue, a visible, selectable
URL is pure clutter (and arguably not something you want casually copyable
off a public-facing screen). Tied to `fullscreenchange` rather than the
button's own click handler so it also reacts correctly if fullscreen is
exited some other way (Esc key, swipe-down on iPadOS), not just via the
kiosk button.

**Known constraint:** the Screen Wake Lock API requires iPadOS/Safari 16.4+;
older iPads will get fullscreen but not the always-on behavior. Not
detected/warned about explicitly — the button just won't keep the screen
awake on those devices. Verify on the actual hardware being used before
relying on it for a competition day.

### 6.8 English-only UI, no language switcher

**Decision:** every app-owned UI string (buttons, labels, error messages —
`public/index.html` and the strings in `public/app.js`) is English, full
stop — no `{de: …, en: …}` dictionary, no language toggle. This was an
explicit user choice, not a default: an earlier version had German UI text,
and it was replaced outright rather than made switchable, because this app
is also used at international (IFSC) events where English is the shared
language and a German-speaking operator can read English UI chrome fine
either way — the reverse (non-German-speaking staff facing German buttons)
was the actual problem being solved.

**What stays non-English:** competition data itself (category/round/athlete
names, e.g. `round.category`/`round.round` — see 4.4) is pass-through from
results.info and reflects whatever language the organizer entered it in;
the app does not and cannot translate that. Maintenance documentation
(`README.md`, `ANLEITUNG.md`, `HOSTING.md`) intentionally stays German —
see `AGENTS.md` §6 for the full convention — because that audience (the
person running the app) is different from the audience of the on-screen UI
(international athletes/officials at the venue).

### 6.9 "Climbing" instead of "at the wall" as the card label

The at-the-wall card's label text was changed from "at the wall" to
"climbing" per user preference (shorter, reads better at a glance). Purely
a label string change (`makeCard("climbing", …)` in `buildLane()` and
`buildSpeedLane()`) — the CSS class stays `card--at-wall` and the internal
field name stays `atWall` throughout the code, since renaming those would
be pure churn with no user-visible benefit. Prose in this document and code
comments may still say "at the wall" when describing the *concept* rather
than quoting the UI label.

### 6.10 Sequence mode: an ordered playlist of rounds, auto-advancing

**Problem this solves:** a tablet at the Speed wall, say, needs to show
Qualification Men, then Qualification Women, then Final Men, then Final
Women, in order, over the course of an event — without someone manually
clicking "switch round" every time one class wraps up.

**Decision:** the setup screen's "Sequence" mode (6.11) offers "+ Add to
sequence" next to the round dropdown, appending the currently-selected round
to a reorderable list (native HTML5 drag-and-drop, no library); "Show
sequence" starts watching the whole ordered list. Internally,
`currentSelection.sequence` is *always* an array — a single "Show" click
(Single round mode) is just an array of length 1 — so there's one code path
for both, not two parallel ones. Each entry is `{ type: "round", id }` or
`{ type: "paired", a, b }` (6.12); this section covers the `"round"` case,
which behaves exactly as originally built.

**Auto-advance mechanism (`pollCurrent()`):** each poll checks
`isRoundFullyFinished()` on the round currently being shown (every
lane/group/heat done, not just the one visible group tab happens to be
on). If finished and the sequence has a next entry, it fetches and renders
that next round **immediately**, in a loop, rather than waiting for the
next 3s timer tick — so a tablet that reloads mid-event (or loads a
sequence where the first few rounds already finished before it was even
opened) catches up through all of them in one go and lands on the actually
current class right away, instead of idling ~3s per already-finished round.
Trade-off accepted: a round that finishes *while being actively watched*
switches away immediately too, with no pause to let viewers see the final
state — simpler to implement correctly than a "was this round watched
before it finished vs. already-finished on load" distinction, and revisit
only if the abruptness turns out to matter in practice.

**Why `sequenceIndex` isn't persisted, only `sequence` is:** the share
link/`localStorage` capture the *configured sequence* (`?rounds=id1,id2,id3`,
back-compat `?round=id` for a single round — see `readUrlSelection()`), not
which entry is currently showing. On every load, `sequenceIndex` restarts
at 0 and the catch-up behavior above immediately fast-forwards to the right
entry. This avoids a second piece of persisted state that could drift out
of sync with reality (e.g. a round finishing between sessions) — the
catch-up logic is the single source of truth for "where are we in the
sequence" and re-derives it from live data every time, rather than trusting
a stored index that could be stale.

**Why round-level finished-ness ignores the selected group tab:** a Boulder
round with Group A/B (6.6) isn't "done" for sequence-advancement purposes
just because whichever group tab a given tablet happens to have selected
finished first — `isRoundFullyFinished()` deliberately checks every group's
every route via `collectRouteGroups()`, independent of `currentSelection.group`.

### 6.11 Setup-screen modes instead of independent checkboxes

**Problem this solves:** the setup screen grew several optional behaviors
over time (sequence-building, training, interleaving) and an early version
exposed them as a scatter of checkboxes next to the round dropdown ("Match
finals", "Training mode"). Live-tested and reported back as "semigut" —
workable, but genuinely confusing which checkbox went with which dropdown,
especially under the time pressure of running a callzone.

**Decision:** a `#modeTabs` row (`setMode()` in `public/app.js`) replaces
the checkboxes with three mutually-exclusive, explicit modes: **Single
round**, **Sequence**, **Training**. Each mode shows only the controls that
apply to it (`el.watchRound` / `el.addToSequence` / `el.startTraining`,
`#pairedRow` only in Sequence mode with 2+ elimination rounds available,
`#sequenceRow` only in Sequence mode). Nothing is inferred from a
checkbox's state; the visible controls *are* the current mode.

### 6.12 Paired sequence entries (interleaving Speed finals between categories)

**Problem this solves:** a Speed event schedule commonly doesn't run one
category's whole final bracket before starting the next — it interleaves
by *stage* across categories to keep a single wall busy efficiently, e.g.
Round-of-16 for categories 1 and 2, then Quarterfinals for 1 and 2, ...,
finish both brackets, *then* Qualification for categories 3 and 4, then
their Round-of-16/Quarterfinals/... interleaved the same way.

**Decision — a first-class entry type, not a checkbox:** a sequence entry
can be `{ type: "paired", a, b }` — two elimination-format round IDs —
instead of `{ type: "round", id }`. Built via the "Interleave two Speed
finals" row (`#pairedRow`, only shown in Sequence mode when the loaded
event has 2+ elimination rounds, i.e. `round.format_identifier ===
"speed_elimination_ifsc_2026"`), picking round A and round B and clicking
"+ Add paired entry". It appears as **one row** in the sequence list
("A ↔ B"), draggable/removable exactly like a plain entry — not ten
near-identical rows. This replaced an earlier per-entry "next stage only"
checkbox design (requiring the *same* round to be added many times, once
per stage-switch) that live-tested as "sehr aufwendig" (very tedious), and
a second design (a dedicated two-dropdown "Match finals" shortcut bolted
onto the round dropdown) that turned out confusing for the same reason as
6.11.

**Playback — a shared stage cursor, not two independently-reported sides
(`pollPairedTick()`):** an earlier version let each side report "my current
stage" from its own live data via `computeSpeedElimination()` and just
switched whenever the active one ran dry. Live-tested and found broken:
with two categories' data entered at different paces (confirmed against a
real event where side B already had recorded times in "1/4" while side A
hadn't started "1/4" at all), that approach let the faster side race ahead
instead of waiting its turn — the requested order (1/8 A, 1/8 B, 1/4 A,
1/4 B, ...) only holds if both sides are kept on the *same named stage* in
lockstep.

The fix: a shared stage, common to both sides — but computed **fresh on
every tick** (`earlierStageName(currentStageNameFor(dataA),
currentStageNameFor(dataB))`), not persisted and only-ever-advanced.
`currentStageNameFor(round)` runs the same "last done heat, mapped to its
stage" logic as `computeSpeedElimination()` (5.5), returning the stage
*name* (e.g. `"1/4"`); `earlierStageName()` picks whichever of the two
names sits first in the canonical `SPEED_STAGE_ORDER` list
(`["1/32", "1/16", "1/8", "1/4", "1/2", "Small Final", "Final"]`, via
`stageNameRank()`), which is what enforces the lockstep — whichever side is
behind caps the shared stage, so the ahead side can never drag the display
forward on its own.

**Why by name, not by raw array index (a real bug, fixed after review, no
live report):** an earlier version compared `Math.min()` of each side's
*index* into its own `round.speed_elimination_stages` array. That's only
safe if both sides' arrays have the same stage set at the same offsets — not
guaranteed, since a smaller bracket can start directly at a later stage
(e.g. "1/4" with no "1/8"/"1/16"/"1/32" stage at all, `stages[0]` would be
"1/4" for that side but `stages[0]` might be "1/8" for the other). Comparing
raw indices in that situation would silently line up two *different* real
stages under the same index and produce a nonsensical shared stage. Matching
on the stage's own name instead of its array position is index-shape-
independent, so it's correct regardless of how deep either side's bracket
is. Verified live: mocked one side's bracket with its "1/8" stage removed
entirely (so its "1/4" sits at index 0, while the other side's "1/4" sits at
index 1 in a full 5-stage array) — `earlierStageName()` correctly resolves
both to `"1/4"`, where the old index-based `Math.min()` would have picked
index 0, i.e. the shorter side's "1/4" versus the full side's "1/8".

**A round that hasn't started at all yet must not anchor the shared
stage** (a real bug, fixed after a live report — "wechselt nicht automatisch,
wenn eine Runde noch nicht gestartet ist, z. B. wartet auf 1/2 finals"):
`currentStageNameFor(round)` returns `null` immediately if
`round.status === "pending"`, before even looking at
`speed_elimination_stages`. Without this check, a round that's waiting on
some earlier upstream stage to determine its own finalists (its bracket
skeleton pre-generated with `athletes: []`, or simply not started yet) would
still report its first stage's name — a non-null value that then
participates in the *real* `earlierStageName()` name comparison on equal
footing with the other, genuinely progressing side. If that not-started
side's (phantom) stage happened to rank *earlier* than the other side's real
progress, the shared stage got pinned there, and `stageHeatsRemaining()`
found nothing for **either** side at that stage (the not-started side
because it's not ready, the progressing side because it had already moved
past it) — the display then ping-ponged between two empty "Waiting for the
next stage…" screens every poll tick instead of ever showing the side that
actually had something to display. Returning `null` for a pending round
defers unconditionally to the other side's real stage (same as the
already-empty-`speed_elimination_stages` case just below it), so a
not-started side never blocks the other from being shown. The manual
"⇄ Switch category now" button (below) is unaffected and still available if
staff want to force a look at the not-started side anyway.

`stageHeatsRemaining(round, stageName)` — a scoped variant of the same
heat-selection rule, applied to *one* named stage instead of scanning
across all of them — then answers "does this side have anything left at
this specific stage" for each side independently. Both rounds are fetched
every tick regardless (cheap — the server's 3s cache means this rarely
reaches results.info twice); if the side currently shown has nothing left
at the shared stage, the turn passes to the other side at the *same*
stage; `pairedState` only still needs to persist `activeSide` (which of the
two co-equal sides to display — there's no data signal for "whose turn it
is", so that genuinely has to be remembered).

**Why fresh-every-tick instead of persisted, and not just "advance
forward":** a persisted, forward-only cursor can't handle a judge reopening
and correcting an earlier stage (deleting a result, re-entering it after a
false-start review is overturned, say) — the cursor would stay stuck ahead
of where the corrected data now actually says the bracket is, and the app
has no way back short of a manual override. Recomputing both sides' own
current-stage index from scratch every tick means a correction like that is
picked up automatically on the very next poll — no separate
detection/reset logic needed, and no manual "reset" button either (this was
discussed and deliberately not built, since the automatic recompute already
covers it). This mirrors the exact "no memory, always re-derive from live
data" property the single-round view already had for free (5.5) — the
paired case just needed the extra `earlierStageName()` step because it's
tracking two rounds instead of one. Verified live: reset a completed heat back to
`pending` on the side currently ahead by a stage, and the shared stage
correctly drops back down on the next poll, no user action required.
Rendered via `renderPairedBoard()`, a sibling of `renderBoard()` that
renders a specific already-computed `{stageName, heats}` result instead of
asking the round what its own current stage is — using the ordinary
`renderBoard()` here would have reintroduced the original skip-ahead bug.
The whole entry is "done" (sequence advances to the next entry) once
**both** rounds report `isRoundFullyFinished()`, which is still allowed to
be genuinely stage-name-async between the two sides (nothing about "done"
requires them to have finished at the same stage) — and once both are
done, the entry doesn't rewind even if something is corrected afterward
(the sequence has already moved on; the same forward-only limitation
sequence mode has in general, considered and explicitly out of scope here).
Because none of this remembers anything about *previous* visits to either
round beyond the two cursor variables — everything else re-derives fresh
from live data every tick — the same round can be revisited any number of
times as the two sides keep alternating, and each revisit "just works"
without further resume logic.

**No automatic stuck-heat watchdog (removed by explicit request — was a
90s `STUCK_TIMEOUT_MS` timer).** Originally added when the suspected cause
of a stuck category switch was a heat's ascent `status` never reaching
`"confirmed"`; that root cause turned out to be broader and got fixed
directly at the source (5.5's `heatIsDone()`, which stopped trusting
`status` for Speed-elimination heats at all), narrowing the watchdog to a
safety net for one remaining case: a heat that never gets *any* recorded
result at all (equipment failure, an unresolved dispute), which would
otherwise block a paired entry from ever ceding the wall to the other
category. The user asked for this removed outright: the display should
only ever switch categories on a genuine stage completion or a human
clicking "Switch category now" — never silently on its own after a
timeout, even as a safety net. **The tradeoff, raised and accepted**: an
unattended tablet (6.7 — these run wall-mounted with no one watching) with
a genuinely stuck heat and nobody noticing will now show a stale category
indefinitely instead of self-correcting after 90s. Accepted deliberately,
consistent with this app's broader preference throughout this investigation
for showing exactly what's confirmed rather than guessing (5.6's
sticky-frontier fix follows the same principle) — the manual button is
considered sufficient, not a fallback of last resort. `pairedState` no
longer tracks `stuckHeatId`/`stuckSince` at all — removed rather than left
unused, since nothing reads them any more.

**Manual override (`#pairedBar` / `pairedSwitchBtn`):** always visible
while a paired entry is active, labelled "⇄ Switch category now" — now the
**only** way to move past a stuck heat, since the automatic watchdog above
was removed.

**`pairedState.manualPin` — why the button needs it:** clicking the button
sets `pairedState.activeSide` directly, but the very next line of
`pollPairedTick()` (the "stick with the current side, else hand the turn to
the other one" logic from two paragraphs up) would otherwise immediately
re-evaluate that side and flip straight back if it happens to have nothing
to show at the current stage yet (e.g. hasn't started) — silently undoing
the click before it ever became visible. Reported live as "the button
doesn't work." `manualPin` (set by the click, consumed - reset to `false`
- on the very next `pollPairedTick()` call regardless of outcome) suppresses
that auto-revert for exactly one tick, so a manual choice is always
honored, even as a "Waiting for the next stage…" placeholder, while normal
ticks afterward resume auto-switching away from a genuinely empty side as
usual.

### 6.13 Training mode: manual advance, same roster/order as qualification, controllable from a second device

**Problem this solves:** Speed training sessions have no live results.info
data behind them at all (no round, no ascents to poll) — but the start
order in training usually matches a real round's (typically the
qualification round), so that order can be reused while advancement is done
by hand instead of inferred from ascent status.

**Decision:** Training mode (`startTrainingSession()`) fetches the chosen
round once for its roster (`orderedAthletesForRoute()`, shared with the
live inference in `computeLane()`) and renders lanes with
`renderLaneBody()` (also shared) driven by a manual `index` instead of
`findCurrentIndex()`. Not composable with Sequence mode — there's no live
"done" signal to auto-advance on, only a position someone moves by hand.

**Why the position lives on the server, not just `localStorage`:**
live-tested feedback was that manual advance itself worked well, but only
from the one device showing the board — there was no way to hand "Next/
Back" duty to a second person away from the wall (e.g. someone with a
clearer view of the actual climbing, controlling from their phone). A tiny
in-memory counter on the server (`/api/training/:host/:roundId`, GET to
read / POST `{ delta }` to step, floored at 0), keyed by host+round and
capped like the existing cache (200 entries, oldest evicted first, 6.2),
lets any number of devices watching the same round stay in sync: the wall
tablet polls it every second and renders `renderTrainingBoard()`; pressing
Next/Back on *any* device (the wall tablet itself, or a second one) posts
to the same endpoint, so all viewers converge within one poll tick. This is
the one exception to "the server has no persistent state" (2) — accepted
specifically because a training position is meaningless once the session
itself ends, so losing it on a server restart costs nothing worth guarding
against with real persistence.

**Wall tablet vs. controller — same round, two renderings:** a plain
Training-mode link (`?...&training=<roundId>`) shows the full board plus
local Next/Back — usable standalone with no second device at all. Sharing
it with `&control=1` appended instead renders `#controller`
(`renderController()`): a deliberately minimal view — current athlete name
per lane plus two large buttons, nothing else — sized for a phone rather
than a wall tablet, since a full multi-lane board doesn't fit a small
screen usefully and the person holding it only needs to know who's up and
to tap with confidence. The wall tablet's board screen shows both its own
"Link for this tablet" *and* a separate "Link to control from another
device" (`buildShareLink({ ...selection, control: true })`), so the two
roles get two distinct, purpose-built links from the same session.

**No auth on the control link:** whoever has the link can drive the
position — the same trust model the app already uses for the ordinary
board link (6.4/6.8's "no accounts" decisions apply here too). Acceptable
for volunteers at a single event; not appropriate to extend this pattern to
anything with real stakes.

**Gated to Speed rounds only.** Training mode reuses a round's *roster
order*, driven by manual advance instead of live ascent status (above) —
that concept doesn't map onto Boulder or Lead at all: Boulder has no linear
start order once starting groups (6.6) split the field, and Lead's rounds
are already served well by Single round/Sequence mode with real live
inference. Raised proactively by the user (not a live bug report): with
Training mode selected and a multi-group Boulder round chosen in the round
dropdown, nothing in the UI explained why starting a training session for
that round wouldn't make sense. `populateRounds()` now tags each dropdown
entry with `isSpeed` (`round.format_identifier?.startsWith("speed_")`,
carried into the DOM via `opt.dataset.speed`); `updateTrainingEligibility()`
(called from `setMode()` and wired to `roundSelect.onchange`) disables
`el.startTraining` and shows a `#trainingHint` explainer whenever the
selected round isn't Speed, while in Training mode. `el.startTraining.onclick`
also re-checks `opt.dataset.speed` itself before starting a session, as a
belt-and-suspenders guard against the button being triggered some other way.

### 6.14 Poll-overlap protection (`pollToken` / `trainingPollToken`)

**Problem this solves:** every poll path in this app (`pollCurrent()`'s 3s
timer, the paired-entry fetch pair in `pollPairedTick()`, Training mode's
1s `pollTrainingIndex()`) is `async`, and a new poll can start (a manual
"Switch category now" click, a mode switch, a `roundSelect` change starting
a fresh watch session) while a previous poll's `fetch()` is still
in flight. Network responses don't necessarily resolve in the order the
requests were sent — a slower "old" request can resolve *after* a faster
"new" one — so without any guard, the old response could land last and
overwrite the board with stale data, clobbering what the new poll had
already correctly rendered.

**Decision:** a module-level counter per independent polling loop —
`pollToken` for the main watch-mode chain (`pollCurrent()` /
`pollPairedTick()` / `pollRound()`), a separate `trainingPollToken` for
Training mode's independent chain (`pollTrainingIndex()` /
`trainingStep()`) — bumped at the start of every call that kicks off a new
poll cycle. That call captures the post-bump value into a local `token`/
`myToken` and threads it through every `await` in that cycle; each place
that's about to mutate shared render state (`lastRoundData`, `el.statusLine`,
`trainingIndex`, the rendered DOM) first checks the captured value against
the current global counter and silently discards the result if a newer call
has since taken over. Two independent counters, not one shared one, because
the main watch chain and Training mode are already mutually exclusive modes
(6.11) with separate render targets — a single shared counter would make an
unrelated training step spuriously invalidate an in-flight watch-mode poll
and vice versa.

**Why a token counter instead of `AbortController`:** the in-flight fetch
itself is harmless to let finish — the cost isn't wasted network traffic
(the server's 3s cache already absorbs that, 6.2), it's *applying* a stale
result after a newer one already rendered. A token check right before each
state mutation is a smaller, more local change than plumbing an
`AbortController` through every fetch call and handling `AbortError`
specially in each `catch` block, for the same net effect.

Verified live: mocked `fetchRoundJson` so an "old" call resolves after a
300ms delay while a "new" call (started 20ms later) resolves instantly;
confirmed the board shows the new call's data immediately and — critically —
still shows it once the delayed old call finally resolves, instead of being
overwritten. Regression-checked the normal (non-racing) case still updates
on every tick as before.

### 6.15 Hosting: Render (Blueprint) over alternatives

**Why not GitHub Pages alone:** static-only, cannot run the proxy (6.1) —
a hard requirement, not a preference.

**Why Render specifically:** free tier requires no payment method, deploys
directly from a GitHub repo via `render.yaml` (checked into this repo), and
the existing Express app needed zero code changes to deploy there (it
already binds `0.0.0.0:process.env.PORT`, which Render requires). Trade-off
accepted: the free tier sleeps after ~15 minutes idle, causing a ~30-60s
cold start on the next request — acceptable for a tool used in bursts on
competition days, not acceptable if this ever needs to be always-instantly
available.

**Deploy trigger is currently manual, not automatic** — see `HOSTING.md`
section A for why and the exact steps. This is an operational detail, not
an architectural one, so it lives in the deployment doc rather than here.

### 6.16 Feedback footer, setup screen only

**Decision:** a `<footer class="setup-footer">` inside `#setup` (nested,
not a sibling) links out to a Google Form ("Request a Feature or Send a
Message") for feature requests/bug reports. Nesting it inside `#setup`
rather than making it its own element is deliberate — `#setup`'s existing
`hidden` toggle (`startWatching()`/`goBackToSetup()` in `public/app.js`)
then hides/shows the footer for free, with no new element reference or
visibility logic needed at all.

**Why setup-screen only, not the board too:** the board is meant to run
unattended on a wall-mounted tablet during a competition (6.7) - a visible
external link there would be pure clutter (and an easy way for a curious
finger to accidentally navigate away from the live board mid-competition).
The setup screen is where a human is actively present adjusting things, so
it's the only place a feedback link is actually useful to have visible.

**Why a Google Form instead of an in-app mailto/contact form:** no
extra infrastructure (this app doesn't send email or store submissions
anywhere), and a Form gives the user a normal inbox of responses to review
without adding a database or auth of any kind - consistent with §7's "no
real database" out-of-scope decision elsewhere in this app.

### 6.17 Boulder final display mode: "Intervall" vs "World Series" (manual toggle, Boulder finals only)

**The problem:** IFSC Boulder finals have (at least) two distinct physical
formats, both reusing the exact same `route_start_positions`-driven queue
mechanism (5.6) with no algorithmic difference in *when* an athlete
actually climbs a given boulder — but with a real difference in how far
away a not-yet-reached boulder's queue should visually show its own
candidate. "Intervall" reuses qualification's pacing (gap 2, many boulders
genuinely live at once, a not-yet-reached candidate is realistically close
once ready). "World Series" paces at most 2 boulders live at once (gap =
roughly half the finalist field, see below) — a not-yet-reached boulder's
candidate can be several heats away even once every closer boulder is
progressing normally, and reported live (a real event, round `13833`) that
showing them at the very front of the queue regardless misrepresents how
far off they actually are.

results.info's own `format_identifier` does **not** distinguish these two
— confirmed by the user directly ("Leider sagt das Format in dav-stage
nichts darüber, welches der Formate gemacht wird") — so this can't be
auto-detected the way every other Boulder format variant in this app is.
Hence a manual, per-round toggle (`renderBoulderModeToggle()`), shown only
when `isBoulderFinalRound(round)` (`discipline === "Boulder"` **and**
`format_identifier` starts with `"boulder_finals"`) — Qualification rounds
never show it and always get the "Intervall" reading, matching the user's
explicit instruction that Qualification stays untouched. Placed in the
board header next to the Course A/B group tabs (6.6), reusing the same
`.group-tab` styling. Remembered per round id (`localStorage`, keyed by
`round.id`, not per-tablet) since it describes a property of the real
event, not a personal display preference — a second tablet loading the
same round sees whatever was last chosen for it.

**"Intervall" is the default and is byte-for-byte the pre-existing
behavior** (5.6's readiness check) — confirmed unaffected by this change:
Qualification, both already-verified final formats under their default
reading, and every already-reached boulder (regardless of mode) render
identically to before.

**"World Series" mode — padded-distance queue.** Reuses
`boulderGroupFrontier()` (5.6) to compute a numeric `distance` (not just a
boolean) for the not-yet-reached candidate: `distance = herePos - frontier
- 1`, i.e. how many heats away they genuinely are (0 = ready now, matching
"Intervall"'s existing readiness cutoff exactly — confirmed live that
`distance === 1` renders byte-identical to the "Intervall" branch, so the
two modes only ever visibly diverge once a candidate is more than one heat
out). When `distance > 0`, `distance - 1` blank placeholder slots (`null`
queue entries, rendered as "—") are prepended before the candidate, so
their real waiting-list position reflects their real distance instead of
always sitting at the front. Verified live off the real reported example
(round `13833`, event `1593`): a candidate 3 heats out from Boulder 4 (the
boulder immediately before it, Boulder 3, still had 3 more heats of its
own queue to clear) now shows 2 blank slots before their name (displayed
rank 4 — CLIMBING, NEXT, 2nd, 3rd all blank, 4th = the candidate),
matching the user's own description exactly ("Auf 4. steht dann #109
KANT. Im nächsten Heat rutscht #109 KANT auf 3."). Also verified via a
controlled heat-by-heat simulation (synthetic 9-athlete round) that the
padding count decrements by exactly one every heat as the group's real
frontier advances, until it reaches 0 and the candidate is promoted to
`onDeck` — at the same heat "Intervall" mode would have promoted them too.

**No new frontier computation was needed** — `boulderGroupFrontier()`
already scopes correctly per route group (5.6), and this mode only changes
how its numeric result is *used* (padding count vs a boolean gate), not
how it's computed. This also means the "orient on the boulder
immediately before" behavior the user asked for falls out for free: in a
World Series final (no course split, a single route group covering all
boulders), the group-wide frontier is, at any real moment, driven by
whichever boulder is currently most advanced — which in a strict linear
pipeline is always the boulder immediately preceding the one being
computed, confirmed by the shared "heat slot" position-value property
(5.6).

### 6.18 QR codes next to the tablet/control share links

**Decision:** both share-link rows (`#shareRow` "Link for this tablet",
`#controlShareRow` "Link to control from another device", 6.1/6.13) get a
small scannable QR code next to the text field and Copy button, generated
client-side via `renderQrCode()`.

**Why client-side, vendored, no CDN:** this app already has zero external
runtime dependencies (only `express` server-side, nothing loaded from a
CDN in the browser) — a QR code is exactly the kind of small, static,
pure-function capability that doesn't need a network call or a server
round-trip, so pulling one in from a CDN would be the only external
dependency in the whole app for no real benefit. Vendored
`public/qrcode.js` (Kazuhiko Arase's `qrcode-generator`, MIT, single file,
no dependencies of its own) instead — loaded via a plain `<script>` tag
before `app.js`, matching this app's build-less, no-bundler setup (6.1).
Its top-level `var qrcode = ...` becomes a normal global in that setup, so
`app.js` can call `qrcode(0, 'M')` directly with no import/require.

**Why SVG, not `<img>`/canvas:** `createSvgTag({ scalable: true })` omits
fixed pixel width/height, sizing purely off the embedded `viewBox` — lets
the `.qr-code` CSS box control final size without any raster blur at
different DPIs, and needs no `<canvas>` element or data-URL round-trip.
The library's own `<rect fill="white">` background guarantees scan
contrast regardless of this app's dark theme.

**`setShareLink()`/`setControlLink()` wrap every write to
`el.shareLink.value`/`el.controlLink.value`** (four call sites:
`startWatching()`, the Boulder group-tab click handler, and both branches
of `startTrainingSession()`) so the QR code can never go stale relative to
the visible text field — don't reintroduce a raw `el.shareLink.value =
...` assignment anywhere; route it through the setter instead. Verified
live (real decode, not just "an SVG rendered"): rendered the generated SVG
to PNG and decoded it with `zbarimg`, confirming byte-for-byte the decoded
payload matches `el.shareLink.value` exactly, for a plain round link, a
Boulder group-tab switch, and a Training mode control link.

### 6.19 "Next up" strip in Sequence mode

**Decision:** below the lanes (`#nextInSequence`, only when
`currentSelection.sequence.length > 1` and the current entry isn't the
last one) shows "Next up: `<category — round>`" for whatever comes after
the currently-displayed sequence entry — plain text, updated once
`pollCurrent()` settles on a stable `sequenceIndex`, not part of the 3s
poll payload itself.

**Why a fresh fetch instead of reusing the setup screen's round labels:**
`populateRounds()` (§1) only ever populates `el.roundSelect` when a tablet
goes through the interactive "Load event" flow — a tablet bookmarked
straight to a `?host=...&rounds=...` deep link (the whole point of 6.1's
share links) calls `startWatching()` directly and never touches
`populateRounds()` at all, so `el.roundSelect` is empty in the common
real-world case. `getRoundLabel()` instead fetches the next round's own
`/api/round/:host/:roundId` data (same endpoint `pollRound()` already
uses) the first time it's needed, building the same `"category — round"`
string used for `el.roundTitle`.

**`roundLabelCache` (by `"host:roundId"`, never invalidated within a
session)** — a round's category/round name is immutable for the life of a
tablet session, so caching it indefinitely is safe and avoids re-fetching
the same not-yet-current round on every 3s tick while staff wait through
the current entry. A paired entry's label is built by fetching both sides
and joining `"A ↔ B"`, matching the sequence-builder list's existing
convention (6.12's "Show sequence" list).

**Called from exactly the two steady-state `return` points inside
`pollCurrent()`'s loop** (the paired-tick branch and the round branch),
not from every branch — the loop's other `return`s are either "superseded
by a newer poll" or "fetch failed", neither of which represents a settled
`sequenceIndex` worth reflecting in the strip. Guarded by the same
`pollToken` comparison as the rest of `pollCurrent()` so a slow label
fetch from a superseded call can't overwrite a newer one's strip.
`startWatching()` force-hides the strip immediately (before
`updateNextInSequence()` gets a chance to run) — needed because Training
mode shares `#board` with normal Sequence mode but has no sequence concept
at all and never calls `updateNextInSequence()` itself, so without this a
stale strip from a previous Sequence-mode session could otherwise persist
into a Training session. Verified live: a 2-round sequence, a 2-entry
sequence with the paired entry first, and with the paired entry second —
all three show the correct "next" label, including the `↔` join.

### 6.20 "Legal Information" disclosure (Impressum, Datenschutzerklärung, Datenquelle, Haftungsausschluss), setup screen only, collapsed by default, pinned to the bottom of the screen

**Decision:** a single `<details class="legal">` disclosure sits in the
same `<footer class="setup-footer">` as the feedback link (6.16), right
below it on its own line, summary labelled "Legal Information" — collapsed
by default, expanding all four legal documents at once when clicked (each
under its own `<h4>` inside `.legal-body`): Impressum (§ 5 DDG), a
privacy policy, a data-source note, and a liability disclaimer. Nested
inside `#setup` for the same reason as the feedback footer: it hides/shows
for free via `#setup`'s existing `hidden` toggle, no separate visibility
logic.

**Why "Legal Information" specifically, not just "Legal":** the bare
adjective "Legal" read ambiguous on its own (legal *what*?). Settled on
"Legal Information" after checking how `dav.results.info` itself — the
platform this app's data comes from — labels the exact same kind of
grouped footer link: it uses "Legal information" verbatim. Matching that
gives a real, already-in-use precedent from a directly adjacent site
instead of inventing new wording, and reads unambiguously as "click here
for legal documents" rather than a floating adjective.

**Pinned to the bottom of the screen, not just following the content:**
`.setup` (the setup screen's own root element) is `min-height: 100dvh` +
`display: flex; flex-direction: column`, and `.setup-footer` gets
`margin-top: auto` instead of a fixed value — the standard flexbox
"sticky footer" pattern. On a normal viewport with little setup content,
the footer sits flush at the bottom instead of right after the form
fields with a lot of dead space below it. On a short viewport, or once
"Legal Information" is expanded (four documents' worth of text), the auto
margin naturally collapses to 0 and the page scrolls instead of
overflowing/overlapping — no separate handling needed for that case, it
falls out of using `margin-top: auto` rather than `position: fixed`.

**Content decisions from user review, after the first draft (don't
reintroduce any of these):**
- **No "this is privately operated, not on behalf of a club/company"
  sentence in the Impressum** — not a § 5 DDG requirement, was just added
  context in the first draft; the user asked for it removed as
  unnecessary. The Impressum's actual content (a private individual's
  name/address, no Verein/company fields) already conveys this correctly
  without a sentence spelling it out.
- **"Deine Rechte" (Art. 15–21 DSGVO rights list) kept as-is** — genuinely
  applicable here even without accounts/forms, since Render's hosting
  necessarily processes visitor IP addresses (personal data) to serve the
  site at all, which triggers Art. 13 information duties.
- **"Haftung für Links" uses the user's own longer-form wording**, not an
  earlier shorter draft - it explicitly states the links were checked at
  the time of linking with no violations recognizable then, and that
  continuous monitoring without concrete cause isn't reasonable. This
  tracks the actual German case-law reasoning on link liability more
  precisely than a bare "not responsible for external content" line.

**Second review round - two law renamings caught, one clause added back
in (don't revert any of these):**
- **§ 5 TMG → § 5 DDG, and § 25 Abs. 2 Nr. 2 TTDSG → § 25 Abs. 2 Nr. 2
  TDDDG.** Both laws were renamed on 14 May 2024 as part of Germany's
  Digital Services Act implementation (TMG → Digitale-Dienste-Gesetz;
  TTDSG → Telekommunikation-Digitale-Dienste-Datenschutz-Gesetz) - content
  essentially unchanged, only the names/section-law-references changed.
  Confirmed via web search before editing, not taken on faith from either
  the user's report or a prior memory of the old names. The Impressum and
  the `localStorage`/TDDDG paragraph both had the stale pre-2024 names in
  the first draft - if this section is ever rewritten from scratch, use
  DDG/TDDDG, not TMG/TTDSG.
- **A short Streitschlichtung (§ 36 VSBG) clause WAS added** - this
  reverses the first draft's "leave it out, doesn't apply" call. Still
  true that § 36 VSBG technically only binds "Unternehmer", and this site
  likely isn't one - but the clause costs nothing to include and closes
  that "likely isn't, but is it definitely not" gap defensively, which the
  user preferred once that tradeoff was made explicit. **Do NOT add a link
  to the EU ODR/"OS-Plattform"** (`ec.europa.eu/consumers/odr`) alongside
  it, even though many older German Impressum templates still pair the two
  - confirmed via web search that the OS-Plattform was shut down by the EU
  Commission on 20 July 2025 (Regulation EU 2024/3228); a site that still
  links to it now risks being seen as making a misleading claim, which is
  itself grounds for a competition-law warning. The § 36 VSBG
  non-participation sentence is a separate, still-valid German national-law
  mechanism unaffected by that shutdown - the two are easy to conflate but
  aren't the same thing.

**Why "Legal" as the umbrella label, "Impressum" kept as the document
title inside:** started as a single Impressum-only disclosure (see the
original version of this decision, superseded here); the user asked to
fold in three more documents and questioned whether the container itself
still had to be called "Impressum". It doesn't — nothing in § 5 DDG
requires the *section* to carry that exact word, only that the Impressum
*document itself* be easily recognizable once reached. "Legal" as the
outer label (matching this app's English-only UI convention, 6.8) with
"Impressum" as the first `<h4>` inside satisfies that: a visitor clicking
"Legal" immediately sees "Impressum" as the first heading, unambiguous and
one click away — still "leicht erkennbar, unmittelbar erreichbar, ständig
verfügbar".

**Why one shared disclosure instead of four separate ones:** keeps the
footer to one interactive element regardless of how many legal documents
exist behind it — "maximal unauffällig" was the explicit ask, and four
separate `<details>` elements (or a sub-menu) would be more visual surface
for the same amount of legally-required content. All four sections show
together on the one click; a visitor scans past the ones they don't need.

**Content decisions worth remembering:**
- **Datenschutzerklärung** explicitly states there are no cookies and no
  analytics/tracking (both true — confirmed against the actual app, not
  just written aspirationally) - the only client-side storage is
  `localStorage` for the tablet's own last-used selection (6.1/6.13),
  called out as not requiring TDDDG § 25 Abs. 2 consent since it's
  strictly technically necessary for the core function, never leaves the
  device, and isn't used for tracking.
- **Hosting section names Render Services, Inc. (USA) explicitly** and
  references Render's own SCCs + EU-US Data Privacy Framework
  certification as the transfer basis, with direct links to
  `render.com/privacy` / `render.com/dpa` rather than restating their
  content - confirmed live via `render.com/privacy` and `render.com/dpa`
  and a web search on Render's current DPF certification before writing
  this, not assumed. **The user's Render service runs in the US region**
  (confirmed directly by the user) - if that ever changes to an EU region,
  this section's wording (Drittlandtransfer / SCC / DPF) would need
  revisiting, it's not automatically still accurate.
- **Datenquelle names results.info / Vertical-Life GmbH as the data
  source, deliberately without mentioning any permission, arrangement, or
  exemption** - the user confirmed the API-usage question is "geklärt"
  (resolved) on their end but explicitly asked that the public-facing text
  not reference any special permission at all, just state plainly where
  the live data comes from. Don't add wording implying a formal
  partnership/license unless the user asks for that specifically.
- **Haftungsausschluss has two parts, not just the generic external-links
  boilerplate:** (1) the standard "not liable for externally linked
  content" clause, and (2) something specific to what this app actually
  does - no guarantee of accuracy/completeness/timeliness for the live
  competition data, with the official on-site judges' ruling always taking
  precedence over what the board shows. That second part is the
  substantively useful one for this specific app, not boilerplate.
- **Not written by a lawyer** - the user was told this directly and
  intends to have it reviewed before relying on it. Don't present this
  content as legally guaranteed-correct in future conversations; it's a
  good-faith draft using standard German patterns, not verified legal
  advice.

**Why the email is assembled in `app.js` instead of written directly in
the HTML** (`renderImpressumEmail()`, called once at load, right before
the URL/localStorage bootstrap): keeps the address out of the page source
as a contiguous, trivially-scraped string, while still rendering a fully
normal, functional `mailto:` link for an actual visitor — no CAPTCHA-style
friction, no loss of one-click "open in mail client", nothing that would
undermine § 5 DDG's "unmittelbare Kommunikation" requirement. This is
light obfuscation against naive static scrapers, not a claim of blocking
anything that executes JavaScript - discussed and accepted as the
tradeoff versus a plain-text `mailto:` link.

**Layout note (a real bug, fixed before shipping, no live report):** an
earlier version placed the `<details>` as `display: inline-block` on the
*same* line as the feedback link, separated by a `·`. Once expanded, the
tall multi-line body content broke the surrounding inline text flow —
`text-align: center` plus a tall inline-block sibling pushed the feedback
link to *below* the legal block instead of staying above it, reading in a
confusing order. Fixed by giving `.legal` its own line (`margin-top`,
default block display) instead of trying to keep it inline with the
feedback link — verified by actually opening it and screenshotting, not
just eyeballing the collapsed state. `.legal-body` additionally gets
`max-width` + `text-align: left` (unlike the short single-purpose
Impressum-only version this replaced) - four documents' worth of prose
centered edge-to-edge across the whole footer width would be hard to
read, so the body is a width-capped, left-aligned, centered block instead
while the "Legal" summary itself stays centered like the rest of the
footer.

## 7. Explicitly out of scope (do not "fix" without asking)

- **A visual bracket tree** for Speed elimination (like the PDF heat sheet
  results.info can export) — the current/next/queue heat-list view (5.5) is
  the supported approach; a graphical tree would be a materially different,
  separately-scoped feature.
- **Training-progress persistence across sessions** — the server-side
  training counter (6.13) is in-memory only and lost on a server restart; a
  training session that gets interrupted that way just restarts at 0.
  Deferred until it proves annoying in practice, not because it's hard.
- **Training mode inside a sequence** — sequence auto-advance needs live
  results to detect "done" (6.10); training mode has none. Combining them
  would need a manual "mark done, advance" control that doesn't exist yet.
- **A language switcher** — the UI is English-only by deliberate choice
  (6.8), not because a toggle wasn't considered.
- **Authentication / access control** — the app has none by design; the
  underlying competition data is already public on results.info, and the
  training-control link (6.13) follows the same no-accounts trust model.
- **A real database** — the server has no persistent storage beyond the
  short-TTL results.info cache (6.2) and the small in-memory training
  counter (6.13), both ephemeral by design.
- **Editing/writing to results.info** — this app is read-only against the
  API; it has no code path that could modify competition data.

## 8. Glossary (results.info terms as used in this codebase)

| Term | Meaning |
|---|---|
| `dcat` | "Discipline category" — one age-class × discipline combination within an event, e.g. "BOULDER U13 m". |
| `category_round` | One round within a dcat, e.g. "Qualifikation" or "Finale". Has its own `category_round_id`, which is the "round" ID this app's UI asks the user to pick. |
| `route` | One physical wall/lane/boulder within a round. |
| `starting_group` | A subdivision of a Boulder round's athletes (e.g. "Group A"/"Group B") climbing on their own separate set of routes in parallel — see Quirk A. |
| `ascent` | One athlete's attempt/result on one specific route (qualification) or one lane of one heat (Speed elimination). |
| `speed_elimination_stages` | The K.O. bracket for a Speed final: an ordered list of stages ("1/8", "1/4", "1/2", "Small Final", "Final"), each with its `heats[]` — see Quirk F. |
| `heat` | One head-to-head Speed duel: two athletes, one per lane, racing simultaneously. Has a globally sequential `number` across the whole bracket. |
| bib | Athlete's start number, shown in the UI as `#123`. Can be `null` (not always assigned, e.g. seen on Speed test data). |
