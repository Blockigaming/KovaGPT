import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import {
  createHookHarness,
  elements,
  text,
  deferred,
  settle,
  loadUiModule,
} from "../helpers/ui-state-harness.mjs";

const React = {
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
};
const components = Object.fromEntries(
  [
    "Dialog",
    "DialogContent",
    "DialogHeader",
    "DialogTitle",
    "DialogDescription",
    "DialogFooter",
    "Button",
    "Input",
    "Textarea",
    "Link",
    "SearchablePicker",
  ].map((name) => [name, name]),
);
function compile(source, deps) {
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  return new Function(...Object.keys(deps), js)(...Object.values(deps));
}
function base() {
  const h = createHookHarness(),
    effects = [],
    focuses = [];
  const useEffect = h.react.useEffect;
  h.react.useEffect = (effect, deps) =>
    useEffect(() => {
      let cleanup;
      effects.push(() => {
        cleanup = effect();
      });
      return () => cleanup?.();
    }, deps);
  const document = { body: {}, activeElement: null };
  document.activeElement = document.body;
  const window = { location: { href: "https://fixture.invalid/projects" } };
  const node = (name) => ({
    name,
    isConnected: true,
    getClientRects: () => [{}],
    closest: () => null,
    matches: () => false,
    contains: (value) => value?.inside === name,
    focus() {
      focuses.push(name);
      document.activeElement = this;
    },
  });
  return {
    h,
    document,
    window,
    focuses,
    node,
    flush: () => {
      while (effects.length) effects.shift()();
    },
    deps: { React, ...components, ...h.react, document, window },
  };
}
const source = readFileSync("src/routes/projects.tsx", "utf8");
const ast = ts.createSourceFile(
  "projects.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const nodes = [];
const visit = (node) => {
  nodes.push(node);
  ts.forEachChild(node, visit);
};
visit(ast);
const createFunction = nodes
  .find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "handleCreate")
  .getText(ast);
const dialogSource = nodes
  .find(
    (node) =>
      ts.isJsxElement(node) &&
      node.openingElement.tagName.getText(ast) === "Dialog" &&
      node.openingElement.attributes.getText(ast).includes("createVisible"),
  )
  .getText(ast);
const declarations = source.slice(
  source.indexOf("  const [createOpen,"),
  source.indexOf("  const navigate = useNavigate();"),
);
function createFixture() {
  const b = base(),
    calls = [],
    successes = [],
    navigations = [],
    rows = [];
  let refreshes = 0;
  const behavior = { navigationFails: false };
  const errors = [];
  const props = { isLoaded: true, isSignedIn: true, userKey: "owner-a" };
  const component = compile(
    `function Harness({isLoaded,isSignedIn,userKey}) { ${declarations}\n${createFunction}\nreturn {dialog: (${dialogSource}),openCreate,closeCreate,handleCreate,restoreCreateFocus,name,description,busy,createError}; } return Harness;`,
    {
      ...b.deps,
      fnCreate: (args) => {
        const pending = deferred();
        calls.push({ args, ...pending });
        return pending.promise;
      },
      toast: {
        success: (...args) => successes.push(args),
        error: (message) => errors.push(message),
      },
      setProjects: (update) => rows.splice(0, rows.length, ...update(rows)),
      refresh: () => {
        refreshes++;
      },
      navigate: (args) => {
        navigations.push(args);
        if (behavior.navigationFails) throw new Error("Navigation failed");
      },
      restoreDialogFocus: loadUiModule("src/lib/dialog-return-focus.ts", {}, { window: b.window })
        .restoreDialogFocus,
    },
  );
  let state;
  const input = b.node("create name"),
    error = b.node("create error"),
    dialog = b.node("create dialog"),
    trigger = b.node("create opener"),
    heading = b.node("projects heading"),
    submit = b.node("create submit");
  b.document.getElementById = (id) => (id === "projects-title" ? heading : null);
  input.inside = error.inside = submit.inside = "create dialog";
  function render() {
    state = b.h.render(component, props);
    for (const element of elements(state.dialog)) {
      if (element.type === "Input") element.props.ref.current = input;
      if (element.type === "DialogContent") element.props.ref.current = dialog;
      if (element.props.role === "alert") element.props.ref.current = error;
    }
    b.flush();
    return state;
  }
  const find = (predicate) => elements(state.dialog, predicate)[0];
  render();
  render();
  return {
    ...b,
    props,
    calls,
    behavior,
    errors,
    successes,
    navigations,
    rows,
    input,
    error,
    trigger,
    heading,
    submit,
    state: () => state,
    render,
    find,
    refreshes: () => refreshes,
    open() {
      state.openCreate(trigger);
      render();
    },
    type(name, description = "Draft description") {
      find((node) => node.type === "Input").props.onChange({ target: { value: name } });
      find((node) => node.type === "Textarea").props.onChange({ target: { value: description } });
      render();
    },
    send() {
      b.document.activeElement = submit;
      const pending = state.handleCreate();
      render();
      return pending;
    },
    button: (label) => find((node) => node.type === "Button" && text(node) === label),
    unmount: () => b.h.unmount(),
  };
}

