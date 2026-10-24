import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const compile = (path) =>
  ts.transpileModule(readFileSync(path, "utf8").replaceAll("import.meta.env", "TEST_ENV"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
const sources = {
  browser: compile("src/lib/kova-auth-browser.ts"),
  client: compile("src/integrations/supabase/client.ts"),
  dialog: compile("src/components/auth/AuthDialog.tsx"),
};
const jsx = (type, props) => ({ type, props: props ?? {} });
const text = (node) => {
  if (node == null || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(text).join("");
  return typeof node === "object" ? text(node.props?.children) : String(node);
};
function buttons(node, result = []) {
  if (Array.isArray(node)) node.forEach((child) => buttons(child, result));
  else if (node && typeof node === "object") {
    if (node.type === "button") result.push(node);
    buttons(node.props?.children, result);
  }
  return result;
}

function fixture({
  mode = "dual",
  dialogMode = "sign-in",
  ownedGoogle = false,
  providers = { resolved: true, google: true },
  probe = () => Response.json({ session: null }),
  start = async () => ({
    data: { url: "https://accounts.example.invalid/authorize" },
    error: null,
  }),
  ownedNavigationFails = false,
} = {}) {
  const events = [];
  const location = new URL("https://kova.test/?sign-in=1");
  location.assign = (url) => {
    events.push({ type: "navigate", url });
    if (ownedNavigationFails && new URL(url).pathname === "/api/auth/google/start")
      throw new Error("navigation_failed");
  };
  const modules = {
    react: {
      useState: (initial) => [initial, () => {}],
      useEffect: () => {},
      useRef: (current) => ({ current }),
      useCallback: (callback) => callback,
    },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "@tanstack/react-router": { useNavigate: () => () => {} },
    "@/components/ui/dialog": {
      Dialog: "dialog",
      DialogContent: "content",
      DialogDescription: "description",
      DialogTitle: "title",
    },
    "@/components/ui/input": { Input: "input" },
    "@/components/ui/button": { Button: "button" },
    "@/components/NovaLogo": { NovaLogo: "logo" },
    "lucide-react": Object.fromEntries(
      ["AlertTriangle", "ArrowLeft", "KeyRound", "Loader2"].map((name) => [name, name]),
    ),
    sonner: {
      toast: {
        error: () => events.push({ type: "error" }),
        success: () => events.push({ type: "success" }),
      },
    },
    "@/lib/oauth-session": {
      getOAuthRedirectUri: () => "https://kova.test/~oauth/callback",
      getEmailAuthRedirectUri: () => "https://kova.test/auth",
      rememberPostAuthRedirect: () => events.push({ type: "remember" }),
    },
    "@/hooks/useAuthProviders": { useAuthProviders: () => providers },
    "@/lib/auth-providers": {
      GOOGLE_UNCONFIGURED_MESSAGE: "Google is not configured.",
    },
    "@/lib/passkey-support": { browserSupportsPasskeys: () => false },
    "@/lib/kova-auth-passkey-browser": {
      signInWithKovaPasskey: () => assert.fail("No passkey attempt in Google fixtures"),
    },
    "@/lib/utils": { cn: (...values) => values.join(" ") },
    "./config": {
      SUPABASE_BROWSER_CONFIG: {
        url: "https://fixture.supabase.co",
        publishableKey: "fixture-publishable",
      },
    },
    "@/lib/kova-auth-data-fetch": {
      createKovaDataFetch: () => assert.fail("Hosted action must not use the Kova data client"),
    },
    "@supabase/supabase-js": {
      createClient: (_url, _key, options) => {
        assert.equal(options.accessToken, undefined);
        events.push({ type: "create-legacy" });
        return {
          auth: {
            signInWithOAuth: async (input) => {
              events.push({ type: "hosted-start", input });
              return start(input);
            },
          },
        };
      },
    },
    "@/integrations/provider-auth": {
      providerAuth: {
        auth: {
          signInWithOAuth: async () => {
            events.push({ type: "original-hosted-start" });
            return { redirected: true };
          },
        },
      },
    },
  };
  const globals = {
    Response,
    Request,
    Headers,
    URL,
    URLSearchParams,
    Date,
    Promise,
    setTimeout,
    TEST_ENV: {
      VITE_KOVA_AUTH_MODE: mode,
      VITE_KOVA_GOOGLE_AUTH_ENABLED: ownedGoogle ? "true" : "false",
    },
    window: { location, localStorage: {} },
    fetch: async (path) => {
      assert.equal(path, "/api/auth/session");
      events.push({ type: "cookie-probe" });
      return probe();
    },
    console: { error: () => {} },
  };
  const load = (source) => {
    const exports = {};
    vm.runInNewContext(source, {
      ...globals,
      exports,
      require: (name) => {
        assert.ok(modules[name], name);
        return modules[name];
      },
    });
    return exports;
  };
  const browser = load(sources.browser);
  modules["@/lib/kova-auth-browser"] = browser;
  modules["@/integrations/supabase/client"] = load(sources.client);
  const dialog = load(sources.dialog).AuthDialog;
  const tree = dialog({ open: true, mode: dialogMode, onOpenChange: () => {} });
  const renderedButtons = buttons(tree);
  return {
    events,
    browser,
    tree,
    hosted: renderedButtons.find((node) => text(node) === "Log in with existing Google"),
    owned: renderedButtons.find((node) => text(node) === "Continue with Google"),
    count: (type) => events.filter((event) => event.type === type).length,
  };
}

test("dual offers an explicit hosted Google login when owned Google is disabled", async () => {
  const f = fixture();
  assert.ok(f.hosted);
  assert.equal(f.hosted.props.disabled, false);
  assert.equal(f.owned, undefined);
  await f.hosted.props.onClick();
  assert.equal(f.count("cookie-probe"), 1);
  assert.equal(f.count("hosted-start"), 1);
  const request = f.events.find((event) => event.type === "hosted-start").input;
  assert.equal(request.provider, "google");
  assert.equal(request.options.redirectTo, "https://kova.test/~oauth/callback");
  assert.equal(request.options.skipBrowserRedirect, true);
  assert.equal(
    f.events.find((event) => event.type === "navigate").url,
    "https://accounts.example.invalid/authorize",
  );
  assert.equal(f.browser.isKovaSessionActive(), false);
});

for (const mode of ["kova", "supabase"])
  test(`${mode} does not expose the dual existing-account action`, async () => {
    const f = fixture({ mode, ownedGoogle: true });
    assert.equal(f.hosted, undefined);
    assert.ok(f.owned);
    await f.owned.props.onClick();
    assert.equal(f.count("hosted-start"), 0);
    assert.equal(f.count("cookie-probe"), 0);
    assert.equal(f.count("original-hosted-start"), mode === "supabase" ? 1 : 0);
  });

test("dual signup keeps owned Google separate from the existing-account login", () => {
  const f = fixture({ dialogMode: "sign-up", ownedGoogle: true });
  assert.equal(f.hosted, undefined);
  assert.ok(f.owned);
});

test("unresolved hosted availability cannot initiate OAuth", async () => {
  const f = fixture({ providers: { resolved: false, google: false } });
  assert.ok(f.hosted);
  assert.equal(f.hosted.props.disabled, true);
  await f.hosted.props.onClick();
  assert.equal(f.count("hosted-start"), 0);
  assert.equal(f.count("cookie-probe"), 0);
});

for (const providers of [
  { resolved: true, google: false },
  { resolved: false, google: false, error: "unreachable" },
])
  test(`disabled/failed hosted provider is not advertised (${JSON.stringify(providers)})`, () => {
    const f = fixture({ providers });
    assert.equal(f.hosted, undefined);
    assert.equal(f.count("hosted-start"), 0);
  });

for (const [label, probe] of [
  ["rejected owned cookie", () => new Response(null, { status: 401 })],
  ["unavailable authority", () => new Response(null, { status: 503 })],
  [
    "interrupted cookie probe",
    () => {
      throw new TypeError("network_failed");
    },
  ],
  [
    "active owned session",
    () =>
      Response.json({
        session: {
          accountId: "owned-account",
          sessionId: "owned-session",
          email: "owner@example.invalid",
          emailVerified: true,
          assuranceLevel: "aal1",
          expiresAt: "2099-01-01T00:00:00Z",
        },
      }),
  ],
])
  test(`${label} cannot start hosted Google or force hosted authority`, async () => {
    const f = fixture({ probe });
    await f.hosted.props.onClick();
    assert.equal(f.count("hosted-start"), 0);
    assert.equal(f.count("create-legacy"), 0);
    assert.equal(f.count("navigate"), 0);
    assert.equal(f.browser.isKovaSessionActive(), true);
    assert.equal(f.count("error"), 1);
  });

test("owned Google navigation failure never triggers hosted fallback", async () => {
  const f = fixture({ ownedGoogle: true, ownedNavigationFails: true });
  assert.ok(f.owned);
  assert.ok(f.hosted);
  await f.owned.props.onClick();
  assert.equal(f.count("hosted-start"), 0);
  assert.equal(f.count("cookie-probe"), 0);
  assert.equal(f.count("error"), 1);
});

test("an authority change during hosted provider work prevents redirect", async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const f = fixture({ start: () => pending });
  const action = f.hosted.props.onClick();
  for (let i = 0; i < 20 && !f.count("hosted-start"); i += 1)
    await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(f.count("hosted-start"), 1);
  f.browser.setKovaSessionActive(true);
  release({
    data: { url: "https://accounts.example.invalid/authorize" },
    error: null,
  });
  await action;
  assert.equal(f.count("navigate"), 0);
  assert.equal(f.browser.isKovaSessionActive(), true);
  assert.equal(f.count("error"), 1);
});

test("concurrent clicks initiate only one hosted provider operation", async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const f = fixture({ probe: () => pending });
  const first = f.hosted.props.onClick();
  await f.hosted.props.onClick();
  release(Response.json({ session: null }));
  await first;
  assert.equal(f.count("cookie-probe"), 1);
  assert.equal(f.count("hosted-start"), 1);
  assert.equal(f.count("navigate"), 1);
});

for (const [label, result] of [
  ["provider rejection", { data: null, error: new Error("provider_start_failed") }],
  ["missing redirect", { data: {}, error: null }],
])
  test(`${label} does not navigate or select owned fallback`, async () => {
    const f = fixture({ start: async () => result });
    await f.hosted.props.onClick();
    assert.equal(f.count("hosted-start"), 1);
    assert.equal(f.count("navigate"), 0);
    assert.equal(f.count("original-hosted-start"), 0);
    assert.equal(f.count("error"), 1);
  });
