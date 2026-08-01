import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import { validatePublicBuildEnv } from "../../scripts/validate-public-build-env.mjs";

const URL = "https://project.supabase.co";
const PUBLISHABLE_KEY = `sb_publishable_${"a".repeat(32)}`;

function jwt(role) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role })}.signature`;
}

test("accepts an HTTPS Supabase URL and publishable key", () => {
  assert.deepEqual(
    validatePublicBuildEnv({
      VITE_SUPABASE_URL: URL,
      VITE_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
    }),
    { supabaseUrl: URL, keyType: "publishable" },
  );
});

test("accepts a legacy anon JWT", () => {
  assert.equal(
    validatePublicBuildEnv({
      VITE_SUPABASE_URL: `${URL}/`,
      VITE_SUPABASE_PUBLISHABLE_KEY: jwt("anon"),
    }).keyType,
    "legacy-anon",
  );
});

test("requires both browser build settings", () => {
  assert.throws(() => validatePublicBuildEnv({}), /VITE_SUPABASE_URL is required/);
  assert.throws(
    () => validatePublicBuildEnv({ VITE_SUPABASE_URL: URL }),
    /VITE_SUPABASE_PUBLISHABLE_KEY is required/,
  );
});

test("rejects unsafe Supabase URLs", () => {
  for (const unsafeUrl of [
    "http://project.supabase.co",
    "https://user:password@project.supabase.co",
    "https://project.supabase.co?token=value",
    "https://project.supabase.co#fragment",
    "https://project.supabase.co/rest/v1",
    "https://project.supabase.co/path with space",
  ]) {
    assert.throws(
      () =>
        validatePublicBuildEnv({
          VITE_SUPABASE_URL: unsafeUrl,
          VITE_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
        }),
      /VITE_SUPABASE_URL/,
    );
  }
});

test("rejects secret, service-role, and unknown key forms", () => {
  for (const unsafeKey of ["sb_secret_do-not-publish", jwt("service_role"), "plain-text-key"]) {
    assert.throws(
      () =>
        validatePublicBuildEnv({
          VITE_SUPABASE_URL: URL,
          VITE_SUPABASE_PUBLISHABLE_KEY: unsafeKey,
        }),
      /VITE_SUPABASE_PUBLISHABLE_KEY/,
    );
  }
});

test("validation errors never include rejected credential values", () => {
  const secret = "sb_secret_extremely-sensitive-value";
  assert.throws(
    () =>
      validatePublicBuildEnv({
        VITE_SUPABASE_URL: URL,
        VITE_SUPABASE_PUBLISHABLE_KEY: secret,
      }),
    (error) => error instanceof Error && !error.message.includes(secret),
  );
});
