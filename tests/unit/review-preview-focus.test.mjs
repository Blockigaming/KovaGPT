import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { taskTimezone } from "../../src/lib/scheduled-task-policy.mjs";

// Exercise the components' focus effects after a simulated ref commit. This is a
// focused unit check; real browser keyboard and screen-reader QA remain separate.
function previewHarness(name) {
  const hooks = [];
  const body = { type: "body", props: {} };
  let cursor = 0;
  let effects = [];
  let nodes = new Map();
  let activeElement = body;
  const jsx = (type, props, key) => ({ type, props, key });
  const react = {
    useReducer(reducer, argument, initialize) {
      const slot = cursor++;
      hooks[slot] ??= { value: initialize ? initialize(argument) : argument };
      return [
        hooks[slot].value,
        (action) => (hooks[slot].value = reducer(hooks[slot].value, action)),
      ];
    },
    useRef(value) {
      const slot = cursor++;
      hooks[slot] ??= { current: value };
      return hooks[slot];
    },
    useEffect(effect, dependencies) {
      const slot = cursor++;
      const previous = hooks[slot];
      if (!previous || dependencies.some((value, index) => !Object.is(value, previous[index]))) {
        effects.push(effect);
      }
      hooks[slot] = dependencies;
    },
  };
  react.useLayoutEffect = react.useEffect;
  const source = readFileSync(
    new URL(`../../review-kit/components/${name}.tsx`, import.meta.url),
    "utf8",
  );
  const { code } = transformSync(source, { loader: "tsx", format: "cjs", jsx: "automatic" });
  const module = { exports: {} };
  const imports = {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "@/components/ui/button": { Button: "button" },
    "@/components/ui/input": { Input: "input" },
    "@/components/ui/label": { Label: "label" },
    "@/components/ui/textarea": { Textarea: "textarea" },
    "@/lib/scheduled-task-policy.mjs": { taskTimezone },
    // Attachment removal and its DOM helper are covered by review-support-attachment-focus.
    "@/lib/dialog-return-focus": {},
  };
  new Function("module", "exports", "require", code)(module, module.exports, (id) => {
    assert.ok(id in imports, `Unexpected dependency: ${id}`);
    return imports[id];
  });

  function render() {
    cursor = 0;
    effects = [];
    const tree = module.exports[name]();
    const nextNodes = new Map();
    for (const node of nodes.values()) {
      if (node.props.ref) node.props.ref.current = null;
    }
    function commit(element, path = "root") {
      if (Array.isArray(element)) {
        element.forEach((child, index) => commit(child, `${path}.${child?.key ?? index}`));
        return;
      }
      if (!element || typeof element !== "object") return;
      const key = `${path}:${element.type}`;
      const node = nodes.get(key) ?? {
        type: element.type,
        focus() {
          if (
            !this.props.disabled &&
            (["button", "input", "select", "textarea"].includes(this.type) ||
              this.props.tabIndex !== undefined)
          ) {
            activeElement = this;
          }
        },
      };
      node.props = element.props;
      nextNodes.set(key, node);
      if (node.props.ref) node.props.ref.current = node;
      commit(element.props.children, `${key}.children`);
    }
    commit(tree);
    if (![...nextNodes.values()].includes(activeElement)) activeElement = body;
    nodes = nextNodes;
    effects.forEach((effect) => effect());
  }
  function text(element) {
    if (Array.isArray(element)) return element.map(text).join("");
    if (element && typeof element === "object") return text(element.props.children);
    return element == null || typeof element === "boolean" ? "" : String(element);
  }
  render();
  return {
    get activeElement() {
      return activeElement;
    },
    click(label, index = 0) {
      const button = [...nodes.values()].filter(
        (node) => node.type === "button" && text(node.props.children) === label,
      )[index];
      assert.ok(button, `Missing button: ${label}`);
      assert.ok(!button.props.disabled, `Disabled button: ${label}`);
      button.focus();
      if (button.props.onClick) button.props.onClick({ currentTarget: button });
      else if (button.props.type === "submit") {
        const form = [...nodes.values()].find((node) => node.type === "form");
        form.props.onSubmit({ preventDefault() {} });
      }
      render();
      return button;
    },
    change(predicate, target) {
      const field = [...nodes.values()].find(predicate);
      assert.ok(field, "Missing field");
      field.focus();
      field.props.onChange({ target });
      render();
      return field;
    },
  };
}

test("session confirmation focuses its heading and cancel restores either originating device", () => {
  const preview = previewHarness("SessionsPreview");
  assert.equal(preview.activeElement.type, "body", "mount must not steal focus");
  for (const index of [0, 1, 0]) {
    const trigger = preview.click("Preview revoke", index);
    assert.equal(preview.activeElement.props.id, "revoke-preview-title");
    assert.equal(trigger.props.disabled, true);
    preview.click("Cancel sample revoke");
    assert.equal(preview.activeElement, trigger);
    assert.equal(trigger.props.disabled, false);
  }
});

