import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chatRoute = readFileSync("src/routes/api/chat.ts", "utf8");
const homeChat = readFileSync("src/routes/index.tsx", "utf8");
const projectChat = readFileSync("src/routes/projects.$projectId.chat.$chatId.tsx", "utf8");
const responsesCompat = readFileSync("src/lib/ai/responses-compat.server.mjs", "utf8");
const accounting = readFileSync("src/lib/ai/accounting.server.ts", "utf8");
const providerBounds = readFileSync("src/lib/provider-response.server.mjs", "utf8");

test("chat route bounds mandatory authorization and usage stages", () => {
  assert.match(chatRoute, /createChatPreflightRunner\(\{/u);
  for (const stage of [
    "request_body",
    "session",
    "guest_rate_limit",
    "ban_check",
    "plan_entitlement",
    "chat_feature",
    "chat_quota",
    "upload_feature",
    "upload_quota",
    "usage_authorization",
  ]) {
    assert.match(chatRoute, new RegExp(`preflight\\.run\\("${stage}"`, "u"));
  }
  assert.match(chatRoute, /finally \{\s*preflight\.close\(\)/u);
  assert.match(chatRoute, /e instanceof ChatPreflightError/u);
  assert.match(chatRoute, /\.\.\.e\.toEnvelope\(\)/u);
  assert.match(chatRoute, /e\.retryable \? \{ "Retry-After": "5" \} : \{\}/u);
});

test("optional chat enrichment stages fail open behind explicit short bounds", () => {
  for (const stage of [
    "owner_lookup",
    "lockdown",
    "library_attachment",
    "web_search",
    "memory_context",
    "project_membership",
    "project_context",
    "project_memory",
    "project_retrieval",
    "chat_workspace",
    "connector_tools",
  ]) {
    const stageMatch = new RegExp(`preflight\\.run\\(\\s*"${stage}"`, "u").exec(chatRoute);
    assert.ok(stageMatch, `${stage} must be bounded`);
    const stageAt = stageMatch.index;
    const nextStageAt = chatRoute.indexOf("preflight.run(", stageAt + stageMatch[0].length);
    const stageCall = chatRoute.slice(stageAt, nextStageAt === -1 ? chatRoute.length : nextStageAt);
    assert.match(stageCall, /\{ required: false(?:, timeoutMs: [\d_]+)? \}/u);
  }
  assert.match(chatRoute, /\[chat\] preflight stage/u);
});

test("inline chat attachments consume upload quota but not durable storage quota", () => {
  assert.match(chatRoute, /enforceQuota\([\s\S]{0,100}"uploads"/u);
  assert.doesNotMatch(chatRoute, /enforceStorage/u);
  assert.doesNotMatch(chatRoute, /STORAGE_LIMITS_BYTES/u);
});

test("main chat preserves the plan-limit dialog for authoritative 429 responses", () => {
  assert.match(homeChat, /err\.status === 429 && \/limit\/i\.test\(raw\)/u);
  assert.match(homeChat, /setLimitDialog\(\{ open: true, kind, message: raw \}\)/u);
});

test("all chat clients share strict terminal SSE consumption", () => {
  for (const source of [homeChat, projectChat]) {
    assert.match(source, /consumeChatSse\(/u);
    assert.match(source, /chatResponseError\(/u);
    assert.doesNotMatch(source, /buffer = line \+ "\\n" \+ buffer/u);
    assert.doesNotMatch(source, /JSON\.parse\(data\)/u);
  }
});

test("Responses translation rejects malformed provider JSON", () => {
  assert.match(responsesCompat, /invalid_provider_sse_json/u);
  assert.match(responsesCompat, /reader\.cancel\("invalid_provider_sse_json"\)/u);
  assert.doesNotMatch(responsesCompat, /catch \{\s*continue;\s*\}/u);
});

test("usage authorization receives cancellation and provider errors retain typed metadata", () => {
  assert.match(accounting, /periodQuery\.abortSignal\(signal\)/u);
  assert.match(accounting, /acquisitionQuery\.abortSignal\(input\.signal\)/u);
  assert.match(chatRoute, /readChatRequest\(request, CHAT_BODY_LIMIT_BYTES, signal\)/u);
  assert.match(chatRoute, /enforceQuota\([\s\S]{0,160}signal/u);
  assert.match(accounting, /input\.signal/u);
  assert.match(chatRoute, /providerError\.toSafeResponse\(\)/u);
  assert.match(chatRoute, /kind: "error"/u);
  assert.match(chatRoute, /retryable: providerError\.retryable/u);
  assert.match(providerBounds, /isTransportInterruption\(error\)/u);
});
