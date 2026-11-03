import { expect, test } from "@playwright/test";

import { waitForKovaHydration } from "./hydration";
import { fixture } from "./actual-app-fixture";

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
    await waitForKovaHydration(page);
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
  await fixture(page, "dark", true);
  await page.goto("/library", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  const refresh = page.getByRole("button", { name: /Refresh/i });
  await expect(refresh).toBeEnabled();
  await expect(async () => {
    await refresh.focus();
    await page.waitForTimeout(100);
    await expect(refresh).toBeFocused();
  }).toPass({ timeout: 5_000 });

  if (page.viewportSize()!.width < 1024) {
    const box = await refresh.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
});

test("inline sign-in preserves keyboard focus and entered email after Escape", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  const email = page.getByRole("textbox", { name: "Email address", exact: true });
  await email.fill("keyboard-check@example.invalid");
  await page.keyboard.press("Escape");
  await expect(email).toBeVisible();
  await expect(email).toBeFocused();
  await expect(email).toHaveValue("keyboard-check@example.invalid");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Continue with email", exact: true }),
  ).toBeFocused();
});
