import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { verifyBrowserConfig } from "./verify-browser-config.mjs";

const REPOSITORY = "Blockigaming/KovaGPT";
const GIT_URL = `https://github.com/${REPOSITORY}.git`;
const SHA = /^[a-f0-9]{40}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
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

// Only browser-safe values from the same protected parameters consumed by PLAN.
// Never pass the parameters document, a server credential, or a vault URI to ACR.
export function productionCandidateConfig(env) {
  requireCondition(
    env.GITHUB_REPOSITORY === REPOSITORY &&
      env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
      env.GITHUB_REF === "refs/heads/main" &&
      env.KOVA_BUILD_CONFIRMATION === "BUILD_ONLY",
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
    typeof publishableKey === "string" && /^sb_publishable_[A-Za-z0-9_-]{16,}$/u.test(publishableKey),
    "browser_key_invalid",
  );
  const stripeKey = env.KOVA_PRODUCTION_STRIPE_PUBLISHABLE_KEY ?? "";
  requireCondition(
    stripeKey === "" || /^pk_live_[A-Za-z0-9]{16,}$/u.test(stripeKey),
    "stripe_browser_key_invalid",
  );
  const tag = `production-candidate-${env.GITHUB_SHA}-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`;
  return { ...APPROVED, sourceSha: env.GITHUB_SHA, supabaseUrl, publishableKey, stripeKey, tag };
}

// Explicit argument allowlist, exact remote Git commit, no local/stale build context.
export function productionCandidateBuildArgs(config, sourceTree, abac) {
  requireCondition(SHA.test(sourceTree), "source_tree_invalid");
  const values = {
    KOVA_SOURCE_SHA: config.sourceSha,
    KOVA_SOURCE_TREE: sourceTree,
    KOVA_EXPECTED_SUPABASE_PROJECT_REF: config.projectRef,
    KOVA_VERIFY_BROWSER_CONFIG: "true",
    VITE_SUPABASE_URL: config.supabaseUrl,
    VITE_SUPABASE_PUBLISHABLE_KEY: config.publishableKey,
    VITE_PAYMENTS_CLIENT_TOKEN: config.stripeKey,
  };
  return [
    "acr", "build", "--registry", config.acrName,
    "--image", `${config.imageRepository}:${config.tag}`,
    "--file", "Dockerfile", "--platform", "linux/amd64", "--timeout", "1800", "--no-logs",
    ...(abac ? ["--source-acr-auth-id", "[caller]"] : []),
    ...Object.entries(values).flatMap(([name, value]) => ["--build-arg", `${name}=${value}`]),
    "--query", "{runId:runId,status:status,outputImages:outputImages}",
    "--output", "json", "--only-show-errors", `${GIT_URL}#${config.sourceSha}`,
  ];
}

// The digest comes from this successful build's output, never from a tag lookup.
export function productionCandidateDigest(run, config) {
  requireCondition(run?.status === "Succeeded", "acr_build_not_succeeded");
  requireCondition(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(run.runId ?? ""), "acr_run_id_invalid");
  requireCondition(Array.isArray(run.outputImages) && run.outputImages.length === 1, "output_invalid");
  const image = run.outputImages[0];
  requireCondition(
    image?.registry === config.loginServer && image.repository === config.imageRepository &&
      image.tag === config.tag && DIGEST.test(image.digest ?? ""),
    "output_image_mismatch",
  );
  return image.digest;
}

