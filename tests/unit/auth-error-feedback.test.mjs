import * as authRetry from "../../src/lib/auth-retry-delay.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { reactFixture } from "../helpers/kova-react-fixture.mjs";

const email = "synthetic@example.invalid";
const password = "synthetic-long-password";
const response = (payload = {}, ok = true) => ({
  ok,
  headers: new Headers(),
  json: async () => payload,
});
const plain = (value) => JSON.parse(JSON.stringify(value));

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fixture(options = {}) {
  const requests = [],
    messages = [],
    redirects = [],
    navigations = [],
    dismissals = [],
    queuedDismissals = [],
    toasts = new Map(),
    timers = new Map();
  let nextToastId = 1,
    nextTimerId = 1,
    search = { email, mode: "sign-in", ...options.search };
  const auth = async (kind, ...args) => {
    requests.push([kind, ...plain(args)]);
    return options.request?.(kind, ...args) ?? response();
  };
  const f = reactFixture("src/routes/auth.tsx", (exports) => exports.Route.component, {
    modules: {
      sonner: {
        toast: {
          error(message, settings) {
            const id = settings.id ?? nextToastId++;
            messages.push(["error", message, settings, id]);
            toasts.set(id, { message, ...settings, id });
            return id;
          },
          success: (...args) => messages.push(["success", ...args]),
          dismiss(id) {
            assert.notEqual(id, undefined, "Never dismiss another surface's feedback");
            dismissals.push(id);
            // Sonner queues ID-specific dismissal until the next animation frame.
            queuedDismissals.push(() => toasts.delete(id));
          },
        },
      },
      "@tanstack/react-router": {
        createFileRoute: () => (config) => config,
        useSearch: () => search,
        useNavigate: () => (destination) => navigations.push(plain(destination)),
      },
      "@/components/NovaLogo": { NovaLogo: "logo" },
      "@/components/auth/ForgotPasswordDialog": { ForgotPasswordDialog: "forgot" },
      "@/integrations/supabase/client": {
        supabase: {
          auth: Object.fromEntries(
            ["signInWithPassword", "signUp", "signInWithOtp"].map((kind) => [
              kind,
              (...args) => auth(kind, ...args),
            ]),
          ),
        },
      },
      "@/lib/oauth-session": {
        getEmailAuthRedirectUri: () => "https://kova.test/auth/callback",
        getSafePostAuthRedirect: (destination) => destination ?? "/library",
      },
      "@/lib/auth-retry-delay.mjs": authRetry,
      "@/lib/kova-auth-browser": {
        browserKovaAuthEnabled: () => options.owned !== false,
        kovaPublicAuthJson: (...args) => auth("owned", ...args),
      },
      "@/lib/kova-auth-passkey-browser": {
        signInWithKovaPasskey: () => auth("passkey"),
      },
      "@/lib/passkey-support": { browserSupportsPasskeys: () => true },
      "@/lib/utils": { cn: (...args) => args.filter(Boolean).join(" ") },
    },
    globals: {
      window: {
        location: { replace: (destination) => redirects.push(destination) },
        requestAnimationFrame: () => {},
      },
      console: { error() {} },
      setTimeout(callback) {
        const id = nextTimerId++;
        timers.set(id, callback);
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    },
  });
  return {
    ...f,
    messages,
    requests,
    redirects,
    navigations,
    dismissals,
    toasts,
    errors: () => messages.filter(([kind]) => kind === "error"),
    visibleErrors() {
      queuedDismissals.splice(0).forEach((run) => run());
      return [...toasts.values()];
    },
    async ready() {
      await f.flush();
      if (!search.googleMfa) await f.input("kova-auth-page-password", password);
    },
    async changeSearch(next) {
      search = { ...search, ...next };
      await f.flush();
    },
    async elapseCooldown() {
      while (timers.size) {
        const callbacks = [...timers.values()];
        timers.clear();
        callbacks.forEach((run) => run());
        await f.flush();
      }
    },
  };
}

function assertPersistent(f, message) {
  const last = f.errors().at(-1);
  assert.ok(last, "An actionable error should be reported");
  if (message) assert.equal(last[1], message);
  assert.equal(last[2].duration, Infinity, "Override the shared four-second timeout");
  assert.equal(last[2].closeButton, true, "Persistent feedback must remain dismissible");
  assert.equal(f.visibleErrors().length, 1, "Keep only this context's current error");
  return last[3];
}

test("password errors persist, deduplicate validation, and allow dismissal without resurfacing", async () => {
  const f = fixture();
  await f.ready();
  await f.input("kova-auth-page-password", "short");
  await f.submit();
  const id = assertPersistent(f, "Password must be at least 12 characters.");
  await f.submit();
  assert.equal(assertPersistent(f), id, "Repeated validation updates the same scoped toast");
  assert.equal(f.requests.length, 0);
  await f.flush();
  assert.equal(f.visibleErrors()[0].duration, Infinity);
  await f.input("kova-auth-page-password", password);
  assert.equal(f.visibleErrors().length, 0, "Correcting the field resolves its validation toast");
  await f.input("kova-auth-page-password", "short");
  await f.submit();
  const correctedId = assertPersistent(f);
  f.visibleErrors()[0].onDismiss({ id: correctedId });
  f.toasts.delete(correctedId);
  await f.flush();
  assert.equal(f.visibleErrors().length, 0);
  await f.submit();
  assert.notEqual(assertPersistent(f), correctedId, "A dismissed toast is not recycled");
  await f.input("kova-auth-page-email", "invalid");
  await f.submit();
  assertPersistent(f, "Please enter a valid email address.");
  assert.equal(f.requests.length, 0);
});

test("fast failed retries cannot be removed by a queued old dismissal; success stays transient", async () => {
  let reject = true;
  const f = fixture({ request: () => response({ error: "Check your credentials." }, !reject) });
  await f.ready();
  await f.submit();
  const firstId = assertPersistent(f, "Check your credentials.");
  await f.input("kova-auth-page-password", `${password}-edited`);
  assert.equal(assertPersistent(f), firstId, "Editing alone does not resolve a provider rejection");
  await f.input("kova-auth-page-password", password);
  await f.submit();
  const retryId = assertPersistent(f);
  assert.notEqual(retryId, firstId);
  assert.deepEqual(f.dismissals, [firstId]);
  reject = false;
  await f.submit();
  assert.equal(f.visibleErrors().length, 0);
  assert.deepEqual(f.messages.at(-1), ["success", "Welcome back."]);
  assert.deepEqual(f.redirects, ["/library"]);
  assert.deepEqual(f.requests.at(-1), ["owned", "/api/auth/login", { email, password }]);
});

test("pending retries are serialized and late failures cannot restore feedback after unmount", async () => {
  const pending = deferred();
  const f = fixture({ request: () => pending.promise });
  await f.ready();
  const first = f.submit();
  await f.submit();
  assert.equal(f.requests.length, 1);
  f.unmount();
  pending.reject(new Error("Synthetic private provider detail"));
  await first;
  assert.equal(f.errors().length, 0);
});

test("account, mode, and recovery transitions clear only scoped feedback and ignore late errors", async () => {
  for (const transition of ["email", "mode", "recovery"]) {
    let pending;
    const f = fixture({
      request: () => pending?.promise ?? response({ error: "Old account guidance." }, false),
    });
    await f.ready();
    await f.submit();
    const id = assertPersistent(f);
    f.toasts.set("unrelated", { id: "unrelated", message: "Keep this separate notice." });
    pending = deferred();
    const retry = f.submit();
    if (transition === "email") await f.input("kova-auth-page-email", "other@example.invalid");
    if (transition === "mode") await f.changeSearch({ mode: "sign-up" });
    if (transition === "recovery") await f.click("Forgot password?");
    pending.resolve(response({ error: "Late private account guidance." }, false));
    await retry;
    assert.deepEqual(
      f.visibleErrors().map((notice) => notice.id),
      ["unrelated"],
    );
    assert.equal(f.errors().length, 1);
    assert.deepEqual(f.dismissals, [id]);
    f.unmount();
    assert.ok(f.toasts.has("unrelated"));
  }
});

test("unmount removes an existing error", async () => {
  const f = fixture({ request: () => response({}, false) });
  await f.ready();
  await f.submit();
  const id = assertPersistent(f, "Authentication could not be completed. Please try again.");
  f.unmount();
  assert.deepEqual(f.dismissals, [id]);
  assert.equal(f.visibleErrors().length, 0);
});

test("legacy password rejection and transport failure retain safe feedback and unchanged success", async () => {
  let outcome = "rejected";
  const f = fixture({
    owned: false,
    request: () => {
      if (outcome === "throw") throw new Error("Sensitive provider diagnostics");
      return { error: outcome === "rejected" ? { name: "AuthError" } : null };
    },
  });
  await f.ready();
  await f.submit();
  assertPersistent(f, "That email and password could not be verified.");
  outcome = "throw";
  await f.submit();
  assertPersistent(f, "Authentication could not be completed. Please try again.");
  outcome = "success";
  await f.submit();
  assert.equal(f.visibleErrors().length, 0);
  assert.deepEqual(f.messages.at(-1), ["success", "Welcome back."]);
  assert.deepEqual(f.redirects, ["/library"]);
  assert.deepEqual(f.requests.at(-1), ["signInWithPassword", { email, password }]);
});

test("signup keeps metadata, provider payloads, generic notices, and session-dependent destinations", async () => {
  for (const owned of [true, false]) {
    for (const session of [false, true]) {
      const f = fixture({
        owned,
        search: { mode: "sign-up" },
        request: () => (owned ? response() : { data: { session }, error: null }),
      });
      await f.ready();
      await f.input("kova-auth-page-name", " Synthetic User ");
      await f.submit();
      assert.deepEqual(
        f.requests[0],
        owned
          ? ["owned", "/api/auth/signup", { email, password, displayName: "Synthetic User" }]
          : [
              "signUp",
              {
                email,
                password,
                options: {
                  emailRedirectTo: "https://kova.test/auth/callback",
                  data: { full_name: "Synthetic User" },
                },
              },
            ],
      );
      if (!owned && session) {
        assert.deepEqual(f.redirects, ["/library"]);
        assert.deepEqual(f.messages.at(-1), ["success", "Welcome to KovaGPT."]);
      } else {
        assert.deepEqual(f.navigations, [{ to: "/" }]);
        assert.deepEqual(f.messages.at(-1), [
          "success",
          "If this address can be registered, check your inbox to continue.",
        ]);
      }
    }
  }
});

test("MFA guidance persists, clears on method changes, and preserves Google recovery return paths", async () => {
  let outcome = "rejected";
  const f = fixture({
    search: { googleMfa: true, returnTo: "/projects" },
    request: () => {
      if (outcome === "throw") throw new Error("Private MFA detail");
      return response({ error: "Check this verification code." }, outcome === "success");
    },
  });
  await f.ready();
  await f.input("kova-auth-page-mfa", "123456");
  await f.submit();
  assertPersistent(f, "Check this verification code.");
  assert.deepEqual(f.requests[0], [
    "owned",
    "/api/auth/login",
    { googleMfa: true, code: "123456" },
  ]);
  await f.click("Use a recovery code");
  assert.equal(f.visibleErrors().length, 0);
  await f.input("kova-auth-page-mfa", "synthetic-recovery-code");
  outcome = "throw";
  await f.submit();
  assertPersistent(f, "Two-factor verification could not be completed.");
  outcome = "success";
  await f.submit();
  assert.equal(f.visibleErrors().length, 0);
  assert.deepEqual(f.requests.at(-1), [
    "owned",
    "/api/auth/login",
    { googleMfa: true, recoveryCode: "synthetic-recovery-code" },
  ]);
  assert.deepEqual(f.messages.at(-1), ["success", "Welcome back."]);
  assert.deepEqual(f.redirects, ["/projects"]);
});

test("native password MFA challenge still advances to verification and supports returning to password", async () => {
  let outcome = "challenge";
  const f = fixture({
    request: () =>
      outcome === "challenge"
        ? response({ mfaRequired: true, challengeToken: "synthetic-challenge" })
        : response({}, false),
  });
  await f.ready();
  await f.submit();
  await f.flush();
  assert.match(f.text(), /Two-factor verification/);
  assert.equal(f.messages.length, 0);
  outcome = "rejected";
  await f.input("kova-auth-page-mfa", "123456");
  await f.submit();
  assertPersistent(f, "Two-factor verification could not be completed.");
  assert.deepEqual(f.requests.at(-1), [
    "owned",
    "/api/auth/login",
    { challengeToken: "synthetic-challenge", code: "123456" },
  ]);
  await f.flush();
  await f.click("Back to password");
  assert.equal(f.visibleErrors().length, 0);
  assert.equal(
    f.find("input", (node) => node.props.id === "kova-auth-page-password").props.value,
    "",
  );
});

test("passkey cancellation stays visible until retry and preserves redirect without legacy fallback", async () => {
  let fail = true;
  const f = fixture({
    request: () => {
      if (fail) throw new Error("Sensitive WebAuthn detail");
    },
  });
  await f.ready();
  await f.click("Continue with a passkey");
  assertPersistent(f, "Passkey sign-in was cancelled or could not be completed.");
  fail = false;
  await f.click("Continue with a passkey");
  assert.equal(f.visibleErrors().length, 0);
  assert.deepEqual(f.requests, [["passkey"], ["passkey"]]);
  assert.deepEqual(f.redirects, ["/library"]);
});

test("magic-link errors persist while success and resend retain their existing cooldown and notices", async () => {
  let fail = true;
  const f = fixture({
    owned: false,
    request: () => ({ error: fail ? new Error("Private delivery failure") : null }),
  });
  await f.ready();
  await f.click("Email me a link instead");
  assertPersistent(f, "The sign-in link could not be requested. Please try again.");
  fail = false;
  await f.click("Email me a link instead");
  assert.equal(f.visibleErrors().length, 0);
  assert.match(f.text(), /Sign-in link requested/);
  assert.match(f.text(), /Retry in 45s \(local delay\)/);
  await f.elapseCooldown();
  await f.click("Resend the link");
  assert.deepEqual(f.messages.at(-1), ["success", "Another link was requested."]);
  assert.deepEqual(f.requests.at(-1), [
    "signInWithOtp",
    { email, options: { emailRedirectTo: "https://kova.test/auth/callback" } },
  ]);
  await f.click("Use a different email");
  await f.input("kova-auth-page-email", "invalid");
  f.find("button", (node) => node.props.children === "Email me a link instead").props.onClick();
  assertPersistent(f, "Enter a valid email first.");
});

test("verification resend errors stay readable and success keeps its generic notice and cooldown", async () => {
  let fail = true;
  const f = fixture({ request: () => response({}, !fail) });
  await f.ready();
  await f.click("Resend verification email");
  assertPersistent(f, "Verification could not be requested. Please try again.");
  fail = false;
  await f.click("Resend verification email");
  assert.equal(f.visibleErrors().length, 0);
  assert.match(f.text(), /Retry in 60s \(local delay\)/);
  assert.deepEqual(f.messages.at(-1), [
    "success",
    "If verification is available for this address, check your inbox.",
  ]);
  assert.deepEqual(f.requests.at(-1), ["owned", "/api/auth/verify/resend", { email }]);
});

test("verification rate limit uses server Retry-After before permitting another request", async () => {
  const f = fixture({
    request: () => ({
      ok: false,
      headers: new Headers({ "Retry-After": "120" }),
      json: async () => ({}),
    }),
  });
  await f.ready();
  await f.click("Resend verification email");
  assert.match(f.text(), /Retry in 120s/);
  assert.equal(f.requests.length, 1);
  assertPersistent(f, "Verification could not be requested. Please try again.");
});
