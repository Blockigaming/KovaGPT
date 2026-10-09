import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  createHookHarness,
  deferred,
  elements,
  loadUiModule,
  settle,
  text,
} from "../helpers/ui-state-harness.mjs";

const source = fileURLToPath(
  new URL("../../src/components/ChatProjectDialog.tsx", import.meta.url),
);
const ownerProject = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Research",
  role: "owner",
  archived_at: null,
  deletion_requested_at: null,
};
const editorProject = {
  ...ownerProject,
  id: "22222222-2222-4222-8222-222222222222",
  name: "Team",
  role: "editor",
};
const defaultChat = {
  id: "chat-a",
  title: "Notes",
  messages: [
    {
      role: "user",
      content: "Summarize this",
      attachments: [{ url: "private-file", name: "private.txt" }],
    },
    { role: "assistant", content: "Here is a summary", sources: [{ secret: "metadata" }] },
    { role: "system", content: "Private background instructions" },
  ],
};

function fixture({ projects = [ownerProject], read, write, conversation = defaultChat } = {}) {
  const hooks = createHookHarness();
  let user = { user: { id: "account-a" }, isSignedIn: true, isLoaded: true };
  const calls = [];
  const closes = [];
  let readCount = 0;
  const listProjects = () => {
    readCount++;
    return read ? read() : Promise.resolve(projects);
  };
  const importChatToProject = (request) => {
    calls.push(request);
    return write ? write(request) : Promise.resolve({ id: "saved-chat" });
  };
  const { ChatProjectDialog } = loadUiModule(source, {
    react: hooks.react,
    "@tanstack/react-router": { Link: "Link" },
    "@tanstack/react-start": { useServerFn: (fn) => fn },
    "@/components/auth/ClerkSafe": { useUser: () => user },
    "@/components/ui/button": { Button: "Button" },
    "@/components/ui/input": { Input: "Input" },
    "@/components/ui/dialog": Object.fromEntries(
      ["Dialog", "DialogContent", "DialogDescription", "DialogHeader", "DialogTitle"].map(
        (name) => [name, name],
      ),
    ),
    "@/lib/projects.functions": { listProjects },
    "@/lib/project-workspace.functions": { importChatToProject },
  });
  let props = { open: true, conversation, onOpenChange: (open) => closes.push(open) };
  let tree;
  const render = () => {
    tree = hooks.render(ChatProjectDialog, props);
    return tree;
  };
  const button = (label) => elements(tree, (el) => el.type === "Button" && text(el) === label)[0];
  return {
    calls,
    closes,
    hooks,
    render,
    button,
    get tree() {
      return tree;
    },
    get readCount() {
      return readCount;
    },
    async ready() {
      render();
      await settle();
      render();
    },
    select(id = ownerProject.id) {
      elements(tree, (el) => el.type === "select")[0].props.onChange({ target: { value: id } });
      render();
    },
    account(id) {
      user = id
        ? { user: { id }, isSignedIn: true, isLoaded: true }
        : { user: null, isSignedIn: false, isLoaded: true };
      render();
      render();
    },
    close() {
      props = { ...props, open: false };
      render();
    },
  };
}

test("lists only active writable projects and requires an explicit Add action", async () => {
  const f = fixture({
    projects: [
      ownerProject,
      editorProject,
      { ...ownerProject, id: "view", name: "View only", role: "viewer" },
      { ...ownerProject, id: "archive", name: "Archived", archived_at: "2026-01-01" },
      { ...ownerProject, id: "delete", name: "Deleting", deletion_requested_at: "2026-01-01" },
    ],
  });
  await f.ready();
  assert.deepEqual(elements(f.tree, (el) => el.type === "option").map(text), [
    "Select a project",
    "Research",
    "Team",
  ]);
  assert.equal(f.calls.length, 0);
  assert.equal(f.button("Add to project").props.disabled, true);
  assert.match(text(f.tree), /Project members can view the copy/);
  assert.match(text(f.tree), /Attachments aren’t copied/);
  f.button("Cancel").props.onClick();
  assert.deepEqual(f.closes, [false]);
  assert.equal(f.calls.length, 0);
});

