import { expect, test } from "@playwright/test";
import { fromJSON } from "seroval";
import { checkoutIntroOfferOriginKey } from "../../src/lib/checkout-notice-policy.mjs";
import { NOTIFICATION_ACCEPTANCE_PROJECTS } from "../../src/lib/notification-acceptance-evidence.mjs";
import { fixture, functionNames, owner } from "./actual-app-fixture";
import { reviewItems } from "./core-app-fixture";
import { chooseSettingsSection, openCurrentSettings } from "./current-ui";
import { waitForKovaHydration } from "./hydration";

const supportedProjects = new Set(NOTIFICATION_ACCEPTANCE_PROJECTS);

// These cases exercise app-owned operation paths, not window.dispatchEvent("kova:notice").
// The authenticated backend is isolated by fixture(), so they are browser integration
// evidence, not a claim about production mail, billing, or notification delivery.
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(!supportedProjects.has(testInfo.project.name));
  const saved = /\[notice:(network_offline|conversation_full)\]/u.test(testInfo.title);
  await fixture(page, "dark", true, saved, "free", {
    preserveStorageOnReload: testInfo.title.includes("[contract:did_you_know]"),
  });
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

test("[notice:conversation_full][notice:conversation_continue] a saved summary opens as an editable draft after context exhaustion", async ({
  page,
}) => {
  let requestChatId: string | null = null;
  let sends = 0;
  let sendSummary!: () => void;
  const waitForSummary = new Promise<void>((resolve) => {
    sendSummary = resolve;
  });
  await page.route("**/api/chat", (route) => {
    sends++;
    requestChatId = route.request().postDataJSON().chatId;
    return route.fulfill({
      status: 400,
      json: {
        code: "CONTEXT_LIMIT",
        error: "This conversation reached its context limit.",
        retryable: false,
      },
    });
  });
  await page.route(
    (url) => url.pathname === "/api/memory" && url.searchParams.has("continuationChatId"),
    async (route) => {
      const id = new URL(route.request().url()).searchParams.get("continuationChatId");
      expect(id).toBeTruthy();
      expect(id).toBe(requestChatId);
      expect(route.request().headers()["x-kova-owner"]).toBe(owner);
      await waitForSummary;
      return route.fulfill({
        json: { summary: "Keep the original decision to use the blue design." },
      });
    },
  );
  const composer = page.getByRole("textbox", { name: "Message KovaGPT" });
  await composer.fill("Continue the design discussion.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const recovery = page.getByRole("region", { name: "Conversation limit" });
  await expect(recovery).toBeVisible();
  await expect(recovery).toHaveAttribute("data-kova-notice-id", "conversation_full");
  sendSummary();
  await expect(recovery).toHaveAttribute("data-kova-notice-id", "conversation_continue");
  const continueButton = recovery.getByRole("button", { name: "Continue with summary" });
  await composer.fill("Protect this unsent text.");
  await expect(continueButton).toBeDisabled();
  await expect(composer).toHaveValue("Protect this unsent text.");
  await composer.clear();
  await continueButton.click();
  await expect(composer).toHaveValue(
    "Continue from this saved conversation summary:\n\nKeep the original decision to use the blue design.",
  );
  await expect(recovery).toBeHidden();
  expect(sends).toBe(1);
});

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

test("[notice:guided_tour][notice:tour_finished] the optional tour highlights actual chat controls and restores focus", async ({
  page,
}, testInfo) => {
  const trigger = page.getByRole("button", { name: "Take a quick tour", exact: true });
  const tour = page.getByRole("dialog", { name: "KovaGPT quick tour" });
  const spotlight = page.locator("[data-tour-spotlight]");
  await expect(tour).toBeHidden();
  await trigger.click();
  for (const [index, title] of [
    "Write a message",
    "Explore your tools",
    "Choose how Kova responds",
    "Meet the sidebar",
  ].entries()) {
    await expect(tour.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(tour.getByText(`Step ${index + 1} of 4`)).toBeVisible();
    await expect(spotlight).toBeVisible();
    await expect
      .poll(async () => {
        const rect = await tour.boundingBox();
        const viewport = page.viewportSize();
        return !!(
          rect &&
          viewport &&
          rect.x >= -1 &&
          rect.y >= -1 &&
          rect.x + rect.width <= viewport.width + 1 &&
          rect.y + rect.height <= viewport.height + 1
        );
      })
      .toBe(true);
    if (index === 1)
      await testInfo.attach("chat-tour-tools-" + testInfo.project.name, {
        body: await page.screenshot(),
        contentType: "image/png",
      });
    await tour.getByRole("button", { name: "Next", exact: true }).click();
  }
  await expect(tour).toHaveAttribute("data-kova-notice-id", "tour_finished");
  await expect(tour.getByRole("heading", { name: "You’re all set" })).toBeVisible();
  await expect(spotlight).toHaveCount(0);
  await tour.getByRole("button", { name: "Finish", exact: true }).click();
  await expect(tour).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await tour.getByRole("button", { name: "Skip tour" }).click();
  await expect(tour).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.getByRole("textbox", { name: "Message KovaGPT" }).fill("Continue typing.");
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

test("[contract:offer_available][contract:offer_ineligible] verified offer details recheck eligibility before continuing", async ({
  page,
}, testInfo) => {
  let eligibilityCalls = 0;
  let eligible = true;
  let checkoutCalls = 0;
  await page.route("**/_serverFn/**", async (route) => {
    const name = serverFunctionName(route.request().url());
    if (name.startsWith("createCheckoutSession_")) checkoutCalls++;
    if (!name.startsWith("getFreeOfferEligibility_")) {
      return route.fallback();
    }
    eligibilityCalls++;
    return route.fulfill({
      json: { result: eligible ? { eligible } : { eligible, reason: "ineligible" }, context: {} },
    });
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
  const offerButton = page.getByRole("button", { name: "Free offer: 50% off your first month" });
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
  eligible = false;
  await details.getByRole("button", { name: "Get 50% off Plus" }).click();
  const unavailable = page.getByRole("dialog", { name: "This offer is unavailable" });
  await expect(unavailable.getByRole("status")).toContainText(
    "This introductory offer is unavailable for your account.",
  );
  expect(checkoutCalls).toBe(0);
  await expect(page).toHaveURL(/\/$/u);
  await unavailable.getByRole("button", { name: "Done", exact: true }).click();
  await expect(unavailable).toBeHidden();
  await expect(offerButton).toBeHidden();
  await expect(page.getByRole("main")).toBeFocused();
});

test("[contract:offer_claimed] a paid matching Stripe receipt recovers on return and confirms once", async ({
  page,
}) => {
  const sessionId = `cs_live_${"Ab12".repeat(6)}`;
  const offerKey = checkoutIntroOfferOriginKey(owner, sessionId)!;
  let checks = 0;
  let applied = false;
  await page.route("**/_serverFn/**", async (route) => {
    const name = serverFunctionName(route.request().url());
    if (name.startsWith("getSubscriptionSummary_")) {
      return route.fulfill({ json: { result: { tier: "plus" }, context: {} } });
    }
    if (name.startsWith("getCheckoutIntroOfferStatus_")) {
      checks++;
      return route.fulfill({ json: { result: { applied }, context: {} } });
    }
    return route.fallback();
  });
  await page.goto(`/checkout/return?session_id=${sessionId}`);
  const confirmedPlan = page.getByRole("heading", { name: "Current subscription confirmed" });
  const notice = page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "Introductory offer applied" });
  await expect(confirmedPlan).toBeVisible();
  expect(checks).toBe(0);
  await expect(notice).toBeHidden();

  await page.evaluate(
    ([key, ownerId]) =>
      sessionStorage.setItem(key, JSON.stringify({ ownerId, startedAt: Date.now() })),
    [offerKey, owner],
  );
  await page.reload();
  await expect.poll(() => checks).toBe(1);
  await expect(confirmedPlan).toBeVisible();
  await expect(notice).toBeHidden();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), offerKey)).not.toBeNull();

  applied = true;
  await page.reload();
  await expect(notice).toBeVisible();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), offerKey)).toBeNull();
  await page.reload();
  await expect(confirmedPlan).toBeVisible();
  expect(checks).toBe(2);
  await expect(notice).toBeHidden();
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

