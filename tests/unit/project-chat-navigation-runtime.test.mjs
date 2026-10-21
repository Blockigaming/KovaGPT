import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import {
  createHookHarness,
  elements,
  text,
  deferred,
  settle,
  loadUiModule,
} from "../helpers/ui-state-harness.mjs";

const { PROJECT_CHAT_DELETE_UNAVAILABLE } = loadUiModule("src/lib/project-chat-deletion.ts", {});
const detailSource = readFileSync("src/routes/projects.$projectId.chat.$chatId.tsx", "utf8");
const projectSource = readFileSync("src/routes/projects.$projectId.tsx", "utf8");
const React = {
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
};
function compile(source, dependencies) {
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  return new Function(...Object.keys(dependencies), js)(...Object.values(dependencies));
}
const names = [
  "AppShell",
  "ChatInput",
  "ChatMessage",
  "Button",
  "Input",
  "Link",
  "SignInButton",
  "Dialog",
  "DialogContent",
  "DialogDescription",
  "DialogFooter",
  "DialogHeader",
  "DialogTitle",
  "AlertDialog",
  "AlertDialogAction",
  "AlertDialogCancel",
  "AlertDialogContent",
  "AlertDialogDescription",
  "AlertDialogFooter",
  "AlertDialogHeader",
  "AlertDialogTitle",
  "AlertDialogTrigger",
  "ArrowLeft",
  "Loader2",
  "Trash2",
  "Plus",
  "MessageCircle",
  "FolderInput",
  "EmptyState",
  "ConfirmDialog",
];
const components = Object.fromEntries(names.map((name) => [name, name]));
function baseHarness() {
  const h = createHookHarness();
  const writes = [];
  let alive = true;
  const useState = h.react.useState;
  h.react.useState = (initial) => {
    const [value, setValue] = useState(initial);
    return [
      value,
      (next) => {
        writes.push({ alive });
        setValue(next);
      },
    ];
  };
  h.react.useMemo = (factory, deps) => {
    const ref = h.react.useRef(null);
    if (!ref.current || deps.some((value, index) => !Object.is(value, ref.current.deps[index])))
      ref.current = { deps, value: factory() };
    return ref.current.value;
  };
  const auth = { user: { id: "owner-a" }, isLoaded: true, isSignedIn: true };
  const errors = [],
    successes = [],
    navigations = [],
    requests = {};
  const request = (name) => {
    requests[name] = [];
    return (args) => {
      const pending = deferred();
      requests[name].push({ ...pending, args });
      return pending.promise;
    };
  };
  return {
    h,
    auth,
    errors,
    successes,
    navigations,
    requests,
    request,
    writes,
    dependencies: {
      React,
      PROJECT_CHAT_DELETE_UNAVAILABLE,
      ...h.react,
      ...components,
      useUser: () => auth,
      useServerFn: (fn) => fn,
      useNavigate: () => (value) => navigations.push(value),
      toast: { error: (value) => errors.push(value), success: (value) => successes.push(value) },
    },
    unmount() {
      alive = false;
      h.unmount();
    },
  };
}
function chatFixture(storage = new Map()) {
  const b = baseHarness();
  const params = { projectId: "project-a", chatId: "chat-a" };
  const blocker = { status: "idle", proceed() {}, reset() {} };
  let blockOptions,
    storageUnavailable = false;
  const key = (user, object) => JSON.stringify([user, object]);
  const fetchRequest = b.request("generate");
  const consumeRequest = b.request("stream");
  const component = compile(
    `${detailSource.slice(detailSource.indexOf("function isAbortError"))}\nreturn ProjectChatPage;`,
    {
      ...b.dependencies,
      Route: { useParams: () => params },
      useBlocker: (options) => {
        blockOptions = options;
        return blocker;
      },
      loadDraft: (user, object) => {
        if (storageUnavailable) throw new Error("storage unavailable");
        return storage.get(key(user, object)) ?? "";
      },
      saveDraft: (user, object, value) => {
        if (storageUnavailable) throw new Error("storage full");
        if (value) storage.set(key(user, object), value);
        else storage.delete(key(user, object));
      },
      getProjectChat: b.request("chat"),
      getProject: b.request("project"),
      saveProjectChat: b.request("save"),
      deleteProjectChat: b.request("delete"),
      authFetch: (url, args) => {
        assert.equal(url, "/api/chat");
        return fetchRequest(args);
      },
      consumeChatSse: (body, options) => consumeRequest(options),
      chatResponseError: async () => new Error("request failed"),
      normalizeResponseSources: (value) => value,
      AbortController,
      crypto: { randomUUID: () => "fixture-request" },
      Intl,
    },
  );
  let tree;
  const render = () => {
    b.h.render(component);
    tree = b.h.render(component);
    return tree;
  };
  const find = (predicate) => elements(tree, predicate);
  const composer = () => find((node) => node.type === "ChatInput")[0];
  async function finishLoad(
    { role = "owner", chatProject = params.projectId, project = true } = {},
    index = b.requests.chat.length - 1,
  ) {
    b.requests.chat[index].resolve({
      id: params.chatId,
      project_id: chatProject,
      title: `Title ${params.chatId}`,
      snapshot: {
        messages: [
          { role: "system", content: "hidden system" },
          { role: "user", content: "Earlier question" },
        ],
      },
    });
    b.requests.project[index].resolve(
      project
        ? {
            id: params.projectId,
            name: `Name ${params.projectId}`,
            role,
            system_prompt: "Actual loaded project instructions",
          }
        : null,
    );
    await settle();
    render();
  }
  async function streamResponse({ fail = false } = {}) {
    b.requests.generate.at(-1).resolve({ ok: true, body: {} });
    await settle();
    const stream = b.requests.stream.at(-1);
    if (fail) stream.reject(new Error("connection interrupted"));
    else {
      stream.args.onEvent({ choices: [{ delta: { content: "Answer" } }] });
      stream.resolve();
    }
    await settle();
    render();
  }
  render();
  return {
    ...b,
    params,
    storage,
    blocker,
    render,
    find,
    composer,
    finishLoad,
    streamResponse,
    text: () => text(tree),
    blockOptions: () => blockOptions,
    type(value) {
      composer().props.onChange(value);
      render();
    },
    setStorageUnavailable(value) {
      storageUnavailable = value;
    },
    draftKey: (user = b.auth.user.id, projectId = params.projectId, chatId = params.chatId) =>
      key(user, `project-chat:${JSON.stringify([projectId, chatId])}`),
  };
}

