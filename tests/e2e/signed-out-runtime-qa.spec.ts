import { expect, test, type Locator } from "@playwright/test";
import { waitForKovaHydration } from "./hydration";

const selectedProjects = new Set(["phone-390x844", "desktop-1440x900"]);
async function expectMinimumTouchTarget(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width + 0.01).toBeGreaterThanOrEqual(44);
  expect(box!.height + 0.01).toBeGreaterThanOrEqual(44);
}

test.beforeEach(({ page: _page }, testInfo) => {
  test.skip(!selectedProjects.has(testInfo.project.name));
});

for (const theme of ["light", "dark"] as const) {
  test(`guest account entry exposes its semantic and keyboard contract in ${theme} @a11y`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.addInitScript((mode) => localStorage.setItem("kova-theme-mode", mode), theme);
    let chatRequests = 0;
    await page.route("**/api/chat", (route) => {
      chatRequests += 1;
      return route.abort("blockedbyclient");
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("html")).not.toHaveAttribute("aria-busy", "true");
    if (theme === "dark") await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    else await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Question what’s next");
    await expect(page.getByRole("region", { name: "Question what’s next" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Message KovaGPT", exact: true })).toHaveCount(
      0,
    );
    for (const name of ["Attach", "Send message", "Voice", "Dictate", "Options"])
      await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
    await expect(page.getByTestId("model-selector-trigger")).toHaveCount(0);
    const login = page.getByRole("button", { name: "Continue with email", exact: true });
    const signup = page.getByRole("button", { name: "Create an account", exact: true });
    await expectMinimumTouchTarget(login);
    await expectMinimumTouchTarget(signup);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const skip = page.getByRole("link", { name: "Skip to content", exact: true });
    await skip.focus();
    await expect(skip).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
    await signup.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Log in", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(signup).toBeVisible();
    const email = page.getByRole("textbox", { name: "Email address", exact: true });
    await email.fill("accessibility@example.test");
    await login.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/auth\?email=accessibility%40example\.test/);
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    expect(chatRequests).toBe(0);
    await page.goto("/auth?email=accessibility%40example.test&mode=sign-in", {
      waitUntil: "domcontentloaded",
    });
    await waitForKovaHydration(page);
    const policies = page.getByRole("navigation", { name: "Account policies", exact: true });
    await expect(
      policies.getByRole("link", { name: "Terms of Service (opens in a new tab)", exact: true }),
    ).toHaveAttribute("href", "/terms");
    await expect(
      policies.getByRole("link", { name: "Privacy Policy (opens in a new tab)", exact: true }),
    ).toHaveAttribute("href", "/privacy");
  });
}
