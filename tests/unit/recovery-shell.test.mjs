import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postcss from "postcss";
const read = (p) => readFileSync(new URL("../../" + p, import.meta.url), "utf8");
test("principal transitions invalidate pending retry callbacks and dismiss account notices", () => {
  const s = read("src/routes/index.tsx");
  const start = s.indexOf("// Load (or reload) settings whenever the signed-in user changes");
  assert.ok(start >= 0);
  const effect = s.slice(start, s.indexOf("}, [", start));
  let previous = -1;
  for (const statement of [
    "storageGenerationRef.current += 1;",
    "retryGenerationRef.current += 1;",
    "retryActionEpochRef.current.clear();",
    "retryableFailedResponsesRef.current.clear();",
    "updateRequestNotice(null);",
    "toast.dismiss();",
    "abortRef.current?.abort();",
    "clearRetryTimer(retryTimerRef);",
  ]) {
    const next = effect.indexOf(statement, previous + 1);
    assert.ok(next > previous, `${statement} must remain in the principal-change reset`);
    previous = next;
  }
  assert.match(read("src/routes/__root.tsx"), /toast.dismiss\(\)/);
});
test("workspace palette has a touch reachable sidebar entry", () => {
  assert.match(read("src/components/Sidebar.tsx"), /onOpenWorkspaceSearch\(\)/);
  assert.match(read("src/routes/index.tsx"), /onOpenWorkspaceSearch=\{openCommandPalette\}/);
});
test("mobile modal geometry centers capped sheets and leaves full viewport scrims square", () => {
  assert.match(read("src/components/ui/dialog.tsx"), /inset-x-0 mx-auto/);
  const sheet = postcss.parse(read("src/styles.css"));
  const scrim = sheet.nodes.find(
    (node) =>
      node.type === "rule" &&
      node.selector === ":is(.kova-assistant, .kova-app-shell) button.kova-sidebar-scrim",
  );
  assert.ok(scrim, "Square scrims are scoped to the actual application roots");
  assert.equal(scrim.parent.type, "root");
  const radius = scrim.nodes.find((node) => node.type === "decl" && node.prop === "border-radius");
  assert.equal(radius.value, "0");
  assert.ok(!radius.important, "Scrims retain square geometry without an important override");
  const geometry = postcss.parse(read("src/styles/control-geometry.css"));
  const policy = geometry.nodes.find(
    (node) => node.type === "rule" && node.selector.startsWith("body"),
  );
  const exclusions = policy.selector.match(/:not\(\s*:where\(([\s\S]+)\)\s*\)$/)?.[1];
  assert.ok(exclusions);
  assert.ok(
    postcss.list.comma(exclusions).includes(".kova-sidebar-scrim"),
    "The pill default must exclude full-viewport scrims",
  );
});
