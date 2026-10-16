import assert from "node:assert/strict";
import test from "node:test";
import {
  createHookHarness,
  loadUiModule,
  elements,
  text,
  deferred,
  settle,
} from "../helpers/ui-state-harness.mjs";
function fixture() {
  const hooks = createHookHarness(),
    calls = [];
  const list = (options) => {
    const call = deferred();
    calls.push({ ...options, ...call });
    return call.promise;
  };
  const module = loadUiModule(
    "src/routes/knowledge-graph.tsx",
    {
      "@/lib/knowledge-history-nodes": loadUiModule("src/lib/knowledge-history-nodes.ts", {}),
      "@/lib/use-account-conversation-history": {
        useAccountConversationHistory: (owner, enabled) => {
          assert.equal(owner, "actor");
          assert.equal(enabled, true);
          return [];
        },
      },
      react: { ...hooks.react, useMemo: (fn) => fn() },
      "@tanstack/react-router": { createFileRoute: () => (value) => value, Link: "link" },
      "@tanstack/react-start": { useServerFn: (fn) => fn },
      "lucide-react": { Clock3: "clock", Network: "network", Search: "search" },
      "@/components/AppShell": { AppShell: "shell" },
      "@/components/auth/ClerkSafe": {
        useUser: () => ({ isLoaded: true, isSignedIn: true, user: { id: "actor" } }),
      },
      "@/lib/professional.functions": { listKnowledgeGraph: list },
      "@/lib/chat-store": {
        chatStoragePrincipal: (id) => id,
        loadConversations: () => [],
        savePendingActive() {},
      },
    },
    { AbortController, Error },
  );
  let tree;
  const render = () => {
    const outer = hooks.render(module.Route.component);
    tree = hooks.render(outer.type, outer.props);
    return tree;
  };
  render();
  render();
  return {
    calls,
    render,
    get tree() {
      return tree;
    },
    unmount: hooks.unmount,
  };
}
const graph = (label) => ({
  nodes: [
    {
      id: "project:p",
      kind: "project",
      label,
      href: "/projects/p",
      updatedAt: "2026-10-12T00:00:00Z",
    },
  ],
  edges: [],
  cursors: {
    projects: "next",
    chats: null,
    files: null,
    library: null,
    memories: null,
    packs: null,
  },
});
test("graph continuation changes one source and failed read retains the previous graph", async () => {
  const f = fixture();
  assert.equal(f.calls.length, 1);
  f.calls[0].resolve(graph("Known graph"));
  await settle();
  f.render();
  const next = elements(
    f.tree,
    (e) => e.type === "button" && /Next\s+projects\s+page/.test(text(e)),
  )[0];
  next.props.onClick();
  f.render();
  assert.equal(f.calls[1].data.cursors.projects, "next");
  f.calls[1].reject(Error("page offline"));
  await settle();
  f.render();
  assert.match(text(f.tree), /Known graph/);
  assert.match(text(f.tree), /Last loaded graph retained/);
});
test("unmount aborts pending graph read and its response cannot become visible", async () => {
  const f = fixture();
  f.unmount();
  assert.equal(f.calls[0].signal.aborted, true);
  f.calls[0].resolve(graph("Old scope"));
  await settle();
  assert.doesNotMatch(text(f.tree), /Old scope/);
});

test("Timeline keeps long unbroken resource title readable and destination unchanged without navigation", async () => {
  const f = fixture(),
    title = "Chat_" + "z".repeat(400);
  f.calls[0].resolve(graph(title));
  await settle();
  f.render();
  const timeline = elements(f.tree, (n) => n.type === "button" && /Timeline/.test(text(n)))[0];
  timeline.props.onClick();
  f.render();
  const list = elements(f.tree, (n) => n.props["aria-label"] === "Knowledge timeline")[0];
  const link = elements(list, (n) => n.type === "link")[0];
  assert.equal(text(link), title);
  assert.equal(link.props.to, "/projects/p");
  assert.match(link.props.className, /\[overflow-wrap:anywhere\]/);
  assert.doesNotMatch(link.props.className, /truncate/);
  assert.equal(f.calls.length, 1);
  f.unmount();
});
