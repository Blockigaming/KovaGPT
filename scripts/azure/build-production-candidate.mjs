import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { verifyBrowserConfig } from "./verify-browser-config.mjs";
import { narrowOpenAiBrowserInputs } from "./narrow-openai-browser-inputs.mjs";
import {
  ACR_RESOURCE_ID,
  ACR_CPU,
  ACR_RECONCILIATION_RESERVE_MS,
} from "./acr-pinned-quick-build.mjs";

const REPOSITORY = "Blockigaming/KovaGPT";
const GIT_URL = `https://github.com/${REPOSITORY}.git`;
const SHA = /^[a-f0-9]{40}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
export const PRODUCTION_BUILD_TIMEOUT_SECONDS = 20 * 60;
export const PRODUCTION_CLIENT_BUDGET_MS = 25 * 60 * 1000;
const APPROVED = {
  acrName: "kovagptacr",
  loginServer: "kovagptacr-dte9hugbhjghcyb8.azurecr.io",
  imageRepository: "kovagpt-web",
  projectRef: "mfbycmbjygcfkrsuepxf",
};

function requireCondition(condition, code) {
  if (!condition) throw new Error(`production_candidate_${code}`);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("production_candidate_json_invalid");
  }
}

function browserAuthInputs(env) {
  // Browser Auth is an explicit build choice. Server bindings never select it.
  const browserAuthMode =
    env.VITE_KOVA_AUTH_MODE === undefined ? "supabase" : env.VITE_KOVA_AUTH_MODE;
  const browserGoogleAuthEnabled =
    env.VITE_KOVA_GOOGLE_AUTH_ENABLED === undefined ? "false" : env.VITE_KOVA_GOOGLE_AUTH_ENABLED;
  const browserAuthOrigin =
    env.VITE_KOVA_AUTH_ORIGIN === undefined ? "" : env.VITE_KOVA_AUTH_ORIGIN;
  requireCondition(
    ["supabase", "dual", "kova"].includes(browserAuthMode),
    "browser_auth_mode_invalid",
  );
  requireCondition(
    ["true", "false"].includes(browserGoogleAuthEnabled),
    "browser_google_auth_invalid",
  );
  requireCondition(typeof browserAuthOrigin === "string", "browser_auth_origin_invalid");
  if (browserAuthOrigin !== "") {
    let parsed;
    try {
      parsed = new URL(browserAuthOrigin);
    } catch {
      requireCondition(false, "browser_auth_origin_invalid");
    }
    requireCondition(
      parsed.protocol === "https:" && parsed.origin === browserAuthOrigin,
      "browser_auth_origin_invalid",
    );
  }
  return { browserAuthMode, browserGoogleAuthEnabled, browserAuthOrigin };
}

export function productionCandidateOperation(env) {
  const operation = env.KOVA_PRODUCTION_OPERATION ?? "build";
  requireCondition(["build", "diagnose-access"].includes(operation), "operation_invalid");
  return operation;
}

function productionCandidateTarget(env) {
  const operation = productionCandidateOperation(env);
  requireCondition(
    env.GITHUB_REPOSITORY === REPOSITORY &&
      env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
      env.GITHUB_REF === "refs/heads/main" &&
      env.KOVA_BUILD_CONFIRMATION === (operation === "build" ? "BUILD_ONLY" : "READ_ONLY"),
    "manual_main_approval_required",
  );
  requireCondition(
    SHA.test(env.GITHUB_SHA ?? "") && env.KOVA_APPROVED_SOURCE_SHA === env.GITHUB_SHA,
    "approved_sha_mismatch",
  );
  requireCondition(
    /^[1-9][0-9]*$/u.test(env.GITHUB_RUN_ID ?? "") &&
      /^[1-9][0-9]*$/u.test(env.GITHUB_RUN_ATTEMPT ?? ""),
    "run_identity_invalid",
  );
  for (const [field, variable] of [
    ["acrName", "KOVA_PRODUCTION_ACR_NAME"],
    ["loginServer", "KOVA_PRODUCTION_ACR_LOGIN_SERVER"],
    ["imageRepository", "KOVA_PRODUCTION_IMAGE_REPOSITORY"],
    ["projectRef", "KOVA_PRODUCTION_SUPABASE_PROJECT_REF"],
  ]) {
    requireCondition(env[variable] === APPROVED[field], `target_mismatch:${variable}`);
  }
  const tag = `production-candidate-${env.GITHUB_SHA}-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`;
  return { ...APPROVED, sourceSha: env.GITHUB_SHA, tag };
}