test("project-chat drafts follow principal, project and chat through navigation and remount", async () => {
  const f = chatFixture();
  await f.finishLoad();
  f.type("Draft A");
  assert.equal(f.storage.get(f.draftKey()), "Draft A");
  assert.equal(
    f.blockOptions().shouldBlockFn(),
    false,
    "durably saved ordinary text does not block navigation",
  );
  f.params.chatId = "chat-b";
  f.render();
  await f.finishLoad();
  assert.equal(f.composer().props.value, "");
  f.type("Draft B");
  f.params.chatId = "chat-a";
  f.render();
  await f.finishLoad();
  assert.equal(f.composer().props.value, "Draft A");
  f.params.projectId = "project-b";
  f.render();
  await f.finishLoad();
  assert.equal(
    f.composer().props.value,
    "",
    "the same chat id in another project cannot adopt the draft",
  );
  f.auth.user = { id: "owner-b" };
  f.params.projectId = "project-a";
  f.render();
  await f.finishLoad();
  assert.equal(f.composer().props.value, "");
  f.type("Owner B draft");
  f.auth.isSignedIn = false;
  f.auth.user = null;
  f.render();
  assert.equal(f.composer(), undefined);
  assert.doesNotMatch(f.text(), /Draft A|Owner B draft/);
  f.unmount();
  const restored = chatFixture(f.storage);
  await restored.finishLoad();
  assert.equal(
    restored.composer().props.value,
    "Draft A",
    "refresh/remount uses the existing draft storage contract",
  );
});

