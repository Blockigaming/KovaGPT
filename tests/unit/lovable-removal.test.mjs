import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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

test("Supabase OAuth consent uses a Kova route and the legacy path only redirects", () => {
  const consent = read("src/routes/oauth.consent.tsx");
  const redirect = read("src/routes/[.]lovable.oauth.consent.tsx");
  assert.match(consent, /createFileRoute\("\/oauth\/consent"\)/u);
  assert.match(consent, /getAuthorizationDetails/u);
  assert.match(consent, /approveAuthorization/u);
  assert.match(consent, /denyAuthorization/u);
  assert.match(redirect, /window\.location\.replace/u);
  assert.match(redirect, /\/oauth\/consent/u);
  assert.doesNotMatch(redirect, /getAuthorizationDetails|approveAuthorization|denyAuthorization/u);
});

test("active package declarations and package-manager policy contain no Lovable dependency", () => {
  const pkg = JSON.parse(read("package.json"));
  for (const group of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    for (const name of Object.keys(pkg[group] ?? {})) assert.doesNotMatch(name, /lovable/iu);
  }
  assert.equal(existsSync(join(root, ".lovable")), false);
  assert.equal(existsSync(join(root, "bun.lock")), false);
  assert.equal(existsSync(join(root, "bunfig.toml")), false);
  assert.match(pkg.scripts["release:zero-lovable"], /zero-lovable\.mjs/u);
  assert.match(pkg.scripts["release:zero-lovable:strict"], /--strict-lock/u);
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
    /LOVABLE_(?:API_KEY|AI_BASE_URL)/iu,
    /Lovable-API-Key/iu,
    /OPENAI_BASE_URL/u,
    /AI_PROVIDER_(?:URL|API_KEY)/u,
  ];
  for (const file of files) {
    const text = read(file);
    for (const pattern of forbidden) assert.equal(pattern.test(text), false, `${file} contains ${pattern}`);
  }
  const provider = read("src/lib/ai/provider.server.ts");
  const env = read(".env.example");
  assert.match(provider, /OPENAI_API_KEY/u);
  assert.match(provider, /ProviderKind = "azure_openai" \| "openai"/u);
  assert.match(provider, /https:\/\/api\.openai\.com\/v1/u);
  assert.match(provider, /\.openai\.azure\.com/u);
  assert.match(provider, /redirect: "error"/u);
  assert.doesNotMatch(provider, /VITE_.*(?:LOVABLE|OPENAI).*API_KEY/u);
  assert.doesNotMatch(env, /^OPENAI_BASE_URL=/mu);
});

test("provider env example contains no secret values or duplicate settings", () => {
  const env = read(".env.example");
  assert.match(env, /^OPENAI_API_KEY=$/mu);
  assert.match(env, /^AZURE_OPENAI_API_KEY=$/mu);
  assert.match(env, /^FIRECRAWL_API_KEY=$/mu);
  assert.match(env, /^SUPABASE_SERVICE_ROLE_KEY=$/mu);
  assert.equal(/pk_[A-Za-z0-9_-]+/u.test(env), false, "example env should not contain publishable third-party sample secrets");

  const names = [...env.matchAll(/^([A-Z][A-Z0-9_]*)=/gmu)].map((match) => match[1]);
  assert.deepEqual(names, [...new Set(names)], "example env should define each setting once");
});
