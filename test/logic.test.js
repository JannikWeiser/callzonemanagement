// ============================================================================
// LOGIK-REGRESSIONSTESTS - "wer ist wann wo" (eingefroren)
//
// These tests pin down the inference of the wall display: who is CLIMBING, who
// is NEXT, who waits, when a route/round/stage is finished. They run the REAL
// public/app.js in a Node vm (test/helpers/app-harness.js) against small
// synthetic rounds and frozen snapshots of real rounds (test/fixtures).
//
// FROZEN: once green, an expectation here is not edited to make a change pass.
// A red test means the change altered who is shown where - fix the CODE, or
// stop and ask the owner (see Tests.md, section 0). Only a NEW test may be
// added; an expectation is replaced only on the owner's explicit decision.
// ============================================================================
import test from "node:test";
import assert from "node:assert/strict";
import { loadApp, plain } from "./helpers/app-harness.js";
import { loadFixture, makeRound, mark, orderBibs, heatState, reset, allRoutes, routeNamed, line, queueHead, summary } from "./helpers/rounds.js";

const app = loadApp();
const QUEUE_MAX = app.get("QUEUE_MAX");
const lead = (round, routeName) => plain(app.fn("computeLane")(round, routeNamed(round, routeName)));
const boulder = (round, routeName, mode) => plain(app.fn("computeBoulderLane")(round, routeNamed(round, routeName), mode));
const bibs = (list) => list.map((n) => String(n));

// ---- Lead / qualification: computeLane ---------------------------------------
test("Lead: a pending round shows nobody at the wall, the first athlete is NEXT", () => {
  const r = makeRound({ status: "pending", n: 6 });
  assert.deepEqual(summary(lead(r, "1")), { at: null, next: "1", queue: bibs([2, 3, 4, 5]).concat("6"), n: 5, finished: false });
});

test("Lead: round started, no result yet - the first athlete is CLIMBING", () => {
  const s = summary(lead(makeRound({ n: 6 }), "1"));
  assert.equal(s.at, "1");
  assert.equal(s.next, "2");
});

test("Lead: after k confirmed results the next athlete in start order is CLIMBING", () => {
  for (const k of [1, 2, 5]) {
    const r = mark(makeRound({ n: 8 }), "1", { confirmed: Array.from({ length: k }, (_, i) => i + 1) });
    const s = summary(lead(r, "1"));
    assert.equal(s.at, String(k + 1), `k=${k}`);
    assert.equal(s.next, String(k + 2), `k=${k}`);
  }
});

test("Lead: a permanently pending gap (no-show) does not block - last confirmed + 1 wins", () => {
  const r = mark(makeRound({ n: 9 }), "1", { confirmed: [5, 6] }); // 1-4 never get a result
  assert.equal(summary(lead(r, "1")).at, "7");
});

test("Lead: an 'active' entry ahead of the confirmed ones is the one on the wall", () => {
  const r = mark(makeRound({ n: 9 }), "1", { confirmed: [1, 2], active: [5] });
  assert.equal(summary(lead(r, "1")).at, "5");
});

test("Lead: with several 'active' entries the LATER one in start order is on the wall", () => {
  const r = mark(makeRound({ n: 9 }), "1", { active: [3, 4] });
  assert.equal(summary(lead(r, "1")).at, "4");
});

test("Lead: re-opening an already confirmed earlier result does not pull the display back", () => {
  const r = mark(makeRound({ n: 9 }), "1", { confirmed: [1, 2, 3, 4, 5], active: [2] });
  assert.equal(summary(lead(r, "1")).at, "6");
});

test("Lead: 'active' alone is NOT done - the athlete stays on the wall until confirmed", () => {
  const r = mark(makeRound({ n: 5 }), "1", { confirmed: [1], active: [2] });
  assert.equal(summary(lead(r, "1")).at, "2");
});

test("Lead: 'locked' counts as done like 'confirmed'", () => {
  const r = mark(makeRound({ n: 5 }), "1", { locked: [1, 2] });
  assert.equal(summary(lead(r, "1")).at, "3");
});

test("Lead: everybody confirmed -> the route is finished", () => {
  const r = mark(makeRound({ n: 4 }), "1", { confirmed: [1, 2, 3, 4] });
  const l = lead(r, "1");
  assert.equal(l.finished, true);
  assert.equal(l.atWall, null);
  assert.equal(l.onDeck, null);
});

test("Lead: the last athlete on the wall has nobody NEXT and the route is not finished yet", () => {
  const r = mark(makeRound({ n: 4 }), "1", { confirmed: [1, 2, 3], active: [4] });
  const l = lead(r, "1");
  assert.equal(l.atWall.bib, "4");
  assert.equal(l.onDeck, null);
  assert.equal(l.finished, false);
});

test("Lead: the waiting list is the next athletes in order, at most QUEUE_MAX", () => {
  const r = makeRound({ n: 40 });
  const l = lead(r, "1");
  assert.equal(l.queue.length, QUEUE_MAX);
  assert.deepEqual(l.queue.slice(0, 3).map((a) => a.bib), ["3", "4", "5"]);
});

test("Lead: two routes run independently, each with its own start order", () => {
  const r = makeRound({ routes: ["1", "2"], n: 6, reverse: ["2"] });
  mark(r, "1", { confirmed: [1, 2, 3] });
  const a = summary(lead(r, "1")), b = summary(lead(r, "2"));
  assert.equal(a.at, "4");
  assert.equal(b.at, "6"); // route 2 starts with the last bib
  assert.equal(b.next, "5");
});

