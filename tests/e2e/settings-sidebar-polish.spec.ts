import { expect, test } from "@playwright/test";
import { fixture } from "./actual-app-fixture";
import { waitForKovaHydration } from "./hydration";

test("collapsed sidebar and menus stay rounded, clean, and usable", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-1440x900");
  await fixture(page, "dark", true, true);
  await page.goto("/");
  await waitForKovaHydration(page);
  const sidebar = page.getByRole("navigation", { name: "Primary navigation", exact: true });
  const options = sidebar.getByRole("button", { name: "Options for Composer review chat" });
  await options.hover();
  await options.click();
  const chatMenu = page.locator(".kova-sidebar-chat-menu");
  await expect(chatMenu).toHaveCSS("border-top-width", "0px");
  await chatMenu.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const rename = page.getByRole("dialog", { name: "Rename chat" });
  await expect(rename).toBeVisible();
  await rename.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(rename).toBeHidden();

  const openRadius = await sidebar.evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
  await sidebar.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
  const rail = page.getByRole("navigation", { name: "Collapsed navigation", exact: true });
  await expect(rail).toHaveCSS("border-top-left-radius", openRadius);
  await expect(rail).toHaveCSS("border-bottom-right-radius", openRadius);
  await rail.getByRole("button", { name: "Account menu", exact: true }).click();
  const accountMenu = page.locator(".kova-profile-menu");
  await expect(accountMenu).toBeVisible();
  await expect(accountMenu).toHaveCSS("border-top-width", "0px");
  await page.keyboard.press("Escape");
  await rail.getByRole("button", { name: "Expand sidebar", exact: true }).click();
  await expect(sidebar).toBeVisible();
});

test("desktop Settings width is editable and Back restores the originating page", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop-1440x900");
  await fixture(page, "dark", true, false, "free", { preserveStorageOnReload: true });
  await page.goto("/library?return-check=1");
  await waitForKovaHydration(page);
  const previousUrl = page.url();
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/appearance$/);
  const settings = page.locator(".kova-settings-page");
  const navigation = settings.getByRole("complementary", { name: "Settings navigation" });
  const width = settings.getByRole("slider", { name: "Settings sidebar width" });
  await expect(width).toHaveAttribute("aria-valuenow", "280");
  await expect(navigation).toHaveCSS("width", "280px");
  const thumb = (await width.boundingBox())!;
  const track = (await settings
    .locator('[data-slot="slider"]')
    .filter({ has: width })
    .boundingBox())!;
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
  await page.mouse.down();
  await page.mouse.move(track.x + track.width + 1, thumb.y + thumb.height / 2, { steps: 8 });
  await expect(width).toHaveAttribute("aria-valuenow", "440");
  await expect(navigation).toHaveCSS("width", "280px");
  await page.mouse.up();
  await expect(navigation).toHaveCSS("width", "440px");
  await width.press("Home");
  await expect(width).toHaveAttribute("aria-valuenow", "200");
  await expect(navigation).toHaveCSS("width", "200px");
  await navigation.getByRole("tab", { name: "Profile", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/profile$/);
  await settings.getByRole("button", { name: "Back to previous page", exact: true }).click();
  await expect(page).toHaveURL(previousUrl);
});

test("appearance sliders stay reachable on a narrow phone", async ({ page }, info) => {
  test.skip(!["phone-320x700", "phone-390x844"].includes(info.project.name));
  await fixture(page, "dark");
  await page.goto("/settings/appearance");
  await waitForKovaHydration(page);
  const width = page.getByRole("slider", { name: "Settings sidebar width" });
  const size = page.getByRole("slider", { name: "Interface size" });
  for (const slider of [size, width]) await expect(slider).toBeInViewport({ ratio: 0.95 });
  await width.press("End");
  await expect(width).toHaveAttribute("aria-valuenow", "440");
  await width.press("Home");
  await expect(width).toHaveAttribute("aria-valuenow", "200");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width + 1,
  );
});
