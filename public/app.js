const STORAGE_KEY = "callzone-selection";

const el = {
  eventId: document.getElementById("eventId"),
  host: document.getElementById("host"),
  loadEvent: document.getElementById("loadEvent"),
  setupError: document.getElementById("setupError"),
  modeTabs: document.getElementById("modeTabs"),
  categoryRow: document.getElementById("categoryRow"),
  roundSelect: document.getElementById("roundSelect"),
  watchRound: document.getElementById("watchRound"),
  trainingHint: document.getElementById("trainingHint"),
  startTraining: document.getElementById("startTraining"),
  sequenceRow: document.getElementById("sequenceRow"),
  sequenceLabel: document.getElementById("sequenceLabel"),
  sequenceList: document.getElementById("sequenceList"),
  addRoundToSequence: document.getElementById("addRoundToSequence"),
  pairedEntryHint: document.getElementById("pairedEntryHint"),
  addPairedToSequence: document.getElementById("addPairedToSequence"),
  watchSequence: document.getElementById("watchSequence"),
  multiSetup: document.getElementById("multiSetup"),
  multiCountTabs: document.getElementById("multiCountTabs"),
  multiColumnsConfig: document.getElementById("multiColumnsConfig"),
  watchMulti: document.getElementById("watchMulti"),
  setup: document.getElementById("setup"),
  board: document.getElementById("board"),
  controller: document.getElementById("controller"),
  backBtn: document.getElementById("backBtn"),
  kioskBtn: document.getElementById("kioskBtn"),
  roundTitle: document.getElementById("roundTitle"),
  statusLine: document.getElementById("statusLine"),
  hostLabel: document.getElementById("hostLabel"),
  pairedBar: document.getElementById("pairedBar"),
  pairedLabel: document.getElementById("pairedLabel"),
  pairedSwitchBtn: document.getElementById("pairedSwitchBtn"),
  trainingControls: document.getElementById("trainingControls"),
  trainingBack: document.getElementById("trainingBack"),
  trainingNext: document.getElementById("trainingNext"),
  shareRow: document.getElementById("shareRow"),
  shareLink: document.getElementById("shareLink"),
  copyLink: document.getElementById("copyLink"),
  shareQr: document.getElementById("shareQr"),
  controlShareRow: document.getElementById("controlShareRow"),
  controlLink: document.getElementById("controlLink"),
  copyControlLink: document.getElementById("copyControlLink"),
  controlQr: document.getElementById("controlQr"),
  groupTabs: document.getElementById("groupTabs"),
  routeTabs: document.getElementById("routeTabs"),
  boulderModeRow: document.getElementById("boulderModeRow"),
  lanes: document.getElementById("lanes"),
  nextInSequence: document.getElementById("nextInSequence"),
  controllerBackBtn: document.getElementById("controllerBackBtn"),
  controllerTitle: document.getElementById("controllerTitle"),
  controllerStatus: document.getElementById("controllerStatus"),
  controllerLanes: document.getElementById("controllerLanes"),
  controlBack: document.getElementById("controlBack"),
  controlNext: document.getElementById("controlNext"),
};

let pollTimer = null;
let lastRoundData = null;
// Multimode's per-column poll results (6.23), rebuilt every pollMulti()
// tick - { round } or { error } per entry, parallel to
// currentSelection.entries. Kept so a group/route tab click inside one
// column can re-render without waiting for the next 3s tick, same role
// lastRoundData plays for the normal single-round board.
let lastMultiResults = null;

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
//   - watch:    { kind: "watch", host, eventId, group, route, sequence }
//   - training: { kind: "training", host, eventId, roundId, control, route }
//   - multi:    { kind: "multi", host, eventId, entries }
// `route`, like `group`, dedicates this tablet to one or several
// routes/boulders instead of the full lanes grid (6.22) - `null`/absent
// means "show all"; otherwise an array of route names (a single route is
// just an array of length one, same convention as `sequence` below).
// `sequence` is always an array - a single round is just an array of length
// one - see "Sequence mode" below. Each entry is either
// { type: "round", id } or { type: "paired", a, b } (see 6.12).
// Multimode's `entries` (6.23) are up to 5 side-by-side columns, each its
// own independent watch-selection-minus-host/event: { sequence,
// sequenceIndex, group, route } - `sequence` is the SAME token shape as
// above (but only ever `{type:"round",id}`, no "paired" - Speed is out of
// scope for Multimode), `sequenceIndex` tracks that column's own position
// exactly like the top-level `sequenceIndex` below does for normal
// Sequence mode, just once per column instead of once globally.
let currentSelection = null;

// Which entry of the sequence is currently showing. Always restarts at 0 on
// load/reload rather than being persisted - pollCurrent() catches up through
// any already-finished entries immediately, so this converges on the right
// one within a poll or two regardless.
let sequenceIndex = 0;

// Caches a round's "Category — Round" label by id (6.10's "next up" strip
// below the lanes) - round metadata (category/round name) never changes
// within a session, so this is safe to keep indefinitely and avoids
// re-fetching the same not-yet-current round on every 3s poll tick.
const roundLabelCache = new Map();

// State for the paired ("interleaved") entry currently active, if any -
// { entryIndex, activeSide: "a" | "b" }. Reset whenever sequenceIndex moves
// to a different entry. null when the current entry isn't a paired one.
let pairedState = null;

// Entries queued up on the setup screen before "Show sequence" is clicked -
// purely local UI state, richer than the playback form (keeps labels for
// display): { type: "round", roundId, label } |
// { type: "paired", aId, aLabel, bId, bLabel }.
let sequenceBuilder = [];

// Multimode setup state (6.23): pick a column count first, then each
// column gets its own dedicated config card (round picker + its own
// mini round-sequence), all visible and editable at once - rather than
// building one column at a time. `multiColumnDrafts[i]` is column i's own
// state: `{ items }` - that column's round sequence so far ({ roundId,
// discipline }, in play order, index 0 first). A fresh column starts with
// `items: []` and stays that way until the user clicks "+ Add Sequence"
// themselves - no round is ever pre-picked without a click (a deliberate
// reversal of an earlier auto-seed design: it read as the setup screen
// silently deciding for you, reported live after a screenshot showed
// every fresh column expected to start truly empty). An empty column is
// always valid and renders as "Round finished" on the board (a tablet can
// be set up ahead of time with more columns than currently-known
// categories).
// Always kept in sync with `multiColumnCount` (padded/truncated on count
// change) so `multiColumnDrafts[i]` is never undefined for `i <
// multiColumnCount`. The discipline lock is per-column, not shared across
// columns (6.24) - renderMultiColumnsConfig()'s `availableFor()` derives
// it fresh each render from that column's own `items` only, so two
// different columns can independently be Lead and Boulder; only a single
// column's own sequence has to stay one discipline throughout.
let multiColumnCount = 2;
let multiColumnDrafts = [{ items: [] }, { items: [] }];

// Which setup-screen mode is selected: "single" | "sequence" | "training" | "multi".
let currentMode = "single";
// How many rounds in the currently-loaded event are Speed elimination
// format - the "interleave two finals" row only makes sense with 2+.
let eliminationCount = 0;
// The currently-loaded event's rounds, kept around (not just a local
// inside populateRounds()) so populateRoundSelect() can rebuild
// #roundSelect's options whenever the mode changes, not just once at load
// time - Training mode filters this down to Speed only.
let loadedEntries = [];
// Just the Speed elimination subset of loadedEntries (6.12) - kept around
// separately so renderSequenceBuilder()'s paired-entry rows can populate
// their own two <select>s without recomputing this filter on every
// render.
let loadedEliminationEntries = [];

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

// Boulder-finals-only display mode (6.17): "interval" (default, matches
// Qualification's reading) vs "world_series" (padded-distance queue, see
// computeBoulderLane()). results.info's format_identifier doesn't tell us
// which physical final format a round actually uses, so this is a manual
// per-round choice, remembered by round id (not per-tablet) since it's a
// property of the real event, not a personal display preference.
const BOULDER_FINAL_MODE_KEY = "callzone-boulder-final-mode";
function loadBoulderFinalMode(roundId) {
  try {
    const modes = JSON.parse(localStorage.getItem(BOULDER_FINAL_MODE_KEY)) ?? {};
    return modes[roundId] ?? "interval";
  } catch {
    return "interval";
  }
}
function saveBoulderFinalMode(roundId, mode) {
  let modes = {};
  try {
    modes = JSON.parse(localStorage.getItem(BOULDER_FINAL_MODE_KEY)) ?? {};
  } catch {
    modes = {};
  }
  modes[roundId] = mode;
  localStorage.setItem(BOULDER_FINAL_MODE_KEY, JSON.stringify(modes));
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

  // `route` is a comma-separated list of route names (6.22) - one or
  // several routes/boulders this tablet is dedicated to, or absent/empty
  // for "show everything".
  const routeParam = params.get("route");
  const route = routeParam ? routeParam.split(",").filter(Boolean) : null;

  const trainingRoundId = params.get("training");
  if (trainingRoundId) {
    return {
      kind: "training",
      host,
      eventId,
      roundId: trainingRoundId,
      control: params.get("control") === "1",
      route,
    };
  }

  // `multi` (6.23) is a comma-separated list of columns, each
  // `roundId1+roundId2~group~route1+route2` (three `~`-separated fields,
  // empty stays empty). `+` joins both a column's own round sequence and
  // its selected route names - unambiguous since `~` already separates the
  // three fields before either gets split on `+`.
  const multiParam = params.get("multi");
  if (multiParam) {
    const entries = multiParam
      .split(",")
      .filter(Boolean)
      .map((token) => {
        const [roundsStr, group, routeStr] = token.split("~");
        return {
          // An empty sequence is a legitimate column (6.23) - a tablet set
          // up ahead of time with more columns than currently-known
          // categories - not dropped here; it round-trips to the same
          // "Round finished" placeholder pollOneMultiColumn()/
          // renderMultiBoard() already show for one built fresh in the UI.
          sequence: (roundsStr ?? "").split("+").filter(Boolean).map((id) => ({ type: "round", id })),
          sequenceIndex: 0,
          group: group || null,
          route: routeStr ? routeStr.split("+").filter(Boolean) : null,
        };
      });
    if (entries.length) return { kind: "multi", host, eventId, entries };
  }

  const group = params.get("group");
  const roundsParam = params.get("rounds");
  const roundParam = params.get("round");
  const sequence = roundsParam
    ? roundsParam.split(",").filter(Boolean).map(parseSequenceToken)
    : roundParam
    ? [{ type: "round", id: roundParam }]
    : null;
  return sequence ? { kind: "watch", host, eventId, group, route, sequence } : null;
}

