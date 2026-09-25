import assert from "node:assert/strict";
import test from "node:test";
import { reactFixture } from "../helpers/kova-react-fixture.mjs";

const key = {
  id: "10000000-0000-4000-8000-000000000001",
  friendlyName: "Laptop",
  createdAt: "2026-09-21T12:00Z",
  lastUsedAt: null,
};
const captured = { accountId: "owner", sessionId: "session" };
function panel(options = {}) {
  const calls = [];
  let current = options.capturedPrincipal ?? captured;
  let sessionRevision = 0;
  let rotated = false;
  const invoke = async (name, ...args) => {
    calls.push([name, ...JSON.parse(JSON.stringify(args))]);
    if (options.hold) await options.hold;
    if (options.fail) throw Error("upstream secrets");
    if (name === "register" || name === "remove") {
      current = null;
      rotated = true;
    }
  };
  const status = {
    passkeys: options.keys ?? [],
    requiresPassword: true,
    canRegister: true,
    canRemove: false,
    ...options.status,
  };
  const f = reactFixture("src/components/KovaPasskeyPanel.tsx", (exp) => exp.KovaPasskeyPanel, {
    modules: {
      "@/components/auth/ClerkSafe": {
        useUser: () => ({ user: { id: options.displayedAccount ?? "owner" } }),
      },
      "@/lib/kova-auth-browser": {
        getCapturedKovaPrincipal: () => current,
        clearKovaAuthCache: () => {
          current = null;
        },
        fetchKovaSession: async () => {
          calls.push(["SESSION"]);
          if (rotated) sessionRevision++;
          current = options.switchOnRefresh
            ? { accountId: "other", sessionId: `session-other-${sessionRevision}` }
            : {
                accountId: "owner",
                sessionId: rotated
                  ? `session-rotated-${sessionRevision}`
                  : (current?.sessionId ?? "session"),
              };
          rotated = false;
          return current;
        },
      },
      "@/lib/passkey-support": { browserSupportsPasskeys: () => options.supported !== false },
      "@/lib/kova-auth-passkey-browser": {
        registerKovaPasskey: (...a) => invoke("register", ...a),
        renameKovaPasskey: (...a) => invoke("rename", ...a),
        removeKovaPasskey: (...a) => invoke("remove", ...a),
      },
    },
    globals: {
      fetch: async (path, init) => {
        calls.push(["GET", path, JSON.parse(JSON.stringify(init.headers))]);
        return Response.json(options.badPayload ? {} : status, {
          status: options.loadFailure ? 503 : 200,
        });
      },
    },
  });
  return { ...f, requests: calls };
}
test("owned panel registers with explicit password confirmation and clears plaintext on success/cancel/error", async () => {
  for (const fail of [false, true]) {
    const f = panel({ fail });
    await f.flush();
    await f.click("Add passkey");
    await f.input("kova-passkey-password", "local test password");
    await f.input("kova-passkey-name", "Phone");
    await f.submit();
    await f.flush();
    assert.deepEqual(
      f.requests.find((c) => c[0] === "register"),
      ["register", { friendlyName: "Phone", currentPassword: "local test password" }, captured],
    );
    assert.equal(f.messages.at(-1)[0], fail ? "error" : "success");
    assert.ok(!JSON.stringify(f.messages).includes("upstream secrets"));
    assert.ok(
      f
        .nodes()
        .filter((n) => n.type === "input" && n.props.type === "password")
        .every((n) => n.props.value === ""),
    );
  }
  const f = panel();
  await f.flush();
  await f.click("Add passkey");
  await f.input("kova-passkey-password", "discard");
  await f.click("Cancel");
  await f.click("Add passkey");
  assert.equal(f.find("input", (n) => n.props.type === "password").props.value, "");
  assert.ok(!f.requests.some((c) => c[0] === "register"));
});
test("AAL2 panel adds without a password and cannot duplicate an in-flight device ceremony", async () => {
  let release;
  const hold = new Promise((r) => {
    release = r;
  });
  const f = panel({ hold, status: { requiresPassword: false, canRemove: true } });
  await f.flush();
  await f.click("Add passkey");
  assert.ok(!f.nodes().some((n) => n.type === "input" && n.props.type === "password"));
  const first = f.submit(),
    second = f.submit();
  await f.flush();
  assert.equal(f.requests.filter((c) => c[0] === "register").length, 1);
  assert.ok(
    f
      .nodes()
      .filter((n) => n.type === "button" || n.type === "input")
      .every((n) => n.props.disabled),
  );
  release();
  await Promise.all([first, second]);
  await f.flush();
  assert.deepEqual(
    f.requests.find((c) => c[0] === "register"),
    ["register", { friendlyName: "Passkey" }, captured],
  );
});
test("rename and removal use owned key IDs, require confirmation, and respect server assurance", async () => {
  const f = panel({ keys: [key], status: { canRemove: true, requiresPassword: false } });
  await f.flush();
  await f.click("Rename Laptop");
  await f.input("kova-passkey-name", "New name");
  await f.submit();
  await f.flush();
  assert.deepEqual(
    f.requests.find((c) => c[0] === "rename"),
    ["rename", key.id, "New name", captured],
  );
  await f.click("Remove Laptop");
  assert.ok(!f.requests.some((c) => c[0] === "remove"));
  await f.click("Cancel");
  assert.ok(!f.requests.some((c) => c[0] === "remove"));
  await f.click("Remove Laptop");
  await f.click("Confirm removal");
  assert.deepEqual(
    f.requests.find((c) => c[0] === "remove"),
    ["remove", key.id, captured],
  );
  const weak = panel({ keys: [key] });
  await weak.flush();
  assert.equal(
    weak.find("button", (n) => n.props["aria-label"] === "Remove Laptop").props.disabled,
    true,
  );
});
test("passkey panel never loads another cookie owner into the displayed account", async () => {
  const wrongOwner = panel({ capturedPrincipal: { ...captured, accountId: "other" } });
  await wrongOwner.flush();
  assert.ok(!wrongOwner.requests.some(([kind]) => kind === "GET"));
  assert.equal(wrongOwner.find("div", (n) => n.props.role === "alert").props.role, "alert");
  const f = panel({ keys: [key] });
  await f.flush();
  assert.deepEqual(f.requests[0], [
    "GET",
    "/api/auth/passkeys",
    { Accept: "application/json", "X-Kova-Owner": "owner", "X-Kova-Session": "session" },
  ]);
});
test("a rotating passkey mutation reloads the captured owner before the panel lists keys", async () => {
  const f = panel({
    rotate: true,
    keys: [key],
    status: { canRemove: true, requiresPassword: false },
  });
  await f.flush();
  await f.click("Add passkey");
  await f.submit();
  await f.flush();
  assert.equal(f.messages.at(-1)[0], "success");
  assert.ok(!f.nodes().some((node) => node.props.role === "alert"));
  assert.equal(
    f.requests.filter(([kind]) => kind === "GET").at(-1)[2]["X-Kova-Session"],
    "session-rotated-1",
  );
  await f.click("Remove Laptop");
  await f.click("Confirm removal");
  assert.equal(f.messages.at(-1)[0], "success");
  assert.equal(
    f.requests.filter(([kind]) => kind === "GET").at(-1)[2]["X-Kova-Session"],
    "session-rotated-2",
  );
});
test("a different cookie owner cannot be refreshed into the stale passkey panel", async () => {
  const f = panel({ switchOnRefresh: true, keys: [key] });
  await f.flush();
  await f.click("Rename Laptop");
  await f.input("kova-passkey-name", "New name");
  await f.submit();
  await f.flush();
  assert.equal(f.messages.at(-1)[0], "error");
  assert.equal(f.requests.filter(([kind]) => kind === "GET").length, 1);
  assert.equal(f.find("div", (node) => node.props.role === "alert").props.role, "alert");
});
test("load errors, invalid payloads, limits, unsupported devices and missing reauthentication do not show usable registration", async () => {
  for (const options of [
    { badPayload: true },
    { loadFailure: true },
    { status: { canRegister: false } },
    { keys: Array.from({ length: 10 }, (_, i) => ({ ...key, id: String(i) })) },
    { supported: false },
  ]) {
    const f = panel(options);
    await f.flush();
    assert.ok(
      !f
        .nodes()
        .some(
          (n) => n.type === "button" && n.props.children === "Add passkey" && !n.props.disabled,
        ),
    );
    assert.ok(!f.requests.some((c) => c[0] === "register"));
  }
});

