import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("OAuth uses one canonical callback URI", () => {
  const source = read("src/lib/oauth-session.ts");
  assert.match(source, /https:\/\/kovagpt\.com\$\{OAUTH_CALLBACK_PATH\}/);
  assert.match(source, /window\.location\.origin\}\$\{OAUTH_CALLBACK_PATH\}/);
  assert.doesNotMatch(source, /return "https:\/\/kovagpt\.com\/"/);
});

test("Azure deployment identity is non-secret, no-store, digest-bound, and verified", () => {
  const route = read("src/routes/api/version.ts");
  const workflow = read(
    ".github/workflows/ca-kovagpt-dev-AutoDeployTrigger-1724b7ba-d38e-4fd3-95e8-bef7f7fbc290.yml",
  );
  const smoke = read("scripts/post-deploy-smoke.mjs");
  assert.match(route, /"X-Kova-Build"/);
  assert.match(route, /"Cache-Control": "no-store, max-age=0"/);
  assert.doesNotMatch(route, /process\.env|SUPABASE|SECRET|TOKEN/);
  assert.match(workflow, /--build-arg KOVA_SOURCE_SHA="\$GITHUB_SHA"/u);
  assert.match(workflow, /digest_image="\$\{ACR_LOGIN_SERVER\}\/\$\{IMAGE_NAME\}@\$\{digest\}"/u);
  assert.match(workflow, /\/api\/version/u);
  assert.match(workflow, /"\$runtime_sha" == "\$GITHUB_SHA"/u);
  assert.match(smoke, /identity\.sha !== expectedSha/);
});

test("Images starts closed, has no dead attachment control, and isolates generations", () => {
  const source = read("src/routes/images.tsx");
  assert.match(source, /useState\(false\);[\s\S]*generationControllerRef/);
  assert.match(source, /generationControllerRef\.current\?\.abort\(\)/);
  assert.match(source, /generation !== generationRef\.current/);
  assert.match(source, /kovagpt:v2:image-history:/);
  assert.doesNotMatch(source, /aria-label="Attach"|<Paperclip/);
  assert.doesNotMatch(source, /Create variation/);
  assert.match(
    source,
    /aria-label=\{[\s\S]*?editSelection \? "Describe the image edit" : "Describe the image to generate"/,
  );
  assert.match(source, /nativeEvent\.isComposing/);
});
