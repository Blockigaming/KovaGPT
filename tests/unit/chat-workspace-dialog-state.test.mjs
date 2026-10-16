import { saveLocalRules as saveDeviceRules } from "../../src/lib/local-chat-workspace.mjs";
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
function fixture({
  libraryFails = false,
  rulesDeferred = false,
  paged = false,
  pinsDeferred = false,
  pinMutationDeferred = false,
  emptyPins = false,
  initialDraft = null,
  saveDeferred = false,
  guestStorageDenied = false,
} = {}) {
  const hooks = createHookHarness();
  const ruleRequest = deferred();
  const rulesSaveRequest = deferred();
  const drafts = [];
  const ruleWrites = [];
  const pinReadRequest = deferred();
  const pinMutationRequest = deferred();
  let pinCalls = 0;
  const notices = [];
  const pageRequests = [];
  const ruleStates = [];
  let user = guestStorageDenied ? null : { id: "account-a" };
  const functions = {
    getChatCustomRules: () =>
      rulesDeferred
        ? ruleRequest.promise
        : Promise.resolve({
            instructions: "Saved rule",
            enabled: true,
            updatedAt: "2026-10-12T00:00:00.000001Z",
          }),
    saveChatCustomRules: async ({ data }) => {
      ruleWrites.push(data);
      return saveDeferred ? rulesSaveRequest.promise : { updatedAt: "2026-10-12T00:00:00.000002Z" };
    },
    resetChatCustomRules: async () => ({ ok: true }),
    listChatPinnedFiles: async () =>
      pinsDeferred
        ? pinReadRequest.promise
        : emptyPins
          ? []
          : [{ id: "pin", sourceId: "file", sourceType: "library", status: "ready" }],
    pinChatFile: async () => {
      pinCalls++;
      return pinMutationDeferred
        ? pinMutationRequest.promise
        : { id: "pin", sourceId: "file", sourceType: "library", status: "ready" };
    },
    unpinChatFile: async () => ({ ok: true }),
  };
  const module = loadUiModule(
    "src/components/ChatWorkspaceDialog.tsx",
    {
      "@/lib/dialog-return-focus": loadUiModule("src/lib/dialog-return-focus.ts", {}),
      react: hooks.react,
      "lucide-react": { Loader2: "loader", Pin: "pin", PinOff: "unpin", Sliders: "sliders" },
      sonner: { toast: { success: (m) => notices.push(m), message: (m) => notices.push(m) } },
      "@tanstack/react-start": { useServerFn: (f) => f },
      "@/components/ui/dialog": {
        Dialog: "dialog",
        DialogContent: "content",
        DialogDescription: "description",
        DialogHeader: "header",
        DialogTitle: "title",
      },
      "@/components/auth/ClerkSafe": { useUser: () => ({ isSignedIn: Boolean(user), user }) },
      "@/lib/chat-workspace.functions": functions,
      "@/lib/library-items-client": {
        listLibraryPage: async (owner, query, signal) => {
          pageRequests.push({ owner, query, signal });
          assert.equal(owner, "account-a");
          assert.equal(query.folder, "all");
          if (libraryFails) throw Error("unavailable");
          return query.cursor
            ? { items: [{ id: "older", title: "Older file" }], cursor: null }
            : {
                items: [{ id: "file", title: "Real file" }],
                cursor: paged ? { id: "next" } : null,
              };
        },
      },
      "@/lib/local-chat-workspace.mjs": {
        clearLocalRules() {},
        localRules() {
          return null;
        },
        saveLocalRules(_storage, chatId, input) {
          if (guestStorageDenied) return saveDeviceRules(null, chatId, input);
        },
      },
      "@/lib/principal-browser-storage.mjs": { safeBrowserStorage: () => ({}) },
      "@/lib/chat-workspace-contract.mjs": {
        describePinStatus: () => "Available",
        MAX_RULES_LENGTH: 4000,
      },
    },
    { AbortController },
  );
  const props = {
    open: true,
    chatId: "chat-a",
    onOpenChange() {},
    onRulesActiveChange: (v) => ruleStates.push(v),
    initialRulesDraft: initialDraft,
    onRulesDraftChange: (value) => drafts.push(value),
  };
  let tree;
  let inner;
  function render() {
    const outer = hooks.render(module.ChatWorkspaceDialog, props);
    inner = typeof outer.type === "function" ? outer.type : module.ChatWorkspaceDialog;
    tree = inner === module.ChatWorkspaceDialog ? outer : hooks.render(inner, outer.props);
    return tree;
  }
  render();
  render();
  return {
    pageRequests,
    drafts,
    ruleWrites,
    rulesSaveRequest,
    pinReadRequest,
    pinMutationRequest,
    get pinCalls() {
      return pinCalls;
    },
    render,
    notices,
    ruleStates,
    ruleRequest,
    get tree() {
      return tree;
    },
    unmount: () => hooks.unmount(),
    outer(next = {}) {
      Object.assign(props, next);
      return hooks.render(module.ChatWorkspaceDialog, props);
    },
    actor(value) {
      user = value;
    },
    tab(value) {
      elements(tree, (e) => e.props.role === "tab" && text(e) === value)[0].props.onClick();
      render();
    },
  };
}
test("Library read failure stays unavailable while loaded chat pins remain usable", async () => {
  const f = fixture({ libraryFails: true });
  await settle();
  f.render();
  f.tab("Pinned files");
  assert.match(text(f.tree), /Library choices could not be loaded/);
  assert.doesNotMatch(text(f.tree), /Your library is empty/);
  assert.match(text(f.tree), /Available/);
});
test("late rules read after dialog scope unmount cannot update parent state", async () => {
  const f = fixture({ rulesDeferred: true });
  f.unmount();
  f.ruleRequest.resolve({ instructions: "Private prior chat", enabled: true });
  await settle();
  assert.deepEqual(f.ruleStates, []);
});
test("dialog lifecycle identity changes for account, chat, temporary mode and close", () => {
  const f = fixture();
  let previous = f.outer().key;
  for (const next of [{ chatId: "chat-b" }, { temporary: true }, { open: false }]) {
    const key = f.outer(next).key;
    assert.notEqual(key, previous);
    previous = key;
  }
  f.actor({ id: "account-b" });
  assert.notEqual(f.outer().key, previous);
});