test("new-project rejection stays named and visible, retains fields, focuses the error and retries once", async () => {
  const f = createFixture();
  f.open();
  f.type("Research");
  const pending = f.send();
  f.state().handleCreate();
  assert.equal(f.calls.length, 1);
  f.state().closeCreate();
  f.render();
  assert.equal(f.state().dialog.props.open, true);
  f.calls[0].reject(new Error("Storage unavailable"));
  await pending;
  f.render();
  assert.match(
    f.state().createError,
    /Could not confirm project creation.*Research.*may already have been created/,
  );
  assert.equal(f.state().name, "Research");
  assert.equal(f.state().description, "Draft description");
  assert.equal(f.document.activeElement, f.error);
  for (let i = 0; i < 8; i++) f.render();
  assert.equal(f.button("Retry create project").props.disabled, true);
  await f.send();
  assert.equal(f.calls.length, 1);
  f.button("Check Projects").props.onClick();
  f.render();
  assert.equal(f.state().dialog.props.open, false);
  assert.equal(f.refreshes(), 1);
  assert.equal(f.state().name, "Research");
  f.open();
  assert.equal(f.button("Retry create project").props.disabled, true);
  f.find((node) => node.type === "input" && node.props.type === "checkbox").props.onChange({
    target: { checked: true },
  });
  f.render();
  const retry = f.send();
  f.calls[1].resolve({ id: "new-project" });
  await retry;
  f.render();
  assert.equal(f.state().dialog.props.open, false);
  assert.equal(f.rows[0].name, "Research");
  assert.deepEqual(f.successes, [["Project created"]]);
  assert.equal(f.navigations[0].params.projectId, "new-project");
});

test("new-project errors dismiss to the name field and ordinary cancellation keeps the draft and restores the opener", async () => {
  const f = createFixture();
  f.open();
  f.type("Research");
  const pending = f.send();
  f.calls[0].reject(new Error("Unavailable"));
  await pending;
  f.render();
  f.button("Dismiss error").props.onClick();
  f.render();
  assert.equal(f.state().createError, null);
  assert.equal(f.document.activeElement, f.input);
  const staleSubmit = f.state().handleCreate;
  f.state().closeCreate();
  f.render();
  f.state().restoreCreateFocus({ preventDefault() {} });
  assert.equal(f.document.activeElement, f.trigger);
  f.open();
  f.type("New draft");
  await staleSubmit();
  assert.equal(f.calls.length, 1);
  assert.equal(f.state().name, "New draft");
});

test("Check Projects restores the stable heading once after closing and refresh, preserving the exact draft and retry warning", async () => {
  const f = createFixture();
  f.open();
  f.type("  Research  ", "  Draft description\nwith details  ");
  const pending = f.send();
  f.calls[0].reject(new Error("Uncertain result"));
  await pending;
  f.render();
  f.focuses.length = 0;

  const check = f.button("Check Projects").props.onClick;
  check();
  check();
  f.render();
  assert.equal(f.state().dialog.props.open, false);
  assert.equal(f.refreshes(), 1);
  assert.equal(f.heading.tabIndex, -1);
  assert.deepEqual(f.focuses, [], "focus waits for the dialog close callback");
  f.trigger.isConnected = false; // Refresh unmounts both possible creation entry points.
  f.document.activeElement = f.document.body;
  f.state().restoreCreateFocus({ preventDefault() {} });
  f.state().restoreCreateFocus({ preventDefault() {} });
  assert.deepEqual(f.focuses, ["projects heading"]);
  assert.equal(f.document.activeElement, f.heading);

  f.trigger.isConnected = true;
  f.open();
  assert.equal(f.state().name, "  Research  ");
  assert.equal(f.state().description, "  Draft description\nwith details  ");
  assert.match(text(f.state().dialog), /Check Projects for.*Research.*retry may create a/);
  assert.equal(f.button("Retry create project").props.disabled, true);
  await f.send();
  assert.equal(f.calls.length, 1);
  f.find((node) => node.type === "input" && node.props.type === "checkbox").props.onChange({
    target: { checked: true },
  });
  f.render();
  assert.equal(f.button("Retry create project").props.disabled, false);
  f.document.activeElement = f.input;
  f.state().closeCreate();
  f.render();
  f.state().restoreCreateFocus({ preventDefault() {} });
  assert.equal(f.document.activeElement, f.trigger, "ordinary Cancel still restores its opener");
  f.open();
  assert.equal(f.button("Retry create project").props.disabled, false);
});