function buildShareLink(sel) {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set("host", sel.host);
  url.searchParams.set("event", sel.eventId);

  if (sel.kind === "training") {
    url.searchParams.set("training", sel.roundId);
    if (sel.control) url.searchParams.set("control", "1");
    if (sel.route?.length) url.searchParams.set("route", sel.route.join(","));
    return url.toString();
  }

  if (sel.kind === "multi") {
    const tokens = sel.entries.map((e) => {
      const rounds = e.sequence.map((s) => s.id).join("+");
      return `${rounds}~${e.group ?? ""}~${(e.route ?? []).join("+")}`;
    });
    url.searchParams.set("multi", tokens.join(","));
    return url.toString();
  }

  const tokens = sel.sequence.map((e) => (e.type === "paired" ? `${e.a}+${e.b}` : e.id));
  if (tokens.length > 1) url.searchParams.set("rounds", tokens.join(","));
  else url.searchParams.set("round", tokens[0]);
  if (sel.group) url.searchParams.set("group", sel.group);
  if (sel.route?.length) url.searchParams.set("route", sel.route.join(","));
  return url.toString();
}

// Renders a scannable QR code for `url` into `container` (replacing any
// previous content) - lets a second device (phone, another tablet) open
// the exact same link without typing or copy-pasting it, alongside the
// existing "Link for this tablet" / "Link to control from another device"
// text fields. `qrcode` comes from the vendored qrcode.js (Kazuhiko Arase,
// MIT) loaded before this script - no network/CDN dependency, consistent
// with this app having no other external runtime dependencies. `scalable:
// true` omits fixed pixel width/height on the generated <svg> so it scales
// via CSS (`.qr-code`) purely off the embedded viewBox.
function renderQrCode(container, url) {
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  container.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

// Small, unobtrusive "which server is this tablet actually pointed at"
// hint next to the "Updated HH:MM:SS" status line - with six selectable
// hosts now (4.1) instead of the original three, a tablet accidentally
// pointed at the wrong tenant (e.g. `usac` instead of `dav`) would
// otherwise be invisible from the board alone, only visible in the URL.
// Reads the host's display label from #host's own <option> text rather
// than a second copy of the same strings - those options are static
// markup in index.html, always present regardless of whether this tablet
// went through the interactive "Load event" flow or a direct deep link
// (unlike #roundSelect's options, which only populateRounds() fills in -
// see 6.19's "Next up" strip for why that distinction matters here too).
function updateHostLabel(hostKey) {
  el.hostLabel.textContent = el.host.querySelector(`option[value="${hostKey}"]`)?.textContent ?? hostKey;
}

function setShareLink(url) {
  el.shareLink.value = url;
  renderQrCode(el.shareQr, url);
}
function setControlLink(url) {
  el.controlLink.value = url;
  renderQrCode(el.controlQr, url);
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
  el.startTraining.hidden = mode !== "training";
  // Single source of truth for both - they must always show/hide together
  // (the hint explains what the button next to it does), so there's no
  // second copy of this condition to drift out of sync with this one.
  el.pairedEntryHint.hidden = el.addPairedToSequence.hidden = mode !== "sequence" || eliminationCount < 2;
  // Multimode and Sequence both pick their round(s) inside their own
  // per-mode section now (#multiSetup / #sequenceRow's own live rows,
  // 6.10/6.23) - neither has any use for the shared "Category / round"
  // picker above, unlike Single round and Training.
  el.categoryRow.hidden = mode === "multi" || mode === "sequence" || el.modeTabs.hidden;
  el.multiSetup.hidden = mode !== "multi";
  populateRoundSelect();
  renderSequenceBuilder();
  updateTrainingEligibility();
}

// Rebuilds #roundSelect's options from loadedEntries - filtered to Speed
// only in Training mode (which has no concept of Lead/Boulder, 6.11),
// everything otherwise. Called on every mode switch, not just once when
// the event loads, so switching into/out of Training re-filters live
// instead of just disabling "Start training" after the fact. Preserves
// the previous selection if it's still in the new (possibly narrower)
// list, so toggling between modes doesn't reset an otherwise-still-valid
// pick back to the first option every time.
function populateRoundSelect() {
  const previousValue = el.roundSelect.value;
  const filtered = currentMode === "training" ? loadedEntries.filter((e) => e.isSpeed) : loadedEntries;
  el.roundSelect.innerHTML = "";
  for (const entry of filtered) {
    const opt = document.createElement("option");
    opt.value = entry.roundId;
    opt.textContent = `${entry.label} (${STATUS_LABEL[entry.status] ?? entry.status})`;
    opt.dataset.speed = entry.isSpeed ? "1" : "";
    el.roundSelect.appendChild(opt);
  }
  if (filtered.some((e) => e.roundId === previousValue)) el.roundSelect.value = previousValue;
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
  // A freshly-loaded event starts with an empty sequence/Multimode builder -
  // carrying over entries from a previously-loaded event would silently mix
  // events.
  sequenceBuilder = [];
  multiColumnCount = 2;
  multiColumnDrafts = [{ items: [] }, { items: [] }];
  for (const btn of el.multiCountTabs.querySelectorAll(".mode-tab")) {
    btn.classList.toggle("active", Number(btn.dataset.count) === multiColumnCount);
  }

  const entries = [];
  for (const dcat of eventData.d_cats ?? []) {
    for (const round of dcat.category_rounds ?? []) {
      entries.push({
        // Stringified - results.info's category_round_id is a number, but
        // every other roundId in this app (URL params, <select> values,
        // sequence/entry tokens) is always a string. Comparing this against
        // one of those with `===` (e.g. Multimode's discipline-lock lookup)
        // silently never matches otherwise - a real bug found live: an
        // `entries.find(e => e.roundId === roundId)` lookup always missed,
        // so the cheap Speed pre-check never fired and Speed rounds could
        // slip into Multimode undetected.
        roundId: String(round.category_round_id),
        label: `${dcat.dcat_name} — ${round.name}`,
        status: round.status,
        isElimination: round.format_identifier === "speed_elimination_ifsc_2026",
        isSpeed: round.format_identifier?.startsWith("speed_") ?? false,
        // Confirmed prefix for every known Boulder format_identifier
        // variant (qualification, both group shapes, every finals variant
        // - see AGENTS.md's fixture table), same confidence level as
        // isSpeed above - used to pre-filter Multimode's per-column round
        // pickers by discipline without a fetch. Never used to positively
        // identify Lead (no confirmed Lead prefix pattern, AGENTS.md rule
        // 2) - only to rule Boulder in/out; Multimode treats "not Speed,
        // not Boulder" as Lead by elimination, since those are the only
        // three disciplines this app (or results.info) has.
        isBoulder: round.format_identifier?.startsWith("boulder_") ?? false,
      });
    }
  }
  const rank = { active: 0, pending: 1, finished: 2 };
  entries.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || a.label.localeCompare(b.label));

  // #roundSelect itself is (re)populated by setMode() below, via
  // populateRoundSelect() - it needs loadedEntries set first, but doesn't
  // need populating twice here too.
  loadedEntries = entries;
  // #categoryRow's own visibility is finished off by setMode() below (also
  // mode-dependent - hidden in Multimode, which picks rounds per column
  // instead), but el.modeTabs.hidden must already be correct before that
  // call since setMode() reads it.
  el.modeTabs.hidden = entries.length === 0;
  if (entries.length === 0) showError("This event has no categories/rounds.");

  // Only Speed elimination rounds have stages to interleave on - quali
  // rounds and non-Speed finals have nothing analogous (see 6.12).
  loadedEliminationEntries = entries.filter((e) => e.isElimination);
  eliminationCount = loadedEliminationEntries.length;
  setMode(currentMode);

  el.watchRound.onclick = () => {
    const roundId = el.roundSelect.value;
    if (!roundId) return;
    startWatching({ kind: "watch", host, eventId, group: null, route: null, sequence: [{ type: "round", id: roundId }] });
  };

  // Appends a new round, pre-filled with the first one not already used
  // anywhere in the sequence - never a duplicate by default (6.10,
  // matching Multimode's "+ Add Sequence", 6.23). Disabled once every
  // round is already in the sequence (see renderSequenceBuilder()'s
  // disabled-state check) rather than silently doing nothing on click.
  el.addRoundToSequence.onclick = () => {
    const used = usedInSequenceBuilder();
    const entry = loadedEntries.find((e) => !used.has(e.roundId));
    if (!entry) return;
    sequenceBuilder.push({ type: "round", roundId: entry.roundId, label: entryLabel(entry) });
    renderSequenceBuilder();
  };

  // Appends a new paired entry (6.12), pre-filled with the first two
  // not-already-used Speed elimination rounds - same reasoning as above.
  el.addPairedToSequence.onclick = () => {
    const used = usedInSequenceBuilder();
    const available = loadedEliminationEntries.filter((e) => !used.has(e.roundId));
    if (available.length < 2) return;
    const [a, b] = available;
    sequenceBuilder.push({ type: "paired", aId: a.roundId, aLabel: entryLabel(a), bId: b.roundId, bLabel: entryLabel(b) });
    renderSequenceBuilder();
  };

  el.watchSequence.onclick = () => {
    if (!sequenceBuilder.length) {
      showError("Add at least one round to the sequence.");
      return;
    }
    showError("");
    const sequence = sequenceBuilder.map((item) =>
      item.type === "paired" ? { type: "paired", a: item.aId, b: item.bId } : { type: "round", id: item.roundId }
    );
    startWatching({ kind: "watch", host, eventId, group: null, route: null, sequence });
  };

  // `.onclick =` (not addEventListener) - populateRounds() re-runs on
  // every "Load event" click, and these are static buttons that already
  // existed in the DOM before this call, so addEventListener would stack
  // a new listener (with this call's now-stale entries/host closure) on
  // top of the previous load's every time, firing the handler multiple
  // times per click. Same reasoning as every other el.X.onclick = ... in
  // this function.
  for (const btn of el.multiCountTabs.querySelectorAll(".mode-tab")) {
    btn.onclick = () => {
      multiColumnCount = Number(btn.dataset.count);
      // Pad with fresh empty columns or truncate extras, but keep already-
      // configured columns intact when just adjusting the count - going
      // from 3 to 2 and back to 3 shouldn't lose column 1/2's rounds.
      while (multiColumnDrafts.length < multiColumnCount) multiColumnDrafts.push({ items: [] });
      multiColumnDrafts.length = multiColumnCount;
      for (const b of el.multiCountTabs.querySelectorAll(".mode-tab")) b.classList.toggle("active", b === btn);
      renderMultiColumnsConfig(entries);
    };
  }
  renderMultiColumnsConfig(entries);

  el.watchMulti.onclick = () => {
    // Columns don't all need a round configured - a tablet can be set up
    // ahead of time with more columns than currently-known categories, and
    // an empty column just renders as "Round finished" (pollOneMultiColumn/
    // renderMultiBoard). Only block if literally nothing was configured
    // anywhere - that would just be an empty board.
    if (multiColumnDrafts.every((d) => d.items.length === 0)) {
      showError("Add at least one round to a column.");
      return;
    }
    showError("");
    const multiEntries = multiColumnDrafts.map((draft) => ({
      sequence: draft.items.map((item) => ({ type: "round", id: item.roundId })),
      sequenceIndex: 0,
      group: null,
      route: null,
    }));
    startWatching({ kind: "multi", host, eventId, entries: multiEntries });
  };

  el.startTraining.onclick = () => {
    const opt = el.roundSelect.selectedOptions[0];
    if (!opt || opt.dataset.speed !== "1") return; // belt-and-suspenders - button is also disabled for this case
    startWatching({ kind: "training", host, eventId, roundId: opt.value, control: false, route: null });
  };

  el.roundSelect.onchange = updateTrainingEligibility;
}

