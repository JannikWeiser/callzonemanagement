# The results.info API — a guide for LLMs / coding agents

Audience: an AI assistant (or a developer) that needs to build something new
against the same API this repository uses, without necessarily reading this
whole codebase first. This file is self-contained: it explains the API
itself — auth, endpoints, response shape, and the non-obvious semantics you
need to correctly answer "who is climbing right now" — independent of how
*this particular app* (Callzone Management) happens to render that data.

If you *are* working inside this repository, `ARCHITECTURE.md` §4 covers the
same ground with cross-references into `server.js`/`public/app.js`; this
file is the portable, standalone version of that knowledge.

**Everything below was reverse-engineered from the live site** (browser
DevTools network tab + `curl`), not from official documentation — there is
none. Treat field names and behavior as "true as observed", not as a stable
contract. Verify against a live endpoint before relying on anything not
already confirmed here (see "How to verify a claim" at the end).

---

## 1. What results.info is

results.info (dav.results.info, ifsc.results.info, and other
`*.results.info` tenants) is a live results platform for climbing
competitions (Deutscher Alpenverein / IFSC and others). It publishes a
public, read-only JSON API behind each tenant's own domain that mirrors
what the results.info web app itself shows: events, categories, rounds,
startlists, and live ascent-by-ascent results.

There is no write API surface relevant here, no API key, and no user
account — everything described below is public read access, gated only by
the header trick in §2.

## 2. Auth: the Referer header gate

Every `/api/v1/...` endpoint returns `401 {"message":"Not Authorized!"}`
**unless** the request's `Referer` header matches that tenant's own origin
exactly (scheme + host, trailing slash included), e.g.
`Referer: https://dav.results.info/` for a request to
`dav.results.info`. Requesting `dav-stage.results.info` needs
`Referer: https://dav-stage.results.info/`, and so on — the Referer must
match the *host you're calling*, not any fixed value.

```bash
# 401 — no Referer
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Accept: application/json" \
  "https://dav-stage.results.info/api/v1/live"

# 200 — Referer matches the host
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Accept: application/json" \
  -H "Referer: https://dav-stage.results.info/" \
  "https://dav-stage.results.info/api/v1/live"
```

Notes on this gate:

- **CORS is wide open** (`Access-Control-Allow-Origin: *`) — this is *not*
  a CORS restriction, it's an explicit server-side header check. Wide-open
  CORS plus a Referer check is an unusual combination; it reads as
  low-effort anti-hotlinking, not real access control (the data is already
  fully public on the website itself, just gated for programmatic access).