for (const interruption of [
  "account",
  "unresolved",
  "sign-out",
  "unmount",
  "navigation",
  "later-focus",
  "removed-heading",
  "hidden-heading",
]) {
  test(`Check Projects close focus respects ${interruption}`, async () => {
    const f = createFixture();
    f.open();
    f.type("Retained draft");
    const pending = f.send();
    f.calls[0].reject(new Error("Uncertain result"));
    await pending;
    f.render();
    f.button("Check Projects").props.onClick();
    f.render();
    f.document.activeElement = f.document.body;
    f.focuses.length = 0;
    if (interruption === "account") {
      f.props.userKey = "owner-b";
      f.render();
    }
    if (interruption === "unresolved") {
      f.props.isLoaded = false;
      f.render();
    }
    if (interruption === "sign-out") {
      f.props.isSignedIn = false;
      f.render();
    }
    if (interruption === "unmount") f.unmount();
    if (interruption === "navigation") f.window.location.href += "?next";
    if (interruption === "later-focus") f.document.activeElement = f.node("later input");
    if (interruption === "removed-heading") f.heading.isConnected = false;
    if (interruption === "hidden-heading") f.heading.closest = () => ({});
    f.state().restoreCreateFocus({ preventDefault() {} });
    assert.deepEqual(f.focuses, []);
    assert.equal(f.calls.length, 1);
    assert.equal(f.refreshes(), 1);
  });
}

for (const interruption of [
  "account",
  "unresolved",
  "sign-out",
  "unmount",
  "navigation",
  "later-focus",
]) {
  test(`new-project completion does not publish or steal focus after ${interruption}`, async () => {
    const f = createFixture();
    f.open();
    f.type("Old draft");
    const pending = f.send();
    if (interruption === "account") {
      f.props.userKey = "owner-b";
      f.render();
    }
    if (interruption === "unresolved") {
      f.props.isLoaded = false;
      f.render();
    }
    if (interruption === "sign-out") {
      f.props.isSignedIn = false;
      f.render();
    }
    if (interruption === "unmount") f.unmount();
    if (interruption === "navigation") f.window.location.href += "?next";
    if (interruption === "later-focus") f.document.activeElement = f.node("later input");
    f.calls[0].reject(new Error("Old failure"));
    await pending;
    if (interruption !== "unmount") f.render();
    assert.deepEqual(f.focuses, []);
    assert.deepEqual(f.successes, []);
    assert.deepEqual(f.navigations, []);
    if (interruption !== "later-focus") assert.equal(f.state().createError, null);
  });
}

