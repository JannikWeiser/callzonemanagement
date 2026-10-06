import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSessionRouter } from "./sessions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Keep this in sync with the <select id="host"> options in
// public/index.html - the two lists are maintained independently (no
// shared source of truth, since the frontend is plain static HTML with no
// build/templating step) and a new host needs both updated by hand.
const HOSTS = {
  prod: "https://dav.results.info",
  ifsc: "https://ifsc.results.info",
  stage: "https://dav-stage.results.info",
  fasi: "https://fasi.results.info",
  usac: "https://usac.results.info",
  saccas: "https://sac-cas.results.info",
};

// Upstream requires a Referer from its own origin (anti-hotlink check),
// otherwise it answers 401 even though CORS headers are wide open.
function refererFor(host) {
  return `${HOSTS[host]}/`;
}

// Short server-side cache so multiple devices (laptop + iPad) polling this
// server don't each hammer results.info, and so we don't get rate limited.
const cache = new Map(); // key -> { at, data }
const MAX_CACHE_ENTRIES = 200; // a full competition day across several tablets stays well under this

async function cachedFetch(key, ttlMs, fetcher) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) {
    // Touch it: delete + re-set moves the key to the end of the Map's
    // insertion order, so the eviction below (which always drops the
    // FRONT of that order) age's out genuinely-unused entries first
    // instead of a frequently-polled one that just happens to have been
    // inserted early.
    cache.delete(key);
    cache.set(key, hit);
    return hit.data;
  }
  const data = await fetcher();
  if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), data });
  return data;
}

// Optional official API key per host (the documented `api_key` scheme of
// results.info's OpenAPI spec: header `x-auth-token`), read from
// RESULTS_API_KEY_<HOST> (e.g. RESULTS_API_KEY_STAGE). Without a key - or
// while the key is being rejected - requests go out exactly as before
// (Referer only), so a missing, expired or revoked key never takes the app
// down. A key only ever lives in this process's environment: never log it,
// never send it to the browser, never put it in the repo.
const API_KEYS = Object.fromEntries(
  Object.keys(HOSTS).map((host) => [host, process.env[`RESULTS_API_KEY_${host.toUpperCase()}`]?.trim() || null])
);
const KEY_RETRY_AFTER_MS = 5 * 60_000; // after a 401/403, stay on the Referer path this long before trying the key again
const keyState = new Map(); // host -> { ok: boolean, at: ms } - last outcome of using that host's key

function apiKeyFor(host) {
  const key = API_KEYS[host];
  if (!key) return null;
  const state = keyState.get(host);
  if (state && !state.ok && Date.now() - state.at < KEY_RETRY_AFTER_MS) return null;
  return key;
}

// Logs only on a change of outcome, so a rejected key doesn't spam the log
// on every poll.
function noteKeyOutcome(host, ok) {
  if (keyState.get(host)?.ok === ok) {
    keyState.set(host, { ok, at: Date.now() });
    return;
  }
  keyState.set(host, { ok, at: Date.now() });
  console.log(
    ok
      ? `[${host}] official API key accepted`
      : `[${host}] official API key REJECTED (401/403) - falling back to Referer-only requests, retrying in ${KEY_RETRY_AFTER_MS / 60_000} min`
  );
}

for (const [host, key] of Object.entries(API_KEYS)) {
  if (key) console.log(`[${host}] official API key configured (from RESULTS_API_KEY_${host.toUpperCase()})`);
}

// With a key: the official path ONLY (no Referer). Verified against the real
// API: a valid Referer alone already authorizes the request, and an invalid
// `x-auth-token` is silently ignored when a Referer is also present - so
// sending both would log "key accepted" for a bogus key. Without the
// Referer, the same bogus key gets a real 401, which is what makes
// noteKeyOutcome() trustworthy and exercises the documented API path.
function fetchUpstream(host, urlPath, key) {
  const headers = { Accept: "application/json" };
  if (key) headers["x-auth-token"] = key;
  else headers.Referer = refererFor(host);
  return fetch(`${HOSTS[host]}${urlPath}`, { headers });
}

