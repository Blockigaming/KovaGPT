import { expect, type Page } from "@playwright/test";
import { waitForKovaHydration } from "./hydration";

export async function openResponseOptions(page: Page) {
  const panel = page.getByRole("dialog", { name: "Response options", exact: true });
  if (!(await panel.isVisible())) {
    await page.getByRole("button", { name: "Options", exact: true }).click();
  }
  await expect(panel).toBeVisible();
  return panel;
}

export async function revealSidebar(page: Page) {
  const navigation = page
    .getByRole("navigation", { name: "Primary navigation", exact: true })
    .or(page.getByRole("dialog", { name: "Primary navigation", exact: true }));
  if (!(await navigation.isVisible())) {
    try {
      await page
        .getByRole("button", { name: /^(Open menu|Open sidebar|Expand sidebar|Toggle sidebar)$/ })
        .filter({ visible: true })
        .first()
        .click({ timeout: 5_000 });
    } catch (error) {
      // A returning profile can open its saved sidebar while the click waits.
      // That transition already satisfies this helper; other failures still fail.
      if (!(await navigation.isVisible())) throw error;
    }
  }
  await expect(navigation).toBeVisible();
  return navigation;
}

export async function openCurrentSettings(page: Page) {
  await waitForKovaHydration(page);
  const navigation = await revealSidebar(page);
  const account = navigation.getByRole("button", { name: "Account menu", exact: true });
  if (await account.count()) {
    await account.click();
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  } else {
    await navigation.getByRole("button", { name: "Settings", exact: true }).click();
  }
  const surface = page.locator(".kova-settings-dialog");
  await expect(surface).toBeVisible();
  return surface;
}

export async function chooseSettingsSection(page: Page, section: string) {
  const surface = page.locator(".kova-settings-dialog");
  const labels: Record<string, string> = {
    "Data control": "Privacy",
    General: "Responses",
    Personalization: "Profile",
    Subscriptions: "Billing",
    Apps: "Connections",
  };
  const secondary: Record<string, string> = {
    Storage: "Privacy",
    Memory: "Privacy",
    "Safety & security": "Privacy",
    "Keyboard shortcuts": "Responses",
    Email: "Profile",
    Location: "Privacy",
    "Parental controls": "Privacy",
    "Family Center": "Connections",
    About: "Profile",
  };
  const label = secondary[section] ?? labels[section] ?? section;
  const tab = surface.getByRole("tab", { name: label, exact: true });
  if (await tab.isVisible()) {
    await tab.click();
  } else {
    await surface.getByRole("button", { name: "Section", exact: true }).click();
    await page
      .getByRole("listbox", { name: "Suggestions", exact: true })
      .getByRole("option", { name: new RegExp(`^${label}(?: Selected)?$`) })
      .click();
  }
  if (secondary[section]) {
    const names: Record<string, string> = {
      Memory: "Saved memory",
      "Safety & security": "Security",
    };
    const button = surface.getByRole("button", { name: names[section] ?? section, exact: true });
    const moreDetails = surface.locator("details").filter({
      has: page.locator("summary").filter({ hasText: /^More / }),
    });
    // The section picker can retain an already-open disclosure across a
    // same-section selection. Button visibility may be temporarily false while
    // the page swaps content, so toggling on that signal can close it instead.
    if (!(await moreDetails.evaluate((details) => (details as HTMLDetailsElement).open)))
      await moreDetails.locator("summary").click();
    await expect(button).toBeVisible();
    await button.click();
  }
  await expect(surface.getByRole("tabpanel").first()).toBeVisible();
  return surface;
}