function titleFixture() {
  const b = base(),
    requests = [],
    loads = [],
    changes = [];
  const auth = { isLoaded: true, isSignedIn: true, user: { id: "owner-a" } };
  const props = {
    open: true,
    onOpenChange: (open) => changes.push(open),
    conversation: {
      id: "chat-a",
      title: "Original",
      messages: [{ role: "user", content: "Question" }],
    },
  };
  const getProjects = () => {
    const pending = deferred();
    loads.push(pending);
    return pending.promise;
  };
  const component = loadUiModule(
    "src/components/ChatProjectDialog.tsx",
    {
      react: b.deps,
      "@tanstack/react-router": { Link: "Link" },
      "@tanstack/react-start": { useServerFn: (fn) => fn },
      "@/components/auth/ClerkSafe": { useUser: () => auth },
      "@/components/ui/button": { Button: "Button" },
      "@/components/ui/input": { Input: "Input" },
      "@/components/ui/dialog": components,
      "@/components/ui/searchable-picker": { SearchablePicker: "SearchablePicker" },
      "@/lib/projects.functions": { listProjects: getProjects },
      "@/lib/project-workspace.functions": {
        importChatToProject: (args) => {
          const pending = deferred();
          requests.push({ ...pending, args });
          return pending.promise;
        },
      },
    },
    { document: b.document, Error },
  ).ChatProjectDialog;
  let tree;
  const input = b.node("chat title"),
    error = b.node("copy error");
  function render() {
    tree = b.h.render(component, props);
    for (const element of elements(tree)) {
      if (element.type === "Input") element.props.ref.current = input;
      if (element.props.role === "alert" && element.props.ref) element.props.ref.current = error;
    }
    b.flush();
    return tree;
  }
  const find = (predicate) => elements(tree, predicate)[0];
  render();
  render();
  return {
    ...b,
    auth,
    props,
    requests,
    changes,
    input,
    error,
    render,
    find,
    async ready() {
      loads.at(-1).resolve([{ id: "project-a", name: "Writable", role: "owner" }]);
      await settle();
      render();
      find((node) => node.type === "SearchablePicker").props.onValueChange("project-a");
      render();
    },
    field: () => find((node) => node.type === "Input"),
    submit: () =>
      find((node) => node.type === "Button" && text(node) === "Add to project").props.onClick(),
    type(value) {
      find((node) => node.type === "Input").props.onChange({ target: { value } });
      render();
    },
    unmount: () => b.h.unmount(),
  };
}

test("chat title validates on blur, links its field error, and clears immediately on correction", async () => {
  const f = titleFixture();
  await f.ready();
  f.type("  ");
  assert.equal(f.field().props["aria-invalid"], false);
  f.field().props.onBlur();
  f.render();
  assert.equal(f.field().props["aria-invalid"], true);
  const error = f.find((node) => node.props.id === f.field().props["aria-describedby"]);
  assert.equal(text(error), "Enter a chat title.");
  f.type("Corrected");
  assert.equal(f.field().props["aria-invalid"], false);
  assert.equal(f.field().props["aria-describedby"], undefined);
  f.type("x".repeat(201));
  assert.match(
    text(f.find((node) => node.props.id === f.field().props["aria-describedby"])),
    /200 characters/,
  );
  assert.equal(f.requests.length, 0);
});

test("invalid title submit gives a field summary and focus without sending; valid correction preserves normal single submission", async () => {
  const f = titleFixture();
  await f.ready();
  f.type(" ");
  await f.submit();
  f.render();
  assert.match(text(f.find((node) => node.props.role === "alert")), /highlighted chat title/);
  assert.equal(f.document.activeElement, f.input);
  assert.equal(f.requests.length, 0);
  f.type("  Corrected title  ");
  assert.equal(
    f.find((node) => node.props.role === "alert"),
    undefined,
  );
  const send = f.submit();
  f.submit();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].args.data.title, "Corrected title");
  f.requests[0].resolve({ id: "copied" });
  await send;
  f.render();
  assert.match(text(f.render()), /Added to\s+Writable/);
});

test("chat-copy failure remains focused and preserves corrected title and destination", async () => {
  const f = titleFixture();
  await f.ready();
  f.type("Retained title");
  const pending = f.submit();
  f.requests[0].reject(new Error("Unavailable"));
  await pending;
  f.render();
  assert.equal(f.field().props.value, "Retained title");
  assert.equal(f.find((node) => node.type === "SearchablePicker").props.value, "project-a");
  assert.equal(f.document.activeElement, f.error);
});

for (const interruption of ["account", "close", "unmount", "later-focus"]) {
  test(`chat title/copy error callbacks respect ${interruption}`, async () => {
    const f = titleFixture();
    await f.ready();
    const staleBlur = f.field().props.onBlur;
    const pending = f.submit();
    if (interruption === "account") {
      f.auth.user = { id: "owner-b" };
      f.render();
    }
    if (interruption === "close") {
      f.props.open = false;
      f.render();
    }
    if (interruption === "unmount") f.unmount();
    if (interruption === "later-focus") f.document.activeElement = f.node("later input");
    staleBlur();
    f.requests[0].reject(new Error("Old failure"));
    await pending;
    if (interruption !== "unmount") f.render();
    assert.deepEqual(f.focuses, []);
  });
}

