import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MODE_IDS_BY_TIER } from "../../src/lib/mode-entitlements.mjs";

const source = readFileSync(
  new URL("../../src/routes/getting-started.tsx", import.meta.url),
  "utf8",
);
test("onboarding describes the canonical Free mode boundary", () => {
  assert.deepEqual(MODE_IDS_BY_TIER.free, ["instant", "thinking"]);
  assert.match(source, /Free includes Default and Thinking\./);
  assert.doesNotMatch(source, /Thinking requires an upgrade/);
});
test("onboarding points daily usage to the existing Usage section", () => {
  assert.match(source, /Settings → Usage/);
  assert.doesNotMatch(source, /Settings → Subscription/);
});
