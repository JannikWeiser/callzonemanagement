import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import crypto from "node:crypto";
import { createSessionRouter } from "../sessions.js";

const HOSTS = ["prod", "stage"];
const round = (id) => ({ type: "round", id });
const watchPlan = (ids = ["13682"], extra = {}) => ({
  kind: "watch",
  host: "stage",
  eventId: "1594",
  sequence: ids.map(round),
  showNextPreview: true,
  ...extra,
});
const splitPlan = () => ({
  kind: "watch",
  host: "stage",
  eventId: "1594",
  sequence: [
    round("9"),
    { type: "split", columns: [{ sequence: [round("1")], group: "Group A", route: ["A1"] }, { sequence: [], group: null, route: null }] },
  ],
  showNextPreview: true,
});

// Boots the router on an ephemeral port with an injectable clock.
// `disciplines` stubs the round lookup technical incidents use ("Speed" for
// anything not listed).
async function boot({ secret, limits, clock, disciplines = { 13682: "Lead", 13709: "Boulder" } } = {}) {
  const state = { t: clock ?? 1_000_000 };
  const router = createSessionRouter({
    hostNames: HOSTS,
    secret,
    now: () => state.t,
    limits: { loginLockMs: 60_000, ...limits },
    roundDiscipline: async (host, roundId) => {
      if (roundId === "99999") throw new Error("upstream down");
      return disciplines[roundId] ?? "Speed";
    },
  });
  const app = express();
  app.use("/api/session", router);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/session`;
  const call = async (method, path, { body, key, raw } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json, text, headers: res.headers };
  };
  const create = async (password = "pocket", plan = watchPlan()) => {
    const r = await call("POST", "", { body: { password, plan } });
    assert.equal(r.status, 201, r.text);
    return r.json;
  };
  return { router, state, call, create, close: () => new Promise((r) => server.close(r)) };
}

test("create: needs a password of at least 4 characters and a valid plan", async () => {
  const s = await boot();
  try {
    assert.equal((await s.call("POST", "", { body: { plan: watchPlan() } })).status, 400);
    assert.equal((await s.call("POST", "", { body: { password: "abc", plan: watchPlan() } })).status, 400);
    assert.equal((await s.call("POST", "", { body: { password: "x".repeat(101), plan: watchPlan() } })).status, 400);
    for (const plan of [null, watchPlan([]), watchPlan(["1", "1"]), { ...watchPlan(), host: "evil" }, { ...watchPlan(), eventId: "12/3" }]) {
      const r = await s.call("POST", "", { body: { password: "pocket", plan } });
      assert.equal(r.status, 400, JSON.stringify(plan));
      assert.ok(r.json.error);
    }
    assert.equal(s.router.sessions.size, 0, "rejected requests leave nothing behind");
  } finally {
    await s.close();
  }
});

test("create: returns id, version 1, credentials - and never the password", async () => {
  const s = await boot();
  try {
    const r = await s.call("POST", "", { body: { password: "correct horse", plan: watchPlan() } });
    assert.equal(r.status, 201);
    assert.match(r.json.id, /^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/);
    assert.equal(r.json.version, 1);
    assert.equal(r.json.record.salt.length, 32);
    assert.equal(r.json.record.hash.length, 128);
    assert.equal(r.json.hostKey.length, 64);
    assert.ok(!r.text.includes("correct horse"));
    assert.equal(r.headers.get("cache-control"), "no-store");
    const stored = s.router.sessions.get(r.json.id);
    assert.ok(!JSON.stringify(stored).includes("correct horse"), "only a hash is stored");
  } finally {
    await s.close();
  }
});

test("viewer GET: full plan, 'unchanged' for the current version, 404 for unknown or malformed ids", async () => {
  const s = await boot();
  try {
    const { id } = await s.create();
    const full = await s.call("GET", `/${id}`);
    assert.equal(full.status, 200);
    assert.equal(full.json.version, 1);
    assert.deepEqual(full.json.plan, watchPlan());
    assert.ok(!("record" in full.json) && !("hostKey" in full.json), "viewers never see credentials");
    const tv = full.json.tiVersion;
    assert.deepEqual((await s.call("GET", `/${id}?v=1&tv=${tv}`)).json, { version: 1, tiVersion: tv, unchanged: true });
    assert.equal((await s.call("GET", `/${id}?v=1`)).json.plan.kind, "watch", "without the incident version the full state is sent");
    assert.equal((await s.call("GET", `/${id}?v=0`)).json.plan.kind, "watch", "an older version gets the plan");
    for (const bad of ["zzzzzzzz", "ABCDEFGH", "short", "abcdefg0", "..%2F..%2Fx"]) {
      assert.equal((await s.call("GET", `/${bad}`)).status, 404, bad);
    }
  } finally {
    await s.close();
  }
});

test("login: right password returns credentials, wrong one is refused", async () => {
  const s = await boot();
  try {
    const created = await s.create("secret1");
    const ok = await s.call("POST", `/${created.id}/login`, { body: { password: "secret1" } });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.hostKey, created.hostKey);
    assert.deepEqual(ok.json.record, created.record);
    assert.equal(ok.json.plan.kind, "watch");
    for (const body of [{ password: "secret2" }, {}, { password: 12345 }, { password: "" }]) {
      assert.equal((await s.call("POST", `/${created.id}/login`, { body })).status, 403, JSON.stringify(body));
    }
    assert.equal((await s.call("POST", `/aaaaaaaa/login`, { body: { password: "secret1" } })).status, 404);
  } finally {
    await s.close();
  }
});

test("login rate limit: 5 wrong passwords lock the session+IP for 60 s, a correct one succeeds again afterwards", async () => {
  const s = await boot();
  try {
    const { id } = await s.create("secret1");
    for (let i = 0; i < 5; i++) assert.equal((await s.call("POST", `/${id}/login`, { body: { password: "nope" } })).status, 403);
    const locked = await s.call("POST", `/${id}/login`, { body: { password: "secret1" } });
    assert.equal(locked.status, 429, "even the right password is refused while locked");
    assert.ok(locked.json.retryAfterSec > 0);
    s.state.t += 61_000;
    assert.equal((await s.call("POST", `/${id}/login`, { body: { password: "secret1" } })).status, 200);
    // a success resets the counter
    for (let i = 0; i < 4; i++) await s.call("POST", `/${id}/login`, { body: { password: "nope" } });
    assert.equal((await s.call("POST", `/${id}/login`, { body: { password: "secret1" } })).status, 200);
    for (let i = 0; i < 4; i++) await s.call("POST", `/${id}/login`, { body: { password: "nope" } });
    assert.equal((await s.call("POST", `/${id}/login`, { body: { password: "nope" } })).status, 403, "counter restarted from zero");
  } finally {
    await s.close();
  }
});

test("publish: needs the host key, bumps the version, normalizes the plan", async () => {
  const s = await boot();
  try {
    const { id, hostKey } = await s.create();
    const next = watchPlan(["1", "2"], { showNextPreview: false });
    assert.equal((await s.call("PUT", `/${id}`, { body: { baseVersion: 1, plan: next } })).status, 403, "no key");
    assert.equal((await s.call("PUT", `/${id}`, { key: "0".repeat(64), body: { baseVersion: 1, plan: next } })).status, 403, "wrong key");
    assert.equal((await s.call("PUT", `/${id}`, { key: "short", body: { baseVersion: 1, plan: next } })).status, 403, "malformed key");
    assert.equal((await s.call("GET", `/${id}`)).json.version, 1, "refused writes change nothing");

    const ok = await s.call("PUT", `/${id}`, { key: hostKey, body: { baseVersion: 1, plan: { ...next, eventId: 1594 } } });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.version, 2);
    assert.deepEqual(ok.json.plan, next);
    assert.deepEqual((await s.call("GET", `/${id}`)).json.plan, next);
  } finally {
    await s.close();
  }
});

test("publish: stale baseVersion is a conflict that returns the current plan; invalid or foreign-event plans are refused", async () => {
  const s = await boot();
  try {
    const { id, hostKey } = await s.create();
    await s.call("PUT", `/${id}`, { key: hostKey, body: { baseVersion: 1, plan: watchPlan(["1"]) } });
    const conflict = await s.call("PUT", `/${id}`, { key: hostKey, body: { baseVersion: 1, plan: watchPlan(["2"]) } });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.json.version, 2);
    assert.deepEqual(conflict.json.plan, watchPlan(["1"]));
    assert.equal((await s.call("PUT", `/${id}`, { key: hostKey, body: { plan: watchPlan(["2"]) } })).status, 409, "missing baseVersion");
    assert.equal((await s.call("PUT", `/${id}`, { key: hostKey, body: { baseVersion: 2, plan: watchPlan([]) } })).status, 400);
    assert.equal((await s.call("PUT", `/${id}`, { key: hostKey, body: { baseVersion: 2, plan: { ...watchPlan(["2"]), eventId: "999" } } })).status, 400, "other event");
    assert.equal((await s.call("PUT", `/${id}`, { key: hostKey, body: { baseVersion: 2, plan: { ...watchPlan(["2"]), host: "prod" } } })).status, 400, "other host");
    assert.equal((await s.call("GET", `/${id}`)).json.version, 2);
  } finally {
    await s.close();
  }
});

test("publish accepts a plan with a split-view entry, and a session is one kind of plan only", async () => {
  const s = await boot();
  try {
    const { id, hostKey } = await s.create();
    const r = await s.call("PUT", `/${id}`, { key: hostKey, body: { baseVersion: 1, plan: splitPlan() } });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual((await s.call("GET", `/${id}?v=1`)).json.plan, splitPlan());
    const old = { kind: "multi", host: "stage", eventId: "1594", entries: [{ sequence: [round("1")], group: null, route: null }] };
    assert.equal((await s.call("PUT", `/${id}`, { key: hostKey, body: { baseVersion: 2, plan: old } })).status, 400, "the old Split View plan kind is refused");
    assert.equal((await s.call("POST", "", { body: { password: "pocket", plan: old } })).status, 400, "and can't be created either");
  } finally {
    await s.close();
  }
});

test("malformed or oversized bodies get a JSON error, not an HTML page or a crash", async () => {
  const s = await boot();
  try {
    const bad = await s.call("POST", "", { raw: "{not json" });
    assert.equal(bad.status, 400);
    assert.ok(bad.json?.error);
    const huge = await s.call("POST", "", { raw: JSON.stringify({ password: "pocket", plan: watchPlan(), pad: "x".repeat(40_000) }) });
    assert.equal(huge.status, 413);
    assert.ok(huge.json?.error);
    assert.equal((await s.call("POST", "", { body: [] })).status, 400);
  } finally {
    await s.close();
  }
});

test("clients: heartbeats are counted, expire after 15 s and are only visible with the host key", async () => {
  const s = await boot();
  try {
    const { id, hostKey } = await s.create();
    await s.call("GET", `/${id}?c=aaaaaaaa11&k=${encodeURIComponent("round:13682")}`);
    await s.call("GET", `/${id}?c=bbbbbbbb22&k=${encodeURIComponent("round:13682")}`);
    await s.call("GET", `/${id}?c=bbbbbbbb22&k=${encodeURIComponent("paired:1+2")}`); // same tablet again: updated, not duplicated
    await s.call("GET", `/${id}?c=NOT-HEX&k=round:1`); // invalid client ids are ignored
    await s.call("GET", `/${id}`); // a plain viewer without an id is simply not counted
    assert.equal((await s.call("GET", `/${id}/clients`)).status, 403);
    const r = await s.call("GET", `/${id}/clients`, { key: hostKey });
    assert.equal(r.status, 200);
    assert.equal(r.json.online, 2);
    assert.deepEqual(r.json.clients.map((c) => c.keys).sort(), [["paired:1+2"], ["round:13682"]]);
    assert.ok(!JSON.stringify(r.json).includes("aaaaaaaa11"), "client ids are never exposed");
    s.state.t += 14_000;
    await s.call("GET", `/${id}?c=aaaaaaaa11&k=round:13682`);
    s.state.t += 2_000; // bbbbbbbb22 is now 16 s old, aaaaaaaa11 only 2 s
    assert.equal((await s.call("GET", `/${id}/clients`, { key: hostKey })).json.online, 1);
    s.state.t += 20_000;
    assert.equal((await s.call("GET", `/${id}/clients`, { key: hostKey })).json.online, 0);
  } finally {
    await s.close();
  }
});

test("clients: key list is capped and truncated", async () => {
  const s = await boot();
  try {
    const { id, hostKey } = await s.create();
    const many = Array.from({ length: 12 }, (_, i) => `${i}|round:${"9".repeat(80)}`).join(",");
    await s.call("GET", `/${id}?c=cccccccc33&k=${encodeURIComponent(many)}`);
    const { json } = await s.call("GET", `/${id}/clients`, { key: hostKey });
    assert.equal(json.clients[0].keys.length, 5);
    assert.ok(json.clients[0].keys.every((k) => k.length <= 60));
  } finally {
    await s.close();
  }
});

test("restore after a restart works with a fixed SESSION_SECRET and keeps the old host key valid", async () => {
  const secret = "fixed-test-secret";
  const before = await boot({ secret });
  const created = await before.create("secret1");
  await before.close();

  const after = await boot({ secret }); // "restarted" server: memory is empty
  try {
    assert.equal((await after.call("GET", `/${created.id}`)).status, 404);
    const restore = await after.call("POST", "", {
      body: { id: created.id, record: created.record, hostKey: created.hostKey, plan: watchPlan(["7"]), version: 5 },
    });
    assert.equal(restore.status, 201);
    assert.equal(restore.json.restored, true);
    assert.equal(restore.json.id, created.id);
    assert.equal(restore.json.version, 6, "newer than anything a tablet may have seen");
    assert.deepEqual((await after.call("GET", `/${created.id}`)).json.plan, watchPlan(["7"]));
    // the pre-restart host key still authorizes writes, and the old password still logs in
    assert.equal((await after.call("PUT", `/${created.id}`, { key: created.hostKey, body: { baseVersion: 6, plan: watchPlan(["8"]) } })).status, 200);
    assert.equal((await after.call("POST", `/${created.id}/login`, { body: { password: "secret1" } })).status, 200);
    // a second device restoring the same session just gets the existing one
    const again = await after.call("POST", "", { body: { id: created.id, record: created.record, hostKey: created.hostKey, plan: watchPlan(["7"]), version: 5 } });
    assert.equal(again.status, 200);
    assert.equal(again.json.restored, false);
    assert.deepEqual(again.json.plan, watchPlan(["8"]), "does not overwrite the newer plan");
  } finally {
    await after.close();
  }
});

test("restore is refused for forged credentials, other records and (without a fixed secret) after a restart", async () => {
  const secret = "fixed-test-secret";
  const a = await boot({ secret });
  const created = await a.create("secret1");
  await a.close();
  const b = await boot({ secret });
  try {
    const attempt = (over) => b.call("POST", "", { body: { id: created.id, record: created.record, hostKey: created.hostKey, plan: watchPlan(), version: 1, ...over } });
    assert.equal((await attempt({ hostKey: "0".repeat(64) })).status, 403, "forged host key");
    assert.equal((await attempt({ record: { ...created.record, hash: "f".repeat(128) } })).status, 403, "record not matching the key");
    assert.equal((await attempt({ record: { salt: "x", hash: "y" } })).status, 400);
    assert.equal((await attempt({ id: "bad" })).status, 400);
    assert.equal((await attempt({ plan: { kind: "watch" } })).status, 400);
    assert.equal(b.router.sessions.size, 0);

    assert.equal((await attempt({})).status, 201);
    // an attacker with their own record + a hostKey they cannot compute (secret unknown) is refused;
    // here we only check that a *different valid record* on an existing id conflicts:
    const otherRecord = { salt: "a".repeat(32), hash: "b".repeat(128) };
    const otherKey = crypto.createHmac("sha256", secret).update(`${created.id}:${otherRecord.hash}`).digest("hex");
    assert.equal((await attempt({ record: otherRecord, hostKey: otherKey })).status, 409);
  } finally {
    await b.close();
  }

  // no fixed secret -> every restart rotates the secret -> old host keys are worthless
  const c = await boot();
  const c1 = await c.create("secret1");
  await c.close();
  const d = await boot();
  try {
    const r = await d.call("POST", "", { body: { id: c1.id, record: c1.record, hostKey: c1.hostKey, plan: watchPlan(), version: 1 } });
    assert.equal(r.status, 403);
    assert.equal(d.router.sessions.size, 0);
    assert.equal(d.router.persistentSecret, false);
  } finally {
    await d.close();
  }
});

test("limits: session cap evicts the least recently used, idle sessions expire, creation is rate limited per IP", async () => {
  const s = await boot({ limits: { maxSessions: 3, sessionTtlMs: 1000, createPerHour: 4 } });
  try {
    const first = await s.create("pocket1", watchPlan(["1"]));
    s.state.t += 10;
    const second = await s.create("pocket1", watchPlan(["2"]));
    s.state.t += 10;
    await s.create("pocket1", watchPlan(["3"]));
    s.state.t += 10;
    await s.call("GET", `/${first.id}`); // touch the oldest -> `second` becomes the least recently used
    s.state.t += 10;
    await s.create("pocket1", watchPlan(["4"])); // 4th create triggers eviction
    assert.equal(s.router.sessions.size, 3);
    assert.equal((await s.call("GET", `/${second.id}`)).status, 404, "least recently used was evicted");
    assert.equal((await s.call("GET", `/${first.id}`)).status, 200);

    const limited = await s.call("POST", "", { body: { password: "pocket1", plan: watchPlan(["5"]) } });
    assert.equal(limited.status, 429, "5th creation within the hour");

    s.state.t += 5_000;
    s.router.cleanup();
    assert.equal(s.router.sessions.size, 0, "all idle sessions expired");
    s.state.t += 3_600_001;
    assert.equal((await s.call("POST", "", { body: { password: "pocket1", plan: watchPlan(["5"]) } })).status, 201, "limit window passed");
  } finally {
    await s.close();
  }
});

test("restore race: of two host devices restoring after a restart the one with the NEWER plan wins, but never over a published change", async () => {
  const secret = "fixed-test-secret";
  const a = await boot({ secret });
  const created = await a.create("secret1", watchPlan(["1"]));
  await a.close();
  const b = await boot({ secret });
  try {
    const restore = (plan, version) =>
      b.call("POST", "", { body: { id: created.id, record: created.record, hostKey: created.hostKey, plan, version } });
    const stale = await restore(watchPlan(["1"]), 4); // a viewer-host that only knew version 4 gets there first
    assert.equal(stale.json.version, 5);
    const newer = await restore(watchPlan(["1", "2"]), 6); // the host that knew version 6 arrives second
    assert.equal(newer.status, 200);
    assert.equal(newer.json.restored, true, "newer plan replaces the stale restore");
    assert.equal(newer.json.version, 7);
    assert.deepEqual(newer.json.plan, watchPlan(["1", "2"]));
    const older = await restore(watchPlan(["9"]), 3); // a straggler with an even older plan changes nothing
    assert.equal(older.json.restored, false);
    assert.deepEqual(older.json.plan, watchPlan(["1", "2"]));
    assert.equal(older.json.version, 7);
    // once the host publishes, no later restore may overwrite it
    const pub = await b.call("PUT", `/${created.id}`, { key: created.hostKey, body: { baseVersion: 7, plan: watchPlan(["5"]) } });
    assert.equal(pub.status, 200);
    const late = await restore(watchPlan(["1", "2", "3"]), 50);
    assert.equal(late.json.restored, false);
    assert.deepEqual((await b.call("GET", `/${created.id}`)).json.plan, watchPlan(["5"]));
  } finally {
    await b.close();
  }
});

const trainingPlan = (ids = ["13719"]) => ({
  kind: "watch",
  host: "stage",
  eventId: "1594",
  sequence: [...ids.map((id) => ({ type: "training", id })), round("13722")],
  showNextPreview: true,
});

test("training counter: everyone can read it, only a host can change it, bounds are enforced", async () => {
  const s = await boot();
  try {
    const { id, hostKey } = await s.create("secret1", trainingPlan());
    const path = `/${id}/training/13719`;
    assert.deepEqual((await s.call("GET", path)).json, { index: 0 }, "starts at the beginning");
    assert.equal((await s.call("POST", path, { body: { delta: 1 } })).status, 403, "no host key");
    assert.equal((await s.call("POST", path, { key: "0".repeat(64), body: { delta: 1 } })).status, 403, "wrong host key");
    assert.deepEqual((await s.call("GET", path)).json, { index: 0 }, "refused writes change nothing");

    assert.deepEqual((await s.call("POST", path, { key: hostKey, body: { delta: 1 } })).json, { index: 1 });
    assert.deepEqual((await s.call("POST", path, { key: hostKey, body: { delta: 4 } })).json, { index: 5 });
    assert.deepEqual((await s.call("POST", path, { key: hostKey, body: { delta: -9 } })).json, { index: 0 }, "never below 0");
    assert.deepEqual((await s.call("POST", path, { key: hostKey, body: { set: 24 } })).json, { index: 24 }, "finish = set to the roster length");
    assert.deepEqual((await s.call("GET", path)).json, { index: 24 }, "viewers see the new position");
    assert.deepEqual((await s.call("POST", path, { key: hostKey, body: { set: 0 } })).json, { index: 0 }, "restart");
    assert.deepEqual((await s.call("POST", path, { key: hostKey, body: { set: 99999999 } })).json, { index: 10000 }, "capped");
    for (const body of [{}, { delta: 1.5 }, { delta: "1" }, { set: -0.5 }, { delta: 1, set: 2 }, { set: null }]) {
      assert.equal((await s.call("POST", path, { key: hostKey, body })).status, 400, JSON.stringify(body));
    }
  } finally {
    await s.close();
  }
});

test("training counter: only for training entries of the plan, scoped per session", async () => {
  const s = await boot();
  try {
    const a = await s.create("secret1", trainingPlan(["13719"]));
    const b = await s.create("secret1", trainingPlan(["13719"]));
    assert.equal((await s.call("GET", `/${a.id}/training/13722`)).status, 404, "a plain round is not a training");
    assert.equal((await s.call("GET", `/${a.id}/training/abc`)).status, 404);
    assert.equal((await s.call("POST", `/${a.id}/training/99999`, { key: a.hostKey, body: { delta: 1 } })).status, 404, "unknown round: nothing is created");
    assert.equal((await s.call("GET", `/aaaaaaaa/training/13719`)).status, 404, "unknown session");
    await s.call("POST", `/${a.id}/training/13719`, { key: a.hostKey, body: { delta: 3 } });
    assert.equal((await s.call("GET", `/${b.id}/training/13719`)).json.index, 0, "another session is unaffected");
    assert.equal((await s.call("POST", `/${b.id}/training/13719`, { key: a.hostKey, body: { delta: 1 } })).status, 403, "a host key only works for its own session");
    assert.equal(s.router.sessions.get(a.id).training.size, 1, "only real trainings are stored");
  } finally {
    await s.close();
  }
});

test("training counter survives an unrelated plan change, is dropped when the training is removed and starts over when re-added", async () => {
  const s = await boot();
  try {
    const { id, hostKey } = await s.create("secret1", trainingPlan(["13719"]));
    const path = `/${id}/training/13719`;
    await s.call("POST", path, { key: hostKey, body: { delta: 6 } });
    const publish = (plan, baseVersion) => s.call("PUT", `/${id}`, { key: hostKey, body: { baseVersion, plan } });

    assert.equal((await publish({ ...trainingPlan(["13719"]), sequence: [round("1"), ...trainingPlan(["13719"]).sequence] }, 1)).status, 200);
    assert.equal((await s.call("GET", path)).json.index, 6, "reordering/adding keeps the position");

    assert.equal((await publish(watchPlan(["1"]), 2)).status, 200);
    assert.equal((await s.call("GET", path)).status, 404, "training removed from the plan");
    assert.equal(s.router.sessions.get(id).training.size, 0, "its counter is gone");

    assert.equal((await publish(trainingPlan(["13719"]), 3)).status, 200);
    assert.equal((await s.call("GET", path)).json.index, 0, "re-added training starts from the beginning");
  } finally {
    await s.close();
  }
});

test("training counter is lost on a restart (like the stand-alone training counter) and a restored session starts it at 0", async () => {
  const secret = "fixed-test-secret";
  const a = await boot({ secret });
  const created = await a.create("secret1", trainingPlan());
  await a.call("POST", `/${created.id}/training/13719`, { key: created.hostKey, body: { delta: 5 } });
  await a.close();
  const b = await boot({ secret });
  try {
    const restore = await b.call("POST", "", { body: { id: created.id, record: created.record, hostKey: created.hostKey, plan: trainingPlan(), version: 1 } });
    assert.equal(restore.status, 201);
    assert.equal((await b.call("GET", `/${created.id}/training/13719`)).json.index, 0);
    assert.deepEqual((await b.call("POST", `/${created.id}/training/13719`, { key: created.hostKey, body: { delta: 1 } })).json, { index: 1 }, "the old host key still controls it");
  } finally {
    await b.close();
  }
});


// ---- technical incidents (6.48) ------------------------------------------------
const tiBody = (extra = {}) => ({ roundId: "13682", routeIds: [21961], athleteId: 9346, beforeAthleteId: 9350, ...extra });

test("technical incident: only a host can add one, viewers see it in the poll, the incident version moves", async () => {
  const s = await boot();
  try {
    const { id, hostKey } = await s.create("secret1", watchPlan(["13682", "13709"]));
    const before = (await s.call("GET", `/${id}`)).json;
    assert.deepEqual(before.ti, []);
    assert.equal((await s.call("POST", `/${id}/ti`, { body: tiBody() })).status, 403, "no key");
    assert.equal((await s.call("POST", `/${id}/ti`, { key: "0".repeat(64), body: tiBody() })).status, 403, "wrong key");
    const r = await s.call("POST", `/${id}/ti`, { key: hostKey, body: tiBody() });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.ti.athleteId, 9346);
    assert.equal(r.json.ti.done, false);
    assert.deepEqual(r.json.ti.routeIds, [21961]);
    const after = (await s.call("GET", `/${id}?v=1&tv=${before.tiVersion}`)).json;
    assert.ok(!after.unchanged, "an incident change reaches a tablet that already has the plan");
    assert.equal(after.version, 1, "the plan version is untouched");
    assert.equal(after.ti.length, 1);
    assert.ok(after.tiVersion > before.tiVersion);
    assert.ok(!("hostKey" in after) && !("record" in after));
  } finally {
    await s.close();
  }
});

test("technical incident: Lead and Boulder only, round must be in the plan, ids are validated", async () => {
  const s = await boot();
  try {
    const { id, hostKey } = await s.create("secret1", watchPlan(["13682", "13709", "13719"]));
    const post = (body) => s.call("POST", `/${id}/ti`, { key: hostKey, body });
    assert.equal((await post(tiBody({ roundId: "13719" }))).status, 400, "Speed is refused");
    assert.match((await post(tiBody({ roundId: "13719" }))).json.error, /Lead and Boulder/);
    assert.equal((await post(tiBody({ roundId: "13709", routeIds: [1, 2, 3], boulderRouteId: 2 }))).status, 201, "Boulder: a block of routes and the boulder he climbs again on");
    assert.equal((await post(tiBody({ roundId: "13709", routeIds: [1, 2, 3] }))).status, 400, "Boulder needs its boulder");
    assert.equal((await post(tiBody({ roundId: "13709", routeIds: [1, 2, 3], boulderRouteId: 9 }))).status, 400, "the boulder must be one of the block's routes");
    assert.equal((await post(tiBody({ roundId: "13709", routeIds: [1, 2, 3], boulderRouteId: "x" }))).status, 400);
    assert.equal((await post(tiBody({ boulderRouteId: 21961 }))).status, 400, "a Lead incident has no boulder");
    assert.equal((await post(tiBody({ reuseOf: "abc" }))).status, 400, "nor a slot to use");
    assert.equal((await post(tiBody({ roundId: "555" }))).status, 400, "round not in the plan");
    assert.equal((await post(tiBody({ athleteId: "x" }))).status, 400);
    assert.equal((await post(tiBody({ beforeAthleteId: "x" }))).status, 400);
    assert.equal((await post(tiBody({ athleteId: 5, beforeAthleteId: 5 }))).status, 400, "before themselves");
    assert.equal((await post(tiBody({ routeIds: [] }))).status, 400);
    assert.equal((await post(tiBody({ routeIds: [1, 1] }))).status, 400, "duplicate routes");
    assert.equal((await post(tiBody({ routeIds: ["a"] }))).status, 400);
    assert.equal((await post(tiBody({ routeIds: Array.from({ length: 21 }, (_, i) => i + 1) }))).status, 400);
    assert.equal((await post(tiBody({ beforeAthleteId: null }))).status, 201, "at the end of the startlist");
    assert.equal(s.router.sessions.get(id).ti.length, 2, "refused requests store nothing");
    assert.equal(s.router.sessions.get(id).ti[0].boulderRouteId, 2);
  } finally {
    await s.close();
  }
});

test("technical incident: a failing round lookup is a 502, and without a lookup nothing is accepted", async () => {
  const s = await boot({ disciplines: { 99999: "Lead" } });
  try {
    const { id, hostKey } = await s.create("secret1", watchPlan(["99999"]));
    assert.equal((await s.call("POST", `/${id}/ti`, { key: hostKey, body: tiBody({ roundId: "99999" }) })).status, 502);
  } finally {
    await s.close();
  }
  const router = createSessionRouter({ hostNames: HOSTS });
  const app = express();
  app.use("/api/session", router);
  const server = await new Promise((resolve) => {
    const x = app.listen(0, "127.0.0.1", () => resolve(x));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/session`;
    const c = await (await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "secret1", plan: watchPlan() }) })).json();
    const r = await fetch(`${base}/${c.id}/ti`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.hostKey}` }, body: JSON.stringify(tiBody()) });
    assert.equal(r.status, 400);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("technical incident: done keeps a short history, remove deletes, both need the host key", async () => {
  const s = await boot();
  try {
    const { id, hostKey } = await s.create("secret1", watchPlan());
    const add = async () => (await s.call("POST", `/${id}/ti`, { key: hostKey, body: tiBody() })).json.ti;
    const a = await add();
    const b = await add();
    assert.equal((await s.call("POST", `/${id}/ti/${a.id}/done`)).status, 403);
    assert.equal((await s.call("DELETE", `/${id}/ti/${a.id}`)).status, 403);
    const done = await s.call("POST", `/${id}/ti/${a.id}/done`, { key: hostKey });
    assert.equal(done.status, 200);
    assert.equal(done.json.ti.done, true);
    const stored = s.router.sessions.get(id).ti;
    assert.deepEqual(stored.map((x) => [x.id, x.done]), [[a.id, true], [b.id, false]]);
    const v = s.router.sessions.get(id).tiVersion;
    await s.call("POST", `/${id}/ti/${a.id}/done`, { key: hostKey });
    assert.equal(s.router.sessions.get(id).tiVersion, v, "done twice changes nothing");
    assert.equal((await s.call("DELETE", `/${id}/ti/${b.id}`, { key: hostKey })).status, 200);
    assert.equal((await s.call("DELETE", `/${id}/ti/${b.id}`, { key: hostKey })).status, 404);
    assert.equal((await s.call("POST", `/${id}/ti/zzzz/done`, { key: hostKey })).status, 404);
    assert.deepEqual(s.router.sessions.get(id).ti.map((x) => x.id), [a.id]);
    // The history of finished incidents stays short.
    for (let i = 0; i < 15; i++) {
      const t = await add();
      await s.call("POST", `/${id}/ti/${t.id}/done`, { key: hostKey });
    }
    assert.ok(s.router.sessions.get(id).ti.length <= 10, "at most 10 finished incidents are kept");
  } finally {
    await s.close();
  }
});

test("technical incident: the per-session cap drops the oldest finished one, never an open one", async () => {
  const s = await boot({ limits: { maxTi: 3 } });
  try {
    const { id, hostKey } = await s.create("secret1", watchPlan());
    const add = () => s.call("POST", `/${id}/ti`, { key: hostKey, body: tiBody() });
    const first = (await add()).json.ti;
    await add();
    await add();
    assert.equal((await add()).status, 400, "three open incidents fill the session");
    await s.call("POST", `/${id}/ti/${first.id}/done`, { key: hostKey });
    assert.equal((await add()).status, 201, "a finished one makes room");
    assert.ok(!s.router.sessions.get(id).ti.some((x) => x.id === first.id));
  } finally {
    await s.close();
  }
});

test("technical incident: removed with its round when a new plan drops it, untouched by an unrelated plan change", async () => {
  const s = await boot();
  try {
    const { id, hostKey } = await s.create("secret1", watchPlan(["13682", "13709"]));
    await s.call("POST", `/${id}/ti`, { key: hostKey, body: tiBody() });
    await s.call("POST", `/${id}/ti`, { key: hostKey, body: tiBody({ roundId: "13709", routeIds: [7], boulderRouteId: 7 }) });
    const publish = (plan, baseVersion) => s.call("PUT", `/${id}`, { key: hostKey, body: { plan, baseVersion } });
    const v1 = s.router.sessions.get(id).tiVersion;
    assert.equal((await publish(watchPlan(["13709", "13682"]), 1)).status, 200);
    assert.equal(s.router.sessions.get(id).ti.length, 2, "reordering keeps both");
    assert.equal(s.router.sessions.get(id).tiVersion, v1);
    assert.equal((await publish(watchPlan(["13709"]), 2)).status, 200);
    assert.deepEqual(s.router.sessions.get(id).ti.map((x) => x.roundId), ["13709"]);
    assert.ok(s.router.sessions.get(id).tiVersion > v1);
  } finally {
    await s.close();
  }
});

test("technical incident: works for the rounds of a split-view entry and is lost on a restart (restored session starts empty)", async () => {
  const a = await boot({ secret: "fixed-secret" });
  const plan = { kind: "watch", host: "stage", eventId: "1594", sequence: [{ type: "split", columns: [{ sequence: [round("13709")], group: null, route: null }, { sequence: [round("13682")], group: null, route: null }] }], showNextPreview: true };
  const created = await a.create("secret1", plan);
  assert.equal((await a.call("POST", `/${created.id}/ti`, { key: created.hostKey, body: tiBody({ roundId: "13709", routeIds: [7, 8], boulderRouteId: 8 }) })).status, 201);
  assert.equal((await a.call("POST", `/${created.id}/ti`, { key: created.hostKey, body: tiBody({ roundId: "13682" }) })).status, 201, "second column's round too");
  await a.close();
  const b = await boot({ secret: "fixed-secret" });
  try {
    const restore = await b.call("POST", "", { body: { id: created.id, record: created.record, hostKey: created.hostKey, plan, version: 1 } });
    assert.equal(restore.status, 201, restore.text);
    assert.deepEqual(restore.json.ti, []);
  } finally {
    await b.close();
  }
});

test("technical incident (Boulder): a TI can use the free slot of another one, be edited, and a removed owner hands its position on", async () => {
  const s = await boot();
  try {
    const { id, hostKey } = await s.create("secret1", watchPlan(["13709", "13682"]));
    const post = (extra) => s.call("POST", `/${id}/ti`, { key: hostKey, body: tiBody({ roundId: "13709", routeIds: [1, 2, 3], boulderRouteId: 1, ...extra }) });
    const owner = await post({ athleteId: 11, beforeAthleteId: 30 });
    assert.equal(owner.status, 201, owner.text);
    assert.equal(owner.json.ti.boulderRouteId, 1);
    assert.equal(owner.json.ti.no, 1);
    // reuse: another boulder of the same block, an existing other TI, not itself, not a reuser
    const bad = async (extra) => (await post({ athleteId: 12, beforeAthleteId: 30, boulderRouteId: 3, ...extra })).status;
    assert.equal(await bad({ reuseOf: "nope" }), 400, "unknown TI");
    assert.equal(await bad({ reuseOf: owner.json.ti.id, boulderRouteId: 1 }), 400, "the owner already climbs that boulder");
    assert.equal(await bad({ reuseOf: owner.json.ti.id, routeIds: [1, 2] }), 400, "another block");
    const user = await post({ athleteId: 12, beforeAthleteId: 30, boulderRouteId: 3, reuseOf: owner.json.ti.id });
    assert.equal(user.status, 201, user.text);
    assert.equal(user.json.ti.reuseOf, owner.json.ti.id);
    assert.equal(user.json.ti.no, 2);
    assert.equal(await bad({ athleteId: 13, boulderRouteId: 2, reuseOf: user.json.ti.id }), 400, "a user is no owner");
    assert.equal((await s.call("POST", `/${id}/ti`, { key: hostKey, body: tiBody({ reuseOf: owner.json.ti.id }) })).status, 400, "Lead has no slot to use");
    // edit: the host key is needed, same checks, the round and block stay
    const put = (tiId, body, key = hostKey) => s.call("PUT", `/${id}/ti/${tiId}`, { key, body: tiBody({ roundId: "13709", routeIds: [1, 2, 3], boulderRouteId: 1, athleteId: 11, ...body }) });
    assert.equal((await put(owner.json.ti.id, { beforeAthleteId: 31 }, null)).status, 403, "no key");
    const moved = await put(owner.json.ti.id, { beforeAthleteId: 31 });
    assert.equal(moved.status, 200, moved.text);
    assert.equal(moved.json.ti.beforeAthleteId, 31);
    assert.equal(moved.json.ti.no, 1, "the number stays");
    assert.equal((await put(owner.json.ti.id, { boulderRouteId: 3, beforeAthleteId: 31 })).status, 400, "he can't move onto the boulder the user climbs");
    assert.equal((await put(owner.json.ti.id, { routeIds: [1, 2], beforeAthleteId: 31 })).status, 400, "the block can't change");
    assert.equal((await put(owner.json.ti.id, { roundId: "13682", routeIds: [21961], boulderRouteId: undefined })).status, 400, "nor the round");
    assert.equal((await put("nope", {})).status, 404);
    const before = s.router.sessions.get(id).tiVersion;
    assert.ok(before > 1);
    // removing the owner: the user keeps the position the owner had
    assert.equal((await s.call("DELETE", `/${id}/ti/${owner.json.ti.id}`, { key: hostKey })).status, 200);
    const kept = s.router.sessions.get(id).ti;
    assert.equal(kept.length, 1);
    assert.equal(kept[0].reuseOf, undefined);
    assert.equal(kept[0].beforeAthleteId, 31);
  } finally {
    await s.close();
  }
});

test("heartbeat: the key of a big split view fits what the server keeps, so the host's impact count is exact", async () => {
  const s = await boot();
  try {
    const { entryKey } = globalThis.SessionPlan;
    const columns = Array.from({ length: 5 }, (_, c) => ({ sequence: Array.from({ length: 10 }, (_, i) => round(String(200000 + c * 10 + i))), group: null, route: null }));
    const entry = { type: "split", columns };
    const plan = { kind: "watch", host: "stage", eventId: "1594", sequence: [entry], showNextPreview: true };
    const { id, hostKey } = await s.create("secret1", plan);
    const key = entryKey(entry);
    assert.ok(key.length <= 60);
    await s.call("GET", `/${id}?c=${"a".repeat(16)}&k=${encodeURIComponent(key)}`);
    const clients = await s.call("GET", `/${id}/clients`, { key: hostKey });
    assert.deepEqual(clients.json.clients, [{ keys: [key] }], "the key arrives untruncated");
    const { affectedClients } = globalThis.SessionPlan;
    assert.equal(affectedClients(plan, plan, clients.json.clients), 0, "an unchanged plan affects nobody");
  } finally {
    await s.close();
  }
});
