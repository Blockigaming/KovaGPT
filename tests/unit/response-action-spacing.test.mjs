import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const component = readFileSync("src/components/ChatMessage.tsx", "utf8");
const styles = readFileSync("src/components/response-action-refinement.css", "utf8");
test("response actions retain 44px targets on every pointer type and consistent icons", () => {
  assert.match(component, /import "\.\/response-action-refinement\.css"/);
  assert.match(component, /kova-response-action-bar/);
  assert.match(styles, /width: 44px !important/);
  assert.match(styles, /border-radius: var\(--kova-radius-button\)/);
  assert.match(styles, /min-width: 44px !important/);
  assert.match(styles, /min-height: 44px !important/);
  assert.match(styles, /stroke-linecap: round/);
});
test("feedback recovery remains available in More without stretching the toolbar", () => {
  assert.doesNotMatch(component, />\s*Retry rating\s*</);
  assert.match(
    component,
    /<DropdownMenuItem[\s\S]*?setFeedbackReload[\s\S]*?Retry loading response feedback/,
  );
});

test("assistant and Images retain bottom account access without duplicate top avatars", () => {
  for (const path of ["src/routes/index.tsx", "src/routes/images.tsx"])
    assert.doesNotMatch(readFileSync(path, "utf8"), /<UserButton\b/);
  assert.match(readFileSync("src/components/Sidebar.tsx", "utf8"), /kova-rail-account/);
});
