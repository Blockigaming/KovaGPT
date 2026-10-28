import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
  buildProductionCandidate,
  createProductionCandidateCommand,
  diagnoseProductionCandidateAccess,
  PRODUCTION_BUILD_TIMEOUT_SECONDS,
  PRODUCTION_CLIENT_BUDGET_MS,
  productionCandidateBuildRequest,
  productionCandidateConfig,
  productionCandidateDigest,
} from "../../scripts/azure/build-production-candidate.mjs";
import { verifyBrowserConfig } from "../../scripts/azure/verify-browser-config.mjs";
import { ACR_RESOURCE_ID } from "../../scripts/azure/acr-pinned-quick-build.mjs";

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
    agentCpu: 2,
    outputImages: [{ registry: loginServer, repository: "kovagpt-web", tag: config.tag, digest }],
  };
}

test("only the explicit production browser argument allowlist reaches a commit-pinned ACR build", () => {
  const config = productionCandidateConfig(environment());
  const request = productionCandidateBuildRequest(config, sourceTree, false);
  assert.equal(request.sourceLocation, `https://github.com/Blockigaming/KovaGPT.git#${sourceSha}`);
  assert.match(config.tag, /^production-candidate-[a-f0-9]{40}-12345-1$/u);
  assert.deepEqual(
    request.arguments.map((argument) => argument.name),
    [
      "KOVA_SOURCE_SHA",
      "KOVA_SOURCE_TREE",
      "KOVA_EXPECTED_SUPABASE_PROJECT_REF",
      "KOVA_VERIFY_BROWSER_CONFIG",
      "VITE_SUPABASE_URL",
      "VITE_SUPABASE_PUBLISHABLE_KEY",
      "VITE_KOVA_AUTH_MODE",
      "VITE_KOVA_GOOGLE_AUTH_ENABLED",
      "VITE_KOVA_AUTH_ORIGIN",
      "VITE_PAYMENTS_CLIENT_TOKEN",
    ],
  );
  assert.equal(
    request.arguments.find((argument) => argument.name === "KOVA_VERIFY_BROWSER_CONFIG").value,
    "true",
  );
  assert.ok(request.arguments.every((argument) => argument.isSecret === false));
  assert.deepEqual(request.platform, { os: "Linux", architecture: "amd64" });
  assert.deepEqual(request.agentConfiguration, { cpu: 2 });
  assert.equal(request.timeout, 1200);
  assert.equal(PRODUCTION_BUILD_TIMEOUT_SECONDS, 1200);
  assert.doesNotMatch(
    JSON.stringify(request),
    /SERVER_REFERENCE|BICEP_PARAMETERS|:latest|containerapp|--no-wait/u,
  );
  const abac = productionCandidateBuildRequest(config, sourceTree, true);
  assert.deepEqual(abac.credentials, { sourceRegistry: { identity: "[caller]" } });
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
    assert.throws(
      () => productionCandidateConfig(environment(overrides)),
      /production_candidate_/u,
    );
  });
}
for (const [name, change] of [
  ["wrong browser URL", { supabaseUrl: { value: `https://${"z".repeat(20)}.supabase.co` } }],
  [
    "server secret instead of browser key",
    { supabasePublishableKey: { value: `sb_secret_${"z".repeat(20)}` } },
  ],
  ["mismatched PLAN registry", { acrName: { value: "wrongregistry" } }],
]) {
  test(`rejects protected parameters with ${name}`, () => {
    const env = environment({
      KOVA_PRODUCTION_BICEP_PARAMETERS_JSON: JSON.stringify({
        parameters: { ...params, ...change },
      }),
    });
    assert.throws(() => productionCandidateConfig(env), /production_candidate_/u);
  });
}
test("an explicitly empty Stripe browser key remains supported without enabling billing", () => {
  assert.equal(
    productionCandidateConfig(environment({ KOVA_PRODUCTION_STRIPE_PUBLISHABLE_KEY: "" }))
      .stripeKey,
    "",
  );
});
test("uses only one successful build output digest; rejects output confusion", () => {
  const config = productionCandidateConfig(environment());
  assert.equal(productionCandidateDigest(buildRun(config), config), digest);
  assert.equal(
    productionCandidateDigest(
      { ...buildRun(config), runId: "0accec26-d6de-4757-8e74-d080f38eaaab" },
      config,
    ),
    digest,
  );
  for (const run of [
    { ...buildRun(config), status: "Running" },
    { ...buildRun(config), runId: "" },
    { ...buildRun(config), runId: "abc\ncommand" },
    { ...buildRun(config), outputImages: [null] },
    { ...buildRun(config), outputImages: [] },
    {
      ...buildRun(config),
      outputImages: [buildRun(config).outputImages[0], buildRun(config).outputImages[0]],
    },
    ...["registry", "repository", "tag", "digest"].map((field) => ({
      ...buildRun(config),
      outputImages: [{ ...buildRun(config).outputImages[0], [field]: "wrong" }],
    })),
  ])
    assert.throws(() => productionCandidateDigest(run, config), /production_candidate_/u);
});

