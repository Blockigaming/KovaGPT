import assert from "node:assert/strict";
import test from "node:test";
import { hasRequiredComposerTools } from "../../scripts/release/apply-chatgpt-parity-source.mjs";

const valid = `const COMPOSER_TOOLS: readonly ComposerAction[] = [
  { id: "web_search", label: "Search the web", icon: Globe },
  { id: "image", label: "Create Image", icon: ImagePlus },
];`;

test("composer-tool parity preserves user-visible label whitespace", () => {
  assert.equal(hasRequiredComposerTools(valid), true);
  assert.equal(hasRequiredComposerTools(valid.replace("Search the web", "Searchtheweb")), false);
  assert.equal(hasRequiredComposerTools(valid.replace("Create Image", "CreateImage")), false);
});
