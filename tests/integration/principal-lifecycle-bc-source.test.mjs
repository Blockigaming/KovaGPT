import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");
const agentSource = read("src/components/AgentWorkspace.tsx");
const commandSource = read("src/components/CommandPalette.tsx");
const settingsSource = read("src/components/SettingsDialog.tsx");
const storageSource = read("src/lib/principal-browser-storage.mjs");

test("mounted AgentWorkspace invalidates stale generations after principal cleanup", () => {
  assert.match(agentSource, /const storageGenerationRef = useRef\(0\)/);
  assert.match(agentSource, /PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT/);
  assert.match(agentSource, /isPrincipalBrowserStorageClearedEvent\(event, userKey\)/);
  assert.match(
    agentSource,
    /storageGenerationRef\.current = generation;[\s\S]{0,120}setRunState\(\{ principal, generation, items: \[\] \}\)/,
  );
  assert.match(
    agentSource,
    /const generation = runState\.generation;\s*if \(generation !== storageGenerationRef\.current\) return;[\s\S]{0,160}saveAgentRuns\(userKey, next\)/,
  );
  assert.match(
    settingsSource,
    /currentAuthUserKeyRef\.current === resetUserKey[\s\S]{0,160}onChange\(DEFAULT_SETTINGS\);[\s\S]{0,80}onClearAll\(\)/,
  );
});

test("cleanup copy names ownerless purging and account deletion surfaces partial cleanup", () => {
  assert.match(
    settingsSource,
    /Ownerless\s+private\s+data,[\s\S]{0,100}transitional values from older versions,[\s\S]{0,100}another profile/,
  );
  assert.match(
    settingsSource,
    /Other profiles' scoped data,[\s\S]{0,100}device-wide\s+display\s+preferences,[\s\S]{0,80}cloud data are preserved/,
  );
  assert.match(
    settingsSource,
    /cleanupResult\.chatHistory\.failures\.length \+\s*cleanupResult\.pwa\.failures\.length;\s*localCleanupIncomplete = !cleanupResult\.resolved \|\| cleanupFailureCount > 0/,
  );
  assert.match(
    settingsSource,
    /Account deletion completed, but some data in this browser could not be removed\./,
  );
  assert.match(settingsSource, /Clear KovaGPT site data in your browser settings/);
  assert.doesNotMatch(
    settingsSource,
    /clearLocalBrowserData\(\);\s*onClearAll\(\);[\s\S]{0,120}toast\.success/,
  );
});

