import { shellLogic, eventAttributes } from "../helpers/workspace-layout-preservation.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import * as store from "../../src/lib/chat-store.ts";
import {
  registerChatHistoryView,
  notifyChatHistoryChanged,
} from "../../src/lib/chat-history-bridge.ts";
import * as privacy from "../../src/lib/principal-browser-storage.mjs";
import {
  createHookHarness,
  loadUiModule,
  elements,
  text,
  settle,
  deferred,
} from "../helpers/ui-state-harness.mjs";
const merge = loadUiModule("src/lib/knowledge-history-nodes.ts", {}).mergeKnowledgeHistoryNodes;
const chat = (id, title = id, pinned = false, updatedAt = 1) => ({
  id,
  title,
  pinned,
  updatedAt,
  createdAt: 1,
  messages: [],
  mode: "instant",
});
function environment() {
  const win = new EventTarget();
  Object.defineProperty(globalThis, "window", { configurable: true, value: win });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => null, setItem() {}, removeItem() {} },
  });
  return win;
}
function view(owner, active = []) {
  const state = {
    ready: false,
    writable: true,
    dirty: false,
    active,
    archived: [],
    markDirty() {},
    write() {
      throw Error("No writes authorized");
    },
  };
  const remove = registerChatHistoryView(owner, state);
  return {
    state,
    remove,
    publish(rows) {
      state.ready = true;
      state.active = rows;
      notifyChatHistoryChanged(owner, "cloud");
    },
  };
}
function hookFixture() {
  const win = environment(),
    hooks = createHookHarness();
  const original = store.subscribeToConversationChanges;
  const callbacks = [];
  let subscriptions = 0,
    cleanups = 0;
  const useHistory = loadUiModule(
    "src/lib/use-account-conversation-history.ts",
    {
      react: hooks.react,
      "./chat-store": {
        ...store,
        subscribeToConversationChanges: (owner, fn) => {
          subscriptions++;
          callbacks.push(fn);
          const remove = original(owner, fn);
          return () => {
            cleanups++;
            remove();
          };
        },
      },
      "./principal-browser-storage.mjs": privacy,
    },
    { window: win },
  ).useAccountConversationHistory;
  return {
    win,
    hooks,
    callbacks,
    render: (owner = "A", enabled = true) => hooks.render(() => useHistory(owner, enabled)),
    counts: () => ({ subscriptions, cleanups }),
  };
}
test("Late cloud hydration, later rename/delete and storage events update the same mounted owner", () => {
  const f = hookFixture(),
    a = view("A");
  try {
    assert.equal(f.render().length, 0);
    a.publish([chat("one")]);
    assert.equal(f.render()[0].title, "one");
    a.publish([chat("one", "Renamed")]);
    assert.equal(f.render()[0].title, "Renamed");
    a.publish([]);
    assert.equal(f.render().length, 0);
    a.state.active = [chat("storage")];
    const e = new Event("storage");
    Object.defineProperty(e, "key", { value: store.conversationStorageKey("A") });
    f.win.dispatchEvent(e);
    assert.equal(f.render()[0].id, "storage");
    assert.equal(f.counts().subscriptions, 1);
  } finally {
    f.hooks.unmount();
    a.remove();
  }
});
test("Subscription is installed before initial read and unresolved/guest states never read history", () => {
  const win = environment(),
    hooks = createHookHarness();
  const order = [];
  const useHistory = loadUiModule(
    "src/lib/use-account-conversation-history.ts",
    {
      react: hooks.react,
      "./chat-store": {
        chatStoragePrincipal: store.chatStoragePrincipal,
        loadConversations: () => {
          order.push("read");
          return [chat("ready")];
        },
        subscribeToConversationChanges: (_, fn) => {
          order.push("subscribe");
          fn([chat("ready")]);
          return () => order.push("unsubscribe");
        },
      },
      "./principal-browser-storage.mjs": privacy,
    },
    { window: win },
  ).useAccountConversationHistory;
  hooks.render(() => useHistory("A", false));
  assert.deepEqual(order, []);
  hooks.render(() => useHistory("A", true));
  assert.deepEqual(order, ["subscribe", "read"]);
  assert.equal(hooks.render(() => useHistory("A", true))[0].id, "ready");
  hooks.unmount();
  assert.equal(order.at(-1), "unsubscribe");
});
test("Wrong owner events, principal switch and callbacks retained after cleanup cannot expose old rows", () => {
  const f = hookFixture(),
    a = view("A"),
    b = view("B");
  try {
    f.render();
    a.publish([chat("A-private")]);
    assert.equal(f.render()[0].id, "A-private");
    b.publish([chat("B-private")]);
    assert.equal(f.render()[0].id, "A-private");
    assert.equal(f.render("B").length, 0);
    assert.equal(f.render("B")[0].id, "B-private");
    f.callbacks[0]([chat("stale-A")]);
    assert.equal(f.render("B")[0].id, "B-private");
    assert.equal(f.render("A", false).length, 0);
    assert.equal(f.render(null, false).length, 0);
    f.hooks.unmount();
    for (const callback of f.callbacks) callback([chat("after-unmount")]);
    assert.ok(f.counts().cleanups >= 2);
  } finally {
    a.remove();
    b.remove();
  }
});
test("Account storage clearing empties rows and fences late hydration until a new subscription lifecycle", () => {
  const f = hookFixture(),
    a = view("A");
  try {
    f.render();
    a.publish([chat("private")]);
    assert.equal(f.render().length, 1);
    f.win.dispatchEvent(
      new CustomEvent(privacy.PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, {
        detail: { principal: privacy.browserStoragePrincipal("B") },
      }),
    );
    assert.equal(f.render().length, 1);
    f.win.dispatchEvent(
      new CustomEvent(privacy.PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, {
        detail: { principal: privacy.browserStoragePrincipal("A") },
      }),
    );
    assert.equal(f.render().length, 0);
    a.publish([chat("late")]);
    f.callbacks[0]([chat("late-direct")]);
    assert.equal(f.render().length, 0);
  } finally {
    f.hooks.unmount();
    a.remove();
  }
});
test("Graph merge preserves remote order/identity, local20-item pages and unique IDs", () => {
  const remote = [
      {
        id: "project:1",
        kind: "project",
        label: "Project",
        href: "/projects",
        updatedAt: "2026-01-01",
      },
      {
        id: "local-chat:0",
        kind: "chat",
        label: "Server canonical",
        href: "/server",
        updatedAt: "2026-01-01",
      },
    ],
    rows = Array.from({ length: 25 }, (_, i) => chat(String(i)));
  const first = merge(remote, rows, 0);
  assert.equal(first.length, 21);
  assert.equal(first[0], remote[0]);
  assert.equal(first[1], remote[1]);
  assert.equal(new Set(first.map((x) => x.id)).size, first.length);
  assert.deepEqual(
    Array.from(merge(remote, rows, 1).slice(2), (n) => n.id),
    ["local-chat:20", "local-chat:21", "local-chat:22", "local-chat:23", "local-chat:24"],
  );
});
function graphFixture() {
  const win = environment(),
    hooks = createHookHarness(),
    react = { ...hooks.react, useMemo: (fn) => fn() };
  let calls = 0;
  const pending = deferred();
  const requests = [];
  const payloads = [];
  const list = (args) => {
    payloads.push(args.data);
    calls++;
    const request = calls === 1 ? pending : deferred();
    requests.push(request);
    return request.promise;
  };
  const account = { isLoaded: true, isSignedIn: true, user: { id: "A" } };
  const useHistory = loadUiModule(
    "src/lib/use-account-conversation-history.ts",
    { react, "./chat-store": store, "./principal-browser-storage.mjs": privacy },
    { window: win },
  ).useAccountConversationHistory;
  const { Route } = loadUiModule(
    "src/routes/knowledge-graph.tsx",
    {
      "@tanstack/react-router": { createFileRoute: () => (x) => x, Link: "Link" },
      "@tanstack/react-start": { useServerFn: (fn) => fn },
      react,
      "lucide-react": { Clock3: "Clock3", Network: "Network", Search: "Search" },
      "@/components/AppShell": { AppShell: "AppShell" },
      "@/components/auth/ClerkSafe": { useUser: () => account },
      "@/lib/professional.functions": { listKnowledgeGraph: list },
      "@/lib/chat-store": {
        chatStoragePrincipal: store.chatStoragePrincipal,
        savePendingActive() {
          throw Error("No navigation mutation");
        },
      },
      "@/lib/use-account-conversation-history": { useAccountConversationHistory: useHistory },
      "@/lib/knowledge-history-nodes": { mergeKnowledgeHistoryNodes: merge },
    },
    { AbortController },
  );
  const inner = Route.component().type;
  return {
    hooks,
    pending,
    requests,
    payloads,
    render: () => hooks.render(inner),
    calls: () => calls,
    account,
  };
}
test("Actual Graph retains remote nodes, selection and filters through late hydration/rename/delete without remote refetch", async () => {
  const f = graphFixture(),
    a = view("A");
  try {
    f.render();
    f.pending.resolve({
      nodes: [
        {
          id: "project:1",
          kind: "project",
          label: "Project one",
          href: "/projects",
          updatedAt: "2026-01-01",
        },
      ],
      edges: [],
      cursors: { projects: "next" },
    });
    await settle();
    let tree = f.render();
    assert.match(text(tree), /Project one/);
    assert.equal(f.calls(), 1);
    a.publish([chat("chat1", "Hydrated chat")]);
    tree = f.render();
    assert.match(text(tree), /Hydrated chat/);
    const node = elements(
      tree,
      (n) => n.type === "g" && n.props["aria-label"] === "chat: Hydrated chat",
    )[0];
    node.props.onKeyDown({ key: "Enter" });
    a.publish([chat("chat1", "Renamed chat")]);
    tree = f.render();
    assert.match(text(tree), /Selected knowledge/);
    assert.ok(elements(tree, (n) => n.type === "h3").some((n) => text(n) === "Renamed chat"));
    const filter = elements(tree, (n) => n.type === "button" && text(n) === "chat")[0];
    filter.props.onClick();
    a.publish([chat("chat1", "Renamed again")]);
    tree = f.render();
    assert.equal(
      elements(tree, (n) => n.type === "g" && n.props["aria-label"]?.startsWith("chat:")).length,
      0,
    );
    assert.equal(f.calls(), 1);
    a.publish([]);
    tree = f.render();
    assert.match(text(tree), /Project one/);
    assert.equal(f.calls(), 1);
  } finally {
    f.hooks.unmount();
    a.remove();
  }
});
test("Graph ignores a remote response after unmount and owner history listeners are removed", async () => {
  const f = graphFixture(),
    a = view("A");
  f.render();
  f.hooks.unmount();
  f.pending.resolve({ nodes: [{ id: "late", kind: "project" }], edges: [], cursors: {} });
  a.publish([chat("late-chat")]);
  await settle();
  a.remove();
  assert.equal(f.calls(), 1);
});
test("Summary pinned/order/filter expressions and existing event contract/privacy fences remain unchanged", () => {
  const base = "0f47972ecae5cac12120e5bb5be38beb132c0418";
  const before = execFileSync("git", ["show", base + ":src/routes/summary.tsx"], {
      encoding: "utf8",
    }),
    now = readFileSync("src/routes/summary.tsx", "utf8");
  const section = (s) => s.slice(s.indexOf("  const pinned ="), s.indexOf("  // Server data"));
  assert.equal(section(now), section(before));
  assert.match(now, /useAccountConversationHistory\(userKey, isLoaded && Boolean\(isSignedIn\)\)/);
  for (const p of [
    "src/lib/chat-store.ts",
    "src/lib/chat-history-bridge.ts",
    "src/lib/principal-browser-storage.mjs",
  ])
    assert.equal(
      readFileSync(p, "utf8"),
      execFileSync("git", ["show", base + ":" + p], { encoding: "utf8" }),
    );
});

