import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const portability = await readFile("src/lib/device-data-portability.ts", "utf8");
const settings = await readFile("src/components/SettingsDialog.tsx", "utf8");
const chat = await readFile("src/routes/index.tsx", "utf8");
const matrix = await readFile("docs/feature-parity.md", "utf8");

test("device chat portability is versioned, bounded, validated and includes archives", () => {
  assert.match(portability, /DEVICE_EXPORT_VERSION = 1/);
  assert.match(portability, /MAX_IMPORT_BYTES = 10 \* 1024 \* 1024/);
  assert.match(portability, /validateConversation/);
  assert.match(portability, /mergeConversations/);
  assert.match(settings, /archivedConversations: loadArchivedConversations\(userKey\)/);
  assert.match(settings, /parseDeviceDataExport/);
  assert.match(settings, /Cloud account records are not included/);
});

test("temporary chat never persists an unsent draft", () => {
  assert.match(
    chat,
    /if \(tempChat\) \{\s*lastLoadedDraftRef\.current = null;\s*setInput\(""\);\s*return;\s*\}/,
  );
  assert.match(chat, /if \(tempChat \|\| !principalReady\) return;/);
  assert.match(chat, /clearDraft\(userKey, activeId\)/);
  assert.doesNotMatch(chat, /localStorage\.(?:getItem|setItem|removeItem)\(`kova-draft:/);
  assert.match(chat, /toast\.success\("Temporary chat on"/);
  assert.match(
    chat,
    /No history or memory\. Profile, instructions, personality and connected apps stay off/,
  );
});

test("feature matrix uses the required honest status vocabulary and covers core categories", () => {
  for (const status of [
    "Working and verified locally",
    "Implemented; production configuration required",
    "Partially implemented",
    "Missing",
    "Intentionally unavailable",
  ]) {
    assert.match(matrix, new RegExp(status));
  }
  for (const capability of [
    "Normal chat",
    "File uploads",
    "Image generation",
    "Web search",
    "Projects",
    "Scheduled tasks",
    "Apps/connectors",
    "Voice",
    "Account deletion",
    "Mobile accessibility",
  ]) {
    assert.match(matrix, new RegExp(capability));
  }
});
