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

**Quirk C — `ascents[].status` values seen:** `"pending"` (not yet judged),
`"confirmed"` (judged, locked in), `"locked"` (seen on Speed — same
practical meaning as confirmed for this app's purposes: anything that is not
`"pending"` counts as "already climbed"). There is no `"in_progress"` /
"currently climbing" status — see section 5.

**Quirk D — `round.status` (pending / active / finished)** is a
*round-level* field, not per-athlete and not per-route. It's the only
reliable signal for "has this round started at all" — see 5.3 for why that
distinction matters and can't be derived from ascent statuses alone.

**Quirk E — `startlist[].route_start_positions[]`** gives each athlete's
start position *per route*, e.g. an athlete might be position 1 on Route "1"
and position 14 on Route "2". For Boulder-with-groups rounds, an athlete only
has `route_start_positions` entries for the routes belonging to their own
group — this is what makes filtering by `route.id` automatically correct
per group with no extra group-membership check needed.

## 5. Core algorithm: "who's at the wall"

### 5.1 The problem

results.info has no "currently climbing" field. All it exposes is, per
athlete per route: has this been judged yet (`pending`) or not
(`confirmed`/`locked`), and that athlete's fixed start position on that
route.

### 5.2 The inference (`computeLane()` in `public/app.js`)

For one route (one physical wall/lane), walk the start order:

1. Build `ordered`: all athletes with a start position on this specific
   route, sorted by `position`.
2. Find `currentIndex`: the index of the first athlete whose ascent status
   for this route is `pending` (or who is entirely absent from `ranking` —
   see Quirk B). Everyone before that index has already climbed.
3. `atWall = ordered[currentIndex]`, `onDeck = ordered[currentIndex + 1]`,
   `queue = ordered.slice(currentIndex + 2, currentIndex + 8)` (next 6).
4. If no pending athlete is found, the whole route is done →
   `finished: true`, rendered as "Runde beendet" instead of the three cards.

This is an approximation, not ground truth: it assumes athletes climb in
strict start-order with no skips, which holds for how results.info judges
enter results in practice, but is not something the API guarantees.

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
(`list.setAttribute("start", "2")` in `buildLane()`), not the HTML default
of 1. Rationale: "Nächste·r" (onDeck) is conceptually queue position 1 — it
has its own card above the list. If the list below also started at 1, there
would be two different people both visually labeled "1", which reads as
contradictory. Starting the list at 2 makes the numbers a continuous,
unambiguous queue position across both the onDeck card and the list. This
applies uniformly, including in the not-started-round case from 5.3 (there,
`onDeck` is the actual first starter, so the list correctly starts at the
second starter).

### 5.5 Known limitation: Speed elimination rounds

Speed *qualification* uses the same `routes: [{name: "A"}, {name: "B"}]` +
start-position shape as Lead/Boulder and is fully supported. Speed **finals
(head-to-head elimination brackets/duels)** use a fundamentally different
data shape (bracket/duel structure, not a linear start order) that this app
does not attempt to parse — such rounds will likely fall through to "Keine
Routen-Daten für diese Runde." This is an explicit scope decision, not an
oversight: supporting brackets would need a materially different rendering
model (a bracket tree, not a queue).

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
fixed category, without re-selecting it from a dropdown after every reload
(power loss, Safari tab reload, etc.).

**Decision:** on load, `readUrlSelection()` (URL `?host=&event=&round=`)
takes precedence over `loadSelection()` (last manually-picked selection,
`localStorage`). A "Link für dieses Tablet" box on the board shows the exact
URL for the currently-watched round, meant to be bookmarked/added to the
home screen on that specific tablet.

**Why this order and not the reverse:** URL params represent an explicit,
durable assignment ("this physical tablet always shows Boulder U11") that
should survive even if someone else used that same browser to look at a
different round manually in between — a bookmark should be trustworthy.
localStorage alone would get silently overwritten by the last manual
selection on that device, which defeats the "each tablet has its permanent
category" use case this feature exists for.

### 6.5 Naming: "Route" (or "Bahn" for Speed), not "Wand"

Earlier revision used "Wand 1" / "Wand 2" as the per-lane label. Changed to
"Route 1" / "Route 2" after user feedback — "Wand" (wall) is ambiguous when
a single physical wall hosts multiple named routes, whereas the athlete
currently climbing is still described as being "an der Wand" (at the wall)
in the card label, which is a different, correct use of the word (a
description of the athlete's location, not a lane identifier). Speed lanes
keep the term "Bahn" (track/lane), which is the climbing-specific term for
side-by-side speed lanes and was not part of the reported naming issue.

### 6.6 Hosting: Render (Blueprint) over alternatives

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

- **Speed elimination brackets** (5.5) — different data shape, not a bug.
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
| `ascent` | One athlete's attempt/result on one specific route. |
| bib | Athlete's start number, shown in the UI as `#123`. Can be `null` (not always assigned, e.g. seen on Speed test data). |
