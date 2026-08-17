const STORAGE_KEY = "callzone-selection";
// How many alternating A/B stage-limited entries the "interleaved pair"
// shortcut generates - deeper than any realistic elimination bracket
// (1/32-final down to Final is 6 stages), see the addInterleavedPair handler.
const INTERLEAVE_REPEATS = 8;

const el = {
  eventId: document.getElementById("eventId"),
  host: document.getElementById("host"),
  loadEvent: document.getElementById("loadEvent"),
  setupError: document.getElementById("setupError"),
  categoryRow: document.getElementById("categoryRow"),
  roundSelect: document.getElementById("roundSelect"),
  addToSequence: document.getElementById("addToSequence"),
  watchRound: document.getElementById("watchRound"),
  trainingCheckbox: document.getElementById("trainingCheckbox"),
  sequenceRow: document.getElementById("sequenceRow"),
  sequenceList: document.getElementById("sequenceList"),
  watchSequence: document.getElementById("watchSequence"),
  interleaveRow: document.getElementById("interleaveRow"),
  interleaveA: document.getElementById("interleaveA"),
  interleaveB: document.getElementById("interleaveB"),
  addInterleavedPair: document.getElementById("addInterleavedPair"),
  setup: document.getElementById("setup"),
  board: document.getElementById("board"),
  backBtn: document.getElementById("backBtn"),
  kioskBtn: document.getElementById("kioskBtn"),
  roundTitle: document.getElementById("roundTitle"),
  statusLine: document.getElementById("statusLine"),
  trainingControls: document.getElementById("trainingControls"),
  trainingBack: document.getElementById("trainingBack"),
  trainingNext: document.getElementById("trainingNext"),
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
// to thread these values through every function call. `rounds` is always
// an array of { id, stage } - a single round is just an array of length 1
// (stage: false) - see "Sequence mode" below. `stage: true` means "advance
// past this entry once its current Speed-elimination stage finishes",
// instead of waiting for the whole round/bracket to finish - what lets the
// same round be queued multiple times to interleave with other rounds
// stage-by-stage (e.g. alternating Round-of-16 between two categories).
let currentSelection = null; // { host, eventId, rounds, group, training }

// Which round of the sequence is currently showing. Always restarts at 0
// on load/reload rather than being persisted - pollCurrent() catches up
// through any already-finished rounds immediately, so this converges on
// the right one within a poll or two regardless.
let sequenceIndex = 0;

// Rounds queued up on the setup screen before "Show sequence" is clicked -
// { roundId, label, isElimination, stage }[], purely local UI state.
let sequenceBuilder = [];

// Training mode: a manually-advanced pointer (no live results to poll -
// see startWatching/buildTrainingLane) shared across every lane shown, so
// one "Next"/"Back" moves every lane forward/back together in lockstep.
let trainingIndex = 0;

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
// screen on every reload - see buildShareLink/startWatching. `rounds`
// (comma-separated, each entry optionally suffixed `:stage`) is the
// sequence-mode form; `round` (singular) is the original single-round
// form, still read for backwards compatibility with links generated
// before sequences existed.
function parseRoundsParam(raw) {
  return raw
    .split(",")
    .filter(Boolean)
    .map((token) => {
      const [id, mode] = token.split(":");
      return { id, stage: mode === "stage" };
    });
}

function readUrlSelection() {
  const params = new URLSearchParams(location.search);
  const host = params.get("host");
  const eventId = params.get("event");
  const group = params.get("group");
  const training = params.get("training") === "1";
  const roundsParam = params.get("rounds");
  const roundParam = params.get("round");
  const rounds = roundsParam ? parseRoundsParam(roundsParam) : roundParam ? [{ id: roundParam, stage: false }] : null;
  return host && eventId ? { host, eventId, rounds, group, training } : null;
}

function buildShareLink({ host, eventId, rounds, group, training }) {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set("host", host);
  url.searchParams.set("event", eventId);
  if (rounds.length > 1) {
    url.searchParams.set("rounds", rounds.map((r) => (r.stage ? `${r.id}:stage` : r.id)).join(","));
  } else {
    url.searchParams.set("round", rounds[0].id);
  }
  if (group) url.searchParams.set("group", group);
  if (training) url.searchParams.set("training", "1");
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
  // A freshly-loaded event starts with an empty sequence - carrying over
  // rounds from a previously-loaded event would silently mix events.
  sequenceBuilder = [];
  renderSequenceBuilder();

  const entries = [];
  for (const dcat of eventData.d_cats ?? []) {
    for (const round of dcat.category_rounds ?? []) {
      entries.push({
        roundId: round.category_round_id,
        label: `${dcat.dcat_name} — ${round.name}`,
        status: round.status,
        isElimination: round.format_identifier === "speed_elimination_ifsc_2026",
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
    opt.dataset.elimination = entry.isElimination ? "1" : "";
    el.roundSelect.appendChild(opt);
  }
  el.categoryRow.hidden = entries.length === 0;
  if (entries.length === 0) showError("This event has no categories/rounds.");

  // Only Speed elimination rounds have stages to interleave on - quali
  // rounds and non-Speed finals have nothing analogous (6.12).
  const eliminationEntries = entries.filter((e) => e.isElimination);
  el.interleaveRow.hidden = eliminationEntries.length < 2;
  el.interleaveA.innerHTML = "";
  el.interleaveB.innerHTML = "";
  for (const entry of eliminationEntries) {
    for (const select of [el.interleaveA, el.interleaveB]) {
      const opt = document.createElement("option");
      opt.value = entry.roundId;
      opt.textContent = `${entry.label} (${STATUS_LABEL[entry.status] ?? entry.status})`;
      select.appendChild(opt);
    }
  }
  if (eliminationEntries.length > 1) el.interleaveB.selectedIndex = 1;

  el.watchRound.onclick = () => {
    const roundId = el.roundSelect.value;
    if (!roundId) return;
    startWatching(host, eventId, [{ id: roundId, stage: false }], null, el.trainingCheckbox.checked);
  };

  el.addToSequence.onclick = () => {
    const opt = el.roundSelect.selectedOptions[0];
    if (!opt) return;
    sequenceBuilder.push({
      roundId: opt.value,
      label: opt.textContent,
      isElimination: opt.dataset.elimination === "1",
      stage: false,
    });
    renderSequenceBuilder();
  };

  el.addInterleavedPair.onclick = () => {
    const optA = el.interleaveA.selectedOptions[0];
    const optB = el.interleaveB.selectedOptions[0];
    if (!optA || !optB || optA.value === optB.value) return;
    // Generously over-provisioned: excess entries for an already-finished
    // stage are skipped instantly by isSequenceEntryDone/pollCurrent, so we
    // don't need to know each bracket's actual depth ahead of time.
    for (let i = 0; i < INTERLEAVE_REPEATS; i++) {
      sequenceBuilder.push({ roundId: optA.value, label: optA.textContent, isElimination: true, stage: true });
      sequenceBuilder.push({ roundId: optB.value, label: optB.textContent, isElimination: true, stage: true });
    }
    renderSequenceBuilder();
  };

  el.watchSequence.onclick = () => {
    if (!sequenceBuilder.length) return;
    startWatching(
      host,
      eventId,
      sequenceBuilder.map((s) => ({ id: s.roundId, stage: s.stage })),
      null,
      false // sequence mode relies on live API status to advance - not compatible with training mode
    );
  };
}

// Drag-and-drop reordering of the in-progress sequence on the setup screen
// (native HTML5 DnD - no library needed for a same-list reorder).
function renderSequenceBuilder() {
  el.sequenceRow.hidden = sequenceBuilder.length === 0;
  el.sequenceList.innerHTML = "";

  sequenceBuilder.forEach((item, index) => {
    const li = document.createElement("li");
    li.className = "sequence-item";
    li.draggable = true;

    const text = document.createElement("span");
    text.textContent = item.label;
    li.appendChild(text);

    // Only Speed elimination rounds have stages to stop after - a
    // qualification round has nothing analogous, so it always runs to
    // completion. This is what lets the same elimination round be queued
    // multiple times to interleave with another one stage-by-stage - see
    // ARCHITECTURE.md on sequence mode.
    if (item.isElimination) {
      const modeSelect = document.createElement("select");
      modeSelect.className = "sequence-mode";
      modeSelect.setAttribute("aria-label", "Advance after");
      modeSelect.innerHTML = '<option value="round">whole round</option><option value="stage">next stage only</option>';
      modeSelect.value = item.stage ? "stage" : "round";
      modeSelect.addEventListener("change", () => {
        item.stage = modeSelect.value === "stage";
      });
      li.appendChild(modeSelect);
    }

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "sequence-remove";
    removeBtn.textContent = "×";
    removeBtn.setAttribute("aria-label", "Remove from sequence");
    removeBtn.addEventListener("click", () => {
      sequenceBuilder.splice(index, 1);
      renderSequenceBuilder();
    });
    li.appendChild(removeBtn);

    li.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", String(index));
      e.dataTransfer.effectAllowed = "move";
      li.classList.add("dragging");
    });
    li.addEventListener("dragend", () => li.classList.remove("dragging"));
    li.addEventListener("dragover", (e) => e.preventDefault());
    li.addEventListener("drop", (e) => {
      e.preventDefault();
      const from = Number(e.dataTransfer.getData("text/plain"));
      if (Number.isNaN(from) || from === index) return;
      const [moved] = sequenceBuilder.splice(from, 1);
      sequenceBuilder.splice(index, 0, moved);
      renderSequenceBuilder();
    });

    el.sequenceList.appendChild(li);
  });
}

function startWatching(host, eventId, rounds, group, training) {
  currentSelection = { host, eventId, rounds, group: group ?? null, training: !!training };
  sequenceIndex = 0;
  trainingIndex = 0;
  lastRoundData = null;
  saveSelection(currentSelection);
  el.shareLink.value = buildShareLink(currentSelection);
  el.trainingControls.hidden = !currentSelection.training;
  el.setup.hidden = true;
  el.board.hidden = false;
  clearInterval(pollTimer);
  pollCurrent();
  pollTimer = setInterval(pollCurrent, 3000);
}

el.trainingNext.addEventListener("click", () => {
  trainingIndex++;
  if (lastRoundData) renderBoard(lastRoundData);
});
el.trainingBack.addEventListener("click", () => {
  trainingIndex = Math.max(0, trainingIndex - 1);
  if (lastRoundData) renderBoard(lastRoundData);
});

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
    return true;
  } catch (err) {
    el.statusLine.textContent = `Connection lost: ${err.message}`;
    el.statusLine.classList.add("stale");
    return false;
  }
}