test("Lead on real data (13682, 2 routes): CLIMBING walks through the start order of each route", () => {
  const base = reset(loadFixture("lead-2-routes"));
  for (const route of ["1", "2"]) {
    const order = orderBibs(base, route);
    for (const k of [0, 1, 7, order.length - 1]) {
      const r = structuredClone(base);
      mark(r, route, { confirmed: order.slice(0, k) });
      assert.equal(lead(r, route).atWall.bib, order[k], `route ${route}, ${k} done`);
    }
    const done = structuredClone(base);
    mark(done, route, { confirmed: order });
    assert.equal(lead(done, route).finished, true);
  }
});

// ---- is the whole round finished (sequence advances on this) -------------------
test("isRoundFullyFinished: only when every route of every group is finished", () => {
  const f = app.fn("isRoundFullyFinished");
  const r = makeRound({ routes: ["1", "2"], n: 3 });
  mark(r, "1", { confirmed: [1, 2, 3] });
  assert.equal(f(r), false, "one route still running");
  mark(r, "2", { confirmed: [1, 2, 3] });
  assert.equal(f(r), true);
  assert.equal(f(makeRound({ status: "pending", n: 3 })), false, "a pending round is never finished");
  assert.equal(f(null), false);
});

// ---- Boulder rotation: computeBoulderLane ----------------------------------------
const GOLD_ROTATION = [
  "1:C-/N201 2:C-/N- 3:C-/N- 4:C-/N- 5:C-/N-",
  "1:C201/N202 2:C-/N- 3:C-/N- 4:C-/N- 5:C-/N-",
  "1:C202/N203 2:C-/N201 3:C-/N- 4:C-/N- 5:C-/N-",
  "1:C203/N204 2:C201/N202 3:C-/N- 4:C-/N- 5:C-/N-",
  "1:C204/N205 2:C202/N203 3:C-/N201 4:C-/N- 5:C-/N-",
  "1:C205/N206 2:C203/N204 3:C201/N202 4:C-/N- 5:C-/N-",
  "1:C206/N207 2:C204/N205 3:C202/N203 4:C-/N201 5:C-/N-",
  "1:C207/N208 2:C205/N206 3:C203/N204 4:C201/N202 5:C-/N-",
  "1:C208/N209 2:C206/N207 3:C204/N205 4:C202/N203 5:C-/N201",
  "1:C209/N210 2:C207/N208 3:C205/N206 4:C203/N204 5:C201/N202",
  "1:C210/N211 2:C208/N209 3:C206/N207 4:C204/N205 5:C202/N203",
  "1:C211/N212 2:C209/N210 3:C207/N208 4:C205/N206 5:C203/N204",
  "1:C212/N213 2:C210/N211 3:C208/N209 4:C206/N207 5:C204/N205",
];
test("Boulder rotation (gap 2, 5 boulders): CLIMBING/NEXT of every boulder at every heat", () => {
  const base = loadFixture("boulder-1-group");
  const routes = allRoutes(base);
  GOLD_ROTATION.forEach((expected, h) => {
    const st = heatState(base, h);
    const got = routes.map((rt) => `${rt.name}:${line(boulder(st, rt.name, "interval"))}`).join(" ");
    assert.equal(got, expected, `heat ${h}`);
  });
});

test("Boulder rotation: a boulder nobody has reached yet shows CLIMBING -, NEXT from heat 6, CLIMBING from heat 7 (Boulder 4)", () => {
  const base = loadFixture("boulder-1-group");
  const at = (h) => boulder(heatState(base, h), "4", "interval");
  for (const h of [0, 1, 2, 3, 4, 5]) {
    assert.equal(at(h).atWall, null, `heat ${h}`);
    assert.equal(at(h).onDeck, null, `heat ${h}`);
    assert.ok(at(h).queue.length > 0, "the waiting list stays visible");
  }
  assert.equal(at(6).atWall, null);
  assert.ok(at(6).onDeck, "NEXT appears at heat 6");
  assert.ok(at(7).atWall, "CLIMBING follows at heat 7");
});

test("Boulder: the previous athlete stays CLIMBING until the next one really goes 'active'", () => {
  const r = reset(loadFixture("boulder-1-group"));
  const order = orderBibs(r, "1");
  mark(r, "1", { confirmed: order.slice(0, 3) });
  let l = boulder(r, "1", "interval");
  assert.equal(l.atWall.bib, order[2], "sticks on the last confirmed athlete");
  assert.equal(l.onDeck.bib, order[3]);
  mark(r, "1", { active: [order[3]] });
  l = boulder(r, "1", "interval");
  assert.equal(l.atWall.bib, order[3], "moves on when the next goes active");
});

test("Boulder: re-opening an earlier athlete does not move the frontier backwards", () => {
  const r = reset(loadFixture("boulder-1-group"));
  const order = orderBibs(r, "1");
  mark(r, "1", { confirmed: order.slice(0, 5), active: [order[1]] });
  assert.equal(boulder(r, "1", "interval").atWall.bib, order[4]);
});

test("Boulder: the last athlete confirmed and nobody active after -> Round finished", () => {
  const r = reset(loadFixture("boulder-1-group"));
  const order = orderBibs(r, "1");
  mark(r, "1", { confirmed: order });
  const l = boulder(r, "1", "interval");
  assert.equal(l.finished, true);
  assert.equal(l.atWall, null);
});

test("Boulder: a route that has started never shows an athlete CLIMBING on two boulders at once (rotation)", () => {
  const base = loadFixture("boulder-1-group");
  const routes = allRoutes(base);
  for (let h = 1; h <= 12; h++) {
    const st = heatState(base, h);
    const climbing = routes.map((rt) => boulder(st, rt.name, "interval").atWall?.bib).filter(Boolean);
    assert.equal(new Set(climbing).size, climbing.length, `heat ${h}`);
  }
});

