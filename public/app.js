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
  kioskBtn: document.getElementById("kioskBtn"),
  roundTitle: document.getElementById("roundTitle"),
  statusLine: document.getElementById("statusLine"),
  groupTabs: document.getElementById("groupTabs"),
  lanes: document.getElementById("lanes"),
  shareRow: document.getElementById("shareRow"),
  shareLink: document.getElementById("shareLink"),
  copyLink: document.getElementById("copyLink"),
};

let pollTimer = null;
let lastRoundData = null;

// Tracks what the currently-watched board is showing, so re-renders (poll
// ticks, group-tab clicks) and the share link stay in sync without having
// to thread these four values through every function call.
let currentSelection = null; // { host, eventId, roundId, group }

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

// Lets each tablet be bookmarked straight to "its" category (and, for
// Boulder rounds with groups, "its" group), so it doesn't need the setup
// screen on every reload - see buildShareLink/startWatching.
function readUrlSelection() {
  const params = new URLSearchParams(location.search);
  const host = params.get("host");
  const eventId = params.get("event");
  const roundId = params.get("round");
  const group = params.get("group");
  return host && eventId ? { host, eventId, roundId, group } : null;
}

function buildShareLink({ host, eventId, roundId, group }) {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set("host", host);
  url.searchParams.set("event", eventId);
  url.searchParams.set("round", roundId);
  if (group) url.searchParams.set("group", group);
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
    showError("Please enter an Event ID.");
    return;
  }
  showError("");
  el.loadEvent.disabled = true;
  el.loadEvent.textContent = "Loading…";
  try {
    const res = await fetch(`/api/event/${host}/${encodeURIComponent(eventId)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    populateRounds(data, host, eventId);
  } catch (err) {
    showError(`Couldn't load event: ${err.message}`);
    el.categoryRow.hidden = true;
  } finally {
    el.loadEvent.disabled = false;
    el.loadEvent.textContent = "Load event";
  }
}

const STATUS_LABEL = {
  active: "live",
  pending: "not started",
  finished: "finished",
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
  if (entries.length === 0) showError("This event has no categories/rounds.");

  el.watchRound.onclick = () => {
    const roundId = el.roundSelect.value;
    if (!roundId) return;
    startWatching(host, eventId, roundId, null);
  };
}

function startWatching(host, eventId, roundId, group) {
  currentSelection = { host, eventId, roundId, group: group ?? null };
  lastRoundData = null;
  saveSelection(currentSelection);
  el.shareLink.value = buildShareLink(currentSelection);
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
    el.copyLink.textContent = "Copied!";
  } catch {
    // Clipboard API needs a secure context; on plain http://<lan-ip> (no
    // HTTPS) Safari blocks it. The select() above still lets the user
    // copy manually with Cmd/Ctrl+C, so just tell them that.
    el.copyLink.textContent = "Selected - copy now";
  }
  setTimeout(() => (el.copyLink.textContent = "Copy"), 2000);
});

// --- Fullscreen + screen-wake-lock ("kiosk mode") for a tablet mounted on
// a wall: keeps the board visible full-bleed and stops the OS from locking
// the screen mid-competition. Both are independent browser APIs behind one
// button since they're always wanted together for this use case.
let wakeLockSentinel = null;

async function enterKioskMode() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
  } catch (err) {
    console.warn("Fullscreen request failed:", err);
  }
  try {
    wakeLockSentinel = (await navigator.wakeLock?.request("screen")) ?? null;
  } catch (err) {
    console.warn("Wake lock request failed:", err);
  }
  el.kioskBtn.textContent = "Exit fullscreen";
}

async function exitKioskMode() {
  if (document.fullscreenElement) {
    try {
      await document.exitFullscreen();
    } catch {
      // ignore - already left fullscreen some other way (Esc key, etc.)
    }
  }
  wakeLockSentinel?.release?.();
  wakeLockSentinel = null;
  el.kioskBtn.textContent = "Fullscreen + Always On";
}

