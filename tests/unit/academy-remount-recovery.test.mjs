import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { loadUiModule, createHookHarness, settle } from "../helpers/ui-state-harness.mjs";
import * as storagePolicy from "../../src/lib/principal-browser-storage.mjs";
import * as records from "../../src/lib/device-records.mjs";
import * as accountPolicy from "../../src/lib/academy-state-policy.mjs";
import { EMPTY_ACADEMY_PROGRESS, isAcademyProgress } from "../../src/lib/academy-progress.mjs";
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222",
  root = process.env.KOVA_REVIEW_SOURCE_DIR ?? ".";
function device() {
  const data = new Map(),
    queues = new Map();
  return {
    storage: {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => data.set(k, v),
      removeItem: (k) => data.delete(k),
      key: (i) => [...data.keys()][i] ?? null,
      get length() {
        return data.size;
      },
    },
    locks: {
      request: (key, fn) => {
        const p = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(fn);
        queues.set(key, p);
        return p;
      },
    },
  };
}
function mount(shared, actor = A) {
  const h = createHookHarness(),
    timers = new Map(),
    events = new Map();
  let id = 0;
  const window = {
    setTimeout: (fn) => {
      timers.set(++id, fn);
      return id;
    },
    clearTimeout: (i) => timers.delete(i),
    addEventListener: (name, fn) => events.set(name, fn),
    removeEventListener: (name) => events.delete(name),
    confirm: () => false,
  };
  const { useDeviceRecord } = loadUiModule(
    `${root}/src/lib/use-device-record.ts`,
    {
      react: h.react,
      "@tanstack/react-router": { useBlocker() {} },
      "./device-records.mjs": {
        ...records,
        saveDeviceRecord: (args) =>
          records.saveDeviceRecord({ ...args, randomUUID: () => webcrypto.randomUUID() }),
      },
      "./principal-browser-storage.mjs": {
        ...storagePolicy,
        safeBrowserStorage: () => shared.storage,
      },
    },
    { window, navigator: { locks: shared.locks } },
  );
  const get = async () => ({
    owner_id: actor,
    topic: "writing",
    revision: 1,
    body: { ...EMPTY_ACADEMY_PROGRESS, notes: `${actor} account notes` },
    updated_at: "2026-10-12T00:00:00Z",
  });
  const { useAcademyAccount } = loadUiModule(
    `${root}/src/lib/use-academy-account.ts`,
    {
      react: h.react,
      "@tanstack/react-start": { useServerFn: (f) => f },
      "./academy-state.functions": {
        getAcademyState: get,
        saveAcademyState: () => {
          throw Error("No account mutation authorized by this fixture");
        },
      },
      // Deferred persistence behavior, not authorization to enable it at launch.
      "./academy-state-policy.mjs": {
        ...accountPolicy,
        ACADEMY_ACCOUNT_PERSISTENCE_ENABLED: true,
      },
      "./academy-progress.mjs": { EMPTY_ACADEMY_PROGRESS },
    },
    { crypto: webcrypto },
  );
  const render = () =>
    h.render(() => {
      const draft = useDeviceRecord(
        "kova-academy-progress",
        actor,
        "writing",
        EMPTY_ACADEMY_PROGRESS,
        isAcademyProgress,
      );
      const account = useAcademyAccount(actor, "writing", draft);
      return { draft, account };
    });
  const settleView = async () => {
    let view;
    for (let i = 0; i < 5; i++) {
      view = render();
      await settle();
    }
    return view;
  };
  const flush = async () => {
    for (const [key, fn] of [...timers]) {
      timers.delete(key);
      fn();
    }
    await settle();
    return settleView();
  };
  return {
    render,
    settleView,
    flush,
    unmount: () => h.unmount(),
    notifyClear: () =>
      events.get(storagePolicy.PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT)?.({
        detail: { principal: storagePolicy.browserStoragePrincipal(actor) },
      }),
  };
}
for (const transition of ["navigate away/back", "page reload"])
  test(`clear → ${transition} keeps device empty until explicit account restore`, async () => {
    const shared = device(),
      first = mount(shared);
    await first.settleView();
    await first.flush();
    assert.match(
      records.readDeviceRecord(shared.storage, "kova-academy-progress", A, "writing").value.notes,
      /account notes/,
    );
    await storagePolicy.clearPrincipalBrowserStorage(A, {
      localStorage: shared.storage,
      sessionStorage: shared.storage,
      locks: shared.locks,
    });
    if (transition === "navigate away/back") {
      first.notifyClear();
      await first.settleView();
      await first.flush();
    }
    first.unmount();
    const second = mount(shared);
    let view = await second.settleView();
    await second.flush();
    assert.equal(view.draft.value.notes, "");
    assert.equal(
      records.readDeviceRecord(shared.storage, "kova-academy-progress", A, "writing").value,
      null,
    );
    assert.match(view.account.record.body.notes, /account notes/);
    view.account.useAccount();
    await second.settleView();
    view = await second.flush();
    assert.match(view.draft.value.notes, /account notes/);
    assert.match(
      records.readDeviceRecord(shared.storage, "kova-academy-progress", A, "writing").value.notes,
      /account notes/,
    );
    second.unmount();
    const other = mount(shared, B);
    await other.settleView();
    await other.flush();
    assert.match(
      records.readDeviceRecord(shared.storage, "kova-academy-progress", B, "writing").value.notes,
      /account notes/,
    );
    other.unmount();
  });