test("Boulder groups: progress in Group A never changes what Group B shows (own position numbering)", () => {
  const base = loadFixture("boulder-two-groups");
  const groupA = base.starting_groups[0].routes.map((r) => r.name);
  const groupB = base.starting_groups[1];
  const withA = heatState(base, 5, null);
  // heatState() would touch both groups - build "progress only in group A" on a clean round
  const onlyA = reset(base);
  const idsA = new Set(base.starting_groups[0].routes.map((r) => r.id));
  for (const e of onlyA.ranking) {
    const a = onlyA.startlist.find((x) => x.athlete_id === e.athlete_id);
    for (const asc of e.ascents) {
      if (!idsA.has(asc.route_id)) continue;
      const pos = a.route_start_positions.find((p) => p.route_id === asc.route_id).position;
      asc.status = pos < 5 ? "confirmed" : pos === 5 ? "active" : "pending";
    }
  }
  const untouched = reset(base);
  for (const rt of groupB.routes) {
    const got = line(plain(app.fn("computeBoulderLane")(onlyA, rt, "interval")));
    const want = line(plain(app.fn("computeBoulderLane")(untouched, rt, "interval")));
    assert.equal(got, want, `Group B boulder ${rt.name}`);
  }
  assert.ok(groupA.length > 0 && withA);
});

test("Boulder 2 Courses: Course A/B are synthesised from the route names (A1.., B1..)", () => {
  const groups = plain(app.fn("collectRouteGroups")(loadFixture("boulder-two-courses")));
  assert.deepEqual(groups.map((g) => g.groupName), ["Course A", "Course B"]);
  assert.deepEqual(groups.map((g) => g.routes.map((r) => r.name)), [["A1", "A2", "A3"], ["B1", "B2"]]);
});

const GOLD_FINAL_INTERVAL = [
  "1:C-/N818[817,804,819,821,803] 2:C-/N-[818,817,804,819,821] 3:C-/N-[818,817,804,819,821] 4:C-/N-[818,817,804,819,821]",
  "1:C818/N817[804,819,821,803,820] 2:C-/N-[818,817,804,819,821] 3:C-/N-[818,817,804,819,821] 4:C-/N-[818,817,804,819,821]",
  "1:C817/N804[819,821,803,820,811] 2:C-/N-[818,817,804,819,821] 3:C-/N-[818,817,804,819,821] 4:C-/N-[818,817,804,819,821]",
  "1:C804/N819[821,803,820,811] 2:C-/N-[818,817,804,819,821] 3:C-/N-[818,817,804,819,821] 4:C-/N-[818,817,804,819,821]",
  "1:C819/N821[803,820,811] 2:C-/N818[817,804,819,821,803] 3:C-/N-[818,817,804,819,821] 4:C-/N-[818,817,804,819,821]",
  "1:C821/N803[820,811] 2:C818/N817[804,819,821,803,820] 3:C-/N-[818,817,804,819,821] 4:C-/N-[818,817,804,819,821]",
  "1:C803/N820[811] 2:C817/N804[819,821,803,820,811] 3:C-/N-[818,817,804,819,821] 4:C-/N-[818,817,804,819,821]",
  "1:C820/N811[] 2:C804/N819[821,803,820,811] 3:C-/N-[818,817,804,819,821] 4:C-/N-[818,817,804,819,821]",
  "1:C811/N-[] 2:C819/N821[803,820,811] 3:C-/N818[817,804,819,821,803] 4:C-/N-[818,817,804,819,821]",
  "1:F/N-[] 2:C821/N803[820,811] 3:C818/N817[804,819,821,803,820] 4:C-/N-[818,817,804,819,821]",
  "1:F/N-[] 2:C803/N820[811] 3:C817/N804[819,821,803,820,811] 4:C-/N-[818,817,804,819,821]",
  "1:F/N-[] 2:C820/N811[] 3:C804/N819[821,803,820,811] 4:C-/N-[818,817,804,819,821]",
  "1:F/N-[] 2:C811/N-[] 3:C819/N821[803,820,811] 4:C-/N818[817,804,819,821,803]",
  "1:F/N-[] 2:F/N-[] 3:C821/N803[820,811] 4:C818/N817[804,819,821,803,820]",
  "1:F/N-[] 2:F/N-[] 3:C803/N820[811] 4:C817/N804[819,821,803,820,811]",
];
test("Boulder final (parallel, 4 boulders), 'Intervall': CLIMBING/NEXT/waiting list at every heat", () => {
  const base = loadFixture("boulder-final-parallel");
  const routes = allRoutes(base);
  GOLD_FINAL_INTERVAL.forEach((expected, h) => {
    const st = heatState(base, h);
    const got = routes.map((rt) => { const l = boulder(st, rt.name, "interval"); return `${rt.name}:${line(l)}[${queueHead(l, 5)}]`; }).join(" ");
    assert.equal(got, expected, `heat ${h}`);
  });
});

