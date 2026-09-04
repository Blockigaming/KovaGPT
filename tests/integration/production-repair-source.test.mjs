import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const chat = await readFile("src/routes/api/chat.ts", "utf8");
const chatIngress = await readFile("src/lib/chat-ingress.server.mjs", "utf8");
const projectSuggest = await readFile("src/routes/api/project-suggest.ts", "utf8");
const auth = await readFile("src/lib/api-auth.server.ts", "utf8");
const recovery = await readFile("src/routes/reset-password.tsx", "utf8");
const githubWebhook = await readFile("src/routes/api/github/webhook.ts", "utf8");
const home = await readFile("src/routes/index.tsx", "utf8");

test("AI routes reject untrusted message and attachment shapes", () => {
  assert.match(chat, /readChatRequest\(request, CHAT_BODY_LIMIT_BYTES, signal\)/);
  assert.match(chatIngress, /valid user or assistant role/);
  assert.match(
    chatIngress,
    /!Array\.isArray\(value\.attachments\).*invalid\("invalid_attachments"\)/,
  );
  assert.match(chatIngress, /IMAGE_DATA_URL_PATTERN/);
  assert.match(chatIngress, /invalid_image_attachment/);
  assert.match(chatIngress, /optionalUuid\(value\.libraryItemId, "library_item_id"\)/);
  assert.match(chatIngress, /invalid_library_attachment/);
});

test("mobile navigation is not covered by redundant floating actions", () => {
  assert.doesNotMatch(home, /<MobileFabs/);
});

test("project suggestions are authenticated, quota-bound, and never fabricated", () => {
  assert.match(projectSuggest, /requireUser\(request\)/);
  assert.match(projectSuggest, /assertNotBanned\(auth\)/);
  assert.match(projectSuggest, /enforceQuota/);
  assert.match(projectSuggest, /missingAiProviderResponse\(\)/);
  assert.doesNotMatch(projectSuggest, /function fallback|Math\.random/);
});

test("moderation lookup failure is fail-closed and webhook bodies are bounded", () => {
  assert.match(auth, /Account status could not be verified/);
  assert.match(auth, /503/);
  assert.match(githubWebhook, /Webhook payload too large/);
  assert.match(githubWebhook, /2 \* 1024 \* 1024/);
});

test("password recovery waits for the provider exchange instead of racing it", () => {
  assert.match(recovery, /PASSWORD_RECOVERY/);
  assert.match(recovery, /markPasswordRecoveryFlow/);
  assert.match(recovery, /hasRecentPasswordRecoveryFlow/);
  assert.match(recovery, /15_000/);
  assert.doesNotMatch(recovery, /event === "SIGNED_IN"/);
  assert.doesNotMatch(recovery, /setTimeout\(check, 200\)/);
});