- **A browser will not let JavaScript set an arbitrary `Referer`** —
  browsers control that header and always send the page's own origin, not
  a spoofed one. This means a purely static/client-side frontend calling
  results.info directly is **not possible**; you need a server-side hop
  that can set the header on an outgoing server-to-server request (not
  subject to the browser's Referer policy). This is the entire reason a
  backend proxy exists in this codebase (`server.js`) — it is not
  incidental architecture, it's a hard requirement imposed by this gate.
- The gate is per-tenant: hardcoding one Referer value and using it for
  every host will fail for the others. Derive it from whichever host
  you're about to call.

### Minimal proxy pattern (Node, generic)

```js
const HOSTS = {
  prod: 'https://dav.results.info',
  ifsc: 'https://ifsc.results.info',
  stage: 'https://dav-stage.results.info',
};

async function callResultsInfo(hostKey, path) {
  const base = HOSTS[hostKey];
  if (!base) throw new Error(`Unknown host: ${hostKey}`);
  const res = await fetch(`${base}${path}`, {
    headers: {
      Accept: 'application/json',
      Referer: `${base}/`,
    },
  });
  if (!res.ok) throw new Error(`results.info ${res.status} for ${path}`);
  return res.json();
}

// e.g. callResultsInfo('stage', '/api/v1/category_rounds/13750/results')
```

Any backend language works the same way — set `Referer` to
`${scheme}://${host}/` on the server-side outgoing request, matching the
host you're calling. A working, slightly more complete reference
implementation (with response caching) lives in this repo's `server.js`.

### Should you cache responses?

Not required, but strongly recommended if more than one client polls the
same round: results.info has no documented rate limit, but polling every
few seconds from multiple independent clients multiplies unnecessarily. A
short server-side cache (this repo uses 20s for event metadata, 3s for
round results — matched to how fast each actually changes) means N clients
polling in a shared frontend produce only 1 upstream request per cache
window, not N.

## 3. Known hosts / environments

| Host | Purpose |
|---|---|
| `dav.results.info` | Production DAV (Deutscher Alpenverein) competitions |
| `ifsc.results.info` | Production IFSC / World Cup competitions |
| `fasi.results.info` | Production FASI (Federazione Arrampicata Sportiva Italiana, Italy) competitions |
| `usac.results.info` | Production USA Climbing competitions |
| `sac-cas.results.info` | Production SAC/CAS (Swiss Alpine Club) competitions |
| `dav-stage.results.info` | Staging/test tenant — same API, test events with fake-name athletes, safe to hit repeatedly during development |

All six (and presumably any other `*.results.info` tenant) run the
identical API and identical Referer-gate mechanism. Confirmed directly for
`fasi`/`usac`/`sac-cas` (not just assumed from the pattern holding for the
first three) — same 401-without-Referer/200-with-Referer behavior, same
`/api/v1/events/{id}` and `/api/v1/category_rounds/{id}/results` response
shapes against real live events on each, and the same "POWERED BY / Legal
information" Vertical-Life footer on all three sites. Adding a new tenant
is just adding its base URL and using its own origin as the Referer -
confirmed in practice, not just in theory, when these three were added to
this app's `HOSTS` map (`server.js`) and the setup screen's Server
dropdown, with zero other code changes needed.

`dav-stage.results.info` in particular is useful for development: it has
long-lived test events with real API response shapes but placeholder
athlete names, so you can exercise every code path (finished rounds,
not-started rounds, Boulder starting groups, Speed elimination brackets)
without needing a live competition.

## 4. Endpoints actually needed

Only two endpoints are required to build a live results/callzone-style
view; both are read-only GETs, no query params beyond the path IDs.

### 4.1 `GET /api/v1/events/{eventId}`

Returns event metadata. The field that matters:

```jsonc
{
  "d_cats": [
    {
      "dcat_name": "BOULDER U13 m",       // one age-class x discipline combo
      "category_rounds": [
        {
          "category_round_id": 13750,      // the ID you need for §4.2
          "name": "Qualifikation",         // or "Finale", etc — organizer's own text
          "status": "active"               // see §5.4
        }
      ]
    }
  ]
}
```

Use this to enumerate what rounds exist for an event and let a user/caller
pick one — it does not itself contain any live results.

### 4.2 `GET /api/v1/category_rounds/{categoryRoundId}/results`

The live-polling endpoint. Returns the full combined ranking + startlist +
route/bracket structure for **one round**. This single endpoint is
sufficient for a live "who's climbing" view — no need to also call the
more granular per-route endpoints below.

Poll this on an interval matched to how "live" you need it (this repo
polls every 3s client-side, with a 3s server cache) — there's no
documented push/websocket mechanism, only polling.

### 4.3 Other endpoints that exist but aren't needed for this use case

Observed but not used by this app: `/api/v1/live`,
`/api/v1/routes/{id}/startlist`, `/api/v1/routes/{id}/results`,
`/api/v1/starting_groups/{id}/results`, per-athlete pages. §4.2's endpoint
already returns the union of what these provide (ranking + startlist +
routes/groups) in one call, which is why it was chosen over composing the
more granular ones. These are worth knowing exist, in case a future need
(e.g. a single-route-only view) makes the granular version more efficient,
but haven't been characterized in as much depth here.

## 5. Response shape — `category_rounds/{id}/results`

This is the part most likely to trip up a naive integration: **the shape
depends on discipline**, and two fields that look like they should always
exist (`routes`, a `category_round_name`-style title field) sometimes
don't. Field names below are exact, confirmed against live data.

### 5.1 Top-level fields

```jsonc
{
  "category": "U11 w",            // combine with "round" for a human title —
  "round": "Qualifikation",       // there is NO "category_round_name" field, despite the name being tempting to assume
  "discipline": "Lead",           // "Lead" | "Boulder" | "Speed"
  "status": "active",             // "pending" | "active" | "finished" | "under_appeal" — see 5.4
  "routes": [ /* … */ ],          // Lead/Speed-qualification and single-group Boulder — see Quirk A
  "starting_groups": [ /* … */ ], // Boulder-with-groups instead of "routes" — see Quirk A
  "ranking": [ /* … */ ],         // only athletes with ≥1 recorded result — see Quirk B
  "startlist": [ /* … */ ],       // ALL athletes, start order per route
  "speed_elimination_stages": [ /* … */ ] // Speed *finals* only — a completely different shape, see §6
}
```

### 5.2 Quirk A — `routes` vs `starting_groups`

Boulder qualification rounds with a large field are frequently split into
parallel starting groups ("Group A" / "Group B") climbing separate boulders
at the same time. For those rounds, **the top-level `routes` key is absent
entirely** — not an empty array, not present at all — and routes instead
live nested one level down, under `starting_groups[].routes`, with each
route additionally carrying `parent_name` (the group's name).

**Don't assume `round.routes` exists.** Check for `starting_groups` first
(or check both and normalize). A route object's own shape (`id`, `name`,
etc.) is identical whether it came from the top level or from inside a
group.

### 5.3 Quirk B — `ranking` only contains athletes who have started

An athlete with zero recorded results for the round is not present in
`ranking` at all — not present-with-pending-ascents, just absent. If you
need "every athlete", cross-reference `startlist` (which always has all of
them) and treat an athlete missing from `ranking` the same as an explicit
"nothing recorded yet" state.

### 5.4 `round.status` values

Observed values: `"pending"` (not started at all), `"active"` (in
progress), `"finished"`, and `"under_appeal"` (can co-occur with either
finished or in-progress ascent data — a round can be under appeal while
some heats/routes are still being judged). This is a *round-level* signal
only, not per-athlete/per-route — it's the only reliable way to know "has
this round started at all" before falling back to per-ascent inspection.

### 5.5 `ascents[].status` values and what they actually mean

Each athlete's `ranking[].ascents[]` entry (one per route) carries a
`status`:

- `"pending"` — not judged yet, nothing recorded.
- `"active"` — **a judge is live-scoring this attempt right now,
  entered but not yet confirmed.** This is easy to misread as "already
  done" — it is not. During live judging, an athlete can be at the wall (or
  just off it) with a result that's already visible in the API but still
  `"active"`, sometimes for a noticeable stretch of time before someone
  hits "confirm" on the judging side. There's no reliable timeout for this;
  build for `"active"` potentially persisting for a while, by design.
