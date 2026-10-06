import test from "node:test";
import assert from "node:assert/strict";
import "../public/session-plan.js";

const { validatePlan, entryKey, relocateIndex, affectedClients, removesOrReplaces, columnKey } = globalThis.SessionPlan;
const HOSTS = ["prod", "stage"];

const watch = (sequence, extra = {}) => ({ kind: "watch", host: "stage", eventId: "1594", sequence, ...extra });
const round = (id) => ({ type: "round", id });
const paired = (a, b) => ({ type: "paired", a, b });
const multi = (entries) => ({ kind: "multi", host: "stage", eventId: "1594", entries });
const col = (ids, group = null, route = null) => ({ sequence: ids.map(round), group, route });

test("entryKey identifies plain and paired entries and tolerates null", () => {
  assert.equal(entryKey(round("5")), "round:5");
  assert.equal(entryKey(paired("1", "2")), "paired:1+2");
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
    multi([]),
    multi(Array.from({ length: 6 }, () => col([]))),
    multi([col(["1", "1"])]),
    multi([{ sequence: [paired("1", "2")], group: null, route: null }]),
    multi([{ sequence: [], group: "x".repeat(101), route: null }]),
    multi([{ sequence: [], group: null, route: "A1" }]),
    multi([{ sequence: [], group: null, route: [""] }]),
  ];
  for (const plan of bad) assert.throws(() => validatePlan(plan, HOSTS), Error, JSON.stringify(plan)?.slice(0, 80));
});

test("validatePlan normalizes split-view columns (empty route -> null, empty column allowed)", () => {
  const plan = validatePlan(multi([col(["1", "2"], "Group A", ["A1", "A2"]), col([], "", [])]), HOSTS);
  assert.deepEqual(plan.entries[0], { sequence: [round("1"), round("2")], group: "Group A", route: ["A1", "A2"] });
  assert.deepEqual(plan.entries[1], { sequence: [], group: null, route: null });
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
  assert.equal(affectedClients(oldPlan, multi([col(["1"])]), clients), 4, "kind change affects everybody");
});

test("affectedClients (multi): per-column removal, dropped columns and group/route changes count", () => {
  const oldPlan = multi([col(["1", "2"], "Group A"), col(["3"])]);
  const clients = [{ keys: [columnKey(0, round("1")), columnKey(1, round("3"))] }, { keys: ["0|round:2", "1|"] }];
  assert.equal(affectedClients(oldPlan, multi([col(["1", "2"], "Group A"), col(["3"])]), clients), 0);
  assert.equal(affectedClients(oldPlan, multi([col(["2"], "Group A"), col(["3"])]), clients), 1, "column 0 lost round 1");
  assert.equal(affectedClients(oldPlan, multi([col(["1", "2"], "Group B"), col(["3"])]), clients), 2, "group switch changes what both show");
  assert.equal(affectedClients(oldPlan, multi([col(["1", "2"], "Group A")]), clients), 2, "column 1 dropped: both tablets show it (one a finished column)");
  assert.equal(affectedClients(oldPlan, multi([col(["1", "2"], "Group A", ["A1"]), col(["3"])]), clients), 2, "route filter changed");
});

test("removesOrReplaces flags removals, kind changes and column changes only", () => {
  const w = watch([round("1"), round("2")]);
  assert.equal(removesOrReplaces(w, watch([round("2"), round("1")])), false);
  assert.equal(removesOrReplaces(w, watch([round("1"), round("2"), round("3")])), false);
  assert.equal(removesOrReplaces(w, watch([round("1")])), true);
  assert.equal(removesOrReplaces(w, multi([col(["1"])])), true);
  const m = multi([col(["1"], "Group A")]);
  assert.equal(removesOrReplaces(m, multi([col(["1"], "Group B")])), true);
  assert.equal(removesOrReplaces(m, multi([col(["1", "2"], "Group A")])), false);
  assert.equal(removesOrReplaces(m, multi([col(["1"], "Group A"), col(["5"])])), false);
});
