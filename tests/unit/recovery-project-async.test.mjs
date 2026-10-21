import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
const source = readFileSync(
  new URL("../../src/routes/projects.$projectId.tsx", import.meta.url),
  "utf8",
);
const library = readFileSync(new URL("../../src/routes/library.tsx", import.meta.url), "utf8");
function compile(code, dependencies) {
  const javascript = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  return new Function(...Object.keys(dependencies), javascript)(...Object.values(dependencies));
}
function findNode(text, predicate) {
  const file = ts.createSourceFile(
    "route.tsx",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let result;
  function visit(node) {
    if (predicate(node)) result = node;
    else ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(result);
  return result.getText(file);
}
function hookFixture(onSave) {
  const component = source.slice(
    source.indexOf("function ProjectInstructionsTab("),
    source.indexOf("// ===================== NOTES"),
  );
  const slots = [],
    timers = new Map();
  let cursor = 0,
    sequence = 0,
    effects = [],
    tree;
  const props = { project: { id: "project-a", system_prompt: "Initial" }, canEdit: true, onSave };
  const renderComponent = compile(`${component}\nreturn ProjectInstructionsTab;`, {
    React: {
      createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    },
    Textarea: "textarea",
    Button: "button",
    useUser: () => ({ user: { id: "sample-owner" } }),
    projectInstructionDrafts: new Map(),
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
      return [
        slots[i],
        (value) => {
          slots[i] = typeof value === "function" ? value(slots[i]) : value;
        },
      ];
    },
    useRef(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { current: initial };
      return slots[i];
    },
    useEffect(callback, dependencies) {
      const i = cursor++,
        previous = slots[i];
      if (
        !previous ||
        dependencies.some((value, index) => value !== previous.dependencies[index])
      ) {
        previous?.cleanup?.();
        slots[i] = { dependencies };
        effects.push(() => {
          slots[i].cleanup = callback();
        });
      }
    },
    setTimeout(callback) {
      const id = ++sequence;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  });
  const render = () => {
    cursor = 0;
    effects = [];
    tree = renderComponent(props);
    effects.forEach((effect) => effect());
    return tree;
  };
  function find(type) {
    const walk = (node) => {
      if (!node || typeof node !== "object") return null;
      if (typeof type === "function" ? type(node) : node.type === type) return node;
      return node.children?.map(walk).find(Boolean);
    };
    return walk(tree);
  }
  render();
  render();
  return {
    props,
    render,
    timers,
    find,
    type(value) {
      find("textarea").props.onChange({ target: { value } });
      render();
    },
    async fire(label = "Save changes") {
      const save = find((node) => node.type === "button" && node.children?.join("") === label);
      assert.ok(save, "Explicit Save changes must be present");
      save.props.onClick();
      render();
      await Promise.resolve();
      render();
    },
  };
}

test("instructions use the visible heading as their accessible name for editors and viewers", () => {
  for (const canEdit of [true, false]) {
    const fixture = hookFixture(async () => {});
    fixture.props.canEdit = canEdit;
    fixture.render();
    const field = fixture.find("textarea");
    const heading = fixture.find("h2");
    assert.equal(field.props["aria-labelledby"], heading.props.id);
    assert.equal(heading.children.join(""), "Project instructions");
    assert.equal(field.props["aria-describedby"], "project-instructions-help");
    assert.ok(fixture.find((node) => node.props.id === "project-instructions-help"));
    assert.equal(field.props.disabled, !canEdit);
  }
});

test("instructions serialize saves and keep a newer draft when completed-save props arrive", async () => {
  const calls = [],
    finishes = [];
  const fixture = hookFixture((value) => {
    calls.push(value);
    return new Promise((resolve) => finishes.push(resolve));
  });
  fixture.type("First edit");
  const pending = fixture.fire();
  fixture.type("Newer draft");
  assert.equal(fixture.timers.size, 0);
  fixture.props.project = { id: "project-a", system_prompt: "First edit" };
  fixture.render();
  assert.equal(fixture.find("textarea").props.value, "Newer draft");
  finishes.shift()();
  await pending;
  fixture.render();
  assert.equal(fixture.timers.size, 0, "Typing never starts an automatic save");
  const second = fixture.fire();
  assert.deepEqual(calls, ["First edit", "Newer draft"]);
  finishes.shift()();
  await second;
  fixture.render();
});

test("instruction failure retains text and Retry uses the same guarded save path", async () => {
  let calls = 0;
  const fixture = hookFixture(async () => {
    if (++calls === 1) throw new Error("Offline");
  });
  fixture.type("Retained instructions");
  await fixture.fire();
  fixture.render();
  assert.equal(fixture.find("textarea").props.value, "Retained instructions");
  assert.equal(
    fixture.find("textarea").props["aria-describedby"],
    "project-instructions-help project-instructions-error",
  );
  assert.ok(fixture.find((node) => node.props.id === "project-instructions-error"));
  assert.equal(fixture.timers.size, 0);
  await fixture.fire("Retry");
  fixture.render();
  assert.equal(calls, 2);
  assert.equal(
    fixture.find((node) => node.type === "button" && node.children?.join("") === "Save changes")
      .props.disabled,
    true,
  );
  assert.equal(fixture.find("textarea").props["aria-describedby"], "project-instructions-help");
  assert.equal(
    fixture.find((node) => node.props.id === "project-instructions-error"),
    undefined,
  );
});

test("single Library delete rollback restores only its failed item", () => {
  const declaration = findNode(
    library,
    (node) => ts.isVariableDeclaration(node) && node.name.getText() === "restoreDeletedItem",
  );
  const a = { id: "a" },
    b = { id: "b" },
    c = { id: "c" },
    fresh = { id: "new" };
  let items = [c, fresh]; // a failed; b was independently deleted successfully.
  const restore = compile(`const ${declaration}; return restoreDeletedItem;`, {
    existing: [a, b, c],
    id: "a",
    setItems: (update) => {
      items = update(items);
    },
  });
  restore();
  assert.deepEqual(items, [a, c, fresh]);
  restore();
  assert.deepEqual(items, [a, c, fresh]);
});

test("Project settings saves preserve mounted drafts and guard post-account-switch effects", () => {
  const settings = source.slice(
    source.indexOf("<SettingsTab"),
    source.indexOf("</TabsContent>", source.indexOf("<SettingsTab")),
  );
  assert.doesNotMatch(settings, /await refresh\(/);
  assert.equal(
    (settings.match(/currentRequestKeyRef.current !== operationRequestKey/g) ?? []).length,
    4,
  );
  const component = source.slice(source.indexOf("function SettingsTab"));
  assert.match(component, /disabled=\{saving \|\| !name.trim\(\)\}/);
  assert.match(component, /if \(saving \|\| !name.trim\(\)\) return/);
});