function command(program, args) {
  const env = { ...process.env };
  for (const name of [
    "KOVA_PRODUCTION_BICEP_PARAMETERS_JSON", "GITHUB_TOKEN", "GH_TOKEN",
    "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
  ]) delete env[name];
  const result = spawnSync(program, args, {
    env, encoding: "utf8", timeout: 35 * 60 * 1000, maxBuffer: 16 * 1024 * 1024,
  });
  // Child errors may contain arguments or provider output. Do not echo them.
  requireCondition(result.status === 0, `command_failed:${program}`);
  return result.stdout.trim();
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

export function buildProductionCandidate(env, run = command) {
  const config = productionCandidateConfig(env);
  requireCondition(run("git", ["rev-parse", "HEAD"]) === config.sourceSha, "checkout_mismatch");
  requireCondition(run("git", ["status", "--porcelain=v1", "--untracked-files=all"]) === "", "dirty_source");
  const sourceTree = run("git", ["rev-parse", "HEAD^{tree}"]);
  requireCondition(SHA.test(sourceTree), "source_tree_invalid");
  const currentMain = run("git", ["ls-remote", GIT_URL, "refs/heads/main"]);
  requireCondition(currentMain === `${config.sourceSha}\trefs/heads/main`, "main_moved");
  const root = run("git", ["rev-parse", "--show-toplevel"]);
  const output = resolve(env.KOVA_PRODUCTION_CANDIDATE_OUTPUT_DIR ?? ".");
  const outputRelative = relative(root, output);
  requireCondition(outputRelative.startsWith("../") || isAbsolute(outputRelative), "output_must_be_external");

  const registry = parseJson(run("az", [
    "acr", "show", "--name", config.acrName, "--query",
    "{loginServer:loginServer,roleAssignmentMode:roleAssignmentMode}", "--output", "json",
  ]));
  requireCondition(registry.loginServer === config.loginServer, "live_registry_mismatch");
  requireCondition(
    ["LegacyRegistryPermissions", "AbacRepositoryPermissions"].includes(registry.roleAssignmentMode),
    "registry_permission_mode_unknown",
  );
  const existing = parseJson(run("az", [
    "acr", "repository", "show-tags", "--name", config.acrName,
    "--repository", config.imageRepository, "--query", `[?@=='${config.tag}']`, "--output", "json",
  ]));
  requireCondition(Array.isArray(existing) && existing.length === 0, "tag_already_exists");
  // Do not overwrite earlier evidence or start paid work after a local path error.
  mkdirSync(output, { mode: 0o700 });
  const build = parseJson(run("az", productionCandidateBuildArgs(
    config, sourceTree, registry.roleAssignmentMode === "AbacRepositoryPermissions",
  )));
  const digest = productionCandidateDigest(build, config);
  const imageReference = `${config.loginServer}/${config.imageRepository}@${digest}`;
  const registryDigest = run("az", [
    "acr", "repository", "show", "--name", config.acrName,
    "--image", `${config.imageRepository}:${config.tag}`, "--query", "digest", "--output", "tsv",
  ]);
  requireCondition(registryDigest === digest, "registry_digest_mismatch");
  run("az", ["acr", "login", "--name", config.acrName, "--only-show-errors"]);
  run("docker", ["pull", "--platform", "linux/amd64", imageReference]);
  const image = parseJson(run("docker", [
    "image", "inspect", "--format",
    '{"Os":{{json .Os}},"Architecture":{{json .Architecture}},"Labels":{{json .Config.Labels}}}',
    imageReference,
  ]));
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
    run("docker", ["cp", `${containerId}:/app/dist/browser-config-provenance.json`, `${temporary}/built.json`]);
    run("docker", ["cp", `${containerId}:/app/dist/client`, `${temporary}/client`]);
    const built = parseJson(readFileSync(`${temporary}/built.json`, "utf8"));
    writeJson(`${temporary}/source.json`, {
      schemaVersion: 1, context: "acr-git", sourceSha: config.sourceSha, sourceTree,
    });
    const { provenance } = verifyBrowserConfig({
      bundleDir: `${temporary}/client`, supabaseUrl: config.supabaseUrl,
      publishableKey: config.publishableKey, stripePublishableKey: config.stripeKey,
      sourceSha: config.sourceSha, sourceTree, expectedProjectRef: config.projectRef,
      sourceAttestationPath: `${temporary}/source.json`, provenancePath: `${temporary}/verified.json`,
      writeProvenance: false,
    });
    requireCondition(
      Object.keys(built).length === Object.keys(provenance).length &&
        Object.entries(provenance).every(([key, value]) => JSON.stringify(built[key]) === JSON.stringify(value)),
      "browser_provenance_mismatch",
    );
    const report = {
      schemaVersion: 1, operation: "production-candidate-build-only",
      sourceSha: config.sourceSha, sourceTree, sourceContext: "acr-git",
      imageReference, digest, acrRunId: build.runId, candidateTag: config.tag,
      observedAt: new Date().toISOString(), labels: expectedLabels,
      githubRunId: env.GITHUB_RUN_ID, githubRunAttempt: env.GITHUB_RUN_ATTEMPT,
      browserBundleSha256: provenance.browserBundleSha256,
      browserProvenanceSha256: sha256(`${JSON.stringify(provenance, null, 2)}\n`),
      containerAppUpdated: false, databaseMutated: false, trafficShifted: false, deployed: false,
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
    requireCondition(process.argv.length === 3 && ["--check", "--execute"].includes(process.argv[2]), "mode_required");
    if (process.argv[2] === "--check") {
      productionCandidateConfig(process.env);
      console.log("PRODUCTION_CANDIDATE_INPUTS=PASS; no build or Azure call performed");
    } else {
      const report = buildProductionCandidate(process.env);
      console.log(`PRODUCTION_CANDIDATE_IMAGE=${report.imageReference}`);
      console.log("BUILD_ONLY_COMPLETE; no deployment performed");
    }
  } catch (error) {
    console.error(error instanceof Error && error.message.startsWith("production_candidate_") ? error.message : "production_candidate_failed");
    process.exitCode = 1;
  }
}