test("Graph uses latest history even when hydration and rename precede remote completion", async () => {
  const f = graphFixture(),
    a = view("A");
  try {
    f.render();
    a.publish([chat("early", "Before remote")]);
    f.render();
    a.publish([chat("early", "Latest rename")]);
    f.pending.resolve({
      nodes: [
        {
          id: "project:1",
          kind: "project",
          label: "Remote",
          href: "/projects",
          updatedAt: "2026-01-01",
        },
      ],
      edges: [],
      cursors: { projects: "page2" },
    });
    await settle();
    const tree = f.render();
    assert.match(text(tree), /Latest rename/);
    assert.doesNotMatch(text(tree), /Before remote/);
    assert.equal(f.calls(), 1);
  } finally {
    f.hooks.unmount();
    a.remove();
  }
});
test("Graph principal switch rejects old history and an in-flight old remote result", async () => {
  const f = graphFixture(),
    a = view("A"),
    b = view("B");
  try {
    f.render();
    a.publish([chat("privateA")]);
    f.account.user = { id: "B" };
    let tree = f.render();
    assert.doesNotMatch(text(tree), /privateA/);
    b.publish([chat("privateB")]);
    f.pending.resolve({
      nodes: [
        {
          id: "project:A",
          kind: "project",
          label: "Private project A",
          href: "/projects",
          updatedAt: "2026-01-01",
        },
      ],
      edges: [],
      cursors: {},
    });
    await settle();
    tree = f.render();
    assert.doesNotMatch(text(tree), /Private project A|privateA/);
    f.requests[1].resolve({
      nodes: [
        {
          id: "project:B",
          kind: "project",
          label: "Project B",
          href: "/projects",
          updatedAt: "2026-01-01",
        },
      ],
      edges: [],
      cursors: {},
    });
    await settle();
    tree = f.render();
    assert.match(text(tree), /Project B/);
    assert.match(text(tree), /privateB/);
    assert.doesNotMatch(text(tree), /Private project A|privateA/);
  } finally {
    f.hooks.unmount();
    a.remove();
    b.remove();
  }
});

