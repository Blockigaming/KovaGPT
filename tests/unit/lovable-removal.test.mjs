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
    assert.equal(
      name.startsWith("@lovable.dev/"),
      false,
      `${name} should not be installed`,
    );
  }
});

test("direct AI integration has no Lovable gateway or configurable endpoint escape hatch", () => {
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
    /LOVABLE_API_KEY/i,
    /LOVABLE_AI_BASE_URL/i,
    /Lovable-API-Key/i,
    /OPENAI_BASE_URL/,
    /AI_PROVIDER_(?:URL|API_KEY)/,
  ];
  for (const file of files) {
    const text = read(file);
    for (const pattern of forbidden) {
      assert.equal(pattern.test(text), false, `${file} contains ${pattern}`);
    }
  }
  const provider = read("src/lib/ai/provider.server.ts");
  const env = read(".env.example");
  assert.match(provider, /OPENAI_API_KEY/);
  assert.match(provider, /provider: "openai"/);
  assert.match(provider, /https:\/\/api\.openai\.com\/v1/);
  assert.match(provider, /redirect: "error"/);
  assert.doesNotMatch(provider, /VITE_.*(?:LOVABLE|OPENAI).*API_KEY/);
  assert.doesNotMatch(env, /^OPENAI_BASE_URL=/m);
});

test("direct provider env example contains no secret values or duplicate settings", () => {
  const env = read(".env.example");
  assert.match(env, /^OPENAI_API_KEY=$/m);
  assert.match(env, /^FIRECRAWL_API_KEY=$/m);
  assert.match(env, /^SUPABASE_SERVICE_ROLE_KEY=$/m);
  assert.equal(
    /pk_[A-Za-z0-9_-]+/.test(env),
    false,
    "example env should not contain publishable third-party sample secrets",
  );

  const names = [...env.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(
    (match) => match[1],
  );
  assert.deepEqual(
    names,
    [...new Set(names)],
    "example env should define each setting once",
  );
});

test("stale Bun lockfile is absent after npm lockfile was selected", () => {
  assert.equal(existsSync(join(root, "bun.lock")), false);
  const lock = JSON.parse(read("package-lock.json"));
  assert.equal(lock.lockfileVersion, 3);
});
