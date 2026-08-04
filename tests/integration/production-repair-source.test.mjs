import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const chat = await readFile("src/routes/api/chat.ts", "utf8");
const projectSuggest = await readFile("src/routes/api/project-suggest.ts", "utf8");
const auth = await readFile("src/lib/api-auth.server.ts", "utf8");
const recovery = await readFile("src/routes/reset-password.tsx", "utf8");
const githubWebhook = await readFile("src/routes/api/github/webhook.ts", "utf8");
const home = await readFile("src/routes/index.tsx", "utf8");

test("AI routes reject untrusted message and attachment shapes", () => {
  assert.match(chat, /valid system, user, or assistant role/);
  assert.match(chat, /attachments must be an array/);
  assert.match(chat, /supported image data URL/);
  assert.match(chat, /Invalid Library attachment metadata/);
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
  assert.match(recovery, /SIGNED_IN/);
  assert.match(recovery, /8_000/);
  assert.doesNotMatch(recovery, /setTimeout\(check, 200\)/);
});
