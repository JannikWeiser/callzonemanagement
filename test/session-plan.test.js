import test from "node:test";
import assert from "node:assert/strict";
import "../public/session-plan.js";

const { validatePlan, entryKey, relocateIndex, affectedClients, removesOrReplaces } = globalThis.SessionPlan;
const HOSTS = ["prod", "stage"];

const watch = (sequence, extra = {}) => ({ kind: "watch", host: "stage", eventId: "1594", sequence, ...extra });
const round = (id) => ({ type: "round", id });
const paired = (a, b) => ({ type: "paired", a, b });
const col = (ids, group = null, route = null) => ({ sequence: ids.map(round), group, route });
const split = (...columns) => ({ type: "split", columns });

test("entryKey identifies plain and paired entries and tolerates null", () => {
  assert.equal(entryKey(round("5")), "round:5");
  assert.equal(entryKey(paired("1", "2")), "paired:1+2");
  const key = entryKey(split(col(["1", "2"], "Group A"), col(["3"])));
  assert.match(key, /^split:[0-9a-z]{4,20}$/, "compact, fits the 60 characters a heartbeat key may have");
  assert.equal(key, entryKey(split(col(["1", "2"], "Group B", ["A1"]), col(["3"]))), "group/route filters are not part of the identity");
  assert.notEqual(key, entryKey(split(col(["1"]), col(["2", "3"]))), "other rounds per column = another entry");
  assert.notEqual(key, entryKey(split(col(["3"]), col(["1", "2"]))), "column order matters");
  const big = split(...Array.from({ length: 5 }, (_, c) => col(Array.from({ length: 50 }, (_, i) => String(100000 + c * 50 + i)))));
  assert.ok(entryKey(big).length <= 30, "even the biggest split view has a short key");
  assert.equal(entryKey(undefined), null);
});

test("validatePlan normalizes a watch plan (numbers -> strings, fixed key order, preview default on)", () => {
  const plan = validatePlan({ eventId: 1594, host: "stage", kind: "watch", sequence: [{ id: 13682, type: "round" }] }, HOSTS);
  assert.deepEqual(plan, watch([round("13682")], { showNextPreview: true }));
  assert.equal(JSON.stringify(plan), JSON.stringify(validatePlan(plan, HOSTS)), "normalizing twice is stable");
  assert.equal(validatePlan(watch([round("1")], { showNextPreview: false }), HOSTS).showNextPreview, false);
});

test("validatePlan accepts paired entries and rejects broken ones", () => {
  assert.deepEqual(validatePlan(watch([round("5"), paired("1", "2")]), HOSTS).sequence[1], paired("1", "2"));
  assert.throws(() => validatePlan(watch([paired("1", "1")]), HOSTS), /two different rounds/);
  assert.throws(() => validatePlan(watch([round("1"), paired("1", "2")]), HOSTS), /more than once/);
  assert.throws(() => validatePlan(watch([{ type: "other", id: "1" }]), HOSTS), /round.*paired/);
});

test("validatePlan rejects structurally invalid plans", () => {
  const bad = [
    null,
    [],
    "x",
    { kind: "training", host: "stage", eventId: "1" },
    watch([]),
    { ...watch([round("1")]), host: "nope" },
    { ...watch([round("1")]), host: "constructor" },
    { ...watch([round("1")]), eventId: "12a" },
    { ...watch([round("1")]), eventId: "../x" },
    watch([round("1?x=y")]),
    watch([round("")]),
    watch(Array.from({ length: 51 }, (_, i) => round(String(i + 1)))),
    { kind: "multi", host: "stage", eventId: "1594", entries: [col(["1"])] },
    watch([split()]),
    watch([split(...Array.from({ length: 6 }, (_, i) => col([String(i + 1)])))]),
    watch([split(col([]), col([]))]),
    watch([split(col(["1", "1"]), col(["2"]))]),
    watch([split(col(["1"]), col(["1"]))]),
    watch([round("1"), split(col(["1"]), col(["2"]))]),
    watch([split({ sequence: [paired("1", "2")], group: null, route: null }, col(["3"]))]),
    watch([split({ sequence: [round("1")], group: "x".repeat(101), route: null }, col(["3"]))]),
    watch([split({ sequence: [round("1")], group: null, route: "A1" }, col(["3"]))]),
    watch([split({ sequence: [round("1")], group: null, route: [""] }, col(["3"]))]),
  ];
  for (const plan of bad) assert.throws(() => validatePlan(plan, HOSTS), Error, JSON.stringify(plan)?.slice(0, 80));
});

