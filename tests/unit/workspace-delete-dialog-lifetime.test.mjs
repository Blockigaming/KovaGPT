import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { transformSync } from "esbuild";

function setup(route, nextHandler, itemKey, listSetter) {
  const source = readFileSync(new URL(`../../src/routes/${route}.tsx`, import.meta.url), "utf8");
  const start = source.indexOf("  const confirmDelete = async () => {");
  const end = source.indexOf(nextHandler, start);
  assert.ok(start >= 0 && end > start);
  const expression = source
    .slice(start, end)
    .trim()
    .replace(/^const confirmDelete = /, "")
    .replace(/;$/, "");
  const code = transformSync(`const execute = ${expression}`, { loader: "ts" }).code;
  const calls = [];
  let resolve;
  let reject;
  const pending = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  const environment = {
    deleteTarget: {
      [itemKey]: { id: "selected", name: "Selected resource" },
      principal: "user:a",
      generation: 4,
      url: "https://kovagpt.com/workspace",
    },
    dataReady: true,
    isSignedIn: true,
    deletingRef: { current: false },
    completedDeleteRef: { current: null },
    setDeleting: (value) => calls.push(["busy", value]),
    generationRef: { current: 4 },
    principalRef: { current: "user:a" },
    setDeleteTarget: (value) => calls.push(["target", value]),
    remove: (request) => {
      calls.push(["remove", request]);
      return pending;
    },
    [listSetter]: (update) => {
      const rows = update([{ id: "selected" }, { id: "retained" }]);
      calls.push(["rows", rows]);
    },
    toast: { error: (message) => calls.push(["error", message]) },
  };
  const execute = new Function(...Object.keys(environment), `${code}; return execute;`)(
    ...Object.values(environment),
  );
  return { environment, calls, execute, resolve, reject, source };
}

function focusSetup(route) {
  const source = readFileSync(new URL(`../../src/routes/${route}.tsx`, import.meta.url), "utf8");
  const start = source.indexOf("  const restoreDeleteFocus = useCallback(");
  const end = source.indexOf("  }, []);", start) + "  }, []);".length;
  assert.ok(start >= 0 && end > start);
  const code = transformSync(source.slice(start, end), { loader: "ts" }).code;
  const calls = [];
  const document = { body: null, activeElement: null };
  class Element {
    isConnected = true;
    disabled = false;
    children = [];
    constructor(name) {
      this.name = name;
    }
    matches(selector) {
      return selector === ":disabled" ? this.disabled : this.name === "alertdialog";
    }
    contains(element) {
      return this === element || this.children.includes(element);
    }
    getClientRects() {
      return [{}];
    }
    closest() {
      return null;
    }
    focus(options) {
      document.activeElement = this;
      calls.push([this.name, options]);
    }
  }
  const body = new Element("body");
  const trigger = new Element("trigger");
  const heading = new Element("heading");
  const editor = new Element("editor");
  const dialog = new Element("alertdialog");
  const action = new Element("dialog action");
  dialog.children.push(action);
  document.body = body;
  document.activeElement = body;
  const window = { location: { href: "https://kovagpt.com/workspace" } };
  const restoreCode = transformSync(
    readFileSync(new URL("../../src/lib/dialog-return-focus.ts", import.meta.url), "utf8").replace(
      /^export /gm,
      "",
    ),
    { loader: "ts" },
  ).code;
  const restoreDialogFocus = new Function("window", `${restoreCode}; return restoreDialogFocus;`)(
    window,
  );
  const environment = {
    useCallback: (callback) => callback,
    deleteTriggerRef: {
      current: { element: trigger, principal: "user:a", generation: 4, url: window.location.href },
    },
    savedListHeadingRef: { current: heading },
    principalRef: { current: "user:a" },
    generationRef: { current: 4 },
    document,
    window,
    HTMLElement: Element,
    restoreDialogFocus,
  };
  const restore = new Function(...Object.keys(environment), `${code}; return restoreDeleteFocus;`)(
    ...Object.values(environment),
  );
  return { restore, calls, body, trigger, heading, editor, dialog, action, environment };
}

