import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const STAGING_SHUTDOWN_APP = "ca-kovagpt-staging";
export const STAGING_SHUTDOWN_GROUP = "rg-kovagpt-staging";
export const STAGING_SHUTDOWN_API_VERSION = "2025-07-01";
const ARM = "https://management.azure.com";
const MAX_COMMAND_MS = 30_000;
const MAX_PAGES = 100;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const APP_QUERY = "{id:id,name:name,runningStatus:properties.runningStatus}";
// Projections can drop null entries. The raw count must also match, so neither
// malformed elements nor a missing collection can become an apparent zero.
const PAGE_QUERY = "{value:value[].{id:id,name:name},rawCount:length(value),nextLink:nextLink}";

function check(value, code) {
  if (!value) throw new Error(`staging_shutdown_${code}`);
}

function timestamp(value) {
  check(
    typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value),
    "time_invalid",
  );
  const milliseconds = Date.parse(value);
  check(
    Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value,
    "time_invalid",
  );
  return milliseconds;
}

// This binds a shutdown attempt, not spending/deployment authorization or a watchdog.
export function validateStagingShutdownPlan(plan) {
  check(plan?.version === 1 && UUID.test(plan.subscriptionId ?? ""), "plan_invalid");
  const targetId = `/subscriptions/${plan.subscriptionId}/resourceGroups/${STAGING_SHUTDOWN_GROUP}/providers/Microsoft.App/containerApps/${STAGING_SHUTDOWN_APP}`;
  check(plan.targetId === targetId, "target_mismatch");
  check(
    UUID.test(plan.attemptId ?? "") && /^[a-f0-9]{40}$/u.test(plan.sourceSha ?? ""),
    "attempt_invalid",
  );
  const t0 = timestamp(plan.t0);
  const stopAt = timestamp(plan.stopAt);
  const hardDeadline = timestamp(plan.hardDeadline);
  check(stopAt > t0 && stopAt <= t0 + 3_300_000, "stop_deadline_invalid");
  check(hardDeadline > stopAt && hardDeadline <= t0 + 3_600_000, "hard_deadline_invalid");
  check(hardDeadline - stopAt >= 300_000, "cleanup_reserve_missing");
  return { ...plan, targetId, t0Ms: t0, stopAtMs: stopAt, hardDeadlineMs: hardDeadline };
}

