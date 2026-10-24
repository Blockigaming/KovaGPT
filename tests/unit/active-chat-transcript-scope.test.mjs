import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createHookHarness,
  deferred,
  elements,
  loadUiModule,
  settle,
} from "../helpers/ui-state-harness.mjs";

// Execute the real transcript-to-branch-picker event path. Only storage/network,
// DOM anchoring and UI primitives are fixtures; this is not browser evidence.
function fixture({ unmountOnNavigate = false, createLocalBranch = false } = {}) {
  const transcriptHooks = createHookHarness();
  const pickerHooks = createHookHarness();
  const pending = deferred();
  const createPending = deferred();
  const navigations = [];
  const notices = [];
  const activations = [];
  const events = [];
  const creations = [];
  const conversationWrites = [];
  const toast = Object.fromEntries(
    ["success", "error", "message"].map((level) => [
      level,
      (message) => {
        notices.push([level, message]);
        events.push(["notice", level]);
      },
    ]),
  );
  const primitiveNames = [
    "DropdownMenu",
    "DropdownMenuContent",
    "DropdownMenuRadioGroup",
    "DropdownMenuRadioItem",
    "DropdownMenuLabel",
    "DropdownMenuSeparator",
    "DropdownMenuTrigger",
  ];
  const { ChatBranchBar } = loadUiModule("src/components/ChatBranchBar.tsx", {
    react: pickerHooks.react,
    "lucide-react": { Check: "Check", GitBranch: "GitBranch", Loader2: "Loader2" },
    sonner: { toast },
    "@/hooks/use-mobile": { useLayout: () => ({ isMobile: false }) },
    "@/components/MobileBottomSheet": { MobileBottomSheet: "MobileBottomSheet" },
    "@/components/ui/dropdown-menu": Object.fromEntries(primitiveNames.map((name) => [name, name])),
    "@/components/ui/popover": {
      Popover: "Popover",
      PopoverContent: "PopoverContent",
      PopoverTrigger: "PopoverTrigger",
    },
    "@/components/ui/searchable-picker": { SearchablePickerList: "SearchablePickerList" },
  });
  const active = {
    id: "chat-a",
    title: "Current chat",
    messages: [{ id: "message-a", role: "assistant", content: "Original response" }],
  };
  const target = {
    id: "branch-b",
    conversationId: "chat-b",
    active: false,
    label: "Another branch",
    branchFromMessageIndex: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    durable: true,
  };
  const branched = { ...active, id: "chat-new", title: "New branch" };
  const branchState = {
    branches: [target],
    activeBranch: null,
    loading: false,
    error: null,
    activate(id) {
      activations.push(id);
      return pending.promise;
    },
    createBranch(request) {
      creations.push(request);
      return createPending.promise;
    },
    refresh() {},
  };
  const { ActiveChatTranscript } = loadUiModule("src/components/ActiveChatTranscript.tsx", {
    react: {
      ...transcriptHooks.react,
      useLayoutEffect: transcriptHooks.react.useEffect,
    },
    "lucide-react": { Sliders: "Sliders" },
    sonner: { toast },
    "@/components/ChatMessage": { ChatMessage: "ChatMessage" },
    "@/components/ChatBranchBar": { ChatBranchBar },
    "@/hooks/useChatBranches": { useChatBranches: () => branchState },
    "@/lib/chat-store": {
      branchConversation(conversation, messageId) {
        assert.equal(createLocalBranch, true, "activation must not create a conversation");
        assert.equal(conversation, active);
        assert.equal(messageId, "message-a");
        return branched;
      },
    },
    "@/lib/chat-reading-anchor": {
      createTranscriptReadingAnchorController: () => ({ dispose() {} }),
    },
  });
  const scope = JSON.stringify(["owner-a", active.id, true]);
  const scrollRef = {
    current: { scrollHeight: 200, scrollTop: 0, clientHeight: 200, scrollTo() {} },
  };
  const transcriptScopeRef = { current: scope };
  function leave(reason, nextChat = "chat-c") {
    if (reason === "owner") {
      transcriptScopeRef.current = JSON.stringify(["owner-b", active.id, true]);
    } else if (reason === "chat") {
      transcriptScopeRef.current = JSON.stringify(["owner-a", nextChat, true]);
    }
    // The route keys the transcript by owner/chat/readiness. A scope change
    // therefore detaches its scroll DOM and unmounts this picker and transcript.
    scrollRef.current = null;
    pickerHooks.unmount();
    transcriptHooks.unmount();
    events.push(["unmount", reason]);
  }
  const transcript = transcriptHooks.render(ActiveChatTranscript, {
    active,
    conversations: [active, { id: target.conversationId, messages: [] }],
    setActiveId(id) {
      navigations.push(id);
      events.push(["navigate", id]);
      if (unmountOnNavigate) leave("chat", id);
    },
    setConversations(update) {
      assert.equal(createLocalBranch, true, "activation must not create a conversation");
      conversationWrites.push(update([active]));
    },
    isSignedIn: true,
    isStreaming: false,
    chatRulesActive: false,
    openChatWorkspace() {},
    scrollRef,
    nearBottomRef: { current: true },
    readingAnchorControllerRef: { current: null },
    transcriptScope: scope,
    transcriptScopeRef,
    setShowJumpToLatest() {},
    renderMessage: (_message, _index, _component, onBranch) => ({
      type: "branch-trigger",
      props: { onClick: onBranch },
    }),
  });
  const bar = elements(transcript, (node) => node.type === ChatBranchBar)[0];
  assert.ok(bar, "the real transcript must wire its activation handler to the branch picker");
  const picker = pickerHooks.render(ChatBranchBar, bar.props);
  const options = elements(picker, (node) => node.type === "DropdownMenuRadioGroup")[0];
  assert.ok(options, "the real picker must expose branch selection");
  return {
    activations,
    creations,
    conversationWrites,
    createPending,
    events,
    navigations,
    notices,
    pending,
    select: () => options.props.onValueChange(target.id),
    create: () => elements(transcript, (node) => node.type === "branch-trigger")[0].props.onClick(),
    leave,
  };
}