// Sequence mode: poll the round at sequenceIndex, and if it's fully
// finished and there's a next one queued up, jump straight to it (no
// artificial delay) rather than waiting for the next 3s tick - this
// catches up through any already-finished rounds in one go on load,
// e.g. a tablet reloaded mid-event lands on the actually-current class
// within a single call instead of idling through each past one.
async function pollCurrent() {
  const { host, rounds } = currentSelection;
  for (;;) {
    const entry = rounds[sequenceIndex];
    const ok = await pollRound(host, entry.id);
    if (!ok) return;
    const hasNext = sequenceIndex < rounds.length - 1;
    if (hasNext && isSequenceEntryDone(entry, lastRoundData)) {
      sequenceIndex++;
      continue;
    }
    return;
  }
}

// Whole-round completion (every lane, in every group, not just the one
// currently shown by the group tabs) - used to decide whether sequence
// mode should advance. Deliberately independent of which group tab a
// tablet happens to have selected: a Boulder round with Group A/B isn't
// "done" for advancement purposes just because the tab someone's looking
// at finished first.
function isRoundFullyFinished(round) {
  if (!round) return false;
  if (round.speed_elimination_stages?.length) return computeSpeedElimination(round).finished;
  const routeGroups = collectRouteGroups(round);
  if (!routeGroups.length) return false;
  return routeGroups.every((g) => g.routes.every((r) => computeLane(round, r).finished));
}

