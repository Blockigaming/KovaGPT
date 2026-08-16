import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { verifyBrowserConfig } from "../../scripts/azure/verify-browser-config.mjs";

const PROJECT_REF = "abcdefghijklmnopqrst";
const OTHER_PROJECT_REF = "tsrqponmlkjihgfedcba";
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
const PUBLISHABLE_KEY = "sb_publishable_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_abcd";
const OTHER_PUBLISHABLE_KEY = "sb_publishable_11223344556677889900_AABBCCDDEEFF";
const SOURCE_SHA = "a".repeat(40);
const SOURCE_TREE = "b".repeat(40);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fakeJwt(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.${"s".repeat(32)}`;
}

function withBundle(files, run) {
  const root = mkdtempSync(join(tmpdir(), "kova-browser-config-"));
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

    return run({ root, distDir, bundleDir, sourceAttestationPath });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function verify(bundleDir, overrides = {}) {
  const root = join(bundleDir, "..", "..");
  return verifyBrowserConfig({
    bundleDir,
    supabaseUrl: SUPABASE_URL,
    publishableKey: PUBLISHABLE_KEY,
    sourceSha: SOURCE_SHA,
    sourceTree: SOURCE_TREE,
    sourceAttestationPath: join(root, ".kova-source-attestation.json"),
    expectedProjectRef: PROJECT_REF,
    forbiddenProjectRefs: OTHER_PROJECT_REF,
    publicConfigPath: null,
    ...overrides,
  });
}

function browserSource(extra = "") {
  return [`const url="${SUPABASE_URL}";`, `const key="${PUBLISHABLE_KEY}";`, extra].join("\n");
}

test("verified browser assets create key-free deterministic Git-archive provenance", () => {
  withBundle(
    {
      "client/assets/app.js": browserSource(),
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

      assert.deepEqual(result.browserFiles, ["assets/app.js"]);
      assert.equal(parsed.schemaVersion, 2);
      assert.equal(parsed.supabaseProjectRef, PROJECT_REF);
      assert.equal(parsed.supabaseUrl, SUPABASE_URL);
      assert.equal(parsed.sourceSha, SOURCE_SHA);
      assert.equal(parsed.sourceTree, SOURCE_TREE);
      assert.equal(parsed.sourceContext, "git-archive");
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
      "client/assets/app.js": browserSource(
        `const fallback="https://${OTHER_PROJECT_REF}.supabase.co";`,
      ),
    },
    ({ bundleDir }) => {
      assert.throws(() => verify(bundleDir), /project-ref literal|Unexpected Supabase project/u);
    },
  );
});

test("a forbidden project ref assembled into a URL at runtime fails closed", () => {
  withBundle(
    {
      "client/assets/app.js": browserSource(
        `const forbiddenRef="${OTHER_PROJECT_REF}";const fallback="https://"+forbiddenRef+".supabase.co";`,
      ),
    },
    ({ bundleDir }) => {
      assert.throws(() => verify(bundleDir), /project-ref literal/u);
    },
  );
});

test("a second publishable key in browser assets fails without printing either key", () => {
  withBundle(
    {
      "client/assets/app.js": browserSource(`const fallback="${OTHER_PUBLISHABLE_KEY}";`),
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

test("legacy Supabase service-role JWTs fail without printing the token", () => {
  const token = fakeJwt({ role: "service_role", ref: PROJECT_REF });
  withBundle(
    {
      "client/assets/app.js": browserSource(`const legacy=${JSON.stringify(token)};`),
    },
    ({ bundleDir }) => {
      assert.throws(
        () => verify(bundleDir),
        (error) => {
          assert.match(error.message, /service-role JWT/u);
          assert.equal(error.message.includes(token), false);
          return true;
        },
      );
    },
  );
});

test("legacy Supabase anon JWTs for another project fail without printing the token", () => {
  const token = fakeJwt({ role: "anon", ref: OTHER_PROJECT_REF });
  withBundle(
    {
      "client/assets/app.js": browserSource(`const legacy=${JSON.stringify(token)};`),
    },
    ({ bundleDir }) => {
      assert.throws(
        () => verify(bundleDir),
        (error) => {
          assert.match(error.message, /anon JWT for an unexpected project/u);
          assert.equal(error.message.includes(token), false);
          return true;
        },
      );
    },
  );
});

test("even same-project legacy anon JWTs fail when a modern publishable key is required", () => {
  const token = fakeJwt({ role: "anon", ref: PROJECT_REF });
  withBundle(
    {
      "client/assets/app.js": browserSource(`const legacy=${JSON.stringify(token)};`),
    },
    ({ bundleDir }) => {
      assert.throws(() => verify(bundleDir), /require the approved publishable key/u);
    },
  );
});

test("non-publishable Supabase user JWTs cannot be baked into browser assets", () => {
  const token = fakeJwt({ role: "authenticated", ref: PROJECT_REF, sub: "user-id" });
  withBundle(
    {
      "client/assets/app.js": browserSource(`const session=${JSON.stringify(token)};`),
    },
    ({ bundleDir }) => {
      assert.throws(
        () => verify(bundleDir),
        (error) => {
          assert.match(error.message, /Non-publishable Supabase JWT/u);
          assert.equal(error.message.includes(token), false);
          return true;
        },
      );
    },
  );
});

test("all served text formats are scanned", () => {
  withBundle(
    {
      "client/assets/app.js": browserSource(),
      "client/robots.txt": "postgresql://user:password@example.invalid/db",
    },
    ({ bundleDir }) => {
      assert.throws(() => verify(bundleDir), /PostgreSQL credential URL/u);
    },
  );
});

test("secret, database credential, and private-key patterns fail the browser build", () => {
  for (const forbidden of [
    "sk-proj_abcdefghijklmnopqrstuvwxyz0123456789",
    "sb_secret_abcdefghijklmnopqrstuvwxyz0123456789",
    "postgresql://user:password@example.invalid/db",
    "-----BEGIN PRIVATE KEY-----",
    "-----BEGIN ENCRYPTED PRIVATE KEY-----",
    "-----BEGIN DSA PRIVATE KEY-----",
    "-----BEGIN OPENSSH PRIVATE KEY-----",
  ]) {
    withBundle(
      {
        "client/assets/app.js": browserSource(`const forbidden=${JSON.stringify(forbidden)};`),
      },
      ({ bundleDir }) => {
        assert.throws(() => verify(bundleDir), /detected in browser asset/u);
      },
    );
  }
});

test("source attestation commit and tree must match the build arguments", () => {
  withBundle(
    {
      "client/assets/app.js": browserSource(),
    },
    ({ bundleDir, sourceAttestationPath }) => {
      rmSync(sourceAttestationPath);
      assert.throws(() => verify(bundleDir), /source attestation is missing/u);

      writeFileSync(
        sourceAttestationPath,
        JSON.stringify({
          schemaVersion: 1,
          context: "git-archive",
          sourceSha: "c".repeat(40),
          sourceTree: SOURCE_TREE,
        }),
      );
      assert.throws(() => verify(bundleDir), /commit does not match/u);

      writeFileSync(
        sourceAttestationPath,
        JSON.stringify({
          schemaVersion: 1,
          context: "git-archive",
          sourceSha: SOURCE_SHA,
          sourceTree: "c".repeat(40),
        }),
      );
      assert.throws(() => verify(bundleDir), /tree does not match/u);
    },
  );
});

test("invalid URLs, project refs, keys, and source identities are rejected", () => {
  withBundle(
    {
      "client/assets/app.js": browserSource(),
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
      assert.throws(() => verify(bundleDir, { sourceSha: "main" }), /Git object identifier/u);
      assert.throws(() => verify(bundleDir, { sourceTree: "main" }), /Git object identifier/u);
    },
  );
});

test("Docker, Azure, and runbook contracts require exact archive and digest provenance", () => {
  const dockerfile = readFileSync("Dockerfile", "utf8");
  const helper = readFileSync("scripts/azure/prepare-verified-build-context.sh", "utf8");
  const workflow = readFileSync(
    ".github/workflows/ca-kovagpt-dev-AutoDeployTrigger-1724b7ba-d38e-4fd3-95e8-bef7f7fbc290.yml",
    "utf8",
  );
  const runbook = readFileSync("docs/azure/verified-browser-image-provenance.md", "utf8");

  assert.match(dockerfile, /ARG KOVA_VERIFY_BROWSER_CONFIG=false/u);
  assert.match(dockerfile, /KOVA_BUILD_SHA="\$KOVA_SOURCE_SHA" npm run build/u);
  assert.match(dockerfile, /KOVA_BROWSER_BUNDLE_DIR=dist\/client/u);
  assert.match(dockerfile, /KOVA_SOURCE_ATTESTATION_PATH=\/app\/\.kova-source-attestation\.json/u);
  assert.match(dockerfile, /com\.kovagpt\.source\.tree/u);
  assert.match(dockerfile, /browser-config-provenance\.json/u);

  assert.match(helper, /git status --porcelain/u);
  assert.match(helper, /git archive --format=tar/u);
  assert.match(helper, /\.kova-source-attestation\.json/u);

  assert.match(workflow, /prepare-verified-build-context\.sh/u);
  assert.match(workflow, /Verify existing server Supabase project before building/u);
  assert.match(workflow, /server SUPABASE_URL does not match/u);
  assert.match(workflow, /az acr repository show/u);
  assert.match(workflow, /digest_image/u);
  assert.match(workflow, /Deploy verified image by registry digest/u);
  assert.match(workflow, /az containerapp update/u);
  assert.match(workflow, /steps\.image\.outputs\.digest_image/u);
  assert.match(workflow, /api\/version/u);
  assert.doesNotMatch(workflow, /container-apps-deploy-action/u);

  assert.match(runbook, /clean `git archive`/u);
  assert.match(runbook, /"\$BUILD_CONTEXT"/u);
  assert.match(runbook, /dist\/client/u);
});

test("PEM public assets are scanned before verification", () => {
  withBundle(
    {
      "client/assets/app.js": browserSource(),
      "client/client-key.pem":
        "-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----",
    },
    ({ bundleDir }) => {
      assert.throws(() => verify(bundleDir), /private key material/u);
    },
  );
});
