import assert from "node:assert/strict";
import test from "node:test";
import { fixtureElement, nativeControlModules } from "../helpers/native-control-bindings.mjs";

test("thin control fixtures retain native type, disabled state, event handlers and forwarded refs", () => {
  for (const [path, name, type] of [
    ["button", "Button", "button"],
    ["input", "Input", "input"],
    ["textarea", "Textarea", "textarea"],
  ]) {
    const ref = { current: null };
    const onChange = () => {};
    const props = { ref, onChange, disabled: true, type: "submit", children: "Retained content" };
    const rendered = fixtureElement(nativeControlModules[`@/components/ui/${path}`][name], props);
    assert.equal(rendered.type, type);
    assert.equal(rendered.props.ref, ref);
    assert.equal(rendered.props.onChange, onChange);
    assert.equal(rendered.props.disabled, true);
    assert.equal(rendered.props.type, "submit");
    assert.equal(rendered.props.children, "Retained content");
  }
});

test("asChild keeps the native child, composes both refs and runs child then parent handlers", () => {
  const calls = [];
  const ref = { current: null };
  const child = fixtureElement("a", {
    href: "/library",
    ref: (node) => calls.push(["child-ref", node]),
    onClick: () => {
      calls.push("child-click");
      return "child-result";
    },
    className: "child",
    style: { color: "red" },
    children: "Open Library",
  });
  const rendered = fixtureElement(nativeControlModules["@/components/ui/button"].Button, {
    asChild: true,
    ref,
    onClick: () => calls.push("parent-click"),
    className: "parent",
    style: { color: "blue", padding: 4 },
    children: child,
  });
  assert.equal(rendered.type, "a");
  assert.equal(rendered.props.href, "/library");
  assert.equal(rendered.props.className, "parent child");
  assert.deepEqual(rendered.props.style, { color: "red", padding: 4 });
  assert.equal(rendered.props.children, "Open Library");
  const node = { focus() {} };
  rendered.props.ref(node);
  assert.equal(ref.current, node);
  assert.equal(rendered.props.onClick(), "child-result");
  assert.deepEqual(calls, [["child-ref", node], "child-click", "parent-click"]);
});

test("asChild cannot silently replace an invalid or missing child with a fake button", () => {
  for (const children of [null, "Text", [], [fixtureElement("a", {})]])
    assert.throws(() =>
      fixtureElement(nativeControlModules["@/components/ui/button"].Button, {
        asChild: true,
        children,
      }),
    );
});