- `"confirmed"` / `"locked"` — fully finalized.

**For Lead/Boulder qualification rounds, `"active"` reliably transitions
to `"confirmed"` in practice** — waiting for that transition (or trusting
the latest `"active"` entry as "currently happening") both work as
inference strategies. **This does *not* hold for Speed elimination heats**
— see §6.3, where `status` is unreliable enough that this codebase ignores
it entirely for that discipline and reads the recorded result fields
directly instead.

### 5.6 Results can be entered out of start order, or never at all

An athlete's ascent can permanently sit at `"pending"` — a no-show,
withdrawal, or an appeal that never resolves — while athletes *later* in
start order already have confirmed results. Don't assume "first
non-pending athlete going forward" or "first pending athlete" is a safe way
to find "who's current" — a permanently-stuck gap earlier in the order
will make that logic never advance. The robust approach (used here, see
§7) is a *frontier*: the position right after the highest-index
already-decided entry, not the first not-yet-decided one.

## 6. Speed elimination — a different shape entirely

Speed **finals** (`round.discipline === "Speed"` combined with a
K.-o./bracket format — identify via
`format_identifier === "speed_elimination_ifsc_2026"`, or simply by
checking whether `speed_elimination_stages` is a non-empty array) have
**no** `routes`, and their `ranking`/`startlist` don't carry the
per-route-ascent shape used elsewhere. Instead:

```jsonc
{
  "speed_elimination_stages": [
    {
      "stage_id": 0,
      "stage_name": "1/8",        // then "1/4", "1/2", "Small Final", "Final"
                                    // (a smaller bracket may start later in
                                    // this sequence, e.g. directly at "1/4" —
                                    // never assume a fixed stage COUNT or
                                    // that index 0 means the same stage
                                    // across two different rounds)
      "heats": [
        {
          "id": 18683,
          "number": 1,              // globally sequential across ALL stages of this bracket
          "athletes": [              // empty [] until results.info has decided this heat's pairing
            {
              "athlete_id": 9283,
              "name": "Mark Twain",  // "Firstname Lastname" here — NOTE this is the
                                      // OPPOSITE order from ranking/startlist elsewhere,
                                      // which use "LASTNAME Firstname"
              "bib": "208",
              "route_name": "A",     // which lane this athlete races in, for THIS heat only
              "ascents": [
                {
                  "route_id": 22299,
                  "status": "pending",          // see 6.3 — do not trust this for done-ness
                  "time_ms": 11108,              // null/0 until a real time is recorded
                  "dnf": false,                  // fell / didn't finish
                  "dns": false,                  // false start
                  "formatted_ascent_score": null // human-readable outcome text — see 6.3
                }
              ],
              "stage_result": { "winner": false, "qualified": false, "time": 11108 }
            }
          ]
        }
      ]
    }
  ]
}
```

