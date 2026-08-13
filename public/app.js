const STORAGE_KEY = "callzone-selection";

const el = {
  eventId: document.getElementById("eventId"),
  host: document.getElementById("host"),
  loadEvent: document.getElementById("loadEvent"),
  setupError: document.getElementById("setupError"),
  categoryRow: document.getElementById("categoryRow"),
  roundSelect: document.getElementById("roundSelect"),
  watchRound: document.getElementById("watchRound"),
  setup: document.getElementById("setup"),
  board: document.getElementById("board"),
  backBtn: document.getElementById("backBtn"),
  roundTitle: document.getElementById("roundTitle"),
  statusLine: document.getElementById("statusLine"),
  lanes: document.getElementById("lanes"),
  shareLink: document.getElementById("shareLink"),
  copyLink: document.getElementById("copyLink"),
};

let pollTimer = null;

function saveSelection(sel) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sel));
}
function loadSelection() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

// Lets each tablet be bookmarked straight to "its" category, so it doesn't
// need the setup screen on every reload - see buildShareLink/startWatching.
function readUrlSelection() {
  const params = new URLSearchParams(location.search);
  const host = params.get("host");
  const eventId = params.get("event");
  const roundId = params.get("round");
  return host && eventId ? { host, eventId, roundId } : null;
}

function buildShareLink({ host, eventId, roundId }) {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set("host", host);
  url.searchParams.set("event", eventId);
  url.searchParams.set("round", roundId);
  return url.toString();
}

function showError(msg) {
  el.setupError.textContent = msg;
  el.setupError.hidden = !msg;
}

