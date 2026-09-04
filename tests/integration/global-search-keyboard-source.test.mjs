import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [source, indexSource] = await Promise.all([
  readFile("src/components/CommandPalette.tsx", "utf8"),
  readFile("src/routes/index.tsx", "utf8"),
]);

test("workspace results use the keyboard index", () => {
  assert.match(source, /const visibleWorkspaceItems = useMemo/);
  assert.match(source, /const workspaceStartIndex = actionItems\.length/);
  assert.match(
    source,
    /const chatStartIndex = workspaceStartIndex \+ visibleWorkspaceItems\.length/,
  );
  assert.match(source, /const totalItems = optionKeys\.length/);
  assert.match(source, /id=\{`command-option-\$\{index\}`\}/);
  assert.match(source, /aria-selected=\{activeIndex === index\}/);
  assert.ok(source.includes("`workspace:${item.type}:${item.id}`"));
  assert.ok(source.includes("`chat:${conversation.id}`"));
  assert.match(source, /optionKeys\.indexOf\(activeOptionKey\)/);
});

test("Enter opens workspace results before chats", () => {
  assert.match(
    source,
    /visibleWorkspaceItems\[activeIndex - workspaceStartIndex\][\s\S]*window\.location\.assign\(workspaceMatch\.href\)/,
  );
  assert.match(source, /conversationMatches\[activeIndex - chatStartIndex\]/);
  assert.match(source, /command-option-\$\{chatStartIndex \+ chatIndex\}/);
  assert.match(source, /activeIndex === chatStartIndex \+ chatIndex/);
});

test("the dialog announces workspace search", () => {
  assert.match(source, /aria-label="Search workspace, chats, and actions"/);
  assert.match(source, /aria-label="Search workspace, commands, and chats"/);
});

test("keyboard navigation keeps the active result visible", () => {
  assert.ok(source.includes(".getElementById(`command-option-${activeIndex}`)"));
  assert.match(source, /scrollIntoView\(\{ block: "nearest" \}\)/);
  assert.match(source, /setActiveIndex\(Math\.min\(totalItems - 1, activeIndex \+ 1\)\)/);
});

test("workspace search exposes truthful loading, error, retry, and empty states", () => {
  assert.match(source, /workspaceStatus === "loading"/);
  assert.match(source, /Searching workspace…/);
  assert.match(source, /workspaceStatus === "error"/);
  assert.match(source, /Workspace results are unavailable\./);
  assert.match(source, /event\.key === "Enter"[\s\S]*event\.stopPropagation\(\)/);
  assert.match(source, /onClick=\{retryWorkspaceSearch\}/);
  assert.match(source, /No workspace results/);
  assert.match(indexSource, /setWorkspaceStatus\("loading"\)/);
  assert.match(indexSource, /setWorkspaceStatus\("ready"\)/);
  assert.match(indexSource, /setWorkspaceStatus\("error"\)/);
  assert.match(indexSource, /retryWorkspaceSearch=\{retryWorkspaceSearch\}/);
});
