// Pure plan logic for shared sessions (ARCHITECTURE.md 6.46) - NO DOM, NO
// network, no dependency on app.js. Loaded as a plain <script> in the browser
// (before app.js) AND imported by server.js/sessions.js and the tests, so the
// validation the server enforces and the "who is affected by this change"
// check the host's browser runs can never drift apart. It registers itself on
// `globalThis.SessionPlan` because the browser side is a classic script, not a
// module.
//
// A "plan" is what a host publishes and every tablet follows:
//   watch: { kind: "watch", host, eventId, sequence, showNextPreview }
//     sequence entries: { type: "round", id } | { type: "paired", a, b }
//   multi: { kind: "multi", host, eventId, entries }
//     entries (1-5 columns): { sequence: [{ type: "round", id }], group, route }
// Per-tablet view preferences (route tabs of a watch session, lane swap,
// Boulder final mode) are deliberately NOT part of the plan.
(function (root) {
  "use strict";

  const MAX_SEQUENCE = 50;
  const MAX_COLUMNS = 5;
  const MAX_NAME = 100;
  const MAX_ROUTES = 20;
  const ID_PATTERN = /^\d{1,12}$/;

  // Identity of one sequence entry. Tablets track "where am I" by this key,
  // never by array index, so a host reordering the list can't make a tablet
  // jump to a different round.
  function entryKey(entry) {
    if (!entry) return null;
    return entry.type === "paired" ? `paired:${entry.a}+${entry.b}` : `round:${entry.id}`;
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
    if (kind !== "watch" && kind !== "multi") fail('Plan kind must be "watch" or "multi"');
    if (typeof raw.host !== "string" || !hostNames.includes(raw.host)) fail("Unknown host");
    const eventId = asId(raw.eventId, "eventId");

    if (kind === "watch") {
      if (!Array.isArray(raw.sequence) || raw.sequence.length < 1) fail("Sequence needs at least one round");
      if (raw.sequence.length > MAX_SEQUENCE) fail(`Sequence is limited to ${MAX_SEQUENCE} entries`);
      const used = new Set();
      const claim = (id) => {
        if (used.has(id)) fail(`Round ${id} appears more than once`);
        used.add(id);
      };
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
        return fail('Sequence entry type must be "round" or "paired"');
      });
      return { kind, host: raw.host, eventId, sequence, showNextPreview: raw.showNextPreview !== false };
    }

    if (!Array.isArray(raw.entries) || raw.entries.length < 1) fail("Split View needs at least one column");
    if (raw.entries.length > MAX_COLUMNS) fail(`Split View is limited to ${MAX_COLUMNS} columns`);
    const entries = raw.entries.map((column) => {
      if (!column || typeof column !== "object") fail("Invalid column");
      if (!Array.isArray(column.sequence) || column.sequence.length > MAX_SEQUENCE) fail("Invalid column sequence");
      const used = new Set();
      const sequence = column.sequence.map((entry) => {
        if (!entry || entry.type !== "round") fail("Split View columns only hold plain rounds");
        const id = asId(entry.id, "round id");
        if (used.has(id)) fail(`Round ${id} appears more than once in a column`);
        used.add(id);
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
      return { sequence, group, route };
    });
    return { kind, host: raw.host, eventId, entries };
  }

  // Where the entry a tablet is currently on sits in a (possibly reordered)
  // new sequence, or -1 when that entry is gone.
  function relocateIndex(oldKey, sequence) {
    if (!oldKey) return -1;
    return sequence.findIndex((entry) => entryKey(entry) === oldKey);
  }

  // What each tablet reports about itself (heartbeat): the keys of the entry
  // it is on - one for a watch plan, one per column ("<column>|<key>", empty
  // key for a finished/empty column) for a split-view plan.
  function columnKey(index, entry) {
    return `${index}|${entry ? entryKey(entry) : ""}`;
  }

  // How many of the reporting tablets would be pulled off what they are
  // showing right now by replacing `oldPlan` with `newPlan`: tablets whose
  // current entry was removed/replaced, whose column's group/route changed, or
  // everybody if the plan changed kind. Moving or adding entries never counts
  // - tablets follow their current entry by key, so those change nothing
  // visible. `clients` is [{ keys: [...] }].
  function affectedClients(oldPlan, newPlan, clients) {
    if (!oldPlan || !newPlan || !Array.isArray(clients)) return 0;
    if (oldPlan.kind !== newPlan.kind) return clients.length;
    let affected = 0;
    for (const client of clients) {
      const keys = Array.isArray(client.keys) ? client.keys : [];
      if (newPlan.kind === "watch") {
        const stillThere = new Set(newPlan.sequence.map(entryKey));
        if (keys.some((key) => key && !stillThere.has(key))) affected++;
        continue;
      }
      let hit = false;
      for (const raw of keys) {
        const sep = raw.indexOf("|");
        const column = Number(raw.slice(0, sep));
        const key = raw.slice(sep + 1);
        const next = newPlan.entries[column];
        const prev = oldPlan.entries[column];
        if (!next) {
          hit = true;
        } else if (key && !next.sequence.some((entry) => entryKey(entry) === key)) {
          hit = true;
        } else if (prev && (prev.group !== next.group || JSON.stringify(prev.route) !== JSON.stringify(next.route))) {
          hit = true;
        }
      }
      if (hit) affected++;
    }
    return affected;
  }

  // Whether a change removes or replaces anything at all (used when the
  // number of affected tablets can't be determined, e.g. the clients lookup
  // failed): any entry present in the old plan but not the new one, a column
  // dropped, a column's group/route changed, or a different kind.
  function removesOrReplaces(oldPlan, newPlan) {
    if (!oldPlan || !newPlan) return false;
    if (oldPlan.kind !== newPlan.kind) return true;
    if (newPlan.kind === "watch") {
      const next = new Set(newPlan.sequence.map(entryKey));
      return oldPlan.sequence.some((entry) => !next.has(entryKey(entry)));
    }
    return oldPlan.entries.some((prev, i) => {
      const next = newPlan.entries[i];
      if (!next) return true;
      if (prev.group !== next.group || JSON.stringify(prev.route) !== JSON.stringify(next.route)) return true;
      const keep = new Set(next.sequence.map(entryKey));
      return prev.sequence.some((entry) => !keep.has(entryKey(entry)));
    });
  }

  root.SessionPlan = {
    MAX_SEQUENCE,
    MAX_COLUMNS,
    ID_PATTERN,
    entryKey,
    columnKey,
    validatePlan,
    relocateIndex,
    affectedClients,
    removesOrReplaces,
  };
})(globalThis);
