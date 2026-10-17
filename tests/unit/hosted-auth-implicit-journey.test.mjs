import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { AuthClient } from "@supabase/auth-js";
import { reactFixture } from "../helpers/kova-react-fixture.mjs";
import * as security from "../../src/lib/auth-security.mjs";
import * as policy from "../../src/lib/auth-validation-policy.mjs";

const id = "10000000-0000-4000-8000-000000000001";
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const token = [
  encode({ alg: "HS256", typ: "JWT" }),
  encode({ sub: id, exp: 4102444800, aal: "aal1", amr: [] }),
  "c2lnbmF0dXJl",
].join(".");
const memory = () => {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
};

async function fixture({
  route = false,
  status = 200,
  debug = true,
  delayMs = 0,
  origin = "https://kovagpt.com",
} = {}) {
  const storage = memory(),
    sessionStorage = memory(),
    calls = [],
    logs = [],
    redirects = [];
  const location = new URL(
    `${origin}/${route ? "~oauth/callback" : ""}${debug ? "?auth_debug=1" : ""}#access_token=${token}&refresh_token=fixture-refresh&type=magiclink`,
  );
  location.replace = (value) => {
    redirects.push(value);
    location.href = new URL(value, location).href;
  };
  location.assign = location.replace;
  let userStatus = status;
  const auth = new AuthClient({
    url: "https://fixture.invalid/auth/v1",
    storage,
    storageKey: "fixture-auth",
    persistSession: true,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    lock: async (_name, _timeout, fn) => fn(),
    fetch: async (url, init) => {
      const path = new URL(url).pathname;
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      calls.push({ operation: "HTTP", path, status: path.endsWith("/logout") ? 204 : userStatus });
      if (path.endsWith("/logout")) return new Response(null, { status: 204 });
      if (path === "/auth/v1/otp") return Response.json({});
      assert.equal(path, "/auth/v1/user");
      return Response.json(
        userStatus === 200
          ? {
              id,
              email: "owner@example.invalid",
              aud: "authenticated",
              role: "authenticated",
              app_metadata: { provider: "email" },
              user_metadata: {},
              created_at: "2026-01-01T00:00:00Z",
            }
          : { code: "provider_unavailable", message: "PRIVATE_UPSTREAM_VALUE" },
        { status: userStatus },
      );
    },
  });
  await auth.initialize();
  const originalSet = auth.setSession.bind(auth);
  auth.setSession = async (input) => {
    calls.push({ operation: "setSession" });
    return originalSet(input);
  };
  let clockOffset = 0;
  class DiagnosticDate extends Date {
    static now() {
      return Date.now() + clockOffset;
    }
  }
  const globals = {
    window: {
      location,
      localStorage: storage,
      sessionStorage,
      history: {
        replaceState(_s, _t, path) {
          location.href = new URL(path, location).href;
        },
      },
      setTimeout,
      clearTimeout,
    },
    document: { title: "KovaGPT", activeElement: null },
    HTMLElement: class {},
    sessionStorage,
    URL,
    URLSearchParams,
    AbortController,
    Error,
    Date: DiagnosticDate,
    setTimeout,
    clearTimeout,
    console: {
      error: (...args) => logs.push(args),
      warn: (...args) => logs.push(args),
      info: (...args) => logs.push(args),
    },
  };
  const client = {
    supabase: { auth },
    getSupabaseClientConfigStatus: () => ({ configured: true, missing: [] }),
    resolveLegacyAuthContext: async () => ({ auth, assertCurrent() {} }),
  };
  const oauth = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync("src/lib/oauth-session.ts", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      ...globals,
      exports: oauth,
      require(name) {
        if (name === "@/integrations/supabase/client") return client;
        if (name === "@/lib/auth-security.mjs") return security;
        throw Error(`Unexpected import ${name}`);
      },
    },
  );
  const modules = {
    "@/integrations/supabase/client": client,
    "@/lib/oauth-session": oauth,
    "@/lib/auth-validation-policy.mjs": policy,
    "@/lib/principal-browser-storage.mjs": {
      clearPrincipalBrowserStorage() {
        calls.push({ operation: "clearPrivateData" });
        return { local: { failures: [] }, session: { failures: [] } };
      },
      purgeUnscopedPrivateBrowserStorage() {
        return { local: { failures: [] }, session: { failures: [] } };
      },
      dispatchPrincipalBrowserStorageCleared() {},
    },
    "@/lib/kova-auth-browser": {
      browserKovaAuthMode: () => "supabase",
      browserKovaAuthEnabled: () => false,
    },
    "@/lib/kova-auth-passkey-browser": {},
    "@/lib/passkey-support": { browserSupportsPasskeys: () => false },
    "@/lib/utils": { cn: (...args) => args.filter(Boolean).join(" ") },
    "@/components/auth/ForgotPasswordDialog": { ForgotPasswordDialog: "forgot" },
    "@/hooks/useAuthProviders": {
      useAuthProviders: () => ({ resolved: true, google: false, passkeys: false }),
    },
    "@/lib/auth-providers": { GOOGLE_UNCONFIGURED_MESSAGE: "Google unavailable" },
    "@/components/ui/dialog": {
      Dialog: "dialog",
      DialogContent: "dialog-content",
      DialogDescription: "description",
      DialogTitle: "title",
    },
    "@/components/auth/AuthDialog": { AuthDialog: "auth-dialog" },
    "@/components/auth/MfaChallengeDialog": { MfaChallengeDialog: "mfa-dialog" },
    "@/components/LogoutConfirmDialog": {},
    "@/components/ui/dropdown-menu": {},
    "@/components/NovaLogo": { NovaLogo: "logo" },
    "@tanstack/react-router": {
      createFileRoute: () => (config) => config,
      useNavigate: () => () => {},
      useSearch: () => ({ email: "owner@example.invalid", mode: "sign-in" }),
      redirect() {},
    },
  };
  const provider = () =>
    reactFixture(
      "src/components/auth/ClerkSafe.tsx",
      (m) => () => {
        const wrapper = m.ClerkProvider({ children: "application" });
        return wrapper.type(wrapper.props);
      },
      { modules, globals },
    );
  const f = route
    ? reactFixture("src/routes/~oauth.callback.tsx", (m) => m.Route.component, { modules, globals })
    : provider();
  const settle = async (target) => {
    for (let i = 0; i < 8; i++) {
      await target.flush();
      await new Promise((r) => setTimeout(r, 0));
    }
  };
  return {
    f,
    auth,
    oauth,
    calls,
    logs,
    location,
    redirects,
    provider,
    emailForm(dialog) {
      location.hash = "";
      return reactFixture(
        dialog ? "src/components/auth/AuthDialog.tsx" : "src/routes/auth.tsx",
        (m) =>
          dialog
            ? () => m.AuthDialog({ open: true, mode: "sign-in", onOpenChange() {} })
            : m.Route.component,
        { modules, globals },
      );
    },
    settle,
    sessionStorage,
    advanceClock(ms) {
      clockOffset += ms;
    },
    setStatus(value) {
      userStatus = value;
    },
  };
}

