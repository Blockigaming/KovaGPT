import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, parse, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ACCEPTANCE_PROMPT,
  acceptanceDigest,
} from "../../src/lib/generation-acceptance.server.mjs";
import { readResponseBytesBounded } from "../../src/lib/endpoint-reliability.mjs";

const ENDPOINT = "https://api.openai.com/v1/responses/input_tokens";
const SHA = /^[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const KINDS = new Set(["actual-account-request-capture", "synthetic-fixture"]);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
class CapturedCountError extends Error {
  constructor(code) {
    super(`captured_count_${code}`);
  }
}
const fail = (code) => {
  throw new CapturedCountError(code);
};
const iso = (value) => {
  const time = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : NaN;
};

// Hashes bind supplied evidence; they do not authenticate its provenance or
// grant authority to use a credential. Synthetic evidence stays synthetic.
export function validateCapturedRequest(capture, plan, now = Date.now()) {
  if (!object(capture) || !object(plan) || capture.version !== 1 || plan.version !== 1)
    fail("invalid_evidence");
  if (
    !KINDS.has(capture.evidenceKind) ||
    plan.expectedEvidenceKind !== capture.evidenceKind ||
    !object(capture.source) ||
    !object(plan.expectedSource) ||
    !COMMIT.test(capture.source.commit ?? "") ||
    !COMMIT.test(capture.source.tree ?? "") ||
    plan.expectedSource.commit !== capture.source.commit ||
    plan.expectedSource.tree !== capture.source.tree ||
    !UUID.test(capture.operationId ?? "") ||
    capture.operationId !== plan.operationId ||
    !SHA.test(capture.capturePlanSha256 ?? "") ||
    capture.capturePlanSha256 !== plan.capturePlanSha256
  )
    fail("binding_mismatch");
  const capturedAt = iso(capture.capturedAt);
  const notBefore = iso(plan.notBefore);
  const expiresAt = iso(plan.expiresAt);
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(capturedAt) ||
    !Number.isFinite(notBefore) ||
    !Number.isFinite(expiresAt) ||
    capturedAt > now ||
    now - capturedAt > 600_000 ||
    notBefore > now ||
    expiresAt <= now ||
    expiresAt <= notBefore ||
    expiresAt - notBefore > 600_000 ||
    capturedAt < notBefore ||
    !integer(plan.maximumInputTokens, 1, 8192)
  )
    fail("evidence_expired_or_invalid");
  const body = capture.body;
  const allowed = new Set([
    "model",
    "input",
    "instructions",
    "reasoning",
    "stream",
    "store",
    "service_tier",
    "max_output_tokens",
  ]);
  if (
    !object(body) ||
    Object.keys(body).some((key) => !allowed.has(key)) ||
    body.model !== "gpt-5.6-luna" ||
    body.stream !== true ||
    body.store !== false ||
    body.service_tier !== "default" ||
    body.max_output_tokens !== 64 ||
    !Array.isArray(body.input) ||
    body.input.length !== 1 ||
    !object(body.input[0]) ||
    Object.keys(body.input[0]).some((key) => !["role", "content"].includes(key)) ||
    body.input[0].role !== "user" ||
    body.input[0].content !== ACCEPTANCE_PROMPT ||
    (Object.hasOwn(body, "instructions") && typeof body.instructions !== "string") ||
    (Object.hasOwn(body, "reasoning") &&
      (!object(body.reasoning) ||
        Object.keys(body.reasoning).some((key) => !["effort", "summary"].includes(key)) ||
        Object.values(body.reasoning).some(
          (value) => typeof value !== "string" || value.length > 80,
        )))
  )
    fail("provider_body_rejected");
  const serialized = JSON.stringify(body);
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (
    !integer(capture.serializedUtf8Bytes, 1, 32768) ||
    bytes !== capture.serializedUtf8Bytes ||
    !SHA.test(capture.bodySha256 ?? "") ||
    capture.bodySha256 !== acceptanceDigest(body) ||
    capture.bodySha256 !== plan.bodySha256 ||
    !SHA.test(capture.serializedBodySha256 ?? "") ||
    capture.serializedBodySha256 !== hash(serialized)
  )
    fail("body_hash_or_size_mismatch");
  const snapshot = JSON.parse(serialized);
  const payload = { model: snapshot.model, input: snapshot.input };
  if (Object.hasOwn(snapshot, "instructions")) payload.instructions = snapshot.instructions;
  if (Object.hasOwn(snapshot, "reasoning")) payload.reasoning = snapshot.reasoning;
  return {
    payload,
    expiresAt,
    operationId: capture.operationId,
    evidenceKind: capture.evidenceKind,
    source: { commit: capture.source.commit, tree: capture.source.tree },
    capturePlanSha256: capture.capturePlanSha256,
    generationBodySha256: capture.bodySha256,
    serializedBodySha256: capture.serializedBodySha256,
    serializedUtf8Bytes: bytes,
    countPayloadSha256: hash(JSON.stringify(payload)),
    maximumInputTokens: plan.maximumInputTokens,
    countPlanSha256: acceptanceDigest(plan),
  };
}