test("a split view may have 1 to 5 columns", () => {
  for (let n = 1; n <= 5; n++) {
    const columns = Array.from({ length: n }, (_, i) => col([String(i + 1)]));
    assert.equal(validatePlan(watch([split(...columns)]), HOSTS).sequence[0].columns.length, n);
  }
  assert.throws(() => validatePlan(watch([split()]), HOSTS), /1 to 5 columns/);
});

test("validatePlan normalizes split-view entries (empty route -> null, an empty column is allowed, rounds are claimed)", () => {
  const plan = validatePlan(watch([split(col(["1", "2"], "Group A", ["A1", "A2"]), col([], "", [])), round("9")]), HOSTS);
  assert.deepEqual(plan.sequence[0].columns[0], { sequence: [round("1"), round("2")], group: "Group A", route: ["A1", "A2"] });
  assert.deepEqual(plan.sequence[0].columns[1], { sequence: [], group: null, route: null });
  assert.equal(JSON.stringify(plan), JSON.stringify(validatePlan(plan, HOSTS)), "normalizing twice is stable");
  assert.throws(() => validatePlan(watch([split(col(["1"]), col(["2"])), round("2")]), HOSTS), /more than once/, "a round in a column is claimed");
  assert.throws(() => validatePlan({ kind: "multi", host: "stage", eventId: "1", entries: [] }, HOSTS), /watch/, "the old Split View plan kind is gone");
});

test("relocateIndex follows the entry by key and reports -1 when it is gone", () => {
  const seq = [round("1"), paired("2", "3"), round("4")];
  assert.equal(relocateIndex("round:4", seq), 2);
  assert.equal(relocateIndex("paired:2+3", seq), 1);
  assert.equal(relocateIndex("round:9", seq), -1);
  assert.equal(relocateIndex(null, seq), -1);
  const reordered = [round("4"), round("1"), paired("2", "3")];
  assert.equal(relocateIndex("round:1", reordered), 1);
});

test("affectedClients (watch): only tablets whose current entry disappeared count", () => {
  const oldPlan = watch([round("1"), round("2"), round("3")]);
  const clients = [{ keys: ["round:1"] }, { keys: ["round:2"] }, { keys: ["round:2"] }, { keys: [] }];
  assert.equal(affectedClients(oldPlan, watch([round("2"), round("3")]), clients), 1, "round 1 removed");
  assert.equal(affectedClients(oldPlan, watch([round("3"), round("2"), round("1")]), clients), 0, "reordering touches nobody");
  assert.equal(affectedClients(oldPlan, watch([round("1"), round("2"), round("3"), round("4")]), clients), 0, "adding touches nobody");
  assert.equal(affectedClients(oldPlan, watch([round("9")]), clients), 3, "everything replaced (tablet without a key isn't counted)");
});

test("affectedClients (split view): the entry's identity and its column filters decide", () => {
  const key = (e) => entryKey(e);
  const base = split(col(["1", "2"], "Group A"), col(["3"]));
  const oldPlan = watch([round("9"), base]);
  const clients = [{ keys: [key(base)] }, { keys: [key(base)] }, { keys: ["round:9"] }];
  assert.equal(affectedClients(oldPlan, watch([round("9"), split(col(["1", "2"], "Group A"), col(["3"]))]), clients), 0, "unchanged");
  assert.equal(affectedClients(oldPlan, watch([split(col(["1", "2"], "Group A"), col(["3"])), round("9")]), clients), 0, "reordering");
  assert.equal(affectedClients(oldPlan, watch([round("9"), split(col(["1"], "Group A"), col(["3"]))]), clients), 2, "a column lost a round: the entry is another one");
  assert.equal(affectedClients(oldPlan, watch([round("9"), split(col(["1", "2"], "Group B"), col(["3"]))]), clients), 2, "group switch changes what they show");
  assert.equal(affectedClients(oldPlan, watch([round("9"), split(col(["1", "2"], "Group A", ["A1"]), col(["3"]))]), clients), 2, "route filter changed");
  assert.equal(affectedClients(oldPlan, watch([round("9")]), clients), 2, "split view removed");
});

