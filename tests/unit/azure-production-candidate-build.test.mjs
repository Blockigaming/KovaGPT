import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
  buildProductionCandidate,
  productionCandidateBuildArgs,
  productionCandidateConfig,
  productionCandidateDigest,
} from "../../scripts/azure/build-production-candidate.mjs";
import { verifyBrowserConfig } from "../../scripts/azure/verify-browser-config.mjs";

const sourceSha = "a".repeat(40);
const sourceTree = "b".repeat(40);
const digest = `sha256:${"c".repeat(64)}`;
const projectRef = "mfbycmbjygcfkrsuepxf";
const loginServer = "kovagptacr-dte9hugbhjghcyb8.azurecr.io";
const browserKey = `sb_publishable_${"x".repeat(20)}`;
const stripeKey = `pk_live_${"y".repeat(20)}`;
const imageReference = `${loginServer}/kovagpt-web@${digest}`;
const params = {
  acrName: { value: "kovagptacr" },
  supabaseUrl: { value: `https://${projectRef}.supabase.co` },
  supabasePublishableKey: { value: browserKey },
  supabaseServiceRoleSecretUri: { value: "SERVER_REFERENCE_MUST_NOT_ENTER_BUILD" },
};
function environment(overrides = {}) {
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
    KOVA_PRODUCTION_ACR_LOGIN_SERVER: loginServer,
    KOVA_PRODUCTION_IMAGE_REPOSITORY: "kovagpt-web",
    KOVA_PRODUCTION_SUPABASE_PROJECT_REF: projectRef,
    KOVA_PRODUCTION_STRIPE_PUBLISHABLE_KEY: stripeKey,
    KOVA_PRODUCTION_BICEP_PARAMETERS_JSON: JSON.stringify({ parameters: params }),
    ...overrides,
  };
}
function buildRun(config) {
  return {
    runId: "ca123",
    status: "Succeeded",
    outputImages: [{ registry: loginServer, repository: "kovagpt-web", tag: config.tag, digest }],
  };
}

test("only the explicit production browser argument allowlist reaches a commit-pinned ACR build", () => {
  const config = productionCandidateConfig(environment());
  const args = productionCandidateBuildArgs(config, sourceTree, false);
  assert.equal(args.at(-1), `https://github.com/Blockigaming/KovaGPT.git#${sourceSha}`);
  assert.match(config.tag, /^production-candidate-[a-f0-9]{40}-12345-1$/u);
  assert.deepEqual(args.filter((_, index) => args[index - 1] === "--build-arg").map((arg) => arg.split("=")[0]), [
    "KOVA_SOURCE_SHA", "KOVA_SOURCE_TREE", "KOVA_EXPECTED_SUPABASE_PROJECT_REF",
    "KOVA_VERIFY_BROWSER_CONFIG", "VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY",
    "VITE_PAYMENTS_CLIENT_TOKEN",
  ]);
  assert.ok(args.includes("KOVA_VERIFY_BROWSER_CONFIG=true"));
  assert.ok(args.includes("linux/amd64"));
  assert.ok(args.includes("--no-logs"));
  assert.ok(args.includes("1800"));
  assert.doesNotMatch(args.join(" "), /SERVER_REFERENCE|BICEP_PARAMETERS|:latest|containerapp|--no-wait/u);
  const abac = productionCandidateBuildArgs(config, sourceTree, true);
  assert.equal(abac[abac.indexOf("--source-acr-auth-id") + 1], "[caller]");
});

