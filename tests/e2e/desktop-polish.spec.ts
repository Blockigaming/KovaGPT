import { expect, test } from "@playwright/test";

const desktopProjects = new Set(["desktop-1280x800", "desktop-1440x900", "desktop-1728x1117"]);

test("collapsed rail, expanded sidebar, and composer stay contained", async ({
  page,
}, testInfo) => {
  test.skip(!desktopProjects.has(testInfo.project.name));
  await page.addInitScript(() => localStorage.setItem("kova-sidebar-open", "0"));
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const sidebar = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(sidebar).toBeVisible();
  await expect(sidebar).toHaveCSS("width", "64px");
  const rail = await sidebar.boundingBox();
  const expand = page.getByRole("button", { name: "Expand sidebar" });
  await expect(expand).toBeVisible();
  const trigger = await expand.boundingBox();
  expect(rail).not.toBeNull();
  expect(trigger).not.toBeNull();
  expect(trigger!.x).toBeGreaterThanOrEqual(rail!.x);
  expect(trigger!.x + trigger!.width).toBeLessThanOrEqual(rail!.x + rail!.width);

  await expand.click();
  await expect(sidebar).toHaveCSS("width", "260px");
  await expect(page.getByRole("button", { name: "Collapse sidebar" })).toBeVisible();

  const composer = page.locator(".kova-composer");
  await expect(composer).toBeVisible();
  const composerBox = await composer.boundingBox();
  expect(composerBox).not.toBeNull();
  expect(composerBox!.width).toBeLessThanOrEqual(768);
  const overflow = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);
});

test("desktop workspaces remain overflow-free at supported widths", async ({ page }, testInfo) => {
  test.skip(!desktopProjects.has(testInfo.project.name));
  for (const route of ["/projects", "/library", "/apps", "/scheduled-tasks", "/help"]) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toBeVisible();
    const overflow = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(overflow.scroll, `${route} should not overflow`).toBeLessThanOrEqual(
      overflow.client + 1,
    );
  }
});
