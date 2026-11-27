import { expect, type Locator, type Page } from "@playwright/test";
import { SIDEBAR_DRAWER_QUERY } from "../../src/lib/sidebar-viewport";
import { waitForKovaHydration } from "./hydration";

export async function expectsSeparateModeRow(composer: Locator) {
  return composer.evaluate((frame) => {
    const container = frame.closest(".spec400-chat-input")!;
    const styles = getComputedStyle(container);
    const contentWidth =
      container.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight);
    // A model name needs 22.5rem beside the actions; the Thinking toggle fits down to 20rem.
    const thinkingOnly =
      document.documentElement.dataset.kovaSurface !== "app" &&
      frame.querySelector(".kova-thinking-toggle") !== null &&
      frame.querySelector(".kova-consumer-model-trigger, .kova-home-model-placeholder") === null;
    const threshold = thinkingOnly ? 20 : 22.5;
    return (
      contentWidth < threshold * parseFloat(getComputedStyle(document.documentElement).fontSize)
    );
  });
}

// Response preferences remain in Settings after the composer tray was simplified.
export async function openResponseOptions(page: Page, recordTrigger?: (trigger: Locator) => void) {
  const panel = await openCurrentSettings(page);
  recordTrigger?.(page.getByRole("button", { name: "Account menu", exact: true }));
  await chooseSettingsSection(page, "Responses");
  return panel;
}

export async function closeCurrentSettings(page: Page) {
  const settings = page.locator(".kova-settings-dialog");
  await settings.getByRole("button", { name: "Close settings", exact: true }).click();
  await expect(settings).toBeHidden();
}

export async function openComposerAddMenu(page: Page) {
  await page.getByRole("button", { name: "Attach", exact: true }).click();
  const menu = page
    .getByRole("dialog", { name: /^(Attach|Attach files and tools)$/ })
    .filter({ visible: true });
  await expect(menu).toBeVisible();
  return menu;
}

export async function composerResourceTrigger(
  page: Page,
  name: "Choose project" | "Files" | "Plugins",
) {
  await expect(page.getByRole("textbox", { name: "Message KovaGPT", exact: true })).toBeEnabled();
  const trayAction = page.locator(".kova-composer-tray").getByRole("button", { name, exact: true });
  if (await trayAction.isVisible()) return trayAction;
  const menu = await openComposerAddMenu(page);
  return menu.getByRole("button", { name, exact: true });
}

export async function revealSidebar(page: Page) {
  const navigation = page
    .getByRole("navigation", { name: "Primary navigation", exact: true })
    .or(page.getByRole("dialog", { name: "Primary navigation", exact: true }));
  if (!(await navigation.isVisible())) {
    try {
      await page
        .getByRole("button", {
          name: /^(Open menu|Open sidebar|Expand sidebar|Toggle sidebar)$/,
        })
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

export function usesSidebarDrawer(page: Page) {
  return page.evaluate((query) => matchMedia(query).matches, SIDEBAR_DRAWER_QUERY);
}

export async function dismissMobileSidebar(page: Page) {
  const drawer = page.getByRole("dialog", {
    name: "Primary navigation",
    exact: true,
  });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "Close sidebar", exact: true }).click();
  await expect(drawer).toBeHidden();
}

export async function revealContinueWorking(page: Page) {
  await expect(page.locator(".kova-empty-chat .spec400-recent-work")).toBeAttached();
  const recommendations = page.getByRole("region", { name: "Continue working", exact: true });
  if (await recommendations.isVisible()) return recommendations;
  const drawer = await revealSidebar(page);
  const chats = drawer.getByRole("region", { name: "Chats", exact: true });
  await expect(chats).toBeVisible();
  return chats;
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
  const account = navigation.getByRole("button", {
    name: "Account menu",
    exact: true,
  });
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
  const menuSettings = page.getByRole("menuitem", {
    name: "Settings",
    exact: true,
  });
  await expect(surface.or(menuSettings).filter({ visible: true }).first()).toBeVisible();
  if (!(await surface.isVisible())) await menuSettings.click();
  await expect(surface).toBeVisible({ timeout: 10_000 });
  return surface;
}

export async function chooseSettingsSection(page: Page, section: string) {
  const surface = page.locator(".kova-settings-dialog");
  // The redesigned Settings navigation exposes these as top-level sections.
  // Retain aliases for tests written against the old nested Settings labels.
  const labels: Record<string, string> = {
    "Data control": "Data controls",
    Privacy: "Data controls",
    Responses: "General",
    General: "General",
    Billing: "Subscriptions",
    "Safety & security": "Security and login",
    Security: "Security and login",
    "Keyboard shortcuts": "Keyboard",
    Email: "Account",
    Memory: "Personalization",
    Apps: "Connections",
  };
  const label = labels[section] ?? section;
  const search = surface.getByPlaceholder("Search settings", { exact: true });
  const back = surface.getByRole("button", {
    name: "Back to settings",
    exact: true,
  });
  await expect(search.or(back).filter({ visible: true }).first()).toBeVisible();
  if (!(await search.isVisible())) await back.click();
  // Search results now overlay the unchanged sidebar. Choose the matching result.
  await search.fill(label);
  await surface
    .getByRole("group", { name: "Matching settings" })
    .getByRole("button", { name: label, exact: true })
    .click();
  await expect(surface.getByRole("tabpanel").first()).toBeVisible();
  return surface;
}
