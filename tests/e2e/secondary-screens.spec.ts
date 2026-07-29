import { expect, test } from "@playwright/test";

const projects = new Set(["phone-320x700", "phone-390x844", "desktop-1440x900"]);
const routes = [
  "/library",
  "/projects",
  "/apps",
  "/scheduled-tasks",
  "/pricing",
  "/reset-password",
];

test.beforeEach(({ page: _page }, testInfo) => test.skip(!projects.has(testInfo.project.name)));

test("secondary screens preserve hierarchy and viewport containment", async ({ page }) => {
  test.setTimeout(60_000);
  for (const route of routes) {
    const response = await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(response?.status(), route).toBeLessThan(500);
    await expect(page.locator("h1").first()).toBeVisible();
    const overflow = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(overflow.scroll, route).toBeLessThanOrEqual(overflow.client + 1);
  }
});

test("secondary controls remain keyboard-visible and touchable", async ({ page }) => {
  await page.goto("/library", { waitUntil: "domcontentloaded" });
  const refresh = page.getByRole("button", { name: /Refresh/i });
  await refresh.focus();
  await expect(refresh).toBeFocused();

  if (page.viewportSize()!.width < 1024) {
    const box = await refresh.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
});

test("auth dialog dismisses with Escape and restores its trigger", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const login = page.getByRole("button", { name: "Log in" }).first();
  await login.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(login).toBeFocused();
});
