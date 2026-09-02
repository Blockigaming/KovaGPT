import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("staging rehearsal verifies a predeployed exact SHA and cannot deploy the app", () => {
  const workflow = read(".github/workflows/staging-rehearsal.yml");

  assert.match(workflow, /^on: \{ workflow_dispatch: \{\} \}$/mu);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /environment: staging/u);
  assert.match(workflow, /persist-credentials: false/u);
  assert.match(
    workflow,
    /name: Verify the externally deployed staging build is the exact workflow SHA/u,
  );
  assert.match(workflow, /run: npm run smoke:deployment/u);
  assert.match(workflow, /KOVA_EXPECTED_SHA: "\$\{\{ github\.sha \}\}"/u);
  assert.match(workflow, /KOVA_GATE_ADMINISTRATOR_DIAGNOSTICS: not-run/u);
  assert.doesNotMatch(workflow, /KOVA_GATE_ADMINISTRATOR_DIAGNOSTICS: passed/u);

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
  assert.match(
    workflow,
    /azure\/login@f5d393ae46f8fde4be8b75f32e3fc50e654ad0ca/u,
  );
  assert.match(workflow, /persist-credentials: false/u);
  assert.match(workflow, /@sha256:/u);
  assert.match(workflow, /org\.opencontainers\.image\.revision/u);
  assert.match(workflow, /com\.kovagpt\.source\.tree/u);
  assert.match(workflow, /com\.kovagpt\.browser\.config-verified/u);
  assert.match(workflow, /browser-config-provenance\.json/u);
  assert.match(workflow, /infra\/azure\/production\/main\.bicep/u);

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

test("production planning documentation records the apply blockers without claiming deployment", () => {
  const documentation = read("docs/azure/PRODUCTION_DEPLOYMENT_PLAN.md");

  assert.match(documentation, /plan-only/u);
  assert.match(documentation, /required reviewers/u);
  assert.match(documentation, /OIDC/u);
  assert.match(
    documentation,
    /exact inventoried production Container App name/u,
  );
  assert.match(documentation, /complete Container App environment list/u);
  assert.match(
    documentation,
    /Staging images contain staging browser configuration/u,
  );
  assert.match(
    documentation,
    /embedded provenance file alone do not authenticate/u,
  );
  assert.match(
    documentation,
    /role identifiers are declared but no production role assignments/u,
  );
  assert.match(documentation, /declared but unused/u);
  assert.match(documentation, /Single-revision mode sends 100% of traffic/u);
  assert.match(documentation, /denial of unauthorized raw-origin requests/u);
  assert.match(documentation, /separate reviewed pull request/u);
});
