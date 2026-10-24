import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { readKovaRecoveryLanding } from "../../src/lib/kova-recovery-landing.mjs";
import {
  classifyKovaRecoveryResetResponse,
  KOVA_RECOVERY_UNCONFIRMED_MESSAGE,
} from "../../src/lib/kova-recovery-result.mjs";

const compiled = ts.transpileModule(
  readFileSync(new URL("../../src/routes/reset-password.tsx", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  },
).outputText;
const password = "fixture-new-password";
const token = "T".repeat(43);
const confirmedPrincipal = {
  accountId: "12345678-1234-1234-1234-123456789abc",
  sessionId: "23456789-1234-1234-1234-123456789abc",
  email: "fixture@example.test",
  emailVerified: true,
  assuranceLevel: "aal1",
  displayName: null,
  expiresAt: "2026-10-19T23:00:00Z",
};
const success = () => Response.json({ session: confirmedPrincipal });
const element = (type, props) => ({ type, props: props ?? {} });
const all = (node, predicate) => {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((child) => all(child, predicate));
  return [...(predicate(node) ? [node] : []), ...all(node.props?.children, predicate)];
};

// Execute the actual TSX component with deterministic hooks/JSX/router seams.
// This verifies callback/state behavior, not React rendering or browser acceptance.
function page(transport) {
  let hookIndex = 0,
    tree;
  const hooks = [],
    effects = [],
    calls = [],
    messages = [],
    navigation = [],
    logs = [];
  const location = {
    href: `https://app.example.test/reset-password#token=${token}`,
    replace: (path) => navigation.push(path),
  };
  const state = (initial) => {
    const index = hookIndex++;
    if (!Object.hasOwn(hooks, index)) hooks[index] = initial;
    return [
      hooks[index],
      (next) => {
        hooks[index] = typeof next === "function" ? next(hooks[index]) : next;
      },
    ];
  };
  const modules = {
    "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "Fragment" },
    react: {
      useState: state,
      useRef: (initial) => {
        const index = hookIndex++;
        return (hooks[index] ??= { current: initial });
      },
      useEffect: (effect) => {
        const index = hookIndex++;
        if (!Object.hasOwn(hooks, index)) {
          hooks[index] = true;
          effects.push(effect);
        }
      },
    },
    "@tanstack/react-router": {
      createFileRoute: () => (route) => route,
      useNavigate: () => (path) => navigation.push(path),
    },
    "@/integrations/supabase/client": {
      getSupabaseClientConfigStatus: () => ({ configured: false }),
      resolveLegacyAuthContext: () => {
        throw new Error("Unexpected legacy provider");
      },
    },
    "@/components/ui/input": { Input: "Input" },
    "@/components/ui/label": { Label: "Label" },
    "@/components/ui/button": { Button: "Button" },
    "@/components/NovaLogo": { NovaLogo: "NovaLogo" },
    "lucide-react": { Loader2: "Loader2", KeyRound: "KeyRound" },
    sonner: {
      toast: {
        error: (message) => messages.push(["error", message]),
        success: (message) => messages.push(["success", message]),
        warning: (message) => messages.push(["warning", message]),
      },
    },
    "@/lib/oauth-session": {
      clearPasswordRecoveryFlow: () => {},
      markPasswordRecoveryFlow: () => {},
      completeOAuthSessionFromUrl: () => {
        throw new Error("Unexpected legacy exchange");
      },
      clearOAuthResponseFromUrl: () => {},
    },
    "@/lib/kova-auth-browser": {
      browserKovaAuthEnabled: () => true,
      browserKovaAuthMode: () => "kova",
      kovaPublicAuthJson: async (path, body) => {
        calls.push([path, { ...body }]);
        return transport(path, body);
      },
    },
    "@/lib/kova-recovery-landing.mjs": { readKovaRecoveryLanding },
    "@/lib/kova-recovery-result.mjs": {
      classifyKovaRecoveryResetResponse,
      KOVA_RECOVERY_UNCONFIRMED_MESSAGE,
    },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    Response,
    URL,
    URLSearchParams,
    AbortController,
    window: {
      location,
      history: {
        replaceState: (_state, _title, path) => {
          location.href = new URL(path, "https://app.example.test").href;
        },
      },
      setTimeout,
      clearTimeout,
      localStorage: new Proxy(
        {},
        {
          get: () => {
            throw new Error("Password flow must not access persistent storage");
          },
        },
      ),
      sessionStorage: new Proxy(
        {},
        {
          get: () => {
            throw new Error("Password flow must not access persistent storage");
          },
        },
      ),
    },
    document: { title: "KovaGPT Password" },
    console: { error: (...args) => logs.push(args) },
    require: (name) => {
      assert.ok(Object.hasOwn(modules, name), name);
      return modules[name];
    },
  });
  const cleanups = [];
  const render = () => {
    hookIndex = 0;
    tree = exports.Route.component();
    while (effects.length) cleanups.push(effects.shift()());
    return tree;
  };
  const inputs = () => all(tree, (node) => node.type === "Input");
  const fill = () => {
    for (const input of inputs()) input.props.onChange({ target: { value: password } });
    render();
  };
  const submit = () =>
    all(tree, (node) => node.type === "form")[0].props.onSubmit({
      preventDefault: () => {},
    });
  render();
  render();
  fill();
  return {
    render,
    inputs,
    submit,
    calls,
    messages,
    navigation,
    logs,
    location,
    notice: () => all(tree, (node) => node.props?.role === "status")[0]?.props.children,
    unmount: () => {
      for (const cleanup of cleanups) if (typeof cleanup === "function") cleanup();
    },
  };
}

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

