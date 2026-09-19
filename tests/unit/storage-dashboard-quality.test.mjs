import assert from "node:assert/strict";
import test from "node:test";
import { LOCAL_WORKSPACE_STORAGE_KEY } from "../../src/lib/local-chat-workspace.mjs";
import * as principal from "../../src/lib/principal-browser-storage.mjs";
import {
  createHookHarness,
  deferred,
  elements,
  loadUiModule,
  settle,
  text,
} from "../helpers/ui-state-harness.mjs";

const display = loadUiModule("src/lib/storage-display.ts", {
  "@/lib/principal-browser-storage.mjs": principal,
});

function storage(entries) {
  const values = new Map(entries);
  const reads = [];
  return {
    reads,
    length: values.size,
    key: (index) => [...values.keys()][index] ?? null,
    getItem(key) {
      reads.push(key);
      return values.get(key) ?? null;
    },
    setItem() {
      assert.fail("Estimating storage must not write");
    },
    removeItem() {
      assert.fail("Estimating storage must not purge");
    },
  };
}

test("browser estimate reads only the resolved principal and explicit device preferences", () => {
  const a = principal.listPrincipalBrowserStorageKeys("account-a", { purgeUnscopedPrivate: false });
  const b = principal.listPrincipalBrowserStorageKeys("account-b", { purgeUnscopedPrivate: false });
  const writeVersionsKey = principal.principalScopedStorageKey(
    "kova.write.versions.v1",
    "account-a",
  );
  assert.ok(a.localExact.includes(writeVersionsKey));
  const entries = [
    [a.localExact[0], "mine"],
    [`${a.localPrefixes[0]}item`, "mine-too"],
    [writeVersionsKey, '[{"title":"Saved version","text":"Private draft"}]'],
    [principal.DEVICE_PREFERENCE_KEYS[0], "dark"],
  ];
  const area = storage([
    ...entries,
    [b.localExact[0], "private"],
    ["sb-auth-token", "secret"],
    ["kova.write.draft.v1", "ownerless"],
    ["unregistered", "unknown"],
  ]);
  assert.equal(
    display.estimateAccountBrowserBytes("account-a", area),
    entries.reduce((sum, [key, value]) => sum + (key.length + value.length) * 2, 0),
  );
  assert.deepEqual(
    area.reads,
    entries.map(([key]) => key),
  );
});

test("unresolved, inaccessible, or incomplete browser measurements are not zero usage", () => {
  const area = storage([["sb-auth-token", "secret"]]);
  assert.equal(display.estimateAccountBrowserBytes(undefined, area), null);
  assert.deepEqual(area.reads, []);
  assert.equal(display.estimateAccountBrowserBytes("account-a", null), null);
  assert.equal(
    display.estimateAccountBrowserBytes("account-a", {
      get length() {
        throw Error("blocked");
      },
    }),
    null,
  );
  assert.equal(display.estimateAccountBrowserBytes("account-a", { length: 10001 }), null);
  assert.equal(display.estimateAccountBrowserBytes("account-a", storage([])), 0);
});

test("guest storage remains separate and invalid byte counts are unavailable", () => {
  const guest = principal.listPrincipalBrowserStorageKeys(null, { purgeUnscopedPrivate: false });
  const own = principal.listPrincipalBrowserStorageKeys("owner", { purgeUnscopedPrivate: false });
  const guestWorkspace = '{"chats":{"guest-chat":{"pins":["message-1"]}}}';
  const area = storage([
    [guest.localExact[0], "guest"],
    [LOCAL_WORKSPACE_STORAGE_KEY, guestWorkspace],
    [own.localExact[0], "private"],
  ]);
  assert.ok(guest.localExact.includes(LOCAL_WORKSPACE_STORAGE_KEY));
  assert.equal(
    display.estimateAccountBrowserBytes(null, area),
    (guest.localExact[0].length + "guest".length) * 2 +
      (LOCAL_WORKSPACE_STORAGE_KEY.length + guestWorkspace.length) * 2,
  );
  assert.deepEqual(area.reads, [guest.localExact[0], LOCAL_WORKSPACE_STORAGE_KEY]);
  for (const value of [-1, NaN, Infinity])
    assert.equal(display.formatStorageBytes(value), "Unavailable");
  assert.equal(display.formatStorageBytes(0), "0 B");
  assert.equal(display.formatStorageBytes(1024), "1.0 KB");
});

