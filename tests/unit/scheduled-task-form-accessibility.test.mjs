import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// The short inline form was replaced by the specified single modal editor.
const source = readFileSync("src/components/ScheduledTaskEditor.tsx", "utf8");
const parsed = ts.createSourceFile(
  "editor.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const labels = [];
function visit(node) {
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(parsed) === "label")
    labels.push(node);
  ts.forEachChild(node, visit);
}
visit(parsed);
const labelFor = (name) =>
  labels.find((label) =>
    label.children.some((child) => ts.isJsxText(child) && child.text.trim() === name),
  );

test("scheduled task fields are named by their persistent wrapping labels", () => {
  for (const name of ["Title", "Prompt", "Frequency", "Weekday", "Time", "Timezone"]) {
    const label = labelFor(name);
    assert.ok(label, `Missing visible ${name} label`);
    assert.match(label.getText(parsed), /<(?:input|textarea|select)\b/);
  }
});
test("modal controls retain 44px minimum targets and 120px prompt", () => {
  assert.match(source, /const control = "min-h-11/);
  assert.match(source, /const button = "min-h-11/);
  assert.match(labelFor("Prompt").getText(parsed), /min-h-\[120px\]/);
  assert.match(source, /<Dialog\s+open/);
});
test("visible labels preserve draft bindings and deliberate consent-gated save", () => {
  for (const [name, field, setter] of [
    ["Title", "title", "setTitle"],
    ["Prompt", "prompt", "setPrompt"],
    ["Frequency", "repeat", "setRepeat"],
    ["Timezone", "timezone", "setTimezone"],
  ]) {
    const control = labelFor(name).getText(parsed);
    assert.ok(control.includes(`value={${field}}`));
    assert.ok(control.includes(`${setter}(event.target.value`));
  }
  assert.match(source, /onSubmit=\{\(event\) => \{\s*event.preventDefault\(\);/);
  assert.match(
    source,
    /const submitter = \(event.nativeEvent as SubmitEvent \| undefined\)\?\.submitter/,
  );
  assert.match(source, /save\(submitter instanceof HTMLElement \? submitter : undefined\)/);
  assert.match(source, /validateScheduledTaskDraft/);
  assert.match(source, /Save schedule/);
});
