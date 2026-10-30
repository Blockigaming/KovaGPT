import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import ts from "typescript";
import { deferred, elements, text } from "../helpers/ui-state-harness.mjs";

const source = readFileSync("src/routes/projects.tsx", "utf8");
const ast = ts.createSourceFile(
  "projects.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
function find(predicate) {
  let found;
  function visit(node) {
    if (predicate(node)) found = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(found, "expected Projects source node exists");
  return found;
}
const names = [
  "openRename",
  "closeRename",
  "requestRenameClose",
  "restoreRenameFocus",
  "restoreRenameEditingFocus",
  "saveRename",
];
const declarations = names
  .map((name) =>
    find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast),
  )
  .join("\n");
const visible = find(
  (node) => ts.isVariableDeclaration(node) && node.name.getText(ast) === "renameVisible",
).initializer.getText(ast);
const dirty = find(
  (node) => ts.isVariableDeclaration(node) && node.name.getText(ast) === "renameDirty",
).initializer.getText(ast);
const nameError = find(
  (node) => ts.isVariableDeclaration(node) && node.name.getText(ast) === "renameNameError",
).initializer.getText(ast);
const dialog = find(
  (node) =>
    ts.isJsxElement(node) &&
    node.openingElement.tagName.getText(ast) === "Dialog" &&
    node.openingElement.attributes.getText(ast).includes("renameVisible"),
).getText(ast);
const confirmation = find(
  (node) =>
    ts.isJsxElement(node) &&
    node.openingElement.tagName.getText(ast) === "AlertDialog" &&
    node.openingElement.attributes.getText(ast).includes("renameDiscardOpen"),
).getText(ast);
const resetEffect = find(
  (node) =>
    ts.isCallExpression(node) &&
    node.expression.getText(ast) === "useEffect" &&
    node.arguments[0]?.getText(ast).includes("Invalidate pending completions"),
).arguments[0].getText(ast);
const restoreSource = readFileSync("src/lib/dialog-return-focus.ts", "utf8").replace(
  /^export function/gm,
  "function",
);
function compile(code, dependencies) {
  const js = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  return new Function(...Object.keys(dependencies), js)(...Object.values(dependencies));
}
function event() {
  return {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
}

function fixture() {
  const project = { id: "project-a", name: "Original name", description: "Original description" };
  const state = {
    userKey: "A",
    isLoaded: true,
    isSignedIn: true,
    renameFor: null,
    renameName: "",
    renameDesc: "",
    renameBusy: false,
    renameOwner: null,
    renameDiscardOpen: false,
    renameNameVisited: false,
    renameError: null,
    projects: [project],
  };
  const document = { activeElement: null, body: null };
  const window = { location: { href: "https://fixture.invalid/projects" } };
  function element(name, parent = null) {
    return {
      name,
      parent,
      isConnected: true,
      hidden: false,
      disabled: false,
      getClientRects() {
        return this.hidden || !this.isConnected ? [] : [{}];
      },
      closest() {
        return this.hidden ? {} : null;
      },
      matches() {
        return this.disabled;
      },
      contains(node) {
        return node === this || node?.parent === this;
      },
      focus() {
        document.activeElement = this;
      },
    };
  }
  document.body = element("body");
  document.activeElement = document.body;
  const surface = element("rename dialog");
  const discard = element("discard dialog");
  discard.isConnected = false;
  const nameInput = element("name", surface);
  const description = element("description", surface);
  const trigger = element("project menu");
  const search = element("search");
  const refs = {
    renameActiveRef: { current: false },
    renameOperationRef: { current: null },
    renameOriginRef: { current: null },
    renameContextRef: { current: {} },
    currentUserKeyRef: { current: "A" },
    projectMenuTriggers: { current: new Map([[project.id, trigger]]) },
    renameDialogRef: { current: surface },
    renameDiscardDialogRef: { current: discard },
    renameNameInputRef: { current: nameInput },
    renameEditFocusRef: { current: null },
    searchInputRef: { current: search },
  };
  const setters = Object.fromEntries(
    Object.keys(state).map((key) => [
      `set${key[0].toUpperCase()}${key.slice(1)}`,
      (next) => {
        state[key] = typeof next === "function" ? next(state[key]) : next;
      },
    ]),
  );
  const calls = [],
    notices = [];
  let refreshes = 0;
  const fnUpdate = (args) => {
    const pending = deferred();
    calls.push({ args, ...pending });
    return pending.promise;
  };
  const components = Object.fromEntries(
    [
      "Dialog",
      "DialogContent",
      "DialogHeader",
      "DialogTitle",
      "DialogDescription",
      "DialogFooter",
      "Input",
      "Textarea",
      "Button",
      "Loader2",
      "AlertDialog",
      "AlertDialogContent",
      "AlertDialogHeader",
      "AlertDialogTitle",
      "AlertDialogDescription",
      "AlertDialogFooter",
      "AlertDialogCancel",
      "AlertDialogAction",
    ].map((name) => [name, name]),
  );
  const dependencies = () => ({
    ...state,
    ...refs,
    ...setters,
    ...components,
    React,
    document,
    window,
    fnUpdate,
    toast: {
      success: (message) => notices.push(["success", message]),
      error: (message) => notices.push(["error", message]),
    },
    refresh: () => {
      refreshes++;
    },
  });
  let rendered;
  const render = () => {
    refs.currentUserKeyRef.current = state.userKey;
    refs.renameContextRef.current = {
      userKey: state.userKey,
      isLoaded: state.isLoaded,
      isSignedIn: state.isSignedIn,
    };
    rendered = compile(
      `${restoreSource}\n${declarations}\nconst renameVisible = ${visible}; const renameDirty = ${dirty}; const renameNameError = ${nameError};\nreturn { ${names.join(", ")}, dialog: (${dialog}), confirmation: (${confirmation}), reset: (${resetEffect}) };`,
      dependencies(),
    );
    return rendered;
  };
  render();
  return {
    state,
    refs,
    calls,
    notices,
    project,
    document,
    window,
    trigger,
    search,
    surface,
    discard,
    nameInput,
    description,
    element,
    render,
    get refreshes() {
      return refreshes;
    },
    get ui() {
      return rendered;
    },
    open() {
      rendered.openRename(project);
      render();
      nameInput.focus();
    },
    edit(name = "Edited name", description = "Edited description") {
      state.renameName = name;
      state.renameDesc = description;
      render();
    },
    switchOwner(owner, loaded = true) {
      state.userKey = owner;
      state.isLoaded = loaded;
      return render();
    },
    closeConfirmation() {
      rendered.confirmation.props.onOpenChange(false);
      discard.isConnected = false;
      render();
      rendered.restoreRenameEditingFocus(event());
    },
  };
}
function button(tree, label) {
  return elements(tree, (node) => node.type === "Button" && text(node).trim() === label)[0];
}
function content(tree) {
  return elements(tree, (node) => node.type === "DialogContent")[0];
}
function field(tree, id = "rename-project-name") {
  return elements(tree, (node) => node.props.id === id)[0];
}
function form(tree) {
  return elements(tree, (node) => node.type === "form")[0];
}

test("empty names wait for a visit, then show a specific associated error until corrected", () => {
  const f = fixture();
  f.project.name = "";
  f.open();
  assert.equal(f.state.renameNameVisited, false);
  assert.equal(field(f.ui.dialog).props["aria-invalid"], false);
  assert.equal(field(f.ui.dialog).props["aria-describedby"], undefined);
  assert.equal(field(f.ui.dialog, "rename-project-name-error"), undefined);
  assert.equal(field(f.ui.dialog).props.required, true);
  field(f.ui.dialog).props.onChange({ target: { value: "   " } });
  f.render();
  assert.equal(field(f.ui.dialog, "rename-project-name-error"), undefined);
  field(f.ui.dialog).props.onBlur();
  f.render();
  assert.equal(field(f.ui.dialog).props["aria-invalid"], true);
  const errorId = field(f.ui.dialog).props["aria-describedby"];
  assert.equal(text(field(f.ui.dialog, errorId)), "Enter a project name");
  assert.equal(field(f.ui.dialog, errorId).props.role, "alert");
  field(f.ui.dialog).props.onChange({ target: { value: "Valid project" } });
  f.render();
  assert.equal(field(f.ui.dialog).props["aria-invalid"], false);
  assert.equal(field(f.ui.dialog).props["aria-describedby"], undefined);
  assert.equal(field(f.ui.dialog, errorId), undefined);
  assert.equal(f.calls.length, 0);
});

for (const name of ["", " \t "]) {
  test(`submitting ${JSON.stringify(name)} explains the required name without a write`, async () => {
    const f = fixture();
    f.open();
    f.edit(name, "Description stays");
    f.description.focus();
    assert.equal(button(f.ui.dialog, "Save project").props.disabled, false);
    assert.equal(form(f.ui.dialog).props.noValidate, true);
    const submission = event();
    form(f.ui.dialog).props.onSubmit(submission);
    await f.ui.saveRename();
    f.render();
    assert.equal(submission.prevented, true);
    assert.equal(f.state.renameNameVisited, true);
    assert.equal(text(field(f.ui.dialog, "rename-project-name-error")), "Enter a project name");
    assert.equal(f.document.activeElement, f.nameInput);
    assert.equal(f.state.renameName, name);
    assert.equal(f.state.renameDesc, "Description stays");
    assert.equal(f.state.renameBusy, false);
    assert.equal(f.refs.renameOperationRef.current, null);
    assert.equal(f.calls.length, 0);
    assert.equal(f.refreshes, 0);
    assert.equal(f.notices.length, 0);
  });
}

test("rename fields have associated labels, bounded values, and explicit idle/pending save text", async () => {
  const f = fixture();
  f.open();
  for (const [id, maxLength] of [
    ["rename-project-name", 100],
    ["rename-project-description", 1000],
  ]) {
    assert.equal(
      elements(f.ui.dialog, (node) => node.type === "label" && node.props.htmlFor === id).length,
      1,
    );
    assert.equal(
      elements(f.ui.dialog, (node) => node.props.id === id)[0].props.maxLength,
      maxLength,
    );
  }
  assert.ok(button(f.ui.dialog, "Save project"));
  f.edit();
  const saving = f.ui.saveRename();
  f.render();
  assert.ok(button(f.ui.dialog, "Saving…").props.disabled);
  assert.equal(button(f.ui.dialog, "Saving…").props["aria-busy"], true);
  const spinner = elements(button(f.ui.dialog, "Saving…"), (node) => node.type === "Loader2")[0];
  assert.equal(spinner.props.className, "h-4 w-4 animate-spin");
  assert.equal(spinner.props["aria-hidden"], "true");
  assert.equal(button(f.ui.dialog, "Cancel").props.disabled, true);
  assert.ok(
    elements(f.ui.dialog, (node) => node.type === "Input" || node.type === "Textarea").every(
      (node) => node.props.disabled,
    ),
  );
  f.calls[0].resolve({});
  await saving;
});

test("clean Cancel closes directly and returns focus to the current project menu", () => {
  const f = fixture();
  f.open();
  button(f.ui.dialog, "Cancel").props.onClick();
  assert.equal(f.state.renameFor, null);
  assert.equal(f.state.renameDiscardOpen, false);
  f.document.activeElement = f.document.body;
  f.ui.restoreRenameFocus(event());
  assert.equal(f.document.activeElement, f.trigger);
  assert.equal(f.calls.length, 0);
});

for (const action of ["Cancel", "Backdrop", "Escape", "Close button"]) {
  test(`dirty ${action} preserves both fields until a discard decision`, () => {
    const f = fixture();
    f.open();
    f.edit();
    f.refs.renameEditFocusRef.current = f.description;
    f.description.focus();
    const ev = event();
    if (action === "Cancel") button(f.ui.dialog, "Cancel").props.onClick();
    else if (action === "Backdrop") content(f.ui.dialog).props.onPointerDownOutside(ev);
    else if (action === "Escape") content(f.ui.dialog).props.onEscapeKeyDown(ev);
    else f.ui.dialog.props.onOpenChange(false);
    if (action === "Backdrop" || action === "Escape") assert.equal(ev.prevented, true);
    f.render();
    assert.equal(f.ui.dialog.props.open, true);
    assert.equal(f.ui.confirmation.props.open, true);
    assert.match(text(f.ui.confirmation), /Keep editing/);
    assert.equal(f.state.renameName, "Edited name");
    assert.equal(f.state.renameDesc, "Edited description");
    f.closeConfirmation();
    assert.equal(f.state.renameDiscardOpen, false);
    assert.equal(f.state.renameName, "Edited name");
    assert.equal(f.state.renameDesc, "Edited description");
    assert.equal(f.document.activeElement, f.description);
    assert.equal(f.calls.length, 0);
  });
}

test("Discard changes closes both layers and restores focus after the confirmation exits", () => {
  const f = fixture();
  f.open();
  f.edit();
  f.ui.requestRenameClose();
  f.render();
  f.discard.isConnected = true;
  const discardButton = f.element("discard", f.discard);
  f.document.activeElement = discardButton;
  elements(f.ui.confirmation, (node) => node.type === "AlertDialogAction")[0].props.onClick();
  f.ui.restoreRenameFocus(event());
  assert.ok(
    f.refs.renameOriginRef.current,
    "the outer layer must defer final focus to confirmation cleanup",
  );
  f.discard.isConnected = false;
  f.document.activeElement = f.document.body;
  f.ui.restoreRenameEditingFocus(event());
  assert.equal(f.document.activeElement, f.trigger);
  assert.equal(f.state.renameFor, null);
  assert.equal(f.state.renameName, "");
  assert.equal(f.state.renameDesc, "");
  assert.equal(f.calls.length, 0);
});

test("pending save prevents duplicate writes and every dismissal path until success", async () => {
  const f = fixture();
  f.open();
  f.edit("  Renamed  ", "  Details  ");
  const saving = f.ui.saveRename();
  await f.ui.saveRename();
  f.render();
  button(f.ui.dialog, "Cancel").props.onClick();
  content(f.ui.dialog).props.onPointerDownOutside(event());
  content(f.ui.dialog).props.onEscapeKeyDown(event());
  f.ui.dialog.props.onOpenChange(false);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].args, {
    data: { id: "project-a", name: "Renamed", description: "Details" },
  });
  assert.equal(f.state.renameDiscardOpen, false);
  assert.equal(f.state.renameFor.id, "project-a");
  f.calls[0].resolve({});
  await saving;
  f.render();
  assert.equal(f.ui.dialog.props.open, false);
  assert.equal(f.state.renameBusy, false);
  assert.deepEqual(f.notices, [["success", "Project updated"]]);
});

