import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const register = JSON.parse(
  readFileSync(new URL("../../docs/interface-2026-09-19/page-register.json", import.meta.url)),
);
const ids = new Set();
const paths = new Set();
for (const page of register.pages) {
  assert(!ids.has(page.page_id), `Duplicate ID: ${page.page_id}`);
  assert(!paths.has(page.kova_path), `Duplicate path: ${page.kova_path}`);
  ids.add(page.page_id);
  paths.add(page.kova_path);
  for (const key of [
    "source_references",
    "required_features",
    "source_screenshot_status",
    "candidate_screenshot_status",
    "completion_status",
  ]) {
    assert(page[key]?.trim(), `${page.page_id}: missing ${key}`);
  }
  assert(!page.kova_path.toLowerCase().includes("codex"), `${page.page_id}: excluded product`);
  if (page.completion_status === "COMPLETE") {
    assert.equal(page.visual_accepted, "True");
    assert.equal(page.functionally_verified, "True");
    assert.equal(page.full_page_and_controls_reviewed, "True");
  }
}
assert.equal(register.plannedTargets, register.pages.length);
assert.equal(
  register.scopeCompletelyResolved,
  false,
  "Reconcile remaining source review before declaring final scope",
);
console.log(
  `${register.pages.length} unique records; sources, requirements and evidence status present. Scope remains provisional.`,
);
