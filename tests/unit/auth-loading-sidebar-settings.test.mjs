import assert from "node:assert/strict";
import test from "node:test";
import { createHookHarness, loadUiModule } from "../helpers/ui-state-harness.mjs";
import { requiresAppAccount } from "../../src/lib/app-access-policy.mjs";

test("unresolved account state renders a neutral shell on home and protected routes", () => {
  let pathname = "/",
    status = { isLoaded: false, isSignedIn: false };
  const { AppAccountGate } = loadUiModule("src/components/AppAccountGate.tsx", {
    react: { lazy: () => "AccountWelcome", Suspense: "Suspense" },
    "@tanstack/react-router": { useRouterState: () => pathname },
    "@/components/auth/ClerkSafe": { useUser: () => status },
    "@/lib/app-access-policy.mjs": { requiresAppAccount },
  });
  for (const path of ["/", "/library", "/projects"]) {
    pathname = path;
    const result = AppAccountGate({ children: "account-page" });
    assert.equal(result.type.name, "SessionLoading");
    status = { isLoaded: true, isSignedIn: true };
    assert.equal(AppAccountGate({ children: "account-page" }), "account-page");
    status = { isLoaded: false, isSignedIn: false };
  }
  status = { isLoaded: true, isSignedIn: false };
  assert.equal(AppAccountGate({ children: "account-page" }).props.children.type, "AccountWelcome");
  pathname = "/about";
  status = { isLoaded: false, isSignedIn: false };
  assert.equal(AppAccountGate({ children: "public-page" }), "public-page");
});
test("settings block every sidebar setter without overwriting the saved preference", () => {
  const hooks = createHookHarness(),
    writes = [];
  let settingsOpen = false;
  const media = { matches: true, addEventListener() {}, removeEventListener() {} };
  const { useSidebarPreference } = loadUiModule(
    "src/hooks/use-sidebar-preference.ts",
    {
      react: { ...hooks.react, useLayoutEffect: hooks.react.useEffect },
    },
    {
      window: {
        matchMedia: () => media,
        localStorage: { getItem: () => "1", setItem: (...args) => writes.push(args) },
      },
      document: { querySelector: () => (settingsOpen ? {} : null) },
    },
  );
  const render = () => hooks.render(useSidebarPreference);
  render();
  let [open, set] = render();
  assert.equal(open, false);
  const before = writes.length;
  settingsOpen = true;
  set(true);
  set((value) => !value);
  [open, set] = render();
  assert.equal(open, false);
  assert.equal(writes.length, before);
  settingsOpen = false;
  set(true);
  [open] = render();
  assert.equal(open, true);
  assert.equal(writes.length, before, "the compact drawer does not persist its open state");
});