test("a503 keeps the in-memory draft, explains ambiguous completion and performs no automatic retry", async () => {
  let finish;
  const app = page(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  assert.equal(app.location.href.includes(token), false);
  const submitted = app.submit();
  app.render();
  assert.ok(app.inputs().every((input) => input.props.disabled === true));
  finish(Response.json({ error: "fixture private diagnostics" }, { status: 503 }));
  await submitted;
  app.render();
  assert.ok(app.inputs().every((input) => input.props.value === password));
  assert.equal(app.calls.length, 1);
  assert.match(app.messages.at(-1)[1], /may have completed/);
  assert.match(app.messages.at(-1)[1], /signing in with your new password/);
  assert.equal(app.navigation.length, 0);
  assert.equal(JSON.stringify(app.logs).includes(password), false);
  app.messages.length = 0;
  assert.match(app.notice(), /may have completed/);
  assert.equal(JSON.stringify(app.messages).includes("fixture private diagnostics"), false);
});

test("lost network reply or malformed success preserves the draft without claiming the reset failed or replaying", async () => {
  for (const transport of [
    async () => {
      throw new Error("fixture secret interrupted response");
    },
    async () => Response.json({ session: null }),
    async () => Response.json({ session: { accountId: "x", emailVerified: true } }),
  ]) {
    const app = page(transport);
    await app.submit();
    app.render();
    assert.ok(app.inputs().every((input) => input.props.value === password));
    assert.equal(app.calls.length, 1);
    assert.equal(app.navigation.length, 0);
    assert.match(app.messages.at(-1)[1], /may have completed/);
    assert.doesNotMatch(JSON.stringify(app.logs), /fixture secret/);
  }
});

test("an explicit same-token retry after throttling succeeds once and clears drafts on confirmed success", async () => {
  let attempts = 0;
  const app = page(async () => (++attempts === 1 ? Response.json({}, { status: 429 }) : success()));
  await app.submit();
  app.render();
  assert.equal(app.calls.length, 1);
  assert.ok(app.inputs().every((input) => input.props.value === password));
  assert.match(app.messages.at(-1)[1], /Wait before retrying/);
  await app.submit();
  app.render();
  assert.equal(app.calls.length, 2);
  assert.equal(app.calls[0][1].token, app.calls[1][1].token);
  assert.ok(app.inputs().every((input) => input.props.value === ""));
  assert.deepEqual(app.navigation, ["/"]);
  assert.equal(app.messages.at(-1)[0], "success");
});

test("terminal invalid-link response clears drafts and does not redirect or echo server diagnostics", async () => {
  const app = page(async () => Response.json({ error: "fixture secret" }, { status: 400 }));
  await app.submit();
  app.render();
  assert.ok(app.inputs().every((input) => input.props.value === ""));
  assert.equal(app.calls.length, 1);
  assert.equal(app.navigation.length, 0);
  assert.match(app.messages.at(-1)[1], /already used or expired/);
  assert.equal(JSON.stringify(app.messages).includes("fixture secret"), false);
});

test("unmount during a request prevents later UI messages or navigation and does not replay", async () => {
  let finish;
  const app = page(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const submitted = app.submit();
  app.unmount();
  finish(success());
  await submitted;
  assert.equal(app.messages.length, 0);
  assert.equal(app.navigation.length, 0);
  assert.equal(app.calls.length, 1);
});