async function loadEvent() {
  const eventId = el.eventId.value.trim();
  const host = el.host.value;
  if (!eventId) {
    showError("Bitte Event ID eingeben.");
    return;
  }
  showError("");
  el.loadEvent.disabled = true;
  el.loadEvent.textContent = "Lädt …";
  try {
    const res = await fetch(`/api/event/${host}/${encodeURIComponent(eventId)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
    populateRounds(data, host, eventId);
  } catch (err) {
    showError(`Event konnte nicht geladen werden: ${err.message}`);
    el.categoryRow.hidden = true;
  } finally {
    el.loadEvent.disabled = false;
    el.loadEvent.textContent = "Event laden";
  }
}

const STATUS_LABEL = {
  active: "läuft",
  pending: "noch nicht gestartet",
  finished: "beendet",
};

function populateRounds(eventData, host, eventId) {
  const entries = [];
  for (const dcat of eventData.d_cats ?? []) {
    for (const round of dcat.category_rounds ?? []) {
      entries.push({
        roundId: round.category_round_id,
        label: `${dcat.dcat_name} — ${round.name}`,
        status: round.status,
      });
    }
  }
  const rank = { active: 0, pending: 1, finished: 2 };
  entries.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || a.label.localeCompare(b.label));

  el.roundSelect.innerHTML = "";
  for (const entry of entries) {
    const opt = document.createElement("option");
    opt.value = entry.roundId;
    opt.textContent = `${entry.label} (${STATUS_LABEL[entry.status] ?? entry.status})`;
    el.roundSelect.appendChild(opt);
  }
  el.categoryRow.hidden = entries.length === 0;
  if (entries.length === 0) showError("Dieses Event hat keine Altersklassen/Runden.");

  el.watchRound.onclick = () => {
    const roundId = el.roundSelect.value;
    if (!roundId) return;
    startWatching(host, eventId, roundId);
  };
}

function startWatching(host, eventId, roundId) {
  saveSelection({ host, eventId, roundId });
  el.shareLink.value = buildShareLink({ host, eventId, roundId });
  el.setup.hidden = true;
  el.board.hidden = false;
  clearInterval(pollTimer);
  pollRound(host, roundId);
  pollTimer = setInterval(() => pollRound(host, roundId), 3000);
}

el.backBtn.addEventListener("click", () => {
  clearInterval(pollTimer);
  el.board.hidden = true;
  el.setup.hidden = false;
});

el.copyLink.addEventListener("click", async () => {
  el.shareLink.select();
  try {
    await navigator.clipboard.writeText(el.shareLink.value);
    el.copyLink.textContent = "Kopiert!";
  } catch {
    // Clipboard API needs a secure context; on plain http://<lan-ip> (no
    // HTTPS) Safari blocks it. The select() above still lets the user
    // copy manually with Cmd/Strg+C, so just tell them that.
    el.copyLink.textContent = "Markiert - jetzt kopieren";
  }
  setTimeout(() => (el.copyLink.textContent = "Kopieren"), 2000);
});

async function pollRound(host, roundId) {
  try {
    const res = await fetch(`/api/round/${host}/${roundId}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
    renderBoard(data);
    el.statusLine.textContent = `Aktualisiert ${new Date().toLocaleTimeString("de-DE")}`;
    el.statusLine.classList.remove("stale");
  } catch (err) {
    el.statusLine.textContent = `Verbindung verloren: ${err.message}`;
    el.statusLine.classList.add("stale");
  }
}

// The API never says who is climbing "right now". It only tells us, per
// route, which athletes already have a confirmed/locked ascent and which
// are still "pending". We infer the callzone order from that: walking the
// start order, the first not-yet-climbed athlete is assumed to be at the
// wall, the one after is next, the rest are the upcoming queue.
function computeLane(round, route) {
  const statusByAthlete = new Map();
  for (const entry of round.ranking ?? []) {
    const ascent = entry.ascents?.find((a) => a.route_id === route.id);
    if (ascent) statusByAthlete.set(entry.athlete_id, ascent.status);
  }

  const ordered = (round.startlist ?? [])
    .map((athlete) => {
      const pos = athlete.route_start_positions?.find((p) => p.route_id === route.id);
      return pos ? { athlete, position: pos.position } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.position - b.position)
    .map((x) => x.athlete);

  let currentIndex = ordered.findIndex((a) => (statusByAthlete.get(a.athlete_id) ?? "pending") === "pending");
  if (currentIndex === -1) currentIndex = ordered.length; // everyone done

  return {
    routeName: route.name,
    finished: currentIndex >= ordered.length,
    atWall: ordered[currentIndex] ?? null,
    onDeck: ordered[currentIndex + 1] ?? null,
    queue: ordered.slice(currentIndex + 2, currentIndex + 2 + 6),
  };
}

function athleteLine(athlete) {
  if (!athlete) return "";
  const bib = athlete.bib ? `#${athlete.bib} · ` : "";
  return `${bib}${athlete.name}`;
}

function renderBoard(round) {
  el.roundTitle.textContent = `${round.category_round_name ?? ""} — ${round.discipline ?? ""}`.trim();
  const laneLabelPrefix = round.discipline === "Speed" ? "Bahn" : "Route";

  el.lanes.innerHTML = "";
  if (!round.routes?.length) {
    const empty = document.createElement("div");
    empty.className = "lane-finished";
    empty.textContent = "Keine Routen-Daten für diese Runde.";
    el.lanes.appendChild(empty);
    return;
  }
  for (const route of round.routes) {
    const lane = computeLane(round, route);
    const laneEl = document.createElement("section");
    laneEl.className = "lane";

    const heading = document.createElement("div");
    heading.className = "lane-heading";
    heading.textContent = `${laneLabelPrefix} ${lane.routeName}`;
    laneEl.appendChild(heading);

    if (lane.finished) {
      const done = document.createElement("div");
      done.className = "lane-finished";
      done.textContent = "Runde beendet";
      laneEl.appendChild(done);
    } else {
      laneEl.appendChild(makeCard("an der wand", athleteLine(lane.atWall), "at-wall"));
      laneEl.appendChild(makeCard("nächste·r", athleteLine(lane.onDeck), "on-deck"));

      if (lane.queue.length) {
        const list = document.createElement("ol");
        list.className = "queue-list";
        for (const athlete of lane.queue) {
          const li = document.createElement("li");
          li.textContent = athleteLine(athlete);
          list.appendChild(li);
        }
        laneEl.appendChild(list);
      }
    }

    el.lanes.appendChild(laneEl);
  }
}

function makeCard(label, text, variant) {
  const card = document.createElement("div");
  card.className = `card card--${variant}`;
  const labelEl = document.createElement("div");
  labelEl.className = "card-label";
  labelEl.textContent = label;
  const textEl = document.createElement("div");
  textEl.className = "card-athlete";
  textEl.textContent = text || "—";
  card.appendChild(labelEl);
  card.appendChild(textEl);
  return card;
}

el.loadEvent.addEventListener("click", loadEvent);
el.eventId.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadEvent();
});

const initial = readUrlSelection() ?? loadSelection();
if (initial?.eventId && initial?.host) {
  el.eventId.value = initial.eventId;
  el.host.value = initial.host;
  if (initial.roundId) {
    // Jump straight to the board so a bookmarked tablet never has to see
    // the setup screen; loadEvent() below fills the dropdown in the
    // background for when "andere Runde" is used later.
    startWatching(initial.host, initial.eventId, initial.roundId);
  }
  loadEvent().then(() => {
    if (initial.roundId && [...el.roundSelect.options].some((o) => o.value === initial.roundId)) {
      el.roundSelect.value = initial.roundId;
    }
  });
}
