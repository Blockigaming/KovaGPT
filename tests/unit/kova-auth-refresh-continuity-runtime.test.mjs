import assert from "node:assert/strict";
import test from "node:test";
import { reactFixture } from "../helpers/kova-react-fixture.mjs";
import * as validationPolicy from "../../src/lib/auth-validation-policy.mjs";

const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
const session = (id) => ({ access_token: `${id}-token`, user: { id } });

function fixture() {
  const calls = [],
    timers = [];
  const window = {
    location: new URL("https://kova.test/"),
    setTimeout: (callback) => timers.push(callback),
  };
  let active = false,
    generation = 0,
    pending = false,
    validationRequired = false,
    revision = 0;
  let currentSession = session("first-owner"),
    listener;
  const users = [],
    assurances = [];
  const auth = {
    getSession: async () => {
      calls.push("get-session");
      return { data: { session: currentSession }, error: null };
    },
    getUser: async (token) => {
      calls.push(["get-user", token]);
      const result = users.shift();
      if (result) return result.promise;
      return { data: { user: { id: token.slice(0, -6) } }, error: null };
    },
    onAuthStateChange: (callback) => {
      listener = callback;
      calls.push("subscribe");
      return { data: { subscription: { unsubscribe: () => calls.push("unsubscribe") } } };
    },
    signOut: async () => {
      calls.push("sign-out");
      return { error: null };
    },
    mfa: {
      getAuthenticatorAssuranceLevel: async () =>
        assurances.shift()?.promise ?? {
          data: { currentLevel: "aal1", nextLevel: "aal1" },
          error: null,
        },
    },
  };
  const modules = {
    "react/jsx-runtime": {
      jsx: (type, props, key) => ({ type, props, key }),
      jsxs: (type, props, key) => ({ type, props, key }),
    },
    "@/integrations/supabase/client": {
      supabase: { auth },
      getSupabaseClientConfigStatus: () => ({ configured: true }),
      getLegacyAuthValidationClient: () => {
        assert.equal(active, false);
        return {
          getSession: auth.getSession,
          getUser: auth.getUser,
          getAuthenticatorAssuranceLevel: auth.mfa.getAuthenticatorAssuranceLevel,
          onAuthStateChange: auth.onAuthStateChange,
          signOut: auth.signOut,
        };
      },
    },
    "@/components/auth/AuthDialog": {},
    "@/components/auth/MfaChallengeDialog": {},
    "@/components/LogoutConfirmDialog": {},
    "@/components/ui/dropdown-menu": {},
    "@/lib/oauth-session": { hasOAuthResponseInUrl: () => false },
    "@/lib/auth-validation-policy.mjs": validationPolicy,
    "@/lib/principal-browser-storage.mjs": {
      clearPrincipalBrowserStorage: (id) => {
        calls.push(["clear", id]);
        return { local: { failures: [] }, session: { failures: [] } };
      },
      purgeUnscopedPrivateBrowserStorage: (id) => {
        calls.push(["purge", id]);
        return { local: { failures: [] }, session: { failures: [] } };
      },
      dispatchPrincipalBrowserStorageCleared: () => {},
    },
    "@/lib/kova-auth-browser": {
      isKovaSessionActive: () => active || validationRequired,
      isLegacySessionValidationAllowed: () => !active,
      kovaAuthGeneration: () => generation,
    },
  };
  const resolved = (value) => {
    assert.equal(value, revision);
    validationRequired = false;
    calls.push("authority-resolved");
  };
  const failed = (value) => {
    assert.equal(value, revision);
    calls.push("authority-failed");
  };
  const h = reactFixture(
    "src/components/auth/ClerkSafe.tsx",
    (m) => () =>
      m.TestLegacyProvider({
        children: "running-task",
        authorityPending: pending,
        authorityRevision: revision,
        legacyValidationRequired: validationRequired,
        onAuthorityResolved: resolved,
        onAuthorityFailed: failed,
      }),
    {
      sourceSuffix: "\nexport { SupabaseClerkProvider as TestLegacyProvider };",
      modules,
      globals: {
        window,
        document: {},
        URLSearchParams,
        AbortController,
        console: { error() {}, warn() {} },
      },
    },
  );
  return {
    ...h,
    calls,
    modules,
    get tree() {
      return h.tree;
    },
    get dispatchAllowed() {
      return !active && !validationRequired;
    },
    setSession(value) {
      currentSession = value;
    },
    nextUser() {
      const value = deferred();
      users.push(value);
      return value;
    },
    nextAssurance() {
      const value = deferred();
      assurances.push(value);
      return value;
    },
    event(value) {
      listener("SIGNED_IN", value);
    },
    runTimers() {
      for (const callback of timers.splice(0)) callback();
    },
    fence() {
      active = true;
      generation += 1;
      pending = true;
      validationRequired = true;
      revision += 1;
    },
    resume() {
      active = false;
      generation += 1;
      pending = false;
    },
    restart() {
      revision += 1;
    },
  };
}