async function securePath(path, directory = false) {
  if (typeof path !== "string" || !isAbsolute(path) || resolve(path) !== path)
    fail("private_path_rejected");
  let part = path;
  while (part !== parse(part).root) {
    const info = await lstat(part);
    if (info.isSymbolicLink()) fail("private_path_rejected");
    part = dirname(part);
  }
  if ((await realpath(path)) !== path) fail("private_path_rejected");
  const info = await lstat(path);
  if (
    (directory ? !info.isDirectory() : !info.isFile()) ||
    info.uid !== process.getuid() ||
    (info.mode & 0o777) !== (directory ? 0o700 : 0o600) ||
    (!directory && info.nlink !== 1)
  )
    fail("private_path_rejected");
  return info;
}

async function readPrivateJson(path, maximumBytes) {
  const expected = await securePath(path);
  await securePath(dirname(path), true);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (
      !info.isFile() ||
      info.uid !== process.getuid() ||
      (info.mode & 0o777) !== 0o600 ||
      info.nlink !== 1 ||
      info.size > maximumBytes ||
      info.dev !== expected.dev ||
      info.ino !== expected.ino
    )
      fail("private_file_rejected");
    const buffer = Buffer.alloc(maximumBytes + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maximumBytes) fail("private_file_rejected");
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytesRead)),
    );
  } finally {
    await file.close();
  }
}

async function openPrivateDirectory(path) {
  if (process.platform !== "linux") fail("private_directory_anchor_unavailable");
  const expected = await securePath(path, true);
  const directory = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const current = await directory.stat();
    if (
      current.dev !== expected.dev ||
      current.ino !== expected.ino ||
      (await realpath(`/proc/self/fd/${directory.fd}`)) !== path
    )
      fail("private_path_rejected");
    return directory;
  } catch (error) {
    await directory.close();
    throw error;
  }
}

// Linux's kernel-owned descriptor path anchors each fixed basename to the held
// directory inode. Renaming/replacing the supplied pathname cannot redirect it.
async function writeExclusive(directory, basename, value) {
  if (!/^token-count-[a-f0-9-]+\.(?:attempt|receipt)\.json$/u.test(basename))
    fail("private_path_rejected");
  const file = await open(
    `/proc/self/fd/${directory.fd}/${basename}`,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await file.writeFile(`${JSON.stringify(value)}\n`);
    await file.sync();
  } finally {
    await file.close();
  }
  await directory.sync();
}

function sanitized(error) {
  return error instanceof CapturedCountError ? error.message : "captured_count_operation_failed";
}

function discard(response) {
  try {
    void Promise.resolve(response?.body?.cancel()).catch(() => {});
  } catch {
    /* best effort */
  }
}

