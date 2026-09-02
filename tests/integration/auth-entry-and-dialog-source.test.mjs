import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [authRoute, authDialog, clerkSafe] = await Promise.all([
  readFile("src/routes/auth.tsx", "utf8"),
  readFile("src/components/auth/AuthDialog.tsx", "utf8"),
  readFile("src/components/auth/ClerkSafe.tsx", "utf8"),
]);

test("invalid password-step deep links return to the existing identity dialog", () => {
  assert.match(authRoute, /beforeLoad: \(\{ search \}\) =>/u);
  assert.match(authRoute, /search\.email && isValidEmail\(search\.email\)/u);
  assert.doesNotMatch(authRoute, /search\.email\.trim\(\)\.slice/u);
  assert.match(authRoute, /normalized\.length <= 320/u);
  assert.match(authRoute, /"sign-up" : "sign-in"\}=1/u);
  assert.match(authRoute, /reloadDocument: true/u);
  assert.match(clerkSafe, /params\.get\("sign-in"\) === "1"/u);
  assert.match(clerkSafe, /params\.get\("sign-up"\) === "1"/u);
  assert.match(
    clerkSafe,
    /setDialog\(\{ open: true, mode: wantsSignUp \? "sign-up" : "sign-in" \}\)/u,
  );
});

test("the valid password step is named, gated, and keeps auth calls unchanged", () => {
  assert.match(authRoute, /id="main-content"/u);
  assert.match(authRoute, /tabIndex=\{-1\}/u);
  assert.match(authRoute, /htmlFor="kova-auth-page-email"/u);
  assert.match(authRoute, /htmlFor="kova-auth-page-password"/u);
  assert.match(authRoute, /aria-describedby="kova-auth-page-password-requirement"/u);
  assert.match(authRoute, /disabled=\{loading \|\| !emailValid \|\| password\.length < 6\}/u);
  assert.match(authRoute, /h-11 w-11/u);
  assert.match(authRoute, /\{ title: "KovaGPT Account" \}/u);
  assert.doesNotMatch(authRoute, /\{ title: "KovaGPT Sign In" \}/u);
  assert.match(authRoute, /supabase\.auth\.signInWithPassword/u);
  assert.match(authRoute, /supabase\.auth\.signUp/u);
  assert.match(authRoute, /supabase\.auth\.signInWithOtp/u);
});

test("the auth modal has one visible semantic heading and the shared contained close", () => {
  assert.match(authDialog, /DialogDescription/u);
  assert.match(authDialog, /<DialogTitle className="text-\[26px\]/u);
  assert.doesNotMatch(authDialog, /<DialogTitle className="sr-only"/u);
  assert.doesNotMatch(authDialog, /<h1/u);
  assert.doesNotMatch(authDialog, /\[&>button\.absolute\]:hidden/u);
  assert.doesNotMatch(authDialog, /absolute -top-3 -right-3/u);
  assert.match(authDialog, /\[&>button\.absolute\]:!h-11/u);
  assert.match(authDialog, /aria-modal="true"/u);
  assert.match(authDialog, /Checking Google availability…/u);
  assert.match(authDialog, /role="status"/u);
  assert.doesNotMatch(authDialog, /emailTouched && !emailValid && email\.length/u);
});