// Every id claimed by the items in `list`, optionally excluding one item's
// own index - shared by Sequence mode (whose items can be a plain round OR
// a paired Speed entry, 6.12, hence `idsOf` returning more than one id) and
// Multimode's per-column picker (whose items are always a plain round).
// Used both for per-row option filtering (a round can't be picked twice in
// the same list) and "+ Add" auto-seed defaults (never default to a round
// already used elsewhere) - same "prevent by not offering, not by
// validating after" approach in both places.
function usedIdsExcluding(list, excludeIndex, idsOf) {
  const used = new Set();
  list.forEach((item, idx) => {
    if (idx === excludeIndex) return;
    for (const id of idsOf(item)) used.add(id);
  });
  return used;
}

// One live <select> for a single-round pick, shared by Sequence mode's
// plain-round rows and Multimode's per-column rows (redesigned to match
// each other, 6.10/6.23 - both used to be a shared dropdown + "Add" button
// instead, which had the same "+ Add duplicates what's already showing"
// bug fixed independently in both places before this was unified).
// `excluded` hides any candidate already claimed elsewhere in the same
// list, except the row's own current value - it must never disappear out
// from under itself. `onChange(newRoundId, newOptionText)` fires whenever
// the user picks something different.
function buildRoundSelect(candidates, excluded, currentRoundId, onChange) {
  const select = document.createElement("select");
  for (const entry of candidates) {
    if (excluded.has(entry.roundId) && entry.roundId !== currentRoundId) continue;
    const opt = document.createElement("option");
    opt.value = entry.roundId;
    opt.textContent = entryLabel(entry);
    select.appendChild(opt);
  }
  select.value = currentRoundId;
  select.addEventListener("change", () => {
    const opt = select.selectedOptions[0];
    if (!opt) return;
    onChange(opt.value, opt.textContent);
  });
  return select;
}

// Shared "×" remove button for one row in a live-editable list (Sequence
// mode and Multimode's column builder, 6.10/6.23).
function buildRemoveButton(ariaLabel, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "sequence-remove";
  btn.textContent = "×";
  btn.setAttribute("aria-label", ariaLabel);
  btn.addEventListener("click", onClick);
  return btn;
}

// Drag-and-drop reordering of the in-progress sequence on the setup screen
// (native HTML5 DnD - no library needed for a same-list reorder). A paired
// entry ("Verschränkt: A ↔ B") appears as a single row here, not as many
// near-duplicate entries - see 6.12 for why that redesign happened.
function usedInSequenceBuilder(excludeIndex = -1) {
  return usedIdsExcluding(sequenceBuilder, excludeIndex, (item) =>
    item.type === "paired" ? [item.aId, item.bId] : [item.roundId]
  );
}

