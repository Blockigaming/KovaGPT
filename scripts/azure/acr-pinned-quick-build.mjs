import https from "node:https";
import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const ACR_API_VERSION = "2025-03-01-preview";
export const ACR_RESOURCE_ID =
  "/subscriptions/ab732127-11c3-46a7-a1cb-6ee8d86594f4/resourceGroups/rg-kovagpt-dev/providers/Microsoft.ContainerRegistry/registries/kovagptacr";
export const ACR_CPU = 2;
export const ACR_SERVER_SECONDS = 1200;
export const ACR_RECONCILIATION_RESERVE_MS = 120_000;
const fail = (condition, code) => {
  if (!condition) throw new Error(`production_candidate_${code}`);
};

// Native HTTPS deliberately has no redirect handler or retry path. Never use
// raw provider errors as diagnostics. The ARM token stays in process memory.
export function requestArmOnce({ method, url, token, body, timeoutMs }, request = https.request) {
  return new Promise((resolveResult, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      reject(new Error("production_candidate_arm_target_invalid"));
      return;
    }
    const runSuffix = target.pathname.startsWith(`${ACR_RESOURCE_ID}/runs/`)
      ? target.pathname.slice(`${ACR_RESOURCE_ID}/runs/`.length)
      : "";
    const cancel =
      method === "POST" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\/cancel$/u.test(runSuffix);
    if (
      target.origin !== "https://management.azure.com" ||
      target.username ||
      target.password ||
      target.hash ||
      target.search !== `?api-version=${ACR_API_VERSION}` ||
      !(
        (target.pathname === `${ACR_RESOURCE_ID}/scheduleRun` && method === "POST") ||
        (/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(runSuffix) && method === "GET") ||
        cancel
      ) ||
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 60_000
    ) {
      reject(new Error("production_candidate_arm_target_invalid"));
      return;
    }
    let finished = false;
    let timer;
    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error) reject(new Error(`production_candidate_${error}`));
      else resolveResult(value);
    };
    const content = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      target,
      {
        method,
        rejectUnauthorized: true,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(content === undefined
            ? {}
            : { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(content) }),
        },
      },
      (response) => {
        if (response.statusCode !== 200) {
          finish("arm_http_status_rejected");
          response.destroy();
          return;
        }
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > 1024 * 1024) {
            finish("arm_response_limit");
            req.destroy();
          } else chunks.push(chunk);
        });
        response.on("error", () => finish("arm_response_failed"));
        response.on("end", () => {
          if (finished) return;
          try {
            finish(null, cancel ? null : JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            finish("arm_response_invalid");
          }
        });
      },
    );
    timer = setTimeout(() => {
      finish("arm_request_timeout");
      req.destroy();
    }, timeoutMs);
    req.on("error", () => finish("arm_request_failed"));
    req.end(content);
  });
}

function identifiedRun(raw, expectedRunId) {
  const run = raw?.properties;
  fail(run && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(run.runId ?? ""), "acr_run_id_invalid");
  fail(!expectedRunId || run.runId === expectedRunId, "acr_run_id_changed");
  fail(raw.id === `${ACR_RESOURCE_ID}/runs/${run.runId}`, "acr_run_resource_mismatch");
  return run;
}

function knownRun(raw, expectedRunId) {
  const run = identifiedRun(raw, expectedRunId);
  fail(
    [
      "Queued",
      "Started",
      "Running",
      "Succeeded",
      "Failed",
      "Canceled",
      "Error",
      "Timeout",
    ].includes(run.status),
    "acr_status_invalid",
  );
  return run;
}

function runCpu(run) {
  const configuration = run.agentConfiguration;
  if (configuration == null) return { cpu: null, observation: "unreported" };
  if (typeof configuration !== "object" || Array.isArray(configuration))
    return { cpu: null, observation: "invalid" };
  const cpu = configuration.cpu;
  if (cpu == null) return { cpu: null, observation: "unreported" };
  if (typeof cpu !== "number" || !Number.isFinite(cpu))
    return { cpu: null, observation: "invalid" };
  return { cpu, observation: cpu === ACR_CPU ? "verified" : "mismatch" };
}