el.kioskBtn.addEventListener("click", () => {
  if (document.fullscreenElement) exitKioskMode();
  else enterKioskMode();
});

document.addEventListener("fullscreenchange", () => {
  // The "link for this tablet" row is only useful for setting a bookmark up
  // in the first place - once mounted and running in kiosk mode, it's just
  // clutter (and a copy-able URL) on an otherwise clean wall display.
  el.shareRow.hidden = !!document.fullscreenElement;
  if (!document.fullscreenElement) {
    wakeLockSentinel?.release?.();
    wakeLockSentinel = null;
    el.kioskBtn.textContent = "Fullscreen + Always On";
  }
});

// The wake lock is released by the browser whenever the tab is backgrounded
// (spec-mandated) - re-acquire it once the tablet's screen comes back.
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "visible" && document.fullscreenElement && !wakeLockSentinel) {
    try {
      wakeLockSentinel = (await navigator.wakeLock?.request("screen")) ?? null;
    } catch {
      // best-effort only
    }
  }
});

async function pollRound(host, roundId) {
  try {
    const res = await fetch(`/api/round/${host}/${roundId}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    lastRoundData = data;
    renderBoard(data);
    el.statusLine.textContent = `Updated ${new Date().toLocaleTimeString("en-GB")}`;
    el.statusLine.classList.remove("stale");
  } catch (err) {
    el.statusLine.textContent = `Connection lost: ${err.message}`;
    el.statusLine.classList.add("stale");
  }
}

// The API never says who is climbing "right now". It only tells us, per
// route, which athletes already have a confirmed ascent and which are
// still "pending". We infer the callzone order from that - but NOT by
// taking the first still-pending athlete in start order: real events
// sometimes never record a result for someone (no-show, withdrawal, a
// review that never gets finalized), and results can get entered out of
// strict start order (e.g. a judge reviewing footage). Either one leaves
// an early position permanently "pending" while later positions already
// have results - if we stopped at the first pending athlete, the board
// would get stuck forever showing that one gap as "at the wall" long
// after the round has actually moved on. Instead we take the position
// right after the LAST confirmed athlete in start order ("the frontier")
// - in the common case (no gaps) this is identical to "first pending",
// but it correctly skips past permanently-unresolved gaps instead of
// getting stuck on them.
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

  // Before the round has actually begun, nobody is "at the wall" yet, even
  // though every athlete's ascent status is still "pending" - that status
  // alone can't tell a not-yet-started route apart from someone mid-climb.
  // round.status (pending/active/finished) is the only reliable signal for
  // "has this round started at all".
  if (round.status === "pending") {
    return {
      routeName: route.name,
      finished: false,
      atWall: null,
      onDeck: ordered[0] ?? null,
      queue: ordered.slice(1, 1 + 6),
    };
  }

  const isDone = (a) => (statusByAthlete.get(a.athlete_id) ?? "pending") !== "pending";
  let currentIndex = 0;
  for (let i = 0; i < ordered.length; i++) {
    if (isDone(ordered[i])) currentIndex = i + 1;
  }

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

// Most rounds list their routes directly on `round.routes`. Boulder rounds
// split into starting groups (e.g. "Group A" / "Group B" climbing separate
// boulders in parallel) instead nest the routes under `round.starting_groups`
// and have no top-level `routes` at all - group them here so the rest of the
// rendering code doesn't need to care which shape it got.
function collectRouteGroups(round) {
  if (round.routes?.length) return [{ groupName: null, routes: round.routes }];
  if (round.starting_groups?.length) {
    return round.starting_groups.map((g) => ({ groupName: g.name, routes: g.routes }));
  }
  return [];
}

function buildLane(round, route, laneLabelPrefix) {
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
    done.textContent = "Round finished";
    laneEl.appendChild(done);
  } else {
    laneEl.appendChild(makeCard("at the wall", athleteLine(lane.atWall), "at-wall"));
    laneEl.appendChild(makeCard("next", athleteLine(lane.onDeck), "on-deck"));

    if (lane.queue.length) {
      const list = document.createElement("ol");
      list.className = "queue-list";
      // "Next" is implicitly queue position 1, so this list continues from 2.
      list.setAttribute("start", "2");
      for (const athlete of lane.queue) {
        const li = document.createElement("li");
        li.textContent = athleteLine(athlete);
        list.appendChild(li);
      }
      laneEl.appendChild(list);
    }
  }

  return laneEl;
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

// --- Speed elimination (bracket) rounds ------------------------------------
//
// Unlike qualification rounds, a Speed final's heats are pre-computed by
// results.info itself: as soon as a stage (e.g. "1/8") is fully judged, the
// next stage's heats are populated with the real advancing athletes (still
// with ascent status "pending"). So there's no bracket-advancement logic to
// build here - only "which heat is current" needs the same kind of
// inference used for qualification routes, at heat granularity instead of
// athlete granularity.

function heatIsReady(heat) {
  return (heat.athletes?.length ?? 0) === 2;
}
function heatIsDone(heat) {
  if (!heatIsReady(heat)) return false;
  return heat.athletes.every((a) => (a.ascents?.[0]?.status ?? "pending") !== "pending");
}

function computeSpeedElimination(round) {
  const heats = (round.speed_elimination_stages ?? []).flatMap((stage) =>
    stage.heats.map((heat) => ({ ...heat, stageName: stage.stage_name }))
  );

  // Mirrors computeLane()'s frontier logic: advance to the heat right
  // after the last CONFIRMED heat, rather than stopping at the first
  // still-pending one. A heat whose result never finalizes (a false start
  // under review, a stuck appeal) would otherwise permanently block the
  // board on an old stage even after results.info has already populated
  // and moved on to the next one.
  let currentIndex = 0;
  for (let i = 0; i < heats.length; i++) {
    if (heatIsReady(heats[i]) && heatIsDone(heats[i])) currentIndex = i + 1;
  }

  if (currentIndex >= heats.length) {
    return { finished: heats.length > 0, stageName: null, heats: [] };
  }
  if (!heatIsReady(heats[currentIndex])) {
    // The previous stage just finished but results.info hasn't populated
    // the next stage's heats yet - a brief, expected transition state.
    return { finished: false, stageName: null, heats: [] };
  }

  const current = heats[currentIndex];
  // "All heats of this round, in the order the athletes are due" - i.e.
  // every remaining heat of the current stage, not just the next one.
  const remaining = heats.slice(currentIndex).filter((h) => h.stageName === current.stageName);

  return { finished: false, stageName: current.stageName, heats: remaining };
}

function heatAthleteLine(athlete) {
  if (!athlete) return "";
  const bib = athlete.bib ? `#${athlete.bib} · ` : "";
  const last = athlete.lastname?.toUpperCase() ?? "";
  return `${bib}${last} ${athlete.firstname ?? ""}`.trim();
}

function athleteForLane(heat, laneName) {
  return heat.athletes?.find((a) => a.route_name === laneName) ?? null;
}

// Renders like a qualification round - one column per lane (Lane A / Lane
// B), each with its own at-the-wall/next/queue chain built from the same
// athlete on that lane across the current stage's heats - instead of one
// two-line "matchup" card per heat. Requested explicitly after the
// matchup-card version shipped: the per-lane layout matches every other
// round type in the app and is easier to scan at a glance.
function buildSpeedLane(laneName, heats) {
  const athletes = heats.map((h) => athleteForLane(h, laneName));

  const laneEl = document.createElement("section");
  laneEl.className = "lane";

  const heading = document.createElement("div");
  heading.className = "lane-heading";
  heading.textContent = `Lane ${laneName}`;
  laneEl.appendChild(heading);

  laneEl.appendChild(makeCard("at the wall", heatAthleteLine(athletes[0]), "at-wall"));
  laneEl.appendChild(makeCard("next", heatAthleteLine(athletes[1]), "on-deck"));

  const queue = athletes.slice(2, 2 + 6);
  if (queue.length) {
    const list = document.createElement("ol");
    list.className = "queue-list";
    // "Next" is implicitly queue position 1, so this list continues from 2.
    list.setAttribute("start", "2");
    for (const athlete of queue) {
      const li = document.createElement("li");
      li.textContent = heatAthleteLine(athlete);
      list.appendChild(li);
    }
    laneEl.appendChild(list);
  }

  return laneEl;
}

function renderSpeedElimination(round) {
  const result = computeSpeedElimination(round);

  if (!result.heats.length) {
    const empty = document.createElement("div");
    empty.className = "lane-finished";
    empty.textContent = result.finished ? "Round finished" : "Waiting for the next stage…";
    el.lanes.appendChild(empty);
    return;
  }

  const stageHeading = document.createElement("div");
  stageHeading.className = "group-heading";
  stageHeading.textContent = `Stage: ${result.stageName}`;
  el.lanes.appendChild(stageHeading);

  const laneNames = round.routes?.length ? round.routes.map((r) => r.name) : ["A", "B"];
  const grid = document.createElement("div");
  grid.className = "lanes-grid";
  for (const laneName of laneNames) {
    grid.appendChild(buildSpeedLane(laneName, result.heats));
  }
  el.lanes.appendChild(grid);
}

// --- Board rendering ---------------------------------------------------

function renderGroupTabs(groupNames) {
  el.groupTabs.innerHTML = "";
  if (groupNames.length < 2) {
    el.groupTabs.hidden = true;
    return;
  }
  el.groupTabs.hidden = false;
  for (const name of groupNames) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `group-tab${name === currentSelection.group ? " active" : ""}`;
    btn.textContent = name;
    btn.addEventListener("click", () => {
      if (currentSelection.group === name) return;
      currentSelection.group = name;
      saveSelection(currentSelection);
      el.shareLink.value = buildShareLink(currentSelection);
      if (lastRoundData) renderBoard(lastRoundData);
    });
    el.groupTabs.appendChild(btn);
  }
}

function renderBoard(round) {
  el.roundTitle.textContent = `${round.category ?? ""} — ${round.round ?? ""} (${round.discipline ?? ""})`.trim();
  el.lanes.innerHTML = "";
  el.groupTabs.hidden = true; // only the multi-group branch below re-shows it

  if (round.speed_elimination_stages?.length) {
    renderSpeedElimination(round);
    return;
  }

  const laneLabelPrefix = round.discipline === "Speed" ? "Lane" : "Route";
  const routeGroups = collectRouteGroups(round);

  if (!routeGroups.length) {
    const empty = document.createElement("div");
    empty.className = "lane-finished";
    empty.textContent = "No route data for this round.";
    el.lanes.appendChild(empty);
    return;
  }

  const groupNames = routeGroups.map((g) => g.groupName).filter(Boolean);
  if (groupNames.length >= 2) {
    // Showing every group's lanes at once doesn't fit a tablet screen well
    // (e.g. 2 groups x 5 boulders = 10 lanes) - default to one group at a
    // time, switchable via tabs, and rememberable via the share link/URL.
    if (!currentSelection.group || !groupNames.includes(currentSelection.group)) {
      currentSelection.group = groupNames[0];
    }
    renderGroupTabs(groupNames);
  }

  for (const group of routeGroups) {
    if (groupNames.length >= 2 && group.groupName !== currentSelection.group) continue;

    const grid = document.createElement("div");
    grid.className = "lanes-grid";
    for (const route of group.routes) {
      grid.appendChild(buildLane(round, route, laneLabelPrefix));
    }
    el.lanes.appendChild(grid);
  }
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
    // background for when "switch round" is used later.
    startWatching(initial.host, initial.eventId, initial.roundId, initial.group ?? null);
  }
  loadEvent().then(() => {
    if (initial.roundId && [...el.roundSelect.options].some((o) => o.value === initial.roundId)) {
      el.roundSelect.value = initial.roundId;
    }
  });
}
