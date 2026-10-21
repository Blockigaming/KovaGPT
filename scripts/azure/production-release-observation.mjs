import { execFile } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ARM = "https://management.azure.com";
const API_VERSION = "2025-07-01";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const SHA = /^[a-f0-9]{40}$/u;
const NAME = /^[a-z][a-z0-9-]{0,61}[a-z0-9]$/u;
const IMAGE = /^[a-z0-9.-]+\.azurecr\.io\/[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/u;
const APP_QUERY =
  "{id:id,name:name,type:type,runningStatus:properties.runningStatus,latestRevisionName:properties.latestRevisionName,latestReadyRevisionName:properties.latestReadyRevisionName,mode:properties.configuration.activeRevisionsMode,traffic:properties.configuration.ingress.traffic[].{revisionName:revisionName,latestRevision:latestRevision,weight:weight}}";
const REVISION_QUERY =
  "{id:id,name:name,active:properties.active,healthState:properties.healthState,runningState:properties.runningState,containers:properties.template.containers[].{name:name,image:image}}";
const MAX_BODY_BYTES = 64 * 1024;
const MAX_TOTAL_MS = 60_000;

function check(value, code) {
  if (!value) throw new Error(`production_observation_${code}`);
}

function canonicalTime(value) {
  const time = typeof value === "string" ? Date.parse(value) : NaN;
  check(Number.isFinite(time) && new Date(time).toISOString() === value, "plan_time_invalid");
  return time;
}

export function validateProductionObservationPlan(plan, now = Date.now()) {
  check(plan?.version === 1 && UUID.test(plan.observationId ?? ""), "plan_invalid");
  check(UUID.test(plan.subscriptionId ?? ""), "subscription_invalid");
  check(/^[-._()A-Za-z0-9]{1,90}$/u.test(plan.resourceGroup ?? ""), "group_invalid");
  check(NAME.test(plan.appName ?? "") && NAME.test(plan.containerName ?? ""), "app_invalid");
  check(
    typeof plan.revisionName === "string" &&
      plan.revisionName.startsWith(`${plan.appName}--`) &&
      /^[a-z0-9-]{1,128}$/u.test(plan.revisionName),
    "revision_invalid",
  );
  check(SHA.test(plan.sourceSha ?? "") && IMAGE.test(plan.image ?? ""), "source_invalid");
  let origin;
  try {
    origin = new URL(plan.origin);
  } catch {
    throw new Error("production_observation_origin_invalid");
  }
  check(
    origin.protocol === "https:" &&
      origin.origin === plan.origin &&
      !origin.username &&
      !origin.password &&
      !origin.port &&
      /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/u.test(origin.hostname) &&
      !/(?:^|\.)(?:localhost|local|internal)$/u.test(origin.hostname),
    "origin_invalid",
  );
  const createdAtMs = canonicalTime(plan.createdAt);
  const expiresAtMs = canonicalTime(plan.expiresAt);
  check(
    Number.isFinite(now) &&
      createdAtMs <= now &&
      now < expiresAtMs &&
      expiresAtMs > createdAtMs &&
      expiresAtMs - createdAtMs <= 600_000,
    "plan_expired",
  );
  const targetId = `/subscriptions/${plan.subscriptionId}/resourceGroups/${plan.resourceGroup}/providers/Microsoft.App/containerApps/${plan.appName}`;
  return { ...plan, targetId, expiresAtMs };
}

// Queries return only application/revision identity, state, traffic and images.
// There is no secret, environment, credential, mutation or interactive command.
export function createProductionObservationRunner({ execute = execFile } = {}) {
  return (args, { timeoutMs }) =>
    new Promise((resolve) => {
      execute(
        "az",
        args,
        {
          encoding: "utf8",
          timeout: timeoutMs,
          killSignal: "SIGKILL",
          maxBuffer: MAX_BODY_BYTES,
          windowsHide: true,
          env: {
            ...process.env,
            AZURE_CORE_ONLY_SHOW_ERRORS: "true",
            AZURE_CORE_COLLECT_TELEMETRY: "false",
            AZURE_EXTENSION_USE_DYNAMIC_INSTALL: "no",
            AZURE_CORE_DISABLE_CONFIRM_PROMPT: "true",
          },
        },
        (error, stdout) => resolve({ ok: !error, stdout: error ? "" : stdout }),
      );
    });
}

function failureCode(error) {
  return /^production_observation_[a-z_]+$/u.test(error?.message ?? "")
    ? error.message
    : "production_observation_failed";
}

/** One observation, never a provider test, deployment approval or watchdog. */
export async function observeProductionRelease(
  input,
  {
    run = createProductionObservationRunner(),
    fetcher = fetch,
    now = Date.now,
    monotonic = () => performance.now(),
  } = {},
) {
  const wallStart = now();
  const plan = validateProductionObservationPlan(input, wallStart);
  const monotonicStart = monotonic();
  const current = () => Math.max(now(), wallStart + monotonic() - monotonicStart);
  const deadline = Math.min(plan.expiresAtMs, wallStart + MAX_TOTAL_MS);
  const budget = (maximum) => {
    const remaining = Math.floor(deadline - current());
    check(remaining > 0, "deadline_exceeded");
    return Math.min(maximum, remaining);
  };
  const receipt = {
    version: 1,
    observationId: plan.observationId,
    sourceSha: plan.sourceSha,
    image: plan.image,
    targetId: plan.targetId,
    revisionName: plan.revisionName,
    origin: plan.origin,
    startedAt: new Date(wallStart).toISOString(),
    status: "RELEASE_UNVERIFIED",
    checks: {
      targetAndTraffic: false,
      revisionAndImage: false,
      healthBuild: false,
      versionBuild: false,
      stableTargetAndTraffic: false,
    },
    operations: {
      azureReadAttempts: 0,
      publicGetAttempts: 0,
      azureMutations: 0,
      providerRequests: 0,
    },
    liveAuthVerified: false,
    providerGenerationVerified: false,
    failureCode: null,
  };
  const arm = async (path, query) => {
    const timeoutMs = budget(20_000);
    receipt.operations.azureReadAttempts += 1;
    let result;
    try {
      result = await run(
        [
          "rest",
          "--method",
          "get",
          "--url",
          `${ARM}${path}?api-version=${API_VERSION}`,
          "--subscription",
          plan.subscriptionId,
          "--only-show-errors",
          "--output",
          "json",
          "--query",
          query,
        ],
        { timeoutMs },
      );
    } catch {
      throw new Error("production_observation_azure_read_failed");
    }
    check(result?.ok === true && typeof result.stdout === "string", "azure_read_failed");
    check(Buffer.byteLength(result.stdout) <= MAX_BODY_BYTES, "response_too_large");
    try {
      return JSON.parse(result.stdout);
    } catch {
      throw new Error("production_observation_response_invalid");
    }
  };
  const publicJson = async (path) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), budget(8_000));
    receipt.operations.publicGetAttempts += 1;
    try {
      const response = await fetcher(`${plan.origin}${path}`, {
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        cache: "no-store",
        headers: { Accept: "application/json", "Cache-Control": "no-cache" },
        signal: controller.signal,
      });
      check(response.status === 200, "public_status_invalid");
      check(
        /^(?:application\/json)(?:\s*;|$)/iu.test(response.headers.get("content-type") ?? ""),
        "public_content_invalid",
      );
      check(
        /(?:^|,)\s*no-store(?:\s*,|$)/iu.test(response.headers.get("cache-control") ?? ""),
        "public_cache_invalid",
      );
      check(response.body, "response_invalid");
      const reader = response.body.getReader();
      const chunks = [];
      let bytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          check(bytes <= MAX_BODY_BYTES, "response_too_large");
          chunks.push(Buffer.from(value));
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        throw new Error("production_observation_response_invalid");
      }
      return { body, buildHeader: response.headers.get("x-kova-build") };
    } catch (error) {
      if (controller.signal.aborted) throw new Error("production_observation_public_timeout");
      throw new Error(failureCode(error));
    } finally {
      clearTimeout(timeout);
    }
  };
  const verifyTarget = (app) => {
    check(
      app?.id?.toLowerCase() === plan.targetId.toLowerCase() &&
        app.name === plan.appName &&
        app.type?.toLowerCase() === "microsoft.app/containerapps" &&
        app.runningStatus === "Running" &&
        app.latestRevisionName === plan.revisionName &&
        app.latestReadyRevisionName === plan.revisionName &&
        app.mode === "Single" &&
        Array.isArray(app.traffic) &&
        app.traffic.length > 0 &&
        app.traffic.every(
          (entry) => Number.isInteger(entry?.weight) && entry.weight >= 0 && entry.weight <= 100,
        ),
      "target_or_traffic_mismatch",
    );
    const receiving = app.traffic.filter((entry) => entry.weight > 0);
    check(
      receiving.length === 1 &&
        receiving[0].weight === 100 &&
        (receiving[0].revisionName === plan.revisionName ||
          (receiving[0].latestRevision === true && !receiving[0].revisionName)),
      "target_or_traffic_mismatch",
    );
  };
  try {
    verifyTarget(await arm(plan.targetId, APP_QUERY));
    receipt.checks.targetAndTraffic = true;
    const revisionId = `${plan.targetId}/revisions/${plan.revisionName}`;
    const revision = await arm(revisionId, REVISION_QUERY);
    check(
      revision?.id?.toLowerCase() === revisionId.toLowerCase() &&
        revision.name === plan.revisionName &&
        revision.active === true &&
        revision.healthState === "Healthy" &&
        revision.runningState === "Running" &&
        Array.isArray(revision.containers),
      "revision_or_image_mismatch",
    );
    const containers = revision.containers.filter((entry) => entry?.name === plan.containerName);
    check(
      containers.length === 1 && containers[0].image === plan.image,
      "revision_or_image_mismatch",
    );
    receipt.checks.revisionAndImage = true;
    const health = await publicJson("/api/health");
    check(
      health.body?.ok === true &&
        health.body.app === "KovaGPT" &&
        health.body.status === "ok" &&
        health.body.service === "kovagpt-web" &&
        health.body.build === plan.sourceSha,
      "health_build_mismatch",
    );
    receipt.checks.healthBuild = true;
    const version = await publicJson("/api/version");
    check(
      version.body?.sha === plan.sourceSha && version.buildHeader === plan.sourceSha,
      "version_build_mismatch",
    );
    receipt.checks.versionBuild = true;
    verifyTarget(await arm(plan.targetId, APP_QUERY));
    receipt.checks.stableTargetAndTraffic = true;
    budget(1);
    receipt.status = "RELEASE_OBSERVED";
  } catch (error) {
    receipt.failureCode = failureCode(error);
  }
  receipt.finishedAt = new Date(current()).toISOString();
  return receipt;
}

export async function productionObservationMain(args = process.argv.slice(2)) {
  check(
    args.length === 2 && args[0] === "--observe" && args[1].startsWith("/"),
    "explicit_observation_required",
  );
  let plan;
  try {
    const stat = statSync(args[1]);
    check(stat.isFile() && stat.size <= MAX_BODY_BYTES, "plan_unreadable");
    plan = JSON.parse(readFileSync(args[1], "utf8"));
  } catch {
    throw new Error("production_observation_plan_unreadable");
  }
  const receipt = await observeProductionRelease(plan);
  console.log(JSON.stringify(receipt));
  return receipt.status === "RELEASE_OBSERVED" ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  productionObservationMain()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(failureCode(error));
      process.exitCode = 1;
    });
}
