import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { verifyStagingBrowserConfig } from "../../scripts/azure/verify-staging-browser-config.mjs";

const PROJECT_REF = "abcdefghijklmnopqrst";
const OTHER_PROJECT_REF = "tsrqponmlkjihgfedcba";
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
const PUBLISHABLE_KEY = "sb_publishable_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_abcd";
const OTHER_PUBLISHABLE_KEY = "sb_publishable_zyxwvutsrqponmlkjihgfedcba9876543210";
const SOURCE_SHA = "a".repeat(40);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function withBundle(files, run) {
  const root = mkdtempSync(join(tmpdir(), "kova-browser-config-"));
  const bundleDir = join(root, "dist");

  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const target = join(bundleDir, relativePath);
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, content);
    }
    return run({ root, bundleDir });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function verify(bundleDir, overrides = {}) {
  return verifyStagingBrowserConfig({
    bundleDir,
    supabaseUrl: SUPABASE_URL,
    publishableKey: PUBLISHABLE_KEY,
    sourceSha: SOURCE_SHA,
    expectedProjectRef: PROJECT_REF,
    forbiddenProjectRefs: OTHER_PROJECT_REF,
    publicConfigPath: null,
    ...overrides,
  });
}

test("verified browser assets create key-free deterministic provenance", () => {
  withBundle(
    {
      "client/assets/app.js": `window.__config={url:${JSON.stringify(
        SUPABASE_URL,
      )},key:${JSON.stringify(PUBLISHABLE_KEY)}};`,
      "server/index.mjs": [
        `const url = "https://${OTHER_PROJECT_REF}.supabase.co";`,
        `const key = "${OTHER_PUBLISHABLE_KEY}";`,
        'const openai = "sk-proj_abcdefghijklmnopqrstuvwxyz0123456789";',
        'const database = "postgresql://user:password@example.invalid/db";',
      ].join("\n"),
    },
    ({ bundleDir }) => {
      const result = verify(bundleDir);
      const written = readFileSync(result.provenancePath, "utf8");
      const parsed = JSON.parse(written);

      assert.deepEqual(result.browserFiles, ["client/assets/app.js"]);
      assert.equal(parsed.supabaseProjectRef, PROJECT_REF);
      assert.equal(parsed.supabaseUrl, SUPABASE_URL);
      assert.equal(parsed.sourceSha, SOURCE_SHA);
      assert.equal(parsed.publishableKeySha256, sha256(PUBLISHABLE_KEY));
      assert.match(parsed.browserBundleSha256, /^[a-f0-9]{64}$/u);
      assert.equal(parsed.scannedFiles, 1);
      assert.deepEqual(parsed.discoveredSupabaseProjectRefs, [PROJECT_REF]);
      assert.doesNotMatch(written, new RegExp(PUBLISHABLE_KEY, "u"));
    },
  );
});

test("server-only configuration cannot satisfy browser verification", () => {
  withBundle(
    {
      "client/assets/app.js": "console.log('browser has no backend config');",
      "server/index.mjs": `export const config={url:"${SUPABASE_URL}",key:"${PUBLISHABLE_KEY}"};`,
    },
    ({ bundleDir }) => {
      assert.throws(
        () => verify(bundleDir),
        /intended Supabase URL was not found in deployable browser assets/u,
      );
    },
  );
});

test("a second Supabase project in browser assets fails closed", () => {
  withBundle(
    {
      "client/assets/app.js": [
        `const expected="${SUPABASE_URL}";`,
        `const key="${PUBLISHABLE_KEY}";`,
        `const fallback="https://${OTHER_PROJECT_REF}.supabase.co";`,
      ].join("\n"),
    },
    ({ bundleDir }) => {
      assert.throws(() => verify(bundleDir), /Unexpected Supabase project refs/u);
    },
  );
});

