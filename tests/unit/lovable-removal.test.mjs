import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  auditZeroLovable,
  decodeReadableText,
  hasLovableActiveControl,
  hasLovableBundlePath,
  hasLovableProductionInput,
  hasLovableRuntimeSource,
  hasUnclassifiedLovableDocumentation,
  hasReadableBundleContent,
  hasReadableRuntimeContent,
  isDockerfilePath,
  inspectLockfile,
  inspectPackageMetadata,
  inspectPackageScripts,
} from "../../scripts/release/zero-lovable.mjs";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

const retiredRuntimeFiles = [
  "src/lib/legacy-lovable-route.ts",
  "src/routes/[.]lovable.oauth.consent.tsx",
  "src/routes/lovable/email/auth/preview.ts",
  "src/routes/lovable/email/auth/webhook.ts",
  "src/routes/lovable/email/queue/process.ts",
  "src/routes/lovable/email/suppression.ts",
  "src/routes/lovable/email/transactional/preview.ts",
  "src/routes/lovable/email/transactional/send.ts",
];

test("Lovable-named runtime routes, helper, generated entries, and chunks are absent", () => {
  for (const path of retiredRuntimeFiles) {
    assert.equal(existsSync(join(root, path)), false, path);
  }

  const routeTree = read("src/routeTree.gen.ts");
  const routeManifest = read("docs/release-reconciliation/canonical-route-manifest.json");
  assert.doesNotMatch(routeTree, /lovable/iu);
  assert.doesNotMatch(routeManifest, /lovable/iu);

  const gate = read("scripts/release/zero-lovable.mjs");
  assert.match(gate, /Lovable-named runtime source/u);
  assert.match(gate, /Lovable-named production input/u);
  assert.match(gate, /Lovable-named bundle asset/u);
  assert.match(gate, /Lovable-named bundle content/u);
  assert.equal(hasLovableRuntimeSource("worker/src/lovable-proxy.mjs"), true);
  assert.equal(hasLovableRuntimeSource("worker/src/proxy.mjs", "Lovable relay"), true);
  assert.equal(hasLovableRuntimeSource("workers/lovable-agent.mjs"), true);
  assert.equal(hasLovableRuntimeSource("src/assets/lovable-logo.png"), true);
  assert.equal(hasLovableRuntimeSource("tests/fixtures/lovable-proxy.mjs"), false);
  assert.equal(hasLovableBundlePath("dist/client/lovable-logo.png"), true);
  for (const path of [
    "dist/client/app.js.map",
    "dist/client/license.txt",
    "dist/client/RUNTIME.TXT",
    "dist/client/logo.svg",
    "dist/client/_headers",
    "dist/client/_redirects",
  ]) {
    assert.equal(hasReadableBundleContent(path), true, path);
  }
  assert.equal(hasReadableRuntimeContent("worker/Dockerfile"), true);
  assert.equal(hasReadableRuntimeContent("worker/Dockerfile.prod"), true);
  assert.equal(hasReadableRuntimeContent("worker/app.Dockerfile"), true);
  assert.equal(hasReadableRuntimeContent("worker/.env.example"), true);
  for (const path of ["Dockerfile", "Dockerfile.prod", "app.Dockerfile", "app.Dockerfile.dev"]) {
    assert.equal(isDockerfilePath(path), true, path);
    assert.equal(hasLovableProductionInput(path, "RUN npx lovable-cli build"), true, path);
  }
  assert.equal(hasLovableRuntimeSource("worker/Dockerfile", "ENV LOVABLE_API_KEY=test"), true);
  assert.equal(hasReadableRuntimeContent("src/lib/provider.d.mts"), true);
  assert.equal(
    hasLovableRuntimeSource("src/lib/provider.d.mts", "export const key = 'LOVABLE_API_KEY';"),
    true,
  );
  assert.equal(
    hasLovableProductionInput(
      "supabase/migrations/20260902000000_provider.sql",
      "create table lovable_jobs (id uuid);",
    ),
    true,
  );
  assert.equal(hasLovableProductionInput("docs/history.md", "Lovable was retired"), false);
  for (const path of [
    ".github/workflows/deploy.yml",
    "infra/azure/main.bicep",
    "public/_redirects",
    "scripts/deploy.sh",
    "docker-compose.agent.yml",
    "wrangler.jsonc",
  ]) {
    assert.equal(hasLovableActiveControl(path, "proxy to lovable.example"), true, path);
  }
  assert.equal(
    hasLovableActiveControl("scripts/release/zero-lovable.mjs", "const forbidden = /lovable/u;"),
    false,
  );
  assert.equal(
    hasLovableActiveControl(
      "scripts/release/finalize-local-candidate.sh",
      "npm run release:zero-lovable:strict",
    ),
    false,
  );
  assert.equal(
    hasLovableActiveControl(
      "scripts/release/finalize-local-candidate.sh",
      "npm run release:zero-lovable:strict && lovable deploy",
    ),
    true,
  );

  const lovableText = "https://lovable.app/runtime";
  const utf16le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(lovableText, "utf16le")]);
  const utf16beBody = Buffer.from(lovableText, "utf16le");
  for (let index = 0; index < utf16beBody.length; index += 2) {
    const first = utf16beBody[index];
    utf16beBody[index] = utf16beBody[index + 1];
    utf16beBody[index + 1] = first;
  }
  const utf16be = Buffer.concat([Buffer.from([0xfe, 0xff]), utf16beBody]);
  assert.match(decodeReadableText(utf16le), /lovable\.app/u);
  assert.match(decodeReadableText(utf16be), /lovable\.app/u);
  assert.throws(
    () => decodeReadableText(Buffer.from([0x6c, 0x00, 0x6f, 0x00])),
    /NUL-containing text/u,
  );

  const deletedPath = "src/routes/lovable/pending-delete.ts";
  assert.equal(existsSync(join(root, deletedPath)), false);
  assert.doesNotMatch(
    auditZeroLovable({ files: [deletedPath] }).errors.join("\n"),
    /Lovable-named runtime source/u,
  );
  assert.ok(
    gate.indexOf("if (hasLovableBundlePath(bundlePath))") <
      gate.indexOf("if (!hasReadableBundleContent(path)) continue;", gate.indexOf("filesUnder")),
  );
});

