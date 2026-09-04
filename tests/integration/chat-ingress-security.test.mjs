import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("chat uses the shared streamed byte-bounded JSON reader before provider routing", () => {
  const chat = read("src/routes/api/chat.ts");
  const ingress = read("src/lib/chat-ingress.server.mjs");

  assert.match(ingress, /mediaType !== "application\/json"/);
  assert.match(ingress, /unsupported_media_type/);
  assert.match(ingress, /readBoundedJsonObject\(request, maxBytes, signal\)/);
  assert.match(chat, /readChatRequest\(request, CHAT_BODY_LIMIT_BYTES, signal\)/);
  assert.match(chat, /ingressError instanceof ChatIngressError/);
  assert.match(chat, /toChatIngressErrorEnvelope\(ingressError, requestId\)/);
  assert.ok(chat.indexOf("readChatRequest(request") < chat.indexOf("optionalUser(request)"));
  assert.ok(chat.indexOf("readChatRequest(request") < chat.indexOf("missingAiProviderResponse()"));
  assert.doesNotMatch(chat, /request\.text\(\)|request\.json\(\)/);
  assert.doesNotMatch(chat, /Number\(request\.headers\.get\(["']content-length/);
  assert.doesNotMatch(chat, /JSON\.parse\(rawBody\)/);
  assert.match(chat, /h\.set\("Cache-Control", "no-store"\)/);
  assert.match(chat, /h\.delete\("Content-Length"\)/);
});

test("chat and image failures never read or log raw provider responses", () => {
  const chat = read("src/routes/api/chat.ts");

  assert.doesNotMatch(chat, /upstream\.text\(\)|hopRes\.text\(\)/);
  assert.doesNotMatch(chat, /rawErr|providerBody|responseBody|\bstack\s*:/);
  assert.doesNotMatch(chat, /\(e as Error\)\.message|error:\s*e\s*instanceof Error/);
  assert.match(chat, /void upstream\.body\?\.cancel\(\)/);
  assert.match(chat, /image_provider_http_error/);
  assert.match(chat, /final_provider_http_error/);
});

test("chat logs are emitted only through the safe field whitelist", () => {
  const chat = read("src/routes/api/chat.ts");
  const logStart = chat.indexOf("function logSafeFailure");
  const logEnd = chat.indexOf("function buildUserContextBlock", logStart);
  const safeLogger = chat.slice(logStart, logEnd);
  const outsideLogger = chat.slice(0, logStart) + chat.slice(logEnd);

  assert.match(
    safeLogger,
    /requestId:\s*context\.requestId[\s\S]*status:\s*details\.status[\s\S]*category:\s*details\.category[\s\S]*durationMs:[\s\S]*code:\s*details\.code/,
  );
  assert.doesNotMatch(outsideLogger, /console\.(?:error|warn|log)\(/);
  assert.doesNotMatch(safeLogger, /prompt|token|secret|body|message|stack|error\s*:/i);
});

test("anonymous limiting uses bounded buckets and only trusted Cloudflare client IPs", () => {
  const chat = read("src/routes/api/chat.ts");
  const ingress = read("src/lib/chat-ingress.server.mjs");

  assert.match(chat, /resolveAnonymousClientKey\(request\.headers\)/);
  assert.match(chat, /chatAnonymousRateLimiter\.isLimited\(clientKey\)/);
  assert.match(chat, /consumeApplicationRateLimit/);
  assert.match(chat, /action: "guest_chat_preflight"/);
  assert.match(chat, /Retry-After/);
  assert.match(ingress, /CHAT_MAX_ANON_BUCKETS = 4096/);
  assert.match(ingress, /buckets\.size >= maxBuckets - 1/);
  assert.match(ingress, /const overflowKey = "ip:overflow"/);
  assert.match(ingress, /headers\.get\("cf-connecting-ip"\)/);
  assert.doesNotMatch(ingress, /headers\.get\("x-forwarded-for"\)/);
});

test("chat normalization strips client extras and validates all prompt-control fields", () => {
  const ingress = read("src/lib/chat-ingress.server.mjs");

  assert.match(ingress, /normalizeMode\(value\.mode\)/);
  assert.match(ingress, /normalizeUser\(value\.user\)/);
  assert.match(ingress, /normalizeTimezone\(value\.timezone\)/);
  assert.match(ingress, /normalizeLocale\(value\.locale\)/);
  assert.match(ingress, /optionalUuid\(value\.chatId, "chat_id"\)/);
  assert.match(ingress, /optionalUuid\(value\.projectId, "project_id"\)/);
  assert.match(ingress, /optionalTrimmedString\(\s*value\.personality,\s*"personality",\s*500,/);
  assert.match(ingress, /normalizeClientTool\(value\.clientTool\)/);
  assert.doesNotMatch(ingress, /\.\.\.value|Object\.assign\(payload, value\)/);
});

test("only the latest user turn can carry provider-bound attachments", () => {
  const chat = read("src/routes/api/chat.ts");
  const ingress = read("src/lib/chat-ingress.server.mjs");
  const mainChat = read("src/routes/index.tsx");
  const projectChat = read("src/routes/projects.$projectId.chat.$chatId.tsx");

  assert.match(ingress, /const latestMessageIndex = messages\.length - 1/);
  assert.match(ingress, /if \(latestMessage\.role !== "user"\)/);
  assert.match(ingress, /historical_attachments_not_allowed/);
  assert.match(ingress, /index !== latestMessageIndex && message\.attachments/);
  assert.doesNotMatch(ingress, /index === latestMessageIndex \|\| !message\.attachments/);
  assert.match(chat, /const currentAttachments = lastUser\?\.attachments \?\? \[\]/);
  assert.ok(chat.indexOf("const currentAttachments") < chat.indexOf("missingAiProviderResponse()"));

  assert.match(mainChat, /\.\.\.priorMessages\.map\(\(message\) => \(\{/);
  assert.match(mainChat, /attachments: userMsg\.attachments/);
  assert.doesNotMatch(mainChat, /\[\.\.\.priorMessages, userMsg\]\.map/);

  assert.match(
    projectChat,
    /\.filter\(\(message\) => message\.role === "user" \|\| message\.role === "assistant"\)/,
  );
  assert.doesNotMatch(projectChat, /priorSystem|project\.system_prompt/);
});