// A sequence entry with `stage: true` (only meaningful for Speed
// elimination rounds - see the `isElimination` check when it's queued up)
// advances once its CURRENT stage is done, not the whole bracket - so the
// same round can be queued multiple times to interleave with a different
// round one stage at a time (e.g. alternating Round-of-16 between two
// categories). `computeSpeedElimination().heats` is empty in both cases
// that mean "this stage is done": a brief transition where the next
// stage isn't populated yet, and the bracket being fully finished - either
// way, there's nothing left to show for the current stage, so it's time
// to move on to the next sequence entry.
function isSequenceEntryDone(entry, round) {
  if (entry.stage && round?.speed_elimination_stages?.length) {
    return computeSpeedElimination(round).heats.length === 0;
  }
  return isRoundFullyFinished(round);
}

// An ascent status counts as fully locked in once it's one of these -
// "active" is deliberately NOT here, see findCurrentIndex() below.
const DONE_STATUSES = new Set(["confirmed", "locked"]);

// The API never says who is climbing "right now" as a single flag - but
// combined, two signals tell us: an ascent status of "active" means a
// judge is live-scoring that attempt right now (entered, not yet
// confirmed), while "confirmed"/"locked" means it's fully done. Given
// those, who's at the wall is:
//   - if anyone has a live ("active") entry, the LATEST one in start
//     order - a judge can start live-scoring the next athlete before
//     confirming the previous one, so among several simultaneously-active
//     entries the later one in order is the one actually on the wall.
//   - otherwise, the position right after the last CONFIRMED entry.
// This also has to tolerate results never arriving for someone at all
// (no-show, withdrawal, a review that never gets finalized) or being
// entered out of strict start order (e.g. a judge reviewing footage) -
// both leave an early position permanently without a confirmed result
// while later positions already have one. "First not-done" would get
// stuck forever on that one gap; "last confirmed + 1" correctly skips
// past it. See ARCHITECTURE.md §5.2 for the full reasoning and a real
// reproduction case.
function findCurrentIndex(items, isActive, isConfirmed) {
  let lastActive = -1;
  let lastConfirmed = -1;
  items.forEach((item, i) => {
    if (isActive(item)) lastActive = i;
    if (isConfirmed(item)) lastConfirmed = i;
  });
  return lastActive !== -1 ? lastActive : lastConfirmed + 1;
}

