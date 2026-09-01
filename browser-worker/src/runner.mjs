import { createHash, randomUUID } from "node:crypto";

function required(value, code) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(code);
  return normalized;
}

function boundedInteger(value, fallback, minimum, maximum, code) {
  const parsed = value == null || String(value).trim() === "" ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(code);
  }
  return parsed;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeFailure(reason) {
  if (reason instanceof Error && reason.name === "AbortError") {
    return "The browser research run was cancelled before completion.";
  }
  if (reason?.retryable === false) {
    return "The browser research run could not be completed with the supplied sources.";
  }
  return "The browser research worker could not complete this run.";
}

function sourceUrls(job) {
  const values = job?.input?.sourceUrls;
  if (!Array.isArray(values) || values.length < 1 || values.length > 10) {
    throw new Error("browser_work_sources_invalid");
  }
  const normalized = values.map((value) => required(value, "browser_work_source_invalid"));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("browser_work_sources_duplicate");
  }
  return normalized;
}

function objective(job) {
  const value = required(job?.input?.objective, "browser_work_objective_invalid");
  if (value.length > 12_000) throw new Error("browser_work_objective_invalid");
  return value;
}

function assertClaim(job, now) {
  if (
    !job ||
    typeof job.job_id !== "string" ||
    typeof job.owner_id !== "string" ||
    typeof job.attempt_id !== "string" ||
    typeof job.lease_token !== "string" ||
    !Number.isInteger(job.attempt_number) ||
    job.attempt_number < 1 ||
    !Number.isInteger(job.state_version) ||
    job.state_version < 1 ||
    !Number.isInteger(job.token_budget) ||
    job.token_budget < 1_000 ||
    job.token_budget > 50_000 ||
    !Array.isArray(job.allowed_domains) ||
    job.allowed_domains.length < 1 ||
    job.allowed_domains.length > 10 ||
    !["plus", "pro"].includes(job.entitlement)
  ) {
    throw new Error("browser_work_claim_invalid");
  }
  const expires = Date.parse(job.lease_expires_at);
  if (!Number.isFinite(expires) || expires <= now()) {
    throw new Error("browser_work_lease_invalid");
  }
  if (!Array.isArray(job.tool_policy?.allowed_tools)) {
    throw new Error("browser_work_tool_policy_invalid");
  }
  if (
    job.tool_policy.allowed_tools.length !== 1 ||
    job.tool_policy.allowed_tools[0] !== "browser.read"
  ) {
    throw new Error("browser_work_tool_policy_invalid");
  }
  objective(job);
  sourceUrls(job);
}

function evidencePath(job, label, extension, bytes) {
  return `${job.owner_id}/${job.job_id}/${job.attempt_id}/${label}-${sha256(bytes).slice(0, 20)}.${extension}`;
}

function reportTitle(objectiveValue) {
  const firstLine = objectiveValue.split(/\r?\n/u)[0].replace(/\s+/gu, " ").trim();
  return (firstLine || "Research report").slice(0, 120);
}

function sourceMarkdown(sources) {
  return sources.map((source, index) => `${index + 1}. [${source.title}](${source.url})`).join("\n");
}

function normalizeReport(report, sources) {
  const body = String(report ?? "").trim().slice(0, 100_000);
  if (!body) throw new Error("browser_research_report_empty");
  const hasSources = /(^|\n)#+\s+Sources\b/iu.test(body);
  return `${body}${hasSources ? "" : `\n\n## Sources\n\n${sourceMarkdown(sources)}`}\n`;
}

async function uploadEvidence(dependencies, job, capture, index) {
  const textBytes = Buffer.from(
    JSON.stringify(
      {
        schemaVersion: 1,
        title: capture.title,
        url: capture.url,
        status: capture.status,
        contentType: capture.contentType,
        text: capture.text,
      },
      null,
      2,
    ),
  );
  const screenshotBytes = Buffer.from(capture.screenshot);
  const textPath = evidencePath(job, `source-${index + 1}`, "json", textBytes);
  const screenshotPath = evidencePath(job, `source-${index + 1}`, "png", screenshotBytes);

  await dependencies.upload({ path: textPath, body: textBytes, contentType: "application/json" });
  await dependencies.upload({
    path: screenshotPath,
    body: screenshotBytes,
    contentType: "image/png",
  });

  return [
    {
      kind: "json",
      storage_path: textPath,
      mime_type: "application/json",
      byte_size: textBytes.byteLength,
      integrity_hash: sha256(textBytes),
      metadata: {
        role: "source_capture",
        source_index: index + 1,
        destination_host: capture.hostname,
      },
    },
    {
      kind: "screenshot",
      storage_path: screenshotPath,
      mime_type: "image/png",
      byte_size: screenshotBytes.byteLength,
      integrity_hash: sha256(screenshotBytes),
      metadata: {
        role: "source_screenshot",
        source_index: index + 1,
        destination_host: capture.hostname,
      },
    },
  ];
}

