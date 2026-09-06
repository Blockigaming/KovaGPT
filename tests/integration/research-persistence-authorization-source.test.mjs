import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chatSource = readFileSync(new URL("../../src/routes/api/chat.ts", import.meta.url), "utf8");
const authSource = readFileSync(
  new URL("../../src/lib/api-auth.server.ts", import.meta.url),
  "utf8",
);
const clientSource = readFileSync(new URL("../../src/routes/index.tsx", import.meta.url), "utf8");

test("research authorization precedes every provider and quota decision", () => {
  const authorizeAt = chatSource.indexOf('preflight.run("research_authorization"');
  const authorizationCallAt = chatSource.indexOf("authorizeResearchPersistence({", authorizeAt);
  const providerConfigAt = chatSource.indexOf(
    "const missingProvider = missingAiProviderResponse();",
  );
  const quotaAt = chatSource.indexOf('preflight.run("chat_quota"');
  const executionAt = chatSource.indexOf("return handleDeepResearchRequest(lastText");

  assert.ok(authorizeAt > 0, "authorization gate must exist");
  assert.ok(
    authorizationCallAt > authorizeAt,
    "bounded authorization stage must call the ownership verifier",
  );
  assert.ok(authorizeAt < providerConfigAt, "authorization must precede provider configuration");
  assert.ok(authorizeAt < quotaAt, "authorization must precede quota charging");
  assert.ok(authorizeAt < executionAt, "authorization must precede provider execution");
});

test("service-role persistence receives only authorization output", () => {
  const persistenceStart = chatSource.indexOf("persistence: auth");
  const persistenceEnd = chatSource.indexOf("temporary: Boolean(temporary)", persistenceStart);
  const persistenceBlock = chatSource.slice(persistenceStart, persistenceEnd);

  assert.match(persistenceBlock, /chatId: authorizedResearchReferences\?\.chatId/);
  assert.match(persistenceBlock, /projectId: authorizedResearchReferences\?\.projectId/);
  assert.doesNotMatch(persistenceBlock, /\n\s+chatId,\s*\n/);
  assert.doesNotMatch(persistenceBlock, /projectId:\s*typeof projectId/);
});

test("authorization uses a verified JWT-scoped user client while writes retain service role", () => {
  assert.match(authSource, /global:\s*\{ headers:\s*\{ Authorization: `Bearer \$\{token\}` \} \}/);
  assert.match(authSource, /supabaseUser:\s*verifier/);
  assert.match(chatSource, /supabaseUser:\s*auth\.supabaseUser/);
  assert.match(chatSource, /supabase:\s*\n\s*auth\.supabaseAdmin/);
});

test("the first-party main-chat client does not submit an unowned research chat id", () => {
  assert.match(clientSource, /chatId:\s*activeTool === "deep_research" \? undefined : nextConvId/);
});
