// One-off helper (NOT part of `npm test`): re-downloads the trimmed round
// snapshots in test/fixtures from a running Callzone server.
//   PORT=4175 node server.js &   node scripts/refresh-fixtures.mjs
// The snapshots are FROZEN on purpose: the logic tests compare against them, so
// only refresh one if the tests were written against the new state.
import fs from "node:fs";
const base = process.env.BASE ?? "http://localhost:4175";
const rounds = { "lead-2-routes": 13682, "boulder-two-groups": 13709, "boulder-two-courses": 13711, "boulder-1-group": 13712, "boulder-final-parallel": 13735, "boulder-final-one-by-one": 13736, "speed-quali": 13719, "speed-final": 13739, "speed-final-u13": 13748 };
const keep = (a) => ({ athlete_id: a.athlete_id, bib: a.bib, name: a.name, firstname: a.firstname, lastname: a.lastname, route_start_positions: a.route_start_positions });
for (const [name, id] of Object.entries(rounds)) {
  const r = await fetch(`${base}/api/round/stage/${id}`).then((x) => x.json());
  const out = {
    id, status: r.status, discipline: r.discipline, format_identifier: r.format_identifier, category: r.category, round: r.round,
    routes: r.routes, starting_groups: r.starting_groups,
    startlist: (r.startlist ?? []).map(keep),
    ranking: (r.ranking ?? []).map((e) => ({ athlete_id: e.athlete_id, ascents: (e.ascents ?? []).map((a) => ({ route_id: a.route_id, status: a.status })) })),
    speed_elimination_stages: r.speed_elimination_stages,
  };
  fs.writeFileSync(new URL(`../test/fixtures/${name}.json`, import.meta.url), JSON.stringify(out));
  console.log(name, id, r.discipline, r.status, (r.startlist ?? []).length, JSON.stringify(out).length);
}
