import assert from "node:assert/strict";
import test from "node:test";
import { reactFixture } from "../helpers/kova-react-fixture.mjs";

test("callback effect replay cancels the first start before consuming one-use credentials", async () => {
  const timers = new Map(),
    calls = [],
    redirects = [];
  let counter = 0;
  const f = reactFixture("src/routes/~oauth.callback.tsx", (e) => e.Route.component, {
    globals: {
      AbortController,
      window: {
        setTimeout(fn, delay) {
          const id = ++counter;
          timers.set(id, { fn, delay });
          return id;
        },
        clearTimeout(id) {
          timers.delete(id);
        },
        location: { replace: (next) => redirects.push(next) },
      },
    },
    modules: {
      "@tanstack/react-router": { createFileRoute: () => (route) => route },
      "@/components/NovaLogo": { NovaLogo: "logo" },
      "@/lib/oauth-session": {
        getCallbackPostAuthRedirect: () => "/settings",
        completeOAuthSessionFromUrl: async (_source, signal) => {
          signal.throwIfAborted();
          calls.push("exchange");
          return { user: { id: "owner" } };
        },
        clearOAuthResponseFromUrl: () => calls.push("scrub"),
        getSafePostAuthRedirect: (value) => value,
      },
    },
  });
  await f.flush();
  assert.deepEqual(calls, [], "no synchronous consumption during the first mount");
  f.replayEffects();
  for (const [id, timer] of [...timers]) {
    if (timer.delay === 0) {
      timers.delete(id);
      timer.fn();
    }
  }
  await f.flush();
  assert.deepEqual(calls, ["exchange", "scrub"]);
  assert.deepEqual(redirects, ["/settings"]);
  f.unmount();
  assert.equal(timers.size, 0);
});

function dialogFixture({ mode = "dual", github = true, rejected = false } = {}) {
  const calls = [],
    redirects = [];
  const f = reactFixture(
    "src/components/auth/AuthDialog.tsx",
    (e) => () =>
      e.AuthDialog({
        open: true,
        mode: "sign-in",
        onOpenChange() {},
      }),
    {
      globals: { window: { location: { assign: (url) => redirects.push(url) } } },
      modules: {
        "@/components/ui/dialog": {
          Dialog: "dialog",
          DialogContent: "section",
          DialogDescription: "p",
          DialogTitle: "h2",
        },
        "@tanstack/react-router": { useNavigate: () => () => {} },
        "@/components/NovaLogo": { NovaLogo: "logo" },
        "@/integrations/supabase/client": {
          supabase: {},
          resolveLegacyAuthContext: async () => {
            if (rejected) throw new Error("hosted_auth_unavailable");
            return {
              assertCurrent() {},
              auth: {
                signInWithOAuth: async (input) => {
                  calls.push(input);
                  return { data: { url: "https://auth.example.test/authorize" }, error: null };
                },
              },
            };
          },
        },
        "@/lib/oauth-session": {
          rememberPostAuthRedirect() {},
          getOAuthRedirectUri: () => "https://kovagpt.com/~oauth/callback",
          getEmailAuthRedirectUri: () => "https://kovagpt.com/~oauth/callback",
        },
        "@/hooks/useAuthProviders": {
          useAuthProviders: () => ({ resolved: true, github, google: true }),
        },
        "@/lib/auth-providers": { GOOGLE_UNCONFIGURED_MESSAGE: "Unavailable" },
        "@/assets/plugins/github.svg": { default: "github.svg" },
        "@/lib/utils": { cn: (...values) => values.filter(Boolean).join(" ") },
        "@/lib/kova-auth-browser": {
          browserKovaAuthEnabled: () => mode !== "supabase",
          browserKovaAuthMode: () => mode,
          browserKovaAuthOrigin: () => "https://kovagpt.com",
        },
      },
    },
  );
  return { f, calls, redirects };
}

test("GitHub replaces passkey and starts the guarded identity OAuth flow", async () => {
  const { f, calls, redirects } = dialogFixture();
  await f.flush();
  assert.ok(!f.text().includes("passkey"));
  await f.click("Continue with GitHub");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].provider, "github");
  assert.equal(calls[0].options.redirectTo, "https://kovagpt.com/~oauth/callback");
  assert.equal(calls[0].options.skipBrowserRedirect, true);
  assert.deepEqual(redirects, ["https://auth.example.test/authorize"]);
});

for (const options of [{ github: false }, { mode: "kova" }])
  test(`GitHub stays disabled when unavailable: ${JSON.stringify(options)}`, async () => {
    const { f, calls, redirects } = dialogFixture(options);
    await f.flush();
    const button = f.find("button", (n) => n.props["aria-describedby"] === "github-sign-in-status");
    assert.equal(button.props.disabled, true);
    await button.props.onClick();
    assert.equal(calls.length, 0);
    assert.equal(redirects.length, 0);
  });

test("GitHub cannot bypass a rejected owned session", async () => {
  const { f, calls, redirects } = dialogFixture({ rejected: true });
  await f.flush();
  await f.click("Continue with GitHub");
  assert.equal(calls.length, 0);
  assert.equal(redirects.length, 0);
  assert.equal(f.messages[0][0], "error");
});
