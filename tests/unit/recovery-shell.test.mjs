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
test("mobile modals remain centered and capped while full viewport scrims stay square", () => {
  const dialog = read("src/components/ui/dialog.tsx");
  for (const token of [
    "fixed left-1/2 top-1/2",
    "max-w-[450px]",
    "-translate-x-1/2 -translate-y-1/2",
    "w-[calc(100%-2rem)]",
    "overflow-y-auto",
    "supports-[height:100dvh]:max-h-",
  ])
    assert.ok(dialog.includes(token), token);
  const sidebar = postcss.parse(read("src/styles/sidebar-core.css"));
  const scrim = sidebar.nodes.find(
    (node) => node.type === "rule" && node.selector === "button.kova-sidebar-scrim",
  );
  assert.ok(scrim, "The actual sidebar owns its full viewport scrim shape");
  assert.equal(scrim.parent.type, "root");
  const radius = scrim.nodes.find((node) => node.type === "decl" && node.prop === "border-radius");
  assert.equal(radius.value, "0");
  assert.ok(!radius.important);
  const geometry = postcss.parse(read("src/styles/control-geometry.css"));
  geometry.walkRules((rule) => {
    if (rule.selector.includes("button"))
      assert.ok(
        !rule.nodes.some((node) => node.type === "decl" && node.prop === "border-radius"),
        "No blanket button shape overrides a full viewport scrim",
      );
  });
});
