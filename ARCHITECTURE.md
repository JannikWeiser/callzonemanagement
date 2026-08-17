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
database, no persistent state, no auth, no request logging beyond what
Express/Render do by default.

## 3. File map

| File | Responsibility |
|---|---|
| `server.js` | Express server: serves `public/`, proxies `/api/event/:host/:eventId` and `/api/round/:host/:roundId` to results.info with the required `Referer` header, short in-memory cache. |
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
3. A heat is **active** if either lane's ascent status is `"active"` (a
   judge is live-scoring one of the two racers right now); it's **confirmed**
   only once *both* lanes are `"confirmed"`/`"locked"` — see Quirk C and
   §5.2's rule 1/rule 2 split, applied here per-heat via the same
   `findCurrentIndex()` helper (not a separate implementation).
4. Find `currentIndex` via `findCurrentIndex(heats, heatIsActive, heatIsConfirmed)`:
   the latest **active** heat if any exists, otherwise the position right
   after the last **confirmed** heat. **Not** "the first ready-and-not-done
   heat": a heat can stay unconfirmed indefinitely (an unresolved
   false-start review, an appeal) while later heats — even in the next
   stage — are already confirmed, which would otherwise permanently block
   the board on an old stage. Observed live on a real `under_appeal` round:
   stage "1/8" fully confirmed, stage "1/4" heat 9 already confirmed, heats
   10-12 still pending — "first not-done" would have stopped at heat 9
   forever; the frontier approach correctly lands on heat 10.
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

**Decision:** the setup screen keeps its existing single-round dropdown +
"Show" flow untouched, and adds a **separate, additive** mechanism next to
it: "+ Add to sequence" appends the currently-selected round to a
reorderable list (native HTML5 drag-and-drop, no library), and "Show
sequence" starts watching the whole ordered list. Internally,
`currentSelection.rounds` is *always* an array of `{ id, stage }` — a
single "Show" click is just an array of length 1 with `stage: false` — so
there's exactly one code path for both cases, not two parallel ones. (The
`stage` flag is what powers interleaving between rounds — see 6.12.)

**Auto-advance mechanism (`pollCurrent()`):** each poll checks
`isSequenceEntryDone()` on the round currently being shown — for a normal
entry this is `isRoundFullyFinished()` (every lane/group/heat done, not
just the one visible group tab happens to be on); for a `stage: true` entry
it's a narrower per-stage check, see 6.12. If done and the sequence has a
next entry, it fetches and renders
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

