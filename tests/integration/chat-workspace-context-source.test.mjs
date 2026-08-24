// Source contract for server-side chat workspace context (per-chat rules and
// pinned files). These assertions protect the security properties that cannot
// be verified from the browser: ownership filtering, membership checks,
// Temporary Chat exclusion, and bounded injection.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const contextSource = readFileSync("src/lib/chat-workspace-context.server.ts", "utf8");
const chatRoute = readFileSync("src/routes/api/chat.ts", "utf8");
const functions = readFileSync("src/lib/chat-workspace.functions.ts", "utf8");

test("per-chat rules are read from owner-scoped rows, never from the request body", () => {
  assert.match(contextSource, /from\("chat_custom_rules"\)/);
  assert.match(contextSource, /\.eq\("owner_id", args\.userId\)/);
  assert.match(contextSource, /\.eq\("chat_id", args\.chatId\)/);
  // The chat route must not accept a client-supplied rules string.
  assert.doesNotMatch(chatRoute, /body\.(customRules|chatRules|rules)\b/);
  assert.doesNotMatch(chatRoute, /chatWorkspaceBlock\s*=\s*[^;]*body/);
});

test("rules and pins are skipped for guests and Temporary Chat", () => {
  assert.match(contextSource, /if \(!args\.userId \|\| !args\.chatId \|\| args\.temporary\) return empty;/);
  assert.match(chatRoute, /if \(auth && typeof chatId === "string" && chatId && !temporary\)/);
});

test("pinned sources are re-authorized, not trusted from the pin row", () => {
  // Library items must match the caller's own user_id.
  assert.match(contextSource, /from\("user_library_items"\)[\s\S]{0,200}\.eq\("user_id", args\.userId\)/);
  // Project files require project membership before any content is read.
  assert.match(contextSource, /is_project_member/);
  assert.match(contextSource, /if \(!isMember\)[\s\S]{0,160}permission_lost/);
  assert.match(contextSource, /project_file_chunks/);
});

test("pinned context is bounded and truncation is disclosed to the model", () => {
  assert.match(contextSource, /budgetPinnedContext/);
  assert.match(contextSource, /MAX_PINNED_CONTEXT_CHARS/);
  assert.match(contextSource, /MAX_PINNED_ITEM_CHARS/);
  assert.match(contextSource, /shortened to stay within the context budget/);
  assert.match(contextSource, /could not be read right now/);
});

test("chat rules precedence is stated explicitly in the injected block", () => {
  assert.match(
    contextSource,
    /take precedence over global settings and project instructions/,
  );
  // Injected after the project block so the narrowest scope is last.
  const projectIdx = chatRoute.indexOf("projectBlock +");
  const workspaceIdx = chatRoute.indexOf("chatWorkspaceBlock +");
  assert.ok(projectIdx > 0 && workspaceIdx > projectIdx);
});

test("context loading never breaks a chat turn", () => {
  assert.match(contextSource, /export async function buildChatWorkspaceBlock[\s\S]*?catch \{[\s\S]*?block: ""/);
});

test("server functions scope every workspace table to owner_id", () => {
  const ownerScoped = functions.match(/\.eq\("owner_id", context\.userId\)/g) ?? [];
  assert.ok(ownerScoped.length >= 8, `expected owner_id scoping on reads/writes, saw ${ownerScoped.length}`);
  // The only user_id filter allowed is the library-ownership re-check, because
  // user_library_items is keyed by user_id rather than owner_id.
  const userIdFilters = functions.match(/\.eq\("user_id", context\.userId\)/g) ?? [];
  assert.equal(userIdFilters.length, (functions.match(/\.eq\("user_id"/g) ?? []).length);
  // Ownership for atomic operations is pinned inside the RPCs, not passed in.
  assert.doesNotMatch(functions, /p_owner_id/);
});
