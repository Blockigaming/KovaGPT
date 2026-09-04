const SAFE_DELIVERY_ID = /^[A-Za-z0-9_.:-]{1,200}$/;
const SAFE_PROVIDER_ID = /^[A-Za-z0-9_.:-]{1,200}$/;
const SAFE_EVENT_TYPE = /^email\.[a-z_]{1,80}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export class ResendWebhookError extends Error {
  constructor(code, status) {
    super(code);
    this.name = "ResendWebhookError";
    this.code = code;
    this.status = status;
  }
}

function fail(code, status) {
  throw new ResendWebhookError(code, status);
}

function decodeBase64(value, code) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 512 ||
    value.length % 4 === 1 ||
    !BASE64.test(value)
  ) {
    fail(code, 401);
  }
  try {
    const decoded = atob(value);
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    fail(code, 401);
  }
}

export async function verifyResendWebhookSignature({
  secret,
  deliveryId,
  timestamp,
  signature,
  body,
  now = Date.now(),
  toleranceSeconds = 300,
}) {
  if (typeof secret !== "string" || !secret.startsWith("whsec_") || secret.length < 24) {
    fail("resend_webhook_verification_unavailable", 503);
  }
  if (!SAFE_DELIVERY_ID.test(deliveryId ?? "")) {
    fail("invalid_resend_delivery_id", 401);
  }
  if (
    typeof timestamp !== "string" ||
    !/^[0-9]{1,12}$/.test(timestamp) ||
    !Number.isSafeInteger(Number(timestamp))
  ) {
    fail("invalid_resend_timestamp", 401);
  }
  const timestampSeconds = Number(timestamp);
  if (
    !Number.isSafeInteger(toleranceSeconds) ||
    toleranceSeconds < 1 ||
    Math.abs(Math.floor(now / 1000) - timestampSeconds) > toleranceSeconds
  ) {
    fail("expired_resend_webhook", 401);
  }
  if (typeof body !== "string" || typeof signature !== "string" || signature.length > 2_048) {
    fail("invalid_resend_signature", 401);
  }

  const candidates = signature
    .trim()
    .split(/\s+/)
    .filter((value) => value.startsWith("v1,"))
    .slice(0, 8)
    .map((value) => decodeBase64(value.slice(3), "invalid_resend_signature"));
  if (!candidates.length) fail("invalid_resend_signature", 401);

  const secretBytes = decodeBase64(secret.slice("whsec_".length), "invalid_resend_webhook_secret");
  if (secretBytes.byteLength < 16) fail("invalid_resend_webhook_secret", 503);
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signed = new TextEncoder().encode(`${deliveryId}.${timestamp}.${body}`);
  for (const candidate of candidates) {
    if (await crypto.subtle.verify("HMAC", key, candidate, signed)) return true;
  }
  fail("invalid_resend_signature", 401);
}

export function parseResendWebhookEvent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid_resend_webhook_payload", 400);
  }
  const type = value.type;
  const data = value.data;
  const createdAt = value.created_at;
  if (
    typeof type !== "string" ||
    !SAFE_EVENT_TYPE.test(type) ||
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    typeof data.email_id !== "string" ||
    !SAFE_PROVIDER_ID.test(data.email_id) ||
    typeof createdAt !== "string" ||
    createdAt.length > 64 ||
    !Number.isFinite(Date.parse(createdAt))
  ) {
    fail("invalid_resend_webhook_payload", 400);
  }
  return Object.freeze({
    type,
    providerMessageId: data.email_id,
    occurredAt: new Date(createdAt).toISOString(),
  });
}

export async function sha256Text(value) {
  if (typeof value !== "string") throw new TypeError("value must be a string");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
