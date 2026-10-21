import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { createHookHarness } from "../helpers/ui-state-harness.mjs";

const source = readFileSync("src/components/ChatMessage.tsx", "utf8");
const parsed = ts.createSourceFile(
  "ChatMessage.tsx",
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
visit(parsed);
const attribute = (name, includes) => {
  const node = nodes.find(
    (node) =>
      ts.isJsxAttribute(node) &&
      node.name.getText(parsed) === name &&
      node.getText(parsed).includes(includes),
  );
  assert.ok(node, `${name}: ${includes}`);
  return node.initializer.expression.getText(parsed);
};
const compile = (code, dependencies) =>
  new Function(
    ...Object.keys(dependencies),
    ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
  )(...Object.values(dependencies));

// Execute the actual Sources hook state, callbacks, and focus guard. Synthetic
// element evidence only; this does not claim browser/Radix focus-trap coverage.
function fixture() {
  const hooks = createHookHarness();
  const focused = [];
  const window = { location: { href: "https://local.invalid/chat/a" } };
  const document = { body: {}, activeElement: null };
  document.activeElement = document.body;
  class HTMLElement {
    constructor(id) {
      this.id = id;
    }
    isConnected = true;
    visible = true;
    disabled = false;
    hidden = false;
    children = [];
    getClientRects() {
      return this.visible ? [{}] : [];
    }
    closest() {
      return this.hidden ? {} : null;
    }
    matches() {
      return this.disabled;
    }
    contains(element) {
      return this === element || this.children.includes(element);
    }
    focus(options) {
      assert.equal(options.preventScroll, true);
      focused.push(this);
      document.activeElement = this;
    }
  }
  const restoreDialogFocus = compile(
    `${readFileSync("src/lib/dialog-return-focus.ts", "utf8").replace(/^export /gm, "")}\nreturn restoreDialogFocus;`,
    { window },
  );
  const start = source.indexOf("  const sourcesContextKey =");
  const end = source.indexOf("  const [memoryOpenFor", start);
  assert.ok(start >= 0 && end > start);
  const component = compile(
    `return function Sources({ principal, chatId, message, temporary, principalResolved }) {
    ${source.slice(start, end)}
    return { sourcesSession, sourcesOpen, sourcesReturnFocusRef, sourcesPillRef, openSource, openSources, closeSources,
      pillClick: ${attribute("onClick", "else openSources(event.currentTarget)")},
      closeAutoFocus: ${attribute("onCloseAutoFocus", "sourcesReturnFocusRef")},
    };
  };`,
    { ...hooks.react, window, document, HTMLElement, restoreDialogFocus },
  );
  let props = {
    principal: "owner-a",
    chatId: "chat-a",
    message: { id: "message-a", sources: [{ id: "one" }] },
    temporary: false,
    principalResolved: true,
  };
  let view;
  const render = (next = {}) => {
    props = { ...props, ...next };
    view = hooks.render(component, props);
    return view;
  };
  const close = (handler = view.closeAutoFocus, closingContent = new HTMLElement("dialog")) => {
    view.closeSources();
    render();
    let prevented = false;
    handler({
      target: closingContent,
      preventDefault() {
        prevented = true;
      },
    });
    assert.equal(prevented, true, "Radix must not fall back to page-start focus");
  };
  render();
  return {
    render,
    close,
    hooks,
    window,
    document,
    HTMLElement,
    focused,
    get view() {
      return view;
    },
  };
}

for (const route of ["citation", "pill"]) {
  test(`${route} restores its exact clicked opener after dismissing Sources`, () => {
    const f = fixture();
    const target = new f.HTMLElement(route);
    f.document.activeElement = new f.HTMLElement("unrelated-previous-focus");
    if (route === "citation") f.view.openSource("one", target);
    else f.view.pillClick({ currentTarget: target });
    f.render();
    assert.equal(f.view.sourcesOpen, true);
    assert.equal(f.view.sourcesSession.trigger, target);
    assert.equal(f.view.sourcesSession.openedUrl, f.window.location.href);
    f.document.activeElement = f.document.body;
    const handler = f.view.closeAutoFocus;
    f.close(handler);
    assert.deepEqual(f.focused, [target]);
    f.document.activeElement = f.document.body;
    handler({ preventDefault() {} });
    assert.equal(f.focused.length, 1, "Return is consumed once");
  });
}

test("different citation instances for one source retain separate focus origins", () => {
  const f = fixture();
  const first = new f.HTMLElement("citation-one");
  const second = new f.HTMLElement("citation-one-again");
  f.view.openSource("one", first);
  f.render();
  const staleClose = f.view.closeAutoFocus;
  f.view.closeSources();
  f.render();
  f.view.openSource("one", second);
  f.render();
  staleClose({ preventDefault() {} });
  assert.deepEqual(f.focused, []);
  assert.equal(f.view.sourcesReturnFocusRef.current, f.view.sourcesSession);
  f.close();
  assert.deepEqual(f.focused, [second]);
});

for (const change of [
  "principal",
  "chat",
  "message",
  "temporary",
  "unresolved",
  "unmount",
  "clear",
]) {
  test(`Sources never returns focus after ${change} invalidates its lifetime`, () => {
    const f = fixture();
    f.view.openSource("one", new f.HTMLElement("citation"));
    f.render();
    const handler = f.view.closeAutoFocus;
    if (change === "principal") f.render({ principal: "owner-b" });
    if (change === "chat") f.render({ chatId: "chat-b" });
    if (change === "message") f.render({ message: { id: "message-b", sources: [{ id: "one" }] } });
    if (change === "temporary") f.render({ temporary: true });
    if (change === "unresolved") f.render({ principal: null, principalResolved: false });
    if (change === "unmount") f.hooks.unmount();
    if (change === "clear") f.view.sourcesReturnFocusRef.current = null;
    handler({ preventDefault() {} });
    assert.deepEqual(f.focused, []);
    if (!["clear", "unmount"].includes(change)) assert.equal(f.view.sourcesOpen, false);
  });
}
test("account clear closes Sources and invalidates its outstanding return", () => {
  assert.match(
    source,
    /closeSources\(\);\s+sourcesReturnFocusRef.current = null;\s+setMemoryOpenFor\(null\)/,
  );
});

test("the sources pill controls the matching inspector", () => {
  const inspector = nodes.find(
    (node) =>
      ts.isJsxOpeningElement(node) &&
      node.tagName.getText(parsed) === "DialogContent" &&
      node.getText(parsed).includes("kova-sources-inspector"),
  );
  assert.ok(inspector);
  const id = inspector.attributes.properties.find(
    (node) => ts.isJsxAttribute(node) && node.name.getText(parsed) === "id",
  );
  assert.ok(id);
  assert.equal(
    id.initializer.expression.getText(parsed),
    attribute("aria-controls", "message-sources-"),
  );
});

for (const change of ["url", "detached", "invisible", "hidden", "disabled", "later-focus"]) {
  test(`Sources leaves focus alone for ${change}`, () => {
    const f = fixture();
    const target = new f.HTMLElement("citation");
    f.view.openSource("one", target);
    f.render();
    if (change === "url") f.window.location.href += "?next";
    if (change === "detached") target.isConnected = false;
    if (change === "invisible") target.visible = false;
    if (change === "hidden") target.hidden = true;
    if (change === "disabled") target.disabled = true;
    if (change === "later-focus") f.document.activeElement = new f.HTMLElement("new-focus");
    f.close();
    assert.deepEqual(f.focused, []);
  });
}

test("focus still inside the closing inspector may return to its opener", () => {
  const f = fixture();
  const target = new f.HTMLElement("citation");
  f.view.openSource("one", target);
  f.render();
  const dialog = new f.HTMLElement("dialog");
  const closeButton = new f.HTMLElement("close-sources");
  dialog.children.push(closeButton);
  f.document.activeElement = closeButton;
  f.close(f.view.closeAutoFocus, dialog);
  assert.deepEqual(f.focused, [target]);
});

test("unresolved principals and missing sources cannot create an inspector session", () => {
  const f = fixture();
  for (const next of [
    { principal: null, principalResolved: false },
    { principal: "owner-a", principalResolved: true, message: { id: "message-a", sources: [] } },
  ]) {
    f.render(next);
    f.view.openSources(new f.HTMLElement("pill"));
    f.render();
    assert.equal(f.view.sourcesOpen, false);
  }
});
