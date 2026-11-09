import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

// The web build resolves lucide-react to the intentionally pinned product-icons
// barrel. A typecheck alone is insufficient to catch missing runtime exports.
test("immersive voice uses only icons exported by the pinned product glyph set", () => {
  const component = readFileSync(
    new URL("../../src/components/ComposerVoiceDialogView.tsx", import.meta.url),
    "utf8",
  );
  const glyphs = readFileSync(
    new URL("../../src/components/ui/product-icons.tsx", import.meta.url),
    "utf8",
  );
  const match = component.match(/import\s*\{([^}]+)\}\s*from\s*"lucide-react"/u);
  assert.ok(match, "voice view should import the pinned glyphs");
  const icons = match[1].split(",").map((value) => value.trim());
  for (const icon of icons) {
    assert.match(glyphs, new RegExp(`export \\{ ${icon} \\} from `), `${icon} is not pinned`);
  }
  assert.ok(component.includes('aria-label={microphoneMuted ? "Unmute microphone"'));
  assert.ok(component.includes("kova-voice-muted-icon"));
});