test("failed saves retain an actionable inline error and draft through edits and a guarded retry", async () => {
  const f = fixture();
  f.open();
  f.edit();
  const saving = f.ui.saveRename();
  f.calls[0].reject(new Error("Fixture update failed"));
  await saving;
  f.render();
  assert.equal(f.ui.dialog.props.open, true);
  assert.equal(f.state.renameName, "Edited name");
  assert.equal(f.state.renameDesc, "Edited description");
  assert.equal(f.state.renameBusy, false);
  assert.equal(f.refs.renameOperationRef.current, null);
  assert.equal(f.refreshes, 1);
  assert.equal(f.notices.length, 0, "failure must not depend on an expiring toast");
  const errorId = form(f.ui.dialog).props["aria-describedby"];
  const error = field(f.ui.dialog, errorId);
  assert.equal(error.props.role, "alert");
  assert.match(text(error), /Couldn’t save the project\./);
  assert.match(text(error), /Fixture update failed/);
  assert.match(text(error), /Your changes are still here\. Use Save project to try again\./);
  assert.ok(button(f.ui.dialog, "Save project"));
  f.edit("Second name", "Second description");
  assert.match(text(field(f.ui.dialog, errorId)), /Fixture update failed/);
  f.ui.requestRenameClose();
  f.render();
  assert.equal(f.ui.confirmation.props.open, true);
  f.closeConfirmation();
  assert.match(text(field(f.ui.dialog, errorId)), /Fixture update failed/);
  const retry = f.ui.saveRename();
  await f.ui.saveRename();
  f.render();
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls[1].args, {
    data: { id: "project-a", name: "Second name", description: "Second description" },
  });
  assert.match(text(field(f.ui.dialog, errorId)), /Fixture update failed/);
  assert.equal(button(f.ui.dialog, "Saving…").props.disabled, true);
  f.calls[1].resolve({});
  await retry;
  f.render();
  assert.equal(f.ui.dialog.props.open, false);
  assert.equal(f.state.renameError, null);
  assert.equal(f.state.renameNameVisited, false);
  assert.equal(field(f.ui.dialog, errorId), undefined);
  assert.deepEqual(f.notices, [["success", "Project updated"]]);
});