test("every deployable build requires the strict built-output audit after Vite", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(
    pkg.scripts["release:zero-lovable:built"],
    "node scripts/release/zero-lovable.mjs --strict-lock --require-build",
  );

  for (const scriptName of ["build", "build:dev"]) {
    const script = pkg.scripts[scriptName];
    assert.match(script, /vite build/u, scriptName);
    assert.match(script, /npm run release:zero-lovable:built/u, scriptName);
    assert.ok(
      script.indexOf("vite build") < script.indexOf("npm run release:zero-lovable:built"),
      scriptName,
    );
  }

  for (const path of [
    ".github/workflows/ci.yml",
    ".github/workflows/staging-rehearsal.yml",
    ".github/workflows/azure-container-ci.yml",
    "scripts/release/finalize-local-candidate.sh",
  ]) {
    assert.match(read(path), /npm run build/u, path);
  }

  const dockerfile = read("Dockerfile");
  assert.match(dockerfile, /npm run build/u);
  assert.match(
    read(
      ".github/workflows/ca-kovagpt-dev-AutoDeployTrigger-1724b7ba-d38e-4fd3-95e8-bef7f7fbc290.yml",
    ),
    /docker buildx build/u,
  );
});

test("Kova-owned OAuth consent, suppression, and auth-email templates remain intact", () => {
  const consent = read("src/routes/oauth.consent.tsx");
  const suppression = read("src/routes/email/unsubscribe.ts");
  const unsubscribePage = read("src/routes/unsubscribe.tsx");
  const signupTemplate = read("src/lib/email-templates/signup.tsx");
  const magicLinkTemplate = read("src/lib/email-templates/magic-link.tsx");

  assert.match(consent, /createFileRoute\("\/oauth\/consent"\)/u);
  assert.match(consent, /getAuthorizationDetails/u);
  assert.match(consent, /approveAuthorization/u);
  assert.match(consent, /denyAuthorization/u);

  assert.match(suppression, /createFileRoute\("\/email\/unsubscribe"\)/u);
  assert.match(suppression, /suppressThenConsumeToken/u);
  assert.match(suppression, /suppressed_emails/u);
  assert.match(unsubscribePage, /fetch\(`\/email\/unsubscribe/u);

  assert.match(signupTemplate, /export const SignupEmail/u);
  assert.match(magicLinkTemplate, /export const MagicLinkEmail/u);
  assert.match(signupTemplate, /BrandHeader/u);
  assert.match(magicLinkTemplate, /BrandHeader/u);
});

test("active package declarations and package-manager policy contain no Lovable dependency", () => {
  const pkg = JSON.parse(read("package.json"));
  for (const group of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    for (const name of Object.keys(pkg[group] ?? {})) assert.doesNotMatch(name, /lovable/iu);
  }
  assert.equal(existsSync(join(root, ".lovable")), false);
  assert.equal(existsSync(join(root, "bun.lock")), false);
  assert.equal(existsSync(join(root, "bunfig.toml")), false);
  assert.match(pkg.scripts["release:zero-lovable"], /zero-lovable\.mjs/u);
  assert.match(pkg.scripts["release:zero-lovable:strict"], /--strict-lock/u);
  assert.deepEqual(
    inspectLockfile({
      packages: {
        "": {},
        "node_modules/example": { resolved: "https://registry.example/lovable-cache/example.tgz" },
      },
    }),
    ["node_modules/example"],
  );
  assert.deepEqual(inspectPackageScripts(pkg), []);
  assert.deepEqual(inspectPackageScripts({ scripts: { deploy: "lovable deploy" } }), ["deploy"]);
  assert.deepEqual(
    inspectPackageScripts({ scripts: { "release:zero-lovable-deploy": "node safe.mjs" } }),
    ["release:zero-lovable-deploy"],
  );
  assert.deepEqual(inspectPackageMetadata(pkg), []);
  assert.deepEqual(inspectPackageMetadata({ homepage: "https://project.lovable.app" }), [
    "package metadata",
  ]);
});

test("Lovable documentation is current guidance or explicitly historical", () => {
  assert.equal(
    hasUnclassifiedLovableDocumentation(
      "docs/old-plan.md",
      "# Old plan\n\nLovable remains the deployment target.",
    ),
    true,
  );
  assert.equal(
    hasUnclassifiedLovableDocumentation(
      "docs/old-plan.md",
      "# Old plan\n\n> **Historical and superseded (2026-09-03):** Do not use.\n\nLovable was used.",
    ),
    false,
  );
  assert.equal(
    hasUnclassifiedLovableDocumentation(
      "docs/release-reconciliation/zero-lovable-classification.md",
      "# Zero-Lovable classification",
    ),
    false,
  );
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
    for (const pattern of forbidden)
      assert.equal(pattern.test(text), false, `${file} contains ${pattern}`);
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
  assert.equal(
    /pk_[A-Za-z0-9_-]+/u.test(env),
    false,
    "example env should not contain publishable third-party sample secrets",
  );

  const names = [...env.matchAll(/^([A-Z][A-Z0-9_]*)=/gmu)].map((match) => match[1]);
  assert.deepEqual(names, [...new Set(names)], "example env should define each setting once");
});
