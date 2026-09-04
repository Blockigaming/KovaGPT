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
    /\(callerTier === "plus" \|\| callerTier === "pro"\)[\s\S]{0,100}personalContext\?\.rememberAcross === true[\s\S]{0,60}usesExistingContext/,
  );
  assert.doesNotMatch(chatApi, /rememberAcross !== false/);
  assert.match(parser, /body\.memoryEnabled !== true/);
  assert.match(parser, /body\.temporary !== false/);
});

test("Temporary Chat enforces clean or personalized context without new memory", () => {
  const page = read("src/routes/index.tsx");
  const chatApi = read("src/routes/api/chat.ts");
  const dialog = read("src/components/TemporaryChatStartDialog.tsx");

  assert.match(
    page,
    /This chat won't appear in history or be used for cross-chat memory\. It also will not use saved profile details, custom instructions, or personality settings\./,
  );
  assert.match(page, /temporaryContext: tempChat \? tempChatContext : undefined/);
  assert.match(page, /user: tempChat && tempChatContext === "clean"[\s\S]{0,40}\? undefined/);
  assert.match(
    page,
    /personality: tempChat && tempChatContext === "clean"[\s\S]{0,40}\? undefined/,
  );
  assert.match(chatApi, /temporaryContext === "personalized"/);
  assert.match(chatApi, /const personalContext = usesExistingContext \? user : undefined/);
  assert.match(chatApi, /usesExistingContext && personality/);
  assert.match(chatApi, /temporary: !usesExistingContext/);
  assert.match(
    chatApi,
    /auth &&\s*usesExistingContext[\s\S]{0,120}getAvailableGoogleTools/,
  );
  assert.match(chatApi, /buildUserContextBlock\(personalContext \?\? \{\}\)/);
  assert.match(page, /if \(!active \|\| active\.temporary\) return/);
  assert.match(page, /memoryStartIndex: convertedAt/);
  assert.match(page, /Save to history/);
  assert.match(dialog, /You cannot change this choice after the chat starts/);
  assert.match(dialog, /Nothing from this temporary chat will be added to memory/);
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

test("family-plan entitlement is resolved by the server and picks the highest active tier", () => {
  const auth = read("src/lib/api-auth.server.ts");
  const chatApi = read("src/routes/api/chat.ts");

  assert.match(auth, /resolveSubscriptionTier/);
  assert.match(auth, /resolved = higherTier\(resolved, tierForLookupKey\(row\.price_id\)\)/);
  assert.match(auth, /\.rpc\("family_owner_of"/);
  assert.match(auth, /resolveSubscriptionTier\(caller, ownerId\)/);
  assert.match(chatApi, /callerTier = isOwner \? "pro" : await getCallerTier\(auth\)/);
});