function sanitizedRun(raw, expectedRunId, expectedTag, submission = false) {
  const run = knownRun(raw, expectedRunId);
  const { cpu, observation } = runCpu(run);
  fail(["verified", "unreported"].includes(observation), "acr_cpu_mismatch");
  // scheduleRun may omit CPU even in its terminal-looking response. Only a
  // subsequent GET can qualify the candidate; queued metadata may still settle.
  fail(
    observation === "verified" || submission || (run.status === "Queued" && run.startTime == null),
    "acr_cpu_unreported",
  );
  const outputImages = (run.outputImages ?? []).map((image) => {
    fail(
      image?.registry === "kovagptacr-dte9hugbhjghcyb8.azurecr.io" &&
        image.repository === "kovagpt-web" &&
        image.tag === expectedTag &&
        /^sha256:[a-f0-9]{64}$/u.test(image.digest ?? ""),
      "output_image_mismatch",
    );
    return {
      registry: image.registry,
      repository: image.repository,
      tag: image.tag,
      digest: image.digest,
    };
  });
  return { runId: run.runId, status: run.status, agentCpu: cpu, outputImages };
}

export async function schedulePinnedAcrBuild(
  input,
  {
    request = requestArmOnce,
    now = () => performance.now(),
    sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  } = {},
) {
  fail(input?.resourceId === ACR_RESOURCE_ID, "registry_resource_mismatch");
  fail(
    typeof input.token === "string" && /^[A-Za-z0-9._~-]{32,}$/u.test(input.token),
    "arm_token_unavailable",
  );
  fail(
    input.body?.type === "DockerBuildRequest" &&
      input.body.agentConfiguration?.cpu === ACR_CPU &&
      input.body.timeout === ACR_SERVER_SECONDS,
    "acr_request_limits_invalid",
  );
  const sourceSha = /^https:\/\/github\.com\/Blockigaming\/KovaGPT\.git#([a-f0-9]{40})$/u.exec(
    input.body.sourceLocation ?? "",
  )?.[1];
  const imageName = input.body.imageNames?.length === 1 ? input.body.imageNames[0] : "";
  const tag = typeof imageName === "string" ? imageName.replace(/^kovagpt-web:/u, "") : "";
  fail(
    sourceSha &&
      new RegExp(`^production-candidate-${sourceSha}-[1-9][0-9]*-[1-9][0-9]*$`, "u").test(tag) &&
      imageName === `kovagpt-web:${tag}`,
    "acr_source_tag_binding_invalid",
  );
  fail(
    Number.isInteger(input.budgetMs) &&
      input.budgetMs <= 1_500_000 &&
      input.budgetMs >= ACR_SERVER_SECONDS * 1000 + ACR_RECONCILIATION_RESERVE_MS,
    "build_submission_budget_insufficient",
  );
  const deadline = now() + input.budgetMs;
  const receipt = {
    schemaVersion: 1,
    operation: "one-cpu-pinned-acr-quick-build",
    state: "SUBMISSION_RESERVED",
    authorizationConsumed: true,
    schedulePostAttempts: 1,
    retries: 0,
    redirectsFollowed: 0,
    resourceId: ACR_RESOURCE_ID,
    sourceSha,
    tag,
    apiVersion: ACR_API_VERSION,
    agentCpu: ACR_CPU, // Legacy receipt field describes the requested allocation.
    requestedAgentCpu: ACR_CPU,
    observedAgentCpu: null,
    cpuObservation: "unreported",
    cancelPostAttempts: 0,
    serverTimeoutSeconds: ACR_SERVER_SECONDS,
    remoteOutcome: "UNKNOWN",
    remoteCleanupVerified: false,
  };
  const receiptPath = input.receiptPath;
  fail(!existsSync(`${receiptPath}.next`), "prior_partial_receipt_requires_reconciliation");
  const update = () => {
    const temporary = `${receiptPath}.next`;
    let owned = false;
    try {
      writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, {
        flag: "wx",
        mode: 0o600,
      });
      owned = true;
      renameSync(temporary, receiptPath);
      owned = false;
    } finally {
      if (owned) unlinkSync(temporary);
    }
  };
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  // Prove the exact atomic update path works before spending the submission.
  update();
  const call = (method, suffix, body, cleanup = false) => {
    const remaining = Math.floor(deadline - now());
    const reserved = cleanup ? 1000 : ACR_RECONCILIATION_RESERVE_MS;
    fail(remaining > reserved, "client_deadline_exceeded");
    return request({
      method,
      url: `https://management.azure.com${ACR_RESOURCE_ID}${suffix}?api-version=${ACR_API_VERSION}`,
      token: input.token,
      body,
      timeoutMs: Math.min(cleanup ? 30_000 : 60_000, remaining - reserved),
    });
  };
  const terminal = (run) => {
    receipt.state = "REMOTE_TERMINAL";
    receipt.remoteOutcome = run.status;
    receipt.remoteCleanupVerified = true;
    update();
  };
  const observe = (raw, source) => {
    const run = knownRun(raw, receipt.runId);
    const { cpu, observation } = runCpu(run);
    receipt.lastStatus = run.status;
    receipt.observedAgentCpu = cpu;
    receipt.cpuObservation = observation;
    receipt.cpuObservationSource = source;
    update();
    return run;
  };
  const cancelAndReconcile = async () => {
    // Only the run ID returned by our one bound submission can be cancelled.
    fail(
      receipt.runId &&
        receipt.sourceSha === sourceSha &&
        receipt.tag === tag &&
        receipt.cancelPostAttempts === 0,
      "owned_run_cancel_binding_invalid",
    );
    receipt.cancelPostAttempts = 1;
    receipt.state = "CANCEL_RESERVED";
    update();
    try {
      await call("POST", `/runs/${receipt.runId}/cancel`, undefined, true);
    } catch {
      receipt.cancelOutcome = "UNKNOWN";
      update();
    }
    while (deadline - now() > 1000) {
      // Cleanup proves only that our bound run stopped. A CPU violation must not
      // prevent observing its terminal status or qualify its image as successful.
      const run = observe(
        await call("GET", `/runs/${receipt.runId}`, undefined, true),
        "cleanup-get",
      );
      if (!["Queued", "Started", "Running"].includes(run.status)) {
        terminal(run);
        return;
      }
      await sleep(Math.min(5000, Math.max(0, deadline - now() - 1000)));
    }
    throw new Error("production_candidate_remote_cleanup_unconfirmed");
  };
  try {
    fail(
      deadline - now() >= ACR_SERVER_SECONDS * 1000 + ACR_RECONCILIATION_RESERVE_MS,
      "build_submission_budget_insufficient",
    );
    const pollDeadline = Math.min(
      now() + ACR_SERVER_SECONDS * 1000,
      deadline - ACR_RECONCILIATION_RESERVE_MS,
    );
    const raw = await call("POST", "/scheduleRun", input.body);
    receipt.runId = identifiedRun(raw).runId;
    receipt.state = "REMOTE_RUN_IDENTIFIED";
    observe(raw, "schedule-response");
    sanitizedRun(raw, receipt.runId, tag, true);
    let run;
    while (true) {
      if (now() >= pollDeadline) {
        await cancelAndReconcile();
        throw new Error("production_candidate_build_wall_budget_exhausted");
      }
      // Never turn a minimal submission response into CPU or success proof.
      const response = await call("GET", `/runs/${receipt.runId}`);
      const observed = observe(response, "run-get");
      if (!["Queued", "Started", "Running"].includes(observed.status)) terminal(observed);
      fail(now() < pollDeadline, "build_wall_budget_exhausted");
      run = sanitizedRun(response, receipt.runId, tag);
      if (!["Queued", "Started", "Running"].includes(run.status)) break;
      await sleep(Math.min(10_000, pollDeadline - now()));
    }
    fail(run.status === "Succeeded", "acr_build_not_succeeded");
    return run;
  } catch (error) {
    if (receipt.runId && receipt.remoteOutcome === "UNKNOWN" && receipt.cancelPostAttempts === 0) {
      try {
        await cancelAndReconcile();
      } catch {
        /* Preserve unknown; never resubmit or repeat cancel. */
      }
    }
    receipt.state =
      receipt.remoteOutcome === "UNKNOWN" ? "CONSUMED_OUTCOME_UNCERTAIN" : "REMOTE_TERMINAL";
    receipt.failureCode = /^production_candidate_[a-z_]+$/u.test(error?.message ?? "")
      ? error.message
      : "production_candidate_build_reconciliation_failed";
    update();
    throw new Error(receipt.failureCode);
  } finally {
    input.token = undefined;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    fail(process.argv.length === 2, "acr_helper_arguments_invalid");
    const bytes = readFileSync(0);
    fail(bytes.length <= 1024 * 1024, "acr_helper_input_limit");
    const input = JSON.parse(bytes.toString("utf8"));
    const result = await schedulePinnedAcrBuild(input);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(
      `${/^production_candidate_[a-z_]+$/u.test(error?.message ?? "") ? error.message : "production_candidate_acr_helper_failed"}\n`,
    );
    process.exitCode = 1;
  }
}