**Why `sequenceIndex` isn't persisted, only `rounds` is:** the share
link/`localStorage` capture the *configured sequence* (`?rounds=id1,id2:stage,id3`,
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

### 6.11 Training mode: manual advance, same roster/order as qualification

**Problem this solves:** Speed training sessions don't exist as a scored
round in results.info at all — there's no live ascent data to poll, so the
usual `findCurrentIndex()` inference (5.2) has nothing to work with. But
per the user, training's start order is always the same as the real
qualification round's — same roster, same per-lane positions.

**Decision:** reuse the *exact same* round-selection UI (Event ID → server
→ round dropdown) rather than building a separate "type in a roster"
screen — whatever round is picked (typically the real, not-yet-run
Qualification round, or a dedicated results.info round set up ahead of
time with the same start order) supplies `round.startlist` /
`route_start_positions` exactly as in live mode. A **"Training mode
(manual advance)" checkbox** next to "Show" switches how "at the wall" is
determined for that viewing session: instead of `findCurrentIndex()`
reading ascent status, a plain integer `trainingIndex` (module state,
starts at 0) is used directly as the position into
`orderedAthletesForRoute()` — the same start-order builder `computeLane()`
uses internally, now extracted as its own function specifically so
training mode could reuse it without duplicating the position/sort logic.

**One shared index across all lanes, not one per lane:** confirmed with
the user (they run both lanes together, e.g. paired practice runs) — a
single "Next"/"Back" pair on the board increments/decrements one
`trainingIndex` that's read by *every* lane shown, Boulder-group tabs
included. This is deliberately simpler than giving Lane A and Lane B (or
each Boulder group) independent pointers; revisit only if a genuinely
per-lane-independent training format comes up.

**Rendering reuse:** `renderLaneBody()` was factored out of `buildLane()`
specifically for this — it turns `{ atWall, onDeck, queue, finished }` into
the three familiar cards, regardless of whether those four values came
from live ascent-status inference (`buildLane`) or a manual click
(`buildTrainingLane`). `renderBoard()` picks one or the other per route
based on `currentSelection.training`, everything else (group tabs, lane
grid layout) is unchanged.

**Explicitly not composable with sequence mode:** sequence auto-advance
(6.10) needs `isSequenceEntryDone()` to read live results to know when to
move on; training mode has none. `el.watchSequence`'s click handler always
passes `training: false` — building a sequence of training rounds isn't
supported (nothing would ever trigger advancing). If that's wanted later,
it needs a manual "mark this entry done, advance" control, not automatic
detection.

**Not persisted across reloads:** `trainingIndex` always restarts at 0 on
load/reload — a tablet crash or accidental reload mid-training means
re-clicking "Next" back up to where you were. Chosen for simplicity in the
first version; revisit if this proves annoying in practice (would need
per-round manual-progress persistence, which nothing else in this app does
today).

### 6.12 Stage-limited sequence entries (interleaving finals between categories)

**Problem this solves:** a Speed event schedule commonly doesn't run one
category's whole final bracket before starting the next — it interleaves
by *stage* across categories to keep a single wall busy efficiently, e.g.
Round-of-16 for categories 1 and 2, then Quarterfinals for 1 and 2, ...,
finish both brackets, *then* Qualification for categories 3 and 4, then
their Round-of-16/Quarterfinals/... interleaved the same way. Sequence mode
as originally built (6.10) treats a round as atomic — it can't stop
partway through a bracket and come back later.

**Decision — extend, don't replace:** each sequence entry gained a
`stage: boolean` flag (only offered in the UI for rounds whose
`format_identifier` is `speed_elimination_ifsc_2026`, captured via
`opt.dataset.elimination` when the round is added — quali rounds have
nothing analogous, so the toggle doesn't apply to them and isn't shown).
The **same round ID can be queued multiple times** — nothing dedupes
`sequenceBuilder` — so building the interleaved schedule above is just:
add Round-of-16 for cat 1 (stage mode), cat 2 (stage mode), cat 1 again
(stage mode), cat 2 again, ..., then cat 3/4's Qualification (plain "whole
round" mode, added once each), then repeat the stage-mode pattern for
cat 3/4. This gives full manual control over the exact interleave pattern
(e.g. inserting a third category mid-sequence, or breaking the alternation
early) — but for the common case of just alternating two categories
through their whole bracket, doing this by hand turned out to be "sehr
aufwendig" (very tedious) in practice, which is what motivated the
shortcut below.

**Shortcut — "+ Add interleaved pair":** a second, simpler entry point for
the common case. `#interleaveRow` (hidden unless the loaded event has at
least two elimination-format rounds) offers two dropdowns, pre-populated
from the same `isElimination`-filtered round list; picking round A and
round B and clicking the button pushes `INTERLEAVE_REPEATS` (8, i.e. 16
entries total) alternating `{roundId: A, stage: true}, {roundId: B, stage:
true}` pairs onto `sequenceBuilder` in one click, then falls through to the
same `renderSequenceBuilder()` / drag-to-reorder / per-entry mode toggle as
manually-added entries — it's a bulk-insert convenience, not a separate
code path. 8 repetitions is deliberately more than any realistic bracket
needs (a 1/32-final-to-Final elimination tree is at most 6 stages); the
excess entries aren't wasted because of the next paragraph's insight —
once both brackets are actually finished, `isSequenceEntryDone()` reports
every remaining paired entry as instantly done, and `pollCurrent()`'s
catch-up loop skips through all of them in one tick. This means the
shortcut never needs to know a bracket's real depth ahead of time.

**Why re-queuing the same round "just works" — no extra state needed:**
`computeSpeedElimination()` (5.5) already derives "which stage is current"
from live ascent data on every call, not from any memory of what was shown
last time. So the *second* time a round appears in the sequence, it's
simply queried fresh again, and naturally reports whatever the next
unfinished stage is — there's nothing to "resume", the live data already
encodes it.

**Advance condition (`isSequenceEntryDone()`):** a `stage: true` entry
advances once `computeSpeedElimination(round).heats.length === 0` — which
is true in exactly the two situations that mean "nothing left to show for
*this* stage": the stage is fully confirmed and the next one isn't
populated yet (5.5's "waiting for next stage" transition), or the whole
bracket is finished. Either way, it's time to cede the wall to the next
sequence entry; a `stage: false` entry (or any non-elimination round)
still uses the original `isRoundFullyFinished()` whole-round check
unchanged. Verified directly against a live bracket by mocking a stage's
ascents to `"confirmed"` and confirming `computeSpeedElimination()`
immediately reports the next stage, with `heats.length === 0` exactly at
the "waiting for next stage" boundary.

**URL encoding:** a `stage: true` entry is written as `id:stage` inside the
comma-separated `rounds=` param (e.g. `rounds=13781:stage,13782:stage`);
absence of the suffix means `stage: false`. Kept inside the existing
`rounds` param rather than a parallel one, since a stage flag only ever
makes sense attached to a specific round ID.

### 6.13 Hosting: Render (Blueprint) over alternatives

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
- **Training-progress persistence across reloads** — `trainingIndex` (6.11)
  always restarts at 0; a mid-session reload means manually re-advancing.
  Deferred until it proves annoying in practice, not because it's hard.
- **Training mode inside a sequence** — sequence auto-advance needs live
  results to detect "done" (6.10); training mode has none. Combining them
  would need a manual "mark done, advance" control that doesn't exist yet.
- **A language switcher** — the UI is English-only by deliberate choice
  (6.8), not because a toggle wasn't considered.
- **Authentication / access control** — the app has none by design; the
  underlying competition data is already public on results.info.
- **Persisting anything server-side** — the server is stateless except for
  the short-TTL cache (6.2); there is no database.
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
