import { expect, test } from "@playwright/test";

const publicRoutes = [
  "/features",
  "/use-cases",
  "/developers",
  "/trust",
  "/pricing",
  "/help",
  "/privacy",
  "/terms",
  "/refund",
  "/ai-safety",
  "/getting-started",
  "/modes",
  "/status",
  "/changelog",
  "/connect",
  "/ai-writer",
  "/blog/ai-market-research-guide",
] as const;
const coreRoutes = new Set(["/pricing", "/help", "/privacy", "/terms", "/refund"]);

async function waitForHydration(page: import("@playwright/test").Page) {
  await expect(page.locator("html")).toHaveAttribute("data-kova-hydration", "ready", {
    timeout: 30_000,
  });
}

test("public routes share one landmark and a working skip target", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440x900");
  test.setTimeout(90_000);

  for (const route of publicRoutes) {
    const response = await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(response?.status(), route).toBeLessThan(400);
    await waitForHydration(page);

    await expect(page.locator("main"), `${route} should render one main landmark`).toHaveCount(1);
    await expect(
      page.locator("main#main-content"),
      `${route} should expose the skip target`,
    ).toHaveCount(1);
    await expect(
      page.getByRole("link", { name: "Skip to content" }),
      `${route} should expose one root-level skip link`,
    ).toHaveCount(1);
    if (coreRoutes.has(route)) {
      const navigation = page.getByRole("navigation", { name: "Account and help navigation" });
      await expect(navigation).toBeVisible();
      await expect(navigation.getByRole("link", { name: "Plans", exact: true })).toHaveAttribute(
        "href",
        "/pricing",
      );
      await expect(navigation.getByRole("link", { name: "Help", exact: true })).toHaveAttribute(
        "href",
        "/help",
      );
      await expect(page.getByRole("link", { name: "Back to KovaGPT chat" })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Public navigation" })).toHaveCount(0);
      const legal = page.getByRole("contentinfo", { name: "Legal and support" });
      await expect(legal).toBeVisible();
      await expect(legal.getByRole("link", { name: "Terms of Service" })).toHaveAttribute(
        "href",
        "/terms",
      );
      await expect(legal.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute(
        "href",
        "/privacy",
      );
    } else {
      await expect(page.getByRole("navigation", { name: "Public navigation" })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Footer navigation" })).toBeVisible();
      await expect(page.getByRole("contentinfo")).toBeVisible();
    }

    const viewport = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(viewport.scrollWidth, `${route} should not overflow horizontally`).toBeLessThanOrEqual(
      viewport.clientWidth + 1,
    );
  }

  await page.goto("/features");
  await waitForHydration(page);
  await expect(page).toHaveTitle("KovaGPT features | KovaGPT");
  await page
    .getByRole("navigation", { name: "Public navigation" })
    .getByRole("link", { name: "Pricing" })
    .click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page).toHaveTitle("KovaGPT Subscriptions");
  await page
    .getByRole("navigation", { name: "Account and help navigation" })
    .getByRole("link", { name: "Help", exact: true })
    .click();
  await expect(page).toHaveURL(/\/help$/);
  await expect(page.getByRole("heading", { name: "How can we help?" })).toBeVisible();
  await page
    .getByRole("contentinfo", { name: "Legal and support" })
    .getByRole("link", { name: "Privacy Policy" })
    .click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page).toHaveTitle("KovaGPT Privacy");

  const missingDeveloperDoc = await page.goto("/developers/__missing-e2e-guide", {
    waitUntil: "domcontentloaded",
  });
  expect(missingDeveloperDoc?.status()).toBe(404);
  await waitForHydration(page);
  await expect(
    page.getByRole("heading", { name: "We couldn't find that page", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Return home", exact: true })).toBeVisible();

  await page.goto("/privacy");
  await waitForHydration(page);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#main-content")).toBeFocused();
});

test("mobile public navigation is keyboard-operable and preserves its primary action", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "phone-390x844");
  await page.goto("/features");
  await waitForHydration(page);

  const toggle = page.getByRole("button", { name: "Open navigation" });
  await expect(toggle).toHaveAttribute("aria-controls", "public-mobile-navigation");
  await toggle.click();

  const menu = page.getByRole("navigation", { name: "Mobile public navigation" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("link", { name: "Features", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(menu.getByRole("link", { name: "Open KovaGPT" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeFocused();

  await page.getByRole("button", { name: "Open navigation" }).click();
  await menu.getByRole("link", { name: "Pricing" }).click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open navigation" })).toHaveCount(0);
  const coreNavigation = page.getByRole("navigation", { name: "Account and help navigation" });
  await expect(coreNavigation.getByRole("link", { name: "Plans", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("link", { name: "Back to KovaGPT chat" })).toHaveAttribute(
    "href",
    "/",
  );

  const targets = page.locator("header a, header button, footer a");
  const count = await targets.count();
  for (let index = 0; index < count; index += 1) {
    const box = await targets.nth(index).boundingBox();
    if (box)
      expect(box.height, `target ${index} should be at least 44px tall`).toBeGreaterThanOrEqual(44);
  }

  const help = coreNavigation.getByRole("link", { name: "Help", exact: true });
  await help.focus();
  await expect(help).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/help$/);
  const terms = page
    .getByRole("contentinfo", { name: "Legal and support" })
    .getByRole("link", { name: "Terms of Service" });
  await terms.focus();
  await expect(terms).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/terms$/);
  await expect(page.locator("main#main-content")).toBeVisible();
});
