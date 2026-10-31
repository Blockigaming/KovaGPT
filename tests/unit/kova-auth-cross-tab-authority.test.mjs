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
  let generation = 0;
  let legacyPending = false;
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
  modules["react/jsx-runtime"] = {
    jsx: (type, props, key) => ({ type, props, key }),
    jsxs: (type, props, key) => ({ type, props, key }),
  };
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
    clearKovaAuthCache: () => {
      generation += 1;
      calls.push("invalidate");
    },
    isKovaSessionActive: () => active || legacyPending,
    isLegacySessionValidationAllowed: () => !active,
    setLegacySessionValidationPending: (value) => {
      if (value && !legacyPending) generation += 1;
      legacyPending = value;
    },
    kovaAuthGeneration: () => generation,
    setKovaSessionActive: (value) => {
      if (active !== value) generation += 1;
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
      return active || legacyPending;
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
    assert.equal(f.tree.type.name, "SupabaseClerkProvider");
    assert.equal(f.tree.props.authorityPending, true);
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

for (const trigger of ["focus", "pageshow", "storage", "visibilitychange"]) {
  test(`${trigger}: an unchanged legacy authority resumes the same mounted task subtree`, async () => {
    const f = fixture();
    f.next().resolve(null);
    await f.flush();
    const provider = f.tree.type;
    const beforeRevision = f.tree.props.authorityRevision;
    const result = f.next();
    f.event(
      trigger,
      trigger === "storage" ? { key: "kova:auth-change", oldValue: "a", newValue: "b" } : {},
      trigger === "visibilitychange" ? f.document : f.window,
    );
    assert.equal(f.active, true);
    f.render();
    assert.equal(f.tree.type, provider);
    assert.equal(f.tree.props.children, "private-view");
    assert.equal(f.tree.props.authorityPending, true);
    assert.equal(f.tree.props.authorityRevision, beforeRevision + 1);
    result.resolve(null);
    await f.flush();
    assert.equal(f.active, true, "the hosted SDK still needs independent user/MFA validation");
    assert.equal(f.tree.props.legacyValidationRequired, true);
    f.tree.props.onAuthorityResolved(f.tree.props.authorityRevision);
    await f.flush();
    assert.equal(f.active, false);
    assert.equal(f.tree.type, provider, "React retains the task component's provider position");
    assert.equal(f.tree.props.authorityPending, false);
    assert.equal(f.tree.props.authorityRevision, beforeRevision + 1);
    f.unmount();
  });

  test(`${trigger}: unchanged owned authority keeps its stable principal key while re-probing`, async () => {
    const f = fixture();
    f.next().resolve(principal("owner"));
    await f.flush();
    const originalKey = f.tree.key;
    assert.equal(originalKey, "owner");
    const result = f.next();
    f.event(
      trigger,
      trigger === "storage" ? { key: "kova:auth-change", oldValue: "a", newValue: "b" } : {},
      trigger === "visibilitychange" ? f.document : f.window,
    );
    f.render();
    assert.equal(f.tree.key, originalKey);
    assert.equal(f.tree.props.value.isLoaded, true);
    assert.equal(f.tree.props.value.user.id, "owner");
    const content = f.nodes().find((node) => node.type === "div" && node.props.inert);
    assert.equal(content.props.style.display, "none", "old account controls are hidden");
    result.resolve(principal("owner"));
    await f.flush();
    assert.equal(f.tree.key, originalKey);
    assert.equal(f.tree.props.value.user.id, "owner");
    assert.equal(
      f.nodes().some((node) => node.props.inert),
      false,
    );
    f.unmount();
  });
}

test("an immediate same-legacy result still advances the rehydration revision", async () => {
  const f = fixture();
  f.next().resolve(null);
  await f.flush();
  const provider = f.tree.type;
  f.next().resolve(null);
  f.event("focus");
  // Deliberately do not render the intermediate pending state.
  await f.flush();
  assert.equal(f.tree.type, provider);
  assert.equal(f.tree.props.authorityPending, false);
  assert.equal(f.tree.props.authorityRevision, 1);
  f.unmount();
});

test("a stale hosted-validation callback cannot release a newer probe's fence", async () => {
  const f = fixture();
  f.next().resolve(null);
  await f.flush();
  f.next().resolve(null);
  f.event("focus");
  await f.flush();
  const old = f.tree.props;
  const current = f.next();
  f.event("pageshow");
  old.onAuthorityResolved(old.authorityRevision);
  f.render();
  assert.equal(f.active, true);
  assert.equal(f.tree.props.legacyValidationRequired, true);
  current.resolve(null);
  await f.flush();
  f.tree.props.onAuthorityFailed(f.tree.props.authorityRevision);
  await f.flush();
  assert.equal(f.active, true);
  assert.equal(f.tree.props.value.user, null);
  assert.equal(f.tree.props.value.isLoaded, false);
  f.unmount();
});

test("confirmed owned account changes and revocation replace the prior principal key", async () => {
  const f = fixture();
  f.next().resolve(principal("first-owner"));
  await f.flush();
  const changed = f.next();
  f.event("storage", { key: "kova:auth-change", oldValue: "a", newValue: "b" });
  changed.resolve(principal("second-owner"));
  await f.flush();
  assert.equal(f.tree.key, "second-owner");
  assert.equal(f.tree.props.value.user.id, "second-owner");
  const revoked = f.next();
  f.event("focus");
  revoked.reject(new Error("rejected"));
  await f.flush();
  assert.equal(f.tree.key, "guest");
  assert.equal(f.tree.props.value.user, null);
  assert.equal(f.tree.props.value.isLoaded, true);
  f.unmount();
});

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
  assert.equal(f.tree.type.name, "SupabaseClerkProvider");
  assert.equal(f.tree.props.authorityPending, true);
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
