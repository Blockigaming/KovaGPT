import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { verifyBrowserConfig } from "../../scripts/azure/verify-browser-config.mjs";

const PROJECT_REF = "abcdefghijklmnopqrst";
const OTHER_PROJECT_REF = "tsrqponmlkjihgfedcba";
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
const PUBLISHABLE_KEY = "sb_publishable_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_abcd";
const SOURCE_SHA = "a".repeat(40);
const SOURCE_TREE = "b".repeat(40);

function withBundle(files, run) {
  const root = mkdtempSync(join(tmpdir(), "kova-browser-secret-regression-"));
  const distDir = join(root, "dist");
  const bundleDir = join(distDir, "client");
  const sourceAttestationPath = join(root, ".kova-source-attestation.json");

  try {
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(
      sourceAttestationPath,
      JSON.stringify({
        schemaVersion: 1,
        context: "git-archive",
        sourceSha: SOURCE_SHA,
        sourceTree: SOURCE_TREE,
      }),
    );

    for (const [relativePath, content] of Object.entries(files)) {
      const target = join(distDir, relativePath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    }

    run({ bundleDir, sourceAttestationPath });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function verify(bundleDir, sourceAttestationPath) {
  return verifyBrowserConfig({
    bundleDir,
    supabaseUrl: SUPABASE_URL,
    publishableKey: PUBLISHABLE_KEY,
    sourceSha: SOURCE_SHA,
    sourceTree: SOURCE_TREE,
    sourceAttestationPath,
    expectedProjectRef: PROJECT_REF,
    forbiddenProjectRefs: OTHER_PROJECT_REF,
    publicConfigPath: null,
  });
}

function browserSource(extra = "") {
  return [`const url="${SUPABASE_URL}";`, `const key="${PUBLISHABLE_KEY}";`, extra].join("\n");
}

test("served browser assets reject Stripe secret and webhook credentials", () => {
  for (const secret of [
    "sk_live_abcdefghijklmnopqrstuvwxyz012345",
    "sk_test_abcdefghijklmnopqrstuvwxyz012345",
    "rk_live_abcdefghijklmnopqrstuvwxyz012345",
    "whsec_abcdefghijklmnopqrstuvwxyz012345",
  ]) {
    withBundle(
      {
        "client/assets/app.js": browserSource(),
        "client/payment-debug.txt": `credential=${secret}`,
      },
      ({ bundleDir, sourceAttestationPath }) => {
        assert.throws(
          () => verify(bundleDir, sourceAttestationPath),
          /Stripe .* was detected in browser asset/u,
        );
      },
    );
  }
});
