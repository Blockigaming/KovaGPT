import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectChat = await readFile("src/routes/projects.$projectId.chat.$chatId.tsx", "utf8");
const chatInput = await readFile("src/components/ChatInput.tsx", "utf8");

test("project chat uses the shared chat surface without unsupported controls", () => {
  assert.match(projectChat, /import \{ ChatInput,/);
  assert.match(projectChat, /import \{ ChatMessage \}/);
  assert.match(projectChat, /<ChatInput/);
  assert.match(projectChat, /<ChatMessage/);
  assert.match(projectChat, /showAddMenu=\{false\}/);
  assert.match(projectChat, /disabled=\{!canEdit\}/);
  assert.doesNotMatch(projectChat, /@\/components\/ui\/textarea/);
  assert.doesNotMatch(projectChat, /\b(?:prompt|confirm)\s*\(/);
  assert.doesNotMatch(projectChat, /h-\[100dvh\]/);
  assert.doesNotMatch(projectChat, /bg-primary\s+text-primary-foreground/);
  assert.doesNotMatch(projectChat, /\b(?:voice|microphone)\b/i);
});

test("project chat can stop generation and saves only non-empty assistant output", () => {
  assert.match(projectChat, /new AbortController\(\)/);
  assert.match(projectChat, /signal: controller\.signal/);
  assert.match(projectChat, /abortControllerRef\.current\?\.abort\(\)/);
  assert.match(projectChat, /assistant\.trim\(\)\s*\?/);
  assert.match(
    projectChat,
    /await fnSave\(\{ data: \{ id: requestChatId, messages: finalMessages \} \}\)/,
  );
  assert.match(projectChat, /project\?\.role === "owner" \|\| project\?\.role === "editor"/);
  assert.match(projectChat, /projectId,/);
});

test("shared composer defaults preserve existing callers while supporting project permissions", () => {
  assert.match(chatInput, /disabled = false/);
  assert.match(chatInput, /showAddMenu = true/);
  assert.match(chatInput, /disabled\?: boolean/);
  assert.match(chatInput, /showAddMenu\?: boolean/);
  assert.match(chatInput, /if \(disabled \|\| submittingRef\.current \|\| isStreaming\) return/);
  assert.match(chatInput, /disabled=\{disabled\}/);
  assert.match(chatInput, /showAddMenu && isMobileLayout/);
});
