import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { reactFixture } from "../helpers/kova-react-fixture.mjs";
import * as security from "../../src/lib/auth-security.mjs";
import * as policy from "../../src/lib/auth-validation-policy.mjs";

const linkMessage =
  "This sign-in link has expired or was already used. Request a new link and open it once in the browser you want to use.";
const genericMessage = "KovaGPT could not verify your session. Your browser data was not changed.";
const session = {
  access_token: "fixture-access",
  refresh_token: "fixture-refresh",
  user: { id: "fixture-owner" },
};

function fixture(href, { route = false, stored = null, userError = null } = {}) {
  let location = new URL(href);
  let storedSession = stored;
  const calls = [],
    logs = [];
  const auth = {
    onAuthStateChange() {
      return { data: { subscription: { unsubscribe() {} } } };
    },
    async getSession() {
      calls.push("getSession");
      return { data: { session: storedSession }, error: null };
    },
    async setSession() {
      calls.push("setSession");
      storedSession = session;
      return { data: { session }, error: null };
    },
    async getUser() {
      calls.push("getUser");
      return { data: { user: userError ? null : session.user }, error: userError };
    },
    async signOut() {
      calls.push("signOut");
    },
    mfa: {
      async getAuthenticatorAssuranceLevel() {
        calls.push("assurance");
        return { data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null };
      },
    },
  };
  const window = {
    get location() {
      return location;
    },
    history: {
      replaceState(_state, _title, path) {
        location = new URL(path, location.origin);
      },
    },
    setTimeout,
    clearTimeout,
  };
  const globals = {
    window,
    document: { title: "Kova", activeElement: null },
    HTMLElement: class {},
    URL,
    URLSearchParams,
    AbortController,
    Error,
    setTimeout,
    console: { error: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
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
        throw new Error(`Unexpected import ${name}`);
      },
    },
  );
  const modules = {
    "@/integrations/supabase/client": client,
    "@/lib/oauth-session": oauth,
    "@/lib/auth-validation-policy.mjs": policy,
    "@/lib/principal-browser-storage.mjs": {
      clearPrincipalBrowserStorage() {
        calls.push("clearPrivateData");
        return Promise.resolve({ local: { failures: [] }, session: { failures: [] } });
      },
      purgeUnscopedPrivateBrowserStorage() {
        calls.push("purgeOwnerless");
        return { local: { failures: [] }, session: { failures: [] } };
      },
      dispatchPrincipalBrowserStorageCleared() {},
    },
    "@/lib/kova-auth-browser": { browserKovaAuthMode: () => "supabase" },
    "@/components/auth/AuthDialog": { AuthDialog: "auth-dialog" },
    "@/components/auth/MfaChallengeDialog": { MfaChallengeDialog: "mfa-dialog" },
    "@/components/LogoutConfirmDialog": {},
    "@/components/ui/dropdown-menu": {},
    "@/components/NovaLogo": { NovaLogo: "logo" },
    "@tanstack/react-router": { createFileRoute: () => (config) => config },
  };
  const f = route
    ? reactFixture("src/routes/~oauth.callback.tsx", (m) => m.Route.component, { modules, globals })
    : reactFixture(
        "src/components/auth/ClerkSafe.tsx",
        (m) => () => {
          const wrapper = m.ClerkProvider({ children: "private-view" });
          return wrapper.type(wrapper.props);
        },
        { modules, globals },
      );
  return { f, calls, logs, oauth, location: () => location };
}

test("actual root callback explains an unusable link and opens sign-in without reload, exchange, logout or data deletion", async (t) => {
  const x = fixture(
    "https://kova.test/#error=access_denied&error_code=otp_expired&error_description=DO_NOT_EXPOSE&access_token=DO_NOT_EXPOSE&refresh_token=DO_NOT_EXPOSE",
  );
  t.after(x.f.unmount);
  await x.f.flush();
  assert.ok(x.f.text().includes(linkMessage), x.f.text());
  assert.equal(x.f.tree.props.value.isLoaded, false);
  assert.equal(x.f.tree.props.value.user, null);
  assert.equal(x.location().hash, "");
  assert.deepEqual(x.calls, []);
  await x.f.click("Sign in again");
  assert.equal(x.f.find("auth-dialog").props.open, true);
  assert.equal(x.f.find("auth-dialog").props.mode, "sign-in");
  assert.deepEqual(x.calls, []);
  assert.ok(!JSON.stringify(x.logs).includes("DO_NOT_EXPOSE"));
});

test("actual dedicated callback uses the same fixed link error and never displays provider text", async (t) => {
  const x = fixture(
    "https://kova.test/~oauth/callback#error=access_denied&error_code=otp_expired&error_description=DO_NOT_EXPOSE",
    { route: true },
  );
  t.after(x.f.unmount);
  await x.f.flush();
  assert.ok(x.f.text().includes(linkMessage), x.f.text());
  assert.equal(x.f.find("a").props.href, "/?sign-in=1");
  assert.deepEqual(x.calls, []);
  assert.ok(!JSON.stringify(x.logs).includes("DO_NOT_EXPOSE"));
});

test("unknown provider failures cannot inject callback details into logs or get misclassified as an expired link", async (t) => {
  const x = fixture(
    "https://kova.test/#error=DO_NOT_EXPOSE&error_code=DO_NOT_EXPOSE&error_description=DO_NOT_EXPOSE",
  );
  t.after(x.f.unmount);
  await x.f.flush();
  assert.ok(x.f.text().includes(genericMessage));
  assert.ok(!JSON.stringify(x.logs).includes("DO_NOT_EXPOSE"));
  assert.deepEqual(x.calls, []);
});

test("a valid implicit callback still requires user and MFA verification before exposing the principal", async (t) => {
  const x = fixture(
    "https://kova.test/#access_token=fixture-access&refresh_token=fixture-refresh&type=magiclink",
  );
  t.after(x.f.unmount);
  await x.f.flush();
  assert.equal(x.f.tree.props.value.user?.id, session.user.id);
  assert.equal(x.f.tree.props.value.isLoaded, true);
  assert.equal(x.f.tree.props.value.authIssue, null);
  assert.ok(x.calls.includes("getUser"));
  assert.ok(x.calls.includes("assurance"));
  assert.ok(!x.calls.includes("signOut"));
});

test("a retryable authoritative-user failure stays unresolved and preserves account data", async (t) => {
  const x = fixture("https://kova.test/", {
    stored: session,
    userError: { name: "AuthApiError", status: 503 },
  });
  t.after(x.f.unmount);
  await x.f.flush();
  assert.ok(x.f.text().includes(genericMessage));
  assert.equal(x.f.tree.props.value.isLoaded, false);
  assert.equal(x.f.tree.props.value.user, null);
  assert.ok(!x.calls.some((v) => ["clearPrivateData", "purgeOwnerless", "signOut"].includes(v)));
});
