import assert from "node:assert/strict";
import test from "node:test";
import { createHookHarness, loadUiModule } from "../helpers/ui-state-harness.mjs";

function fixture() {
  const hooks = createHookHarness();
  let timerId = 0;
  const timers = new Map();
  const calls = [];
  const hook = loadUiModule(
    "src/lib/use-project-instruction-draft.ts",
    { react: hooks.react },
    {
      Error,
      setTimeout: (callback) => {
        timers.set(++timerId, callback);
        return timerId;
      },
      clearTimeout: (id) => timers.delete(id),
    },
  ).useProjectInstructionDraft;
  let props = {
    scopeKey: "account-a:project-a",
    initialValue: "Initial",
    initialRevision: "r0",
    onReload: async () => ({ value: "Remote instructions", revision: "r9" }),
    canEdit: true,
    onSave: (value, expectedRevision) =>
      new Promise((resolve, reject) => calls.push({ value, expectedRevision, resolve, reject })),
  };
  let state;
  const render = () => {
    state = hooks.render(hook, props);
    return state;
  };
  render();
  render();
  return {
    calls,
    render,
    get state() {
      return state;
    },
    edit(value) {
      state.edit(value);
      render();
    },
    props(next) {
      props = { ...props, ...next };
      render();
      render();
    },
    async tick() {
      const pending = [...timers.values()];
      timers.clear();
      for (const callback of pending) callback();
      await Promise.resolve();
      render();
    },
    async settle(index, error) {
      if (error) calls[index].reject(new Error(error));
      else calls[index].resolve(`r${index + 1}`);
      await Promise.resolve();
      await Promise.resolve();
      render();
    },
    unmount() {
      hooks.unmount();
    },
  };
}

test("earlier save acknowledgement preserves newer typing and serializes the next save", async () => {
  const f = fixture();
  f.edit("First edit");
  await f.tick();
  f.edit("Newer edit");
  await f.tick();
  assert.deepEqual(
    f.calls.map((c) => c.value),
    ["First edit"],
  );
  await f.settle(0);
  f.props({ initialValue: "First edit", initialRevision: "r1" });
  assert.equal(f.state.draft, "Newer edit");
  assert.equal(f.state.saved, false);
  await f.tick();
  assert.deepEqual(
    f.calls.map((c) => c.value),
    ["First edit", "Newer edit"],
  );
  await f.settle(1);
  f.props({ initialValue: "Newer edit", initialRevision: "r2" });
  assert.equal(f.state.lastSaved, "Newer edit");
  assert.equal(f.state.saved, true);
});

test("failure keeps current draft, stops automatic retries, and guarded Retry saves the latest text", async () => {
  const f = fixture();
  f.edit("First");
  await f.tick();
  f.edit("Newest");
  await f.settle(0, "Storage unavailable");
  assert.equal(f.state.draft, "Newest");
  assert.equal(f.state.error, "Storage unavailable");
  await f.tick();
  assert.equal(f.calls.length, 1);
  const retry = f.state.saveDraft();
  void f.state.saveDraft(); // Double click before React rerenders.
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].value, "Newest");
  await f.settle(1);
  await retry;
  f.render();
  assert.equal(f.state.error, null);
  assert.equal(f.state.lastSaved, "Newest");
});

test("account/project transition ignores a late save result", async () => {
  const f = fixture();
  f.edit("Account A draft");
  await f.tick();
  f.props({ scopeKey: "account-b:project-b", initialValue: "Account B saved" });
  await f.settle(0, "Account A failed");
  assert.equal(f.state.draft, "Account B saved");
  assert.equal(f.state.lastSaved, "Account B saved");
  assert.equal(f.state.error, null);
  assert.equal(f.state.saving, false);
});

test("permission revocation and unmount prevent further dispatch", async () => {
  const f = fixture();
  f.edit("Pending");
  f.props({ canEdit: false });
  await f.tick();
  await f.state.saveDraft();
  assert.equal(f.calls.length, 0);
  f.props({ canEdit: true });
  f.unmount();
  await f.state.saveDraft();
  assert.equal(f.calls.length, 0);
});

test("remote update adopts into a clean editor but pauses a dirty editor for explicit resolution", async () => {
  const f = fixture();
  f.props({ initialValue: "Remote clean" });
  assert.equal(f.state.draft, "Remote clean");
  f.edit("My unsaved work");
  f.props({ initialValue: "Collaborator update" });
  assert.equal(f.state.draft, "My unsaved work");
  assert.equal(f.state.conflict, true);
  await f.tick();
  assert.equal(f.calls.length, 0);
  const save = f.state.saveDraft();
  assert.equal(f.calls[0].value, "My unsaved work");
  await f.settle(0);
  await save;
  f.render();
  assert.equal(f.state.conflict, false);
});

