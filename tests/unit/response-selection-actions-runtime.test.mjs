import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { createHookHarness, deferred } from "../helpers/ui-state-harness.mjs";
import { locateSelection } from "../../src/lib/selection-edit.mjs";

const source = readFileSync("src/components/ChatMessage.tsx", "utf8");
const ast = ts.createSourceFile(
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
visit(ast);
const attribute = (name, includes) =>
  nodes
    .find(
      (node) =>
        ts.isJsxAttribute(node) &&
        node.name.getText(ast) === name &&
        node.getText(ast).includes(includes),
    )
    .initializer.expression.getText(ast);
const compile = (code, deps) =>
  new Function(
    ...Object.keys(deps),
    ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
  )(...Object.values(deps));

// Actual selection hooks and action handlers with synthetic selection/element inputs.
// Native selection, pointer compatibility, and focus trapping still require browser review.
function fixture() {
  const hooks = createHookHarness(),
    module = deferred(),
    errors = [],
    listeners = new Map();
  const selection = {
    isCollapsed: false,
    anchorNode: {},
    focusNode: {},
    toString: () => "chosen passage",
  };
  const document = {
    activeElement: {},
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
  };
  class Element {
    constructor(button = true) {
      this.button = button;
    }
    closest() {
      return this.button ? this : null;
    }
  }
  const block = source
    .slice(source.indexOf("  const bodyRef ="), source.indexOf("  const saveFn ="))
    .replace('await import("@/lib/selection-edit.mjs")', "await selectionModule");
  const component = compile(
    `return function Selection({ message, studyContextKey, lifecycleGenerationRef }) {
    const [selectedText, setSelectedText] = useState("");
    const [selectionOpen, setSelectionOpen] = useState(false);
    const [selectionTarget, setSelectionTarget] = useState(null);
    const [selectionInstruction, setSelectionInstruction] = useState("");
    const [selectionAskOpen, setSelectionAskOpen] = useState(false);
    const [selectionAskPassage, setSelectionAskPassage] = useState("");
    const [selectionQuestion, setSelectionQuestion] = useState("");
    const responseDraftFocusRef = useRef(null);
    ${block}
    return { selectedText, selectionOpen, selectionTarget, selectionInstruction, selectionAskOpen,
      selectionAskPassage, bodyRef, selectionActionsRef, lastSelectionRef, rememberSelection, openSelectionEdit,
      pointerDown: ${attribute("onPointerDown", "event.isPrimary")},
      blur: ${attribute("onBlur", "rememberSelection")},
      ask: ${attribute("onClick", "setSelectionAskPassage(lastSelectionRef.current)")},
    };
  };`,
    {
      ...hooks.react,
      Element,
      document,
      window: { getSelection: () => selection },
      selectionModule: module.promise,
      toast: { error: (value) => errors.push(value) },
    },
  );
  let props = {
      message: { content: "Before chosen passage after." },
      studyContextKey: "owner-a:chat-a:message-a",
      lifecycleGenerationRef: { current: 0 },
    },
    view;
  const render = (next = {}) => {
    props = { ...props, ...next };
    view = hooks.render(component, props);
    return view;
  };
  render();
  const proseNodes = new Set([selection.anchorNode, selection.focusNode]);
  const button = new Element();
  view.bodyRef.current = { contains: (node) => proseNodes.has(node) };
  view.selectionActionsRef.current = { contains: (node) => node === button };
  view.rememberSelection();
  render();
  const pointer = (overrides = {}) => {
    let prevented = false;
    view.pointerDown({
      isPrimary: true,
      button: 0,
      target: button,
      preventDefault() {
        prevented = true;
      },
      ...overrides,
    });
    return prevented;
  };
  return {
    render,
    selection,
    document,
    button,
    Element,
    pointer,
    errors,
    hooks,
    props,
    module,
    resolve: () => module.resolve({ locateSelection }),
    get view() {
      return view;
    },
  };
}

test("primary toolbar activation retains the chosen prose until Rewrite opens its local dialog", async () => {
  const f = fixture();
  assert.equal(f.view.selectedText, "chosen passage");
  assert.equal(f.pointer(), true, "Only the toolbar action cancels collapse-on-pointerdown");
  const opening = f.view.openSelectionEdit();
  // Even a later native selectionchange cannot alter this click's snapshot during lazy load.
  f.selection.isCollapsed = true;
  f.view.rememberSelection();
  f.render();
  assert.equal(f.view.lastSelectionRef.current, "");
  f.resolve();
  await opening;
  f.render();
  assert.equal(f.view.selectionOpen, true);
  assert.deepEqual(f.view.selectionTarget, {
    source: "Before chosen passage after.",
    start: 7,
    end: 21,
  });
  assert.equal(f.view.selectionInstruction, "");
  assert.deepEqual(f.errors, []);
});

test("Shorten only prefills a local edit instruction and never runs a rewrite", async () => {
  const f = fixture();
  const opening = f.view.openSelectionEdit("Shorten this passage while preserving its meaning.");
  f.resolve();
  await opening;
  f.render();
  assert.equal(f.view.selectionOpen, true);
  assert.equal(f.view.selectionInstruction, "Shorten this passage while preserving its meaning.");
  const editor = readFileSync("src/components/SelectionEditDialog.tsx", "utf8");
  assert.match(editor, /useState\(initialInstruction\)/);
  assert.match(editor, /onClick=\{\(\) => void generate\(\)\}/);
});

test("secondary clicks, nonprimary pointers and prose dragging keep native defaults", () => {
  const f = fixture();
  assert.equal(f.pointer({ button: 2 }), false);
  assert.equal(f.pointer({ isPrimary: false }), false);
  assert.equal(f.pointer({ target: new f.Element(false) }), false);
  assert.equal(f.pointer({ target: {} }), false);
  assert.doesNotMatch(source, /onContextMenu=.*preventDefault|onSelectStart/);
});

test("keyboard focus in the toolbar retains the passage; leaving it clears a collapsed range", () => {
  const f = fixture();
  f.document.activeElement = f.button;
  f.selection.isCollapsed = true;
  f.view.rememberSelection();
  f.render();
  assert.equal(f.view.selectedText, "chosen passage");
  f.document.activeElement = {};
  f.view.blur({ currentTarget: f.view.selectionActionsRef.current, relatedTarget: null });
  f.render();
  assert.equal(f.view.selectedText, "");
  assert.equal(f.view.lastSelectionRef.current, "");
});

for (const endpoint of ["anchorNode", "focusNode"]) {
  test(`selection ending outside the prose (${endpoint}) clears both toolbar and stale snapshot`, () => {
    const f = fixture();
    f.selection[endpoint] = {};
    f.selection.toString = () => "chosen passage Response stopped Retry";
    f.view.rememberSelection();
    f.render();
    assert.equal(f.view.selectedText, "");
    assert.equal(f.view.lastSelectionRef.current, "");
  });
}

test("the prose containment boundary excludes stopped/status, retry, label, and toolbar controls", () => {
  const wrapper = nodes.find(
    (node) =>
      ts.isJsxElement(node) &&
      node.openingElement.attributes.properties.some(
        (prop) =>
          ts.isJsxAttribute(prop) &&
          prop.name.getText(ast) === "ref" &&
          prop.initializer.expression.getText(ast) === "bodyRef",
      ),
  );
  assert.ok(wrapper);
  const markup = wrapper.getText(ast);
  assert.match(markup, /className="prose-chat"/);
  for (const disallowed of [
    "Response stopped",
    "Retry stopped response",
    "Selected text actions",
    "ToolConfirmCard",
    ">Kova<",
  ])
    assert.equal(markup.includes(disallowed), false);
});

test("Ask snapshots the selected passage before dialog focus collapses native selection", () => {
  const f = fixture();
  f.view.ask();
  f.render();
  f.selection.isCollapsed = true;
  f.view.rememberSelection();
  f.render();
  assert.equal(f.view.lastSelectionRef.current, "");
  assert.equal(f.view.selectionAskPassage, "chosen passage");
  assert.equal(f.view.selectionAskOpen, true);
});

for (const boundary of ["context", "content", "account clear", "unmount"]) {
  test(`a ${boundary} change cannot open a stale selection dialog after the lazy module resolves`, async () => {
    const f = fixture();
    const opening = f.view.openSelectionEdit();
    if (boundary === "context") f.render({ studyContextKey: "owner-b:chat-a:message-a" });
    if (boundary === "content") f.render({ message: { content: "New response" } });
    if (boundary === "account clear") f.props.lifecycleGenerationRef.current++;
    if (boundary === "unmount") f.hooks.unmount();
    f.resolve();
    await opening;
    f.render();
    assert.equal(f.view.selectionOpen, false);
  });
}
