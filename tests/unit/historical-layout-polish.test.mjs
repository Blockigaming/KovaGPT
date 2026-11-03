import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = (name) => readFileSync(new URL("../../src/" + name, import.meta.url), "utf8");
test("Work objective controls align on a 44px bottom edge and execution has separation", () => {
  const source = read("components/WorkSessionPanel.tsx");
  assert.match(source, /const button = "min-h-11/);
  assert.match(source, /mt-3 flex flex-wrap items-end gap-2/);
  assert.match(source, /mt-1 block min-h-11 w-full/);
  assert.match(source, /<div className="mt-4">\s*<WorkExecutionPanel/);
});
test("Library preview title matches desktop body left inset without encroaching on close control", () => {
  const source = read("routes/library.tsx");
  assert.match(source, /border-b border-border p-4 pr-16 sm:pl-6/);
  assert.match(source, /overflow-auto p-4[^"\n]+sm:p-6/);
});
test("Tasks omit the unrelated workspace panel while retaining their editor", () => {
  const source = read("routes/scheduled-tasks.tsx");
  assert.doesNotMatch(
    source,
    /RelatedWorkspaceItems|relatedWorkspaceOpen|Context for automations|Browsing does not attach/,
  );
  assert.match(source, /ScheduledTaskEditor/);
});

test("image failure remains adjacent to its prompt and linked for assistive reading", () => {
  const source = read("routes/images.tsx");
  assert.match(source, /aria-describedby=\{error \? "image-generation-error" : undefined\}/);
  const alert = source.indexOf('id="image-generation-error"');
  assert.ok(alert > source.indexOf("</form>"));
  assert.ok(alert < source.indexOf("{/* Create an image */}"));
  assert.equal((source.match(/id="image-generation-error"/g) || []).length, 1);
  assert.match(source, /\{\(loading \|\| result\) && \(/);
});
