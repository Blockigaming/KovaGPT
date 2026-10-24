import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as icons from "lucide-react";
import ts from "typescript";
import { elements, text } from "../helpers/ui-state-harness.mjs";

const path = "src/components/ChatMessage.tsx";
const source = readFileSync(path, "utf8");
const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const providers = [];
function visit(node) {
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "TooltipProvider")
    providers.push(node);
  ts.forEachChild(node, visit);
}
visit(ast);

function loadSharedTooltips() {
  const compiled = ts.transpileModule(readFileSync("src/components/ui/tooltip.tsx", "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
    },
  }).outputText;
  const dependencies = {
    react: React,
    "@radix-ui/react-tooltip": TooltipPrimitive,
    "@/lib/utils": { cn: (...values) => values.filter(Boolean).join(" ") },
  };
  const module = { exports: {} };
  new Function("module", "exports", "require", compiled)(module, module.exports, (name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected shared tooltip import: ${name}`);
    return dependencies[name];
  });
  return module.exports;
}
const shared = loadSharedTooltips();

// Execute the actual bounded JSX and shared primitives. SSR confirms the button
// DOM shape; live browser hover/focus timing remains separate native evidence.
function fixture(state = {}) {
  assert.equal(providers.length, 1);
  const calls = [];
  const dependencies = {
    React,
    ...shared,
    ...Object.fromEntries(
      ["Copy", "Check", "ThumbsUp", "ThumbsDown", "Loader2", "Bookmark"].map((name) => [
        name,
        icons[name],
      ]),
    ),
    copied: false,
    feedback: null,
    feedbackSaving: false,
    feedbackLoadFailed: false,
    saving: false,
    saved: false,
    copy: () => calls.push(["copy"]),
    persistFeedback: (value) => calls.push(["feedback", value]),
    saveItem: () => calls.push(["save"]),
    ...state,
  };
  const compiled = ts.transpileModule(`return (${providers[0].getText(ast)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  const tree = new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies));
  const roots = elements(tree, (node) => node.type === shared.Tooltip);
  const controls = roots.map((root) => {
    const trigger = elements(root, (node) => node.type === shared.TooltipTrigger)[0];
    const content = elements(root, (node) => node.type === shared.TooltipContent)[0];
    const button = elements(trigger, (node) => node.type === "button")[0];
    return { root, trigger, content, button };
  });
  return { tree, controls, calls, dependencies };
}

test("the four response icons share the existing keyboard-and-pointer tooltip primitives", () => {
  const f = fixture();
  assert.equal(f.tree.type, shared.TooltipProvider);
  assert.equal(f.tree.props.delayDuration, undefined);
  assert.equal(f.tree.props.skipDelayDuration, undefined);
  const provider = shared.TooltipProvider(f.tree.props);
  assert.equal(provider.type, TooltipPrimitive.Provider);
  assert.equal(provider.props.delayDuration, 300);
  assert.equal(provider.props.skipDelayDuration, 120);
  assert.equal(shared.Tooltip, TooltipPrimitive.Root);
  assert.equal(shared.TooltipTrigger, TooltipPrimitive.Trigger);
  assert.deepEqual(
    f.controls.map(({ button }) => button.props["aria-label"]),
    ["Copy response", "Good response", "Bad response", "Save to Library"],
  );
  for (const { root, trigger, content, button } of f.controls) {
    assert.deepEqual(Object.keys(root.props), ["children"], "No open state or timing overrides");
    assert.equal(trigger.props.asChild, true);
    assert.equal(trigger.props.children, button, "No focusable wrapper around the original button");
    assert.equal(text(content), button.props["aria-label"]);
    assert.equal(button.props.type, "button");
    assert.equal(button.props.title, undefined, "Avoid competing native hover-only titles");
    assert.match(button.props.className, /\bkova-message-icon-action\b/);
    for (const event of ["onFocus", "onBlur", "onPointerMove", "onPointerLeave", "onPointerDown"]) {
      assert.equal(trigger.props[event], undefined, `${event} stays owned by Radix`);
      assert.equal(button.props[event], undefined);
    }
  }
  const toolbar = providers[0].parent;
  assert.ok(ts.isJsxElement(toolbar));
  assert.match(toolbar.openingElement.getText(ast), /role="toolbar"/);
  assert.match(toolbar.openingElement.getText(ast), /aria-label="Response actions"/);
});

test("actual shared Tooltip SSR keeps four native direct-child buttons and no layout wrapper", () => {
  const f = fixture();
  const html = renderToStaticMarkup(React.createElement("div", { role: "toolbar" }, f.tree));
  const withoutButtons = html.replace(/<button\b[^>]*>[\s\S]*?<\/button>/g, "");
  assert.equal((html.match(/<button\b/g) ?? []).length, 4);
  assert.equal((html.match(/data-state="closed"/g) ?? []).length, 4);
  assert.equal(withoutButtons, '<div role="toolbar"></div>');
  assert.doesNotMatch(html, /\btitle=/);
});

test("tooltip copy follows copied and saving/saved state without replacing icons or disabled state", () => {
  for (const state of [
    {},
    { copied: true, saving: true },
    { saved: true, feedback: "up" },
    { feedback: "down" },
    { feedbackSaving: true },
    { feedbackLoadFailed: true },
  ]) {
    const f = fixture(state);
    const [copy, good, bad, save] = f.controls;
    assert.equal(text(copy.content), state.copied ? "Copied" : "Copy response");
    assert.equal(copy.button.props.children.type, state.copied ? icons.Check : icons.Copy);
    assert.equal(good.button.props["aria-pressed"], state.feedback === "up");
    assert.equal(bad.button.props["aria-pressed"], state.feedback === "down");
    assert.equal(
      good.button.props.disabled,
      Boolean(state.feedbackSaving || state.feedbackLoadFailed),
    );
    assert.equal(bad.button.props.disabled, good.button.props.disabled);
    assert.equal(save.button.props.disabled, Boolean(state.saving));
    assert.equal(
      text(save.content),
      state.saved ? "Saved to Library" : state.saving ? "Saving to Library" : "Save to Library",
    );
    assert.equal(
      save.button.props.children.type,
      state.saving ? icons.Loader2 : state.saved ? icons.Check : icons.Bookmark,
    );
    for (const { content, button } of f.controls)
      assert.equal(text(content), button.props["aria-label"]);
  }
});

test("tooltip wrapping preserves the existing copy, toggle-rating and save callbacks", () => {
  for (const feedback of [null, "up", "down"]) {
    const f = fixture({ feedback });
    const [copy, good, bad, save] = f.controls;
    assert.equal(copy.button.props.onClick, f.dependencies.copy);
    assert.deepEqual(f.calls, [], "Rendering tooltip content cannot execute an action");
    for (const { button } of f.controls) button.props.onClick();
    assert.deepEqual(f.calls, [
      ["copy"],
      ["feedback", feedback === "up" ? null : "up"],
      ["feedback", feedback === "down" ? null : "down"],
      ["save"],
    ]);
    assert.equal(good.button.props["aria-label"], "Good response");
    assert.equal(bad.button.props["aria-label"], "Bad response");
    assert.equal(save.button.props["aria-label"], "Save to Library");
  }
});
