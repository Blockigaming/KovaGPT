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

test("capability inventory separates source, test and deployment evidence for all core areas", async () => {
  const audit = JSON.parse(await readFile("docs/product-parity/capability-audit.json", "utf8"));
  assert.equal(audit.progressRecalculated, false);
  assert.equal(audit.voiceAudioDictation, "intentionally_excluded");
  assert.deepEqual(
    audit.surfaces.map(({ id }) => id),
    Array.from({ length: 27 }, (_, index) => String(index + 1).padStart(2, "0")),
  );
  for (const stage of ["Source", "Local", "Hosted CI/review", "Staging", "Production"]) {
    assert.ok(matrix.includes(`| ${stage}`), `missing evidence stage: ${stage}`);
  }
  for (const surface of audit.surfaces) {
    assert.ok(matrix.includes(`${surface.id} — ${surface.area}`), surface.area);
    assert.ok(
      ["bounded_source", "partial_source", "pending_package"].includes(surface.sourceStatus),
    );
    for (const field of [
      "implementedScope",
      "boundary",
      "localStatus",
      "hostedStatus",
      "stagingStatus",
      "productionStatus",
    ]) {
      assert.equal(typeof surface[field], "string", `${surface.area}: ${field}`);
      assert.ok(surface[field].trim(), `${surface.area}: empty ${field}`);
    }
    assert.ok(surface.sourceEvidence.length > 0, `${surface.area}: source evidence`);
    assert.ok(surface.testEvidence.length > 0, `${surface.area}: test evidence`);
  }
  assert.match(matrix, /not a deployment certificate/);
  assert.match(matrix, /Source\/build\/CI success cannot prove deployed/);
});
