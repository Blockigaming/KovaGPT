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

// Evaluate only the literal protected-var expressions used by this workflow.
// Missing GitHub vars are empty strings; nonempty strings such as "false" are
// truthy. This is a source/config integration check, not an Actions/cloud run.
function selectedBrowserInputs(variables = {}) {
  return Object.fromEntries(
    names.map((name) => {
      const entry = jobEnvironment.match(new RegExp(`^      ${name}: (.+)$`, "mu"));
      assert.ok(entry, `${name} must reach the production job`);
      const expression = entry[1].match(/^\$\{\{ vars\.([A-Z_]+)(?: \|\| '([^']*)')? \}\}$/u);
      assert.ok(expression, `${name} uses only a protected public variable and literal default`);
      assert.equal(expression[1], name, "Server Auth bindings cannot select browser values");
      return [name, variables[name] || expression[2] || ""];
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

test("workflow reads browser Auth inputs only inside the protected production build job", () => {
  assert.match(buildJob, /environment:\n      name: production/u);
  assert.deepEqual(
    selectedBrowserInputs({
      VITE_KOVA_AUTH_MODE: "dual",
      VITE_KOVA_GOOGLE_AUTH_ENABLED: "true",
      VITE_KOVA_AUTH_ORIGIN: "https://auth.example.invalid",
    }),
    {
      VITE_KOVA_AUTH_MODE: "dual",
      VITE_KOVA_GOOGLE_AUTH_ENABLED: "true",
      VITE_KOVA_AUTH_ORIGIN: "https://auth.example.invalid",
    },
  );
  assert.doesNotMatch(workflow.split("  build-only:\n")[0], /vars\.VITE_KOVA_/u);
});

test("missing or unset protected vars retain hosted Auth, Google-off and same-origin", () => {
  for (const inputMode of ["plan", "narrow-openai"])
    for (const variables of [{}, Object.fromEntries(names.map((name) => [name, ""]))])
      assert.deepEqual(forwarded(inputMode, variables).browser, {
        VITE_KOVA_AUTH_MODE: "supabase",
        VITE_KOVA_GOOGLE_AUTH_ENABLED: "false",
        VITE_KOVA_AUTH_ORIGIN: "",
      });
});

test("each explicit protected browser choice reaches the real commit-pinned build request", () => {
  for (const inputMode of ["plan", "narrow-openai"])
    for (const mode of ["supabase", "dual", "kova"])
      for (const google of ["false", "true"])
        for (const origin of ["", "https://auth.example.invalid"]) {
          const values = {
            VITE_KOVA_AUTH_MODE: mode,
            VITE_KOVA_GOOGLE_AUTH_ENABLED: google,
            VITE_KOVA_AUTH_ORIGIN: origin,
          };
          const { browser, request } = forwarded(inputMode, values);
          assert.deepEqual(browser, values);
          assert.equal(
            request.sourceLocation,
            `https://github.com/Blockigaming/KovaGPT.git#${sourceSha}`,
          );
          assert.ok(request.arguments.every(({ isSecret }) => isSecret === false));
        }
});

test("server Auth bindings never override missing or explicitly selected browser values", () => {
  const server = {
    KOVA_AUTH_MODE: "kova",
    KOVA_AUTH_ORIGIN: "https://server-auth.example.invalid",
    KOVA_GOOGLE_AUTH_ENABLED: "true",
  };
  for (const inputMode of ["plan", "narrow-openai"])
    for (const variables of [{}, { VITE_KOVA_AUTH_MODE: "dual" }])
      assert.deepEqual(
        forwarded(inputMode, variables, server).browser,
        forwarded(inputMode, variables).browser,
      );
});

test("invalid protected browser values still fail before a build request can be made", () => {
  for (const inputMode of ["plan", "narrow-openai"])
    for (const variables of [
      { VITE_KOVA_AUTH_MODE: "auto" },
      { VITE_KOVA_AUTH_MODE: "dual " },
      { VITE_KOVA_GOOGLE_AUTH_ENABLED: "1" },
      { VITE_KOVA_AUTH_ORIGIN: "http://auth.example.invalid" },
      { VITE_KOVA_AUTH_ORIGIN: "https://user:password@auth.example.invalid" },
      { VITE_KOVA_AUTH_ORIGIN: "https://auth.example.invalid/path" },
    ])
      assert.throws(
        () => forwarded(inputMode, variables),
        /production_candidate_browser_(?:auth_mode|google_auth|auth_origin)_invalid/u,
      );
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