test("a second publishable key in browser assets fails without printing either key", () => {
  withBundle(
    {
      "client/assets/app.js": [
        `const url="${SUPABASE_URL}";`,
        `const expected="${PUBLISHABLE_KEY}";`,
        `const fallback="${OTHER_PUBLISHABLE_KEY}";`,
      ].join("\n"),
    },
    ({ bundleDir }) => {
      assert.throws(
        () => verify(bundleDir),
        (error) => {
          assert.match(error.message, /unexpected Supabase publishable key/u);
          assert.doesNotMatch(error.message, new RegExp(PUBLISHABLE_KEY, "u"));
          assert.doesNotMatch(error.message, new RegExp(OTHER_PUBLISHABLE_KEY, "u"));
          return true;
        },
      );
    },
  );
});

test("secret and database credential patterns fail the browser build", () => {
  for (const forbidden of [
    "sk-proj_abcdefghijklmnopqrstuvwxyz0123456789",
    "sb_secret_abcdefghijklmnopqrstuvwxyz0123456789",
    "postgresql://user:password@example.invalid/db",
    "-----BEGIN PRIVATE KEY-----",
  ]) {
    withBundle(
      {
        "client/assets/app.js": [
          `const url="${SUPABASE_URL}";`,
          `const key="${PUBLISHABLE_KEY}";`,
          `const forbidden=${JSON.stringify(forbidden)};`,
        ].join("\n"),
      },
      ({ bundleDir }) => {
        assert.throws(() => verify(bundleDir), /detected in browser asset/u);
      },
    );
  }
});

test("invalid URLs, project refs, keys, and source identities are rejected", () => {
  withBundle(
    {
      "client/assets/app.js": `const url="${SUPABASE_URL}";const key="${PUBLISHABLE_KEY}";`,
    },
    ({ bundleDir }) => {
      assert.throws(
        () => verify(bundleDir, { supabaseUrl: "http://example.invalid" }),
        /must use HTTPS/u,
      );
      assert.throws(
        () => verify(bundleDir, { expectedProjectRef: OTHER_PROJECT_REF }),
        /does not match VITE_SUPABASE_URL/u,
      );
      assert.throws(
        () => verify(bundleDir, { publishableKey: "sb_secret_not_browser_safe" }),
        /sb_publishable_/u,
      );
      assert.throws(
        () => verify(bundleDir, { sourceSha: "main" }),
        /40-character Git commit SHA/u,
      );
    },
  );
});

test("Docker and public config preserve local defaults while enabling verified staging builds", () => {
  const dockerfile = readFileSync("Dockerfile", "utf8");
  const publicConfig = readFileSync("src/config/public-config.ts", "utf8");

  assert.match(dockerfile, /ARG KOVA_VERIFY_STAGING_BROWSER_CONFIG=false/u);
  assert.match(dockerfile, /ARG VITE_SUPABASE_URL=/u);
  assert.match(dockerfile, /ARG VITE_SUPABASE_PUBLISHABLE_KEY=/u);
  assert.match(dockerfile, /node scripts\/azure\/verify-staging-browser-config\.mjs/u);
  assert.match(dockerfile, /org\.opencontainers\.image\.revision/u);
  assert.match(dockerfile, /com\.kovagpt\.browser\.supabase-project-ref/u);
  assert.match(dockerfile, /com\.kovagpt\.browser\.config-verified/u);
  assert.match(dockerfile, /staging-browser-config-provenance\.json/u);

  assert.match(publicConfig, /import\.meta\.env\.VITE_SUPABASE_URL/u);
  assert.match(publicConfig, /import\.meta\.env\.VITE_SUPABASE_PUBLISHABLE_KEY/u);
  assert.match(
    publicConfig,
    /PUBLIC_BACKEND_PROJECT_ID = new URL\(PUBLIC_BACKEND_URL\)\.hostname\.split\("\."\)\[0\]/u,
  );
  assert.doesNotMatch(
    publicConfig,
    /PUBLIC_BACKEND_PROJECT_ID\s*=\s*"[a-z0-9]{20}"/u,
  );
});