test("a pending authority probe hides controls without changing the validated legacy principal or task subtree", async () => {
  const f = fixture();
  await f.flush();
  assert.equal(f.tree.props.value.user.id, "first-owner");
  assert.equal(f.tree.key, "first-owner");
  const before = f.calls.length;
  f.fence();
  await f.flush();
  assert.equal(f.tree.props.value.isLoaded, true);
  assert.equal(f.tree.props.value.user.id, "first-owner");
  assert.equal(f.tree.key, "first-owner");
  const content = f.nodes().find((node) => node.props.inert);
  assert.equal(content.props.style.display, "none");
  assert.equal(content.props.children, "running-task");
  assert.equal(f.calls.slice(before).includes("unsubscribe"), true);
  assert.equal(f.calls.slice(before).includes("get-session"), false);
  f.resume();
  await f.flush();
  assert.equal(f.tree.props.value.user.id, "first-owner");
  assert.equal(f.tree.props.value.isLoaded, true);
  assert.equal(
    f.nodes().some((node) => node.props.inert),
    false,
  );
  assert.equal(
    f.calls.some((call) => Array.isArray(call) && call[0] === "clear"),
    false,
  );
  f.unmount();
});

test("a pre-fence validation cannot publish or clean storage after legacy authority reopens", async () => {
  const f = fixture();
  const stale = f.nextUser();
  await f.flush();
  f.fence();
  f.resume();
  // Never render pending=true: this exercises React's batched fast-probe case.
  f.setSession(session("current-owner"));
  await f.flush();
  assert.equal(f.tree.props.value.user.id, "current-owner");
  const before = f.calls.length;
  stale.resolve({ data: { user: null }, error: { status: 401 } });
  await f.flush();
  assert.equal(f.tree.props.value.user.id, "current-owner");
  assert.equal(f.calls.length, before, "stale terminal evidence cannot trigger cleanup or logout");
  f.unmount();
});

test("an old queued auth event cannot overwrite the freshly hydrated account after a fast probe", async () => {
  const f = fixture();
  await f.flush();
  f.event(session("stale-event-owner"));
  f.fence();
  f.resume();
  f.setSession(session("new-owner"));
  await f.flush();
  f.runTimers();
  await f.flush();
  assert.equal(f.tree.props.value.user.id, "new-owner");
  assert.equal(f.tree.key, "new-owner", "confirmed owner change remounts private child state");
  assert.equal(
    f.calls.some((call) => Array.isArray(call) && call[1] === "stale-event-owner-token"),
    false,
  );
  assert.equal(
    f.calls.some((call) => Array.isArray(call) && call[0] === "clear" && call[1] === "first-owner"),
    true,
  );
  f.unmount();
});

test("a genuine sign-out observed after re-probing clears the former account and resolves guest", async () => {
  const f = fixture();
  await f.flush();
  f.fence();
  await f.flush();
  f.setSession(null);
  f.resume();
  await f.flush();
  assert.equal(f.tree.props.value.user, null);
  assert.equal(f.tree.key, "guest", "the old owner's child state cannot reappear after logout");
  assert.equal(f.tree.props.value.isLoaded, true);
  assert.equal(
    f.calls.some((call) => Array.isArray(call) && call[0] === "clear" && call[1] === "first-owner"),
    true,
  );
  f.unmount();
});

test("current terminal validation still cleans storage and signs out", async () => {
  const f = fixture();
  await f.flush();
  const rejected = f.nextUser();
  f.event(session("first-owner"));
  f.runTimers();
  rejected.resolve({ data: { user: null }, error: { status: 401 } });
  await f.flush();
  assert.equal(f.tree.props.value.user, null);
  assert.equal(f.tree.props.value.isLoaded, true);
  assert.equal(f.calls.includes("sign-out"), true);
  f.unmount();
});

