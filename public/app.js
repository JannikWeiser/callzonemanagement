const STORAGE_KEY = "callzone-selection";
// If a paired entry's current heat hasn't changed in this long, force a
// switch to the other category anyway - see pollPairedTick()'s watchdog.
const STUCK_TIMEOUT_MS = 90_000;

const el = {
  eventId: document.getElementById("eventId"),
  host: document.getElementById("host"),
  loadEvent: document.getElementById("loadEvent"),
  setupError: document.getElementById("setupError"),
  modeTabs: document.getElementById("modeTabs"),
  categoryRow: document.getElementById("categoryRow"),
  roundSelect: document.getElementById("roundSelect"),
  watchRound: document.getElementById("watchRound"),
  addToSequence: document.getElementById("addToSequence"),
  trainingHint: document.getElementById("trainingHint"),
  startTraining: document.getElementById("startTraining"),
  pairedRow: document.getElementById("pairedRow"),
  pairedA: document.getElementById("pairedA"),
  pairedB: document.getElementById("pairedB"),
  addPaired: document.getElementById("addPaired"),
  sequenceRow: document.getElementById("sequenceRow"),
  sequenceList: document.getElementById("sequenceList"),
  watchSequence: document.getElementById("watchSequence"),
  setup: document.getElementById("setup"),
  board: document.getElementById("board"),
  controller: document.getElementById("controller"),
  backBtn: document.getElementById("backBtn"),
  kioskBtn: document.getElementById("kioskBtn"),
  roundTitle: document.getElementById("roundTitle"),
  statusLine: document.getElementById("statusLine"),
  pairedBar: document.getElementById("pairedBar"),
  pairedLabel: document.getElementById("pairedLabel"),
  pairedSwitchBtn: document.getElementById("pairedSwitchBtn"),
  trainingControls: document.getElementById("trainingControls"),
  trainingBack: document.getElementById("trainingBack"),
  trainingNext: document.getElementById("trainingNext"),
  shareRow: document.getElementById("shareRow"),
  shareLink: document.getElementById("shareLink"),
  copyLink: document.getElementById("copyLink"),
  controlShareRow: document.getElementById("controlShareRow"),
  controlLink: document.getElementById("controlLink"),
  copyControlLink: document.getElementById("copyControlLink"),
  groupTabs: document.getElementById("groupTabs"),
  lanes: document.getElementById("lanes"),
  controllerBackBtn: document.getElementById("controllerBackBtn"),
  controllerTitle: document.getElementById("controllerTitle"),
  controllerStatus: document.getElementById("controllerStatus"),
  controllerLanes: document.getElementById("controllerLanes"),
  controlBack: document.getElementById("controlBack"),
  controlNext: document.getElementById("controlNext"),
};

let pollTimer = null;
let lastRoundData = null;

// Bumped at the start of every pollCurrent() call (the natural 3s timer AND
// a manual "Switch category now" click both go through it). Whichever call
// started LAST "owns" the token; an older, still-in-flight call checks its
// own captured copy against this after every await and bails out silently
// if it's been superseded - otherwise a slow response from an earlier call
// could land after a newer one and overwrite the display with stale data
// (e.g. a manual switch click racing the next automatic tick). Purely a
// robustness measure - not tied to any specific bug report.
let pollToken = 0;

// Tracks what the currently-watched board is showing, so re-renders (poll
// ticks, group-tab clicks) and the share link stay in sync without having
// to thread these values through every function call.
//   - watch:    { kind: "watch", host, eventId, group, sequence }
//   - training: { kind: "training", host, eventId, roundId, control }
// `sequence` is always an array - a single round is just an array of length
// one - see "Sequence mode" below. Each entry is either
// { type: "round", id } or { type: "paired", a, b } (see 6.12).
let currentSelection = null;

// Which entry of the sequence is currently showing. Always restarts at 0 on
// load/reload rather than being persisted - pollCurrent() catches up through
// any already-finished entries immediately, so this converges on the right
// one within a poll or two regardless.
let sequenceIndex = 0;

// State for the paired ("interleaved") entry currently active, if any -
// { entryIndex, activeSide: "a" | "b" }. Reset whenever sequenceIndex moves
// to a different entry. null when the current entry isn't a paired one.
let pairedState = null;

// Entries queued up on the setup screen before "Show sequence" is clicked -
// purely local UI state, richer than the playback form (keeps labels for
// display): { type: "round", roundId, label } |
// { type: "paired", aId, aLabel, bId, bLabel }.
let sequenceBuilder = [];

// Which setup-screen mode is selected: "single" | "sequence" | "training".
let currentMode = "single";
// How many rounds in the currently-loaded event are Speed elimination
// format - the "interleave two finals" row only makes sense with 2+.
let eliminationCount = 0;

