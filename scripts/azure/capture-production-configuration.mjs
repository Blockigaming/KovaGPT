import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import https from "node:https";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { documentSha256, generateRevisionRolloutPlan } from "./revision-rollout-plan.mjs";

// Collection is a separately approved read, never a deployment or secret export.
export const TARGET =
  "/subscriptions/ab732127-11c3-46a7-a1cb-6ee8d86594f4/resourceGroups/rg-kovagpt-prod/providers/Microsoft.App/containerApps/kovagpt-prod-web";
export const API = "2025-01-01";
export const LIMITS = Object.freeze({
  tokenMs: 15000,
  requestMs: 20000,
  totalMs: 80000,
  maximumBytes: 4 * 1024 * 1024,
  maximumGets: 3,
  retries: 0,
});
const SUBSCRIPTION = TARGET.split("/")[2];
const APP = TARGET.split("/").at(-1);
const ARM = "https://management.azure.com";
const APP_URL = `${ARM}${TARGET}?api-version=${API}`;
const revisionName = (name) =>
  typeof name === "string" &&
  /^kovagpt-prod-web--[a-z][a-z0-9-]{0,62}$/u.test(name) &&
  !name.endsWith("-");
const require = (ok, code) => {
  if (!ok) throw new Error(`configuration_capture_${code}`);
};
export const sanitizedFailure = (error) =>
  /^configuration_capture_[a-z_0-9]+$/u.test(error?.message ?? "")
    ? error.message
    : "configuration_capture_private_operation_failed";
const sameId = (a, b) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();

function validateApp(app) {
  require(sameId(app?.id, TARGET) &&
    app.name === APP &&
    app.type?.toLowerCase() === "microsoft.app/containerapps", "target_mismatch");
  require(app.properties?.configuration &&
    app.properties?.template &&
    revisionName(app.properties.latestReadyRevisionName), "app_response_incomplete");
}

function validatePrevious(previous, name) {
  require(sameId(previous?.id, `${TARGET}/revisions/${name}`) &&
    previous.name === name &&
    previous.properties?.template, "revision_mismatch");
}

function allowedUrl(url) {
  if (url === APP_URL) return true;
  const prefix = `${ARM}${TARGET}/revisions/`;
  const suffix = `?api-version=${API}`;
  return (
    typeof url === "string" &&
    url.startsWith(prefix) &&
    url.endsWith(suffix) &&
    revisionName(url.slice(prefix.length, -suffix.length))
  );
}

// Native HTTPS makes exactly one request. No redirect, pagination or SDK retry.
export function armGet(url, token, timeoutMs, request = https.request) {
  require(allowedUrl(url), "url_not_allowed");
  require(typeof token === "string" && /^[A-Za-z0-9._~-]+$/u.test(token), "token_invalid");
  require(Number.isInteger(timeoutMs) &&
    timeoutMs > 0 &&
    timeoutMs <= LIMITS.requestMs, "timeout_invalid");
  return new Promise((resolveResult, reject) => {
    let settled = false;
    let req;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        req?.destroy();
        reject(error);
      } else resolveResult(result);
    };
    const failure = (code) => finish(new Error(`configuration_capture_${code}`));
    const timer = setTimeout(() => failure("request_timeout"), timeoutMs);
    try {
      req = request(
        url,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          agent: false,
          rejectUnauthorized: true,
        },
        (response) => {
          if (response.statusCode !== 200) {
            // Do not retain or print error bodies, including authentication errors.
            response.destroy();
            failure(
              Number.isInteger(response.statusCode)
                ? `http_${response.statusCode}`
                : "http_invalid",
            );
            return;
          }
          const chunks = [];
          let bytes = 0;
          response.on("data", (chunk) => {
            bytes += chunk.length;
            if (bytes > LIMITS.maximumBytes) {
              response.destroy();
              failure("response_too_large");
            } else chunks.push(chunk);
          });
          response.on("error", () => failure("response_interrupted"));
          response.on("aborted", () => failure("response_interrupted"));
          response.on("end", () => {
            try {
              finish(null, JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch {
              failure("response_json_invalid");
            }
          });
        },
      );
      req.on("error", () => failure("network_failed"));
      req.end();
    } catch {
      failure("network_failed");
    }
  });
}