const GOLD_FINAL_WS = [
  "1:C-/N818[817,804,819,821,803] 2:C-/N-[_,_,_,818,817] 3:C-/N-[_,_,_,_,_] 4:C-/N-[_,_,_,_,_]",
  "1:C818/N817[804,819,821,803,820] 2:C-/N-[_,_,818,817,804] 3:C-/N-[_,_,_,_,_] 4:C-/N-[_,_,_,_,_]",
  "1:C817/N804[819,821,803,820,811] 2:C-/N-[_,818,817,804,819] 3:C-/N-[_,_,_,_,_] 4:C-/N-[_,_,_,_,_]",
  "1:C804/N819[821,803,820,811] 2:C-/N-[818,817,804,819,821] 3:C-/N-[_,_,_,_,818] 4:C-/N-[_,_,_,_,_]",
  "1:C819/N821[803,820,811] 2:C-/N818[817,804,819,821,803] 3:C-/N-[_,_,_,818,817] 4:C-/N-[_,_,_,_,_]",
  "1:C821/N803[820,811] 2:C818/N817[804,819,821,803,820] 3:C-/N-[_,_,818,817,804] 4:C-/N-[_,_,_,_,_]",
  "1:C803/N820[811] 2:C817/N804[819,821,803,820,811] 3:C-/N-[_,818,817,804,819] 4:C-/N-[_,_,_,_,_]",
  "1:C820/N811[] 2:C804/N819[821,803,820,811] 3:C-/N-[818,817,804,819,821] 4:C-/N-[_,_,_,_,818]",
  "1:C811/N-[] 2:C819/N821[803,820,811] 3:C-/N818[817,804,819,821,803] 4:C-/N-[_,_,_,818,817]",
  "1:F/N-[] 2:C821/N803[820,811] 3:C818/N817[804,819,821,803,820] 4:C-/N-[_,_,818,817,804]",
  "1:F/N-[] 2:C803/N820[811] 3:C817/N804[819,821,803,820,811] 4:C-/N-[_,818,817,804,819]",
  "1:F/N-[] 2:C820/N811[] 3:C804/N819[821,803,820,811] 4:C-/N-[818,817,804,819,821]",
  "1:F/N-[] 2:C811/N-[] 3:C819/N821[803,820,811] 4:C-/N818[817,804,819,821,803]",
  "1:F/N-[] 2:F/N-[] 3:C821/N803[820,811] 4:C818/N817[804,819,821,803,820]",
  "1:F/N-[] 2:F/N-[] 3:C803/N820[811] 4:C817/N804[819,821,803,820,811]",
];
test("Boulder final 'World Series': a far-away candidate rises one slot per heat (blank slots in front)", () => {
  const base = loadFixture("boulder-final-parallel");
  const routes = allRoutes(base);
  GOLD_FINAL_WS.forEach((expected, h) => {
    const st = heatState(base, h);
    const got = routes.map((rt) => { const l = boulder(st, rt.name, "world_series"); return `${rt.name}:${line(l)}[${queueHead(l, 5)}]`; }).join(" ");
    assert.equal(got, expected, `heat ${h}`);
  });
});

test("Boulder final: 'Intervall' and 'World Series' only differ in the waiting list of a not-yet-reached boulder", () => {
  const base = loadFixture("boulder-final-parallel");
  for (let h = 0; h <= 14; h++) {
    const st = heatState(base, h);
    for (const rt of allRoutes(base)) {
      const a = boulder(st, rt.name, "interval"), b = boulder(st, rt.name, "world_series");
      assert.equal(line(a), line(b), `heat ${h}, boulder ${rt.name}: CLIMBING/NEXT must be identical`);
      if (a.atWall) assert.deepEqual(a.queue, b.queue, `heat ${h}, boulder ${rt.name}: a reached boulder renders the same`);
    }
  }
});

const GOLD_ONE_BY_ONE = [
  "1:C-/N921 2:C-/N- 3:C-/N- 4:C-/N-",
  "1:C921/N916 2:C-/N- 3:C-/N- 4:C-/N-",
  "1:C916/N914 2:C-/N- 3:C-/N- 4:C-/N-",
  "1:C914/N905 2:C-/N- 3:C-/N- 4:C-/N-",
  "1:C905/N918 2:C-/N- 3:C-/N- 4:C-/N-",
  "1:C918/N912 2:C-/N- 3:C-/N- 4:C-/N-",
  "1:C912/N903 2:C-/N- 3:C-/N- 4:C-/N-",
  "1:C903/N906 2:C-/N- 3:C-/N- 4:C-/N-",
  "1:C906/N- 2:C-/N921 3:C-/N- 4:C-/N-",
  "1:F/N- 2:C921/N916 3:C-/N- 4:C-/N-",
  "1:F/N- 2:C916/N914 3:C-/N- 4:C-/N-",
  "1:F/N- 2:C914/N905 3:C-/N- 4:C-/N-",
  "1:F/N- 2:C905/N918 3:C-/N- 4:C-/N-",
  "1:F/N- 2:C918/N912 3:C-/N- 4:C-/N-",
  "1:F/N- 2:C912/N903 3:C-/N- 4:C-/N-",
];
test("Boulder final (one by one): boulder N+1 only opens after EVERY finalist went through boulder N", () => {
  const base = loadFixture("boulder-final-one-by-one");
  const routes = allRoutes(base);
  GOLD_ONE_BY_ONE.forEach((expected, h) => {
    const st = heatState(base, h);
    const got = routes.map((rt) => `${rt.name}:${line(boulder(st, rt.name, "interval"))}`).join(" ");
    assert.equal(got, expected, `heat ${h}`);
  });
});

test("isBoulderFinalRound: only Boulder FINALS (not qualification, not other disciplines)", () => {
  const f = app.fn("isBoulderFinalRound");
  assert.equal(f({ discipline: "Boulder", format_identifier: "boulder_finals_ifsc_2026" }), true);
  assert.equal(f({ discipline: "Boulder", format_identifier: "boulder_finals_one_by_one" }), true);
  assert.equal(f({ discipline: "Boulder", format_identifier: "boulder_one_group_ifsc_2026" }), false);
  assert.equal(f({ discipline: "Lead", format_identifier: "boulder_finals_ifsc_2026" }), false);
});

