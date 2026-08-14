import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HOSTS = {
  prod: "https://dav.results.info",
  ifsc: "https://ifsc.results.info",
  stage: "https://dav-stage.results.info",
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
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  const data = await fetcher();
  if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), data });
  return data;
}

async function upstreamJson(host, urlPath) {
  const res = await fetch(`${HOSTS[host]}${urlPath}`, {
    headers: {
      Accept: "application/json",
      Referer: refererFor(host),
    },
  });
  if (!res.ok) {
    const err = new Error(`Upstream ${res.status} for ${urlPath}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

const app = express();
app.use(express.static(path.join(__dirname, "public")));

function requireHost(req, res, next) {
  if (!HOSTS[req.params.host]) {
    const valid = Object.keys(HOSTS).map((k) => `"${k}"`).join(", ");
    return res.status(400).json({ error: `Unknown host "${req.params.host}", use one of: ${valid}` });
  }
  next();
}

app.get("/api/event/:host/:eventId", requireHost, async (req, res) => {
  const { host, eventId } = req.params;
  try {
    const data = await cachedFetch(`event:${host}:${eventId}`, 20_000, () =>
      upstreamJson(host, `/api/v1/events/${eventId}`)
    );
    res.set("Cache-Control", "no-store").json(data);
  } catch (err) {
    res.status(err.status ?? 502).json({ error: err.message });
  }
});

app.get("/api/round/:host/:roundId", requireHost, async (req, res) => {
  const { host, roundId } = req.params;
  try {
    const data = await cachedFetch(`round:${host}:${roundId}`, 3_000, () =>
      upstreamJson(host, `/api/v1/category_rounds/${roundId}/results`)
    );
    res.set("Cache-Control", "no-store").json(data);
  } catch (err) {
    res.status(err.status ?? 502).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 4173;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Callzone Management laeuft auf http://localhost:${PORT}`);
});
