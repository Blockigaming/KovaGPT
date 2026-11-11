import { expect, test } from "@playwright/test";
import { fixture, functionNames } from "./actual-app-fixture";
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

test("[notice:network_offline][notice:network_restored] offline and recovery notices come from real browser connection state", async ({
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

test("[notice:theme_changed] saving an appearance choice emits its own notice in light mode", async ({
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

const serverFunctionName = (url: string) =>
  functionNames.get(new URL(url).pathname.split("/").at(-1) ?? "") ?? "";

test("[contract:offer_available] a server-eligible account receives the offer and details", async ({
  page,
}, testInfo) => {
  let eligibilityCalls = 0;
  await page.route("**/_serverFn/**", async (route) => {
    if (!serverFunctionName(route.request().url()).startsWith("getFreeOfferEligibility_")) {
      return route.fallback();
    }
    eligibilityCalls++;
    return route.fulfill({ json: { result: { eligible: true }, context: {} } });
  });
  await page.reload();
  await waitForKovaHydration(page);
  await expect.poll(() => eligibilityCalls).toBeGreaterThan(0);
  const notice = page.getByRole("dialog", { name: "A Plus offer is available" });
  await expect(notice).toBeVisible();
  await testInfo.attach("eligible-offer-notice-" + testInfo.project.name, {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await notice.getByRole("button", { name: "Not now" }).click();
  const offerButton = page.locator('[data-free-introductory-offer="true"]').first();
  await expect(offerButton).toBeVisible();
  await offerButton.click();
  const details = page.getByRole("dialog", { name: "50% off your first month of Plus" });
  await expect(details).toBeVisible();
  await testInfo.attach("eligible-offer-details-" + testInfo.project.name, {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

test("[contract:whats_new] server-approved campaign renders and saves dismissal", async ({
  page,
}, testInfo) => {
  let dismissals = 0;
  const campaign = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    eventId: "whats_new",
    releaseId: "verified-fixture-release",
    title: "A Kova release is ready",
    message: "Explore a verified feature release.",
    actionUrl: "/images",
  };
  await page.route("**/_serverFn/**", async (route) => {
    const name = serverFunctionName(route.request().url());
    if (name.startsWith("listEligibleAnnouncementCampaigns_")) {
      return route.fulfill({ json: { result: [campaign], context: {} } });
    }
    if (name.startsWith("dismissAnnouncementCampaign_")) {
      dismissals++;
      return route.fulfill({ json: { result: { ok: true }, context: {} } });
    }
    return route.fallback();
  });
  await page.reload();
  await waitForKovaHydration(page);
  const announcement = page.getByRole("dialog", { name: campaign.title });
  await expect(announcement).toBeVisible();
  await expect(announcement).toHaveAttribute("aria-modal", "true");
  await testInfo.attach("release-campaign-" + testInfo.project.name, {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await announcement.getByRole("button", { name: "Not now" }).click();
  await expect(announcement).toHaveCount(0);
  await expect.poll(() => dismissals).toBeGreaterThan(0);
});

test("[contract:ineligible] absent backend offers and campaigns stay hidden", async ({ page }) => {
  let offerChecks = 0;
  let campaignChecks = 0;
  await page.route("**/_serverFn/**", async (route) => {
    const name = serverFunctionName(route.request().url());
    if (name.startsWith("getFreeOfferEligibility_")) {
      offerChecks++;
      return route.fulfill({ json: { result: { eligible: false }, context: {} } });
    }
    if (name.startsWith("listEligibleAnnouncementCampaigns_")) {
      campaignChecks++;
      return route.fulfill({ json: { result: [], context: {} } });
    }
    return route.fallback();
  });
  await page.reload();
  await waitForKovaHydration(page);
  await expect.poll(() => offerChecks).toBeGreaterThan(0);
  await expect.poll(() => campaignChecks).toBeGreaterThan(0);
  await expect(page.locator('[data-free-introductory-offer="true"]')).toHaveCount(0);
  await expect(page.locator(".kova-notice-panel[data-group='announcements']")).toHaveCount(0);
});
