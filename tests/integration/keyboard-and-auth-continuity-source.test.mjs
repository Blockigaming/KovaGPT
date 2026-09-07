import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("command palette places workspace rows in the keyboard option model", () => {
  const palette = read("src/components/CommandPalette.tsx");

  assert.match(palette, /const workspaceStartIndex = actionItems\.length/);
  assert.match(
    palette,
    /const chatStartIndex = workspaceStartIndex \+ visibleWorkspaceItems\.length/,
  );
  assert.match(palette, /const optionKeys = useMemo/);
  assert.match(
    palette,
    /\.\.\.visibleWorkspaceItems\.map\(\(item\) => `workspace:\$\{item\.type\}:\$\{item\.id\}`\)/,
  );
  assert.match(palette, /const totalItems = optionKeys\.length/);
  assert.match(palette, /const resolvedActiveIndex = optionKeys\.indexOf\(activeOptionKey\)/);
  assert.match(palette, /aria-activedescendant=\{`command-option-\$\{activeIndex\}`\}/);
  assert.match(
    palette,
    /document[\s\S]{0,100}\.getElementById\(`command-option-\$\{activeIndex\}`\)[\s\S]{0,80}\.scrollIntoView/,
  );
  assert.match(
    palette,
    /const workspaceMatch = visibleWorkspaceItems\[activeIndex - workspaceStartIndex\][\s\S]{0,260}window\.location\.assign\(workspaceMatch\.href\)/,
  );
  assert.match(palette, /const index = workspaceStartIndex \+ workspaceIndex/);
  assert.doesNotMatch(palette, /role="option"\s+aria-selected=\{false\}/);
});

test("email, password, magic-link, and OAuth entry preserve a validated return route", () => {
  const dialog = read("src/components/auth/AuthDialog.tsx");
  const auth = read("src/routes/auth.tsx");
  const callback = read("src/routes/~oauth.callback.tsx");
  const session = read("src/lib/oauth-session.ts");

  assert.match(dialog, /rememberPostAuthRedirect\(\)[\s\S]{0,100}to: "\/auth"/);
  assert.match(dialog, /emailRedirectTo: getEmailAuthRedirectUri\(\)/);
  assert.match(auth, /emailRedirectTo: getEmailAuthRedirectUri\(\)/);
  assert.equal((auth.match(/getSafePostAuthRedirect\(\)/g) ?? []).length, 2);

  assert.match(session, /POST_AUTH_REDIRECT_PARAM = "return_to"/);
  assert.match(session, /safeRelativeRedirect\([\s\S]{0,180}OAUTH_CALLBACK_PATH/);
  assert.match(session, /callback\.searchParams\.set\(POST_AUTH_REDIRECT_PARAM, next\)/);
  assert.match(session, /sessionStorage\.removeItem\(POST_AUTH_REDIRECT_KEY\)/);
  assert.match(session, /url\.searchParams\.delete\(POST_AUTH_REDIRECT_PARAM\)/);

  const readCallback = callback.indexOf("getCallbackPostAuthRedirect()");
  const clearCallback = callback.indexOf("clearOAuthResponseFromUrl()");
  const navigate = callback.indexOf("window.location.replace(next)");
  assert.ok(readCallback >= 0 && clearCallback > readCallback && navigate > clearCallback);
  assert.match(callback, /getSafePostAuthRedirect\(callbackRedirect\)/);
});