// Training mode's shared roster (fetched once per session) and the current
// manual position (polled from the server so a second device can drive it -
// see the /api/training endpoint and ARCHITECTURE.md 6.11).
let trainingRoundData = null;
let trainingIndex = 0;
let trainingPollTimer = null;

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

function parseSequenceToken(token) {
  const [a, b] = token.split("+");
  return b ? { type: "paired", a, b } : { type: "round", id: a };
}

// Lets each tablet be bookmarked straight to "its" category (and, for
// Boulder rounds with groups, "its" group), so it doesn't need the setup
// screen on every reload - see buildShareLink/startWatching. `rounds`
// (comma-separated) is the sequence-mode form, where a paired entry is
// written as `idA+idB`; `round` (singular) is the original single-round
// form, still read for backwards compatibility with links generated before
// sequences existed. `training=<roundId>` is a distinct flow entirely (no
// live results to poll - see 6.11); `control=1` alongside it marks this
// device as a controller rather than the wall display.
function readUrlSelection() {
  const params = new URLSearchParams(location.search);
  const host = params.get("host");
  const eventId = params.get("event");
  if (!host || !eventId) return null;

  const trainingRoundId = params.get("training");
  if (trainingRoundId) {
    return { kind: "training", host, eventId, roundId: trainingRoundId, control: params.get("control") === "1" };
  }

  const group = params.get("group");
  const roundsParam = params.get("rounds");
  const roundParam = params.get("round");
  const sequence = roundsParam
    ? roundsParam.split(",").filter(Boolean).map(parseSequenceToken)
    : roundParam
    ? [{ type: "round", id: roundParam }]
    : null;
  return sequence ? { kind: "watch", host, eventId, group, sequence } : null;
}