// Every entry is its own live row now, not a static label added via a
// separate shared dropdown+button (6.10, redesigned to match Multimode's
// per-column sequence builder, 6.23, after the original shared-dropdown
// version turned out to have the exact same "+ Add" duplicates whatever's
// still showing" usability bug Multimode's first version had). A plain
// round gets one <select>; a paired entry (6.12) gets two, side by side,
// each excluding the other side's current value in addition to whatever's
// used elsewhere in the sequence. Drag-reorder is kept (unlike Multimode's
// per-column rows, which don't support it) - order matters here and
// always has.
function renderSequenceBuilder() {
  el.sequenceRow.hidden = currentMode !== "sequence";
  el.sequenceList.innerHTML = "";

  sequenceBuilder.forEach((item, index) => {
    const li = document.createElement("li");
    li.className = "sequence-item";
    li.draggable = true;

    if (item.type === "paired") {
      const pair = document.createElement("div");
      pair.className = "sequence-pair";
      const excluded = usedInSequenceBuilder(index);

      // Each side also excludes the OTHER side's current value, on top of
      // whatever `excluded` already rules out - the two sides of one paired
      // entry can never match each other.
      const buildSide = (idField, labelField, otherIdField) => {
        const sideExcluded = new Set(excluded);
        sideExcluded.add(item[otherIdField]);
        return buildRoundSelect(loadedEliminationEntries, sideExcluded, item[idField], (newId, newLabel) => {
          item[idField] = newId;
          item[labelField] = newLabel;
          renderSequenceBuilder();
        });
      };

      pair.appendChild(buildSide("aId", "aLabel", "bId"));
      const sep = document.createElement("span");
      sep.className = "sequence-pair-sep";
      sep.textContent = "↔";
      pair.appendChild(sep);
      pair.appendChild(buildSide("bId", "bLabel", "aId"));
      li.appendChild(pair);
    } else {
      const excluded = usedInSequenceBuilder(index);
      const select = buildRoundSelect(loadedEntries, excluded, item.roundId, (newId, newLabel) => {
        item.roundId = newId;
        item.label = newLabel;
        renderSequenceBuilder();
      });
      li.appendChild(select);
    }

    li.appendChild(
      buildRemoveButton("Remove from sequence", () => {
        sequenceBuilder.splice(index, 1);
        renderSequenceBuilder();
      })
    );

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

  const used = usedInSequenceBuilder();
  el.addRoundToSequence.disabled = !loadedEntries.some((e) => !used.has(e.roundId));
  el.addPairedToSequence.disabled = loadedEliminationEntries.filter((e) => !used.has(e.roundId)).length < 2;
}

// Rebuilds every Multimode config card from scratch (6.23) - one per
// `multiColumnDrafts` entry, each with its own round picker + "Add round"
// button + its own mini round-sequence list (no drag-reorder here, unlike
// the Sequence-mode builder - a column's rounds are added in the order
// they should play, and reordering wasn't asked for). A full rebuild on
// every change (count change, round added/removed) rather than a partial
// DOM patch - simpler, and this is a handful of small setup-screen
// elements, not the 3s-polled board.
// "Lead"/"Boulder"/"Speed" for one `entries[]` item - see the `isBoulder`
// comment in populateRounds() for why Lead is inferred by elimination
// rather than its own confirmed prefix.
function multiEntryDiscipline(entry) {
  return entry.isSpeed ? "Speed" : entry.isBoulder ? "Boulder" : "Lead";
}

// "Category — Round (status)" text for one loadedEntries/loadedEliminationEntries
// item - shared by every live <select> option list in this app (Multimode's
// per-column rows, 6.23, and Sequence mode's own rows below) so an
// auto-seeded pick (no <option> element involved yet) reads identically to
// one picked by hand via a dropdown.
function entryLabel(entry) {
  return `${entry.label} (${STATUS_LABEL[entry.status] ?? entry.status})`;
}

function renderMultiColumnsConfig(entries) {
  el.multiColumnsConfig.innerHTML = "";

  multiColumnDrafts.forEach((draft, columnIndex) => {
    // A column's own sequence has to stay one discipline throughout (its
    // rounds are meant to be "the same category, later stage" - Quali ->
    // Finale - not an arbitrary discipline switch mid-column), but
    // different COLUMNS are free to be different disciplines from each
    // other (6.24) - Multimode's whole point is showing several
    // categories side by side, and those don't have to match; one column
    // can be Boulder while another is Lead. `availableFor(excludeIndex)`
    // computes what a given row (or a brand-new row, for "+ Add Sequence" -
    // pass -1, which never matches a real index) may become: filtered to
    // whichever discipline every *other* item already in this column has
    // committed to (all of them share one, by construction - checking any
    // one of them is enough), or unfiltered if this would be the column's
    // only item, so a column's very first pick is free to be either
    // discipline.
    const availableFor = (excludeIndex) => {
      const other = draft.items.find((_, i) => i !== excludeIndex);
      const discipline = other ? other.discipline : null;
      return entries.filter((e) => !e.isSpeed && (!discipline || multiEntryDiscipline(e) === discipline));
    };

    const card = document.createElement("div");
    card.className = "multi-column-config";

    const heading = document.createElement("div");
    heading.className = "sequence-label";
    heading.textContent = `Column ${columnIndex + 1}`;
    card.appendChild(heading);

    // Every step of this column's sequence gets its own live dropdown, not
    // just the first one - each `<select>` IS that step's round, editable
    // with no confirm click, same "no click needed" idea the first step
    // already had, now applied to every step instead of just it. Fixes a
    // real usability bug in the one-shared-dropdown version: clicking
    // "+ Add Sequence" without first changing the dropdown just appended a
    // duplicate of the step already there, since the button had no way to
    // know the user meant to pick something different. Each row's options
    // exclude whatever round every *other* row in this same column is
    // already using (but always include its own current value) - a round
    // can't be picked twice in one column's sequence, prevented by not
    // offering it rather than validating after the fact, same philosophy
    // as the Speed/discipline filtering above.
    const usedInThisColumn = (itemIndex) => usedIdsExcluding(draft.items, itemIndex, (item) => [item.roundId]);

    const list = document.createElement("ol");
    list.className = "sequence-list";

    draft.items.forEach((item, itemIndex) => {
      const li = document.createElement("li");
      li.className = "sequence-item sequence-item--static";

      const excluded = usedInThisColumn(itemIndex);
      const rowSelect = buildRoundSelect(availableFor(itemIndex), excluded, item.roundId, (newId) => {
        const entry = entries.find((e) => e.roundId === newId);
        draft.items[itemIndex] = { roundId: newId, discipline: multiEntryDiscipline(entry) };
        renderMultiColumnsConfig(entries);
      });
      li.appendChild(rowSelect);

      li.appendChild(
        buildRemoveButton("Remove from column", () => {
          draft.items.splice(itemIndex, 1);
          renderMultiColumnsConfig(entries);
        })
      );

      list.appendChild(li);
    });
    card.appendChild(list);

    // Appends a new step, pre-filled with the first round *not already
    // used in this column* - never defaults to a duplicate, unlike the
    // single-shared-dropdown version this replaced. Disabled once every
    // available round for this column's locked discipline is already
    // in its sequence (rare, but silently doing nothing on click would
    // read as a broken button - the same lesson learned from Multimode's
    // very first "Show Multimode" bug).
    const unusedForThisColumn = availableFor(-1).filter((e) => !draft.items.some((item) => item.roundId === e.roundId));
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "ghost";
    addBtn.textContent = "+ Add Sequence";
    addBtn.disabled = unusedForThisColumn.length === 0;
    addBtn.addEventListener("click", () => {
      if (!unusedForThisColumn.length) return;
      const entry = unusedForThisColumn[0];
      draft.items.push({ roundId: entry.roundId, discipline: multiEntryDiscipline(entry) });
      renderMultiColumnsConfig(entries);
    });
    card.appendChild(addBtn);

    el.multiColumnsConfig.appendChild(card);
  });
}

function startWatching(selection) {
  clearInterval(pollTimer);
  clearInterval(trainingPollTimer);
  currentSelection = selection;
  saveSelection(selection);
  updateHostLabel(selection.host);
  el.setup.hidden = true;
  el.pairedBar.hidden = true;
  el.trainingControls.hidden = true;
  el.controlShareRow.hidden = true;
  el.nextInSequence.hidden = true; // re-shown by updateNextInSequence() once pollCurrent() settles, watch mode only - training has no sequence concept

  if (selection.kind === "training") {
    el.board.hidden = !!selection.control;
    el.controller.hidden = !selection.control;
    startTrainingSession(selection);
    return;
  }

  if (selection.kind === "multi") {
    el.board.hidden = false;
    el.controller.hidden = true;
    lastMultiResults = null;
    setShareLink(buildShareLink(selection));
    pollMulti();
    pollTimer = setInterval(pollMulti, 3000);
    return;
  }

  el.board.hidden = false;
  el.controller.hidden = true;
  sequenceIndex = 0;
  pairedState = null;
  lastRoundData = null;
  setShareLink(buildShareLink(selection));
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

// Reported live: on an iPad running in Safari Private Browsing, the wake
// lock silently stops holding the screen awake after about 10 minutes even
// though the tab stays visible and fullscreen the whole time - Private
// Browsing is known to apply stricter background/power policies than a
// normal tab, so the browser can revoke the lock on its own without ever
// backgrounding the tab (which is the only case the visibilitychange
// listener below covers). The spec-correct way to catch that is the
// sentinel's own "release" event, which fires whenever the lock is let go
// for ANY reason, not just an explicit release() call - listen for it and
// try to re-acquire immediately. This is best-effort: if the browser keeps
// revoking it (e.g. a hard policy in Private Browsing that a page can't
// override), each release just triggers one more retry rather than an
// infinite tight loop, since the event only fires once per acquisition.
async function requestWakeLock() {
  try {
    wakeLockSentinel = (await navigator.wakeLock?.request("screen")) ?? null;
    wakeLockSentinel?.addEventListener("release", () => {
      wakeLockSentinel = null;
      if (document.visibilityState === "visible" && document.fullscreenElement) requestWakeLock();
    });
  } catch (err) {
    console.warn("Wake lock request failed:", err);
  }
}

async function enterKioskMode() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
  } catch (err) {
    console.warn("Fullscreen request failed:", err);
  }
  await requestWakeLock();
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
  const fullscreen = !!document.fullscreenElement;
  // The "link for this tablet" row is only useful for setting a bookmark up
  // in the first place - once mounted and running in kiosk mode, it's just
  // clutter (and a copy-able URL, now with a scannable QR code too - 6.18)
  // on an otherwise clean wall display.
  el.shareRow.hidden = fullscreen;
  // "Switch round" is only needed to leave the current round/sequence
  // entirely - rarely done mid-event, and always reachable by exiting
  // fullscreen first. Unlike the group/route tabs and the Boulder-format
  // toggle (deliberately left visible - see 6.22), it's not something
  // someone would want to tap without leaving kiosk mode anyway, so it's
  // just clutter on the wall display like the share-link row above.
  el.backBtn.hidden = fullscreen;
  // The Training "link to control from another device" row (6.11) is more
  // than clutter if left up in fullscreen - reported live: whoever's near
  // a wall-mounted, unattended tablet could scan its QR code and take over
  // advancing the training session, with no login required by design. Hide
  // it in fullscreen the same way; only restore it on exit if this tablet
  // is genuinely the training wall-display side (`kind === "training" &&
  // !control`) - it must stay hidden everywhere else (every non-training
  // context, and the controller's OWN view), not just during fullscreen.
  if (fullscreen) {
    el.controlShareRow.hidden = true;
  } else if (currentSelection?.kind === "training" && !currentSelection?.control) {
    el.controlShareRow.hidden = false;
  }
  if (!fullscreen) {
    wakeLockSentinel?.release?.();
    wakeLockSentinel = null;
    el.kioskBtn.textContent = "Fullscreen + Always On";
  }
});

