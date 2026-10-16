import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("inactive launch UI does not change historical server entitlement enforcement", () => {
  const entitlements = read("src/lib/mode-entitlements.mjs");
  const modes = read("src/lib/modes.ts");
  const selector = read("src/components/ResponsiveModelSelector.tsx");
  const composer = read("src/components/ChatInput.tsx");
  const chat = read("src/routes/api/chat.ts");
  const study = read("src/components/StudyPanel.tsx");
  const publicCopy = read("public/llms.txt");

  assert.match(entitlements, /free:\s*Object\.freeze\(\["instant"\]\)/);
  assert.match(entitlements, /plus:\s*Object\.freeze\(\["instant", "medium", "high"\]\)/);
  assert.match(
    entitlements,
    /pro:\s*Object\.freeze\(\["instant", "medium", "high", "extra_high", "max", "ultra"\]\)/,
  );
  assert.match(entitlements, /if \(tier === "free"\) return "instant"/);

  assert.match(modes, /id: "instant",[\s\S]*label: "Lite"/);
  assert.match(modes, /tier === "plus" && id === "high"[\s\S]*label: "Thinking"/);
  assert.match(selector, /kova-model-static/);
  assert.match(selector, /onChange\(CORE_LAUNCH_MODE\)/);
  assert.doesNotMatch(selector, /<button|model-selector-trigger/);
  assert.doesNotMatch(composer, /thinking-upgrade-button|Upgrade to Plus for Thinking/);

  assert.match(
    chat,
    /if \(callerTier === "free"\) \{[\s\S]*enforceQuota\(auth, "chats", DAILY_CHAT_LIMIT_BY_TIER\.free/,
  );
  assert.doesNotMatch(chat, /enforceQuota\(auth, "chats", DAILY_CHAT_LIMIT_BY_TIER\[callerTier\]/);

  assert.match(study, /mode: "instant",[\s\S]*clientTool: "study"/);
  assert.match(publicCopy, /one unified assistant/);
  assert.match(publicCopy, /Model selection and response effort are separate/);
});
