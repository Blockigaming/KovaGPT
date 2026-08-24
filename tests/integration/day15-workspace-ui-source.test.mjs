import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relative) => readFileSync(join(root, relative), "utf8");

test("assistant messages expose selection editing and version history", () => {
  const source = read("src/components/ChatMessage.tsx");
  assert.match(source, /SelectionEditDialog/u);
  assert.match(source, /MessageVersionHistoryDialog/u);
  assert.match(source, /Edit selection/u);
  assert.match(source, /Version history/u);
  // The message renderer must be told which chat it belongs to, otherwise edits
  // cannot be persisted durably.
  assert.match(source, /chatId\?: string \| null/u);
  assert.match(source, /onReplaceContent\?:/u);
});

test("selection edits go through /api/write and never claim an unsaved save", () => {
  const source = read("src/components/SelectionEditDialog.tsx");
  assert.match(source, /"\/api\/write"/u);
  assert.match(source, /applySelectionEdit/u);
  assert.match(source, /describeRewriteFailure/u);
  // Guest edits are explicitly labelled as device-only.
  assert.match(source, /this device/iu);
  assert.doesNotMatch(source, /TODO|FIXME/u);
});

test("branch UI is backed by durable branches with a local guest fallback", () => {
  const hook = read("src/hooks/useChatBranches.ts");
  assert.match(hook, /listChatBranches/u);
  assert.match(hook, /createChatBranch/u);
  assert.match(hook, /activateChatBranch/u);
  assert.match(hook, /localBranches/u);
  assert.match(hook, /saveLocalBranch/u);
  assert.match(hook, /activateLocalBranch/u);

  const bar = read("src/components/ChatBranchBar.tsx");
  assert.match(bar, /MobileBottomSheet|lg:hidden/u);
  // A load failure must be surfaced with a retry, not silently hidden.
  assert.match(bar, /onRetry/u);
});

test("per-chat rules and pinned files have a real management surface", () => {
  const dialog = read("src/components/ChatWorkspaceDialog.tsx");
  assert.match(dialog, /getChatRules/u);
  assert.match(dialog, /saveChatRules/u);
  assert.match(dialog, /listChatPins/u);
  assert.match(dialog, /pinChatFile/u);
  assert.match(dialog, /unpinChatFile/u);
  assert.match(dialog, /listMyLibrary/u);
  assert.doesNotMatch(dialog, /TODO|FIXME/u);
});

test("the chat route wires branches, rules disclosure, and edit application", () => {
  const source = read("src/routes/index.tsx");
  assert.match(source, /useChatBranches/u);
  assert.match(source, /<ChatBranchBar/u);
  assert.match(source, /ChatWorkspaceDialog/u);
  assert.match(source, /replaceMessageContent/u);
  assert.match(source, /Chat rules are active/u);
  // Mobile users reach the same surface from the top bar.
  assert.match(source, /onOpenChatSettings/u);
});

test("mobile top bar exposes chat settings with an accessible target", () => {
  const source = read("src/components/MobileTopBar.tsx");
  assert.match(source, /onOpenChatSettings/u);
  assert.match(source, /h-11 w-11/u);
  assert.match(source, /aria-label=/u);
});

test("sharing discloses that only the active branch is snapshotted", () => {
  const source = read("src/components/ShareChatDialog.tsx");
  assert.match(source, /branch you are currently viewing/u);
});