for (const interruption of ["account", "unmount", "navigation"]) {
  test(`successful creation after ${interruption} cannot navigate or overwrite the replacement view`, async () => {
    const f = createFixture();
    f.open();
    f.type("Old project");
    const pending = f.send();
    if (interruption === "account") {
      f.props.userKey = "owner-b";
      f.render();
      f.open();
      f.type("Replacement project");
    }
    if (interruption === "unmount") f.unmount();
    if (interruption === "navigation") f.window.location.href += "?new";
    f.calls[0].resolve({ id: "old-result" });
    await pending;
    if (interruption !== "unmount") f.render();
    assert.deepEqual(f.rows, []);
    assert.deepEqual(f.navigations, []);
    assert.deepEqual(f.successes, []);
    if (interruption === "account") assert.equal(f.state().name, "Replacement project");
  });
}

test("an old creation cannot release a replacement account's pending-operation latch", async () => {
  const f = createFixture();
  f.open();
  f.type("Old project");
  const old = f.send();
  f.props.userKey = "owner-b";
  f.render();
  f.open();
  f.type("New project");
  const current = f.send();
  f.calls[0].reject(new Error("Old failure"));
  await old;
  f.render();
  assert.equal(f.state().busy, true);
  f.state().handleCreate();
  assert.equal(f.calls.length, 2);
  f.calls[1].reject(new Error("Current failure"));
  await current;
  f.render();
  assert.match(f.state().createError, /Could not confirm project creation.*New project/);
});

test("missing returned project ID is an uncertain outcome and cannot be blindly retried", async () => {
  const f = createFixture();
  f.open();
  f.type("Possibly created");
  const pending = f.send();
  f.calls[0].resolve({});
  await pending;
  f.render();
  assert.match(
    f.state().createError,
    /Could not confirm project creation.*Possibly created.*duplicate/,
  );
  assert.equal(f.button("Retry create project").props.disabled, true);
  f.button("Dismiss error").props.onClick();
  f.render();
  assert.equal(f.button("Retry create project").props.disabled, true);
  await f.send();
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.successes, []);
  assert.deepEqual(f.errors, []);
});

test("navigation failure after a confirmed project ID does not become a creation failure or retry", async () => {
  const f = createFixture();
  f.behavior.navigationFails = true;
  f.open();
  f.type("Confirmed project");
  const pending = f.send();
  f.calls[0].resolve({ id: "confirmed-id" });
  await pending;
  f.render();
  assert.equal(f.rows[0].id, "confirmed-id");
  assert.deepEqual(f.successes, [["Project created"]]);
  assert.equal(f.state().createError, null);
  assert.equal(f.button("Retry create project"), undefined);
  assert.match(
    f.errors[0],
    /Confirmed project.*was created, but could not be opened.*Open it from Projects/,
  );
  assert.equal(f.calls.length, 1);
});

test("new-project Name validates after blur, links its error and clears on correction", () => {
  const f = createFixture();
  f.open();
  const field = () => f.find((node) => node.props.id === "create-project-name");
  assert.equal(field().props["aria-invalid"], false);
  field().props.onBlur();
  f.render();
  assert.equal(field().props["aria-invalid"], true);
  assert.equal(field().props["aria-describedby"], "create-project-name-error");
  assert.match(
    text(f.find((node) => node.props.id === "create-project-name-error")),
    /Enter a project name/,
  );
  f.type("Named project");
  assert.equal(field().props["aria-invalid"], false);
  assert.equal(field().props["aria-describedby"], undefined);
});
test("new-project invalid submit keeps focus on Name and does not call creation", async () => {
  const f = createFixture();
  f.open();
  await f.send();
  assert.equal(f.calls.length, 0);
  assert.equal(f.document.activeElement, f.input);
  assert.equal(
    f.find((node) => node.props.id === "create-project-name").props["aria-invalid"],
    true,
  );
});

test("empty and populated Project create entry points both establish the guarded dialog session", () => {
  assert.equal((source.match(/setCreateOpen\(true\)/g) || []).length, 1);
  assert.equal(
    (source.match(/onClick=\{\(event\) => openCreate\(event.currentTarget\)\}/g) || []).length,
    2,
  );
});
