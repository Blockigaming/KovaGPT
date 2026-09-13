import { expect, test } from "@playwright/test";

import { waitForKovaHydration } from "./hydration";

const allDetailRoutes = [
  "/features/deep-research",
  "/features/plugins",
  "/features/study-mode",
  "/features/chat-with-pdfs",
  "/plans/free",
  "/plans/plus",
  "/plans/pro",
  "/use-cases/chat-with-presentations",
  "/use-cases/chat-with-spreadsheets",
  "/use-cases/fitness-wellness-and-health",
  "/use-cases/money-and-finances",
  "/use-cases/recipes-cooking",
  "/use-cases/science-medicine",
  "/use-cases/students",
  "/use-cases/teachers",
  "/use-cases/travel-and-exploration",
  "/use-cases/university-educators",
  "/use-cases/veterans",
  "/business/ai-for-data-science-analytics",
  "/business/ai-for-engineering",
  "/business/ai-for-finance",
  "/business/ai-for-product-management",
  "/business/ai-for-sales-marketing",
  "/business/education",
  "/business/enterprise",
  "/apps/google-drive",
  "/apps/gmail",
  "/apps/google-calendar",
  "/apps/github",
] as const;

const responsiveRoutes = [
  "/features/deep-research",
  "/plans/pro",
  "/use-cases/chat-with-spreadsheets",
  "/business/ai-for-engineering",
  "/apps/google-drive",
] as const;

test("every public detail page has complete content and metadata", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440x900");
  test.setTimeout(120_000);

  for (const route of allDetailRoutes) {
    const response = await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(response?.status(), route).toBe(200);
    await waitForKovaHydration(page);

    await expect(page.locator("main#main-content"), route).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 }), route).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Breadcrumb" }), route).toBeVisible();
    await expect(page.getByRole("region", { name: "Page highlights" }), route).toBeVisible();
    await expect(page.locator("main article"), route).toHaveCount(2);
    const primaryAction = page.locator("[data-public-primary]");
    await expect(primaryAction, route).toHaveCount(1);
    if (route === "/plans/free") await expect(primaryAction).toHaveAttribute("href", "/");
    if (route === "/plans/plus" || route === "/plans/pro") {
      await expect(primaryAction).toHaveAttribute("href", "/pricing");
    }
    const description = await page.locator('meta[name="description"]').getAttribute("content");
    expect(description?.trim().length, `${route} description length`).toBeGreaterThanOrEqual(30);
    await expect(page.locator('link[rel="canonical"]'), route).toHaveAttribute(
      "href",
      `https://kovagpt.com${route}`,
    );
    await expect(page.getByRole("contentinfo"), route).toBeVisible();
  }
});

test("representative detail families remain responsive in light and dark modes", async ({
  page,
}, testInfo) => {
  const projects = new Set(["phone-390x844", "tablet-1024x768", "desktop-1440x900"]);
  test.skip(!projects.has(testInfo.project.name));
  test.setTimeout(90_000);

  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    for (const route of responsiveRoutes) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await waitForKovaHydration(page);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const viewport = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      expect(viewport.scroll, `${route} ${colorScheme}`).toBeLessThanOrEqual(viewport.width + 1);

      const primary = page.locator("main a.min-h-11").first();
      const box = await primary.boundingBox();
      expect(box, `${route} ${colorScheme} primary action`).not.toBeNull();
      expect(box!.height, `${route} ${colorScheme} primary action`).toBeGreaterThanOrEqual(44);
    }
  }
});
