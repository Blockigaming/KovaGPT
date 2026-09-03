import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("command palette places workspace rows in the keyboard option model", () => {
  const palette = read("src/components/CommandPalette.tsx");

  assert.match(palette, /type PaletteOption =/);
  assert.match(palette, /kind: "workspace"/);
  assert.match(palette, /const paletteOptions = useMemo<PaletteOption\[\]>/);
  assert.match(palette, /\.\.\.visibleWorkspaceItems\.map/);
  assert.match(palette, /const totalItems = paletteOptions\.length/);
  assert.match(palette, /const activeOption = paletteOptions\[activeIndex\]/);
  assert.match(palette, /aria-activedescendant=\{activeOption\?\.id\}/);
  assert.match(palette, /document\.getElementById\(activeOption\.id\)\?\.scrollIntoView/);
  assert.match(
    palette,
    /if \(option\.kind === "workspace"\)[\s\S]{0,220}window\.location\.assign\(option\.item\.href\)/,
  );
  assert.match(
    palette,
    /const index = actionItems\.length \+ visibleWorkspaceItems\.length \+ chatIndex/,
  );
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
