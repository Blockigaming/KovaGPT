import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = ts.transpileModule(readFileSync("src/hooks/use-online.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture() {
  let online = true;
  let cleanup;
  let timer;
  const listeners = new Map();
  const pending = [];
  const exports = {};
  new Function(
    "require",
    "exports",
    "window",
    "navigator",
    "fetch",
    "setTimeout",
    "clearTimeout",
    "AbortSignal",
    source,
  )(
    () => ({
      useState: () => [
        online,
        (value) => {
          online = value;
        },
      ],
      useEffect: (effect) => {
        cleanup = effect();
      },
    }),
    exports,
    {
      addEventListener: (name, callback) => listeners.set(name, callback),
      removeEventListener: (name) => listeners.delete(name),
    },
    { onLine: true },
    () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    (callback) => {
      timer = callback;
      return 1;
    },
    () => {
      timer = undefined;
    },
    { timeout: () => undefined },
  );
  exports.useOnline();
  return {
    get online() {
      return online;
    },
    event: (name) => listeners.get(name)(),
    probe: () => timer(),
    pending,
    cleanup: () => cleanup(),
    listeners,
  };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("a stale failed offline probe cannot undo a successful reconnect", async () => {
  const view = fixture();
  view.event("offline");
  const probe = view.probe();
  view.event("online");
  view.pending[0].reject(new Error("old connection failed"));
  await probe;
  assert.equal(view.online, true);
  view.cleanup();
});

test("only the latest offline event can update connectivity", async () => {
  const view = fixture();
  view.event("offline");
  const older = view.probe();
  view.event("offline");
  const latest = view.probe();
  view.pending[1].reject(new Error("offline"));
  await latest;
  assert.equal(view.online, false);
  view.pending[0].resolve({ ok: true, status: 200 });
  await older;
  assert.equal(view.online, false);
  view.event("online");
  assert.equal(view.online, true);
  view.cleanup();
});

test("unmounted connectivity probes cannot change state or retain listeners", async () => {
  const view = fixture();
  view.event("offline");
  view.probe();
  view.cleanup();
  view.pending[0].reject(new Error("offline"));
  await flush();
  assert.equal(view.online, true);
  assert.equal(view.listeners.size, 0);
});
