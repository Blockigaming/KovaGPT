import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { loadUiModule, createHookHarness, elements, text } from "../helpers/ui-state-harness.mjs";
test("model availability control is informative, gated, and exposes no invented selection", () => {
  const hooks = createHookHarness();
  const { ComposerModelStatus } = loadUiModule("src/components/ComposerModelStatus.tsx", {
    react: hooks.react,
    "lucide-react": { ChevronDown: "ChevronDown" },
    "@/components/ui/popover": {
      Popover: "Popover",
      PopoverTrigger: "PopoverTrigger",
      PopoverContent: "PopoverContent",
    },
  });
  assert.equal(hooks.render(ComposerModelStatus, { visible: false }), null);
  const tree = hooks.render(ComposerModelStatus, { visible: true }),
    buttons = elements(tree, (n) => n.type === "button");
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].props.type, "button");
  assert.equal(buttons[0].props["aria-label"], "Model availability");
  const content = elements(tree, (n) => n.type === "PopoverContent")[0],
    heading = elements(tree, (n) => n.type === "h2")[0];
  assert.equal(content.props["aria-labelledby"], heading.props.id);
  assert.equal(content.props.side, "top");
  assert.equal(content.props.align, "end");
  assert.match(text(content), /Model selection isn’t available/);
  assert.match(text(content), /serving model isn’t confirmed/);
  assert.equal(
    elements(
      tree,
      (n) =>
        ["option", "select", "input"].includes(n.type) ||
        ["option", "menuitemradio"].includes(n.props.role),
    ).length,
    0,
  );
  assert.equal(
    hooks.render(ComposerModelStatus, { visible: false }),
    null,
    "account loss removes popover subtree",
  );
});
test("both workspace composers request gated status while keeping agent selection off", () => {
  const workspace = readFileSync("src/components/ChatWorkspace.tsx", "utf8"),
    input = readFileSync("src/components/ChatInput.tsx", "utf8");
  assert.equal([...workspace.matchAll(/canChangeAgent=\{false\}\s+showModelStatus/g)].length, 2);
  const expression = input.match(/<ComposerModelStatus visible=\{([^}]+)\}/)?.[1];
  assert.ok(expression);
  for (const [showModelStatus, isLoaded, user, expected] of [
    [true, true, { id: "plus" }, true],
    [true, true, null, false],
    [true, false, { id: "plus" }, false],
    [false, true, { id: "pro" }, false],
  ])
    assert.equal(vm.runInNewContext(expression, { showModelStatus, isLoaded, user }), expected);
  assert.match(workspace, /mode: CORE_LAUNCH_MODE/);
  assert.match(input, /!\(canChangeAgent && mode && onModeChange\) && \(\s*<ComposerModelStatus/);
});