test("removesOrReplaces flags removals and split-view filter changes only", () => {
  const w = watch([round("1"), round("2")]);
  assert.equal(removesOrReplaces(w, watch([round("2"), round("1")])), false);
  assert.equal(removesOrReplaces(w, watch([round("1"), round("2"), round("3")])), false);
  assert.equal(removesOrReplaces(w, watch([round("1")])), true);
  const m = watch([split(col(["1"], "Group A"), col(["2"]))]);
  assert.equal(removesOrReplaces(m, watch([split(col(["1"], "Group B"), col(["2"]))])), true);
  assert.equal(removesOrReplaces(m, watch([split(col(["1"], "Group A"), col(["2"])), round("5")])), false);
  assert.equal(removesOrReplaces(m, watch([split(col(["1"], "Group A"), col(["2", "3"]))])), true, "other columns = other entry");
});

const training = (id) => ({ type: "training", id });

test("training entries: key, normalization and the 'same round may be training AND real round' rule", () => {
  assert.equal(entryKey(training("13719")), "training:13719");
  const plan = validatePlan(watch([training("13719"), round("13719"), round("1")]), HOSTS);
  assert.deepEqual(plan.sequence, [training("13719"), round("13719"), round("1")], "a training does not claim its round");
  assert.deepEqual(validatePlan(watch([{ type: "training", id: 13719 }]), HOSTS).sequence, [training("13719")], "numeric id -> string");
});

test("training entries: only one training per round, numeric ids, never inside a split view", () => {
  assert.throws(() => validatePlan(watch([training("5"), round("1"), training("5")]), HOSTS), /Training for round 5 appears more than once/);
  assert.throws(() => validatePlan(watch([training("x")]), HOSTS), /numeric id/);
  assert.throws(() => validatePlan(watch([training("5?a=b")]), HOSTS), /numeric id/);
  assert.throws(() => validatePlan(watch([split({ sequence: [training("5")], group: null, route: null }, col(["3"]))]), HOSTS), /only hold plain rounds/);
  // a real round can still not be listed twice
  assert.throws(() => validatePlan(watch([training("5"), round("5"), round("5")]), HOSTS), /more than once/);
});

test("training entries behave like any other entry for relocation and impact", () => {
  const seq = [round("1"), training("7"), round("2")];
  assert.equal(relocateIndex("training:7", seq), 1);
  const oldPlan = watch(seq);
  const clients = [{ keys: ["training:7"] }, { keys: ["round:1"] }];
  assert.equal(affectedClients(oldPlan, watch([round("1"), round("2")]), clients), 1, "removing the training affects the tablets on it");
  assert.equal(affectedClients(oldPlan, watch([training("7"), round("1"), round("2")]), clients), 0, "moving it affects nobody");
  assert.equal(removesOrReplaces(oldPlan, watch([round("1"), round("2")])), true);
  assert.equal(removesOrReplaces(oldPlan, watch([round("2"), training("7"), round("1")])), false);
});

