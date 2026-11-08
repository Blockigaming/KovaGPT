import { test, expect } from "@playwright/test";
import { coreFixture } from "./core-app-fixture";
import { functionNames } from "./actual-app-fixture";
import { waitForKovaHydration } from "./hydration";
import { revealSidebar, openCurrentSettings, chooseSettingsSection } from "./current-ui";

for (const theme of ["dark", "light"] as const) {
  test(`${theme} profile identity uses the readable theme foreground and Upgrade redirects immediately`, async ({
    page,
  }) => {
    await coreFixture(page, theme);
    let creates = 0;
    await page.route("**/_serverFn/**", async (route) => {
      const name =
        functionNames.get(new URL(route.request().url()).pathname.split("/").at(-1)!) || "";
      if (name.startsWith("createCheckoutSession_")) {
        creates++;
        return route.fulfill({
          json: {
            result: { url: "https://checkout.stripe.com/c/pay/cs_test_profile" },
            context: {},
          },
        });
      }
      return route.fallback();
    });
    await page
      .context()
      .route("https://checkout.stripe.com/**", (route) =>
        route.fulfill({ contentType: "text/html", body: "<h1>Checkout fixture</h1>" }),
      );
    await page.goto("/");
    await waitForKovaHydration(page);
    const sidebar = await revealSidebar(page);
    await sidebar.getByRole("button", { name: "Account menu", exact: true }).click();
    const identity = page.locator(".kova-profile-menu-account");
    await expect(identity).toBeVisible();
    const colors = await identity.evaluate((node) =>
      [...node.querySelectorAll("strong,small")].map((child) => ({
        color: getComputedStyle(child).color,
        opacity: getComputedStyle(child).opacity,
      })),
    );
    expect(colors).toHaveLength(3);
    const foreground = await identity.evaluate((node) => getComputedStyle(node).color);
    for (const entry of colors) {
      expect(entry.color).toBe(foreground);
      expect(entry.opacity).toBe("1");
    }
    const rgb = foreground.match(/\d+/g)!.slice(0, 3).map(Number);
    if (theme === "dark") expect(Math.min(...rgb)).toBeGreaterThan(200);
    else expect(Math.max(...rgb)).toBeLessThan(100);
    await page.getByRole("menuitem", { name: "Upgrade plan", exact: true }).click();
    await expect(page).toHaveURL("https://checkout.stripe.com/c/pay/cs_test_profile");
    expect(creates).toBe(1);
  });
}

test("Manage subscription opens the hosted portal directly with no checkout or purchase", async ({
  page,
}) => {
  await coreFixture(page, "dark", "plus");
  let portals = 0;
  let checkouts = 0;
  await page.route("**/_serverFn/**", async (route) => {
    const name =
      functionNames.get(new URL(route.request().url()).pathname.split("/").at(-1)!) || "";
    if (name.startsWith("getSubscriptionSummary_"))
      return route.fulfill({
        json: {
          result: {
            effectiveTier: "plus",
            tier: "plus",
            hasBillingAccount: true,
            billingPortalAvailable: true,
            activeSubscriptionCount: 1,
          },
          context: {},
        },
      });
    if (name.startsWith("createPortalSession_")) {
      portals++;
      return route.fulfill({
        json: { result: { url: "https://billing.stripe.com/p/session/test_profile" }, context: {} },
      });
    }
    if (name.startsWith("createCheckoutSession_")) checkouts++;
    return route.fallback();
  });
  await page
    .context()
    .route("https://billing.stripe.com/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "<h1>Portal fixture</h1>" }),
    );
  await page.goto("/");
  await waitForKovaHydration(page);
  await openCurrentSettings(page);
  await chooseSettingsSection(page, "Subscriptions");
  await page.getByRole("button", { name: "Manage subscription", exact: true }).click();
  await expect(page).toHaveURL("https://billing.stripe.com/p/session/test_profile");
  expect(portals).toBe(1);
  expect(checkouts).toBe(0);
});