test("chat Library chooser reaches older metadata pages and searches through existing API", async () => {
  const f = fixture({ paged: true });
  await settle();
  f.render();
  f.tab("Pinned files");
  const more = elements(
    f.tree,
    (e) => e.type === "button" && text(e) === "Load more Library items",
  )[0];
  assert.ok(more);
  more.props.onClick();
  await settle();
  f.render();
  assert.match(text(f.tree), /Older file/);
  assert.equal(f.pageRequests.length, 2);
  assert.equal(f.pageRequests[1].query.cursor.id, "next");
  elements(f.tree, (e) => e.props.id === "chat-library-query")[0].props.onChange({
    target: { value: "specific" },
  });
  f.render();
  await settle();
  f.render();
  assert.equal(f.pageRequests.at(-1).query.query, "specific");
  assert.equal(f.pageRequests.at(-1).query.cursor, null);
  assert.doesNotMatch(text(f.tree), /Older file/);
});

test("pin cannot race the initial pin read even when Library metadata arrives first", async () => {
  const f = fixture({ pinsDeferred: true });
  await settle();
  f.render();
  f.tab("Pinned files");
  const button = () =>
    elements(f.tree, (e) => e.type === "button" && text(e).trim() === "Real file")[0];
  assert.ok(button());
  await button().props.onClick();
  assert.equal(f.pinCalls, 0);
  assert.equal(button().props.disabled, true);
  f.pinReadRequest.resolve([]);
  await settle();
  f.render();
  assert.equal(button().props.disabled, false);
  await button().props.onClick();
  f.render();
  assert.equal(f.pinCalls, 1);
  assert.match(text(f.tree), /Available/);
});
test("late pin mutation after account/chat scope unmount cannot notify or populate new state", async () => {
  const f = fixture({ emptyPins: true, pinMutationDeferred: true });
  await settle();
  f.render();
  f.tab("Pinned files");
  const pending = elements(
    f.tree,
    (e) => e.type === "button" && text(e).trim() === "Real file",
  )[0].props.onClick();
  assert.equal(f.pinCalls, 1);
  f.unmount();
  f.pinMutationRequest.resolve({
    id: "pin",
    sourceId: "file",
    sourceType: "library",
    status: "ready",
  });
  await pending;
  assert.deepEqual(f.notices, []);
});