async function processClaim(dependencies, job, options) {
  assertClaim(job, dependencies.now);
  await dependencies.heartbeatJob(job, options.leaseSeconds);
  const captures = [];
  const urls = sourceUrls(job);

  for (let index = 0; index < urls.length; index += 1) {
    const url = urls[index];
    const idempotencyKey = `browser-read-${sha256(url)}`.slice(0, 200);
    try {
      const capture = await dependencies.capture({
        sourceUrl: url,
        allowedDomains: job.allowed_domains,
        navigationTimeoutMs: options.navigationTimeoutMs,
      });
      const evidence = await uploadEvidence(dependencies, job, capture, index);
      await dependencies.recordToolResult(job, {
        idempotencyKey,
        destination: capture.url,
        status: "succeeded",
        responsePayload: {
          title: capture.title,
          status: capture.status,
          text_chars: capture.text.length,
          content_type: capture.contentType,
          pinned_address_family: capture.pinnedAddressFamily,
        },
        safeError: null,
        evidence,
      });
      captures.push({
        title: capture.title,
        url: capture.url,
        text: capture.text,
      });
    } catch {
      await dependencies.recordToolResult(job, {
        idempotencyKey,
        destination: url,
        status: "failed",
        responsePayload: null,
        safeError: "The source could not be read safely.",
        evidence: [],
      });
    }
    await dependencies.heartbeatJob(job, options.leaseSeconds);
  }

  if (captures.length === 0) {
    return dependencies.settleFailure(job, {
      failureType: "policy",
      safeError: "None of the supplied sources could be read safely.",
      retryable: false,
    });
  }

  const controller = new AbortController();
  const synthesis = await dependencies.synthesize({
    objective: objective(job),
    sources: captures,
    tokenBudget: job.token_budget,
    signal: controller.signal,
  });
  await dependencies.heartbeatJob(job, options.leaseSeconds);

  const report = normalizeReport(synthesis.report, captures);
  const reportBytes = Buffer.from(report, "utf8");
  const reportPath = evidencePath(job, "research-report", "md", reportBytes);
  await dependencies.upload({ path: reportPath, body: reportBytes, contentType: "text/plain" });

  const result = {
    summary: report.slice(0, 12_000),
    content: report,
    runtime: "browser_research_v2",
    source_count: captures.length,
    citations: captures.map((source, index) => ({
      index: index + 1,
      title: source.title,
      url: source.url,
    })),
  };
  const providerReceipt = sha256(
    JSON.stringify({
      requestId: synthesis.providerRequestId,
      reportHash: sha256(reportBytes),
      sourceHashes: captures.map((source) => sha256(source.text)),
    }),
  );

  // A lost response after this fenced settlement is ambiguous. The caller must
  // never convert it into a contradictory failure settlement.
  return dependencies.settleSuccess(job, {
    providerRequestId: synthesis.providerRequestId,
    providerReceipt,
    usage: synthesis.usage,
    result,
    reportTitle: reportTitle(objective(job)),
    reportStoragePath: reportPath,
    reportByteSize: reportBytes.byteLength,
    reportIntegrityHash: sha256(reportBytes),
  });
}