test("project-chat storage failure retains text and protects navigation/reload", async () => {
  const f = chatFixture();
  await f.finishLoad();
  f.setStorageUnavailable(true);
  f.type("Keep this text");
  assert.equal(f.composer().props.value, "Keep this text");
  assert.equal(f.blockOptions().shouldBlockFn(), true);
  assert.equal(f.blockOptions().enableBeforeUnload, true);
  assert.match(f.text(), /browser storage is unavailable/i);
  f.setStorageUnavailable(false);
  f.type("Saved now");
  assert.equal(f.blockOptions().shouldBlockFn(), false);
});

for (const outcome of ["success", "generation failure", "save failure", "new typing"]) {
  test(`project-chat ${outcome} preserves the correct draft and serializes sends`, async () => {
    const f = chatFixture();
    await f.finishLoad();
    f.type("Original draft");
    const submit = f.composer().props.onSubmit;
    const sending = submit();
    void submit();
    f.render();
    assert.equal(f.requests.generate.length, 1);
    assert.equal(
      f.storage.get(f.draftKey()),
      "Original draft",
      "do not clear recovery text before response persistence",
    );
    assert.equal(f.composer().props.value, "");
    assert.equal(f.blockOptions().shouldBlockFn(), true);
    const payload = JSON.parse(f.requests.generate[0].args.body);
    assert.equal(payload.projectId, "project-a");
    assert.deepEqual(payload.messages, [
      { role: "user", content: "Earlier question" },
      { role: "user", content: "Original draft" },
    ]);
    assert.equal(payload.attachments, undefined);
    if (outcome === "new typing") f.type("Next draft");
    await f.streamResponse({ fail: outcome === "generation failure" });
    if (outcome === "save failure") f.requests.save[0].reject(new Error("save rejected"));
    else f.requests.save[0].resolve({ ok: true });
    await sending;
    f.render();
    const expected =
      outcome === "success" ? "" : outcome === "new typing" ? "Next draft" : "Original draft";
    assert.equal(f.composer().props.value, expected);
    assert.equal(f.storage.get(f.draftKey()) ?? "", expected);
    assert.equal(f.composer().props.isStreaming, false);
  });
}

for (const boundary of ["account", "project", "chat", "sign-out", "unmount"]) {
  test(`pending project-chat generation cannot save or update after ${boundary}`, async () => {
    const f = chatFixture();
    await f.finishLoad();
    f.type("Scoped draft");
    const sending = f.composer().props.onSubmit();
    if (boundary === "account") f.auth.user = { id: "owner-b" };
    if (boundary === "project") f.params.projectId = "project-b";
    if (boundary === "chat") f.params.chatId = "chat-b";
    if (boundary === "sign-out") {
      f.auth.isSignedIn = false;
      f.auth.user = null;
    }
    if (boundary === "unmount") f.unmount();
    else f.render();
    const writes = f.writes.length;
    f.requests.generate[0].reject(new Error("late error"));
    await sending;
    assert.equal(f.requests.save.length, 0);
    assert.equal(f.writes.length, writes);
    assert.equal(f.errors.length, 0);
    assert.equal(f.storage.get(f.draftKey("owner-a", "project-a", "chat-a")), "Scoped draft");
  });
}

test("project-chat breadcrumbs and read-only Context expose actual authorized data for all roles", async () => {
  for (const role of ["owner", "editor", "viewer"]) {
    const f = chatFixture();
    await f.finishLoad({ role });
    const links = f.find((node) => node.type === "Link");
    assert.ok(links.some((node) => node.props.to === "/projects" && text(node) === "Projects"));
    assert.ok(
      links.some(
        (node) => node.props.to === "/projects/$projectId" && text(node).includes("Name project-a"),
      ),
    );
    assert.match(text(f.find((node) => node.props["aria-current"] === "page")[0]), /Title chat-a/);
    const context = f.composer().props.readOnlyContext;
    assert.match(context.description, /Name project-a/);
    for (const heading of [
      "Project instructions",
      "Files",
      "Saved results",
      "Conversation context",
      "Actual loaded project instructions",
    ])
      assert.ok(text(context.content).includes(heading));
    assert.match(text(context.content), /Exact excerpts and readiness are not loaded here/);
    assert.equal(f.composer().props.showAddMenu, false);
    assert.equal(f.composer().props.disabled, role === "viewer");
  }
});

