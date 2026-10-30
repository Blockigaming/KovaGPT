import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync("src/routes/apps.tsx", "utf8");
const parsed = ts.createSourceFile(
  "apps.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const declaration = (name) =>
  parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
const page = declaration("AppsPage");
const card = declaration("AppCard");
const matching = (root, predicate) => {
  const results = [];
  const visit = (node) => {
    if (predicate(node)) results.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return results;
};
const attributeExpression = (root, name, includes = "") => {
  const attributes = matching(
    root,
    (node) =>
      ts.isJsxAttribute(node) &&
      node.name.getText(parsed) === name &&
      node.getText(parsed).includes(includes),
  );
  assert.equal(attributes.length, 1, `Expected exactly one ${name} handler`);
  return attributes[0].initializer.expression.getText(parsed);
};
const compile = (code, dependencies) => {
  const javascript = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(dependencies), javascript)(...Object.values(dependencies));
};

function focusFixture() {
  const focused = [];
  const target = (name) => ({
    name,
    isConnected: true,
    getClientRects: () => [{}],
    closest: () => null,
    matches: () => false,
    focus: (options) => focused.push({ name, options }),
  });
  const window = { location: { href: "https://local.invalid/apps" } };
  const detailsReturnRef = { current: null };
  const principalRef = { current: "user:current" };
  const searchRef = { current: target("search") };
  const item = { id: "hubspot", label: "HubSpot" };
  const selections = [];
  const restoreSource = readFileSync("src/lib/dialog-return-focus.ts", "utf8").replace(
    /^export function/gm,
    "function",
  );
  const restoreDialogFocus = compile(`${restoreSource}; return restoreDialogFocus;`, { window });
  const open = compile(`return (${attributeExpression(page, "onDetails")});`, {
    detailsReturnRef,
    principalRef,
    window,
    item,
    setSelectedApp: (value) => selections.push(value),
  });
  const click = compile(`return (${attributeExpression(card, "onClick", "onDetails")});`, {
    onDetails: open,
  });
  const detailDialogs = matching(
    page,
    (node) =>
      ts.isJsxOpeningElement(node) &&
      node.tagName.getText(parsed) === "DialogContent" &&
      node.attributes.properties.some(
        (attribute) =>
          ts.isJsxAttribute(attribute) &&
          attribute.name.getText(parsed) === "closeLabel" &&
          attribute.initializer?.text === "Close connection details",
      ),
  );
  assert.equal(detailDialogs.length, 1, "Expected the named provider-details dialog");
  const close = compile(`return (${attributeExpression(detailDialogs[0], "onCloseAutoFocus")});`, {
    detailsReturnRef,
    principalRef,
    searchRef,
    restoreDialogFocus,
  });
  return {
    target,
    focused,
    window,
    principalRef,
    selections,
    item,
    open(trigger) {
      click({ currentTarget: trigger, target: { name: "nested icon" } });
    },
    close() {
      let prevented = false;
      close({ preventDefault: () => (prevented = true) });
      assert.equal(prevented, true);
    },
  };
}

test("provider cards retain stable identity in the All and Connected directory", () => {
  assert.ok(declaration("AppCard"));
  assert.equal(
    matching(
      page,
      (node) => ts.isFunctionDeclaration(node) && node.name?.getText(parsed) === "AppCard",
    ).length,
    0,
  );
  assert.match(source, /connectionFilter === "connected" && !hasConnection/);
  assert.match(source, /<Input\s+ref=\{searchRef\}/);
});

test("closing provider details restores the exact latest invoker across repeated opens", () => {
  const fixture = focusFixture();
  for (const name of ["hubspot-details", "salesforce-details", "hubspot-details"]) {
    fixture.open(fixture.target(name));
    fixture.close();
    assert.deepEqual(fixture.focused.at(-1), { name, options: { preventScroll: true } });
    assert.equal(fixture.selections.at(-1), fixture.item);
  }
  assert.equal(fixture.focused.length, 3);
});

test("closing provider details falls back to search if its original row disappeared", () => {
  const fixture = focusFixture();
  const trigger = fixture.target("removed-details");
  fixture.open(trigger);
  trigger.isConnected = false;
  fixture.close();
  assert.deepEqual(fixture.focused, [{ name: "search", options: { preventScroll: true } }]);
});

test("provider detail dismissal cannot steal focus after navigation or an account change", () => {
  for (const change of ["page", "account"]) {
    const fixture = focusFixture();
    fixture.open(fixture.target("old-details"));
    if (change === "page") fixture.window.location.href = "https://local.invalid/library";
    else fixture.principalRef.current = "user:different";
    fixture.close();
    assert.deepEqual(fixture.focused, []);
  }
});
