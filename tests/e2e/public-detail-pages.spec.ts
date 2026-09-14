import { expect, test } from "@playwright/test";

import {
  PUBLIC_BUSINESS_PATHS,
  PUBLIC_ECOSYSTEM_PATHS,
  PUBLIC_FORM_PATHS,
  PUBLIC_GLOBAL_AFFAIRS_PATHS,
  PUBLIC_POLICY_PATHS,
  PUBLIC_SITEMAP_ENTRIES,
} from "../../src/lib/seo-policy.mjs";
import { waitForKovaHydration } from "./hydration";

const allDetailRoutes = [
  "/features/deep-research",
  "/features/plugins",
  "/features/study-mode",
  "/features/chat-with-pdfs",
  "/features/voice",
  "/features/voice-with-video",
  "/plans/free",
  "/plans/plus",
  "/plans/pro",
  "/plans/go",
  "/plans/k12-teachers",
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
  "/apps/canva",
  "/apps/powerpoint",
  "/apps/spotify",
  "/codex/enterprise",
  "/codex/pricing",
  "/students/2026",
  "/translate/english-to-french",
  "/translate/english-to-hindi",
  "/translate/english-to-marathi",
  "/translate/english-to-portuguese",
  "/translate/english-to-tagalog",
  "/translate/english-to-tamil",
  "/translate/english-to-urdu",
  "/translate/hindi-to-english",
  "/translate/spanish-to-english",
  "/translate/tagalog-to-english",
  "/writing/paraphrase",
  ...PUBLIC_SITEMAP_ENTRIES.map(({ path }) => path).filter((path) => path.startsWith("/academy/")),
  ...PUBLIC_POLICY_PATHS,
  ...PUBLIC_BUSINESS_PATHS,
  ...PUBLIC_ECOSYSTEM_PATHS,
  ...PUBLIC_FORM_PATHS,
  ...PUBLIC_GLOBAL_AFFAIRS_PATHS,
];

const responsiveRoutes = [
  "/features/deep-research",
  "/plans/pro",
  "/use-cases/chat-with-spreadsheets",
  "/business/ai-for-engineering",
  "/apps/google-drive",
  "/academy/ai-fundamentals",
  "/academy/chatgpt-work/how-data-science-teams-use-codex",
  "/policies/privacy-policy/california-privacy-rights-reporting",
  "/business/solutions/finance/workflows",
  "/business/plugins/google-drive",
  "/business/partners/accenture",
  "/form/model-behavior-feedback",
  "/global-affairs/a-primer-on-the-eu-ai-act",
  "/global-affairs/the-washington-post-partners-with-openai",
] as const;

const detailRouteGroups = Array.from({ length: 5 }, (_, groupIndex) =>
  allDetailRoutes.filter((_, routeIndex) => routeIndex % 5 === groupIndex),
);

test.describe.parallel("complete public detail content", () => {
  detailRouteGroups.forEach((routes, groupIndex) => {
    test(`detail group ${groupIndex + 1} has complete content and metadata`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop-1440x900");
      test.setTimeout(420_000);

      for (const route of routes) {
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
        if (["/plans/plus", "/plans/pro", "/plans/go", "/plans/k12-teachers"].includes(route)) {
          await expect(primaryAction).toHaveAttribute("href", "/pricing");
        }
        const description = await page.locator('meta[name="description"]').getAttribute("content");
        expect(description?.trim().length, `${route} description length`).toBeGreaterThanOrEqual(
          30,
        );
        await expect(page.locator('link[rel="canonical"]'), route).toHaveAttribute(
          "href",
          `https://kovagpt.com${route}`,
        );
        await expect(page.getByRole("contentinfo"), route).toBeVisible();
      }
    });
  });
});

test("representative detail families remain responsive in light and dark modes", async ({
  page,
}, testInfo) => {
  const projects = new Set(["phone-390x844", "tablet-1024x768", "desktop-1440x900"]);
  test.skip(!projects.has(testInfo.project.name));
  test.setTimeout(300_000);

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

test("Academy and research landings expose populated destinations", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440x900");

  await page.goto("/academy", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expect(page.locator('[data-public-primary="true"]')).toHaveAttribute(
    "href",
    "/academy/ai-fundamentals",
  );
  await expect(page.locator('main a[href^="/academy/"]')).toHaveCount(39);

  await page.goto("/economic-research-exchange", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  const researchAction = page.locator('[data-public-primary="true"]');
  await expect(researchAction).toHaveAttribute("href", "/research-assistant");
  await researchAction.click();
  await expect(page).toHaveURL(/\/research-assistant$/u);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