test("missing or moved project chats fail closed and stale load results cannot leak context", async () => {
  for (const options of [{ project: false }, { chatProject: "other-project" }]) {
    const f = chatFixture();
    await f.finishLoad(options);
    assert.equal(f.composer(), undefined);
    assert.match(f.text(), /unavailable/);
  }
  const f = chatFixture();
  f.auth.user = { id: "owner-b" };
  f.render();
  const writes = f.writes.length;
  f.requests.chat[0].resolve({
    title: "Private old chat",
    project_id: "project-a",
    snapshot: { messages: [] },
  });
  f.requests.project[0].resolve({ id: "project-a", name: "Old private project", role: "owner" });
  await settle();
  assert.equal(f.writes.length, writes);
  f.render();
  assert.doesNotMatch(f.text(), /Private old chat|Old private project/);
});

function moveFixture() {
  const b = baseHarness();
  const focusRequests = [],
    focused = [];
  const props = {
    projectId: "project-a",
    canEdit: true,
    chats: [{ id: "chat-a", title: "Shared chat", updated_at: "2026-10-19T00:00:00Z" }],
    onRefresh: async () => {
      refreshes++;
    },
    onMoveFocusRequest(source) {
      const request = { source, completed: 0, cancelled: 0 };
      focusRequests.push(request);
      return {
        complete() {
          request.completed++;
        },
        cancel() {
          request.cancelled++;
        },
      };
    },
  };
  let refreshes = 0;
  const source = projectSource.slice(
    projectSource.indexOf("function ChatsTab("),
    projectSource.indexOf("// ===================== FILES / IMAGES"),
  );
  const component = compile(`${source}\nreturn ChatsTab;`, {
    ...b.dependencies,
    createProjectChat: b.request("create"),
    deleteProjectChat: b.request("delete"),
    listProjects: b.request("list"),
    moveChatToProject: b.request("move"),
  });
  let tree;
  const render = () => {
    b.h.render(component, props);
    tree = b.h.render(component, props);
  };
  const find = (predicate) => elements(tree, predicate);
  const button = (label) => find((node) => node.type === "Button" && text(node) === label)[0];
  const trigger = {
    isConnected: true,
    disabled: false,
    focus() {
      focused.push("row Move");
    },
  };
  render();
  return {
    ...b,
    props,
    render,
    find,
    button,
    focusRequests,
    focused,
    text: () => text(tree),
    refreshes: () => refreshes,
    open() {
      find((node) => node.props["aria-label"] === "Move Shared chat to project")[0].props.onClick({
        currentTarget: trigger,
      });
      render();
    },
    async finishList(rows, index = b.requests.list.length - 1) {
      b.requests.list[index].resolve(rows);
      await settle();
      render();
    },
    choose(id) {
      find((node) => node.type === "input" && node.props.value === id)[0].props.onChange();
      render();
    },
  };
}
const destinations = (count = 2) =>
  Array.from({ length: count }, (_, index) => ({
    id: `destination-${index}`,
    name: `Destination ${index}`,
    role: "editor",
    deletion_requested_at: null,
    archived_at: null,
  }));

test("Move to project is a 44px pointer control with searchable eligible destinations and confirmed refresh", async () => {
  const f = moveFixture();
  const trigger = f.find((node) => node.props["aria-label"] === "Move Shared chat to project")[0];
  assert.match(trigger.props.className, /h-11 w-11/);
  f.open();
  await f.finishList([
    ...destinations(8),
    { id: "project-a", role: "owner", name: "Current" },
    { id: "viewer", role: "viewer", name: "View only" },
    { id: "deleted", role: "owner", name: "Deleting", deletion_requested_at: "today" },
  ]);
  assert.equal(f.find((node) => node.type === "input").length, 8);
  const search = f.find((node) => node.props["aria-label"] === "Search destination projects")[0];
  assert.ok(search);
  search.props.onChange({ target: { value: "Destination 7" } });
  f.render();
  assert.equal(f.find((node) => node.type === "input").length, 1);
  f.choose("destination-7");
  const submit = f.button("Move chat").props.onClick;
  const pending = submit();
  void submit();
  assert.equal(f.requests.move.length, 1);
  assert.deepEqual(f.requests.move[0].args, {
    data: { chat_id: "chat-a", project_id: "destination-7" },
  });
  assert.equal(f.refreshes(), 0);
  f.requests.move[0].resolve({ ok: true });
  await pending;
  f.render();
  assert.equal(f.refreshes(), 1);
  assert.equal(f.successes.length, 1);
  assert.equal(f.focusRequests.length, 1);
  assert.equal(f.focusRequests[0].completed, 1);
  assert.equal(f.focusRequests[0].cancelled, 0);
});

