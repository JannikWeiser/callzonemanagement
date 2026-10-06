// Shared sessions (ARCHITECTURE.md 6.46): a host publishes ONE plan (the
// sequence of rounds, or the columns of a Split View) and every tablet that
// opens `?s=<id>` follows it. This is the second deliberate exception to "the
// server keeps no state" (the first being the Training counter) and the
// first thing in this app with a password:
//
//   - Anyone with the session id can WATCH (GET) - the id is the viewer's
//     only secret, tablets must open without typing anything.
//   - Changing the plan needs the host password. The server stores only a
//     scrypt hash; a successful login returns a `hostKey` (an HMAC over the
//     session id and the password hash, signed with SESSION_SECRET) that is
//     sent as `Authorization: Bearer <hostKey>` on writes.
//   - State lives in memory only. If the server restarts, tablets keep
//     showing the last plan they received, and a device that holds the host
//     credentials (record + hostKey) can restore the session under the same
//     id - which is only possible when SESSION_SECRET is set to a fixed
//     value (otherwise the per-process random secret changes on restart and
//     the old hostKeys no longer verify, so a stranger can't claim an id
//     either).
import crypto from "node:crypto";
import { promisify } from "node:util";
import express from "express";
import "./public/session-plan.js";

const { validatePlan } = globalThis.SessionPlan;
const scrypt = promisify(crypto.scrypt);

const ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o/1/i/l
const ID_LENGTH = 8;
const ID_PATTERN = new RegExp(`^[${ID_ALPHABET}]{${ID_LENGTH}}$`);
const HEX = /^[0-9a-f]+$/;

export const DEFAULTS = {
  maxSessions: 200,
  sessionTtlMs: 24 * 60 * 60_000, // untouched (no viewer poll, no host call) for a day -> dropped
  clientTtlMs: 15_000, // a tablet polls every 5 s; 3 missed polls and it no longer counts as online
  maxClientsPerSession: 300,
  minPasswordLength: 4,
  maxPasswordLength: 100,
  loginMaxFailures: 5,
  loginLockMs: 60_000,
  createPerHour: 20,
};

function newId() {
  let id = "";
  for (let i = 0; i < ID_LENGTH; i++) id += ID_ALPHABET[crypto.randomInt(ID_ALPHABET.length)];
  return id;
}

function safeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

async function hashPassword(password, saltHex) {
  const salt = saltHex ?? crypto.randomBytes(16).toString("hex");
  const hash = (await scrypt(password, Buffer.from(salt, "hex"), 64)).toString("hex");
  return { salt, hash };
}

function validRecord(record) {
  return (
    record &&
    typeof record.salt === "string" &&
    typeof record.hash === "string" &&
    record.salt.length === 32 &&
    record.hash.length === 128 &&
    HEX.test(record.salt) &&
    HEX.test(record.hash)
  );
}

/**
 * @param {object} opts
 * @param {string[]} opts.hostNames known results.info host keys
 * @param {string} [opts.secret] HMAC secret (SESSION_SECRET); random per process when omitted
 * @param {() => number} [opts.now] clock, injectable for tests
 * @param {object} [opts.limits] overrides for DEFAULTS
 */