// ---- Speed qualification: both lanes race the same heat ---------------------------------
test("Speed qualification: both lanes follow the SLOWER lane (position N on A races position N on B)", () => {
  const q = loadFixture("speed-quali");
  const r = reset(q);
  mark(r, "A", { confirmed: orderBibs(r, "A").slice(0, 8) });
  mark(r, "B", { confirmed: orderBibs(r, "B").slice(0, 3) });
  const shared = app.fn("speedQualificationSharedIndex")(r);
  assert.equal(shared, 3);
  const a = plain(app.fn("computeSpeedQualificationLane")(r, routeNamed(r, "A"), shared));
  const b = plain(app.fn("computeSpeedQualificationLane")(r, routeNamed(r, "B"), shared));
  assert.equal(a.atWall.bib, orderBibs(r, "A")[3]);
  assert.equal(b.atWall.bib, orderBibs(r, "B")[3]);
  assert.equal(a.onDeck.bib, orderBibs(r, "A")[4]);
  assert.equal(b.onDeck.bib, orderBibs(r, "B")[4]);
});

test("Speed qualification: pending shows nobody at the wall; everybody done -> finished", () => {
  const q = loadFixture("speed-quali");
  const pending = reset(q, "pending");
  const lane = plain(app.fn("computeSpeedQualificationLane")(pending, routeNamed(pending, "A"), 0));
  assert.equal(lane.atWall, null);
  assert.equal(lane.onDeck.bib, orderBibs(pending, "A")[0]);
  const done = reset(q);
  for (const route of ["A", "B"]) mark(done, route, { confirmed: orderBibs(done, route) });
  const shared = app.fn("speedQualificationSharedIndex")(done);
  assert.equal(plain(app.fn("computeSpeedQualificationLane")(done, routeNamed(done, "A"), shared)).finished, true);
});

// ---- Speed elimination (K.o.) -----------------------------------------------------------
const ascent = (o = {}) => ({ time_ms: 0, dnf: false, dns: false, status: "pending", formatted_ascent_score: null, ...o });
const heatOf = (a = {}, b = {}, bibA = "1", bibB = "2") => ({ athletes: [{ route_name: "A", bib: bibA, ascents: [ascent(a)] }, { route_name: "B", bib: bibB, ascents: [ascent(b)] }] });
const done = (ms = 6000) => ({ time_ms: ms, status: "confirmed" });

test("Speed heat: done when both lanes have a time", () => {
  assert.equal(app.fn("heatIsDone")(heatOf(done(), done(6100))), true);
});
test("Speed heat: one lane without a time is not done", () => {
  assert.equal(app.fn("heatIsDone")(heatOf(done(), {})), false);
});
test("Speed heat: the ascent STATUS is ignored (a complete result stays 'active' forever on results.info)", () => {
  assert.equal(app.fn("heatIsDone")(heatOf({ time_ms: 6000, status: "active" }, { time_ms: 6100, status: "active" })), true);
});
test("Speed heat: a false start (dns) decides the whole heat on its own - the other lane never gets a result", () => {
  assert.equal(app.fn("heatIsDone")(heatOf({ dns: true }, {})), true);
  assert.equal(app.fn("heatIsDone")(heatOf({}, { dns: true })), true);
});
test("Speed heat: 'NOT STARTED' decides the heat; a bare empty ascent (time null) does NOT", () => {
  assert.equal(app.fn("heatIsDone")(heatOf({ formatted_ascent_score: "NOT STARTED" }, {})), true);
  assert.equal(app.fn("heatIsDone")(heatOf({ time_ms: null }, {})), false);
});
test("Speed heat: a fall (dnf) only settles that lane - the other lane still needs a time", () => {
  assert.equal(app.fn("heatIsDone")(heatOf({ dnf: true }, {})), false);
  assert.equal(app.fn("heatIsDone")(heatOf({ dnf: true }, done())), true);
});
test("Speed heat: a heat with fewer than two athletes is not ready and never done", () => {
  const one = { athletes: [{ route_name: "A", bib: "1", ascents: [ascent(done())] }] };
  assert.equal(app.fn("heatIsReady")(one), false);
  assert.equal(app.fn("heatIsDone")(one), false);
});

