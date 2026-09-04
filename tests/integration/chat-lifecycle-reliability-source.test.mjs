import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chatRoute = readFileSync("src/routes/api/chat.ts", "utf8");
const homeChat = readFileSync("src/routes/index.tsx", "utf8");
const projectChat = readFileSync("src/routes/projects.$projectId.chat.$chatId.tsx", "utf8");
const responsesCompat = readFileSync("src/lib/ai/responses-compat.server.mjs", "utf8");

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
  assert.match(chatRoute, /retryable: e\.retryable/u);
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
    assert.match(
      chatRoute,
      new RegExp(
        `preflight\\.run\\([\\s\\S]{0,120}"${stage}"[\\s\\S]{0,500}required: false`,
        "u",
      ),
    );
  }
  assert.match(chatRoute, /\[chat\] preflight stage/u);
});

test("inline chat attachments consume upload quota but not durable storage quota", () => {
  assert.match(chatRoute, /enforceQuota\([\s\S]{0,100}"uploads"/u);
  assert.doesNotMatch(chatRoute, /enforceStorage/u);
  assert.doesNotMatch(chatRoute, /STORAGE_LIMITS_BYTES/u);
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