for (const route of [false, true])
  test(`implicit ${route ? "callback route" : "root fallback"}: effect replay must not discard the fragment before SDK persistence`, async (t) => {
    const x = await fixture({ route });
    t.after(() => {
      x.f.unmount();
      x.auth.stopAutoRefresh();
    });
    const pending = x.f.flush(); // Starts the first effect synchronously.
    x.f.replayEffects(); // React development replay: cleanup then setup, before async work resumes.
    await pending;
    await x.settle(x.f);
    assert.equal(
      (await x.auth.getSession()).data.session?.user.id,
      id,
      "fragment session must survive effect replay",
    );
    assert.equal(
      x.calls.filter((c) => c.operation === "setSession").length,
      1,
      "one callback must persist once",
    );
    if (route) assert.deepEqual(x.redirects, ["/"]);
    else assert.equal(x.f.tree.props.value.user?.id, id);
  });

test("implicit application journey uses one SDK write, validates the user, survives refresh and logs out", async (t) => {
  const x = await fixture();
  t.after(() => {
    x.f.unmount();
    x.auth.stopAutoRefresh();
  });
  await x.settle(x.f);
  assert.equal(x.f.tree.props.value.user?.id, id);
  assert.equal(x.f.tree.props.value.isLoaded, true);
  assert.equal(x.location.hash, "");
  assert.equal(
    x.calls.filter((c) => c.operation === "setSession").length,
    1,
    "readback must not call setSession a second time",
  );
  x.f.unmount();
  const refreshed = x.provider();
  t.after(refreshed.unmount);
  await x.settle(refreshed);
  assert.equal(refreshed.tree.props.value.user?.id, id);
  await refreshed.tree.props.value.signOut();
  assert.equal((await x.auth.getSession()).data.session, null);
  const signedOut = x.provider();
  t.after(signedOut.unmount);
  await x.settle(signedOut);
  assert.equal(signedOut.tree.props.value.user, null);
  assert.equal(signedOut.tree.props.value.isLoaded, true);
});