test("[contract:reference_saved][contract:quick_tip] a named image reference is acknowledged only after Library saves it", async ({
  page,
}, testInfo) => {
  const imageUrl =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X01cAAAAASUVORK5CYII=";
  const itemId = "550e8400-e29b-41d4-a716-446655440001";
  const writes: Record<string, unknown>[] = [];
  let savedTitle = "";
  await page.route("**/api/generate-image**", async (route) => {
    if (route.request().method() === "POST") return route.fulfill({ json: { imageUrl } });
    return route.fulfill({
      json: {
        editingEnabled: true,
        images: savedTitle ? [{ id: itemId, title: savedTitle, file_type: "image/png" }] : [],
      },
    });
  });
  await page.route("**/_serverFn/**", async (route) => {
    if (!serverFunctionName(route.request().url()).startsWith("saveImageToLibrary_"))
      return route.fallback();
    const request = fromJSON(route.request().postDataJSON()) as { data: Record<string, unknown> };
    writes.push(request.data);
    if (writes.length === 1) return route.abort("failed");
    savedTitle = String(request.data.title);
    return route.fulfill({ json: { result: { id: itemId }, context: {} } });
  });
  await page.goto("/images");
  await waitForKovaHydration(page);
  await page.getByRole("textbox", { name: "Describe the image to generate" }).fill("A paper bird");
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  const openReference = page.getByRole("button", { name: "Save as reference", exact: true });
  await openReference.click();
  const dialog = page.getByRole("dialog", { name: "Save reference image" });
  const name = dialog.getByRole("textbox", { name: "Reference name" });
  const save = dialog.getByRole("button", { name: "Save reference", exact: true });
  await save.click();
  await expect(dialog.getByRole("alert")).toHaveText("Enter a reference name.");
  await expect(name).toBeFocused();
  expect(writes).toHaveLength(0);

  await name.fill("Paper bird");
  await save.click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "The reference could not be saved. Try again.",
  );
  await expect(page.getByText("Reference saved", { exact: true })).toHaveCount(0);
  await expect(name).toHaveValue("Paper bird");
  await save.click();
  await expect(dialog).toBeHidden();
  await expect(openReference).toBeFocused();
  const confirmation = page.locator("[data-sonner-toast]").filter({ hasText: "Reference saved" });
  await expect(confirmation).toBeVisible();
  expect(writes).toHaveLength(2);
  expect(writes[0]).toMatchObject({ title: "Paper bird", expectedOwnerId: owner, imageUrl });
  expect(writes[0].idempotencyKey).toEqual(expect.any(String));
  expect(writes[1]).toEqual(writes[0]);
  await testInfo.attach("named-reference-" + testInfo.project.name, {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await confirmation.getByRole("button", { name: "Close toast" }).click();
  await expect(confirmation).toBeHidden();

  await page.reload();
  await waitForKovaHydration(page);
  await page.getByRole("button", { name: "Edit an image from Library" }).click();
  await page.getByRole("combobox", { name: "Original image" }).click();
  await page.getByRole("option", { name: "Paper bird", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Describe the image edit" })).toBeVisible();
  const tip = page.locator('[data-kova-notice-id="quick_tip"]');
  await expect(tip).toContainText("optional transparent PNG mask");
  await tip.getByRole("button", { name: "Got it" }).click();
  await expect(tip).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Original image" })).toBeFocused();
  await page.getByRole("button", { name: "Generate a new image instead" }).click();
  await page.getByRole("button", { name: "Edit an image from Library" }).click();
  await page.getByRole("combobox", { name: "Original image" }).click();
  await page.getByRole("option", { name: "Paper bird", exact: true }).click();
  await expect(tip).toHaveCount(0);
});

test("[contract:did_you_know] Library filter discovery stays dismissed after reload", async ({
  page,
}) => {
  await page.route("**/api/library/items**", (route) =>
    route.fulfill({ json: { items: reviewItems, cursor: null, hasMore: false } }),
  );
  await page.goto("/library");
  await waitForKovaHydration(page);
  const tip = page.locator('[data-kova-notice-id="did_you_know"]');
  const filters = page.getByRole("button", { name: "Filters", exact: true });
  await expect(page.getByText("Release notes", { exact: true })).toBeVisible();
  await expect(tip).toHaveCount(0);
  await filters.click();
  await expect(tip).toContainText("Combine a Library search");
  await tip.getByRole("button", { name: "Got it" }).click();
  await expect(tip).toHaveCount(0);
  await page.reload();
  await waitForKovaHydration(page);
  await expect(page.getByText("Release notes", { exact: true })).toBeVisible();
  await filters.click();
  await expect(page.getByText("Filter loaded items", { exact: true })).toBeVisible();
  await expect(tip).toHaveCount(0);
});

test("[contract:privacy_updated] saving browser privacy rules uses the current account and confirms the write", async ({
  page,
}, testInfo) => {
  let writes = 0;
  let rules: { sites: { origin: string; access: "ask" | "block" }[] } = { sites: [] };
  await page.route("**/api/work/browser?**", async (route) => {
    const request = route.request();
    const query = new URL(request.url()).searchParams;
    if (query.get("scope") !== "permissions") return route.fallback();
    expect(query.get("expectedUserId")).toBe(owner);
    if (request.method() === "GET")
      return route.fulfill({
        json: { rules, readiness: { available: true, origins: [], siteRulesEnforced: true } },
      });
    expect(request.postDataJSON()).toEqual({
      expectedUserId: owner,
      rules: { sites: [{ origin: "https://example.com", access: "block" }] },
    });
    if (++writes === 1)
      return route.fulfill({ status: 409, json: { error: "work_browser_action_unconfirmed" } });
    rules = request.postDataJSON().rules;
    return route.fulfill({ json: { rules } });
  });
  await page.goto("/settings/cloud-browser");
  await waitForKovaHydration(page);
  const form = page.getByRole("region", { name: "Cloud Browser settings" });
  const title = "Cloud Browser privacy settings updated";
  const update = async () => {
    await form.getByRole("textbox", { name: "Website" }).fill("https://example.com");
    await form.getByRole("combobox", { name: "Rule" }).selectOption("block");
    await form.getByRole("button", { name: "Save site rule" }).click();
  };
  await update();
  await expect(form.getByRole("alert")).toContainText("Permissions were not confirmed saved");
  await expect(page.getByText(title, { exact: true })).toHaveCount(0);
  await page.reload();
  await waitForKovaHydration(page);
  await update();
  const toast = page.locator("[data-sonner-toast]").filter({ hasText: title });
  await expect(toast).toBeVisible();
  expect(writes).toBe(2);
  await testInfo.attach("browser-privacy-rules-" + testInfo.project.name, {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await toast.getByRole("button", { name: "Close toast" }).click();
  await expect(toast).toBeHidden();
  await page.reload();
  await waitForKovaHydration(page);
  await expect(form.getByText("https://example.com", { exact: true })).toBeVisible();
  await expect(page.getByText(title, { exact: true })).toHaveCount(0);
});
