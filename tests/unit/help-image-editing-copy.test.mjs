import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createContentLoader } from "../../scripts/publication/source-loader.mjs";

test("Help50 distinguishes conditional local adjustments from unavailable AI editing/cropping", () => {
  const { load } = createContentLoader();
  const answer = load("src/lib/help-center-data.ts").HELP_FAQS.find(
    (item) => item.id === "help-50",
  );
  assert.equal(answer.question, "Can I edit an existing image?");
  const editor = readFileSync("src/components/LocalImageEditor.tsx", "utf8");
  for (const name of ["brightness", "contrast", "saturation"]) {
    assert.ok(answer.answer.includes(name));
    assert.ok(editor.includes(`"${name}"`));
  }
  assert.match(answer.answer, /disabled unless the original pixels load successfully/);
  assert.match(editor, /disabled=\{!original\}/);
  assert.match(answer.answer, /image access restrictions or unsupported browser features/);
  assert.match(answer.answer, /AI\/instruction-based editing and cropping are not available/);
  assert.doesNotMatch(answer.answer, /saved|downloaded|generate|successfully saved/i);
  assert.equal(
    load("src/lib/capability-registry.ts").CAPABILITY_REGISTRY.features.imageEditing.availability,
    "unavailable",
  );
});
