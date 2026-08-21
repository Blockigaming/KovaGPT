import assert from "node:assert/strict";
import test from "node:test";

import { auditUiTruthfulness } from "../../scripts/release/ui-truthfulness.mjs";

test("visible KovaGPT controls are functional, ChatGPT-like, responsive, and voice-free", () => {
  const result = auditUiTruthfulness();
  assert.ok(result.checkedFiles > 0, "UI audit must inspect visible source files");
  assert.deepEqual(result.errors, []);
});
