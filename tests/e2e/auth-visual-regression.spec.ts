import { expect, test, type Page } from "@playwright/test";

import { captureCandidateVisual } from "./candidate-visual-evidence";
import { waitForKovaHydration } from "./hydration";

type ThemeMode = "light" | "dark";

test.setTimeout(45_000);

const themeByProject = new Map<string, ThemeMode>([
  ["desktop-1440x900", "light"],
  ["phone-390x844", "dark"],
]);
const authFixtureOrigin = "http://127.0.0.1:8081";
const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "accept, apikey, authorization, content-type, x-client-info",
};

async function installDeterministicAuthGuard(page: Page) {
  const observations = {
    settingsPreflights: 0,
    settingsReads: 0,
    unexpectedFixtureRequests: [] as string[],
    writes: [] as string[],
  };

  await page.route("**/auth/v1/**", async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const url = new URL(request.url());
    const path = url.pathname;
    const isFixtureOrigin = url.origin === authFixtureOrigin;
    const isSettings = /\/auth\/v1\/settings\/?$/u.test(path);

    if (isFixtureOrigin && method === "OPTIONS" && isSettings) {
      observations.settingsPreflights += 1;
      await route.fulfill({
        status: 204,
        headers: corsHeaders,
        body: "",
      });
      return;
    }

    if (isFixtureOrigin && method === "GET" && isSettings) {
      observations.settingsReads += 1;
      await route.fulfill({
        status: 200,
        headers: {
          ...corsHeaders,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          external: {
            google: true,
            email: true,
            apple: false,
            azure: false,
            github: false,
          },
          disable_signup: false,
          mailer_autoconfirm: false,
        }),
      });
      return;
    }

    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      observations.writes.push(`${method} ${url.origin}${path}`);
      await route.abort("blockedbyclient");
      return;
    }

    if (isFixtureOrigin) {
      observations.unexpectedFixtureRequests.push(`${method} ${path}`);
      await route.abort("blockedbyclient");
      return;
    }

    await route.continue();
  });

  return observations;
}

test.beforeEach(({ page: _page }, testInfo) => {
  test.skip(
    !themeByProject.has(testInfo.project.name),
    "The auth visual gate intentionally covers one complementary theme at each target viewport.",
  );
});

test("guest auth dialog visual baseline", async ({ page }, testInfo) => {
  const theme = themeByProject.get(testInfo.project.name)!;
  const authNetwork = await installDeterministicAuthGuard(page);

  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await page.addInitScript((mode: ThemeMode) => {
    window.localStorage.setItem("kova-theme-mode", mode);
  }, theme);

  await page.goto("/auth", { waitUntil: "domcontentloaded" });
  expect(new URL(page.url()).origin).toBe(authFixtureOrigin);
  await waitForKovaHydration(page);

  const dialog = page.getByRole("dialog", { name: "Log in or sign up" });
  const email = dialog.getByLabel("Email address");
  const googleButton = dialog.getByRole("button", {
    name: "Continue with Google",
  });
  await expect(dialog).toBeVisible();
  await expect(email).toBeFocused();
  await expect(googleButton).toBeEnabled({ timeout: 15_000 });
  await expect(googleButton).toHaveAttribute("aria-busy", "false");
  await expect(googleButton.locator(".animate-spin")).toHaveCount(0);
  expect(authNetwork.settingsReads).toBe(1);
  expect(authNetwork.settingsPreflights).toBe(0);
  expect(authNetwork.unexpectedFixtureRequests).toEqual([]);

  await page.evaluate(() => document.fonts.ready);
  await dialog.evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });

  expect(authNetwork.writes).toEqual([]);
  expect(authNetwork.unexpectedFixtureRequests).toEqual([]);
  await expect(page).toHaveScreenshot("guest-auth-dialog.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.005,
    scale: "css",
  });
  await captureCandidateVisual(page, testInfo, `guest-auth-dialog-${theme}`);
  expect(authNetwork.writes).toEqual([]);
  expect(authNetwork.unexpectedFixtureRequests).toEqual([]);
});