for (const [name, overrides] of [
  ["pull request", { GITHUB_EVENT_NAME: "pull_request" }],
  ["non-main branch", { GITHUB_REF: "refs/heads/dev" }],
  ["foreign repository", { GITHUB_REPOSITORY: "other/KovaGPT" }],
  ["missing consent", { KOVA_BUILD_CONFIRMATION: "PLAN" }],
  ["stale approved SHA", { KOVA_APPROVED_SOURCE_SHA: "d".repeat(40) }],
  ["mutable source", { GITHUB_SHA: "main", KOVA_APPROVED_SOURCE_SHA: "main" }],
  ["dev registry", { KOVA_PRODUCTION_ACR_NAME: "otheracr" }],
  ["guessed registry DNS", { KOVA_PRODUCTION_ACR_LOGIN_SERVER: "kovagptacr.azurecr.io" }],
  ["dev image repository", { KOVA_PRODUCTION_IMAGE_REPOSITORY: "kovagpt-dev" }],
  ["dev project", { KOVA_PRODUCTION_SUPABASE_PROJECT_REF: "z".repeat(20) }],
  ["sandbox Stripe key", { KOVA_PRODUCTION_STRIPE_PUBLISHABLE_KEY: `pk_test_${"x".repeat(20)}` }],
  ["unsafe run identity", { GITHUB_RUN_ID: "1\ncommand" }],
  ["missing protected parameters", { KOVA_PRODUCTION_BICEP_PARAMETERS_JSON: "" }],
]) {
  test(`refuses ${name} before any cloud build`, () => {
    assert.throws(() => productionCandidateConfig(environment(overrides)), /production_candidate_/u);
  });
}
for (const [name, change] of [
  ["wrong browser URL", { supabaseUrl: { value: `https://${"z".repeat(20)}.supabase.co` } }],
  ["server secret instead of browser key", { supabasePublishableKey: { value: `sb_secret_${"z".repeat(20)}` } }],
  ["mismatched PLAN registry", { acrName: { value: "wrongregistry" } }],
]) {
  test(`rejects protected parameters with ${name}`, () => {
    const env = environment({ KOVA_PRODUCTION_BICEP_PARAMETERS_JSON: JSON.stringify({ parameters: { ...params, ...change } }) });
    assert.throws(() => productionCandidateConfig(env), /production_candidate_/u);
  });
}
test("an explicitly empty Stripe browser key remains supported without enabling billing", () => {
  assert.equal(productionCandidateConfig(environment({ KOVA_PRODUCTION_STRIPE_PUBLISHABLE_KEY: "" })).stripeKey, "");
});
test("uses only one successful build output digest; rejects output confusion", () => {
  const config = productionCandidateConfig(environment());
  assert.equal(productionCandidateDigest(buildRun(config), config), digest);
  assert.equal(productionCandidateDigest({ ...buildRun(config), runId: "0accec26-d6de-4757-8e74-d080f38eaaab" }, config), digest);
  for (const run of [
    { ...buildRun(config), status: "Running" },
    { ...buildRun(config), runId: "" },
    { ...buildRun(config), runId: "abc\ncommand" },
    { ...buildRun(config), outputImages: [null] },
    { ...buildRun(config), outputImages: [] },
    { ...buildRun(config), outputImages: [buildRun(config).outputImages[0], buildRun(config).outputImages[0]] },
    ...["registry", "repository", "tag", "digest"].map((field) => ({
      ...buildRun(config), outputImages: [{ ...buildRun(config).outputImages[0], [field]: "wrong" }],
    })),
  ]) assert.throws(() => productionCandidateDigest(run, config), /production_candidate_/u);
});

