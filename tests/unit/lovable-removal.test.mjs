import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test("legacy Lovable email URLs are inert compatibility tombstones", () => {
  const routes = [
    "src/routes/lovable/email/auth/preview.ts",
    "src/routes/lovable/email/auth/webhook.ts",
    "src/routes/lovable/email/queue/process.ts",
    "src/routes/lovable/email/suppression.ts",
    "src/routes/lovable/email/transactional/preview.ts",
    "src/routes/lovable/email/transactional/send.ts",
  ];
  const helper = read("src/lib/legacy-lovable-route.ts");
  assert.match(helper, /status:\s*410/u);
  assert.match(helper, /legacy_lovable_route_retired/u);
  assert.match(helper, /performs no work/u);

  for (const route of routes) {
    const source = read(route);
    assert.match(source, /legacyLovableRouteGone/u);
    assert.doesNotMatch(source, /@lovable\.dev|LOVABLE_API_KEY|sendLovableEmail/u);
    assert.doesNotMatch(source, /success:\s*true|queued:\s*true|processed:/u);
  }
});

test("AI integration has no Lovable gateway or configurable endpoint escape hatch", () => {
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
    "src/lib/ai/provider.server.ts",
  ];
  const forbidden = [
    /connector-gateway\.lovable\.dev/,
    /ai\.gateway\.lovable\.dev/,
    /LOVABLE_(?:API_KEY|AI_BASE_URL)/i,
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
  assert.match(provider, /ProviderKind = "azure_openai" \| "openai"/);
  assert.match(provider, /https:\/\/api\.openai\.com\/v1/);
  assert.match(provider, /\.openai\.azure\.com/);
  assert.match(provider, /redirect: "error"/);
  assert.doesNotMatch(provider, /VITE_.*(?:LOVABLE|OPENAI).*API_KEY/);
  assert.doesNotMatch(env, /^OPENAI_BASE_URL=/m);
});

test("direct provider env example contains no secret values or duplicate settings", () => {
  const env = read(".env.example");
  assert.match(env, /^OPENAI_API_KEY=$/m);
  assert.match(env, /^AZURE_OPENAI_API_KEY=$/m);
  assert.match(env, /^FIRECRAWL_API_KEY=$/m);
  assert.match(env, /^SUPABASE_SERVICE_ROLE_KEY=$/m);
  assert.equal(
    /pk_[A-Za-z0-9_-]+/.test(env),
    false,
    "example env should not contain publishable third-party sample secrets",
  );

  const names = [...env.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]);
  assert.deepEqual(names, [...new Set(names)], "example env should define each setting once");
});

test("npm and Bun lockfiles are intentionally maintained for deterministic supported workflows", () => {
  assert.equal(existsSync(join(root, "bun.lock")), true);
  const lock = JSON.parse(read("package-lock.json"));
  assert.equal(lock.lockfileVersion, 3);
});
