import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyBrowserImageConfig } from "../../scripts/azure/verify-browser-image-config.mjs";

const PROJECT_REF = "abcdefghijklmnopqrst";
const OTHER_PROJECT_REF = "qrstuvwxyzabcdefghij";
const FORBIDDEN_PROJECT_REF = "zyxwvutsrqponmlkjihg";
const SOURCE_SHA = "a".repeat(40);
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
const PUBLISHABLE_KEY = "sb_publishable_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const scriptPath = path.resolve("scripts/azure/verify-browser-image-config.mjs");

async function withFixture(assertion) {
  const root = await mkdtemp(path.join(tmpdir(), "kovagpt-browser-image-config-"));
  const clientRoot = path.join(root, "dist", "client");
  const serverRoot = path.join(root, "dist", "server");
  const outputPath = path.join(root, "dist", "browser-config-provenance.json");
  await mkdir(path.join(clientRoot, "assets"), { recursive: true });
  await mkdir(serverRoot, { recursive: true });

  try {
    await assertion({ root, clientRoot, serverRoot, outputPath });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeValidClient(clientRoot, extra = "") {
  await writeFile(
    path.join(clientRoot, "index.html"),
    `<!doctype html><script type="module" src="/assets/app.js"></script>${SUPABASE_URL}`,
  );
  await writeFile(
    path.join(clientRoot, "assets", "app.js"),
    `const backend=${JSON.stringify(SUPABASE_URL)};const key=${JSON.stringify(
      PUBLISHABLE_KEY,
    )};${extra}`,
  );
}

function verifyOptions(clientRoot, outputPath, overrides = {}) {
  return {
    assetRoot: clientRoot,
    outputPath,
    sourceSha: SOURCE_SHA,
    projectRef: PROJECT_REF,
    supabaseUrl: SUPABASE_URL,
    publishableKey: PUBLISHABLE_KEY,
    forbiddenProjectRefs: [FORBIDDEN_PROJECT_REF],
    ...overrides,
  };
}

test("valid synthetic browser assets produce deterministic key-free provenance", async () => {
  await withFixture(async ({ clientRoot, serverRoot, outputPath }) => {
    await writeValidClient(clientRoot);
    await writeFile(
      path.join(serverRoot, "server-only.mjs"),
      'const serverSecret = "sk-proj-server-only-material-that-browser-scan-must-ignore";',
    );

    const first = await verifyBrowserImageConfig(verifyOptions(clientRoot, outputPath));
    const second = await verifyBrowserImageConfig(verifyOptions(clientRoot, outputPath));
    const serialized = await readFile(outputPath, "utf8");

    assert.deepEqual(first, second);
    assert.equal(first.sourceSha, SOURCE_SHA);
    assert.equal(first.browserSupabaseProjectRef, PROJECT_REF);
    assert.equal(first.browserSupabaseUrl, SUPABASE_URL);
    assert.equal(
      first.publishableKeyFingerprint,
      `sha256:${createHash("sha256").update(PUBLISHABLE_KEY).digest("hex")}`,
    );
    assert.match(first.browserBundleDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(first.scan.fileCount, 2);
    assert.ok(first.scan.expectedUrlOccurrences >= 2);
    assert.ok(first.scan.expectedKeyOccurrences >= 1);
    assert.deepEqual(first.scan.discoveredSupabaseProjectRefs, [PROJECT_REF]);
    assert.doesNotMatch(serialized, new RegExp(PUBLISHABLE_KEY, "u"));
    assert.deepEqual(JSON.parse(serialized), first);
  });
});

test("values present only in server output do not satisfy browser verification", async () => {
  await withFixture(async ({ clientRoot, serverRoot, outputPath }) => {
    await writeFile(path.join(clientRoot, "index.html"), "<!doctype html><p>no browser config</p>");
    await writeFile(
      path.join(serverRoot, "index.mjs"),
      `export const url=${JSON.stringify(SUPABASE_URL)};export const key=${JSON.stringify(
        PUBLISHABLE_KEY,
      )};`,
    );

    await assert.rejects(
      verifyBrowserImageConfig(verifyOptions(clientRoot, outputPath)),
      /Expected synthetic Supabase URL was not found/u,
    );
  });
});

test("wrong or forbidden Supabase projects fail closed", async () => {
  await withFixture(async ({ clientRoot, outputPath }) => {
    await writeValidClient(clientRoot, `const wrong="https://${OTHER_PROJECT_REF}.supabase.co";`);
    await assert.rejects(
      verifyBrowserImageConfig(verifyOptions(clientRoot, outputPath)),
      new RegExp(`unexpected Supabase project: ${OTHER_PROJECT_REF}`, "u"),
    );
  });

  await withFixture(async ({ clientRoot, outputPath }) => {
    await writeValidClient(clientRoot, `const stale=${JSON.stringify(FORBIDDEN_PROJECT_REF)};`);
    await assert.rejects(
      verifyBrowserImageConfig(verifyOptions(clientRoot, outputPath)),
      new RegExp(`forbidden Supabase project ref: ${FORBIDDEN_PROJECT_REF}`, "u"),
    );
  });
});

for (const [name, material, expectedError] of [
  ["OpenAI secret", "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789", /OpenAI secret key/u],
  ["Supabase secret", "sb_secret_abcdefghijklmnopqrstuvwxyz0123456789", /Supabase secret key/u],
  ["database URL", "postgresql://user:password@db.example.com/postgres", /PostgreSQL/u],
  [
    "private key",
    "-----BEGIN PRIVATE KEY-----\\nnot-real\\n-----END PRIVATE KEY-----",
    /private-key PEM/u,
  ],
  [
    "service-role JWT",
    `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(
      '{"role":"service_role"}',
    ).toString("base64url")}.signature12345`,
    /privileged Supabase JWT/u,
  ],
]) {
  test(`browser bundle rejects ${name} material`, async () => {
    await withFixture(async ({ clientRoot, outputPath }) => {
      await writeValidClient(clientRoot, `const prohibited=${JSON.stringify(material)};`);
      await assert.rejects(
        verifyBrowserImageConfig(verifyOptions(clientRoot, outputPath)),
        expectedError,
      );
    });
  });
}

test("configuration inputs are strict and errors do not echo rejected credentials", async () => {
  await withFixture(async ({ clientRoot, outputPath }) => {
    await writeValidClient(clientRoot);
    await assert.rejects(
      verifyBrowserImageConfig(
        verifyOptions(clientRoot, outputPath, {
          sourceSha: "short",
        }),
      ),
      /complete 40-character Git commit SHA/u,
    );
    await assert.rejects(
      verifyBrowserImageConfig(
        verifyOptions(clientRoot, outputPath, {
          supabaseUrl: `https://${OTHER_PROJECT_REF}.supabase.co`,
        }),
      ),
      /canonical HTTPS root/u,
    );
    const rejected = "sb_secret_rejected-value-must-never-appear";
    await assert.rejects(
      verifyBrowserImageConfig(
        verifyOptions(clientRoot, outputPath, {
          publishableKey: rejected,
        }),
      ),
      (error) => error instanceof Error && !error.message.includes(rejected),
    );
  });
});

test("ordinary local Docker builds keep verification explicitly disabled", () => {
  const result = spawnSync(process.execPath, [scriptPath], {
    encoding: "utf8",
    env: { ...process.env, KOVA_VERIFY_BROWSER_CONFIG: "false" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /KOVA_BROWSER_CONFIG_VERIFICATION=disabled/u);
});

test("Dockerfile makes verified staging builds explicit and labels the final image", async () => {
  const dockerfile = await readFile("Dockerfile", "utf8");
  assert.match(dockerfile, /ARG KOVA_VERIFY_BROWSER_CONFIG=false/u);
  assert.match(dockerfile, /ARG VITE_SUPABASE_URL=""/u);
  assert.match(dockerfile, /ARG VITE_SUPABASE_PUBLISHABLE_KEY=""/u);
  assert.match(dockerfile, /KOVA_BROWSER_ASSET_ROOT=dist\/client/u);
  assert.match(
    dockerfile,
    /KOVA_BROWSER_CONFIG_PROVENANCE_PATH=dist\/browser-config-provenance\.json/u,
  );
  assert.match(
    dockerfile,
    /if \[ "\$KOVA_VERIFY_BROWSER_CONFIG" = "true" \]; then[\s\S]*verify-browser-image-config\.mjs/u,
  );
  assert.match(dockerfile, /org\.opencontainers\.image\.revision="\$\{KOVA_SOURCE_SHA\}"/u);
  assert.match(
    dockerfile,
    /io\.kovagpt\.browser-supabase-project-ref="\$\{KOVA_BROWSER_SUPABASE_PROJECT_REF\}"/u,
  );
  assert.match(dockerfile, /COPY --from=build --chown=kova:kova \/app\/dist \.\/dist/u);
});
