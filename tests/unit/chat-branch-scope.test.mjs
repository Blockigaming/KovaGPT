import assert from "node:assert/strict";
import test from "node:test";
import { createHookHarness, loadUiModule, deferred, settle } from "../helpers/ui-state-harness.mjs";
function fixture() {
  const hooks = createHookHarness(),
    reads = [],
    writes = [];
  let user = { id: "actor-a" },
    chat = "chat-a";
  const api = {
    listChatBranches: () => {
      const r = deferred();
      reads.push(r);
      return r.promise;
    },
    createChatBranch: ({ data }) => {
      const r = deferred();
      writes.push({ data, ...r });
      return r.promise;
    },
    activateChatBranch: async () => null,
  };
  const module = loadUiModule(
    "src/hooks/useChatBranches.ts",
    {
      react: { ...hooks.react, useMemo: (fn) => fn() },
      "@tanstack/react-start": { useServerFn: (fn) => fn },
      "@/components/auth/ClerkSafe": {
        useUser: () => ({ isLoaded: true, isSignedIn: true, user }),
      },
      "@/lib/chat-workspace.functions": api,
      "@/lib/local-chat-workspace.mjs": {
        activateLocalBranch() {},
        localBranches: () => [],
        saveLocalBranch() {},
      },
      "@/lib/principal-browser-storage.mjs": { safeBrowserStorage: () => null },
    },
    { Error },
  );
  let state;
  const render = () => (state = hooks.render(module.useChatBranches, chat));
  // Hook receives rootChatId as its first argument, which the harness forwards.
  render();
  return {
    reads,
    writes,
    render,
    get state() {
      return state;
    },
    scope(actor, nextChat = chat) {
      user = { id: actor };
      chat = nextChat;
      render();
    },
    unmount: () => hooks.unmount(),
  };
}
const row = (id) => ({ id, conversationId: id, label: id, active: true });
test("late branch reads cannot populate another signed-in account or chat", async () => {
  const f = fixture();
  f.scope("actor-b", "chat-b");
  f.reads[0].resolve([row("private-a")]);
  await settle();
  f.render();
  assert.equal(f.state.branches.length, 0);
  f.reads[1].resolve([row("visible-b")]);
  await settle();
  f.render();
  assert.equal(f.state.branches[0].id, "visible-b");
});
test("root creation completing after account change cannot dispatch child creation or return a private branch", async () => {
  const f = fixture();
  f.reads[0].resolve([]);
  await settle();
  f.render();
  const creation = f.state.createBranch({
    conversationId: "child",
    branchFromMessageId: "message",
  });
  assert.equal(f.writes.length, 1);
  f.scope("actor-b");
  f.writes[0].resolve(row("root-a"));
  await settle();
  if (f.writes[1]) f.writes[1].resolve(row("child-a"));
  await creation;
  await settle();
  f.render();
  assert.equal(f.writes.length, 1);
  assert.equal(f.state.branches.length, 0);
});

test("late branch mutation failure after account change does not leak an obsolete error", async () => {
  const f = fixture();
  f.reads[0].resolve([]);
  await settle();
  f.render();
  const creation = f.state.createBranch({
    conversationId: "child",
    branchFromMessageId: "message",
  });
  f.scope("actor-b");
  f.writes[0].reject(Error("Private old actor failure"));
  assert.equal(await creation, null);
});
