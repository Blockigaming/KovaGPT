import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync("src/lib/auth-providers.ts", "utf8");
const dialog = readFileSync("src/components/auth/AuthDialog.tsx", "utf8");
const authRoute = readFileSync("src/routes/auth.tsx", "utf8");

test("provider availability starts unresolved so no provider is falsely advertised", () => {
  assert.match(source, /UNRESOLVED_AUTH_PROVIDERS[\s\S]*?resolved: false/);
  assert.match(source, /google: false/);
});

test("the probe uses only the publishable key and never a service role secret", () => {
  assert.match(source, /VITE_SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(source, /SERVICE_ROLE/);
  assert.doesNotMatch(source, /process\.env/);
});

test("the sign-in dialog only enables Google once the deployment confirms it", () => {
  assert.match(dialog, /googleAvailable = providers\.resolved && providers\.google/);
  assert.match(dialog, /googleUnavailable = providers\.resolved && !providers\.google/);
  assert.match(dialog, /disabled=\{loading \|\| !googleAvailable\}/);
});

test("the dialog has no unreachable password step and defers passwords to /auth", () => {
  // A dead `step === "password"` branch previously rendered a password form the
  // user could never reach; the password surface is the /auth route.
  assert.doesNotMatch(dialog, /"password"/);
  assert.match(dialog, /to: "\/auth"/);
});

test("magic-link surfaces describe a request, not a guaranteed delivery", () => {
  for (const [name, text] of [
    ["AuthDialog", dialog],
    ["auth route", authRoute],
  ]) {
    assert.match(text, /asked our email provider/, `${name} must not claim the email was sent`);
    assert.doesNotMatch(text, /We sent a sign-in link/, `${name} overstates delivery`);
    assert.match(text, /RESEND_COOLDOWN_SECONDS/, `${name} must rate limit resends`);
  }
});