### 6.1 Bracket advancement is computed server-side

results.info determines who advances — as soon as a stage is fully judged,
the next stage's heats populate with the real athletes
(`athletes.length` goes from `0` to `2`). You only ever *read* the
bracket; there is no need (and no supported way) to compute advancement
yourself.

### 6.2 A heat is "ready" once both lanes are known

`heat.athletes.length === 2` means the pairing has been decided. Before
that (`length === 0`), it's simply waiting on the previous stage — not an
error state, and worth distinguishing in UI/logic from "this heat will
never happen".

### 6.3 A heat is "done" — but *not* via `status`

This is the single most important gotcha in the whole API. For Speed
elimination heats specifically, `ascents[].status` **does not reliably
reach `"confirmed"`**, even for a heat with a complete, real, valid time on
both lanes, with the stage explicitly closed on the results.info admin
side. It can sit at `"active"`/`"pending"` indefinitely. This is a
discipline-specific quirk — it does *not* apply to Lead/Boulder
qualification rounds (§5.5), only to Speed elimination heats.

**Don't use `status` to decide if a Speed elimination heat is done.**
Instead, inspect the recorded result directly:

- **Either lane is `dns: true` (false start), OR either lane's
  `formatted_ascent_score === "NOT STARTED"`** (a distinct, separate
  outcome from `dns` — a no-show, with `dnf: false, dns: false`, detectable
  *only* via that exact score-text string) → **the heat is decided as a
  "wildcard"**: the other lane wins/advances *without ever getting its own
  ascent touched at all*. That winning lane's ascent can permanently show
  `time_ms: null` (or `0`), no `dnf`/`dns`, `status` stuck at
  `"active"`/`"pending"` — this is the expected, terminal shape for a
  wildcard win, not an unfinished heat. results.info's own results table
  labels this outcome "WILDCARD".
  - **`time_ms === null` alone is *not* a safe "not started" signal** — a
    completely untouched wildcard-*winner* ascent can also show
    `time_ms: null` with no `formatted_ascent_score` set at all. Only the
    exact `formatted_ascent_score === "NOT STARTED"` string, or an
    explicit `dns: true` on the *other* lane, safely identifies this case.
- **A `dnf: true` (fall) does *not* auto-decide the heat** — unlike a false
  start, a fall only settles *that lane's own* result (no more time is
  coming for them); the other lane still needs a real recorded
  `time_ms > 0` before the heat counts as done. Treating `dnf` the same as
  `dns` is a real, previously-made mistake — don't conflate the two.
- **Otherwise, the heat is done once both lanes have a real time**
  (`time_ms > 0`, neither `dnf` nor `dns`) — the normal case.

### 6.4 Finding the "current" heat/stage

