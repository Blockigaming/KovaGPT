import assert from "node:assert/strict";
import test from "node:test";
import { reactFixture } from "../helpers/kova-react-fixture.mjs";
import { classifyKovaRecoveryResetResponse } from "../../src/lib/kova-recovery-result.mjs";

const password = "fixture-new-password";
const confirmedPrincipal = {
  accountId: "12345678-1234-1234-1234-123456789abc",
  sessionId: "23456789-1234-1234-1234-123456789abc",
  email: "fixture@example.test",
  emailVerified: true,
  assuranceLevel: "aal1",
  displayName: null,
  expiresAt: "2026-10-19T23:00:00Z",
};

test("pure response classification distinguishes retryable interruption, malformed success, terminal rejection and confirmation", () => {
  for (const status of [408, 500, 503, 504, 200, 202]) {
    const result = classifyKovaRecoveryResetResponse(status, null);
    assert.equal(result.confirmed, false);
    assert.equal(result.preserveDraft, true);
    assert.match(result.message, /may have completed/);
    assert.match(result.message, /signing in with your new password/);
  }
  assert.equal(classifyKovaRecoveryResetResponse(429, null).preserveDraft, true);
  for (const status of [400, 401, 403, 409, 415])
    assert.equal(classifyKovaRecoveryResetResponse(status, null).preserveDraft, false);
  assert.equal(
    classifyKovaRecoveryResetResponse(200, {
      session: { accountId: "", emailVerified: true },
    }).confirmed,
    false,
  );
  for (const session of [
    [],
    "invalid",
    { accountId: "x", emailVerified: true },
    { ...confirmedPrincipal, sessionId: "invalid" },
    { ...confirmedPrincipal, email: "invalid" },
    { ...confirmedPrincipal, assuranceLevel: "unknown" },
  ]) {
    const result = classifyKovaRecoveryResetResponse(200, { session });
    assert.equal(result.confirmed, false);
    assert.equal(result.preserveDraft, true);
  }
  assert.equal(
    classifyKovaRecoveryResetResponse(200, { session: confirmedPrincipal }).confirmed,
    true,
  );
});

async function page(transport) {
  const calls = [],
    messages = [],
    navigation = [],
    logs = [];
  const user = { id: confirmedPrincipal.accountId };
  const context = {
    assertCurrent() {},
    auth: {
      async getSession() {
        return { data: { session: { user } }, error: null };
      },
      async updateUser(input) {
        calls.push(input);
        return transport();
      },
      async signOut() {
        return { error: null };
      },
    },
  };
  const f = reactFixture("src/routes/reset-password.tsx", (e) => e.Route.component, {
    modules: {
      "@tanstack/react-router": {
        createFileRoute: () => (route) => route,
        useNavigate: () => (path) => navigation.push(path),
      },
      "@/components/NovaLogo": { NovaLogo: "Logo" },
      "@/integrations/supabase/client": {
        getSupabaseClientConfigStatus: () => ({ configured: true }),
        resolveLegacyAuthContext: async () => context,
      },
      "@/lib/oauth-session": {
        clearPasswordRecoveryFlow() {},
        markPasswordRecoveryFlow() {},
        async completeOAuthSessionFromUrl(_source, signal, options) {
          assert.equal(options.recoveryOnly, true);
          signal.throwIfAborted();
          return { user };
        },
      },
      sonner: {
        toast: {
          error: (message) => messages.push(["error", message]),
          success: (message) => messages.push(["success", message]),
          warning: (message) => messages.push(["warning", message]),
        },
      },
    },
    globals: {
      AbortController,
      window: { setTimeout: () => 1, clearTimeout() {} },
      console: { error: (...args) => logs.push(args) },
    },
  });
  await f.flush();
  await f.input("new-pw", password);
  await f.input("confirm-pw", password);
  return {
    ...f,
    calls,
    messages,
    navigation,
    logs,
    inputs: () => f.nodes().filter((node) => node.type === "input"),
  };
}

test("Supabase 503 preserves the draft and does not retry automatically", async () => {
  let finish;
  const app = await page(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const submitted = app.submit();
  await app.flush();
  assert.ok(app.inputs().every((input) => input.props.disabled === true));
  finish({ error: { status: 503, message: "fixture private diagnostics" } });
  await submitted;
  await app.flush();
  assert.ok(app.inputs().every((input) => input.props.value === password));
  assert.equal(app.calls.length, 1);
  assert.match(app.messages.at(-1)[1], /may have completed/);
  assert.match(app.messages.at(-1)[1], /signing in with your new password/);
  assert.equal(app.navigation.length, 0);
  assert.doesNotMatch(JSON.stringify(app.logs), /fixture-new-password|private diagnostics/);
  assert.match(app.text(), /may have completed/);
});

test("lost Supabase network reply preserves draft without claiming failure or replaying", async () => {
  const app = await page(async () => {
    throw new Error("fixture secret interrupted response");
  });
  await app.submit();
  await app.flush();
  assert.ok(app.inputs().every((input) => input.props.value === password));
  assert.equal(app.calls.length, 1);
  assert.equal(app.navigation.length, 0);
  assert.match(app.messages.at(-1)[1], /may have completed/);
  assert.doesNotMatch(JSON.stringify(app.logs), /fixture secret/);
});

test("explicit retry after Supabase throttling succeeds once and clears drafts", async () => {
  let attempts = 0;
  const app = await page(async () => ({
    error: ++attempts === 1 ? { status: 429 } : null,
  }));
  await app.submit();
  await app.flush();
  assert.equal(app.calls.length, 1);
  assert.ok(app.inputs().every((input) => input.props.value === password));
  assert.match(app.messages.at(-1)[1], /Wait before retrying/);
  await app.submit();
  await app.flush();
  assert.equal(app.calls.length, 2);
  assert.ok(app.inputs().every((input) => input.props.value === ""));
  assert.equal(app.navigation.length, 1);
  assert.equal(app.messages.at(-1)[0], "success");
});

test("terminal Supabase rejection clears drafts without redirect or raw diagnostics", async () => {
  const app = await page(async () => ({ error: { status: 400, message: "fixture secret" } }));
  await app.submit();
  await app.flush();
  assert.ok(app.inputs().every((input) => input.props.value === ""));
  assert.equal(app.calls.length, 1);
  assert.equal(app.navigation.length, 0);
  assert.match(app.messages.at(-1)[1], /Request a new reset link/);
  assert.doesNotMatch(JSON.stringify(app.messages), /fixture secret/);
});

test("unmount during Supabase update prevents later UI messages or navigation", async () => {
  let finish;
  const app = await page(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const submitted = app.submit();
  await app.flush();
  app.unmount();
  finish({ error: null });
  await submitted;
  assert.equal(app.messages.length, 0);
  assert.equal(app.navigation.length, 0);
  assert.equal(app.calls.length, 1);
});
