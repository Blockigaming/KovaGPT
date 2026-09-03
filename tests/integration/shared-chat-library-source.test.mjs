import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("Library exposes received snapshots and owner revocation without inventing live sync", () => {
  const source = read("src/routes/library.tsx");

  assert.match(source, /listSharedWithMe/u);
  assert.match(source, /listMySharedChats/u);
  assert.match(source, /Shared with me/u);
  assert.match(source, /Shared by me/u);
  assert.match(source, /Open snapshot/u);
  assert.match(source, /visibleSharedPreview\.snapshot\.messages\.map/u);
  assert.match(source, /Read-only snapshot/u);
  assert.match(source, /sharedPreviewReturnFocusRef/u);
  assert.match(source, /if \(trigger\?\.isConnected\) trigger\.focus\(\)/u);
  assert.match(source, /revokeSharedChat/u);
  assert.match(source, /Revoke this shared snapshot\?/u);
  assert.doesNotMatch(source, /live collaboration|live sync/iu);
});

test("shared-chat Library requests and mutations are guarded across account changes", () => {
  const source = read("src/routes/library.tsx");

  assert.match(source, /shareLoadGenerationRef/u);
  assert.match(source, /principalRef\.current === requestPrincipal/u);
  assert.match(source, /previous\.principal === requestPrincipal/u);
  assert.match(
    source,
    /setShareState\(\{[\s\S]*?principal: null,[\s\S]*?received: \[\],[\s\S]*?sent: \[\]/u,
  );
});

test("Share chat labels its email field and points recipients to Library", () => {
  const source = read("src/components/ShareChatDialog.tsx");

  assert.match(source, /htmlFor=\{recipientEmailId\}/u);
  assert.match(source, /id=\{recipientEmailId\}/u);
  assert.match(source, /aria-describedby=\{recipientHelpId\}/u);
  assert.match(source, /open the snapshot\s+from Library/u);
});

test("shared-chat reads validate snapshots and revocation cannot report a zero-row success", () => {
  const source = read("src/lib/shared-chats.functions.ts");

  assert.match(source, /SnapshotSchema\.safeParse\(row\.snapshot\)/u);
  assert.match(source, /skipped malformed snapshot/u);
  assert.match(source, /const \{ data: revoked, error \}/u);
  assert.match(source, /\.eq\("owner_user_id", context\.userId\)[\s\S]{0,80}\.select\("id"\)/u);
  assert.match(source, /if \(!revoked\)/u);
});