test("unknown and blank failures get a persistent fallback and each failed retry releases the guard", async () => {
  const f = fixture();
  f.open();
  f.edit();
  for (const failure of [undefined, new Error("   ")]) {
    const saving = f.ui.saveRename();
    await f.ui.saveRename();
    f.calls.at(-1).reject(failure);
    await saving;
    f.render();
    assert.match(
      text(field(f.ui.dialog, "rename-project-save-error")),
      /The project could not be updated\./,
    );
    assert.equal(f.state.renameBusy, false);
    assert.equal(f.refs.renameOperationRef.current, null);
    assert.equal(f.state.renameName, "Edited name");
    assert.equal(f.state.renameDesc, "Edited description");
  }
  assert.equal(f.calls.length, 2);
  assert.equal(f.refreshes, 2);
  assert.equal(f.notices.length, 0);
});

test("discarding and opening another project clear the prior validation and save failure", async () => {
  const f = fixture();
  f.open();
  f.edit();
  const saving = f.ui.saveRename();
  f.calls[0].reject(new Error("Prior project failure"));
  await saving;
  f.render();
  f.ui.requestRenameClose();
  f.render();
  elements(f.ui.confirmation, (node) => node.type === "AlertDialogAction")[0].props.onClick();
  assert.equal(f.state.renameError, null);
  assert.equal(f.state.renameNameVisited, false);
  f.render();
  f.ui.openRename({ id: "project-b", name: "", description: "Other project" });
  f.render();
  assert.equal(field(f.ui.dialog).props["aria-invalid"], false);
  assert.equal(form(f.ui.dialog).props["aria-describedby"], undefined);
  assert.equal(field(f.ui.dialog, "rename-project-save-error"), undefined);
  assert.equal(f.state.renameDesc, "Other project");
});

