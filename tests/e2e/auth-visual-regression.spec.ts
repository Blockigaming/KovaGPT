import { expect, test, type Page } from "@playwright/test";

import { waitForKovaHydration } from "./hydration";

type ThemeMode = "light" | "dark";

test.setTimeout(45_000);

const themeByProject = new Map<string, ThemeMode>([
  ["desktop-1440x900", "light"],
  ["phone-390x844", "dark"],
]);

async function installDeterministicAuthGuard(page: Page) {
  const observations = {
    settingsReads: 0,
    writes: [] as string[],
  };

  await page.route("**/auth/v1/**", async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const path = new URL(request.url()).pathname;

    if (method === "GET" && /\/auth\/v1\/settings\/?$/u.test(path)) {
      observations.settingsReads += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
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
      observations.writes.push(`${method} ${path}`);
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
  expect(authNetwork.settingsReads).toBeGreaterThanOrEqual(1);

  await page.evaluate(() => document.fonts.ready);
  await dialog.evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });

  expect(authNetwork.writes).toEqual([]);
  await expect(page).toHaveScreenshot("guest-auth-dialog.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.005,
    scale: "css",
  });
  expect(authNetwork.writes).toEqual([]);
});