export async function runBrowserWorkOnce(dependencies, environment = process.env) {
  if (environment.KOVA_WORK_BROWSER_WORKER_ENABLED !== "1") {
    throw new Error("browser_work_worker_disabled");
  }
  const workerEnvironment = required(
    environment.KOVA_WORK_BROWSER_ENVIRONMENT,
    "browser_work_environment_required",
  );
  if (!/^[a-z0-9][a-z0-9-]{0,49}$/u.test(workerEnvironment)) {
    throw new Error("browser_work_environment_invalid");
  }
  const revision = required(
    environment.KOVA_WORKER_REVISION ?? environment.CONTAINER_APP_JOB_EXECUTION_NAME,
    "browser_work_revision_required",
  ).slice(0, 200);
  const sourceSha = required(
    environment.KOVA_SOURCE_SHA ?? environment.KOVA_BUILD_SHA,
    "browser_work_source_sha_required",
  );
  if (!/^[a-f0-9]{40}$/u.test(sourceSha)) throw new Error("browser_work_source_sha_invalid");

  const capacity = boundedInteger(
    environment.KOVA_WORK_BROWSER_CAPACITY,
    1,
    1,
    4,
    "browser_work_capacity_invalid",
  );
  const limit = boundedInteger(
    environment.KOVA_WORK_BROWSER_BATCH_LIMIT,
    1,
    1,
    4,
    "browser_work_batch_limit_invalid",
  );
  const leaseSeconds = boundedInteger(
    environment.KOVA_WORK_BROWSER_LEASE_SECONDS,
    300,
    120,
    900,
    "browser_work_lease_invalid",
  );
  const navigationTimeoutMs = boundedInteger(
    environment.KOVA_WORK_BROWSER_NAVIGATION_TIMEOUT_MS,
    20_000,
    5_000,
    60_000,
    "browser_work_navigation_timeout_invalid",
  );
  const readinessStaleSeconds = boundedInteger(
    environment.KOVA_WORK_BROWSER_READINESS_STALE_SECONDS,
    600,
    30,
    3_600,
    "browser_work_readiness_stale_invalid",
  );
  const host = dependencies.hostname().replace(/[^a-zA-Z0-9._-]/gu, "-").slice(0, 80);
  const workerId = `${workerEnvironment}-browser-${revision}-${host}-${randomUUID().slice(0, 8)}`.slice(
    0,
    240,
  );
  const heartbeatBase = { environment: workerEnvironment, revision, sourceSha, capacity };

  dependencies.log("info", "work_browser_worker_started", {
    environment: workerEnvironment,
    revision,
    sourceSha,
    workerId,
    capacity,
    limit,
  });
  await dependencies.recordWorkerHeartbeat({
    ...heartbeatBase,
    status: "running",
    activeJobs: 0,
    safeError: null,
  });

  try {
    await dependencies.recover();
    const results = [];
    const seen = new Set();
    while (results.length < limit) {
      const job = await dependencies.claim({
        workerId,
        workerRevision: revision,
        sourceSha,
        capacity,
        leaseSeconds,
      });
      if (!job) break;
      if (seen.has(job.job_id)) throw new Error("browser_work_repeated_claim");
      seen.add(job.job_id);
      await dependencies.recordWorkerHeartbeat({
        ...heartbeatBase,
        status: "running",
        activeJobs: 1,
        safeError: null,
      });
      results.push(await processClaim(dependencies, job, { leaseSeconds, navigationTimeoutMs }));
      await dependencies.recordWorkerHeartbeat({
        ...heartbeatBase,
        status: "running",
        activeJobs: 0,
        safeError: null,
      });
    }

    await dependencies.recordWorkerHeartbeat({
      ...heartbeatBase,
      status: "healthy",
      activeJobs: 0,
      safeError: null,
    });
    const readiness = await dependencies.readReadiness({
      environment: workerEnvironment,
      sourceSha,
      staleSeconds: readinessStaleSeconds,
    });
    if (
      !readiness?.healthy ||
      readiness.sourceSha !== sourceSha ||
      readiness.expiredAttempts !== 0 ||
      readiness.runtimeEnabled !== true
    ) {
      throw new Error("browser_work_readiness_unhealthy");
    }

    const summary = {
      environment: workerEnvironment,
      revision,
      sourceSha,
      workerId,
      claimed: results.length,
      complete: results.filter((result) => result?.status === "complete").length,
      failed: results.filter((result) => result?.status === "failed").length,
    };
    dependencies.log("info", "work_browser_worker_completed", summary);
    return summary;
  } catch (reason) {
    const safeError = safeFailure(reason);
    try {
      await dependencies.recordWorkerHeartbeat({
        ...heartbeatBase,
        status: "failed",
        activeJobs: 0,
        safeError,
      });
    } catch (heartbeatReason) {
      dependencies.log("error", "work_browser_failure_heartbeat_failed", {
        environment: workerEnvironment,
        revision,
        sourceSha,
        errorName: heartbeatReason instanceof Error ? heartbeatReason.name : "UnknownError",
      });
    }
    dependencies.log("error", "work_browser_worker_failed", {
      environment: workerEnvironment,
      revision,
      sourceSha,
      errorName: reason instanceof Error ? reason.name : "UnknownError",
    });
    throw new Error(safeError, { cause: reason });
  }
}
