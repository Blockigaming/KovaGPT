import { expect, test } from "@playwright/test";

const projects = new Set(["phone-390x844", "desktop-1440x900"]);

test.beforeEach(({ page: _page }, testInfo) => test.skip(!projects.has(testInfo.project.name)));

test("production responses include compatible security headers", async ({ request }) => {
  const response = await request.get("/");
  expect(response.ok()).toBeTruthy();
  const headers = response.headers();
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("SAMEORIGIN");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["permissions-policy"]).toContain("geolocation=(self)");
});

test("keyboard users can dismiss menus and dialogs with focus restoration", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const width = page.viewportSize()!.width;

  if (width < 1024) {
    const menu = page.getByRole("button", { name: "Open menu" });
    await menu.focus();
    await page.keyboard.press("Enter");
    const navigation = page.getByRole("dialog", { name: "Primary navigation" });
    await expect(navigation).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(navigation).toBeHidden();
    await expect(menu).toBeFocused();
    await menu.press("Enter");
  }

  const settings = page.getByRole("button", { name: "Settings" }).first();
  await settings.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: /Settings/i });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(
    width < 1024 ? page.getByRole("button", { name: "Open menu" }) : settings,
  ).toBeFocused();
});

test("keyboard focus is visibly distinguishable on primary controls", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const target =
    page.viewportSize()!.width < 1024
      ? page.getByRole("button", { name: "Open menu" })
      : page.getByRole("button", { name: "New chat" }).first();
  await target.focus();
  const focusStyle = await target.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  expect(focusStyle.outlineStyle).not.toBe("none");
  expect(Number.parseFloat(focusStyle.outlineWidth)).toBeGreaterThanOrEqual(2);
});