function loginSurface(dialog, options = {}) {
  const events = [];
  const owned = options.owned !== false;
  const modules = {
    "@/lib/kova-auth-browser": {
      browserKovaAuthEnabled: () => owned,
      browserKovaAuthOrigin: () => "https://kova.test",
      kovaAuthJson: () => {
        throw Error("Unexpected password request");
      },
      kovaPublicAuthJson: () => {
        throw Error("Unexpected password request");
      },
    },
    "@/lib/kova-auth-passkey-browser": {
      signInWithKovaPasskey: async () => {
        events.push("owned");
        if (options.hold) await options.hold;
        if (options.fail) throw Error("sensitive exception");
      },
    },
    "@/lib/passkey-support": { browserSupportsPasskeys: () => options.supported !== false },
    "@/integrations/supabase/client": {
      supabase: {
        auth: {
          signInWithPasskey: async () => {
            events.push("legacy");
            return {};
          },
        },
      },
    },
    "@/lib/oauth-session": {
      getSafePostAuthRedirect: () => "/library",
      rememberPostAuthRedirect: () => {},
    },
    "@/lib/utils": { cn: (...args) => args.filter(Boolean).join(" ") },
    "@/components/NovaLogo": { NovaLogo: "logo" },
    "@/components/auth/ForgotPasswordDialog": { ForgotPasswordDialog: "forgot" },
    "@/hooks/useAuthProviders": {
      useAuthProviders: () => ({ resolved: !owned, passkeys: !owned, google: false }),
    },
    "@/lib/auth-providers": { GOOGLE_UNCONFIGURED_MESSAGE: "Google sign-in unavailable" },
    "@/components/ui/dialog": {
      Dialog: "dialog",
      DialogContent: "dialog-content",
      DialogDescription: "description",
      DialogTitle: "title",
    },
    "@tanstack/react-router": {
      useNavigate: () => () => {},
      useSearch: () => ({ email: "synthetic@example.invalid", mode: "sign-in" }),
      createFileRoute: () => (config) => config,
      redirect: () => {},
    },
  };
  const f = reactFixture(
    dialog ? "src/components/auth/AuthDialog.tsx" : "src/routes/auth.tsx",
    (exp) =>
      dialog
        ? () => exp.AuthDialog({ open: true, mode: "sign-in", onOpenChange: () => {} })
        : exp.Route.component,
    {
      modules,
      globals: {
        window: {
          location: { reload: () => events.push("reload"), replace: (path) => events.push(path) },
        },
      },
    },
  );
  return { ...f, events };
}
test("both owned sign-in surfaces use WebAuthn without a Supabase fallback and block duplicate clicks", async () => {
  for (const dialog of [false, true]) {
    let release;
    const hold = new Promise((r) => {
      release = r;
    });
    const f = loginSurface(dialog, { hold });
    await f.flush();
    const button = f.find(
      "button",
      (n) =>
        n.props.children === "Continue with a passkey" ||
        (Array.isArray(n.props.children) && n.props.children.includes("Continue with a passkey")),
    );
    const first = button.props.onClick(),
      second = button.props.onClick();
    await f.flush();
    assert.deepEqual(f.events, ["owned"]);
    release();
    await Promise.all([first, second]);
    await f.flush();
    assert.deepEqual(f.events, ["owned", dialog ? "reload" : "/library"]);
  }
});
test("passkey cancellation keeps both login surfaces open and never falls back or leaks provider text", async () => {
  for (const dialog of [false, true]) {
    const f = loginSurface(dialog, { fail: true });
    await f.flush();
    await f.click("Continue with a passkey");
    assert.deepEqual(f.events, ["owned"]);
    assert.equal(f.messages.at(-1)[0], "error");
    assert.ok(!JSON.stringify(f.messages).includes("sensitive exception"));
  }
});

test("passkey capability appears only after hydration and the legacy dialog retains its own provider", async () => {
  for (const dialog of [false, true]) {
    const f = loginSurface(dialog);
    f.render();
    assert.ok(!f.text().includes("Continue with a passkey"));
    await f.flush();
    assert.ok(f.text().includes("Continue with a passkey"));
    const unsupported = loginSurface(dialog, { supported: false });
    await unsupported.flush();
    assert.ok(!unsupported.text().includes("Continue with a passkey"));
  }
  const legacy = loginSurface(true, { owned: false });
  await legacy.flush();
  await legacy.click("Continue with a passkey");
  assert.deepEqual(legacy.events, ["legacy"]);
});