// Only browser-safe values from protected PLAN parameters or explicit narrow inputs.
// Never pass the parameters document, a server credential, or a vault URI to ACR.
export function productionCandidateConfig(env) {
  const target = productionCandidateTarget(env);
  const inputMode = env.KOVA_PRODUCTION_BROWSER_INPUT_MODE ?? "plan";
  requireCondition(["plan", "narrow-openai"].includes(inputMode), "browser_input_mode_invalid");
  const authInputs = browserAuthInputs(env);
  let browserInputs;
  if (inputMode === "narrow-openai") {
    browserInputs = narrowOpenAiBrowserInputs(env, APPROVED);
  } else {
    const document = parseJson(env.KOVA_PRODUCTION_BICEP_PARAMETERS_JSON ?? "");
    const parameters = document?.parameters;
    requireCondition(parameters && typeof parameters === "object", "parameters_required");
    const supabaseUrl = parameters.supabaseUrl?.value;
    const publishableKey = parameters.supabasePublishableKey?.value;
    requireCondition(parameters.acrName?.value === APPROVED.acrName, "parameter_registry_mismatch");
    requireCondition(
      supabaseUrl === `https://${APPROVED.projectRef}.supabase.co`,
      "supabase_url_mismatch",
    );
    requireCondition(
      typeof publishableKey === "string" &&
        /^sb_publishable_[A-Za-z0-9_-]{16,}$/u.test(publishableKey),
      "browser_key_invalid",
    );
    const stripeKey = env.KOVA_PRODUCTION_STRIPE_PUBLISHABLE_KEY ?? "";
    requireCondition(
      stripeKey === "" || /^pk_live_[A-Za-z0-9]{16,}$/u.test(stripeKey),
      "stripe_browser_key_invalid",
    );
    browserInputs = { supabaseUrl, publishableKey, stripeKey };
  }
  return { ...target, ...browserInputs, ...authInputs };
}

// Explicit argument allowlist, exact remote Git commit, no local/stale build context.
export function productionCandidateBuildRequest(config, sourceTree, abac) {
  requireCondition(SHA.test(sourceTree), "source_tree_invalid");
  const authInputs = browserAuthInputs({
    VITE_KOVA_AUTH_MODE: config.browserAuthMode,
    VITE_KOVA_GOOGLE_AUTH_ENABLED: config.browserGoogleAuthEnabled,
    VITE_KOVA_AUTH_ORIGIN: config.browserAuthOrigin,
  });
  const values = {
    KOVA_SOURCE_SHA: config.sourceSha,
    KOVA_SOURCE_TREE: sourceTree,
    KOVA_EXPECTED_SUPABASE_PROJECT_REF: config.projectRef,
    KOVA_VERIFY_BROWSER_CONFIG: "true",
    VITE_SUPABASE_URL: config.supabaseUrl,
    VITE_SUPABASE_PUBLISHABLE_KEY: config.publishableKey,
    VITE_KOVA_AUTH_MODE: authInputs.browserAuthMode,
    VITE_KOVA_GOOGLE_AUTH_ENABLED: authInputs.browserGoogleAuthEnabled,
    VITE_KOVA_AUTH_ORIGIN: authInputs.browserAuthOrigin,
    VITE_PAYMENTS_CLIENT_TOKEN: config.stripeKey,
  };
  return {
    type: "DockerBuildRequest",
    imageNames: [`${config.imageRepository}:${config.tag}`],
    isPushEnabled: true,
    dockerFilePath: "Dockerfile",
    platform: { os: "Linux", architecture: "amd64" },
    timeout: PRODUCTION_BUILD_TIMEOUT_SECONDS,
    agentConfiguration: { cpu: ACR_CPU },
    sourceLocation: `${GIT_URL}#${config.sourceSha}`,
    arguments: Object.entries(values).map(([name, value]) => ({ name, value, isSecret: false })),
    ...(abac ? { credentials: { sourceRegistry: { identity: "[caller]" } } } : {}),
  };
}

// The digest comes from this successful build's output, never from a tag lookup.
export function productionCandidateDigest(run, config) {
  requireCondition(run?.status === "Succeeded", "acr_build_not_succeeded");
  requireCondition(run.agentCpu === ACR_CPU, "acr_cpu_mismatch");
  requireCondition(
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(run.runId ?? ""),
    "acr_run_id_invalid",
  );
  requireCondition(
    Array.isArray(run.outputImages) && run.outputImages.length === 1,
    "output_invalid",
  );
  const image = run.outputImages[0];
  requireCondition(
    image?.registry === config.loginServer &&
      image.repository === config.imageRepository &&
      image.tag === config.tag &&
      DIGEST.test(image.digest ?? ""),
    "output_image_mismatch",
  );
  return image.digest;
}