export function acquireAzureToken(run = spawnSync) {
  const result = run(
    "az",
    [
      "account",
      "get-access-token",
      "--subscription",
      SUBSCRIPTION,
      "--resource",
      `${ARM}/`,
      "--query",
      "{accessToken:accessToken,subscription:subscription}",
      "--output",
      "json",
      "--only-show-errors",
    ],
    {
      encoding: "utf8",
      timeout: LIMITS.tokenMs,
      maxBuffer: 256 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
      env: {
        ...process.env,
        AZURE_CORE_COLLECT_TELEMETRY: "0",
        AZURE_CORE_NO_COLOR: "1",
        AZURE_CORE_ONLY_SHOW_ERRORS: "true",
      },
    },
  );
  try {
    require(result.status === 0 && !result.error, "azure_token_unavailable");
    let value;
    try {
      value = JSON.parse(result.stdout);
    } catch {
      require(false, "azure_token_json_invalid");
    }
    require(value.subscription === SUBSCRIPTION &&
      typeof value.accessToken === "string" &&
      value.accessToken.length > 0, "azure_token_binding_invalid");
    return value.accessToken;
  } finally {
    result.stdout = null;
    result.stderr = null;
  }
}

function privateDirectory(path) {
  const stat = lstatSync(path);
  require(stat.isDirectory() &&
    !stat.isSymbolicLink() &&
    realpathSync(path) === resolve(path) &&
    stat.uid === process.getuid() &&
    (stat.mode & 0o077) === 0, "private_directory_required");
}

