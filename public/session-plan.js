// Pure plan logic for shared sessions (ARCHITECTURE.md 6.46) - NO DOM, NO
// network, no dependency on app.js. Loaded as a plain <script> in the browser
// (before app.js) AND imported by server.js/sessions.js and the tests, so the
// validation the server enforces and the "who is affected by this change"
// check the host's browser runs can never drift apart. It registers itself on
// `globalThis.SessionPlan` because the browser side is a classic script, not a
// module.
//
// A "plan" is what a host publishes and every tablet follows - ONE shape,
// the Sequence (ARCHITECTURE.md 6.46/6.50):
//   { kind: "watch", host, eventId, sequence, showNextPreview }
//     sequence entries: { type: "round", id } | { type: "paired", a, b }
//                       | { type: "training", id }  (a manual Speed training on
//                       the startlist of round `id`, see ARCHITECTURE.md 6.47)
//                       | { type: "split", columns: [{ sequence: [{type:"round",
//                       id}], group, route }] }  (1-5 categories side by side,
//                       each column running through its own rounds, 6.50)
// Per-tablet view preferences (route tabs of a plain round entry, lane swap,
// Boulder final mode) are deliberately NOT part of the plan.
(function (root) {
  "use strict";

  const MAX_SEQUENCE = 50;
  const MAX_COLUMNS = 5;
  const MAX_NAME = 100;
  const MAX_ROUTES = 20;
  const ID_PATTERN = /^\d{1,12}$/;

  // A compact, deterministic fingerprint (two independent 32-bit hashes, ~13
  // base-36 characters): a split view's identity is the list of all its
  // columns' rounds, which would not fit the 60 characters the server keeps of
  // a heartbeat key for five columns with a few rounds each - a truncated key
  // would never match any entry and count every tablet as "affected".
  function digest(text) {
    let a = 5381;
    let b = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      a = ((a << 5) + a + c) >>> 0;
      b = (c + (b << 6) + (b << 16) - b) >>> 0;
    }
    return a.toString(36) + b.toString(36);
  }

  // Identity of one sequence entry. Tablets track "where am I" by this key,
  // never by array index, so a host reordering the list can't make a tablet
  // jump to a different round.
  function entryKey(entry) {
    if (!entry) return null;
    if (entry.type === "paired") return `paired:${entry.a}+${entry.b}`;
    if (entry.type === "training") return `training:${entry.id}`;
    if (entry.type === "split") return `split:${digest(entry.columns.map((c) => c.sequence.map((e) => e.id).join("+")).join("|"))}`;
    return `round:${entry.id}`;
  }

  function fail(message) {
    throw new Error(message);
  }

  function asId(value, what) {
    const id = typeof value === "number" ? String(value) : value;
    if (typeof id !== "string" || !ID_PATTERN.test(id)) fail(`${what} must be a numeric id`);
    return id;
  }

  // Validates AND normalizes (fixed key order, strings only), so two plans
  // with the same content always serialize identically - the host's
  // "unapplied changes" check and the server's version bookkeeping compare
  // JSON.stringify() of normalized plans. Throws Error(message) on anything
  // invalid; `hostNames` is the list of known results.info host keys.
  function validatePlan(raw, hostNames) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("Plan must be an object");
    const kind = raw.kind;
    if (kind !== "watch") fail('Plan kind must be "watch"');
    if (typeof raw.host !== "string" || !hostNames.includes(raw.host)) fail("Unknown host");
    const eventId = asId(raw.eventId, "eventId");

    if (!Array.isArray(raw.sequence) || raw.sequence.length < 1) fail("Sequence needs at least one round");
    if (raw.sequence.length > MAX_SEQUENCE) fail(`Sequence is limited to ${MAX_SEQUENCE} entries`);
    const used = new Set();
    const claim = (id) => {
      if (used.has(id)) fail(`Round ${id} appears more than once`);
      used.add(id);
    };
    // A training borrows a round's startlist and does NOT claim the round:
    // the same Speed round is normally in the sequence twice, once as the
    // training and once as the real round. Only a second training on the
    // same round is a duplicate.
    const usedTraining = new Set();
    const sequence = raw.sequence.map((entry) => {
      if (!entry || typeof entry !== "object") fail("Invalid sequence entry");
      if (entry.type === "round") {
        const id = asId(entry.id, "round id");
        claim(id);
        return { type: "round", id };
      }
      if (entry.type === "paired") {
        const a = asId(entry.a, "paired round id");
        const b = asId(entry.b, "paired round id");
        if (a === b) fail("A paired entry needs two different rounds");
        claim(a);
        claim(b);
        return { type: "paired", a, b };
      }
      if (entry.type === "training") {
        const id = asId(entry.id, "training round id");
        if (usedTraining.has(id)) fail(`Training for round ${id} appears more than once`);
        usedTraining.add(id);
        return { type: "training", id };
      }
      if (entry.type === "split") {
        if (!Array.isArray(entry.columns) || entry.columns.length < 1 || entry.columns.length > MAX_COLUMNS) {
          fail(`A split view needs 1 to ${MAX_COLUMNS} columns`);
        }
        let rounds = 0;
        const columns = entry.columns.map((column) => {
          if (!column || typeof column !== "object") fail("Invalid column");
          if (!Array.isArray(column.sequence) || column.sequence.length > MAX_SEQUENCE) fail("Invalid column sequence");
          const columnSequence = column.sequence.map((item) => {
            if (!item || item.type !== "round") fail("Split view columns only hold plain rounds");
            const id = asId(item.id, "round id");
            claim(id);
            rounds++;
            return { type: "round", id };
          });
          let group = null;
          if (column.group != null && column.group !== "") {
            if (typeof column.group !== "string" || column.group.length > MAX_NAME) fail("Invalid group name");
            group = column.group;
          }
          let route = null;
          if (column.route != null) {
            if (!Array.isArray(column.route) || column.route.length > MAX_ROUTES) fail("Invalid route list");
            const names = column.route.map((name) => {
              if (typeof name !== "string" || !name || name.length > MAX_NAME) fail("Invalid route name");
              return name;
            });
            route = names.length ? names : null;
          }
          return { sequence: columnSequence, group, route };
        });
        if (!rounds) fail("A split view needs at least one round");
        return { type: "split", columns };
      }
      return fail('Sequence entry type must be "round", "paired", "training" or "split"');
    });
    return { kind, host: raw.host, eventId, sequence, showNextPreview: raw.showNextPreview !== false };
  }

  // Where the entry a tablet is currently on sits in a (possibly reordered)
  // new sequence, or -1 when that entry is gone.
  function relocateIndex(oldKey, sequence) {
    if (!oldKey) return -1;
    return sequence.findIndex((entry) => entryKey(entry) === oldKey);
  }

  // What a tablet reports about itself (heartbeat): the key of the entry it
  // is on. A split view is one entry (its columns progress inside it).

  // What a tablet SEES of an entry besides its identity: a split view's
  // per-column group/route filter is part of the plan, so changing it changes
  // what tablets on that entry show without changing the entry's key.
  function viewSignature(entry) {
    return entry && entry.type === "split" ? JSON.stringify(entry.columns.map((c) => [c.group, c.route])) : "";
  }

  // How many of the reporting tablets would be pulled off what they are
  // showing right now by replacing `oldPlan` with `newPlan`: tablets whose
  // current entry was removed/replaced, or whose split view's column
  // filters changed. Moving or adding entries never counts - tablets follow
  // their current entry by key, so those change nothing visible. `clients` is
  // [{ keys: [...] }].
  function affectedClients(oldPlan, newPlan, clients) {
    if (!oldPlan || !newPlan || !Array.isArray(clients)) return 0;
    const next = new Map(newPlan.sequence.map((entry) => [entryKey(entry), entry]));
    const prev = new Map(oldPlan.sequence.map((entry) => [entryKey(entry), entry]));
    let affected = 0;
    for (const client of clients) {
      const keys = Array.isArray(client.keys) ? client.keys : [];
      const hit = keys.some((key) => {
        if (!key) return false;
        if (!next.has(key)) return true;
        return prev.has(key) && viewSignature(prev.get(key)) !== viewSignature(next.get(key));
      });
      if (hit) affected++;
    }
    return affected;
  }

  // Whether a change removes or replaces anything at all (used when the
  // number of affected tablets can't be determined, e.g. the clients lookup
  // failed): any entry present in the old plan but not the new one, or a
  // split view whose column filters changed.
  function removesOrReplaces(oldPlan, newPlan) {
    if (!oldPlan || !newPlan) return false;
    const next = new Map(newPlan.sequence.map((entry) => [entryKey(entry), entry]));
    return oldPlan.sequence.some((entry) => {
      const key = entryKey(entry);
      return !next.has(key) || viewSignature(entry) !== viewSignature(next.get(key));
    });
  }

  // ---- technical incidents (ARCHITECTURE.md 6.48, 6.51) -----------------------
  // An incident re-starts an athlete who already climbed: athlete `athleteId`
  // climbs again right before `beforeAthleteId` (or at the end of the start
  // list when that is null). It is drawn as an OVERLAY on a lane that was
  // computed from the real results - the inference itself never sees it. The
  // position is NOT calculated here: the jury president takes it over from the
  // TI-Rechner ("Boulder 1 stays free in front of start position X").
  //
  // Lead: the athlete is drawn on the incident's route. Boulder: the incident
  // is a rotation SLOT that travels through the whole block like a ghost
  // athlete - on the boulder the athlete climbs again (`boulderRouteId`) the
  // athlete is drawn, on every other boulder of the block the slot is an
  // EMPTY place (nobody is called there in that interval). `reuseOf` = this
  // athlete uses the already free slot of another incident (the TI-Rechner's
  // "as fast as possible"): no gap of its own, it stands in that slot's place on
  // its own boulder, where the other incident's empty place is replaced by it.
  //
  // `lane` is { atWall, onDeck, queue, finished, ...} as built by
  // computeLane()/computeBoulderLane(). `incidents` are the session's
  // incidents of THIS round; `athleteById(id)` returns the startlist entry;
  // `isSuperseded(ti, routeId)` says the athlete it was put in front of has
  // already started on THIS route (the incident is over there, whatever the
  // host forgot to press). `isUnderway(ti, routeId)` says the re-starting
  // athlete is being scored again right now (their ascent is "active") - it
  // is only asked for the route the athlete climbs again on.
  // Returns the same lane object when nothing applies. Re-started athletes are
  // copies flagged `tiRestart: true`; an empty place is `{ tiGap: true }` (drawn
  // as "TI: no athlete" - a plain `null` would look like any other blank).
  // How many queue entries a lane carries. The display shows as many as fit the
  // screen (6.52), at least 6; "the end of the list is in view" means the queue is
  // shorter than this.
  const LANE_QUEUE = 15;

  function applyTechnicalIncidents(lane, { incidents, routeId, athleteById, isSuperseded, isUnderway }) {
    const all = (incidents ?? []).filter((ti) => ti && Array.isArray(ti.routeIds));
    const byId = new Map(all.map((ti) => [ti.id, ti]));
    // A TI that uses another one's slot stands where that slot stands.
    const ownerOf = (ti) => (ti.reuseOf != null ? byId.get(ti.reuseOf) ?? null : null);
    const anchorOf = (ti) => (ownerOf(ti) ? ownerOf(ti).beforeAthleteId : ti.beforeAthleteId);
    const keyOf = (ti) => (ownerOf(ti) ?? ti).createdAt;
    const open = all
      .filter((ti) => !ti.done && ti.routeIds.includes(routeId))
      .sort((a, b) => keyOf(a) - keyOf(b) || a.createdAt - b.createdAt);
    if (!open.length) return lane;
    // On the boulder where another TI re-uses this one's slot, that TI's empty
    // place is taken by the athlete.
    const takenOver = (ti) =>
      open.some((o) => o !== ti && ownerOf(o) === ti && o.boulderRouteId === routeId);

    let list = lane.finished ? [] : [lane.atWall ?? null, lane.onDeck ?? null, ...lane.queue];
    const idOf = (item) => (item && item.athlete_id != null ? String(item.athlete_id) : null);
    const endInView = lane.finished || lane.queue.length < LANE_QUEUE;
    let changed = false;

    for (const ti of open) {
      const before = anchorOf(ti);
      const view = before === ti.beforeAthleteId ? ti : { ...ti, beforeAthleteId: before };
      if (isSuperseded && isSuperseded(view, routeId)) continue;
      // Boulder: the athlete only on the boulder he climbs again, an empty
      // place on the others. Lead: no boulderRouteId, the athlete on the route.
      const restartHere = ti.boulderRouteId == null || ti.boulderRouteId === routeId;
      // A TI that uses another one's slot has no gap of its own: it only draws its
      // athlete (the empty places are the owner's). An owner's empty place on the
      // reuser's boulder is replaced by the athlete.
      if (!restartHere && (ti.reuseOf != null || takenOver(ti))) continue;
      let entry = { tiGap: true };
      if (restartHere) {
        const athlete = athleteById(ti.athleteId);
        if (!athlete) continue;
        // The re-start is happening right now (a judge is live-scoring the
        // athlete again): the real lane already shows them, never twice.
        if (isUnderway && isUnderway(ti, routeId)) continue;
        entry = { ...athlete, tiRestart: true };
      }

      if (before == null) {
        // At the end of the start list - only once the end is in view (a
        // full queue may continue beyond what is shown). An empty place at
        // the very end means nothing.
        if (entry.tiGap || !endInView) continue;
        let last = -1;
        list.forEach((item, i) => {
          if (item) last = i;
        });
        // Fill an empty climbing/next slot instead of pushing it down.
        if (last + 1 < 2 && list[last + 1] == null) list[last + 1] = entry;
        else list.splice(last + 1, 0, entry);
        changed = true;
        continue;
      }
      const at = list.findIndex((item) => idOf(item) === String(before));
      if (at === -1) continue; // not in view yet, or long gone
      list.splice(at, 0, entry);
      changed = true;
    }
    if (!changed) return lane;
    while (list.length > 2 && list[list.length - 1] == null) list.pop();
    while (list.length < 2) list.push(null);
    return {
      ...lane,
      finished: false,
      atWall: list[0],
      onDeck: list[1],
      queue: list.slice(2, 2 + LANE_QUEUE),
    };
  }


  root.SessionPlan = {
    applyTechnicalIncidents,
    MAX_SEQUENCE,
    LANE_QUEUE,
    MAX_COLUMNS,
    ID_PATTERN,
    entryKey,
    validatePlan,
    relocateIndex,
    affectedClients,
    removesOrReplaces,
  };
})(globalThis);