test("trimmed acknowledgements and intentional reverts do not replace current text", async () => {
  const f = fixture();
  f.edit(" First edit ");
  await f.tick();
  f.edit("Initial");
  await f.settle(0);
  f.props({ initialValue: "First edit", initialRevision: "r1" });
  assert.equal(f.state.draft, "Initial");
  assert.equal(f.state.conflict, false);
  await f.tick();
  assert.equal(f.calls[1].value, "Initial");
});

test("server conflict requires review and binds replacement to that reviewed revision", async () => {
  const f = fixture();
  f.edit("My draft");
  await f.tick();
  assert.equal(f.calls[0].expectedRevision, "r0");
  await f.settle(0, "Project changed or is no longer editable.");
  assert.equal(f.state.conflict, true);
  await f.state.saveDraft();
  assert.equal(f.calls.length, 1);
  await f.state.reviewSaved();
  f.render();
  assert.equal(f.state.draft, "My draft");
  assert.equal(f.state.remoteReview.value, "Remote instructions");
  const save = f.state.saveDraft();
  assert.equal(f.calls[1].expectedRevision, "r9");
  await f.settle(1, "Project changed again.");
  await save;
  f.render();
  assert.equal(f.state.remoteReview, null);
  assert.equal(f.state.draft, "My draft");
  await f.state.saveDraft();
  assert.equal(f.calls.length, 2);
});

test("a subsequent save uses the exact acknowledged revision, not the opening props", async () => {
  const f = fixture();
  f.edit("One");
  await f.tick();
  await f.settle(0);
  f.edit("Two");
  await f.tick();
  assert.equal(f.calls[1].expectedRevision, "r1");
});

test("Use saved adopts only the reviewed snapshot without writing it back", async () => {
  const f = fixture();
  f.edit("My draft");
  await f.tick();
  await f.settle(0, "Project changed.");
  await f.state.reviewSaved();
  f.render();
  f.state.useSaved();
  f.render();
  assert.equal(f.state.draft, "Remote instructions");
  assert.equal(f.state.error, null);
  await f.tick();
  assert.equal(f.calls.length, 1);
  f.edit("New edit after review");
  await f.tick();
  assert.equal(f.calls[1].expectedRevision, "r9");
});

