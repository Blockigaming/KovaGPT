import { expect, test, type Page } from "@playwright/test";

import { PUBLIC_REVIEW_PATHS } from "../../src/lib/seo-policy.mjs";
import { waitForKovaHydration } from "./hydration";

const verificationProjects = new Set([
  "phone-320x700",
  "phone-390x844",
  "phone-landscape-844x390",
  "tablet-768x1024",
  "tablet-1024x768",
  "desktop-1280x800",
  "desktop-1440x900",
]);
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
  ...PUBLIC_REVIEW_PATHS.filter((route) => route.startsWith("/policies/")),
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
  ...PUBLIC_REVIEW_PATHS.filter((route) => route.startsWith("/academy/")),
  ...PUBLIC_REVIEW_PATHS.filter((route) => route.startsWith("/business/")),
  ...PUBLIC_REVIEW_PATHS.filter((route) => route.startsWith("/form/")),
  ...PUBLIC_REVIEW_PATHS.filter((route) => route.startsWith("/global-affairs/")),
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
// Bound each shardable test rather than letting one group consume a whole CI job.
// Every route still runs in both themes on every verification project.
const groupCount = Math.max(1, Math.ceil(routesUnderTest.length / 12));
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
  const response = await page.goto(route, { waitUntil: "domcontentloaded", timeout: 15_000 });
  expect(response?.status(), `${route} ${colorScheme} status`).toBe(200);
  await waitForKovaHydration(page);
  // Guest entry and navigation can change after the session check completes.
  await expect(page.getByRole("dialog", { name: "Checking account", exact: true })).toBeHidden();
  await expect(page.locator("main.kova-session-shell-main")).toHaveCount(0);

  const main = page.locator("main#main-content");
  await expect(main, `${route} ${colorScheme} main`).toHaveCount(1);
  const pageHeading = main.locator("h1");
  await expect(pageHeading, `${route} ${colorScheme} unique page heading`).toHaveCount(1);
  await expect(pageHeading, `${route} ${colorScheme} heading`).toBeVisible();
  const publicNavigation = page.getByRole("navigation", {
    name: "Public navigation",
    exact: true,
  });
  if ((await publicNavigation.count()) === 1) {
    await expect(publicNavigation, `${route} ${colorScheme} navigation`).toBeVisible();
    await expect(page.getByRole("contentinfo"), `${route} ${colorScheme} footer`).toBeVisible();
  } else {
    await expect(
      page.getByRole("button", { name: /^Log in(?: to KovaGPT)?$/u }).first(),
      `${route} ${colorScheme} application-shell login entry`,
    ).toBeVisible();
  }
  if (route === "/") {
    await expect(
      page.getByRole("textbox", { name: "Message KovaGPT" }),
      `${route} ${colorScheme} account-gated composer`,
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Create an account", exact: true }),
    ).toBeVisible();
  }

  const layout = await page.evaluate(() => {
    const root = document.documentElement;
    const main = document.querySelector<HTMLElement>("main#main-content");
    const heading = main?.querySelector<HTMLElement>("h1");
    const primary = document.querySelector<HTMLElement>("[data-public-primary]");
    const mainRect = main?.getBoundingClientRect();
    const headingStyle = heading ? getComputedStyle(heading) : null;
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      clientWidth: root.clientWidth,
      scrollWidth: root.scrollWidth,
      isDark: root.classList.contains("dark"),
      mainHeight: mainRect?.height ?? 0,
      headingColor: headingStyle?.color ?? "",
      headingVisibility: headingStyle?.visibility ?? "",
      primaryHeight: primary?.getBoundingClientRect().height ?? null,
    };
  });

  expect(layout.viewportWidth, `${route} ${colorScheme} viewport width`).toBe(
    page.viewportSize()?.width,
  );
  expect(layout.viewportHeight, `${route} ${colorScheme} viewport height`).toBe(
    page.viewportSize()?.height,
  );
  expect(layout.isDark, `${route} ${colorScheme} applied theme`).toBe(colorScheme === "dark");
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

      // The app defaults to dark and persists its preference across navigations.
      // Use its system setting so both emulated themes are actually rendered.
      await page.addInitScript(() => localStorage.setItem("kova-theme-mode", "system"));
      const runtimeErrors = watchForRuntimeErrors(page);
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
        for (const route of routes) {
          await test.step(`${colorScheme} ${route}`, () =>
            verifyRoute(page, route, colorScheme, runtimeErrors));
        }
      }
    });
  });
});
