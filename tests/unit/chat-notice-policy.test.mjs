import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chatFailureNoticeId } from "../../src/lib/chat-notice-policy.mjs";
import { chatResponseError } from "../../src/lib/chat-sse-client.mjs";
import { NOTIFICATION_IDS } from "../../src/lib/notification-catalog.mjs";

test("server quota kind distinguishes Thinking from ordinary messages", () => {
  assert.equal(chatFailureNoticeId({ code: "message_window_limit", category: "quota_exceeded",
    status: 429, usageKind: "thinking" }), "thinking_limit");
  assert.equal(chatFailureNoticeId({ code: "message_window_limit", category: "quota_exceeded",
    status: 429, usageKind: "regular" }), "assistant_limit");
  assert.equal(chatFailureNoticeId({ code: "message_window_limit", category: "quota_exceeded",
    status: 429 }), "assistant_limit");
});

test("backend-entitlement and availability failures have specific notices", () => {
  const samples = [
    [{code:"kova_model_not_entitled",status:403},"reasoning_restricted"],
    [{code:"mode_not_entitled",status:403},"reasoning_restricted"],
    [{code:"kova_model_runtime_unverified",status:503},"model_unavailable"],
    [{code:"kova_model_vision_unavailable",status:400},"unsupported_content"],
    [{code:"web_search_unavailable",status:503},"search_failed"],
    [{code:"hosted_tools_unavailable",status:503},"source_unavailable"],
    [{code:"message_quota_unavailable",status:503},"source_unavailable"],
    [{code:"analysis_sign_in_required",status:401},"sign_in_required"],
    [{code:"file_upload_limit",status:429},"upload_limit"],
    [{code:"image_generation_limit",status:429},"image_limit"],
    [{status:403},"permission_denied"],
    [{status:429,category:"rate_limit"},"rate_limited"],
    [{category:"model_timeout"},"request_timeout"],
    [{category:"model_provider_failure"},"model_unavailable"],
    [{category:"network_failure"},"network_offline"],
  ];
  for (const [error,eventId] of samples) {
    assert.equal(chatFailureNoticeId(error),eventId);
    assert.ok(NOTIFICATION_IDS.includes(eventId),eventId);
  }
});

test("notices never claim a user has signed out when the session is merely unverified", () => {
  assert.equal(chatFailureNoticeId({status:401,code:"authentication_required"},{signedIn:true}),
    "session_expired");
  assert.equal(chatFailureNoticeId({status:401,code:"authentication_required"},{signedIn:false}),
    "sign_in_required");
});

test("client preserves backend quota metadata rather than guessing from error wording", () => {
  const parser=readFileSync("src/lib/chat-sse-client.mjs","utf8");
  const route=readFileSync("src/routes/index.tsx","utf8");
  assert.match(parser,/payload\.code === "message_window_limit"/);
  assert.match(parser,/error\.usageKind/);
  assert.match(route,/chatFailureNoticeId\(err/);
  assert.doesNotMatch(route,/const failureEvent = quotaRejected/);
});

test("real quota response carries a reliable reset instant to the limit dialog", async () => {
  const reset = "2026-11-12T00:00:00.000Z";
  const error = await chatResponseError(Response.json({
    error: "Your weekly Thinking allowance is used.",
    code: "message_window_limit",
    category: "quota_exceeded",
    kind: "thinking",
    resetsAt: reset,
    retryable: false,
  }, {status:429}));
  assert.equal(error.usageKind,"thinking");
  assert.equal(error.resetAtMs, Date.parse(reset));
  assert.equal(chatFailureNoticeId(error), "thinking_limit");
  const invalid = await chatResponseError(Response.json({
    error:"Rate limit",code:"message_window_limit",kind:"thinking",
    resetsAt:"not a date",
  },{status:429}));
  assert.equal(invalid.resetAtMs,undefined);
  const route=readFileSync("src/routes/index.tsx","utf8");
  assert.match(route,/resetsAt: err\.resetAtMs/);
  assert.match(route,/resetsAt=\{limitDialog\.resetsAt\}/);
  assert.doesNotMatch(route,/getUsage\(\)\.resetsAt/);
});

test("Thinking limit sheet uses the server category, not a guessed message string", () => {
  const dialog=readFileSync("src/components/LimitReachedDialog.tsx","utf8");
  const route=readFileSync("src/routes/index.tsx","utf8");
  assert.match(dialog,/usageKind === "thinking" \? "Thinking limit reached"/);
  assert.match(route,/usageKind: err\.usageKind/);
  assert.match(route,/usageKind=\{limitDialog\.usageKind\}/);
  assert.match(dialog,/max-sm:!bottom-0/);
  assert.match(dialog,/safe-area-inset-bottom/);
});