export function createProductionCandidateCommand({
  spawn = spawnSync,
  now = () => performance.now(),
  wallNow = Date.now,
  workflowDeadlineMs,
} = {}) {
  // One monotonic budget for the complete attempt, not a fresh allowance for
  // every child process. Expiry is a terminal, potentially consumed operation;
  // never retry a build submission or certify a late result.
  const budget =
    workflowDeadlineMs === undefined
      ? PRODUCTION_CLIENT_BUDGET_MS
      : Math.min(PRODUCTION_CLIENT_BUDGET_MS, Math.floor(workflowDeadlineMs - wallNow()));
  requireCondition(Number.isInteger(budget) && budget > 0, "client_deadline_exceeded");
  const deadline = now() + budget;
  const command = (program, args, { input } = {}) => {
    const remaining = Math.floor(deadline - now());
    requireCondition(remaining > 0, "client_deadline_exceeded");
    const env = { ...process.env };
    for (const name of [
      "KOVA_PRODUCTION_BICEP_PARAMETERS_JSON",
      "GITHUB_TOKEN",
      "GH_TOKEN",
      "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
    ])
      delete env[name];
    const result = spawn(program, args, {
      env,
      encoding: "utf8",
      timeout: remaining,
      killSignal: "SIGKILL",
      maxBuffer: 16 * 1024 * 1024,
      ...(input === undefined ? {} : { input }),
    });
    // Child errors may contain arguments or provider output. Do not echo them.
    requireCondition(
      result.error?.code !== "ETIMEDOUT" && now() < deadline,
      "client_deadline_exceeded",
    );
    requireCondition(result.status === 0, `command_failed:${program}`);
    return result.stdout.trim();
  };
  command.remainingMs = () => Math.floor(deadline - now());
  return command;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

// Fixed labels identify failing reads without exposing child output or credentials.
function readProductionAccess(run, operation, args) {
  try {
    return run("az", args);
  } catch (error) {
    const deadline = error?.message === "production_candidate_client_deadline_exceeded";
    throw new Error(
      `production_candidate_access_failed:${operation}${deadline ? ":client_deadline_exceeded" : ""}`,
    );
  }
}

function verifyProductionSource(config, run) {
  requireCondition(run("git", ["rev-parse", "HEAD"]) === config.sourceSha, "checkout_mismatch");
  requireCondition(
    run("git", ["status", "--porcelain=v1", "--untracked-files=all"]) === "",
    "dirty_source",
  );
  const sourceTree = run("git", ["rev-parse", "HEAD^{tree}"]);
  requireCondition(SHA.test(sourceTree), "source_tree_invalid");
  const currentMain = run("git", ["ls-remote", GIT_URL, "refs/heads/main"]);
  requireCondition(currentMain === `${config.sourceSha}\trefs/heads/main`, "main_moved");
  const root = run("git", ["rev-parse", "--show-toplevel"]);
  return { sourceTree, root };
}

function inspectProductionRegistry(config, run) {
  const registry = parseJson(
    readProductionAccess(run, "registry_metadata_read", [
      "acr",
      "show",
      "--name",
      config.acrName,
      "--resource-group",
      "rg-kovagpt-dev",
      "--query",
      "{id:id,loginServer:loginServer,roleAssignmentMode:roleAssignmentMode}",
      "--output",
      "json",
    ]),
  );
  requireCondition(registry.loginServer === config.loginServer, "live_registry_mismatch");
  requireCondition(registry.id === ACR_RESOURCE_ID, "registry_resource_mismatch");
  requireCondition(
    ["LegacyRegistryPermissions", "AbacRepositoryPermissions"].includes(
      registry.roleAssignmentMode,
    ),
    "registry_permission_mode_unknown",
  );
  const existing = parseJson(
    readProductionAccess(run, "repository_tags_read", [
      "acr",
      "repository",
      "show-tags",
      "--name",
      config.acrName,
      "--repository",
      config.imageRepository,
      "--query",
      `[?@=='${config.tag}']`,
      "--output",
      "json",
    ]),
  );
  requireCondition(Array.isArray(existing) && existing.length === 0, "tag_already_exists");
  return registry;
}

function readProductionArmToken(run) {
  const token = readProductionAccess(run, "arm_token_read", [
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
  ]);
  requireCondition(typeof token === "string" && token.length > 0, "arm_token_empty");
  return token;
}

export function diagnoseProductionCandidateAccess(env, run) {
  requireCondition(
    productionCandidateOperation(env) === "diagnose-access",
    "diagnostic_mode_required",
  );
  const config = productionCandidateTarget(env);
  run ??= createProductionCandidateCommand();
  verifyProductionSource(config, run);
  inspectProductionRegistry(config, run);
  // Acquisition is checked, but the token and all token metadata remain private.
  readProductionArmToken(run);
  return {
    operation: "diagnose-access",
    sourceSha: config.sourceSha,
    registryMetadataRead: true,
    repositoryTagsRead: true,
    armTokenRead: true,
    buildSubmitted: false,
  };
}

export function buildProductionCandidate(env, run) {
  requireCondition(productionCandidateOperation(env) === "build", "build_mode_required");
  if (!run) {
    requireCondition(
      /^[1-9][0-9]{12}$/u.test(env.KOVA_BUILD_JOB_DEADLINE_MS ?? ""),
      "workflow_deadline_required",
    );
    run = createProductionCandidateCommand({
      workflowDeadlineMs: Number(env.KOVA_BUILD_JOB_DEADLINE_MS),
    });
  }
  const config = productionCandidateConfig(env);
  const { sourceTree, root } = verifyProductionSource(config, run);
  const output = resolve(env.KOVA_PRODUCTION_CANDIDATE_OUTPUT_DIR ?? ".");
  const outputRelative = relative(root, output);
  requireCondition(
    outputRelative.startsWith("../") || isAbsolute(outputRelative),
    "output_must_be_external",
  );
  const registry = inspectProductionRegistry(config, run);
  // Do not overwrite earlier evidence or start paid work after a local path error.
  mkdirSync(output, { mode: 0o700 });
  const submissionBudget = () => {
    requireCondition(typeof run.remainingMs === "function", "client_budget_required");
    const budget = run.remainingMs();
    requireCondition(
      budget >= PRODUCTION_BUILD_TIMEOUT_SECONDS * 1000 + ACR_RECONCILIATION_RESERVE_MS,
      "build_submission_budget_insufficient",
    );
    return budget;
  };
  submissionBudget();
  let token;
  let build;
  try {
    token = readProductionArmToken(run);
    build = parseJson(
      run("node", [resolve("scripts/azure/acr-pinned-quick-build.mjs")], {
        input: JSON.stringify({
          resourceId: registry.id,
          token,
          budgetMs: submissionBudget(),
          receiptPath: `${output}/acr-attempt.json`,
          body: productionCandidateBuildRequest(
            config,
            sourceTree,
            registry.roleAssignmentMode === "AbacRepositoryPermissions",
          ),
        }),
      }),
    );
  } finally {
    token = undefined;
  }
  const digest = productionCandidateDigest(build, config);
  const imageReference = `${config.loginServer}/${config.imageRepository}@${digest}`;
  const registryDigest = run("az", [
    "acr",
    "repository",
    "show",
    "--name",
    config.acrName,
    "--image",
    `${config.imageRepository}:${config.tag}`,
    "--query",
    "digest",
    "--output",
    "tsv",
  ]);
  requireCondition(registryDigest === digest, "registry_digest_mismatch");
  run("az", [
    "acr",
    "login",
    "--name",
    config.acrName,
    "--resource-group",
    "rg-kovagpt-dev",
    "--only-show-errors",
  ]);
  run("docker", ["pull", "--platform", "linux/amd64", imageReference]);
  const image = parseJson(
    run("docker", [
      "image",
      "inspect",
      "--format",
      '{"Os":{{json .Os}},"Architecture":{{json .Architecture}},"Labels":{{json .Config.Labels}}}',
      imageReference,
    ]),
  );
  requireCondition(image?.Os === "linux" && image.Architecture === "amd64", "platform_mismatch");
  const expectedLabels = {
    "org.opencontainers.image.revision": config.sourceSha,
    "com.kovagpt.source.tree": sourceTree,
    "com.kovagpt.browser.supabase-project-ref": config.projectRef,
    "com.kovagpt.browser.config-verified": "true",
    "com.kovagpt.browser.config-provenance": "/app/dist/browser-config-provenance.json",
  };
  requireCondition(
    Object.entries(expectedLabels).every(([key, value]) => image.Labels?.[key] === value),
    "labels_mismatch",
  );
  const temporary = mkdtempSync(resolve(tmpdir(), "kova-production-candidate-"));
  let containerId;
  try {
    containerId = run("docker", ["create", imageReference]);
    requireCondition(/^[a-f0-9]{12,64}$/u.test(containerId), "container_id_invalid");
    run("docker", [
      "cp",
      `${containerId}:/app/dist/browser-config-provenance.json`,
      `${temporary}/built.json`,
    ]);
    run("docker", ["cp", `${containerId}:/app/dist/client`, `${temporary}/client`]);
    const built = parseJson(readFileSync(`${temporary}/built.json`, "utf8"));
    writeJson(`${temporary}/source.json`, {
      schemaVersion: 1,
      context: "acr-git",
      sourceSha: config.sourceSha,
      sourceTree,
    });
    const { provenance } = verifyBrowserConfig({
      bundleDir: `${temporary}/client`,
      supabaseUrl: config.supabaseUrl,
      publishableKey: config.publishableKey,
      stripePublishableKey: config.stripeKey,
      expectedAuthMode: config.browserAuthMode,
      sourceSha: config.sourceSha,
      sourceTree,
      expectedProjectRef: config.projectRef,
      sourceAttestationPath: `${temporary}/source.json`,
      provenancePath: `${temporary}/verified.json`,
      writeProvenance: false,
    });
    requireCondition(
      Object.keys(built).length === Object.keys(provenance).length &&
        Object.entries(provenance).every(
          ([key, value]) => JSON.stringify(built[key]) === JSON.stringify(value),
        ),
      "browser_provenance_mismatch",
    );
    const report = {
      schemaVersion: 1,
      operation: "production-candidate-build-only",
      sourceSha: config.sourceSha,
      sourceTree,
      sourceContext: "acr-git",
      imageReference,
      digest,
      acrRunId: build.runId,
      agentCpu: build.agentCpu,
      serverTimeoutSeconds: PRODUCTION_BUILD_TIMEOUT_SECONDS,
      candidateTag: config.tag,
      observedAt: new Date().toISOString(),
      labels: expectedLabels,
      githubRunId: env.GITHUB_RUN_ID,
      githubRunAttempt: env.GITHUB_RUN_ATTEMPT,
      browserBundleSha256: provenance.browserBundleSha256,
      browserAuthMode: provenance.authMode,
      requestedBrowserGoogleAuthEnabled: config.browserGoogleAuthEnabled,
      requestedBrowserAuthOrigin: config.browserAuthOrigin,
      browserProvenanceSha256: sha256(`${JSON.stringify(provenance, null, 2)}\n`),
      containerAppUpdated: false,
      databaseMutated: false,
      trafficShifted: false,
      deployed: false,
    };
    // Only regenerated, key-free, checked evidence is eligible for artifact upload.
    writeJson(`${output}/browser-config-provenance.json`, provenance);
    writeJson(`${output}/candidate.json`, report);
    writeFileSync(`${output}/image-reference.txt`, `${imageReference}\n`, { mode: 0o600 });
    return report;
  } finally {
    try {
      if (containerId && /^[a-f0-9]{12,64}$/u.test(containerId)) run("docker", ["rm", containerId]);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    requireCondition(
      process.argv.length === 3 &&
        ["--check", "--execute", "--diagnose-access"].includes(process.argv[2]),
      "mode_required",
    );
    if (process.argv[2] === "--check") {
      if (productionCandidateOperation(process.env) === "diagnose-access")
        productionCandidateTarget(process.env);
      else productionCandidateConfig(process.env);
      console.log("PRODUCTION_CANDIDATE_INPUTS=PASS; no build or Azure call performed");
    } else if (process.argv[2] === "--diagnose-access") {
      const report = diagnoseProductionCandidateAccess(process.env);
      console.log(JSON.stringify(report));
      console.log("PRODUCTION_ACCESS_READS=PASS; no build submitted or deployment performed");
    } else {
      const report = buildProductionCandidate(process.env);
      console.log(`PRODUCTION_CANDIDATE_IMAGE=${report.imageReference}`);
      console.log("BUILD_ONLY_COMPLETE; no deployment performed");
    }
  } catch (error) {
    console.error(
      error instanceof Error && error.message.startsWith("production_candidate_")
        ? error.message
        : "production_candidate_failed",
    );
    process.exitCode = 1;
  }
}