for (const nextOwner of ["first-owner", "second-owner"]) {
  for (const boundary of ["user", "MFA"]) {
    test(`old controls and dispatch stay fenced until deferred ${boundary} confirms ${nextOwner}`, async () => {
      const f = fixture();
      await f.flush();
      f.fence();
      await f.flush();
      f.setSession(session(nextOwner));
      const verification = boundary === "user" ? f.nextUser() : f.nextAssurance();
      f.resume();
      await f.flush();
      assert.equal(f.dispatchAllowed, false, "a null owned-cookie probe cannot reopen dispatch");
      assert.equal(
        f.nodes().some((node) => node.props.inert),
        true,
      );
      assert.equal(
        f.nodes().find((node) => node.type?.name === "AuthAuthorityGate").props.pending,
        true,
      );
      if (nextOwner === "first-owner") {
        assert.equal(f.tree.key, "first-owner", "same-owner task effects remain mounted");
        assert.equal(f.tree.props.value.isLoaded, true);
      } else {
        assert.equal(f.tree.props.value.user, null, "the former owner cannot remain actionable");
      }
      verification.resolve(
        boundary === "user"
          ? { data: { user: { id: nextOwner } }, error: null }
          : { data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null },
      );
      await f.flush();
      assert.equal(f.dispatchAllowed, true);
      assert.equal(f.tree.key, nextOwner);
      assert.equal(f.tree.props.value.user.id, nextOwner);
      assert.equal(
        f.nodes().some((node) => node.props.inert),
        false,
      );
      f.unmount();
    });
  }
}

test("a retryable hosted validation error never reopens the old account's dispatch", async () => {
  const f = fixture();
  await f.flush();
  f.fence();
  await f.flush();
  const verification = f.nextUser();
  f.resume();
  await f.flush();
  verification.resolve({ data: { user: null }, error: { status: 503 } });
  await f.flush();
  assert.equal(f.calls.includes("authority-failed"), true);
  assert.equal(f.dispatchAllowed, false);
  assert.equal(
    f.nodes().some((node) => node.props.inert),
    true,
  );
  f.unmount();
});

for (const transition of ["unmount", "effect replacement"]) {
  test(`a deferred legacy validation cannot publish after ${transition}`, async () => {
    const f = fixture();
    const old = f.nextUser();
    await f.flush();
    if (transition === "unmount") f.unmount();
    else {
      f.setSession(session("current-owner"));
      f.restart();
      await f.flush();
      assert.equal(f.tree.props.value.user.id, "current-owner");
    }
    const before = f.calls.length;
    old.resolve({ data: { user: null }, error: { status: 401 } });
    if (transition === "unmount") await new Promise((resolve) => setImmediate(resolve));
    else await f.flush();
    assert.equal(f.calls.length, before);
    assert.equal(f.calls.includes("sign-out"), false);
    if (transition !== "unmount") f.unmount();
  });
}

test("the native verification gate fences portal interaction, cannot be dismissed, and closes on resolution", async () => {
  const base = fixture();
  let pending = false;
  const calls = [];
  const modal = {
    open: false,
    showModal() {
      this.open = true;
      calls.push("show-modal");
    },
    close() {
      this.open = false;
      calls.push("close");
    },
  };
  const f = reactFixture(
    "src/components/auth/ClerkSafe.tsx",
    (m) => () => m.TestAuthorityGate({ pending }),
    {
      sourceSuffix: "\nexport { AuthAuthorityGate as TestAuthorityGate };",
      modules: base.modules,
    },
  );
  f.render();
  f.tree.props.ref.current = modal;
  await f.flush();
  assert.equal(modal.open, false, "initial public loading has no modal");
  pending = true;
  await f.flush();
  assert.equal(modal.open, true);
  let prevented = false;
  f.tree.props.onCancel({
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true, "Escape cannot reveal an unresolved prior account");
  assert.match(f.tree.props.className, /bg-background.*backdrop:bg-background/);
  pending = false;
  await f.flush();
  assert.equal(modal.open, false);
  assert.deepEqual(calls, ["show-modal", "close"]);
  pending = true;
  await f.flush();
  f.unmount();
  assert.equal(modal.open, false, "unmount never leaves an orphaned top-layer modal");
});