test("closing and remounting chat settings retains the workspace-owned unsaved draft", async () => {
  const first = fixture();
  await settle();
  first.render();
  elements(first.tree, (e) => e.props.id === "chat-rules")[0].props.onChange({
    target: { value: "Unsaved rules" },
  });
  first.render();
  const draft = first.drafts.at(-1);
  first.unmount();
  const reopened = fixture({ initialDraft: draft });
  await settle();
  reopened.render();
  assert.equal(
    elements(reopened.tree, (e) => e.props.id === "chat-rules")[0].props.value,
    "Unsaved rules",
  );
  assert.match(text(reopened.tree), /Unsaved rules/);
});
test("an earlier rules save acknowledgement preserves newer cached typing", async () => {
  const f = fixture({ saveDeferred: true });
  await settle();
  f.render();
  const edit = (value) => {
    elements(f.tree, (e) => e.props.id === "chat-rules")[0].props.onChange({ target: { value } });
    f.render();
  };
  edit("Submitted");
  const save = elements(
    f.tree,
    (e) => e.type === "button" && text(e).trim() === "Save rules",
  )[0].props.onClick();
  edit("Newer");
  f.rulesSaveRequest.resolve({ updatedAt: "2026-10-12T00:00:00.000002Z" });
  await save;
  await settle();
  f.render();
  assert.equal(f.drafts.at(-1).instructions, "Newer");
  assert.equal(elements(f.tree, (e) => e.props.id === "chat-rules")[0].props.value, "Newer");
});

test("close and reopen saves carry the same captured revision so reverse completion cannot authorize both writes", async () => {
  const first = fixture({ saveDeferred: true });
  await settle();
  first.render();
  elements(first.tree, (e) => e.type === "textarea")[0].props.onChange({
    target: { value: "Older request" },
  });
  first.render();
  elements(
    first.tree,
    (e) => e.type === "button" && text(e).trim() === "Save rules",
  )[0].props.onClick();
  first.unmount();
  const second = fixture({
    saveDeferred: true,
    initialDraft: { instructions: "Newer request", enabled: true },
  });
  await settle();
  second.render();
  elements(
    second.tree,
    (e) => e.type === "button" && text(e).trim() === "Save rules",
  )[0].props.onClick();
  assert.equal(first.ruleWrites[0].expectedUpdatedAt, "2026-10-12T00:00:00.000001Z");
  assert.equal(second.ruleWrites[0].expectedUpdatedAt, first.ruleWrites[0].expectedUpdatedAt);
  second.rulesSaveRequest.resolve({ updatedAt: "2026-10-12T00:00:00.000002Z" });
  await settle();
  second.render();
  first.rulesSaveRequest.reject(Error("Rules changed"));
  await settle();
  assert.equal(first.notices.length, 0);
  assert.equal(elements(second.tree, (e) => e.type === "textarea")[0].props.value, "Newer request");
});
test("uncertain rules outcome blocks repeat save until explicit review and keeps draft", async () => {
  const f = fixture({ saveDeferred: true });
  await settle();
  f.render();
  elements(f.tree, (e) => e.type === "textarea")[0].props.onChange({
    target: { value: "Preserved draft" },
  });
  f.render();
  elements(
    f.tree,
    (e) => e.type === "button" && text(e).trim() === "Save rules",
  )[0].props.onClick();
  f.rulesSaveRequest.reject(Error("Unknown outcome"));
  await settle();
  f.render();
  const button = elements(f.tree, (e) => e.type === "button" && text(e).trim() === "Save rules")[0];
  assert.equal(button.props.disabled, true);
  button.props.onClick();
  assert.equal(f.ruleWrites.length, 1);
  assert.equal(elements(f.tree, (e) => e.type === "textarea")[0].props.value, "Preserved draft");
  elements(
    f.tree,
    (e) => e.type === "button" && text(e).trim() === "Review saved rules",
  )[0].props.onClick();
  await settle();
  f.render();
  assert.match(text(f.tree), /Latest saved rules/);
  assert.equal(elements(f.tree, (e) => e.type === "textarea")[0].props.value, "Preserved draft");
});

test("guest storage failure retains unsaved rules and never claims a device save", async () => {
  const f = fixture({
    guestStorageDenied: true,
    initialDraft: { instructions: "Do not lose this", enabled: true },
  });
  await settle();
  f.render();
  elements(
    f.tree,
    (e) => e.type === "button" && text(e).trim() === "Save rules",
  )[0].props.onClick();
  await settle();
  f.render();
  assert.equal(f.notices.length, 0);
  assert.equal(elements(f.tree, (e) => e.type === "textarea")[0].props.value, "Do not lose this");
  assert.match(text(f.tree), /Unsaved rules/);
});