Same frontier logic as §5.6, applied to the flattened, stage-ordered,
heat-number-ordered heat list instead of a per-route start order: the
current position is the one right after the **highest-index already-done**
heat (per §6.3's definition of "done"), not the first not-done one — a
heat that never resolves (equipment failure, an unresolved dispute)
shouldn't permanently block recognizing progress made after it. If the
heat at that position exists but isn't yet **ready** (§6.2), the bracket
has simply not caught up yet — a brief, expected transitional state, not
an error or a finished round.

## 7. Boulder rotation and final formats

Boulder qualification, and at least two Boulder *final* formats, share a
mechanic that isn't obvious from the top-level response shape alone: they
rotate athletes through several boulders on a timer, not a single linear
queue per route the way Lead is. The important thing: **results.info
already fully encodes the resulting queue order for you** — no wall-clock
or interval-length knowledge is needed on the consumer side, for any of
the variants below.

### 7.1 The mechanic

Multiple athletes climb different boulders at (or near) the same time,
each moving boulder 1 → 2 → 3 → ... in order, offset from each other in
time. `startlist[].route_start_positions` (§5, Quirk E) gives each athlete
an independent position *per boulder* — sorting a boulder's own entrants
by that value reproduces the exact real arrival order, regardless of how
the physical rotation is paced. Confirmed `format_identifier` values and
their route shapes, from real (if not always populated) DAV test-stage
data:

| `format_identifier` | Shape | Notes |
|---|---|---|
| `boulder_two_groups_ifsc_2026` | `starting_groups[]` (e.g. "Group A"/"Group B"), each with its own `routes[]` | Two groups run the identical rotation in parallel on separate boulder sets. |
| `boulder_one_group_ifsc_2026` | flat `routes[]`, no groups | Single-group sibling of the above — same mechanic, one boulder set. |
| `boulder_one_group_ifsc_2026_two_courses` | flat `routes[]` named e.g. `A1`/`A2`/`A3`/`B1`/`B2` — **no** `starting_groups` | Athletes split into two cohorts that start on Course A or Course B *first*, then swap to the other partway through. Confirmed via real `route_start_positions`: an athlete starting on Course A has low position values on `A1`-`A3` and very high ones on `B1`/`B2` (arriving there only after finishing Course A), and vice versa for the Course-B-first cohort. Both cohorts' data lives in the exact same flat route list - sorting each route's own entrants by position still produces the correct combined queue, including at the exact moment both cohorts are mid-swap. |
| `boulder_finals_ifsc_2026` | flat `routes[]`, no groups | A **parallel** final: for a given athlete, position on boulder *N+1* = position on boulder *N* **+ the boulder count** (e.g. +4 for a 4-boulder final). Multiple boulders can be genuinely simultaneously "live" with different athletes. Has `points_per_boulder_settings` at the round level (points-based scoring). |
| `boulder_finals_one_by_one` | flat `routes[]`, no groups | A **strictly sequential** final: for a given athlete, position on boulder *N+1* = position on boulder *N* **+ the total finalist count** (e.g. +8 for 8 finalists). Boulder *N+1* never gets any real entrant until *every* finalist has gone through boulder *N* - only one boulder is ever "live", one athlete on it. No `points_per_boulder_settings` at the round level as of investigation - likely a different (non-points, Top/zone-count based) scoring mechanism; unverified against real populated ascent data (every round seen so far was still `status: "pending"` with an empty `ranking`). |

The gap size between an athlete's own consecutive-boulder position values
is what tells these apart — the inference algorithm itself (§7.2) never
needs to know which variant it's looking at.

### 7.2 The inference gap this doesn't cover on its own

A boulder can go completely untouched by anyone for a while even after
`round.status` is already `"active"` (an earlier boulder in the rotation
already has real progress) — `round.status` is round-level, not per-route,
so it can't signal "this specific boulder hasn't been reached yet" the way
it signals "the round hasn't started at all" (§5.3's general "not started"
guard). Reproduced with mocked data: without an extra per-route check,
whoever is first in a not-yet-reached boulder's own queue gets shown as
already "current" there — including, in one reproduction, the *same*
athlete showing as current on two different boulders simultaneously (one
correctly, one falsely).

**Fix:** before applying a frontier rule to a given boulder, first check
whether *anyone* in that boulder's own ordered queue has gone active or
been confirmed there yet. If nobody has, treat it exactly like a
not-yet-started round (no current, first-in-queue is "on deck", not
"current") rather than running a frontier rule at all. This one extra
check is sufficient for every rotation/final variant in the table above —
none of them needed a different core algorithm from qualification's, only
this one additional per-route guard before falling through.

**"On deck" for a not-yet-reached boulder needs a group-scoped progress
check, not just the candidate's own prior routes.** An early version
marked the boulder's first-in-queue candidate "on deck" once they were
confirmed on every one of their OWN routes with a lower position value —
correct for a gap-2 qualification rotation, but confirmed wrong for a
World Series-style final (gap = boulder count, at most 2 boulders live at
once): a candidate with only one prior boulder gets confirmed there almost
immediately, well before the target boulder has any real reason to open
(other athletes are still working through the *current* boulder's own
remaining capacity) — that check only looks at the candidate's own
obligations, never at whether the route itself made room. Confirmed
against real `route_start_positions` data across several fixtures that
position values are a literal shared "heat slot" number *within one route
group* (Course A/B, Group A/B, or the whole round if ungrouped) — not a
per-route-independent rank — so the same position value can appear on two
different routes in the same group for two different athletes, meaning
those ascents genuinely happen at the same moment. The correct check: the
candidate is "on deck" once the group's real furthest-progressed position
(the highest position with an active/confirmed ascent anywhere in that
same group) reaches one position before the candidate's own position here.
Scope this per group, not per round — confirmed against real data that two
starting groups each have their own independent position numbering
starting at 1, not a shared round-wide clock; a round-wide check would let
a faster group's progress falsely mark a slower group's candidate "ready"
early.

**Once a boulder has real activity, though, it does NOT use §8's general
frontier rule ("last confirmed + 1 is current") unmodified — confirmed
against real, currently-live-judged data (a real DAV-hosted event, not
test-stage).** §8's rule assumes the athlete after the last confirmed one
is already climbing the instant that confirmation lands. For Boulder,
real judging shows a real gap: an ascent goes `pending` → `active` (the
judge genuinely starts recording a try — a try-counter increment with an
updated timestamp; simply navigating to that athlete's screen does **not**
trigger this) → `confirmed` (save, instantaneous — there is no separate
"judge moved to the next athlete" signal in the API at all). For however
long the next athlete hasn't started a try yet, §8's rule shows them as
current before they've done anything. **Boulder's actual rule:** the last
*confirmed* athlete stays "current" until the *next* one is genuinely
`"active"` — track `lastActive`/`lastConfirmed` indices in the route's own
ordered queue; an `"active"` entry only becomes the new frontier if it
sits *after* `lastConfirmed` (same backward-jump protection as §5.5 — a
judge reopening an earlier score to correct it must not pull the frontier
back past someone already confirmed further along); otherwise the
frontier sticks at `lastConfirmed`, or resolves to "finished" if that's
the last athlete in the queue with nobody active after them.

### 7.3 Open, not-yet-verified questions

- `boulder_finals_one_by_one`'s actual ascent field shape, given it lacks
  `points_per_boulder_settings` unlike every other format above — never
  confirmed against a real populated ascent object.

**Resolved:** whether Boulder ascent `status` reliably transitions to
`"confirmed"` the way it does for Lead qualification, or gets stuck the
way it does for Speed elimination (§6.3) — confirmed against a real,
currently-live-judged Boulder round: it reaches `"confirmed"` reliably,
same as Lead, no Speed-elimination-style stuck state. See §7.2 above for
the transition sequence and the frontier-rule fix it motivated.

## 8. General inference recipe (any discipline)

The qualification-route case (§5), the Speed-elimination case (§6), and
Boulder rotation/finals (§7) all follow the same shape of algorithm, just
over different underlying lists — worth internalizing as the general
pattern for "what's currently happening" against this API:

1. Build an ordered list (start order per route, or heat order per
   bracket).
2. Check the round/stage-level "hasn't started at all" signal first
   (`round.status === "pending"` for qualification rounds) — ascent-level
   data alone can't distinguish "not started" from "first entry currently
   in progress", since both look identical (first position, no result
   yet). For a per-route rotation, this round-level check isn't
   sufficient on its own — see §7.2's extra per-route guard.
