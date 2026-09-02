import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("staging rehearsal verifies a predeployed exact SHA and cannot deploy the app", () => {
  const workflow = read(".github/workflows/staging-rehearsal.yml");

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
  assert.match(workflow, /KOVA_GATE_ADMINISTRATOR_DIAGNOSTICS: not-run/u);
  assert.doesNotMatch(workflow, /KOVA_GATE_ADMINISTRATOR_DIAGNOSTICS: passed/u);
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
  assert.match(workflow, /azure\/login@f5d393ae46f8fde4be8b75f32e3fc50e654ad0ca/u);
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
  assert.match(smoke, /AbortController/u);
  assert.match(smoke, /KOVA_EXPECTED_SUPABASE_URL/u);
  assert.match(smoke, /No deployed JavaScript assets were found/u);
  assert.ok(smoke.includes('candidate.startsWith("assets/")'));
  assert.match(smoke, /does not contain the expected Supabase project URL/u);
  assert.match(smoke, /contains an unexpected Supabase project URL/u);
  assert.doesNotMatch(smoke, /await fetch\(/u);
});

test("deployment smoke resolves Vite root, relative, and preload-map asset paths", async () => {
  const expectedSha = "a".repeat(40);
  const expectedProjectRef = "stagingprojectref123";
  const requestedPaths = [];
  const scripts = new Map([
    [
      "/assets/index.js",
      'import "./relative.js"; import "/assets/root.js"; const deps = ["assets/preloaded.js"];',
    ],
    ["/assets/relative.js", "export const relative = true;"],
    ["/assets/root.js", "export const root = true;"],
    [
      "/assets/preloaded.js",
      `export const supabaseUrl = "https://${expectedProjectRef}.supabase.co";`,
    ],
  ]);

  const server = createServer((request, response) => {
    requestedPaths.push(request.url);
    if (request.url === "/api/version") {
      response.writeHead(200, {
        "content-type": "application/json",
        "x-kova-build": expectedSha,
      });
      response.end(JSON.stringify({ sha: expectedSha }));
      return;
    }
    if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end('<script type="module" src="/assets/index.js"></script>');
      return;
    }
    if (scripts.has(request.url)) {
      response.writeHead(200, { "content-type": "application/javascript" });
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
      response.writeHead(200, { "content-type": "text/html" });
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

  const child = spawn(process.execPath, ["scripts/post-deploy-smoke.mjs"], {
    env: {
      ...process.env,
      KOVA_SMOKE_BASE_URL: `http://127.0.0.1:${address.port}`,
      KOVA_EXPECTED_SHA: expectedSha,
      KOVA_EXPECTED_SUPABASE_URL: `https://${expectedProjectRef}.supabase.co`,
      KOVA_SMOKE_REQUEST_TIMEOUT_MS: "1000",
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
  server.close();
  await once(server, "close");

  assert.equal(code, 0, stderr);
  assert.match(stdout, /passed smoke checks/u);
  assert.ok(requestedPaths.includes("/assets/relative.js"));
  assert.ok(requestedPaths.includes("/assets/root.js"));
  assert.ok(requestedPaths.includes("/assets/preloaded.js"));
  assert.ok(!requestedPaths.includes("/assets/assets/preloaded.js"));
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
});
