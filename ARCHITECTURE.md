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

For one route (one physical wall/lane), walk the start order and apply two
rules, in this priority:

1. **If anyone has a live (`"active"`) entry, the LATEST one in start order
   is at the wall.** A judge can start live-scoring the next athlete before
   confirming the previous one's result, so if two athletes are
   simultaneously `"active"`, the later one in start order is the one
   actually on the wall right now.
2. **Otherwise, it's the position right after the last `"confirmed"`/`"locked"`
   entry** ("last confirmed + 1"). Anyone entirely absent from `ranking`
   (Quirk B) counts as not-confirmed here, same as an explicit `"pending"`
   status.

Concretely (`findCurrentIndex(items, isActive, isConfirmed)`): walk `ordered`
front to back once, remembering the index of the most recent item matching
each rule; `currentIndex` is the last-active index if one exists, otherwise
one past the last-confirmed index. Then:

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

**Wake Lock re-acquisition:** per spec, the Screen Wake Lock is
automatically released when the tab is backgrounded (`visibilitychange` to
`"hidden"`) — e.g. if the tablet's screen was manually turned off and back
on. A `visibilitychange` listener re-requests the lock once the page is
visible again, but only while still in fullscreen (treated as a proxy for
"still in kiosk mode" — exiting fullscreen also drops the wake lock via the
`fullscreenchange` listener, so both stay in sync through one user action).

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

`stageHeatsRemaining(round, stageName)` — a scoped variant of the same
heat-selection rule, applied to *one* named stage instead of scanning
across all of them — then answers "does this side have anything left at
this specific stage" for each side independently. Both rounds are fetched
every tick regardless (cheap — the server's 3s cache means this rarely
reaches results.info twice); if the side currently shown has nothing left
at the shared stage, the turn passes to the other side at the *same*
stage; `pairedState` only still needs to persist `activeSide` (which of the
two co-equal sides to display — there's no data signal for "whose turn it
is", so that genuinely has to be remembered) and the stuck-heat watchdog
state below.

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

**Stuck-heat watchdog:** originally added when the suspected cause of a
stuck category switch was a heat's ascent `status` never reaching
`"confirmed"`. That root cause turned out to be broader and got fixed
directly at the source (5.5's `heatIsDone()`, which stopped trusting
`status` for Speed-elimination heats at all) — so this watchdog is no
longer covering for that. It stays as a narrower safety net for the case
`heatIsDone()` still can't resolve: a heat that never gets *any* recorded
result at all (equipment failure, an unresolved dispute) would otherwise
block a paired entry from ever ceding the wall to the other category.
`pollPairedTick()` tracks how long the active side's current heat
(`sideResult.heats[0].id`) has stayed the same; if it hasn't changed in
`STUCK_TIMEOUT_MS` (90s), it force-switches to the other side (same
`stageIndex` — the stage cursor only ever advances once both sides
genuinely have nothing left, per the previous paragraph), resetting the
watchdog for whichever side is now shown. Deliberately scoped to just this
paired-entry switch decision: a stuck *single* round still just shows one
stale card forever with no timeout (5.2's rule 1 is unaffected by any of
this — qualification-round `"active"` still reliably resolves to
`"confirmed"` in practice, unlike Speed-elimination heats), but a stuck
paired entry blocks the whole callzone from moving on to the next
category, a materially worse failure mode worth a narrow exception for.

**Manual override (`#pairedBar` / `pairedSwitchBtn`):** always visible
while a paired entry is active, labelled "⇄ Switch category now" — an
immediate escape hatch alongside the 90s watchdog above, for when staff
notice a stall themselves and don't want to wait it out.

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