test("a late conflict review cannot disclose another account's snapshot in the next editor", async () => {
  const f = fixture();
  let resolve;
  f.props({
    onReload: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  const review = f.state.reviewSaved();
  f.props({ scopeKey: "account-b:project-b", initialValue: "B", initialRevision: "b1" });
  resolve({ value: "Private A", revision: "a9" });
  await review;
  f.render();
  assert.equal(f.state.remoteReview, null);
  assert.equal(f.state.draft, "B");
});

test("clean adoption of r2 clears obsolete r1 review so Use saved cannot restore r1", () => {
  const f = fixture();
  f.edit("Dirty r0");
  f.props({ initialValue: "Remote r1", initialRevision: "r1" });
  assert.equal(f.state.conflict, true);
  f.edit("Initial");
  f.props({ initialValue: "Remote r2", initialRevision: "r2" });
  assert.equal(f.state.draft, "Remote r2");
  assert.equal(f.state.conflict, false);
  assert.equal(f.state.error, null);
  assert.equal(f.state.remoteReview, null);
  f.state.useSaved();
  f.render();
  assert.equal(f.state.draft, "Remote r2");
});

test("review reload updates the parent snapshot used when Instructions remounts", async () => {
  const { readFileSync } = await import("node:fs");
  const ts = (await import("typescript")).default;
  const routeText = readFileSync("src/routes/projects.$projectId.tsx", "utf8");
  const source = ts.createSourceFile(
    "route.tsx",
    routeText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let callback;
  function visit(node) {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(source) === "onReload" &&
      node.initializer?.expression
    )
      callback = node.initializer.expression.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(callback);
  const compiled = ts.transpileModule(`const reload = ${callback};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let parent = { system_prompt: "Initial", updated_at: "r0" };
  const current = { current: "account-a:project-a" };
  const reload = new Function(
    "requestKey",
    "fnGet",
    "projectId",
    "currentRequestKeyRef",
    "setProject",
    `${compiled}; return reload;`,
  )(
    current.current,
    async () => ({ system_prompt: "Remote instructions", updated_at: "r9" }),
    "project-a",
    current,
    (value) => {
      parent = value;
    },
  );
  const f = fixture();
  f.props({ onReload: reload });
  f.edit("Local draft");
  await f.state.reviewSaved();
  f.render();
  f.state.useSaved();
  f.render();
  assert.equal(f.state.draft, "Remote instructions");
  f.unmount();
  const remounted = fixture();
  remounted.props({ initialValue: parent.system_prompt, initialRevision: parent.updated_at });
  assert.equal(remounted.state.draft, "Remote instructions");
  remounted.edit("Next edit");
  await remounted.tick();
  assert.equal(remounted.calls[0].expectedRevision, "r9");
  // Installed Radix removes inactive children; this is source + hook lifecycle
  // evidence only, not a browser interaction or animation timing assertion.
  const radix = readFileSync("node_modules/@radix-ui/react-tabs/dist/index.js", "utf8");
  assert.match(radix, /present: forceMount \|\| isSelected/);
  assert.match(radix, /children: present && children/);
  current.current = "account-b:project-a";
  await assert.rejects(reload(), /access changed/);
});

// Exercise the real route panel props with the installed Radix lifecycle
// contract. This remains a deterministic lifecycle test, not browser evidence.
async function tabFixture() {
  const { readFileSync } = await import("node:fs");
  const ts = (await import("typescript")).default;
  const { jsxRuntime } = await import("../helpers/ui-state-harness.mjs");
  const source = ts.createSourceFile(
    "route.tsx",
    readFileSync("src/routes/projects.$projectId.tsx", "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let panel;
  function visit(node) {
    if (
      ts.isJsxElement(node) &&
      node.openingElement.tagName.getText(source) === "TabsContent" &&
      node.openingElement.attributes.properties.some(
        (p) => p.name?.getText(source) === "value" && p.initializer?.text === "instructions",
      )
    )
      panel = node.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(panel);
  const js = ts.transpileModule(`const panel = ${panel};`, {
    fileName: "panel.tsx",
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const renderPanel = new Function(
    "tab",
    "requestKey",
    "require",
    "exports",
    "TabsContent",
    "ProjectInstructionsTab",
    "project",
    "canEdit",
    js + ";return panel;",
  );
  let f = fixture();
  let mounted = true;
  return {
    get hook() {
      return f;
    },
    select(tab) {
      const node = renderPanel(
        tab,
        "account-a:project-a",
        () => jsxRuntime,
        {},
        "panel",
        "editor",
        {},
        true,
      );
      const present = node.props.forceMount || tab === "instructions";
      if (!present && mounted) {
        f.unmount();
        mounted = false;
      }
      if (present && !mounted) {
        f = fixture();
        mounted = true;
      }
      if (tab !== "instructions") {
        assert.equal(node.props.hidden, true);
        assert.equal(node.props.inert, true);
      } else {
        assert.equal(node.props.hidden, false);
        assert.equal(node.props.inert, false);
      }
      return node;
    },
  };
}
test("instructions survive a tab round trip before the debounce fires", async () => {
  const f = await tabFixture();
  f.hook.edit("Pending debounce");
  f.select("notes");
  f.select("instructions");
  assert.equal(f.hook.state.draft, "Pending debounce");
  await f.hook.tick();
  assert.equal(f.hook.calls[0].value, "Pending debounce");
});
test("failed instructions save survives tab return with its retry state", async () => {
  const f = await tabFixture();
  f.hook.edit("Unsaved after failure");
  await f.hook.tick();
  await f.hook.settle(0, "Storage unavailable");
  f.select("notes");
  f.select("instructions");
  assert.equal(f.hook.state.draft, "Unsaved after failure");
  assert.equal(f.hook.state.error, "Storage unavailable");
  await f.hook.tick();
  assert.equal(f.hook.calls.length, 1);
});
test("newer typing survives a tab return while an earlier save completes", async () => {
  const f = await tabFixture();
  f.hook.edit("Earlier");
  await f.hook.tick();
  f.hook.edit("Newer draft");
  f.select("notes");
  await f.hook.settle(0);
  f.hook.props({ initialValue: "Earlier", initialRevision: "r1" });
  f.select("instructions");
  assert.equal(f.hook.state.draft, "Newer draft");
});
test("mounted hidden instructions reset when the account or project scope changes", async () => {
  for (const scopeKey of ["account-b:project-a", "account-a:project-b"]) {
    const f = await tabFixture();
    f.hook.edit("Private draft");
    f.select("notes");
    f.hook.props({ scopeKey, initialValue: "Other scope", initialRevision: "r8" });
    f.select("instructions");
    assert.equal(f.hook.state.draft, "Other scope");
    await f.hook.tick();
    assert.equal(f.hook.calls.length, 0);
  }
});
