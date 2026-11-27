import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_SIDEBAR_LAYOUT, readSidebarLayout, saveSidebarLayout, sidebarLayoutKey } from "../../src/lib/sidebar-layout.mjs";
import { googleConnectorScopes, hasGoogleCapability } from "../../src/lib/google-account-policy.mjs";

test("Inbox defaults on, including existing customized sidebars, while explicit removal persists", () => {
  const data = new Map();
  const storage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const key = sidebarLayoutKey("owner");
  assert.ok(DEFAULT_SIDEBAR_LAYOUT.shortcuts.includes("inbox"));
  data.set(key, JSON.stringify({ shortcuts: ["library"] }));
  const migrated = readSidebarLayout(storage, "owner");
  assert.deepEqual(migrated.shortcuts, ["library", "inbox"]);
  assert.equal(saveSidebarLayout(storage, "owner", { ...migrated, shortcuts: ["library"] }), true);
  assert.deepEqual(readSidebarLayout(storage, "owner").shortcuts, ["library"]);
  assert.ok(readSidebarLayout(storage, "other").shortcuts.includes("inbox"));
});

test("mailbox mutations require modify permission, not a read-only Google grant", () => {
  const read = googleConnectorScopes("gmail", "read");
  const write = googleConnectorScopes("gmail", "read-write");
  assert.equal(hasGoogleCapability(read, "gmail.modify"), false);
  assert.equal(hasGoogleCapability(write, "gmail.modify"), true);
});

test("Inbox is gated by active mail connections and uses connector actions outside chat", () => {
  const sidebar = readFileSync("src/components/Sidebar.tsx", "utf8");
  const server = readFileSync("src/lib/inbox.functions.ts", "utf8");
  const route = readFileSync("src/routes/inbox.tsx", "utf8");
  assert.match(sidebar, /shortcut\.id !== "inbox" \|\| inboxAccounts\.accounts\.length > 0/);
  assert.match(server, /checkOwner\(data.owner, context.userId\)/);
  assert.match(server, /connectorWriteAllowed\(owner, provider, account\)/);
  assert.match(server, /confirmed: z.literal\(true\)/);
  assert.match(route, /if \(!mounted.current \|\| !result.sent\) return/);
  assert.doesNotMatch(route, /chat\/send|onSendMessage|useChatController/);
});