test("Graph responds when an existing history array is updated before its change event", async () => {
  const f = graphFixture(),
    a = view("A");
  try {
    f.render();
    f.pending.resolve({ nodes: [], edges: [], cursors: {} });
    await settle();
    a.publish([chat("same", "Before")]);
    f.render();
    a.state.active[0].title = "After same-array rename";
    notifyChatHistoryChanged("A", "cloud");
    assert.match(text(f.render()), /After same-array rename/);
  } finally {
    f.hooks.unmount();
    a.remove();
  }
});
test("History updates preserve remote page cursors and explicit paging still requests the selected cursor", async () => {
  const f = graphFixture(),
    a = view("A");
  try {
    f.render();
    f.pending.resolve({
      nodes: [
        {
          id: "project:1",
          kind: "project",
          label: "Page one",
          href: "/projects",
          updatedAt: "2026-01-01",
        },
      ],
      edges: [],
      cursors: { projects: "next-project", library: "next-library" },
    });
    await settle();
    a.publish([chat("live")]);
    let tree = f.render();
    const next = elements(
      tree,
      (n) => n.type === "button" && /Next\s+projects\s+page/.test(text(n)),
    )[0];
    assert.equal(next.props.disabled, false);
    next.props.onClick();
    f.render();
    assert.equal(f.calls(), 2);
    assert.equal(f.payloads[1].cursors.projects, "next-project");
    f.requests[1].resolve({
      nodes: [
        {
          id: "project:2",
          kind: "project",
          label: "Page two",
          href: "/projects",
          updatedAt: "2026-01-01",
        },
      ],
      edges: [],
      cursors: {},
    });
    await settle();
    tree = f.render();
    assert.match(text(tree), /Page two/);
    assert.match(text(tree), /live/);
    assert.doesNotMatch(text(tree), /Page one/);
  } finally {
    f.hooks.unmount();
    a.remove();
  }
});

test("AppShell history, privacy, focus handlers survive header utility relocation", () => {
  const path = "src/components/AppShell.tsx";
  const prior = execFileSync("git", ["show", "ebd244977ac7250a291e71f08a1d802f383868c5:" + path], {
    encoding: "utf8",
  });
  const current = readFileSync(path, "utf8");
  assert.equal(shellLogic(current), shellLogic(prior));
  assert.deepEqual(eventAttributes(current), eventAttributes(prior));
});
