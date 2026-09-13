import { expect, test, type Page } from "@playwright/test";

import { PUBLIC_REVIEW_PATHS } from "../../src/lib/seo-policy.mjs";
import { waitForKovaHydration } from "./hydration";

const verificationProjects = new Set(["phone-390x844", "tablet-1024x768", "desktop-1440x900"]);

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

const routeGroups = Array.from({ length: 12 }, (_, groupIndex) =>
  PUBLIC_REVIEW_PATHS.filter((_, routeIndex) => routeIndex % 12 === groupIndex),
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
      test.setTimeout(4 * 60_000);

      const runtimeErrors = watchForRuntimeErrors(page);
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
        for (const route of routes) await verifyRoute(page, route, colorScheme, runtimeErrors);
      }
    });
  });
});
