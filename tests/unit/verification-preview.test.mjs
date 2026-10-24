import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
const source = readFileSync(
  new URL("../../review-kit/components/VerificationPreview.tsx", import.meta.url),
  "utf8",
);
const pure = source.slice(
  source.indexOf("export const VERIFICATION_SAMPLE_STATUSES"),
  source.indexOf("export function VerificationPreview()"),
);
const module = { exports: {} };
new Function("module", "exports", transformSync(pure, { loader: "ts", format: "cjs" }).code)(
  module,
  module.exports,
);
const {
  createVerificationPreviewState: create,
  verificationPreviewReducer: reduce,
  VERIFICATION_SAMPLE_STATUSES: statuses,
  VERIFICATION_SAMPLE_COPY: copy,
} = module.exports;

test("all five sample statuses are inspectable with explicit sample copy", () => {
  assert.deepEqual(statuses, ["sent", "pending", "verified", "expired", "failed"]);
  for (const status of statuses) {
    const state = reduce(create(), { type: "select", status });
    assert.equal(state.status, status);
    assert.equal(state.screen, "verification");
    assert.match(copy[status].title, /sample/i);
  }
  const state = create();
  assert.equal(reduce(state, { type: "select", status: "unknown" }), state);
});
test("local success guards duplicate resends until source-matched cooldown ends", () => {
  let state = reduce(create(), { type: "resend", outcome: "success" });
  assert.equal(state.cooldown, 60);
  assert.match(state.notice, /No email was sent/);
  assert.equal(reduce(state, { type: "resend", outcome: "failure" }), state);
  for (let i = 0; i < 60; i++) state = reduce(state, { type: "tick" });
  assert.equal(state.cooldown, 0);
  assert.equal(reduce(state, { type: "tick" }), state);
  assert.equal(reduce(state, { type: "resend", outcome: "success" }).cooldown, 60);
  const auth = readFileSync(new URL("../../src/routes/auth.tsx", import.meta.url), "utf8");
  assert.match(auth.slice(auth.indexOf("const resendVerification")), /setCooldown\(60\)/);
});
test("failure preserves expired state and permits retry; verified cannot resend", () => {
  const expired = reduce(create(), { type: "select", status: "expired" });
  const failed = reduce(expired, { type: "resend", outcome: "failure" });
  assert.equal(failed.status, "expired");
  assert.equal(failed.cooldown, 0);
  assert.match(failed.error, /failed/);
  const retried = reduce(failed, { type: "resend", outcome: "success" });
  assert.equal(retried.status, "sent");
  assert.equal(retried.error, "");
  const verified = reduce(create(), { type: "select", status: "verified" });
  assert.equal(reduce(verified, { type: "resend", outcome: "success" }), verified);
});
test("illustrative return and reset clear transient notices and cooldown", () => {
  const sent = reduce(create(), { type: "resend", outcome: "success" });
  const returned = reduce(sent, { type: "sign-in" });
  assert.equal(returned.screen, "sign-in");
  assert.equal(returned.cooldown, 0);
  assert.equal(returned.notice, "");
  assert.equal(reduce(returned, { type: "resend", outcome: "success" }), returned);
  assert.deepEqual(reduce(returned, { type: "reset" }), create());
  assert.equal(reduce(sent, { type: "select", status: "pending" }).cooldown, 0);
});
test("preview remains local with accessible feedback and timer cleanup", () => {
  assert.doesNotMatch(
    source,
    /fetch\(|authFetch|useServerFn|supabase|localStorage|sessionStorage|window\.|https?:\/\//,
  );
  assert.match(source, /clearTimeout\(timer\)/);
  assert.match(source, /role="alert"/);
  assert.match(source, /aria-pressed/);
  assert.match(source, /sample proposal/);
});
