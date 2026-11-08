import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("Library retires shared snapshots and the email invitation entry point", () => {
  const source = read("src/routes/library.tsx");
  const sharing = read("src/components/ShareChatDialog.tsx");
  assert.doesNotMatch(source, /Shared with me|Shared by me|Open snapshot/);
  assert.doesNotMatch(sharing, /Invite by email|EmailShareChatDialog/);
  assert.match(sharing, /Create & copy link/);
  assert.match(sharing, /Remove link/);
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
  const source = read("src/components/EmailShareChatDialog.tsx");

  assert.match(source, /htmlFor=\{recipientEmailId\}/u);
  assert.match(source, /id=\{recipientEmailId\}/u);
  assert.ok(
    source.includes('aria-describedby={`${recipientHelpId}${error ? ` ${errorId}` : ""}`}'),
  );
  assert.match(source, /id=\{recipientHelpId\}/u);
  assert.match(source, /aria-invalid=\{Boolean\(error\)\}/u);
  assert.match(source, /id=\{errorId\} role="alert"/u);
  assert.match(
    source,
    /recipient needs a KovaGPT account using this\s+address to open the private snapshot from Library/u,
  );
  assert.match(source, /You can manage or revoke this snapshot in Library/u);
});

test("shared-chat reads validate snapshots and revocation cannot report a zero-row success", () => {
  const source = read("src/lib/shared-chats.functions.ts");

  assert.match(source, /SnapshotSchema\.safeParse\(row\.snapshot\)/u);
  assert.match(source, /skipped malformed snapshot/u);
  assert.match(source, /const \{ data: revoked, error \}/u);
  assert.match(source, /\.eq\("owner_user_id", context\.userId\)[\s\S]{0,80}\.select\("id"\)/u);
  assert.match(source, /if \(!revoked\)/u);
});

test("owner share management paginates every non-revoked snapshot", () => {
  const source = read("src/lib/shared-chats.functions.ts");
  const ownerList = source.slice(
    source.indexOf("export const listMySharedChats"),
    source.indexOf("export const listSharedWithMe"),
  );

  assert.match(ownerList, /\.neq\("status", "revoked"\)/u);
  assert.match(ownerList, /\.range\(offset, offset \+ SHARED_CHAT_PAGE_SIZE - 1\)/u);
  assert.match(ownerList, /sharedChats\.push\(\.\.\.page\)/u);
  assert.match(ownerList, /if \(page\.length < SHARED_CHAT_PAGE_SIZE\) break/u);
  assert.doesNotMatch(ownerList, /\.limit\(200\)/u);
});