function harness(t, options = {}) {
  const directory = mkdtempSync(resolve(tmpdir(), "kova-build-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = `${directory}/repo`;
  const output = options.internalOutput ? `${root}/evidence` : `${directory}/evidence`;
  mkdirSync(root);
  const env = environment({
    KOVA_PRODUCTION_CANDIDATE_OUTPUT_DIR: output,
    ...options.browserAuthInputs,
  });
  const config = productionCandidateConfig(env);
  const calls = [];
  const run = (program, args, { input } = {}) => {
    calls.push([program, ...args]);
    const command = args.slice(0, 3).join(" ");
    if (program === "git") {
      if (args[0] === "status") return options.dirty ? " M Dockerfile" : "";
      if (args[0] === "ls-remote")
        return `${options.mainMoved ? "d".repeat(40) : sourceSha}\trefs/heads/main`;
      return { HEAD: sourceSha, "HEAD^{tree}": sourceTree, "--show-toplevel": root }[args[1]];
    }
    if (program === "az") {
      if (command === "acr show --name")
        return JSON.stringify({
          id: options.wrongResource
            ? ACR_RESOURCE_ID.replace("rg-kovagpt-dev", "other")
            : ACR_RESOURCE_ID,
          loginServer: options.wrongRegistry ? "wrong.azurecr.io" : loginServer,
          roleAssignmentMode: "LegacyRegistryPermissions",
        });
      if (command === "acr repository show-tags") {
        if (options.tagLookupFailed) throw new Error("simulated_authorization_failure");
        return options.tagExists ? JSON.stringify([config.tag]) : "[]";
      }
      if (command === "account get-access-token --subscription") return "fixtureToken".repeat(5);
      if (command === "acr repository show")
        return options.digestMismatch ? `sha256:${"d".repeat(64)}` : digest;
      if (args[1] === "login") return "";
    }
    if (program === "node") {
      const request = JSON.parse(input);
      assert.equal(request.resourceId, ACR_RESOURCE_ID);
      assert.equal(request.body.agentConfiguration.cpu, 2);
      assert.equal(request.body.timeout, 1200);
      assert.equal(
        request.body.sourceLocation,
        `https://github.com/Blockigaming/KovaGPT.git#${sourceSha}`,
      );
      return JSON.stringify(buildRun(config));
    }
    if (program === "docker") {
      if (args[0] === "pull" || args[0] === "rm") return "";
      if (args[0] === "create") return "f".repeat(64);
      if (args[0] === "image")
        return JSON.stringify({
          Os: "linux",
          Architecture: "amd64",
          Labels: {
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
          writeFileSync(
            `${bundle}/index.js`,
            `window.config=["https://${projectRef}.supabase.co","${browserKey}","${stripeKey}"];const authMode="kova-browser-auth-mode:${options.builtAuthMode ?? config.browserAuthMode}";`,
          );
          writeFileSync(
            `${parent}/expected-source.json`,
            JSON.stringify({ schemaVersion: 1, context: "acr-git", sourceSha, sourceTree }),
          );
          const { provenance } = verifyBrowserConfig({
            bundleDir: bundle,
            supabaseUrl: params.supabaseUrl.value,
            publishableKey: browserKey,
            stripePublishableKey: stripeKey,
            expectedAuthMode: options.builtAuthMode ?? config.browserAuthMode,
            sourceSha,
            sourceTree,
            expectedProjectRef: projectRef,
            sourceAttestationPath: `${parent}/expected-source.json`,
            provenancePath: `${parent}/verified.json`,
            writeProvenance: false,
          });
          if (options.wrongProvenance) provenance.sourceContext = "git-archive";
          writeFileSync(target, JSON.stringify(provenance));
        } else {
          mkdirSync(target);
          const original = readFileSync(
            `${resolve(target, "..")}/expected-client/index.js`,
            "utf8",
          );
          writeFileSync(
            `${target}/index.js`,
            `${original}${options.contaminatedBundle ? `\n"https://${"z".repeat(20)}.supabase.co"` : ""}`,
          );
        }
        return "";
      }
    }
    throw new Error(`unexpected_mock_command:${program}:${args.join(" ")}`);
  };
  run.remainingMs = () => options.remainingMs ?? PRODUCTION_CLIENT_BUDGET_MS;
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
  const artifact =
    readFileSync(`${output}/candidate.json`, "utf8") +
    readFileSync(`${output}/browser-config-provenance.json`, "utf8");
  assert.doesNotMatch(artifact, /sb_publishable_|pk_live_|SERVER_REFERENCE/u);
  assert.equal(readFileSync(`${output}/image-reference.txt`, "utf8"), `${imageReference}\n`);
  assert.equal(calls.filter(([program]) => program === "node").length, 1);
  assert.ok(!calls.some(([program, , sub]) => program === "az" && sub === "build"));
  assert.ok(calls.some(([program, sub]) => program === "docker" && sub === "rm"));
  assert.deepEqual(
    calls.find(
      ([program, command, sub]) => program === "az" && command === "acr" && sub === "login",
    ),
    [
      "az",
      "acr",
      "login",
      "--name",
      "kovagptacr",
      "--resource-group",
      "rg-kovagpt-dev",
      "--only-show-errors",
    ],
  );
  for (const call of calls) {
    assert.doesNotMatch(
      call.join(" "),
      /containerapp|deployment|traffic|supabase db|keyvault|role assignment|docker (?:run|start)/u,
    );
  }
});
for (const [name, options, code] of [
  ["main moved", { mainMoved: true }, /main_moved/u],
  ["dirty checkout", { dirty: true }, /dirty_source/u],
  ["internal output path", { internalOutput: true }, /output_must_be_external/u],
  ["wrong live registry", { wrongRegistry: true }, /live_registry_mismatch/u],
  ["wrong live registry resource", { wrongResource: true }, /registry_resource_mismatch/u],
  [
    "preflight exhausted server and cleanup reserve",
    { remainingMs: 1_319_999 },
    /submission_budget_insufficient/u,
  ],
  ["existing candidate tag", { tagExists: true }, /tag_already_exists/u],
  [
    "tag-read authorization failure",
    { tagLookupFailed: true },
    /access_failed:repository_tags_read/u,
  ],
]) {
  test(`no build is queued when ${name}`, (t) => {
    const { env, run, calls, output } = harness(t, options);
    assert.throws(() => buildProductionCandidate(env, run), code);
    assert.ok(!calls.some(([program]) => program === "node"));
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
  const workflow = readFileSync(
    new URL("../../.github/workflows/build-azure-production-candidate.yml", import.meta.url),
    "utf8",
  );
  const tests = workflow.slice(
    workflow.indexOf("  source-tests:"),
    workflow.indexOf("  build-only:"),
  );
  assert.doesNotMatch(tests, /id-token|environment:|secrets\.|--execute|azure\/login/u);
  assert.match(tests, /timeout-minutes: 5\b/u);
  assert.match(workflow.slice(workflow.indexOf("  build-only:")), /timeout-minutes: 25\b/u);
  assert.match(
    workflow,
    /github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/u,
  );
  assert.match(
    workflow,
    /inputs\.source_sha == github\.sha && \(\(inputs\.operation == 'build' && inputs\.confirmation == 'BUILD_ONLY'\) \|\| \(inputs\.operation == 'diagnose-access' && inputs\.confirmation == 'READ_ONLY'\)\)/u,
  );
  assert.match(workflow, /needs: source-tests/u);
  assert.doesNotMatch(
    workflow,
    /az containerapp|az deployment|wrangler|workflow_run:|KOVA_DEV_|gh workflow run/u,
  );
  assert.equal((workflow.match(/--execute/g) ?? []).length, 1);
  assert.equal((workflow.match(/id-token: write/g) ?? []).length, 1);
  assert.match(workflow, /name: production\n/u);
});

test("all commands share one twenty-five-minute client budget without a retry", () => {
  let clock = 0;
  const calls = [];
  const run = createProductionCandidateCommand({
    now: () => clock,
    spawn: (program, args, options) => {
      calls.push({ program, args, timeout: options.timeout, killSignal: options.killSignal });
      clock += 60_000;
      return { status: 0, stdout: " fixture\n" };
    },
  });
  assert.equal(PRODUCTION_CLIENT_BUDGET_MS, 1_500_000);
  assert.equal(run("git", ["rev-parse", "HEAD"]), "fixture");
  assert.equal(run("az", ["acr", "build"]), "fixture");
  assert.deepEqual(
    calls.map((call) => call.timeout),
    [1_500_000, 1_440_000],
  );
  assert.ok(calls.every((call) => call.killSignal === "SIGKILL"));
  clock = PRODUCTION_CLIENT_BUDGET_MS;
  assert.throws(() => run("az", ["acr", "build"]), /client_deadline_exceeded/u);
  assert.equal(calls.length, 2);
});

test("a timed-out command or late successful result cannot certify or retry the operation", () => {
  for (const lateSuccess of [false, true]) {
    let clock = 0;
    let calls = 0;
    const run = createProductionCandidateCommand({
      now: () => clock,
      spawn: () => {
        calls++;
        clock = PRODUCTION_CLIENT_BUDGET_MS;
        return lateSuccess
          ? { status: 0, stdout: "private provider fixture" }
          : {
              status: null,
              error: { code: "ETIMEDOUT", message: "private credential fixture" },
              stderr: "private provider fixture",
            };
      },
    });
    assert.throws(
      () => run("az", ["acr", "build"]),
      (error) => {
        assert.equal(error.message, "production_candidate_client_deadline_exceeded");
        return true;
      },
    );
    assert.equal(calls, 1);
    assert.throws(() => run("az", ["acr", "build"]), /client_deadline_exceeded/u);
    assert.equal(calls, 1);
  }
});

test("workflow setup elapsed time reduces the same command budget", () => {
  let recorded;
  const run = createProductionCandidateCommand({
    now: () => 0,
    wallNow: () => 100_000,
    workflowDeadlineMs: 1_400_000,
    spawn: (_program, _args, options) => {
      recorded = options.timeout;
      return { status: 0, stdout: "" };
    },
  });
  run("fixture", []);
  assert.equal(recorded, 1_300_000);
  assert.equal(run.remainingMs(), 1_300_000);
});

test("existing PLAN and Dockerfile require the same provenance context and labels", () => {
  const plan = readFileSync(
    new URL("../../.github/workflows/validate-azure-production.yml", import.meta.url),
    "utf8",
  );
  const dockerfile = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");
  assert.match(plan, /value\.schemaVersion !== 3/u);
  assert.match(plan, /value\.sourceContext !== "acr-git"/u);
  assert.match(dockerfile, /context:'acr-git'/u);
  for (const label of [
    "org.opencontainers.image.revision",
    "com.kovagpt.source.tree",
    "com.kovagpt.browser.supabase-project-ref",
    "com.kovagpt.browser.config-verified",
  ]) {
    assert.ok(plan.includes(label));
    assert.ok(dockerfile.includes(label));
  }
  for (const setting of [
    "KOVA_PRODUCTION_ACR_NAME",
    "KOVA_PRODUCTION_ACR_LOGIN_SERVER",
    "KOVA_PRODUCTION_IMAGE_REPOSITORY",
    "KOVA_PRODUCTION_SUPABASE_PROJECT_REF",
    "KOVA_PRODUCTION_STRIPE_PUBLISHABLE_KEY",
    "KOVA_PRODUCTION_BICEP_PARAMETERS_JSON",
  ]) {
    assert.ok(plan.includes(setting));
  }
});

function narrowEnvironment(overrides = {}) {
  return environment({
    KOVA_PRODUCTION_BROWSER_INPUT_MODE: "narrow-openai",
    KOVA_PRODUCTION_SUPABASE_URL: params.supabaseUrl.value,
    KOVA_PRODUCTION_SUPABASE_PUBLISHABLE_KEY: browserKey,
    KOVA_PRODUCTION_BICEP_PARAMETERS_JSON: undefined,
    ...overrides,
  });
}

test("browser mode: default and explicit PLAN inputs retain the original behavior", () => {
  const original = productionCandidateConfig(environment());
  assert.deepEqual(
    productionCandidateConfig(environment({ KOVA_PRODUCTION_BROWSER_INPUT_MODE: "plan" })),
    original,
  );
  assert.equal(
    productionCandidateConfig(
      environment({
        KOVA_PRODUCTION_BROWSER_INPUT_MODE: "plan",
        KOVA_PRODUCTION_STRIPE_PUBLISHABLE_KEY: "",
      }),
    ).stripeKey,
    "",
  );
  assert.throws(
    () => productionCandidateConfig(environment({ KOVA_PRODUCTION_BICEP_PARAMETERS_JSON: "" })),
    /production_candidate_json_invalid/u,
  );
});

test("browser Auth defaults stay Supabase, Google-off and same-origin regardless of server bindings", () => {
  const config = productionCandidateConfig(
    environment({
      KOVA_AUTH_MODE: "kova",
      KOVA_AUTH_ORIGIN: "https://server-auth.example.invalid",
      KOVA_GOOGLE_AUTH_ENABLED: "true",
    }),
  );
  assert.equal(config.browserAuthMode, "supabase");
  assert.equal(config.browserGoogleAuthEnabled, "false");
  assert.equal(config.browserAuthOrigin, "");
});

test("explicit browser Auth inputs reach the pinned build in both protected input modes", () => {
  for (const inputMode of ["plan", "narrow-openai"]) {
    for (const mode of ["supabase", "dual", "kova"]) {
      const inputs = {
        VITE_KOVA_AUTH_MODE: mode,
        VITE_KOVA_GOOGLE_AUTH_ENABLED: "true",
        VITE_KOVA_AUTH_ORIGIN: "https://auth.example.invalid",
      };
      const env = inputMode === "plan" ? environment(inputs) : narrowEnvironment(inputs);
      const config = productionCandidateConfig(env);
      const request = productionCandidateBuildRequest(config, sourceTree, false);
      const forwarded = Object.fromEntries(
        request.arguments.map(({ name, value }) => [name, value]),
      );
      for (const [name, value] of Object.entries(inputs)) assert.equal(forwarded[name], value);
      assert.equal(
        request.sourceLocation,
        `https://github.com/Blockigaming/KovaGPT.git#${sourceSha}`,
      );
      assert.ok(request.arguments.every(({ isSecret }) => isSecret === false));
    }
  }
});

test("invalid browser Auth inputs fail before any external command", () => {
  for (const inputs of [
    { VITE_KOVA_AUTH_MODE: "" },
    { VITE_KOVA_AUTH_MODE: "KOVA" },
    { VITE_KOVA_AUTH_MODE: "dual " },
    { VITE_KOVA_AUTH_MODE: null },
    { VITE_KOVA_GOOGLE_AUTH_ENABLED: true },
    { VITE_KOVA_GOOGLE_AUTH_ENABLED: "1" },
    { VITE_KOVA_GOOGLE_AUTH_ENABLED: "true\n" },
    { VITE_KOVA_AUTH_ORIGIN: null },
    { VITE_KOVA_AUTH_ORIGIN: "http://auth.example.invalid" },
    { VITE_KOVA_AUTH_ORIGIN: "https://user:password@auth.example.invalid" },
    { VITE_KOVA_AUTH_ORIGIN: "https://auth.example.invalid/" },
    { VITE_KOVA_AUTH_ORIGIN: "https://auth.example.invalid/path" },
    { VITE_KOVA_AUTH_ORIGIN: "https://auth.example.invalid?mode=kova" },
    { VITE_KOVA_AUTH_ORIGIN: "https://auth.example.invalid#token" },
    { VITE_KOVA_AUTH_ORIGIN: " https://auth.example.invalid" },
  ]) {
    assert.throws(
      () => buildProductionCandidate(environment(inputs), () => assert.fail("No command may run")),
      /production_candidate_browser_(?:auth_mode|google_auth|auth_origin)_invalid/u,
    );
  }
  const config = productionCandidateConfig(environment());
  assert.throws(
    () =>
      productionCandidateBuildRequest({ ...config, browserAuthMode: "auto" }, sourceTree, false),
    /production_candidate_browser_auth_mode_invalid/u,
  );
});

test("pulled browser bytes are verified against the explicitly selected owned Auth mode", (t) => {
  const { env, run, output } = harness(t, {
    browserAuthInputs: {
      VITE_KOVA_AUTH_MODE: "kova",
      VITE_KOVA_GOOGLE_AUTH_ENABLED: "true",
      VITE_KOVA_AUTH_ORIGIN: "https://auth.example.invalid",
    },
  });
  const report = buildProductionCandidate(env, run);
  assert.equal(report.browserAuthMode, "kova");
  assert.equal(report.requestedBrowserGoogleAuthEnabled, "true");
  assert.equal(report.requestedBrowserAuthOrigin, "https://auth.example.invalid");
  assert.equal(
    JSON.parse(readFileSync(`${output}/browser-config-provenance.json`, "utf8")).authMode,
    "kova",
  );
});

test("a pulled image with another Auth mode is not certified", (t) => {
  const { env, run, output } = harness(t, {
    browserAuthInputs: { VITE_KOVA_AUTH_MODE: "kova" },
    builtAuthMode: "supabase",
  });
  assert.throws(
    () => buildProductionCandidate(env, run),
    /intended Kova authentication mode|Unexpected or mixed Kova authentication modes/u,
  );
  assert.equal(existsSync(`${output}/candidate.json`), false);
});

test("Docker accepts each forwarded public Auth input with unchanged defaults", () => {
  const docker = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");
  assert.match(docker, /^ARG VITE_KOVA_AUTH_MODE=supabase$/mu);
  assert.match(docker, /^ARG VITE_KOVA_GOOGLE_AUTH_ENABLED=false$/mu);
  assert.match(docker, /^ARG VITE_KOVA_AUTH_ORIGIN=$/mu);
});

test("browser mode: explicit narrow input never accesses the full PLAN secret", () => {
  const env = narrowEnvironment();
  Object.defineProperty(env, "KOVA_PRODUCTION_BICEP_PARAMETERS_JSON", {
    get() {
      assert.fail("Narrow mode must not read the PLAN document");
    },
  });
  const config = productionCandidateConfig(env);
  assert.deepEqual(config, productionCandidateConfig(environment()));
  const request = productionCandidateBuildRequest(config, sourceTree, false);
  assert.deepEqual(
    request.arguments
      .filter((argument) => argument.name.startsWith("VITE_"))
      .map(({ name, value }) => [name, value]),
    [
      ["VITE_SUPABASE_URL", params.supabaseUrl.value],
      ["VITE_SUPABASE_PUBLISHABLE_KEY", browserKey],
      ["VITE_KOVA_AUTH_MODE", "supabase"],
      ["VITE_KOVA_GOOGLE_AUTH_ENABLED", "false"],
      ["VITE_KOVA_AUTH_ORIGIN", ""],
      ["VITE_PAYMENTS_CLIENT_TOKEN", stripeKey],
    ],
  );
  assert.equal(request.agentConfiguration.cpu, 2);
  assert.equal(request.timeout, 1200);
});

test("browser mode: narrow missing values cannot fall back to a complete PLAN document", () => {
  for (const [field, code] of [
    ["KOVA_PRODUCTION_SUPABASE_URL", "supabase_url_invalid"],
    ["KOVA_PRODUCTION_SUPABASE_PUBLISHABLE_KEY", "supabase_publishable_key_invalid"],
    ["KOVA_PRODUCTION_STRIPE_PUBLISHABLE_KEY", "stripe_publishable_key_invalid"],
  ]) {
    const env = narrowEnvironment({
      KOVA_PRODUCTION_BICEP_PARAMETERS_JSON: environment().KOVA_PRODUCTION_BICEP_PARAMETERS_JSON,
      [field]: "",
    });
    assert.throws(() => productionCandidateConfig(env), {
      message: `narrow_openai_browser_inputs_${code}`,
    });
  }
});

test("browser mode: unknown selections fail before any external command", () => {
  for (const mode of ["", "auto", "NARROW-OPENAI", "narrow-openai ", 7]) {
    assert.throws(
      () =>
        buildProductionCandidate(environment({ KOVA_PRODUCTION_BROWSER_INPUT_MODE: mode }), () =>
          assert.fail("Invalid mode must not execute a command"),
        ),
      { message: "production_candidate_browser_input_mode_invalid" },
    );
  }
});

test("browser mode: narrow mode preserves the protected target and owner-approval gates", () => {
  for (const change of [
    { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_REF: "refs/heads/dev" },
    { KOVA_BUILD_CONFIRMATION: "PLAN" },
    { KOVA_APPROVED_SOURCE_SHA: "d".repeat(40) },
    { KOVA_PRODUCTION_SUPABASE_PROJECT_REF: "z".repeat(20) },
    { KOVA_PRODUCTION_ACR_NAME: "wrongregistry" },
  ]) {
    assert.throws(
      () =>
        buildProductionCandidate(narrowEnvironment(change), () =>
          assert.fail("Invalid approval or target must not execute a command"),
        ),
      /production_candidate_/u,
    );
  }
});

test("browser mode: workflow opts in explicitly and excludes the PLAN secret from narrow inputs", () => {
  const workflow = readFileSync(
    new URL("../../.github/workflows/build-azure-production-candidate.yml", import.meta.url),
    "utf8",
  );
  assert.match(
    workflow,
    /browser_input_mode:[\s\S]*?type: choice\n\s+default: plan\n\s+options:\n\s+- plan\n\s+- narrow-openai/u,
  );
  assert.ok(
    workflow.includes("KOVA_PRODUCTION_BROWSER_INPUT_MODE: ${{ inputs.browser_input_mode }}"),
  );
  for (const name of ["KOVA_PRODUCTION_SUPABASE_URL", "KOVA_PRODUCTION_SUPABASE_PUBLISHABLE_KEY"])
    assert.ok(workflow.includes(`${name}: \${{ vars.${name} }}`));
  const planBindings = [...workflow.matchAll(/KOVA_PRODUCTION_BICEP_PARAMETERS_JSON: ([^\n]+)/gu)];
  assert.equal(planBindings.length, 2);
  for (const [, binding] of planBindings)
    assert.equal(
      binding,
      "${{ inputs.operation == 'build' && inputs.browser_input_mode != 'narrow-openai' && secrets.KOVA_PRODUCTION_BICEP_PARAMETERS_JSON || '' }}",
    );
  const tests = workflow.slice(
    workflow.indexOf("  source-tests:"),
    workflow.indexOf("  build-only:"),
  );
  assert.match(tests, /timeout-minutes: 5\b/u);
  assert.doesNotMatch(tests, /id-token|environment:|secrets\.|--execute|azure\/login/u);
  for (const path of [
    "scripts/azure/narrow-openai-browser-inputs.mjs",
    "tests/unit/azure-narrow-openai-browser-inputs.test.mjs",
  ])
    assert.equal(workflow.split(path).length - 1, path.startsWith("tests/") ? 4 : 3);
});

function diagnosticEnvironment(overrides = {}) {
  return environment({
    KOVA_PRODUCTION_OPERATION: "diagnose-access",
    KOVA_BUILD_CONFIRMATION: "READ_ONLY",
    ...overrides,
  });
}

test("access diagnostics perform only the three existing Azure reads and never create build evidence", (t) => {
  const { run, calls, output } = harness(t);
  const report = diagnoseProductionCandidateAccess(diagnosticEnvironment(), run);
  assert.deepEqual(report, {
    operation: "diagnose-access",
    sourceSha,
    registryMetadataRead: true,
    repositoryTagsRead: true,
    armTokenRead: true,
    buildSubmitted: false,
  });
  assert.deepEqual(
    calls.filter(([program]) => program === "az").map(([, ...args]) => args),
    [
      [
        "acr",
        "show",
        "--name",
        "kovagptacr",
        "--resource-group",
        "rg-kovagpt-dev",
        "--query",
        "{id:id,loginServer:loginServer,roleAssignmentMode:roleAssignmentMode}",
        "--output",
        "json",
      ],
      [
        "acr",
        "repository",
        "show-tags",
        "--name",
        "kovagptacr",
        "--repository",
        "kovagpt-web",
        "--query",
        `[?@=='production-candidate-${sourceSha}-12345-1']`,
        "--output",
        "json",
      ],
      [
        "account",
        "get-access-token",
        "--subscription",
        "ab732127-11c3-46a7-a1cb-6ee8d86594f4",
        "--resource",
        "https://management.azure.com/",
        "--query",
        "accessToken",
        "--output",
        "tsv",
        "--only-show-errors",
      ],
    ],
  );
  assert.ok(calls.every(([program]) => program === "git" || program === "az"));
  assert.equal(existsSync(output), false);
  assert.doesNotMatch(
    JSON.stringify(report),
    /fixtureToken|sb_publishable_|pk_live_|SERVER_REFERENCE|tokenLength|tokenHash/u,
  );
});

test("build and read-only diagnostic authority cannot be interchanged", () => {
  const noCommands = () => assert.fail("No external command is authorized");
  for (const env of [
    diagnosticEnvironment({ KOVA_BUILD_CONFIRMATION: "BUILD_ONLY" }),
    diagnosticEnvironment({ GITHUB_EVENT_NAME: "pull_request" }),
    diagnosticEnvironment({ GITHUB_REF: "refs/heads/diagnostic" }),
    diagnosticEnvironment({ KOVA_APPROVED_SOURCE_SHA: "d".repeat(40) }),
    diagnosticEnvironment({ GITHUB_REPOSITORY: "other/KovaGPT" }),
  ])
    assert.throws(
      () => diagnoseProductionCandidateAccess(env, noCommands),
      /production_candidate_/u,
    );
  assert.throws(
    () => buildProductionCandidate(diagnosticEnvironment(), noCommands),
    /build_mode_required/u,
  );
  assert.throws(
    () => diagnoseProductionCandidateAccess(environment(), noCommands),
    /diagnostic_mode_required/u,
  );
  assert.throws(
    () =>
      buildProductionCandidate(environment({ KOVA_BUILD_CONFIRMATION: "READ_ONLY" }), noCommands),
    /manual_main_approval_required/u,
  );
  assert.throws(
    () =>
      diagnoseProductionCandidateAccess(
        diagnosticEnvironment({ KOVA_PRODUCTION_OPERATION: "unknown" }),
        noCommands,
      ),
    /operation_invalid/u,
  );
});

for (const [argsPrefix, stage] of [
  [["acr", "show"], "registry_metadata_read"],
  [["acr", "repository", "show-tags"], "repository_tags_read"],
  [["account", "get-access-token"], "arm_token_read"],
]) {
  test(`access failures identify ${stage} without exposing provider output or secrets`, (t) => {
    for (const diagnose of [false, true]) {
      const { run: successful, calls, output } = harness(t);
      const secret = "PRIVATE_PROVIDER_SECRET_MUST_NEVER_APPEAR";
      const run = (program, args, options) => {
        if (program === "az" && argsPrefix.every((arg, i) => args[i] === arg)) {
          throw new Error(`${secret}: ${args.join(" ")}`);
        }
        return successful(program, args, options);
      };
      run.remainingMs = successful.remainingMs;
      assert.throws(
        () =>
          diagnose
            ? diagnoseProductionCandidateAccess(diagnosticEnvironment(), run)
            : buildProductionCandidate(
                environment({ KOVA_PRODUCTION_CANDIDATE_OUTPUT_DIR: output }),
                run,
              ),
        (error) => {
          assert.equal(error.message, `production_candidate_access_failed:${stage}`);
          assert.doesNotMatch(
            error.stack,
            /PRIVATE_PROVIDER_SECRET|fixtureToken|accessToken|--query/u,
          );
          return true;
        },
      );
      assert.ok(!calls.some(([program]) => program === "node" || program === "docker"));
      assert.equal(existsSync(`${output}/candidate.json`), false);
    }
  });
}

test("diagnostic workflow cannot fall through to a build, artifact, or handoff", () => {
  const workflow = readFileSync(
    new URL("../../.github/workflows/build-azure-production-candidate.yml", import.meta.url),
    "utf8",
  );
  assert.match(
    workflow,
    /operation:\n[\s\S]*?default: build\n[\s\S]*?- build\n[\s\S]*?- diagnose-access/u,
  );
  const diagnostic = workflow.slice(
    workflow.indexOf("      - name: Diagnose the three"),
    workflow.indexOf("      - name: Build exact"),
  );
  assert.match(diagnostic, /if: inputs\.operation == 'diagnose-access'/u);
  assert.match(diagnostic, /--diagnose-access/u);
  assert.doesNotMatch(diagnostic, /--execute|upload-artifact|acr-pinned|docker|PLAN/u);
  for (const name of [
    "Build exact Git commit",
    "Preserve verified key-free",
    "Record the build-only",
  ]) {
    const step = workflow
      .slice(workflow.indexOf(`      - name: ${name}`))
      .split("      - name: ")
      .slice(0, 2)
      .join("      - name: ");
    assert.match(step, /if: (?:always\(\) && )?inputs\.operation == 'build'/u);
  }
});

test("default PLAN selection in read-only diagnostics never reads browser parameters or keys", (t) => {
  const { run, output } = harness(t);
  const env = diagnosticEnvironment({ KOVA_PRODUCTION_BROWSER_INPUT_MODE: "plan" });
  for (const name of [
    "KOVA_PRODUCTION_BICEP_PARAMETERS_JSON",
    "KOVA_PRODUCTION_SUPABASE_URL",
    "KOVA_PRODUCTION_SUPABASE_PUBLISHABLE_KEY",
    "KOVA_PRODUCTION_STRIPE_PUBLISHABLE_KEY",
    "VITE_KOVA_AUTH_MODE",
    "VITE_KOVA_GOOGLE_AUTH_ENABLED",
    "VITE_KOVA_AUTH_ORIGIN",
  ])
    Object.defineProperty(env, name, {
      get() {
        assert.fail("Diagnostics must not read browser inputs or the PLAN secret");
      },
    });
  assert.equal(diagnoseProductionCandidateAccess(env, run).buildSubmitted, false);
  assert.equal(existsSync(output), false);
});

test("the diagnostic CLI suppresses real failed child stdout and stderr", (t) => {
  const directory = mkdtempSync(resolve(tmpdir(), "kova-access-cli-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bin = `${directory}/bin`;
  mkdirSync(bin);
  writeFileSync(
    `${bin}/git`,
    `#!${process.execPath}\nconst args=process.argv.slice(2);if(args[0]==="status")process.exit(0);if(args[0]==="ls-remote")console.log("${sourceSha}\\trefs/heads/main");else console.log(({HEAD:"${sourceSha}","HEAD^{tree}":"${sourceTree}","--show-toplevel":${JSON.stringify(directory)}})[args[1]]);\n`,
    { mode: 0o700 },
  );
  writeFileSync(
    `${bin}/az`,
    `#!${process.execPath}\nconst args=process.argv.slice(2);if(args[1]==="show"){console.log(${JSON.stringify(JSON.stringify({ id: ACR_RESOURCE_ID, loginServer, roleAssignmentMode: "LegacyRegistryPermissions" }))});}else{console.log("PRIVATE_CHILD_STDOUT_SENTINEL");console.error("PRIVATE_CHILD_STDERR_SENTINEL");process.exitCode=1;}\n`,
    { mode: 0o700 },
  );
  const result = spawnSync(
    process.execPath,
    [resolve("scripts/azure/build-production-candidate.mjs"), "--diagnose-access"],
    { env: { ...diagnosticEnvironment(), PATH: bin }, encoding: "utf8", timeout: 5000 },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "production_candidate_access_failed:repository_tags_read\n");
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /PRIVATE_CHILD_|sb_publishable_|SERVER_REFERENCE/u,
  );
});