async function upstreamJson(host, urlPath) {
  const key = apiKeyFor(host);
  let res = await fetchUpstream(host, urlPath, key);
  if (key) {
    if (res.status === 401 || res.status === 403) {
      // Only an auth failure retries without the key - 429/5xx would just hit
      // the same upstream harder on the fallback path.
      noteKeyOutcome(host, false);
      res = await fetchUpstream(host, urlPath, null);
    } else if (res.ok) {
      noteKeyOutcome(host, true);
    }
  }
  if (!res.ok) {
    const err = new Error(`Upstream ${res.status} for ${urlPath}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

const app = express();
// Behind Render's proxy, req.ip must be the real client (the session login
// and create rate limits are per IP).
app.set("trust proxy", 1);
app.use(express.static(path.join(__dirname, "public")));

// Shared sessions (sessions.js, ARCHITECTURE.md 6.46). SESSION_SECRET is
// optional: set to any fixed random string it lets a host device restore its
// session after a server restart; without it a restart simply ends all
// sessions (tablets keep showing their last plan).
const sessionRouter = createSessionRouter({
  hostNames: Object.keys(HOSTS),
  secret: process.env.SESSION_SECRET?.trim() || undefined,
});
app.use("/api/session", sessionRouter);
if (!sessionRouter.persistentSecret) {
  console.log("SESSION_SECRET not set - shared sessions end when the server restarts (no host restore)");
}

// `HOSTS` is a plain object literal, so a bare `!HOSTS[host]` truthiness
// check also (wrongly) passes for inherited Object.prototype property names
// such as "constructor" or "toString" - hasOwnProperty is what actually
// enforces "one of exactly these keys".
function isKnownHost(host) {
  return Object.prototype.hasOwnProperty.call(HOSTS, host);
}

function requireHost(req, res, next) {
  if (!isKnownHost(req.params.host)) {
    const valid = Object.keys(HOSTS).map((k) => `"${k}"`).join(", ");
    return res.status(400).json({ error: `Unknown host "${req.params.host}", use one of: ${valid}` });
  }
  next();
}

// results.info ids are always plain positive integers in every event/round
// this app has ever seen (see AGENTS.md's fixture table) - rejecting
// anything else up front (rather than string-interpolating it straight into
// the upstream URL) closes off path/query-injection against the upstream
// host via a crafted, percent-encoded id (e.g. "123%3Ffoo=bar").
const ID_PATTERN = /^\d+$/;

function requireNumericId(paramName) {
  return (req, res, next) => {
    if (!ID_PATTERN.test(req.params[paramName])) {
      return res.status(400).json({ error: `"${paramName}" must be a positive integer` });
    }
    next();
  };
}

// Only `err.status` (set by upstreamJson() above for a real, well-formed
// upstream HTTP response) is safe to echo back verbatim - it's just a
// number and a URL path we already know. Anything else (a network error, a
// malformed-URL TypeError, ...) gets a generic message instead of whatever
// internal Node/undici wording it happens to carry, logged server-side for
// debugging instead.
function sendUpstreamError(res, err) {
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error("Upstream request failed:", err);
  res.status(502).json({ error: "Upstream request failed" });
}

app.get("/api/event/:host/:eventId", requireHost, requireNumericId("eventId"), async (req, res) => {
  const { host, eventId } = req.params;
  try {
    const data = await cachedFetch(`event:${host}:${eventId}`, 20_000, () =>
      upstreamJson(host, `/api/v1/events/${eventId}`)
    );
    res.set("Cache-Control", "no-store").json(data);
  } catch (err) {
    sendUpstreamError(res, err);
  }
});

app.get("/api/round/:host/:roundId", requireHost, requireNumericId("roundId"), async (req, res) => {
  const { host, roundId } = req.params;
  try {
    const data = await cachedFetch(`round:${host}:${roundId}`, 3_000, () =>
      upstreamJson(host, `/api/v1/category_rounds/${roundId}/results`)
    );
    res.set("Cache-Control", "no-store").json(data);
  } catch (err) {
    sendUpstreamError(res, err);
  }
});

// Shared, ephemeral position for Training mode - lets a wall-mounted tablet
// (display) and a second device such as a phone (controller) stay in sync
// without any account/auth system, since there's no live results.info data
// to poll during training. Keyed by host+round, not persisted across a
// server restart - acceptable, since a training position is meaningless
// once the training session itself restarts anyway.
const trainingIndex = new Map(); // "host:roundId" -> number
const MAX_TRAINING_ENTRIES = 200;

function trainingKey(host, roundId) {
  return `${host}:${roundId}`;
}

app.get("/api/training/:host/:roundId", requireHost, requireNumericId("roundId"), (req, res) => {
  const key = trainingKey(req.params.host, req.params.roundId);
  res.set("Cache-Control", "no-store").json({ index: trainingIndex.get(key) ?? 0 });
});

app.post("/api/training/:host/:roundId", requireHost, requireNumericId("roundId"), express.json(), (req, res) => {
  const key = trainingKey(req.params.host, req.params.roundId);
  const delta = Number(req.body?.delta);
  if (!Number.isInteger(delta)) {
    return res.status(400).json({ error: "Body must be { delta: <integer> }" });
  }
  if (!trainingIndex.has(key) && trainingIndex.size >= MAX_TRAINING_ENTRIES) {
    trainingIndex.delete(trainingIndex.keys().next().value);
  }
  const next = Math.max(0, (trainingIndex.get(key) ?? 0) + delta);
  trainingIndex.set(key, next);
  res.set("Cache-Control", "no-store").json({ index: next });
});

const PORT = process.env.PORT || 4173;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Callzone Management laeuft auf http://localhost:${PORT}`);
});
