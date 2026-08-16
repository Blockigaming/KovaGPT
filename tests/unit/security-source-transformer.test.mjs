import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { applySecuritySource } from "../../scripts/release/apply-security-source.mjs";

const source = `import { validateSupportedGoogleWrite } from "@/lib/google-write-validation.server.mjs";

async function run(name: string) {
  try {
    return name;
  } catch (e) {
    console.error(\`[tool \${name}] failed\`, e);
    return { error: "tool_failed", message: (e as Error).message };
  }
}

async function stage(error: { message?: string } | null, data: unknown) {
  if (error || !data) {
    console.error("[stagePendingAction] insert failed", error);
    throw new Error("Could not stage pending action");
  }
}`;

test("security transformer sanitizes connector error and staging logs exactly once", () => {
  const root = mkdtempSync(join(tmpdir(), "kova-security-transform-"));
  const previous = process.cwd();
  try {
    const path = join(root, "src/lib/google-tools.server.ts");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source);
    process.chdir(root);
    assert.deepEqual(applySecuritySource({ check: false }).changed, [
      "src/lib/google-tools.server.ts",
    ]);
    const transformed = readFileSync(path, "utf8");
    assert.match(transformed, /safeConnectorError/u);
    assert.doesNotMatch(transformed, /message: \(e as Error\)\.message/u);
    assert.doesNotMatch(transformed, /insert failed", error/u);
    assert.deepEqual(applySecuritySource({ check: true }).changed, []);
  } finally {
    process.chdir(previous);
    rmSync(root, { recursive: true, force: true });
  }
});

test("security transformer fails closed on source drift", () => {
  const root = mkdtempSync(join(tmpdir(), "kova-security-drift-"));
  const previous = process.cwd();
  try {
    const path = join(root, "src/lib/google-tools.server.ts");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source.replace("Could not stage pending action", "Staging failed"));
    process.chdir(root);
    assert.throws(() => applySecuritySource({ check: false }), /security_source_drift/u);
  } finally {
    process.chdir(previous);
    rmSync(root, { recursive: true, force: true });
  }
});