// The wake lock is released by the browser whenever the tab is backgrounded
// (spec-mandated) - re-acquire it once the tablet's screen comes back. The
// sentinel's own "release" listener (requestWakeLock() above) covers the
// silent-drop-while-visible case; this one covers the backgrounded case,
// where the sentinel was already released before the tab became visible
// again, so there's no live sentinel left to have fired that event on.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && document.fullscreenElement && !wakeLockSentinel) {
    requestWakeLock();
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

async function getRoundLabel(host, roundId) {
  const cacheKey = `${host}:${roundId}`;
  if (roundLabelCache.has(cacheKey)) return roundLabelCache.get(cacheKey);
  try {
    const data = await fetchRoundJson(host, roundId);
    const label = `${data.category ?? ""} — ${data.round ?? ""}`.trim();
    roundLabelCache.set(cacheKey, label);
    return label;
  } catch {
    return null; // shown as "…" below rather than blocking the whole strip
  }
}

// The "next up" strip below the lanes (6.10) - only meaningful in Sequence
// mode with more than one entry, and only once the CURRENT entry is known
// (sequenceIndex has settled - see the two call sites in pollCurrent()).
// Deliberately a one-off lookup, not part of the 3s poll payload: the next
// entry's category/round name doesn't change while it's waiting its turn,
// so re-fetching it every tick would be pure waste.
async function updateNextInSequence() {
  const seq = currentSelection?.sequence;
  if (!seq || seq.length <= 1 || sequenceIndex >= seq.length - 1) {
    el.nextInSequence.hidden = true;
    return;
  }
  const myToken = pollToken;
  const next = seq[sequenceIndex + 1];
  const host = currentSelection.host;
  const label =
    next.type === "paired"
      ? (await Promise.all([getRoundLabel(host, next.a), getRoundLabel(host, next.b)])).map((l) => l ?? "…").join(" ↔ ")
      : (await getRoundLabel(host, next.id)) ?? "…";
  if (myToken !== pollToken) return; // superseded while fetching labels
  el.nextInSequence.hidden = false;
  el.nextInSequence.innerHTML = "";
  el.nextInSequence.appendChild(document.createTextNode("Next up: "));
  const strong = document.createElement("strong");
  strong.textContent = label;
  el.nextInSequence.appendChild(strong);
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
      updateNextInSequence();
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
    updateNextInSequence();
    return;
  }
}

// Multimode (6.23): the same catch-up-through-already-finished-entries loop
// as pollCurrent() above, but scoped to one column's own sequence/index -
// run in parallel across all columns by pollMulti() below, so one column
// advancing has no effect on the others' timing. No paired-entry handling
// needed (Multimode is Lead/Boulder only, "paired" is Speed-only, 6.12).
// Catches its own fetch errors and returns an error marker instead of
// throwing, so one broken/deleted round doesn't blank the whole board.
async function pollOneMultiColumn(entry, token) {
  // A column left without any round configured (6.23 - a tablet can be set
  // up ahead of time with more columns than currently-known categories) has
  // nothing to fetch - render it the same "Round finished" placeholder an
  // actually-finished round gets, rather than blocking Multimode setup on
  // every column being filled in.
  if (!entry.sequence.length) return { empty: true };
  for (;;) {
    if (token !== pollToken) return null;
    const current = entry.sequence[entry.sequenceIndex];
    let round;
    try {
      round = await fetchRoundJson(currentSelection.host, current.id);
    } catch (err) {
      return { error: err.message };
    }
    if (token !== pollToken) return null;
    const hasNext = entry.sequenceIndex < entry.sequence.length - 1;
    if (hasNext && isRoundFullyFinished(round)) {
      entry.sequenceIndex++;
      continue;
    }
    return { round };
  }
}

