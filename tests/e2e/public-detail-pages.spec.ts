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

test.describe("Academy search", () => {
  const projects = new Set([
    "phone-320x700",
    "phone-390x844",
    "tablet-1024x768",
    "desktop-1440x900",
  ]);

  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(!projects.has(testInfo.project.name));
    const response = await page.goto("/academy", { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    await waitForKovaHydration(page);
  });

  test("filters the correct guide titles and summaries without losing catalog entries", async ({
    page,
  }) => {
    const search = page.getByRole("searchbox", { name: "Search guides", exact: true });
    const results = page.locator("#academy-guide-results");
    const links = results.getByRole("link");
    const expected = PUBLIC_SITEMAP_ENTRIES.map(({ path }) => path)
      .filter((path) => path.startsWith("/academy/"))
      .sort();
    await expect(links).toHaveCount(37);
    expect(
      await links.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")).sort()),
    ).toEqual(expected);

    for (const [query, destination] of [
      ["  BRAINSTORM  ", "/academy/brainstorming"],
      ["MENTÁL  MODEL", "/academy/ai-fundamentals"],
      ["MODEL mental", "/academy/ai-fundamentals"],
      ["multi step", "/academy/chatgpt-work"],
    ]) {
      await search.fill(query);
      await expect(links).toHaveCount(1);
      await expect(links).toHaveAttribute("href", destination);
      await expect(page.locator("#academy-result-count")).toHaveText("1 guide found");
      await expect(search).toBeFocused();
    }
    await search.fill("   ");
    await expect(links).toHaveCount(37);
  });

  test("shows an empty result state and restores all guides and input focus on clear", async ({
    page,
  }) => {
    const search = page.getByRole("searchbox", { name: "Search guides", exact: true });
    const results = page.locator("#academy-guide-results");
    for (const label of ["Clear search", "Clear Academy search"]) {
      await search.fill("brainstorm student");
      await expect(results.getByRole("link")).toHaveCount(0);
      await expect(results.getByRole("heading", { name: "No guides found" })).toBeVisible();
      await expect(page.locator("#academy-result-count")).toHaveText("0 guides found");
      await page.getByRole("button", { name: label, exact: true }).click();
      await expect(search).toHaveValue("");
      await expect(search).toBeFocused();
      await expect(results.getByRole("link")).toHaveCount(37);
      await expect(results.getByRole("heading", { name: "No guides found" })).toHaveCount(0);
      await expect(page.locator("#academy-result-count")).toHaveText("37 guides found");
    }
  });

  test("Tab and Shift+Tab traverse the input, clear action, and every filtered lesson link", async ({
    page,
  }) => {
    const search = page.getByRole("searchbox", { name: "Search guides", exact: true });
    const clear = page.getByRole("button", { name: "Clear Academy search" });
    await search.fill("coding");
    const links = page.locator("#academy-guide-results").getByRole("link");
    const count = await links.count();
    expect(count).toBeGreaterThan(1);
    await page.keyboard.press("Tab");
    await expect(clear).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(search).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(clear).toBeFocused();
    for (let index = 0; index < count; index++) {
      await page.keyboard.press("Tab");
      await expect(links.nth(index)).toBeFocused();
    }
    for (let index = count - 2; index >= 0; index--) {
      await page.keyboard.press("Shift+Tab");
      await expect(links.nth(index)).toBeFocused();
    }
    await page.keyboard.press("Shift+Tab");
    await expect(clear).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(search).toBeFocused();
    await search.fill("zzzz-no-guide");
    await page.keyboard.press("Tab");
    await expect(clear).toBeFocused();
    await page.keyboard.press("Tab");
    const reset = page.getByRole("button", { name: "Clear search", exact: true });
    await expect(reset).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(search).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator("#academy-guide-results").getByRole("link").first()).toBeFocused();
  });

  test("Enter keeps inline search open and Escape clears the filter without blurring", async ({
    page,
  }) => {
    const search = page.getByRole("searchbox", { name: "Search guides", exact: true });
    await search.fill("brainstorm");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/academy$/u);
    await expect(search).toHaveValue("brainstorm");
    await expect(search).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(search).toHaveValue("");
    await expect(search).toBeFocused();
    await expect(page.locator("#academy-guide-results").getByRole("link")).toHaveCount(37);
    await page.keyboard.press("Escape");
    await expect(search).toBeFocused();
  });

  test("a filtered nested lesson navigates by keyboard and returns to the Academy catalog", async ({
    page,
  }) => {
    const search = page.getByRole("searchbox", { name: "Search guides", exact: true });
    await search.fill("coding assistance data science");
    const lesson = page.locator("#academy-guide-results").getByRole("link");
    await expect(lesson).toHaveCount(1);
    await expect(lesson).toHaveAttribute(
      "href",
      "/academy/chatgpt-work/how-data-science-teams-use-codex",
    );
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(lesson).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/academy\/chatgpt-work\/how-data-science-teams-use-codex$/u);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Coding assistance for data science teams",
    );
    await page
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("link", { name: "academy", exact: true })
      .click();
    await expect(page).toHaveURL(/\/academy$/u);
    await expect(page.locator("#academy-guide-results").getByRole("link")).toHaveCount(37);
    await expect(search).toHaveValue("");
  });

  test("exposes labeled search, a live result count, landmarks, and visible keyboard focus @a11y", async ({
    page,
  }) => {
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("search", { name: "Academy guides", exact: true })).toHaveCount(1);
    const search = page.getByRole("searchbox", { name: "Search guides", exact: true });
    await expect(search).toHaveAttribute("aria-controls", "academy-guide-results");
    await expect(search).toHaveAccessibleDescription(
      "Search guide titles and summaries. Press Escape to clear. 37 guides found",
    );
    const count = page.locator("#academy-result-count");
    await expect(count).toHaveAttribute("role", "status");
    await expect(count).toHaveAttribute("aria-live", "polite");
    await expect(count).toHaveAttribute("aria-atomic", "true");
    await page.keyboard.press("Tab");
    await page.getByRole("link", { name: "Skip to content" }).press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
    await search.focus();
    await page.keyboard.press("Tab");
    const first = page.locator("#academy-guide-results").getByRole("link").first();
    await expect(first).toBeFocused();
    expect(await first.evaluate((node) => node.matches(":focus-visible"))).toBe(true);
    // The shared stylesheet intentionally uses an outline instead of a shadow.
    const focus = await first.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        width: parseFloat(style.outlineWidth),
        style: style.outlineStyle,
        color: style.outlineColor,
      };
    });
    expect(focus.width).toBeGreaterThanOrEqual(2);
    expect(focus.style).toBe("solid");
    expect(focus.color).not.toBe("rgba(0, 0, 0, 0)");
  });

  test("search and empty states reflow in both themes and at 200% text size", async ({ page }) => {
    const search = page.getByRole("searchbox", { name: "Search guides", exact: true });
    const results = page.locator("#academy-guide-results");
    const width = page.viewportSize()!.width;
    for (const dark of [false, true]) {
      await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), dark);
      for (const enlarged of [false, true]) {
        await page.evaluate((enlarged) => {
          document.documentElement.style.fontSize = enlarged ? "200%" : "";
        }, enlarged);
        for (const query of ["", "brainstorm", "z".repeat(200)]) {
          await search.fill(query);
          const layout = await page.evaluate(() => ({
            width: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
            columns: getComputedStyle(
              document.getElementById("academy-guide-results")!,
            ).gridTemplateColumns.split(/\s+/).length,
          }));
          expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width + 1);
          expect(layout.columns).toBe(width < 768 ? 1 : 2);
          const controls = page
            .getByRole("search", { name: "Academy guides", exact: true })
            .locator("input, button");
          for (let index = 0; index < (await controls.count()); index++) {
            const box = (await controls.nth(index).boundingBox())!;
            expect(box.width).toBeGreaterThanOrEqual(44);
            expect(box.height).toBeGreaterThanOrEqual(44);
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
          }
          await expect(results.getByRole("link")).toHaveCount(
            query.length === 200 ? 0 : query ? 1 : 37,
          );
          if (query.length === 200) {
            const reset = results.getByRole("button", { name: "Clear search", exact: true });
            await expect(reset).toBeVisible();
            expect((await reset.boundingBox())!.height).toBeGreaterThanOrEqual(44);
          }
        }
      }
    }
  });
});

