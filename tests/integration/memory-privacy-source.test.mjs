import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test("saved-memory reads and POSTs require explicit browser consent and paid entitlement", () => {
  const settings = read("src/components/SettingsDialog.tsx");
  const page = read("src/routes/index.tsx");
  const chatApi = read("src/routes/api/chat.ts");
  const parser = read("src/lib/endpoint-reliability.mjs");

  assert.match(settings, /rememberAcross: false/);
  assert.match(page, /setSettingsPrincipal\(storagePrincipal\)/);
  assert.match(page, /if \(!settingsReady\) return;[\s\S]{0,120}blockMemoryWrites/);
  assert.match(
    page,
    /!settings\.rememberAcross[\s\S]{0,80}tier === "free"[\s\S]{0,220}!active \|\| active\.temporary/,
  );
  assert.match(page, /memoryEnabled: true,[\s\S]{0,40}temporary: false/);
  assert.match(page, /enqueueMemoryWrite\(\{/);
  assert.match(
    chatApi,
    /\(callerTier === "plus" \|\| callerTier === "pro"\)[\s\S]{0,100}personalContext\?\.rememberAcross === true[\s\S]{0,40}!temporary/,
  );
  assert.doesNotMatch(chatApi, /rememberAcross !== false/);
  assert.match(parser, /body\.memoryEnabled !== true/);
  assert.match(parser, /body\.temporary !== false/);
});

test("Temporary Chat omits and server-discards cross-chat personal context", () => {
  const page = read("src/routes/index.tsx");
  const chatApi = read("src/routes/api/chat.ts");

  assert.match(
    page,
    /This chat won't appear in history or be used for cross-chat memory\. It also will not use saved profile details, custom instructions, or personality settings\./,
  );
  assert.match(page, /user: tempChat[\s\S]{0,40}\? undefined/);
  assert.match(page, /personality: tempChat[\s\S]{0,40}\? undefined/);
  assert.match(chatApi, /const personalContext = temporary \? undefined : user/);
  assert.match(chatApi, /const personalityBlock =\s*!temporary && personality/);
  assert.match(chatApi, /buildUserContextBlock\(personalContext \?\? \{\}\)/);
  assert.match(page, /does not use or update saved[\s\S]{0,100}custom instructions/);
});

test("saved-memory deletion is authenticated, serialized after writes, and truthful on failure", () => {
  const settings = read("src/components/SettingsDialog.tsx");
  const coordinator = read("src/lib/memory-write-coordinator.mjs");
  const memoryApi = read("src/routes/api/memory.ts");

  assert.match(settings, /authFetch\("\/api\/memory", \{ method: "DELETE" \}\)/);
  assert.match(settings, /deleteSavedMemoryAfterDraining\(\{/);
  assert.match(settings, /onChange\(\{ \.\.\.settings, rememberAcross: false \}\)/);
  assert.match(settings, /Memory remains off in this browser/);
  assert.match(settings, /Browser-saved chats are not deleted/);
  assert.match(coordinator, /await pendingWrites/);
  assert.match(coordinator, /await run\(\)/);
  assert.match(coordinator, /globalThis\.navigator\?\.locks/);
  assert.match(coordinator, /isMemoryWriteBlocked\(normalized\)/);
  assert.match(settings, /blockMemoryWrites\(userKey\)/);
  assert.match(memoryApi, /const caller = await identifyMemoryCaller\(request\)/);
  assert.match(memoryApi, /delete\(\)\.eq\("user_id", caller\.auth\.userId\)/);
});

test("family-plan entitlement uses the centralized effective database resolver", () => {
  const auth = read("src/lib/api-auth.server.ts");
  const resolver = read("src/lib/billing-entitlement.server.ts");
  const chatApi = read("src/routes/api/chat.ts");

  assert.match(auth, /resolveEffectiveBillingTier\(caller\.supabaseAdmin, caller\.userId\)/);
  assert.match(resolver, /\.rpc\("effective_user_plan_tier"/);
  assert.doesNotMatch(auth, /tierForLookupKey|\.from\("subscriptions"\)/);
  assert.doesNotMatch(resolver, /tierForLookupKey|\.from\("subscriptions"\)/);
  assert.match(chatApi, /callerTier = isOwner \? "pro" : await getCallerTier\(auth\)/);
});