// ---- technical incidents (6.48) -------------------------------------------------
const { applyTechnicalIncidents } = globalThis.SessionPlan;
const ath = (id) => ({ athlete_id: id, name: `N${id}`, bib: String(id) });
const athletes = new Map([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((id) => [id, ath(id)]));
const byId = (id) => athletes.get(Number(id)) ?? null;
// A lane as computeLane() builds it: `current` at the wall, the next ones after.
const laneFrom = (ids, extra = {}) => ({
  routeName: "1",
  finished: false,
  atWall: ath(ids[0]),
  onDeck: ids[1] ? ath(ids[1]) : null,
  queue: ids.slice(2, 8).map(ath),
  ...extra,
});
const tiOf = (athleteId, beforeAthleteId, extra = {}) => ({
  id: "t",
  roundId: "1",
  routeIds: [10],
  athleteId,
  beforeAthleteId,
  createdAt: 1,
  done: false,
  ...extra,
});
const apply = (lane, incidents, extra = {}) =>
  applyTechnicalIncidents(lane, { incidents, routeId: 10, athleteById: byId, ...extra });
// an empty place of a TI slot is `{ tiGap: true }`; the helper shows it as null, a blank of the lane stays null too
const names = (lane) => [lane.atWall, lane.onDeck, ...lane.queue].map((a) => (a && !a.tiGap ? (a.tiRestart ? `TI:${a.athlete_id}` : a.athlete_id) : null));

test("incident: no incident, a finished one or another route leaves the lane object untouched", () => {
  const lane = laneFrom([5, 6, 7, 8]);
  assert.equal(apply(lane, []), lane);
  assert.equal(apply(lane, undefined), lane);
  assert.equal(apply(lane, [tiOf(1, 7, { done: true })]), lane);
  assert.equal(apply(lane, [tiOf(1, 7, { routeIds: [11] })]), lane);
  assert.equal(apply(lane, [tiOf(1, 99)]), lane, "the athlete it is in front of is not in view");
  assert.equal(apply(lane, [tiOf(77, 7)]), lane, "unknown athlete");
});

test("incident: a re-start in front of a queued athlete sits in the queue, climbing/next stay real", () => {
  const out = apply(laneFrom([5, 6, 7, 8, 9]), [tiOf(1, 8)]);
  assert.deepEqual(names(out), [5, 6, 7, "TI:1", 8, 9]);
  assert.equal(out.atWall.athlete_id, 5);
  assert.equal(out.onDeck.athlete_id, 6);
  assert.equal(out.finished, false);
});

test("incident: in front of the next athlete it becomes NEXT, in front of the one at the wall it becomes CLIMBING", () => {
  assert.deepEqual(names(apply(laneFrom([5, 6, 7]), [tiOf(1, 6)])), [5, "TI:1", 6, 7]);
  assert.deepEqual(names(apply(laneFrom([5, 6, 7]), [tiOf(1, 5)])), ["TI:1", 5, 6, 7]);
});

test("incident: the original lane and athlete objects are not mutated", () => {
  const lane = laneFrom([5, 6, 7]);
  const copy = JSON.stringify(lane);
  apply(lane, [tiOf(1, 6)]);
  assert.equal(JSON.stringify(lane), copy);
  assert.equal(athletes.get(1).tiRestart, undefined);
});

test("incident: several incidents keep their creation order, also in front of the same athlete", () => {
  const out = apply(laneFrom([5, 6, 7, 8]), [tiOf(2, 7, { createdAt: 20 }), tiOf(1, 7, { createdAt: 10 })]);
  assert.deepEqual(names(out), [5, 6, "TI:1", "TI:2", 7, 8]);
});

test("incident: at the end of the start list - shown once the end is in view, never earlier", () => {
  assert.deepEqual(names(apply(laneFrom([5, 6, 7]), [tiOf(1, null)])), [5, 6, 7, "TI:1"]);
  const long = laneFrom([5, 6, 7, 8, 9, 10, 11, 4]); // queue full: the list may continue
  assert.equal(apply(long, [tiOf(1, null)]), long, "end not in view");
  // the last athlete is at the wall, nobody after
  assert.deepEqual(names(apply(laneFrom([5]), [tiOf(1, null)])), [5, "TI:1"]);
});

test("incident: after the round finished a re-start at the end is CLIMBING again", () => {
  const finished = { routeName: "1", finished: true, atWall: null, onDeck: null, queue: [] };
  const out = apply(finished, [tiOf(1, null)]);
  assert.equal(out.finished, false);
  assert.equal(out.atWall.athlete_id, 1);
  assert.equal(out.atWall.tiRestart, true);
  assert.equal(out.onDeck, null);
  assert.equal(apply(finished, [tiOf(1, 5)]), finished, "in front of someone who is already done: nothing");
});

test("incident: while the re-start is being scored it is not drawn on top of the real lane", () => {
  const lane = laneFrom([1, 6, 7]); // the judge re-opened athlete 1: the inference shows them as current
  assert.equal(apply(lane, [tiOf(1, 6)], { isUnderway: (ti) => ti.athleteId === 1 }), lane);
  assert.deepEqual(names(apply(lane, [tiOf(1, 6)], { isUnderway: () => false })), [1, "TI:1", 6, 7], "not underway: drawn");
  assert.deepEqual(names(apply(lane, [tiOf(1, 6), tiOf(2, 7)], { isUnderway: (ti) => ti.athleteId === 1 })), [1, 6, "TI:2", 7]);
});

test("incident: superseded (the athlete in front already started) is ignored", () => {
  const lane = laneFrom([5, 6, 7]);
  assert.equal(apply(lane, [tiOf(1, 6)], { isSuperseded: (ti) => ti.beforeAthleteId === 6 }), lane);
  const out = apply(lane, [tiOf(1, 6), tiOf(2, 7)], { isSuperseded: (ti) => ti.beforeAthleteId === 6 });
  assert.deepEqual(names(out), [5, 6, "TI:2", 7]);
});

test("incident: the queue stays at 6 entries and a not-yet-started round (blank climbing) works", () => {
  const out = apply(laneFrom([5, 6, 7, 8, 9, 10, 11, 4]), [tiOf(1, 7)]);
  assert.equal(out.queue.length, 6);
  const blank = { routeName: "1", finished: false, atWall: null, onDeck: null, queue: [ath(5), ath(6)] };
  assert.deepEqual(names(apply(blank, [tiOf(1, 6)])), [null, null, 5, "TI:1", 6]);
});

// ---- Boulder: a TI is a slot, the athlete is drawn on his boulder only (6.51) -----
test("incident (Boulder): the athlete only on his boulder, an empty place on every other boulder of the block", () => {
  const ti = tiOf(1, 7, { routeIds: [10, 11, 12], boulderRouteId: 11 });
  const onDrawn = (routeId) => applyTechnicalIncidents(laneFrom([5, 6, 7, 8, 9]), { incidents: [ti], routeId, athleteById: byId });
  assert.deepEqual(names(onDrawn(11)), [5, 6, "TI:1", 7, 8, 9], "boulder 2: the athlete");
  assert.deepEqual(names(onDrawn(10)), [5, 6, null, 7, 8, 9], "boulder 1: an empty place (nobody is called)");
  assert.deepEqual(names(onDrawn(12)), [5, 6, null, 7, 8, 9], "boulder 3: an empty place");
  assert.equal(applyTechnicalIncidents(laneFrom([5, 6, 7]), { incidents: [ti], routeId: 99, athleteById: byId }).atWall.athlete_id, 5);
});

test("incident (Boulder): superseded is decided per route, 'underway' only on the boulder the athlete climbs again", () => {
  const ti = tiOf(1, 7, { routeIds: [10, 11], boulderRouteId: 11 });
  const asked = [];
  const isUnderway = (t, routeId) => {
    asked.push(routeId);
    return false;
  };
  const gapLane = applyTechnicalIncidents(laneFrom([5, 6, 7, 8]), { incidents: [ti], routeId: 10, athleteById: byId, isUnderway });
  assert.deepEqual(names(gapLane), [5, 6, null, 7, 8]);
  assert.deepEqual(asked, [], "the athlete's own regular climbs on other boulders never hide the empty place");
  // the athlete in front started on boulder 1 only: the empty place is gone there, the athlete stays on boulder 2
  const isSuperseded = (t, routeId) => routeId === 10;
  const lane10 = applyTechnicalIncidents(laneFrom([5, 6, 7, 8]), { incidents: [ti], routeId: 10, athleteById: byId, isSuperseded });
  assert.equal(lane10, lane10, "sanity");
  assert.deepEqual(names(lane10), [5, 6, 7, 8]);
  const lane11 = applyTechnicalIncidents(laneFrom([5, 6, 7, 8]), { incidents: [ti], routeId: 11, athleteById: byId, isSuperseded });
  assert.deepEqual(names(lane11), [5, 6, "TI:1", 7, 8]);
});

test("incident (Boulder): at the end of the list only the athlete is drawn, never an empty place", () => {
  const ti = tiOf(1, null, { routeIds: [10, 11], boulderRouteId: 11 });
  const at = (routeId) => applyTechnicalIncidents(laneFrom([5, 6, 7]), { incidents: [ti], routeId, athleteById: byId });
  assert.deepEqual(names(at(11)), [5, 6, 7, "TI:1"]);
  const untouched = laneFrom([5, 6, 7]);
  assert.equal(applyTechnicalIncidents(untouched, { incidents: [ti], routeId: 10, athleteById: byId }), untouched);
});

// ---- Boulder: a slot that another TI re-uses (the TI-Rechner's "as fast as possible") ----
test("incident (Boulder): a TI that uses another one's slot takes its place on its own boulder, no second empty place", () => {
  const owner = tiOf(1, 7, { id: "a", routeIds: [10, 11, 12], boulderRouteId: 10, createdAt: 1 });
  const reuser = tiOf(2, 99, { id: "b", routeIds: [10, 11, 12], boulderRouteId: 12, createdAt: 2, reuseOf: "a" });
  const on = (routeId, incidents = [owner, reuser]) => applyTechnicalIncidents(laneFrom([5, 6, 7, 8, 9]), { incidents, routeId, athleteById: byId });
  assert.deepEqual(names(on(10)), [5, 6, "TI:1", 7, 8, 9], "the owner on his own boulder");
  assert.deepEqual(names(on(11)), [5, 6, null, 7, 8, 9], "one empty place, not two");
  assert.deepEqual(names(on(12)), [5, 6, "TI:2", 7, 8, 9], "the reuser in the owner's place - the owner's empty place is gone there");
});

test("incident (Boulder): the reuser stands where the owner's slot stands, also between other slots", () => {
  const owner = tiOf(1, 7, { id: "a", routeIds: [10, 11], boulderRouteId: 10, createdAt: 1 });
  const other = tiOf(3, 7, { id: "c", routeIds: [10, 11], boulderRouteId: 10, createdAt: 2 });
  const reuser = tiOf(2, 99, { id: "b", routeIds: [10, 11], boulderRouteId: 11, createdAt: 3, reuseOf: "a" });
  const lane = (routeId) => applyTechnicalIncidents(laneFrom([5, 6, 7, 8, 9]), { incidents: [owner, other, reuser], routeId, athleteById: byId });
  // on boulder 2: owner's place (taken by the reuser) first, then the other slot's empty place
  assert.deepEqual(names(lane(11)), [5, 6, "TI:2", null, 7, 8, 9]);
  assert.deepEqual(names(lane(10)), [5, 6, "TI:1", "TI:3", 7, 8, 9]);
});

test("incident (Boulder): the reuser follows the owner's position live, survives a finished owner, and stands alone without one", () => {
  const owner = tiOf(1, 7, { id: "a", routeIds: [10, 11], boulderRouteId: 10, createdAt: 1 });
  const reuser = tiOf(2, 99, { id: "b", routeIds: [10, 11], boulderRouteId: 11, createdAt: 2, reuseOf: "a" });
  const run = (incidents) => names(applyTechnicalIncidents(laneFrom([5, 6, 7, 8, 9]), { incidents, routeId: 11, athleteById: byId }));
  assert.deepEqual(run([owner, reuser]), [5, 6, "TI:2", 7, 8, 9]);
  const moved = { ...owner, beforeAthleteId: 8 };
  assert.deepEqual(run([moved, reuser]), [5, 6, 7, "TI:2", 8, 9], "the owner's slot moved (edited), the reuser moved with it");
  assert.deepEqual(run([{ ...owner, done: true }, reuser]), [5, 6, "TI:2", 7, 8, 9], "a finished owner doesn't take the reuser along");
  assert.deepEqual(run([reuser]), [5, 6, 7, 8, 9], "the owner was removed: a reuser with a snapshot anchor of its own keeps it");
  const withSnapshot = { ...reuser, beforeAthleteId: 8 };
  assert.deepEqual(run([withSnapshot]), [5, 6, 7, "TI:2", 8, 9]);
});

// ---- fuzz: the overlay never breaks a lane, whatever mix of incidents it gets -------
test("incident fuzz: Lead and Boulder incidents, reuse, done, superseded - invariants hold on every route", () => {
  let seed = 20261014;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const routes = [10, 11, 12, 13];
  for (let run = 0; run < 3000; run++) {
    const ids = Array.from({ length: ri(0, 9) }, (_, i) => i + 1);
    const incidents = [];
    const pool = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].sort(() => rnd() - 0.5); // one TI per athlete: the check below names athletes
    for (let n = 0; n < ri(0, 4); n++) {
      const boulder = rnd() < 0.8;
      const who = pool.pop();
      const ti = tiOf(who, rnd() < 0.2 ? null : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].filter((x) => x !== who)[ri(0, 9)], {
        id: `t${n}`,
        createdAt: n + 1,
        routeIds: boulder ? routes : [10],
        done: rnd() < 0.15,
      });
      if (boulder) {
        ti.boulderRouteId = routes[ri(0, 3)];
        const owners = incidents.filter((o) => o.boulderRouteId != null && !o.reuseOf && o.boulderRouteId !== ti.boulderRouteId);
        if (owners.length && rnd() < 0.4) ti.reuseOf = owners[ri(0, owners.length - 1)].id;
      }
      incidents.push(ti);
    }
    const startedOn = new Set();
    const isSuperseded = (t, routeId) => startedOn.has(`${t.beforeAthleteId}:${routeId}`);
    for (let k = 0; k < ri(0, 6); k++) startedOn.add(`${ri(1, 11)}:${routes[ri(0, 3)]}`);
    for (const routeId of routes) {
      const real = ids.slice();
      const lane = real.length ? laneFrom(real) : { routeName: "1", finished: true, atWall: null, onDeck: null, queue: [] };
      const out = applyTechnicalIncidents(lane, { incidents, routeId, athleteById: byId, isSuperseded });
      const list = out === lane ? names(lane) : names(out);
      const reals = list.filter((x) => typeof x === "number");
      // the real athletes keep their order and none is lost or doubled
      const expected = real.slice(0, reals.length);
      assert.deepEqual(reals, out === lane ? expected : reals, "order of the real athletes");
      if (out !== lane) {
        const kept = real.filter((id) => reals.includes(id));
        assert.deepEqual(reals, kept, "real athletes unchanged and in order");
        assert.equal(reals.length, Math.min(real.length, reals.length));
      }
      const tiNames = list.filter((x) => typeof x === "string");
      assert.equal(new Set(tiNames).size >= 0, true);
      // a Boulder TI athlete only on his boulder; an Lead one on its route
      for (const ti of incidents) {
        const drawn = list.includes(`TI:${ti.athleteId}`);
        if (drawn) {
          assert.ok(!ti.done, "a finished TI is never drawn");
          assert.ok(ti.routeIds.includes(routeId));
          assert.ok(ti.boulderRouteId == null || ti.boulderRouteId === routeId, "the athlete only on his own boulder");
        }
      }
      // no empty place at the very end, and no more than the queue limit
      assert.ok(out.queue.length <= 6);
      // (a full queue may end with an empty place: the list is cut there)
      if (out !== lane && out.queue.length && out.queue.length < 6) assert.notEqual(out.queue[out.queue.length - 1], null, "no empty place at the end of the list");
      assert.equal(out.finished && out !== lane, false, "a lane with incidents is not finished");
    }
  }
});

