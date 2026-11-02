import { expect, test, type Page } from "@playwright/test";

import { openCurrentSettings } from "./current-ui";
import { waitForKovaHydration } from "./hydration";

const projects = new Set(["phone-390x844", "desktop-1440x900"]);
const supabaseAuthStorageKeyPattern = /^sb-([a-z0-9]{20})-auth-token$/;
const supabaseRequestPattern = /^https:\/\/[a-z0-9]{20}\.supabase\.co(?:\/|$)/;
const observedAuthStorageKey = "kova-e2e-observed-supabase-auth-storage-key";
const e2eUser = {
  id: "11111111-1111-4111-8111-111111111111",
  aud: "authenticated",
  role: "authenticated",
  email: "settings-e2e@example.invalid",
  email_confirmed_at: "2026-01-01T00:00:00.000Z",
  confirmed_at: "2026-01-01T00:00:00.000Z",
  last_sign_in_at: "2026-01-01T00:00:00.000Z",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: { full_name: "Settings E2E" },
  identities: [],
  factors: [],
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  is_anonymous: false,
};

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(!projects.has(testInfo.project.name));
  await page.addInitScript(
    ({ storageKeyPatternSource, observedStorageKey, user }) => {
      localStorage.clear();
      localStorage.setItem("kova-theme-mode", "light");
      if (new URLSearchParams(location.search).get("e2e-settings-auth") !== "1") return;

      const base64Url = (value: unknown) =>
        btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
      const storageKeyPattern = new RegExp(storageKeyPatternSource);
      const nativeGetItem = Storage.prototype.getItem;
      Storage.prototype.getItem = function (key: string) {
        const match = storageKeyPattern.exec(key);
        if (this !== localStorage || !match) return nativeGetItem.call(this, key);

        const now = Math.floor(Date.now() / 1000);
        const expiresAt = now + 60 * 60;
        const accessToken = `${base64Url({ alg: "HS256", typ: "JWT" })}.${base64Url({
          iss: `https://${match[1]}.supabase.co/auth/v1`,
          aud: "authenticated",
          role: "authenticated",
          sub: user.id,
          email: user.email,
          aal: "aal1",
          amr: [{ method: "password", timestamp: now }],
          iat: now,
          exp: expiresAt,
        })}.c2ln`;
        sessionStorage.setItem(observedStorageKey, key);
        return JSON.stringify({
          access_token: accessToken,
          refresh_token: "settings-e2e-refresh-token",
          expires_in: 60 * 60,
          expires_at: expiresAt,
          token_type: "bearer",
          user,
        });
      };
    },
    {
      storageKeyPatternSource: supabaseAuthStorageKeyPattern.source,
      observedStorageKey: observedAuthStorageKey,
      user: e2eUser,
    },
  );
});

async function mockAuthenticatedBackend(page: Page) {
  const mockedBackendOrigins = new Set<string>();
  await page.route(supabaseRequestPattern, async (route) => {
    const url = new URL(route.request().url());
    mockedBackendOrigins.add(url.origin);
    if (url.pathname === "/auth/v1/user") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(e2eUser),
      });
      return;
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: url.pathname.includes("/rpc/") ? "null" : "[]",
      });
      return;
    }
    await route.abort("blockedbyclient");
  });
  return mockedBackendOrigins;
}

test("guest Settings URLs require an account with a consistent first-paint surface", async ({
  page,
}) => {
  await page.goto("/settings/appearance", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  const surface = page.locator(".kova-account-gate");
  await expect(surface).toBeVisible();
  await expect(page.getByRole("button", { name: "Log in", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Theme", exact: true })).toHaveCount(0);
  const frames = await surface.evaluate(async (node) => {
    const colors: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      colors.push(getComputedStyle(node).backgroundColor);
    }
    return colors;
  });
  expect(frames).toHaveLength(12);
  expect(new Set(frames)).toEqual(new Set(["rgb(255, 255, 255)"]));
});

test("signed-in mobile settings list keeps every option at least 44px tall", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "phone-390x844");
  const mockedBackendOrigins = await mockAuthenticatedBackend(page);
  await page.goto("/?e2e-settings-auth=1", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  const onboarding = page.getByRole("dialog", { name: "Welcome to KovaGPT" });
  // The authenticated onboarding lookup settles after hydration. Wait for its
  // mocked empty-state dialog instead of racing a one-shot visibility check;
  // otherwise it can mount over Settings between that check and the click.
  await onboarding.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
  if (await onboarding.isVisible().catch(() => false)) {
    await onboarding.getByRole("button", { name: "Close" }).click();
    await expect(onboarding).toHaveCount(0);
  }
  const runtimeStorageKey = await page.evaluate(
    (key) => sessionStorage.getItem(key),
    observedAuthStorageKey,
  );
  const storageMatch = supabaseAuthStorageKeyPattern.exec(runtimeStorageKey ?? "");
  expect(
    storageMatch,
    "the deployed Supabase client should request its project-scoped auth key",
  ).not.toBeNull();
  expect([...mockedBackendOrigins]).toEqual([`https://${storageMatch![1]}.supabase.co`]);

  const settingsDialog = await openCurrentSettings(page);
  const navigation = settingsDialog.getByRole("complementary", {
    name: "Settings navigation",
    exact: true,
  });
  if (!(await navigation.isVisible())) {
    await settingsDialog.getByRole("button", { name: "Back to settings", exact: true }).click();
  }
  await expect(navigation).toBeVisible();
  const options = navigation.getByRole("tab");
  await expect(options).toHaveCount(12);
  await expect(navigation.getByRole("tab", { name: "Cloud Browser", exact: true })).toBeVisible();
  for (let index = 0; index < (await options.count()); index++) {
    await options.nth(index).scrollIntoViewIfNeeded();
    await expect(options.nth(index)).toBeVisible();
    await expect(options.nth(index)).toBeInViewport({ ratio: 1 });
    expect(
      await options.nth(index).evaluate((element: HTMLElement) => element.offsetHeight),
    ).toBeGreaterThanOrEqual(44);
  }
});