test("a new local branch reports a durable-save failure after its own navigation", async () => {
  const f = fixture({ unmountOnNavigate: true, createLocalBranch: true });
  f.create();
  assert.deepEqual(f.navigations, ["chat-new"]);
  assert.equal(f.conversationWrites.length, 1);
  assert.deepEqual(
    Array.from(f.conversationWrites[0], (conversation) => conversation.id),
    ["chat-new", "chat-a"],
  );
  assert.equal(f.creations.length, 1);
  assert.equal(f.creations[0].conversationId, "chat-new");
  assert.deepEqual(Array.from(f.creations[0].messageIds), ["message-a"]);
  f.createPending.reject(new Error("Durable branch save failed"));
  await settle();
  assert.deepEqual(
    f.notices.map(([level]) => level),
    ["success", "error"],
  );
});

for (const reason of ["owner", "chat"]) {
  test(`a durable branch-save rejection stays silent after external ${reason} change`, async () => {
    const f = fixture({ unmountOnNavigate: true, createLocalBranch: true });
    f.create();
    f.leave(reason);
    f.createPending.reject(new Error("Old durable branch save failed"));
    await settle();
    assert.deepEqual(f.navigations, ["chat-new"]);
    assert.deepEqual(f.notices, [["success", "Branched into a new chat"]]);
  });
}

test("transcript remount identity includes the owner, active chat and principal readiness", () => {
  const route = readFileSync("src/routes/index.tsx", "utf8");
  assert.match(
    route,
    /transcriptScope\s*=\s*JSON\.stringify\(\[storagePrincipal,\s*activeId,\s*principalReady\]\)/,
  );
  assert.match(route, /<ActiveChatTranscript\s+key=\{transcriptScope\}/);
});

test("current transcript branch activation navigates once and reports success", async () => {
  const f = fixture();
  f.select();
  assert.deepEqual(f.activations, ["branch-b"]);
  assert.deepEqual(f.navigations, []);
  f.pending.resolve();
  await settle();
  assert.deepEqual(f.navigations, ["chat-b"]);
  assert.deepEqual(f.notices, [["success", "Switched branch"]]);
  assert.deepEqual(f.events, [
    ["navigate", "chat-b"],
    ["notice", "success"],
  ]);
});

test("current transcript branch rejection reports an error without navigation", async () => {
  const f = fixture();
  f.select();
  f.pending.reject(new Error("Branch storage failed"));
  await settle();
  assert.deepEqual(f.navigations, []);
  assert.equal(f.notices.length, 1);
  assert.equal(f.notices[0][0], "error");
});

test("successful branch navigation reports success even when it unmounts the old picker before its continuation", async () => {
  const f = fixture({ unmountOnNavigate: true });
  f.select();
  f.pending.resolve();
  await settle();
  assert.deepEqual(f.navigations, ["chat-b"]);
  assert.deepEqual(f.notices, [["success", "Switched branch"]]);
  assert.deepEqual(f.events, [
    ["navigate", "chat-b"],
    ["unmount", "chat"],
    ["notice", "success"],
  ]);
});

for (const reason of ["owner", "chat", "unmount"]) {
  for (const outcome of ["resolve", "reject"]) {
    test(`delayed branch ${outcome} after ${reason} change cannot navigate or toast`, async () => {
      const f = fixture();
      f.select();
      assert.deepEqual(f.activations, ["branch-b"]);
      f.leave(reason);
      if (outcome === "resolve") f.pending.resolve();
      else f.pending.reject(new Error("Old branch request failed"));
      await settle();
      assert.deepEqual(f.navigations, []);
      assert.deepEqual(f.notices, []);
    });
  }
}
