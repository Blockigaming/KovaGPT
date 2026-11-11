import { expect, test } from "@playwright/test";
import { fixture } from "./actual-app-fixture";
import { chooseSettingsSection, openCurrentSettings } from "./current-ui";
import { waitForKovaHydration } from "./hydration";

const supportedProjects = new Set(["desktop-1440x900", "phone-390x844"]);

// These cases exercise app-owned operation paths, not window.dispatchEvent("kova:notice").
// The authenticated backend is isolated by fixture(), so they are browser integration
// evidence, not a claim about production mail, billing, or notification delivery.
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(!supportedProjects.has(testInfo.project.name));
  await fixture(page, "dark", true, false);
  await page.goto("/");
  await waitForKovaHydration(page);
});

test("offline and recovery notices come from real browser connection state", async ({
  page,
  context,
}, testInfo) => {
  await context.setOffline(true);
  const offlineStatus = page.getByRole("status").filter({ hasText: "You're offline" });
  await expect(offlineStatus).toBeAttached();
  await context.setOffline(false);
  await expect(page.getByText("Browser connection restored", { exact: true })).toBeVisible();
  await testInfo.attach("network-recovery-" + testInfo.project.name, {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

test("saving an appearance choice emits its own notice in light mode", async ({
  page,
}, testInfo) => {
  const settings = await openCurrentSettings(page);
  await chooseSettingsSection(page, "Appearance");
  const theme = settings.getByRole("combobox", { name: "Theme", exact: true });
  await expect(theme).toBeVisible();
  await theme.click();
  await page.getByRole("option", { name: "Light", exact: true }).click();
  await expect(page.getByText("Appearance changed", { exact: true })).toBeVisible();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await testInfo.attach("appearance-light-notice-" + testInfo.project.name, {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});
