import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  KOVA_SESSION_COOKIE,
  clearKovaSessionCookie,
  readKovaSessionToken,
  resolveKovaAuthMode,
  selectAuthCredential,
  serializeKovaSessionCookie,
} from "../../src/lib/kova-auth-contract.mjs";

const token = "A".repeat(43);
const browserClientSource = readFileSync(
  new URL("../../src/integrations/supabase/client.ts", import.meta.url),
  "utf8",
);
const providerSource = readFileSync(
  new URL("../../src/components/auth/ClerkSafe.tsx", import.meta.url),
  "utf8",
);

test("auth mode defaults safely and rejects configuration drift", () => {
  assert.equal(resolveKovaAuthMode({}), "supabase");
  assert.equal(resolveKovaAuthMode({ KOVA_AUTH_MODE: "dual" }), "dual");
  assert.equal(resolveKovaAuthMode({ KOVA_AUTH_MODE: "kova" }), "kova");
  assert.throws(() => resolveKovaAuthMode({ KOVA_AUTH_MODE: "enabled" }), /must be one of/u);
});

test("Kova sessions use a host-only secure cookie", () => {
  const serialized = serializeKovaSessionCookie(token, { maxAge: 3600 });
  assert.match(serialized, new RegExp(`^${KOVA_SESSION_COOKIE}=`));
  assert.match(serialized, /Path=\//u);
  assert.match(serialized, /Max-Age=3600/u);
  assert.match(serialized, /HttpOnly/u);
  assert.match(serialized, /Secure/u);
  assert.match(serialized, /SameSite=Lax/u);
  assert.doesNotMatch(serialized, /Domain=/u);
  assert.match(clearKovaSessionCookie(), /Max-Age=0/u);
  assert.throws(() => serializeKovaSessionCookie("predictable"), /opaque base64url/u);
  assert.throws(() => serializeKovaSessionCookie(token, { maxAge: 60 * 60 * 24 * 91 }), /90 days/u);
});

test("cookie parsing accepts an opaque Kova session and rejects malformed values", () => {
  const valid = new Request("https://kovagpt.com", {
    headers: { cookie: `theme=dark; ${KOVA_SESSION_COOKIE}=${token}` },
  });
  assert.deepEqual(readKovaSessionToken(valid), { ok: true, token });

  const malformed = new Request("https://kovagpt.com", {
    headers: { cookie: `${KOVA_SESSION_COOKIE}=not.valid` },
  });
  assert.deepEqual(readKovaSessionToken(malformed), {
    ok: false,
    code: "invalid_kova_session_cookie",
  });
});

test("dual mode prefers Kova and never falls back from a malformed Kova cookie", () => {
  const both = new Request("https://kovagpt.com", {
    headers: {
      authorization: "Bearer legacy-token",
      cookie: `${KOVA_SESSION_COOKIE}=${token}`,
    },
  });
  assert.deepEqual(selectAuthCredential(both, "dual"), {
    kind: "credential",
    provider: "kova",
    token,
  });

  const malformed = new Request("https://kovagpt.com", {
    headers: {
      authorization: "Bearer legacy-token",
      cookie: `${KOVA_SESSION_COOKIE}=bad`,
    },
  });
  assert.deepEqual(selectAuthCredential(malformed, "dual"), {
    kind: "invalid",
    provider: "kova",
    code: "invalid_kova_session_cookie",
  });
});

test("provider modes do not accept disabled credential types", () => {
  const bearer = new Request("https://kovagpt.com", {
    headers: { authorization: "Bearer legacy-token" },
  });
  const cookie = new Request("https://kovagpt.com", {
    headers: { cookie: `${KOVA_SESSION_COOKIE}=${token}` },
  });
  assert.deepEqual(selectAuthCredential(bearer, "kova"), { kind: "anonymous" });
  assert.deepEqual(selectAuthCredential(cookie, "supabase"), { kind: "anonymous" });
  assert.equal(selectAuthCredential(bearer, "supabase").provider, "supabase");
  assert.equal(selectAuthCredential(cookie, "kova").provider, "kova");
});

test("dual-mode logout cannot reveal a dormant legacy session or cached Kova token", () => {
  assert.match(browserClientSource, /export async function signOutLegacySupabaseSession/u);
  assert.match(
    providerSource,
    /if \(allowLegacyFallback\)[\s\S]+await signOutLegacySupabaseSession\(\)[\s\S]+fetch\("\/api\/auth\/logout"/u,
  );
  assert.match(
    providerSource,
    /setKovaSessionActive\(false\);\s+if \(!allowLegacyFallback\) setKovaSessionActive\(true\)/u,
  );
  assert.match(
    browserClientSource,
    /setKovaSessionActive\(false\);\s+if \(browserKovaAuthMode\(\) === "kova"\) setKovaSessionActive\(true\)/u,
  );
  assert.match(
    providerSource,
    /purgeOwnerlessStateFor\(principal\?\.accountId \?\? null\);\s+setKovaSessionActive/u,
  );
});