3. Scan the list once, remembering the **highest index that counts as
   "done"** per the discipline-appropriate rule (§5.5's active/confirmed
   split for qualification routes; §6.3's result-field check for Speed
   elimination) — not the first index that *isn't* done.
4. "Current" = one position past that highest-done index. If that's past
   the end of the list, everything is finished. If the position exists but
   isn't yet populated/ready, it's a transitional gap, not a finished or
   errored state.

This "last-done-frontier, not first-gap" rule is the load-bearing idea
across the whole API: results.info does not guarantee sequential entry or
guarantee every entry eventually resolves, so any logic assuming otherwise
will eventually get stuck on a permanent gap.

## 9. How to verify a claim in this document

Everything above was checked against live data, but results.info could
change without notice, and there may be states this document hasn't
encountered yet. Before relying on something not covered here, or if
behavior seems to contradict this document:

```bash
curl -s -H "Accept: application/json" \
     -H "Referer: https://dav-stage.results.info/" \
     "https://dav-stage.results.info/api/v1/category_rounds/<id>/results" | less
```

Or, from a browser tab already on `*.results.info` (the site's own Referer
is already correct, so no header juggling needed):

```js
fetch('/api/v1/category_rounds/<id>/results').then(r => r.json()).then(console.log)
```

Prefer reading a real, current response over trusting memory of "how this
should work" — two real bugs in the app this document was extracted from
came from exactly that mistake (assuming a field existed, or assumed a
different discipline's semantics applied universally).
