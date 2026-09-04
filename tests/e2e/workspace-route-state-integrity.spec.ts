import { expect, test, type Page } from "@playwright/test";

import { waitForKovaHydration } from "./hydration";

const auditedProjects = new Set(["phone-390x844", "desktop-1440x900"]);

test.beforeEach(({ page }, testInfo) => {
  void page;
  test.skip(!auditedProjects.has(testInfo.project.name));
});

async function expectMainTarget(page: Page) {
  const main = page.locator("#main-content");
  await expect(main).toHaveCount(1);
  await expect(main).toHaveJSProperty("tagName", "MAIN");
  await expect(page.locator('a[href="#main-content"]').first()).toHaveAttribute(
    "href",
    "#main-content",
  );
}

async function expectNoViewportOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

test("signed-out workspace routes keep one main target and only truthful controls", async ({
  page,
}) => {
  const routes = [
    { path: "/projects", gate: "Sign in to use Projects" },
    { path: "/projects/unavailable-project", gate: "Sign in to use Projects" },
    { path: "/files", gate: "Sign in to use Files" },
    { path: "/memory", gate: "Sign in to manage memory" },
    { path: "/research-planner", gate: "Sign in to plan research" },
  ];

  for (const route of routes) {
    await page.goto(route.path, { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    await expectMainTarget(page);
    await expect(page.getByRole("heading", { name: route.gate, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    await expectNoViewportOverflow(page);
  }

  await page.goto("/files", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expect(page.getByPlaceholder("Search files")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Duplicates", exact: true })).toHaveCount(0);

  await page.goto("/memory", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expect(page.getByPlaceholder("Search memories")).toHaveCount(0);
  await expect(page.getByRole("toolbar", { name: "Filter memories by source" })).toHaveCount(0);

  await page.goto("/research-planner", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expect(page.getByLabel("Research question")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start Deep Research" })).toHaveCount(0);
});
