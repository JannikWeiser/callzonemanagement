// Loads the browser script public/app.js (plus session-plan.js) into a Node
// `vm` context with stubbed browser globals, so the pure logic of the wall
// display (who is at the wall, who is next, ...) can be tested without a
// browser. Every DOM access returns a harmless stub; only the logic functions
// are exercised by the tests. Keep this file generic: it must not know anything
// about the individual tests.
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "public");

// a universal stub: any property is another stub; callable and constructible
function stub() {
  const f = function () {};
  return new Proxy(f, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : k === "length" ? 0 : k === Symbol.iterator ? function* () {} : stub()),
    apply: () => stub(),
    construct: () => stub(),
    set: () => true,
  });
}

export function loadApp() {
  const store = new Map();
  const ctx = vm.createContext({
    console,
    document: stub(),
    navigator: { userAgent: "node", clipboard: stub() },
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: new URL("http://localhost/"),
    history: stub(),
    fetch: () => new Promise(() => {}), // never answers: the tests drive the logic directly
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, queueMicrotask() {}, requestAnimationFrame: () => 0,
    MutationObserver: class { observe() {} takeRecords() { return []; } },
    ResizeObserver: class { observe() {} },
    CSS: { supports: () => false },
    getComputedStyle: () => stub(),
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    qrcode: () => stub(),
    crypto: globalThis.crypto, TextEncoder, Uint8Array, AbortController, URL, URLSearchParams, structuredClone, performance: { now: () => 0 },
    btoa, atob, alert() {}, confirm: () => true, prompt: () => null,
    Event: class {}, CustomEvent: class {},
  });
  ctx.window = stub();
  ctx.globalThis = ctx;
  for (const file of ["session-plan.js", "app.js"]) {
    vm.runInContext(fs.readFileSync(path.join(publicDir, file), "utf8"), ctx, { filename: file });
  }
  return {
    ctx,
    // a function declared in app.js
    fn: (name) => ctx[name],
    // read / run an expression in the app's scope (also reaches top-level const/let)
    get: (expr) => vm.runInContext(expr, ctx),
    set: (name, value) => { ctx.__tmp = value; vm.runInContext(`${name} = __tmp`, ctx); },
  };
}

// results of the vm come from another realm: make them comparable
export const plain = (x) => JSON.parse(JSON.stringify(x ?? null));
