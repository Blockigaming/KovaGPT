import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read = (path) => readFile(path, "utf8");
const [chat, memory, client, worker, server, exports, snapshot] = await Promise.all([
  read("src/routes/api/chat.ts"),
  read("src/routes/api/memory.ts"),
  read("src/routes/index.tsx"),
  read("src/routes/api/internal/chat-summaries.ts"),
  read("src/lib/chat-summary.server.ts"),
  read("src/lib/account-export-policy.mjs"),
  read("src/lib/chat-summary-snapshot.mjs"),
]);

test("same-chat summary reads require paid consent and an explicit non-Temporary privacy boundary", () => {
  const section = chat.slice(
    chat.indexOf("let conversationSummary:"),
    chat.indexOf("// Project workspace context:"),
  );
  assert.match(
    section,
    /auth &&[\s\S]*chatId &&[\s\S]*!temporary &&[\s\S]*memoryStartIndex !== undefined/,
  );
  assert.match(section, /callerTier === "plus" \|\| callerTier === "pro"/);
  assert.match(section, /personalContext\?\.rememberAcross === true/);
  assert.match(section, /buildChatSummaryContext/);
  assert.doesNotMatch(chat, /queueChatSummary/);
  assert.match(server, /\.eq\("user_id", input\.userId\)[\s\S]*\.eq\("chat_id", input\.chatId\)/);
  assert.match(server, /acceptChatSummary\(result\.data, input\)/);
});

test("durable admission stays in the existing serialized memory POST and deletion removes jobs first", () => {
  assert.match(client, /scheduleMemoryWrites\(active, userKey, controller\.signal\)/);
  assert.match(
    snapshot,
    /enqueueMemoryWrite\([\s\S]*?run: async \(\) =>[\s\S]*?writeMemoryForPrincipal\(active, principal/,
  );
  assert.match(
    memory,
    /parseMemoryPayload\(raw\)[\s\S]*?queueChatSummary\(\s*authorized\.auth\.supabaseAdmin,\s*authorized\.auth\.userId/,
  );
  assert.ok(
    memory.indexOf("memoryEpoch = await beginChatMemoryWrite") <
      memory.indexOf("raw = await readUtf8BodyBounded"),
  );
  assert.match(memory, /persistChatMemory\(authorized\.auth\.supabaseAdmin, memoryEpoch, row\)/);
  assert.match(
    memory,
    /deleteChatMemory\(caller\.auth\.supabaseAdmin, caller\.auth\.userId, chatId\)/,
  );
  assert.match(exports, /\["chat_context_summaries", "user_id"\]/);
});

test("worker activation requires a dedicated secret and explicit flag and uses the bounded provider contract", () => {
  assert.match(server, /runtimeEnv\("KOVA_CHAT_SUMMARIES_ENABLED"\) === "true"/);
  assert.match(server, /runtimeEnv\("CHAT_SUMMARY_WORKER_SECRET"\)/);
  assert.match(worker, /timingSafeEqualText\(supplied, secret\)/);
  assert.ok(
    worker.indexOf("timingSafeEqualText(supplied, secret)") <
      worker.indexOf("await runChatSummaryBatch()"),
  );
  assert.doesNotMatch(worker, /CRON_SECRET/);
  assert.match(server, /modelForRole\("UTILITY"\)/);
  assert.match(server, /AbortSignal\.timeout\(45_000\)/);
  assert.match(server, /readProviderJsonObject\(response, 64 \* 1024\)/);
  const batch = server.slice(server.indexOf("export async function runChatSummaryBatch"));
  assert.ok(
    batch.indexOf('"purge_expired_chat_context_inputs"') <
      batch.indexOf("if (!chatSummariesEnabled())"),
  );
  assert.doesNotMatch(worker, /chatSummariesEnabled/);
});