function savePrivate(path, value) {
  const fd = openSync(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export async function captureProductionConfiguration(
  { outputDirectory, sourceSha, authorizeRead = false },
  { get = armGet, acquireToken = acquireAzureToken, now = () => new Date().toISOString() } = {},
) {
  require(authorizeRead === true &&
    /^[a-f0-9]{40}$/u.test(sourceSha ?? ""), "explicit_read_authorization_required");
  const directory = resolve(outputDirectory);
  privateDirectory(dirname(directory));
  // Existing/partial capture is never replaced or retried, even if it failed.
  try {
    mkdirSync(directory, { mode: 0o700 });
  } catch {
    require(false, "output_already_exists_or_unavailable");
  }
  privateDirectory(directory);
  const started = Date.now();
  const receipt = {
    schemaVersion: 1,
    kind: "production-configuration-capture",
    attemptId: randomUUID(),
    stage: "CREATED_NO_READ_DISPATCHED",
    sourceSha,
    targetResourceId: TARGET,
    apiVersion: API,
    startedAt: now(),
    limits: LIMITS,
    reads: [],
    authorizationConsumed: false,
    secretValueEndpointsCalled: 0,
    productionWrites: 0,
    incrementalSpendUsd: 0,
  };
  const checkpoint = () => {
    savePrivate(`${directory}/receipt.next.json`, receipt);
    renameSync(`${directory}/receipt.next.json`, `${directory}/receipt.json`);
    const fd = openSync(directory, constants.O_RDONLY);
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  };
  checkpoint();
  let token;
  try {
    token = await acquireToken();
    const read = async (name, url, validate) => {
      const remaining = LIMITS.totalMs - (Date.now() - started);
      require(remaining > 0 &&
        receipt.reads.length < LIMITS.maximumGets &&
        allowedUrl(url), "execution_bound_exceeded");
      const attempt = {
        name,
        method: "GET",
        url,
        startedAt: now(),
        outcome: "DISPATCH_INTENT_OUTCOME_UNKNOWN",
      };
      receipt.reads.push(attempt);
      receipt.authorizationConsumed = true;
      receipt.stage = "READ_DISPATCHED_RECONCILE_BEFORE_ANY_FUTURE_ATTEMPT";
      checkpoint();
      const value = await get(url, token, Math.min(remaining, LIMITS.requestMs));
      validate(value);
      savePrivate(`${directory}/${name}.json`, value);
      attempt.completedAt = now();
      attempt.outcome = "SUCCESS";
      attempt.documentSha256 = documentSha256(value);
      checkpoint();
      return value;
    };
    const baseline = await read("baseline", APP_URL, validateApp);
    const previous = baseline.properties.latestReadyRevisionName;
    const previousRevision = await read(
      "previous-revision",
      `${ARM}${TARGET}/revisions/${previous}?api-version=${API}`,
      (value) => validatePrevious(value, previous),
    );
    const confirmation = await read("confirmation", APP_URL, validateApp);
    require(documentSha256(baseline) === documentSha256(confirmation), "configuration_drift");
    receipt.stage = "CAPTURE_COMPLETE_NOT_DEPLOYMENT_ACCEPTANCE";
    receipt.completedAt = now();
    receipt.baselineSha256 = documentSha256(baseline);
    receipt.previousRevisionSha256 = documentSha256(previousRevision);
    receipt.observedAt = receipt.reads[0].completedAt;
    receipt.remainingGets = 0;
    receipt.unusedAllowanceReleased = true;
    checkpoint();
    return { baseline, previousRevision, confirmation, receipt };
  } catch (error) {
    receipt.stage = "STOPPED_RECONCILE_SAVED_READS_NO_RETRY";
    receipt.errorCode = sanitizedFailure(error);
    receipt.completedAt = now();
    receipt.remainingGets = 0;
    receipt.unusedAllowanceReleased = true;
    checkpoint();
    // Do not attach the original error: its cause may contain a token or body.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(receipt.errorCode);
  } finally {
    // No token file/argv/log is ever created; release references (not a claim of
    // cryptographic RAM erasure in JavaScript). The short-lived process exits.
    token = null;
  }
}

// Offline bridge: use real approved image/source/canary inputs, not guessed
// defaults. Run the unchanged preservation checker before returning anything.
export function capturedRolloutInput(
  { baseline, previousRevision, confirmation, receipt },
  scope,
  canary,
  options = {},
) {
  require(receipt?.stage === "CAPTURE_COMPLETE_NOT_DEPLOYMENT_ACCEPTANCE" &&
    receipt.targetResourceId === TARGET &&
    receipt.apiVersion === API &&
    receipt.reads?.length === 3 &&
    receipt.reads.every((r) => r.outcome === "SUCCESS"), "receipt_incomplete");
  validateApp(baseline);
  validatePrevious(previousRevision, baseline.properties.latestReadyRevisionName);
  require(receipt.baselineSha256 === documentSha256(baseline) &&
    documentSha256(baseline) === documentSha256(confirmation) &&
    receipt.previousRevisionSha256 === documentSha256(previousRevision), "capture_hash_mismatch");
  const expectedUrls = [
    APP_URL,
    `${ARM}${TARGET}/revisions/${previousRevision.name}?api-version=${API}`,
    APP_URL,
  ];
  require(/^[a-f0-9]{40}$/u.test(receipt.sourceSha ?? "") &&
    receipt.observedAt === receipt.reads[0].completedAt &&
    receipt.reads.every(
      (read, index) =>
        read.method === "GET" &&
        read.url === expectedUrls[index] &&
        read.documentSha256 === documentSha256([baseline, previousRevision, confirmation][index]),
    ), "receipt_binding_mismatch");
  require(scope?.environment === "production" &&
    scope.targetResourceId === TARGET, "scope_mismatch");
  const input = {
    baseline,
    previousRevision,
    scope,
    canary,
    inventory: {
      complete: true,
      apiVersion: API,
      observedAt: receipt.observedAt,
      receiptSha256: documentSha256(receipt),
      baselineSha256: receipt.baselineSha256,
      previousRevisionSha256: receipt.previousRevisionSha256,
    },
  };
  generateRevisionRolloutPlan(input, options);
  return input;
}

function verifySource(sha) {
  require(/^[a-f0-9]{40}$/u.test(sha ?? ""), "approved_source_required");
  const cwd = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  for (const [args, expected] of [
    [["rev-parse", "HEAD"], sha],
    [["status", "--porcelain", "--untracked-files=all"], ""],
  ]) {
    const result = spawnSync("git", args, {
      cwd,
      encoding: "utf8",
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    });
    require(result.status === 0 &&
      !result.error &&
      result.stdout.trim() === expected, "source_not_clean_or_mismatch");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    require(process.argv.length === 5 &&
      process.argv[2] === "--execute-approved-read", "explicit_read_authorization_required");
    process.umask(0o077);
    verifySource(process.argv[3]);
    await captureProductionConfiguration({
      authorizeRead: true,
      sourceSha: process.argv[3],
      outputDirectory: process.argv[4],
    });
    console.log("PRODUCTION_CONFIGURATION_CAPTURE=PASS GETs=3 writes=0 deploymentAcceptance=false");
  } catch (error) {
    console.error(sanitizedFailure(error));
    process.exitCode = 1;
  }
}
