import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("current Chat packaging stays consistent across server, picker, composer and public copy", () => {
  const entitlements = read("src/lib/mode-entitlements.mjs"),
    selector = read("src/components/ResponsiveModelSelector.tsx"),
    chat = read("src/routes/api/chat.ts");
  assert.match(entitlements, /free:\s*Object\.freeze\(\["instant", "thinking"\]\)/);
  assert.match(
    entitlements,
    /plus:\s*Object\.freeze\(\["instant", "medium", "thinking", "high"\]\)/,
  );
  assert.match(entitlements, /"extra_high", "max", "ultra"/);
  assert.match(selector, /if \(userTier === "free"\)/);
  assert.match(selector, /aria-pressed=\{mode === "thinking"\}/);
  assert.match(selector, /onChange\(mode === "thinking" \? "instant" : "thinking"\)/);
  assert.match(chat, /if \(auth && !isOwner\)/);
  assert.match(chat, /enforceQuota\(auth, "chats", DAILY_CHAT_LIMIT_BY_TIER\[callerTier\]/);
  assert.match(read("src/components/StudyPanel.tsx"), /mode: "instant",[\s\S]*clientTool: "study"/);
  assert.match(read("public/llms.txt"), /Free users can select Default or Thinking/);
});