const allDetailRoutes = [
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
  // Application-style writing and translation workspaces have dedicated specs;
  // this list only covers routes rendered with the public detail-page template.
  ...PUBLIC_SITEMAP_ENTRIES.map(({ path }) => path).filter((path) => path.startsWith("/academy/")),
  ...PUBLIC_POLICY_PATHS,
  ...PUBLIC_BUSINESS_PATHS,
  ...PUBLIC_ECOSYSTEM_PATHS,
  ...PUBLIC_FORM_PATHS,
  ...PUBLIC_GLOBAL_AFFAIRS_PATHS,
];

const responsiveRoutes = [
  "/features/plugins",
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
  const academyPaths = PUBLIC_SITEMAP_ENTRIES.map(({ path }) => path).filter((path) =>
    path.startsWith("/academy/"),
  );
  // Require every active guide plus the separately verified hero link. Compare
  // destinations, not an obsolete count that includes a retired product guide.
  await expect
    .poll(() =>
      page
        .locator('main a[href^="/academy/"]')
        .evaluateAll((links) => links.map((link) => link.getAttribute("href")).sort()),
    )
    .toEqual([...academyPaths, "/academy/ai-fundamentals"].sort());

  await page.goto("/economic-research-exchange", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  const researchAction = page.locator('[data-public-primary="true"]');
  await expect(researchAction).toHaveAttribute("href", "/research-assistant");
  await researchAction.click();
  await expect(page).toHaveURL(/\/research-assistant$/u);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
