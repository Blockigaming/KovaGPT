import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile("src/components/CommandPalette.tsx", "utf8");

test("workspace results participate in the command palette keyboard index", () => {
  assert.match(source, /const visibleWorkspaceItems = useMemo/);
  assert.match(source, /const workspaceStartIndex = actionItems\.length/);
  assert.match(source, /const chatStartIndex = workspaceStartIndex \+ visibleWorkspaceItems\.length/);
  assert.match(source, /const totalItems = chatStartIndex \+ conversationMatches\.length/);
  assert.match(source, /id=\{`command-option-\$\{index\}`\}/);
  assert.match(source, /aria-selected=\{activeIndex === index\}/);
});

test("Enter opens the active workspace result and chat indices follow workspace rows", () => {
  assert.match(
    source,
    /visibleWorkspaceItems\[activeIndex - workspaceStartIndex\][\s\S]*window\.location\.assign\(workspaceMatch\.href\)/,
  );
  assert.match(source, /conversationMatches\[activeIndex - chatStartIndex\]/);
  assert.match(source, /id=\{`command-option-\$\{chatStartIndex \+ chatIndex\}`\}/);
  assert.match(source, /aria-selected=\{activeIndex === chatStartIndex \+ chatIndex\}/);
});

test("global search dialog announces workspace results", () => {
  assert.match(source, /aria-label="Search workspace, chats, and actions"/);
  assert.match(source, /aria-label="Search workspace, commands, and chats"/);
});