function storageServer({
  bytes = { data: { bytes_used: 128 }, error: null },
  library = { count: 2, error: null },
  subscription = { data: { effectiveTier: "plus" }, error: null },
} = {}) {
  const queries = [];
  const auth = Symbol("auth");
  const module = loadUiModule("src/utils/storage.functions.ts", {
    "@tanstack/react-start": {
      createServerFn({ method }) {
        assert.equal(method, "GET");
        return {
          middleware(list) {
            assert.equal(list[0], auth);
            return this;
          },
          handler: (fn) => fn,
        };
      },
    },
    "@/integrations/supabase/auth-middleware": { requireSupabaseAuth: auth },
    "@/lib/modes": { STORAGE_LIMITS_BYTES: { free: 500, plus: 25000, pro: 25000 } },
  });
  return {
    queries,
    run: () =>
      module.getMyStorage({
        context: {
          userId: "current-owner",
          supabase: {
            from(table) {
              const result = table === "user_storage" ? bytes : library;
              const query = { table, filters: [] };
              queries.push(query);
              return {
                select(...args) {
                  query.select = args;
                  return this;
                },
                eq(...args) {
                  query.filters.push(args);
                  return this;
                },
                maybeSingle: async () => result,
                then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
              };
            },
            rpc: async (name) => {
              assert.equal(name, "current_subscription_summary");
              return subscription;
            },
          },
        },
      }),
  };
}

test("cloud usage and verified plan come from authenticated, owner-filtered queries", async () => {
  const server = storageServer();
  const result = await server.run();
  assert.equal(result.bytesUsed, 128);
  assert.equal(result.libraryCount, 2);
  assert.equal(result.tier, "plus");
  assert.equal(result.limitBytes, 25000);
  assert.equal(server.queries.length, 2);
  for (const query of server.queries)
    assert.deepEqual(query.filters, [["user_id", "current-owner"]]);
  assert.equal(server.queries[1].select[1].head, true);
});

test("query errors and malformed counts never masquerade as empty cloud storage", async () => {
  for (const options of [
    { bytes: { data: null, error: { message: "private database detail" } } },
    { library: { count: null, error: { message: "private database detail" } } },
    { bytes: { data: { bytes_used: -1 }, error: null } },
    { bytes: { data: { bytes_used: "128" }, error: null } },
    { library: { count: null, error: null } },
    { library: { count: NaN, error: null } },
  ]) {
    await assert.rejects(storageServer(options).run(), (error) => {
      assert.match(error.message, /storage usage/i);
      assert.doesNotMatch(error.message, /private database detail/);
      return true;
    });
  }
  const empty = await storageServer({
    bytes: { data: null, error: null },
    library: { count: 0, error: null },
  }).run();
  assert.equal(empty.bytesUsed, 0);
  assert.equal(empty.libraryCount, 0);
});

test("unknown billing cannot invent a free or paid storage quota", async () => {
  for (const subscription of [
    { data: { effectiveTier: "professional" }, error: null },
    { data: { effectiveTier: "pro" }, error: { message: "unavailable" } },
    { data: [{ effectiveTier: "pro" }], error: null },
    { data: null, error: null },
  ]) {
    const result = await storageServer({ subscription }).run();
    assert.equal(result.tier, null);
    assert.equal(result.limitBytes, null);
    assert.equal(result.bytesUsed, 128);
  }
});

