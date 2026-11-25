import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  productionCandidateBuildRequest,
  productionCandidateConfig,
} from "../../scripts/azure/build-production-candidate.mjs";

const workflow = readFileSync(
  new URL("../../.github/workflows/build-azure-production-candidate.yml", import.meta.url),
  "utf8",
);
const buildJob = workflow.split("  build-only:\n")[1];
assert.ok(buildJob, "The protected production build job exists");
const jobEnvironment = buildJob.split("    env:\n")[1]?.split("    steps:\n")[0];
assert.ok(jobEnvironment, "Browser inputs are supplied to the whole protected job");
const names = ["VITE_KOVA_AUTH_MODE", "VITE_KOVA_GOOGLE_AUTH_ENABLED", "VITE_KOVA_AUTH_ORIGIN"];

// Production workflows must pin the hosted authority, independent of stale vars.
const ghcr = readFileSync(
  new URL("../../.github/workflows/build-ghcr-production-candidate.yml", import.meta.url),
  "utf8",
);
function selectedBrowserInputs() {
  return Object.fromEntries(
    names.map((name) => {
      const entry = jobEnvironment.match(new RegExp(`^      ${name}: "([^"]*)"$`, "mu"));
      assert.ok(entry, `${name} must be a pinned literal`);
      const other = ghcr.match(new RegExp(`^      ${name}: "([^"]*)"$`, "mu"));
      assert.ok(other, `${name} must also be pinned in the GHCR workflow`);
      assert.equal(other[1], entry[1]);
      return [name, entry[1]];
    }),
  );
}

const sourceSha = "a".repeat(40);
const sourceTree = "b".repeat(40);
const projectRef = "mfbycmbjygcfkrsuepxf";
const browserKey = `sb_publishable_${"x".repeat(20)}`;
const stripeKey = `pk_live_${"y".repeat(20)}`;
function environment(inputMode, variables, overrides = {}) {
  return {
    GITHUB_REPOSITORY: "Blockigaming/KovaGPT",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_SHA: sourceSha,
    GITHUB_RUN_ID: "12345",
    GITHUB_RUN_ATTEMPT: "1",
    KOVA_BUILD_CONFIRMATION: "BUILD_ONLY",
    KOVA_APPROVED_SOURCE_SHA: sourceSha,
    KOVA_PRODUCTION_ACR_NAME: "kovagptacr",
    KOVA_PRODUCTION_ACR_LOGIN_SERVER: "kovagptacr-dte9hugbhjghcyb8.azurecr.io",
    KOVA_PRODUCTION_IMAGE_REPOSITORY: "kovagpt-web",
    KOVA_PRODUCTION_SUPABASE_PROJECT_REF: projectRef,
    KOVA_PRODUCTION_BROWSER_INPUT_MODE: inputMode,
    KOVA_PRODUCTION_SUPABASE_URL: `https://${projectRef}.supabase.co`,
    KOVA_PRODUCTION_SUPABASE_PUBLISHABLE_KEY: browserKey,
    KOVA_PRODUCTION_STRIPE_PUBLISHABLE_KEY: stripeKey,
    KOVA_PRODUCTION_BICEP_PARAMETERS_JSON: JSON.stringify({
      parameters: {
        acrName: { value: "kovagptacr" },
        supabaseUrl: { value: `https://${projectRef}.supabase.co` },
        supabasePublishableKey: { value: browserKey },
      },
    }),
    ...selectedBrowserInputs(variables),
    ...overrides,
  };
}
function forwarded(inputMode, variables, overrides) {
  const config = productionCandidateConfig(environment(inputMode, variables, overrides));
  const request = productionCandidateBuildRequest(config, sourceTree, false);
  return {
    request,
    browser: Object.fromEntries(
      request.arguments
        .filter(({ name }) => names.includes(name))
        .map(({ name, value }) => [name, value]),
    ),
  };
}

const hosted = {
  VITE_KOVA_AUTH_MODE: "supabase",
  VITE_KOVA_GOOGLE_AUTH_ENABLED: "false",
  VITE_KOVA_AUTH_ORIGIN: "",
};

test("both production workflows pin Supabase-only browser auth", () => {
  assert.match(buildJob, /environment:\n      name: production/u);
  assert.deepEqual(selectedBrowserInputs(), hosted);
  assert.doesNotMatch(workflow, /vars\.VITE_KOVA_(?:AUTH_MODE|GOOGLE_AUTH_ENABLED|AUTH_ORIGIN)/u);
  assert.doesNotMatch(ghcr, /vars\.VITE_KOVA_(?:AUTH_MODE|GOOGLE_AUTH_ENABLED|AUTH_ORIGIN)/u);
});

test("stale repository variables cannot change the commit-pinned production build", () => {
  for (const inputMode of ["plan", "narrow-openai"])
    for (const mode of ["supabase", "dual", "kova", "invalid"]) {
      const { browser, request } = forwarded(inputMode, {
        VITE_KOVA_AUTH_MODE: mode,
        VITE_KOVA_GOOGLE_AUTH_ENABLED: "true",
        VITE_KOVA_AUTH_ORIGIN: "https://auth.example.invalid",
      });
      assert.deepEqual(browser, hosted);
      assert.equal(
        request.sourceLocation,
        `https://github.com/Blockigaming/KovaGPT.git#${sourceSha}`,
      );
      assert.ok(request.arguments.every(({ isSecret }) => isSecret === false));
    }
});

test("server bindings cannot change pinned browser authority", () => {
  for (const inputMode of ["plan", "narrow-openai"]) {
    assert.deepEqual(
      forwarded(
        inputMode,
        {},
        {
          KOVA_AUTH_MODE: "kova",
          KOVA_AUTH_ORIGIN: "https://server-auth.example.invalid",
          KOVA_GOOGLE_AUTH_ENABLED: "true",
        },
      ).browser,
      hosted,
    );
  }
});

test("workflow retains explicit main approval and includes this regression in source CI", () => {
  assert.match(
    buildJob,
    /github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main' && inputs\.source_sha == github\.sha && \(\(inputs\.operation == 'build' && inputs\.confirmation == 'BUILD_ONLY'\) \|\| \(inputs\.operation == 'diagnose-access' && inputs\.confirmation == 'READ_ONLY'\)\)/u,
  );
  const relativePath = "tests/unit/azure-production-browser-workflow-inputs.test.mjs";
  assert.match(
    workflow,
    new RegExp(`run: node --test [^\\n]*${relativePath.replaceAll(".", "\\.")}`, "u"),
  );
  assert.ok(workflow.includes(`      - ${relativePath}`), "CI trigger watches its regression test");
});