// Polls every Multimode column in parallel and renders them together in one
// pass (not as each column's fetch resolves) so columns with different
// response times don't visibly pop in one at a time on every tick.
async function pollMulti() {
  const myToken = ++pollToken;
  const results = await Promise.all(currentSelection.entries.map((entry) => pollOneMultiColumn(entry, myToken)));
  if (myToken !== pollToken) return; // superseded mid-flight
  if (results.some((r) => r === null)) return; // a column bailed for the same reason
  lastMultiResults = results;
  renderMultiBoard(currentSelection.entries, results);
  // Only configured (non-empty) columns actually fetch anything - if every
  // one of them came back with an error this tick, results.info itself is
  // unreachable, not just one bad round, so the shared status line should
  // say so the same way every other poll path does (pollRound/pollCurrent/
  // the paired poll). Previously this always showed "Updated ...", so a
  // real outage read as healthy unless you separately noticed each
  // column's own "Couldn't load: ..." text.
  const configured = results.filter((r) => !r.empty);
  if (configured.length && configured.every((r) => r.error)) {
    el.statusLine.textContent = `Connection lost: ${configured[0].error}`;
    el.statusLine.classList.add("stale");
  } else {
    el.statusLine.textContent = `Updated ${new Date().toLocaleTimeString("en-GB")}`;
    el.statusLine.classList.remove("stale");
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
// `pairedState.activeSide` (which of the two co-equal sides to display)
// still needs to persist across ticks - there's no data signal for "whose
// turn it is", so that has to be remembered.
async function pollPairedTick(entry, token) {
  if (!pairedState || pairedState.entryIndex !== sequenceIndex) {
    pairedState = {
      entryIndex: sequenceIndex,
      activeSide: "a",
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

  // No automatic stuck-heat watchdog here (deliberately removed - see
  // ARCHITECTURE.md 6.12): a heat can have a "current" (not-yet-confirmed)
  // athlete forever if the live-scoring source never posts a final result
  // for one lane, and the logic above never hands the turn back on its own
  // in that case. That's intentionally left to staff via the manual
  // "Switch category now" button (renderPairedBar()) instead of an
  // automatic timeout - requested explicitly so the display never switches
  // categories without either a genuine stage completion or a human
  // choosing to.

  const sideData = side === "a" ? dataA : dataB;
  const otherData = side === "a" ? dataB : dataA;
  lastRoundData = sideData;
  renderPairedBoard(sideData, sideResult);
  renderPairedBar(otherData, side);
  el.statusLine.textContent = `Updated ${new Date().toLocaleTimeString("en-GB")}`;
  el.statusLine.classList.remove("stale");
  return { ok: true, bothDone: false };
}

// The manual "Switch category now" button is the ONLY way to move past a
// stuck heat (6.12) - there is no automatic timeout (deliberately removed,
// see pollPairedTick() above): the display only ever switches categories
// on a genuine stage completion or a human choosing to.
function renderPairedBar(otherData, activeSide) {
  el.pairedBar.hidden = false;
  const otherLabel = `${otherData.category ?? ""} — ${otherData.round ?? ""}`.trim();
  el.pairedLabel.textContent = `Interleaved with: ${otherLabel}`;
  el.pairedSwitchBtn.onclick = () => {
    if (!pairedState) return;
    pairedState.activeSide = activeSide === "a" ? "b" : "a";
    pairedState.manualPin = true;
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
  // An "active" entry normally wins outright (see the big comment above),
  // but NOT if it sits behind an already-confirmed frontier - that only
  // happens when someone re-opens/edits an earlier, already-passed result
  // (e.g. a score correction), which briefly sets it back to "active" again.
  // Without the Math.max() here, that edit would yank the display backward
  // to the athlete being corrected, even though real progress (later
  // confirmed entries) has already moved well past them. Reported live:
  // Route 2 appeared to "hang" on an earlier athlete after their result was
  // edited post-confirmation, while athletes after them were already
  // confirmed. If nothing further along is confirmed yet, lastConfirmed + 1
  // is 0 or otherwise behind lastActive, so this still resolves to the
  // active entry as before - this only changes behavior for the
  // edited-after-the-fact case.
  return Math.max(lastActive, lastConfirmed + 1);
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

// Boulder qualification (and some final formats) rotate athletes through
// several boulders in a staggered pipeline: everyone visits boulder 1, then
// 2, then 3, ... but offset in time, so a later boulder can go completely
// untouched for a while even after the round itself is already "active"
// (an earlier boulder already has real progress). computeLane()'s
// round.status === "pending" guard can't catch this - by the time boulder
// 2 is still empty, the round as a whole is already well past "pending".
// Without a per-route guard, computeLane() would show whoever is first in
// THAT boulder's own queue (route_start_positions) as already "climbing"
// there, days/intervals before they actually arrive - reproduced live with
// mocked data: two different boulders both showing the same athlete as
// "climbing" simultaneously, and boulders nobody had touched yet all
// showing a (wrong) current climber.
//
// Fix, scoped to Boulder only (checked here, not inside computeLane()
// itself, so Lead/Speed-qualification rounds - which share the exact same
// computeLane() - are provably unaffected): a route only participates in
// the normal active/confirmed inference once SOMEONE on it has actually
// gone active or been confirmed; before that, it gets the same "not
// started yet" shape computeLane() already gives a whole not-started
// round. This also naturally covers round.status === "pending" as a
// special case (if the round hasn't started, nobody's started any route
// either), so there's no separate check needed for that.
// A not-yet-reached boulder's candidate (its own first-in-queue athlete)
// isn't "ready" to show as NEXT just because they're personally done with
// every route that comes before this one in their own rotation - reported
// live (World Series-style finals, gap = boulder count): that athlete can
// still be several intervals away because OTHER athletes are still working
// through the boulder's shared capacity before it opens. Confirmed against
// real route_start_positions data (fixtures 13712, 13735, 13711/13709 in
// AGENTS.md §3) that position values are a literal shared "heat slot"
// number - not a per-route-independent rank - WITHIN one route group: the
// same position value can appear on two different routes in the same
// group for two different athletes, meaning those two ascents genuinely
// happen at the same moment (e.g. one athlete finishing route N while
// another starts route N+1). This lets readiness be computed generically
// from real recorded progress instead of the athlete's own routes alone:
// a candidate is ready once the group's furthest-progressed position
// (the highest position with a real active/confirmed ascent, anywhere in
// the SAME group) reaches one below their own position here.
//
// Scoped to the route's own group (via collectRouteGroups(), 6.6) rather
// than the whole round - confirmed against real data (fixture 13709,
// starting_groups) that Group A and Group B each have their OWN
// independent position numbering starting at 1, not a shared round-wide
// clock. A round-wide frontier would let a faster-judged group's high
// position values falsely mark a slower group's candidate "ready" early.
function boulderGroupFrontier(round, route) {
  const groups = collectRouteGroups(round);
  const group = groups.find((g) => g.routes.some((r) => r.id === route.id));
  const groupRouteIds = new Set((group?.routes ?? round.routes ?? [route]).map((r) => r.id));
  let frontier = 0;
  for (const entry of round.ranking ?? []) {
    for (const ascent of entry.ascents ?? []) {
      if (!groupRouteIds.has(ascent.route_id)) continue;
      if (ascent.status !== "active" && !DONE_STATUSES.has(ascent.status)) continue;
      const pos = round.startlist
        ?.find((a) => a.athlete_id === entry.athlete_id)
        ?.route_start_positions?.find((p) => p.route_id === ascent.route_id)?.position;
      if (pos != null && pos > frontier) frontier = pos;
    }
  }
  return frontier;
}

function computeBoulderLane(round, route, finalMode) {
  const ordered = orderedAthletesForRoute(round, route);
  const statusByAthlete = new Map();
  for (const entry of round.ranking ?? []) {
    const ascent = entry.ascents?.find((a) => a.route_id === route.id);
    if (ascent) statusByAthlete.set(entry.athlete_id, ascent.status);
  }
  const routeHasStarted = ordered.some((a) => {
    const status = statusByAthlete.get(a.athlete_id);
    return status === "active" || DONE_STATUSES.has(status);
  });
  if (!routeHasStarted) {
    // CLIMBING stays blank - showing the eventual first-in-queue athlete
    // as already "climbing" reads as imminent when they can genuinely be
    // several rotations away (reported live: the last boulder of a
    // 5-boulder round showed its very first occupant from the moment the
    // round opened). NEXT, though, should populate one rotation early -
    // once the group's real progress (boulderGroupFrontier(), above) has
    // reached one position before this candidate's own position here -
    // rather than jumping straight from "just a name in the waiting list"
    // to "CLIMBING" with no NEXT step in between (also reported live).
    const candidate = ordered[0] ?? null;
    let herePos = null;
    if (candidate) {
      herePos = round.startlist
        ?.find((a) => a.athlete_id === candidate.athlete_id)
        ?.route_start_positions?.find((p) => p.route_id === route.id)?.position ?? null;
    }
    // distance: how many heats away the candidate genuinely is, derived
    // from the group's real recorded progress - 0 means ready right now.
    const distance = herePos != null ? Math.max(0, herePos - boulderGroupFrontier(round, route) - 1) : Infinity;
    const candidateIsReady = distance === 0;

    // World Series-style finals (6.17): at most 2 boulders are ever
    // genuinely live, so a not-yet-reached boulder's candidate can be MANY
    // heats away, not just one - showing them at the front of the queue
    // regardless misrepresents how far off they really are. Reported live
    // off a real event (round 13833): a candidate still 3 heats out from
    // Boulder 4 was shown right at the top of its queue, when their real
    // wait is still driven entirely by Boulder 3's own remaining progress.
    // This mode inserts blank placeholder slots so the candidate visibly
    // occupies their real distance from the front and slides one slot
    // closer every heat, only surfacing once genuinely close - opt-in via
    // the Boulder-finals-only mode toggle (6.17), because Qualification and
    // the default "Intervall" final reading are correct as-is and must stay
    // untouched (verified live: distance 1 already renders identically to
    // the "interval" branch below, so this mode never changes anything
    // until a candidate is genuinely more than one heat out).
    if (finalMode === "world_series") {
      const padding = candidateIsReady ? 0 : Math.max(0, distance - 1);
      const queue = [...Array(Math.min(padding, 6)).fill(null), ...ordered.slice(candidateIsReady ? 1 : 0, 7)].slice(
        0,
        6
      );
      return {
        routeName: route.name,
        finished: false,
        atWall: null,
        onDeck: candidateIsReady ? candidate : null,
        queue,
      };
    }

    return {
      routeName: route.name,
      finished: false,
      atWall: null,
      onDeck: candidateIsReady ? candidate : null,
      queue: candidateIsReady ? ordered.slice(1, 7) : ordered.slice(0, 6),
    };
  }

  // The route has real activity now, but deliberately does NOT fall
  // through to computeLane() from here on (unlike the not-yet-started
  // branch above, which does) - Boulder needs a different frontier rule
  // for this part: confirmed live against real, currently-being-judged
  // results.info data (event 1593, round 13840) that a Boulder athlete's
  // ascent goes STRAIGHT from "pending" to "confirmed" the moment the
  // judge saves - there is no "active" in-between state until the NEXT
  // athlete's judge screen actually starts recording a try (a real try
  // counter increment flips their ascent to "active" with an updated
  // timestamp - confirmed live, this genuinely happens, it's just not
  // triggered by merely navigating to their screen). computeLane()'s rule
  // ("last confirmed + 1" - see 5.2) ASSUMES the next athlete is already
  // climbing the instant the previous one is confirmed, which is exactly
  // the gap in between: for however long the next athlete hasn't started a
  // try yet (could be seconds in a real competition, could be much longer
  // if judging pauses), computeLane() would show them as "CLIMBING" before
  // they've done anything at all. Reported live: prefer showing the LAST
  // CONFIRMED athlete as still current until the NEXT one goes "active" -
  // "NEXT" already correctly names who that will be, one position ahead.
  let lastActive = -1;
  let lastConfirmed = -1;
  ordered.forEach((a, i) => {
    const status = statusByAthlete.get(a.athlete_id);
    if (status === "active") lastActive = i;
    if (DONE_STATUSES.has(status)) lastConfirmed = i;
  });
  // Same post-hoc-edit protection as findCurrentIndex() (5.2) - an
  // "active" entry behind the confirmed frontier (a judge reopening an
  // earlier score to correct it) must not pull the display backward.
  const effectiveActive = lastActive > lastConfirmed ? lastActive : -1;
  let currentIndex;
  if (effectiveActive !== -1) {
    currentIndex = effectiveActive;
  } else if (lastConfirmed === ordered.length - 1) {
    currentIndex = ordered.length; // nobody left after the last confirmed athlete - genuinely finished
  } else {
    currentIndex = lastConfirmed; // stick here until the next athlete actually goes active
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

// Boulder's "2 Courses" format (e.g. format_identifier
// "boulder_one_group_ifsc_2026_two_courses") has no `starting_groups` at
// all - the course split lives entirely in route NAMING ("A1"/"A2"/"A3"/
// "B1"/"B2"). Detected structurally (every route name is a letter prefix
// plus digits, at least two distinct prefixes) rather than hardcoded to
// that one format_identifier, so a future "3 courses" variant using the
// same naming convention picks this up automatically too. Returns null
// (defer to the ungrouped fallback) if the names don't actually follow
// this convention - e.g. plain "1".."5" boulder names have no letter
// prefix at all and correctly fall through untouched.
function groupRoutesByCoursePrefix(routes) {
  const parsed = routes.map((r) => {
    const m = /^([A-Za-z]+)\d+$/.exec(r.name);
    return m ? { route: r, prefix: m[1].toUpperCase() } : null;
  });
  if (parsed.some((p) => p === null)) return null;
  const prefixes = [...new Set(parsed.map((p) => p.prefix))].sort();
  if (prefixes.length < 2) return null;
  return prefixes.map((prefix) => ({
    groupName: `Course ${prefix}`,
    routes: parsed.filter((p) => p.prefix === prefix).map((p) => p.route),
  }));
}

// Most rounds list their routes directly on `round.routes`. Boulder rounds
// split into starting groups (e.g. "Group A" / "Group B" climbing separate
// boulders in parallel) instead nest the routes under `round.starting_groups`
// and have no top-level `routes` at all - group them here so the rest of the
// rendering code doesn't need to care which shape it got. The course-prefix
// check is scoped to `discipline === "Boulder"` specifically - Lead and
// Speed qualification share this same function and must stay byte-for-byte
// unaffected (frozen: "fertig, dürfen nicht mehr verändert werden"), even
// though neither has ever been observed using letter-prefixed route names.
function collectRouteGroups(round) {
  if (round.routes?.length) {
    if (round.discipline === "Boulder") {
      const courseGroups = groupRoutesByCoursePrefix(round.routes);
      if (courseGroups) return courseGroups;
    }
    return [{ groupName: null, routes: round.routes }];
  }
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
      // A `null` entry is a World Series-mode padding slot (6.17) - not yet
      // a real athlete, so it renders the same blank dash a card would.
      li.textContent = athleteLine(athlete) || "—";
      list.appendChild(li);
    }
    laneEl.appendChild(list);
  }
}

// Lane heading prefix by discipline - "Boulder 1"/"Boulder 2" reads better
// than "Route 1" for Boulder specifically (where "route" isn't the term
// climbers/judges actually use), while Lead keeps "Route" and Speed keeps
// "Lane". Shared by every place that builds a lane/route heading so the
// three stay in sync.
function laneLabelPrefixFor(round) {
  if (round.discipline === "Speed") return "Lane";
  if (round.discipline === "Boulder") return "Boulder";
  return "Route";
}

function buildLane(round, route, laneLabelPrefix, boulderFinalMode) {
  // Discipline check, not a format_identifier check - deliberately covers
  // every Boulder round shape (qualification, two-group, and any future
  // final format that reuses the same routes/starting_groups shape), while
  // strictly excluding Lead and Speed qualification, which must keep using
  // computeLane() unchanged - see computeBoulderLane()'s comment above.
  const lane =
    round.discipline === "Boulder" ? computeBoulderLane(round, route, boulderFinalMode) : computeLane(round, route);
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
  // A round that hasn't started at all yet (round.status === "pending") must
  // not anchor the shared stage cursor - e.g. a smaller category's final
  // round sitting at "pending" while it waits for its own semifinal to
  // resolve. Without this check, a pre-generated stage skeleton (heats
  // present with athletes: [] because the field isn't seeded yet) would
  // still report its first stage's name here, and lockstep comparison
  // would then make BOTH sides wait on that not-actually-progressing side
  // instead of automatically showing whichever side genuinely has
  // something to display right now. Returning null here defers entirely to
  // the other side's real stage, the same way an empty stages array already
  // does below.
  if (round.status === "pending") return null;
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

// `container`/`sel` are parameterized (6.23) so this can render into either
// the single singleton `el.groupTabs`/`currentSelection` (watch mode) or a
// dynamically-created per-column container/entry (Multimode) - behavior is
// otherwise identical.
function renderGroupTabs(groupNames, container, sel, onSelect) {
  container.innerHTML = "";
  if (groupNames.length < 2) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  for (const name of groupNames) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `group-tab${name === sel.group ? " active" : ""}`;
    btn.textContent = name;
    btn.addEventListener("click", () => {
      if (sel.group === name) return;
      sel.group = name;
      // A route selected in the old group may not exist (or may mean
      // something different) in the new one - back out to "all routes".
      sel.route = null;
      saveSelection(currentSelection);
      setShareLink(buildShareLink(currentSelection));
      onSelect();
    });
    container.appendChild(btn);
  }
}

// Returns just the routes selected via the route tabs, or all of `routes`
// if nothing (valid) is selected - shared by renderBoard(),
// renderTrainingBoard() and renderMultiBoard() (6.22/6.23). `routeNames`
// scopes the check to the round/group currently being rendered, so a
// selection left over from a different round/group (different route names)
// safely falls back to "all" instead of silently filtering everything out.
// `sel` holds `.route` - `currentSelection` for watch/training, or one
// Multimode column entry.
function filterRoutesBySelection(routes, routeNames, sel) {
  const selected = (sel.route ?? []).filter((name) => routeNames.includes(name));
  return selected.length ? routes.filter((r) => selected.includes(r.name)) : routes;
}

// Dedicates this tablet to one or several routes/boulders instead of the
// full lanes grid (6.22) - e.g. one tablet per boulder, or one tablet
// covering two boulders when there aren't enough tablets for one each.
// `sel.route` is `null` ("all") or an array of route names, each toggled
// independently by tapping its tab - tapping "All routes" clears the
// selection outright. `routeNames` is whatever the currently visible
// group/round actually has, so switching group or round can't leave a
// stale selection on screen; `onSelect` re-renders whichever board is
// currently active (watch/training/Multimode all use different render
// functions/state); `prefix` is "Route"/"Lane"/"Boulder"
// (laneLabelPrefixFor()) so the tabs read the same as the lane headings
// they filter. `container`/`sel` parameterized for the same reason as
// renderGroupTabs() above (6.23).
function renderRouteTabs(routeNames, prefix, container, sel, onSelect) {
  container.innerHTML = "";
  if (routeNames.length < 2) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  const selected = (sel.route ?? []).filter((name) => routeNames.includes(name));

  const allBtn = document.createElement("button");
  allBtn.type = "button";
  allBtn.className = `group-tab${selected.length ? "" : " active"}`;
  allBtn.textContent = `All ${prefix.toLowerCase()}s`;
  allBtn.addEventListener("click", () => {
    if (!selected.length) return;
    sel.route = null;
    saveSelection(currentSelection);
    setShareLink(buildShareLink(currentSelection));
    onSelect();
  });
  container.appendChild(allBtn);

  for (const name of routeNames) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `group-tab${selected.includes(name) ? " active" : ""}`;
    btn.textContent = `${prefix} ${name}`;
    btn.addEventListener("click", () => {
      const next = selected.includes(name) ? selected.filter((n) => n !== name) : [...selected, name];
      sel.route = next.length ? next : null;
      saveSelection(currentSelection);
      setShareLink(buildShareLink(currentSelection));
      onSelect();
    });
    container.appendChild(btn);
  }
}

// Only Boulder final rounds get the World Series/Intervall toggle (6.17) -
// checked via format_identifier's "boulder_finals" prefix (both known final
// identifiers share it), not just discipline, so Qualification rounds never
// show it and stay on the single, already-verified "interval" reading.
function isBoulderFinalRound(round) {
  return round.discipline === "Boulder" && (round.format_identifier ?? "").startsWith("boulder_finals");
}

// `container` parameterized (6.23) same as renderGroupTabs()/renderRouteTabs()
// above - no `sel` needed here, the toggle is purely `localStorage`-based by
// `round.id` (6.17), already scoped to the right round regardless of mode.
function renderBoulderModeToggle(roundId, activeMode, container, onSelect) {
  container.innerHTML = "";
  container.hidden = false;
  const label = document.createElement("span");
  label.className = "share-label";
  label.textContent = "Boulder final format:";
  container.appendChild(label);
  const options = [
    { value: "interval", text: "Intervall" },
    { value: "world_series", text: "World Series" },
  ];
  for (const opt of options) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `group-tab${opt.value === activeMode ? " active" : ""}`;
    btn.textContent = opt.text;
    btn.addEventListener("click", () => {
      if (opt.value === activeMode) return;
      saveBoulderFinalMode(roundId, opt.value);
      onSelect();
    });
    container.appendChild(btn);
  }
}

function renderBoard(round) {
  el.roundTitle.textContent = `${round.category ?? ""} — ${round.round ?? ""} (${round.discipline ?? ""})`.trim();
  el.lanes.innerHTML = "";
  el.groupTabs.hidden = true; // only the multi-group branch below re-shows it
  el.routeTabs.hidden = true; // only the per-group branch below re-shows it
  el.boulderModeRow.hidden = true; // only the Boulder-final branch below re-shows it

  if (round.speed_elimination_stages?.length) {
    renderSpeedElimination(round);
    return;
  }

  const laneLabelPrefix = laneLabelPrefixFor(round);
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
    renderGroupTabs(groupNames, el.groupTabs, currentSelection, () => {
      if (lastRoundData) renderBoard(lastRoundData);
    });
  }

  let boulderFinalMode = "interval";
  if (isBoulderFinalRound(round)) {
    boulderFinalMode = loadBoulderFinalMode(round.id);
    renderBoulderModeToggle(round.id, boulderFinalMode, el.boulderModeRow, () => {
      if (lastRoundData) renderBoard(lastRoundData);
    });
  }

  for (const group of routeGroups) {
    if (groupNames.length >= 2 && group.groupName !== currentSelection.group) continue;

    const routeNames = group.routes.map((r) => r.name);
    renderRouteTabs(routeNames, laneLabelPrefix, el.routeTabs, currentSelection, () => {
      if (lastRoundData) renderBoard(lastRoundData);
    });
    const routesToShow = filterRoutesBySelection(group.routes, routeNames, currentSelection);

    const grid = document.createElement("div");
    grid.className = routesToShow.length === 1 ? "lanes-grid lanes-grid--single" : "lanes-grid";
    for (const route of routesToShow) {
      grid.appendChild(buildLane(round, route, laneLabelPrefix, boulderFinalMode));
    }
    el.lanes.appendChild(grid);
  }
}

// Multimode (6.23): one `.multi-block` per column, each independently
// group-/route-filterable via its own dynamically-created tabs/toggle
// (using the same containerized renderGroupTabs()/renderRouteTabs()/
// renderBoulderModeToggle()/filterRoutesBySelection() renderBoard() uses,
// just with `entries[i]` instead of `currentSelection` as the `sel` and a
// per-block container instead of the singleton `el.groupTabs`/`el.routeTabs`/
// `el.boulderModeRow`). `results[i]` is either `{ round }` or `{ error }` -
// see pollOneMultiColumn() - a column that failed to load gets its own
// small error message instead of blanking the whole board.
function renderMultiBoard(entries, results) {
  el.roundTitle.textContent = "Multimode";
  el.lanes.innerHTML = "";
  el.groupTabs.hidden = true;
  el.routeTabs.hidden = true;
  el.boulderModeRow.hidden = true;

  // All columns side by side, wrapping onto further rows only once the
  // screen is too narrow to fit them - the whole point of Multimode is
  // seeing every category at once on a big enough display (6.23). Each
  // column keeps its own internal .lanes-grid for its lane cards, so a
  // narrow column still wraps its own boulders/routes sanely.
  const columnsGrid = document.createElement("div");
  columnsGrid.className = "multi-columns";
  el.lanes.appendChild(columnsGrid);

  entries.forEach((entry, i) => {
    const result = results[i];
    const block = document.createElement("section");
    block.className = "multi-block";
    columnsGrid.appendChild(block);

    if (result.error) {
      const heading = document.createElement("div");
      heading.className = "group-heading";
      heading.textContent = "Column " + (i + 1);
      block.appendChild(heading);
      const err = document.createElement("div");
      err.className = "lane-finished";
      err.textContent = `Couldn't load: ${result.error}`;
      block.appendChild(err);
      return;
    }

    if (result.empty) {
      const heading = document.createElement("div");
      heading.className = "group-heading";
      heading.textContent = "Column " + (i + 1);
      block.appendChild(heading);
      const placeholder = document.createElement("div");
      placeholder.className = "lane-finished";
      placeholder.textContent = "Round finished";
      block.appendChild(placeholder);
      return;
    }

    const round = result.round;
    const heading = document.createElement("div");
    heading.className = "group-heading";
    heading.textContent = `${round.category ?? ""} — ${round.round ?? ""} (${round.discipline ?? ""})`.trim();
    block.appendChild(heading);

    // Starts hidden, same as the singleton el.groupTabs does in renderBoard()
    // - renderGroupTabs() only re-shows it for rounds with 2+ starting
    // groups, so a round without groups needs this default or the empty
    // container is left visible (and still takes up its CSS margin) with
    // no content and no way to hide itself.
    const groupTabsEl = document.createElement("div");
    groupTabsEl.className = "group-tabs";
    groupTabsEl.hidden = true;
    block.appendChild(groupTabsEl);

    // Starts hidden too, same reasoning as groupTabsEl above - a round with
    // no route data (routeGroups.length === 0 below) returns before ever
    // calling renderRouteTabs(), which is what would otherwise clear this.
    const routeTabsEl = document.createElement("div");
    routeTabsEl.className = "group-tabs";
    routeTabsEl.hidden = true;
    block.appendChild(routeTabsEl);

    const modeRowEl = document.createElement("div");
    modeRowEl.className = "share-row";
    modeRowEl.hidden = true;
    block.appendChild(modeRowEl);

    const rerender = () => {
      if (lastMultiResults) renderMultiBoard(entries, lastMultiResults);
    };

    const laneLabelPrefix = laneLabelPrefixFor(round);
    const routeGroups = collectRouteGroups(round);

    if (!routeGroups.length) {
      const empty = document.createElement("div");
      empty.className = "lane-finished";
      empty.textContent = "No route data for this round.";
      block.appendChild(empty);
      return;
    }

    const groupNames = routeGroups.map((g) => g.groupName).filter(Boolean);
    if (groupNames.length >= 2) {
      if (!entry.group || !groupNames.includes(entry.group)) entry.group = groupNames[0];
      renderGroupTabs(groupNames, groupTabsEl, entry, rerender);
    }

    let boulderFinalMode = "interval";
    if (isBoulderFinalRound(round)) {
      boulderFinalMode = loadBoulderFinalMode(round.id);
      renderBoulderModeToggle(round.id, boulderFinalMode, modeRowEl, rerender);
    }

    for (const group of routeGroups) {
      if (groupNames.length >= 2 && group.groupName !== entry.group) continue;

      const routeNames = group.routes.map((r) => r.name);
      renderRouteTabs(routeNames, laneLabelPrefix, routeTabsEl, entry, rerender);
      const routesToShow = filterRoutesBySelection(group.routes, routeNames, entry);

      const grid = document.createElement("div");
      grid.className = routesToShow.length === 1 ? "lanes-grid lanes-grid--single" : "lanes-grid";
      for (const route of routesToShow) {
        grid.appendChild(buildLane(round, route, laneLabelPrefix, boulderFinalMode));
      }
      block.appendChild(grid);
    }

    // Filled in asynchronously by updateMultiNextLabels() below, same
    // "don't block the render on a network round-trip" split as the
    // single-round "Next up" strip (updateNextInSequence(), 6.19) - a
    // column's next round doesn't change tick to tick, so this is a
    // one-off lookup, not part of the 3s poll payload.
    if (entry.sequenceIndex < entry.sequence.length - 1) {
      const next = document.createElement("div");
      next.className = "next-in-sequence";
      next.dataset.columnIndex = i;
      next.hidden = true;
      block.appendChild(next);
    }
  });

  updateMultiNextLabels(entries);
}

// Per-column "Next: …" line (6.23), mirroring updateNextInSequence()'s
// single-strip version for normal Sequence mode - each column's own next
// queued round, fetched and cached the same way (getRoundLabel(), keyed by
// host+roundId - a round's category/round name never changes within a
// session). `myToken` reuses the shared pollToken staleness guard so a
// slower-resolving lookup from an earlier tick can't land after a newer
// tick already moved that column on to a different round.
async function updateMultiNextLabels(entries) {
  const myToken = pollToken;
  await Promise.all(
    entries.map(async (entry, i) => {
      if (entry.sequenceIndex >= entry.sequence.length - 1) return;
      const next = entry.sequence[entry.sequenceIndex + 1];
      const label = (await getRoundLabel(currentSelection.host, next.id)) ?? "…";
      if (myToken !== pollToken) return; // superseded while fetching labels
      const el2 = document.querySelector(`.next-in-sequence[data-column-index="${i}"]`);
      if (!el2) return; // column re-rendered (e.g. a tab click) before this resolved
      el2.hidden = false;
      el2.innerHTML = "";
      el2.appendChild(document.createTextNode("Next: "));
      const strong = document.createElement("strong");
      strong.textContent = label;
      el2.appendChild(strong);
    })
  );
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
  el.routeTabs.hidden = true;
  el.boulderModeRow.hidden = true; // not reachable for Boulder (Speed-only view), but a stale toggle from a previous Boulder-final board must not linger here either

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
    setShareLink(buildShareLink(selection));
    el.controlShareRow.hidden = false;
    setControlLink(buildShareLink({ ...selection, control: true }));
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
  el.boulderModeRow.hidden = true; // Training is Speed-only, but a stale Boulder-final toggle from a previously-viewed Boulder round must not linger here

  const routes = collectRouteGroups(round).flatMap((g) => g.routes);
  if (!routes.length) {
    el.routeTabs.hidden = true;
    const empty = document.createElement("div");
    empty.className = "lane-finished";
    empty.textContent = "No route data for this round.";
    el.lanes.appendChild(empty);
    return;
  }

  const routeNames = routes.map((r) => r.name);
  const laneLabelPrefix = laneLabelPrefixFor(round);
  renderRouteTabs(routeNames, laneLabelPrefix, el.routeTabs, currentSelection, () =>
    renderTrainingBoard(trainingRoundData, trainingIndex)
  );
  const routesToShow = filterRoutesBySelection(routes, routeNames, currentSelection);

  const grid = document.createElement("div");
  grid.className = routesToShow.length === 1 ? "lanes-grid lanes-grid--single" : "lanes-grid";
  for (const route of routesToShow) {
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
  const laneLabelPrefix = laneLabelPrefixFor(round);
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
  // Clears any error left over from the mode being switched away from (e.g.
  // "Add at least one round to the sequence.") - setMode() itself can't do
  // this unconditionally, since populateRounds() also calls it internally
  // right after setting its own "This event has no categories/rounds."
  // error, which that call must NOT wipe out again.
  btn.addEventListener("click", () => {
    showError("");
    setMode(btn.dataset.mode);
  });
}
setMode("single");

// Impressum email (§ 5 TMG): assembled here rather than written directly
// into the HTML so it doesn't sit in the page source as a plain scrapable
// string - joined back into a normal mailto: link at load time, so it's
// fully functional and accessible for an actual visitor, just not for a
// naive static scraper.
(function renderImpressumEmail() {
  const link = document.getElementById("impressumEmail");
  if (!link) return;
  const address = ["weiser", "jannik"].join(".") + "@" + ["gmail", "com"].join(".");
  link.href = `mailto:${address}`;
  link.textContent = address;
})();

const initial = readUrlSelection() ?? loadSelection();
if (initial?.host && initial?.eventId) {
  el.eventId.value = initial.eventId;
  el.host.value = initial.host;
  if (initial.kind === "training" || initial.kind === "multi" || initial.sequence?.length) {
    // Jump straight to the board (or controller) so a bookmarked device
    // never has to see the setup screen; loadEvent() below fills the
    // dropdown in the background for when "switch round" is used later.
    startWatching(initial);
  }
  loadEvent().then(() => {
    const restoredRoundId =
      initial.kind === "training"
        ? initial.roundId
        : initial.kind === "multi"
        ? initial.entries?.[0]?.sequence?.[0]?.id
        : initial.sequence?.[0]?.id ?? initial.sequence?.[0]?.a;
    if (restoredRoundId && [...el.roundSelect.options].some((o) => o.value === restoredRoundId)) {
      el.roundSelect.value = restoredRoundId;
    }
  });
}
