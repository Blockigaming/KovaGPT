import { createPrivateKey, sign } from "node:crypto";
import { runtimeEnv } from "@/lib/runtime-env.server";
import { readResponseBytesBounded } from "@/lib/endpoint-reliability.mjs";

const tokenUrl = "https://oauth2.googleapis.com/token";
const scope = "https://www.googleapis.com/auth/firebase.messaging";
const registrationTokenPattern = /^[A-Za-z0-9_:-]{20,2048}$/u;

export function normalizeAndroidPushToken(value: unknown): string {
  if (typeof value !== "string" || !registrationTokenPattern.test(value)) {
    throw new Error("android_push_invalid_token");
  }
  return value;
}

export function androidPushConfigured() {
  return (
    /^[a-z][a-z0-9-]{4,59}$/u.test(runtimeEnv("FCM_PROJECT_ID") ?? "") &&
    Boolean(runtimeEnv("FCM_CLIENT_EMAIL") && runtimeEnv("FCM_PRIVATE_KEY"))
  );
}

export async function sendAndroidTaskPush(
  registrationToken: string,
  signal: AbortSignal,
  assertCurrent: () => Promise<void>,
): Promise<"sent" | "expired" | "retry"> {
  const token = normalizeAndroidPushToken(registrationToken);
  const project = runtimeEnv("FCM_PROJECT_ID") ?? "";
  const issuer = runtimeEnv("FCM_CLIENT_EMAIL") ?? "";
  const key = runtimeEnv("FCM_PRIVATE_KEY") ?? "";
  if (!androidPushConfigured()) return "retry";
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(12000)]);
  const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const issuedAt = Math.floor(Date.now() / 1000);
  const unsigned = [
    b64({ alg: "RS256", typ: "JWT" }),
    b64({ iss: issuer, scope, aud: tokenUrl, iat: issuedAt, exp: issuedAt + 300 }),
  ].join(".");
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(unsigned),
    createPrivateKey(key.replaceAll("\\n", "\n")),
  ).toString("base64url");
  const authorization = await fetch(tokenUrl, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
    redirect: "error",
    signal: deadline,
  });
  if (!authorization.ok) {
    void authorization.body?.cancel().catch(() => {});
    return "retry";
  }
  const bytes = await readResponseBytesBounded(authorization, 8192, { signal: deadline });
  const { access_token: accessToken } = JSON.parse(new TextDecoder().decode(bytes));
  if (typeof accessToken !== "string" || !/^[A-Za-z0-9._~+/-]+={0,2}$/u.test(accessToken)) {
    return "retry";
  }
  await assertCurrent();
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${project}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token,
        data: { kind: "scheduled_task_completed" },
        android: { priority: "high", ttl: "3600s" },
      },
    }),
    redirect: "error",
    signal: deadline,
  });
  if (response.ok || response.status !== 404) {
    void response.body?.cancel().catch(() => {});
    return response.ok ? "sent" : "retry";
  }
  const errorBytes = await readResponseBytesBounded(response, 8192, { signal: deadline });
  const details = JSON.parse(new TextDecoder().decode(errorBytes)).error?.details;
  return Array.isArray(details) &&
    details.some(
      (entry) =>
        entry?.["@type"] === "type.googleapis.com/google.firebase.fcm.v1.FcmError" &&
        entry.errorCode === "UNREGISTERED",
    )
    ? "expired"
    : "retry";
}