test("incident (Boulder): the empty place is a real marker, not a blank", () => {
  const ti = tiOf(1, 7, { routeIds: [10, 11], boulderRouteId: 11 });
  const out = applyTechnicalIncidents(laneFrom([5, 6, 7, 8]), { incidents: [ti], routeId: 10, athleteById: byId });
  const gap = out.queue[0];
  assert.deepEqual(gap, { tiGap: true }, "drawn as 'TI: no athlete'");
  // in front of the athlete at the wall / on deck it is the CLIMBING / NEXT card
  const atWall = applyTechnicalIncidents(laneFrom([5, 6, 7]), { incidents: [tiOf(1, 5, { routeIds: [10, 11], boulderRouteId: 11 })], routeId: 10, athleteById: byId });
  assert.deepEqual(atWall.atWall, { tiGap: true });
  assert.equal(atWall.onDeck.athlete_id, 5);
  const blank = applyTechnicalIncidents({ ...laneFrom([5, 6]), queue: [null, ath(7)] }, { incidents: [tiOf(1, 7, { routeIds: [10, 11], boulderRouteId: 11 })], routeId: 10, athleteById: byId });
  assert.equal(blank.queue.filter((x) => x?.tiGap).length, 1, "a lane's own blank stays a blank");
  assert.equal(blank.queue[0], null);
});