function bracket() {
  const stage = (name, n, pairs) => ({ stage_name: name, heats: Array.from({ length: n }, (_, i) => (pairs ? heatOf({}, {}, String(i * 2 + 1), String(i * 2 + 2)) : { athletes: [] })) });
  return { status: "active", discipline: "Speed", speed_elimination_stages: [stage("1/4", 4, true), stage("1/2", 2, false), stage("Final", 1, false)] };
}
test("Speed elimination: the current stage and its remaining heats", () => {
  const r = bracket();
  let s = plain(app.fn("computeSpeedElimination")(r));
  assert.equal(s.stageName, "1/4");
  assert.equal(s.heats.length, 4);
  Object.assign(r.speed_elimination_stages[0].heats[0].athletes[0].ascents[0], done());
  Object.assign(r.speed_elimination_stages[0].heats[0].athletes[1].ascents[0], done(6200));
  s = plain(app.fn("computeSpeedElimination")(r));
  assert.equal(s.heats.length, 3, "a finished heat drops out");
  assert.equal(s.heats[0].athletes[0].bib, "3");
});
test("Speed elimination: when the next stage is not paired yet nothing is shown (and it is NOT finished)", () => {
  const r = bracket();
  for (const h of r.speed_elimination_stages[0].heats) h.athletes.forEach((a) => Object.assign(a.ascents[0], done()));
  const s = plain(app.fn("computeSpeedElimination")(r));
  assert.deepEqual(s, { finished: false, stageName: null, heats: [] });
});
test("Speed elimination: every heat done -> finished", () => {
  const r = bracket();
  for (const st of r.speed_elimination_stages) for (const h of st.heats) { if (!h.athletes.length) h.athletes = heatOf().athletes; h.athletes.forEach((a) => Object.assign(a.ascents[0], done())); }
  assert.equal(plain(app.fn("computeSpeedElimination")(r)).finished, true);
});
test("Speed elimination on real data (13739): stage 1/4 with 4 heats left, A:208 vs B:218 first", () => {
  const s = plain(app.fn("computeSpeedElimination")(loadFixture("speed-final")));
  assert.equal(s.stageName, "1/4");
  assert.equal(s.heats.length, 4);
  assert.deepEqual(s.heats[0].athletes.map((a) => `${a.route_name}:${a.bib}`), ["A:208", "B:218"]);
});
test("Speed elimination on real data (13748): a completely judged bracket is finished", () => {
  assert.equal(plain(app.fn("computeSpeedElimination")(loadFixture("speed-final-u13"))).finished, true);
});

test("Paired entries: both sides stay on the EARLIER stage (by stage name, not by array index)", () => {
  const e = app.fn("earlierStageName");
  assert.equal(e("1/4", "1/8"), "1/8");
  assert.equal(e("1/8", "1/4"), "1/8");
  assert.equal(e("Final", "Small Final"), "Small Final");
  assert.equal(e("1/2", "Small Final"), "1/2");
  assert.equal(e("1/4", "1/4"), "1/4");
  assert.equal(e(null, "1/4"), "1/4", "a side without a stage never blocks the other");
  assert.equal(e("1/4", null), "1/4");
  assert.equal(e("Weird", "1/4"), "1/4", "an unknown stage name sorts last");
});
test("Paired entries: a round that has not started reports no stage (even if its skeleton exists)", () => {
  const r = bracket();
  r.status = "pending";
  assert.equal(app.fn("currentStageNameFor")(r), null);
  r.status = "active";
  assert.equal(app.fn("currentStageNameFor")(r), "1/4");
});
test("Speed stage helpers: stageHeatsRemaining is scoped to ONE stage, isLastSpeedStage only for the last", () => {
  const r = bracket();
  assert.equal(plain(app.fn("stageHeatsRemaining")(r, "1/4")).heats.length, 4);
  assert.equal(plain(app.fn("stageHeatsRemaining")(r, "1/2")).heats.length, 0, "not paired yet");
  assert.equal(app.fn("isLastSpeedStage")(r, "Final"), true);
  assert.equal(app.fn("isLastSpeedStage")(r, "1/2"), false);
});

// ---- route groups -------------------------------------------------------------------------
test("collectRouteGroups: plain routes, starting groups, Boulder courses - and never course tabs for Lead/Speed", () => {
  const g = (round) => plain(app.fn("collectRouteGroups")(round)).map((x) => [x.groupName, x.routes.map((r) => r.name)]);
  assert.deepEqual(g(makeRound({ routes: ["1", "2"] })), [[null, ["1", "2"]]]);
  assert.deepEqual(g(makeRound({ discipline: "Boulder", routes: ["1", "2", "3"], groups: [{ name: "Group A", routes: ["1", "2"] }, { name: "Group B", routes: ["3"] }] })), [["Group A", ["1", "2"]], ["Group B", ["3"]]]);
  assert.deepEqual(g(makeRound({ discipline: "Boulder", routes: ["A1", "A2", "B1"] })), [["Course A", ["A1", "A2"]], ["Course B", ["B1"]]]);
  assert.deepEqual(g(makeRound({ discipline: "Lead", routes: ["A1", "A2", "B1"] })), [[null, ["A1", "A2", "B1"]]], "the discipline check is the guarantee");
  assert.deepEqual(g({ discipline: "Boulder" }), []);
});

// ---- names ---------------------------------------------------------------------------------
test("Names: '#bib · name', a bib of 0 is kept, no bib -> just the name, nobody -> empty", () => {
  const f = app.fn("athleteLine");
  assert.equal(f({ bib: "12", name: "TWAIN Mark" }), "#12 · TWAIN Mark");
  assert.equal(f({ bib: 0, name: "TWAIN Mark" }), "#0 · TWAIN Mark");
  assert.equal(f({ bib: "", name: "TWAIN Mark" }), "TWAIN Mark");
  assert.equal(f(null), "");
  const h = app.fn("heatAthleteLine");
  assert.equal(h({ bib: "208", lastname: "Twain", firstname: "Mark" }), "#208 · TWAIN Mark");
  assert.equal(h(null), "");
});