test("command history and pins are principal scoped and unresolved auth never persists them", () => {
  assert.match(
    commandSource,
    /isLoaded\s*\? principalScopedStorageKey\("kova-command-history-v1", userKey\)\s*:\s*null/,
  );
  assert.match(
    commandSource,
    /isLoaded\s*\? principalScopedStorageKey\("kova-command-pins-v1", userKey\)\s*:\s*null/,
  );
  assert.match(
    commandSource,
    /if \(!open \|\| !isLoaded \|\| !principal \|\| !historyStorageKey \|\| !pinsStorageKey\)/,
  );
  assert.match(commandSource, /isPrincipalBrowserStorageClearedEvent\(event, userKey\)/);
  assert.match(commandSource, /commandState\.principal === principal/);
  assert.match(commandSource, /generation !== storageGenerationRef\.current/);
  assert.match(
    commandSource,
    /setCommandState\(\{ principal, generation, recent: \[\], pinned: \[\] \}\)/,
  );
  assert.doesNotMatch(
    commandSource,
    /localStorage\.(?:getItem|setItem|removeItem)\("kova-command-(?:history|pins)-v1"/,
  );
  assert.match(storageSource, /"kova-command-history-v1"/);
  assert.match(storageSource, /"kova-command-pins-v1"/);
});

test("live handoff producers and consumers use the tested principal envelope helpers", () => {
  const sources = {
    agent: agentSource,
    apps: read("src/routes/apps.tsx"),
    contextPacks: read("src/routes/context-packs.tsx"),
    home: read("src/routes/index.tsx"),
    prompts: read("src/routes/prompt-studio.tsx"),
    research: read("src/routes/research-planner.tsx"),
    scheduled: read("src/routes/scheduled-tasks.tsx"),
  };

  const producerKeys = new Map([
    ["kova-active-context-pack", [sources.contextPacks]],
    ["kova-app-chat-context", [sources.apps]],
    ["kova-prompt-launch", [sources.prompts]],
    ["kova-research-launch", [sources.research]],
    ["kova-work-context", [sources.agent]],
    ["kova-automation-draft", [sources.agent]],
    ["kova-research-draft", [sources.contextPacks]],
    ["kova-work-draft", [sources.contextPacks, sources.research]],
  ]);
  for (const [key, producers] of producerKeys) {
    for (const source of producers) {
      assert.match(source, new RegExp(`writePrincipalHandoff\\([\\s\\S]{0,160}"${key}"`), key);
    }
  }

  assert.match(
    sources.home,
    /const storage = safeBrowserStorage\("sessionStorage"\);[\s\S]{0,260}consumePrincipalHandoff<T>\(storage, baseKey, userKey\)/,
  );
  for (const key of [
    "kova-active-context-pack",
    "kova-app-chat-context",
    "kova-prompt-launch",
    "kova-research-launch",
    "kova-work-context",
  ]) {
    assert.match(sources.home, new RegExp(`consume<[\\s\\S]{0,320}>\\("${key}",`), key);
  }
  for (const [key, source] of [
    ["kova-automation-draft", sources.scheduled],
    ["kova-research-draft", sources.research],
    ["kova-context-candidates", sources.contextPacks],
  ]) {
    assert.match(source, /consumePrincipalHandoff/);
    assert.match(source, new RegExp(`"${key}"`), key);
  }

  const allLiveSources = Object.values(sources).join("\n");
  assert.doesNotMatch(
    allLiveSources,
    /(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)\(\s*["']kova-(?:active-context-pack|app-chat-context|prompt-launch|research-launch|work-context|automation-draft|work-draft|research-draft|context-candidates)/,
  );
  assert.match(sources.home, /if \(!principalReady\) return;/);
  assert.match(
    sources.home,
    /candidates\.sort\(\(left, right\) => right\.createdAt - left\.createdAt\)/,
  );
  assert.match(sources.home, /\}, \[principalReady, userKey\]\);/);
});

test("handoff helpers remove before parsing and retain no ownerless fallback", () => {
  const removeIndex = storageSource.indexOf("storage.removeItem(key)");
  const parseIndex = storageSource.indexOf("parsePrincipalHandoffEnvelope(raw, userKey, options)");
  assert.ok(removeIndex >= 0 && parseIndex > removeIndex);
  assert.match(storageSource, /return parsed\.ok \? \{ \.\.\.parsed, key \} : parsed/);
  assert.doesNotMatch(storageSource, /getItem\(["']kova-(?:active-context-pack|prompt-launch)/);
});

test("live private feature stores are principal tagged and reset stale mounted state", () => {
  const sources = {
    apps: read("src/routes/apps.tsx"),
    chat: read("src/components/ChatMessage.tsx"),
    library: read("src/routes/library.tsx"),
    personality: read("src/components/PersonalitySliders.tsx"),
    prompts: read("src/routes/prompt-studio.tsx"),
    research: read("src/routes/research-planner.tsx"),
    scheduled: read("src/routes/scheduled-tasks.tsx"),
    shortcuts: read("src/lib/shortcuts.ts"),
    summary: read("src/routes/summary.tsx"),
    timers: read("src/lib/timers.ts"),
    write: read("src/routes/write.tsx"),
  };

  for (const [name, source] of Object.entries(sources)) {
    assert.match(source, /principalScopedStorageKey|browserStoragePrincipal/, name);
    assert.doesNotMatch(
      source,
      /localStorage\.(?:getItem|setItem|removeItem)\(\s*["'](?:kova\.write|kova-prompt-studio-draft-v1|kova-app-activity-v1|kova-library-favorites|kovagpt:savedMessageIds|kova\.personality|kova-shortcuts-v1|kova-feedback:|kova-timers-v1|kova-summary-dismissed-v1|kova-weather-opt-in)/,
      name,
    );
  }

  for (const source of [sources.prompts, sources.research, sources.scheduled]) {
    assert.match(source, /generationRef = useRef\(0\)/);
    assert.match(source, /dataPrincipal/);
    assert.match(source, /isPrincipalBrowserStorageClearedEvent\(event, userKey\)/);
    assert.match(source, /generationRef\.current !== generation/);
  }
});

test("same-principal cleanup blocks late writes and account-switch UI flashes", () => {
  const apps = read("src/routes/apps.tsx");
  const chat = read("src/components/ChatMessage.tsx");
  const home = read("src/routes/index.tsx");
  const summary = read("src/routes/summary.tsx");
  const write = read("src/routes/write.tsx");

  assert.match(chat, /lifecycleGenerationRef\.current \+= 1/);
  assert.match(chat, /requestGeneration === lifecycleGenerationRef\.current/);
  assert.match(chat, /if \(!isCurrent\(\)\) return;[\s\S]{0,180}savedIds\.push/);

  assert.match(write, /if \(!documentReady \|\| !dirty \|\| !draftKey \|\| !titleKey\) return/);
  assert.match(write, /requestPrincipal !== principalRef\.current/);
  assert.match(write, /setDirty\(false\);[\s\S]{0,100}setDocumentPrincipal\(principal\)/);

  assert.match(apps, /const visibleGoogleStatus = activityReady \? googleStatus : null/);
  assert.match(apps, /setLifecycleVersion\(\(value\) => value \+ 1\)/);
  assert.match(summary, /function useWeather\(enabled: boolean, scope: string \| null\)/);
  assert.match(summary, /if \(!current\) return;[\s\S]{0,100}setState\(/);

  assert.match(home, /setCommandQuery\(""\)/);
  assert.match(
    home,
    /setConversationState\(\{ principal: storagePrincipal, items: \[\] \}\);[\s\S]{0,100}setSettingsPrincipal\(storagePrincipal\)/,
  );
  assert.match(settingsSource, /currentAuthUserKeyRef\.current === deletionUserKey/);
  assert.match(
    settingsSource,
    /if \(currentAuthUserKeyRef\.current === deletionUserKey\) await clerk\?\.signOut\(\)/,
  );
});
