import { expect, test } from "@playwright/test";
import { NOTIFICATION_ACCEPTANCE_PROJECTS } from "../../src/lib/notification-acceptance-evidence.mjs";
import { fixture, functionNames } from "./actual-app-fixture";
import { chooseSettingsSection, openCurrentSettings } from "./current-ui";
import { waitForKovaHydration } from "./hydration";

const supportedProjects = new Set(NOTIFICATION_ACCEPTANCE_PROJECTS);

// These cases exercise app-owned operation paths, not window.dispatchEvent("kova:notice").
// The authenticated backend is isolated by fixture(), so they are browser integration
// evidence, not a claim about production mail, billing, or notification delivery.
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(!supportedProjects.has(testInfo.project.name));
  await fixture(page, "dark", true, testInfo.title.includes("[notice:network_offline]"));
  await page.goto("/");
  await waitForKovaHydration(page);
});

test("[notice:network_offline][notice:network_restored] offline and recovery notices come from real browser connection state", async ({
  page,
  context,
}, testInfo) => {
  const dock = page.locator(".spec400-composer-dock");
  const composer = dock.getByRole("textbox", { name: "Message KovaGPT" });
  const draft = "Release notes draft\n\nKeep this text while offline.\n\nCheck composer clearance.";
  await expect(composer).toBeEnabled();
  await composer.fill(draft);
  await context.setOffline(true);
  const offline = page.locator("[data-sonner-toast]").filter({ hasText: "You're offline" });
  await expect(offline).toBeVisible();
  await expect
    .poll(async () => {
      const [toast, input] = await Promise.all([offline.boundingBox(), dock.boundingBox()]);
      return Boolean(toast && input && toast.y + toast.height <= input.y + 1);
    })
    .toBe(true);
  await context.setOffline(false);
  await expect(offline).toBeHidden();
  const restored = page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "Browser connection restored" });
  await expect(restored).toBeVisible();
  await testInfo.attach("network-recovery-" + testInfo.project.name, {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await restored.getByRole("button", { name: "Close toast" }).click();
  await expect(restored).toBeHidden();
  await expect(composer).toHaveValue(draft);
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

test("[notice:first_conversation] empty synchronized history offers the first conversation without blocking chat", async ({
  page,
}, testInfo) => {
  const notice = page.locator('[data-kova-notice-id="first_conversation"]');
  const composer = page.getByRole("textbox", { name: "Message KovaGPT" });
  await expect(notice).toBeVisible();
  await expect(page.locator('[data-kova-notice-id="welcome_back"]')).toHaveCount(0);
  await composer.fill("Write a short release summary.");
  await expect(composer).toHaveValue("Write a short release summary.");
  await expect(composer).toBeFocused();
  await testInfo.attach("first-conversation-" + testInfo.project.name, {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

test("[notice:shared_task_unavailable] an inaccessible task-copy link offers a safe return", async ({
  page,
}, testInfo) => {
  let checkedOffers = 0;
  await page.route("**/_serverFn/**", async (route) => {
    const name = serverFunctionName(route.request().url());
    if (name.startsWith("isScheduledTasksEligible_")) {
      return route.fulfill({
        json: { result: { eligible: true, executionAvailable: false }, context: {} },
      });
    }
    if (name.startsWith("listScheduledTaskOffers_")) {
      checkedOffers++;
      return route.fulfill({
        json: { result: { sent: [], received: [], linked: null }, context: {} },
      });
    }
    return route.fallback();
  });
  await page.goto("/scheduled-tasks?offerId=11111111-1111-4111-8111-111111111111");
  await waitForKovaHydration(page);
  const notice = page.locator('[data-kova-notice-id="shared_task_unavailable"]');
  await expect.poll(() => checkedOffers).toBeGreaterThan(0);
  await expect(notice).toContainText("This task copy link is unavailable for this account.");
  await expect(page.getByRole("button", { name: "Accept paused copy" })).toHaveCount(0);
  await testInfo.attach("unavailable-task-copy-" + testInfo.project.name, {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await notice.getByRole("link", { name: "Back to scheduled tasks" }).click();
  await expect(notice).toHaveCount(0);
});

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
  if (page.viewportSize()!.width <= 640) {
    await expect
      .poll(async () => {
        const rect = await details.boundingBox();
        return rect ? Math.abs(rect.y + rect.height - page.viewportSize()!.height) : 999;
      })
      .toBeLessThan(5);
  }
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

test("[notice:no_matching_files] filters show no matching files only after a search", async ({
  page,
}, info) => {
  await page.goto("/files");
  await waitForKovaHydration(page);
  const search = page.getByRole("textbox", { name: "Search files" });
  const emptyResult = page.locator('[data-kova-notice-id="no_matching_files"]');
  await expect(search).toBeVisible();
  await expect(emptyResult).toHaveCount(0);
  await search.fill("unmatched review filename");
  await expect(emptyResult.getByRole("heading", { name: "No matching files" })).toBeVisible();
  await info.attach("file-search-no-results", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await search.clear();
  await expect(emptyResult).toHaveCount(0);
});