async function waitBounded(promise, signal) {
  signal.throwIfAborted();
  return new Promise((resolveValue, reject) => {
    const abort = () => reject(new CapturedCountError("request_aborted"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise)
      .then((response) => {
        if (signal.aborted) discard(response);
        resolveValue(response);
      }, reject)
      .finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}

export async function countCapturedRequest(
  { capture, plan, outputDirectory, apiKey },
  { fetcher = fetch, now = Date.now, signal, requestTimeoutMs = 8000, totalTimeoutMs = 10000 } = {},
) {
  const startedAt = now();
  const bound = validateCapturedRequest(capture, plan, startedAt);
  if (
    !integer(requestTimeoutMs, 1, 8000) ||
    !integer(totalTimeoutMs, 1, 10000) ||
    typeof apiKey !== "string" ||
    apiKey.length < 16 ||
    apiKey.length > 4096 ||
    /[\s\u0000-\u001f\u007f]/u.test(apiKey)
  )
    fail("private_configuration_or_deadline_invalid");
  const directory = await openPrivateDirectory(outputDirectory);
  try {
    const attemptName = `token-count-${bound.operationId}.attempt.json`;
    const receiptName = `token-count-${bound.operationId}.receipt.json`;
    try {
      await lstat(`/proc/self/fd/${directory.fd}/${receiptName}`);
      fail("attempt_already_reserved");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const { payload, expiresAt, maximumInputTokens, ...bindings } = bound;
    const base = {
      version: 1,
      ...bindings,
      countEndpoint: ENDPOINT,
      attemptReservedAt: new Date(startedAt).toISOString(),
      maximumInputTokens,
      maximumRequestAttempts: 1,
      generationRequests: 0,
      retries: 0,
      captureAuthenticityVerified: false,
      executionAuthorityGranted: false,
    };
    try {
      await writeExclusive(directory, attemptName, {
        ...base,
        status: "COUNT_ATTEMPT_RESERVED_NO_RETRY",
      });
    } catch (error) {
      if (error?.code === "EEXIST") fail("attempt_already_reserved");
      throw error;
    }
    let response;
    let attempted = false;
    let responseSha256;
    let inputTokens;
    let failureCode;
    const remaining = Math.min(expiresAt - now(), totalTimeoutMs - (now() - startedAt));
    const deadline = AbortSignal.timeout(
      Math.max(1, Math.min(requestTimeoutMs, Math.ceil(remaining))),
    );
    const boundedSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    try {
      if (remaining <= 0 || boundedSignal.aborted) fail("request_aborted");
      attempted = true;
      response = await waitBounded(
        fetcher(ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(payload),
          redirect: "error",
          cache: "no-store",
          signal: boundedSignal,
        }),
        boundedSignal,
      );
      if (response.redirected || (response.url && response.url !== ENDPOINT))
        fail("redirect_rejected");
      if (!response.ok) fail("provider_http_rejected");
      if (!/^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") ?? ""))
        fail("response_rejected");
      const bytes = await readResponseBytesBounded(response, 32768, {
        signal: boundedSignal,
        timeoutMs: Math.min(requestTimeoutMs, Math.max(1, expiresAt - now())),
      });
      responseSha256 = hash(bytes);
      const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (
        !object(value) ||
        value.object !== "response.input_tokens" ||
        !integer(value.input_tokens, 1, maximumInputTokens) ||
        now() >= expiresAt ||
        now() - startedAt >= totalTimeoutMs ||
        boundedSignal.aborted
      )
        fail("response_rejected");
      inputTokens = value.input_tokens;
    } catch (error) {
      failureCode = boundedSignal.aborted ? "captured_count_request_aborted" : sanitized(error);
    } finally {
      discard(response);
    }
    const receipt = {
      ...base,
      completedAt: new Date(now()).toISOString(),
      status: failureCode
        ? "COUNT_FAILED_ATTEMPT_CONSUMED"
        : "COUNT_OBSERVED_NOT_GENERATION_QUALIFIED",
      requestAttempts: Number(attempted),
      attemptConsumed: true,
      ...(responseSha256 ? { responseSha256 } : {}),
      ...(inputTokens === undefined ? {} : { inputTokens }),
      ...(failureCode ? { failureCode } : {}),
    };
    const final = { ...receipt, receiptSha256: acceptanceDigest(receipt) };
    await writeExclusive(directory, receiptName, final);
    return final;
  } finally {
    await directory.close();
  }
}

export async function main(argv = process.argv.slice(2), env = process.env, dependencies = {}) {
  if (!argv.includes("--count"))
    return {
      countEnabled: false,
      status: "COUNT_DISABLED",
      requestAttempts: 0,
      generationRequests: 0,
    };
  if (argv.length !== 7 || argv[0] !== "--count") fail("arguments_rejected");
  const values = new Map();
  for (let index = 1; index < argv.length; index += 2) {
    if (
      !new Set(["--capture", "--plan", "--output-directory"]).has(argv[index]) ||
      values.has(argv[index])
    )
      fail("arguments_rejected");
    values.set(argv[index], argv[index + 1]);
  }
  const capture = await readPrivateJson(values.get("--capture"), 65536);
  const plan = await readPrivateJson(values.get("--plan"), 16384);
  validateCapturedRequest(capture, plan, (dependencies.now ?? Date.now)());
  if (
    env.KOVA_REQUEST_COUNT_ENABLED !== "true" ||
    env.AZURE_ENVIRONMENT !== "staging" ||
    env.KOVA_DEPLOYMENT_TARGET !== "ca-kovagpt-staging"
  )
    fail("count_disabled");
  return countCapturedRequest(
    {
      capture,
      plan,
      outputDirectory: values.get("--output-directory"),
      apiKey: env.OPENAI_API_KEY,
    },
    dependencies,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await main();
    // Full redacted receipts live only in the scoped private output directory.
    process.stdout.write(
      `${JSON.stringify({ status: result.status, requestAttempts: result.requestAttempts, generationRequests: result.generationRequests })}\n`,
    );
    if (result.status === "COUNT_FAILED_ATTEMPT_CONSUMED") process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${sanitized(error)}\n`);
    process.exitCode = 1;
  }
}