test("successful Move suppresses obsolete dialog return and completes parent focus after refresh unmount", async () => {
  const f = moveFixture();
  f.open();
  await f.finishList(destinations());
  f.choose("destination-0");
  const close = f.find((node) => node.type === "DialogContent")[0].props.onCloseAutoFocus;
  const refreshed = deferred();
  f.props.onRefresh = async () => {
    f.unmount();
    await refreshed.promise;
  };
  f.render();
  const submit = {};
  const pending = f.button("Move chat").props.onClick({ currentTarget: submit });
  f.requests.move[0].resolve({ ok: true });
  await settle();
  assert.equal(f.focusRequests[0].source, submit);
  assert.equal(f.focusRequests[0].completed, 0);
  let prevented = false;
  close({
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(f.focused.length, 0);
  refreshed.resolve();
  await pending;
  assert.equal(f.focusRequests[0].completed, 1);
  assert.equal(f.focusRequests[0].cancelled, 0);
  assert.equal(f.writes.filter((write) => !write.alive).length, 0);
});

test("ordinary Move Cancel retains original row-focus return without success focus intent", async () => {
  const f = moveFixture();
  f.open();
  await f.finishList(destinations());
  const close = f.find((node) => node.type === "DialogContent")[0].props.onCloseAutoFocus;
  f.button("Cancel").props.onClick();
  f.render();
  close({ preventDefault() {} });
  assert.deepEqual(f.focused, ["row Move"]);
  assert.equal(f.focusRequests.length, 0);
});

test("move failure retains target, selected destination and search; loading failure offers retry", async () => {
  const f = moveFixture();
  f.open();
  f.requests.list[0].reject(new Error("offline"));
  await settle();
  f.render();
  assert.match(f.text(), /Projects could not be loaded/);
  f.button("Retry loading projects").props.onClick();
  await f.finishList(destinations());
  assert.equal(
    f.find((node) => node.props["aria-label"] === "Search destination projects").length,
    0,
  );
  f.choose("destination-1");
  const pending = f.button("Move chat").props.onClick();
  f.requests.move[0].reject(new Error("denied"));
  await pending;
  f.render();
  assert.equal(f.refreshes(), 0);
  assert.equal(f.successes.length, 0);
  assert.match(f.text(), /move could not be confirmed/);
  assert.equal(
    f.find((node) => node.type === "input" && node.props.value === "destination-1")[0].props
      .checked,
    true,
  );
  assert.ok(f.find((node) => node.type === "Dialog" && node.props.open).length);
  assert.equal(f.focusRequests[0].completed, 0);
  assert.equal(f.focusRequests[0].cancelled, 1);
});

for (const boundary of ["account", "project", "sign-out", "unmount"]) {
  for (const stage of ["destinations", "move"]) {
    test(`stale ${stage} after ${boundary} cannot update project-chat move UI`, async () => {
      const f = moveFixture();
      f.open();
      let pending;
      if (stage === "move") {
        await f.finishList(destinations());
        f.choose("destination-0");
        pending = f.button("Move chat").props.onClick();
      }
      if (boundary === "account") f.auth.user = { id: "owner-b" };
      if (boundary === "project") f.props.projectId = "project-b";
      if (boundary === "sign-out") {
        f.auth.user = null;
        f.auth.isSignedIn = false;
      }
      if (boundary === "unmount") f.unmount();
      else f.render();
      const writes = f.writes.length;
      if (stage === "destinations") f.requests.list[0].resolve(destinations());
      else f.requests.move[0].resolve({ ok: true });
      if (pending) await pending;
      else await settle();
      assert.equal(f.writes.length, writes);
      assert.equal(f.refreshes(), 0);
      assert.equal(f.successes.length, 0);
    });
  }
}

test("viewers have no move control and cancellation invalidates destination results", async () => {
  const f = moveFixture();
  f.props.canEdit = false;
  f.render();
  assert.equal(
    f.find((node) => node.props["aria-label"] === "Move Shared chat to project").length,
    0,
  );
  f.props.canEdit = true;
  f.render();
  f.open();
  f.find((node) => node.type === "Dialog" && node.props.open)[0].props.onOpenChange(false);
  f.render();
  const writes = f.writes.length;
  f.requests.list[0].resolve(destinations());
  await settle();
  assert.equal(f.writes.length, writes);
});

for (const role of ["owner", "editor"]) {
  test(`project-chat ${role} sees disabled deletion with a visible accessible recovery explanation`, async () => {
    const f = chatFixture();
    await f.finishLoad({ role });
    f.type("Keep my draft");
    const button = f.find(
      (node) => node.props["aria-label"] === "Delete Title chat-a unavailable",
    )[0];
    assert.equal(button.props.disabled, true);
    assert.equal(button.props.onClick, undefined);
    const description = f.find((node) => node.props.id === button.props["aria-describedby"])[0];
    assert.equal(text(description), PROJECT_CHAT_DELETE_UNAVAILABLE);
    assert.equal(button.props.title, PROJECT_CHAT_DELETE_UNAVAILABLE);
    assert.equal(
      f.find((node) => node.type === "AlertDialog" && text(node).includes("Delete “")).length,
      0,
    );
    assert.equal(f.requests.delete.length, 0);
    assert.equal(f.composer().props.value, "Keep my draft");
    assert.equal(f.storage.get(f.draftKey()), "Keep my draft");
    assert.equal(f.navigations.length, 0);
  });
}

test("project chat list deletion is unavailable without a delete callback or misleading confirmation", () => {
  const f = moveFixture();
  const originalChats = JSON.stringify(f.props.chats);
  const button = f.find((node) => node.props["aria-label"] === "Delete Shared chat unavailable")[0];
  assert.equal(button.props.disabled, true);
  assert.equal(button.props.onClick, undefined);
  assert.equal(
    text(f.find((node) => node.props.id === button.props["aria-describedby"])[0]),
    PROJECT_CHAT_DELETE_UNAVAILABLE,
  );
  assert.equal(f.find((node) => node.type === "ConfirmDialog").length, 0);
  assert.equal(f.requests.delete.length, 0);
  assert.equal(JSON.stringify(f.props.chats), originalChats);
  assert.equal(f.refreshes(), 0);
  f.props.canEdit = false;
  f.render();
  assert.equal(
    f.find((node) => node.props["aria-label"] === "Delete Shared chat unavailable").length,
    0,
  );
});

test("stopping a response preserves submitted ordinary text after saving the partial history", async () => {
  const f = chatFixture();
  await f.finishLoad();
  f.type("Keep interrupted text");
  const pending = f.composer().props.onSubmit();
  f.render();
  f.requests.generate[0].resolve({ ok: true, body: {} });
  await settle();
  f.composer().props.onStop();
  assert.equal(f.requests.generate[0].args.signal.aborted, true);
  const error = new Error("stopped");
  error.name = "AbortError";
  f.requests.stream[0].reject(error);
  await settle();
  f.requests.save[0].resolve({ ok: true });
  await pending;
  f.render();
  assert.equal(f.composer().props.value, "Keep interrupted text");
  assert.equal(f.storage.get(f.draftKey()), "Keep interrupted text");
  assert.equal(f.errors.length, 0);
});

test("destination loads from a dismissed move dialog cannot replace a new dialog", async () => {
  const f = moveFixture();
  f.open();
  f.find((node) => node.type === "Dialog" && node.props.open)[0].props.onOpenChange(false);
  f.render();
  f.open();
  await f.finishList(destinations(), 1);
  const writes = f.writes.length;
  f.requests.list[0].reject(new Error("old error"));
  await settle();
  assert.equal(f.writes.length, writes);
  f.render();
  assert.doesNotMatch(f.text(), /Projects could not be loaded/);
});
