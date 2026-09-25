import assert from "node:assert/strict";
import test from "node:test";
import { reactFixture } from "../helpers/kova-react-fixture.mjs";

const pending = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const principal = (accountId) => ({
  accountId,
  sessionId: `${accountId}-session`,
  email: `${accountId}@example.invalid`,
  displayName: accountId,
  emailVerified: true,
  assuranceLevel: "aal1",
  expiresAt: "2026-10-01T00:00:00Z",
});
function fixture() {
  const window = new EventTarget();
  window.location = new URL("https://kova.test/");
  const document = new EventTarget();
  document.visibilityState = "visible";
  const queue = [],
    calls = [];
  let active = true;
  const modules = Object.fromEntries(
    [
      "@/integrations/supabase/client",
      "@/components/auth/AuthDialog",
      "@/components/auth/MfaChallengeDialog",
      "@/components/LogoutConfirmDialog",
      "@/lib/oauth-session",
      "@/lib/auth-validation-policy.mjs",
      "@/components/ui/dropdown-menu",
    ].map((name) => [name, {}]),
  );
  modules["@/lib/principal-browser-storage.mjs"] = {
    purgeUnscopedPrivateBrowserStorage: () => ({
      local: { failures: [] },
      session: { failures: [] },
    }),
    dispatchPrincipalBrowserStorageCleared: () => {},
  };
  modules["@/lib/kova-auth-browser"] = {
    KOVA_AUTH_CHANGE_KEY: "kova:auth-change",
    browserKovaAuthMode: () => "dual",
    resolveKovaSessionAuthority: () => {
      calls.push("probe");
      const next = queue.shift();
      assert.ok(next, "every probe has an explicit result");
      return next.promise;
    },
    clearKovaAuthCache: () => calls.push("invalidate"),
    setKovaSessionActive: (value) => {
      active = value;
      calls.push(value ? "owned" : "legacy");
    },
    announceKovaAuthChange: () => calls.push("announce"),
    isKovaSessionRejectedError: (error) => error.message === "rejected",
  };
  const h = reactFixture(
    "src/components/auth/ClerkSafe.tsx",
    (m) => () => m.TestKovaProvider({ children: "private-view", allowLegacyFallback: true }),
    {
      sourceSuffix: "\nexport { KovaClerkProvider as TestKovaProvider };",
      modules,
      globals: { window, document, URLSearchParams, console: { error() {}, warn() {} } },
    },
  );
  return {
    ...h,
    window,
    document,
    calls,
    get active() {
      return active;
    },
    get tree() {
      return h.tree;
    },
    next() {
      const value = pending();
      queue.push(value);
      return value;
    },
    event(type, values = {}, target = window) {
      const event = new Event(type);
      for (const [key, value] of Object.entries(values))
        Object.defineProperty(event, key, { value });
      target.dispatchEvent(event);
    },
  };
}

for (const trigger of ["focus", "pageshow", "storage", "visibilitychange"]) {
  test(`${trigger}: a dual-mode legacy tab is fenced immediately and adopts only the freshly verified owned account`, async () => {
    const f = fixture();
    f.next().resolve(null);
    await f.flush();
    assert.equal(f.tree.type.name, "SupabaseClerkProvider");
    assert.equal(f.active, false);
    const result = f.next();
    f.event(
      trigger,
      trigger === "storage"
        ? { key: "kova:auth-change", oldValue: "old", newValue: "not-an-account-claim" }
        : {},
      trigger === "visibilitychange" ? f.document : f.window,
    );
    assert.equal(f.active, true, "legacy dispatch is disabled before the probe completes");
    f.render();
    assert.equal(f.tree.type, "context-provider");
    assert.equal(f.tree.props.value.isLoaded, false);
    assert.equal(f.tree.props.value.user, null);
    result.resolve(principal("new-owner"));
    await f.flush();
    assert.equal(f.tree.props.value.user.id, "new-owner");
    assert.equal(f.tree.props.value.isLoaded, true);
    assert.equal(
      f.calls.filter((v) => v === "announce").length,
      1,
      "refreshes do not cause broadcast loops",
    );
    f.unmount();
  });
}

test("rapid changes discard an older result and coalesce into one authoritative follow-up probe", async () => {
  const f = fixture();
  f.next().resolve(null);
  await f.flush();
  const stale = f.next();
  f.event("focus");
  const current = f.next();
  f.event("pageshow");
  f.event("storage", { key: "kova:auth-change", oldValue: "a", newValue: "b" });
  stale.resolve(principal("stale-owner"));
  await f.flush();
  assert.equal(f.tree.props.value.user, null);
  assert.equal(f.calls.filter((v) => v === "probe").length, 3);
  current.resolve(principal("current-owner"));
  await f.flush();
  assert.equal(f.tree.props.value.user.id, "current-owner");
  f.unmount();
});

for (const failure of ["unavailable", "rejected"]) {
  test(`${failure}: re-probe cannot restore the old legacy authority`, async () => {
    const f = fixture();
    f.next().resolve(null);
    await f.flush();
    const result = f.next();
    f.event("focus");
    result.reject(new Error(failure));
    await f.flush();
    assert.equal(f.active, true);
    assert.equal(f.tree.type, "context-provider");
    assert.equal(f.tree.props.value.user, null);
    assert.equal(f.tree.props.value.isLoaded, failure === "rejected");
    f.unmount();
  });
}

test("unrelated storage and hidden visibility are ignored, and unmount removes every observer and late publication", async () => {
  const f = fixture();
  f.next().resolve(principal("initial"));
  await f.flush();
  f.event("storage", { key: "unrelated", oldValue: "a", newValue: "b" });
  f.document.visibilityState = "hidden";
  f.event("visibilitychange", {}, f.document);
  assert.equal(f.calls.filter((v) => v === "probe").length, 1);
  const late = f.next();
  f.event("focus");
  f.unmount();
  const count = f.calls.length;
  late.resolve(principal("late-owner"));
  f.event("focus");
  f.event("pageshow");
  f.event("storage", { key: "kova:auth-change", oldValue: "a", newValue: "b" });
  await new Promise((r) => setImmediate(r));
  assert.equal(f.calls.length, count);
});
