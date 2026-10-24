import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const page = readFileSync("src/routes/auth.tsx", "utf8");
const recovery = readFileSync("src/components/auth/ForgotPasswordDialog.tsx", "utf8");
test("authentication page uses specified headings and panel width", () => {
  assert.match(page, /max-w-\[400px\]/);
  assert.match(page, /Create your Kova account/);
  assert.match(page, /Log in to Kova/);
  assert.match(page, /isSignUp \? "Create account" : "Log in"/);
});
test("password visibility returns focus and retains autofill purposes", () => {
  assert.match(page, /aria-pressed=\{showPassword\}/);
  assert.match(
    page,
    /setShowPassword\(\(value\) => !value\);\s*passwordInputRef.current\?\.focus\(\)/,
  );
  assert.match(page, /autoComplete=\{isSignUp \? "new-password" : "current-password"\}/);
});
test("recovery receives entered email and makes no delivery-time promise", () => {
  assert.match(page, /initialEmail=\{email\}/);
  assert.match(recovery, /setEmail\(initialEmail\)/);
  assert.match(
    recovery,
    /If an account exists for this email, you’ll receive recovery instructions/,
  );
  assert.doesNotMatch(
    recovery,
    /you'll get the link in a minute|Reset link sent|We sent a secure reset link/,
  );
});

test("shared auth sizing overrides the legacy main card selector", () => {
  const css = readFileSync("src/styles/spec400-system.css", "utf8");
  assert.match(
    css,
    /body \.kova-auth-page > main\s*\{[^}]*max-width: 400px;[^}]*border-radius: var\(--kova-radius-panel\);/s,
  );
  const tokens = readFileSync("src/styles/visual-tokens.css", "utf8");
  assert.match(tokens, /--kova-radius-panel: 24px;/);
});
