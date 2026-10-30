import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("current Chat packaging stays consistent across server, picker, composer and public copy", () => {
  const entitlements = read("src/lib/mode-entitlements.mjs");
  const modes = read("src/lib/modes.ts");
  const selector = read("src/components/ResponsiveModelSelector.tsx");
  const composer = read("src/components/ChatInput.tsx");
  const chat = read("src/routes/api/chat.ts");
  const study = read("src/components/StudyPanel.tsx");
  const publicCopy = read("public/llms.txt");

  assert.match(entitlements, /free:\s*Object\.freeze\(\["instant", "thinking"\]\)/);
  assert.match(
    entitlements,
    /plus:\s*Object\.freeze\(\["instant", "medium", "thinking", "high"\]\)/,
  );
  assert.match(
    entitlements,
    /pro:\s*Object\.freeze\(\["instant", "medium", "thinking", "high", "extra_high", "max", "ultra"\]\)/,
  );
  assert.match(entitlements, /if \(tier === "free"\) return "instant"/);

  assert.match(modes, /id: "instant",[\s\S]*label: "Lite"/);
  assert.match(selector, /const locked = !isLoaded \|\| !isSignedIn;/);
  assert.match(selector, /isModeAllowedForTier\(userTier, mode\)/);
  assert.match(selector, /availableMode.id === "thinking" &&/);
  assert.match(selector, /<Brain aria-hidden="true"/);
  assert.match(
    composer,
    /<ModelSelector mode=\{mode\} onChange=\{onModeChange\} userTier=\{userTier\} compact/,
  );
  assert.doesNotMatch(composer, /thinking-upgrade-button|Thinking is locked/);

  assert.match(
    chat,
    /if \(callerTier === "free" && !capture\) \{\s*const quota = await preflight\.run\("chat_quota", \(signal\) =>\s*enforceQuota\(auth, "chats", DAILY_CHAT_LIMIT_BY_TIER\.free, 1, signal\)/,
  );
  assert.doesNotMatch(chat, /enforceQuota\(auth, "chats", DAILY_CHAT_LIMIT_BY_TIER\[callerTier\]/);

  assert.match(study, /mode: "instant",[\s\S]*clientTool: "study"/);
  assert.match(publicCopy, /Free users can select Default or Thinking/);
});
