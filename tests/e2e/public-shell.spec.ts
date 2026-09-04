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
    await expect(page.getByRole("navigation", { name: "Public navigation" })).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();

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
  await expect(page).toHaveTitle("KovaGPT Billing");
  await page
    .getByRole("navigation", { name: "Footer navigation" })
    .getByRole("link", { name: "Privacy" })
    .click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page).toHaveTitle("KovaGPT Privacy");

  await page.goto("/developers/quickstart");
  await waitForHydration(page);
  await expect(
    page
      .getByRole("navigation", { name: "Public navigation" })
      .getByRole("link", { name: "Developers" }),
  ).toHaveAttribute("aria-current", "page");

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
  await expect(menu.getByRole("link", { name: "Product" })).toHaveAttribute("aria-current", "page");
  await expect(menu.getByRole("link", { name: "Open KovaGPT" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeFocused();

  await page.getByRole("button", { name: "Open navigation" }).click();
  await menu.getByRole("link", { name: "Pricing" }).click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.getByRole("button", { name: "Open navigation" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );

  const targets = page.locator("header a, header button, footer a");
  const count = await targets.count();
  for (let index = 0; index < count; index += 1) {
    const box = await targets.nth(index).boundingBox();
    if (box)
      expect(box.height, `target ${index} should be at least 44px tall`).toBeGreaterThanOrEqual(44);
  }
});
