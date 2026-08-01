import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const title = await readFile("src/routes/api/title.ts", "utf8");
const mfa = await readFile("src/components/MfaPanel.tsx", "utf8");
const sidebar = await readFile("src/components/Sidebar.tsx", "utf8");
const home = await readFile("src/routes/index.tsx", "utf8");
const shares = await readFile("src/lib/shared-chats.functions.ts", "utf8");
const settings = await readFile("src/components/SettingsDialog.tsx", "utf8");
const apiAuth = await readFile("src/lib/api-auth.server.ts", "utf8");
const authSecurity = await readFile("src/lib/auth-security.mjs", "utf8");

test("anonymous protected requests fail as unauthorized before auth configuration is consulted", () => {
  const headerCheck = apiAuth.indexOf('request.headers.get("authorization")');
  const envCheck = apiAuth.indexOf("process.env.SUPABASE_URL");
  assert.ok(headerCheck > -1 && envCheck > -1 && headerCheck < envCheck);
  assert.match(apiAuth, /parseBearerToken\(authHeader\)/);
  assert.match(authSecurity, /export function parseBearerToken/);
  assert.match(authSecurity, /const match = \/\^Bearer/);
});

test("title generation rejects malformed and unbounded message payloads", () => {
  assert.match(title, /function parseMessages/);
  assert.match(title, /messages\.length > 100/);
  assert.match(title, /content\.length <= 50_000/);
  assert.match(title, /Invalid messages/);
  assert.match(title, /status: 400/);
});

test("MFA never presents locally generated codes as server-verifiable recovery codes", () => {
  assert.doesNotMatch(mfa, /Math\.random/);
  assert.doesNotMatch(mfa, /Each can be used once to sign in/);
  assert.match(mfa, /Security settings could not be loaded/);
  assert.match(mfa, /role="alert"/);
});

test("chat menus expose only the real server-backed sharing flow", () => {
  assert.doesNotMatch(sidebar, /Add members/);
  assert.doesNotMatch(home, /AddMembersDialog|membersChatId/);
  assert.match(home, /ShareChatDialog/);
});

test("shared-chat failures remain distinguishable from truthful empty states", () => {
  assert.match(shares, /Shared chats could not be loaded/);
  assert.match(shares, /Chats shared with you could not be loaded/);
  assert.doesNotMatch(shares, /\[listMySharedChats\][\s\S]{0,100}return \[\]/);
  assert.match(settings, /Library data is unavailable/);
  assert.match(settings, /setLoadError/);
});
