import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const settings = readFileSync(join(process.cwd(), "src/components/SettingsDialog.tsx"), "utf8");

test("signed-out Settings exposes only preferences with implemented behavior", () => {
  assert.doesNotMatch(settings, /GuestLanguageSelect/);
  assert.doesNotMatch(settings, /kova-guest-language/);
  assert.doesNotMatch(settings, />Language<\/span>/);
  assert.doesNotMatch(settings, /settings across devices/);
  assert.match(settings, /Browser\s+preferences stay on this device/);
  assert.match(
    settings,
    /Your appearance\s+preference remains in this browser, but nothing here is synced to an account/,
  );
});
