import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("staging rehearsal verifies a predeployed exact SHA and cannot deploy the app", () => {
  const workflow = read(".github/workflows/staging-rehearsal.yml");
  const rootRoute = read("src/routes/__root.tsx");
  const supabaseConfig = read("src/integrations/supabase/config.ts");
  const supabaseClient = read("src/integrations/supabase/client.ts");

  assert.match(workflow, /^on: \{ workflow_dispatch: \{\} \}$/mu);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /environment: staging/u);
  assert.match(workflow, /persist-credentials: false/u);
  assert.match(workflow, /name: Verify the externally deployed staging build and browser target/u);
  assert.match(workflow, /run: npm run smoke:deployment/u);
  assert.match(workflow, /KOVA_EXPECTED_SHA: "\$\{\{ github\.sha \}\}"/u);
  assert.match(
    workflow,
    /KOVA_EXPECTED_SUPABASE_URL: "\$\{\{ secrets\.STAGING_SUPABASE_URL \}\}"/u,
  );
  assert.match(
    workflow,
    /KOVA_EXPECTED_SUPABASE_PUBLISHABLE_KEY_SHA256: "\$\{\{ steps\.staging-build\.outputs\.supabase_publishable_key_sha256 \}\}"/u,
  );
  assert.match(workflow, /createHash\("sha256"\)\.update\(publishableKey\)/u);
  assert.match(workflow, /export VITE_SUPABASE_URL="\$staging_url"/u);
  assert.match(rootRoute, /name: "kova-build"/u);
  assert.match(rootRoute, /SUPABASE_BROWSER_CONFIG/u);
  assert.match(rootRoute, /name: "kova-supabase-url"/u);
  assert.match(rootRoute, /name: "kova-supabase-publishable-key"/u);
  assert.match(rootRoute, /import\.meta\.env\.VITE_KOVA_BUILD_SHA/u);
  assert.match(rootRoute, /"Cache-Control": "no-store, max-age=0"/u);
  assert.match(supabaseConfig, /import\.meta\.env\.VITE_SUPABASE_URL/u);
  assert.match(supabaseConfig, /import\.meta\.env\.VITE_SUPABASE_PUBLISHABLE_KEY/u);
  assert.doesNotMatch(supabaseConfig, /process\.env/u);
  assert.match(supabaseConfig, /export const SUPABASE_BROWSER_CONFIG = Object\.freeze/u);
  assert.match(supabaseConfig, /Server-only SUPABASE_\* variables belong/u);
  assert.match(supabaseClient, /const \{ url, publishableKey \} = SUPABASE_BROWSER_CONFIG/u);
  assert.match(supabaseClient, /createClient<Database>\(url, publishableKey/u);
  assert.match(workflow, /KOVA_GATE_ADMINISTRATOR_DIAGNOSTICS: not-run/u);
  assert.doesNotMatch(workflow, /KOVA_GATE_ADMINISTRATOR_DIAGNOSTICS: passed/u);
  assert.match(workflow, /name: Derive authenticated staging gates/u);
  assert.match(workflow, /readFileSync\("artifacts\/release\/authenticated-smoke\.json"/u);
  assert.match(workflow, /report\.target !== process\.env\.KOVA_STAGING_ALLOWED_HOST/u);
  assert.match(workflow, /report\.orphans\.length === 0/u);
  assert.match(workflow, /report\.cleanup === "orphaned" \? "failed"/u);
  assert.match(workflow, /workflow\.isolation\?\.select === true/u);
  assert.match(
    workflow,
    /KOVA_GATE_AUTHENTICATED_CRUD: "\$\{\{ steps\.authenticated-evidence\.outputs\.authenticated_crud \}\}"/u,
  );
  assert.match(
    workflow,
    /KOVA_GATE_OWNER_ISOLATION: "\$\{\{ steps\.authenticated-evidence\.outputs\.owner_isolation \}\}"/u,
  );
  assert.match(
    workflow,
    /KOVA_SMOKE_CLEANUP: "\$\{\{ steps\.authenticated-evidence\.outputs\.cleanup \}\}"/u,
  );
  assert.doesNotMatch(workflow, /KOVA_GATE_AUTHENTICATED_CRUD: passed/u);
  assert.doesNotMatch(workflow, /KOVA_GATE_OWNER_ISOLATION: passed/u);
  assert.match(workflow, /KOVA_STAGING_VALIDATED=0/u);
  assert.doesNotMatch(workflow, /KOVA_STAGING_VALIDATED=1/u);
  assert.match(workflow, /PLAYWRIGHT_BASE_URL: "\$\{\{ vars\.STAGING_BASE_URL \}\}"/u);
  assert.doesNotMatch(workflow, /PLAYWRIGHT_BASE_URL=\$\{\{/u);

  const identityGate = workflow.indexOf("run: npm run smoke:deployment");
  const edgeProbe = workflow.indexOf("run: npm run release:edge");
  const candidateEvidence = workflow.indexOf("npm run release:candidate");
  assert.ok(identityGate >= 0);
  assert.ok(edgeProbe > identityGate);
  assert.ok(candidateEvidence > edgeProbe);

  for (const forbidden of [
    /CLOUDFLARE_API_TOKEN/u,
    /CLOUDFLARE_ACCOUNT_ID/u,
    /wrangler deploy/u,
    /cloudflare\/wrangler-action@/u,
    /az containerapp update/u,
    /az deployment group create/u,
  ]) {
    assert.doesNotMatch(workflow, forbidden);
  }
});

test("production Azure workflow is protected, OIDC-based, digest-bound, and plan-only", () => {
  const workflow = read(".github/workflows/validate-azure-production.yml");

  assert.match(workflow, /^on:\n  workflow_dispatch:/mu);
  assert.doesNotMatch(workflow, /^  (?:push|pull_request|schedule):/mu);
  assert.match(
    workflow,
    /if: inputs\.confirmation == 'PLAN' && github\.ref == 'refs\/heads\/main'/u,
  );
  assert.match(workflow, /environment:\n      name: production/u);
  assert.match(workflow, /permissions:\n  contents: read\n  id-token: write/u);
  assert.match(workflow, /azure\/login@7ddb5af1ef8758cf1353cf3b42f940aee27ba21c # v3/u);
  assert.match(workflow, /persist-credentials: false/u);
  assert.match(
    workflow,
    /concurrency:\n  group: kovagpt-azure-production-plan\n  cancel-in-progress: false/u,
  );
  assert.match(workflow, /@sha256:/u);
  assert.match(workflow, /org\.opencontainers\.image\.revision/u);
  assert.match(workflow, /com\.kovagpt\.source\.tree/u);
  assert.match(workflow, /com\.kovagpt\.browser\.config-verified/u);
  assert.match(workflow, /browser-config-provenance\.json/u);
  assert.match(workflow, /value\.sourceContext !== "acr-git"/u);
  assert.match(workflow, /document\.parameters\.supabasePublishableKey/u);
  assert.match(workflow, /createHash\("sha256"\)/u);
  assert.match(workflow, /provenance\.publishableKeySha256 !== publishableKeySha256/u);
  assert.match(workflow, /infra\/azure\/production\/main\.bicep/u);
  assert.match(workflow, /--result-format ResourceIdOnly/u);
  assert.doesNotMatch(
    workflow.slice(0, workflow.indexOf("jobs:")),
    /KOVA_PRODUCTION_BICEP_PARAMETERS_JSON/u,
  );
  assert.match(
    workflow,
    /name: Render protected production parameters for planning[\s\S]*env:[\s\S]*KOVA_PRODUCTION_BICEP_PARAMETERS_JSON:/u,
  );

  const validate = workflow.indexOf("az deployment group validate");
  const whatIf = workflow.indexOf("az deployment group what-if");
  assert.ok(validate >= 0);
  assert.ok(whatIf > validate);

  for (const forbidden of [
    /az deployment group create/u,
    /az containerapp (?:create|update)/u,
    /wrangler deploy/u,
    /cloudflare\/wrangler-action@/u,
    /CLOUDFLARE_API_TOKEN/u,
    /CLOUDFLARE_ACCOUNT_ID/u,
  ]) {
    assert.doesNotMatch(workflow, forbidden);
  }
});

test("deployment smoke bounds every request and inspects the deployed browser bundle", () => {
  const smoke = read("scripts/post-deploy-smoke.mjs");

  assert.match(smoke, /KOVA_SMOKE_REQUEST_TIMEOUT_MS/u);
  assert.match(smoke, /KOVA_SMOKE_MAX_JAVASCRIPT_BYTES/u);
  assert.match(smoke, /AbortController/u);
  assert.match(smoke, /response\.body\.getReader\(\)/u);
  assert.match(smoke, /JAVASCRIPT_CONTENT_TYPES/u);
  assert.match(smoke, /JAVASCRIPT_DEPENDENCY_PATTERNS/u);
  assert.match(smoke, /assertNotCacheable/u);
  assert.match(smoke, /verifyRootBuildIdentity/u);
  assert.match(smoke, /verifyRootSupabaseConfig/u);
  assert.match(smoke, /getUniqueMetaContent/u);
  assert.match(smoke, /source\.includes\(expectedBuildSha\)/u);
  assert.match(smoke, /KOVA_EXPECTED_SUPABASE_URL/u);
  assert.match(smoke, /KOVA_EXPECTED_SUPABASE_PUBLISHABLE_KEY_SHA256/u);
  assert.match(smoke, /No deployed JavaScript assets were found/u);
  assert.doesNotMatch(smoke, /SUPABASE_PROJECT_URL_PATTERN/u);
  assert.doesNotMatch(smoke, /SUPABASE_PUBLISHABLE_KEY_PATTERN/u);
  assert.doesNotMatch(smoke, /QUOTED_JAVASCRIPT_PATTERN/u);
  assert.doesNotMatch(smoke, /collectJavaScriptStringLiterals/u);
  assert.doesNotMatch(smoke, /await fetch\(/u);
});

test("deployment smoke safely traverses and validates deployed JavaScript", async () => {
  const expectedSha = "a".repeat(40);
  const expectedProjectRef = "stagingprojectref123";
  const expectedSupabaseUrl = "https://" + expectedProjectRef + ".supabase.co";
  const expectedPublishableKey = "sb_publishable_" + "x".repeat(32);
  const expectedPublishableKeySha256 = createHash("sha256")
    .update(expectedPublishableKey)
    .digest("hex");
  const requestedPaths = [];
  let assetContentType = "application/javascript";
  let browserBuildSha = expectedSha;
  let htmlCacheControl = "no-store, max-age=0";
  let runtimeSupabaseUrl = expectedSupabaseUrl;
  let runtimeSupabasePublishableKey = expectedPublishableKey;
  let includeRuntimeMetas = true;
  let extraRuntimeMeta = "";
  const scripts = new Map([
    [
      "/assets/index.js",
      [
        'import "./relative.js";',
        'import "/assets/root.js";',
        'const deps = ["assets/preloaded.js"];',
        'const stripe = "https://js.stripe.com/v3/stripe.js";',
      ].join(" "),
    ],
    ["/assets/relative.js", "export const relative = true;"],
    ["/assets/root.js", "export const root = true;"],
    [
      "/assets/preloaded.js",
      [
        String.raw`const quotePattern = /["']/;`,
        'const tracingAllowlist = "*.supabase.co";',
        'const bareSuffix = ".supabase.co";',
        'export const supabaseUrl = "https://' + expectedProjectRef + '.supabase.co";',
        'export const supabaseKey = "' + expectedPublishableKey + '";',
        'export const buildSha = "' + expectedSha + '";',
      ].join(" "),
    ],
  ]);

  const server = createServer((request, response) => {
    requestedPaths.push(request.url);
    if (request.url === "/api/version") {
      response.writeHead(200, {
        "content-type": "application/json",
        "x-kova-build": expectedSha,
        "cache-control": "no-store, max-age=0",
      });
      response.end(JSON.stringify({ sha: expectedSha }));
      return;
    }
    if (request.url === "/") {
      response.writeHead(200, {
        "content-type": "text/html",
        "cache-control": htmlCacheControl,
      });
      response.end(
        '<meta name="kova-build" content="' +
          browserBuildSha +
          '">' +
          (includeRuntimeMetas
            ? '<meta name="kova-supabase-url" content="' +
              runtimeSupabaseUrl +
              '"><meta name="kova-supabase-publishable-key" content="' +
              runtimeSupabasePublishableKey +
              '">'
            : "") +
          extraRuntimeMeta +
          '<script type="module" src="/assets/index.js"></script>',
      );
      return;
    }
    if (scripts.has(request.url)) {
      response.writeHead(200, { "content-type": assetContentType });
      response.end(scripts.get(request.url));
      return;
    }
    if (request.url === "/robots.txt") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("User-agent: *");
      return;
    }
    if (request.url === "/sitemap.xml") {
      response.writeHead(200, { "content-type": "application/xml" });
      response.end("<urlset />");
      return;
    }
    if (["/pricing", "/modes", "/~oauth/callback"].includes(request.url)) {
      response.writeHead(200, {
        "content-type": "text/html",
        "cache-control": htmlCacheControl,
      });
      response.end("<main>KovaGPT</main>");
      return;
    }
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("missing");
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");

  async function runSmoke(extraEnv = {}) {
    requestedPaths.length = 0;
    const child = spawn(process.execPath, ["scripts/post-deploy-smoke.mjs"], {
      env: {
        ...process.env,
        KOVA_SMOKE_BASE_URL: "http://127.0.0.1:" + address.port,
        KOVA_EXPECTED_SHA: expectedSha,
        KOVA_EXPECTED_SUPABASE_URL: expectedSupabaseUrl,
        KOVA_EXPECTED_SUPABASE_PUBLISHABLE_KEY_SHA256: expectedPublishableKeySha256,
        KOVA_SMOKE_REQUEST_TIMEOUT_MS: "1000",
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const [code] = await once(child, "exit");
    return { code, stdout, stderr, paths: [...requestedPaths] };
  }

  try {
    const passing = await runSmoke();
    assert.equal(passing.code, 0, passing.stderr);
    assert.match(passing.stdout, /passed smoke checks/u);
    assert.ok(passing.paths.includes("/assets/relative.js"));
    assert.ok(passing.paths.includes("/assets/root.js"));
    assert.ok(passing.paths.includes("/assets/preloaded.js"));
    assert.ok(!passing.paths.includes("/assets/assets/preloaded.js"));
    assert.ok(!passing.paths.includes("/stripe.js"));

    htmlCacheControl = "public, max-age=300";
    const cacheableHtml = await runSmoke();
    assert.notEqual(cacheableHtml.code, 0);
    assert.match(cacheableHtml.stderr, /returned a cacheable response/u);
    htmlCacheControl = "no-store, max-age=0";

    assetContentType = "text/html";
    const fallback = await runSmoke();
    assert.notEqual(fallback.code, 0);
    assert.match(fallback.stderr, /non-JavaScript content type text\/html/u);
    assetContentType = "application/javascript";

    // Exact dead literals remain in the fetched JavaScript; runtime metadata is authoritative.
    runtimeSupabaseUrl = expectedSupabaseUrl + "@attacker.example";
    const concatenatedRuntimeUrl = await runSmoke();
    assert.notEqual(concatenatedRuntimeUrl.code, 0);
    assert.match(concatenatedRuntimeUrl.stderr, /non-canonical Supabase runtime URL/u);
    runtimeSupabaseUrl = expectedSupabaseUrl;

    for (const malformedKey of [
      "prefix" + expectedPublishableKey,
      expectedPublishableKey + ".junk",
      expectedPublishableKey + "&#46;junk",
      expectedPublishableKey + String.fromCharCode(39),
    ]) {
      runtimeSupabasePublishableKey = malformedKey;
      const malformedRuntimeKey = await runSmoke();
      assert.notEqual(malformedRuntimeKey.code, 0);
      assert.match(malformedRuntimeKey.stderr, /non-canonical Supabase publishable key/u);
      assert.doesNotMatch(malformedRuntimeKey.stderr, /sb_publishable_/u);
    }
    runtimeSupabasePublishableKey = "sb_publishable_" + "y".repeat(32);
    const wrongPublishableKey = await runSmoke();
    assert.notEqual(wrongPublishableKey.code, 0);
    assert.match(wrongPublishableKey.stderr, /publishable-key fingerprint/u);
    assert.doesNotMatch(wrongPublishableKey.stderr, /sb_publishable_/u);
    runtimeSupabasePublishableKey = expectedPublishableKey;

    includeRuntimeMetas = false;
    const missingRuntimeConfig = await runSmoke();
    assert.notEqual(missingRuntimeConfig.code, 0);
    assert.match(missingRuntimeConfig.stderr, /exactly one valid kova-supabase-url meta/u);
    includeRuntimeMetas = true;

    extraRuntimeMeta = '<meta name="kova-supabase-url" content="' + expectedSupabaseUrl + '">';
    const duplicateRuntimeConfig = await runSmoke();
    assert.notEqual(duplicateRuntimeConfig.code, 0);
    assert.match(duplicateRuntimeConfig.stderr, /exactly one valid kova-supabase-url meta/u);
    extraRuntimeMeta = "";

    scripts.set(
      "/assets/preloaded.js",
      'export const supabaseUrl = "https://' +
        expectedProjectRef +
        '.supabase.co"; export const supabaseKey = "' +
        expectedPublishableKey +
        '"; export const buildSha = "' +
        "b".repeat(40) +
        '";',
    );
    const staleBrowserBundle = await runSmoke();
    assert.notEqual(staleBrowserBundle.code, 0);
    assert.match(staleBrowserBundle.stderr, /does not contain the expected build SHA/u);

    scripts.set(
      "/assets/preloaded.js",
      'export const supabaseUrl = "https://' +
        expectedProjectRef +
        '.supabase.co"; export const supabaseKey = "' +
        expectedPublishableKey +
        '"; export const buildSha = "' +
        expectedSha +
        '";',
    );
    scripts.set("/assets/index.js", 'const deps = ["assets/preloaded.js", "assets/oversized.js"];');
    scripts.set("/assets/oversized.js", "x".repeat(8192));
    const oversized = await runSmoke({ KOVA_SMOKE_MAX_JAVASCRIPT_BYTES: "4096" });
    assert.notEqual(oversized.code, 0);
    assert.match(oversized.stderr, /Deployed JavaScript scan exceeded 4096 bytes/u);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
});

test("production planning documentation records the apply blockers without claiming deployment", () => {
  const documentation = read("docs/azure/PRODUCTION_DEPLOYMENT_PLAN.md");

  assert.match(documentation, /plan-only/u);
  assert.match(documentation, /required reviewers/u);
  assert.match(documentation, /OIDC/u);
  assert.match(documentation, /exact inventoried production Container App name/u);
  assert.match(documentation, /complete Container App environment list/u);
  assert.match(documentation, /Staging images contain staging browser configuration/u);
  assert.match(documentation, /embedded provenance file alone do not authenticate/u);
  assert.match(documentation, /role identifiers are declared but no production role assignments/u);
  assert.match(documentation, /declared but unused/u);
  assert.match(documentation, /Single-revision mode sends 100% of traffic/u);
  assert.match(documentation, /denial of unauthorized raw-origin requests/u);
  assert.match(documentation, /separate reviewed pull request/u);
  assert.match(documentation, /release-candidate manifest keeps `validation\.staging` false/u);
  assert.match(documentation, /does not guarantee FIFO ordering/u);
  assert.match(documentation, /not a durable queue/u);
  assert.doesNotMatch(documentation, /queues later runs/u);
});
