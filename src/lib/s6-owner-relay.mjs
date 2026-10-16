// Disposable, in-memory receipt exchange for the single staging owner session.
// It never issues an application session or accepts a provider/authenticator secret.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { kovaAuthRequestUrl } from "./kova-auth-proxy-origin.mjs";

export const S6_ORIGIN =
  "https://ca-kovagpt-auth-rehearsal.whitepebble-42e8ad60.eastus.azurecontainerapps.io";
export const S6_CHECKS = [
  "passkey_registration",
  "passkey_login_and_removal",
  "google_callback_and_consent",
];
const digest = (value) => createHash("sha256").update(value).digest();
const matches = (value, hash) =>
  typeof value === "string" && hash && timingSafeEqual(digest(value), hash);
const validToken = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
const reply = (status, data) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });

export function createS6OwnerRelay({ env = process.env, clock = Date.now } = {}) {
  let active = null;
  const enabled = () => {
    const end = Date.parse(env.KOVA_S6_OWNER_RELAY_DEADLINE ?? "");
    return (
      validToken(env.KOVA_S6_OWNER_RELAY_KEY) &&
      Number.isFinite(end) &&
      clock() < end &&
      end - clock() <= 1_200_000 &&
      env.KOVA_AUTH_PUBLIC_ORIGIN === S6_ORIGIN &&
      env.KOVA_AUTH_REVERSE_PROXY_ORIGIN === S6_ORIGIN &&
      env.SUPABASE_URL === "https://oztdrjtdglkizlewnulh.supabase.co" &&
      ["dual", "kova"].includes(env.KOVA_AUTH_MODE)
    );
  };
  const handle = async function (request) {
    const now = clock();
    const end = Date.parse(env.KOVA_S6_OWNER_RELAY_DEADLINE ?? "");
    const key = env.KOVA_S6_OWNER_RELAY_KEY;
    if (!enabled()) {
      active = null;
      return reply(404, { error: "unavailable" });
    }
    if (kovaAuthRequestUrl(request, env).origin !== S6_ORIGIN)
      return reply(404, { error: "unavailable" });
    if (request.headers.has("origin") && request.headers.get("origin") !== S6_ORIGIN)
      return reply(403, { error: "origin_denied" });
    const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
    if (!validToken(token)) return reply(401, { error: "unauthorized" });
    const coordinator = matches(token, digest(key));
    if (request.method === "GET") {
      if (!coordinator) return reply(401, { error: "unauthorized" });
      return reply(
        200,
        active
          ? {
              runId: active.runId,
              status: active.status,
              receipts: active.receipts,
              failure: active.failure,
            }
          : { status: "empty" },
      );
    }
    if (request.method !== "POST") return reply(405, { error: "method_denied" });
    // Read a bounded body, including when Content-Length is absent or misleading.
    const reader = request.body?.getReader();
    if (!reader) return reply(400, { error: "invalid_body" });
    const chunks = [];
    let length = 0,
      timer;
    const expired = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reader.cancel().catch(() => {});
        reject(new Error("body_timeout"));
      }, 5000);
    });
    try {
      while (true) {
        const { done, value } = await Promise.race([reader.read(), expired]);
        if (done) break;
        length += value.byteLength;
        if (length > 16_384) {
          await reader.cancel();
          return reply(413, { error: "body_too_large" });
        }
        chunks.push(value);
      }
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (coordinator && data.action === "open") {
        if (active) return reply(409, { error: "already_open" });
        const b = data.baseline;
        if (
          !/^[a-f0-9]{12}$/.test(data.runId) ||
          !/^[a-f0-9]{64}$/.test(data.ticketHash) ||
          b?.origin !== S6_ORIGIN ||
          !/^[a-f0-9]{40}$/.test(b.sourceSha) ||
          b.sourceSha !== env.KOVA_S6_SOURCE_SHA ||
          !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(b.expectedAccountId) ||
          typeof b.expectedEmail !== "string" ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.expectedEmail) ||
          b.expectedEmail !== b.expectedEmail.toLowerCase() ||
          b.existingAccounts !== 0 ||
          b.existingHostedUsers !== 0 ||
          b.authorizedDisposableGoogleIdentity !== true ||
          !Number.isFinite(b.deadline) ||
          b.deadline > end - 180_000 ||
          b.deadline <= now + 60_000 ||
          !Number.isFinite(Date.parse(b.capturedAt)) ||
          now - Date.parse(b.capturedAt) < 0 ||
          now - Date.parse(b.capturedAt) > 60_000
        )
          return reply(400, { error: "invalid_baseline" });
        active = {
          runId: data.runId,
          status: "waiting",
          ticketHash: Buffer.from(data.ticketHash, "hex"),
          baseline: {
            origin: S6_ORIGIN,
            runId: data.runId,
            expectedEmail: b.expectedEmail,
            expectedAccountId: b.expectedAccountId,
            sourceSha: b.sourceSha,
            deadline: b.deadline,
            capturedAt: b.capturedAt,
            existingAccounts: 0,
            existingHostedUsers: 0,
            authorizedDisposableGoogleIdentity: true,
          },
          receipts: null,
          failure: null,
        };
        return reply(201, { runId: active.runId });
      }
      if (coordinator && data.action === "close") {
        if (active && data.runId !== active.runId) return reply(409, { error: "run_mismatch" });
        active = null;
        return reply(200, { status: "closed" });
      }
      if (!active || data.runId !== active.runId) return reply(401, { error: "unauthorized" });
      if (now >= active.baseline.deadline) return reply(410, { error: "session_expired" });
      if (
        data.action === "claim" &&
        active.status === "waiting" &&
        matches(token, active.ticketHash)
      ) {
        const receiptToken = randomBytes(32).toString("base64url");
        active.receiptHash = digest(receiptToken);
        active.ticketHash = null;
        active.status = "claimed";
        return reply(200, { baseline: active.baseline, runId: active.runId, receiptToken });
      }
      if (active.status !== "claimed" || !matches(token, active.receiptHash))
        return reply(401, { error: "unauthorized" });
      if (data.action === "fail") {
        active.status = "failed";
        active.failure = "owner_session_failed";
        active.receiptHash = null;
        return reply(200, { status: "failed" });
      }
      if (data.action !== "complete" || !Array.isArray(data.receipts) || data.receipts.length !== 3)
        return reply(400, { error: "invalid_receipt" });
      const receipts = [];
      for (const check of S6_CHECKS) {
        const rows = data.receipts.filter((x) => x.check === check);
        const row = rows[0];
        const at = Date.parse(row?.at);
        if (
          rows.length !== 1 ||
          row.status !== "PASS" ||
          row.kind !== "DEPLOYED" ||
          row.sourceSha !== active.baseline.sourceSha ||
          !Number.isFinite(at) ||
          at > now ||
          at < Date.parse(active.baseline.capturedAt) ||
          at >= active.baseline.deadline
        )
          return reply(400, { error: "invalid_receipt" });
        // Deliberately whitelist fields: credential material cannot enter the report.
        receipts.push({
          check,
          status: "PASS",
          kind: "DEPLOYED",
          sourceSha: row.sourceSha,
          at: row.at,
          assertions: ["dedicated owner harness completed physical/provider assertions"],
        });
      }
      active.receipts = receipts;
      active.status = "complete";
      active.receiptHash = null;
      return reply(200, { status: "complete" });
    } catch {
      return reply(400, { error: "invalid_body" });
    } finally {
      clearTimeout(timer);
    }
  };
  handle.googleIdentityAllowed = (email) => {
    if (!env.KOVA_S6_OWNER_RELAY_KEY) return true;
    return (
      enabled() &&
      active?.status === "claimed" &&
      clock() < active.baseline.deadline &&
      typeof email === "string" &&
      email.toLowerCase() === active.baseline.expectedEmail
    );
  };
  return handle;
}

export const handleS6OwnerRelay = createS6OwnerRelay();
export const s6GoogleIdentityAllowed = (email) => handleS6OwnerRelay.googleIdentityAllowed(email);
