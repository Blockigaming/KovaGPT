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

const routesPerBatch = 4;
for (let offset = 0; offset < publicRoutes.length; offset += routesPerBatch) {
  const routes = publicRoutes.slice(offset, offset + routesPerBatch);
  test(`public landmark and skip target from ${routes[0]} to ${routes.at(-1)}`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1440x900");
    test.setTimeout(60_000);
    for (const route of routes) {
      await test.step(route, async () => {
        const response = await page.goto(route, { waitUntil: "domcontentloaded", timeout: 15_000 });
        expect(response?.status(), route).toBeLessThan(400);
        await waitForHydration(page);

        await expect(page.locator("main"), `${route} should render one main landmark`).toHaveCount(
          1,
        );
        await expect(
          page.locator("main#main-content"),
          `${route} should expose the skip target`,
        ).toHaveCount(1);
        await expect(
          page.getByRole("link", { name: "Skip to content" }),
          `${route} should expose one root-level skip link`,
        ).toHaveCount(1);
        await expect(page.getByRole("navigation", { name: "Public navigation" })).toBeVisible();
        if (route === "/pricing") {
          await expect(page.locator("[data-billing-page]")).toHaveCount(1);
          await expect(
            page
              .getByRole("navigation", { name: "Public navigation" })
              .getByRole("link", { name: "Open KovaGPT", exact: true }),
          ).toHaveAttribute("href", "/");
        }
        await expect(page.getByRole("contentinfo")).toBeVisible();

        const viewport = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }));
        expect(
          viewport.scrollWidth,
          `${route} should not overflow horizontally`,
        ).toBeLessThanOrEqual(viewport.clientWidth + 1);
      });
    }
  });
}

test("public footer links and the missing guide reach the correct destinations", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440x900");
  test.setTimeout(60_000);

  await page.goto("/features");
  await waitForHydration(page);
  await expect(page).toHaveTitle("Explore KovaGPT | KovaGPT");
  await page
    .getByRole("navigation", { name: "Footer navigation" })
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

  const missingDeveloperDoc = await page.goto("/developers/__missing-e2e-guide", {
    waitUntil: "domcontentloaded",
  });
  expect(missingDeveloperDoc?.status()).toBe(404);
  await waitForHydration(page);
  await expect(page).toHaveURL("/");
  await expect(page.getByText("Sorry, this page doesn’t exist!", { exact: true })).toBeVisible();
});

test("the public skip link moves keyboard focus to the main landmark", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440x900");
  await page.goto("/privacy");
  await waitForHydration(page);
  const skipLink = page.getByRole("link", { name: "Skip to content" });
  await skipLink.focus();
  await expect(skipLink).toBeFocused();
  await skipLink.press("Enter");
  await expect(page.locator("main#main-content")).toBeFocused();
});

test("mobile public navigation is keyboard-operable and preserves its primary action", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "phone-390x844");
  await page.goto("/overview");
  await waitForHydration(page);

  const toggle = page.getByRole("button", { name: "Open navigation" });
  await expect(toggle).toHaveAttribute("aria-controls", "public-mobile-navigation");
  await toggle.click();

  const menu = page.getByRole("navigation", { name: "Mobile public navigation" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("link", { name: "About", exact: true })).toHaveAttribute(
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
  await expect(menu).toBeHidden();
  const pricingToggle = page.getByRole("button", { name: "Open navigation" });
  await expect(pricingToggle).toHaveAttribute("aria-expanded", "false");
  await pricingToggle.click();
  await expect(menu.getByRole("link", { name: "Pricing", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(menu.getByRole("link", { name: "Open KovaGPT" })).toBeVisible();

  const targets = page.locator("header a, header button, footer a");
  const count = await targets.count();
  for (let index = 0; index < count; index += 1) {
    const box = await targets.nth(index).boundingBox();
    if (box)
      expect(box.height, `target ${index} should be at least 44px tall`).toBeGreaterThanOrEqual(44);
  }
});
