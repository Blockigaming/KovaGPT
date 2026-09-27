import assert from "node:assert/strict";
import test from "node:test";
import { reactFixture } from "../helpers/kova-react-fixture.mjs";

const token = "A".repeat(43);

function fixture(href, mode = "dual") {
  let url = new URL(href);
  let resolveSession;
  const session = new Promise((resolve) => {
    resolveSession = resolve;
  });
  const active = [];
  const jsx = (type, props, key) => ({ type, props, key });
  const f = reactFixture(
    "src/components/auth/ClerkSafe.tsx",
    (exports) => () => {
      const wrapper = exports.ClerkProvider({ children: "reset form" });
      return wrapper.type(wrapper.props);
    },
    {
      modules: {
        "react/jsx-runtime": { jsx, jsxs: jsx },
        "@/integrations/supabase/client": {},
        "@/components/auth/AuthDialog": { AuthDialog: "auth-dialog" },
        "@/components/auth/MfaChallengeDialog": {},
        "@/components/LogoutConfirmDialog": {},
        "@/lib/oauth-session": {},
        "@/lib/principal-browser-storage.mjs": {
          purgeUnscopedPrivateBrowserStorage: () => ({
            local: { failures: [] },
            session: { failures: [] },
          }),
          dispatchPrincipalBrowserStorageCleared() {},
        },
        "@/lib/auth-validation-policy.mjs": {},
        "@/lib/kova-auth-browser": {
          browserKovaAuthMode: () => mode,
          resolveKovaSessionAuthority: () => session,
          announceKovaAuthChange() {},
          setKovaSessionActive: (value) => active.push(value),
          isKovaSessionRejectedError: () => false,
          KOVA_AUTH_CHANGE_KEY: "auth-change",
        },
        "@/components/ui/dropdown-menu": {},
      },
      globals: {
        URLSearchParams,
        document: { addEventListener() {}, removeEventListener() {}, visibilityState: "visible" },
        window: {
          location: {
            get href() {
              return url.href;
            },
            get pathname() {
              return url.pathname;
            },
            get search() {
              return url.search;
            },
            get hash() {
              return url.hash;
            },
          },
          addEventListener() {},
          removeEventListener() {},
        },
      },
    },
  );
  return {
    f,
    active,
    resolveSession,
    scrub: () => {
      url = new URL("/reset-password", url.origin);
    },
  };
}

test("dual guest resolution preserves an owned reset fragment already scrubbed by the route", async () => {
  const { f, active, resolveSession, scrub } = fixture(
    `https://kova.test/reset-password#token=${token}`,
  );
  await f.flush();
  assert.equal(f.tree.type, "context-provider");
  assert.equal(f.tree.key, "owned-recovery");
  scrub();
  resolveSession(null);
  await f.flush();
  assert.equal(f.tree.type, "context-provider");
  assert.equal(f.tree.key, "owned-recovery");
  assert.equal(active.at(-1), true);
});

test("pure owned mode keeps the reset form mounted during guest resolution", async () => {
  const { f, resolveSession, scrub } = fixture(
    `https://kova.test/reset-password#token=${token}`,
    "kova",
  );
  await f.flush();
  scrub();
  resolveSession(null);
  await f.flush();
  assert.equal(f.tree.type, "context-provider");
  assert.equal(f.tree.key, "owned-recovery");
});

test("dual guest still falls back to hosted auth without a valid owned reset fragment", async () => {
  const { f, resolveSession } = fixture("https://kova.test/reset-password#token=invalid");
  await f.flush();
  resolveSession(null);
  await f.flush();
  assert.equal(typeof f.tree.type, "function");
});