function dashboard(getMyStorage, user = { id: "account-a" }) {
  const hooks = createHookHarness();
  const auth = { isLoaded: true, user };
  const module = loadUiModule("src/components/StorageDashboard.tsx", {
    react: hooks.react,
    "lucide-react": { HardDrive: "HardDrive", RefreshCw: "RefreshCw" },
    "@/utils/storage.functions": { getMyStorage },
    "@/components/auth/ClerkSafe": { useUser: () => auth },
    "@/lib/storage-display": { ...display, estimateAccountBrowserBytes: () => 900000 },
    "@/components/ui/progress": { Progress: "Progress" },
    "@/components/ui/button": { Button: "Button" },
  });
  const wrapper = () => module.StorageDashboard({ signedIn: !!auth.user });
  const root = wrapper();
  return { auth, wrapper, root, hooks, render: () => hooks.render(root.type, root.props) };
}

test("cloud percentage excludes local bytes and errors have a named refresh path", async () => {
  let fail = false;
  const d = dashboard(async () => {
    if (fail) throw Error("network");
    return { bytesUsed: 10, libraryCount: 1, tier: "free", limitBytes: 100 };
  });
  assert.match(text(d.render()), /Loading cloud storage/);
  await settle();
  let tree = d.render();
  assert.equal(elements(tree, (node) => node.type === "Progress")[0].props.value, 10);
  assert.match(text(tree), /1 item/);
  fail = true;
  elements(tree, (node) => node.type === "Button")[0].props.onClick();
  await settle();
  tree = d.render();
  assert.equal(elements(tree, (node) => node.props.role === "alert").length, 1);
  assert.equal(elements(tree, (node) => node.type === "Progress").length, 0);
  assert.doesNotMatch(text(tree), /0 B|0 items/);
  const refresh = elements(tree, (node) => node.type === "Button")[0];
  assert.equal(refresh.props.disabled, false);
  assert.equal(refresh.props["aria-label"], "Refresh storage usage");
});

test("guest storage skips cloud queries and account transitions remount the dashboard", () => {
  const d = dashboard(() => assert.fail("Guest must not request cloud usage"), null);
  assert.match(text(d.render()), /Sign in/);
  assert.equal(d.root.key, "guest");
  d.auth.user = { id: "account-b" };
  assert.equal(d.wrapper().key, "account-b");
  d.auth.isLoaded = false;
  assert.match(text(d.wrapper()), /Checking your account/);
});

test("unmounted and superseded storage responses cannot overwrite newer state", async () => {
  const first = deferred();
  const second = deferred();
  let calls = 0;
  const d = dashboard(() => (++calls === 1 ? first.promise : second.promise));
  const tree = d.render();
  elements(tree, (node) => node.type === "Button")[0].props.onClick();
  second.resolve({ bytesUsed: 20, libraryCount: 2, tier: "free", limitBytes: 100 });
  await settle();
  first.resolve({ bytesUsed: 99, libraryCount: 99, tier: "free", limitBytes: 100 });
  await settle();
  assert.match(text(d.render()), /2 items/);
  assert.doesNotMatch(text(d.render()), /99 items/);
  const late = deferred();
  const old = dashboard(() => late.promise);
  old.render();
  old.hooks.unmount();
  late.resolve({ bytesUsed: 88, libraryCount: 88, tier: "free", limitBytes: 100 });
  await settle();
  assert.doesNotMatch(text(old.render()), /88 items/);
});

test("shared Progress passes its actual value and accessible label to the Radix root", () => {
  const hooks = createHookHarness();
  const { Progress } = loadUiModule("src/components/ui/progress.tsx", {
    react: hooks.react,
    "@radix-ui/react-progress": { Root: "RadixRoot", Indicator: "RadixIndicator" },
    "@/lib/utils": { cn: (...values) => values.filter(Boolean).join(" ") },
  });
  const root = Progress({
    value: 37,
    "aria-label": "Cloud storage",
    "aria-valuetext": "37 of 100",
  });
  assert.equal(root.props.value, 37);
  assert.equal(root.props["aria-label"], "Cloud storage");
  assert.equal(root.props["aria-valuetext"], "37 of 100");
  assert.equal(root.props.children.props.style.transform, "translateX(-63%)");
  assert.equal(Progress({ value: 0 }).props.value, 0);
});
