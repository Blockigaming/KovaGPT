import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("legacy saved memory true values are gated by consent version", async () => {
  const loader = await readFile("src/lib/use-nova-settings.ts", "utf8");
  const dialog = await readFile("src/components/SettingsDialog.tsx", "utf8");

  assert.match(loader, /memoryConsentVersion !== CURRENT_MEMORY_CONSENT_VERSION/);
  assert.match(loader, /rememberAcross: false/);
  assert.match(dialog, /memoryConsentVersion: value\s*\? CURRENT_MEMORY_CONSENT_VERSION/);
});