export function createSessionRouter({ hostNames, secret, now = Date.now, limits = {} }) {
  const cfg = { ...DEFAULTS, ...limits };
  const persistentSecret = Boolean(secret);
  const hmacSecret = secret || crypto.randomBytes(32).toString("hex");
  const sessions = new Map(); // id -> session
  const loginFailures = new Map(); // "id|ip" -> { fails, lockedUntil }
  const createLog = new Map(); // ip -> [timestamps]

  const hostKeyFor = (id, recordHash) =>
    crypto.createHmac("sha256", hmacSecret).update(`${id}:${recordHash}`).digest("hex");

  function evictIfFull() {
    while (sessions.size >= cfg.maxSessions) {
      let oldest = null;
      for (const s of sessions.values()) if (!oldest || s.touchedAt < oldest.touchedAt) oldest = s;
      sessions.delete(oldest.id);
    }
  }

  function cleanup() {
    const t = now();
    for (const [id, s] of sessions) if (t - s.touchedAt > cfg.sessionTtlMs) sessions.delete(id);
    for (const [key, f] of loginFailures) if (f.lockedUntil < t && t - f.lastAt > cfg.loginLockMs) loginFailures.delete(key);
    for (const [ip, stamps] of createLog) {
      const fresh = stamps.filter((x) => t - x < 3_600_000);
      if (fresh.length) createLog.set(ip, fresh);
      else createLog.delete(ip);
    }
  }
  const timer = setInterval(cleanup, 10 * 60_000);
  timer.unref();

  const router = express.Router();
  router.use(express.json({ limit: "32kb" }));

  function bad(res, status, message, extra = {}) {
    return res.status(status).set("Cache-Control", "no-store").json({ error: message, ...extra });
  }

  function publicSession(s) {
    return { id: s.id, version: s.version, plan: s.plan };
  }

  function requireSession(req, res, next) {
    const id = String(req.params.id ?? "");
    const s = ID_PATTERN.test(id) ? sessions.get(id) : null;
    if (!s) return bad(res, 404, "Session not found");
    req.session = s;
    next();
  }

  function requireHostKey(req, res, next) {
    const header = req.get("authorization") ?? "";
    const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!safeEqualHex(key, hostKeyFor(req.session.id, req.session.record.hash))) {
      return bad(res, 403, "Host password required");
    }
    next();
  }

  function normalize(planInput) {
    return validatePlan(planInput, hostNames);
  }

  // ---- create (new, or restore under an existing id) ---------------------
  router.post("/", async (req, res) => {
    const body = req.body ?? {};
    try {
      // Restore: a host device that still holds its credentials re-creates a
      // session the server forgot (restart), under the SAME id.
      if (body.id !== undefined) {
        const id = String(body.id);
        if (!ID_PATTERN.test(id)) return bad(res, 400, "Invalid session id");
        if (!validRecord(body.record)) return bad(res, 400, "Invalid credentials");
        if (!safeEqualHex(String(body.hostKey ?? ""), hostKeyFor(id, body.record.hash))) {
          return bad(res, 403, "These credentials can't restore this session");
        }
        const existing = sessions.get(id);
        const baseVersion = Math.max(1, Math.floor(Number(body.version)) || 0);
        if (existing) {
          if (existing.record.hash !== body.record.hash) return bad(res, 409, "Session id is already in use");
          existing.touchedAt = now();
          // Two host devices can both notice the restart and restore. If the
          // first one to arrive only knew an OLDER plan and nobody has
          // published since the restore, the one with the newer plan wins -
          // otherwise a stale device would silently undo the host's last
          // change. A published change always wins over any restore.
          const unpublishedSinceRestore = existing.restoredFrom != null && existing.version === existing.restoredFrom + 1;
          if (unpublishedSinceRestore && baseVersion > existing.restoredFrom) {
            const plan = normalize(body.plan);
            if (plan.host === existing.host && plan.eventId === existing.eventId) {
              existing.plan = plan;
              existing.restoredFrom = baseVersion;
              existing.version = baseVersion + 1;
              return res.set("Cache-Control", "no-store").json({ ...publicSession(existing), restored: true });
            }
          }
          return res.set("Cache-Control", "no-store").json({ ...publicSession(existing), restored: false });
        }
        const plan = normalize(body.plan);
        evictIfFull();
        const t = now();
        const session = {
          id,
          host: plan.host,
          eventId: plan.eventId,
          plan,
          // Always newer than any version a tablet may already have seen
          // (the host sends the last version it knew).
          version: baseVersion + 1,
          restoredFrom: baseVersion,
          record: { salt: body.record.salt, hash: body.record.hash },
          createdAt: t,
          touchedAt: t,
          clients: new Map(),
        };
        sessions.set(id, session);
        return res.status(201).set("Cache-Control", "no-store").json({ ...publicSession(session), restored: true });
      }

      // New session.
      const password = body.password;
      if (typeof password !== "string" || password.length < cfg.minPasswordLength) {
        return bad(res, 400, `Password must be at least ${cfg.minPasswordLength} characters`);
      }
      if (password.length > cfg.maxPasswordLength) return bad(res, 400, "Password is too long");
      const plan = normalize(body.plan);

      const t = now();
      const stamps = (createLog.get(req.ip) ?? []).filter((x) => t - x < 3_600_000);
      if (stamps.length >= cfg.createPerHour) return bad(res, 429, "Too many sessions created, try again later");
      stamps.push(t);
      createLog.set(req.ip, stamps);

      let id = newId();
      while (sessions.has(id)) id = newId();
      const record = await hashPassword(password);
      evictIfFull();
      const session = {
        id,
        host: plan.host,
        eventId: plan.eventId,
        plan,
        version: 1,
        record,
        createdAt: t,
        touchedAt: t,
        clients: new Map(),
      };
      sessions.set(id, session);
      res.status(201).set("Cache-Control", "no-store").json({
        ...publicSession(session),
        record,
        hostKey: hostKeyFor(id, record.hash),
      });
    } catch (err) {
      bad(res, 400, err.message || "Invalid request");
    }
  });

  // ---- viewer poll + heartbeat -------------------------------------------
  router.get("/:id", requireSession, (req, res) => {
    const s = req.session;
    const t = now();
    s.touchedAt = t;

    const clientId = String(req.query.c ?? "");
    if (/^[a-f0-9]{8,32}$/.test(clientId)) {
      const keys = String(req.query.k ?? "")
        .split(",")
        .map((k) => k.slice(0, 60))
        .filter(Boolean)
        .slice(0, 5);
      if (!s.clients.has(clientId) && s.clients.size >= cfg.maxClientsPerSession) {
        s.clients.delete(s.clients.keys().next().value);
      }
      s.clients.delete(clientId); // re-insert so the Map stays in last-seen order
      s.clients.set(clientId, { at: t, keys });
    }

    if (String(req.query.v ?? "") === String(s.version)) {
      return res.set("Cache-Control", "no-store").json({ version: s.version, unchanged: true });
    }
    res.set("Cache-Control", "no-store").json(publicSession(s));
  });

  // ---- host login ----------------------------------------------------------
  router.post("/:id/login", requireSession, async (req, res) => {
    const s = req.session;
    const key = `${s.id}|${req.ip}`;
    const t = now();
    const state = loginFailures.get(key) ?? { fails: 0, lockedUntil: 0, lastAt: t };
    if (state.lockedUntil > t) {
      const retryAfterSec = Math.ceil((state.lockedUntil - t) / 1000);
      return bad(res, 429, `Too many wrong passwords, try again in ${retryAfterSec} s`, { retryAfterSec });
    }
    const password = req.body?.password;
    let ok = false;
    if (typeof password === "string" && password.length <= cfg.maxPasswordLength) {
      const { hash } = await hashPassword(password, s.record.salt);
      ok = safeEqualHex(hash, s.record.hash);
    }
    if (!ok) {
      state.fails += 1;
      state.lastAt = t;
      if (state.fails >= cfg.loginMaxFailures) {
        state.lockedUntil = t + cfg.loginLockMs;
        state.fails = 0;
      }
      loginFailures.set(key, state);
      return bad(res, 403, "Wrong password");
    }
    loginFailures.delete(key);
    s.touchedAt = t;
    res.set("Cache-Control", "no-store").json({
      ...publicSession(s),
      record: s.record,
      hostKey: hostKeyFor(s.id, s.record.hash),
    });
  });

  // ---- publish a new plan --------------------------------------------------
  router.put("/:id", requireSession, requireHostKey, (req, res) => {
    const s = req.session;
    let plan;
    try {
      plan = normalize(req.body?.plan);
    } catch (err) {
      return bad(res, 400, err.message || "Invalid plan");
    }
    if (plan.host !== s.host || plan.eventId !== s.eventId) {
      return bad(res, 400, "A session belongs to one event - this plan is for a different one");
    }
    if (Number(req.body?.baseVersion) !== s.version) {
      return bad(res, 409, "The plan was changed by someone else in the meantime", publicSession(s));
    }
    s.plan = plan;
    s.version += 1;
    s.touchedAt = now();
    res.set("Cache-Control", "no-store").json(publicSession(s));
  });

  // ---- who is online (host only) ------------------------------------------
  router.get("/:id/clients", requireSession, requireHostKey, (req, res) => {
    const s = req.session;
    const t = now();
    for (const [clientId, c] of s.clients) if (t - c.at > cfg.clientTtlMs) s.clients.delete(clientId);
    const clients = [...s.clients.values()].map((c) => ({ keys: c.keys }));
    res.set("Cache-Control", "no-store").json({ version: s.version, online: clients.length, clients });
  });

  // JSON error responses for malformed/oversized bodies (express.json would
  // otherwise answer with an HTML error page).
  router.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    bad(res, err.status === 413 ? 413 : 400, "Invalid request");
  });

  router.sessions = sessions;
  router.cleanup = cleanup;
  router.persistentSecret = persistentSecret;
  return router;
}