for (const [name, args] of [
  ["Context pack", ["context-packs", "  const attachPack =", "pack", "setPacks"]],
  ["Prompt", ["prompt-studio", "  const create =", "item", "setItems"]],
]) {
  test(`${name} confirmation sends one selected deletion and retains unrelated rows`, async () => {
    const f = setup(...args);
    const task = f.execute();
    await f.execute();
    assert.deepEqual(f.calls, [
      ["busy", true],
      ["target", null],
      ["remove", { data: { id: "selected" } }],
    ]);
    f.resolve();
    await task;
    assert.deepEqual(
      f.calls.find(([kind]) => kind === "rows"),
      ["rows", [{ id: "retained" }]],
    );
    assert.deepEqual(f.calls.at(-1), ["busy", false]);
    assert.deepEqual(f.environment.completedDeleteRef.current, {
      principal: "user:a",
      generation: 4,
      url: "https://kovagpt.com/workspace",
    });
    assert.equal(f.environment.deletingRef.current, false);
  });

  for (const [condition, change] of [
    ["stale principal", (e) => (e.principalRef.current = "user:b")],
    ["stale generation", (e) => (e.generationRef.current = 5)],
    ["unavailable data", (e) => (e.dataReady = false)],
    ["signed-out session", (e) => (e.isSignedIn = false)],
  ]) {
    test(`${name} confirmation refuses ${condition} before sending a deletion`, async () => {
      const f = setup(...args);
      change(f.environment);
      // Recompile with the changed render values; refs remain live in the handler.
      const source = f.source;
      const start = source.indexOf("  const confirmDelete = async () => {");
      const end = source.indexOf(args[1], start);
      const code = transformSync(source.slice(start, end), { loader: "ts" }).code;
      const execute = new Function(...Object.keys(f.environment), `${code}; return confirmDelete;`)(
        ...Object.values(f.environment),
      );
      await execute();
      assert.deepEqual(f.calls, []);
    });
  }

  test(`${name} cannot confirm a second row while the first deletion is pending`, async () => {
    const f = setup(...args);
    const task = f.execute();
    f.environment.deleteTarget = {
      ...f.environment.deleteTarget,
      [args[2]]: { id: "retained", name: "Second resource" },
    };
    const start = f.source.indexOf("  const confirmDelete = async () => {");
    const end = f.source.indexOf(args[1], start);
    const code = transformSync(f.source.slice(start, end), { loader: "ts" }).code;
    const confirmSecond = new Function(
      ...Object.keys(f.environment),
      `${code}; return confirmDelete;`,
    )(...Object.values(f.environment));
    await confirmSecond();
    assert.deepEqual(
      f.calls.filter(([kind]) => kind === "remove"),
      [["remove", { data: { id: "selected" } }]],
    );
    assert.deepEqual(
      f.calls.filter(([kind]) => kind === "busy"),
      [["busy", true]],
    );
    f.resolve();
    await task;
    assert.deepEqual(f.calls.at(-1), ["busy", false]);
  });

  test(`${name} deletion cannot change a later account or show a stale error`, async () => {
    for (const failure of [false, true]) {
      const f = setup(...args);
      const task = f.execute();
      f.environment.principalRef.current = "user:b";
      f.environment.generationRef.current += 1;
      if (failure) f.reject(new Error("Previous account failure"));
      else f.resolve();
      await task;
      assert.deepEqual(f.calls, [
        ["busy", true],
        ["target", null],
        ["remove", { data: { id: "selected" } }],
      ]);
    }
  });

  test(`${name} deletion reports a current failure without discarding saved rows`, async () => {
    const f = setup(...args);
    const task = f.execute();
    f.reject(new Error("Deletion unavailable"));
    await task;
    assert.deepEqual(
      f.calls.find(([kind]) => kind === "error"),
      ["error", "Deletion unavailable"],
    );
    assert.deepEqual(f.calls.at(-1), ["busy", false]);
    assert.equal(
      f.calls.some(([kind]) => kind === "rows"),
      false,
    );
    assert.equal(f.environment.deletingRef.current, false);
  });

  test(`${name} restores otherwise lost focus to the connected list heading`, () => {
    const f = focusSetup(args[0]);
    f.trigger.isConnected = false;
    f.restore();
    assert.deepEqual(f.calls, [["heading", { preventScroll: true }]]);
  });

  test(`${name} preserves a newer editor focus choice on completion and delayed dialog close`, () => {
    const f = focusSetup(args[0]);
    f.trigger.isConnected = false;
    f.environment.document.activeElement = f.editor;
    f.restore();
    f.restore(f.dialog);
    assert.deepEqual(f.calls, []);
    assert.equal(f.environment.document.activeElement, f.editor);
  });

  test(`${name} cancellation returns focus from its own closing dialog to its invoker`, () => {
    const f = focusSetup(args[0]);
    f.environment.document.activeElement = f.action;
    f.restore(f.dialog);
    assert.deepEqual(f.calls, [["trigger", { preventScroll: true }]]);
  });

  test(`${name} cannot restore focus after URL, principal or generation changes`, () => {
    for (const change of [
      (e) => (e.window.location.href += "#a-new-focus-destination"),
      (e) => (e.principalRef.current = "user:b"),
      (e) => (e.generationRef.current += 1),
    ]) {
      const f = focusSetup(args[0]);
      f.trigger.isConnected = false;
      change(f.environment);
      f.restore();
      assert.deepEqual(f.calls, []);
    }
  });
}
