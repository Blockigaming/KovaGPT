import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { scanArtifactSecrets } from "../../scripts/release/artifact-secret-scan.mjs";

test("generated artifact scan reports secret classes without echoing their values", () => {
  const root = mkdtempSync(join(tmpdir(), "kova-secret-scan-"));
  const clean = join(root, "clean");
  const dirty = join(root, "dirty");
  mkdirSync(clean);
  mkdirSync(dirty);
  writeFileSync(join(clean, "app.js"), 'console.log("KovaGPT");\n');
  writeFileSync(join(dirty, "app.map"), '{"token":"sk-proj-abcdefghijklmnopqrstuvwxyz123456"}\n');
  assert.deepEqual(scanArtifactSecrets({ roots: [clean] }), { filesScanned: 1, findings: [] });
  const result = scanArtifactSecrets({ roots: [dirty] });
  assert.equal(result.filesScanned, 1);
  assert.deepEqual(result.findings, [{ path: result.findings[0].path, label: "OpenAI secret key" }]);
  assert.doesNotMatch(JSON.stringify(result), /abcdefghijklmnopqrstuvwxyz123456/u);
});
