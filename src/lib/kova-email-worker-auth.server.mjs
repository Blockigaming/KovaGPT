import { createHmac, timingSafeEqual } from "node:crypto";

const WORKER_PATH = "/api/internal/email-dispatch";
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
const SIGNATURE = /^[0-9a-f]{64}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function fail(code) {
  const error = new Error(code);
  error.name = "EmailWorkerAuthError";
  error.code = code;
  throw error;
}

function validateSecret(secret) {
  if (typeof secret !== "string" || secret.length < 32 || /[\r\n]/u.test(secret))
    fail("email_worker_unavailable");
}

function validIdentifiers(runId, issuedAt) {
  if (
    typeof runId !== "string" ||
    !UUID.test(runId) ||
    typeof issuedAt !== "string" ||
    !TIMESTAMP.test(issuedAt)
  )
    return false;
  const timestamp = Date.parse(issuedAt);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === issuedAt;
}

/** The empty-object body is fixed by the protocol. This function never sends a request. */
export function signEmailWorkerRequest({ runId, issuedAt }, secret) {
  validateSecret(secret);
  if (!validIdentifiers(runId, issuedAt)) fail("email_worker_signing_input_invalid");
  return createHmac("sha256", secret)
    .update(`kova-email-worker-v1\nPOST\n${WORKER_PATH}\n${runId}\n${issuedAt}\n{}`, "utf8")
    .digest("hex");
}

/** Authenticate only. The handler must separately reject any body except `{}`,
 * and acquire the database run lease before dispatch; this does not consume it. */
export function authenticateEmailWorkerRequest(request, env = process.env, now = Date.now()) {
  validateSecret(env?.KOVA_EMAIL_WORKER_SECRET);
  const secret = env.KOVA_EMAIL_WORKER_SECRET;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    fail("email_worker_unauthorized");
  }
  if (
    request.method !== "POST" ||
    url.pathname !== WORKER_PATH ||
    url.search !== "" ||
    url.hash !== "" ||
    request.url.includes("?") ||
    request.url.includes("#") ||
    request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
      "application/json"
  )
    fail("email_worker_unauthorized");
  const runId = request.headers.get("x-kova-email-run-id");
  const issuedAt = request.headers.get("x-kova-email-issued-at");
  const signature = request.headers.get("x-kova-email-signature");
  if (!validIdentifiers(runId, issuedAt) || !SIGNATURE.test(signature ?? ""))
    fail("email_worker_unauthorized");
  const age = now - Date.parse(issuedAt);
  if (!Number.isFinite(now) || age > 60_000 || age < -5_000) fail("email_worker_unauthorized");
  const expected = signEmailWorkerRequest({ runId, issuedAt }, secret);
  if (!timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex")))
    fail("email_worker_unauthorized");
  return { runId, issuedAt };
}
