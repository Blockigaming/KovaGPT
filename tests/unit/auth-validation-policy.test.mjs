import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyAuthValidationResult,
  classifySessionRestoreError,
  classifyThrownAuthValidationError,
  isCurrentAuthValidation,
  retryableAuthPrincipalState,
} from "../../src/lib/auth-validation-policy.mjs";

const assertRetryable = (disposition) => {
  assert.deepEqual(disposition, {
    kind: "retryable",
    clearBrowserStorage: false,
    signOut: false,
    principalResolution: "unresolved",
  });
};

test("returned retryable user-validation errors never clean storage or resolve guest", () => {
  for (const userError of [
    { name: "AuthRetryableFetchError", status: 0 },
    { status: 429, code: "over_request_rate_limit" },
    { status: 503, code: "provider_unavailable" },
    { message: "unknown transport failure" },
  ]) {
    assertRetryable(classifyAuthValidationResult({ userError, userPresent: false }));
  }
});

test("assurance lookup failures alone are always retryable", () => {
  for (const assuranceError of [
    { status: 401, code: "assurance_lookup_failed" },
    { status: 429 },
    { status: 502 },
    { message: "network unavailable" },
  ]) {
    assertRetryable(classifyAuthValidationResult({ assuranceError, userPresent: true }));
  }
});

test("thrown network and runtime errors never clean storage or resolve guest", () => {
  assertRetryable(classifyThrownAuthValidationError(new TypeError("Failed to fetch")));
  assertRetryable(classifyThrownAuthValidationError(new Error("unexpected provider failure")));
});

test("session restore classifies explicit terminal policy errors without retry loops", () => {
  for (const error of [
    { status: 401 },
    { status: 403 },
    { code: "refresh_token_not_found" },
    { code: "session_not_found" },
  ]) {
    assert.equal(classifySessionRestoreError(error).kind, "terminal");
  }
  for (const error of [{ status: 429 }, { status: 503 }, new TypeError("Failed to fetch")]) {
    assertRetryable(classifySessionRestoreError(error));
  }
});

test("a queued auth event invalidates stale hydrate success before deferred validation", async () => {
  let resolveHydration;
  const restoredSession = new Promise((resolve) => {
    resolveHydration = resolve;
  });
  let currentValidation = 0;
  const hydrationValidation = currentValidation;
  const accepted = [];
  const hydrate = (async () => {
    const session = await restoredSession;
    if (!isCurrentAuthValidation(hydrationValidation, currentValidation)) return;
    accepted.push(session);
  })();

  // onAuthStateChange invalidates hydration synchronously, even though its
  // authoritative validation must wait for the provider lock to be released.
  const eventValidation = ++currentValidation;
  resolveHydration("stale-hydrated-session");
  await hydrate;
  assert.deepEqual(accepted, []);

  if (isCurrentAuthValidation(eventValidation, currentValidation)) {
    accepted.push("new-auth-event-session");
    currentValidation += 1;
  }
  assert.deepEqual(accepted, ["new-auth-event-session"]);
  assert.equal(isCurrentAuthValidation(currentValidation, currentValidation, true), false);
});

test("only affirmative terminal user evidence permits destructive sign-out cleanup", () => {
  for (const userError of [
    { status: 401 },
    { status: 403 },
    { code: "bad_jwt" },
    { code: "session_not_found" },
    { code: "user_banned" },
  ]) {
    assert.deepEqual(classifyAuthValidationResult({ userError, userPresent: false }), {
      kind: "terminal",
      clearBrowserStorage: true,
      signOut: true,
      principalResolution: "guest",
    });
  }
});

test("a successful missing, deleted, or banned user result is terminal", () => {
  for (const options of [
    { userPresent: false },
    { userPresent: true, userIdMatches: false },
    { userPresent: true, userDeleted: true },
    { userPresent: true, userBanned: true },
  ]) {
    assert.equal(classifyAuthValidationResult(options).kind, "terminal");
  }
});

test("an error-free valid result stays authenticated", () => {
  assert.deepEqual(classifyAuthValidationResult({ userPresent: true }), {
    kind: "valid",
    clearBrowserStorage: false,
    signOut: false,
    principalResolution: "authenticated",
  });
});

test("retryable principal state retains only an already validated same user", () => {
  assert.deepEqual(retryableAuthPrincipalState("account-a", "account-a"), {
    principalResolution: "authenticated",
    userId: "account-a",
  });
  assert.deepEqual(retryableAuthPrincipalState("account-b", "account-a"), {
    principalResolution: "unresolved",
    userId: null,
  });
  assert.deepEqual(retryableAuthPrincipalState("account-a", null), {
    principalResolution: "unresolved",
    userId: null,
  });
});