// ---- next category preview -------------------------------------------------------------------
test("Next-category preview: pads the waiting list with a blank gap and the next round's names", () => {
  const current = makeRound({ routes: ["1"], n: 5 });
  const next = makeRound({ routes: ["1"], n: 40 });
  app.set("nextRoundPreview", next);
  try {
    const route = routeNamed(next, "1");
    const lane = { routeName: "1", finished: false, atWall: { bib: "5" }, onDeck: null, queue: [] };
    const out = plain(app.fn("withNextCategoryPreview")(lane, route));
    assert.equal(out.atWall.bib, "5", "never touches CLIMBING");
    assert.equal(out.onDeck, null, "never fills NEXT");
    assert.equal(out.queue[0], null, "a blank gap first");
    assert.deepEqual(out.queue.slice(1, 4).map((x) => x.preview.bib), ["1", "2", "3"]);
    assert.equal(out.queue.length, 1 + QUEUE_MAX, "gap + preview up to QUEUE_MAX places");
    const full = { ...lane, queue: next.startlist.slice(0, QUEUE_MAX) };
    assert.equal(plain(app.fn("withNextCategoryPreview")(full, route)).queue.length, QUEUE_MAX, "a full list gets no preview");
    assert.equal(plain(app.fn("withNextCategoryPreview")({ ...lane, finished: true }, route)).queue.length, 0, "a finished lane gets none");
    assert.ok(current);
  } finally {
    app.set("nextRoundPreview", null);
  }
});

test("Next-category preview: without a preview round nothing changes", () => {
  const lane = { routeName: "1", finished: false, atWall: { bib: "5" }, onDeck: null, queue: [{ bib: "6" }] };
  assert.deepEqual(plain(app.fn("withNextCategoryPreview")(lane, { id: 1 })), plain(lane));
});

// ---- this tablet's own route order (6.53) ---------------------------------------------------
test("Route order: listed routes first in the given order, the others keep their natural order after them", () => {
  const f = app.fn("applyRouteOrder");
  const items = ["1", "2", "3", "4", "5"].map((name) => ({ name }));
  const names = (order) => plain(f(items, (r) => r.name, order)).map((r) => r.name).join(",");
  assert.equal(names(["3", "1"]), "3,1,2,4,5");
  assert.equal(names(["5", "4", "3", "2", "1"]), "5,4,3,2,1");
  assert.equal(names(["2", "1", "3", "4", "5"]), "2,1,3,4,5");
  assert.equal(names(["9", "2"]), "2,1,3,4,5", "a name that does not exist is ignored");
});
test("Route order: no order (null/empty) returns the same list untouched", () => {
  const f = app.fn("applyRouteOrder");
  const items = [{ name: "1" }, { name: "2" }];
  assert.equal(f(items, (r) => r.name, null), items);
  assert.equal(f(items, (r) => r.name, []), items);
});
test("Route order never changes who is where: the lanes only change place", () => {
  const base = reset(loadFixture("boulder-1-group"));
  const st = heatState(base, 7);
  const routes = allRoutes(st);
  const byName = (list) => Object.fromEntries(list.map((r) => [r.name, line(boulder(st, r.name, "interval"))]));
  const ordered = plain(app.fn("applyRouteOrder")(routes, (r) => r.name, ["5", "3", "1"]));
  assert.deepEqual(ordered.map((r) => r.name), ["5", "3", "1", "2", "4"]);
  assert.deepEqual(byName(ordered), byName(routes));
});

// ---- Lead: athletes who did not start (DNS) are skipped (6.54) --------------------------------
// results.info marks them with `score: "DNS"` on the ascent (real round 13519); the status stays "pending".
const dns = (round, routeName, bibList) => {
  const route = routeNamed(round, routeName);
  for (const bib of bibList) {
    const a = round.startlist.find((x) => x.bib === String(bib));
    round.ranking.find((e) => e.athlete_id === a.athlete_id).ascents.find((x) => x.route_id === route.id).score = "DNS";
  }
  return round;
};
const laneBibs = (l) => [l.atWall?.bib ?? null, l.onDeck?.bib ?? null, ...l.queue.map((a) => a?.bib)];

test("DNS: a DNS athlete in the middle of the start order is skipped", () => {
  const r = dns(mark(makeRound({ n: 7 }), "1", { confirmed: [1, 2] }), "1", [3]);
  assert.deepEqual(laneBibs(lead(r, "1")), ["4", "5", "6", "7"]);
});
test("DNS: a DNS athlete is never NEXT - the next athlete after him is", () => {
  const r = dns(mark(makeRound({ n: 6 }), "1", { confirmed: [1], active: [2] }), "1", [3]);
  const l = lead(r, "1");
  assert.equal(l.atWall.bib, "2");
  assert.equal(l.onDeck.bib, "4");
});
test("DNS: two DNS athletes in a row are both skipped", () => {
  const r = dns(mark(makeRound({ n: 7 }), "1", { confirmed: [1] }), "1", [2, 3]);
  assert.deepEqual(laneBibs(lead(r, "1")), ["4", "5", "6", "7"]);
});
test("DNS: a DNS athlete at the END does not keep the route from finishing", () => {
  const r = dns(mark(makeRound({ routes: ["1", "2"], n: 5 }), "1", { confirmed: [1, 2, 3, 4] }), "1", [5]);
  const l = lead(r, "1");
  assert.equal(l.finished, true);
  assert.equal(l.atWall, null);
  mark(r, "2", { confirmed: [1, 2, 3, 4, 5] });
  assert.equal(app.fn("isRoundFullyFinished")(r), true, "the sequence can move on");
});
test("DNS: a pending round does not offer a DNS athlete as NEXT", () => {
  const r = dns(makeRound({ status: "pending", n: 4 }), "1", [1]);
  const l = lead(r, "1");
  assert.equal(l.atWall, null);
  assert.equal(l.onDeck.bib, "2");
});
test("DNS: is per route - an athlete who is DNS on route 1 only still waits on route 2", () => {
  const r = dns(makeRound({ routes: ["1", "2"], n: 4 }), "1", [2]);
  assert.deepEqual(laneBibs(lead(r, "1")), ["1", "3", "4"]);
  assert.deepEqual(laneBibs(lead(r, "2")), ["1", "2", "3", "4"]);
});
test("DNS: an ascent that is 'active' is never hidden, whatever its score says", () => {
  const r = dns(mark(makeRound({ n: 4 }), "1", { confirmed: [1], active: [2] }), "1", [2]);
  assert.equal(lead(r, "1").atWall.bib, "2");
});
test("DNS: no DNS marker anywhere changes nothing (the frozen scenarios above stay valid)", () => {
  const r = mark(makeRound({ n: 6 }), "1", { confirmed: [1, 2] });
  assert.deepEqual(laneBibs(lead(r, "1")), ["3", "4", "5", "6"]);
});
test("DNS on real data (13519, DM Darmstadt): route 1 FLOHÉ #22, route 2 starts again with #1 and #4 (BICKNELL, DNS) is skipped", () => {
  const r = loadFixture("lead-two-pass-dns");
  const r1 = lead(r, "1"), r2 = lead(r, "2");
  assert.deepEqual(laneBibs(r1).slice(0, 5), ["22", "23", "24", "25", "26"]);
  assert.deepEqual(laneBibs(r2).slice(0, 6), ["1", "2", "3", "5", "6", "7"]);
  assert.ok(!laneBibs(r2).includes("4"), "BICKNELL never appears on route 2");
  assert.equal(r1.finished || r2.finished, false);
});