test("copies text only, prevents double submission and acknowledges the returned saved chat", async () => {
  const pending = deferred();
  const f = fixture({ write: () => pending.promise });
  await f.ready();
  f.select();
  const submit = f.button("Add to project").props.onClick;
  const operation = submit();
  await submit();
  f.render();
  assert.equal(f.calls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0])), {
    data: {
      project_id: ownerProject.id,
      title: "Notes",
      messages: [
        { role: "user", content: "Summarize this" },
        { role: "assistant", content: "Here is a summary" },
      ],
    },
  });
  assert.equal(f.button("Cancel").props.disabled, true);
  elements(f.tree, (el) => el.type === "Dialog")[0].props.onOpenChange(false);
  assert.deepEqual(f.closes, []);
  pending.resolve({ id: "returned-chat-id" });
  await operation;
  f.render();
  assert.match(text(f.tree), /Added to\s+Research/);
  const destination = elements(
    f.tree,
    (el) => el.type === "Link" && text(el) === "Open project chat",
  )[0];
  assert.equal(destination.props.params.chatId, "returned-chat-id");
  assert.equal(destination.props.params.projectId, ownerProject.id);
  await submit();
  assert.equal(f.calls.length, 1);
});

test("account change invalidates loaded choices and stale mutation handlers", async () => {
  const f = fixture();
  await f.ready();
  f.select();
  const oldSubmit = f.button("Add to project").props.onClick;
  f.account("account-b");
  await oldSubmit();
  assert.match(text(f.tree), /Your account changed/);
  assert.equal(elements(f.tree, (el) => el.type === "select").length, 0);
  assert.equal(f.calls.length, 0);
  assert.equal(f.readCount, 1);
});

test("late mutation response cannot acknowledge another account's chat", async () => {
  const pending = deferred();
  const f = fixture({ write: () => pending.promise });
  await f.ready();
  f.select();
  const operation = f.button("Add to project").props.onClick();
  f.account("account-b");
  pending.resolve({ id: "private-result" });
  await operation;
  f.render();
  assert.doesNotMatch(text(f.tree), /Added to\s+Research/);
  assert.equal(elements(f.tree, (el) => el.type === "Link").length, 0);
});

test("read failures can be retried without a write, and ambiguous write failures do not claim success", async () => {
  let attempt = 0;
  const f = fixture({
    read: () =>
      ++attempt === 1 ? Promise.reject(new Error("offline")) : Promise.resolve([ownerProject]),
    write: () => Promise.resolve({}),
  });
  await f.ready();
  assert.match(text(f.tree), /Could not load your projects/);
  f.button("Try again").props.onClick();
  await f.ready();
  f.select();
  await f.button("Add to project").props.onClick();
  f.render();
  assert.match(text(f.tree), /Could not confirm the chat was added/);
  assert.equal(f.calls.length, 1);
  assert.equal(
    elements(f.tree, (el) => el.type === "Link" && text(el) === "Open project chat").length,
    0,
  );
});

test("empty or oversized snapshots and overlong titles are rejected without truncating or writing", async () => {
  for (const conversation of [
    { ...defaultChat, title: "x".repeat(201) },
    { ...defaultChat, messages: [{ role: "user", content: "x".repeat(100_001) }] },
    {
      ...defaultChat,
      messages: Array.from({ length: 501 }, () => ({ role: "user", content: "message" })),
    },
    { ...defaultChat, messages: [{ role: "user", content: "", attachments: [{ url: "file" }] }] },
  ]) {
    const f = fixture({ conversation });
    await f.ready();
    f.select();
    await f.button("Add to project").props.onClick();
    f.render();
    assert.equal(f.calls.length, 0);
    assert.ok(elements(f.tree, (el) => el.props.role === "alert").length > 0);
    f.hooks.unmount();
  }
});