// No shell, interactive login, debug output, token extraction or inherited stdin.
// Child output/errors are deliberately discarded on failure.
export function createAzureShutdownRunner({ execute = execFile } = {}) {
  return (args, { timeoutMs }) =>
    new Promise((resolve) => {
      execute(
        "az",
        args,
        {
          encoding: "utf8",
          timeout: timeoutMs,
          killSignal: "SIGKILL",
          maxBuffer: 256 * 1024,
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

function clockFor(plan, now, monotonic) {
  const wallStart = now();
  const monotonicStart = monotonic();
  check(Number.isFinite(wallStart) && wallStart >= plan.t0Ms, "clock_before_t0");
  // A backward wall-clock correction cannot extend either original deadline.
  const current = () => Math.max(now(), wallStart + monotonic() - monotonicStart);
  return { current, remaining: () => Math.floor(plan.hardDeadlineMs - current()) };
}

function restArgs(plan, method, url, query) {
  return [
    "rest",
    "--method",
    method,
    "--url",
    url,
    "--subscription",
    plan.subscriptionId,
    "--only-show-errors",
    "--output",
    query ? "json" : "none",
    ...(query ? ["--query", query] : []),
  ];
}

function collectionUrl(plan, path, continuation) {
  const initial = `${ARM}${path}?api-version=${STAGING_SHUTDOWN_API_VERSION}`;
  if (!continuation) return initial;
  check(typeof continuation === "string", "pagination_invalid");
  let next;
  try {
    next = new URL(continuation);
  } catch {
    throw new Error("staging_shutdown_pagination_invalid");
  }
  check(
    next.origin === ARM &&
      next.pathname.toLowerCase() === path.toLowerCase() &&
      !next.username &&
      !next.password &&
      !next.hash &&
      next.searchParams.get("api-version") === STAGING_SHUTDOWN_API_VERSION,
    "pagination_scope_mismatch",
  );
  return next.href;
}

function failureCode(error) {
  return /^staging_shutdown_[a-z_]+$/u.test(error?.message ?? "")
    ? error.message
    : "staging_shutdown_command_failed";
}

/** Actual stop executor. Importing the module performs no Azure calls. */
export async function stopStagingAndVerify(
  input,
  {
    run = createAzureShutdownRunner(),
    now = Date.now,
    monotonic = () => performance.now(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    pollIntervalMs = 5_000,
    reason = "explicit_stop",
    clock,
  } = {},
) {
  const plan = validateStagingShutdownPlan(input);
  const timer = clock ?? clockFor(plan, now, monotonic);
  check(
    Number.isInteger(pollIntervalMs) && pollIntervalMs > 0 && pollIntervalMs <= 5_000,
    "poll_interval_invalid",
  );
  check(
    ["explicit_stop", "success", "failure", "timeout", "cancelled"].includes(reason),
    "reason_invalid",
  );
  const receipt = {
    version: 1,
    attemptId: plan.attemptId,
    sourceSha: plan.sourceSha,
    targetId: plan.targetId,
    t0: plan.t0,
    stopAt: plan.stopAt,
    hardDeadline: plan.hardDeadline,
    reason,
    startedAt: new Date(timer.current()).toISOString(),
    stopAcknowledged: false,
    observedStopped: false,
    revisionCount: null,
    replicaCount: null,
    verificationPasses: 0,
    withinOriginalDeadline: false,
    independentDeadlineVerified: false,
    activationQualified: false,
    status: "SHUTDOWN_UNVERIFIED",
    failureCode: null,
  };
  const invoke = async (args, emergencyStop = false) => {
    const remaining = timer.remaining();
    check(remaining > 0 || emergencyStop, "deadline_exceeded");
    // Even if called late, attempt one bounded stop to reduce exposure. This
    // cannot extend the authorization or certify a late shutdown as on-time.
    const timeoutMs = Math.min(MAX_COMMAND_MS, Math.max(1, remaining));
    let result;
    try {
      result = await run(args, {
        timeoutMs: emergencyStop && remaining <= 0 ? MAX_COMMAND_MS : timeoutMs,
      });
    } catch {
      throw new Error("staging_shutdown_command_failed");
    }
    check(result?.ok === true && typeof result.stdout === "string", "command_failed");
    return result.stdout;
  };
  const json = async (url, query) => {
    const raw = await invoke(restArgs(plan, "get", url, query));
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error("staging_shutdown_response_invalid");
    }
  };
  const list = async (path) => {
    const items = [];
    const seen = new Set();
    let continuation;
    do {
      const url = collectionUrl(plan, path, continuation);
      check(!seen.has(url) && seen.size < MAX_PAGES, "pagination_incomplete");
      seen.add(url);
      const page = await json(url, PAGE_QUERY);
      check(
        page &&
          Array.isArray(page.value) &&
          Number.isSafeInteger(page.rawCount) &&
          page.rawCount === page.value.length,
        "collection_invalid",
      );
      for (const item of page.value) {
        check(
          item &&
            typeof item.name === "string" &&
            /^[A-Za-z0-9][A-Za-z0-9_-]{0,253}$/u.test(item.name),
          "resource_invalid",
        );
        check(
          typeof item.id === "string" &&
            item.id.toLowerCase() === `${path}/${item.name}`.toLowerCase(),
          "resource_scope_mismatch",
        );
        check(
          !items.some((previous) => previous.id.toLowerCase() === item.id.toLowerCase()),
          "collection_invalid",
        );
        items.push(item);
      }
      check(
        page.nextLink == null || (typeof page.nextLink === "string" && page.nextLink.length > 0),
        "pagination_invalid",
      );
      continuation = page.nextLink;
    } while (continuation);
    return items;
  };
  const app = async () => {
    const value = await json(
      `${ARM}${plan.targetId}?api-version=${STAGING_SHUTDOWN_API_VERSION}`,
      APP_QUERY,
    );
    check(
      value?.id?.toLowerCase() === plan.targetId.toLowerCase() &&
        value.name === STAGING_SHUTDOWN_APP &&
        typeof value.runningStatus === "string",
      "app_observation_invalid",
    );
    return value.runningStatus;
  };
  try {
    await invoke(
      restArgs(
        plan,
        "post",
        `${ARM}${plan.targetId}/stop?api-version=${STAGING_SHUTDOWN_API_VERSION}`,
      ),
      true,
    );
    receipt.stopAcknowledged = true;
  } catch (error) {
    receipt.failureCode = failureCode(error);
  }
  try {
    let consecutive = 0;
    let previousRevisions = "";
    // Stop may return 202. Observe convergence rather than treating acceptance
    // as completion or following an arbitrary operation/redirect URL.
    while (timer.remaining() > 0) {
      const before = await app();
      const revisions = await list(`${plan.targetId}/revisions`);
      let replicas = 0;
      for (const revision of revisions) replicas += (await list(`${revision.id}/replicas`)).length;
      const afterRevisions = await list(`${plan.targetId}/revisions`);
      const after = await app();
      const names = revisions
        .map((revision) => revision.id.toLowerCase())
        .sort()
        .join("\n");
      const namesAfter = afterRevisions
        .map((revision) => revision.id.toLowerCase())
        .sort()
        .join("\n");
      receipt.observedStopped = before === "Stopped" && after === "Stopped";
      receipt.revisionCount = revisions.length;
      receipt.replicaCount = replicas;
      receipt.verificationPasses += 1;
      const complete = receipt.observedStopped && replicas === 0 && names === namesAfter;
      consecutive = complete ? (previousRevisions === names ? consecutive + 1 : 1) : 0;
      previousRevisions = names;
      if (consecutive >= 2) {
        receipt.withinOriginalDeadline = timer.remaining() >= 0;
        if (receipt.stopAcknowledged && receipt.withinOriginalDeadline)
          receipt.status = "VERIFIED_STOPPED";
        break;
      }
      const remaining = timer.remaining();
      if (remaining > 0) await sleep(Math.min(pollIntervalMs, remaining));
    }
    if (receipt.status !== "VERIFIED_STOPPED" && !receipt.failureCode)
      receipt.failureCode = "staging_shutdown_deadline_exceeded";
  } catch (error) {
    receipt.failureCode ??= failureCode(error);
  }
  receipt.finishedAt = new Date(timer.current()).toISOString();
  return receipt;
}

/** Local finally/timer companion only. Does not establish an independent guard. */
export async function withStagingShutdown(
  input,
  {
    work,
    signal,
    processSignals = process,
    now = Date.now,
    monotonic = () => performance.now(),
    schedule = setTimeout,
    unschedule = clearTimeout,
    ...options
  } = {},
) {
  const plan = validateStagingShutdownPlan(input);
  check(typeof work === "function", "work_required");
  check(
    options.pollIntervalMs === undefined ||
      (Number.isInteger(options.pollIntervalMs) &&
        options.pollIntervalMs > 0 &&
        options.pollIntervalMs <= 5_000),
    "poll_interval_invalid",
  );
  const clock = clockFor(plan, now, monotonic);
  check(clock.current() < plan.stopAtMs, "acceptance_deadline_exceeded");
  const controller = new AbortController();
  let reason;
  let settled = false;
  let workOutcome;
  let abortResolve;
  const aborted = new Promise((resolve) => {
    abortResolve = resolve;
  });
  const cancel = (value) => {
    if (reason) return;
    reason = value;
    controller.abort();
    abortResolve();
  };
  const cancelled = () => cancel("cancelled");
  processSignals.on("SIGINT", cancelled);
  processSignals.on("SIGTERM", cancelled);
  signal?.addEventListener("abort", cancelled, { once: true });
  const timeout = schedule(() => cancel("timeout"), Math.max(0, plan.stopAtMs - clock.current()));
  try {
    if (signal?.aborted) cancelled();
    const running = Promise.resolve().then(async () => {
      try {
        if (controller.signal.aborted) return;
        await work({
          signal: controller.signal,
          stopAt: plan.stopAt,
          hardDeadline: plan.hardDeadline,
        });
        workOutcome = "success";
      } catch {
        workOutcome = "failure";
      } finally {
        settled = true;
      }
    });
    await Promise.race([running, aborted]);
    reason ??= workOutcome ?? "cancelled";
    controller.abort();
    // Let cooperative abort handlers settle through their queued continuations,
    // without awaiting arbitrary work or granting a fresh deadline allowance.
    if (!settled) await new Promise((resolve) => setImmediate(resolve));
    // Quiescence must precede Stop and its observations. Checking only after
    // verification would miss a late writer that settles after the final read.
    const quiescedBeforeStop = settled;
    const receipt = await stopStagingAndVerify(plan, { ...options, now, monotonic, clock, reason });
    receipt.workQuiesced = quiescedBeforeStop;
    if (!quiescedBeforeStop) {
      // A callback that ignores abort could subsequently start staging again.
      // Stop still runs, but no safe completion can be certified here, even if
      // that callback settles during the subsequent observations.
      receipt.status = "SHUTDOWN_UNVERIFIED";
      receipt.failureCode = "staging_shutdown_work_not_quiesced";
    }
    return receipt;
  } finally {
    unschedule(timeout);
    processSignals.off("SIGINT", cancelled);
    processSignals.off("SIGTERM", cancelled);
    signal?.removeEventListener("abort", cancelled);
  }
}

export async function stagingShutdownMain(args = process.argv.slice(2)) {
  check(args.length === 2 && args[0] === "--execute-stop", "explicit_stop_required");
  let plan;
  try {
    plan = JSON.parse(readFileSync(args[1], "utf8"));
  } catch {
    throw new Error("staging_shutdown_plan_unreadable");
  }
  // During an explicit stop, SIGINT/SIGTERM must not cancel its cleanup. This
  // still cannot survive SIGKILL, host loss or revoked Azure credentials.
  const continueCleanup = () => {};
  process.on("SIGINT", continueCleanup);
  process.on("SIGTERM", continueCleanup);
  let receipt;
  try {
    receipt = await stopStagingAndVerify(plan);
  } finally {
    process.off("SIGINT", continueCleanup);
    process.off("SIGTERM", continueCleanup);
  }
  receipt.executorSha256 = createHash("sha256")
    .update(readFileSync(new URL(import.meta.url)))
    .digest("hex");
  console.log(JSON.stringify(receipt));
  return receipt.status === "VERIFIED_STOPPED" ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  stagingShutdownMain()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(failureCode(error));
      process.exitCode = 1;
    });
}