// The start order for one route, independent of any results - shared by
// live mode (computeLane, below) and training mode (buildTrainingLane),
// which both need the same ordered roster but pick "who's at the wall"
// from it in completely different ways (live results vs. a manual click).
function orderedAthletesForRoute(round, route) {
  return (round.startlist ?? [])
    .map((athlete) => {
      const pos = athlete.route_start_positions?.find((p) => p.route_id === route.id);
      return pos ? { athlete, position: pos.position } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.position - b.position)
    .map((x) => x.athlete);
}

function computeLane(round, route) {
  const statusByAthlete = new Map();
  for (const entry of round.ranking ?? []) {
    const ascent = entry.ascents?.find((a) => a.route_id === route.id);
    if (ascent) statusByAthlete.set(entry.athlete_id, ascent.status);
  }

  const ordered = orderedAthletesForRoute(round, route);

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

  const currentIndex = findCurrentIndex(
    ordered,
    (a) => statusByAthlete.get(a.athlete_id) === "active",
    (a) => DONE_STATUSES.has(statusByAthlete.get(a.athlete_id))
  );

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

// Shared by live mode (buildLane) and training mode (buildTrainingLane) -
// both just need to turn { atWall, onDeck, queue, finished } into the same
// three cards, regardless of how those four values were derived.
function renderLaneBody(laneEl, { atWall, onDeck, queue, finished }) {
  if (finished) {
    const done = document.createElement("div");
    done.className = "lane-finished";
    done.textContent = "Round finished";
    laneEl.appendChild(done);
    return;
  }

  laneEl.appendChild(makeCard("climbing", athleteLine(atWall), "at-wall"));
  laneEl.appendChild(makeCard("next", athleteLine(onDeck), "on-deck"));

  if (queue.length) {
    const list = document.createElement("ol");
    list.className = "queue-list";
    // "Next" is implicitly queue position 1, so this list continues from 2.
    list.setAttribute("start", "2");
    for (const athlete of queue) {
      const li = document.createElement("li");
      li.textContent = athleteLine(athlete);
      list.appendChild(li);
    }
    laneEl.appendChild(list);
  }
}

function buildLane(round, route, laneLabelPrefix) {
  const lane = computeLane(round, route);
  const laneEl = document.createElement("section");
  laneEl.className = "lane";

  const heading = document.createElement("div");
  heading.className = "lane-heading";
  heading.textContent = `${laneLabelPrefix} ${lane.routeName}`;
  laneEl.appendChild(heading);

  renderLaneBody(laneEl, lane);
  return laneEl;
}

// Training mode: no live results to poll, so "who's at the wall" is
// whatever `index` a human has manually clicked to via the Next/Back
// buttons, walking the exact same start order as a live round (Quirk E) -
// see startWatching/renderBoard for how `index` (trainingIndex) is shared
// across every lane so one click advances all of them together.
function buildTrainingLane(route, ordered, index, laneLabelPrefix) {
  const laneEl = document.createElement("section");
  laneEl.className = "lane";

  const heading = document.createElement("div");
  heading.className = "lane-heading";
  heading.textContent = `${laneLabelPrefix} ${route.name}`;
  laneEl.appendChild(heading);

  renderLaneBody(laneEl, {
    finished: index >= ordered.length,
    atWall: ordered[index] ?? null,
    onDeck: ordered[index + 1] ?? null,
    queue: ordered.slice(index + 2, index + 2 + 6),
  });
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
function heatAscentStatuses(heat) {
  return heat.athletes.map((a) => a.ascents?.[0]?.status);
}
// A heat is "active" if either lane is currently being live-scored (mirrors
// the per-athlete "active" check in computeLane/findCurrentIndex); it's
// fully "confirmed" only once BOTH lanes are locked in.
function heatIsActive(heat) {
  return heatIsReady(heat) && heatAscentStatuses(heat).some((s) => s === "active");
}
function heatIsConfirmed(heat) {
  return heatIsReady(heat) && heatAscentStatuses(heat).every((s) => DONE_STATUSES.has(s));
}

function computeSpeedElimination(round) {
  const heats = (round.speed_elimination_stages ?? []).flatMap((stage) =>
    stage.heats.map((heat) => ({ ...heat, stageName: stage.stage_name }))
  );

  // Same findCurrentIndex() rule as qualification routes, applied at heat
  // granularity: the latest live ("active") heat wins, otherwise it's the
  // heat right after the last fully-confirmed one. A heat whose result
  // never finalizes (a false start under review, a stuck appeal) would
  // otherwise permanently block the board on an old stage even after
  // results.info has already populated and moved on to the next one.
  const currentIndex = findCurrentIndex(heats, heatIsActive, heatIsConfirmed);

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

  laneEl.appendChild(makeCard("climbing", heatAthleteLine(athletes[0]), "at-wall"));
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
  const trainingSuffix = currentSelection.training ? " — Training" : "";
  el.roundTitle.textContent = `${round.category ?? ""} — ${round.round ?? ""} (${round.discipline ?? ""})${trainingSuffix}`.trim();
  el.lanes.innerHTML = "";
  el.groupTabs.hidden = true; // only the multi-group branch below re-shows it

  // Training mode always uses the plain per-route lane view below (manual
  // Next/Back has nothing meaningful to do with a bracket's stages), even
  // if the round happens to be Speed-elimination-shaped.
  if (!currentSelection.training && round.speed_elimination_stages?.length) {
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
      grid.appendChild(
        currentSelection.training
          ? buildTrainingLane(route, orderedAthletesForRoute(round, route), trainingIndex, laneLabelPrefix)
          : buildLane(round, route, laneLabelPrefix)
      );
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
  if (initial.rounds?.length) {
    // Jump straight to the board so a bookmarked tablet never has to see
    // the setup screen; loadEvent() below fills the dropdown in the
    // background for when "switch round" is used later.
    startWatching(initial.host, initial.eventId, initial.rounds, initial.group ?? null, initial.training);
  }
  loadEvent().then(() => {
    const firstRoundId = initial.rounds?.[0]?.id;
    if (firstRoundId && [...el.roundSelect.options].some((o) => o.value === firstRoundId)) {
      el.roundSelect.value = firstRoundId;
    }
  });
}
