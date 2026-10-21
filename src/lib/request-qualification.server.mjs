import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { ACCEPTANCE_PROMPT, acceptanceDigest } from "./generation-acceptance.server.mjs";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const SHA = /^[a-f0-9]{40}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const KINDS = new Set(["actual-account-request-capture", "synthetic-fixture"]);
const BODY_FIELDS = new Set([
  "model",
  "input",
  "instructions",
  "stream",
  "store",
  "service_tier",
  "max_output_tokens",
  "reasoning",
]);
const hash = (text) => createHash("sha256").update(text).digest("hex");

export class RequestCaptureError extends Error {
  constructor(status = 503) {
    super("request_capture_denied");
    this.status = status;
  }
}
const deny = (status) => {
  throw new RequestCaptureError(status);
};
const checkTime = (plan, now) => {
  const start = Date.parse(plan.notBefore),
    end = Date.parse(plan.expiresAt);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    new Date(start).toISOString() !== plan.notBefore ||
    new Date(end).toISOString() !== plan.expiresAt ||
    end <= start ||
    end - start > 600_000 ||
    now < start ||
    now >= end
  )
    deny();
};

/** No credentials, filesystem or provider calls. An enabled capture host is capture-only. */
export function readRequestCapturePlan({ request, getEnv, buildSha, now = Date.now }) {
  const enabled = getEnv("KOVA_REQUEST_CAPTURE_ENABLED");
  const header = request.headers.get("x-kova-request-capture");
  if ((!enabled || enabled === "false") && header === null) return null;
  if (enabled !== "true" || !UUID.test(header ?? "")) deny();
  let plan;
  try {
    plan = JSON.parse(getEnv("KOVA_REQUEST_CAPTURE_PLAN") ?? "");
  } catch {
    deny();
  }
  const planSha256 = getEnv("KOVA_REQUEST_CAPTURE_PLAN_SHA256");
  const directory = getEnv("KOVA_REQUEST_CAPTURE_DIRECTORY");
  if (
    !plan ||
    Object.keys(plan).some(
      (key) =>
        ![
          "version",
          "operationId",
          "ownerId",
          "chatId",
          "source",
          "authMode",
          "evidenceKind",
          "notBefore",
          "expiresAt",
        ].includes(key),
    ) ||
    plan.version !== 1 ||
    !UUID.test(plan.operationId ?? "") ||
    !UUID.test(plan.ownerId ?? "") ||
    !UUID.test(plan.chatId ?? "") ||
    !plan.source ||
    typeof plan.source !== "object" ||
    Array.isArray(plan.source) ||
    Object.keys(plan.source).some((key) => key !== "commit" && key !== "tree") ||
    !SHA.test(plan.source?.commit ?? "") ||
    !SHA.test(plan.source?.tree ?? "") ||
    !["supabase", "kova"].includes(plan.authMode) ||
    !KINDS.has(plan.evidenceKind) ||
    !HASH.test(planSha256 ?? "") ||
    acceptanceDigest(plan) !== planSha256 ||
    !directory ||
    !isAbsolute(directory)
  )
    deny();
  Object.freeze(plan.source);
  Object.freeze(plan);
  const validate = () => {
    if (
      request.signal.aborted ||
      getEnv("KOVA_REQUEST_CAPTURE_ENABLED") !== "true" ||
      getEnv("AZURE_ENVIRONMENT") !== "staging" ||
      getEnv("KOVA_DEPLOYMENT_TARGET") !== "ca-kovagpt-staging" ||
      getEnv("KOVA_GENERATION_DISABLED") !== "true" ||
      getEnv("AI_GENERATION_ENABLED") !== "false" ||
      getEnv("KOVA_SPEECH_ENABLED") !== "false" ||
      getEnv("KOVA_GENERATION_ACCEPTANCE_ENABLED") !== "false" ||
      getEnv("KOVA_TEXT_PROVIDER") !== "openai" ||
      getEnv("KOVA_AUTH_MODE") !== plan.authMode ||
      getEnv("KOVA_SOURCE_TREE") !== plan.source.tree ||
      buildSha !== plan.source.commit ||
      getEnv("KOVA_REQUEST_CAPTURE_PLAN_SHA256") !== planSha256 ||
      getEnv("KOVA_REQUEST_CAPTURE_DIRECTORY") !== directory ||
      header !== plan.operationId
    )
      deny();
    let current;
    try {
      current = JSON.parse(getEnv("KOVA_REQUEST_CAPTURE_PLAN") ?? "");
    } catch {
      deny();
    }
    if (acceptanceDigest(current) !== planSha256) deny();
    checkTime(plan, now());
  };
  validate();
  return Object.freeze({ plan, planSha256, directory, validate });
}