function buildShareLink(sel) {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set("host", sel.host);
  url.searchParams.set("event", sel.eventId);

  if (sel.kind === "training") {
    url.searchParams.set("training", sel.roundId);
    if (sel.control) url.searchParams.set("control", "1");
    return url.toString();
  }

  const tokens = sel.sequence.map((e) => (e.type === "paired" ? `${e.a}+${e.b}` : e.id));
  if (tokens.length > 1) url.searchParams.set("rounds", tokens.join(","));
  else url.searchParams.set("round", tokens[0]);
  if (sel.group) url.searchParams.set("group", sel.group);
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
    el.modeTabs.hidden = true;
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

// Shows only the setup-screen controls relevant to the selected mode -
// replaces an earlier design with several independent checkboxes, which
// turned out confusing (unclear which checkbox went with which dropdown).
function setMode(mode) {
  currentMode = mode;
  for (const btn of el.modeTabs.querySelectorAll(".mode-tab")) {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  }
  el.watchRound.hidden = mode !== "single";
  el.addToSequence.hidden = mode !== "sequence";
  el.startTraining.hidden = mode !== "training";
  el.pairedRow.hidden = mode !== "sequence" || eliminationCount < 2;
  renderSequenceBuilder();
  updateTrainingEligibility();
}

// Training mode only makes sense for Speed (Lead/Boulder have no concept of
// a training session with no live results.info round behind it - see
// 6.11) - disable "Start training" and explain why whenever the currently-
// selected round isn't Speed, rather than letting staff click through into
// a mode that doesn't fit their discipline.
function updateTrainingEligibility() {
  if (currentMode !== "training") {
    el.trainingHint.hidden = true;
    return;
  }
  const opt = el.roundSelect.selectedOptions[0];
  const isSpeed = opt?.dataset.speed === "1";
  el.startTraining.disabled = !isSpeed;
  el.trainingHint.hidden = !opt || isSpeed;
}

function populateRounds(eventData, host, eventId) {
  // A freshly-loaded event starts with an empty sequence - carrying over
  // entries from a previously-loaded event would silently mix events.
  sequenceBuilder = [];

  const entries = [];
  for (const dcat of eventData.d_cats ?? []) {
    for (const round of dcat.category_rounds ?? []) {
      entries.push({
        roundId: round.category_round_id,
        label: `${dcat.dcat_name} — ${round.name}`,
        status: round.status,
        isElimination: round.format_identifier === "speed_elimination_ifsc_2026",
        isSpeed: round.format_identifier?.startsWith("speed_") ?? false,
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
    opt.dataset.speed = entry.isSpeed ? "1" : "";
    el.roundSelect.appendChild(opt);
  }
  el.modeTabs.hidden = entries.length === 0;
  el.categoryRow.hidden = entries.length === 0;
  if (entries.length === 0) showError("This event has no categories/rounds.");

  // Only Speed elimination rounds have stages to interleave on - quali
  // rounds and non-Speed finals have nothing analogous (see 6.12).
  const eliminationEntries = entries.filter((e) => e.isElimination);
  eliminationCount = eliminationEntries.length;
  el.pairedA.innerHTML = "";
  el.pairedB.innerHTML = "";
  for (const entry of eliminationEntries) {
    for (const select of [el.pairedA, el.pairedB]) {
      const opt = document.createElement("option");
      opt.value = entry.roundId;
      opt.textContent = `${entry.label} (${STATUS_LABEL[entry.status] ?? entry.status})`;
      select.appendChild(opt);
    }
  }
  if (eliminationEntries.length > 1) el.pairedB.selectedIndex = 1;
  setMode(currentMode);

  el.watchRound.onclick = () => {
    const roundId = el.roundSelect.value;
    if (!roundId) return;
    startWatching({ kind: "watch", host, eventId, group: null, sequence: [{ type: "round", id: roundId }] });
  };

  el.addToSequence.onclick = () => {
    const opt = el.roundSelect.selectedOptions[0];
    if (!opt) return;
    sequenceBuilder.push({ type: "round", roundId: opt.value, label: opt.textContent });
    renderSequenceBuilder();
  };

  el.addPaired.onclick = () => {
    const optA = el.pairedA.selectedOptions[0];
    const optB = el.pairedB.selectedOptions[0];
    if (!optA || !optB || optA.value === optB.value) return;
    sequenceBuilder.push({
      type: "paired",
      aId: optA.value,
      aLabel: optA.textContent,
      bId: optB.value,
      bLabel: optB.textContent,
    });
    renderSequenceBuilder();
  };

  el.watchSequence.onclick = () => {
    if (!sequenceBuilder.length) return;
    const sequence = sequenceBuilder.map((item) =>
      item.type === "paired" ? { type: "paired", a: item.aId, b: item.bId } : { type: "round", id: item.roundId }
    );
    startWatching({ kind: "watch", host, eventId, group: null, sequence });
  };

  el.startTraining.onclick = () => {
    const opt = el.roundSelect.selectedOptions[0];
    if (!opt || opt.dataset.speed !== "1") return; // belt-and-suspenders - button is also disabled for this case
    startWatching({ kind: "training", host, eventId, roundId: opt.value, control: false });
  };

  el.roundSelect.onchange = updateTrainingEligibility;
}

// Drag-and-drop reordering of the in-progress sequence on the setup screen
// (native HTML5 DnD - no library needed for a same-list reorder). A paired
// entry ("Verschränkt: A ↔ B") appears as a single row here, not as many
// near-duplicate entries - see 6.12 for why that redesign happened.
function renderSequenceBuilder() {
  el.sequenceRow.hidden = currentMode !== "sequence" || sequenceBuilder.length === 0;
  el.sequenceList.innerHTML = "";

  sequenceBuilder.forEach((item, index) => {
    const li = document.createElement("li");
    li.className = "sequence-item";
    li.draggable = true;

    const text = document.createElement("span");
    text.textContent = item.type === "paired" ? `${item.aLabel} ↔ ${item.bLabel}` : item.label;
    li.appendChild(text);

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

function startWatching(selection) {
  clearInterval(pollTimer);
  clearInterval(trainingPollTimer);
  currentSelection = selection;
  saveSelection(selection);
  el.setup.hidden = true;
  el.pairedBar.hidden = true;
  el.trainingControls.hidden = true;
  el.controlShareRow.hidden = true;

  if (selection.kind === "training") {
    el.board.hidden = !!selection.control;
    el.controller.hidden = !selection.control;
    startTrainingSession(selection);
    return;
  }

  el.board.hidden = false;
  el.controller.hidden = true;
  sequenceIndex = 0;
  pairedState = null;
  lastRoundData = null;
  el.shareLink.value = buildShareLink(selection);
  pollCurrent();
  pollTimer = setInterval(pollCurrent, 3000);
}

function goBackToSetup() {
  clearInterval(pollTimer);
  clearInterval(trainingPollTimer);
  el.board.hidden = true;
  el.controller.hidden = true;
  el.setup.hidden = false;
}
el.backBtn.addEventListener("click", goBackToSetup);
el.controllerBackBtn.addEventListener("click", goBackToSetup);

function wireCopyButton(inputEl, buttonEl) {
  buttonEl.addEventListener("click", async () => {
    inputEl.select();
    try {
      await navigator.clipboard.writeText(inputEl.value);
      buttonEl.textContent = "Copied!";
    } catch {
      // Clipboard API needs a secure context; on plain http://<lan-ip> (no
      // HTTPS) Safari blocks it. The select() above still lets the user
      // copy manually with Cmd/Ctrl+C, so just tell them that.
      buttonEl.textContent = "Selected - copy now";
    }
    setTimeout(() => (buttonEl.textContent = "Copy"), 2000);
  });
}
wireCopyButton(el.shareLink, el.copyLink);
wireCopyButton(el.controlLink, el.copyControlLink);

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

async function fetchRoundJson(host, roundId) {
  const res = await fetch(`/api/round/${host}/${roundId}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

async function pollRound(host, roundId, token) {
  try {
    const data = await fetchRoundJson(host, roundId);
    if (token !== pollToken) return false; // a newer pollCurrent() call has taken over
    lastRoundData = data;
    renderBoard(data);
    el.statusLine.textContent = `Updated ${new Date().toLocaleTimeString("en-GB")}`;
    el.statusLine.classList.remove("stale");
    return true;
  } catch (err) {
    if (token !== pollToken) return false;
    el.statusLine.textContent = `Connection lost: ${err.message}`;
    el.statusLine.classList.add("stale");
    return false;
  }
}

// Sequence mode: poll the current entry, and if it's done and there's a
// next one queued up, jump straight to it (no artificial delay) rather than
// waiting for the next 3s tick - this catches up through any already-
// finished entries in one go on load, e.g. a tablet reloaded mid-event
// lands on the actually-current class within a single call instead of
// idling through each past one. A "paired" entry (6.12) gets its own
// per-tick handling since it involves two rounds, not one. `myToken` (see
// `pollToken` above) makes sure that if this call gets superseded by a
// newer one partway through (the natural timer firing again before a slow
// fetch resolves, or a manual button click), it never applies its
// now-stale results on top of the newer call's.
async function pollCurrent() {
  const myToken = ++pollToken;
  const seq = currentSelection.sequence;
  for (;;) {
    if (myToken !== pollToken) return;
    const entry = seq[sequenceIndex];
    if (entry.type === "paired") {
      const { ok, bothDone } = await pollPairedTick(entry, myToken);
      if (myToken !== pollToken) return;
      if (!ok) return;
      if (bothDone && sequenceIndex < seq.length - 1) {
        sequenceIndex++;
        pairedState = null;
        continue;
      }
      return;
    }
    el.pairedBar.hidden = true;
    const ok = await pollRound(currentSelection.host, entry.id, myToken);
    if (myToken !== pollToken) return;
    if (!ok) return;
    const hasNext = sequenceIndex < seq.length - 1;
    if (hasNext && isRoundFullyFinished(lastRoundData)) {
      sequenceIndex++;
      continue;
    }
    return;
  }
}

// Fetches both rounds of a paired ("interleaved") entry every tick (cheap -
// the server's 3s cache means this rarely hits results.info itself) and
// decides what to show via a shared stage cursor computed FRESH every tick
// - earlierStageName() of each side's own current stage NAME
// (currentStageNameFor), not array index - rather than a persisted,
// only-ever-advancing counter. Without the shared-minimum part, one
// category racing ahead of the other (e.g. results entered in bulk, or
// simply climbing faster) would break the requested lockstep order (1/8 A,
// 1/8 B, 1/4 A, 1/4 B, ...) - confirmed live: side B had real times in
// stage "1/4" while side A hadn't started "1/4" at all, so the naive "show
// whichever stage each side's own data says is current" approach (an
// earlier version of this function) skipped straight to B's 1/4 instead of
// waiting for A's 1/8 turn. Comparing by NAME rather than raw index also
// matters whenever the two brackets are differently sized (one category
// starts at "1/8", a smaller one starts straight at "1/4") - see
// SPEED_STAGE_ORDER above. Without the "fresh every tick" part, a judge
// reopening and correcting an earlier stage (a false start overturned on
// review, say) would leave a persisted cursor stuck ahead of where the
// corrected data now says the bracket actually is - recomputing from
// scratch every time means that just self-corrects on the next poll, same
// as the single-round view already does for free (5.5). Only
// `pairedState.activeSide` (which of the two co-equal sides to display) and
// the stuck-heat watchdog below still need to persist across ticks - there's
// no data signal for "whose turn it is", so that has to be remembered.
async function pollPairedTick(entry, token) {
  if (!pairedState || pairedState.entryIndex !== sequenceIndex) {
    pairedState = {
      entryIndex: sequenceIndex,
      activeSide: "a",
      stuckHeatId: null,
      stuckSince: 0,
      manualPin: false,
    };
  }
  const { host } = currentSelection;
  let dataA, dataB;
  try {
    [dataA, dataB] = await Promise.all([fetchRoundJson(host, entry.a), fetchRoundJson(host, entry.b)]);
  } catch (err) {
    if (token !== pollToken) return { ok: false, bothDone: false }; // superseded while fetching
    el.statusLine.textContent = `Connection lost: ${err.message}`;
    el.statusLine.classList.add("stale");
    return { ok: false, bothDone: false };
  }
  if (token !== pollToken) return { ok: false, bothDone: false }; // superseded while fetching

  const bothDone = isRoundFullyFinished(dataA) && isRoundFullyFinished(dataB);
  if (bothDone) {
    lastRoundData = dataA;
    renderBoard(dataA);
    el.pairedBar.hidden = true;
    el.statusLine.textContent = `Updated ${new Date().toLocaleTimeString("en-GB")}`;
    el.statusLine.classList.remove("stale");
    return { ok: true, bothDone: true };
  }

  const stageName = earlierStageName(currentStageNameFor(dataA), currentStageNameFor(dataB));
  const resultA = stageHeatsRemaining(dataA, stageName);
  const resultB = stageHeatsRemaining(dataB, stageName);

  // Stick with whichever side was showing if it still has something at this
  // stage; otherwise hand the turn to the other one. Skipped for exactly
  // one tick right after a manual "Switch category now" click
  // (`manualPin`) - without this, clicking to a side that's genuinely
  // empty right now (e.g. hasn't started this stage yet) would get
  // silently flipped straight back before the click ever became visible,
  // making the button look like it does nothing. A manual choice should be
  // honored - even as "Waiting for the next stage…" - not second-guessed
  // on the very same tick that set it.
  let side = pairedState.activeSide;
  let sideResult = side === "a" ? resultA : resultB;
  if (sideResult.heats.length === 0 && !pairedState.manualPin) {
    side = side === "a" ? "b" : "a";
    sideResult = side === "a" ? resultA : resultB;
  }
  pairedState.manualPin = false;
  pairedState.activeSide = side;

  // Stuck-heat watchdog: a heat can have a "current" (not-yet-confirmed)
  // athlete forever if the live-scoring source never posts a final result
  // for one lane - checked directly against results.info's raw response and
  // confirmed there is no separate "stage finished" flag to read instead
  // (see ARCHITECTURE.md 6.12). That leaves this stage genuinely non-empty
  // for one side, so the logic above never hands the turn back on its own.
  // Force a switch to the other side (same stage) once the same heat has
  // been "current" for STUCK_TIMEOUT_MS. Deliberately scoped to just this
  // paired-entry switch decision, not the core inference (5.2), which
  // still trusts "active" forever by design - a stuck single round "merely"
  // shows a stale card, but a stuck paired entry blocks the whole callzone
  // from moving on to the next stage.
  const currentHeatId = sideResult.heats[0]?.id ?? null;
  if (currentHeatId !== pairedState.stuckHeatId) {
    pairedState.stuckHeatId = currentHeatId;
    pairedState.stuckSince = Date.now();
  } else if (currentHeatId !== null && Date.now() - pairedState.stuckSince >= STUCK_TIMEOUT_MS) {
    side = side === "a" ? "b" : "a";
    pairedState.activeSide = side;
    pairedState.stuckHeatId = null;
    pairedState.stuckSince = 0;
    sideResult = side === "a" ? resultA : resultB;
  }

  const sideData = side === "a" ? dataA : dataB;
  const otherData = side === "a" ? dataB : dataA;
  lastRoundData = sideData;
  renderPairedBoard(sideData, sideResult);
  renderPairedBar(otherData, side);
  el.statusLine.textContent = `Updated ${new Date().toLocaleTimeString("en-GB")}`;
  el.statusLine.classList.remove("stale");
  return { ok: true, bothDone: false };
}

// The manual "Switch category now" button stays available as an immediate
// escape hatch alongside the automatic 90s watchdog above - staff can't
// afford to wait out a timeout mid-competition if they notice a stall
// themselves first.
function renderPairedBar(otherData, activeSide) {
  el.pairedBar.hidden = false;
  const otherLabel = `${otherData.category ?? ""} — ${otherData.round ?? ""}`.trim();
  el.pairedLabel.textContent = `Interleaved with: ${otherLabel}`;
  el.pairedSwitchBtn.onclick = () => {
    if (!pairedState) return;
    pairedState.activeSide = activeSide === "a" ? "b" : "a";
    pairedState.manualPin = true;
    pairedState.stuckHeatId = null;
    pairedState.stuckSince = 0;
    pollCurrent();
  };
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

// Builds the sorted athlete order for one route from the round's startlist -
// shared by the live inference (computeLane) and Training mode, which
// reuses this same order but drives the position manually instead (6.11).
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

// Renders the climbing/next/queue cards (or a "finished" placeholder) into
// an already-headed lane section - shared by the live inference (buildLane)
// and Training mode's manual position (buildTrainingLane), which differ
// only in how atWall/onDeck/queue/finished get computed.
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

// Training mode's lane: same rendering as a live lane, but the position
// comes from the manually/remotely driven `index` instead of inferred
// ascent status (6.11) - there's no live results to infer from during
// training in the first place.
function buildTrainingLane(route, ordered, index, laneLabelPrefix) {
  const laneEl = document.createElement("section");
  laneEl.className = "lane";

  const heading = document.createElement("div");
  heading.className = "lane-heading";
  heading.textContent = `${laneLabelPrefix} ${route.name}`;
  laneEl.appendChild(heading);

  renderLaneBody(laneEl, {
    atWall: ordered[index] ?? null,
    onDeck: ordered[index + 1] ?? null,
    queue: ordered.slice(index + 2, index + 2 + 6),
    finished: index >= ordered.length,
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

// A heat is "done" once it has a real recorded outcome - checked directly
// on the data, NOT via the ascent `status` field. Confirmed live against
// real results.info data across several rounds: a Speed-elimination heat
// can carry a complete, valid time for both lanes, with the stage
// explicitly closed upstream (results.info's own admin tool shows a
// "Reopen stage" affordance), and STILL report status "active" forever -
// unlike qualification rounds (5.2), where active reliably resolves to
// confirmed, it apparently never does here for Speed elimination. Trusting
// "active" the way computeLane() does would mean the display gets
// permanently stuck on whichever heat was last touched, no matter how much
// real progress happens afterward - exactly the bug this replaces.
function ascentHasResult(ascent) {
  // A fall (dnf) is itself a recorded outcome for that lane - it doesn't
  // decide the whole heat by itself (see ascentIsAutoDecided below), but it
  // does mean THIS lane is done: no further time is coming for them.
  if (ascent?.dnf === true) return true;
  return (ascent?.time_ms ?? 0) > 0;
}
function ascentIsAutoDecided(ascent) {
  // A false start (dns) OR an explicit "not started" no-show auto-decides
  // the whole heat under Speed climbing rules - the other lane
  // wins/advances as a "wildcard" without ever getting their own ascent
  // recorded at all (confirmed live: that lane's ascent stays
  // `time_ms: 0/null, status: "active"/"pending"` forever, and
  // results.info's own official standings label the outcome "WILDCARD").
  // "Not started" is a THIRD, separate outcome from results.info, not
  // covered by `dnf`/`dns` at all - confirmed live: a "Not Started" ascent
  // has `dnf: false, dns: false`, only distinguishable via
  // `formatted_ascent_score === "NOT STARTED"`. `time_ms === null` alone is
  // NOT a safe substitute for this - a completely untouched wildcard-winner
  // ascent (the other lane's own case) can also have `time_ms: null` with
  // no `formatted_ascent_score` at all, so checking the score text
  // specifically is what avoids false-triggering on that.
  // A fall (dnf) is different from both: it does NOT auto-decide the heat -
  // the other lane still has to actually finish their own run and get a
  // real time before the heat counts as done.
  return ascent?.dns === true || ascent?.formatted_ascent_score === "NOT STARTED";
}
function heatIsDone(heat) {
  if (!heatIsReady(heat)) return false;
  const ascents = heat.athletes.map((a) => a.ascents?.[0]);
  if (ascents.some(ascentIsAutoDecided)) return true;
  return ascents.every(ascentHasResult);
}

// "Current heat" = the one right after the last heat with a real recorded
// result, scanning the given heats front to back once - deliberately the
// LAST done heat, not the FIRST not-done one, so a heat that never gets a
// result (a genuine gap - equipment failure, a dispute) doesn't
// permanently block heats after it from being recognized as current, the
// same "last confirmed + 1" reasoning as findCurrentIndex() (5.2), just
// applied via heatIsDone() instead of ascent status.
function findCurrentHeatIndex(heats) {
  let lastDone = -1;
  heats.forEach((h, i) => {
    if (heatIsDone(h)) lastDone = i;
  });
  return lastDone + 1;
}

// Canonical ordering of Speed elimination stage names, earliest first. A
// paired entry's shared stage cursor (6.12) needs this because the two
// interleaved rounds can have differently-sized brackets - e.g. one
// category has enough finalists to start at "1/8" while a smaller one
// starts straight at "1/4" with no "1/8" stage at all. Comparing raw array
// index into each round's own `speed_elimination_stages` would then compare
// two DIFFERENT real stages under the same index (index 0 = "1/8" for one
// side, "1/4" for the other) - comparing by name instead is what keeps the
// lockstep meaningful regardless of bracket size. Extend this list if a
// bigger bracket ("1/16"/"1/32") or different wording is ever seen live -
// see AGENTS.md §2 on verifying field values against real data first.
const SPEED_STAGE_ORDER = ["1/32", "1/16", "1/8", "1/4", "1/2", "Small Final", "Final"];

function stageNameRank(stageName) {
  const idx = SPEED_STAGE_ORDER.indexOf(stageName);
  return idx === -1 ? SPEED_STAGE_ORDER.length : idx; // unknown name sorts last - never blocks the other, known side
}

// Whichever of the two given stage names is earlier per SPEED_STAGE_ORDER;
// either may be null (bracket not generated yet at all).
function earlierStageName(nameA, nameB) {
  if (nameA === null) return nameB;
  if (nameB === null) return nameA;
  return stageNameRank(nameA) <= stageNameRank(nameB) ? nameA : nameB;
}

// Which stage NAME contains this round's own current heat, per
// findCurrentHeatIndex() above. Used by paired sequence entries (6.12) to
// recompute their shared stage cursor fresh on every tick instead of
// persisting it - so if a judge reopens and corrects an earlier stage
// (deletes a result, re-enters it), the shared cursor picks that up
// automatically on the next poll, the same "no memory, always re-derive
// from live data" property the single-round view already has for free
// (5.5).
function currentStageNameFor(round) {
  const stages = round.speed_elimination_stages ?? [];
  if (!stages.length) return null;
  const heats = stages.flatMap((stage) => stage.heats.map((h) => ({ ...h, stageName: stage.stage_name })));
  const currentIndex = findCurrentHeatIndex(heats);
  if (currentIndex >= heats.length) return stages[stages.length - 1].stage_name; // whole bracket done - pin at the last stage
  return heats[currentIndex].stageName;
}

function computeSpeedElimination(round) {
  const heats = (round.speed_elimination_stages ?? []).flatMap((stage) =>
    stage.heats.map((heat) => ({ ...heat, stageName: stage.stage_name }))
  );

  const currentIndex = findCurrentHeatIndex(heats);

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

// Same "which heat is current" rule as computeSpeedElimination() above, but
// scoped to one specific named stage instead of scanning across all of
// them. Looked up by NAME, not array index - see SPEED_STAGE_ORDER above
// for why (differently-sized brackets don't share index-to-stage meaning).
// Used by paired sequence entries (6.12) to force both sides of an
// interleaved pair through the SAME stage names in lockstep, rather than
// each side just reporting wherever its own live data happens to currently
// be (which could otherwise be several stages apart, e.g. if one
// category's results were entered in bulk ahead of the other's).
function stageHeatsRemaining(round, stageName) {
  const stage = round.speed_elimination_stages?.find((s) => s.stage_name === stageName);
  if (!stage) return { stageName, heats: [], exists: false };
  const heats = stage.heats.map((h) => ({ ...h, stageName: stage.stage_name }));
  const currentIndex = findCurrentHeatIndex(heats);
  if (currentIndex >= heats.length || !heatIsReady(heats[currentIndex])) {
    return { stageName: stage.stage_name, heats: [], exists: true };
  }
  return { stageName: stage.stage_name, heats: heats.slice(currentIndex), exists: true };
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

  renderSpeedStage(round, result);
}

// Shared by renderSpeedElimination() (normal single-round display) and the
// paired-entry lockstep view (renderPairedBoard, 6.12) - both end up with a
// { stageName, heats } result, just derived differently, and render
// identically from there.
function renderSpeedStage(round, result) {
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

// A paired sequence entry's lockstep view (6.12): like renderBoard(), but
// forced to a specific stage (via a pre-computed stageHeatsRemaining()
// result) instead of letting the round's own data decide which stage is
// "current" - that's the whole point of the lockstep, so this deliberately
// does NOT call renderSpeedElimination()/computeSpeedElimination().
function renderPairedBoard(round, stageResult) {
  el.roundTitle.textContent = `${round.category ?? ""} — ${round.round ?? ""} (${round.discipline ?? ""})`.trim();
  el.lanes.innerHTML = "";
  el.groupTabs.hidden = true;

  if (!stageResult.heats.length) {
    const empty = document.createElement("div");
    empty.className = "lane-finished";
    empty.textContent = "Waiting for the next stage…";
    el.lanes.appendChild(empty);
    return;
  }
  renderSpeedStage(round, stageResult);
}

// --- Training mode -------------------------------------------------------
//
// A Speed training session has no live results.info data to poll (it isn't
// a real scored round). Its start order matches a real round's though (e.g.
// the qualification round), so this mode reuses that round's roster/order
// and drives the position manually instead of from ascent status. The
// position is kept on the server (not just localStorage) so a second device
// - e.g. a phone - can also drive it while the wall tablet just displays
// (see the /api/training endpoint and ARCHITECTURE.md 6.11).

async function startTrainingSession(selection) {
  if (!selection.control) {
    el.shareLink.value = buildShareLink(selection);
    el.controlShareRow.hidden = false;
    el.controlLink.value = buildShareLink({ ...selection, control: true });
    el.trainingControls.hidden = false;
  }

  const statusEl = selection.control ? el.controllerStatus : el.statusLine;
  try {
    trainingRoundData = await fetchRoundJson(selection.host, selection.roundId);
  } catch (err) {
    statusEl.textContent = `Couldn't load round: ${err.message}`;
    statusEl.classList.add("stale");
    return;
  }

  await pollTrainingIndex();
  trainingPollTimer = setInterval(pollTrainingIndex, 1000);
}

// Same staleness guard as `pollToken` above, for training's independent
// 1s poll loop - a manual Next/Back tap (trainingStep) and the automatic
// 1s tick (pollTrainingIndex) can otherwise land out of order (a slow GET
// resolving after a POST that started later), briefly showing the wrong
// athlete until the next tick corrects it. Whichever call started LAST
// wins, regardless of which resolves first.
let trainingPollToken = 0;

async function pollTrainingIndex() {
  const myToken = ++trainingPollToken;
  const isController = currentSelection.control;
  const statusEl = isController ? el.controllerStatus : el.statusLine;
  try {
    const res = await fetch(`/api/training/${currentSelection.host}/${currentSelection.roundId}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    if (myToken !== trainingPollToken) return;
    trainingIndex = data.index ?? 0;
    if (isController) renderController(trainingRoundData, trainingIndex);
    else renderTrainingBoard(trainingRoundData, trainingIndex);
    statusEl.textContent = `Updated ${new Date().toLocaleTimeString("en-GB")}`;
    statusEl.classList.remove("stale");
  } catch (err) {
    if (myToken !== trainingPollToken) return;
    statusEl.textContent = `Connection lost: ${err.message}`;
    statusEl.classList.add("stale");
  }
}

async function trainingStep(delta) {
  const myToken = ++trainingPollToken;
  const statusEl = currentSelection.control ? el.controllerStatus : el.statusLine;
  try {
    const res = await fetch(`/api/training/${currentSelection.host}/${currentSelection.roundId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delta }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    if (myToken !== trainingPollToken) return;
    trainingIndex = data.index ?? trainingIndex;
    if (currentSelection.control) renderController(trainingRoundData, trainingIndex);
    else renderTrainingBoard(trainingRoundData, trainingIndex);
  } catch (err) {
    if (myToken !== trainingPollToken) return;
    statusEl.textContent = `Connection lost: ${err.message}`;
    statusEl.classList.add("stale");
  }
}

function renderTrainingBoard(round, index) {
  el.roundTitle.textContent = `${round.category ?? ""} — ${round.round ?? ""} (${round.discipline ?? ""}) — Training`.trim();
  el.lanes.innerHTML = "";
  el.groupTabs.hidden = true;

  const routes = collectRouteGroups(round).flatMap((g) => g.routes);
  if (!routes.length) {
    const empty = document.createElement("div");
    empty.className = "lane-finished";
    empty.textContent = "No route data for this round.";
    el.lanes.appendChild(empty);
    return;
  }

  const laneLabelPrefix = round.discipline === "Speed" ? "Lane" : "Route";
  const grid = document.createElement("div");
  grid.className = "lanes-grid";
  for (const route of routes) {
    grid.appendChild(buildTrainingLane(route, orderedAthletesForRoute(round, route), index, laneLabelPrefix));
  }
  el.lanes.appendChild(grid);
}

// The controller device's view is deliberately minimal (just names + two
// big buttons) rather than the full board - a phone screen doesn't have
// room for several lane cards, and the person holding it just needs to
// know who's up and to be able to tap Next/Back with confidence.
function renderController(round, index) {
  el.controllerTitle.textContent = `${round.category ?? ""} — ${round.round ?? ""} — Training`.trim();
  el.controllerLanes.innerHTML = "";

  const routes = collectRouteGroups(round).flatMap((g) => g.routes);
  const laneLabelPrefix = round.discipline === "Speed" ? "Lane" : "Route";
  for (const route of routes) {
    const ordered = orderedAthletesForRoute(round, route);
    const atWall = ordered[index] ?? null;

    const laneEl = document.createElement("div");
    laneEl.className = "controller-lane";
    const name = document.createElement("span");
    name.className = "lane-name";
    name.textContent = `${laneLabelPrefix} ${route.name}`;
    const athlete = document.createElement("span");
    athlete.className = "lane-athlete";
    athlete.textContent = atWall ? athleteLine(atWall) : index >= ordered.length ? "Finished" : "—";
    laneEl.appendChild(name);
    laneEl.appendChild(athlete);
    el.controllerLanes.appendChild(laneEl);
  }
}

el.trainingBack.addEventListener("click", () => trainingStep(-1));
el.trainingNext.addEventListener("click", () => trainingStep(1));
el.controlBack.addEventListener("click", () => trainingStep(-1));
el.controlNext.addEventListener("click", () => trainingStep(1));

el.loadEvent.addEventListener("click", loadEvent);
el.eventId.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadEvent();
});

for (const btn of el.modeTabs.querySelectorAll(".mode-tab")) {
  btn.addEventListener("click", () => setMode(btn.dataset.mode));
}
setMode("single");

const initial = readUrlSelection() ?? loadSelection();
if (initial?.host && initial?.eventId) {
  el.eventId.value = initial.eventId;
  el.host.value = initial.host;
  if (initial.kind === "training" || initial.sequence?.length) {
    // Jump straight to the board (or controller) so a bookmarked device
    // never has to see the setup screen; loadEvent() below fills the
    // dropdown in the background for when "switch round" is used later.
    startWatching(initial);
  }
  loadEvent().then(() => {
    const restoredRoundId =
      initial.kind === "training" ? initial.roundId : initial.sequence?.[0]?.id ?? initial.sequence?.[0]?.a;
    if (restoredRoundId && [...el.roundSelect.options].some((o) => o.value === restoredRoundId)) {
      el.roundSelect.value = restoredRoundId;
    }
  });
}
