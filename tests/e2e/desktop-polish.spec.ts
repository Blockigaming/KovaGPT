import { expect, test } from "@playwright/test";
import { waitForKovaHydration } from "./hydration";

const desktopProjects = new Set(["desktop-1280x800", "desktop-1440x900", "desktop-1728x1117"]);

test("collapsed sidebar leaves the layout and reopens from its external control", async ({
  page,
}, testInfo) => {
  test.skip(!desktopProjects.has(testInfo.project.name));
  await page.addInitScript(() => localStorage.setItem("kova-sidebar-open", "0"));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);

  const sidebar = page.locator(".kova-sidebar");
  await expect(sidebar).toHaveCSS("width", "0px");
  await expect(sidebar).toHaveAttribute("aria-hidden", "true");

  const openSidebar = page.getByRole("button", { name: "Open sidebar" });
  await expect(openSidebar).toBeVisible();
  await openSidebar.click();

  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(navigation).toBeVisible();
  await expect(sidebar).toHaveCSS("width", "260px");
  const collapseSidebar = page.getByRole("button", { name: "Collapse sidebar" });
  await expect(collapseSidebar).toBeVisible();
  await expect(collapseSidebar).toBeFocused();
  await collapseSidebar.click();
  await expect(sidebar).toHaveCSS("width", "0px");
  await expect(openSidebar).toBeFocused();

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
    await waitForKovaHydration(page);
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