// ---- Split View: the route order per column in the tablet link (6.53) -------------------------
test("Column order link: 'corder' parses to one list per column, empty = natural", () => {
  const parse = app.fn("colOrderFromParam");
  assert.deepEqual(plain(parse("2+1+3*2+1")), [["2", "1", "3"], ["2", "1"]]);
  assert.deepEqual(plain(parse("*3+1")), [null, ["3", "1"]]);
  assert.equal(parse(""), null);
  assert.equal(parse(null), null);
  assert.equal(parse("*"), null, "no column has an order");
});
test("Column order link: building and parsing give the same thing back", () => {
  const parse = app.fn("colOrderFromParam"), build = app.fn("colOrderToParam");
  for (const colOrder of [[["2", "1"], null], [null, ["A2", "A1", "A3"]], [["3", "2", "1"], ["2", "1"], null]]) {
    assert.deepEqual(plain(parse(build(colOrder))), plain(colOrder));
  }
  assert.equal(build(null), null);
  assert.equal(build([null, null]), null, "nothing to write when no column has an order");
});

// ---- a finished lane lists the first names of the next category (6.55) -----------------------
test("Next Category: a finished lane gets the first 7 names of the next round's matching route", () => {
  const next = makeRound({ routes: ["1", "2"], n: 20 });
  app.set("nextRoundPreview", next);
  try {
    const finished = { routeName: "1", finished: true, atWall: null, onDeck: null, queue: [] };
    const out = plain(app.fn("withNextCategoryPreview")(finished, routeNamed(next, "1")));
    assert.equal(out.finished, true, "stays 'Round finished'");
    assert.equal(out.atWall, null);
    assert.equal(out.onDeck, null, "CLIMBING/NEXT are never filled");
    assert.deepEqual(out.queue, []);
    assert.deepEqual(out.nextCategory.map((a) => a.bib), ["1", "2", "3", "4", "5", "6", "7"]);
    const rev = makeRound({ routes: ["1", "2"], n: 20, reverse: ["2"] });
    app.set("nextRoundPreview", rev);
    assert.deepEqual(plain(app.fn("withNextCategoryPreview")(finished, routeNamed(rev, "2"))).nextCategory.map((a) => a.bib), ["20", "19", "18", "17", "16", "15", "14"], "that lane's own start order");
  } finally {
    app.set("nextRoundPreview", null);
  }
});
test("Next Category: fewer than 7 athletes in the next round shows them all; none -> nothing added", () => {
  const few = makeRound({ n: 3 });
  app.set("nextRoundPreview", few);
  try {
    const finished = { routeName: "1", finished: true, atWall: null, onDeck: null, queue: [] };
    assert.equal(plain(app.fn("withNextCategoryPreview")(finished, routeNamed(few, "1"))).nextCategory.length, 3);
    const empty = makeRound({ n: 0 });
    app.set("nextRoundPreview", empty);
    assert.equal(plain(app.fn("withNextCategoryPreview")(finished, routeNamed(empty, "1"))).nextCategory, undefined);
  } finally {
    app.set("nextRoundPreview", null);
  }
});
test("Next Category: DNS athletes of the next round are left out here too", () => {
  const next = dns(makeRound({ n: 10 }), "1", [2]);
  app.set("nextRoundPreview", next);
  try {
    const finished = { routeName: "1", finished: true, atWall: null, onDeck: null, queue: [] };
    assert.deepEqual(plain(app.fn("withNextCategoryPreview")(finished, routeNamed(next, "1"))).nextCategory.map((a) => a.bib), ["1", "3", "4", "5", "6", "7", "8"]);
  } finally {
    app.set("nextRoundPreview", null);
  }
});
test("Next Category: no preview round or no matching route (lane count differs) -> a finished lane stays as it was", () => {
  const finished = { routeName: "1", finished: true, atWall: null, onDeck: null, queue: [] };
  assert.deepEqual(plain(app.fn("withNextCategoryPreview")(finished, { id: 1 })), plain(finished), "no next round loaded");
  app.set("nextRoundPreview", makeRound({ n: 5 }));
  try {
    assert.deepEqual(plain(app.fn("withNextCategoryPreview")(finished, undefined)), plain(finished), "previewRoute is undefined when the lane counts differ");
  } finally {
    app.set("nextRoundPreview", null);
  }
});