function harness(t, options = {}) {
  const directory = mkdtempSync(resolve(tmpdir(), "kova-build-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = `${directory}/repo`;
  const output = options.internalOutput ? `${root}/evidence` : `${directory}/evidence`;
  mkdirSync(root);
  const env = environment({ KOVA_PRODUCTION_CANDIDATE_OUTPUT_DIR: output });
  const config = productionCandidateConfig(env);
  const calls = [];
  const run = (program, args) => {
    calls.push([program, ...args]);
    const command = args.slice(0, 3).join(" ");
    if (program === "git") {
      if (args[0] === "status") return options.dirty ? " M Dockerfile" : "";
      if (args[0] === "ls-remote") return `${options.mainMoved ? "d".repeat(40) : sourceSha}\trefs/heads/main`;
      return { HEAD: sourceSha, "HEAD^{tree}": sourceTree, "--show-toplevel": root }[args[1]];
    }
    if (program === "az") {
      if (command === "acr show --name") return JSON.stringify({ loginServer: options.wrongRegistry ? "wrong.azurecr.io" : loginServer, roleAssignmentMode: "LegacyRegistryPermissions" });
      if (command === "acr repository show-tags") {
        if (options.tagLookupFailed) throw new Error("simulated_authorization_failure");
        return options.tagExists ? JSON.stringify([config.tag]) : "[]";
      }
      if (args[1] === "build") return JSON.stringify(buildRun(config));
      if (command === "acr repository show") return options.digestMismatch ? `sha256:${"d".repeat(64)}` : digest;
      if (args[1] === "login") return "";
    }
    if (program === "docker") {
      if (args[0] === "pull" || args[0] === "rm") return "";
      if (args[0] === "create") return "f".repeat(64);
      if (args[0] === "image") return JSON.stringify({
        Os: "linux", Architecture: "amd64", Labels: {
          "org.opencontainers.image.revision": options.wrongLabel ? "d".repeat(40) : sourceSha,
          "com.kovagpt.source.tree": sourceTree,
          "com.kovagpt.browser.supabase-project-ref": projectRef,
          "com.kovagpt.browser.config-verified": "true",
          "com.kovagpt.browser.config-provenance": "/app/dist/browser-config-provenance.json",
        },
      });
      if (args[0] === "cp") {
        const target = args[2];
        if (target.endsWith("/built.json")) {
          const parent = resolve(target, "..");
          const bundle = `${parent}/expected-client`;
          mkdirSync(bundle);
          writeFileSync(`${bundle}/index.js`, `window.config=["https://${projectRef}.supabase.co","${browserKey}","${stripeKey}"];`);
          writeFileSync(`${parent}/expected-source.json`, JSON.stringify({ schemaVersion: 1, context: "acr-git", sourceSha, sourceTree }));
          const { provenance } = verifyBrowserConfig({
            bundleDir: bundle, supabaseUrl: params.supabaseUrl.value,
            publishableKey: browserKey, stripePublishableKey: stripeKey,
            sourceSha, sourceTree, expectedProjectRef: projectRef,
            sourceAttestationPath: `${parent}/expected-source.json`,
            provenancePath: `${parent}/verified.json`, writeProvenance: false,
          });
          if (options.wrongProvenance) provenance.sourceContext = "git-archive";
          writeFileSync(target, JSON.stringify(provenance));
        } else {
          mkdirSync(target);
          const original = readFileSync(`${resolve(target, "..")}/expected-client/index.js`, "utf8");
          writeFileSync(`${target}/index.js`, `${original}${options.contaminatedBundle ? `\n"https://${"z".repeat(20)}.supabase.co"` : ""}`);
        }
        return "";
      }
    }
    throw new Error(`unexpected_mock_command:${program}:${args.join(" ")}`);
  };
  return { run, calls, env, output };
}

test("build-only orchestration verifies pulled bytes and emits key-free PLAN evidence", (t) => {
  const { env, run, calls, output } = harness(t);
  const report = buildProductionCandidate(env, run);
  assert.equal(report.imageReference, imageReference);
  assert.equal(report.sourceSha, sourceSha);
  assert.equal(report.sourceTree, sourceTree);
  assert.equal(report.sourceContext, "acr-git");
  assert.equal(report.deployed, false);
  assert.equal(report.databaseMutated, false);
  assert.equal(report.containerAppUpdated, false);
  assert.equal(report.trafficShifted, false);
  const artifact = readFileSync(`${output}/candidate.json`, "utf8") + readFileSync(`${output}/browser-config-provenance.json`, "utf8");
  assert.doesNotMatch(artifact, /sb_publishable_|pk_live_|SERVER_REFERENCE/u);
  assert.equal(readFileSync(`${output}/image-reference.txt`, "utf8"), `${imageReference}\n`);
  assert.equal(calls.filter(([program, , sub]) => program === "az" && sub === "build").length, 1);
  assert.ok(calls.some(([program, sub]) => program === "docker" && sub === "rm"));
  for (const call of calls) {
    assert.doesNotMatch(call.join(" "), /containerapp|deployment|traffic|supabase db|keyvault|role assignment|docker (?:run|start)/u);
  }
});
for (const [name, options, code] of [
  ["main moved", { mainMoved: true }, /main_moved/u],
  ["dirty checkout", { dirty: true }, /dirty_source/u],
  ["internal output path", { internalOutput: true }, /output_must_be_external/u],
  ["wrong live registry", { wrongRegistry: true }, /live_registry_mismatch/u],
  ["existing candidate tag", { tagExists: true }, /tag_already_exists/u],
  ["tag-read authorization failure", { tagLookupFailed: true }, /simulated_authorization_failure/u],
]) {
  test(`no build is queued when ${name}`, (t) => {
    const { env, run, calls, output } = harness(t, options);
    assert.throws(() => buildProductionCandidate(env, run), code);
    assert.ok(!calls.some(([program, , sub]) => program === "az" && sub === "build"));
    assert.equal(existsSync(`${output}/candidate.json`), false);
  });
}
for (const [name, options, code] of [
  ["registry digest differs", { digestMismatch: true }, /registry_digest_mismatch/u],
  ["image label differs", { wrongLabel: true }, /labels_mismatch/u],
  ["provenance context differs", { wrongProvenance: true }, /browser_provenance_mismatch/u],
  ["pulled bundle contains another project", { contaminatedBundle: true }, /Supabase project/u],
]) {
  test(`never certifies a candidate when ${name}`, (t) => {
    const { env, run, output } = harness(t, options);
    assert.throws(() => buildProductionCandidate(env, run), code);
    assert.equal(existsSync(`${output}/candidate.json`), false);
  });
}

test("production writes are isolated from PR validation and never dispatch PLAN or deployment", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/build-azure-production-candidate.yml", import.meta.url), "utf8");
  const tests = workflow.slice(workflow.indexOf("  source-tests:"), workflow.indexOf("  build-only:"));
  assert.doesNotMatch(tests, /id-token|environment:|secrets\.|--execute|azure\/login/u);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /inputs\.confirmation == 'BUILD_ONLY' && inputs\.source_sha == github\.sha/u);
  assert.match(workflow, /needs: source-tests/u);
  assert.doesNotMatch(workflow, /az containerapp|az deployment|wrangler|workflow_run:|KOVA_DEV_|gh workflow run/u);
  assert.equal((workflow.match(/--execute/g) ?? []).length, 1);
  assert.equal((workflow.match(/id-token: write/g) ?? []).length, 1);
  assert.match(workflow, /name: production\n/u);
});

test("existing PLAN and Dockerfile require the same provenance context and labels", () => {
  const plan = readFileSync(new URL("../../.github/workflows/validate-azure-production.yml", import.meta.url), "utf8");
  const dockerfile = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");
  assert.match(plan, /value\.schemaVersion !== 3/u);
  assert.match(plan, /value\.sourceContext !== "acr-git"/u);
  assert.match(dockerfile, /context:'acr-git'/u);
  for (const label of ["org.opencontainers.image.revision", "com.kovagpt.source.tree", "com.kovagpt.browser.supabase-project-ref", "com.kovagpt.browser.config-verified"]) {
    assert.ok(plan.includes(label));
    assert.ok(dockerfile.includes(label));
  }
  for (const setting of ["KOVA_PRODUCTION_ACR_NAME", "KOVA_PRODUCTION_ACR_LOGIN_SERVER", "KOVA_PRODUCTION_IMAGE_REPOSITORY", "KOVA_PRODUCTION_SUPABASE_PROJECT_REF", "KOVA_PRODUCTION_STRIPE_PUBLISHABLE_KEY", "KOVA_PRODUCTION_BICEP_PARAMETERS_JSON"]) {
    assert.ok(plan.includes(setting));
  }
});
