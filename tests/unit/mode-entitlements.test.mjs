import assert from "node:assert/strict";
import test from "node:test";

import {
  MODE_IDS_BY_TIER,
  isModeAllowedForTier,
  studyModeForTier,
} from "../../src/lib/mode-entitlements.mjs";
import { readFileSync } from "node:fs";

const ALL_MODES = ["instant", "medium", "thinking", "high", "extra_high", "max", "ultra"];
const EXPECTED = {
  free: ["instant"],
  plus: ["instant", "medium", "high"],
  pro: ["instant", "medium", "high", "extra_high", "max", "ultra"],
};

for (const [tier, expected] of Object.entries(EXPECTED)) {
  test(`${tier} allows only its published modes`, () => {
    assert.deepEqual(MODE_IDS_BY_TIER[tier], expected);
    for (const mode of ALL_MODES) {
      assert.equal(isModeAllowedForTier(tier, mode), expected.includes(mode), `${tier}: ${mode}`);
    }
  });
}

test("unknown plans and obsolete modes fail closed", () => {
  assert.equal(isModeAllowedForTier("enterprise", "instant"), false);
  assert.equal(isModeAllowedForTier("pro", "pro"), false);
  assert.equal(isModeAllowedForTier("free", "kova_5_5"), false);
});

test("Study selects a mode within every plan's exact entitlements", () => {
  assert.equal(studyModeForTier("free"), "instant");
  assert.equal(studyModeForTier("plus"), "high");
  assert.equal(studyModeForTier("pro"), "high");
  for (const tier of Object.keys(EXPECTED)) {
    assert.equal(isModeAllowedForTier(tier, studyModeForTier(tier)), true);
  }
  assert.equal(studyModeForTier("enterprise"), "instant");
});

test("Free Study uses Instant while the server may elevate paid Study by tier", () => {
  const study = readFileSync("src/components/StudyPanel.tsx", "utf8");
  assert.match(study, /mode: "instant",\s*clientTool: "study"/);
  assert.equal(isModeAllowedForTier("free", "thinking"), false);
  assert.equal(isModeAllowedForTier("free", "instant"), true);
});
