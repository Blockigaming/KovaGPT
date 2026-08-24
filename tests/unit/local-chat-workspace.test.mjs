import assert from "node:assert/strict";
import test from "node:test";

import {
  activateLocalBranch,
  clearLocalRules,
  localBranches,
  localRules,
  localVersions,
  parseWorkspaceState,
  saveLocalBranch,
  saveLocalRules,
  saveLocalVersion,
  LOCAL_MAX_RULES_CHARS,
  LOCAL_MAX_VERSIONS_PER_MESSAGE,
} from "../../src/lib/local-chat-workspace.mjs";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

test("corrupt storage degrades to an empty workspace instead of throwing", () => {
  assert.deepEqual(parseWorkspaceState("not json"), { chats: {} });
  assert.deepEqual(parseWorkspaceState(null), { chats: {} });
});

test("guest edit versions persist per message and stay bounded", () => {
  const storage = memoryStorage();
  for (let i = 1; i <= LOCAL_MAX_VERSIONS_PER_MESSAGE + 5; i += 1) {
    saveLocalVersion(storage, "chat-1", "msg-1", { content: `edit ${i}` });
  }
  const versions = localVersions(storage, "chat-1", "msg-1");
  assert.equal(versions.length, LOCAL_MAX_VERSIONS_PER_MESSAGE);
  assert.equal(
    versions.every((entry) => entry.durable === false),
    true,
  );
  assert.equal(versions[versions.length - 1].content, `edit ${LOCAL_MAX_VERSIONS_PER_MESSAGE + 5}`);
  // Versions are scoped per message and per chat.
  assert.deepEqual(localVersions(storage, "chat-1", "msg-2"), []);
  assert.deepEqual(localVersions(storage, "chat-2", "msg-1"), []);
});

test("an empty guest edit is refused", () => {
  const storage = memoryStorage();
  assert.throws(() => saveLocalVersion(storage, "chat-1", "msg-1", { content: "  " }), /empty/);
});

test("guest rules round-trip, clear, and respect the length bound", () => {
  const storage = memoryStorage();
  assert.equal(localRules(storage, "chat-1"), null);
  const saved = saveLocalRules(storage, "chat-1", { instructions: "Be terse", enabled: true });
  assert.equal(saved.instructions, "Be terse");
  assert.equal(localRules(storage, "chat-1").enabled, true);
  assert.throws(
    () =>
      saveLocalRules(storage, "chat-1", { instructions: "x".repeat(LOCAL_MAX_RULES_CHARS + 1) }),
    /characters or fewer/,
  );
  clearLocalRules(storage, "chat-1");
  assert.equal(localRules(storage, "chat-1"), null);
});

test("only one guest branch is active at a time", () => {
  const storage = memoryStorage();
  saveLocalBranch(storage, "chat-1", { id: "b1", branchFromMessageId: "m1" });
  saveLocalBranch(storage, "chat-1", { id: "b2", branchFromMessageId: "m2" });
  let branches = localBranches(storage, "chat-1");
  assert.equal(branches.filter((branch) => branch.active).length, 1);
  assert.equal(branches.find((branch) => branch.active).id, "b2");

  assert.equal(activateLocalBranch(storage, "chat-1", "b1").active, true);
  branches = localBranches(storage, "chat-1");
  assert.equal(branches.filter((branch) => branch.active).length, 1);
  assert.equal(branches.find((branch) => branch.active).id, "b1");
  // Activating an unknown id reports nothing rather than a fake success.
  assert.equal(activateLocalBranch(storage, "chat-1", "missing"), null);
});

test("missing storage never throws and reports empty state", () => {
  assert.deepEqual(localVersions(null, "chat-1", "msg-1"), []);
  assert.equal(localRules(null, "chat-1"), null);
  assert.deepEqual(localBranches(null, "chat-1"), []);
});
