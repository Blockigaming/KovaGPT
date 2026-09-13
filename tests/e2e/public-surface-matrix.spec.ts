import { expect, test, type Page } from "@playwright/test";

import { PUBLIC_REVIEW_PATHS } from "../../src/lib/seo-policy.mjs";
import { waitForKovaHydration } from "./hydration";

const verificationProjects = new Set(["phone-390x844", "tablet-1024x768", "desktop-1440x900"]);
const expandedPublicRoutes = new Set([
  "/academy",
  "/business-data",
  "/careers",
  "/charter",
  "/consumer-privacy",
  "/economic-research-exchange",
  "/enterprise-privacy",
  "/interview-guide",
  "/open-model-feedback",
  "/open-models",
  "/our-structure",
  "/policies",
  "/residency",
  "/safety",
  "/science",
  "/security-and-privacy",
  "/solutions",
  "/student-collective",
  "/transparency-and-content-moderation",
  "/trust-and-transparency",
  "/solutions/blueprints/knowledge-retrieval",
  "/solutions/blueprints/mcpkit",
  "/solutions/industries/financial-services",
  "/solutions/industries/government",
  "/solutions/industries/healthcare",
  "/solutions/industries/retail",
  "/solutions/use-case/agents",
  "/solutions/use-case/coding",
  "/solutions/use-case/content-creation",
  "/solutions/use-case/data-analysis",
  "/solutions/use-case/research",
]);

function watchForRuntimeErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /(?:uncaught|typeerror|referenceerror|hydration|server rendered html|did not match)/iu.test(
        message.text(),
      )
    ) {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

const routesUnderTest =
  process.env.KOVA_PUBLIC_MATRIX_SCOPE === "expanded"
    ? PUBLIC_REVIEW_PATHS.filter((route) => expandedPublicRoutes.has(route))
    : PUBLIC_REVIEW_PATHS;
const groupCount = process.env.KOVA_PUBLIC_MATRIX_SCOPE === "expanded" ? 4 : 12;
const routeGroups = Array.from({ length: groupCount }, (_, groupIndex) =>
  routesUnderTest.filter((_, routeIndex) => routeIndex % groupCount === groupIndex),
);

async function verifyRoute(
  page: Page,
  route: string,
  colorScheme: "light" | "dark",
  runtimeErrors: string[],
) {
  runtimeErrors.length = 0;
  const response = await page.goto(route, { waitUntil: "domcontentloaded" });
  expect(response?.status(), `${route} ${colorScheme} status`).toBe(200);
  await waitForKovaHydration(page);

  await expect(page.locator("main#main-content"), `${route} ${colorScheme} main`).toHaveCount(1);
  await expect(
    page.getByRole("heading", { level: 1 }),
    `${route} ${colorScheme} heading`,
  ).toBeVisible();
  const publicNavigation = page.getByRole("navigation", { name: "Public navigation" });
  if ((await publicNavigation.count()) === 1) {
    await expect(publicNavigation, `${route} ${colorScheme} navigation`).toBeVisible();
    await expect(page.getByRole("contentinfo"), `${route} ${colorScheme} footer`).toBeVisible();
  } else {
    await expect(
      page.getByRole("button", { name: "Log in", exact: true }).first(),
      `${route} ${colorScheme} application-shell login entry`,
    ).toBeVisible();
  }
  if (route === "/") {
    await expect(
      page.getByRole("textbox", { name: "Message KovaGPT" }),
      `${route} ${colorScheme} composer`,
    ).toBeVisible();
  }

  const layout = await page.evaluate(() => {
    const root = document.documentElement;
    const main = document.querySelector<HTMLElement>("main#main-content");
    const heading = document.querySelector<HTMLElement>("h1");
    const primary = document.querySelector<HTMLElement>("[data-public-primary]");
    const mainRect = main?.getBoundingClientRect();
    const headingStyle = heading ? getComputedStyle(heading) : null;
    return {
      clientWidth: root.clientWidth,
      scrollWidth: root.scrollWidth,
      mainHeight: mainRect?.height ?? 0,
      headingColor: headingStyle?.color ?? "",
      headingVisibility: headingStyle?.visibility ?? "",
      primaryHeight: primary?.getBoundingClientRect().height ?? null,
    };
  });

  expect(layout.scrollWidth, `${route} ${colorScheme} horizontal overflow`).toBeLessThanOrEqual(
    layout.clientWidth + 1,
  );
  expect(layout.mainHeight, `${route} ${colorScheme} main height`).toBeGreaterThan(0);
  expect(layout.headingVisibility, `${route} ${colorScheme} heading visibility`).not.toBe("hidden");
  expect(layout.headingColor, `${route} ${colorScheme} heading color`).not.toBe("rgba(0, 0, 0, 0)");
  if (layout.primaryHeight !== null) {
    expect(layout.primaryHeight, `${route} ${colorScheme} primary action`).toBeGreaterThanOrEqual(
      44,
    );
  }
  expect(runtimeErrors, `${route} ${colorScheme} runtime errors`).toEqual([]);
}

test.describe.parallel("complete public surface matrix", () => {
  routeGroups.forEach((routes, groupIndex) => {
    test(`route group ${groupIndex + 1} passes responsive light and dark checks`, async ({
      page,
    }, testInfo) => {
      test.skip(!verificationProjects.has(testInfo.project.name));
      test.setTimeout(Math.max(4 * 60_000, routes.length * 2 * 20_000));

      const runtimeErrors = watchForRuntimeErrors(page);
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
        for (const route of routes) await verifyRoute(page, route, colorScheme, runtimeErrors);
      }
    });
  });
});