for (const transition of ["account", "unresolved", "signed out"]) {
  test(`${transition} masks existing name and save errors before cleanup`, async () => {
    const f = fixture();
    f.open();
    f.edit();
    const saving = f.ui.saveRename();
    f.calls[0].reject(new Error("Private project failure"));
    await saving;
    f.edit("");
    assert.ok(field(f.ui.dialog, "rename-project-name-error"));
    assert.ok(field(f.ui.dialog, "rename-project-save-error"));
    if (transition === "account") f.state.userKey = "B";
    if (transition === "unresolved") f.state.isLoaded = false;
    if (transition === "signed out") f.state.isSignedIn = false;
    f.render();
    assert.equal(f.ui.dialog.props.open, false);
    assert.equal(field(f.ui.dialog, "rename-project-name-error"), undefined);
    assert.equal(field(f.ui.dialog, "rename-project-save-error"), undefined);
    assert.equal(field(f.ui.dialog).props["aria-describedby"], undefined);
    assert.equal(form(f.ui.dialog).props["aria-describedby"], undefined);
    assert.doesNotMatch(text(f.ui.dialog), /Private project failure/);
    f.ui.reset();
    assert.equal(f.state.renameError, null);
    assert.equal(f.state.renameNameVisited, false);
  });
}

for (const outcome of ["resolve", "reject"]) {
  test(`principal switch masks the old draft immediately and ignores late save ${outcome}`, async () => {
    const f = fixture();
    f.open();
    f.edit();
    const saving = f.ui.saveRename();
    f.switchOwner("B");
    assert.equal(f.ui.dialog.props.open, false);
    assert.equal(f.ui.confirmation.props.open, false);
    assert.ok(
      elements(f.ui.dialog, (node) => node.type === "Input" || node.type === "Textarea").every(
        (node) => node.props.value === "",
      ),
    );
    f.ui.reset();
    f.calls[0][outcome](outcome === "reject" ? new Error("Old account failure") : {});
    await saving;
    assert.equal(f.state.renameFor, null);
    assert.equal(f.state.renameName, "");
    assert.equal(f.notices.length, 0);
    assert.equal(f.refreshes, 0);
    f.document.activeElement = f.document.body;
    f.ui.restoreRenameFocus(event());
    assert.equal(f.document.activeElement, f.document.body);
  });
}

