// Builders for the logic tests: small synthetic rounds (readable expectations)
// and helpers to put real, frozen round snapshots (test/fixtures) into a given
// state ("heat h of the rotation", "k athletes done on this route", ...).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
export const loadFixture = (name) => JSON.parse(fs.readFileSync(path.join(fixtures, `${name}.json`), "utf8"));

export const allRoutes = (round) => (round.routes?.length ? round.routes : (round.starting_groups ?? []).flatMap((g) => g.routes));
export const routeNamed = (round, name) => allRoutes(round).find((r) => r.name === name);

// A synthetic round: athletes with bib "1".."n". On every route the start order
// is the bib order, except on the routes named in `reverse` (n..1).
export function makeRound({ discipline = "Lead", status = "active", routes = ["1"], n = 8, reverse = [], groups = null } = {}) {
  const routeObjs = routes.map((name, i) => ({ id: 100 + i, name }));
  const startlist = Array.from({ length: n }, (_, i) => ({
    athlete_id: i + 1,
    bib: String(i + 1),
    name: `LAST${i + 1} First${i + 1}`,
    firstname: `First${i + 1}`,
    lastname: `Last${i + 1}`,
    route_start_positions: routeObjs.map((r) => ({ route_id: r.id, route_name: r.name, position: reverse.includes(r.name) ? n - i : i + 1 })),
  }));
  const ranking = startlist.map((a) => ({ athlete_id: a.athlete_id, ascents: routeObjs.map((r) => ({ route_id: r.id, status: "pending" })) }));
  const round = { id: 1, status, discipline, startlist, ranking };
  if (groups) round.starting_groups = groups.map((g) => ({ name: g.name, routes: g.routes.map((nm) => routeObjs.find((r) => r.name === nm)) }));
  else round.routes = routeObjs;
  return round;
}

// Set ascent statuses on one route by bib: mark(round, "1", { confirmed: [1,2], active: [3] })
export function mark(round, routeName, spec) {
  const route = routeNamed(round, routeName);
  for (const [status, bibs] of Object.entries(spec)) {
    for (const bib of bibs) {
      const athlete = round.startlist.find((a) => a.bib === String(bib));
      const entry = round.ranking.find((e) => e.athlete_id === athlete.athlete_id);
      entry.ascents.find((a) => a.route_id === route.id).status = status;
    }
  }
  return round;
}

// bibs of one route in start order (plain sorting, independent of app.js)
export function orderBibs(round, routeName) {
  const route = routeNamed(round, routeName);
  return round.startlist
    .map((a) => ({ bib: a.bib, pos: a.route_start_positions.find((p) => p.route_id === route.id)?.position }))
    .filter((x) => x.pos != null)
    .sort((a, b) => a.pos - b.pos)
    .map((x) => x.bib);
}

// Rotation snapshot: on EVERY route (or only the routes in `only`) the ascents
// at a start position below `h` are confirmed, the one at `h` is active, the
// rest pending - "heat h" of a rotation whose start positions are shared slots.
export function heatState(round, h, only = null) {
  const out = structuredClone(round);
  out.status = "active";
  const routes = allRoutes(out);
  const wanted = new Set((only ?? routes.map((r) => r.name)).map(String));
  const idOf = new Map(routes.map((r) => [r.id, r.name]));
  out.ranking = out.startlist.map((a) => ({
    athlete_id: a.athlete_id,
    ascents: a.route_start_positions.map((p) => ({
      route_id: p.route_id,
      status: !wanted.has(String(idOf.get(p.route_id))) ? "pending" : p.position < h ? "confirmed" : p.position === h ? "active" : "pending",
    })),
  }));
  return out;
}

// What the wall shows, reduced to bibs: { at, next, queue (first 5), n (queue length, capped at 5), finished }
export function summary(lane) {
  const bib = (a) => (a ? a.bib : null);
  return { at: bib(lane.atWall), next: bib(lane.onDeck), queue: lane.queue.slice(0, 5).map((a) => (a ? a.bib : null)), n: Math.min(lane.queue.length, 5), finished: !!lane.finished };
}
// compact one-line form for the golden tables: C=climbing, N=next, "-" nothing, F=finished
export function line(lane) {
  return `${lane.finished ? "F" : lane.atWall ? "C" + lane.atWall.bib : "C-"}/${lane.onDeck ? "N" + lane.onDeck.bib : "N-"}`;
}

// first entries of the waiting list, "_" for an empty slot (World Series padding)
export const queueHead = (lane, n = 4) => lane.queue.slice(0, n).map((a) => (a ? a.bib : "_")).join(",");

// every ascent back to "pending" (a snapshot of a finished round -> a fresh one)
export function reset(round, status = "active") {
  const out = structuredClone(round);
  out.status = status;
  // a round without results yet has no ranking rows: build them from the start list
  out.ranking = out.startlist.map((a) => ({ athlete_id: a.athlete_id, ascents: a.route_start_positions.map((p) => ({ route_id: p.route_id, status: "pending" })) }));
  return out;
}