test("session retry focuses its success status and subsequent cancel/reset retain useful focus", () => {
  const preview = previewHarness("SessionsPreview");
  preview.click("Preview revoke");
  const failure = preview.click("Simulate revoke failure");
  assert.equal(preview.activeElement, failure);
  preview.click("Retry sample revoke");
  assert.equal(preview.activeElement.props.role, "status");
  const remainingTrigger = preview.click("Preview revoke");
  preview.click("Cancel sample revoke");
  assert.equal(preview.activeElement, remainingTrigger);
  const reset = preview.click("Reset sample sessions");
  assert.equal(preview.activeElement, reset);
});

test("delivery review/back/failure/save focus their newly available destination", () => {
  const preview = previewHarness("TaskDeliveryPreview");
  assert.equal(preview.activeElement.type, "body", "mount must not steal focus");
  preview.click("Review sample preferences");
  assert.equal(preview.activeElement.props.id, "delivery-review-title");
  preview.click("Back to draft");
  assert.equal(preview.activeElement.props.children, "Review sample preferences");
  preview.click("Review sample preferences");
  preview.click("Simulate save failure");
  assert.equal(preview.activeElement.props.role, "alert");
  preview.click("Review sample preferences");
  preview.click("Save sample preferences");
  assert.equal(preview.activeElement.props.role, "status");
  const reset = preview.click("Reset delivery preview");
  assert.equal(preview.activeElement, reset);
  preview.click("Review sample preferences");
  preview.click("Cancel draft changes");
  assert.equal(preview.activeElement.props.children, "Review sample preferences");
});

test("support validation focuses the first invalid field without disrupting ordinary edits", () => {
  const preview = previewHarness("SupportRequestPreview");
  assert.equal(preview.activeElement.type, "body", "mount must not steal focus");
  for (const [field, value] of [
    ["category", "Report a problem"],
    ["email", "preview@example.invalid"],
    ["message", "The sample button did not open."],
  ]) {
    preview.click("Simulate send");
    assert.equal(preview.activeElement.props.id, `preview-support-${field}`);
    const input = preview.change((node) => node.props.id === `preview-support-${field}`, { value });
    assert.equal(preview.activeElement, input);
  }
  preview.click("Simulate send");
  assert.equal(preview.activeElement.props.role, "status");
  assert.match(preview.activeElement.props.children, /Simulated sending/);
  preview.click("Simulate failure");
  assert.equal(preview.activeElement.props.role, "alert");
  preview.click("Retry local simulation");
  assert.match(preview.activeElement.props.children, /Simulated sending/);
  preview.click("Cancel simulation");
  assert.equal(preview.activeElement.props.children, "Simulate send");
  preview.click("Simulate send");
  preview.click("Simulate success");
  assert.equal(preview.activeElement.props.role, "status");
  assert.match(preview.activeElement.props.children, /Local simulation complete/);
  preview.click("Start a new local draft");
  assert.equal(preview.activeElement.props.id, "preview-support-category");
});

test("trial transitions focus state details and returns restore their initiating control", () => {
  const preview = previewHarness("TrialPreview");
  assert.equal(preview.activeElement.type, "body", "mount must not steal focus");
  preview.click("Preview trial start");
  assert.equal(preview.activeElement.props.children, "Start · sample state");
  preview.click("Cancel start preview");
  assert.equal(preview.activeElement.props.children, "Preview trial start");
  preview.click("Preview trial start");
  const checkbox = preview.change((node) => node.props.type === "checkbox", { checked: true });
  assert.equal(preview.activeElement, checkbox);
  preview.click("Simulate trial start");
  assert.equal(preview.activeElement.props.children, "Active · sample state");
  preview.click("Simulate ending state");
  assert.equal(preview.activeElement.props.children, "Ending · sample state");
  preview.click("Preview cancellation");
  assert.equal(preview.activeElement.props.children, "Confirm sample cancellation");
  preview.click("Return without canceling");
  assert.equal(preview.activeElement.props.children, "Preview cancellation");
  preview.click("Preview cancellation");
  preview.click("Confirm sample cancellation");
  assert.equal(preview.activeElement.props.children, "Canceled · sample state");
  const reset = preview.click("Reset trial preview");
  assert.equal(preview.activeElement, reset);
  const select = preview.change((node) => node.type === "select", { value: "active" });
  assert.equal(preview.activeElement, select, "sample selector must retain keyboard focus");
  preview.click("Simulate expiry");
  assert.equal(preview.activeElement.props.children, "Expired · sample state");
});