test("focus restoration respects replacement triggers, fallback, navigation and newer user focus", () => {
  for (const mode of ["replacement", "fallback", "navigation", "newer focus", "account"]) {
    const f = fixture();
    f.open();
    f.ui.closeRename();
    f.document.activeElement = f.document.body;
    const replacement = f.element("replacement trigger");
    const newer = f.element("new user focus");
    if (mode === "replacement") f.refs.projectMenuTriggers.current.set(f.project.id, replacement);
    if (mode === "fallback") f.trigger.isConnected = false;
    if (mode === "navigation") f.window.location.href = "https://fixture.invalid/library";
    if (mode === "newer focus") f.document.activeElement = newer;
    if (mode === "account") f.refs.currentUserKeyRef.current = "B";
    f.ui.restoreRenameFocus(event());
    const expected =
      mode === "replacement"
        ? replacement
        : mode === "fallback"
          ? f.search
          : mode === "newer focus"
            ? newer
            : f.document.body;
    assert.equal(f.document.activeElement, expected);
  }
});

test("Keep editing respects a newer field focus, navigation and account changes", () => {
  for (const mode of ["newer field", "navigation", "account"]) {
    const f = fixture();
    f.open();
    f.edit();
    f.refs.renameEditFocusRef.current = f.description;
    f.ui.requestRenameClose();
    f.render();
    f.document.activeElement = mode === "newer field" ? f.nameInput : f.document.body;
    if (mode === "navigation") f.window.location.href = "https://fixture.invalid/library";
    if (mode === "account") f.refs.currentUserKeyRef.current = "B";
    f.ui.restoreRenameEditingFocus(event());
    assert.equal(f.document.activeElement, mode === "newer field" ? f.nameInput : f.document.body);
  }
});

test("auth becoming unresolved invalidates pending rename state and prevents stale notices", async () => {
  const f = fixture();
  f.open();
  f.edit();
  const saving = f.ui.saveRename();
  f.switchOwner("A", false);
  assert.equal(f.ui.dialog.props.open, false);
  f.calls[0].resolve({});
  await saving;
  assert.equal(f.notices.length, 0);
  f.ui.reset();
  assert.equal(f.state.renameBusy, false);
  assert.equal(f.refs.renameOperationRef.current, null);
});
