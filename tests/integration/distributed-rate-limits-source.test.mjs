import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(path, "utf8");

test("public and expensive utility routes use the shared cross-instance limiter", async () => {
  const [chat, title, project, support, diagnostics] = await Promise.all([
    read("src/routes/api/chat.ts"),
    read("src/routes/api/title.ts"),
    read("src/routes/api/project-suggest.ts"),
    read("src/routes/api/public/help-submit.ts"),
    read("src/routes/api/admin/diagnostics.ts"),
  ]);

  for (const source of [chat, title, project, support, diagnostics]) {
    assert.match(source, /consumeApplicationRateLimit/);
    assert.match(source, /Retry-After/);
  }
  for (const source of [title, project, support, diagnostics])
    assert.doesNotMatch(source, /new Map/);
  for (const source of [title, support]) {
    assert.match(source, /resolveAnonymousClientKey\(request\.headers\)/);
    assert.doesNotMatch(source, /x-forwarded-for|x-real-ip/iu);
  }
  assert.match(project, /identity: `user:\$\{auth\.userId\}`/);
  assert.match(diagnostics, /identity: `user:\$\{authorization\.caller\.userId\}`/);
  assert.match(chat, /action: "guest_chat_preflight"/);
  assert.ok(
    chat.indexOf('action: "guest_chat_preflight"') <
      chat.indexOf("const result = await runWebSearch("),
    "guest protection must run before optional web-search work",
  );
});

test("distributed limiter is fail-closed and never persists a raw identity", async () => {
  const limiter = await read("src/lib/distributed-rate-limit.mjs");
  const server = await read("src/lib/distributed-rate-limit.server.ts");
  assert.match(limiter, /status: "unavailable", allowed: false/);
  assert.match(limiter, /hashRateLimitIdentity/);
  assert.match(limiter, /HMAC/);
  assert.match(limiter, /p_identity_hash: identityHash/);
  assert.doesNotMatch(limiter, /p_identity_hash: identity[,\s]/);
  assert.match(server, /runtimeEnv\("SUPABASE_SERVICE_ROLE_KEY"\)/);
  assert.match(server, /runtimeEnv\("KOVA_IP_HASH_SECRET"\)/);
});

test("title requests validate bounded input before consuming a distributed bucket", async () => {
  const title = await read("src/routes/api/title.ts");
  assert.ok(
    title.indexOf("const messages = parseMessages(raw)") <
      title.indexOf("const rateLimit = await consumeApplicationRateLimit"),
    "malformed title requests must fail deterministically before rate-limit infrastructure",
  );
});

test("Google integration actions share the atomic limiter", async () => {
  const source = await read("src/lib/google-rate-limit.server.ts");
  assert.match(source, /consumeApplicationRateLimit/);
  assert.match(source, /action: `google_\$\{operation\}`/);
  assert.match(source, /status: result\.status === "limited" \? 429 : 503/);
  assert.doesNotMatch(source, /new Map/);
});
