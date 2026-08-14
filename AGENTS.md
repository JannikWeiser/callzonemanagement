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
- `collectRouteGroups()` handling both `round.routes` and
  `round.starting_groups[].routes` — Boulder-with-groups rounds have no
  `routes` field at all; assuming it always exists breaks those rounds.
- `queue.setAttribute("start", "2")` — intentional, not a stray leftover.
- The `[hidden] { display: none !important; }` rule in `styles.css` —
  needed because a more specific `.setup-row { display: flex }` rule was
  silently overriding the default `[hidden]` behavior.

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
| `stage` | 1594 | `13740` (SPEED Damen+ Finale) | Speed elimination round with `status: "pending"` and no bracket generated yet — baseline "no bracket data" case |
| `prod` | `2101` "KidsCup Hessen Bouldern + Lead Gießen" | — | Real `dav.results.info` event structure, all rounds pending as of investigation |
| `ifsc` | `1518` "World Climbing Asia Youth Series Quannan 2026" | — | Real `ifsc.results.info` event structure confirmation |
| `stage` | 1595 "Anleitung CallzoneManagement" | `13750` (LEAD Damen+ Quali) | **The "at the wall" frontier bug, reproduced.** Route 1 has confirmed results at positions 4,5,6,7,9 but permanently-pending gaps at 1,2,3,8 (simulated no-shows) — the correct "at the wall" is position 10 (STEIN), not position 1. Built by the user specifically to demonstrate this bug; keep this round's data shape in mind (or a fresh equivalent) whenever touching `computeLane()`'s frontier logic. |
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
for the full list and reasoning (a visual bracket tree, the Speed-training
manual mode, a language switcher, auth, a database, write access to
results.info). If a user report sounds like it needs one of these, say so
and ask before implementing rather than silently
scoping it in.

## 8. Keeping docs in sync

Whenever you change behavior in `app.js` or `server.js`:
- Add a `CHANGELOG.md` entry (Unreleased section, mirror the existing entry
  style: what broke / what changed, one line, link to the relevant
  ARCHITECTURE.md section for the reasoning).
- If the change touches something ARCHITECTURE.md documents, update that
  section in the same pass — a stale architecture doc is worse than none,
  because it will be trusted.
