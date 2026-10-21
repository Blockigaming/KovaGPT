// PRIVATE REVIEW ONLY. This module never imports the production support route,
// email templates, queue, database, auth client, or any network implementation.
// Source contracts: src/components/HelpSupportForm.tsx and
// src/routes/api/public/help-submit.ts (BodySchema and response classifiers).
export const SUPPORT_REVIEW_SCENARIOS = Object.freeze([
  "support-pending",
  "support-rejected",
  "support-uncertain",
  "support-accepted",
]);
export const SUPPORT_REVIEW_OPTIONS = Object.freeze(
  SUPPORT_REVIEW_SCENARIOS.map((id) =>
    Object.freeze({
      id,
      label: `${id} · synthetic form outcome, no email`,
      accounts: Object.freeze(["guest", "free", "plus", "pro"]),
      path: "/help",
    }),
  ),
);
export const SUPPORT_REVIEW_DISCLOSURE =
  "Support review exercises the actual public Help form for Guest, Free, Plus and Pro. Use only a sample .invalid reply address and fictional content. Pending holds for at most 20 seconds, then ends without acceptance; the form's own 20-second timeout may win. Rejected is a simulated 400 response; uncertain is a simulated 503 response and must not be retried automatically. Accepted is a simulation only: the product's Request accepted message does not mean a real request was accepted or sent. No email, support ticket, provider, queue or backend is contacted, and no submitted fields are stored or logged. Reset or sign-out cancels the disposable session.";
export const SUPPORT_REVIEW_MAX_BODY_BYTES = 32 * 1024;
export const SUPPORT_REVIEW_SAMPLE_BODY = Object.freeze({
  name: "Sample reviewer",
  email: "review@example.invalid",
  topic: "Other",
  message: "Synthetic support review message. No email should be sent.",
  variant: "help",
  website: "",
  url: "http://127.0.0.1:4189/help",
  userAgent: "Private support review sample",
});

const origin = "http://127.0.0.1:4189";
const path = "/api/public/help-submit";
const fields = new Set([
  "name",
  "email",
  "topic",
  "message",
  "variant",
  "website",
  "url",
  "userAgent",
]);
const optionalLimits = { name: 120, topic: 200, url: 500, userAgent: 500 };
// Matches the installed Zod email validator used by BodySchema. The .invalid
// suffix is an additional private-review restriction, not a product requirement.
const emailPattern =
  /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;
const plainObject = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));

/** Pure validation only: never return, retain, echo or log submitted fields.
 * Production permits variant "bug" and strips unknown fields. This fixture is
 * intentionally narrower: it accepts only the Help form and rejects operations,
 * recipient overrides, attachments and any other undeclared fields.
 */
export function validSupportReviewBody(body) {
  if (!plainObject(body) || Object.keys(body).some((key) => !fields.has(key))) return false;
  if (typeof body.email !== "string" || typeof body.message !== "string") return false;
  const email = body.email.trim();
  if (email.length > 254 || !emailPattern.test(email) || !/\.invalid$/i.test(email)) return false;
  if (!body.message.trim() || body.message.trim().length > 4000) return false;
  for (const [key, limit] of Object.entries(optionalLimits))
    if (
      Object.hasOwn(body, key) &&
      (typeof body[key] !== "string" || body[key].trim().length > limit)
    )
      return false;
  if (Object.hasOwn(body, "variant") && body.variant !== "help") return false;
  if (Object.hasOwn(body, "website") && body.website !== "") return false;
  return true;
}

function validateRequest(request) {
  const headers = Object.fromEntries(
    Object.entries(request.headers()).map(([key, value]) => [key.toLowerCase(), value]),
  );
  // No owner, authorization, operation or destination is part of the actual
  // public form. Cookies may exist for signed-in reviewers but are not used here.
  if (Object.hasOwn(headers, "x-kova-owner") || Object.hasOwn(headers, "authorization"))
    return [400, "Synthetic Support review accepts only the public form contract."];
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(headers["content-type"] ?? ""))
    return [415, "Synthetic Support review requires the form's JSON content type."];
  const declaredLength = Number(headers["content-length"] ?? "0");
  const raw = request.postData();
  if (
    (Number.isFinite(declaredLength) && declaredLength > SUPPORT_REVIEW_MAX_BODY_BYTES) ||
    (typeof raw === "string" && Buffer.byteLength(raw) > SUPPORT_REVIEW_MAX_BODY_BYTES)
  )
    return [413, "Synthetic Support request is too large."];
  try {
    if (typeof raw !== "string" || !validSupportReviewBody(JSON.parse(raw)))
      return [400, "Synthetic Support review requires valid sample fields and a .invalid email."];
  } catch {
    return [400, "Synthetic Support review requires valid JSON."];
  }
  return null;
}

/** Install only for an explicit Support scenario, after the base fixtures.
 * isActive means this disposable SESSION is current, including a guest session;
 * it must not be an authentication check. The real endpoint is public and the
 * form sends no owner header. The parent owns session reset/sign-out invalidation
 * and wait(signal), a bounded, cancelable 20-second hold. No release sends email.
 */
export function createSupportReviewHandler(scenario, { isActive, wait } = {}) {
  if (!SUPPORT_REVIEW_SCENARIOS.includes(scenario))
    throw new Error("Unknown Support review scenario.");
  if (
    typeof isActive !== "function" ||
    (scenario === "support-pending" && typeof wait !== "function")
  )
    throw new Error("Support review requires an active session and a bounded pending wait.");

  return async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname !== path) return route.fallback();
    const reply = (value, status = 200) =>
      route.fulfill({
        status,
        headers: {
          "Cache-Control": "no-store",
          "X-Kova-Review-Only": "synthetic-no-delivery",
          ...(status === 405 ? { Allow: "POST" } : {}),
        },
        json: value,
      });
    const error = (status, message) => reply({ error: message }, status);
    if (url.origin !== origin) return error(403, "Synthetic Support origin does not match.");
    if (isActive() !== true)
      return error(409, "Synthetic Support session ended. Reset the review.");
    if (request.method() !== "POST") return error(405, "Synthetic Support requires POST.");
    if (url.search || url.hash)
      return error(400, "Synthetic Support does not accept URL arguments.");
    const invalid = validateRequest(request);
    if (invalid) return error(...invalid);
    const signal = request.signal?.();
    if (signal?.aborted)
      return error(499, "Synthetic Support inspection canceled; nothing was sent.");
    if (scenario === "support-pending") {
      let reason;
      try {
        reason = await wait(signal);
      } catch {
        reason = "failed";
      }
      if (
        isActive() !== true ||
        signal?.aborted ||
        ["aborted", "reset", "disposed"].includes(reason)
      )
        return error(499, "Synthetic Support inspection canceled; nothing was sent.");
      return error(
        503,
        reason === "expired"
          ? "Synthetic Support pending hold ended after 20 seconds without acceptance. Nothing was sent."
          : reason === "capacity"
            ? "Synthetic Support pending request limit reached. Nothing was sent."
            : "Synthetic Support pending inspection ended without acceptance. Nothing was sent.",
      );
    }
    if (scenario === "support-rejected")
      return error(400, "Synthetic Support rejection. Nothing was accepted or sent.");
    if (scenario === "support-uncertain")
      return error(
        503,
        "Synthetic Support unconfirmed outcome. Nothing was sent; do not auto-retry.",
      );
    // Exact current success DTO exercises the real UI. The controller disclosure
    // must remain explicit: this is not evidence of delivery or service acceptance.
    return reply({ success: true });
  };
}
