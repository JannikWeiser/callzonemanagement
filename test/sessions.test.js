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
const multiPlan = () => ({
  kind: "multi",
  host: "stage",
  eventId: "1594",
  entries: [{ sequence: [round("1")], group: "Group A", route: ["A1"] }, { sequence: [], group: null, route: null }],
});

// Boots the router on an ephemeral port with an injectable clock.
async function boot({ secret, limits, clock } = {}) {
  const state = { t: clock ?? 1_000_000 };
  const router = createSessionRouter({ hostNames: HOSTS, secret, now: () => state.t, limits: { loginLockMs: 60_000, ...limits } });
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
    assert.deepEqual((await s.call("GET", `/${id}?v=1`)).json, { version: 1, unchanged: true });
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

test("publish can switch a session between a watch plan and a split view", async () => {
  const s = await boot();
  try {
    const { id, hostKey } = await s.create();
    const r = await s.call("PUT", `/${id}`, { key: hostKey, body: { baseVersion: 1, plan: multiPlan() } });
    assert.equal(r.status, 200);
    assert.deepEqual((await s.call("GET", `/${id}?v=1`)).json.plan, multiPlan());
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