test("callback diagnostics identify the SDK-reported failing stage and latency without credentials", async (t) => {
  const x = await fixture({ status: 503, delayMs: 18 });
  t.after(() => {
    x.f.unmount();
    x.auth.stopAutoRefresh();
  });
  await x.settle(x.f);
  await new Promise((resolve) => setTimeout(resolve, 25));
  await x.settle(x.f);
  assert.equal(x.f.tree.props.value.user, null);
  assert.equal(x.f.tree.props.value.isLoaded, false);
  const exported = x.oauth.getHostedAuthDiagnosticText();
  const events = JSON.parse(exported).events;
  const failure = events.find((e) => e.phase === "session_write" && e.outcome === "error");
  assert.equal(failure.httpStatus, 503);
  assert.equal(failure.errorClass, "AuthRetryableFetchError");
  assert.ok(
    failure.elapsedMs >= 15,
    "timing belongs to the SDK operation, not an automation timeout",
  );
  assert.equal(events.find((e) => e.phase === "callback_received").flow, "implicit");
  for (const secret of [
    token,
    "fixture-refresh",
    "owner@example.invalid",
    "PRIVATE_UPSTREAM_VALUE",
    id,
  ]) {
    assert.equal(exported.includes(secret), false);
    assert.equal(JSON.stringify(x.logs).includes(secret), false);
  }
});

test("sanitized diagnostic evidence survives failed saves, stays bounded and expires", async (t) => {
  const x = await fixture({ origin: "https://www.kovagpt.com" });
  t.after(() => {
    x.f.unmount();
    x.auth.stopAutoRefresh();
  });
  x.sessionStorage.setItem = () => {
    throw new Error("PRIVATE_STORAGE_ERROR");
  };
  await x.settle(x.f);
  const initial = JSON.parse(x.oauth.getHostedAuthDiagnosticText()).events;
  assert.equal(initial.find((e) => e.phase === "callback_received").origin, "www");
  assert.equal(initial.find((e) => e.phase === "callback_received").redirectOriginChanges, true);
  assert.equal(x.f.tree.props.value.user?.id, id);
  for (let i = 0; i < 80; i++)
    x.oauth.recordHostedAuthDiagnostic("current_user", "error", {
      error: {
        name: "PRIVATE_NAME",
        code: "PRIVATE_CODE",
        message: "PRIVATE_MESSAGE",
        status: 403,
        cause: { token },
      },
      email: "PRIVATE_EMAIL",
      url: "https://secret.invalid/",
      identityMatches: false,
    });
  const exported = x.oauth.getHostedAuthDiagnosticText();
  assert.equal(JSON.parse(exported).events.length, 64);
  assert.equal(JSON.parse(exported).events.at(-1).httpStatus, 403);
  assert.equal(JSON.parse(exported).events.at(-1).errorClass, "other");
  assert.doesNotMatch(exported, /PRIVATE|secret.invalid|cause|email/);
  x.advanceClock(30 * 60 * 1000 + 1);
  assert.equal(x.oauth.getHostedAuthDiagnosticText(), null);
});

test("normal sign-in has no diagnostic panel or record without opt-in", async (t) => {
  const x = await fixture({ debug: false });
  t.after(() => {
    x.f.unmount();
    x.auth.stopAutoRefresh();
  });
  await x.settle(x.f);
  assert.equal(x.f.tree.props.value.user?.id, id);
  assert.equal(x.oauth.getHostedAuthDiagnosticText(), null);
  assert.equal(
    x.logs.some((line) => line[0] === "[KovaAuth diagnostic]"),
    false,
  );
});

for (const dialog of [false, true])
  test(`email initiation diagnostics use the actual ${dialog ? "dialog" : "account page"} request without changing its redirect`, async (t) => {
    const x = await fixture();
    const form = x.emailForm(dialog);
    t.after(() => {
      form.unmount();
      x.f.unmount();
      x.auth.stopAutoRefresh();
    });
    await x.settle(form);
    if (dialog) {
      form.find("input").props.onChange({ target: { value: "owner@example.invalid" } });
      await form.flush();
    }
    await form.click(dialog ? "Email me a sign-in link" : "Email me a link instead");
    await x.settle(form);
    assert.equal(
      x.calls.filter((call) => call.operation === "HTTP" && call.path === "/auth/v1/otp").length,
      1,
    );
    const events = JSON.parse(x.oauth.getHostedAuthDiagnosticText()).events;
    assert.ok(events.some((event) => event.phase === "email_request" && event.outcome === "ok"));
    assert.match(form.text(), /link requested|Check your email/);
    assert.equal(new URL(x.oauth.getEmailAuthRedirectUri()).origin, "https://kovagpt.com");
    assert.equal(new URL(x.oauth.getEmailAuthRedirectUri()).pathname, "/~oauth/callback");
    assert.ok(!JSON.stringify(x.logs).includes("owner@example.invalid"));
  });
