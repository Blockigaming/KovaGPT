import assert from "node:assert/strict";
import test from "node:test";
import {
  hasRequiredComposerTools,
  isDirectExecution,
} from "../../scripts/release/apply-chatgpt-parity-source.mjs";

const valid = `const COMPOSER_TOOLS: readonly ComposerAction[] = [
  { id: "web_search", label: "Search the web", icon: Globe },
  { id: "image", label: "Create Image", icon: ImagePlus },
];`;

test("composer-tool parity preserves user-visible label whitespace", () => {
  assert.equal(hasRequiredComposerTools(valid), true);
  assert.equal(hasRequiredComposerTools(valid.replace("Search the web", "Searchtheweb")), false);
  assert.equal(hasRequiredComposerTools(valid.replace("Create Image", "CreateImage")), false);
});

test("parity script direct execution handles URL-escaped filesystem paths", () => {
  const path = "/tmp/Kova GPT/scripts/release/apply-chatgpt-parity-source.mjs";
  assert.equal(
    isDirectExecution(
      "file:///tmp/Kova%20GPT/scripts/release/apply-chatgpt-parity-source.mjs",
      path,
    ),
    true,
  );
  assert.equal(
    isDirectExecution(
      "file:///tmp/Kova%20GPT/scripts/release/apply-chatgpt-parity-source.mjs",
      "/tmp/Other/scripts/release/apply-chatgpt-parity-source.mjs",
    ),
    false,
  );
});
