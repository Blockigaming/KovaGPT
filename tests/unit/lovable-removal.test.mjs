import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test("package metadata does not depend on private Lovable packages", () => {
  const pkg = JSON.parse(read("package.json"));
  const allDeps = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  };
  for (const name of Object.keys(allDeps)) {
    assert.equal(name.startsWith("@lovable.dev/"), false, `${name} should not be installed`);
  }
});

test("Lovable integration uses no private package and exposes no client-side gateway secret", () => {
  const files = [
    "package.json",
    "vite.config.ts",
    "src/routes/api/chat.ts",
    "src/routes/api/generate-image.ts",
    "src/routes/api/memory.ts",
    "src/routes/api/title.ts",
    "src/routes/api/write.ts",
    "src/lib/project-rag.server.ts",
    "src/lib/stripe.server.ts",
  ];
  const forbidden = [
    /@lovable\.dev/i,
    /ai\.gateway\.lovable\.dev/,
    /connector-gateway\.lovable\.dev/,
  ];
  for (const file of files) {
    const text = read(file);
    for (const pattern of forbidden) {
      assert.equal(pattern.test(text), false, `${file} contains ${pattern}`);
    }
  }
  const provider = read("src/lib/ai/provider.server.ts");
  assert.match(provider, /LOVABLE_API_KEY/);
  assert.match(provider, /OPENAI_API_KEY/);
  assert.doesNotMatch(provider, /VITE_.*(?:LOVABLE|OPENAI).*API_KEY/);
});

test("direct provider env example contains no secret values", () => {
  const env = read(".env.example");
  assert.match(env, /^OPENAI_API_KEY=$/m);
  assert.match(env, /^FIRECRAWL_API_KEY=$/m);
  assert.match(env, /^SUPABASE_SERVICE_ROLE_KEY=$/m);
  assert.equal(
    /pk_[A-Za-z0-9_-]+/.test(env),
    false,
    "example env should not contain publishable third-party sample secrets",
  );
});

test("stale Bun lockfile is absent after npm lockfile was selected", () => {
  assert.equal(existsSync(join(root, "bun.lock")), false);
  const lock = JSON.parse(read("package-lock.json"));
  assert.equal(lock.lockfileVersion, 3);
});