/** The only external operations here are authenticated owner-scoped SELECTs. */
export async function authorizeRequestCapture({ capture, auth, ingress, signal }) {
  capture.validate();
  const { plan } = capture;
  if (
    !auth ||
    auth.userId !== plan.ownerId ||
    auth.emailVerified !== true ||
    auth.authProvider !== plan.authMode ||
    !auth.supabaseUser ||
    signal.aborted
  )
    deny(403);
  if (
    ingress.chatId !== plan.chatId ||
    ingress.mode !== "instant" ||
    ingress.temporary ||
    ingress.temporaryContext !== undefined ||
    ingress.projectId !== undefined ||
    ingress.clientTool !== undefined ||
    ingress.kovaModel !== undefined ||
    ingress.kova !== undefined ||
    ingress.skill !== undefined ||
    (ingress.memoryStartIndex !== undefined && ingress.memoryStartIndex !== 0) ||
    (ingress.historyOffset !== undefined && ingress.historyOffset !== 0) ||
    ingress.summaryProof !== undefined ||
    !Array.isArray(ingress.messages) ||
    ingress.messages.length !== 1 ||
    ingress.messages[0]?.role !== "user" ||
    ingress.messages[0]?.content !== ACCEPTANCE_PROMPT ||
    (ingress.messages[0]?.attachments?.length ?? 0) !== 0
  )
    deny(400);
  let result;
  try {
    result = await auth.supabaseUser
      .from("chat_history_records")
      .select("owner_id,id,payload,deleted_at")
      .eq("owner_id", auth.userId)
      .eq("id", plan.chatId)
      .is("deleted_at", null)
      .abortSignal(signal)
      .maybeSingle();
  } catch {
    deny();
  }
  const row = result?.data;
  if (result?.error) deny();
  if (
    !row ||
    row.owner_id !== auth.userId ||
    row.id !== plan.chatId ||
    row.deleted_at ||
    row.payload?.id !== plan.chatId ||
    row.payload?.temporary === true ||
    !Array.isArray(row.payload?.messages)
  )
    deny(404);
  capture.validate();
}

/** Shares the acceptance guard's final body shape, but never claims a usage slot. */
export function boundedCaptureBody(body) {
  let bounded;
  try {
    bounded = JSON.parse(
      JSON.stringify({ ...body, max_output_tokens: Math.min(body.max_output_tokens, 64) }),
    );
  } catch {
    deny();
  }
  if (
    Object.keys(body).some((key) => !BODY_FIELDS.has(key)) ||
    bounded.model !== "gpt-5.6-luna" ||
    bounded.stream !== true ||
    bounded.store !== false ||
    bounded.service_tier !== "default" ||
    bounded.max_output_tokens !== 64 ||
    typeof bounded.instructions !== "string" ||
    !bounded.instructions ||
    !Array.isArray(bounded.input) ||
    bounded.input.length !== 1 ||
    bounded.input[0]?.role !== "user" ||
    bounded.input[0]?.content !== ACCEPTANCE_PROMPT ||
    Object.keys(bounded.input[0]).some((key) => key !== "role" && key !== "content") ||
    Buffer.byteLength(JSON.stringify(bounded), "utf8") > 32768
  )
    deny(400);
  return bounded;
}

/** Private server file only. HTTP receives a content-free receipt; no provider/key APIs. */
export async function captureConstructedRequest({
  capture,
  body,
  authMode,
  signal,
  now = Date.now,
}) {
  capture.validate();
  if (signal.aborted || authMode !== capture.plan.authMode) deny();
  const bounded = boundedCaptureBody(body);
  const serialized = JSON.stringify(bounded);
  const artifact = {
    version: 1,
    evidenceKind: capture.plan.evidenceKind,
    capturedAt: new Date(now()).toISOString(),
    source: capture.plan.source,
    operationId: capture.plan.operationId,
    authMode,
    capturePlanSha256: capture.planSha256,
    ownerIdSha256: acceptanceDigest(capture.plan.ownerId),
    chatIdSha256: acceptanceDigest(capture.plan.chatId),
    body: bounded,
    bodySha256: acceptanceDigest(bounded),
    serializedBodySha256: hash(serialized),
    serializedUtf8Bytes: Buffer.byteLength(serialized, "utf8"),
    generationPerformed: false,
    usageCharged: false,
  };
  // Dynamic Node-only storage, never a browser/static URL and never supplied by ingress.
  const fs = await import("node:fs/promises");
  const { constants } = await import("node:fs");
  let file;
  let directoryHandle;
  try {
    if (process.platform !== "linux") deny();
    const directory = resolve(capture.directory);
    const actual = await fs.realpath(directory);
    const stat = await fs.lstat(directory);
    const fromCwd = relative(resolve(process.cwd()), actual);
    if (
      actual !== directory ||
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (stat.mode & 0o777) !== 0o700 ||
      stat.uid !== process.getuid?.() ||
      !fromCwd ||
      (!fromCwd.startsWith(`..${sep}`) && fromCwd !== ".." && !isAbsolute(fromCwd))
    )
      deny();
    directoryHandle = await fs.open(
      directory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const opened = await directoryHandle.stat();
    if (
      opened.dev !== stat.dev ||
      opened.ino !== stat.ino ||
      (opened.mode & 0o777) !== 0o700 ||
      opened.uid !== process.getuid?.()
    )
      deny();
    capture.validate();
    if (signal.aborted) deny();
    // Hold the verified inode: a directory rename/symlink swap cannot redirect
    // the content write into a different directory between validation and open.
    file = await fs.open(
      `/proc/self/fd/${directoryHandle.fd}/${capture.plan.operationId}.json`,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    await file.writeFile(`${JSON.stringify(artifact)}\n`, { encoding: "utf8", signal });
    await file.sync();
    capture.validate();
    if (signal.aborted) deny();
  } catch {
    deny();
  } finally {
    await file?.close().catch(() => undefined);
    await directoryHandle?.close().catch(() => undefined);
  }
  return {
    status: "REQUEST_CAPTURED_NO_GENERATION",
    evidenceKind: artifact.evidenceKind,
    operationId: artifact.operationId,
    source: artifact.source,
    capturePlanSha256: artifact.capturePlanSha256,
    bodySha256: artifact.bodySha256,
    serializedUtf8Bytes: artifact.serializedUtf8Bytes,
    generationPerformed: false,
    usageCharged: false,
  };
}
