import { expect, type Locator, type Page } from "@playwright/test";
import { waitForKovaHydration } from "./hydration";

export async function openResponseOptions(page: Page, recordTrigger?: (trigger: Locator) => void) {
  const panel = page.getByRole("dialog", { name: "Response options", exact: true });
  if (!(await panel.isVisible())) {
    const options = page.getByRole("button", { name: "Options", exact: true });
    if (await options.isVisible()) {
      recordTrigger?.(options);
      await options.click();
    } else {
      const attach = page.getByRole("button", { name: "Attach", exact: true });
      recordTrigger?.(attach);
      await attach.click();
      await page
        .getByTestId("mobile-bottom-sheet")
        .getByRole("button", { name: "Response options", exact: true })
        .click();
    }
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
  const surface = page.locator(".kova-settings-dialog");
  if (await surface.isVisible()) return surface;
  const navigation = page
    .getByRole("navigation", { name: "Primary navigation", exact: true })
    .or(page.getByRole("dialog", { name: "Primary navigation", exact: true }));
  const railSettings = page
    .getByRole("navigation", { name: "Collapsed navigation", exact: true })
    .getByRole("button", { name: "Settings", exact: true });
  const account = navigation.getByRole("button", { name: "Account menu", exact: true });
  try {
    await revealSidebar(page);
    // Authentication can replace the guest Settings button with Account menu.
    // Resolve either real control at click time instead of branching on count().
    await account
      .or(navigation.getByRole("button", { name: "Settings", exact: true }))
      .filter({ visible: true })
      .first()
      .click({ timeout: 4_000 });
  } catch (error) {
    // Only use the rail once the expanded navigation is actually gone. During
    // its animation the rail can still be visible underneath the open footer.
    if ((await navigation.isVisible()) || !(await railSettings.isVisible())) throw error;
    await railSettings.click({ timeout: 4_000 });
  }
  const menuSettings = page.getByRole("menuitem", { name: "Settings", exact: true });
  await expect(surface.or(menuSettings).filter({ visible: true }).first()).toBeVisible();
  if (!(await surface.isVisible())) await menuSettings.click();
  await expect(surface).toBeVisible();
  return surface;
}

export async function chooseSettingsSection(page: Page, section: string) {
  const surface = page.locator(".kova-settings-dialog");
  const labels: Record<string, string> = {
    "Data control": "Privacy",
    General: "Responses",
    Personalization: "Profile",
    Subscriptions: "Subscriptions",
    Billing: "Subscriptions",
    "Safety & security": "Security",
    Apps: "Connections",
  };
  const secondary: Record<string, string> = {
    "Keyboard shortcuts": "Responses",
    Email: "Profile",
    Location: "Privacy",
    "Parental controls": "Privacy",
    "Family Center": "Connections",
    About: "Profile",
  };
  const label = secondary[section] ?? labels[section] ?? section;
  const tab = surface.getByRole("tab", { name: label, exact: true });
  const picker = surface.getByRole("button", { name: "Section", exact: true });
  const chooseWithPicker = async () => {
    await picker.click();
    await page
      .getByRole("listbox", { name: "Suggestions", exact: true })
      .getByRole("option", { name: new RegExp(`^${label}(?: Selected)?$`) })
      .click();
  };
  if (await tab.isVisible()) {
    try {
      await tab.click({ timeout: 4_000 });
    } catch (error) {
      // Restoring the sidebar can narrow the settings container after its tabs
      // first appear. Use the real section picker only if that layout replaced
      // the tab; unrelated click failures must still fail the test.
      if (
        !(error instanceof Error) ||
        error.name !== "TimeoutError" ||
        (await tab.isVisible()) ||
        !(await picker.isVisible())
      )
        throw error;
      await chooseWithPicker();
    }
  } else {
    await chooseWithPicker();
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
